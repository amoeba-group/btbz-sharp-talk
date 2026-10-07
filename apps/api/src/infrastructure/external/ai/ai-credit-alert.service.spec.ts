import {
  AiCreditAlertService,
  CREDIT_ALERT_TTL_SEC,
  creditAlertMail,
  creditRecoveredMail,
} from './ai-credit-alert.service';
import { AiGatewayService } from './ai-gateway.service';

/** PLN-261007-AI-Credit-Alert — mail dev@amoeba.group when an engine runs dry, once, and on recovery. */
describe('creditAlertMail', () => {
  const base = {
    env: 'staging',
    consoleUrl: 'https://shoptalk.amoeba.site',
    engineName: 'go2joy',
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    tenantSlug: 'go2joy' as string | null,
    isSystemDefault: false,
    detectedAt: new Date('2026-10-06T13:04:00Z'),
    todayFailures: 365,
    detail: 'Anthropic API error 400: invalid_request_error: Your credit balance is too low',
    affectedTenants: [] as string[],
  };

  it('tells the operator to switch a tenant engine to the system default engine', () => {
    const m = creditAlertMail(base);
    expect(m.subject).toBe('[SharpTalk staging] AI 크레딧 부족 — go2joy · go2joy');
    expect(m.text).toContain('시스템 기본 엔진으로 전환');
    expect(m.text).toContain('https://shoptalk.amoeba.site/settings/basic');
    expect(m.text).toContain('오늘 실패 수: 365');
    expect(m.text).toContain('credit balance is too low');
  });

  it('for the system default engine, asks for a top-up and lists who is affected', () => {
    const m = creditAlertMail({ ...base, tenantSlug: null, isSystemDefault: true, engineName: 'Anthropic Claude', affectedTenants: ['ivyusa', 'skyliving'] });
    expect(m.subject).toContain('시스템 기본 엔진 · Anthropic Claude');
    expect(m.text).toContain('플랫폼 키의 크레딧을 충전');
    expect(m.text).toContain('ivyusa, skyliving');
    expect(m.text).toContain('엔진을 지정하지 않은 기능은 모두 이 엔진을 씁니다');
    expect(m.text).not.toContain('[시스템 기본 엔진으로 전환]');
  });

  it('recovery mail states how long it lasted', () => {
    const m = creditRecoveredMail({
      env: 'production',
      engineName: 'go2joy',
      tenantSlug: 'go2joy',
      isSystemDefault: false,
      since: new Date('2026-10-06T13:04:00Z'),
      recoveredAt: new Date('2026-10-06T15:04:00Z'),
    });
    expect(m.subject).toBe('[SharpTalk production] AI 크레딧 복구 — go2joy · go2joy');
    expect(m.text).toContain('약 120분');
  });
});

describe('AiCreditAlertService', () => {
  const ENGINE = { id: '5', tenantId: 4, name: 'go2joy', provider: 'anthropic', model: 'm', isDefault: 1 };

  function build(redisUp: boolean) {
    const store = new Map<string, string>();
    const redis = {
      available: () => redisUp,
      setIfAbsent: jest.fn(async (k: string, v: string) => {
        if (!redisUp) return null;
        if (store.has(k)) return false;
        store.set(k, v);
        return true;
      }),
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      del: jest.fn(async (k: string) => void store.delete(k)),
    };
    const mailer = { send: jest.fn(async () => true) };
    const svc = new AiCreditAlertService(
      { findOne: jest.fn(async () => ENGINE) } as never,
      { findOne: jest.fn(async () => ({ id: 4, slug: 'go2joy' })), find: jest.fn(async () => []) } as never,
      { find: jest.fn(async () => []) } as never,
      { todayByEngine: jest.fn(async () => new Map([[5, { calls: 10, failures: 7 }]])) } as never,
      redis as never,
      mailer as never,
    );
    return { svc, mailer, store };
  }
  const OLD = process.env.AI_ALERT_EMAIL;
  afterEach(() => {
    if (OLD === undefined) delete process.env.AI_ALERT_EMAIL;
    else process.env.AI_ALERT_EMAIL = OLD;
  });

  it('mails dev@amoeba.group once per window, however many calls fail', async () => {
    delete process.env.AI_ALERT_EMAIL;
    const { svc, mailer } = build(true);
    await svc.onCredit(5, 'credit balance is too low');
    await svc.onCredit(5, 'credit balance is too low');
    await svc.onCredit(5, 'credit balance is too low');
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect((mailer.send.mock.calls[0] as unknown as [{ to: string }])[0].to).toBe('dev@amoeba.group');
  });

  it('sends a recovery mail on the first success after an alert, then alerts afresh next time', async () => {
    const { svc, mailer } = build(true);
    await svc.onCredit(5, 'credit');
    await svc.onRecovered(5);
    await svc.onRecovered(5); // nothing pending any more
    await svc.onCredit(5, 'credit');
    const subjects = mailer.send.mock.calls.map((c) => (c as unknown as [{ subject: string }])[0].subject);
    expect(subjects).toHaveLength(3);
    expect(subjects[1]).toContain('복구');
  });

  it('stays silent on success when nothing was alerted', async () => {
    const { svc, mailer } = build(true);
    await svc.onRecovered(5);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('falls back to memory when Redis is down, still once per window', async () => {
    const { svc, mailer } = build(false);
    const t0 = new Date('2026-10-07T00:00:00Z');
    await svc.onCredit(5, 'credit', t0);
    await svc.onCredit(5, 'credit', new Date(t0.getTime() + 60_000));
    await svc.onCredit(5, 'credit', new Date(t0.getTime() + CREDIT_ALERT_TTL_SEC * 1000 + 1));
    expect(mailer.send).toHaveBeenCalledTimes(2);
  });

  it('honours AI_ALERT_EMAIL and never throws when mail fails', async () => {
    process.env.AI_ALERT_EMAIL = 'ops@example.com';
    const { svc, mailer } = build(true);
    mailer.send.mockRejectedValueOnce(new Error('smtp down'));
    await expect(svc.onCredit(5, 'credit')).resolves.toBeUndefined();
    expect((mailer.send.mock.calls[0] as unknown as [{ to: string }])[0].to).toBe('ops@example.com');
  });
});

describe('AiGatewayService → credit alert wiring', () => {
  it('raises onCredit for a credit failure only, and onRecovered on a recorded success', () => {
    const alert = { onCredit: jest.fn(async () => undefined), onRecovered: jest.fn(async () => undefined) };
    const gw = new AiGatewayService(
      { update: jest.fn(async () => undefined) } as never,
      {} as never,
      { provider: 'stub' } as never,
      { provider: 'anthropic' } as never,
      { provider: 'openai' } as never,
      { provider: 'voyage' } as never,
      {} as never,
      alert as never,
    );
    const t = new Date('2026-10-07T00:00:00Z');
    gw.recordHealth(5, 'Anthropic API error 400: invalid_request_error: Your credit balance is too low', t);
    gw.recordHealth(6, '401 Unauthorized', t);
    gw.recordHealth(5, null, new Date(t.getTime() + 1000));
    expect(alert.onCredit).toHaveBeenCalledTimes(1);
    expect(alert.onCredit.mock.calls[0][0]).toBe(5);
    expect(alert.onRecovered).toHaveBeenCalledWith(5, expect.any(Date));
  });
});
