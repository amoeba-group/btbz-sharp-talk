/**
 * In-memory stand-ins shared by the embed / identity specs (PLN-261012 SG-04).
 *
 * Not production code. The file name ends in "spec.ts" on purpose: tsconfig.build excludes
 * every file name ending in spec.ts, so this never reaches dist (jest only runs names ending
 * in ".spec.ts", so it is not a suite either). It only exists so the specs run the REAL
 * replay-guard logic against a store that behaves like Redis SET NX EX instead of stubbing
 * each call.
 */
export interface FakeRedis {
  /** key → value, with the TTL the writer asked for (seconds), for assertions. */
  store: Map<string, { value: string; ttlSec: number | null }>;
  /** Simulate Redis being unreachable: reads miss and `setIfAbsent` answers null. */
  down: boolean;
  available: () => boolean;
  get: jest.Mock<Promise<string | null>, [string]>;
  set: jest.Mock<Promise<void>, [string, string, number?]>;
  setIfAbsent: jest.Mock<Promise<boolean | null>, [string, string, number]>;
  del: jest.Mock<Promise<void>, [string]>;
  /** Drop every key (what the TTL would do after the window). */
  expireAll: () => void;
}

export function fakeRedis(): FakeRedis {
  const store: FakeRedis['store'] = new Map();
  const r: FakeRedis = {
    store,
    down: false,
    available: () => !r.down,
    get: jest.fn(async (key: string) => (r.down ? null : (store.get(key)?.value ?? null))),
    set: jest.fn(async (key: string, value: string, ttlSec?: number) => {
      if (!r.down) store.set(key, { value, ttlSec: ttlSec ?? null });
    }),
    setIfAbsent: jest.fn(async (key: string, value: string, ttlSec: number) => {
      if (r.down) return null;
      if (store.has(key)) return false;
      store.set(key, { value, ttlSec });
      return true;
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    expireAll: () => store.clear(),
  };
  return r;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Does `row` satisfy a TypeORM `where` made of plain values, `In(...)` and `IsNull()`? */
export function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === 'object' && 'type' in cond) {
      if (cond.type === 'in') return (cond.value as unknown[]).includes(value);
      if (cond.type === 'isNull') return value == null;
    }
    return value === cond;
  });
}

/** A conversation repository over an in-memory array: `find` + `update` with In/IsNull criteria. */
export function fakeConvRepo(conversations: Row[]) {
  return {
    find: jest.fn(async ({ where }: { where: Row }) =>
      conversations.filter((c) => matchesWhere(c, where)).map((c) => ({ id: c.id })),
    ),
    update: jest.fn(async (where: Row, set: Row) => {
      const hit = conversations.filter((c) => matchesWhere(c, where));
      hit.forEach((c) => Object.assign(c, set));
      return { affected: hit.length };
    }),
  };
}

// ---- a full EmbedService over in-memory stores ------------------------------------------

import { EmbedService } from './embed.service';

export const TENANT_SECRET = 'shtk_testsecret';
export const OTHER_TENANT_SECRET = 'shtk_other_tenant_secret';

export interface HarnessOpts {
  secret?: string | null;
  identityPolicy?: unknown;
  /** Session rows to start with (a guest session `tok` is created when omitted). */
  sessions?: Row[];
  withAudit?: boolean;
  withIssue?: boolean;
  withBus?: boolean;
}

export function guestSessionRow(over: Row = {}): Row {
  return {
    id: 5,
    sessionToken: 'tok',
    tenantId: 4,
    channel: null,
    landingPath: 'https://hotel-admin.example/login',
    aiAgentId: 9,
    language: 'VI',
    languageLocked: 1,
    consentState: 'granted',
    consentAt: new Date('2026-10-01T09:00:00.000Z'),
    consentVersion: '2026-07',
    customerId: null,
    identityLevel: 'guest',
    identityClaims: null,
    alias: null,
    autoReplyMode: 'inherit',
    openCount: 0,
    firstOpenedAt: null,
    ...over,
  };
}

/** The real EmbedService with in-memory repositories, a SET NX Redis and spies for every side effect. */
export function buildEmbedHarness(opts: HarnessOpts = {}) {
  const tenant: Row = {
    id: 4,
    embedSecret: opts.secret === undefined ? TENANT_SECRET : opts.secret,
    identityPolicy: opts.identityPolicy ?? null,
  };
  const sessions: Row[] = opts.sessions ?? [guestSessionRow()];
  const customers: Row[] = [];
  const conversations: Row[] = [];
  let nextSessionId = Math.max(...sessions.map((s) => Number(s.id)), 0) + 1;

  const tenantRepo = {
    findOne: jest.fn(async () => tenant),
    update: jest.fn(async (_w: Row, set: Row) => {
      Object.assign(tenant, set);
      return { affected: 1 };
    }),
  };
  const customerRepo = {
    findOne: jest.fn(
      async ({ where }: { where: { externalCustomerId: string } }) =>
        customers.find((c) => c.externalCustomerId === where.externalCustomerId) ?? null,
    ),
    create: (v: Row) => ({ ...v }),
    save: jest.fn(async (c: Row) => {
      if (!c.id) {
        c.id = 100 + customers.length;
        customers.push(c);
      }
      return c;
    }),
    update: jest.fn(async ({ id }: { id: number }, set: Row) => {
      Object.assign(customers.find((c) => c.id === id) as Row, set);
      return { affected: 1 };
    }),
  };
  const sessionRepo = {
    findOne: jest.fn(
      async ({ where }: { where: { sessionToken: string } }) =>
        sessions.find((s) => s.sessionToken === where.sessionToken) ?? null,
    ),
    create: jest.fn((v: Row) => ({ ...v })),
    save: jest.fn(async (s: Row) => {
      if (!s.id) {
        s.id = nextSessionId++;
        sessions.push(s);
      }
      return s;
    }),
    update: jest.fn(async ({ id }: { id: number }, set: Row) => {
      Object.assign(sessions.find((s) => s.id === id) as Row, set);
      return { affected: 1 };
    }),
  };
  const convRepo = fakeConvRepo(conversations);
  const redis = fakeRedis();
  const audit = { write: jest.fn(async (_p: Row) => ({})) };
  const issue = { onConversationEnded: jest.fn(async () => undefined) };
  const bus = { publish: jest.fn(async () => undefined) };

  const service = new EmbedService(
    tenantRepo as never,
    customerRepo as never,
    sessionRepo as never,
    redis as never,
    convRepo as never,
    opts.withAudit === false ? undefined : (audit as never),
    opts.withIssue === false ? undefined : (issue as never),
    opts.withBus === false ? undefined : (bus as never),
  );
  return { service, tenant, sessions, customers, conversations, tenantRepo, customerRepo, sessionRepo, convRepo, redis, audit, issue, bus };
}

/** A correctly signed v2 identify body. `iat` defaults to now. */
export function signedV2(
  secret: string,
  token: string,
  user: string,
  over: { hotelSn?: string; role?: 'manager' | 'receptionist' | 'internal'; iat?: number; province?: string } = {},
) {
  const iat = over.iat ?? Math.floor(Date.now() / 1000);
  const hotelSn = over.hotelSn ?? '1721';
  const role = over.role ?? 'receptionist';
  return {
    sessionToken: token,
    userId: user,
    hash: EmbedService.signV2(secret, user, hotelSn, role, iat, over.province),
    claims: { hotelSn, role, iat, hotelName: 'A In Hotel Del Luna', hotelCode: 'HCM_001_001721', province: over.province },
  };
}

/** A correctly signed v1 identify body (user id only). */
export function signedV1(secret: string, token: string, user: string) {
  return { sessionToken: token, userId: user, hash: EmbedService.sign(secret, user) };
}
