import { QdrantService } from './qdrant.service';
import { AiTimeoutError } from '../../resilience/resilience';
import { m, metrics } from '../../observability/app-metrics';

/** PLN-261012 SG-84 — Qdrant had no request deadline; a hung instance stalled every live retrieval. */
describe('QdrantService — deadline and breaker', () => {
  const saved = { ...process.env };

  const build = () => {
    const svc = new QdrantService({ get: () => undefined } as never);
    // As if onModuleInit had connected: skip the bootstrap round trips.
    (svc as unknown as { baseUrl: string; ready: boolean }).baseUrl = 'http://qdrant:6333';
    (svc as unknown as { ready: boolean }).ready = true;
    return svc;
  };

  /** A fetch that never answers but honours the abort signal, like the real one. */
  const hang = () =>
    jest.fn(
      (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise((_res, rej) => {
          init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
    );

  beforeEach(() => {
    process.env = { ...saved };
    process.env.QDRANT_REQUEST_TIMEOUT_MS = '500';
    process.env.AI_BREAKER_FAILURE_THRESHOLD = '3';
    delete process.env.AI_BREAKER_ENABLED;
    metrics.reset();
  });
  afterAll(() => {
    process.env = saved;
  });

  it('aborts a hung search at the deadline instead of waiting for the HTTP layer', async () => {
    const svc = build();
    global.fetch = hang() as unknown as typeof fetch;

    const started = Date.now();
    await expect(svc.search(4, [0.1], 8)).rejects.toBeInstanceOf(AiTimeoutError);

    expect(Date.now() - started).toBeLessThan(3000);
    expect(m.qdrantFailures.get({ operation: 'search' })).toBe(1);
  });

  it('stops calling a dead Qdrant after N consecutive failures (search only)', async () => {
    const svc = build();
    const fetchMock = jest.fn(async () => ({ ok: false, status: 503, text: async () => 'down' }));
    global.fetch = fetchMock as unknown as typeof fetch;
    for (let i = 0; i < 3; i++) await svc.search(4, [0.1], 8).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await expect(svc.search(4, [0.1], 8)).rejects.toThrow(/circuit open/);

    expect(fetchMock).toHaveBeenCalledTimes(3); // no network call
    expect(m.qdrantFailures.get({ operation: 'search_skipped' })).toBe(1);
    expect(svc.breakerSnapshot()).toMatchObject({ component: 'qdrant', state: 'open' });
  });

  it('does not gate KB writes: an upsert still reaches Qdrant while search is skipped', async () => {
    const svc = build();
    const fetchMock = jest.fn(async () => ({ ok: false, status: 503, text: async () => 'down' }));
    global.fetch = fetchMock as unknown as typeof fetch;
    for (let i = 0; i < 3; i++) await svc.search(4, [0.1], 8).catch(() => undefined);

    await svc.upsert(1, [0.1], { tenant_id: 4, category: null, source: 's', active: true }).catch(() => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('a healthy answer keeps the breaker closed', async () => {
    const svc = build();
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ result: [{ id: 7, score: 0.8, payload: {} }] }) })) as unknown as typeof fetch;

    const hits = await svc.search(4, [0.1], 8);

    expect(hits).toEqual([{ id: 7, score: 0.8, payload: {} }]);
    expect(svc.breakerSnapshot()?.state).toBe('closed');
  });

  it('probe() reaches the backend even when the breaker is open (readiness must see the truth)', async () => {
    const svc = build();
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, text: async () => 'down' })) as unknown as typeof fetch;
    for (let i = 0; i < 3; i++) await svc.search(4, [0.1], 8).catch(() => undefined);
    const ok = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    global.fetch = ok as unknown as typeof fetch;

    await expect(svc.probe()).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['POST', '/collections/kb_documents/points/search', 'search'],
    ['POST', '/collections/kb_documents/points/delete?wait=true', 'delete'],
    ['POST', '/collections/kb_documents/points/payload?wait=true', 'set_active'],
    ['PUT', '/collections/kb_documents/points?wait=true', 'upsert'],
    ['GET', '/collections', 'probe'],
    ['GET', '/collections/kb_documents/exists', 'ensure'],
  ])('%s %s → bounded label %s', (method, path, expected) => {
    expect(QdrantService.operationOf(method, path)).toBe(expected);
  });
});
