import { ThreadService } from './thread.service';

function repo(overrides: Record<string, unknown> = {}): never {
  return { findOne: jest.fn(async () => null), find: jest.fn(async () => []), count: jest.fn(async () => 0), ...overrides } as never;
}
const aiConfig = (thread?: object) => ({ getHandoffConfig: jest.fn(async () => (thread ? { thread } : null)) }) as never;
const tenantOn = () => repo({ findOne: jest.fn(async () => ({ id: 4, threadContinuity: 1 })) });
const tenantOff = () => repo({ findOne: jest.fn(async () => ({ id: 4, threadContinuity: 0 })) });

/** Account threads (PLN-261022 stage 2). */
describe('ThreadService', () => {
  it('accountOf: company when known, else customer, guest → null', () => {
    expect(ThreadService.accountOf({ customerId: '5' as never, companyId: '3' as never })).toEqual({ companyId: 3, customerId: 5 });
    expect(ThreadService.accountOf({ customerId: 5, companyId: null })).toEqual({ companyId: null, customerId: 5 });
    expect(ThreadService.accountOf({ customerId: null, companyId: null })).toBeNull();
  });

  it('previousOf scopes by company (B2B) or customer', async () => {
    const findOne = jest.fn(async () => ({ id: '40' }));
    const svc = new ThreadService(repo({ findOne }), repo(), tenantOn(), repo(), aiConfig());
    await svc.previousOf(4, { companyId: 3, customerId: 5 });
    expect(findOne).toHaveBeenLastCalledWith({ where: { tenantId: 4, companyId: 3 }, order: { id: 'DESC' } });
    await svc.previousOf(4, { companyId: null, customerId: 5 });
    expect(findOne).toHaveBeenLastCalledWith({ where: { tenantId: 4, customerId: 5 }, order: { id: 'DESC' } });
  });

  describe('stickyAgent', () => {
    const conv = { id: 50, prevConversationId: 40 } as never;
    const prevEnded = (hoursAgo: number, agentId: number | null = 7) =>
      repo({ findOne: jest.fn(async () => ({ id: '40', agentId, endedAt: new Date(Date.now() - hoursAgo * 3600_000), createdAt: new Date() })) });
    const activeAgent = repo({ findOne: jest.fn(async () => ({ id: '7', status: 'active' })) });

    it('prefers the previous agent inside the window', async () => {
      const svc = new ThreadService(prevEnded(3), repo(), tenantOn(), activeAgent, aiConfig({ stickyHours: 24 }));
      await expect(svc.stickyAgent(4, conv)).resolves.toBe(7);
    });

    it('not after the window, not for a suspended agent, not when the tenant is off', async () => {
      await expect(new ThreadService(prevEnded(30), repo(), tenantOn(), activeAgent, aiConfig()).stickyAgent(4, conv)).resolves.toBeNull();
      const suspended = repo({ findOne: jest.fn(async () => ({ id: '7', status: 'suspended' })) });
      await expect(new ThreadService(prevEnded(1), repo(), tenantOn(), suspended, aiConfig()).stickyAgent(4, conv)).resolves.toBeNull();
      await expect(new ThreadService(prevEnded(1), repo(), tenantOff(), activeAgent, aiConfig()).stickyAgent(4, conv)).resolves.toBeNull();
      await expect(
        new ThreadService(prevEnded(1), repo(), tenantOn(), activeAgent, aiConfig({ stickyHours: 0 })).stickyAgent(4, conv),
      ).resolves.toBeNull();
    });
  });

  describe('listForWidget', () => {
    const session = { tenantId: 4, customerId: 5, companyId: 3 } as never;
    const rows = [
      { id: '30', customerId: 5, companyId: 3, status: 'ended', createdAt: new Date(), endedAt: new Date() },
      { id: '20', customerId: 5, companyId: 3, status: 'ended', createdAt: new Date(), endedAt: null },
    ];

    it("scope 'self': own conversations, colleagues counted only", async () => {
      const find = jest.fn(async () => rows);
      const count = jest.fn(async () => 2);
      const msgFind = jest.fn(async () => [{ id: '1', conversationId: 30, senderType: 'user', body: 'hi' }]);
      const svc = new ThreadService(repo({ find, count }), repo({ find: msgFind }), tenantOn(), repo(), aiConfig({ scope: 'self' }));
      const page = await svc.listForWidget(session, 60, 1);
      expect((find.mock.calls[0] as unknown[])[0]).toMatchObject({ where: { tenantId: 4, companyId: 3, customerId: 5 }, take: 2 });
      expect(page.hasMore).toBe(true);
      expect(page.conversations).toHaveLength(1);
      expect(page.conversations[0]).toMatchObject({ own: true, messages: [{ body: 'hi' }] });
      expect(page.colleagueCount).toBe(2);
    });

    it("scope 'company': every conversation of the company, no colleague count", async () => {
      const find = jest.fn(async () => [{ ...rows[0], customerId: 6 }]);
      const svc = new ThreadService(repo({ find }), repo(), tenantOn(), repo(), aiConfig({ scope: 'company' }));
      const page = await svc.listForWidget(session, null, 3);
      expect((find.mock.calls[0] as unknown[])[0]).toMatchObject({ where: { tenantId: 4, companyId: 3 } });
      expect(page.conversations[0].own).toBe(false);
      expect(page.colleagueCount).toBe(0);
    });

    it('a guest has no thread', async () => {
      const svc = new ThreadService(repo(), repo(), tenantOn(), repo(), aiConfig());
      await expect(svc.listForWidget({ tenantId: 4, customerId: null, companyId: null } as never, null, 3)).resolves.toEqual({
        conversations: [],
        hasMore: false,
        colleagueCount: 0,
      });
    });
  });

  describe('previousExcerpt', () => {
    const conv = { id: 50, prevConversationId: 40 } as never;
    it('formats the last turns, scrubs a phone number the customer typed, dates the excerpt', async () => {
      const prev = { id: '40', createdAt: new Date('2026-10-20T03:00:00Z') };
      const msgs = [
        { senderType: 'ai', body: 'Kiểm tra trong mục Đối soát.' },
        { senderType: 'user', body: 'Gọi tôi 0901234567 về đối soát' },
      ];
      const svc = new ThreadService(repo({ findOne: jest.fn(async () => prev) }), repo({ find: jest.fn(async () => msgs) }), tenantOn(), repo(), aiConfig());
      const text = await svc.previousExcerpt(4, conv);
      expect(text).toContain('(2026-10-20)');
      expect(text).toContain('Customer: ');
      expect(text).toContain('Support: Kiểm tra');
      expect(text).not.toContain('0901234567');
    });

    it('nothing when the tenant is off, the conversation has no predecessor, or it is too old', async () => {
      await expect(new ThreadService(repo(), repo(), tenantOff(), repo(), aiConfig()).previousExcerpt(4, conv)).resolves.toBeUndefined();
      await expect(
        new ThreadService(repo(), repo(), tenantOn(), repo(), aiConfig()).previousExcerpt(4, { id: 50, prevConversationId: null } as never),
      ).resolves.toBeUndefined();
      const old = repo({ findOne: jest.fn(async () => ({ id: '40', createdAt: new Date(Date.now() - 40 * 86400_000) })) });
      await expect(new ThreadService(old, repo(), tenantOn(), repo(), aiConfig()).previousExcerpt(4, conv)).resolves.toBeUndefined();
    });
  });
});
