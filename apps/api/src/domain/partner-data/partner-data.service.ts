import { createHash } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PARTNER_API_CLIENT, validateEnvelope } from './partner-api.client';
import type { PartnerApiClient } from './partner-api.client';
import type { PartnerCtx } from './partner-ctx';
import { PARTNER_LOOKUP_STATUS, PartnerError, partnerError } from './partner-data.constants';
import type { PartnerApiMode, PartnerLookupStatus, PartnerTopic } from './partner-data.constants';
import { PartnerLookupLogService } from './partner-lookup-log.service';
import type { PartnerQuery } from './partner-params.util';
import { asDateTime } from './partner-project.util';
import { TopicRegistry } from './partner-topics';
import type { FormattedTopic, TopicView } from './partner-topics';

/** Ids that tie a lookup to the chat turn that caused it (for partner_lookup_logs). */
export interface PartnerCallMeta {
  conversationId?: number | null;
  messageId?: number | null;
  sessionId?: number | null;
  /** Session language — the data block's money is formatted for it. */
  language?: string;
}

/** What goes on the answer's trace as `partnerEvidence` — deliberately NOT in `citations`. */
export interface PartnerEvidence {
  topic: PartnerTopic;
  hotelSn: string;
  role: string;
  source: PartnerApiMode;
  apiVersion: string;
  /** When the partner generated the data. */
  generatedAt: string;
  /** When we fetched it. */
  fetchedAt: string;
  /** SHA-256 of the validated, projected snapshot the answer was built from. */
  snapshotHash: string;
  itemCount: number;
  /** Validated closed parameters (never a hotel). */
  params: PartnerQuery;
}

export type PartnerResolution =
  | {
      ok: true;
      topic: PartnerTopic;
      query: PartnerQuery;
      /** Whitelisted, validated snapshot. Rendered per language with `render`. */
      view: TopicView;
      evidence: PartnerEvidence;
      latencyMs: number;
    }
  | {
      ok: false;
      topic: string;
      error: PartnerError;
      status: PartnerLookupStatus;
      latencyMs: number;
    };

/** Which failures were the caller's to avoid (nothing was requested) vs the partner's. */
function statusOf(e: PartnerError): PartnerLookupStatus {
  switch (e.code) {
    case 'E5101':
    case 'E5102':
      return PARTNER_LOOKUP_STATUS.DENIED;
    case 'E5103':
    case 'E5104':
      return PARTNER_LOOKUP_STATUS.REJECTED;
    default:
      return PARTNER_LOOKUP_STATUS.ERROR;
  }
}

/**
 * The one entry point to partner data (PLN-261012 SG-31).
 *
 *   resolve(ctx, topic, params)
 *     1. the topic must be on the allow-list            -> E5103
 *     2. the ctx role must be allowed for that topic    -> E5101 (nothing requested)
 *     3. the parameters must fit the topic's CLOSED set -> E5104 (no hotel key, ever)
 *     4. the client fetches (hotel = ctx.hotelSn only)  -> E5100 / E5106 / E5108
 *     5. the reply must echo that hotel + pass schema   -> E5105
 *     6. the projector whitelists fields + checks money -> E5105
 *
 * It never throws for any of those: a failure comes back as `{ ok: false }` with
 * its classified error, and every outcome — including the denials that never
 * reached the partner — is written to partner_lookup_logs.
 *
 * `ctx` is a branded PartnerCtx (see partner-ctx.ts). `topic` and `params` are
 * `string` / `unknown` on purpose: they are the untrusted part (a detector's
 * output today, a model's tool arguments in wave 2), and everything below treats
 * them that way.
 */
@Injectable()
export class PartnerDataService {
  private readonly logger = new Logger(PartnerDataService.name);
  private readonly registry = new TopicRegistry();

  constructor(
    @Inject(PARTNER_API_CLIENT) private readonly client: PartnerApiClient,
    private readonly logs: PartnerLookupLogService,
  ) {}

  get mode(): PartnerApiMode {
    return this.client.mode;
  }

  async resolve(
    ctx: PartnerCtx,
    topic: string,
    params: unknown,
    meta: PartnerCallMeta = {},
  ): Promise<PartnerResolution> {
    const started = Date.now();
    let query: PartnerQuery | undefined;
    try {
      const def = this.registry.get(topic);
      if (!this.registry.allows(def, ctx.role)) {
        throw partnerError.roleDenied('role_not_allowed_for_topic', { topic, role: ctx.role });
      }
      query = this.registry.query(def, params);

      const raw = await this.client.get(ctx, def.topic, query);
      const generatedAtFallback = new Date().toISOString();
      let apiVersion = '0';
      let generatedAt = generatedAtFallback;
      let view: TopicView;
      if (raw === null) {
        // "Nothing for this hotel": an answer, rendered as an empty view.
        view = { topic: def.topic, items: [], ...(def.topic === 'bookings' || def.topic === 'settlement' ? { total: 0 } : {}) } as TopicView;
      } else {
        // Re-validated here as well as in the client: the mock has no client-side
        // checks, and a second look at the echoed hotel costs nothing.
        const env = validateEnvelope(raw, ctx, def.topic);
        apiVersion = env.apiVersion;
        generatedAt = asDateTime(env.generatedAt, 'generatedAt');
        view = def.project(env.data, ctx, query);
      }
      const evidence: PartnerEvidence = {
        topic: def.topic,
        hotelSn: ctx.hotelSn,
        role: ctx.role,
        source: this.client.mode,
        apiVersion,
        generatedAt,
        fetchedAt: new Date().toISOString(),
        snapshotHash: createHash('sha256').update(JSON.stringify(view)).digest('hex'),
        itemCount: view.items.length,
        params: query,
      };
      const latencyMs = Date.now() - started;
      await this.logs.record({
        ...this.who(ctx, meta),
        topic: def.topic,
        params: query,
        status: PARTNER_LOOKUP_STATUS.OK,
        source: this.client.mode,
        latencyMs,
        snapshotHash: evidence.snapshotHash,
      });
      return { ok: true, topic: def.topic, query, view, evidence, latencyMs };
    } catch (e) {
      const error = e instanceof PartnerError ? e : partnerError.unavailable('unexpected_error');
      if (!(e instanceof PartnerError)) {
        // A bug or an unforeseen failure: classified as "unavailable" for the
        // customer, but the cause belongs in the server log.
        this.logger.error(`partner lookup failed unexpectedly: ${(e as Error).message}`, (e as Error).stack);
      } else if (error.reason === 'hotel_param') {
        // Someone — a user's wording or a model's arguments — tried to name a hotel.
        this.logger.warn(
          `partner lookup refused a hotel parameter: tenant=${ctx.tenantId} hotel=${ctx.hotelSn} topic=${topic} keys=${JSON.stringify(error.detail?.keys)}`,
        );
      }
      const status = statusOf(error);
      const latencyMs = Date.now() - started;
      await this.logs.record({
        ...this.who(ctx, meta),
        topic,
        ...(status === PARTNER_LOOKUP_STATUS.REJECTED
          ? { rejectedKeys: (error.detail?.keys as string[] | undefined) ?? [] }
          : { params: query ?? null }),
        status,
        errorCode: error.code,
        reason: error.reason,
        source: this.client.mode,
        latencyMs,
      });
      return { ok: false, topic, error, status, latencyMs };
    }
  }

  /** The view as the lines of a PARTNER_DATA block, amounts formatted for the session language. */
  render(view: TopicView, language: string): FormattedTopic {
    return this.registry.get(view.topic).format(view, language);
  }

  private who(ctx: PartnerCtx, meta: PartnerCallMeta) {
    return {
      tenantId: ctx.tenantId,
      conversationId: meta.conversationId ?? null,
      messageId: meta.messageId ?? null,
      sessionId: meta.sessionId ?? null,
      hotelSn: ctx.hotelSn,
      role: ctx.role,
    };
  }
}
