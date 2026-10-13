import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { parseFrom, parseTo } from '../../global/util/date-range.util';
import { Tenant } from '../tenant/entity/tenant.entity';
import { TenantPilotHotel } from '../pilot/entity/tenant-pilot-hotel.entity';
import { AnalyticsPilotQueries } from './analytics-pilot.queries';
import {
  PILOT_GROUPS,
  PILOT_MAX_CONVERSATIONS,
  PILOT_EXPORT_MAX_ROWS,
  PILOT_MAX_ROWS,
  addConversation,
  chunk,
  classifyConversation,
  computeAdoption,
  emptyMessageStats,
  emptyModeration,
  emptyPartner,
  finalizeRow,
  groupKeyOf,
  isHandoffReason,
  newAccumulator,
  resolvePilotWindow,
  sortRows,
  usableTimeZone,
} from './analytics-pilot.util';
import type {
  ConversationFacts,
  ConversationRow,
  PilotAccumulator,
  PilotAdoption,
  PilotGroup,
  PilotRow,
} from './analytics-pilot.util';
import {
  buildTranscript,
  pilotCsvHeader,
  pilotCsvRow,
  pilotCsvTruncationLine,
} from './analytics-pilot-csv.util';

/** Conversations whose facts are read per round of queries (one IN list each). */
const FACT_CHUNK = 1_000;
/** Conversations per page of the CSV: bounds the messages held in memory at once. */
const EXPORT_PAGE = 200;
/** Longest hotel serial / role accepted as a filter. */
const FILTER_MAX_LENGTH = 64;

/** The query string of both pilot routes, already snake_case-validated by the DTO. */
export interface PilotRequest {
  group?: string;
  from?: string;
  to?: string;
  hotelSn?: string;
  role?: string;
}

export interface PilotReport {
  group: PilotGroup;
  from: Date;
  to: Date;
  days: number;
  /** IANA zone the `day` group is drawn in. */
  timezone: string;
  rows: PilotRow[];
  /** Rows before the {@link PILOT_MAX_ROWS} cap. */
  rowsTotal: number;
  totals: PilotRow;
  adoption: PilotAdoption;
  /** The conversation read hit {@link PILOT_MAX_CONVERSATIONS}: the numbers cover the OLDEST ones only. */
  truncated: boolean;
  /** Conversations the numbers are computed from. */
  scanned: number;
}

export interface PilotExportPlan {
  from: Date;
  to: Date;
  rows: ConversationRow[];
  /** More conversations matched than the row cap allows. */
  truncated: boolean;
}

/**
 * Pilot analytics (PLN-261012 SG-52): the numbers by hotel / role / day that a two-week UAT is judged
 * on, and a transcript export for grading by hand. Read-only and tenant-scoped; the definitions live
 * in `analytics-pilot.util.ts` (read its header before changing a number), the SQL in
 * `analytics-pilot.queries.ts`.
 *
 * Memory stays bounded: the conversation list is capped, and the per-conversation facts are read and
 * folded in chunks — only the group accumulators (counters and latency numbers) survive a chunk.
 */
@Injectable()
export class AnalyticsPilotService {
  private readonly logger = new Logger(AnalyticsPilotService.name);

  constructor(
    private readonly queries: AnalyticsPilotQueries,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(TenantPilotHotel) private readonly hotelRepo: Repository<TenantPilotHotel>,
  ) {}

  /** The group, or E5140. Absent = hotel. */
  parseGroup(raw: string | undefined): PilotGroup {
    const group = (raw ?? PILOT_GROUPS[0]).trim().toLowerCase();
    if (!(PILOT_GROUPS as string[]).includes(group)) this.invalid(`unknown group '${String(raw).slice(0, 20)}'`);
    return group as PilotGroup;
  }

  /** `[from, to)` for a request, or E5140 (bad range) / E5141 (longer than the cap). */
  resolveWindow(q: Pick<PilotRequest, 'from' | 'to'>, now: Date = new Date()) {
    const from = parseFrom(q.from);
    const to = parseTo(q.to);
    // A value that was given but could not be read is a client error, not "use the default".
    if ((q.from && !from) || (q.to && !to)) this.invalid('unreadable date');
    const w = resolvePilotWindow(from, to, now);
    if (!w.ok) {
      if (w.reason === 'too_long') {
        this.logger.warn(`pilot analytics refused: window longer than the cap`);
        throw new BusinessException(ERROR_CODE.PILOT_ANALYTICS_WINDOW_TOO_LONG, HttpStatus.BAD_REQUEST);
      }
      this.invalid('from must be before to');
    }
    return w;
  }

  private invalid(why: string): never {
    // 4xx is not server-logged by default: say why the screen shows an error.
    this.logger.warn(`pilot analytics refused: ${why}`);
    throw new BusinessException(ERROR_CODE.PILOT_ANALYTICS_QUERY_INVALID, HttpStatus.BAD_REQUEST);
  }

  private filters(q: PilotRequest): { hotelSn?: string; role?: string } {
    const clean = (v: string | undefined) => {
      const s = (v ?? '').trim();
      if (s.length > FILTER_MAX_LENGTH) this.invalid('filter too long');
      return s || undefined;
    };
    return { hotelSn: clean(q.hotelSn), role: clean(q.role) };
  }

  // ---- the report ---------------------------------------------------------------------------

  async report(tenantId: number, q: PilotRequest, now: Date = new Date()): Promise<PilotReport> {
    const group = this.parseGroup(q.group);
    const window = this.resolveWindow(q, now);
    const scope = { from: window.from, to: window.to, ...this.filters(q) };

    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: { id: true, timezone: true, pilotAccess: true },
    });
    const timezone = usableTimeZone(tenant?.timezone);

    // One extra row tells us the cap was hit without a COUNT(*) over the same range.
    const read = await this.queries.conversations(tenantId, scope, PILOT_MAX_CONVERSATIONS + 1);
    const truncated = read.length > PILOT_MAX_CONVERSATIONS;
    const rows = truncated ? read.slice(0, PILOT_MAX_CONVERSATIONS) : read;

    const byGroup = new Map<string, PilotAccumulator>();
    const total = newAccumulator('total');
    for (const page of chunk(rows, FACT_CHUNK)) {
      const facts = await this.loadFacts(tenantId, page, { latency: true });
      for (const f of facts) {
        const v = classifyConversation(f);
        const key = groupKeyOf(group, f.row, timezone);
        let acc = byGroup.get(key);
        if (!acc) {
          acc = newAccumulator(key);
          byGroup.set(key, acc);
        }
        addConversation(acc, f, v);
        addConversation(total, f, v);
      }
    }

    const sorted = sortRows(group, [...byGroup.values()].map(finalizeRow));
    return {
      group,
      from: window.from,
      to: window.to,
      days: window.days,
      timezone,
      rows: sorted.slice(0, PILOT_MAX_ROWS),
      rowsTotal: sorted.length,
      totals: finalizeRow(total),
      adoption: await this.adoption(tenantId, window.from, window.to, tenant?.pilotAccess?.enabled === true),
      truncated,
      scanned: rows.length,
    };
  }

  /**
   * Hotels active in the window against the ACTIVE pilot list. Independent of the row cap of the main
   * read: it asks the database for the exact distinct hotels, so "never chatted" can be trusted.
   */
  private async adoption(tenantId: number, from: Date, to: Date, pilotEnabled: boolean): Promise<PilotAdoption> {
    const [listed, active] = await Promise.all([
      this.hotelRepo.find({ where: { tenantId, active: 1 }, select: { hotelSn: true } }),
      this.queries.activeHotels(tenantId, from, to),
    ]);
    return computeAdoption(
      pilotEnabled,
      listed.map((h) => h.hotelSn),
      active,
    );
  }

  // ---- facts ----------------------------------------------------------------------------------

  /**
   * Everything the definitions need about a page of conversations, read with a handful of grouped
   * queries (never one per conversation).
   */
  private async loadFacts(
    tenantId: number,
    rows: ConversationRow[],
    opts: { latency: boolean },
  ): Promise<ConversationFacts[]> {
    const ids = rows.map((r) => r.id);
    const [messages, reasons, moderation, partner, latencies] = await Promise.all([
      this.queries.messageStats(ids),
      this.queries.reasons(ids),
      this.queries.moderation(tenantId, ids),
      this.queries.partner(tenantId, ids),
      opts.latency ? this.queries.latencies(ids) : Promise.resolve(new Map()),
    ]);

    // Escalations with no stored hand-off reason (a legacy notice, a channel that never wrote one)
    // fall back to the reason on their alert. Asked only for those, so it is a handful of rows.
    const needAlert = rows
      .filter((r) => {
        const stats = messages.get(r.id);
        const stored = reasons.get(r.id) ?? [];
        return (r.escalated || r.agentAssigned || (stats?.agents ?? 0) > 0) && !stored.some((s) => isHandoffReason(s.reason));
      })
      .map((r) => r.id);
    const alerts = await this.queries.alertReasons(tenantId, needAlert);

    return rows.map((row) => ({
      row,
      messages: messages.get(row.id) ?? emptyMessageStats(),
      reasons: reasons.get(row.id) ?? [],
      moderation: moderation.get(row.id) ?? emptyModeration(),
      partner: partner.get(row.id) ?? emptyPartner(),
      latencies: latencies.get(row.id) ?? [],
      alertReason: alerts.get(row.id) ?? null,
    }));
  }

  // ---- the export -----------------------------------------------------------------------------

  /**
   * The conversations an export will contain, decided BEFORE a byte is written: the controller needs
   * `truncated` for the response headers and a failure must still be a clean JSON error.
   */
  async prepareExport(tenantId: number, q: PilotRequest, now: Date = new Date()): Promise<PilotExportPlan> {
    const window = this.resolveWindow(q, now);
    const scope = { from: window.from, to: window.to, ...this.filters(q) };
    const read = await this.queries.conversations(tenantId, scope, PILOT_EXPORT_MAX_ROWS + 1);
    const truncated = read.length > PILOT_EXPORT_MAX_ROWS;
    return { from: window.from, to: window.to, rows: truncated ? read.slice(0, PILOT_EXPORT_MAX_ROWS) : read, truncated };
  }

  /**
   * The file, as chunks of text: BOM + header first, then one page of conversations at a time (their
   * messages are loaded for that page only and dropped), then — when capped — the truncation record.
   * Lazy on purpose: the consumer applies back-pressure, so memory is one page, not the file.
   */
  async *exportChunks(tenantId: number, plan: PilotExportPlan): AsyncGenerator<string> {
    yield pilotCsvHeader();
    for (const page of chunk(plan.rows, EXPORT_PAGE)) {
      const [facts, transcripts] = await Promise.all([
        this.loadFacts(tenantId, page, { latency: false }),
        this.queries.transcripts(page.map((r) => r.id)),
      ]);
      let text = '';
      for (const f of facts) {
        const v = classifyConversation(f);
        text += pilotCsvRow(f, v, buildTranscript(transcripts.get(f.row.id) ?? []));
      }
      yield text;
    }
    if (plan.truncated) yield pilotCsvTruncationLine();
  }
}
