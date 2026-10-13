import { MODERATION_DECISION } from '@sharptalk/types';
import { KnowledgeService } from './knowledge.service';

/**
 * The console's knowledge Q&A and the audience (PLN-261012 SG-10).
 *
 * The operator's own view sees everything (you cannot fix what is hidden from you), so
 * without an audience nothing changes. With one — which a later stream (SG-51) will let the
 * operator pick — the question must be answered exactly as a widget turn of that audience
 * would be, so the value has to reach retrieval. A control that appears to work and does
 * nothing is the failure knowledge-ask-agent-scope.spec.ts already guards against once.
 */
describe('KnowledgeService.ask — audience', () => {
  const build = () => {
    const rag = { answer: jest.fn(async () => ({ text: 'ok', confidence: 0.9, citations: [] })) };
    const moderate = jest.fn(async (p: { text: string }) => ({ decision: MODERATION_DECISION.DELIVERED, text: p.text }));
    const svc = Object.create(KnowledgeService.prototype) as KnowledgeService;
    Object.assign(svc, {
      rag,
      moderation: { moderate },
      docRepo: { find: jest.fn(async () => []) },
      conflicts: { forDocuments: jest.fn(async () => new Set()) },
    });
    return { svc, rag };
  };
  const optsOf = (rag: { answer: jest.Mock }) => (rag.answer.mock.calls[0] as unknown[])[9];

  it('without an audience the call is exactly what it was (opts undefined): the operator sees everything', async () => {
    const { svc, rag } = build();

    await svc.ask(1, 'payout deadline?', 'EN', undefined, 5);

    expect(rag.answer).toHaveBeenCalledWith(1, 'payout deadline?', 'EN', undefined, undefined, undefined, 5, undefined, undefined, undefined);
  });

  it.each(['public', 'partner', 'manager'] as const)('audience %s reaches the retrieval options', async (audience) => {
    const { svc, rag } = build();

    await svc.ask(1, 'payout deadline?', 'EN', undefined, 5, null, audience);

    expect(optsOf(rag)).toEqual({ audience });
  });

  it('is carried next to a partner-data block, not instead of it', async () => {
    const { svc, rag } = build();
    const partner = { kind: 'data', block: 'PARTNER BLOCK', protect: [] } as never;

    await svc.ask(1, 'payout deadline?', 'EN', undefined, 5, partner, 'partner');

    expect(optsOf(rag)).toEqual({ partnerData: 'PARTNER BLOCK', audience: 'partner' });
  });
});
