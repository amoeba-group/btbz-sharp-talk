import { AiGatewayService } from './ai-gateway.service';

/**
 * PLN-261007 S3/D4 — the gateway remembers what an engine last did, and marks
 * a stub stand-in so nothing customer-facing passes it off as an answer.
 */
describe('AiGatewayService — engine health and degraded replies', () => {
  const ENGINE = { id: '5', tenantId: 4, provider: 'anthropic', model: 'm', endpoint: null, apiKeyEncrypted: null, status: 'enabled', isDefault: 1 };

  function build(complete: () => Promise<unknown>) {
    const updates: Array<{ w: unknown; set: Record<string, unknown> }> = [];
    const engineRepo = {
      findOne: jest.fn(async () => ENGINE),
      update: jest.fn(async (w: unknown, set: Record<string, unknown>) => updates.push({ w, set })),
    };
    const settingRepo = { findOne: jest.fn(async () => ({ tenantId: 4, func: 'rag', engineId: 5, paramsJson: null })) };
    const stub = { provider: 'stub', complete: jest.fn(async () => ({ text: "Here's what I found for you:", tokensIn: 1, tokensOut: 1, provider: 'stub', model: 'stub-1' })) };
    const anthropic = { provider: 'anthropic', complete: jest.fn(complete) };
    const other = { provider: 'openai', complete: jest.fn() };
    const voyage = { provider: 'voyage', complete: jest.fn() };
    const usage = { record: jest.fn(async () => undefined) };
    const gw = new AiGatewayService(
      engineRepo as never,
      settingRepo as never,
      stub as never,
      anthropic as never,
      other as never,
      voyage as never,
      usage as never,
    );
    return { gw, updates };
  }
  const flush = () => new Promise((r) => setImmediate(r));

  it('marks the stub stand-in as degraded and records the failure with its reason', async () => {
    const { gw, updates } = build(async () => {
      throw new Error('Anthropic API error 400: invalid_request_error: Your credit balance is too low');
    });

    const res = await gw.complete({ tenantId: 4, function: 'rag' as never, messages: [{ role: 'user', content: 'q' }] });
    await flush();

    expect(res.degraded).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toMatchObject({ lastErrorReason: 'credit' });
    expect(String(updates[0].set.lastErrorDetail)).toContain('credit balance');
  });

  it('records success at most once a minute per engine', async () => {
    const { gw, updates } = build(async () => ({ text: 'ok', tokensIn: 1, tokensOut: 1, provider: 'anthropic', model: 'm' }));

    const res = await gw.complete({ tenantId: 4, function: 'rag' as never, messages: [{ role: 'user', content: 'q' }] });
    await gw.complete({ tenantId: 4, function: 'rag' as never, messages: [{ role: 'user', content: 'q' }] });
    await flush();

    expect(res.degraded).toBeUndefined();
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toHaveProperty('lastOkAt');
  });

  it('writes the first success after a failure immediately', () => {
    const { gw, updates } = build(async () => ({}));
    const t0 = new Date('2026-10-07T00:00:00Z');
    gw.recordHealth(5, null, t0);
    gw.recordHealth(5, 'boom', new Date(t0.getTime() + 1_000));
    gw.recordHealth(5, null, new Date(t0.getTime() + 2_000));
    expect(updates.map((u) => Object.keys(u.set)[0])).toEqual(['lastOkAt', 'lastErrorAt', 'lastOkAt']);
  });
});
