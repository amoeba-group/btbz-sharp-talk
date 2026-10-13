import { UNRECORDED_REASONS } from './analytics-pilot.util';
import type { PilotRow } from './analytics-pilot.util';
import type { PilotReport } from './analytics-pilot.service';
import {
  PILOT_DEFAULT_WINDOW_DAYS,
  PILOT_EXPORT_MAX_ROWS,
  PILOT_MAX_CONVERSATIONS,
  PILOT_MAX_WINDOW_DAYS,
} from './analytics-pilot.util';

/** One group row on the wire (camelCase). Counts only — no id of any customer, session or message. */
export type PilotRowResponse = PilotRow;

export interface PilotReportResponse {
  group: string;
  window: { from: string; to: string; days: number; timezone: string };
  rows: PilotRowResponse[];
  totals: PilotRowResponse;
  adoption: PilotReport['adoption'];
  meta: {
    /** Conversations the numbers are computed from. */
    scanned: number;
    /** The conversation read hit its cap: the numbers cover the oldest conversations of the window only. */
    truncated: boolean;
    maxConversations: number;
    /** Group rows before the display cap. */
    rowsTotal: number;
    rowsShown: number;
    defaultWindowDays: number;
    maxWindowDays: number;
    exportMaxRows: number;
    /** Reasons the product defines but never stores — there is no count, which is not the same as 0. */
    unrecordedReasons: string[];
  };
}

export class AnalyticsPilotMapper {
  static toReport(r: PilotReport): PilotReportResponse {
    return {
      group: r.group,
      window: { from: r.from.toISOString(), to: r.to.toISOString(), days: r.days, timezone: r.timezone },
      rows: r.rows,
      totals: r.totals,
      adoption: r.adoption,
      meta: {
        scanned: r.scanned,
        truncated: r.truncated,
        maxConversations: PILOT_MAX_CONVERSATIONS,
        rowsTotal: r.rowsTotal,
        rowsShown: r.rows.length,
        defaultWindowDays: PILOT_DEFAULT_WINDOW_DAYS,
        maxWindowDays: PILOT_MAX_WINDOW_DAYS,
        exportMaxRows: PILOT_EXPORT_MAX_ROWS,
        unrecordedReasons: [...UNRECORDED_REASONS],
      },
    };
  }
}
