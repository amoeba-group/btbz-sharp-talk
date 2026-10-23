import { AgentService } from './agent.service';
import { ChatGroupService } from './chat-group.service';
import { likePattern, matchSnippet, searchTerm } from './message-search.util';
import { SessionService } from '../session/session.service';
import { ThreadService } from '../chat/thread.service';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { maskIp } from '../../global/util/pii-display.util';
import { runWithRequestContext, trustedClientIp } from '../../global/middleware/request-context.middleware';

/**
 * PLN-261023 — live-chat transcript search (S1), visitor IP (S2), one
 * conversation number/name in group rooms (S3), claimed HA users filed under
 * their customer and hotel (S4). Ids are STRINGS where TypeORM returns a
 * BIGINT PK — numeric fixtures have hidden real bugs before.
 */

describe('message search helpers (S1)', () => {
  it('takes LIKE wildcards in the term literally', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });

  it('refuses a term shorter than two characters after trimming', () => {
    expect(searchTerm(' a ')).toBeNull();
    expect(searchTerm(undefined)).toBeNull();
    expect(searchTerm('  hoàn ')).toBe('hoàn');
  });

  it('cuts an excerpt around the match, found without case or accents like the collation', () => {
    const body = `${'x'.repeat(60)} Tôi muốn HOÀN tiền đặt phòng ${'y'.repeat(60)}`;
    const snippet = matchSnippet(body, 'hoan tien', 10);
    expect(snippet).toBe('… Tôi muốn HOÀN tiền đặt phòng…');
  });

  it('falls back to the start of the message when the term is not located', () => {
    expect(matchSnippet('short text', 'zzz')).toBe('short text');
  });
});

describe('visitor address (S2)', () => {
  it("reads X-Forwarded-For from the right — a browser-sent first hop is not the visitor's", () => {
    // browser sent "6.6.6.6"; host nginx appended the real client; stack nginx appended the host.
    expect(trustedClientIp('6.6.6.6, 203.0.113.45, 172.18.0.1', '172.18.0.5')).toBe('203.0.113.45');
  });

  it('takes the leftmost entry of a shorter chain, and the socket without a header', () => {
    expect(trustedClientIp('203.0.113.45', '10.0.0.1')).toBe('203.0.113.45');
    expect(trustedClientIp(undefined, '::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(trustedClientIp(undefined, undefined)).toBeNull();
  });

  it('masks the host part of v4 and v6 addresses', () => {
    expect(maskIp('203.0.113.45')).toBe('203.0.113.***');
    expect(maskIp('2001:db8:85a3:0:0:8a2e:370:7334')).toBe('2001:db8:85a3:0:***');
    expect(maskIp('garbage')).toBe('***');
    expect(maskIp(null)).toBeNull();
  });

  describe('SessionService.ensure records it', () => {
    function build(session: Record<string, unknown> | null) {
      const updates: Array<Record<string, unknown>> = [];
      const sessionRepo = {
        findOne: jest.fn(async () => session),
        update: jest.fn(async (_w: unknown, patch: Record<string, unknown>) => {
          updates.push(patch);
          return { affected: 1 };
        }),
        create: jest.fn((v: Record<string, unknown>) => v),
        save: jest.fn(async (v: Record<string, unknown>) => ({ id: '41', ...v })),
      };
      const tenantRepo = { findOne: jest.fn(async () => ({ id: 4, timezone: 'Asia/Ho_Chi_Minh' })) };
      const svc = new SessionService(
        sessionRepo as never,
        tenantRepo as never,
        {} as never,
        { publish: jest.fn() } as never,
        { available: () => true, get: jest.fn(), set: jest.fn(), del: jest.fn() } as never,
      );
      return { svc, updates, sessionRepo };
    }
    const withIp = <T>(ip: string, fn: () => Promise<T>) =>
      runWithRequestContext({ requestId: 'r', ip }, fn);

    it('stamps first and last on a new session', async () => {
      const h = build(null);
      jest.spyOn(h.svc as never, 'resolveTenant' as never).mockResolvedValue({ id: 4 } as never);
      jest.spyOn(h.svc as never, 'assertEmbedOriginAllowed' as never).mockReturnValue(undefined as never);
      jest.spyOn(h.svc as never, 'assertWidgetAccessAllowed' as never).mockReturnValue(undefined as never);
      await withIp('203.0.113.45', () => h.svc.ensure(undefined, 'vi', 'shop'));
      expect(h.sessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ firstIp: '203.0.113.45', lastIp: '203.0.113.45', lastIpAt: expect.any(Date) }),
      );
    });

    it('does not write again for the same address within the hour', async () => {
      const h = build({ id: '41', sessionToken: 't', tenantId: 4, firstIp: '203.0.113.45', lastIp: '203.0.113.45', lastIpAt: new Date() });
      await withIp('203.0.113.45', () => h.svc.ensure('t', 'vi'));
      expect(h.updates).toEqual([]);
    });

    it('moves only the last address when the visitor moved', async () => {
      const h = build({ id: '41', sessionToken: 't', tenantId: 4, firstIp: '203.0.113.45', lastIp: '203.0.113.45', lastIpAt: new Date() });
      await withIp('198.51.100.7', () => h.svc.ensure('t', 'vi'));
      expect(h.updates).toEqual([{ lastIp: '198.51.100.7', lastIpAt: expect.any(Date) }]);
    });

    it('fills the first address on a session from before addresses were kept', async () => {
      const h = build({ id: '41', sessionToken: 't', tenantId: 4, firstIp: null, lastIp: null, lastIpAt: null });
      await withIp('203.0.113.45', () => h.svc.ensure('t', 'vi'));
      expect(h.updates).toEqual([{ lastIp: '203.0.113.45', lastIpAt: expect.any(Date), firstIp: '203.0.113.45' }]);
    });
  });
});

describe('AgentService — search, visitor IP, claimed customer panel', () => {
  function build(opts: { conversation?: Record<string, unknown> | null; session?: Record<string, unknown> | null; matches?: unknown[] } = {}) {
    const conversation =
      opts.conversation === undefined ? { id: '887', tenantId: 4, sessionId: '20796', customerId: null } : opts.conversation;
    const convRepo = {
      findOne: jest.fn(async (q: { where: { id: number; tenantId: number } }) =>
        conversation && Number(q.where.id) === Number(conversation.id) && q.where.tenantId === conversation.tenantId
          ? conversation
          : null,
      ),
    };
    const qb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(async () => [opts.matches ?? [], (opts.matches ?? []).length]),
    };
    const msgRepo = { createQueryBuilder: jest.fn(() => qb) };
    const sessionRepo = { findOne: jest.fn(async () => opts.session ?? null) };
    const customerService = {
      getContext: jest.fn(async (_t: number, id: number) => ({
        id,
        name: 'ADMIN123',
        email: null,
        phone: null,
        tier: 'guest',
        recentOrders: [],
      })),
    };
    const audit = { write: jest.fn(async () => undefined) };
    const svc = new AgentService(
      convRepo as never,
      msgRepo as never,
      {} as never,
      sessionRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      customerService as never,
      {} as never,
      audit as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { svc, qb, audit, sessionRepo, customerService };
  }

  it('refuses a one-character in-room search with E5103', async () => {
    await expect(build().svc.searchMessages(887, 4, 'a')).rejects.toMatchObject({
      errorCode: ERROR_CODE.SEARCH_TERM_TOO_SHORT.code,
    });
  });

  it("does not search another tenant's conversation", async () => {
    await expect(build().svc.searchMessages(887, 5, 'hoàn')).rejects.toMatchObject({
      errorCode: ERROR_CODE.RESOURCE_NOT_FOUND.code,
    });
  });

  it('scopes the scan to the tenant and room, escapes the term, and returns oldest first', async () => {
    const h = build({
      matches: [
        { id: '30', senderType: 'user', body: 'second 100% sure', createdAt: new Date() },
        { id: '10', senderType: 'ai', body: 'first 100% answer', createdAt: new Date() },
      ],
    });
    const res = await h.svc.searchMessages(887, 4, '100%');
    expect(h.qb.where).toHaveBeenCalledWith(expect.stringContaining('m.tenant_id = :tenantId'), {
      tenantId: 4,
      conversationId: 887,
      pattern: '%100\\%%',
    });
    expect(res.total).toBe(2);
    expect(res.items.map((i) => i.id)).toEqual(['10', '30']);
  });

  it('shows the address masked, and whether the visitor moved', async () => {
    const h = build({ session: { id: '20796', firstIp: '203.0.113.45', lastIp: '198.51.100.7', lastIpAt: new Date() } });
    await expect(h.svc.visitorIp(20796)).resolves.toMatchObject({ masked: '198.51.100.***', changed: true });
    await expect(build({ session: { id: '1', lastIp: null } }).svc.visitorIp(1)).resolves.toBeNull();
  });

  it('reveals the address with one audit row that does not hold it', async () => {
    const h = build({ session: { id: '20796', firstIp: '203.0.113.45', lastIp: '203.0.113.45', lastIpAt: null } });
    await expect(h.svc.revealVisitorIp(887, 4, 21)).resolves.toMatchObject({ lastIp: '203.0.113.45' });
    expect(h.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'session.ip_revealed', target: 'session:20796', actorId: 21 }),
    );
    expect(JSON.stringify(h.audit.write.mock.calls)).not.toContain('203.0.113');
  });

  it('shows the customer a claimed conversation is filed under, flagged unverified (S4)', async () => {
    const h = build({
      conversation: { id: '887', tenantId: 4, sessionId: '20796', customerId: '100' },
      session: { id: '20796', customerId: null },
    });
    await expect(h.svc.customerContext(887, 4)).resolves.toMatchObject({ id: 100, unverified: true, masked: true });
  });

  it('keeps the session customer as the verified one', async () => {
    const h = build({
      conversation: { id: '887', tenantId: 4, sessionId: '20796', customerId: '100' },
      session: { id: '20796', customerId: 9 },
    });
    const ctx = await h.svc.customerContext(887, 4);
    expect(ctx).toMatchObject({ id: 9 });
    expect(ctx).not.toHaveProperty('unverified');
  });
});

describe('ChatGroupService.detail — one number and name per member (S3)', () => {
  it('gives each member its conversation number, company and host-given names', async () => {
    const svc = new ChatGroupService(
      { findOne: jest.fn(async () => ({ id: 50, tenantId: 4, kind: 'project', title: 'HCM' })) } as never,
      { find: jest.fn(async () => [{ id: 1, sessionId: '20796' }]) } as never,
      {
        find: jest.fn(async () => [
          {
            id: '20796',
            customerId: null,
            companyId: null,
            alias: null,
            identityAttributes: { name: 'ADMIN123', hotel_name: 'Lá Hotel Quận 10' },
          },
        ]),
      } as never,
      {
        find: jest.fn(async () => [
          { id: '887', sessionId: '20796', status: 'waiting', channel: 'widget', customerId: '100', companyId: '4' },
          { id: '883', sessionId: '20796', status: 'ended', channel: 'widget', customerId: null, companyId: null },
        ]),
      } as never,
      {} as never,
      { find: jest.fn(async () => [{ id: '100', name: 'ADMIN123' }]) } as never,
      {} as never,
    );
    const { members } = await svc.detail(50, 4);
    expect(members[0]).toMatchObject({
      sessionId: 20796,
      targetConversationId: 887,
      customerName: 'ADMIN123',
      companyId: 4,
      identityName: 'ADMIN123',
      identityHotelName: 'Lá Hotel Quận 10',
    });
  });
});

describe('ThreadService.claimedAttribution (S4)', () => {
  const claimed = { identityLevel: 'claimed', identityAttributes: { user_id: 'laquan10', hotel_id: '4118' } };
  const svc = (customer: unknown, company: unknown) =>
    new ThreadService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { findOne: jest.fn(async () => customer) } as never,
      { findOne: jest.fn(async () => company) } as never,
    );

  it("finds the claimed user's customer row and the hotel's company", async () => {
    await expect(svc({ id: '100' }, { id: '4' }).claimedAttribution(4, claimed as never)).resolves.toEqual({
      customerId: 100,
      companyId: 4,
    });
  });

  it('is null for a session that is not claimed, or when nothing is on record', async () => {
    await expect(svc({ id: '100' }, null).claimedAttribution(4, { identityLevel: 'verified' } as never)).resolves.toBeNull();
    await expect(svc(null, null).claimedAttribution(4, claimed as never)).resolves.toBeNull();
  });
});
