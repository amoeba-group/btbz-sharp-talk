import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { parseCsv } from '../knowledge/csv.util';
import { REGION_PROVINCE_MAX_LEN } from './region-routing.util';

/** Most data rows one upload may hold: Go2Joy lists a few thousand hotels. */
export const HOTEL_CSV_MAX_ROWS = 20000;
/** Longest hotelSn a row may carry — the column is varchar(64). */
export const HOTEL_SN_MAX_LEN = 64;
/** Problems reported back in full; the count is always exact. */
export const HOTEL_CSV_PROBLEMS_SHOWN = 50;

export interface HotelCsvRow {
  /** 1-based row number in the file, the header being row 1. */
  line: number;
  hotelSn: string;
  province: string;
}

/** Machine-readable reason of a malformed row — the console localises by this, `reason` is the English log text. */
export const HOTEL_CSV_PROBLEM = {
  HOTEL_SN_EMPTY: 'hotel_sn_empty',
  HOTEL_SN_LONG: 'hotel_sn_long',
  HOTEL_SN_CONTROL: 'hotel_sn_control',
  PROVINCE_EMPTY: 'province_empty',
  PROVINCE_LONG: 'province_long',
  PROVINCE_CONTROL: 'province_control',
  HOTEL_SN_CONFLICT: 'hotel_sn_conflict',
} as const;
export type HotelCsvProblemCode = (typeof HOTEL_CSV_PROBLEM)[keyof typeof HOTEL_CSV_PROBLEM];

export interface HotelCsvProblem {
  line: number;
  code: HotelCsvProblemCode;
  reason: string;
  hotelSn?: string;
}

export interface ParsedHotelCsv {
  rows: HotelCsvRow[];
  problems: HotelCsvProblem[];
  /** Exact repeats of an earlier row (same hotelSn and province): dropped, not an error. */
  duplicates: number;
}

const HOTEL_HEADERS = new Set(['hotelsn', 'hotelid', 'hotelno', 'sn']);
const PROVINCE_HEADERS = new Set(['province', 'provincename', 'tinh']);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function fatal(problem: string): never {
  throw new BusinessException(ERROR_CODE.HOTEL_PROVINCE_CSV_INVALID, HttpStatus.BAD_REQUEST, { file: [problem] });
}

/** "Hotel SN", "hotel_sn", "hotelSn" and "Province Name" all read as one key. */
function headerKey(cell: string): string {
  return cell
    .replace(/^﻿/, '')
    .toLowerCase()
    .replace(/[\s_\-.]+/g, '');
}

/**
 * Read the hotel → province CSV (PLN-261012 SG-67). Two columns, any order, any common
 * header spelling (`hotel_sn` / `hotelSn` / `Hotel SN`, `province` / `tinh`); other
 * columns (the hotel's name, say) are ignored — a name is display text and is never used
 * as a key. The first row must be the header.
 *
 * Fatal (400, E5127): no header with both columns, more than HOTEL_CSV_MAX_ROWS rows.
 * Per-row problems come back in `problems` instead of aborting, so a preview can list
 * them all: an empty or over-long hotelSn / province, a control character, and the same
 * hotelSn repeated with a DIFFERENT province. The same hotelSn with the SAME province is
 * a harmless repeat and counts in `duplicates`. hotelSn compares case-insensitively,
 * like the table's unique key does.
 */
export function parseHotelProvinceCsv(text: string): ParsedHotelCsv {
  const table = parseCsv(text);
  if (table.length === 0) fatal('the file is empty');
  const header = table[0].map(headerKey);
  const hotelCol = header.findIndex((h) => HOTEL_HEADERS.has(h));
  const provinceCol = header.findIndex((h) => PROVINCE_HEADERS.has(h));
  if (hotelCol < 0 || provinceCol < 0) {
    fatal('the first row must name a hotel_sn column and a province column');
  }
  const data = table.slice(1);
  if (data.length > HOTEL_CSV_MAX_ROWS) fatal(`at most ${HOTEL_CSV_MAX_ROWS} rows per upload`);

  const rows: HotelCsvRow[] = [];
  const problems: HotelCsvProblem[] = [];
  const seen = new Map<string, { province: string; line: number }>();
  let duplicates = 0;

  data.forEach((cells, i) => {
    const line = i + 2; // the header is row 1
    const hotelSn = (cells[hotelCol] ?? '').trim();
    const province = (cells[provinceCol] ?? '').trim();
    const problem = (code: HotelCsvProblemCode, reason: string) =>
      problems.push({ line, code, reason, ...(hotelSn ? { hotelSn: hotelSn.slice(0, HOTEL_SN_MAX_LEN) } : {}) });

    if (!hotelSn) return problem(HOTEL_CSV_PROBLEM.HOTEL_SN_EMPTY, 'hotel_sn is empty');
    if (hotelSn.length > HOTEL_SN_MAX_LEN) {
      return problem(HOTEL_CSV_PROBLEM.HOTEL_SN_LONG, `hotel_sn is longer than ${HOTEL_SN_MAX_LEN} characters`);
    }
    if (CONTROL_CHARS.test(hotelSn)) return problem(HOTEL_CSV_PROBLEM.HOTEL_SN_CONTROL, 'hotel_sn holds a control character');
    if (!province) return problem(HOTEL_CSV_PROBLEM.PROVINCE_EMPTY, 'province is empty');
    if (province.length > REGION_PROVINCE_MAX_LEN) {
      return problem(HOTEL_CSV_PROBLEM.PROVINCE_LONG, `province is longer than ${REGION_PROVINCE_MAX_LEN} characters`);
    }
    if (CONTROL_CHARS.test(province)) return problem(HOTEL_CSV_PROBLEM.PROVINCE_CONTROL, 'province holds a control character');

    const key = hotelSn.toLowerCase();
    const earlier = seen.get(key);
    if (earlier) {
      if (earlier.province === province) {
        duplicates += 1;
        return;
      }
      return problem(HOTEL_CSV_PROBLEM.HOTEL_SN_CONFLICT, `hotel_sn repeats row ${earlier.line} with a different province`);
    }
    seen.set(key, { province, line });
    rows.push({ line, hotelSn, province });
  });

  return { rows, problems, duplicates };
}
