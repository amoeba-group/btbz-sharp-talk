import { CircuitBreaker, breakerEnabled, breakerOptionsFromEnv, isEngineFailure } from './circuit-breaker';
import { AiTimeoutError, ProviderHttpError } from './resilience';

/** PLN-261012 SG-84 — per-engine circuit breaker, driven by an injected clock. */
describe('CircuitBreaker', () => {
  const build = (failureThreshold = 3, openMs = 30_000) => {
    let t = 1_000_000;
    const transitions: string[] = [];
    const breaker = new CircuitBreaker({
      failureThreshold,
      openMs,
      now: () => t,
      onTransition: (from, to) => transitions.push(`${from}->${to}`),
    });
    return { breaker, transitions, advance: (ms: number) => void (t += ms) };
  };

  it('stays closed below the threshold and lets calls through', () => {
    const { breaker } = build(3);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.state()).toBe('closed');
    expect(breaker.allow()).toBe(true);
  });

  it('opens after N CONSECUTIVE failures and then refuses calls', () => {
    const { breaker, transitions } = build(3);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.state()).toBe('open');
    expect(breaker.allow()).toBe(false);
    expect(transitions).toEqual(['closed->open']);
  });

  it('a success resets the streak — failures must be consecutive', () => {
    const { breaker } = build(3);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.state()).toBe('closed');
  });

  it('after the open window it goes half-open and admits exactly ONE probe', () => {
    const { breaker, advance } = build(2, 30_000);
    breaker.recordFailure();
    breaker.recordFailure();
    advance(29_999);
    expect(breaker.allow()).toBe(false);

    advance(1);
    expect(breaker.state()).toBe('half_open');
    expect(breaker.allow()).toBe(true); // the probe
    expect(breaker.allow()).toBe(false); // everyone else keeps skipping while it is out
  });

  it('a successful probe closes the breaker', () => {
    const { breaker, advance, transitions } = build(2, 30_000);
    breaker.recordFailure();
    breaker.recordFailure();
    advance(30_000);
    breaker.allow();

    breaker.recordSuccess();

    expect(breaker.state()).toBe('closed');
    expect(breaker.allow()).toBe(true);
    expect(transitions).toEqual(['closed->open', 'open->half_open', 'half_open->closed']);
  });

  it('a failed probe re-opens it for a FULL new window', () => {
    const { breaker, advance, transitions } = build(2, 30_000);
    breaker.recordFailure();
    breaker.recordFailure();
    advance(30_000);
    breaker.allow();

    breaker.recordFailure();

    expect(breaker.state()).toBe('open');
    advance(29_000);
    expect(breaker.allow()).toBe(false);
    advance(1_000);
    expect(breaker.allow()).toBe(true);
    expect(transitions).toEqual(['closed->open', 'open->half_open', 'half_open->open', 'open->half_open']);
  });

  it('a probe whose outcome never arrives cannot wedge the breaker forever', () => {
    const { breaker, advance } = build(1, 30_000);
    breaker.recordFailure();
    advance(30_000);
    expect(breaker.allow()).toBe(true); // probe handed out, then lost
    advance(10_000);
    expect(breaker.allow()).toBe(false);
    advance(20_000); // another full window since the probe
    expect(breaker.allow()).toBe(true);
  });

  it('a straggler failing after the breaker opened does not extend the window', () => {
    const { breaker, advance } = build(1, 30_000);
    breaker.recordFailure();
    advance(20_000);
    breaker.recordFailure(); // an in-flight call that started before the breaker opened
    advance(10_000);
    expect(breaker.state()).toBe('half_open');
  });

  it('snapshot reports state and streak for metrics and readiness', () => {
    const { breaker } = build(5);
    breaker.recordFailure();
    expect(breaker.snapshot()).toMatchObject({ state: 'closed', consecutiveFailures: 1, openedAt: null });
  });
});

describe('which failures count against an engine', () => {
  it('counts engine-level failures: timeout, network, 5xx, 429, auth, credit, missing key', () => {
    expect(isEngineFailure(new AiTimeoutError('Anthropic', 25_000))).toBe(true);
    expect(isEngineFailure(new TypeError('fetch failed'))).toBe(true);
    expect(isEngineFailure(new ProviderHttpError('x', 503))).toBe(true);
    expect(isEngineFailure(new ProviderHttpError('x', 429))).toBe(true);
    expect(isEngineFailure(new ProviderHttpError('x', 401))).toBe(true);
    expect(isEngineFailure(new ProviderHttpError('Anthropic API error 400: credit balance is too low', 400))).toBe(true);
    expect(isEngineFailure(new Error('Anthropic API key not configured'))).toBe(true);
  });

  it('does NOT count a plain request rejection — one malformed prompt must not take the engine offline', () => {
    expect(isEngineFailure(new ProviderHttpError('Anthropic API error 400: invalid_request_error: prompt too long', 400))).toBe(false);
    expect(isEngineFailure(new ProviderHttpError('x', 422))).toBe(false);
    expect(isEngineFailure(new ProviderHttpError('x', 404))).toBe(false);
  });
});

describe('breaker configuration', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('defaults to 5 failures / 30 s, enabled', () => {
    delete process.env.AI_BREAKER_FAILURE_THRESHOLD;
    delete process.env.AI_BREAKER_OPEN_SEC;
    delete process.env.AI_BREAKER_ENABLED;
    expect(breakerOptionsFromEnv()).toEqual({ failureThreshold: 5, openMs: 30_000 });
    expect(breakerEnabled()).toBe(true);
  });

  it('reads the environment and can be switched off', () => {
    process.env.AI_BREAKER_FAILURE_THRESHOLD = '2';
    process.env.AI_BREAKER_OPEN_SEC = '10';
    process.env.AI_BREAKER_ENABLED = 'false';
    expect(breakerOptionsFromEnv()).toEqual({ failureThreshold: 2, openMs: 10_000 });
    expect(breakerEnabled()).toBe(false);
  });
});
