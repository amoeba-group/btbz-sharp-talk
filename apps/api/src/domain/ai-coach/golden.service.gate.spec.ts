import { HttpStatus } from '@nestjs/common';
import { GoldenService } from './golden.service';
import { GOLDEN_RUN_KIND } from './entity/golden-run.entity';
import type { GoldenQuestion } from './entity/golden-question.entity';
import type { GoldenRunItem } from './entity/golden-run.entity';
import type { KnowledgeService } from '../knowledge/knowledge.service';
import type { GateSimulatorService } from '../knowledge/gate-simulator.service';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/**
 * Golden questions asked AS a viewer (PLN-261012 SG-51): the run records the gate's decision per
 * item and grades `expect_gate`. A question with no `audience` is asked exactly as before.
 */
describe('GoldenService — gate', () => {
  const q = (id: number, question: string, extra: Partial<GoldenQuestion> = {}) =>
    ({ id, question, language: 'VI', active: 1, audience: null, expectGate: null, ...extra }) as GoldenQuestion;

  interface Sim {
    decision?: string;
    answer?: string;
    confidence?: number | null;
    threshold?: number;
    topSimilarity?: number | null;
    vectorProvider?: string | null;
    degraded?: boolean;
    throws?: string;
  }

  const build = (questions: GoldenQuestion[], sim: Sim | ((as: string) => Sim) = {}, withSimulator = true) => {
    const simulated: Array<Record<string, unknown>> = [];
    const askedPlain: string[] = [];
    const savedItems: GoldenRunItem[] = [];
    const savedQuestions: GoldenQuestion[] = [];
    let nextId = 1;
    const questionRepo = {
      find: async () => questions,
      findOne: async ({ where }: { where: { id: number } }) => questions.find((x) => x.id === where.id) ?? null,
      create: (v: Partial<GoldenQuestion>) => ({ id: 1000 + nextId++, ...v }) as GoldenQuestion,
      save: async (v: GoldenQuestion) => {
        savedQuestions.push(v);
        return v;
      },
    };
    const runRepo = { create: (v: object) => ({ id: nextId++, ...v }), save: async (r: object) => r };
    const itemRepo = {
      create: (v: Partial<GoldenRunItem>) => v as GoldenRunItem,
      save: async (i: GoldenRunItem) => {
        savedItems.push(i);
        return i;
      },
    };
    const knowledge = {
      ask: async (_t: number, question: string) => {
        askedPlain.push(question);
        return { answer: 'plain answer', confidence: 0.7, blocked: false, sources: [] };
      },
    } as unknown as KnowledgeService;
    const simulator = {
      simulate: async (_t: number, input: Record<string, unknown>) => {
        simulated.push(input);
        const s = typeof sim === 'function' ? sim(String(input.as)) : sim;
        if (s.throws) throw new Error(s.throws);
        const decision = s.decision ?? 'allow';
        return {
          answer: s.answer ?? (decision === 'allow' ? 'Model answer' : 'Please sign in.'),
          confidence: s.confidence === undefined ? 0.8 : s.confidence,
          blocked: false,
          sources: [],
          gate: {
            as: input.as,
            decision,
            refused: decision !== 'allow',
            confidence: s.confidence === undefined ? 0.8 : s.confidence,
            threshold: s.threshold ?? 0.45,
            topSimilarity: s.topSimilarity === undefined ? 0.8 : s.topSimilarity,
            vectorProvider: s.vectorProvider === undefined ? 'voyage' : s.vectorProvider,
            degraded: s.degraded === true,
          },
        };
      },
    } as unknown as GateSimulatorService;
    const service = new GoldenService(
      questionRepo as never,
      runRepo as never,
      itemRepo as never,
      { getConfig: async () => ({ persona: 'p', rules: [], scenarioOverrides: {} }) } as never,
      knowledge,
      undefined,
      withSimulator ? simulator : undefined,
    );
    return { service, simulated, askedPlain, savedItems, savedQuestions };
  };

  describe('a run', () => {
    it('asks a viewer question through the gate simulator, as that viewer, on the run\'s agent', async () => {
      const { service, simulated, askedPlain } = build([q(1, 'Hạn đối soát?', { audience: 'guest', expectGate: 'refuse' })]);

      await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL, { aiAgentId: 5 });

      expect(simulated).toEqual([{ question: 'Hạn đối soát?', language: 'VI', aiAgentId: 5, as: 'guest', partner: null }]);
      expect(askedPlain).toEqual([]);
    });

    it('asks an ordinary question exactly as before: no simulator, gate columns all NULL', async () => {
      const { service, simulated, askedPlain, savedItems } = build([q(1, 'Chính sách hoàn tiền?')]);

      await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);

      expect(simulated).toEqual([]);
      expect(askedPlain).toEqual(['Chính sách hoàn tiền?']);
      expect(savedItems[0]).toMatchObject({
        audience: null,
        expectGate: null,
        gateDecision: null,
        gateConfidence: null,
        gateThreshold: null,
        gateTopSimilarity: null,
        gateVectorProvider: null,
        verdict: null,
      });
    });

    it('records the gate per item: viewer, expectation as asked, decision, figures, provider', async () => {
      const { service, savedItems } = build(
        [q(1, 'Hạn đối soát?', { audience: 'guest', expectGate: 'refuse' })],
        { decision: 'guest_gate', confidence: 0.2, topSimilarity: 0.31 },
      );

      await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);

      expect(savedItems[0]).toMatchObject({
        audience: 'guest',
        expectGate: 'refuse',
        gateDecision: 'guest_gate',
        gateConfidence: 0.2,
        gateThreshold: 0.45,
        gateTopSimilarity: 0.31,
        gateVectorProvider: 'voyage',
        answer: 'Please sign in.',
        confidence: 0.2,
      });
    });

    it('a degraded measurement is recorded as provider "degraded", an absent one as "none"', async () => {
      const degraded = build([q(1, 'a?', { audience: 'guest' })], { decision: 'embedder_degraded', confidence: 0.2, vectorProvider: null, degraded: true });
      const none = build([q(1, 'a?', { audience: 'guest' })], { vectorProvider: null });

      await degraded.service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);
      await none.service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);

      expect(degraded.savedItems[0].gateVectorProvider).toBe('degraded');
      expect(none.savedItems[0].gateVectorProvider).toBe('none');
    });
  });

  describe('grading expect_gate', () => {
    it.each([
      ['refuse', 'guest_gate', 'pass'],
      ['refuse', 'role_manager_only', 'pass'],
      ['allow', 'allow', 'pass'],
    ])('expect %s, decision %s -> %s', async (expectGate, decision, verdict) => {
      const { service, savedItems } = build([q(1, 'x?', { audience: 'guest', expectGate })], { decision });

      const run = await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);

      expect(savedItems[0].verdict).toBe(verdict);
      expect(savedItems[0].failedChecks).toBeNull();
      expect(run.passCount).toBe(1);
      expect(run.failCount).toBe(0);
    });

    it('expect refuse but the gate ALLOWED: a leak, failed and named', async () => {
      const { service, savedItems } = build([q(1, 'x?', { audience: 'guest', expectGate: 'refuse' })], { decision: 'allow' });

      const run = await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);

      expect(savedItems[0].verdict).toBe('fail');
      expect(savedItems[0].failedChecks).toEqual(['gate: expected refuse, got allow']);
      expect(run.failCount).toBe(1);
    });

    it('expect allow but the gate REFUSED: an over-refusal, failed and named', async () => {
      const { service, savedItems } = build([q(1, 'x?', { audience: 'guest', expectGate: 'allow' })], { decision: 'guest_gate' });

      await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);

      expect(savedItems[0].failedChecks).toEqual(['gate: expected allow, got guest_gate']);
    });

    it('an outage reads as a refusal: expect allow + embedder_degraded fails, expect refuse passes', async () => {
      const allow = build([q(1, 'x?', { audience: 'guest', expectGate: 'allow' })], { decision: 'embedder_degraded' });
      const refuse = build([q(1, 'x?', { audience: 'guest', expectGate: 'refuse' })], { decision: 'embedder_degraded' });

      await allow.service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);
      await refuse.service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);

      expect(allow.savedItems[0].verdict).toBe('fail');
      expect(refuse.savedItems[0].verdict).toBe('pass');
    });

    it('no expectation: the decision is recorded but the item is not graded (NULL = not graded)', async () => {
      const { service, savedItems } = build([q(1, 'x?', { audience: 'receptionist' })], { decision: 'role_manager_only' });

      const run = await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);

      expect(savedItems[0]).toMatchObject({ gateDecision: 'role_manager_only', expectGate: null, verdict: null });
      expect(run.passCount + run.failCount).toBe(0);
    });

    it('a refusal that was EXPECTED does not fail on the question\'s listed facts (they are not in the notice)', async () => {
      const { service, savedItems } = build(
        [q(1, 'Đối soát?', { audience: 'guest', expectGate: 'refuse', expected: ['15 ngày'] })],
        { decision: 'guest_gate' },
      );

      await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);

      expect(savedItems[0].verdict).toBe('pass');
    });

    it('an ALLOWED answer is still graded on its facts, next to the gate', async () => {
      const ok = build(
        [q(1, 'Đăng ký?', { audience: 'guest', expectGate: 'allow', expected: ['email'] })],
        { decision: 'allow', answer: 'Dùng email để đăng ký' },
      );
      const missing = build(
        [q(1, 'Đăng ký?', { audience: 'guest', expectGate: 'allow', expected: ['email'] })],
        { decision: 'allow', answer: 'Hãy liên hệ chúng tôi' },
      );

      await ok.service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);
      await missing.service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);

      expect(ok.savedItems[0].verdict).toBe('pass');
      expect(missing.savedItems[0].verdict).toBe('fail');
      expect(missing.savedItems[0].failedChecks).toEqual(['missing: email']);
    });

    it('both failing is both reported', async () => {
      const { service, savedItems } = build(
        [q(1, 'Đăng ký?', { audience: 'guest', expectGate: 'refuse', expected: ['email'] })],
        { decision: 'allow', answer: 'Hãy liên hệ chúng tôi' },
      );

      await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);

      expect(savedItems[0].failedChecks).toEqual(['missing: email', 'gate: expected refuse, got allow']);
    });
  });

  describe('failure handling', () => {
    it('a question that cannot be run as a viewer is a recorded error, and FAILS when it was graded', async () => {
      const { service, savedItems } = build([q(1, 'x?', { audience: 'guest', expectGate: 'refuse' }), q(2, 'ordinary')], { throws: 'engine down' });

      const run = await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);

      expect(savedItems).toHaveLength(2);
      expect(savedItems[0]).toMatchObject({ error: 'engine down', verdict: 'fail', failedChecks: ['error'], audience: 'guest', expectGate: 'refuse' });
      expect(run.failCount).toBe(1);
      expect(savedItems[1].error).toBeUndefined(); // the next question still ran
    });

    it('with no simulator available a viewer question is a recorded error, never silently asked without the viewer', async () => {
      const { service, askedPlain, savedItems } = build([q(1, 'x?', { audience: 'guest', expectGate: 'allow' })], {}, false);

      await service.run(1, 9, GOLDEN_RUN_KIND.MANUAL);

      expect(askedPlain).toEqual([]);
      expect(savedItems[0].error).toMatch(/gate simulation is not available/);
      expect(savedItems[0].verdict).toBe('fail');
    });
  });

  describe('storing the labels', () => {
    it('add: keeps a valid viewer and expectation, drops an invalid viewer', async () => {
      const { service } = build([]);

      const ok = await service.addQuestion(1, 9, { question: 'Hạn đối soát?', audience: 'Guest', expectGate: 'REFUSE' });
      const bad = await service.addQuestion(1, 9, { question: 'Hạn đối soát?', audience: 'admin' });

      expect(ok).toMatchObject({ audience: 'guest', expectGate: 'refuse' });
      expect(bad).toMatchObject({ audience: null, expectGate: null });
    });

    it('add: an expectation with no viewer is refused (E5145), not silently stored', async () => {
      const { service } = build([]);

      await expect(service.addQuestion(1, 9, { question: 'Hạn đối soát?', expectGate: 'refuse' })).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        errorCode: ERROR_CODE.GOLDEN_GATE_NEEDS_AUDIENCE.code,
      });
    });

    it('update: set, change and clear; clearing the viewer clears its expectation; absent leaves both', async () => {
      const row = q(1, 'x?', { audience: 'guest', expectGate: 'refuse' });
      const { service } = build([row]);

      expect(await service.updateQuestion(1, 1, { note: 'n' })).toMatchObject({ audience: 'guest', expectGate: 'refuse' });
      expect(await service.updateQuestion(1, 1, { expectGate: 'allow' })).toMatchObject({ audience: 'guest', expectGate: 'allow' });
      expect(await service.updateQuestion(1, 1, { audience: 'manager', expectGate: 'allow' })).toMatchObject({ audience: 'manager' });
      expect(await service.updateQuestion(1, 1, { audience: '' })).toMatchObject({ audience: null, expectGate: null });
    });

    it('update: an expectation with no viewer is refused', async () => {
      const { service } = build([q(1, 'x?')]);

      await expect(service.updateQuestion(1, 1, { expectGate: 'refuse' })).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });

    it('bulk paste: 5th/6th columns set the viewer and expectation; a re-paste without them leaves them', async () => {
      const row = q(1, 'Hạn đối soát?', { audience: 'guest', expectGate: 'refuse' });
      const { service, savedQuestions } = build([row]);

      await service.bulkImport(1, 9, { text: 'Hạn đối soát?\t\t\t\t\t\nCách đăng ký?\t\t\t\tguest\tallow' });

      expect(row).toMatchObject({ audience: 'guest', expectGate: 'refuse' }); // untouched by the blank re-paste
      expect(savedQuestions.find((s) => s.question === 'Cách đăng ký?')).toMatchObject({ audience: 'guest', expectGate: 'allow' });
    });
  });
});
