import { GoldenService, GOLDEN_MAX_QUESTIONS } from './golden.service';
import { GOLDEN_RUN_KIND, type GoldenRun, type GoldenRunItem } from './entity/golden-run.entity';
import type { GoldenQuestion } from './entity/golden-question.entity';
import type { AiConfigService } from '../ai-engine/ai-config.service';
import type { KnowledgeService } from '../knowledge/knowledge.service';
import { BusinessException } from '../../global/exception/business.exception';

/**
 * Regression runs (FR-073). The value of this feature rests on two things being
 * right: every question actually gets asked (a silent partial run would read as
 * "we checked everything"), and a comparison never implies an effect it cannot
 * support.
 */

type AskResult = { answer: string; confidence: number; blocked: boolean; sources: unknown[] };

function serviceFor(opts: {
  questions?: Partial<GoldenQuestion>[];
  ask?: (q: string) => Promise<AskResult>;
  config?: { persona: string; rules: string[] };
  runs?: Partial<GoldenRun>[];
  items?: Partial<GoldenRunItem>[];
}) {
  const asked: string[] = [];
  const savedRuns: GoldenRun[] = [];
  const savedItems: GoldenRunItem[] = [];
  let nextId = 1;

  const questionRepo = {
    find: async () => (opts.questions ?? []) as GoldenQuestion[],
    findOne: async () => null,
  };
  const runRepo = {
    create: (v: Partial<GoldenRun>) => ({ id: nextId++, ...v }) as GoldenRun,
    save: async (r: GoldenRun) => {
      savedRuns.push(r);
      return r;
    },
    find: async () => (opts.runs ?? []) as GoldenRun[],
    findOne: async ({ where }: { where: { id: number } }) =>
      ((opts.runs ?? []).find((r) => r.id === where.id) as GoldenRun) ?? null,
  };
  const itemRepo = {
    create: (v: Partial<GoldenRunItem>) => v as GoldenRunItem,
    save: async (i: GoldenRunItem) => {
      savedItems.push(i);
      return i;
    },
    find: async ({ where }: { where: { runId: number } }) =>
      ((opts.items ?? []).filter((i) => i.runId === where.runId) as GoldenRunItem[]),
  };

  const aiConfig = {
    getConfig: async () => ({
      persona: opts.config?.persona ?? 'p',
      rules: opts.config?.rules ?? [],
      scenarioOverrides: {},
    }),
  } as unknown as AiConfigService;

  const knowledge = {
    ask: async (_t: number, q: string) => {
      asked.push(q);
      return opts.ask
        ? await opts.ask(q)
        : { answer: `answer to ${q}`, confidence: 0.7, blocked: false, sources: [] };
    },
  } as unknown as KnowledgeService;

  const service = new GoldenService(
    questionRepo as never,
    runRepo as never,
    itemRepo as never,
    aiConfig,
    knowledge,
  );
  return { service, asked, savedRuns, savedItems };
}

const q = (id: number, question: string) => ({ id, question, language: 'KO', active: 1 });

describe('GoldenService.run', () => {
  it('refuses to run with an empty set instead of reporting a vacuous pass', async () => {
    const { service } = serviceFor({ questions: [] });
    await expect(service.run(1, 9, GOLDEN_RUN_KIND.MANUAL)).rejects.toBeInstanceOf(BusinessException);
  });

  it('asks every active question and records the answers', async () => {
    const { service, asked, savedItems } = serviceFor({
      questions: [q(1, '배송은 얼마나 걸리나요?'), q(2, '반품 배송비는?')],
    });
    const run = await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);
    expect(asked).toEqual(['배송은 얼마나 걸리나요?', '반품 배송비는?']);
    expect(savedItems).toHaveLength(2);
    expect(run.questionCount).toBe(2);
  });

  it('records a failed question and keeps going instead of losing the run', async () => {
    const { service, savedItems } = serviceFor({
      questions: [q(1, 'first'), q(2, 'boom'), q(3, 'third')],
      ask: async (question) => {
        if (question === 'boom') throw new Error('rate limited');
        return { answer: 'ok', confidence: 0.7, blocked: false, sources: [] };
      },
    });
    await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);
    expect(savedItems).toHaveLength(3);
    expect(savedItems.find((i) => i.question === 'boom')?.error).toContain('rate limited');
    expect(savedItems.filter((i) => !i.error)).toHaveLength(2);
  });

  it('flags a truncated run rather than silently checking part of the set', async () => {
    // A partial run that looks complete is worse than no run: it reads as
    // "everything passed" when most of the set was never asked.
    const many = Array.from({ length: GOLDEN_MAX_QUESTIONS + 3 }, (_, i) => q(i + 1, `q${i}`));
    const { service, asked } = serviceFor({ questions: many });
    const run = await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);
    expect(asked).toHaveLength(GOLDEN_MAX_QUESTIONS);
    expect(run.truncated).toBe(1);
  });

  it('gives runs on the same config the same fingerprint, and a changed one a different fingerprint', async () => {
    const a = serviceFor({ questions: [q(1, 'x')], config: { persona: 'p', rules: ['one'] } });
    const b = serviceFor({ questions: [q(1, 'x')], config: { persona: 'p', rules: ['one'] } });
    const c = serviceFor({ questions: [q(1, 'x')], config: { persona: 'p', rules: ['one', 'two'] } });
    const [ha, hb, hc] = await Promise.all([
      a.service.configHash(1),
      b.service.configHash(1),
      c.service.configHash(1),
    ]);
    expect(ha).toBe(hb);
    expect(ha).not.toBe(hc);
  });
});

describe('GoldenService.compare', () => {
  const runs = [
    { id: 1, tenantId: 1, configHash: 'AAA' },
    { id: 2, tenantId: 1, configHash: 'BBB' },
    { id: 3, tenantId: 1, configHash: 'AAA' },
  ];
  const item = (runId: number, question: string, answer: string, confidence: number, titles: string[]) => ({
    runId,
    tenantId: 1,
    question,
    answer,
    confidence,
    blocked: 0,
    citations: titles.map((t, i) => ({ id: i, title: t, similarity: 0.5 })),
  });

  it('reports the signals between two runs without calling anything a regression', async () => {
    const { service } = serviceFor({
      runs,
      items: [
        item(1, '배송은?', '5~7일 걸립니다', 0.66, ['2.1.2']),
        item(2, '배송은?', '영업일 5~7일이 소요됩니다.', 0.69, ['2.1.2', '2.1.4']),
      ],
    });
    const res = await service.compare(1, 1, 2);
    expect(res.items).toHaveLength(1);
    const [it] = res.items;
    expect(it.confidenceDelta).toBeCloseTo(0.03, 3);
    expect(it.citationsChanged).toBe(true);
    expect(it.textChanged).toBe(true);
    expect(res.sameConfig).toBe(false);
  });

  it('marks a comparison between identical configs as variance, not effect', async () => {
    // Runs 1 and 3 share a config hash, so any difference is the model moving
    // on its own — the caller must not present it as the result of a change.
    const { service } = serviceFor({
      runs,
      items: [
        item(1, '배송은?', 'A', 0.66, ['2.1.2']),
        item(3, '배송은?', 'B', 0.66, ['2.1.2']),
      ],
    });
    const res = await service.compare(1, 1, 3);
    expect(res.sameConfig).toBe(true);
    expect(res.items[0].textChanged).toBe(true);
  });

  it('lines questions up by text so an edited set still compares', async () => {
    const { service } = serviceFor({
      runs,
      items: [
        item(1, '배송은?', 'A', 0.6, []),
        item(2, '반품은?', 'C', 0.5, []),
      ],
    });
    const res = await service.compare(1, 1, 2);
    const byQ = Object.fromEntries(res.items.map((i) => [i.question, i]));
    expect(byQ['배송은?'].target).toBeNull(); // dropped from the later run
    expect(byQ['반품은?'].base).toBeNull(); // added after the baseline
    expect(byQ['배송은?'].confidenceDelta).toBeNull();
  });
});

describe('GoldenService — graded runs (PLN-261007 R7)', () => {
  const graded = (id: number, question: string, expected: string[]) => ({ ...q(id, question), expected, forbidden: null });

  it('grades each answer against its expected facts and counts the run', async () => {
    const { service, savedItems, savedRuns } = serviceFor({
      questions: [graded(1, 'D3', ['19133261136016']), graded(2, 'E1', ['Chờ nhận phòng']), q(3, 'H2')],
      ask: async (question) => ({
        answer: question === 'D3' ? 'STK **19133261136016**' : question === 'E1' ? 'Email ▇▇▇' : 'anything',
        confidence: 0.7,
        blocked: false,
        sources: [],
      }),
    });
    await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);
    expect(savedItems.map((i) => i.verdict)).toEqual(['pass', 'fail', null]);
    expect(savedItems[1].failedChecks).toEqual(['missing: Chờ nhận phòng', 'forbidden: ▇▇▇']);
    const done = savedRuns[savedRuns.length - 1];
    expect([done.passCount, done.failCount, done.status]).toEqual([1, 1, 'done']);
  });

  it('asks as the chosen agent', async () => {
    const seen: unknown[] = [];
    const { service } = serviceFor({ questions: [q(1, 'x')] });
    (service as unknown as { knowledge: { ask: (...a: unknown[]) => Promise<unknown> } }).knowledge.ask = async (...a) => {
      seen.push(a[4]);
      return { answer: 'a', confidence: 0.5, blocked: false, sources: [] };
    };
    await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL, { aiAgentId: 10 });
    expect(seen).toEqual([10]);
  });

  it('returns a running row at once in background mode and finishes afterwards', async () => {
    const { service, savedRuns } = serviceFor({ questions: [q(1, 'x')] });
    const run = await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL, { background: true });
    expect(run.status).toBe('running');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(savedRuns[savedRuns.length - 1].status).toBe('done');
  });

  it('lists regressions (pass → fail) first in a comparison', async () => {
    const { service } = serviceFor({
      runs: [
        { id: 1, configHash: 'a' },
        { id: 2, configHash: 'a' },
      ],
      items: [
        { runId: 1, question: 'A', answer: 'a', verdict: 'pass', citations: [] },
        { runId: 1, question: 'B', answer: 'b', verdict: 'fail', citations: [] },
        { runId: 2, question: 'A', answer: 'a', verdict: 'fail', failedChecks: ['missing: x'], citations: [] },
        { runId: 2, question: 'B', answer: 'b', verdict: 'pass', citations: [] },
      ],
    });
    const c = await service.compare(1, 1, 2);
    expect(c.items[0]).toMatchObject({ question: 'A', regressed: true, targetFailedChecks: ['missing: x'] });
    expect(c.items.find((i) => i.question === 'B')?.improved).toBe(true);
  });
});

describe('GoldenService.bulkImport', () => {
  it('creates new questions and only updates the facts of existing ones', async () => {
    const rows: Array<Record<string, unknown>> = [{ id: 1, tenantId: 1, question: 'Hoa hồng bao nhiêu?', expected: null }];
    const questionRepo = {
      find: async () => rows,
      create: (v: Record<string, unknown>) => v,
      save: async (v: Record<string, unknown>) => {
        if (!rows.includes(v)) rows.push({ id: rows.length + 1, ...v });
        return v;
      },
    };
    const svc = new GoldenService(questionRepo as never, {} as never, {} as never, {} as never, {} as never);
    const res = await svc.bulkImport(1, 9, {
      text: 'Hoa hồng bao nhiêu?\t15%|10%\nTôi có thể thanh toán cho Go2Joy như nào?\tTechcombank',
      language: 'vi',
    });
    expect(res).toEqual({ created: 1, updated: 1, skipped: 0 });
    expect(rows[0].expected).toEqual(['15%', '10%']);
    expect(rows[1]).toMatchObject({ question: 'Tôi có thể thanh toán cho Go2Joy như nào?', expected: ['Techcombank'], language: 'VI' });
  });
});
