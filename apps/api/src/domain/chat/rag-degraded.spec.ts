import { RagService } from './rag.service';

/** PLN-261007 D4 — the stub's canned text is not an answer. */
describe('RagService — degraded engine', () => {
  const build = () => {
    const svc = new RagService(
      { createQueryBuilder: () => ({}) } as never,
      { findOne: async () => null } as never,
      {
        complete: jest.fn(async () => ({ text: "Here's what I found for you: [policy] x", degraded: true, tokensIn: 1, tokensOut: 1, provider: 'stub' })),
      } as never,
      { enabled: false, search: jest.fn() } as never,
      { getPersonaRules: jest.fn(async () => ({ persona: 'P', rules: [] })), effectiveAgentId: jest.fn(async () => 1) } as never,
    );
    (svc as unknown as { retrieveHybrid: unknown }).retrieveHybrid = async () => ({
      chunks: [{ id: 1, title: 't', category: 'policy', snippet: 's', similarity: 0.7 }],
      vectorProvider: 'voyage',
    });
    return svc;
  };

  it('answer() returns no text and zero confidence so the turn is handed off', async () => {
    const res = await build().answer(4, 'How do I check in a guest?', 'EN');
    expect(res.text).toBe('');
    expect(res.confidence).toBe(0);
    expect(res.citations).toEqual([]);
  });

  it('answerWithoutKnowledge() returns empty — the caller hands off', async () => {
    expect(await build().answerWithoutKnowledge(4, 'smalltalk', 'hi', 'EN')).toBe('');
  });

  it('classifyIntent() reports a failed classification, not the stub guess', async () => {
    expect(await build().classifyIntent(4, 'where is my order')).toMatchObject({ fallback: true });
  });
});
