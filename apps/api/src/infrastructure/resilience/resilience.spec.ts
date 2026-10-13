import {
  AiTimeoutError,
  ProviderHttpError,
  aiRequestTimeoutMs,
  embedRequestTimeoutMs,
  failureReason,
  isNetworkError,
  isTransientError,
  retryWithJitter,
  runWithTimeout,
} from './resilience';

/** PLN-261012 SG-84 — deadlines and bounded retry for provider calls. */
describe('runWithTimeout', () => {
  it('aborts the operation at the deadline and reports a timeout, not a generic abort', async () => {
    let sawAbort = false;
    const stalled = (signal: AbortSignal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          sawAbort = true;
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });

    const started = Date.now();
    await expect(runWithTimeout(40, 'Anthropic', stalled)).rejects.toBeInstanceOf(AiTimeoutError);
    expect(sawAbort).toBe(true);
    // It must give up around the deadline, not hang for a provider-controlled time.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('names the provider and the deadline in the error', async () => {
    const err = await runWithTimeout(20, 'Voyage', (s) => new Promise((_r, rej) => s.addEventListener('abort', () => rej(new Error('x'))))).catch((e) => e);
    expect(err).toBeInstanceOf(AiTimeoutError);
    expect(err.message).toBe('Voyage request timed out after 20ms');
    expect(err.timeoutMs).toBe(20);
  });

  it('returns the result and clears the timer when the operation finishes in time', async () => {
    jest.useFakeTimers();
    try {
      const p = runWithTimeout(10_000, 'Anthropic', async () => 'ok');
      await expect(p).resolves.toBe('ok');
      // No timer left behind to abort a finished request (or keep the process alive).
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves a non-timeout failure as itself', async () => {
    const boom = new TypeError('fetch failed');
    await expect(runWithTimeout(1_000, 'X', async () => Promise.reject(boom))).rejects.toBe(boom);
  });
});

describe('transient error classification', () => {
  it('retries network blips, 5xx and 429', () => {
    expect(isTransientError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))).toBe(true);
    expect(isTransientError(new ProviderHttpError('Anthropic API error 529: overloaded', 529))).toBe(true);
    expect(isTransientError(new ProviderHttpError('OpenAI API error 503', 503))).toBe(true);
    expect(isTransientError(new ProviderHttpError('Voyage API error 429', 429))).toBe(true);
  });

  it('does not retry a timeout — the deadline is the budget', () => {
    expect(isTransientError(new AiTimeoutError('Anthropic', 25_000))).toBe(false);
  });

  it('does not retry a request the provider rejected', () => {
    expect(isTransientError(new ProviderHttpError('Anthropic API error 400: invalid_request_error: bad', 400))).toBe(false);
    expect(isTransientError(new ProviderHttpError('OpenAI API error 401: invalid api key', 401))).toBe(false);
  });

  it('does not retry an out-of-credit 429 (OpenAI reports a drained account that way)', () => {
    const e = new ProviderHttpError('OpenAI API error 429: insufficient_quota: You exceeded your current quota', 429);
    expect(isTransientError(e)).toBe(false);
  });

  it('does not stack a retry on a Voyage batch 429 that already waited out its own backoff', () => {
    expect(isTransientError(new ProviderHttpError('Voyage API error 429', 429, true))).toBe(false);
  });

  it('recognises undici-style network errors by cause code and by message', () => {
    expect(isNetworkError(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toBe(true);
    expect(isNetworkError(new TypeError('fetch failed'))).toBe(true);
    expect(isNetworkError(new Error('something else'))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});

describe('failureReason — a bounded label vocabulary', () => {
  it.each([
    [new AiTimeoutError('A', 1), 'timeout'],
    [new TypeError('fetch failed'), 'network'],
    [new ProviderHttpError('Anthropic API error 400: credit balance is too low', 400), 'credit'],
    [new ProviderHttpError('x', 429), 'rate_limit'],
    [new ProviderHttpError('x', 502), 'server_error'],
    [new ProviderHttpError('x', 401), 'auth'],
    [new ProviderHttpError('x', 400), 'rejected'],
    [new Error('whatever'), 'other'],
  ])('%#', (err, expected) => {
    expect(failureReason(err)).toBe(expected);
  });
});

describe('retryWithJitter', () => {
  const transient = () => new ProviderHttpError('OpenAI API error 503', 503);

  it('retries a transient failure once and returns the second answer', async () => {
    const op = jest.fn().mockRejectedValueOnce(transient()).mockResolvedValueOnce('ok');
    const sleeps: number[] = [];

    const res = await retryWithJitter(op, { retries: 1, sleep: async (ms) => void sleeps.push(ms), random: () => 0.5 });

    expect(res).toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
    expect(sleeps).toHaveLength(1);
  });

  it('is bounded: gives up after `retries` and rethrows the last error', async () => {
    const op = jest.fn(async () => {
      throw transient();
    });

    await expect(retryWithJitter(op, { retries: 2, sleep: async () => undefined })).rejects.toMatchObject({ status: 503 });
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('never retries what retryOn refuses', async () => {
    const op = jest.fn(async () => {
      throw new ProviderHttpError('Anthropic API error 400', 400);
    });

    await expect(retryWithJitter(op, { retries: 3, sleep: async () => undefined })).rejects.toMatchObject({ status: 400 });
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('uses full jitter: the wait is a random slice of the exponential window, capped', async () => {
    const sleeps: number[] = [];
    const op = jest.fn(async () => {
      throw transient();
    });

    await retryWithJitter(op, {
      retries: 3,
      baseMs: 300,
      maxMs: 1000,
      sleep: async (ms) => void sleeps.push(ms),
      random: () => 1, // the top of each window
    }).catch(() => undefined);

    // windows: 300, 600, min(1200, 1000)
    expect(sleeps).toEqual([300, 600, 1000]);
  });

  it('with random() = 0 does not wait at all (lockstep is prevented by the spread, not the floor)', async () => {
    const sleeps: number[] = [];
    const op = jest.fn().mockRejectedValueOnce(transient()).mockResolvedValueOnce(1);
    await retryWithJitter(op, { retries: 1, sleep: async (ms) => void sleeps.push(ms), random: () => 0 });
    expect(sleeps).toEqual([0]);
  });
});

describe('deadline configuration', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('defaults: 25 s for a completion, 8 s for an embedding', () => {
    delete process.env.AI_REQUEST_TIMEOUT_MS;
    delete process.env.EMBED_REQUEST_TIMEOUT_MS;
    expect(aiRequestTimeoutMs()).toBe(25_000);
    expect(embedRequestTimeoutMs()).toBe(8_000);
  });

  it('honours the environment, treats a blank as unset, and refuses a pathological value', () => {
    process.env.AI_REQUEST_TIMEOUT_MS = '40000';
    process.env.EMBED_REQUEST_TIMEOUT_MS = '';
    expect(aiRequestTimeoutMs()).toBe(40_000);
    expect(embedRequestTimeoutMs()).toBe(8_000);
    process.env.AI_REQUEST_TIMEOUT_MS = '5'; // would abort every call before it connects
    expect(aiRequestTimeoutMs()).toBe(1_000);
  });
});
