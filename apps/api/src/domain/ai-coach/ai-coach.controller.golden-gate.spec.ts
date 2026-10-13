import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AiCoachController } from './ai-coach.controller';
import { AiCoachMapper } from './ai-coach.mapper';
import { CreateGoldenQuestionRequest, UpdateGoldenQuestionRequest } from './dto/request/golden.request';
import type { GoldenQuestion } from './entity/golden-question.entity';
import type { GoldenService } from './golden.service';

/**
 * The golden editor's two new labels (PLN-261012 SG-51) travel request -> controller -> service
 * -> response. The wire is snake_case (`expect_gate`) and the service camelCase (`expectGate`): the
 * controller is where that mapping happens, and a dropped one is a control that does nothing
 * (knowledge-ask-agent-scope.spec.ts documents that bug class).
 */
describe('golden questions — audience / expect_gate', () => {
  const user = { actorType: 'user', userId: 7, tenantId: 1, rank: 'master', labels: [] } as never;
  const row = (over: Partial<GoldenQuestion> = {}) =>
    ({ id: 3, question: 'q', language: 'VI', active: 1, expected: null, forbidden: null, partnerCtx: null, audience: null, expectGate: null, createdAt: new Date(), ...over }) as GoldenQuestion;

  const build = () => {
    const golden = {
      addQuestion: jest.fn(async () => row({ audience: 'guest', expectGate: 'refuse' })),
      updateQuestion: jest.fn(async () => row({ audience: 'manager', expectGate: 'allow' })),
    };
    const ctrl = new AiCoachController({} as never, {} as never, golden as unknown as GoldenService);
    return { ctrl, golden };
  };

  it('add: the viewer and the expectation reach the service (expect_gate -> expectGate)', async () => {
    const { ctrl, golden } = build();

    const res = await ctrl.addGolden(user, { question: 'Hạn đối soát?', audience: 'guest', expect_gate: 'refuse' } as never);

    expect(golden.addQuestion).toHaveBeenCalledWith(
      1,
      7,
      expect.objectContaining({ question: 'Hạn đối soát?', audience: 'guest', expectGate: 'refuse' }),
    );
    expect(res).toMatchObject({ audience: 'guest', expectGate: 'refuse' });
  });

  it('update: both reach the service, a blank viewer included (it clears)', async () => {
    const { ctrl, golden } = build();

    await ctrl.updateGolden(user, 3, { audience: '', expect_gate: '' } as never);

    expect(golden.updateQuestion).toHaveBeenCalledWith(1, 3, expect.objectContaining({ audience: '', expectGate: '' }));
  });

  it('update: absent stays undefined (the service reads undefined as "leave it")', async () => {
    const { ctrl, golden } = build();

    await ctrl.updateGolden(user, 3, { note: 'n' } as never);

    const input = (golden.updateQuestion.mock.calls[0] as unknown as unknown[])[2] as Record<string, unknown>;
    expect(input.audience).toBeUndefined();
    expect(input.expectGate).toBeUndefined();
  });

  it('the response carries both labels, null for an ordinary question', () => {
    expect(AiCoachMapper.toGoldenQuestion(row({ audience: 'receptionist', expectGate: 'refuse' }))).toMatchObject({
      audience: 'receptionist',
      expectGate: 'refuse',
    });
    expect(AiCoachMapper.toGoldenQuestion(row())).toMatchObject({ audience: null, expectGate: null });
  });

  describe('request validation', () => {
    const create = (extra: object) => validate(plainToInstance(CreateGoldenQuestionRequest, { question: 'a valid question', ...extra }));
    const update = (extra: object) => validate(plainToInstance(UpdateGoldenQuestionRequest, extra));

    it.each(['guest', 'partner', 'receptionist', 'manager'])('create accepts audience %s', async (audience) => {
      expect(await create({ audience })).toHaveLength(0);
    });

    it.each(['allow', 'refuse'])('create accepts expect_gate %s', async (expect_gate) => {
      expect(await create({ audience: 'guest', expect_gate })).toHaveLength(0);
    });

    it.each(['admin', 'public', '', 'Guest', 4])('create rejects audience %j', async (audience) => {
      expect((await create({ audience })).map((e) => e.property)).toContain('audience');
    });

    it.each(['guest_gate', 'deny', '', 'ALLOW', true])('create rejects expect_gate %j', async (expect_gate) => {
      expect((await create({ audience: 'guest', expect_gate })).map((e) => e.property)).toContain('expect_gate');
    });

    it('update accepts a BLANK audience and expect_gate (that is how they are cleared)', async () => {
      expect(await update({ audience: '', expect_gate: '' })).toHaveLength(0);
    });

    it('update still rejects an unknown viewer', async () => {
      expect((await update({ audience: 'admin' })).map((e) => e.property)).toContain('audience');
    });
  });
});
