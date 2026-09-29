import { envNumber } from './env-number.util';

describe('envNumber (FIX-260930)', () => {
  const KEY = 'ENV_NUMBER_SPEC_KEY';
  afterEach(() => delete process.env[KEY]);

  it('uses the fallback when the key is absent', () => {
    expect(envNumber(KEY, 0.45)).toBe(0.45);
  });

  it('uses the fallback for a blank value — the production defect', () => {
    process.env[KEY] = '';
    expect(envNumber(KEY, '0.45')).toBe(0.45);
    process.env[KEY] = '   ';
    expect(envNumber(KEY, 30)).toBe(30);
  });

  it('uses the fallback for a non-number', () => {
    process.env[KEY] = 'abc';
    expect(envNumber(KEY, 7)).toBe(7);
  });

  it('honours a real value, including an explicit zero', () => {
    process.env[KEY] = '0.6';
    expect(envNumber(KEY, 0.45)).toBe(0.6);
    process.env[KEY] = '0';
    expect(envNumber(KEY, 360)).toBe(0);
  });
});
