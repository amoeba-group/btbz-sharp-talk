import { MODERATION_DECISION } from '@sharptalk/types';
import { ModerationService, mergeProtected } from './moderation.service';

/**
 * Per-call protected values (PLN-261012 SG-31). The default mask rules — here
 * the 13-16 digit rule and the phone rule — would eat a long booking code that
 * is the whole point of a partner-data answer. The caller passes the ids of its
 * OWN trusted data block for that one call; everything else is masked as ever.
 */
describe('ModerationService — per-call protect list', () => {
  const rules = [
    { id: 18, tenantId: 4, scope: 'both', type: 'regex', patternOrPrompt: '[\\w.+-]+@[\\w-]+\\.[\\w.-]+', action: 'mask', isActive: 1 },
    { id: 19, tenantId: 4, scope: 'both', type: 'regex', patternOrPrompt: '01[016789][- ]?\\d{3,4}[- ]?\\d{4}', action: 'mask', isActive: 1 },
    { id: 20, tenantId: 4, scope: 'both', type: 'regex', patternOrPrompt: '\\b\\d{13,16}\\b', action: 'mask', isActive: 1 },
  ];
  const build = (answerFooter: unknown = null) =>
    new ModerationService(
      { find: jest.fn(async () => rules) } as never,
      { create: jest.fn((x) => x), save: jest.fn(async (x) => x) } as never,
      { complete: jest.fn() } as never,
      { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as never,
      { findOne: jest.fn(async () => ({ answerFooter })) } as never,
    );
  const input = (text: string, protect?: string[]) => ({
    tenantId: 4,
    scope: 'ai' as const,
    authorType: 'ai' as const,
    authorId: 1,
    conversationId: 1,
    text,
    ...(protect ? { protect } : {}),
  });

  const CODE = '2610140000123456'; // 16 digits
  const REF = '0101234567890'; // contains a phone-shaped run (0101234567)

  it('control: without the list the long booking code is masked', async () => {
    const res = await build().moderate(input(`Mã đặt phòng ${CODE}, tham chiếu ${REF}.`));
    expect(res.text).not.toContain(CODE);
    expect(res.text).toContain('▇▇▇');
  });

  it('leaves the ids of the trusted data block alone, and still masks everything else', async () => {
    const res = await build().moderate(
      input(`Mã ${CODE}, tham chiếu ${REF}. Khách: guest@mail.com, thẻ 4111111111111111.`, [CODE, REF]),
    );
    expect(res.text).toContain(CODE);
    expect(res.text).toContain(REF);
    expect(res.text).not.toContain('guest@mail.com');
    expect(res.text).not.toContain('4111111111111111');
    expect(res.decision).toBe(MODERATION_DECISION.EDITED);
  });

  it('delivers untouched when only protected values are present', async () => {
    const text = `Mã đặt phòng ${CODE} đã hủy.`;
    const res = await build().moderate(input(text, [CODE]));
    expect(res.text).toBe(text);
    expect(res.decision).toBe(MODERATION_DECISION.DELIVERED);
  });

  it('is for THAT call only: the next call, without the list, masks again', async () => {
    const svc = build();
    expect((await svc.moderate(input(`Mã ${CODE}`, [CODE]))).text).toContain(CODE);
    expect((await svc.moderate(input(`Mã ${CODE}`))).text).not.toContain(CODE);
  });

  it('works together with the tenant\'s own protected values (contact footer)', async () => {
    const footer = { enabled: true, text: { VI: 'Hỗ trợ: support@go2joy.vn' }, protected: [] };
    const res = await build(footer).moderate(input(`Email support@go2joy.vn, mã ${CODE}, khách guest@mail.com`, [CODE]));
    expect(res.text).toContain('support@go2joy.vn');
    expect(res.text).toContain(CODE);
    expect(res.text).not.toContain('guest@mail.com');
  });

  describe('mergeProtected', () => {
    it('returns the tenant list as is when there is no per-call list', () => {
      const tenant = ['support@go2joy.vn'];
      expect(mergeProtected(tenant)).toBe(tenant);
      expect(mergeProtected(tenant, [])).toBe(tenant);
    });

    it('merges, de-duplicates and orders longest first', () => {
      expect(mergeProtected(['abc'], ['abcdef', 'abc', 'abcd'])).toEqual(['abcdef', 'abcd', 'abc']);
    });

    it('drops entries shorter than 3 characters (they would match inside ordinary words)', () => {
      expect(mergeProtected([], ['1', 'ab', 'abc'])).toEqual(['abc']);
    });

    it('ignores non-string entries', () => {
      expect(mergeProtected([], [123 as never, 'abc'])).toEqual(['abc']);
    });
  });
});
