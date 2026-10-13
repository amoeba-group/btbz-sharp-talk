import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { scrubPii } from '../../global/util/pii-scrub.util';
import { PartnerLookupLog } from './entity/partner-lookup-log.entity';
import type { PartnerLookupStatus } from './partner-data.constants';

export interface LookupLogEntry {
  tenantId: number;
  conversationId?: number | null;
  /** The customer turn that triggered the lookup. */
  messageId?: number | null;
  sessionId?: number | null;
  hotelSn?: string | null;
  role?: string | null;
  topic: string;
  /** Validated parameters of an executed lookup. */
  params?: Record<string, unknown> | null;
  /** For a rejected lookup: the offending KEYS (never their values). */
  rejectedKeys?: string[];
  status: PartnerLookupStatus;
  errorCode?: string | null;
  reason?: string | null;
  source?: string | null;
  latencyMs?: number | null;
  snapshotHash?: string | null;
}

const PARAM_VALUE_MAX = 64;
const PARAM_KEYS_MAX = 10;

/** Scalar parameters only, values PII-scrubbed and capped; anything else is dropped. */
export function scrubParams(params: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!params) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params).slice(0, PARAM_KEYS_MAX)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k.slice(0, 32)] = v;
    else if (typeof v === 'string') out[k.slice(0, 32)] = scrubPii(v.slice(0, PARAM_VALUE_MAX)).text;
  }
  return Object.keys(out).length ? out : null;
}

/** Keys are logged for a rejected lookup so the attempt is visible; control characters and length are bounded. */
export function safeKeys(keys: string[] | undefined): string[] {
  return (keys ?? []).slice(0, 5).map((k) => String(k).replace(/[^\w.-]/g, '?').slice(0, 40));
}

/**
 * Writes `partner_lookup_logs` (PLN-261012 SG-31). Used from the chat path, so
 * `record` NEVER throws or rejects: a log row lost to a database hiccup must not
 * cost a customer their answer.
 */
@Injectable()
export class PartnerLookupLogService {
  private readonly logger = new Logger(PartnerLookupLogService.name);

  constructor(@InjectRepository(PartnerLookupLog) private readonly repo: Repository<PartnerLookupLog>) {}

  async record(entry: LookupLogEntry): Promise<void> {
    try {
      const params =
        entry.rejectedKeys !== undefined
          ? { rejectedKeys: safeKeys(entry.rejectedKeys) }
          : scrubParams(entry.params ?? null);
      await this.repo.save(
        this.repo.create({
          tenantId: entry.tenantId,
          conversationId: entry.conversationId ?? null,
          messageId: entry.messageId ?? null,
          sessionId: entry.sessionId ?? null,
          hotelSn: entry.hotelSn ?? null,
          actorRole: entry.role ?? null,
          topic: String(entry.topic).slice(0, 24),
          params,
          status: entry.status,
          errorCode: entry.errorCode ?? null,
          reason: entry.reason ? String(entry.reason).slice(0, 64) : null,
          source: entry.source ?? null,
          latencyMs: entry.latencyMs ?? null,
          snapshotHash: entry.snapshotHash ?? null,
        }),
      );
    } catch (e) {
      this.logger.warn(`partner lookup log not written (${entry.status} ${entry.topic}): ${(e as Error).message}`);
    }
  }
}
