import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChatService } from '../chat/chat.service';
import { AGENT_ID, QUESTION, makeRag } from '../chat/testing/gate-harness';
import type { World } from '../chat/testing/gate-harness';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { GateSimulatorService } from './gate-simulator.service';
import { AskKnowledgeRequest } from './dto/request/knowledge.request';

/**
 * `POST /knowledge/ask` with `as_audience` (PLN-261012 SG-51, "Test as…").
 *
 * knowledge-ask-agent-scope.spec.ts documents the failure this guards against: a console control
 * that rendered, sent its value and was dropped by the controller — "answer as this agent" quietly
 * answered as everyone, and nothing looked wrong. Here the viewer is followed all the way: request
 * -> controller -> simulator -> the retrieval scope and the answer's audience.
 */
const user = { actorType: 'user', userId: 7, tenantId: 1 } as never;

describe('KnowledgeController.ask — as_audience', () => {
  const buildSeam = (simulate: jest.Mock) => {
    const knowledgeService = { ask: jest.fn(async () => ({ answer: '', confidence: 1, blocked: false, sources: [] })) };
    const args = Array(13).fill({}) as never[];
    const ctrl = new KnowledgeController(
      knowledgeService as unknown as KnowledgeService,
      ...(args.slice(1) as never[]),
      { simulate } as unknown as GateSimulatorService,
    );
    return { ctrl, knowledgeService };
  };

  it('hands the chosen viewer, agent, language and group to the simulator', async () => {
    const simulate = jest.fn(async () => ({ answer: 'x', gate: {} }));
    const { ctrl, knowledgeService } = buildSeam(simulate);

    await ctrl.ask(user, { question: 'payout?', language: 'vi', group: 'counsel', ai_agent_id: 5, as_audience: 'receptionist' } as never);

    expect(simulate).toHaveBeenCalledWith(1, { question: 'payout?', language: 'vi', group: 'counsel', aiAgentId: 5, as: 'receptionist' });
    // The operator-view path is NOT also run (it would bill a second model call).
    expect(knowledgeService.ask).not.toHaveBeenCalled();
  });

  it.each(['guest', 'partner', 'receptionist', 'manager'])('forwards %s untouched', async (as) => {
    const simulate = jest.fn(async () => ({}));
    const { ctrl } = buildSeam(simulate);

    await ctrl.ask(user, { question: 'q', as_audience: as } as never);

    expect((simulate.mock.calls[0] as unknown[])[1]).toMatchObject({ as, aiAgentId: null, language: 'EN' });
  });

  it('WITHOUT as_audience the request is exactly what it always was (the operator\'s own view)', async () => {
    const simulate = jest.fn();
    const { ctrl, knowledgeService } = buildSeam(simulate);

    await ctrl.ask(user, { question: 'refunds?', ai_agent_id: 5 } as never);

    expect(knowledgeService.ask).toHaveBeenCalledWith(1, 'refunds?', 'EN', undefined, 5);
    expect(simulate).not.toHaveBeenCalled();
  });

  describe('request validation', () => {
    const check = async (as_audience: unknown) => validate(plainToInstance(AskKnowledgeRequest, { question: 'q', as_audience }));

    it.each(['guest', 'partner', 'receptionist', 'manager'])('accepts %s', async (v) => {
      expect(await check(v)).toHaveLength(0);
    });

    it('is optional', async () => {
      expect(await validate(plainToInstance(AskKnowledgeRequest, { question: 'q' }))).toHaveLength(0);
    });

    it.each(['admin', 'Manager', 'public', '', 3, true, ['guest']])('rejects %j', async (v) => {
      const errors = await check(v);
      expect(errors.map((e) => e.property)).toContain('as_audience');
    });
  });
});

describe('the viewer reaches retrieval and the answer, end to end (request -> controller -> simulator -> RagService)', () => {
  const world: World = {
    policy: 'open',
    tiers: true,
    guest: { confidence: 0.8 },
    audience: { confidence: 0.8, categories: ['cancellation'] },
    manager: { confidence: 0.8, categories: ['payout'] },
  };

  const build = () => {
    const rag = makeRag(world);
    const ask = jest.fn(async () => ({ answer: 'Model answer', confidence: 0.8, blocked: false, sources: [] }));
    const chat = Object.assign(Object.create(ChatService.prototype), { rag }) as ChatService;
    const simulator = new GateSimulatorService(rag as never, chat, { ask } as unknown as KnowledgeService, { find: jest.fn(async () => []) } as never);
    const ctrl = new KnowledgeController(
      { ask } as unknown as KnowledgeService,
      ...(Array(12).fill({}) as never[]),
      simulator,
    );
    return { ctrl, rag, ask };
  };

  it.each([
    ['guest', 'public'],
    ['partner', 'partner'],
    ['receptionist', 'partner'],
    ['manager', 'manager'],
  ])('as_audience=%s: retrieval is asked for audience %s and the answer is produced for it', async (as_audience, audience) => {
    const { ctrl, rag, ask } = build();

    const res = (await ctrl.ask(user, { question: QUESTION, ai_agent_id: AGENT_ID, as_audience } as never)) as { gate: { as: string; audience: string } };

    const retrievalScopes = rag.groundingReport.mock.calls.map((c) => (c[3] as { audience?: string } | undefined)?.audience);
    expect(retrievalScopes).toContain(audience);
    expect(ask.mock.calls[0][6]).toBe(audience);
    expect(res.gate).toMatchObject({ as: as_audience, audience });
  });

  it('a different viewer yields a different retrieval — the control is not decoration', async () => {
    const asReceptionist = build();
    const asManager = build();

    await asReceptionist.ctrl.ask(user, { question: QUESTION, as_audience: 'receptionist' } as never);
    await asManager.ctrl.ask(user, { question: QUESTION, as_audience: 'manager' } as never);

    const scopesOf = (h: ReturnType<typeof build>) => h.rag.groundingReport.mock.calls.map((c) => JSON.stringify(c[3]));
    expect(scopesOf(asReceptionist)).not.toEqual(scopesOf(asManager));
  });
});
