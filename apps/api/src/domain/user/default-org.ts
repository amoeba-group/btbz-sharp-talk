/**
 * Default job labels and units every tenant starts with
 * (PLN-261019-Users-Unit-Labels-Routing-Conditions D2).
 *
 * Names used to be Korean regardless of the tenant's language (the seed for
 * ivyusa was copied into tenant creation). Now a tenant whose default language
 * is Korean gets the Korean names and everyone else the English ones; either is
 * renamed freely from the console afterwards. Codes are the stable part: the
 * three job-label codes are the permission axis (permission-matrix.ts) and must
 * never change.
 */

/** Codes are lower-case slugs — stable identifiers, not display text. */
export const ORG_CODE_PATTERN = /^[a-z0-9_]{1,24}$/;

type NamedCode = { code: string; name: string };

const JOB_LABEL_NAMES: ReadonlyArray<{ code: string; ko: string; en: string }> = [
  { code: 'consult', ko: '상담', en: 'Counsels' },
  { code: 'accounting', ko: '회계', en: 'Accountant' },
  { code: 'operations', ko: '운영', en: 'Operation' },
];

const UNIT_NAMES: ReadonlyArray<{ code: string; ko: string; en: string }> = [
  { code: 'cs', ko: '고객지원팀', en: 'CS' },
  { code: 'mkt', ko: '마케팅팀', en: 'MKT' },
  { code: 'management', ko: '운영팀', en: 'Management' },
];

const isKorean = (language: string | null | undefined) => (language ?? '').trim().toLowerCase() === 'ko';

export function defaultJobLabels(language: string | null | undefined): NamedCode[] {
  const ko = isKorean(language);
  return JOB_LABEL_NAMES.map((l) => ({ code: l.code, name: ko ? l.ko : l.en }));
}

export function defaultUnits(language: string | null | undefined): NamedCode[] {
  const ko = isKorean(language);
  return UNIT_NAMES.map((u) => ({ code: u.code, name: ko ? u.ko : u.en }));
}
