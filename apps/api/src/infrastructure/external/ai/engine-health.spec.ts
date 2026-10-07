import {
  ENGINE_FAILURE,
  ENGINE_HEALTH,
  classifyEngineFailure,
  engineHealth,
  providerErrorSummary,
} from './engine-health';

/** PLN-261007 S2/S3 — the vocabulary both consoles read engines by. */
describe('classifyEngineFailure', () => {
  it.each([
    // The go2joy outage, verbatim from the provider (2026-10-06).
    [
      'Anthropic API error 400: invalid_request_error: Your credit balance is too low to access the Anthropic API.',
      ENGINE_FAILURE.CREDIT,
    ],
    ['OpenAI API error 429: insufficient_quota: You exceeded your current quota', ENGINE_FAILURE.CREDIT],
    ['401 Unauthorized', ENGINE_FAILURE.AUTH],
    ['Anthropic API key not configured', ENGINE_FAILURE.AUTH],
    ['404 model not_found', ENGINE_FAILURE.MODEL],
    ['429 rate_limit_error', ENGINE_FAILURE.RATE_LIMIT],
    ['Failed to parse URL from fremd@naver.com', ENGINE_FAILURE.UNREACHABLE],
  ])('%s → %s', (message, expected) => {
    expect(classifyEngineFailure(message)).toBe(expected);
  });

  it('reads credit before the status code — Anthropic sends it as a 400, OpenAI as a 429', () => {
    expect(classifyEngineFailure('429 insufficient_quota')).toBe(ENGINE_FAILURE.CREDIT);
  });
});

describe('engineHealth', () => {
  const base = {
    provider: 'anthropic',
    status: 'enabled',
    hasKey: true,
    lastOkAt: null as Date | null,
    lastErrorAt: null as Date | null,
    lastErrorReason: null as string | null,
  };
  const t = (iso: string) => new Date(iso);

  it('stub, disabled and keyless come before any history', () => {
    expect(engineHealth({ ...base, provider: 'stub' })).toBe(ENGINE_HEALTH.STUB);
    expect(engineHealth({ ...base, status: 'disabled' })).toBe(ENGINE_HEALTH.DISABLED);
    expect(engineHealth({ ...base, hasKey: false })).toBe(ENGINE_HEALTH.NO_KEY);
  });

  it('is unknown until something has been tried', () => {
    expect(engineHealth(base)).toBe(ENGINE_HEALTH.UNKNOWN);
  });

  it('reports the failure when it is newer than the last success', () => {
    expect(
      engineHealth({
        ...base,
        lastOkAt: t('2026-10-06T13:03:00Z'),
        lastErrorAt: t('2026-10-06T19:06:00Z'),
        lastErrorReason: 'credit',
      }),
    ).toBe(ENGINE_HEALTH.CREDIT);
  });

  it('recovers once a success follows the failure', () => {
    expect(
      engineHealth({
        ...base,
        lastOkAt: t('2026-10-07T09:00:00Z'),
        lastErrorAt: t('2026-10-06T19:06:00Z'),
        lastErrorReason: 'credit',
      }),
    ).toBe(ENGINE_HEALTH.OK);
  });

  it('treats an unrecognised stored reason as unreachable rather than echoing it', () => {
    expect(
      engineHealth({ ...base, lastErrorAt: t('2026-10-06T19:06:00Z'), lastErrorReason: 'weird' }),
    ).toBe(ENGINE_HEALTH.UNREACHABLE);
  });
});

describe('providerErrorSummary', () => {
  it('keeps the provider type and message from a JSON body', () => {
    const body =
      '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low."},"request_id":"req_1"}';
    expect(providerErrorSummary(body)).toBe('invalid_request_error: Your credit balance is too low.');
  });

  it('uses the OpenAI code when there is no type', () => {
    expect(providerErrorSummary('{"error":{"code":"insufficient_quota","message":"quota"}}')).toBe(
      'insufficient_quota: quota',
    );
  });

  it('falls back to the raw text, single line and capped', () => {
    const out = providerErrorSummary(`bad\n gateway ${'x'.repeat(300)}`);
    expect(out.startsWith('bad gateway')).toBe(true);
    expect(out.length).toBe(200);
  });
});
