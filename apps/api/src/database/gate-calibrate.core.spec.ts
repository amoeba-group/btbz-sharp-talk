import { simulatedIdentity } from '@sharptalk/types';
import { decideGate } from '../domain/chat/gate-decision';
import type { GateDecision } from '../domain/chat/gate-decision';
import type { LabelledItem } from '../domain/chat/gate-calibration.util';
import { AGENT_ID, asGateRag, makeRag } from '../domain/chat/testing/gate-harness';
import type { World } from '../domain/chat/testing/gate-harness';
import { parseCalibrateArgs, runCalibration, sampleOf } from './gate-calibrate.core';

describe('parseCalibrateArgs', () => {
  it('defaults: tenant 1, the 0.45..0.95 sweep in 0.05 steps, no file, no JSON', () => {
    expect(parseCalibrateArgs([])).toEqual({ tenantId: 1, agentId: null, file: null, from: 0.45, to: 0.95, step: 0.05, json: null, delayMs: 0 });
  });

  it('takes --key=value and --key value', () => {
    expect(parseCalibrateArgs(['--tenant=2', '--agent', '14', '--file=reference/x.csv', '--from=0.5', '--to=0.9', '--step=0.1', '--json=out.json', '--delay-ms=250'])).toEqual({
      tenantId: 2,
      agentId: 14,
      file: 'reference/x.csv',
      from: 0.5,
      to: 0.9,
      step: 0.1,
      json: 'out.json',
      delayMs: 250,
    });
  });

  it.each([
    [['--tennant=2'], 'unknown option --tennant'],
    [['file.csv'], 'unexpected argument "file.csv"'],
    [['--tenant'], '--tenant needs a value'],
    [['--tenant=abc'], '--tenant must be a number'],
    [['--tenant=0'], '--tenant must be a tenant id'],
    [['--agent=1.5'], '--agent must be an agent id'],
    [['--from=0.9', '--to=0.5'], 'the sweep needs --from <= --to and --step > 0'],
    [['--step=0'], 'the sweep needs --from <= --to and --step > 0'],
  ])('rejects %j: %s (a typo must not be ignored)', (argv, error) => {
    expect(parseCalibrateArgs(argv)).toEqual({ error });
  });
});

describe('runCalibration — the stub / keyword-only guard (REQ D-16)', () => {
  const items: LabelledItem[] = [
    { question: 'Làm sao đăng ký?', audience: 'guest', expect: 'allow' },
    { question: 'Hạn đối soát?', audience: 'guest', expect: 'refuse' },
    { question: 'Đổi tài khoản ngân hàng?', audience: 'receptionist', expect: 'refuse' },
  ];
  const context = { tenantId: 1, agentId: AGENT_ID, source: 'csv' as const, guestPolicy: 'open', voyageKeySet: false, qdrantEnabled: true, currentThreshold: 0.45 };
  const args = { from: 0.45, to: 0.95, step: 0.05, delayMs: 0 };

  /** Measure with the REAL decideGate over a scripted world, so the samples are what the CLI would build. */
  const measureWith = (world: (item: LabelledItem) => World) => async (item: LabelledItem): Promise<GateDecision> =>
    decideGate(
      asGateRag(makeRag(world(item))),
      { tenantId: 1, agentId: AGENT_ID, identity: simulatedIdentity(item.audience), query: item.question },
      { assumeGuestPolicy: 'login_guidance' },
    );

  // The stub embedder: a hit count, >= 0.62 as soon as ONE document matches — the gate cannot close.
  const stubWorld = (): World => ({
    policy: 'open',
    tiers: true,
    guest: { confidence: 0.62, vectorProvider: 'stub' },
    audience: { confidence: 0.62, vectorProvider: 'stub' },
    manager: { confidence: 0.62, vectorProvider: 'stub' },
  });
  const voyageWorld = (item: LabelledItem): World => ({
    policy: 'open',
    tiers: true,
    // Public how-to grounds high; the partner-only question does not ground in the public scope.
    guest: item.question.startsWith('Làm sao') ? { confidence: 0.8, topSimilarity: 0.8 } : { confidence: 0.2, topSimilarity: 0.3 },
    audience: { confidence: 0.2, topSimilarity: 0.3 },
    manager: { confidence: 0.85, topSimilarity: 0.85 },
  });

  it('the stub embedder: a loud banner, exit code 3, and NO recommendation anyone could copy', async () => {
    const run = await runCalibration({ items, measure: measureWith(stubWorld), args, context });

    expect(run.exitCode).toBe(3);
    expect(run.meaningfulness.meaningful).toBe(false);
    expect(run.text).toContain('NOT MEANINGFUL: stub embeddings — gate never closes');
    // Top AND bottom, so it is the first and the last thing read.
    expect(run.text.match(/NOT MEANINGFUL: stub embeddings — gate never closes/g)).toHaveLength(2);
    expect(run.text).toContain('for illustration only');
    expect(run.report.recommendation).toBeNull();
    expect(run.text).not.toContain('RECOMMENDED GUEST_GATE_CONFIDENCE');
    expect(run.json).toMatchObject({ meaningful: false, exitCode: 3, providers: { stub: 3 } });
    expect((run.json.report as { recommendation: unknown }).recommendation).toBeNull();
  });

  it('what the stub run shows is exactly the bug: the must-refuse guest question is ALLOWED (the gate never closes)', async () => {
    const run = await runCalibration({ items, measure: measureWith(stubWorld), args, context });

    const refuseGuest = run.samples.find((s) => s.question === 'Hạn đối soát?')!;
    expect(refuseGuest).toMatchObject({ expect: 'refuse', decision: 'allow', thresholdSensitive: true, vectorProvider: 'stub' });
    expect(run.report.rows.find((r) => r.threshold === 0.45)!.leaks).toBeGreaterThan(0);
  });

  it('real embeddings, a clean separation: exit 0 and a recommendation', async () => {
    const run = await runCalibration({
      items: items.slice(0, 2),
      measure: measureWith(voyageWorld),
      args,
      context: { ...context, voyageKeySet: true },
    });

    expect(run.exitCode).toBe(0);
    expect(run.meaningfulness).toMatchObject({ meaningful: true, providers: { voyage: 2 } });
    expect(run.report.recommendation).toMatchObject({ threshold: 0.8, leakFree: true });
    expect(run.text).toContain('RECOMMENDED GUEST_GATE_CONFIDENCE=0.80');
    expect(run.text).not.toContain('NOT MEANINGFUL');
    expect(run.json).toMatchObject({ meaningful: true, exitCode: 0 });
  });

  it('real embeddings but a LEAK no bar closes: exit 2', async () => {
    const leaky: LabelledItem[] = [
      { question: 'Làm sao đăng ký?', audience: 'guest', expect: 'allow' },
      { question: 'Hạn đối soát?', audience: 'guest', expect: 'refuse' },
    ];
    const world = (): World => ({
      policy: 'open',
      tiers: true,
      guest: { confidence: 0.95, topSimilarity: 0.95 }, // the must-refuse question grounds at the cap
      audience: { confidence: 0.9 },
      manager: { confidence: 0.9 },
    });

    const run = await runCalibration({ items: leaky, measure: measureWith(world), args, context });

    expect(run.exitCode).toBe(2);
    expect(run.report.recommendation?.leakFree).toBe(false);
  });

  it('a degraded vector leg (Voyage or Qdrant failed) is not calibration data either', async () => {
    const world = (): World => ({
      policy: 'open',
      tiers: true,
      guest: { confidence: 0.2, degraded: true, vectorProvider: 'stub' },
      audience: { confidence: 0.2 },
      manager: { confidence: 0.2 },
    });

    const run = await runCalibration({ items: items.slice(0, 2), measure: measureWith(world), args, context });

    expect(run.exitCode).toBe(3);
    expect(run.meaningfulness.degradedSamples).toBeGreaterThan(0);
  });

  it('only guests are moved by the guest bar; a signed-in viewer is carried as measured', async () => {
    const run = await runCalibration({ items, measure: measureWith(voyageWorld), args, context });

    expect(run.samples.map((s) => [s.audience, s.thresholdSensitive])).toEqual([
      ['guest', true],
      ['guest', true],
      ['receptionist', false],
    ]);
  });

  it('is sequential, and pauses between questions only when asked (the embedding tier is rate-limited)', async () => {
    const sleeps: number[] = [];
    const order: string[] = [];
    await runCalibration({
      items,
      measure: async (item) => {
        order.push(item.question);
        return measureWith(voyageWorld)(item);
      },
      args: { ...args, delayMs: 250 },
      context,
      sleep: async (ms) => void sleeps.push(ms),
    });

    expect(order).toEqual(items.map((i) => i.question));
    expect(sleeps).toEqual([250, 250]);
  });

  it('reports progress once per question', async () => {
    const progress: Array<[number, number]> = [];
    await runCalibration({ items, measure: measureWith(voyageWorld), args, context, onProgress: (d, t) => progress.push([d, t]) });

    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('the JSON keeps the question short and every measurement; the text header says what environment it ran in', async () => {
    const long = 'x'.repeat(300);
    const run = await runCalibration({
      items: [{ question: long, audience: 'guest', expect: 'allow' }],
      measure: measureWith(voyageWorld),
      args,
      context: { ...context, voyageKeySet: true },
    });

    const sample = (run.json.samples as Array<{ question: string }>)[0];
    expect(sample.question).toHaveLength(120);
    expect(run.text).toContain('VOYAGE_API_KEY set, Qdrant enabled');
    expect(run.text).toContain('agent guest policy now: open (calibration measures guests as if it were login_guidance)');
  });

  it('sampleOf marks a guest as threshold-sensitive only when the guest gate really decided it', async () => {
    const d = await measureWith(voyageWorld)(items[0]);

    expect(sampleOf(1, items[0], d)).toMatchObject({ thresholdSensitive: true, grounded: 0.8, vectorProvider: 'voyage' });
    expect(sampleOf(1, items[0], { ...d, guestGated: false })).toMatchObject({ thresholdSensitive: false });
  });
});

describe('runCalibration — keyword-only grounding warning', () => {
  it('a real-embedding run still exits on its recommendation, with the warning in the text and the JSON', async () => {
    const items: LabelledItem[] = [
      { question: 'Làm sao đăng ký?', audience: 'guest', expect: 'allow' },
      { question: 'Hạn đối soát?', audience: 'guest', expect: 'refuse' },
    ];
    const measure = async (item: LabelledItem): Promise<GateDecision> =>
      decideGate(
        asGateRag(
          makeRag({
            policy: 'open',
            tiers: true,
            // The refuse question grounds on keyword hits only: voyage ran, no similarity, 0.62.
            guest: item.question.startsWith('Làm sao') ? { confidence: 0.8, topSimilarity: 0.8 } : { confidence: 0.62, topSimilarity: null },
            audience: { confidence: 0.2 },
            manager: { confidence: 0.2 },
          }),
        ),
        { tenantId: 1, agentId: AGENT_ID, identity: simulatedIdentity(item.audience), query: item.question },
        { assumeGuestPolicy: 'login_guidance' },
      );

    const run = await runCalibration({
      items,
      measure,
      args: { from: 0.45, to: 0.95, step: 0.05, delayMs: 0 },
      context: { tenantId: 1, agentId: AGENT_ID, source: 'csv', guestPolicy: 'open', voyageKeySet: true, qdrantEnabled: true, currentThreshold: 0.45 },
    });

    expect(run.meaningfulness.meaningful).toBe(true);
    expect(run.meaningfulness.warnings).toHaveLength(1);
    expect(run.text).toContain('WARNING: 1 guest question(s) grounded on KEYWORD hits only');
    expect((run.json.warnings as string[])[0]).toMatch(/KEYWORD hits only/);
  });
});
