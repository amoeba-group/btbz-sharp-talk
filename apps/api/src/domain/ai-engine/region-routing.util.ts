import { HttpStatus } from '@nestjs/common';
import {
  REGION_CATEGORIES,
  REGION_CATEGORY_DEFAULT_TEAM,
  REGION_ROUTING_MODE,
  SESSION_LANGUAGE_CODES,
  USER_REGION,
} from '@sharptalk/types';
import type { LocalizedText, RegionCategory, RegionCategoryRule, RegionRoutingConfig, UserRegion } from '@sharptalk/types';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { hasWebhook, isMaskedWebhook, isSlackWebhookUrl, sealWebhook } from './slack-webhook.util';

/** Longest province name or code a table row may hold ("Bà Rịa - Vũng Tàu" is 17). */
export const REGION_PROVINCE_MAX_LEN = 80;
/** Most provinces under one category: the 63 old + 34 new names + aliases fit several times over. */
export const REGION_PROVINCES_PER_CATEGORY_MAX = 200;
/** Longest per-language display name of a category. */
export const REGION_LABEL_MAX_LEN = 60;

const TEAMS: readonly string[] = Object.values(USER_REGION);

function invalid(problem: string): never {
  throw new BusinessException(ERROR_CODE.REGION_ROUTING_INVALID, HttpStatus.BAD_REQUEST, {
    regionRouting: [problem],
  });
}

/** Longest a strict-mode widening delay may be: one day. */
export const REGION_WIDEN_AFTER_MAX_MIN = 1440;

/**
 * The strict-mode fields of the table (PLN-261012 SG-67): `mode`, `widenAfterMinutes`
 * and the per-team Slack webhooks. Each is optional and only copied across when set,
 * so a table without them is stored exactly as before.
 */
function sanitizeStrictFields(
  raw: Record<string, unknown>,
  out: RegionRoutingConfig,
  previous?: RegionRoutingConfig | null,
): void {
  if (raw.mode !== undefined && raw.mode !== null) {
    if (raw.mode !== REGION_ROUTING_MODE.PREFER && raw.mode !== REGION_ROUTING_MODE.STRICT) {
      invalid(`mode must be ${REGION_ROUTING_MODE.PREFER} or ${REGION_ROUTING_MODE.STRICT}`);
    }
    out.mode = raw.mode;
  }

  if (raw.widenAfterMinutes !== undefined && raw.widenAfterMinutes !== null && raw.widenAfterMinutes !== '') {
    const n = Number(raw.widenAfterMinutes);
    if (!Number.isInteger(n) || n < 0 || n > REGION_WIDEN_AFTER_MAX_MIN) {
      invalid(`widenAfterMinutes must be a whole number of minutes from 0 to ${REGION_WIDEN_AFTER_MAX_MIN}`);
    }
    // 0 = "never widen", which is what leaving it out means.
    if (n > 0) out.widenAfterMinutes = n;
  }

  if (raw.slackByRegion === undefined || raw.slackByRegion === null) return;
  if (typeof raw.slackByRegion !== 'object' || Array.isArray(raw.slackByRegion)) {
    invalid('slackByRegion must be an object');
  }
  const byRegion = raw.slackByRegion as Record<string, unknown>;
  const sealed: Partial<Record<UserRegion, string>> = {};
  for (const [team, value] of Object.entries(byRegion)) {
    if (!TEAMS.includes(team)) invalid(`slackByRegion.${team} is not a team (${TEAMS.join(', ')})`);
    if (value === undefined || value === null || value === '') continue; // cleared
    if (typeof value !== 'string') invalid(`slackByRegion.${team} must be text`);
    if (isMaskedWebhook(value)) {
      // Untouched in the console: keep what is stored, or nothing when nothing was.
      const kept = previous?.slackByRegion?.[team as UserRegion];
      if (hasWebhook(kept)) sealed[team as UserRegion] = kept as string;
      continue;
    }
    if (!isSlackWebhookUrl(value.trim())) {
      invalid(`slackByRegion.${team} must be a Slack incoming webhook (https://hooks.slack.com/services/…)`);
    }
    try {
      sealed[team as UserRegion] = sealWebhook(value.trim());
    } catch {
      invalid('the server cannot store a webhook because its encryption key is not configured');
    }
  }
  if (Object.keys(sealed).length) out.slackByRegion = sealed;
}

/**
 * Validate and clean `handoff_config.regionRouting` before it is stored
 * (PLN-261012 SG-65, REQ D-14). The console is the only writer today, but the
 * column is JSON an API client can fill with anything, and the matcher reads it on
 * every hand-off — a malformed table must be refused at the door, not tolerated
 * at 2am.
 *
 * Rejects (400, E5095): a non-object table, a non-boolean `enabled`, more than four
 * category rows, an unknown or repeated category id, a team that is not north or
 * south, a non-array `provinces`, a non-string province, a province or label over
 * its length limit, too many provinces under one category.
 * Cleans silently: blank provinces are dropped, entries are trimmed, exact
 * repeats inside one category collapse, unknown row fields are not stored.
 * `null` removes the table. An absent `team` takes the category's default team.
 *
 * Strict-mode fields (PLN-261012 SG-67) are optional: `mode` (prefer | strict),
 * `widenAfterMinutes` (0..1440, 0 = never) and `slackByRegion` (Slack incoming webhooks,
 * sealed at rest — see slack-webhook.util). Anything else in the object is not stored.
 */
export function sanitizeRegionRouting(
  input: unknown,
  /** The stored table, for keeping a sealed webhook the console echoed back masked (SG-67). */
  previous?: RegionRoutingConfig | null,
): RegionRoutingConfig | undefined {
  if (input === null || input === undefined) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) invalid('regionRouting must be an object');
  const raw = input as Record<string, unknown>;

  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') invalid('enabled must be true or false');
  const out: RegionRoutingConfig = { enabled: raw.enabled === true };
  sanitizeStrictFields(raw, out, previous);

  if (raw.categories === undefined || raw.categories === null) return out;
  if (!Array.isArray(raw.categories)) invalid('categories must be an array');
  if (raw.categories.length > REGION_CATEGORIES.length) {
    invalid(`at most ${REGION_CATEGORIES.length} categories`);
  }

  const seen = new Set<string>();
  const categories: RegionCategoryRule[] = [];
  raw.categories.forEach((row: unknown, i: number) => {
    const at = `categories[${i}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) invalid(`${at} must be an object`);
    const r = row as Record<string, unknown>;

    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!id) invalid(`${at}.id is required`);
    if (!(REGION_CATEGORIES as readonly string[]).includes(id)) {
      invalid(`${at}.id must be one of ${REGION_CATEGORIES.join(', ')}`);
    }
    if (seen.has(id)) invalid(`${at}.id "${id}" is listed twice`);
    seen.add(id);

    let team: UserRegion = REGION_CATEGORY_DEFAULT_TEAM[id as RegionCategory];
    if (r.team !== undefined && r.team !== null) {
      if (typeof r.team !== 'string' || !TEAMS.includes(r.team)) {
        invalid(`${at}.team must be one of ${TEAMS.join(', ')}`);
      }
      team = r.team as UserRegion;
    }

    if (r.provinces !== undefined && !Array.isArray(r.provinces)) invalid(`${at}.provinces must be an array`);
    const provinces: string[] = [];
    for (const p of (r.provinces ?? []) as unknown[]) {
      if (typeof p !== 'string') invalid(`${at}.provinces must contain only text`);
      const name = p.trim();
      if (!name) continue; // a blank line in the console box, not an error
      if (name.length > REGION_PROVINCE_MAX_LEN) {
        invalid(`${at}.provinces entries are at most ${REGION_PROVINCE_MAX_LEN} characters`);
      }
      if (!provinces.includes(name)) provinces.push(name);
    }
    if (provinces.length > REGION_PROVINCES_PER_CATEGORY_MAX) {
      invalid(`${at}.provinces holds at most ${REGION_PROVINCES_PER_CATEGORY_MAX} entries`);
    }

    const rule: RegionCategoryRule = { id: id as RegionCategory, team, provinces };
    if (r.label !== undefined && r.label !== null) {
      if (typeof r.label !== 'object' || Array.isArray(r.label)) invalid(`${at}.label must be an object`);
      const label: LocalizedText = {};
      for (const lang of SESSION_LANGUAGE_CODES) {
        const v = (r.label as Record<string, unknown>)[lang];
        if (typeof v !== 'string' || !v.trim()) continue;
        if (v.trim().length > REGION_LABEL_MAX_LEN) {
          invalid(`${at}.label is at most ${REGION_LABEL_MAX_LEN} characters`);
        }
        label[lang] = v.trim();
      }
      if (Object.keys(label).length) rule.label = label;
    }
    categories.push(rule);
  });

  out.categories = categories;
  return out;
}
