import { MODERATION_DECISION } from '@sharptalk/types';
import { KnowledgeService } from './knowledge.service';

/**
 * The simulator asks as a GATED visitor (PLN-261012 SG-51): their answer is retrieved from the
 * guest-visible categories only, so `ask()` must be able to say so — and say nothing when it is
 * not asked to (knowledge-ask-audience.spec.ts pins the unchanged operator call).
 */
describe('KnowledgeService.ask — guest scope', () => {
  const build = () => {
    const rag = { answer: jest.fn(async () => ({ text: 'ok', confidence: 0.9, citations: [] })) };
    const svc = Object.create(KnowledgeService.prototype) as KnowledgeService;
    Object.assign(svc, {
      rag,
      moderation: { moderate: jest.fn(async (p: { text: string }) => ({ decision: MODERATION_DECISION.DELIVERED, text: p.text })) },
      docRepo: { find: jest.fn(async () => []) },
      conflicts: { forDocuments: jest.fn(async () => new Set()) },
    });
    return { svc, rag };
  };
  const optsOf = (rag: { answer: jest.Mock }) => (rag.answer.mock.calls[0] as unknown[])[9];

  it('guestOnly reaches the retrieval options, next to the audience', async () => {
    const { svc, rag } = build();

    await svc.ask(1, 'how do I sign up?', 'EN', undefined, 5, null, 'public', true);

    expect(optsOf(rag)).toEqual({ audience: 'public', guestOnly: true });
  });

  it('guestOnly false or absent adds nothing: the call is the one knowledge-ask-audience.spec pins', async () => {
    const { svc, rag } = build();

    await svc.ask(1, 'q', 'EN', undefined, 5, null, 'partner', false);
    await svc.ask(1, 'q', 'EN', undefined, 5, null, 'partner');

    expect((rag.answer.mock.calls[0] as unknown[])[9]).toEqual({ audience: 'partner' });
    expect((rag.answer.mock.calls[1] as unknown[])[9]).toEqual({ audience: 'partner' });
  });

  it('with neither an audience nor a partner block nor guestOnly, opts stay undefined (the operator view)', async () => {
    const { svc, rag } = build();

    await svc.ask(1, 'q', 'EN', undefined, 5);

    expect(optsOf(rag)).toBeUndefined();
  });
});
