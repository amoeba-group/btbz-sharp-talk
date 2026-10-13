import { AgentService } from './agent.service';

/**
 * A human agent's reply and the reuse store (PLN-261012 SG-06, REQ D-06).
 *
 * The store is keyed by tenant, language and agent only. A reply to a signed hotel user is
 * about THAT hotel — its rates, its settlement, a one-off exception — and would replay to the
 * next hotel asking the same words; a reply to a manager may quote what a receptionist must
 * not read. So: nothing is stored for a signed hotel conversation, and what IS stored carries
 * the audience rank of the conversation (the store itself also closes to human replies while
 * the tenant has a manager-only category — answer-reuse-audience.spec.ts).
 */
describe('AgentService.ingestReplyForReuse', () => {
  const build = (opts: {
    session: Record<string, unknown> | null;
    conversation?: Record<string, unknown> | null;
  }) => {
    const recordAgentAnswer = jest.fn(async () => undefined);
    const svc = Object.create(AgentService.prototype) as AgentService;
    Object.assign(svc, {
      logger: { debug: jest.fn(), warn: jest.fn(), log: jest.fn() },
      answerReuse: { recordAgentAnswer },
      msgRepo: { findOne: jest.fn(async () => ({ id: 3, body: 'Khi nào đối soát xong?', lang: 'VI' })) },
      convRepo: { findOne: jest.fn(async () => (opts.conversation === undefined ? { id: 77, sessionId: 5, hotelSn: null } : opts.conversation)) },
      sessionRepo: { findOne: jest.fn(async () => opts.session) },
      aiAgentRepo: { findOne: jest.fn(async () => ({ id: 10 })) },
    });
    const ingest = () =>
      (svc as unknown as { ingestReplyForReuse: (c: number, t: number, r: unknown) => Promise<void> }).ingestReplyForReuse(77, 1, {
        id: 9,
        body: 'Đối soát xong vào ngày 5 hằng tháng.',
      });
    return { ingest, recordAgentAnswer };
  };

  const guest = { id: 5, aiAgentId: null, identityLevel: 'guest', identityClaims: null, customerId: null };
  const v1 = { id: 5, aiAgentId: null, identityLevel: 'verified', identityClaims: null, customerId: 100 };
  const signed = (role: string, ageMs = 0) => ({
    id: 5,
    aiAgentId: null,
    identityLevel: 'verified',
    customerId: 100,
    identityClaims: { hotelSn: '1721', role, signed: true, verifiedAt: new Date(Date.now() - ageMs).toISOString() },
  });

  it.each(['receptionist', 'manager', 'internal'])('a reply to a signed %s is NOT stored (it is about one hotel)', async (role) => {
    const { ingest, recordAgentAnswer } = build({ session: signed(role) });

    await ingest();

    expect(recordAgentAnswer).not.toHaveBeenCalled();
  });

  it('…even after the claims lapsed: the earlier turns are no less about that hotel', async () => {
    const { ingest, recordAgentAnswer } = build({ session: signed('receptionist', 9 * 3_600_000) });

    await ingest();

    expect(recordAgentAnswer).not.toHaveBeenCalled();
  });

  it('a conversation stamped with a hotel is not stored either (the session row may be gone)', async () => {
    const { ingest, recordAgentAnswer } = build({ session: null, conversation: { id: 77, sessionId: 5, hotelSn: '1721' } });

    await ingest();

    expect(recordAgentAnswer).not.toHaveBeenCalled();
  });

  it('a reply to a guest is stored with rank 0', async () => {
    const { ingest, recordAgentAnswer } = build({ session: guest });

    await ingest();

    expect(recordAgentAnswer).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 1, audienceRank: 0, aiAgentId: 10 }));
  });

  it('a reply to a v1-verified user (no claims, no hotel) is stored with rank 1', async () => {
    const { ingest, recordAgentAnswer } = build({ session: v1 });

    await ingest();

    expect(recordAgentAnswer).toHaveBeenCalledWith(expect.objectContaining({ audienceRank: 1 }));
  });

  it('with no readable session the audience is unknown: stored at the HIGHEST rank (fail closed)', async () => {
    const { ingest, recordAgentAnswer } = build({ session: null });

    await ingest();

    expect(recordAgentAnswer).toHaveBeenCalledWith(expect.objectContaining({ audienceRank: 2 }));
  });
});
