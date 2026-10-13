import { apiDelete, apiGet, apiGetList, apiPatch, apiPost, apiPut } from '@/lib/api-client';
// Type-only: @sharptalk/types ships CJS whose runtime exports Rollup cannot see.
import type { PilotNonPilot, SessionLanguage } from '@sharptalk/types';

/**
 * Pilot allowlist by hotel — console API (PLN-261012 SG-40).
 *
 * `/tenants/me/pilot`: the switch (MASTER writes, MASTER/DIRECTOR read) and the
 * hotel list. Hotel serials are business keys, not personal data.
 */

export interface PilotAccessSettings {
  enabled: boolean;
  guestAllowed: boolean;
  nonPilot: PilotNonPilot;
  notice: Partial<Record<SessionLanguage, string>>;
  /** Hotels served right now (active rows). */
  activeCount: number;
  /** Every row, paused ones included. */
  totalCount: number;
  /** The list's ceiling. */
  limit: number;
}

/** What the card edits; the counts are read-only. */
export interface PilotAccessDraft {
  enabled: boolean;
  guestAllowed: boolean;
  nonPilot: PilotNonPilot;
  notice: Partial<Record<SessionLanguage, string>>;
}

export interface PilotHotel {
  id: string;
  hotelSn: string;
  note: string | null;
  active: boolean;
  addedBy: number | null;
  createdAt: string;
}

export type PilotImportStatus = 'added' | 'reactivated' | 'existing' | 'duplicate' | 'invalid';

export interface PilotImportRow {
  line: number;
  hotelSn: string | null;
  /** The first field as typed — what the operator needs to find a bad line. */
  raw: string;
  note: string | null;
  status: PilotImportStatus;
}

/** The outcome — or, with `dryRun`, the preview — of a paste / CSV import. */
export interface PilotImportResult {
  dryRun: boolean;
  headerSkipped: boolean;
  total: number;
  added: number;
  reactivated: number;
  existing: number;
  duplicate: number;
  invalid: number;
  exceedsLimit: boolean;
  rows: PilotImportRow[];
  invalidRows: PilotImportRow[];
}

export interface PilotHotelQuery {
  page: number;
  size: number;
  q?: string;
  active?: boolean;
}

const BASE = '/tenants/me/pilot';

export const pilotService = {
  access: () => apiGet<PilotAccessSettings>(BASE),
  // Sent whole — a partial update of a rule set is how "I removed it but it is
  // still there" happens.
  saveAccess: (body: PilotAccessDraft) =>
    apiPut<PilotAccessSettings>(BASE, {
      enabled: body.enabled,
      guest_allowed: body.guestAllowed,
      non_pilot: body.nonPilot,
      notice: body.notice,
    }),
  hotels: (q: PilotHotelQuery) =>
    apiGetList<PilotHotel>(`${BASE}/hotels`, {
      page: q.page,
      size: q.size,
      ...(q.q?.trim() ? { q: q.q.trim() } : {}),
      ...(q.active === undefined ? {} : { active: String(q.active) }),
    }),
  addHotel: (hotelSn: string, note: string) =>
    apiPost<PilotHotel>(`${BASE}/hotels`, { hotel_sn: hotelSn, ...(note.trim() ? { note: note.trim() } : {}) }),
  importHotels: (text: string, dryRun: boolean) =>
    apiPost<PilotImportResult>(`${BASE}/hotels/import`, { text, dry_run: dryRun }),
  setHotelActive: (hotelSn: string, active: boolean) =>
    apiPatch<PilotHotel>(`${BASE}/hotels/${encodeURIComponent(hotelSn)}`, { active }),
  removeHotel: (hotelSn: string) =>
    apiDelete<{ hotelSn: string }>(`${BASE}/hotels/${encodeURIComponent(hotelSn)}`),
};
