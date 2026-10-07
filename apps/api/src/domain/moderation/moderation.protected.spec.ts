import { MODERATION_DECISION } from '@sharptalk/types';
import { ModerationService } from './moderation.service';

/**
 * Published contacts pass the PII mask rules (PLN-261007 R2). go2joy's e-mail
 * rule (#18) masked support@go2joy.vn in 48 of 50 answers; the 13–16 digit
 * rule (#20) would have masked the account customers pay into.
 */
describe('ModerationService — protected values', () => {
  const rules = [
    { id: 18, tenantId: 4, scope: 'both', type: 'regex', patternOrPrompt: '[\\w.+-]+@[\\w-]+\\.[\\w.-]+', action: 'mask', isActive: 1 },
    { id: 20, tenantId: 4, scope: 'both', type: 'regex', patternOrPrompt: '\\b\\d{13,16}\\b', action: 'mask', isActive: 1 },
  ];
  const build = (answerFooter: unknown) =>
    new ModerationService(
      { find: jest.fn(async () => rules) } as never,
      { create: jest.fn((x) => x), save: jest.fn(async (x) => x) } as never,
      { complete: jest.fn() } as never,
      { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as never,
      { findOne: jest.fn(async () => ({ answerFooter })) } as never,
    );
  const input = (text: string) => ({ tenantId: 4, scope: 'ai' as const, authorType: 'ai' as const, authorId: 1, conversationId: 1, text });
  const footer = {
    enabled: true,
    text: { VI: 'Hỗ trợ: support@go2joy.vn · Zalo 077 789 2399' },
    protected: ['19133261136016'],
  };

  it('leaves the support e-mail and the payee account alone, masks anything else', async () => {
    const res = await build(footer).moderate(
      input('Email support@go2joy.vn, STK 19133261136016. Khách: guest@mail.com, thẻ 4111111111111111.'),
    );
    expect(res.text).toContain('support@go2joy.vn');
    expect(res.text).toContain('19133261136016');
    expect(res.text).not.toContain('guest@mail.com');
    expect(res.text).not.toContain('4111111111111111');
    expect(res.decision).toBe(MODERATION_DECISION.EDITED);
  });

  it('delivers untouched when only protected values are present', async () => {
    const text = 'Liên hệ support@go2joy.vn';
    const res = await build(footer).moderate(input(text));
    expect(res.text).toBe(text);
    expect(res.decision).toBe(MODERATION_DECISION.DELIVERED);
  });

  it('masks as before when the tenant has no footer', async () => {
    const res = await build(null).moderate(input('Email support@go2joy.vn'));
    expect(res.text).not.toContain('support@go2joy.vn');
  });
});
