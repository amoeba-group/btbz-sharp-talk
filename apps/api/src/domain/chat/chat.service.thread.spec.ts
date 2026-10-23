import { ChatService } from './chat.service';
import { Session } from '../session/entity/session.entity';

/**
 * Account threads in the chat pipeline (PLN-261022 stage 2): a new conversation
 * records its account and links the account's previous one; a handoff of that
 * new conversation prefers the previous agent (sticky) when routing allows.
 */
describe('ChatService — account threads', () => {
  function build(opts: {
    open?: object | null;
    previous?: object | null;
    sticky?: number | null;
    route?: { mode: 'agents' | 'email'; targetUserIds: number[]; ruleName?: string };
  }) {
    const save = jest.fn(async (x: object) => ({ id: '77', ...x }));
    const convFindOne = jest.fn(async (q: { where: { id?: number } }) =>
      q.where.id != null ? { id: q.where.id, sessionId: 5, prevConversationId: 40 } : (opts.open ?? null),
    );
    const publish = jest.fn();
    const threads = {
      previousOf: jest.fn(async () => opts.previous ?? null),
      stickyAgent: jest.fn(async () => opts.sticky ?? null),
    };
    const svc = new ChatService(
      { findOne: convFindOne, create: (x: object) => x, save, update: jest.fn() } as never,
      { findOne: jest.fn(async () => ({ body: 'help' })) } as never, // Message repo
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        route: jest.fn(async () => opts.route ?? { mode: 'agents', targetUserIds: [] }),
        needsCustomerTier: jest.fn(async () => false),
      } as never,
      { publish } as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      threads as never,
    );
    return { svc, save, publish, threads };
  }
  const b2b = { id: 5, tenantId: 4, customerId: 9, companyId: 3, language: 'VI', identityLevel: 'verified' } as unknown as Session;

  it('a new conversation carries the account and links the previous one', async () => {
    const { svc, save, threads } = build({ previous: { id: '40' } });
    await svc.getOrCreateConversation(5, b2b);
    expect(threads.previousOf).toHaveBeenCalledWith(4, { companyId: 3, customerId: 9 });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 4, customerId: 9, companyId: 3, prevConversationId: 40 }),
    );
  });

  it('a claimed user (unsigned host, P7) links its own previous conversation, still with no customer', async () => {
    process.env.EMBED_UNSIGNED_IDENTIFY_TENANT_IDS = '4';
    try {
      const { svc, save, threads } = build({ previous: { id: '41' } });
      const claimed = { id: 5, tenantId: 4, customerId: null, companyId: null, identityLevel: 'claimed', identityAttributes: { user_id: 'ha:8818' } };
      await svc.getOrCreateConversation(5, claimed as unknown as Session);
      expect(threads.previousOf).toHaveBeenCalledWith(4, { companyId: null, customerId: null, claimedUserId: 'ha:8818' });
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ customerId: null, companyId: null, prevConversationId: 41 }));
    } finally {
      delete process.env.EMBED_UNSIGNED_IDENTIFY_TENANT_IDS;
    }
  });

  it('a claimed user is not linked once its tenant leaves the unsigned list', async () => {
    const { svc, save, threads } = build({ previous: { id: '41' } });
    const claimed = { id: 5, tenantId: 4, customerId: null, companyId: null, identityLevel: 'claimed', identityAttributes: { user_id: 'ha:8818' } };
    await svc.getOrCreateConversation(5, claimed as unknown as Session);
    expect(threads.previousOf).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ prevConversationId: null }));
  });

  it('a guest conversation has no account and no link', async () => {
    const { svc, save, threads } = build({});
    await svc.getOrCreateConversation(5, { id: 5, tenantId: 4, customerId: null, companyId: null } as unknown as Session);
    expect(threads.previousOf).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ customerId: null, companyId: null, prevConversationId: null }));
  });

  it('an open conversation is reused untouched', async () => {
    const open = { id: '60', status: 'ai_active' };
    const { svc, save } = build({ open });
    await expect(svc.getOrCreateConversation(5, b2b)).resolves.toBe(open);
    expect(save).not.toHaveBeenCalled();
  });

  it('escalate: the previous agent is preferred when routing would page them', async () => {
    const { svc, publish } = build({ sticky: 7, route: { mode: 'agents', targetUserIds: [7, 8], ruleName: 'cs' } });
    await svc.escalate(b2b, 77);
    expect(publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ targetUserIds: [7], assignMode: 'least_loaded', ruleName: 'cs (sticky)' }),
    );
  });

  it('escalate: not when the rule picked other people', async () => {
    const { svc, publish } = build({ sticky: 7, route: { mode: 'agents', targetUserIds: [8], ruleName: 'cs' } });
    await svc.escalate(b2b, 77);
    expect(publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ targetUserIds: [8], ruleName: 'cs' }));
  });

  it('escalate: a broadcast route narrows to the previous agent; no sticky agent leaves it alone', async () => {
    const a = build({ sticky: 7, route: { mode: 'agents', targetUserIds: [] } });
    await a.svc.escalate(b2b, 77);
    expect(a.publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ targetUserIds: [7] }));
    const b = build({ sticky: null, route: { mode: 'agents', targetUserIds: [] } });
    await b.svc.escalate(b2b, 77);
    expect(b.publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ targetUserIds: [] }));
  });
});
