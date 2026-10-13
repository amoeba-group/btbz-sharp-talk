import { MetricsCollectorService } from './metrics-collector.service';
import { routeGroupOf, statusClassOf } from './http-metrics.middleware';
import { deriveTurnOutcome, safeLabel, m, metrics } from './app-metrics';

/** PLN-261012 SG-83 — scrape-time gauges, route grouping and the turn-outcome derivation. */
describe('MetricsCollectorService', () => {
  const build = (o: { query?: jest.Mock; pool?: unknown; breakers?: Array<{ component: string; state: 'closed' | 'half_open' | 'open' }>; qdrant?: { component: string; state: 'closed' | 'half_open' | 'open' } | null } = {}) => {
    const dataSource = { query: o.query ?? jest.fn(async () => []), driver: { pool: o.pool } };
    const svc = new MetricsCollectorService(
      dataSource as never,
      { breakerSnapshots: () => o.breakers ?? [] } as never,
      { breakerSnapshot: () => o.qdrant ?? null } as never,
    );
    return { svc, dataSource };
  };

  beforeEach(() => metrics.reset());

  it('reports the WORST breaker state per component (two engines of one provider: one open = open)', async () => {
    const { svc } = build({
      breakers: [
        { component: 'anthropic', state: 'closed' },
        { component: 'anthropic', state: 'open' },
        { component: 'embedding', state: 'half_open' },
      ],
      qdrant: { component: 'qdrant', state: 'closed' },
    });

    svc.collectBreakers();
    const text = await metrics.render();

    expect(text).toContain('sharptalk_circuit_breaker_state{component="anthropic"} 2');
    expect(text).toContain('sharptalk_circuit_breaker_state{component="embedding"} 1');
    expect(text).toContain('sharptalk_circuit_breaker_state{component="qdrant"} 0');
  });

  it('reports queued/open conversations from one grouped query, cached for 30 s', async () => {
    const query = jest.fn(async () => [
      { status: 'waiting', n: '4' },
      { status: 'agent', n: 2 },
    ]);
    const { svc } = build({ query });

    await svc.collectConversations();
    await svc.collectConversations();
    const text = await metrics.render();

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('GROUP BY status');
    expect(text).toContain('sharptalk_conversations_open{status="waiting"} 4');
    expect(text).toContain('sharptalk_conversations_open{status="agent"} 2');
    expect(text).toContain('sharptalk_conversations_open{status="ai_active"} 0');
  });

  it('a failing conversation query costs the gauge, not the scrape', async () => {
    const { svc } = build({ query: jest.fn(async () => Promise.reject(new Error('db down'))) });
    await expect(svc.collectConversations()).resolves.toBeUndefined();
  });

  it('reads the mysql2 pool defensively', async () => {
    const { svc } = build({ pool: { pool: { _allConnections: { length: 7 }, _freeConnections: { length: 3 } } } });
    svc.collectDbPool();
    const text = await metrics.render();
    expect(text).toContain('sharptalk_db_pool_connections{state="total"} 7');
    expect(text).toContain('sharptalk_db_pool_connections{state="in_use"} 4');

    // The real TypeORM shape: the mysql2 pool itself, bookkeeping directly on it.
    metrics.reset();
    build({ pool: { _allConnections: { length: 2 }, _freeConnections: { length: 2 } } }).svc.collectDbPool();
    expect(await metrics.render()).toContain('sharptalk_db_pool_connections{state="in_use"} 0');

    metrics.reset();
    build({ pool: undefined }).svc.collectDbPool(); // a driver that changed shape: no throw, no gauge
    expect(await metrics.render()).toBe('');
  });

  it('exposes process gauges', async () => {
    build().svc.collectProcess();
    const text = await metrics.render();
    expect(text).toMatch(/sharptalk_process_uptime_seconds \d+/);
    expect(text).toMatch(/sharptalk_process_resident_memory_bytes \d+/);
  });

  it('registers its collectors on init and removes them on destroy (no duplicates across apps)', async () => {
    const { svc } = build({ breakers: [{ component: 'anthropic', state: 'open' }] });
    svc.onModuleInit();
    expect(await metrics.render()).toContain('sharptalk_circuit_breaker_state{component="anthropic"} 2');
    svc.onModuleDestroy();
    metrics.reset();
    expect(await metrics.render()).toBe('');
  });
});

describe('routeGroupOf', () => {
  it.each([
    ['/api/v1/chat/message', 'chat'],
    ['/api/v1/agent/conversations/:id', 'agent'],
    ['/api/v1/admin/ai-engines', 'admin'],
    ['/api/v1/health/readiness', 'health'],
    ['/api/v1/ops/metrics', 'ops'],
    ['/api/v1', 'root'],
    ['/api/v1/:tenant/x', 'root'],
    ['/metrics', 'metrics'],
    [undefined, 'unmatched'],
    [null, 'unmatched'],
  ])('%s → %s', (path, expected) => {
    expect(routeGroupOf(path as string | undefined)).toBe(expected);
  });

  it('is bounded to a safe alphabet', () => {
    expect(routeGroupOf('/api/v1/we!rd$name/x')).toBe('we_rd_name');
  });

  it('statusClassOf', () => {
    expect([200, 201, 302, 404, 500, 503].map(statusClassOf)).toEqual(['2xx', '2xx', '3xx', '4xx', '5xx', '5xx']);
  });
});

describe('chat-turn outcome derivation', () => {
  it.each([
    [{ escalate: true, reply: { senderType: 'system' } }, 'handoff'],
    [{ needsAuth: true, reply: { senderType: 'system' } }, 'needs_auth'],
    [{ draft: { body: 'x' }, reply: null }, 'draft'],
    [{ reply: null }, 'silent'],
    [{ reply: { senderType: 'ai' } }, 'answered'],
    [{ reply: { senderType: 'system' } }, 'notice'],
  ])('%j → %s', (result, expected) => {
    expect(deriveTurnOutcome(result)).toBe(expected);
  });

  it('safeLabel keeps label values in a bounded alphabet', () => {
    expect(safeLabel('chat_answer')).toBe('chat_answer');
    expect(safeLabel('Chat Answer!')).toBe('chat_answer_');
    expect(safeLabel('x'.repeat(100)).length).toBe(40);
    expect(safeLabel('', 'fallback')).toBe('fallback');
    expect(safeLabel(undefined)).toBe('other');
    expect(m.chatTurns).toBeDefined();
  });
});
