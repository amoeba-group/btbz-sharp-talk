import {
  footerFor,
  footerVariants,
  protectedValuesOf,
  sanitizeAnswerFooter,
  shieldProtected,
  stripFooters,
} from './answer-footer.util';

/** PLN-261007-Go2Joy-FAQ-Accuracy R2/R4. */
const GO2JOY_VI =
  '📞 Hỗ trợ Go2Joy: support@go2joy.vn · Hotline 1900 638 838\nZalo/Hotline 077 789 2399 (miền Bắc) / 0931 836 836 (miền Nam)';

describe('sanitizeAnswerFooter', () => {
  it('keeps the allowed shape only', () => {
    const f = sanitizeAnswerFooter({
      enabled: true,
      text: { vi: ` ${GO2JOY_VI} `, xx1: 'bad', EN: 123 },
      protected: ['19133261136016', '19133261136016', 'ab', 7],
      evil: 'x',
    });
    expect(f).toEqual({ enabled: true, text: { VI: GO2JOY_VI }, protected: ['19133261136016'] });
  });

  it('is null for nothing and disabled unless enabled === true', () => {
    expect(sanitizeAnswerFooter(null)).toBeNull();
    expect(sanitizeAnswerFooter({ enabled: 'yes', text: { EN: 'x' } })?.enabled).toBe(false);
  });
});

describe('footerFor', () => {
  const f = { enabled: true, text: { VI: 'vi footer', EN: 'en footer' }, protected: [] };
  it('uses the session language, then EN, then the first written', () => {
    expect(footerFor(f, 'VI')).toBe('vi footer');
    expect(footerFor(f, 'ko')).toBe('en footer');
    expect(footerFor({ ...f, text: { VI: 'vi footer' } }, 'KO')).toBe('vi footer');
  });
  it('is null when off or empty', () => {
    expect(footerFor({ ...f, enabled: false }, 'VI')).toBeNull();
    expect(footerFor({ enabled: true, text: {}, protected: [] }, 'VI')).toBeNull();
    expect(footerFor(null, 'VI')).toBeNull();
  });
});

describe('protectedValuesOf / shieldProtected', () => {
  const footer = { enabled: true, text: { VI: GO2JOY_VI }, protected: ['19133261136016'] };

  it('takes the explicit list plus e-mails and numbers in the footer', () => {
    const v = protectedValuesOf(footer);
    expect(v).toEqual(
      expect.arrayContaining(['support@go2joy.vn', '077 789 2399', '0931 836 836', '1900 638 838', '19133261136016']),
    );
  });

  it('round-trips text through placeholders that carry no @ and no digit runs', () => {
    const text = 'Chuyển khoản STK 19133261136016 hoặc email support@go2joy.vn, Zalo 077 789 2399.';
    const s = shieldProtected(text, protectedValuesOf(footer));
    expect(s.text).not.toMatch(/@|\d{6,}/);
    expect(s.restore(s.text)).toBe(text);
  });

  it('is a no-op without values', () => {
    const s = shieldProtected('a@b.com', []);
    expect(s.text).toBe('a@b.com');
  });
});

describe('footerVariants / stripFooters', () => {
  it('lists the texts of an enabled footer only', () => {
    expect(footerVariants({ enabled: true, text: { VI: ' a ', EN: 'b' }, protected: [] })).toEqual(['a', 'b']);
    expect(footerVariants({ enabled: false, text: { VI: 'a' }, protected: [] })).toEqual([]);
  });
  it('removes verbatim copies and tidies blank lines', () => {
    expect(stripFooters('Body.\n\nFOOT\n\nFOOT', ['FOOT'])).toBe('Body.');
    expect(stripFooters('Body.', ['FOOT'])).toBe('Body.');
  });
});
