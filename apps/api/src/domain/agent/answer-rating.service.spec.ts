import { AnswerRatingService } from './answer-rating.service';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import type { AnswerRating } from './entity/answer-rating.entity';

/**
 * Answer accuracy ratings (PLN-261015 D7): one verdict per (message, rater),
 * tenant-fenced, only on AI/agent answers, and a non-accurate AI verdict turns
 * into a knowledge-gap proposal.
 */
function build() {
  const conversations = [{ id: 900, tenantId: 4 }];
  const messages = [
    { id: 1, conversationId: 900, senderType: 'user', body: 'Q' },
    { id: 2, conversationId: 900, senderType: 'ai', body: 'A' },
    { id: 3, conversationId: 900, senderType: 'agent', body: 'H' },
  ];
  const rows: AnswerRating[] = [];
  const ratingRepo = {
    findOne: jest.fn(async ({ where }: { where: Partial<AnswerRating> }) =>
      rows.find((r) => r.tenantId === where.tenantId && r.messageId === where.messageId && r.ratedBy === where.ratedBy) ?? null,
    ),
    create: (v: Partial<AnswerRating>) => ({ ...v }) as AnswerRating,
    save: jest.fn(async (r: AnswerRating) => {
      if (!rows.includes(r)) rows.push(r);
      return r;
    }),
    find: jest.fn(async () => rows),
  };
  const convRepo = {
    findOne: jest.fn(async ({ where }: { where: { id: number; tenantId: number } }) =>
      conversations.find((c) => c.id === where.id && c.tenantId === where.tenantId) ?? null,
    ),
  };
  const msgRepo = {
    findOne: jest.fn(async ({ where }: { where: { id: number; conversationId: number } }) =>
      messages.find((m) => m.id === where.id && m.conversationId === where.conversationId) ?? null,
    ),
  };
  const bus = { publish: jest.fn(async () => undefined) };
  const svc = new AnswerRatingService(ratingRepo as never, convRepo as never, msgRepo as never, bus as never);
  return { svc, rows, bus };
}

describe('AnswerRatingService.rate', () => {
  it('stores a verdict and raises a gap proposal for a non-accurate AI answer', async () => {
    const h = build();
    const r = await h.svc.rate(4, 7, 900, 2, { rating: 'inaccurate', reason: 'outdated', note: ' old price ' });
    expect(r).toMatchObject({ senderType: 'ai', rating: 'inaccurate', reason: 'outdated', note: 'old price' });
    expect(h.bus.publish).toHaveBeenCalledWith('answer.rated', expect.objectContaining({ messageId: 2, rating: 'inaccurate' }));
  });

  it('re-rating replaces the same row; accurate clears the reason and raises nothing', async () => {
    const h = build();
    await h.svc.rate(4, 7, 900, 2, { rating: 'partial', reason: 'wording' });
    h.bus.publish.mockClear();
    const r = await h.svc.rate(4, 7, 900, 2, { rating: 'accurate', reason: 'wording' });
    expect(h.rows).toHaveLength(1);
    expect(r.reason).toBeNull();
    expect(h.bus.publish).not.toHaveBeenCalled();
  });

  it('rates agent answers without raising a gap proposal', async () => {
    const h = build();
    await h.svc.rate(4, 7, 900, 3, { rating: 'inaccurate' });
    expect(h.rows[0].senderType).toBe('agent');
    expect(h.bus.publish).not.toHaveBeenCalled();
  });

  it("refuses another tenant's conversation with the same 404 as a missing one", async () => {
    const h = build();
    await expect(h.svc.rate(5, 7, 900, 2, { rating: 'accurate' })).rejects.toMatchObject({
      errorCode: ERROR_CODE.RESOURCE_NOT_FOUND.code,
    });
  });

  it('refuses to rate a customer message', async () => {
    const h = build();
    await expect(h.svc.rate(4, 7, 900, 1, { rating: 'accurate' })).rejects.toMatchObject({
      errorCode: ERROR_CODE.VALIDATION_FAILED.code,
    });
  });
});

describe('AnswerRatingService.summary', () => {
  it('counts by sender and by reason (non-accurate only)', async () => {
    const h = build();
    await h.svc.rate(4, 7, 900, 2, { rating: 'inaccurate', reason: 'outdated' });
    await h.svc.rate(4, 8, 900, 2, { rating: 'accurate' });
    await h.svc.rate(4, 7, 900, 3, { rating: 'partial' });
    const s = await h.svc.summary(4, new Date(0), new Date());
    expect(s.total).toBe(3);
    expect(s.bySender.ai).toEqual({ accurate: 1, partial: 0, inaccurate: 1 });
    expect(s.bySender.agent).toEqual({ accurate: 0, partial: 1, inaccurate: 0 });
    expect(s.byReason).toEqual({ outdated: 1, other: 1 });
  });
});
