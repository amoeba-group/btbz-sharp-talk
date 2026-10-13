import { GoldenService, GOLDEN_MAX_QUESTIONS } from './golden.service';
import { GOLDEN_RUN_KIND } from './entity/golden-run.entity';
import type { GoldenQuestion } from './entity/golden-question.entity';
import type { GoldenRunItem } from './entity/golden-run.entity';
import type { KnowledgeService } from '../knowledge/knowledge.service';
import { PartnerGoldenService } from '../partner-data/partner-golden.service';

/**
 * Golden questions that carry a partner context (PLN-261012 SG-31): the runner
 * prepares the partner turn and hands it to `knowledge.ask`, so figures, role
 * refusals and cross-hotel isolation are graded like any other answer.
 */
describe('GoldenService — partner context', () => {
  const NOW = Date.parse('2026-10-13T02:00:00.000Z');
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => jest.restoreAllMocks());

  const q = (id: number, question: string, extra: Partial<GoldenQuestion> = {}) =>
    ({ id, question, language: 'VI', active: 1, ...extra }) as GoldenQuestion;

  const build = (questions: GoldenQuestion[], opts: { withPartner?: boolean; ask?: (q: string, partner: unknown) => Promise<unknown> } = {}) => {
    const asked: Array<{ question: string; partner: unknown }> = [];
    const savedItems: GoldenRunItem[] = [];
    let nextId = 1;
    const questionRepo = {
      find: async () => questions,
      findOne: async ({ where }: { where: { id: number } }) => questions.find((x) => x.id === where.id) ?? null,
      create: (v: Partial<GoldenQuestion>) => ({ id: 1000 + nextId++, ...v }) as GoldenQuestion,
      save: async (v: GoldenQuestion) => v,
    };
    const runRepo = {
      create: (v: object) => ({ id: nextId++, ...v }),
      save: async (r: object) => r,
    };
    const itemRepo = {
      create: (v: Partial<GoldenRunItem>) => v as GoldenRunItem,
      save: async (i: GoldenRunItem) => {
        savedItems.push(i);
        return i;
      },
    };
    const knowledge = {
      ask: async (_t: number, question: string, _l: string, _g: unknown, _a: unknown, partner: unknown) => {
        asked.push({ question, partner });
        return opts.ask ? opts.ask(question, partner) : { answer: 'ok', confidence: 0.7, blocked: false, sources: [] };
      },
    } as unknown as KnowledgeService;
    const service = new GoldenService(
      questionRepo as never,
      runRepo as never,
      itemRepo as never,
      { getConfig: async () => ({ persona: 'p', rules: [], scenarioOverrides: {} }) } as never,
      knowledge,
      opts.withPartner === false ? undefined : new PartnerGoldenService(),
    );
    return { service, asked, savedItems };
  };

  it('prepares the partner turn for a question that names a context and hands it to ask()', async () => {
    const { service, asked } = build([
      q(1, 'Giá qua đêm phòng Deluxe hôm nay?', { partnerCtx: { hotelSn: '1721', role: 'manager', mockSet: 'default' } }),
    ]);
    await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);
    expect(asked).toHaveLength(1);
    expect(asked[0].partner).toMatchObject({ kind: 'data', block: expect.stringContaining('hotel 1721') });
  });

  it('asks an ordinary question exactly as before (no partner turn)', async () => {
    const { service, asked } = build([q(1, 'Chính sách hoàn tiền của Go2Joy?')]);
    await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);
    expect(asked[0].partner).toBeNull();
  });

  it('records a refusal as the answer and grades it', async () => {
    const { service, savedItems } = build(
      [
        q(1, 'Đối soát tháng 9?', {
          partnerCtx: { hotelSn: '1721', role: 'receptionist', mockSet: 'default' },
          expected: ['Quản lý'],
        }),
      ],
      {
        ask: async (_q, partner) => ({ answer: (partner as { body: string }).body, confidence: 1, blocked: false, sources: [] }),
      },
    );
    await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);
    expect(savedItems[0].verdict).toBe('pass');
    expect(savedItems[0].answer).toContain('Quản lý');
  });

  it('a question that names a context never silently runs without it (recorded as an error)', async () => {
    const { service, asked, savedItems } = build(
      [q(1, 'Giá phòng?', { partnerCtx: { hotelSn: '1721', role: 'manager', mockSet: 'default' }, expected: ['x'] })],
      { withPartner: false },
    );
    await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);
    expect(asked).toHaveLength(0);
    expect(savedItems[0].error).toMatch(/partner-data golden support is not available/);
    expect(savedItems[0].verdict).toBe('fail');
  });

  it('an unknown mock set is a recorded error for that question, not a lost run', async () => {
    const { service, savedItems } = build([
      q(1, 'Giá phòng?', { partnerCtx: { hotelSn: '1721', role: 'manager', mockSet: 'nope' } }),
      q(2, 'Hoa hồng bao nhiêu?'),
    ]);
    await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);
    expect(savedItems).toHaveLength(2);
    expect(savedItems[0].error).toMatch(/unknown mock set/);
    expect(savedItems[1].error).toBeUndefined();
  });

  it('keeps the 60-question cap', async () => {
    const many = Array.from({ length: GOLDEN_MAX_QUESTIONS + 3 }, (_, i) =>
      q(i + 1, `q${i}`, { partnerCtx: { hotelSn: '1721', role: 'manager', mockSet: 'default' } }),
    );
    const { service, asked } = build(many);
    const run = await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);
    expect(asked.length).toBeLessThanOrEqual(GOLDEN_MAX_QUESTIONS);
    expect(run.truncated).toBe(1);
  });

  it('stores a sanitised context on add/update and drops a malformed one', async () => {
    const { service } = build([q(1, 'x')]);
    const added = await service.addQuestion(1, 9, {
      question: 'Giá qua đêm?',
      partnerCtx: { hotelSn: '1721', role: 'Manager' },
    });
    expect(added.partnerCtx).toEqual({ hotelSn: '1721', role: 'manager', mockSet: 'default' });
    const bad = await service.addQuestion(1, 9, { question: 'Giá qua đêm?', partnerCtx: { hotelSn: '1721', role: 'owner' } });
    expect(bad.partnerCtx).toBeNull();
    const cleared = await service.updateQuestion(1, 1, { partnerCtx: null });
    expect(cleared.partnerCtx).toBeNull();
  });

  it('bulk paste: the 4th column sets the context; a re-paste without it leaves it alone', async () => {
    const existing = q(1, 'Giá qua đêm Deluxe?', { partnerCtx: { hotelSn: '1721', role: 'manager', mockSet: 'default' } });
    const { service } = build([existing]);
    const out = await service.bulkImport(1, 9, { text: 'Giá qua đêm Deluxe?\t425.000' });
    expect(out.updated).toBe(1);
    expect(existing.partnerCtx).toEqual({ hotelSn: '1721', role: 'manager', mockSet: 'default' });
    await service.bulkImport(1, 9, { text: 'Giá qua đêm Deluxe?\t425.000\t\thotel=2204|role=receptionist' });
    expect(existing.partnerCtx).toEqual({ hotelSn: '2204', role: 'receptionist', mockSet: 'default' });
  });
});
