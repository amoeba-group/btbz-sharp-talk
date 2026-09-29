import { RagService } from './rag.service';

/**
 * What the model receives once the conversation rides along (PLN-260929 S2–S4).
 * The console paths pass no history, so their prompts must stay exactly as
 * they were — that half is pinned as carefully as the new behaviour.
 */
describe('RagService — conversation memory at the model seam', () => {
  function build(reply = 'ok') {
    const complete = jest.fn(async () => ({ text: reply, tokensIn: 1, tokensOut: 1, provider: 'stub' }));
    const svc = new RagService(
      { createQueryBuilder: () => ({}) } as never,
      { findOne: async () => null } as never,
      { complete, embed: jest.fn() } as never,
      { enabled: false, search: jest.fn() } as never,
      {
        getPersonaRules: jest.fn(async () => ({ persona: 'P', rules: [] })),
        effectiveAgentId: jest.fn(async () => 1),
      } as never,
    );
    (svc as unknown as { retrieveHybrid: unknown }).retrieveHybrid = async () => ({
      chunks: [],
      vectorProvider: null,
    });
    const call = () =>
      (complete.mock.calls[0] as unknown as [{ system: string; messages: Array<{ role: string; content: string }> }])[0];
    return { svc, call };
  }

  const HISTORY = [
    { role: 'user' as const, content: '벽걸이' },
    { role: 'assistant' as const, content: '성함과 연락처를 알려주세요' },
  ];

  describe('answer()', () => {
    it('sends the history before the current message and adds the conversation rules', async () => {
      const { svc, call } = build();

      await svc.answer(5, '김익용, [PHONE]', 'KO', undefined, undefined, undefined, null, undefined, HISTORY);

      expect(call().messages).toEqual([...HISTORY, { role: 'user', content: '김익용, [PHONE]' }]);
      expect(call().system).toContain('Never ask again for information the customer already gave');
      expect(call().system).toContain('[PHONE]');
    });

    it('leaves the single-question prompt untouched without history (console paths)', async () => {
      const { svc, call } = build();

      await svc.answer(5, 'refund?', 'EN');

      expect(call().messages).toEqual([{ role: 'user', content: 'refund?' }]);
      expect(call().system).not.toContain('Conversation rules');
    });
  });

  describe('answerWithoutKnowledge()', () => {
    it('carries the history and the rules', async () => {
      const { svc, call } = build();

      await svc.answerWithoutKnowledge(5, 'unintelligible', '1. 김익용', 'KO', null, HISTORY);

      expect(call().messages).toHaveLength(3);
      expect(call().system).toContain('Conversation rules');
    });

    it('is unchanged without history', async () => {
      const { svc, call } = build();

      await svc.answerWithoutKnowledge(5, 'smalltalk', 'hi', 'EN');

      expect(call().messages).toEqual([{ role: 'user', content: 'hi' }]);
      expect(call().system).not.toContain('Conversation rules');
    });
  });

  describe('classifyIntent()', () => {
    it('shows the recent exchange as reference text and still classifies one message', async () => {
      const { svc, call } = build('{"intent":"other","needsOrderData":false,"confidence":0.8}');

      await svc.classifyIntent(5, '1. 김익용', HISTORY);

      expect(call().messages).toEqual([{ role: 'user', content: '1. 김익용' }]);
      expect(call().system).toContain('ASSISTANT: 성함과 연락처를 알려주세요');
      expect(call().system).toContain('classify ONLY the final shopper message');
      // The stub adapter keys on this marker; the block must come after it.
      expect(call().system.startsWith('JSON_MODE:intent')).toBe(true);
    });

    it('has no conversation block without history', async () => {
      const { svc, call } = build('{"intent":"other","needsOrderData":false,"confidence":0.8}');

      await svc.classifyIntent(5, 'hi');

      expect(call().system).not.toContain('Recent conversation');
    });
  });
});
