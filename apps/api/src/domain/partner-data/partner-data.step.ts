import { Injectable, Logger } from '@nestjs/common';
import type { IdentityClaims } from '@sharptalk/types';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { partnerCtxOf } from './partner-ctx';
import type { PartnerCtx } from './partner-ctx';
import { PARTNER_LOOKUP_STATUS, PartnerError, partnerError } from './partner-data.constants';
import type { PartnerRefusalReason, PartnerTopic } from './partner-data.constants';
import { PartnerDataService } from './partner-data.service';
import type { PartnerEvidence } from './partner-data.service';
import { PartnerFlagService } from './partner-flag.service';
import { PartnerLookupLogService } from './partner-lookup-log.service';
import { partnerNoticePolicy, partnerNoticeText } from './partner-messages';
import { verifyNumbers } from './partner-numbers.util';
import { detectPartnerIntent } from './partner-intent.util';

/** What the chat step needs to know about the session (a subset of the Session entity). */
export interface PartnerStepSession {
  id: number;
  tenantId: number | null;
  identityClaims: IdentityClaims | null;
}

export interface PartnerPrepareInput {
  tenantId: number;
  session: PartnerStepSession;
  conversationId: number;
  /** The customer turn being answered. */
  messageId: number;
  /** The customer's own words (raw — parameters are parsed server-side, never sent to a model from here). */
  text: string;
  language: string;
}

/** The identifiers every lookup of a turn shares — also what `verify` logs against. */
interface TurnMeta {
  tenantId: number;
  conversationId: number;
  messageId: number;
  sessionId: number;
  hotelSn: string;
  role: string;
}

/** Facts fetched for this turn: goes into the prompt as PARTNER_DATA and onto the trace as `partnerEvidence`. */
export interface PartnerDataBlock {
  kind: 'data';
  /** Text placed between the PARTNER_DATA markers of the prompt. */
  block: string;
  evidence: PartnerEvidence[];
  /** Values (ids, amounts) the moderation PII masks must leave alone for this answer. */
  protect: string[];
  topics: PartnerTopic[];
  meta: TurnMeta;
}

/** The turn is answered with a fixed localized notice instead of a model reply. */
export interface PartnerNotice {
  kind: 'notice';
  code: string;
  reason: PartnerRefusalReason;
  body: string;
  /** Also page a human ("confirm later" path). False for a refusal the customer can fix themselves. */
  handoff: boolean;
  /** Merged into the persisted message trace. */
  trace: Record<string, unknown>;
}

export type PartnerPrepared = PartnerDataBlock | PartnerNotice;

export type PartnerVerdict = { ok: true } | { ok: false; notice: PartnerNotice };

/**
 * The partner-data step of a chat turn (PLN-261012 SG-31), mirroring how
 * `orderContext` is produced: decide whether this turn is a partner-data
 * question, fetch the facts server-side, and hand ChatService either a trusted
 * data block (to ground the model) or a fixed notice (refusal / degradation).
 *
 * Inert by construction: with the server-wide PARTNER_DATA_ENABLED or the
 * tenant's switch off, with an unsigned session, or with no partner topic in the
 * message, `prepare` returns null having done no I/O beyond the flag read — and
 * the chat turn is byte-identical to what it was.
 *
 * Never throws: ChatService calls it on the customer's path.
 */
@Injectable()
export class PartnerDataStep {
  private readonly logger = new Logger(PartnerDataStep.name);

  constructor(
    private readonly flags: PartnerFlagService,
    private readonly data: PartnerDataService,
    private readonly logs: PartnerLookupLogService,
  ) {}

  /**
   * Would `prepare` act on this message — feature on, signed partner, a partner
   * topic named? A cheap yes/no for ChatService, which must not let the shop-
   * centric classifier call a partner-data question "out of scope" before the
   * step gets to see it. Never throws; anything doubtful is "no".
   */
  async handles(input: Pick<PartnerPrepareInput, 'tenantId' | 'session' | 'text'>): Promise<boolean> {
    try {
      if (!this.flags.serverEnabled()) return false;
      if (!(await this.flags.isEnabled(input.tenantId))) return false;
      const claims = input.session.identityClaims;
      if (!claims?.signed) return false;
      return detectPartnerIntent(input.text, { hotelSn: String(claims.hotelSn ?? '') }).topics.length > 0;
    } catch {
      return false;
    }
  }

  async prepare(input: PartnerPrepareInput): Promise<PartnerPrepared | null> {
    let claims: IdentityClaims | null;
    let intent: ReturnType<typeof detectPartnerIntent>;
    try {
      if (!this.flags.serverEnabled()) return null;
      if (!(await this.flags.isEnabled(input.tenantId))) return null;
      // Guests and unsigned (v1) identities keep today's behaviour: partner data
      // is for a signed partner, and a guest asking a general policy question
      // must still get the public knowledge-base answer.
      claims = input.session.identityClaims;
      if (!claims?.signed) return null;
      intent = detectPartnerIntent(input.text, { hotelSn: String(claims.hotelSn ?? '') });
      if (!intent.topics.length) return null;
    } catch (e) {
      this.logger.error(`partner step skipped: ${(e as Error).message}`);
      return null;
    }

    // A partner topic WAS asked. From here on a failure degrades to a notice —
    // never to a silent fall-through that could answer from generic knowledge.
    try {
      const meta = (ctx: PartnerCtx | null): TurnMeta => ({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        sessionId: input.session.id,
        hotelSn: ctx?.hotelSn ?? String(claims?.hotelSn ?? ''),
        role: ctx?.role ?? String(claims?.role ?? ''),
      });

      let ctx: PartnerCtx;
      try {
        ctx = partnerCtxOf({ tenantId: input.session.tenantId ?? input.tenantId, identityClaims: claims });
      } catch (e) {
        const err = e instanceof PartnerError ? e : partnerError.claimsStale('claims_unusable');
        await this.logDenied(input, claims, intent.topics[0].topic, err);
        return this.notice(err.code, input.language, { claims: err.reason });
      }

      // The message names another hotel (or all of them): answering would give
      // THIS hotel's data to a user who believes it is the other's.
      if (intent.foreignHotel) {
        const err = partnerError.paramRejected('hotel_mention');
        this.logger.warn(`partner lookup refused: message names another hotel (tenant=${ctx.tenantId} hotel=${ctx.hotelSn})`);
        await this.logs.record({
          ...this.logWho(meta(ctx)),
          topic: intent.topics[0].topic,
          rejectedKeys: ['hotel_mention'],
          status: PARTNER_LOOKUP_STATUS.REJECTED,
          errorCode: err.code,
          reason: err.reason,
        });
        return this.notice(err.code, input.language);
      }

      const sections: string[] = [];
      const evidence: PartnerEvidence[] = [];
      const protect: string[] = [];
      for (const detected of intent.topics) {
        const res = await this.data.resolve(ctx, detected.topic, detected.params, {
          conversationId: input.conversationId,
          messageId: input.messageId,
          sessionId: input.session.id,
        });
        if (!res.ok) return this.notice(res.error.code, input.language, { topic: res.topic });
        const rendered = this.data.render(res.view, input.language);
        sections.push(`[${res.topic}] (data as of ${res.evidence.generatedAt})\n${rendered.lines.join('\n')}`);
        evidence.push(res.evidence);
        protect.push(...rendered.protect);
      }

      const block =
        `Live data from the partner system for the signed-in hotel (hotel ${ctx.hotelSn}, role ${ctx.role}).\n` +
        sections.join('\n');
      return {
        kind: 'data',
        block,
        evidence,
        // Longest first: the moderation shield replaces values in this order.
        protect: [...new Set(protect)].sort((a, b) => b.length - a.length),
        topics: intent.topics.map((t) => t.topic),
        meta: meta(ctx),
      };
    } catch (e) {
      this.logger.error(`partner step failed after a partner topic was detected: ${(e as Error).message}`, (e as Error).stack);
      return this.notice(ERROR_CODE.PARTNER_API_UNAVAILABLE.code, input.language, { topic: 'step_error' });
    }
  }

  /**
   * Check the drafted (moderated) answer's numbers against the data block.
   * A figure the block does not support means the answer is withheld and the
   * turn degrades to "we will confirm" + hand-off (E5107).
   */
  async verify(
    prepared: PartnerDataBlock,
    reply: string,
    context: { question: string; kbTexts?: string[]; language: string },
  ): Promise<PartnerVerdict> {
    try {
      const check = verifyNumbers(reply, { block: prepared.block, question: context.question, kbTexts: context.kbTexts });
      if (check.ok) return { ok: true };
      this.logger.warn(
        `partner answer withheld: ${check.unverified.length} unverified number(s) conversation=${prepared.meta.conversationId} topics=${prepared.topics.join(',')}`,
      );
      await this.logs.record({
        ...this.logWho(prepared.meta),
        topic: prepared.topics.join(','),
        status: PARTNER_LOOKUP_STATUS.UNVERIFIED,
        errorCode: ERROR_CODE.PARTNER_ANSWER_UNVERIFIED.code,
        reason: `unverified_numbers:${check.unverified.length}`,
        source: prepared.evidence[0]?.source ?? null,
        snapshotHash: prepared.evidence[0]?.snapshotHash ?? null,
      });
      return {
        ok: false,
        notice: this.notice(ERROR_CODE.PARTNER_ANSWER_UNVERIFIED.code, context.language, {
          unverifiedCount: check.unverified.length,
        }),
      };
    } catch (e) {
      // A check that itself failed must not let an unchecked answer through.
      this.logger.error(`partner number check failed, withholding the answer: ${(e as Error).message}`);
      return { ok: false, notice: this.notice(ERROR_CODE.PARTNER_ANSWER_UNVERIFIED.code, context.language) };
    }
  }

  // ---- helpers --------------------------------------------------------------

  private notice(code: string, language: string, extra: Record<string, unknown> = {}): PartnerNotice {
    const policy = partnerNoticePolicy(code);
    return {
      kind: 'notice',
      code,
      reason: policy.reason,
      body: partnerNoticeText(policy.key, language),
      handoff: policy.handoff,
      trace: { reason: policy.reason, partnerError: code, ...extra },
    };
  }

  private logWho(m: TurnMeta) {
    return {
      tenantId: m.tenantId,
      conversationId: m.conversationId,
      messageId: m.messageId,
      sessionId: m.sessionId,
      hotelSn: m.hotelSn || null,
      role: m.role || null,
    };
  }

  /** A signed-in user whose claims are unusable asked a partner question: record the denial. */
  private async logDenied(
    input: PartnerPrepareInput,
    claims: IdentityClaims | null,
    topic: string,
    err: PartnerError,
  ): Promise<void> {
    await this.logs.record({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      sessionId: input.session.id,
      hotelSn: claims?.hotelSn ? String(claims.hotelSn).slice(0, 32) : null,
      role: claims?.role ?? null,
      topic,
      status: PARTNER_LOOKUP_STATUS.DENIED,
      errorCode: err.code,
      reason: err.reason,
    });
  }
}
