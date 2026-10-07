import { DEFAULT_FORBIDDEN, gradeAnswer, normalizeForGrade, parseBulkLines, sanitizeChecks } from './golden-grade.util';

/** PLN-261007 R7 — facts give a verdict; wording does not. */
describe('gradeAnswer', () => {
  it('passes when every expected fact is present, ignoring case and markdown emphasis', () => {
    const r = gradeAnswer('Số tài khoản: **19133261136016**, ngân hàng TECHCOMBANK', ['19133261136016', 'Techcombank'], null);
    expect(r).toEqual({ verdict: 'pass', failedChecks: [] });
  });

  it('names the missing facts', () => {
    expect(gradeAnswer('Đã thanh toán only', ['Chưa thanh toán', 'Đã thanh toán'], null)).toEqual({
      verdict: 'fail',
      failedChecks: ['missing: Chưa thanh toán'],
    });
  });

  it('fails on the built-in masks and on the question’s own forbidden text', () => {
    expect(gradeAnswer('Email ▇▇▇', ['Email'], null).failedChecks).toEqual(['forbidden: ▇▇▇']);
    expect(gradeAnswer('gọi [PHONE]', ['gọi'], null).verdict).toBe('fail');
    expect(gradeAnswer('liên hệ partner manager', ['liên hệ'], ['partner manager']).failedChecks).toEqual([
      'forbidden: partner manager',
    ]);
    expect(DEFAULT_FORBIDDEN).toContain('▇▇▇');
  });

  it('gives no verdict without expected facts (old diff-only behaviour)', () => {
    expect(gradeAnswer('Email ▇▇▇', null, null)).toEqual({ verdict: null, failedChecks: [] });
  });

  it('normalizes "ngày **17**" to match "ngày 17"', () => {
    expect(normalizeForGrade('Ngày **17**  tháng')).toBe('ngày 17 tháng');
  });
});

describe('parseBulkLines / sanitizeChecks', () => {
  it('reads question ⇥ facts ⇥ forbidden, skipping blanks and comments', () => {
    const rows = parseBulkLines(
      '# header\nTôi có thể thanh toán cho Go2Joy như nào?\tTechcombank|19133261136016\n\nHoa hồng bao nhiêu?\t15%\tpartner manager\nx',
    );
    expect(rows).toEqual([
      { question: 'Tôi có thể thanh toán cho Go2Joy như nào?', expected: ['Techcombank', '19133261136016'], forbidden: null },
      { question: 'Hoa hồng bao nhiêu?', expected: ['15%'], forbidden: ['partner manager'] },
    ]);
  });

  it('drops non-strings, blanks and duplicates, caps the list', () => {
    expect(sanitizeChecks([' a ', 'a', '', 7, 'b'])).toEqual(['a', 'b']);
    expect(sanitizeChecks([])).toBeNull();
    expect(sanitizeChecks('a')).toBeNull();
    expect(sanitizeChecks(Array.from({ length: 20 }, (_, i) => `f${i}`))).toHaveLength(10);
  });
});
