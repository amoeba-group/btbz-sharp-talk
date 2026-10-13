import { RagService } from './rag.service';
import {
  CONFIDENCE_SCALE,
  NOT_MEANINGFUL_EXIT_CODE,
  assessMeaningfulness,
  barClass,
  buildCalibration,
  confusionOf,
  decisionAt,
  formatCalibration,
  notMeaningfulBanner,
  parseLabelledCsv,
  thresholdGrid,
} from './gate-calibration.util';
import type { CalibrationSample } from './gate-calibration.util';

/**
 * The calibration math (PLN-261012 SG-51, REQ D-16) on synthetic score sets: the bimodal confidence,
 * the no-leak bias, identical-bar detection, and whether a measurement is real at all.
 */
let nextId = 1;
const guest = (expect: 'allow' | 'refuse', grounded: number, over: Partial<CalibrationSample> = {}): CalibrationSample => ({
  id: nextId++,
  question: `q${nextId}`,
  audience: 'guest',
  expect,
  decision: grounded < 0.45 ? 'guest_gate' : 'allow',
  thresholdSensitive: true,
  grounded,
  topSimilarity: grounded,
  vectorProvider: 'voyage',
  degraded: false,
  ...over,
});
const signedIn = (audience: 'partner' | 'receptionist' | 'manager', expect: 'allow' | 'refuse', decision: CalibrationSample['decision']): CalibrationSample => ({
  id: nextId++,
  question: `s${nextId}`,
  audience,
  expect,
  decision,
  thresholdSensitive: false,
  grounded: decision === 'allow' ? 0.8 : 0.2,
  topSimilarity: 0.8,
  vectorProvider: 'voyage',
  degraded: false,
});

describe('thresholdGrid', () => {
  it('defaults to 0.45..0.95 step 0.05 with clean numbers (no 0.5000000001)', () => {
    expect(thresholdGrid()).toEqual([0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]);
  });

  it('honours a custom range and refuses nonsense', () => {
    expect(thresholdGrid(0.5, 0.6, 0.05)).toEqual([0.5, 0.55, 0.6]);
    expect(thresholdGrid(0.5, 0.6, 0)).toEqual([]);
    expect(thresholdGrid(0.9, 0.5, 0.05)).toEqual([]);
  });
});

describe('the bimodal scale', () => {
  it('classifies a bar by where it sits', () => {
    expect(barClass(0.2)).toBe('open'); // the 0.2 sentinel is not < 0.2: the gate never closes
    expect(barClass(0.1)).toBe('open');
    expect(barClass(0.21)).toBe('floor');
    expect(barClass(0.45)).toBe('floor');
    expect(barClass(0.5)).toBe('floor');
    expect(barClass(0.51)).toBe('live');
    expect(barClass(0.95)).toBe('live');
    expect(barClass(0.96)).toBe('closed');
  });

  it('mirrors RagService.confidence(): real scores are only ever 0.2 or in [floor, cap]', async () => {
    const saved = { ...process.env };
    delete process.env.RAG_MIN_SIMILARITY;
    const seen: number[] = [];
    for (let s = 0; s <= 100; s++) {
      const svc = new RagService(
        { createQueryBuilder: () => ({}) } as never,
        { findOne: async () => null } as never,
        { complete: jest.fn() } as never,
        { enabled: true, search: jest.fn() } as never,
        { getPersonaRules: jest.fn(), effectiveAgentId: jest.fn() } as never,
      );
      (svc as unknown as { retrieveHybrid: unknown }).retrieveHybrid = async () => ({
        chunks: [{ id: 1, title: 't', category: 'c', group: 'g', similarity: s / 100 }],
        vectorProvider: 'voyage',
      });
      seen.push((await svc.groundingReport(1, 'q')).confidence);
    }
    process.env = saved;

    expect(Math.min(...seen)).toBe(CONFIDENCE_SCALE.sentinel);
    expect(Math.min(...seen.filter((c) => c > CONFIDENCE_SCALE.sentinel))).toBe(CONFIDENCE_SCALE.floor);
    expect(Math.max(...seen)).toBe(CONFIDENCE_SCALE.cap);
  });
});

describe('decisionAt', () => {
  it('a guest sample moves with the bar (refuse iff grounded < bar)', () => {
    const s = guest('allow', 0.6);

    expect(decisionAt(s, 0.55)).toBe('allow');
    expect(decisionAt(s, 0.6)).toBe('allow'); // not strictly below
    expect(decisionAt(s, 0.65)).toBe('refuse');
  });

  it('a missing measurement fails CLOSED', () => {
    expect(decisionAt(guest('allow', 0.9, { grounded: null }), 0.45)).toBe('refuse');
  });

  it('a signed-in sample never meets the guest bar: its verdict is the measured decision at every bar', () => {
    const refused = signedIn('receptionist', 'refuse', 'role_manager_only');
    const allowed = signedIn('partner', 'allow', 'allow');

    for (const t of [0.1, 0.45, 0.95, 2]) {
      expect(decisionAt(refused, t)).toBe('refuse');
      expect(decisionAt(allowed, t)).toBe('allow');
    }
  });
});

describe('confusionOf — positive class is refuse', () => {
  it('counts tp / fp / fn(leak) / tn and derives precision, recall and F1', () => {
    const set = [
      guest('refuse', 0.2), // refused at 0.5: tp
      guest('refuse', 0.7), // allowed at 0.5: fn (a LEAK)
      guest('allow', 0.4), // refused at 0.5: fp (an over-refusal)
      guest('allow', 0.9), // allowed: tn
      guest('allow', 0.8), // allowed: tn
    ];

    expect(confusionOf(set, 0.5)).toEqual({ tp: 1, fp: 1, fn: 1, tn: 2, precision: 0.5, recall: 0.5, f1: 0.5 });
  });

  it('F1 is undefined with nothing to refuse and 0 when the gate missed every positive', () => {
    expect(confusionOf([guest('allow', 0.9)], 0.5).f1).toBeNull();
    expect(confusionOf([guest('refuse', 0.9)], 0.5)).toMatchObject({ tp: 0, fn: 1, precision: null, recall: 0, f1: 0 });
  });
});

describe('buildCalibration', () => {
  describe('the bimodal confidence: bars that cannot be told apart', () => {
    // Real scores are 0.2 (nothing near) or the similarity itself: public how-to questions ground at
    // 0.7-0.9, partner-only ones at the 0.2 sentinel. Nothing between.
    const set = [
      guest('refuse', 0.2),
      guest('refuse', 0.2),
      guest('refuse', 0.2),
      guest('allow', 0.7),
      guest('allow', 0.8),
      guest('allow', 0.9),
    ];
    const report = buildCalibration(set);

    it('reports the run of bars that behave identically (0.45 .. 0.70)', () => {
      expect(report.identical[0]).toEqual({ from: 0.45, to: 0.7, thresholds: [0.45, 0.5, 0.55, 0.6, 0.65, 0.7] });
    });

    it('is perfect across that run and starts over-refusing above the lowest allowed score', () => {
      const at = (t: number) => report.rows.find((r) => r.threshold === t)!;
      for (const t of [0.45, 0.5, 0.7]) expect(at(t)).toMatchObject({ leaks: 0, falseRefuses: 0 });
      expect(at(0.75).falseRefuses).toBe(1); // 0.7 now refused
      expect(at(0.95).falseRefuses).toBe(3);
    });

    it('recommends the STRICTEST bar of the equivalent run, listing the others', () => {
      expect(report.recommendation).toMatchObject({ threshold: 0.7, leaks: 0, falseRefuses: 0, leakFree: true, f1: 1 });
      expect(report.recommendation?.equivalent).toEqual([0.45, 0.5, 0.55, 0.6, 0.65, 0.7]);
    });

    it('measures the separation: a clean gap between the classes', () => {
      expect(report.separation).toEqual({ maxRefused: 0.2, minAllowed: 0.7, gap: 0.5, separable: true });
    });
  });

  describe('the safety bias: no leaks beats a better F1', () => {
    // One must-refuse question grounds at 0.9 — as well as the public ones. Any bar that lets the public
    // ones through also lets it through.
    const set = [...Array.from({ length: 9 }, () => guest('refuse', 0.2)), guest('refuse', 0.9), guest('allow', 0.7), guest('allow', 0.75), guest('allow', 0.8), guest('allow', 0.85)];
    const report = buildCalibration(set);

    it('an F1-only chooser would take a LEAKY bar', () => {
      const best = [...report.rows].sort((a, b) => (b.total.f1 ?? 0) - (a.total.f1 ?? 0))[0];
      expect(best.leaks).toBe(1);
    });

    it('the recommendation takes the leak-free bar instead, at the price of over-refusals', () => {
      expect(report.recommendation).toMatchObject({ threshold: 0.95, leaks: 0, leakFree: true });
      expect(report.recommendation!.falseRefuses).toBe(4);
      expect(report.separation.separable).toBe(false);
    });
  });

  it('when NO bar is leak-free it still picks the fewest leaks and says so', () => {
    // A must-refuse question grounds at the cap (0.95): the bar 0.95 does not refuse 0.95.
    const report = buildCalibration([guest('refuse', 0.95), guest('refuse', 0.2), guest('allow', 0.7)]);

    expect(report.recommendation).toMatchObject({ leaks: 1, leakFree: false });
    expect(report.reason).toMatch(/NO leak-free bar/);
    expect(formatCalibration(report)).toMatch(/NOT leak-free/);
  });

  it('a one-sided set recommends nothing (it would just pick an extreme)', () => {
    const onlyRefuse = buildCalibration([guest('refuse', 0.2), guest('refuse', 0.3)]);
    const onlyAllow = buildCalibration([guest('allow', 0.8)]);
    const none = buildCalibration([signedIn('receptionist', 'refuse', 'role_manager_only')]);

    for (const r of [onlyRefuse, onlyAllow, none]) {
      expect(r.recommendation).toBeNull();
      expect(r.reason).toMatch(/at least one guest question that must be REFUSED and one that must be ALLOWED/);
    }
  });

  it('never recommends a bar at or under the 0.2 sentinel (it never closes)', () => {
    const report = buildCalibration([guest('refuse', 0.2), guest('allow', 0.9)], { thresholds: [0.1, 0.2, 0.3] });

    expect(report.recommendation?.threshold).toBe(0.3);
    expect(report.rows.find((r) => r.threshold === 0.2)).toMatchObject({ class: 'open', leaks: 1 });
  });

  it('signed-in viewers ride along: reported per audience, constant across bars, and counted in the totals', () => {
    const set = [
      guest('refuse', 0.2),
      guest('allow', 0.8),
      signedIn('receptionist', 'refuse', 'role_manager_only'),
      signedIn('receptionist', 'refuse', 'allow'), // a LEAK of the tier, whatever the guest bar
      signedIn('manager', 'allow', 'allow'),
    ];
    const report = buildCalibration(set, { currentThreshold: 0.45 });

    for (const row of report.rows) {
      expect(row.byAudience.receptionist).toMatchObject({ tp: 1, fn: 1 });
      expect(row.byAudience.manager).toMatchObject({ tn: 1 });
      expect(row.leaks).toBe(1); // the receptionist leak, at EVERY bar
    }
    expect(report.byAudience).toEqual({ guest: 2, receptionist: 2, manager: 1 });
    expect(report.thresholdSensitive).toBe(2);
    expect(report.recommendation?.leakFree).toBe(false);
    expect(report.current).toEqual({ threshold: 0.45, leaks: 1, falseRefuses: 0 });
  });

  it('identical-bar detection looks at the actual verdicts: a score between two bars splits them', () => {
    const report = buildCalibration([guest('refuse', 0.2), guest('allow', 0.62), guest('allow', 0.9)], { thresholds: [0.5, 0.6, 0.65, 0.7] });

    // 0.5 and 0.6 both allow 0.62; 0.65 and 0.7 both refuse it.
    expect(report.identical).toEqual([
      { from: 0.5, to: 0.6, thresholds: [0.5, 0.6] },
      { from: 0.65, to: 0.7, thresholds: [0.65, 0.7] },
    ]);
  });

  it('every row carries its place on the scale', () => {
    const report = buildCalibration([guest('refuse', 0.2), guest('allow', 0.9)], { thresholds: [0.2, 0.45, 0.6, 0.97] });

    expect(report.rows.map((r) => r.class)).toEqual(['open', 'floor', 'live', 'closed']);
  });
});

describe('assessMeaningfulness — is this a real measurement?', () => {
  const sample = (over: Partial<CalibrationSample>) => guest('allow', 0.8, over);

  it('real Voyage embeddings on every question: meaningful', () => {
    expect(assessMeaningfulness([sample({}), sample({})])).toMatchObject({ meaningful: true, reasons: [], providers: { voyage: 2 } });
  });

  it('the stub embedder everywhere: NOT meaningful, and the reason says the gate never closes', () => {
    const m = assessMeaningfulness([sample({ vectorProvider: 'stub' }), sample({ vectorProvider: 'stub' })]);

    expect(m.meaningful).toBe(false);
    expect(m.reasons.join(' ')).toMatch(/STUB EMBEDDINGS/);
    expect(m.reasons.join(' ')).toMatch(/never closes/);
  });

  it('keyword-only (no vector provider) is not meaningful either', () => {
    expect(assessMeaningfulness([sample({ vectorProvider: null })])).toMatchObject({ meaningful: false, providers: { none: 1 } });
  });

  it('one question measured without real embeddings spoils the run', () => {
    const m = assessMeaningfulness([sample({}), sample({ vectorProvider: 'stub' })]);

    expect(m.meaningful).toBe(false);
    expect(m.reasons[0]).toMatch(/1 of 2 questions were measured WITHOUT real embeddings/);
  });

  it('a degraded vector leg (Voyage or Qdrant failed) is not a measurement', () => {
    const m = assessMeaningfulness([sample({ degraded: true, vectorProvider: 'voyage' })]);

    expect(m).toMatchObject({ meaningful: false, degradedSamples: 1 });
    expect(m.reasons.join(' ')).toMatch(/degraded/);
  });

  it('nothing measured is not meaningful', () => {
    expect(assessMeaningfulness([]).meaningful).toBe(false);
  });

  it('the banner is loud and names the stub, and the exit code is 3', () => {
    const banner = notMeaningfulBanner(assessMeaningfulness([sample({ vectorProvider: 'stub' })]));

    expect(banner).toContain('NOT MEANINGFUL: stub embeddings — gate never closes');
    expect(banner).toMatch(/Do NOT use any number below/);
    expect(banner.split('\n')[0]).toBe('#'.repeat(78));
    expect(NOT_MEANINGFUL_EXIT_CODE).toBe(3);
  });
});

describe('parseLabelledCsv', () => {
  it('reads question, audience, expect; comments and blank lines are skipped; quotes and commas survive', () => {
    const { items, errors } = parseLabelledCsv(
      [
        '# DRAFT — to be reviewed by Go2Joy ops',
        'question,audience,expect',
        '"Làm sao đăng ký, tạo tài khoản?",guest,allow',
        '',
        'Hạn đối soát?,Guest,REFUSE',
        'Đổi tài khoản ngân hàng,receptionist,refuse',
      ].join('\r\n'),
    );

    expect(errors).toEqual([]);
    expect(items).toEqual([
      { question: 'Làm sao đăng ký, tạo tài khoản?', audience: 'guest', expect: 'allow' },
      { question: 'Hạn đối soát?', audience: 'guest', expect: 'refuse' },
      { question: 'Đổi tài khoản ngân hàng', audience: 'receptionist', expect: 'refuse' },
    ]);
  });

  it('accepts expect_gate for expect, and an optional language column', () => {
    const { items } = parseLabelledCsv('question,audience,expect_gate,language\nHow do I sign up?,guest,allow,en');

    expect(items).toEqual([{ question: 'How do I sign up?', audience: 'guest', expect: 'allow', language: 'EN' }]);
  });

  it('reports bad rows by line instead of dropping them silently', () => {
    const { items, errors } = parseLabelledCsv('question,audience,expect\nok?,guest,allow\n,guest,allow\nq,admin,allow\nq2,guest,maybe');

    expect(items).toHaveLength(1);
    expect(errors).toEqual([
      'row 3: empty question',
      'row 4: audience must be one of guest, partner, receptionist, manager',
      'row 5: expect must be allow or refuse',
    ]);
  });

  it('a file without the header says what it needs', () => {
    expect(parseLabelledCsv('q,a,e\nx,guest,allow').errors).toEqual(['the header must contain: question, audience, expect']);
  });
});

describe('formatCalibration', () => {
  it('prints the sweep, the identical run, the structure, the separation and the recommendation', () => {
    const text = formatCalibration(
      buildCalibration([guest('refuse', 0.2), guest('refuse', 0.2), guest('allow', 0.7), guest('allow', 0.9)], { currentThreshold: 0.45 }),
    );

    expect(text).toContain('Labelled questions: 4 (guest: 4); 4 are decided by the guest bar.');
    expect(text).toContain('  0.45  floor');
    expect(text).toContain('Bars that behave IDENTICALLY on this set');
    expect(text).toContain('(0.20, 0.50] ALL identical');
    expect(text).toContain('gap 0.500 — a bar can separate them');
    expect(text).toContain('RECOMMENDED GUEST_GATE_CONFIDENCE=0.70');
    expect(text).toContain('equivalent on this set: 0.45, 0.50');
    expect(text).toContain('Current bar 0.45: leaks 0, over-refusals 0.');
  });

  it('says plainly when no recommendation can be made', () => {
    expect(formatCalibration(buildCalibration([guest('allow', 0.9)]))).toMatch(/NO RECOMMENDATION/);
  });
});

describe('the starter set reference/go2joy-gate-calibration-set.csv (DRAFT, for Go2Joy ops to review)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require('path') as typeof import('path');
  const text = readFileSync(join(__dirname, '../../../../../reference/go2joy-gate-calibration-set.csv'), 'utf8');

  it('parses cleanly: every row has a question, a valid audience and a valid expectation', () => {
    const { items, errors } = parseLabelledCsv(text);

    expect(errors).toEqual([]);
    expect(items).toHaveLength(30);
  });

  it('is ~12 public, ~12 partner-only, ~6 manager-only, in Vietnamese AND English', () => {
    const { items } = parseLabelledCsv(text);
    const guestAllow = items.filter((i) => i.audience === 'guest' && i.expect === 'allow');
    const guestRefuse = items.filter((i) => i.audience === 'guest' && i.expect === 'refuse');
    const managerOnly = items.filter((i) => i.audience === 'receptionist' && i.expect === 'refuse');

    expect([guestAllow.length, guestRefuse.length, managerOnly.length]).toEqual([12, 12, 6]);
    for (const group of [guestAllow, guestRefuse, managerOnly]) {
      expect(group.some((i) => i.language === 'VI')).toBe(true);
      expect(group.some((i) => i.language === 'EN')).toBe(true);
    }
  });

  it('is marked DRAFT everywhere: the header says so and no row claims to be reviewed', () => {
    expect(text.split('\n')[0]).toMatch(/DRAFT/);
    expect(text).toMatch(/to be reviewed by Go2Joy ops|NOT yet reviewed by Go2Joy ops/);
    const rows = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#') && !l.startsWith('question,'));
    expect(rows).toHaveLength(30);
    for (const row of rows) expect(row.endsWith(',DRAFT')).toBe(true);
  });

  it('has no duplicate question', () => {
    const { items } = parseLabelledCsv(text);
    expect(new Set(items.map((i) => i.question)).size).toBe(items.length);
  });
});

describe('notMeaningfulBanner layout', () => {
  const stub = (over: Partial<CalibrationSample> = {}) => guest('allow', 0.8, { vectorProvider: 'stub', ...over });

  it('every line is a closed 78-column box and no sentence is cut off', () => {
    const banner = notMeaningfulBanner(assessMeaningfulness([stub()]));

    for (const line of banner.split('\n')) {
      expect(line).toHaveLength(78);
      expect(line.startsWith('#') && line.endsWith('#')).toBe(true);
    }
    // The long reason wraps instead of being truncated (it was, once: "as soon as one d#").
    expect(banner.replace(/#|\n/g, ' ').replace(/\s+/g, ' ')).toContain('as soon as one document matches), so the gate never closes on topic');
  });

  it('a stub-only run says stub; a mixed or degraded run says what it is', () => {
    expect(notMeaningfulBanner(assessMeaningfulness([stub(), stub()]))).toContain('NOT MEANINGFUL: stub embeddings — gate never closes');

    const mixed = notMeaningfulBanner(assessMeaningfulness([guest('allow', 0.8, { degraded: true }), stub()]));
    expect(mixed).toContain('NOT MEANINGFUL: the vector leg was not real for every question');
    expect(mixed).not.toContain('stub embeddings — gate never closes');
  });
});
