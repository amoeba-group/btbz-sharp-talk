/**
 * Business-hours draft shared by the tenant-wide hours and a team's own override in the console's
 * hand-off settings (PLN-261012 SG-67). The editor works on a flat draft (strings for the inputs);
 * these two functions are the whole conversion to and from the stored shape, kept pure so the
 * round trip — including "no override" and "no break" — is unit-tested instead of eyeballed.
 */

/** The stored shape (`handoff_config.businessHours` and `teamRouting.options[].businessHours`). */
export interface StoredBusinessHours {
  timezone: string;
  days: number[];
  start: string;
  end: string;
  breaks?: Array<{ start: string; end: string }>;
}

export interface HoursDraft {
  /** Hours are in use (for a team: the team overrides the shared hours). */
  on: boolean;
  timezone: string;
  days: number[];
  start: string;
  end: string;
  breakOn: boolean;
  breakStart: string;
  breakEnd: string;
}

/** Monday to Friday, 09:00-18:00, a lunch hour — what a freshly ticked box starts from. */
export function defaultHoursDraft(timezone: string = 'UTC'): HoursDraft {
  return {
    on: false,
    timezone,
    days: [1, 2, 3, 4, 5],
    start: '09:00',
    end: '18:00',
    breakOn: false,
    breakStart: '12:00',
    breakEnd: '13:00',
  };
}

/** Read stored hours into a draft; nothing stored = `on: false` with the defaults. */
export function hoursDraftFrom(stored: StoredBusinessHours | null | undefined, timezone: string = 'UTC'): HoursDraft {
  const base = defaultHoursDraft(timezone);
  if (!stored) return base;
  const firstBreak = stored.breaks?.[0];
  return {
    on: true,
    timezone: stored.timezone || timezone,
    days: stored.days ?? base.days,
    start: stored.start || base.start,
    end: stored.end || base.end,
    breakOn: !!firstBreak,
    breakStart: firstBreak?.start || base.breakStart,
    breakEnd: firstBreak?.end || base.breakEnd,
  };
}

/**
 * The stored shape for a draft, or undefined when the hours are off. `breaks` is written even when
 * empty: the console owns the whole config object, so omitting the key would silently keep a stored
 * break the operator just removed.
 */
export function hoursConfigFrom(draft: HoursDraft): StoredBusinessHours | undefined {
  if (!draft.on) return undefined;
  return {
    timezone: draft.timezone,
    days: draft.days,
    start: draft.start,
    end: draft.end,
    breaks: draft.breakOn ? [{ start: draft.breakStart, end: draft.breakEnd }] : [],
  };
}
