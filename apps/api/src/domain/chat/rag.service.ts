import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { AI_FUNCTION } from '@sharptalk/types';
import { KbDocument } from '../knowledge/entity/kb-document.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { normalizeStorefrontUrl, productLinkFor } from '../../global/util/storefront-url.util';
import { AiGatewayService } from '../../infrastructure/external/ai/ai-gateway.service';
import { QdrantService } from '../../infrastructure/external/vector/qdrant.service';
import { AiConfigService } from '../ai-engine/ai-config.service';
import type { AiMessage } from '../../infrastructure/external/ai/ai-adapter.interface';
import { capContext, selectPassages, titleMatchScore } from './passage.util';
import { AnswerFooter, footerFor } from '../ai-engine/answer-footer.util';
import { envNumber } from '../../global/util/env-number.util';
import { CONVERSATION_RULES, transcript, withCurrentTurn } from './conversation-history.util';

export interface RetrievedChunk {
  id: number;
  title: string;
  category: string | null;
  source: string;
  /** counsel | product — lets the widget label product recommendations. */
  group: string;
  /**
   * Customer-facing link, or null. Only set for product documents whose
   * source_url is on the tenant's own storefront: the value arrives in an
   * operator-uploaded CSV and the widget turns it into a clickable link inside
   * a shopper's conversation.
   */
  url: string | null;
  snippet: string;
  /** Dense similarity (dot, normalized vectors) when the vector leg saw this doc. */
  similarity: number | null;
  /** A simulation candidate injected by the board review (PLN-260829 B2) — not a stored KB document. */
  candidate?: boolean;
}

/** A not-yet-adopted board document, ranked as if it were knowledge (B2 P4-4). */
export interface RagCandidateInput {
  title: string;
  content: string;
  category: string | null;
  group: string;
}

export interface RagAnswer {
  text: string;
  confidence: number;
  citations: RetrievedChunk[];
  /** Every injected candidate with its rank/similarity — cited or not (B2). */
  candidateResults?: RetrievedChunk[];
  tokensIn: number;
  tokensOut: number;
}

/**
 * What to do on a turn with nothing to retrieve (PLN-260813 P2). These steer
 * the model; the customer never sees them.
 */
const NO_KNOWLEDGE_INSTRUCTION: Record<string, string> = {
  smalltalk:
    'The shopper is making small talk — a greeting, thanks or a compliment. ' +
    'Answer warmly and briefly, then ask in one sentence what you can help with. ' +
    'Do not mention the knowledge base, documents, or that you searched.',
  out_of_scope:
    'The shopper asked something this shop cannot answer (weather, exchange ' +
    'rates, news). Say plainly that this is outside what you can help with, ' +
    'then name what you CAN help with (orders, delivery, returns, products). ' +
    'Never guess or invent the information they asked for.',
  unintelligible:
    'The message cannot be read as a question. Say you did not catch that and ' +
    'ask them to rephrase. Do not guess at what they meant.',
};

/**
 * Confidence floor when the answer is grounded in the customer's own order data.
 * Must stay above ChatService's escalation threshold so a factual order answer is
 * delivered rather than handed off for lack of a matching help article.
 */
const ORDER_CONTEXT_CONFIDENCE = 0.6;

/**
 * The model's bookkeeping line naming the context items it used ("CITED: 1,3").
 * Deliberately forgiving — a stray bullet, bold marker or trailing period must
 * still be recognised, because a marker we fail to match is a marker the
 * customer would read in the chat bubble.
 */
const CITED_LINE = /^[\s>*_`-]*cited\s*:?\s*([\d,\s]*)[\s.*_`-]*$/gim;

/**
 * Split the answer text from that marker. Returns the customer-facing text and
 * the 1-based item numbers, or `cited: null` when the model wrote no marker at
 * all — the caller then keeps every citation rather than dropping them.
 */
export function splitCitedMarker(raw: string): { text: string; cited: number[] | null } {
  let found = false;
  const cited = new Set<number>();
  const text = raw
    .replace(CITED_LINE, (_match, list: string) => {
      found = true;
      for (const part of list.split(',')) {
        const n = Number(part.trim());
        if (Number.isInteger(n) && n > 0) cited.add(n);
      }
      return '';
    })
    .trim();
  return { text, cited: found ? [...cited] : null };
}

/**
 * Retrieval-Augmented answering (FN-016/017, POL-011/013,
 * PLAN-KB-VectorHybrid-Qdrant W4). Hybrid retrieval: MySQL FULLTEXT (exact
 * keyword leg) + Qdrant dense vectors (semantic leg, cross-lingual ko/en/es),
 * merged with Reciprocal Rank Fusion. Only active KB documents scoped to the
 * tenant are retrieved, excluding those from a source the operator has
 * un-designated (Knowledge Store wins; Google Drive supplements). The vector leg degrades silently — Qdrant/embedder failures
 * fall back to FULLTEXT-only, which is the pre-hybrid behavior.
 *
 * An answer may additionally be grounded in the signed-in customer's own order
 * facts, which no KB document can contain — see `answer`'s `orderContext`.
 */
/**
 * Added when the tenant's contact footer is on (PLN-261007 R4): the system
 * appends it, so a contact block written by the model would be a duplicate —
 * and the model's copy was where masking and token cut-offs did their damage.
 */
const FOOTER_RULE =
  '\n- Do not end your reply with contact details (e-mail, phone, hotline, ' +
  'Zalo, working hours): the system appends the official contact block. Give ' +
  'contact details in the body only when the customer asks how to reach support.';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  /** Per-leg candidate depth before fusion; the merged top-`limit` is returned. */
  private static readonly LEG_LIMIT = 8;
  /** RRF constant (standard k=60). */
  private static readonly RRF_K = 60;
  /** POL-013 nudge: knowledge_store outranks google_drive on near-ties. */
  private static readonly SOURCE_BONUS = 0.0005;
  /**
   * Nudge toward the caller's preferred document group (PLN-260804 D3).
   * Deliberately a bonus, not a filter: a product question can still need the
   * return policy, so the other group must stay reachable. Larger than
   * SOURCE_BONUS so group preference outranks provenance, small enough that it
   * cannot invert a clear RRF gap.
   */
  private static readonly GROUP_BONUS = 0.002;
  /**
   * Slots that go to the best documents by unbiased rank whatever the group
   * preference says (PLN-260929 S9). The bonus above was meant to be a nudge,
   * but RRF gaps between neighbouring ranks are ~0.0003, so 0.002 jumps about
   * ten places — in a KB of 2,275 products and ~30 policy sections a question
   * the classifier labelled product_inquiry ("What is your return policy?")
   * came back with six products and no policy at all, and the model said it
   * had no information (measured on staging 2026-09-29).
   */
  private static readonly UNBIASED_RESERVE = 3;
  /** Confidence when real embeddings are expected but missing — under escalation (FIX-260930). */
  private static readonly DEGRADED_CONFIDENCE = 0.2;
  /**
   * Documents handed to the model per answer. Was 4, which is too few for this
   * KB: the policy import splits one topic across several short sections
   * (`2.1.3 Shipping Rates`, `2.2.4 Return Shipment Deadline`, …), so a
   * multi-part question ("how do I return an item and get a refund?") retrieved
   * one fragment, answered partially, and offered a human agent for the rest —
   * measured on staging 2026-08-07. Six covers those fan-outs while staying
   * under LEG_LIMIT, so fusion still has candidates to rank.
   */
  private static readonly TOP_K = 6;
  /**
   * Vector hits below this dot score are discarded. Qdrant always returns the
   * nearest neighbors, so without a floor an off-topic query pads the context
   * with irrelevant docs and suppresses escalation. Near-zero cutoff is safe
   * for both voyage (unrelated ≈ 0.3+) and the stub (zero-overlap = 0).
   */
  private static readonly VECTOR_SCORE_FLOOR = 0.01;

  constructor(
    @InjectRepository(KbDocument) private readonly kbRepo: Repository<KbDocument>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    private readonly ai: AiGatewayService,
    private readonly qdrant: QdrantService,
    private readonly aiConfig: AiConfigService,
  ) {}

  /** The tenant's storefront origin, or null when nobody has configured one. */
  private async storefrontFor(tenantId: number): Promise<string | null> {
    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: ['id', 'storefrontUrl'],
    });
    return normalizeStorefrontUrl(tenant?.storefrontUrl);
  }

  /**
   * `aiAgentId` narrows the result to what that agent may cite. Omitting it
   * retrieves everything the tenant has — which is what the console and agent
   * coaching want: a person managing the knowledge base has to see all of it.
   */
  async retrieve(
    tenantId: number,
    query: string,
    limit = RagService.TOP_K,
    aiAgentId?: number | null,
  ): Promise<RetrievedChunk[]> {
    const scopeAgentId =
      aiAgentId == null ? null : await this.aiConfig.effectiveAgentId(tenantId, aiAgentId);
    return (await this.retrieveHybrid(tenantId, query, limit, undefined, scopeAgentId)).chunks;
  }

  /**
   * Top `limit` with the group bonus applied, except that the best
   * UNBIASED_RESERVE documents by plain score always keep a place (S9). Result
   * is ordered by the biased score, so a preferred document still leads.
   */
  static rankWithPreference<T extends { doc: { docGroup?: string | null }; rrf: number }>(
    scored: T[],
    limit: number,
    preferGroup?: string,
  ): T[] {
    const plain = [...scored].sort((a, b) => b.rrf - a.rrf);
    if (!preferGroup) return plain.slice(0, limit);
    const biasedScore = (e: T) =>
      e.rrf + (e.doc.docGroup === preferGroup ? RagService.GROUP_BONUS : 0);
    const kept = new Set(plain.slice(0, Math.min(RagService.UNBIASED_RESERVE, limit)));
    for (const e of [...scored].sort((a, b) => biasedScore(b) - biasedScore(a))) {
      if (kept.size >= limit) break;
      kept.add(e);
    }
    return [...kept]
      .sort((a, b) => biasedScore(b) - biasedScore(a))
      .map((e) => ({ ...e, rrf: biasedScore(e) }));
  }

  /**
   * A document whose title is (nearly) the question goes to the top
   * (FIX-261007-FAQ-Title-Match). RRF scores sit around 0.016–0.033, so 0.05
   * outranks any fusion result; a partial match gets a nudge only.
   */
  static titleBonus(title: string | null | undefined, query: string): number {
    const s = titleMatchScore(title ?? '', query);
    if (s >= 0.8) return 0.05;
    if (s >= 0.6) return 0.004;
    return 0;
  }

  /** Results kept from the current-message search when it is merged with the contextual one. */
  private static readonly OWN_QUERY_RESERVE = 3;

  /**
   * The current message's best hits first (up to OWN_QUERY_RESERVE), then the
   * contextual search's, then the rest of the current message's — deduplicated
   * by document, capped at `limit` (FIX-261007-Topic-Switch). A topic switch
   * keeps its own documents; a topic-less follow-up still gets the context's,
   * because its own search finds little and the context fills the slots.
   */
  static mergeOwnFirst<T extends { id: number }>(own: T[], contextual: T[], limit: number): T[] {
    const out: T[] = [];
    const seen = new Set<number>();
    const take = (c: T) => {
      if (out.length < limit && !seen.has(Number(c.id))) {
        seen.add(Number(c.id));
        out.push(c);
      }
    };
    own.slice(0, RagService.OWN_QUERY_RESERVE).forEach(take);
    contextual.forEach(take);
    own.slice(RagService.OWN_QUERY_RESERVE).forEach(take);
    return out;
  }

  /**
   * The contact footer to append to a knowledge answer in this language, or
   * null (PLN-261007 R4). Operator-written fixed text — appended after
   * moderation, the same standing as a scenario script.
   */
  async footerText(tenantId: number, language: string): Promise<string | null> {
    return footerFor(await this.aiConfig.getAnswerFooter?.(tenantId), language);
  }

  /** The tenant's footer config (null = none) — the chat strips copies of it. */
  async footerConfig(tenantId: number): Promise<AnswerFooter | null> {
    return (await this.aiConfig.getAnswerFooter?.(tenantId)) ?? null;
  }

  /** Who is answering, after inactive/unknown pins degrade to the default. */
  effectiveAgentId(tenantId: number, aiAgentId?: number | null): Promise<number | null> {
    return this.aiConfig.effectiveAgentId(tenantId, aiAgentId);
  }

  /**
   * How well the knowledge base covers `query`, on the same scale `answer()`
   * reports — retrieval only, no model call (PLN-260929 S6). Lets the chat path
   * second-guess an out_of_scope label: the classifier assumes a shop, so a
   * cleaning company's "에어컨 청소 예약" was refused while its price sheet sat
   * in the knowledge base.
   */
  async groundingConfidence(
    tenantId: number,
    query: string,
    aiAgentId?: number | null,
  ): Promise<number> {
    const { chunks, vectorProvider } = await this.retrieveHybrid(
      tenantId,
      query,
      RagService.TOP_K,
      undefined,
      aiAgentId ?? null,
    );
    return this.confidence(chunks, vectorProvider);
  }

  private async retrieveHybrid(
    tenantId: number,
    query: string,
    limit = 4,
    preferGroup?: string,
    aiAgentId?: number | null,
  ): Promise<{ chunks: RetrievedChunk[]; vectorProvider: string | null }> {
    const [ftDocs, vec] = await Promise.all([
      this.retrieveFulltext(tenantId, query, RagService.LEG_LIMIT, aiAgentId),
      this.retrieveVector(tenantId, query, RagService.LEG_LIMIT),
    ]);
    // Uncalibrated (stub) vector scores may RANK docs but never ADMIT them:
    // hash-collision noise would otherwise pad off-topic queries with random
    // documents and suppress escalation. Real embeddings (voyage) admit freely —
    // that cross-lingual/semantic admission is the point of the vector leg.
    const ftIds = new Set(ftDocs.map((d) => Number(d.id)));
    const vecHits =
      vec.provider === 'voyage' ? vec.hits : vec.hits.filter((h) => ftIds.has(h.id));

    // RRF over the two legs; similarity rides along from the vector hits.
    // Number() on every doc id: MySQL bigint PKs are strings at runtime, and a
    // string-keyed map entry would never fuse with the numeric Qdrant ids.
    const fused = new Map<number, { rrf: number; similarity: number | null }>();
    ftDocs.forEach((d, rank) => {
      const id = Number(d.id);
      const e = fused.get(id) ?? { rrf: 0, similarity: null };
      e.rrf += 1 / (RagService.RRF_K + rank + 1);
      fused.set(id, e);
    });
    vecHits.forEach((h, rank) => {
      const e = fused.get(h.id) ?? { rrf: 0, similarity: null };
      e.rrf += 1 / (RagService.RRF_K + rank + 1);
      e.similarity = h.score;
      fused.set(h.id, e);
    });

    // Hydrate vector-only ids from MySQL (tenant scope re-checked — defense in depth).
    const ftById = new Map(ftDocs.map((d) => [Number(d.id), d]));
    const missingIds = [...fused.keys()].filter((id) => !ftById.has(id));
    if (missingIds.length) {
      // The vector leg searches Qdrant, which knows nothing about categories or
      // agents; re-hydrating through baseQuery is what applies the scope to it.
      const rows = await this.baseQuery(tenantId, aiAgentId)
        .andWhere({ id: In(missingIds) })
        .getMany();
      rows.forEach((d) => ftById.set(Number(d.id), d));
    }

    const scored = [...fused.entries()]
      .map(([id, e]) => ({ doc: ftById.get(id), ...e }))
      .filter((e): e is { doc: KbDocument; rrf: number; similarity: number | null } => !!e.doc)
      .map((e) => ({
        ...e,
        rrf:
          e.rrf +
          (e.doc.source === 'knowledge_store' ? RagService.SOURCE_BONUS : 0) +
          RagService.titleBonus(e.doc.title, query),
      }));
    const ranked = RagService.rankWithPreference(scored, limit, preferGroup);

    const storefront = await this.storefrontFor(tenantId);
    const chunks = ranked.map(({ doc, similarity }) => ({
      id: Number(doc.id),
      title: doc.title,
      category: doc.category,
      source: doc.source,
      group: doc.docGroup,
      url: productLinkFor(doc.docGroup, doc.sourceUrl, storefront),
      // Whole document up to the budget, else the paragraphs matching the query (R3).
      snippet: selectPassages(doc.content ?? '', query),
      similarity,
    }));
    return { chunks, vectorProvider: vec.provider };
  }

  /** Keyword leg — FULLTEXT MATCH (PERF-2), LIKE scan when the index is absent. */
  private async retrieveFulltext(
    tenantId: number,
    query: string,
    limit: number,
    aiAgentId?: number | null,
  ): Promise<KbDocument[]> {
    const terms = query
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .slice(0, 8);

    if (!terms.length) {
      return this.baseQuery(tenantId, aiAgentId)
        .orderBy("CASE WHEN kb.source = 'knowledge_store' THEN 0 ELSE 1 END", 'ASC')
        .addOrderBy('kb.updatedAt', 'DESC')
        .take(limit)
        .getMany();
    }
    try {
      return await this.baseQuery(tenantId, aiAgentId)
        .addSelect('MATCH(kb.title, kb.content) AGAINST (:ftq IN NATURAL LANGUAGE MODE)', 'relevance')
        .andWhere('MATCH(kb.title, kb.content) AGAINST (:ftq IN NATURAL LANGUAGE MODE)')
        .setParameter('ftq', terms.join(' '))
        .orderBy("CASE WHEN kb.source = 'knowledge_store' THEN 0 ELSE 1 END", 'ASC')
        .addOrderBy('relevance', 'DESC')
        .take(limit)
        .getMany();
    } catch {
      // FULLTEXT index not present yet (pre-migration DB) — legacy LIKE scan.
      return this.retrieveLike(tenantId, terms, limit, aiAgentId);
    }
  }

  /** Semantic leg — embed the query, dense-search Qdrant. Failures return no hits. */
  private async retrieveVector(
    tenantId: number,
    query: string,
    limit: number,
  ): Promise<{ hits: { id: number; score: number }[]; provider: string | null }> {
    if (!this.qdrant.enabled) return { hits: [], provider: null };
    try {
      const emb = await this.ai.embed([query], 'query');
      const hits = await this.qdrant.search(tenantId, emb.vectors[0], limit);
      return {
        hits: hits.filter((h) => h.score >= RagService.VECTOR_SCORE_FLOOR),
        provider: emb.provider,
      };
    } catch (e) {
      this.logger.warn(`vector leg failed, FULLTEXT only: ${(e as Error).message}`);
      return { hits: [], provider: null };
    }
  }

  /**
   * The one place that decides what an answer may be grounded in.
   *
   * Both legs pass through here — the keyword leg queries it directly and the
   * vector leg re-hydrates its hits from it — so a rule added here cannot be
   * bypassed by whichever leg happened to find the document.
   */
  private baseQuery(tenantId: number, aiAgentId?: number | null) {
    const qb = (
      this.kbRepo
        .createQueryBuilder('kb')
        .where('kb.active = 1')
        .andWhere('(kb.tenantId = :tenantId OR kb.tenantId IS NULL)', { tenantId })
        // Un-designating a source is how an operator says "stop answering from
        // this". It never did: the flag lives on the source and retrieval only
        // ever looked at the document, so documents already ingested kept being
        // cited. Written as NOT IN the undesignated set rather than IN the
        // designated one, so documents with no source — hand-written, catalogue,
        // gap-promoted — are unaffected, and the subquery is empty in the normal
        // case where nothing has been turned off.
        .andWhere(
          `(kb.sourceId IS NULL OR kb.sourceId NOT IN
             (SELECT s.id FROM knowledge_sources s WHERE s.designated = 0))`,
        )
    );
    // Per-agent knowledge scope (REQ-260826 R2). Phrased as "not in the
    // categories this agent is excluded from" rather than "in the ones it is
    // allowed", so a tenant that has never scoped anything matches an empty set
    // and its answers are byte-identical to before. Documents with no category,
    // and categories nobody has narrowed, are never touched.
    //
    // `origin <> 'catalog'` is enforced here as well as on save: origin is a
    // property of what documents a category holds, so a hand-made category that
    // later takes catalogue documents flips to catalog while still carrying the
    // old narrowing (PR #342 met the same flip from the other side).
    if (aiAgentId != null) {
      qb.andWhere(
        `(kb.category IS NULL OR NOT EXISTS
           (SELECT 1 FROM kb_categories c
             WHERE c.tenant_id = :scopeTenantId
               AND c.doc_group = kb.doc_group
               AND c.name = kb.category
               AND c.origin <> 'catalog'
               AND JSON_LENGTH(c.agent_ids) > 0
               AND NOT JSON_CONTAINS(c.agent_ids, CAST(:scopeAgentId AS JSON))))`,
        { scopeTenantId: tenantId, scopeAgentId: aiAgentId },
      );
    }
    return qb;
  }

  /** Legacy keyword scan — only used when the FULLTEXT index is unavailable. */
  private async retrieveLike(
    tenantId: number,
    terms: string[],
    limit: number,
    aiAgentId?: number | null,
  ): Promise<KbDocument[]> {
    const qb = this.baseQuery(tenantId, aiAgentId).andWhere(
      new Brackets((b) => {
        terms.forEach((term, i) => {
          b.orWhere(`LOWER(kb.title) LIKE :t${i}`, { [`t${i}`]: `%${term}%` });
          b.orWhere(`LOWER(kb.content) LIKE :c${i}`, { [`c${i}`]: `%${term}%` });
        });
      }),
    );
    return qb
      .orderBy("CASE WHEN kb.source = 'knowledge_store' THEN 0 ELSE 1 END", 'ASC')
      .addOrderBy('kb.updatedAt', 'DESC')
      .take(limit)
      .getMany();
  }

  /**
   * Answer a shopper question from the tenant's knowledge base, optionally
   * grounded in `orderContext` — the signed-in customer's own order facts, which
   * the knowledge base cannot contain. Callers must only pass order data for an
   * authenticated session (see ChatService's auth gate).
   */
  async answer(
    tenantId: number,
    query: string,
    language: string,
    orderContext?: string,
    preferGroup?: string,
    retrievalQuery?: string,
    aiAgentId?: number | null,
    extraCandidates?: RagCandidateInput[],
    history?: AiMessage[],
  ): Promise<RagAnswer> {
    // The caller decides the group preference; RAG only applies it. Keeping the
    // judgement out of here means the chat path can use its intent label and
    // the console can pass an explicit choice, without RAG knowing about either.
    //
    // `retrievalQuery` lets the caller search with more words than the model is
    // asked to answer — chat passes the previous turns so a follow-up that only
    // makes sense in context ("and for my young son?") still retrieves the topic
    // it refers to. `history` is the conversation itself (PLN-260929 S2): the
    // model reads the earlier turns so it stops asking for what the customer
    // already gave. Console callers pass none and get the single-question
    // prompt unchanged.
    // `aiAgentId` is applied as given, never resolved here. Null means "no
    // scope" — the console's operator view, which has to see everything it
    // manages. A widget turn is a different thing: an unpinned session answers
    // AS the default agent, so `chat.service` resolves it before calling and
    // hands the id down. Resolving in here made both callers mean the same
    // thing, and the operator view silently lost every scoped category
    // (found in the staging smoke, T9).
    const scopeAgentId = aiAgentId ?? null;
    // eslint-disable-next-line prefer-const
    let { chunks, vectorProvider } = await this.retrieveHybrid(
      tenantId,
      retrievalQuery?.trim() || query,
      RagService.TOP_K,
      preferGroup,
      // The agent was already being passed for its persona; it decides what may
      // be retrieved as well (REQ-260826 R2).
      scopeAgentId,
    );
    // The current message searched on its own as well (FIX-261007-Topic-Switch).
    // Prepending the earlier turns rescues a follow-up with no topic words of
    // its own, but it also drags a NEW question back to the old topic: go2joy
    // "How do I process a guest check-in?" right after a staff-account answer
    // retrieved only staff documents (context query) while the check-in guide
    // was the top hit for the question alone — and the model said it had no
    // information, at 0.77. Both searches now contribute.
    if (retrievalQuery?.trim() && retrievalQuery.trim() !== query.trim()) {
      const own = await this.retrieveHybrid(tenantId, query, RagService.TOP_K, preferGroup, scopeAgentId);
      chunks = RagService.mergeOwnFirst(own.chunks, chunks, RagService.TOP_K);
      vectorProvider = vectorProvider ?? own.vectorProvider;
    }
    // Simulation candidates (B2): scored in the same embedding space and merged
    // by similarity, but NEVER written to Qdrant — a document an operator is
    // still judging must not be reachable from a real customer turn. Absent the
    // parameter this block is dead code and the production path is unchanged.
    if (extraCandidates?.length) {
      chunks = await this.mergeCandidates(retrievalQuery?.trim() || query, chunks, extraCandidates);
    }
    // Numbered so the model can name the items it actually used (see CITED_LINE).
    // Total prompt budget across documents (R3) — the numbering below must
    // match what the model sees, so the cap is applied to `chunks` itself.
    chunks = capContext(chunks);
    const context = chunks
      .map((c, i) => `[${i + 1}] [${c.category ?? 'general'}] ${c.title}: ${c.snippet}`)
      .join('\n');
    const hasOrderContext = !!orderContext?.trim();
    // Retrieval quality drives confidence, but order facts are authoritative on
    // their own: an order question answered from the customer's real orders must
    // not be escalated just because no help article matched.
    const confidence = Math.max(
      this.confidence(chunks, vectorProvider),
      hasOrderContext ? ORDER_CONTEXT_CONFIDENCE : 0,
    );

    // Persona + response rules of the session's AI agent (FR-047 / PLN-260820);
    // null falls back to the tenant's default agent.
    const { persona, rules } = await this.aiConfig.getPersonaRules(tenantId, aiAgentId);
    const rulesBlock = rules.length ? `\nResponse rules:\n${rules.map((r) => `- ${r}`).join('\n')}` : '';
    const orderBlock = hasOrderContext
      ? `\nCUSTOMER_ORDERS_START\n${orderContext!.trim()}\nCUSTOMER_ORDERS_END`
      : '';
    const sourceRule = hasOrderContext
      ? "Answer ONLY from the context and the customer's own order data below. " +
        'The order data is authoritative for their order status, items and totals; ' +
        'never invent order numbers, dates or tracking details that are not listed.'
      : 'Answer ONLY from the context.';
    const hasHistory = !!history?.length;

    // The tenant's contact footer is appended by the system (R4); the model is
    // told not to write its own, which also frees the output budget.
    const footerOn = !!footerFor(await this.aiConfig.getAnswerFooter?.(tenantId), language);
    const res = await this.ai.complete({
      tenantId,
      function: AI_FUNCTION.RAG,
      feature: 'chat_answer',
      // Long Vietnamese answers hit 1,024 and stopped mid-sentence (REQ-261007 I-5).
      maxTokens: envNumber('RAG_MAX_TOKENS', 2048),
      system:
        `${persona}${rulesBlock}${hasHistory ? CONVERSATION_RULES : ''}${footerOn ? FOOTER_RULE : ''}\n` +
        `${sourceRule} If the information is insufficient, apologize briefly and ` +
        `offer to connect a human agent. Reply in language code: ${language}.\n` +
        `The context items are numbered. After your reply, on its own final line, ` +
        `write "CITED:" followed by the numbers of the items your answer actually ` +
        `used, comma separated (write "CITED:" with nothing after it if you used ` +
        `none). That line is internal bookkeeping: never mention it, never number ` +
        `or refer to the context items in the visible reply.\n` +
        `CONTEXT_START\n${context || '(no relevant documents found)'}\nCONTEXT_END` +
        orderBlock,
      messages: withCurrentTurn(history, query),
    });

    // The engine failed and the stub's canned text came back (PLN-261007 D4).
    // Not an answer: zero confidence sends the turn to a person through the
    // ordinary low-confidence path instead of delivering "Here's what I found
    // for you: [category] title" as if it were one.
    if (res.degraded) {
      this.logger.warn(`answer withheld: engine degraded to stub (tenant ${tenantId})`);
      return { text: '', confidence: 0, citations: [], tokensIn: res.tokensIn, tokensOut: res.tokensOut };
    }

    // Show only what the answer stands on. The retrieved set is the top matches,
    // so recommending one cleanser used to surface a concealer and a night cream
    // next to it as "referenced" products (FIX-260806 §7-1). Matching the answer
    // text against titles cannot do this — replies are localized while the
    // catalogue titles are English — so the model reports which items it used.
    const { text, cited } = splitCitedMarker(res.text);
    return {
      text,
      confidence,
      // No marker (older/odd model output) → keep every citation, i.e. exactly
      // the previous behavior, rather than silently dropping all the links.
      citations: cited ? chunks.filter((_, i) => cited.includes(i + 1)) : chunks,
      // The simulation needs the candidate's similarity even when the model
      // did NOT cite it — "ranked 0.31, unused" is the finding.
      ...(extraCandidates?.length ? { candidateResults: chunks.filter((c) => c.candidate) } : {}),
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
    };
  }

  /** Cosine-rank the candidates against the query and merge (B2 P4-4). */
  private async mergeCandidates(
    query: string,
    chunks: RetrievedChunk[],
    candidates: RagCandidateInput[],
  ): Promise<RetrievedChunk[]> {
    const [qEmb, cEmb] = await Promise.all([
      this.ai.embed([query], 'query'),
      this.ai.embed(
        candidates.map((c) => `${c.title}\n${c.content}`.slice(0, 30_000)),
        'document',
      ),
    ]);
    const q = qEmb.vectors[0];
    const cosine = (v: number[]): number => {
      let dot = 0;
      let nq = 0;
      let nv = 0;
      for (let i = 0; i < Math.min(q.length, v.length); i++) {
        dot += q[i] * v[i];
        nq += q[i] * q[i];
        nv += v[i] * v[i];
      }
      const denom = Math.sqrt(nq) * Math.sqrt(nv);
      return denom > 0 ? dot / denom : 0;
    };
    const candidateChunks: RetrievedChunk[] = candidates.map((c, i) => ({
      // Negative synthetic ids — they can never collide with (or load) a real
      // kb_documents row downstream.
      id: -(i + 1),
      title: c.title,
      category: c.category,
      source: 'board',
      group: c.group,
      url: null,
      snippet: c.content.slice(0, 400),
      similarity: cosine(cEmb.vectors[i]),
      candidate: true,
    }));
    // Candidates are always in the context — the question being answered is
    // "what happens once this IS knowledge" — but they take their honest rank.
    return [...chunks, ...candidateChunks].sort(
      (a, b) => (b.similarity ?? -1) - (a.similarity ?? -1),
    );
  }

  /**
   * Similarity-based confidence (replaces the hit-count formula). The best
   * dense similarity IS the grounding signal: below RAG_MIN_SIMILARITY the
   * retrieval is judged off-topic and confidence drops to 0.2, which is under
   * the chat escalation threshold — "don't know → hand off" (policy §0.4).
   * Applied only for calibrated real embeddings (voyage): stub pseudo-vector
   * scores live on a different scale, and when the vector leg didn't run at
   * all (Qdrant disabled/down) there is no similarity — both cases fall back
   * to the legacy count-based estimate, i.e. the pre-hybrid behavior.
   */
  private confidence(chunks: RetrievedChunk[], vectorProvider: string | null): number {
    // Real embeddings are configured but this turn did not get them — the
    // gateway fell back to the stub, or the vector leg threw (FIX-260930 D2).
    // The count formula below then scored full-text noise at 0.95: ivyusa's
    // "What is your return policy?" was answered "I don't have that
    // information" with six unrelated products and nobody paged. Without the
    // signal we trust, "don't know → hand off" (policy §0.4) is the safe
    // reading, so the turn goes to a person instead.
    // Qdrant switched off is configuration, not failure — that keeps the
    // count-based estimate below, exactly as before.
    if (process.env.VOYAGE_API_KEY && this.qdrant.enabled && vectorProvider !== 'voyage') {
      this.logger.warn(`vector leg degraded (provider=${vectorProvider ?? 'none'}) — confidence withheld`);
      return RagService.DEGRADED_CONFIDENCE;
    }
    const best = chunks.reduce<number | null>(
      (m, c) => (c.similarity !== null && (m === null || c.similarity > m) ? c.similarity : m),
      null,
    );
    if (vectorProvider === 'voyage' && best !== null) {
      const minSim = envNumber('RAG_MIN_SIMILARITY', '0.45');
      return best >= minSim ? Math.min(0.95, Math.max(0.5, best)) : 0.2;
    }
    return chunks.length ? Math.min(0.95, 0.5 + chunks.length * 0.12) : 0.2;
  }

  /**
   * Reply to a turn that has nothing to look up (PLN-260813 P2).
   *
   * A greeting resembles no document, so retrieval returns nothing and the old
   * path read that as "no answer found" and paged a human. This answers from
   * the persona alone — no embedding, no vector search, no citations — which is
   * both correct and cheaper than the RAG call it replaces.
   */
  async answerWithoutKnowledge(
    tenantId: number,
    kind: 'smalltalk' | 'out_of_scope' | 'unintelligible',
    query: string,
    language: string,
    aiAgentId?: number | null,
    history?: AiMessage[],
  ): Promise<string> {
    const { persona, rules } = await this.aiConfig.getPersonaRules(tenantId, aiAgentId);
    const instruction = NO_KNOWLEDGE_INSTRUCTION[kind];
    // A misclassified reply ("1. 김익용" to "what is your name?") lands here too;
    // with the conversation in view the model answers it instead of saying it
    // did not understand (PLN-260929 S3).
    const memory = history?.length ? CONVERSATION_RULES : '';
    const res = await this.ai.complete({
      tenantId,
      function: AI_FUNCTION.RAG,
      feature: 'chat_rewrite',
      system:
        `${persona}\n${rules.map((r) => `- ${r}`).join('\n')}${memory}\n` +
        `${instruction}\nReply in ${language.toUpperCase()}. Two sentences at most.`,
      messages: withCurrentTurn(history, query),
    });
    // Empty = no reply could be written; the caller hands off (PLN-261007 D4).
    if (res.degraded) return '';
    return res.text.trim();
  }

  async classifyIntent(
    tenantId: number,
    query: string,
    recent?: AiMessage[],
  ): Promise<{ intent: string; needsOrderData: boolean; confidence: number; fallback?: boolean }> {
    // The exchange the message answers, as reference text in the system prompt
    // rather than as turns: the classifier labels the final message only
    // (PLN-260929 S4). Without it "벽걸이" or "1. 김익용" after a question read
    // as noise and fell into the no-knowledge branch.
    const recentBlock = recent?.length
      ? '\nRecent conversation (context only — classify ONLY the final shopper ' +
        `message):\n${transcript(recent)}\n` +
        "If the shopper's message answers a question the assistant just asked, " +
        'classify it by the topic of the conversation — never unintelligible, ' +
        'smalltalk or out_of_scope.'
      : '';
    const res = await this.ai.complete({
      tenantId,
      function: AI_FUNCTION.CHAT,
      feature: 'chat_rewrite',
      system:
        // A closed set, not free text (PLN-260813 P1). Handing off when the
        // shopper asks for a person needs an intent value that arrives
        // spelled the same way every time; a free-form label produced
        // 'agent_request', 'human_handoff' and 'talk_to_agent' for the same
        // sentence.
        'JSON_MODE:intent. Classify the shopper message. `intent` must be one ' +
          'of: order_status, delivery, cancel_refund, product_inquiry, ' +
          'agent_request, smalltalk, out_of_scope, unintelligible, other. ' +
          'agent_request only when the shopper is asking to reach a human, not ' +
          'when they merely mention agents. Asking HOW to contact support (which ' +
          'phone number, e-mail or channel, or "how do I reach technical support?") ' +
          'is a question to answer — other, not agent_request. smalltalk = greetings, thanks, ' +
          'compliments, chat with nothing to answer. out_of_scope = a real ' +
          'question this shop cannot answer (weather, exchange rates, news). ' +
          'unintelligible = the message cannot be read as language. ' +
          'IMPORTANT: a greeting followed by a real question takes the ' +
          "question's intent — \"Hi, where is my order?\" is order_status, not " +
          'smalltalk. Return ' +
          '{"intent":string,"needsOrderData":boolean,"confidence":number}.' +
          recentBlock,
      messages: [{ role: 'user', content: query }],
    });
    try {
      // The stub's keyword guess is not a classification (PLN-261007 D4).
      if (res.degraded) throw new Error('degraded');
      return JSON.parse(res.text);
    } catch {
      // The fallback label is 'product_inquiry', so an unparseable response
      // would otherwise read as a confident product question and bias
      // retrieval toward the product group. Mark it so callers can tell the
      // difference between "classified as product" and "classification failed".
      return { intent: 'product_inquiry', needsOrderData: false, confidence: 0.5, fallback: true };
    }
  }
}
