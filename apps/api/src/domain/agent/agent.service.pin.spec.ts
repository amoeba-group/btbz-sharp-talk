import { AgentService } from './agent.service';
import { Conversation } from '../chat/entity/conversation.entity';

/**
 * Queue pinning, on-demand message translation, and message-level issue
 * filing (PLN-260826). Ids in fixtures are strings where TypeORM returns
 * strings at runtime (bigint PKs) — numeric fixtures have hidden real bugs
 * before.
 */
describe('AgentService — pin / translate / message issue (PLN-260826)', () => {
  function build(
    opts: {
      pinnedAt?: Date | null;
      activePins?: number;
      message?: Record<string, unknown> | null;
      cached?: string | null;
      aiText?: string;
      aiError?: boolean;
    } = {},
  ) {
    const conversation = {
      id: '5',
      tenantId: 1,
      sessionId: '90',
      status: 'waiting',
      pinnedAt: opts.pinnedAt ?? null,
      pinnedBy: null,
    } as unknown as Conversation;
    const convRepo = {
      findOne: jest.fn(async (q: { where: { id: number; tenantId: number } }) =>
        Number(q.where.id) === 5 && q.where.tenantId === 1 ? conversation : null,
      ),
      count: jest.fn(async () => opts.activePins ?? 0),
      save: jest.fn(async (c: Conversation) => c),
    };
    const message =
      opts.message !== undefined
        ? opts.message
        : { id: '77', conversationId: '5', tenantId: 1, senderType: 'user', body: '배송이 언제 오나요?' };
    const msgRepo = {
      findOne: jest.fn(async (q: { where: Record<string, unknown> }) =>
        q.where.tenantId === 1 ? message : null,
      ),
    };
    const redis = {
      del: jest.fn(async () => undefined),
      get: jest.fn(async () => opts.cached ?? null),
      set: jest.fn(async () => undefined),
      available: () => true,
    };
    const audit = { write: jest.fn(async () => undefined) };
    const aiGateway = {
      complete: jest.fn(async () => {
        if (opts.aiError) throw new Error('provider down');
        return { text: opts.aiText ?? 'When will my delivery arrive?' };
      }),
    };
    const issueService = {
      createManual: jest.fn(async () => ({ issue: { id: '30', issueNo: 12 }, appended: true })),
    };

    const svc = new AgentService(
      convRepo as never,
      msgRepo as never,
      {} as never, // userRepo
      {} as never, // sessionRepo
      {} as never, // profileRepo
      {} as never, // assignmentRepo
      {} as never, // statRepo
      {} as never, // moderation
      {} as never, // customerService
      aiGateway as never,
      audit as never,
      redis as never,
      {} as never, // sessionService
      {} as never, // bus
      {} as never, // mailer
      undefined, // answerReuse
      issueService as never,
      undefined, // aiConfigRepo
      undefined, // threadRepo
      undefined, // channelRepo
      undefined, // draftRepo
      undefined, // attachments
      undefined, // aiAgentRepo
    );
    return { svc, convRepo, msgRepo, redis, audit, aiGateway, issueService, conversation };
  }

  // ── R1 pin ────────────────────────────────────────────────────────────────

  it('pins: stamps pinned_at/by, saves, audits', async () => {
    const h = build({ activePins: 2 });

    const result = await h.svc.setConversationPin(5, 1, 7, true);

    expect(h.conversation.pinnedAt).toBeInstanceOf(Date);
    expect(h.conversation.pinnedBy).toBe(7);
    expect(h.convRepo.save).toHaveBeenCalled();
    expect(result.pinned).toBe(true);
    expect(h.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent.conversation.pin' }),
    );
  });

  it('refuses the fourth pin with E5060 — never evicts a colleague pin', async () => {
    const h = build({ activePins: 3 });

    await expect(h.svc.setConversationPin(5, 1, 7, true)).rejects.toMatchObject({
      errorCode: 'E5060',
    });
    expect(h.convRepo.save).not.toHaveBeenCalled();
  });

  it('re-pinning an already-pinned row is a no-op (does not count against the limit)', async () => {
    const pinnedAt = new Date('2026-08-26T00:00:00Z');
    const h = build({ pinnedAt, activePins: 3 });

    const result = await h.svc.setConversationPin(5, 1, 7, true);

    expect(result.pinned).toBe(true);
    expect(h.conversation.pinnedAt).toBe(pinnedAt);
    expect(h.convRepo.count).not.toHaveBeenCalled();
  });

  it('unpin always succeeds and clears both columns', async () => {
    const h = build({ pinnedAt: new Date(), activePins: 3 });

    const result = await h.svc.setConversationPin(5, 1, 7, false);

    expect(result.pinned).toBe(false);
    expect(h.conversation.pinnedAt).toBeNull();
    expect(h.conversation.pinnedBy).toBeNull();
  });

  it('pin is tenant-fenced — foreign conversation not found', async () => {
    const h = build();

    await expect(h.svc.setConversationPin(5, 2, 7, true)).rejects.toThrow();
  });

  // ── R2 translate ──────────────────────────────────────────────────────────

  it('rejects a language outside the system six', async () => {
    const h = build();

    await expect(h.svc.translateMessage(77, 1, 'fr')).rejects.toMatchObject({
      errorCode: 'E5003',
    });
    expect(h.aiGateway.complete).not.toHaveBeenCalled();
  });

  it('translate is tenant-fenced — foreign message not found', async () => {
    const h = build();

    await expect(h.svc.translateMessage(77, 2, 'ko')).rejects.toMatchObject({
      errorCode: 'E5002',
    });
  });

  it('cache hit returns without an LLM call', async () => {
    const h = build({ cached: '캐시된 번역' });

    const result = await h.svc.translateMessage(77, 1, 'KO');

    expect(result).toEqual({ messageId: 77, lang: 'ko', text: '캐시된 번역' });
    expect(h.aiGateway.complete).not.toHaveBeenCalled();
  });

  it('cache miss translates via the gateway and caches for 24h', async () => {
    const h = build();

    const result = await h.svc.translateMessage(77, 1, 'en');

    expect(result.text).toBe('When will my delivery arrive?');
    expect(h.aiGateway.complete).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 1, feature: 'agent_translate' }),
    );
    expect(h.redis.set).toHaveBeenCalledWith('msgtr:77:en', result.text, 24 * 3600);
  });

  it('customer and reply turns get their own prompt (PLN-261023)', async () => {
    const h = build();
    await h.svc.translateMessage(77, 1, 'en');
    expect(h.aiGateway.complete).toHaveBeenCalledWith(
      expect.objectContaining({ system: expect.stringContaining('customer message') }),
    );

    for (const senderType of ['agent', 'ai']) {
      const r = build({
        message: { id: '78', conversationId: '5', tenantId: 1, senderType, body: '- 2개 남았어요' },
      });
      await r.svc.translateMessage(78, 1, 'vi');
      expect(r.aiGateway.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'agent_translate',
          system: expect.stringContaining('support reply'),
        }),
      );
      expect(r.redis.set).toHaveBeenCalledWith('msgtr:78:vi', expect.any(String), 24 * 3600);
    }
  });

  it('system notices are not translatable', async () => {
    const h = build({
      message: { id: '79', conversationId: '5', tenantId: 1, senderType: 'system', body: '상담원 연결' },
    });

    await expect(h.svc.translateMessage(79, 1, 'en')).rejects.toMatchObject({
      errorCode: 'E5003',
    });
    expect(h.aiGateway.complete).not.toHaveBeenCalled();
  });

  it('gateway failure or empty output → E5055 (502), nothing cached', async () => {
    const h = build({ aiError: true });

    await expect(h.svc.translateMessage(77, 1, 'en')).rejects.toMatchObject({
      errorCode: 'E5055',
    });
    expect(h.redis.set).not.toHaveBeenCalled();

    const h2 = build({ aiText: '   ' });
    await expect(h2.svc.translateMessage(77, 1, 'en')).rejects.toMatchObject({
      errorCode: 'E5055',
    });
  });

  // ── R5 message-level issue ────────────────────────────────────────────────

  it('files with excerpt+memo in the note; memo clamped to 300', async () => {
    const h = build({
      message: { id: '77', conversationId: '5', tenantId: 1, body: '  환불해  주세요  ' },
    });

    const result = await h.svc.fileIssue(5, 1, 7, 'refund', {
      messageId: 77,
      memo: 'x'.repeat(400),
    });

    expect(h.issueService.createManual).toHaveBeenCalledWith(1, 5, 90, 'refund', 7, {
      note: `[고객] "환불해 주세요"\n${'x'.repeat(300)}`,
    });
    expect(result.appended).toBe(true);
  });

  it('excerpt is clamped to 120 chars of whitespace-collapsed body', async () => {
    const h = build({ message: { id: '77', conversationId: '5', tenantId: 1, body: 'a'.repeat(500) } });

    await h.svc.fileIssue(5, 1, 7, 'other', { messageId: 77 });

    const note = ((h.issueService.createManual as jest.Mock).mock.calls[0][5] as { note: string })
      .note;
    expect(note).toBe(`[고객] "${'a'.repeat(120)}"`);
  });

  it("refuses a message that is not this conversation's", async () => {
    const h = build({ message: null });

    await expect(h.svc.fileIssue(5, 1, 7, 'other', { messageId: 999 })).rejects.toMatchObject({
      errorCode: 'E5002',
    });
    expect(h.issueService.createManual).not.toHaveBeenCalled();
  });
});
