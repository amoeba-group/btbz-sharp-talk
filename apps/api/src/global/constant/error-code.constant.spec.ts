import { ERROR_CODE } from './error-code.constant';

/**
 * Every Exxxx code is unique. Several streams allocate codes in parallel blocks (PLN-261012 SG-xx) and
 * merge afterwards; a code reused by two entries makes the client localise the wrong message, and
 * nothing else would notice.
 */
describe('ERROR_CODE', () => {
  it('has no code used by two entries', () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const [name, entry] of Object.entries(ERROR_CODE)) {
      const other = seen.get(entry.code);
      if (other) duplicates.push(`${entry.code}: ${other} and ${name}`);
      seen.set(entry.code, name);
    }
    expect(duplicates).toEqual([]);
  });

  it('every code is E + 4 digits and has a non-empty English message', () => {
    for (const [name, entry] of Object.entries(ERROR_CODE)) {
      expect({ name, ok: /^E\d{4}$/.test(entry.code) && entry.message.trim().length > 0 }).toEqual({ name, ok: true });
    }
  });

  it('the pilot analytics block (E5140-E5141) is what the console localises by', () => {
    expect(ERROR_CODE.PILOT_ANALYTICS_QUERY_INVALID.code).toBe('E5140');
    expect(ERROR_CODE.PILOT_ANALYTICS_WINDOW_TOO_LONG.code).toBe('E5141');
  });
});
