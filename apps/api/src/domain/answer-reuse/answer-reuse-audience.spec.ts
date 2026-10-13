import { Repository } from 'typeorm';
import { AUDIENCE_RANK } from '@sharptalk/types';
import { AnswerReuseService } from './answer-reuse.service';
import { AnswerReuse } from './entity/answer-reuse.entity';
import { AiGatewayService } from '../../infrastructure/external/ai/ai-gateway.service';
import { ReuseQdrantService } from '../../infrastructure/external/vector/reuse-qdrant.service';
import { KbCategory } from '../knowledge/entity/kb-category.entity';

/**
 * Answer reuse by audience (PLN-261012 SG-06, REQ D-06).
 *
 * The reuse lookup runs BEFORE retrieval, so a retrieval scope alone is bypassed by every
 * question that was asked once already: a manager's answer, stored, would replay to the
 * receptionist asking the same words. Rows carry the rank of the audience they were
 * generated for; a viewer must rank at least as high.
 */
describe('AnswerReuseService — audience', () => {
  const RANK = AUDIENCE_RANK;

  const build = (row: Partial<AnswerReuse> | null, categories: Array<Partial<KbCategory>>, extra: { noHits?: boolean } = {}) => {
    const repo = {
      findOne: jest.fn(async () => row),
      update: jest.fn(async () => undefined),
      increment: jest.fn(async () => undefined),
      count: jest.fn(async () => 0),
      create: (e: Partial<AnswerReuse>) => e as AnswerReuse,
      save: jest.fn(async (e: AnswerReuse) => ({ ...e, id: 101 })),
    } as unknown as Repository<AnswerReuse>;
    const categoryRepo = { find: jest.fn(async () => categories) } as unknown as Repository<KbCategory>;
    const ai = {
      embed: jest.fn(async () => ({ vectors: [[0.1, 0.2]], provider: 'voyage', model: 'v', tokensIn: 1, dimension: 2 })),
    } as unknown as AiGatewayService;
    // A lookup finds row 7 at 0.99; a STORE must not meet a near-duplicate, so those tests find nothing.
    const search = jest.fn(async () => (extra.noHits ? [] : [{ id: 7, score: 0.99 }]));
    const vector = {
      enabled: true,
      search,
      upsert: jest.fn(async () => undefined),
    } as unknown as ReuseQdrantService;
    return { svc: new AnswerReuseService(repo, categoryRepo, ai, vector), repo, vector };
  };

  const row = (over: Partial<AnswerReuse> = {}): Partial<AnswerReuse> => ({
    id: 7,
    tenantId: 1,
    lang: 'VI',
    questionText: 'Khi nào đối soát xong?',
    answerText: 'x'.repeat(40),
    source: 'ai',
    active: 1,
    confidence: 0.9,
    citations: [],
    updatedAt: new Date(),
    aiAgentId: 3,
    audienceRank: null,
    ...over,
  });

  const tiered = [{ name: 'settlement', agentIds: null, minAudience: 'manager' }] as Array<Partial<KbCategory>>;
  const untiered = [
    { name: 'checkin', agentIds: null, minAudience: null },
    { name: 'faq', agentIds: null, minAudience: 'partner' },
  ] as Array<Partial<KbCategory>>;

  const ask = (svc: AnswerReuseService, viewerRank?: number) =>
    svc.lookup(1, 'VI', 'Khi nào đối soát xong?', 3, viewerRank);

  describe('while the tenant has a manager-only category', () => {
    it('a manager answer (rank 2) does NOT replay to a receptionist (rank 1)', async () => {
      const { svc } = build(row({ audienceRank: RANK.manager }), tiered);
      expect(await ask(svc, RANK.partner)).toBeNull();
    });

    it('…nor to a guest (rank 0)', async () => {
      const { svc } = build(row({ audienceRank: RANK.manager }), tiered);
      expect(await ask(svc, RANK.public)).toBeNull();
    });

    it('a manager answer replays to a manager', async () => {
      const { svc } = build(row({ audienceRank: RANK.manager }), tiered);
      expect(await ask(svc, RANK.manager)).not.toBeNull();
    });

    it('a receptionist answer (rank 1) replays to the receptionist and to a manager, not to a guest', async () => {
      const r = row({ audienceRank: RANK.partner });
      expect(await ask(build(r, tiered).svc, RANK.partner)).not.toBeNull();
      expect(await ask(build(r, tiered).svc, RANK.manager)).not.toBeNull();
      expect(await ask(build(r, tiered).svc, RANK.public)).toBeNull();
    });

    it('a public answer (rank 0) replays to everyone', async () => {
      const r = row({ audienceRank: RANK.public });
      for (const rank of [RANK.public, RANK.partner, RANK.manager]) {
        expect(await ask(build(r, tiered).svc, rank)).not.toBeNull();
      }
    });

    it('a legacy NULL-rank row is never replayed: its audience is unknowable', async () => {
      const r = row({ audienceRank: null });
      for (const rank of [RANK.public, RANK.partner, RANK.manager]) {
        expect(await ask(build(r, tiered).svc, rank)).toBeNull();
      }
    });

    it('a lookup that forgets the viewer rank reads as the lowest rank (fail closed)', async () => {
      expect(await ask(build(row({ audienceRank: RANK.partner }), tiered).svc)).toBeNull();
      expect(await ask(build(row({ audienceRank: RANK.public }), tiered).svc)).not.toBeNull();
    });

    it('also holds for a row written before agents were recorded (agent-less)', async () => {
      const { svc } = build(row({ aiAgentId: null, audienceRank: RANK.manager }), tiered);
      // The agent-less rule (scope) is separate: nothing is agent-scoped here, the rank decides.
      expect(await svc.lookup(1, 'VI', 'Khi nào đối soát xong?', 3, RANK.partner)).toBeNull();
    });
  });

  describe('a tenant with no manager-only category is byte-identical to before', () => {
    it.each([RANK.public, RANK.partner, RANK.manager])('replays a NULL-rank row to rank %s', async (rank) => {
      const { svc } = build(row({ audienceRank: null }), untiered);
      expect(await ask(svc, rank)).not.toBeNull();
    });

    it('ignores the stored rank entirely: a stored manager rank still replays to a guest', async () => {
      // No tier exists, so no retrieval scope differed between audiences — nothing to protect.
      const { svc } = build(row({ audienceRank: RANK.manager }), untiered);
      expect(await ask(svc, RANK.public)).not.toBeNull();
    });

    it('explicit public/partner categories are not a restriction (only manager is)', async () => {
      const cats = [{ name: 'a', agentIds: null, minAudience: 'public' }, { name: 'b', agentIds: null, minAudience: 'partner' }] as Array<Partial<KbCategory>>;
      expect(await ask(build(row({ audienceRank: RANK.manager }), cats).svc, RANK.public)).not.toBeNull();
    });
  });

  describe('the per-agent rules still apply on top', () => {
    it('another agent’s row never replays, whatever the rank', async () => {
      const { svc } = build(row({ aiAgentId: 9, audienceRank: RANK.public }), tiered);
      expect(await ask(svc, RANK.manager)).toBeNull();
    });
  });

  describe('what gets stored', () => {
    it('an AI answer is stored with the audience rank it was generated for', async () => {
      const { svc, repo } = build(null, tiered, { noHits: true });
      await svc.recordAiAnswer({
        tenantId: 1,
        lang: 'VI',
        question: 'Khi nào đối soát xong vậy bạn?',
        answerText: 'Đối soát hoàn tất vào ngày làm việc thứ ba của tháng sau.',
        confidence: 0.9,
        citations: [{ id: 1 }],
        sourceMessageId: 5,
        needsOrderData: false,
        aiAgentId: 3,
        audienceRank: RANK.manager,
      });
      const saved = (repo.save as jest.Mock).mock.calls[0][0] as AnswerReuse;
      expect(saved.audienceRank).toBe(RANK.manager);
    });

    it('a row stored without a rank (an older caller) keeps NULL — and so never replays once tiers exist', async () => {
      const { svc, repo } = build(null, tiered, { noHits: true });
      await svc.recordAiAnswer({
        tenantId: 1,
        lang: 'VI',
        question: 'Khi nào đối soát xong vậy bạn?',
        answerText: 'Đối soát hoàn tất vào ngày làm việc thứ ba của tháng sau.',
        confidence: 0.9,
        citations: [{ id: 1 }],
        sourceMessageId: 5,
        needsOrderData: false,
      });
      expect((repo.save as jest.Mock).mock.calls[0][0].audienceRank).toBeNull();
    });

    it('a human agent reply is NOT stored while the tenant has a manager-only category', async () => {
      const { svc, repo, vector } = build(null, tiered, { noHits: true });
      await svc.recordAgentAnswer({
        tenantId: 1,
        lang: 'VI',
        question: 'Khi nào đối soát xong vậy bạn?',
        answerText: 'Đối soát hoàn tất vào ngày làm việc thứ ba của tháng sau.',
        sourceMessageId: 5,
        aiAgentId: 3,
        audienceRank: RANK.partner,
      });
      expect(repo.save).not.toHaveBeenCalled();
      expect(vector.upsert).not.toHaveBeenCalled();
    });

    it('…but is stored, stamped with its rank, for a tenant with no tier (as before)', async () => {
      const { svc, repo } = build(null, untiered, { noHits: true });
      await svc.recordAgentAnswer({
        tenantId: 1,
        lang: 'VI',
        question: 'Khi nào đối soát xong vậy bạn?',
        answerText: 'Đối soát hoàn tất vào ngày làm việc thứ ba của tháng sau.',
        sourceMessageId: 5,
        aiAgentId: 3,
        audienceRank: RANK.partner,
      });
      expect(repo.save).toHaveBeenCalledTimes(1);
      expect((repo.save as jest.Mock).mock.calls[0][0].audienceRank).toBe(RANK.partner);
    });
  });
});
