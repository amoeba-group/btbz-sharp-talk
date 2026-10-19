import { CONVERSATION_STATUS } from '@sharptalk/types';
import { ChatService } from './chat.service';
import { Session } from '../session/entity/session.entity';

const HOUR = 3_600_000;

/**
 * A rating is written by an anonymous widget caller, so every guard here is
 * about who may score what, and when.
 */
describe('ChatService.rate', () => {
  const session = { id: 9, tenantId: 1 } as Session;

  function build(conversation: Record<string, unknown> | null) {
    const updates: any[] = [];
    const convRepo = {
      findOne: jest.fn(async () => conversation),
      update: jest.fn(async (where: unknown, patch: unknown) => void updates.push({ where, patch })),
      createQueryBuilder: () => ({
        select: () => ({
          addSelect: () => ({
            where: () => ({
              andWhere: () => ({
                andWhere: () => ({
                  andWhere: () => ({ getRawOne: async () => ({ avg: '4', rated: '2' }) }),
                }),
              }),
            }),
          }),
        }),
      }),
    };
    const msgRepo = { findOne: jest.fn(async () => ({ senderId: 5 })) };
    const statRepo = {
      findOne: jest.fn(async () => null),
      create: (r: any) => r,
      save: jest.fn(async (r: any) => r),
    };
    const repos = Array.from({ length: 20 }, () => ({}) as never);
    const svc = new ChatService(
      convRepo as never,
      msgRepo as never,
      ...(repos.slice(0, 11) as never[]),
    ) as ChatService;
    // The constructor is long and positional; inject what this path touches.
    Object.assign(svc as unknown as Record<string, unknown>, {
      convRepo,
      msgRepo,
      statRepo,
      logger: { log: jest.fn(), warn: jest.fn() },
    });
    return { svc, updates, statRepo };
  }

  const ended = (over: Record<string, unknown> = {}) => ({
    id: 42,
    sessionId: 9,
    tenantId: 1,
    agentId: 5,
    status: CONVERSATION_STATUS.ENDED,
    endedAt: new Date(Date.now() - HOUR),
    csatRating: null,
    ...over,
  });

  it('stores the rating with the time it was given', async () => {
    const { svc, updates } = build(ended());

    await expect(svc.rate(session, 42, 4)).resolves.toEqual({ rating: 4 });

    expect(updates[0].patch.csatRating).toBe(4);
    expect(updates[0].patch.csatRatedAt).toBeInstanceOf(Date);
  });

  it('stores survey answers; a reason only for an unhappy rating; "other" text PII-masked (PLN-261019)', async () => {
    const { svc, updates } = build(ended());
    await svc.rate(session, 42, 2, { resolved: false, reason: 'other', comment: 'call me 0908754789 pls' });
    expect(updates[0].patch).toMatchObject({ csatRating: 2, csatResolved: 0, csatReason: 'other' });
    expect(String(updates[0].patch.csatComment)).not.toContain('8754789');

    const happy = build(ended());
    await happy.svc.rate(session, 42, 5, { resolved: true, reason: 'slow', comment: 'x' });
    // A reason makes no sense for a happy rating; the comment belongs to "other" only.
    expect(happy.updates[0].patch).toMatchObject({ csatResolved: 1, csatReason: null, csatComment: null });

    const plain = build(ended());
    await plain.svc.rate(session, 42, 4);
    expect(plain.updates[0].patch).toMatchObject({ csatResolved: null, csatReason: null, csatComment: null });
  });

  it('overwrites an earlier rating — a misclick must be correctable', async () => {
    const { svc, updates } = build(ended({ csatRating: 1 }));

    await svc.rate(session, 42, 5);

    expect(updates[0].patch.csatRating).toBe(5);
  });

  it("refuses another session's conversation", async () => {
    const { svc, updates } = build(ended({ sessionId: 999 }));

    await expect(svc.rate(session, 42, 5)).rejects.toThrow();
    expect(updates).toHaveLength(0);
  });

  it('refuses a conversation that is still running', async () => {
    const { svc, updates } = build(ended({ status: CONVERSATION_STATUS.AGENT, endedAt: null }));

    await expect(svc.rate(session, 42, 5)).rejects.toThrow();
    expect(updates).toHaveLength(0);
  });

  it('refuses once the 24-hour window has closed', async () => {
    const { svc, updates } = build(ended({ endedAt: new Date(Date.now() - 25 * HOUR) }));

    await expect(svc.rate(session, 42, 5)).rejects.toThrow();
    expect(updates).toHaveLength(0);
  });

  it.each([0, 6, 2.5])('refuses %s as a star count', async (rating) => {
    const { svc, updates } = build(ended());

    await expect(svc.rate(session, 42, rating as number)).rejects.toThrow();
    expect(updates).toHaveLength(0);
  });

  it('folds the score into the agent daily row that never had one', async () => {
    // agent_daily_stats.csat_avg has existed since the console was built and
    // nothing wrote it; this is the first writer.
    const { svc, statRepo } = build(ended());

    await svc.rate(session, 42, 4);
    await new Promise((r) => setImmediate(r));

    expect(statRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 5, csatAvg: 4 }),
    );
  });
});
