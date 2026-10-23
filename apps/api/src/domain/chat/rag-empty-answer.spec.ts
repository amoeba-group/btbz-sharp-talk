import { RagService } from './rag.service';

/** FIX-261023-AI-Empty-Answer — an empty reply is retried once, then is not an answer. */
describe('RagService — empty reply', () => {
  const ok = (text: string) => ({ text, tokensIn: 1, tokensOut: 1, provider: 'anthropic', model: 'm' });
  const build = (...replies: string[]) => {
    const complete = jest.fn();
    for (const r of replies) complete.mockResolvedValueOnce(ok(r));
    const svc = new RagService(
      { createQueryBuilder: () => ({}) } as never,
      { findOne: async () => null } as never,
      { complete } as never,
      { enabled: false, search: jest.fn() } as never,
      { getPersonaRules: jest.fn(async () => ({ persona: 'P', rules: [] })), effectiveAgentId: jest.fn(async () => 1) } as never,
    );
    (svc as unknown as { retrieveHybrid: unknown }).retrieveHybrid = async () => ({
      chunks: [{ id: 1, title: 't', category: 'booking', snippet: 's', similarity: 0.76 }],
      vectorProvider: 'voyage',
    });
    return { svc, complete };
  };

  it('retries once when only the CITED line came back, and delivers the retry', async () => {
    const { svc, complete } = build('CITED: 1', 'Open Trang chủ.\nCITED: 1');
    const res = await svc.answer(4, "View today's bookings", 'EN');
    expect(complete).toHaveBeenCalledTimes(2);
    expect(res.text).toBe('Open Trang chủ.');
    expect(res.confidence).toBeGreaterThan(0.45);
  });

  it('returns no text and zero confidence when the retry is empty too', async () => {
    const { svc, complete } = build('', '  ');
    const res = await svc.answer(4, "View today's bookings", 'EN');
    expect(complete).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ text: '', confidence: 0, citations: [] });
  });

  it('does not retry a reply that has text', async () => {
    const { svc, complete } = build('Open Trang chủ.\nCITED: 1');
    await svc.answer(4, "View today's bookings", 'EN');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('answerWithoutKnowledge() retries an empty reply once', async () => {
    const { svc, complete } = build('', 'Hello!');
    expect(await svc.answerWithoutKnowledge(4, 'smalltalk', 'hi', 'EN')).toBe('Hello!');
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
