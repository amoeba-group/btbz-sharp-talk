import { randomBytes } from 'crypto';
import {
  WEBHOOK_MASK,
  hasWebhook,
  isMaskedWebhook,
  isSlackWebhookUrl,
  openWebhook,
  sealWebhook,
} from './slack-webhook.util';
import { sanitizeRegionRouting } from './region-routing.util';
import { maskHandoffForRead, sanitizeBusinessHours, sanitizeHandoffExtras } from './handoff-config.util';
import { AiConfigService } from './ai-config.service';
import { BusinessException } from '../../global/exception/business.exception';
import type { HandoffConfig } from './entity/tenant-ai-config.entity';

/**
 * Hand-off config added for routing extras (PLN-261012 SG-63, SG-67): strict region mode and its
 * widening delay, regional Slack webhooks (sealed at rest, never returned in clear), regional
 * off-hours mailboxes, the unclaimed-alert switch, and a team's own business hours. Everything is
 * optional and a config that uses none of it is stored exactly as before.
 */
const HOOK = 'https://hooks.slack.com/services/T0001/B0002/abcDEF123';
const OTHER_HOOK = 'https://hooks.slack.com/services/T0001/B0003/zzzYYY999';

const OLD_KEY = process.env.CRED_ENC_KEY;
beforeAll(() => {
  process.env.CRED_ENC_KEY = randomBytes(32).toString('base64');
});
afterAll(() => {
  if (OLD_KEY === undefined) delete process.env.CRED_ENC_KEY;
  else process.env.CRED_ENC_KEY = OLD_KEY;
});

function rejection(fn: () => unknown): BusinessException {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BusinessException);
    return e as BusinessException;
  }
  throw new Error('expected a rejection');
}

describe('slack webhook util', () => {
  it('accepts only an https Slack incoming-webhook URL', () => {
    expect(isSlackWebhookUrl(HOOK)).toBe(true);
    for (const bad of [
      'http://hooks.slack.com/services/T/B/x', // not https
      'https://hooks.slack.com.evil.com/services/T/B/x', // look-alike host
      'https://evil.com/hooks.slack.com/services/T/B/x',
      'https://user:pw@hooks.slack.com/services/T/B/x', // credentials in the URL
      'https://hooks.slack.com:8443/services/T/B/x', // port
      'https://hooks.slack.com/services/T/B/x?redirect=http://169.254.169.254', // query
      'https://hooks.slack.com/services/T/B', // missing token
      'https://hooks.slack.com/services/T/B/x/extra',
      'https://hooks.slack.com/other/T/B/x',
      'https://localhost/services/T/B/x',
      'javascript:alert(1)',
      '',
      'not a url',
      `https://hooks.slack.com/services/T/B/${'x'.repeat(400)}`,
    ]) {
      expect(isSlackWebhookUrl(bad)).toBe(false);
    }
    expect(isSlackWebhookUrl(null)).toBe(false);
    expect(isSlackWebhookUrl(42)).toBe(false);
  });

  it('seals for storage and opens again, and the sealed text holds no part of the URL', () => {
    const sealed = sealWebhook(HOOK);
    expect(sealed.startsWith('enc:v1:')).toBe(true);
    expect(sealed).not.toContain('abcDEF123');
    expect(sealed).not.toContain('hooks.slack.com');
    expect(openWebhook(sealed)).toBe(HOOK);
  });

  it('seals differently each time (random IV)', () => {
    expect(sealWebhook(HOOK)).not.toBe(sealWebhook(HOOK));
  });

  it('opens a plain Slack URL stored by hand, and refuses anything else without throwing', () => {
    expect(openWebhook(HOOK)).toBe(HOOK);
    expect(openWebhook('https://evil.example/hook')).toBeNull();
    expect(openWebhook('enc:v1:not-base64-ciphertext')).toBeNull();
    expect(openWebhook(undefined)).toBeNull();
    expect(openWebhook('')).toBeNull();
  });

  it('a sealed value whose clear text is not a Slack URL opens as nothing', () => {
    expect(openWebhook(sealWebhook('https://evil.example/hook'))).toBeNull();
  });

  it('knows the mask and what counts as "something stored"', () => {
    expect(isMaskedWebhook(WEBHOOK_MASK)).toBe(true);
    expect(isMaskedWebhook(HOOK)).toBe(false);
    expect(hasWebhook(sealWebhook(HOOK))).toBe(true);
    expect(hasWebhook('')).toBe(false);
    expect(hasWebhook(undefined)).toBe(false);
  });
});

describe('sanitizeRegionRouting — strict mode fields (SG-67)', () => {
  it('stores nothing extra for a table that uses none of it', () => {
    expect(sanitizeRegionRouting({ enabled: true })).toEqual({ enabled: true });
  });

  it('accepts prefer and strict, drops null, refuses anything else', () => {
    expect(sanitizeRegionRouting({ enabled: true, mode: 'strict' })).toEqual({ enabled: true, mode: 'strict' });
    expect(sanitizeRegionRouting({ enabled: true, mode: 'prefer' })).toEqual({ enabled: true, mode: 'prefer' });
    expect(sanitizeRegionRouting({ enabled: true, mode: null })).toEqual({ enabled: true });
    expect(rejection(() => sanitizeRegionRouting({ enabled: true, mode: 'hard' })).errorCode).toBe('E5095');
  });

  it('accepts a widening delay of whole minutes up to a day; 0 means never', () => {
    expect(sanitizeRegionRouting({ enabled: true, widenAfterMinutes: 15 })?.widenAfterMinutes).toBe(15);
    expect(sanitizeRegionRouting({ enabled: true, widenAfterMinutes: '20' })?.widenAfterMinutes).toBe(20);
    expect(sanitizeRegionRouting({ enabled: true, widenAfterMinutes: 0 })).toEqual({ enabled: true });
    expect(sanitizeRegionRouting({ enabled: true, widenAfterMinutes: '' })).toEqual({ enabled: true });
    for (const bad of [-1, 1.5, 1441, 'soon', NaN]) {
      expect(rejection(() => sanitizeRegionRouting({ enabled: true, widenAfterMinutes: bad })).errorCode).toBe('E5095');
    }
  });

  it('seals a new webhook, never storing it in clear', () => {
    const out = sanitizeRegionRouting({ enabled: true, slackByRegion: { north: HOOK } });
    expect(out?.slackByRegion?.north?.startsWith('enc:v1:')).toBe(true);
    expect(JSON.stringify(out)).not.toContain('abcDEF123');
    expect(openWebhook(out?.slackByRegion?.north)).toBe(HOOK);
  });

  it('keeps the stored webhook when the console echoes the mask back, and replaces it when changed', () => {
    const stored = { enabled: true, slackByRegion: { north: sealWebhook(HOOK), south: sealWebhook(OTHER_HOOK) } };
    const out = sanitizeRegionRouting(
      { enabled: true, slackByRegion: { north: WEBHOOK_MASK, south: 'https://hooks.slack.com/services/T9/B9/newtoken' } },
      stored,
    );
    expect(out?.slackByRegion?.north).toBe(stored.slackByRegion.north); // untouched
    expect(openWebhook(out?.slackByRegion?.south)).toBe('https://hooks.slack.com/services/T9/B9/newtoken');
  });

  it('removes a webhook that was cleared, and drops a masked echo with nothing stored behind it', () => {
    const stored = { enabled: true, slackByRegion: { north: sealWebhook(HOOK) } };
    expect(sanitizeRegionRouting({ enabled: true, slackByRegion: { north: '' } }, stored)).toEqual({ enabled: true });
    expect(sanitizeRegionRouting({ enabled: true, slackByRegion: { south: WEBHOOK_MASK } }, stored)).toEqual({ enabled: true });
    // Omitting the map entirely also removes them: the console owns the whole table.
    expect(sanitizeRegionRouting({ enabled: true }, stored)).toEqual({ enabled: true });
  });

  it('refuses a webhook that is not Slack, a team that does not exist, and a non-object map', () => {
    expect(rejection(() => sanitizeRegionRouting({ enabled: true, slackByRegion: { north: 'https://evil.example/x' } })).errorCode).toBe('E5095');
    expect(rejection(() => sanitizeRegionRouting({ enabled: true, slackByRegion: { east: HOOK } })).errorCode).toBe('E5095');
    expect(rejection(() => sanitizeRegionRouting({ enabled: true, slackByRegion: [HOOK] })).errorCode).toBe('E5095');
    expect(rejection(() => sanitizeRegionRouting({ enabled: true, slackByRegion: { north: 5 } })).errorCode).toBe('E5095');
  });

  it('says what is wrong, in details the console can show', () => {
    const e = rejection(() => sanitizeRegionRouting({ enabled: true, slackByRegion: { north: 'https://evil.example/x' } }));
    expect(e.details?.regionRouting?.[0]).toContain('slackByRegion.north');
  });

  it('refuses to store a webhook when the server has no encryption key', () => {
    const saved = process.env.CRED_ENC_KEY;
    delete process.env.CRED_ENC_KEY;
    try {
      const e = rejection(() => sanitizeRegionRouting({ enabled: true, slackByRegion: { north: HOOK } }));
      expect(e.details?.regionRouting?.[0]).toContain('encryption key');
    } finally {
      process.env.CRED_ENC_KEY = saved;
    }
  });
});

describe('sanitizeBusinessHours — a team own hours (SG-67)', () => {
  const ok = { timezone: 'Asia/Ho_Chi_Minh', days: [1, 2, 3], start: '09:00', end: '18:00' };

  it('passes valid hours through, with breaks', () => {
    expect(sanitizeBusinessHours({ ...ok, breaks: [{ start: '12:00', end: '13:00' }] }, 'h')).toEqual({
      ...ok,
      breaks: [{ start: '12:00', end: '13:00' }],
    });
  });

  it('null / undefined mean no override', () => {
    expect(sanitizeBusinessHours(null, 'h')).toBeUndefined();
    expect(sanitizeBusinessHours(undefined, 'h')).toBeUndefined();
  });

  it('an empty day list is kept (the router reads it as every day); duplicates collapse', () => {
    expect(sanitizeBusinessHours({ ...ok, days: [] }, 'h')?.days).toEqual([]);
    expect(sanitizeBusinessHours({ ...ok, days: [1, 1, 2] }, 'h')?.days).toEqual([1, 2]);
  });

  it.each([
    ['a missing timezone', { ...ok, timezone: '' }, 'timezone'],
    ['an unknown timezone', { ...ok, timezone: 'Mars/Olympus' }, 'timezone'],
    ['a bad start', { ...ok, start: '25:00' }, 'start'],
    ['a bad end', { ...ok, end: '9am' }, 'end'],
    ['a day out of range', { ...ok, days: [7] }, 'days'],
    ['a non-integer day', { ...ok, days: [1.5] }, 'days'],
    ['days that are not a list', { ...ok, days: 'mon' }, 'days'],
    ['a break without an end', { ...ok, breaks: [{ start: '12:00' }] }, 'breaks[0]'],
    ['too many breaks', { ...ok, breaks: Array.from({ length: 5 }, () => ({ start: '12:00', end: '12:30' })) }, 'breaks'],
  ])('refuses %s (E5128)', (_name, input, where) => {
    const e = rejection(() => sanitizeBusinessHours(input, 'teamRouting.options[0].businessHours'));
    expect(e.errorCode).toBe('E5128');
    expect(e.details?.handoffConfig?.[0]).toContain(where);
  });

  it('refuses a non-object', () => {
    expect(rejection(() => sanitizeBusinessHours('9-18', 'h')).errorCode).toBe('E5128');
  });
});

describe('sanitizeHandoffExtras', () => {
  it('returns a config that uses none of the extras as the SAME object', () => {
    const plain: HandoffConfig = { assigneeUserIds: [1], sla: { normalHours: 24 }, offHours: { email: 'a@b.co' } };
    expect(sanitizeHandoffExtras(plain)).toBe(plain);
  });

  it('checks and cleans the regional mailboxes', () => {
    const out = sanitizeHandoffExtras({ offHours: { email: 'cs@x.co', emailByRegion: { north: ' n@x.co ', south: '' } } });
    expect(out.offHours).toEqual({ email: 'cs@x.co', emailByRegion: { north: 'n@x.co' } });
    // All blank: the key goes away.
    expect(sanitizeHandoffExtras({ offHours: { emailByRegion: { north: '' } } }).offHours).toEqual({});
  });

  it('refuses a mailbox that is not an address, and a team that does not exist', () => {
    expect(rejection(() => sanitizeHandoffExtras({ offHours: { emailByRegion: { north: 'no-at-sign' } } })).errorCode).toBe('E5128');
    expect(rejection(() => sanitizeHandoffExtras({ offHours: { emailByRegion: { east: 'a@b.co' } as never } })).errorCode).toBe('E5128');
    expect(rejection(() => sanitizeHandoffExtras({ offHours: { emailByRegion: 'x' as never } })).errorCode).toBe('E5128');
  });

  it('checks each team option hours and keeps the others as they were', () => {
    const out = sanitizeHandoffExtras({
      teamRouting: {
        enabled: true,
        options: [
          { id: 'cs', jobLabel: 'consult', businessHours: { timezone: 'Asia/Ho_Chi_Minh', days: [1], start: '9:00', end: '18:00' } },
          { id: 'business', jobLabel: 'sales_admin' },
        ],
      },
    });
    expect(out.teamRouting?.options?.[0].businessHours).toEqual({ timezone: 'Asia/Ho_Chi_Minh', days: [1], start: '9:00', end: '18:00' });
    expect(out.teamRouting?.options?.[1]).toEqual({ id: 'business', jobLabel: 'sales_admin' });

    const e = rejection(() =>
      sanitizeHandoffExtras({
        teamRouting: { enabled: true, options: [{ id: 'cs', jobLabel: 'consult', businessHours: { timezone: 'Nope', days: [], start: '9:00', end: '18:00' } }] },
      }),
    );
    expect(e.details?.handoffConfig?.[0]).toContain('options[0].businessHours.timezone');
  });

  it('a null team hours removes the override', () => {
    const out = sanitizeHandoffExtras({
      teamRouting: { enabled: true, options: [{ id: 'cs', jobLabel: 'consult', businessHours: null as never }] },
    });
    expect(out.teamRouting?.options?.[0]).toEqual({ id: 'cs', jobLabel: 'consult' });
  });

  it('accepts true / false / null for the unclaimed switch and refuses the rest', () => {
    expect(sanitizeHandoffExtras({ unclaimedAlerts: false }).unclaimedAlerts).toBe(false);
    expect(sanitizeHandoffExtras({ unclaimedAlerts: true }).unclaimedAlerts).toBe(true);
    expect('unclaimedAlerts' in sanitizeHandoffExtras({ unclaimedAlerts: null as never })).toBe(false);
    expect(rejection(() => sanitizeHandoffExtras({ unclaimedAlerts: 'yes' as never })).errorCode).toBe('E5128');
  });
});

describe('maskHandoffForRead', () => {
  it('replaces every stored webhook by the mask and leaves the original alone', () => {
    const stored: HandoffConfig = {
      assigneeUserIds: [1],
      regionRouting: { enabled: true, slackByRegion: { north: sealWebhook(HOOK), south: sealWebhook(OTHER_HOOK) } },
    };
    const masked = maskHandoffForRead(stored);
    expect(masked?.regionRouting?.slackByRegion).toEqual({ north: WEBHOOK_MASK, south: WEBHOOK_MASK });
    expect(JSON.stringify(masked)).not.toContain('enc:v1');
    expect(stored.regionRouting?.slackByRegion?.north?.startsWith('enc:v1:')).toBe(true);
    expect(masked?.assigneeUserIds).toEqual([1]);
  });

  it('is the same object when there is nothing to hide, and null for no config', () => {
    const plain: HandoffConfig = { regionRouting: { enabled: true } };
    expect(maskHandoffForRead(plain)).toBe(plain);
    expect(maskHandoffForRead(null)).toBeNull();
    expect(maskHandoffForRead(undefined)).toBeNull();
  });
});

describe('AiConfigService — the extras on the way in and out (SG-67)', () => {
  function build(stored: HandoffConfig | null = null) {
    const row: Record<string, unknown> = { tenantId: 1, handoffConfig: stored };
    const configRepo = {
      findOne: jest.fn(async () => row),
      create: jest.fn((v: Record<string, unknown>) => v),
      save: jest.fn(async (v: Record<string, unknown>) => v),
    };
    const svc = new AiConfigService(
      configRepo as never,
      { findOne: jest.fn(async () => null) } as never,
      { findOne: jest.fn(async () => null) } as never,
      { findOne: jest.fn(async () => ({ id: 1 })) } as never,
      { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as never,
      { record: jest.fn() } as never,
      {} as never,
    );
    return { svc, row };
  }

  it('the console never reads a webhook back: only the mask comes out', async () => {
    const h = build({ regionRouting: { enabled: true, slackByRegion: { north: sealWebhook(HOOK) } } });
    const cfg = await h.svc.getConfig(1);
    expect(cfg.handoffConfig?.regionRouting?.slackByRegion).toEqual({ north: WEBHOOK_MASK });
    expect(JSON.stringify(cfg)).not.toContain('enc:v1');
    expect(JSON.stringify(cfg)).not.toContain('abcDEF123');
  });

  it('the internal read the alert side uses still holds the sealed value', async () => {
    const h = build({ regionRouting: { enabled: true, slackByRegion: { north: sealWebhook(HOOK) } } });
    const internal = await h.svc.getHandoffConfig(1);
    expect(openWebhook(internal?.regionRouting?.slackByRegion?.north)).toBe(HOOK);
  });

  it('saving the config the console just read (mask included) keeps the stored webhook', async () => {
    const sealed = sealWebhook(HOOK);
    const h = build({ regionRouting: { enabled: true, slackByRegion: { north: sealed } } });
    const read = (await h.svc.getConfig(1)).handoffConfig as HandoffConfig;
    await h.svc.upsertConfig(1, { handoffConfig: read });
    expect((h.row.handoffConfig as HandoffConfig).regionRouting?.slackByRegion?.north).toBe(sealed);
  });

  it('a new webhook typed in the console is sealed before it is stored', async () => {
    const h = build();
    await h.svc.upsertConfig(1, { handoffConfig: { regionRouting: { enabled: true, slackByRegion: { south: HOOK } } } });
    const stored = (h.row.handoffConfig as HandoffConfig).regionRouting?.slackByRegion?.south;
    expect(stored?.startsWith('enc:v1:')).toBe(true);
    expect(openWebhook(stored)).toBe(HOOK);
  });

  it('a malformed team hours refuses the whole save (E5128) and stores nothing', async () => {
    const h = build();
    await expect(
      h.svc.upsertConfig(1, {
        handoffConfig: { teamRouting: { enabled: true, options: [{ id: 'cs', jobLabel: 'consult', businessHours: { timezone: 'x', days: [], start: '9', end: '18' } }] } },
      }),
    ).rejects.toMatchObject({ errorCode: 'E5128' });
    expect(h.row.handoffConfig).toBeNull();
  });

  it('a config that uses none of the extras is stored byte for byte as before', async () => {
    const h = build();
    const cfg: HandoffConfig = { assigneeUserIds: [9], sla: { normalHours: 24 }, offHours: { email: 'a@b.co' } };
    await h.svc.upsertConfig(1, { handoffConfig: cfg });
    expect(h.row.handoffConfig).toEqual(cfg);
  });
});
