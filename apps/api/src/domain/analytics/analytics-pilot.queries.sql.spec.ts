import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';
import { Session } from '../session/entity/session.entity';
import { ModerationLog } from '../moderation/entity/moderation-log.entity';
import { PartnerLookupLog } from '../partner-data/entity/partner-lookup-log.entity';
import { AgentAlert } from '../agent/entity/agent-alert.entity';
import { TenantPilotHotel } from '../pilot/entity/tenant-pilot-hotel.entity';
import { AnalyticsPilotQueries } from './analytics-pilot.queries';
import { AnalyticsPilotService } from './analytics-pilot.service';

/**
 * REAL SQL against a real MySQL 8 (PLN-261012 SG-52) — the JSON functions, GROUP BYs, collation and
 * driver value types that no mock can vouch for. Opt-in, because it needs a database:
 *
 *   ANALYTICS_PILOT_SQL_TEST=1 PILOT_SQL_TEST_DB=scratch_w2b DB_HOST=127.0.0.1 DB_PORT=3316 \
 *   DB_USER=sharptalk DB_PASSWORD=... npx jest src/domain/analytics/analytics-pilot.queries.sql.spec.ts
 *
 * It creates the seven tables it needs in `PILOT_SQL_TEST_DB` with `synchronize` and DROPS ALL OF THEM
 * first — point it ONLY at a scratch database, never at a shared one. Without the env var the suite is
 * skipped, so the default `jest` run needs no database.
 *
 * `ANALYTICS_PILOT_SQL_PERF=1` additionally seeds a large volume and prints timings and EXPLAIN plans
 * (the evidence for whether sql/261018-analytics-pilot-indexes.sql is needed).
 */
const enabled = process.env.ANALYTICS_PILOT_SQL_TEST === '1';
const perfEnabled = process.env.ANALYTICS_PILOT_SQL_PERF === '1';
const d = enabled ? describe : describe.skip;

const OURS = 7;
const OTHER = 8;
const T0 = '2026-10-01 00:00:00';
const T1 = '2026-10-14 00:00:00';

/** Records every statement the real queries run, for EXPLAIN. */
class SpyQueries extends AnalyticsPilotQueries {
  captured: Array<{ sql: string; params: unknown[]; ms: number }> = [];
  protected override async run<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
    const t = process.hrtime.bigint();
    try {
      return await super.run<T>(sql, params);
    } finally {
      this.captured.push({ sql, params, ms: Number((process.hrtime.bigint() - t) / 1_000n) / 1000 });
    }
  }
}

d('pilot analytics — real SQL on MySQL 8', () => {
  let ds: DataSource;
  const entities = [Conversation, Message, Session, ModerationLog, PartnerLookupLog, AgentAlert, TenantPilotHotel];

  const q = (sql: string, params: unknown[] = []) => ds.query(sql, params);
  /** A JSON literal bound as a parameter; null stays SQL NULL. */
  const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));

  let sessionSeq = 0;
  async function session(tenantId: number, customerId: number | null, channel: string | null = null): Promise<number> {
    sessionSeq += 1;
    const r = await q(
      `INSERT INTO sessions (session_token, tenant_id, channel, customer_id, language, ai_agent_id)
       VALUES (?, ?, ?, ?, 'VI', 3)`,
      [`tok-${sessionSeq}-${Math.random()}`, tenantId, channel, customerId],
    );
    return Number(r.insertId);
  }

  async function conversation(c: {
    tenantId: number; sessionId: number; createdAt: string; hotelSn?: string | null; role?: string | null;
    escalated?: number; agentId?: number | null; csat?: number | null; status?: string;
  }): Promise<number> {
    const r = await q(
      `INSERT INTO conversations (tenant_id, session_id, channel, status, escalated, agent_id, hotel_sn, actor_role, ai_agent_id, csat_rating, created_at)
       VALUES (?, ?, 'widget', ?, ?, ?, ?, ?, 3, ?, ?)`,
      [c.tenantId, c.sessionId, c.status ?? 'ai_active', c.escalated ?? 0, c.agentId ?? null, c.hotelSn ?? null, c.role ?? null, c.csat ?? null, c.createdAt],
    );
    return Number(r.insertId);
  }

  async function message(conversationId: number, tenantId: number, senderType: string, body: string, trace: unknown | null | 'RAW_JSON_NULL') {
    const traceSql = trace === 'RAW_JSON_NULL' ? "CAST('null' AS JSON)" : '?';
    const params: unknown[] = [tenantId, conversationId, senderType, body];
    if (trace !== 'RAW_JSON_NULL') params.push(json(trace));
    await q(
      `INSERT INTO messages (tenant_id, conversation_id, sender_type, body, lang, retrieval_trace)
       VALUES (?, ?, ?, ?, 'VI', ${traceSql})`,
      params,
    );
  }

  beforeAll(async () => {
    const database = process.env.PILOT_SQL_TEST_DB;
    if (!database || !/scratch/i.test(database)) {
      throw new Error('PILOT_SQL_TEST_DB must name a scratch database (the suite drops its tables)');
    }
    ds = new DataSource({
      type: 'mysql',
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 3306),
      username: process.env.DB_USER ?? 'sharptalk',
      password: process.env.DB_PASSWORD ?? '',
      database,
      charset: 'utf8mb4',
      timezone: 'Z',
      synchronize: false,
      entities,
    });
    await ds.initialize();
    // KEEP=1 re-uses the volume dataset of an earlier run AS IS (indexes included: a synchronize would
    // drop any index the entities do not declare, which is exactly what is being trialled).
    if (process.env.ANALYTICS_PILOT_SQL_PERF_KEEP !== '1') {
      await ds.dropDatabase().catch(() => undefined); // scratch only (guarded above)
      await ds.synchronize();
    }
  }, 120_000);

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  // ---- correctness ------------------------------------------------------------------------

  describe('hand-built dataset (exact numbers)', () => {
    let ids: Record<string, number>;
    const tenantRepo = { findOne: async () => ({ id: OURS, timezone: 'Asia/Ho_Chi_Minh', pilotAccess: { enabled: true } }) };
    let queries: SpyQueries;
    let svc: AnalyticsPilotService;

    beforeAll(async () => {
      const sCust1 = await session(OURS, 501);
      const sCust1b = await session(OURS, 501);
      const sCust2 = await session(OURS, 502);
      const sGuest = await session(OURS, null);
      const sPreview = await session(OURS, null, 'preview');
      const sOther = await session(OTHER, 900);

      ids = {};
      // c1 — hotel 1721 manager: the AI answered, rated 5, with a full latency trace.
      ids.c1 = await conversation({ tenantId: OURS, sessionId: sCust1, createdAt: '2026-10-05 03:00:00', hotelSn: '1721', role: 'manager', csat: 5 });
      await message(ids.c1, OURS, 'user', 'Hoa hồng bao nhiêu?', null);
      await message(ids.c1, OURS, 'ai', 'Hoa hồng là 15%.', { confidence: 0.8, citations: [{ id: 1 }], latencyMs: { total: 1500, classify: 200, retrieve: 100, generate: 900, moderate: 50 } });
      // c2 — hotel 1721 receptionist: low-confidence hand-off, an agent replied, an alert and a blocked answer exist.
      ids.c2 = await conversation({ tenantId: OURS, sessionId: sCust1b, createdAt: '2026-10-05 04:00:00', hotelSn: '1721', role: 'receptionist', escalated: 1, agentId: 41, status: 'agent' });
      await message(ids.c2, OURS, 'user', 'Đối soát?', null);
      await message(ids.c2, OURS, 'system', 'Chuyển nhân viên', { reason: 'low_confidence', agentId: 3 });
      await message(ids.c2, OURS, 'agent', 'Em chào anh', null);
      await q(`INSERT INTO agent_alerts (tenant_id, conversation_id, reason, status) VALUES (?, ?, 'low_confidence', 'acked')`, [OURS, ids.c2]);
      await q(`INSERT INTO moderation_logs (tenant_id, conversation_id, author_type, action, decision) VALUES (?, ?, 'ai', 'block', 'blocked')`, [OURS, ids.c2]);
      // c3 — hotel 2204 manager: partner data; one answer without a citation; partner lookups; an edited answer.
      ids.c3 = await conversation({ tenantId: OURS, sessionId: sCust2, createdAt: '2026-10-06 05:00:00', hotelSn: '2204', role: 'manager' });
      await message(ids.c3, OURS, 'user', 'Giá qua đêm?', null);
      await message(ids.c3, OURS, 'ai', 'Giá là 480.000 ₫', { confidence: 0.6, citations: [], answeredFrom: 'partner_data', latencyMs: { total: 3000, classify: 100, retrieve: null, generate: 2500, moderate: 80 } });
      await message(ids.c3, OURS, 'system', 'Chỉ dành cho quản lý', { reason: 'partner_role_denied', partnerError: 'E5101', agentId: 3 });
      for (const [topic, status] of [['rates', 'ok'], ['rates', 'ok'], ['settlement', 'denied'], ['rates,bookings', 'unverified'], ['policies', 'error']]) {
        await q(`INSERT INTO partner_lookup_logs (tenant_id, conversation_id, topic, status) VALUES (?, ?, ?, ?)`, [OURS, ids.c3, topic, status]);
      }
      await q(`INSERT INTO moderation_logs (tenant_id, conversation_id, author_type, action, decision) VALUES (?, ?, 'ai', 'mask', 'edited'), (?, ?, 'ai', 'pass', 'delivered')`, [OURS, ids.c3, OURS, ids.c1]);
      // c4 — legacy guest: no stamps, NULL traces, a trace with no confidence, a guest-gate prompt.
      ids.c4 = await conversation({ tenantId: OURS, sessionId: sGuest, createdAt: '2026-10-07 06:00:00' });
      await message(ids.c4, OURS, 'user', 'Xin chào', null);
      await message(ids.c4, OURS, 'ai', 'Chào bạn', { answeredFrom: 'no_knowledge', nonQuestionKind: 'smalltalk' });
      await message(ids.c4, OURS, 'system', 'Vui lòng đăng nhập', { reason: 'guest_gate', agentId: 1 });
      await message(ids.c4, OURS, 'system', 'Vui lòng đăng nhập', { reason: 'guest_gate', agentId: 1 });
      await message(ids.c4, OURS, 'system', 'old notice', null);
      // c5 — admin preview sandbox: must not exist for the report.
      ids.c5 = await conversation({ tenantId: OURS, sessionId: sPreview, createdAt: '2026-10-07 07:00:00', hotelSn: '1721', role: 'manager' });
      await message(ids.c5, OURS, 'ai', 'preview answer', { confidence: 0.99, citations: [{ id: 1 }] });
      // c6 — outside the window.
      ids.c6 = await conversation({ tenantId: OURS, sessionId: sCust1, createdAt: '2026-09-01 07:00:00', hotelSn: '1721', role: 'manager' });
      // c7 — ANOTHER tenant, inside the window: must never appear.
      ids.c7 = await conversation({ tenantId: OTHER, sessionId: sOther, createdAt: '2026-10-05 07:00:00', hotelSn: '1721', role: 'manager', escalated: 1 });
      await message(ids.c7, OTHER, 'ai', 'other tenant', { confidence: 0.9, citations: [{ id: 1 }] });
      await q(`INSERT INTO moderation_logs (tenant_id, conversation_id, author_type, action, decision) VALUES (?, ?, 'ai', 'block', 'blocked')`, [OTHER, ids.c7]);
      // c8 — legacy escalation: no stored reason on the notice, only the alert knows (old escalation word).
      ids.c8 = await conversation({ tenantId: OURS, sessionId: sCust1, createdAt: '2026-10-08 08:00:00', hotelSn: '2204', role: 'receptionist', escalated: 1 });
      await message(ids.c8, OURS, 'user', 'x', null);
      await message(ids.c8, OURS, 'system', 'Chuyển nhân viên', null);
      await q(`INSERT INTO agent_alerts (tenant_id, conversation_id, reason, status) VALUES (?, ?, 'moderation_blocked', 'new')`, [OURS, ids.c8]);
      // c9 — hostile / odd JSON: a string confidence, a JSON null literal, an array, a scalar, a bad reason type.
      ids.c9 = await conversation({ tenantId: OURS, sessionId: sCust2, createdAt: '2026-10-09 09:00:00', hotelSn: '2204', role: 'manager' });
      await message(ids.c9, OURS, 'ai', 'a', { confidence: '0.9', citations: 'x', latencyMs: null });
      await message(ids.c9, OURS, 'ai', 'b', 'RAW_JSON_NULL');
      await message(ids.c9, OURS, 'ai', 'c', [1, 2, 3]);
      await message(ids.c9, OURS, 'ai', 'd', 'just a string');
      await message(ids.c9, OURS, 'system', 'e', { reason: 12345 });
      await message(ids.c9, OURS, 'system', 'f', { reason: ['guest_gate'] });
      await message(ids.c9, OURS, 'ai', 'g', { latencyMs: { total: 'fast' } });
      // the pilot list: 1721, 2204 and a hotel that never chatted
      await q(`INSERT INTO tenant_pilot_hotels (tenant_id, hotel_sn, active) VALUES (?, '1721', 1), (?, '2204', 1), (?, '3099', 1), (?, '4000', 0)`, [OURS, OURS, OURS, OURS]);
      await q(`INSERT INTO tenant_pilot_hotels (tenant_id, hotel_sn, active) VALUES (?, '5555', 1)`, [OTHER]);

      queries = new SpyQueries(ds.getRepository(Conversation));
      svc = new AnalyticsPilotService(queries, tenantRepo as never, ds.getRepository(TenantPilotHotel));
    }, 120_000);

    const WINDOW = { from: '2026-10-01', to: '2026-10-13' };
    const NOW = new Date('2026-10-14T00:00:00Z');

    it('by hotel: exact counts, definitions applied to real rows', async () => {
      const r = await svc.report(OURS, { group: 'hotel', ...WINDOW }, NOW);
      const by = Object.fromEntries(r.rows.map((x) => [x.key, x]));

      // c5 (preview), c6 (outside window), c7 (other tenant) are nowhere
      expect(Object.keys(by).sort()).toEqual(['1721', '2204', 'unknown']);
      expect(r.totals.conversations).toBe(6); // c1 c2 c3 c4 c8 c9

      // 1721: c1 (AI only, csat 5) + c2 (hand-off low_confidence)
      expect(by['1721']).toMatchObject({
        conversations: 2, aiOnlyResolved: 1, handedOff: 1, refused: 0, noAnswer: 0,
        handoffReasons: { low_confidence: 1 },
        answers: 1, noSourceAnswers: 0, avgConfidence: 0.8, noSourceRate: 0,
        moderation: { blocked: 1, edited: 0 }, // c1's DELIVERED row is not counted; c7's blocked row (other tenant) is not either
        csat: { rated: 1, avg: 5 },
        distinctUsers: 1, anonymousSessions: 0, // customer 501 in both
      });
      expect(by['1721'].latency.total).toMatchObject({ count: 1, p50: 1500 });

      // 2204: c3 (AI answered, no source, partner refusal), c8 (legacy escalation), c9 (odd JSON)
      expect(by['2204']).toMatchObject({
        conversations: 3, aiOnlyResolved: 1, handedOff: 1, noAnswer: 1,
        // c3's grounded answer is the ONLY numeric confidence; c9's string "0.9" is not one.
        answers: 1, noSourceAnswers: 1, avgConfidence: 0.6, noSourceRate: 1,
        refusals: { partner_role_denied: 1 },
        moderation: { blocked: 0, edited: 1 },
        distinctUsers: 2, // 502 (c3, c9) and 501 (c8)
      });
      // the legacy escalation took its reason from the alert, mapped to the closed vocabulary
      expect(by['2204'].handoffReasons).toEqual({ moderation: 1 });
      expect(by['2204'].partner).toEqual({
        lookups: 5, ok: 2, denied: 1, rejected: 0, unavailable: 1, unverified: 1,
        // 'rates,bookings' on the unverified row is two topics: rates 2 (ok x2) + 1, bookings 1
        topics: { rates: 3, settlement: 1, bookings: 1, policies: 1 },
      });
      expect(by['2204'].latency.total).toMatchObject({ count: 1, p50: 3000 });
      expect(by['2204'].latency.retrieve.count).toBe(0); // c3's retrieve is null: not a 0 ms retrieval
      expect(by['2204'].latency.generate).toMatchObject({ count: 1, p50: 2500 });

      // legacy: no stamps -> the unknown group, guest gate counted per turn, no crash on NULL traces
      expect(by['unknown']).toMatchObject({
        unknown: true, conversations: 1, refused: 1, aiOnlyResolved: 0,
        refusals: { guest_gate: 2 }, guestGatePrompts: 2, answers: 0, avgConfidence: null,
        anonymousSessions: 1, distinctUsers: 0,
      });
    });

    it('by role and by day (tenant timezone)', async () => {
      const role = await svc.report(OURS, { group: 'role', ...WINDOW }, NOW);
      expect(Object.fromEntries(role.rows.map((x) => [x.key, x.conversations]))).toEqual({ manager: 3, receptionist: 2, unknown: 1 });
      const day = await svc.report(OURS, { group: 'day', ...WINDOW }, NOW);
      // 2026-10-05 03:00Z and 04:00Z are 10:00 / 11:00 in Ho Chi Minh; c3 05:00Z on the 6th; c4 06:00Z on the 7th ...
      expect(day.rows.map((x) => [x.key, x.conversations])).toEqual([
        ['2026-10-05', 2], ['2026-10-06', 1], ['2026-10-07', 1], ['2026-10-08', 1], ['2026-10-09', 1],
      ]);
      expect(day.timezone).toBe('Asia/Ho_Chi_Minh');
    });

    it('totals partition the conversations, in every grouping', async () => {
      for (const group of ['hotel', 'role', 'day']) {
        const r = await svc.report(OURS, { group, ...WINDOW }, NOW);
        for (const x of [...r.rows, r.totals]) expect(x.aiOnlyResolved + x.handedOff + x.refused + x.noAnswer).toBe(x.conversations);
        expect(r.rows.reduce((n, x) => n + x.conversations, 0)).toBe(r.totals.conversations);
      }
    });

    it('adoption against the ACTIVE pilot list of THIS tenant: 3099 never chatted; the paused hotel and the other tenant\'s list do not count', async () => {
      const r = await svc.report(OURS, { group: 'hotel', ...WINDOW }, NOW);
      expect(r.adoption).toMatchObject({
        pilotEnabled: true, listed: 3, listedActive: 2, listedSilent: 1, silentHotels: ['3099'], hotelsActive: 2, offListActive: 0,
      });
    });

    it('a hotel / role filter narrows the report to the stamped conversations', async () => {
      const r = await svc.report(OURS, { group: 'hotel', hotelSn: '2204', ...WINDOW }, NOW);
      expect(r.totals.conversations).toBe(3);
      expect(r.rows.map((x) => x.key)).toEqual(['2204']);
    });

    it('the export: one row per conversation, scrubbed transcripts, correct outcomes, nothing from other tenants', async () => {
      const plan = await svc.prepareExport(OURS, WINDOW, NOW);
      expect(plan.rows.map((x) => x.id).sort((a, b) => a - b)).toEqual([ids.c1, ids.c2, ids.c3, ids.c4, ids.c8, ids.c9]);
      let text = '';
      for await (const part of svc.exportChunks(OURS, plan)) text += part;
      const lines = text.slice(1).split('\r\n').filter(Boolean);
      expect(lines).toHaveLength(1 + 6);
      expect(text).not.toContain('other tenant');
      expect(text).not.toContain('preview answer');
      expect(text).toContain(`${ids.c2},2026-10-05T04:00:00.000Z,1721,receptionist,3,VI,handoff,low_confidence`);
      expect(text).toContain('SYSTEM [guest_gate]: Vui lòng đăng nhập');
      expect(text).toContain('AI [0.80]: Hoa hồng là 15%.');
    });

    it('JSON of every shape never fails the statements (null literal, array, scalar, wrong types)', async () => {
      // c9 above holds them all; the report succeeded and counted c9 as a conversation with no usable trace data.
      const r = await svc.report(OURS, { group: 'hotel', hotelSn: '2204', role: 'manager', ...WINDOW }, NOW);
      expect(r.totals.conversations).toBe(2); // c3 + c9
    });

    it('every statement is parameterised: no tenant / id / filter value is concatenated into the SQL text', async () => {
      queries.captured.length = 0;
      await svc.report(OURS, { group: 'hotel', hotelSn: '2204', ...WINDOW }, NOW);
      expect(queries.captured.length).toBeGreaterThan(5);
      for (const { sql } of queries.captured) {
        expect(sql).not.toMatch(/tenant_id = \d/);
        expect(sql).not.toMatch(/IN \(\d/);
        expect(sql).not.toContain('2204');
        await qr.query(
        `INSERT INTO partner_lookup_logs (tenant_id, conversation_id, hotel_sn, actor_role, topic, status, created_at)
         SELECT c.tenant_id, c.id, c.hotel_sn, c.actor_role, ELT(c.id % 4 + 1, 'rates', 'bookings', 'policies', 'settlement'), ELT(c.id % 5 + 1, 'ok', 'ok', 'denied', 'error', 'unverified'), c.created_at
           FROM conversations c WHERE c.id % 20 = 0`,
      );
      await qr.query(
        `INSERT INTO agent_alerts (tenant_id, conversation_id, reason, status, created_at)
         SELECT c.tenant_id, c.id, ELT(c.id % 3 + 1, 'low_confidence', 'user_request', 'moderation_blocked'), 'acked', c.created_at
           FROM conversations c WHERE c.escalated = 1`,
      );
    }
      // a hostile filter is just a value: it matches nothing and breaks nothing
      const r = await svc.report(OURS, { group: 'hotel', hotelSn: "1721' OR 1=1 -- ", ...WINDOW }, NOW);
      expect(r.totals.conversations).toBe(0);
    });
  });

  // ---- volume / EXPLAIN ----------------------------------------------------------------------

  const p = perfEnabled ? it : it.skip;
  p('volume: timings and EXPLAIN on a seeded dataset', async () => {
    const N = Number(process.env.ANALYTICS_PILOT_SQL_PERF_ROWS ?? 100_000);
    const keep = process.env.ANALYTICS_PILOT_SQL_PERF_KEEP === '1';
    const existing = keep ? Number((await q('SELECT COUNT(*) AS n FROM conversations'))[0].n) : 0;
    const qr = ds.createQueryRunner();
    const t0 = Date.now();
    if (!(keep && existing > 0)) {
      await qr.query('SET SESSION cte_max_recursion_depth = 5000000');
      await qr.query('TRUNCATE TABLE messages');
      await qr.query('TRUNCATE TABLE conversations');
      await qr.query('TRUNCATE TABLE sessions');
      await qr.query('TRUNCATE TABLE moderation_logs');
      await qr.query('TRUNCATE TABLE partner_lookup_logs');
      await qr.query('TRUNCATE TABLE agent_alerts');
      const seqCte = `WITH RECURSIVE seq (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${N * 2})`;
      await qr.query(
        `INSERT INTO sessions (session_token, tenant_id, channel, customer_id, language, ai_agent_id, created_at)
         ${seqCte}
         SELECT CONCAT('perf-', n), IF(n % 2 = 0, ?, ?), NULL, IF(n % 3 = 0, NULL, n % 900 + 1), 'VI', 3,
                TIMESTAMP(DATE_SUB('2026-10-14 00:00:00', INTERVAL (n DIV 2 % 180) DAY), SEC_TO_TIME(n DIV 2 % 86400))
           FROM seq`,
        [OURS, OTHER],
      );
      await qr.query(
        `INSERT INTO conversations (id, tenant_id, session_id, channel, status, escalated, agent_id, hotel_sn, actor_role, ai_agent_id, csat_rating, created_at)
         SELECT s.id, s.tenant_id, s.id, 'widget', IF(s.id % 7 = 0, 'agent', 'ended'), IF(s.id % 7 = 0, 1, 0), IF(s.id % 7 = 0, 41, NULL),
                IF(s.id % 20 = 0, NULL, CONCAT('H', 1000 + s.id % 60)), ELT(s.id % 3 + 1, 'manager', 'receptionist', 'internal'), 3,
                IF(s.id % 9 = 0, 1 + s.id % 5, NULL), s.created_at
           FROM sessions s`,
      );
      await qr.query(
        `INSERT INTO messages (tenant_id, conversation_id, sender_type, body, lang, retrieval_trace, created_at)
         SELECT c.tenant_id, c.id, 'user', 'Hoa hồng bao nhiêu?', 'VI', NULL, c.created_at FROM conversations c
         UNION ALL
         SELECT c.tenant_id, c.id, 'ai', 'Hoa hồng hiện tại là 15%.', 'VI',
                JSON_OBJECT('confidence', 0.4 + (c.id % 60) / 100, 'citations', IF(c.id % 11 = 0, JSON_ARRAY(), JSON_ARRAY(JSON_OBJECT('id', 1))),
                            'latencyMs', JSON_OBJECT('total', 800 + c.id % 4000, 'classify', 200, 'retrieve', 100 + c.id % 300, 'generate', 500 + c.id % 3000, 'moderate', 50)),
                c.created_at FROM conversations c
         UNION ALL
         SELECT c.tenant_id, c.id, 'system', 'notice', 'VI',
                JSON_OBJECT('reason', ELT(c.id % 4 + 1, 'guest_gate', 'low_confidence', 'user_request', 'partner_role_denied'), 'agentId', 3), c.created_at
           FROM conversations c WHERE c.id % 4 = 0
         UNION ALL
         SELECT c.tenant_id, c.id, 'agent', 'Em chào anh', 'VI', NULL, c.created_at FROM conversations c WHERE c.escalated = 1`,
      );
      await qr.query(
        `INSERT INTO moderation_logs (tenant_id, conversation_id, author_type, action, decision, created_at)
         SELECT c.tenant_id, c.id, 'ai', IF(c.id % 13 = 0, 'mask', 'pass'), IF(c.id % 13 = 0, 'edited', 'delivered'), c.created_at FROM conversations c`,
      );
      await qr.release();
    }
    const seedMs = Date.now() - t0;

    const counts = await q('SELECT (SELECT COUNT(*) FROM conversations) AS convs, (SELECT COUNT(*) FROM messages) AS msgs, (SELECT COUNT(*) FROM moderation_logs) AS mods');
    const queries = new SpyQueries(ds.getRepository(Conversation));
    const svc = new AnalyticsPilotService(queries, { findOne: async () => ({ id: OURS, timezone: 'Asia/Ho_Chi_Minh', pilotAccess: null }) } as never, ds.getRepository(TenantPilotHotel));
    const NOW = new Date('2026-10-14T00:00:00Z');

    const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const s = process.hrtime.bigint();
      const out = await fn();
      // eslint-disable-next-line no-console
      console.log(`[perf] ${label}: ${Number((process.hrtime.bigint() - s) / 1_000_000n)} ms`);
      return out;
    };

    // eslint-disable-next-line no-console
    console.log(`[perf] seeded ${JSON.stringify(counts[0])} in ${seedMs} ms`);
    const r14 = await timed('report hotel, 14 days', () => svc.report(OURS, { group: 'hotel', from: '2026-09-30', to: '2026-10-13' }, NOW));
    // eslint-disable-next-line no-console
    console.log(`[perf]   scanned ${r14.scanned} conversations, ${r14.rows.length} rows, truncated=${r14.truncated}`);
    await timed('report role, 14 days', () => svc.report(OURS, { group: 'role', from: '2026-09-30', to: '2026-10-13' }, NOW));
    await timed('report day, 14 days', () => svc.report(OURS, { group: 'day', from: '2026-09-30', to: '2026-10-13' }, NOW));
    queries.captured.length = 0;
    const r92 = await timed('report hotel, 92 days (the maximum)', () => svc.report(OURS, { group: 'hotel', from: '2026-07-14', to: '2026-10-13' }, NOW));
    // eslint-disable-next-line no-console
    console.log(`[perf]   scanned ${r92.scanned} conversations, truncated=${r92.truncated}`);

    // CSV: the capped export, consumed page by page
    const plan = await svc.prepareExport(OURS, { from: '2026-07-14', to: '2026-10-13' }, NOW);
    let bytes = 0;
    let maxPart = 0;
    await timed(`export CSV (${plan.rows.length} rows, truncated=${plan.truncated})`, async () => {
      for await (const part of svc.exportChunks(OURS, plan)) {
        bytes += part.length;
        maxPart = Math.max(maxPart, part.length);
      }
    });
    // eslint-disable-next-line no-console
    console.log(`[perf]   export ${bytes} chars total, largest single chunk ${maxPart} chars`);

    // Where the time went: per statement kind over the 92-day report
    const byKind = new Map<string, { n: number; total: number; max: number }>();
    for (const { sql, ms } of queries.captured) {
      const kind = sql.replace(/\s+/g, ' ').slice(0, 60);
      const e = byKind.get(kind) ?? { n: 0, total: 0, max: 0 };
      e.n += 1;
      e.total += ms;
      e.max = Math.max(e.max, ms);
      byKind.set(kind, e);
    }
    for (const [kind, e] of byKind) {
      // eslint-disable-next-line no-console
      console.log(`[perf-by-statement] ${kind} -> x${e.n} total ${Math.round(e.total)} ms, max ${Math.round(e.max)} ms`);
    }

    // EXPLAIN of the statements the 92-day report ran (one representative chunk per kind)
    const seen = new Set<string>();
    for (const { sql, params } of queries.captured) {
      const kind = sql.replace(/\s+/g, ' ').slice(0, 60);
      if (seen.has(kind)) continue;
      seen.add(kind);
      const plan2 = (await q(`EXPLAIN ${sql}`, params.map((v) => (Array.isArray(v) ? v.slice(0, 1000) : v)))) as Array<Record<string, unknown>>;
      // eslint-disable-next-line no-console
      console.log(`[explain] ${kind}\n${plan2.map((x) => `    table=${x.table} type=${x.type} key=${x.key} rows=${x.rows} extra=${x.Extra}`).join('\n')}`);
    }
    expect(r14.totals.conversations).toBeGreaterThan(0);
  }, 900_000);
});
