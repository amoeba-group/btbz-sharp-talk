import { Repository } from 'typeorm';
import { SessionService } from '../session/session.service';
import { NotificationService } from './notification.service';
import { Notification } from './entity/notification.entity';
import { NotificationPref } from './entity/notification-pref.entity';
import { Session } from '../session/entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { EventBusService } from '../../infrastructure/infrastructure.module';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { ORDER_NOTIFICATION_CATEGORIES } from '@sharptalk/types';

const EXTERNAL = ['email', 'sms', 'web_push', 'push'];
const CATEGORIES = ['payment', 'shipping', 'event', 'review', 'chat'];

describe('NotificationService.isSuppressed / notify (Stage 6 — D-4 fail-closed suppression)', () => {
  let svc: NotificationService;
  let busPublish: jest.Mock;
  /** (customerId:channel:category) -> enabled(0|1); absent key = no pref row. */
  let prefRows: Map<string, number>;

  const key = (c: number, ch: string, cat: string) => `${c}:${ch}:${cat}`;

  beforeEach(() => {
    prefRows = new Map();
    const notifRepo = {
      create: jest.fn((e: Partial<Notification>) => e as Notification),
      save: jest.fn(async (e: Notification) => e),
    } as unknown as Repository<Notification>;
    const prefRepo = {
      findOne: jest.fn(async ({ where }: { where: { customerId: number; channel: string; category: string } }) => {
        const enabled = prefRows.get(key(where.customerId, where.channel, where.category));
        if (enabled === undefined) return null;
        return { customerId: where.customerId, channel: where.channel, category: where.category, enabled } as NotificationPref;
      }),
    } as unknown as Repository<NotificationPref>;
    const sessionRepo = {} as unknown as Repository<Session>;
    busPublish = jest.fn();
    const bus = { subscribe: jest.fn(), publish: busPublish } as unknown as EventBusService;
    const redis = {
      del: jest.fn(),
      get: jest.fn(async () => null),
      set: jest.fn(),
      available: () => false,
    } as unknown as RedisService;
    // sessionService sits between sessionRepo and bus — it is the shared widget-session
    // authorization gate. Unused by these suppression suites, but its position matters:
    // omitting it shifted bus into its slot and redis into bus's.
    const sessionService = {
      requireCustomerId: jest.fn(),
      requireCustomer: jest.fn(),
    } as never;
    svc = new NotificationService(
      notifRepo,
      prefRepo,
      sessionRepo,
      // Tenant repo: no row, i.e. no delivery ceiling — the pre-policy behaviour
      // these suppression cases were written against.
      { findOne: jest.fn(async () => null) } as unknown as Repository<Tenant>,
      sessionService,
      bus,
      redis,
    );
  });

  const channelsOf = (rows: Notification[]) => rows.map((r) => r.channel).sort();

  it('null customer: all external suppressed (fail-closed), in_app kept', async () => {
    const rows = await svc.notify({ customerId: null, category: 'payment', title: 't' });
    expect(channelsOf(rows)).toEqual(['in_app']);
  });

  it('marketing category with no pref row: external suppressed (default-deny)', async () => {
    const rows = await svc.notify({ customerId: 1, category: 'event', title: 't' });
    expect(channelsOf(rows)).toEqual(['in_app']);
  });

  it('transactional category with no pref row: external allowed (incl. push)', async () => {
    const rows = await svc.notify({ customerId: 1, category: 'shipping', title: 't' });
    expect(channelsOf(rows)).toEqual(['email', 'in_app', 'push', 'sms', 'web_push']);
  });

  it('chat category is transactional: push allowed with no pref row', async () => {
    const rows = await svc.notify({ customerId: 1, category: 'chat', title: 't', channel: 'push' });
    expect(channelsOf(rows)).toEqual(['in_app', 'push']);
  });

  it('explicitly disabled row suppresses just that channel', async () => {
    prefRows.set(key(1, 'email', 'payment'), 0);
    const rows = await svc.notify({ customerId: 1, category: 'payment', title: 't' });
    expect(channelsOf(rows)).toEqual(['in_app', 'push', 'sms', 'web_push']);
  });

  it('full opt-out (every external row disabled): zero external, in_app kept', async () => {
    for (const ch of EXTERNAL) for (const cat of CATEGORIES) prefRows.set(key(1, ch, cat), 0);
    for (const cat of CATEGORIES) {
      const rows = await svc.notify({ customerId: 1, category: cat, title: 't' });
      expect(channelsOf(rows)).toEqual(['in_app']);
    }
  });

  it('re-consent (rows re-enabled) resumes external sends, incl. marketing', async () => {
    for (const ch of EXTERNAL) for (const cat of CATEGORIES) prefRows.set(key(1, ch, cat), 1);
    const marketing = await svc.notify({ customerId: 1, category: 'event', title: 't' });
    expect(channelsOf(marketing)).toEqual(['email', 'in_app', 'push', 'sms', 'web_push']);
  });

  it('push row publishes EVENTS.PUSH_DISPATCH with tenant/customer context', async () => {
    const rows = await svc.notify({
      tenantId: 7,
      customerId: 1,
      category: 'shipping',
      title: 't',
      channel: 'push',
    });
    expect(channelsOf(rows)).toEqual(['in_app', 'push']);
    expect(busPublish).toHaveBeenCalledWith(
      'push.dispatch',
      expect.objectContaining({ tenantId: 7, customerId: 1, category: 'shipping' }),
    );
  });

  it('linkUrl persists on every row and rides the PUSH_DISPATCH payload with productHandle (A-9)', async () => {
    const rows = await svc.notify({
      tenantId: 7,
      customerId: 1,
      category: 'shipping',
      title: 't',
      channel: 'push',
      linkUrl: 'https://shop.example.com/products/apple-jam',
      productHandle: 'apple-jam',
    });
    expect(channelsOf(rows)).toEqual(['in_app', 'push']);
    for (const r of rows) expect(r.linkUrl).toBe('https://shop.example.com/products/apple-jam');
    expect(busPublish).toHaveBeenCalledWith(
      'push.dispatch',
      expect.objectContaining({
        linkUrl: 'https://shop.example.com/products/apple-jam',
        productHandle: 'apple-jam',
      }),
    );
  });

  it('no linkUrl: rows and push payload carry null link fields (A-9 default)', async () => {
    const rows = await svc.notify({ tenantId: 7, customerId: 1, category: 'shipping', title: 't', channel: 'push' });
    for (const r of rows) expect(r.linkUrl).toBeNull();
    expect(busPublish).toHaveBeenCalledWith(
      'push.dispatch',
      expect.objectContaining({ linkUrl: null, productHandle: null }),
    );
  });

  it('tenantId is stamped on created rows (detached-handler G4 fix)', async () => {
    const rows = await svc.notify({ tenantId: 7, customerId: 1, category: 'payment', title: 't' });
    for (const r of rows) expect(r.tenantId).toBe(7);
  });

  it('isSuppressed matrix directly', async () => {
    // no row
    await expect(svc.isSuppressed(null, 'email', 'payment')).resolves.toBe(true);
    await expect(svc.isSuppressed(2, 'email', 'payment')).resolves.toBe(false);
    await expect(svc.isSuppressed(2, 'email', 'shipping')).resolves.toBe(false);
    await expect(svc.isSuppressed(2, 'email', 'event')).resolves.toBe(true);
    await expect(svc.isSuppressed(2, 'email', 'review')).resolves.toBe(true);
    // explicit rows override defaults both ways
    prefRows.set(key(2, 'email', 'payment'), 0);
    prefRows.set(key(2, 'sms', 'review'), 1);
    await expect(svc.isSuppressed(2, 'email', 'payment')).resolves.toBe(true);
    await expect(svc.isSuppressed(2, 'sms', 'review')).resolves.toBe(false);
  });
});

/**
 * `ref_type`/`ref_id` — what a notification is ABOUT (PLN-260817 S5).
 *
 * ReviewService.requestReview had always published `orderItemId` on the event,
 * but NotifyInput had no matching field, so it was dropped on the floor and the
 * widget had no id to open the review form with. These pin the plumbing.
 */
describe('NotificationService.notify — record reference (PLN-260817 S5)', () => {
  let svc: NotificationService;
  let saved: Notification[];

  beforeEach(() => {
    saved = [];
    const notifRepo = {
      create: jest.fn((e: Partial<Notification>) => e as Notification),
      save: jest.fn(async (e: Notification) => {
        saved.push(e);
        return e;
      }),
    } as unknown as Repository<Notification>;
    const prefRepo = {
      findOne: jest.fn(async () => null),
    } as unknown as Repository<NotificationPref>;
    const sessionService = { requireCustomerId: jest.fn(), requireCustomer: jest.fn() } as never;
    const bus = { subscribe: jest.fn(), publish: jest.fn() } as unknown as EventBusService;
    const redis = {
      del: jest.fn(),
      get: jest.fn(async () => null),
      set: jest.fn(),
      available: () => false,
    } as unknown as RedisService;
    svc = new NotificationService(
      notifRepo,
      prefRepo,
      {} as unknown as Repository<Session>,
      { findOne: jest.fn(async () => null) } as unknown as Repository<Tenant>,
      sessionService,
      bus,
      redis,
    );
  });

  it('persists refType/refId on every row it writes', async () => {
    await svc.notify({
      customerId: 1,
      category: 'review',
      title: 'How was your order?',
      refType: 'order_item',
      refId: 4242,
    });
    expect(saved.length).toBeGreaterThan(0);
    for (const row of saved) {
      expect(row.refType).toBe('order_item');
      expect(row.refId).toBe(4242);
    }
  });

  it('an emitter that names no record leaves both columns null', async () => {
    await svc.notify({ customerId: 1, category: 'payment', title: 'Paid' });
    for (const row of saved) {
      expect(row.refType).toBeNull();
      expect(row.refId).toBeNull();
    }
  });
});

/**
 * Feed scoping (PLN-260817-Widget-Tab-Config). When a tenant shows both list
 * tabs, each must own half the feed — otherwise Notifications' "All" repeats
 * every order row the Orders tab already shows and splitting the chips buys
 * nothing.
 */
describe('NotificationService scoping — order vs notice half', () => {
  let svc: NotificationService;
  let lastWhere: Record<string, unknown> | undefined;
  let countWhere: Record<string, unknown> | undefined;

  beforeEach(() => {
    lastWhere = undefined;
    countWhere = undefined;
    const notifRepo = {
      findAndCount: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        lastWhere = where;
        return [[], 0] as [Notification[], number];
      }),
      count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        countWhere = where;
        return 7;
      }),
    } as unknown as Repository<Notification>;
    const sessionService = {
      requireCustomerId: jest.fn(async () => 42),
      requireCustomer: jest.fn(),
    } as never;
    const redis = {
      del: jest.fn(),
      get: jest.fn(async () => null),
      set: jest.fn(),
      available: () => false,
    } as unknown as RedisService;
    svc = new NotificationService(
      notifRepo,
      {} as unknown as Repository<NotificationPref>,
      {} as unknown as Repository<Session>,
      { findOne: jest.fn(async () => null) } as unknown as Repository<Tenant>,
      sessionService,
      { subscribe: jest.fn(), publish: jest.fn() } as unknown as EventBusService,
      redis,
    );
  });

  /**
   * Assert the OPERATOR, not just that some filter exists: `In` and `Not(In)`
   * over the same list are each other's opposite, so a test that only checks
   * "category is set" passes just as happily with the two swapped — which would
   * put order rows in the notice tab and vice versa.
   */
  const operatorOf = (where: Record<string, unknown> | undefined) =>
    where?.category as unknown as { type?: string; value?: unknown; child?: { type?: string; value?: unknown } };

  it('scope=order narrows "all" to exactly the order categories', async () => {
    await svc.list('tok', 'all', 1, 20, 'order');
    expect(lastWhere).toMatchObject({ customerId: 42 });
    const op = operatorOf(lastWhere);
    expect(op.type).toBe('in');
    expect(op.value).toEqual([...ORDER_NOTIFICATION_CATEGORIES]);
  });

  it('scope=notice EXCLUDES the order categories rather than listing the rest', async () => {
    // Written as an exclusion on purpose: a category added later (a new campaign
    // type, say) must land in the notice half without touching this code.
    await svc.list('tok', 'all', 1, 20, 'notice');
    const op = operatorOf(lastWhere);
    // TypeORM nests the negated operator under `child`, not `value`.
    expect(op.type).toBe('not');
    expect(op.child?.type).toBe('in');
    expect(op.child?.value).toEqual([...ORDER_NOTIFICATION_CATEGORIES]);
  });

  it('the two halves are exact complements — no row belongs to both or neither', async () => {
    await svc.list('tok', 'all', 1, 20, 'order');
    const orderOp = operatorOf(lastWhere);
    await svc.list('tok', 'all', 1, 20, 'notice');
    expect(operatorOf(lastWhere).child?.value).toEqual(orderOp.value);
  });

  it('no scope means the whole feed — the single-list-tab configuration', async () => {
    await svc.list('tok', 'all', 1, 20);
    expect(lastWhere).toEqual({ customerId: 42, deletedAt: expect.anything() });
  });

  it('an explicit chip wins over the scope', async () => {
    // A chip asks for exactly one category; the scope only decides what "all" means.
    await svc.list('tok', 'event', 1, 20, 'order');
    expect(lastWhere).toEqual({ customerId: 42, category: 'event', deletedAt: expect.anything() });
  });

  it('unreadCount applies the same scope, so two badges cannot double-count', async () => {
    await svc.unreadCount('tok', 'order');
    expect(countWhere).toMatchObject({ customerId: 42 });
    const op = countWhere!.category as unknown as { type?: string; value?: unknown };
    expect(op.type).toBe('in');
    expect(op.value).toEqual([...ORDER_NOTIFICATION_CATEGORIES]);
    expect(countWhere!.readAt).toBeDefined();
  });

  it('unreadCount without a scope counts everything', async () => {
    await svc.unreadCount('tok');
    expect(countWhere!.category).toBeUndefined();
  });
});

/**
 * Tenant delivery ceiling + the widget's single marketing opt-out
 * (PLN-260817-Widget-Header-Prefs-Cleanup).
 */
describe('NotificationService — tenant ceiling and marketing opt-out', () => {
  let svc: NotificationService;
  let prefRows: Map<string, number>;
  let saved: Array<{ channel: string; category: string; enabled: number }>;
  let policy: Record<string, string[]> | null;

  const key = (ch: string, cat: string) => `${ch}:${cat}`;

  beforeEach(() => {
    prefRows = new Map();
    saved = [];
    policy = null;
    const notifRepo = {
      create: jest.fn((e: Partial<Notification>) => e as Notification),
      save: jest.fn(async (e: Notification) => e),
    } as unknown as Repository<Notification>;
    const prefRepo = {
      findOne: jest.fn(async ({ where }: { where: { channel: string; category: string } }) => {
        const enabled = prefRows.get(key(where.channel, where.category));
        return enabled === undefined ? null : ({ ...where, enabled } as NotificationPref);
      }),
      find: jest.fn(async () =>
        [...prefRows.entries()].map(([k, enabled]) => {
          const [channel, category] = k.split(':');
          return { channel, category, enabled } as NotificationPref;
        }),
      ),
      create: jest.fn((e: Partial<NotificationPref>) => e as NotificationPref),
      save: jest.fn(async (e: NotificationPref) => {
        saved.push({ channel: e.channel, category: e.category, enabled: e.enabled });
        prefRows.set(key(e.channel, e.category), e.enabled);
        return e;
      }),
    } as unknown as Repository<NotificationPref>;
    const tenantRepo = {
      findOne: jest.fn(async () => ({ notificationChannels: policy }) as unknown as Tenant),
    } as unknown as Repository<Tenant>;
    const sessionService = {
      requireCustomerId: jest.fn(async () => 42),
      requireCustomer: jest.fn(),
    } as never;
    const redis = {
      del: jest.fn(),
      get: jest.fn(async () => null),
      set: jest.fn(),
      available: () => false,
    } as unknown as RedisService;
    svc = new NotificationService(
      notifRepo,
      prefRepo,
      {} as unknown as Repository<Session>,
      tenantRepo,
      sessionService,
      { subscribe: jest.fn(), publish: jest.fn() } as unknown as EventBusService,
      redis,
    );
  });

  it('an unconfigured tenant imposes no ceiling — delivery is unchanged', async () => {
    // The property the whole design rests on: adding this column must not alter
    // what any existing shop sends.
    policy = null;
    prefRows.set(key('email', 'shipping'), 1);
    await expect(svc.isSuppressed(42, 'email', 'shipping', 7)).resolves.toBe(false);
  });

  it('the shop policy overrides an enabled customer preference', async () => {
    policy = { shipping: ['email'] };
    prefRows.set(key('sms', 'shipping'), 1); // customer says yes
    await expect(svc.isSuppressed(42, 'sms', 'shipping', 7)).resolves.toBe(true);
  });

  it('within what the shop permits, the customer still decides', async () => {
    // This is why the mobile app's push toggle keeps working.
    policy = { shipping: ['email', 'push'] };
    prefRows.set(key('push', 'shipping'), 0);
    await expect(svc.isSuppressed(42, 'push', 'shipping', 7)).resolves.toBe(true);
    prefRows.set(key('push', 'shipping'), 1);
    await expect(svc.isSuppressed(42, 'push', 'shipping', 7)).resolves.toBe(false);
  });

  it('reads as opted out when the customer has no preference rows at all', async () => {
    // Marketing is already default-deny, so anything else would show a toggle
    // as "on" while nothing is actually sent.
    await expect(svc.marketingOptOut('tok')).resolves.toBe(true);
  });

  it('opting in writes every marketing category × external channel', async () => {
    await svc.setMarketingOptOut('tok', false);
    const cats = new Set(saved.map((r) => r.category));
    expect(cats.has('event')).toBe(true);
    expect(cats.has('review')).toBe(true);
    // Transactional categories are not marketing and must not be touched here.
    expect(cats.has('payment')).toBe(false);
    expect(cats.has('shipping')).toBe(false);
    expect(saved.every((r) => r.enabled === 1)).toBe(true);
    await expect(svc.marketingOptOut('tok')).resolves.toBe(false);
  });

  it('opting back out disables them again', async () => {
    await svc.setMarketingOptOut('tok', false);
    saved = [];
    await svc.setMarketingOptOut('tok', true);
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.every((r) => r.enabled === 0)).toBe(true);
    await expect(svc.marketingOptOut('tok')).resolves.toBe(true);
  });

  it('a transactional preference does not make the shopper look opted in', async () => {
    prefRows.set(key('email', 'shipping'), 1);
    await expect(svc.marketingOptOut('tok')).resolves.toBe(true);
  });
});

/** PLN-260916 P3 — shopper-side soft delete. */
describe('NotificationService.remove', () => {
  function build() {
    const update = jest.fn().mockResolvedValue({ affected: 2 });
    const notifRepo = { update } as unknown as Repository<Notification>;
    const redis = { del: jest.fn(), get: jest.fn(), set: jest.fn(), available: () => false } as unknown as RedisService;
    const svc = new NotificationService(
      notifRepo,
      {} as unknown as Repository<NotificationPref>,
      {} as unknown as Repository<Session>,
      { findOne: jest.fn(async () => null) } as unknown as Repository<Tenant>,
      { requireCustomerId: jest.fn(async () => 42) } as unknown as SessionService,
      { subscribe: jest.fn(), publish: jest.fn() } as unknown as EventBusService,
      redis,
    );
    return { svc, update, redis };
  }

  it("soft-deletes only the caller's selected rows and busts the unread cache", async () => {
    const { svc, update, redis } = build();
    await expect(svc.remove('tok', { ids: [7, 8, -1, NaN] })).resolves.toBe(2);
    const [where, patch] = update.mock.calls[0];
    expect(where).toMatchObject({ customerId: 42 });
    expect(where.id).toBeDefined();
    expect(patch.deletedAt).toBeInstanceOf(Date);
    expect(redis.del).toHaveBeenCalled();
  });

  it('all=true deletes everything the caller has; nothing selected and not all is a no-op', async () => {
    const { svc, update } = build();
    await svc.remove('tok', { all: true });
    expect(update.mock.calls[0][0]).not.toHaveProperty('id');
    update.mockClear();
    await expect(svc.remove('tok', {})).resolves.toBe(0);
    expect(update).not.toHaveBeenCalled();
  });
});
