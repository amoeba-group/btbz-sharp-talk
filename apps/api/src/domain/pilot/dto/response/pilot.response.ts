import type { PilotNonPilot, SessionLanguage } from '@sharptalk/types';
import type { PilotImportStatus } from '../../pilot.util';

/** Response DTOs — camelCase. Hotel serials are business keys, not personal data. */

/** `GET/PUT /tenants/me/pilot` — the switch plus the size of the list it guards. */
export interface PilotAccessResponse {
  enabled: boolean;
  guestAllowed: boolean;
  nonPilot: PilotNonPilot;
  notice: Partial<Record<SessionLanguage, string>>;
  /** Hotels the list serves right now (active rows) — what the console warns about at zero. */
  activeCount: number;
  /** Every row, paused ones included. */
  totalCount: number;
  /** The list's ceiling, so the console can say "12 / 5000". */
  limit: number;
}

export interface PilotHotelResponse {
  id: string;
  hotelSn: string;
  note: string | null;
  active: boolean;
  addedBy: number | null;
  createdAt: string;
}

export interface PilotImportRowResponse {
  line: number;
  hotelSn: string | null;
  /** The first field as typed — what the operator needs to find a bad line. */
  raw: string;
  note: string | null;
  status: PilotImportStatus;
}

/**
 * The outcome — or, with `dryRun`, the preview — of pasting a list or importing
 * a CSV. Counts cover every line; `rows` carries the first ones for display and
 * `invalid` carries the lines that cannot be used, so the screen can name them.
 */
export interface PilotImportResponse {
  dryRun: boolean;
  headerSkipped: boolean;
  total: number;
  added: number;
  reactivated: number;
  existing: number;
  duplicate: number;
  invalid: number;
  /** Adding these would push the list past its ceiling — the real import refuses. */
  exceedsLimit: boolean;
  rows: PilotImportRowResponse[];
  invalidRows: PilotImportRowResponse[];
}
