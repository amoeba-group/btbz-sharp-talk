import {
  buildHistory,
  hasAssistantTurn,
  replacePiiTokens,
  transcript,
  withCurrentTurn,
} from './conversation-history.util';

describe('buildHistory (PLN-260929 S1)', () => {
  it('maps roles, drops system turns and prefixes agent turns', () => {
    const out = buildHistory([
      { senderType: 'user', body: '에어컨 청소 예약가능?' },
      { senderType: 'system', body: 'consent notice' },
      { senderType: 'ai', body: '종류를 알려주세요' },
      { senderType: 'user', body: '벽걸이' },
      { senderType: 'agent', body: '제가 도와드릴게요' },
    ]);
    expect(out).toEqual([
      { role: 'user', content: '에어컨 청소 예약가능?' },
      { role: 'assistant', content: '종류를 알려주세요' },
      { role: 'user', content: '벽걸이' },
      { role: 'assistant', content: '[Agent] 제가 도와드릴게요' },
    ]);
  });

  it('removes a leading assistant turn so the first message is the user', () => {
    const out = buildHistory([
      { senderType: 'ai', body: 'Hello! How can I help?' },
      { senderType: 'user', body: 'Hi' },
    ]);
    expect(out[0]).toEqual({ role: 'user', content: 'Hi' });
    expect(out).toHaveLength(1);
  });

  it('merges same-role neighbours left behind by dropped system turns', () => {
    const out = buildHistory([
      { senderType: 'user', body: 'a' },
      { senderType: 'system', body: 'handoff' },
      { senderType: 'user', body: 'b' },
    ]);
    expect(out).toEqual([{ role: 'user', content: 'a\nb' }]);
  });

  it('skips empty bodies (file-only turns)', () => {
    const out = buildHistory([
      { senderType: 'user', body: '   ' },
      { senderType: 'user', body: 'x' },
    ]);
    expect(out).toEqual([{ role: 'user', content: 'x' }]);
  });

  it('scrubs PII before anything reaches the provider', () => {
    const out = buildHistory([{ senderType: 'user', body: '연락처 010-1234-5678, a@b.com' }]);
    expect(out[0].content).not.toContain('010-1234-5678');
    expect(out[0].content).not.toContain('a@b.com');
    expect(out[0].content).toContain('[PHONE]');
    expect(out[0].content).toContain('[EMAIL]');
  });

  it('keeps the newest turns within the budget and trims the oldest kept one from the front', () => {
    const out = buildHistory(
      [
        { senderType: 'user', body: 'old-question' },
        { senderType: 'ai', body: 'x'.repeat(20) },
        { senderType: 'user', body: 'newest' },
      ],
      30,
    );
    // 'newest' (6) + the ai turn (20) = 26; 4 chars remain → tail of 'old-question'
    expect(out[out.length - 1]).toEqual({ role: 'user', content: 'newest' });
    expect(out[0]).toEqual({ role: 'user', content: 'tion' });
  });

  it('returns nothing for an empty conversation', () => {
    expect(buildHistory([])).toEqual([]);
  });
});

describe('withCurrentTurn', () => {
  it('appends the current message as the user', () => {
    expect(withCurrentTurn([{ role: 'assistant', content: 'q?' }], 'a')).toEqual([
      { role: 'assistant', content: 'q?' },
      { role: 'user', content: 'a' },
    ]);
  });

  it('merges when the history already ends on the user', () => {
    expect(withCurrentTurn([{ role: 'user', content: 'a' }], 'b')).toEqual([
      { role: 'user', content: 'a\nb' },
    ]);
  });

  it('is the single-message array without history (console paths unchanged)', () => {
    expect(withCurrentTurn(undefined, 'q')).toEqual([{ role: 'user', content: 'q' }]);
  });

  it('does not mutate the history it is given', () => {
    const history = [{ role: 'user' as const, content: 'a' }];
    withCurrentTurn(history, 'b');
    expect(history[0].content).toBe('a');
  });
});

describe('hasAssistantTurn / transcript', () => {
  it('detects whether the shop has spoken', () => {
    expect(hasAssistantTurn(undefined)).toBe(false);
    expect(hasAssistantTurn([{ role: 'user', content: 'a' }])).toBe(false);
    expect(hasAssistantTurn([{ role: 'assistant', content: 'b' }])).toBe(true);
  });

  it('renders a one-line-per-turn transcript', () => {
    expect(
      transcript([
        { role: 'assistant', content: 'Which type?\nWall or stand' },
        { role: 'user', content: 'wall' },
      ]),
    ).toBe('ASSISTANT: Which type? Wall or stand\nSHOPPER: wall');
  });
});

describe('replacePiiTokens (PLN-260929 S7)', () => {
  it('replaces tokens with a phrase in the session language', () => {
    expect(replacePiiTokens('- **연락처**: [PHONE]', 'KO')).toBe('- **연락처**: 말씀하신 연락처');
    expect(replacePiiTokens('Email: [EMAIL], [ADDR]', 'EN')).toBe(
      'Email: the email you provided, the address you provided',
    );
  });

  it('falls back to English for an unknown language and leaves other brackets alone', () => {
    expect(replacePiiTokens('[ORDER] [NOTE]', 'XX')).toBe('the order number you provided [NOTE]');
  });

  it('is a no-op on clean text', () => {
    expect(replacePiiTokens('안녕하세요', 'KO')).toBe('안녕하세요');
  });
});
