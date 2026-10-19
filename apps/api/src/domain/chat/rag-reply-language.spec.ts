import { RagService, replyLanguageRule } from './rag.service';

/**
 * PLN-261019-Widget-Language-Follow-Selection D4 — the answer is checked
 * against the session language and translated once when the script is wrong.
 */
describe('RagService — reply language', () => {
  const KO = '네, 시간제(Hourly) 예약 기능이 있습니다. 시간제는 시간 단위로 이용하는 예약 유형으로, 어드민에서 설정합니다.\nCITED: 1';
  const VI = 'Có, có chức năng đặt phòng theo giờ. Đặt theo giờ là loại đặt phòng tính theo giờ, cấu hình trong trang quản trị.';

  const build = (replies: string[]) => {
    const complete = jest.fn();
    for (const text of replies) {
      complete.mockResolvedValueOnce({ text, degraded: false, tokensIn: 1, tokensOut: 1, provider: 'anthropic' });
    }
    const svc = new RagService(
      { createQueryBuilder: () => ({}) } as never,
      { findOne: async () => null } as never,
      { complete } as never,
      { enabled: false, search: jest.fn() } as never,
      { getPersonaRules: jest.fn(async () => ({ persona: 'P', rules: [] })), effectiveAgentId: jest.fn(async () => 1) } as never,
    );
    (svc as unknown as { retrieveHybrid: unknown }).retrieveHybrid = async () => ({
      chunks: [{ id: 1, title: 'Hourly booking', category: 'policy', snippet: '시간제 예약 안내', similarity: 0.8 }],
      vectorProvider: 'voyage',
    });
    return { svc, complete };
  };

  it('names the language and the exceptions in one instruction', () => {
    expect(replyLanguageRule('vi')).toContain('Always reply in Vietnamese (vi)');
    expect(replyLanguageRule('VI')).toContain('even if the customer wrote in another language');
    expect(replyLanguageRule('ko')).toContain('Korean (ko)');
    // Unregistered codes still produce a usable line rather than "undefined".
    expect(replyLanguageRule('th')).toContain('TH (th)');
  });

  it('puts the rule in the answer prompt (and the old code-only line is gone)', async () => {
    const { svc, complete } = build([VI]);
    await svc.answer(4, '시간단위 예약 기능 있나요?', 'VI');
    const system = complete.mock.calls[0][0].system as string;
    expect(system).toContain('Always reply in Vietnamese (vi)');
    expect(system).not.toContain('Reply in language code');
  });

  it('translates once when the visible reply is in the wrong script, keeping the citations', async () => {
    const { svc, complete } = build([KO, VI]);
    const res = await svc.answer(4, '시간단위 예약 기능 있나요?', 'VI');
    expect(complete).toHaveBeenCalledTimes(2);
    const fix = complete.mock.calls[1][0];
    expect(fix.feature).toBe('chat_answer_language_fix');
    expect(fix.system).toContain('into Vietnamese (vi)');
    // The CITED marker was split off before the check, so the translator never saw it.
    expect(fix.messages[0].content).not.toContain('CITED');
    expect(res.text).toBe(VI);
    expect(res.citations.map((c) => c.id)).toEqual([1]);
  });

  it('keeps the original when the translation is still in the wrong script', async () => {
    const { svc, complete } = build([KO, KO]);
    const res = await svc.answer(4, 'q', 'VI');
    expect(complete).toHaveBeenCalledTimes(2);
    expect(res.text).toBe(KO.replace(/\nCITED: 1$/, ''));
  });

  it('makes no extra call when the script already matches', async () => {
    const { svc, complete } = build([VI]);
    await svc.answer(4, 'q', 'VI');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('guards answerWithoutKnowledge the same way', async () => {
    const { svc, complete } = build([KO, VI]);
    expect(await svc.answerWithoutKnowledge(4, 'smalltalk', '안녕', 'VI')).toBe(VI);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0][0].system).toContain('Always reply in Vietnamese (vi)');
  });
});
