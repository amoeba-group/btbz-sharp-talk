import { CLI_CONTEXT_ENV, isCliContext } from './cli-context.util';

describe('isCliContext (PLN-261008 D2)', () => {
  const old = process.env[CLI_CONTEXT_ENV];
  afterEach(() => {
    if (old === undefined) delete process.env[CLI_CONTEXT_ENV];
    else process.env[CLI_CONTEXT_ENV] = old;
  });
  it('is true only when a CLI entrypoint set it', () => {
    delete process.env[CLI_CONTEXT_ENV];
    expect(isCliContext()).toBe(false);
    process.env[CLI_CONTEXT_ENV] = '1';
    expect(isCliContext()).toBe(true);
  });
});
