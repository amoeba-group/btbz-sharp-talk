import { HttpStatus } from '@nestjs/common';
import { USER_REGION } from '@sharptalk/types';
import type { UserRegion } from '@sharptalk/types';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import type { HandoffBusinessHours, HandoffConfig } from './entity/tenant-ai-config.entity';
import { WEBHOOK_MASK, hasWebhook } from './slack-webhook.util';

/** Most break windows one set of hours may carry (lunch, stand-up, …). */
export const BUSINESS_HOURS_BREAKS_MAX = 4;
const MAILBOX_MAX_LEN = 254;
const TEAMS: readonly string[] = Object.values(USER_REGION);
const HHMM = /^(\d{1,2}):(\d{2})$/;
const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function invalid(problem: string): never {
  throw new BusinessException(ERROR_CODE.HANDOFF_CONFIG_INVALID, HttpStatus.BAD_REQUEST, {
    handoffConfig: [problem],
  });
}

function validClock(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = HHMM.exec(value.trim());
  return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

function validTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate one set of business hours (a team's own override, PLN-261012 SG-67) and return
 * it cleaned. `null`/`undefined` mean "no override". The tenant-wide hours are stored as
 * the console sends them (they always were); only the new per-team override is checked
 * here, because a malformed one would silently decide every hand-off for that team.
 */
export function sanitizeBusinessHours(input: unknown, at: string): HandoffBusinessHours | undefined {
  if (input === null || input === undefined) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) invalid(`${at} must be an object`);
  const raw = input as Record<string, unknown>;

  const timezone = typeof raw.timezone === 'string' ? raw.timezone.trim() : '';
  if (!timezone || !validTimezone(timezone)) invalid(`${at}.timezone must be an IANA time zone such as Asia/Ho_Chi_Minh`);

  if (!validClock(raw.start)) invalid(`${at}.start must be a time as HH:mm`);
  if (!validClock(raw.end)) invalid(`${at}.end must be a time as HH:mm`);

  const days: number[] = [];
  if (raw.days !== undefined && raw.days !== null) {
    if (!Array.isArray(raw.days)) invalid(`${at}.days must be a list of weekdays 0-6`);
    for (const d of raw.days as unknown[]) {
      if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6) invalid(`${at}.days must be whole numbers 0 (Sunday) to 6`);
      if (!days.includes(d)) days.push(d);
    }
  }

  const out: HandoffBusinessHours = { timezone, days, start: (raw.start as string).trim(), end: (raw.end as string).trim() };

  if (raw.breaks !== undefined && raw.breaks !== null) {
    if (!Array.isArray(raw.breaks)) invalid(`${at}.breaks must be a list`);
    if (raw.breaks.length > BUSINESS_HOURS_BREAKS_MAX) invalid(`${at}.breaks holds at most ${BUSINESS_HOURS_BREAKS_MAX} windows`);
    out.breaks = (raw.breaks as unknown[]).map((b, i) => {
      const row = (b ?? {}) as Record<string, unknown>;
      if (!validClock(row.start) || !validClock(row.end)) invalid(`${at}.breaks[${i}] needs a start and an end as HH:mm`);
      return { start: (row.start as string).trim(), end: (row.end as string).trim() };
    });
  }
  return out;
}

/** Cleaned `offHours.emailByRegion`, or undefined when nothing is set. */
function sanitizeEmailByRegion(input: unknown): Partial<Record<UserRegion, string>> | undefined {
  if (input === null || input === undefined) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) invalid('offHours.emailByRegion must be an object');
  const out: Partial<Record<UserRegion, string>> = {};
  for (const [team, value] of Object.entries(input as Record<string, unknown>)) {
    if (!TEAMS.includes(team)) invalid(`offHours.emailByRegion.${team} is not a team (${TEAMS.join(', ')})`);
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string') invalid(`offHours.emailByRegion.${team} must be text`);
    const mail = value.trim();
    if (!mail) continue;
    if (mail.length > MAILBOX_MAX_LEN || !SIMPLE_EMAIL.test(mail)) invalid(`offHours.emailByRegion.${team} must be an email address`);
    out[team as UserRegion] = mail;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Check and clean the parts of the hand-off config added for routing extras
 * (PLN-261012 SG-63/SG-67): `unclaimedAlerts`, `offHours.emailByRegion` and each team
 * option's `businessHours`. The rest of the object is returned exactly as received —
 * a config that uses none of these comes back as the same object.
 */
export function sanitizeHandoffExtras(handoff: HandoffConfig): HandoffConfig {
  let out = handoff;
  const set = (patch: Partial<HandoffConfig>) => {
    out = { ...out, ...patch };
  };

  const unclaimed = (handoff as { unclaimedAlerts?: unknown }).unclaimedAlerts;
  if (unclaimed !== undefined && unclaimed !== null && typeof unclaimed !== 'boolean') {
    invalid('unclaimedAlerts must be true or false');
  }
  if (unclaimed === null) {
    const { unclaimedAlerts: _drop, ...rest } = out;
    out = rest;
  }

  if (handoff.offHours && handoff.offHours.emailByRegion !== undefined) {
    const emailByRegion = sanitizeEmailByRegion(handoff.offHours.emailByRegion);
    const { emailByRegion: _old, ...offRest } = handoff.offHours;
    set({ offHours: emailByRegion ? { ...offRest, emailByRegion } : offRest });
  }

  const options = handoff.teamRouting?.options;
  if (Array.isArray(options) && options.some((o) => o && o.businessHours !== undefined)) {
    const cleaned = options.map((o, i) => {
      if (!o || o.businessHours === undefined) return o;
      const { businessHours, ...optRest } = o;
      const hours = sanitizeBusinessHours(businessHours, `teamRouting.options[${i}].businessHours`);
      return hours ? { ...optRest, businessHours: hours } : optRest;
    });
    set({ teamRouting: { ...(handoff.teamRouting as NonNullable<HandoffConfig['teamRouting']>), options: cleaned } });
  }
  return out;
}

/**
 * The hand-off config as the console may read it: a stored regional Slack webhook is
 * replaced by the fixed mask, never returned in clear or sealed. The original is not
 * modified.
 */
export function maskHandoffForRead(handoff: HandoffConfig | null | undefined): HandoffConfig | null {
  if (!handoff) return handoff ?? null;
  const hooks = handoff.regionRouting?.slackByRegion;
  if (!hooks) return handoff;
  const masked: Partial<Record<UserRegion, string>> = {};
  for (const [team, value] of Object.entries(hooks)) {
    if (hasWebhook(value)) masked[team as UserRegion] = WEBHOOK_MASK;
  }
  return { ...handoff, regionRouting: { ...handoff.regionRouting!, slackByRegion: masked } };
}
