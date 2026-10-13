import { combineGrades, gradeGate, sanitizeAudience, sanitizeExpectGate, textGradeAppliesFacts } from './golden-gate-grade.util';
import { parseBulkLines } from './golden-grade.util';

describe('sanitizeAudience / sanitizeExpectGate', () => {
  it.each([
    ['guest', 'guest'],
    [' Receptionist ', 'receptionist'],
    ['MANAGER', 'manager'],
    ['partner', 'partner'],
    ['', null],
    ['admin', null],
    ['public', null],
    [undefined, null],
    [null, null],
    [3, null],
  ])('audience %j -> %j', (raw, expected) => {
    expect(sanitizeAudience(raw)).toBe(expected);
  });

  it.each([
    ['allow', 'allow'],
    [' REFUSE ', 'refuse'],
    ['guest_gate', null],
    ['', null],
    [undefined, null],
  ])('expect_gate %j -> %j', (raw, expected) => {
    expect(sanitizeExpectGate(raw)).toBe(expected);
  });
});

describe('gradeGate', () => {
  it('no expectation, or a gate that did not run: not graded', () => {
    expect(gradeGate(null, 'allow')).toEqual({ verdict: null, failedChecks: [] });
    expect(gradeGate('refuse', null)).toEqual({ verdict: null, failedChecks: [] });
  });

  it.each([
    ['allow', 'allow'],
    ['refuse', 'guest_gate'],
    ['refuse', 'role_manager_only'],
    ['refuse', 'low_confidence'],
    ['refuse', 'embedder_degraded'],
  ] as const)('expected %s, got %s: pass', (expectation, decision) => {
    expect(gradeGate(expectation, decision)).toEqual({ verdict: 'pass', failedChecks: [] });
  });

  it('expected refuse but ALLOWED is the leak, named so', () => {
    expect(gradeGate('refuse', 'allow')).toEqual({ verdict: 'fail', failedChecks: ['gate: expected refuse, got allow'] });
  });

  it('expected allow but REFUSED is the over-refusal, named so', () => {
    expect(gradeGate('allow', 'guest_gate')).toEqual({ verdict: 'fail', failedChecks: ['gate: expected allow, got guest_gate'] });
    expect(gradeGate('allow', 'embedder_degraded').verdict).toBe('fail');
  });
});

describe('combineGrades', () => {
  const pass = { verdict: 'pass' as const, failedChecks: [] };
  const fail = (c: string) => ({ verdict: 'fail' as const, failedChecks: [c] });
  const none = { verdict: null, failedChecks: [] };

  it('either failing fails the item, with every failed check listed (text first)', () => {
    expect(combineGrades(fail('missing: x'), fail('gate: expected allow, got guest_gate'))).toEqual({
      verdict: 'fail',
      failedChecks: ['missing: x', 'gate: expected allow, got guest_gate'],
    });
    expect(combineGrades(pass, fail('gate: g')).verdict).toBe('fail');
    expect(combineGrades(fail('missing: x'), pass).verdict).toBe('fail');
  });

  it('passes when something was graded and nothing failed', () => {
    expect(combineGrades(pass, none).verdict).toBe('pass');
    expect(combineGrades(none, pass).verdict).toBe('pass');
    expect(combineGrades(pass, pass).verdict).toBe('pass');
  });

  it('stays ungraded when nothing was graded — an ordinary question is untouched', () => {
    expect(combineGrades(none, none)).toEqual({ verdict: null, failedChecks: [] });
  });
});

describe('textGradeAppliesFacts', () => {
  it('a refusal that was expected: the facts are not a property of the gate\'s own notice', () => {
    expect(textGradeAppliesFacts('refuse', 'guest_gate')).toBe(false);
    expect(textGradeAppliesFacts('refuse', 'role_manager_only')).toBe(false);
  });

  it('every other case grades the text as before', () => {
    expect(textGradeAppliesFacts('refuse', 'allow')).toBe(true); // a leak: the answer is graded too
    expect(textGradeAppliesFacts('allow', 'allow')).toBe(true);
    expect(textGradeAppliesFacts('allow', 'guest_gate')).toBe(true); // an over-refusal: the text misses its facts
    expect(textGradeAppliesFacts(null, 'guest_gate')).toBe(true);
    expect(textGradeAppliesFacts(null, null)).toBe(true);
  });
});

describe('parseBulkLines — the 5th and 6th columns (viewer, gate expectation)', () => {
  it('reads them when present', () => {
    const rows = parseBulkLines('Hạn đối soát?\t\t\t\tguest\trefuse\nCách đăng ký?\t\t\t\tguest\tallow');

    expect(rows[0]).toMatchObject({ question: 'Hạn đối soát?', audience: 'guest', expectGate: 'refuse' });
    expect(rows[1]).toMatchObject({ audience: 'guest', expectGate: 'allow' });
  });

  it('leaves the keys OUT when absent or invalid (a re-paste keeps what is stored; old pastes parse as before)', () => {
    const [plain, bad] = parseBulkLines('Câu hỏi thường\t15%\nCâu hỏi khác\t\t\t\tadmin\tmaybe');

    expect(plain).not.toHaveProperty('audience');
    expect(plain).not.toHaveProperty('expectGate');
    expect(bad).not.toHaveProperty('audience');
    expect(bad).not.toHaveProperty('expectGate');
  });
});
