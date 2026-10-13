import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { gateRefuses, kbAccessOf, simulatedIdentity } from '@sharptalk/types';
import type { Audience, GateAs, GateDecisionValue } from '@sharptalk/types';
import { RagService } from '../chat/rag.service';
import { ChatService } from '../chat/chat.service';
import { decideGate } from '../chat/gate-decision';
import type { GateDecision, GateOptions } from '../chat/gate-decision';
import { KbCategory } from './entity/kb-category.entity';
import { KnowledgeService } from './knowledge.service';
import type { PartnerPrepared } from '../partner-data/partner-data.step';

/** One category the retrieval matched, with the tier that decides who may read it. */
export interface SimulatedCategory {
  category: string | null;
  group: string | null;
  /** The category's access tier (public / partner / manager); null when no category row exists. */
  tier: Audience | null;
  similarity: number | null;
  docCount: number;
}

/** The gate decision as the console shows it (PLN-261012 SG-51, wireframe W3). */
export interface GateReport {
  /** The viewer simulated. */
  as: GateAs;
  /** The EFFECTIVE agent the visitor would be talking to (the default agent when none is picked). */
  agentId: number | null;
  /** The agent's guest policy: whether a signed-out visitor is gated at all. */
  guestPolicy: string | null;
  audience: Audience;
  decision: GateDecisionValue;
  /** Which question decided: the guest gate, or the answerability / low-confidence check. */
  stage: 'guest' | 'answer';
  refused: boolean;
  guestGated: boolean;
  /** The bar the deciding measurement was compared with. */
  threshold: number;
  /** The deciding measurement, on the confidence scale; null when no gate applied. */
  confidence: number | null;
  topSimilarity: number | null;
  matchedCategories: SimulatedCategory[];
  vectorProvider: string | null;
  degraded: boolean;
  degradedReason: string | null;
  /** The exact customer-facing text a refusal gives; null when the question is answered. */
  reply: string | null;
}

export type GateSimulation = Awaited<ReturnType<KnowledgeService['ask']>> & { gate: GateReport };

export interface SimulateInput {
  question: string;
  language: string;
  group?: string;
  /** The agent to talk to; null/absent = the tenant's default agent (what an unpinned visitor gets). */
  aiAgentId?: number | null;
  as: GateAs;
  /**
   * A partner-data turn prepared for a golden question (SG-31), handed to the answer when the gate lets
   * the question through. Never taken from a request.
   */
  partner?: PartnerPrepared | null;
}

/**
 * The console's "Test as…" (PLN-261012 SG-51, REQ D-13 / D-16). Answers one question: what would a
 * signed-out visitor, a partner, a receptionist or a manager be told? It takes NO decision of its
 * own — `decideGate` (chat/gate-decision.ts) is the very function the chat path calls, fed a
 * synthetic identity — so it cannot drift from what visitors get; the reply text comes from the
 * same ChatService helpers the refusal branches use.
 *
 * Read-only, like `KnowledgeService.ask`: no conversation, no session, no stored message, nobody
 * paged. A refusal makes no model call (as in chat: a gated visitor never reaches the LLM); an
 * `allow` runs the answer exactly as the widget would, scoped to the viewer's audience.
 */
@Injectable()
export class GateSimulatorService {
  constructor(
    private readonly rag: RagService,
    private readonly chat: ChatService,
    private readonly knowledge: KnowledgeService,
    @InjectRepository(KbCategory) private readonly categoryRepo: Repository<KbCategory>,
  ) {}

  /**
   * The decision alone, no answer and no reply text — the golden runner grades it and the
   * calibration CLI measures it. `opts` is for calibration (assume a guest policy, override the bar).
   */
  async decide(
    tenantId: number,
    input: Pick<SimulateInput, 'question' | 'aiAgentId' | 'as'>,
    opts: GateOptions = {},
  ): Promise<{ decision: GateDecision; agentId: number | null }> {
    // The agent a visitor would really talk to: an unpinned session answers AS the default agent.
    const agentId = await this.rag.effectiveAgentId(tenantId, input.aiAgentId ?? null);
    const decision = await decideGate(
      this.rag,
      { tenantId, agentId, identity: simulatedIdentity(input.as), query: input.question },
      opts,
    );
    return { decision, agentId };
  }

  async simulate(tenantId: number, input: SimulateInput): Promise<GateSimulation> {
    const language = input.language.toUpperCase();
    const { decision, agentId } = await this.decide(tenantId, input);
    const refused = gateRefuses(decision.decision);
    const [reply, matchedCategories] = await Promise.all([
      refused ? this.chat.gateReplyText(tenantId, language, decision) : Promise.resolve(null),
      this.withTiers(tenantId, decision),
    ]);

    const gate: GateReport = {
      as: input.as,
      agentId,
      guestPolicy: decision.guestPolicy,
      audience: decision.audience,
      decision: decision.decision,
      stage: decision.stage,
      refused,
      guestGated: decision.guestGated,
      threshold: decision.threshold,
      confidence: decision.grounded,
      topSimilarity: decision.topSimilarity,
      matchedCategories,
      vectorProvider: decision.vectorProvider,
      degraded: decision.degraded,
      degradedReason: decision.degradedReason,
      reply,
    };

    if (refused) {
      // What the visitor reads IS the gate's own text; no model call, nothing to moderate (fixed copy).
      return {
        answer: reply ?? '',
        confidence: decision.grounded ?? 0,
        blocked: false,
        sources: [],
        gate,
      };
    }
    // Allowed: the answer a widget turn of this kind would get — the same audience scope (and the
    // guest scope for a gated visitor), on the same effective agent.
    const answered = await this.knowledge.ask(
      tenantId,
      input.question,
      language,
      input.group,
      agentId,
      input.partner ?? null,
      decision.audience,
      decision.guestGated,
    );
    return { ...answered, gate };
  }

  /** Attach each matched category's tier (one read for all of them). */
  private async withTiers(tenantId: number, decision: GateDecision): Promise<SimulatedCategory[]> {
    const names = [...new Set(decision.matchedCategories.map((c) => c.category).filter((n): n is string => !!n))];
    const rows = names.length ? await this.categoryRepo.find({ where: { tenantId, name: In(names) } }) : [];
    const tierOf = new Map(rows.map((r) => [`${r.docGroup}\u0000${r.name}`, kbAccessOf(r)] as const));
    return decision.matchedCategories.map((c) => ({
      category: c.category,
      group: c.group,
      tier: c.category && c.group ? (tierOf.get(`${c.group}\u0000${c.category}`) ?? null) : null,
      similarity: c.similarity,
      docCount: c.docCount,
    }));
  }
}
