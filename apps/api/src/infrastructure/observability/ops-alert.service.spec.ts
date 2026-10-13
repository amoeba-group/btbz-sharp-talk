import { OpsAlertService, formatOpsAlert, sanitizeDetail } from './ops-alert.service';
import { m, metrics } from './app-metrics';

/**
 * PLN-261012 SG-83 — generic ops alerting: no built-in recipients, dedupe with a cooldown, English
 * text, nothing personal or secret in the message, and it never throws.
 */
describe('OpsAlertService', () => {
  const saved = { ...process.env };
  const T0 = new Date('2026-10-13T08:00:00Z');
  const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

  const build = (cfg: Record<string, string> = {}, opts: { mailOk?: boolean; redis?: unknown } = {}) => {
    const send = jest.fn(async () => opts.mailOk ?? true);
    const mailer = { configured: () => true, send };
    const config = { get: (k: string) => cfg[k] };
    const svc = new OpsAlertService(config as never, mailer as never, opts.redis as never);
    return { svc, send };
  };
  const alert = { key: 'llm_breaker:engine:5', kind: 'llm_breaker', severity: 'critical' as const, title: 'Circuit breaker open: anthropic', detail: 'engine failing' };

  let fetchMock: jest.Mock;
  beforeEach(() => {
    process.env = { ...saved };
    delete process.env.OPS_ALERT_COOLDOWN_SEC;
    metrics.reset();
    fetchMock = jest.fn(async () => ({ ok: true, status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    process.env = saved;
  });

  describe('recipients', () => {
    it('has NO built-in recipient: with nothing configured nothing is sent (and it is reported as unconfigured)', async () => {
      const { svc, send } = build();

      const res = await svc.alert(alert, T0);

      expect(res).toEqual({ outcome: 'unconfigured', channels: [] });
      expect(send).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(m.opsAlerts.get({ kind: 'llm_breaker', result: 'unconfigured' })).toBe(1);
    });

    it('mails every address in OPS_ALERT_EMAIL, in English, with severity and environment in the subject', async () => {
      const { svc, send } = build({ OPS_ALERT_EMAIL: 'ops@go2joy.example, oncall@go2joy.example' });

      const res = await svc.alert(alert, T0);

      expect(res).toEqual({ outcome: 'sent', channels: ['email'] });
      expect(send).toHaveBeenCalledTimes(2);
      const mail = send.mock.calls[0][0] as { to: string; subject: string; text: string };
      expect(mail.to).toBe('ops@go2joy.example');
      expect(mail.subject).toBe(`[SharpTalk ${process.env.NODE_ENV || 'development'}] CRITICAL: Circuit breaker open: anthropic`);
      expect(mail.text).toContain('Detail: engine failing');
      expect(mail.text).toContain('2026-10-13T08:00:00.000Z');
      // No Korean / Amoeba defaults leak into the message or recipients.
      expect(JSON.stringify(send.mock.calls)).not.toMatch(/amoeba|[가-힣]/i);
    });

    it('posts JSON to OPS_ALERT_WEBHOOK_URL with readable text (Slack/Teams) and content (Discord)', async () => {
      const { svc } = build({ OPS_ALERT_WEBHOOK_URL: 'https://hooks.example.test/T000/secret-path' });

      const res = await svc.alert(alert, T0);

      expect(res).toEqual({ outcome: 'sent', channels: ['webhook'] });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://hooks.example.test/T000/secret-path');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body).toMatchObject({
        source: 'sharptalk',
        key: 'llm_breaker:engine:5',
        kind: 'llm_breaker',
        severity: 'critical',
        title: 'Circuit breaker open: anthropic',
        detail: 'engine failing',
      });
      expect(body.text).toContain('CRITICAL: Circuit breaker open: anthropic');
      expect(body.content).toBe(body.text);
    });

    it('one channel failing does not lose the alert: webhook 500 + mail ok = sent via email', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });
      const { svc } = build({ OPS_ALERT_WEBHOOK_URL: 'https://hooks.example.test/x', OPS_ALERT_EMAIL: 'ops@go2joy.example' });

      expect(await svc.alert(alert, T0)).toEqual({ outcome: 'sent', channels: ['email'] });
    });

    it('every configured channel failing is reported as failed, not sent', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const { svc } = build({ OPS_ALERT_WEBHOOK_URL: 'https://hooks.example.test/x' }, { mailOk: false });

      expect((await svc.alert(alert, T0)).outcome).toBe('failed');
    });

    it('never throws, even when the mailer does', async () => {
      const send = jest.fn(async () => {
        throw new Error('smtp exploded');
      });
      const svc = new OpsAlertService({ get: (k: string) => (k === 'OPS_ALERT_EMAIL' ? 'a@b.test' : undefined) } as never, { configured: () => true, send } as never);

      await expect(svc.alert(alert, T0)).resolves.toMatchObject({ outcome: 'failed' });
    });

    it('does not log or leak the webhook URL (it can embed a token) on failure', async () => {
      fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));
      const { svc } = build({ OPS_ALERT_WEBHOOK_URL: 'https://hooks.example.test/T000/super-secret' });
      const logged: string[] = [];
      const logger = (svc as unknown as { logger: { warn: (m: string) => void; error: (m: string) => void } }).logger;
      logger.warn = (msg: string) => void logged.push(msg);
      logger.error = (msg: string) => void logged.push(msg);

      await svc.alert(alert, T0);

      expect(logged.join('\n')).not.toContain('super-secret');
    });
  });

  describe('dedupe / cooldown', () => {
    const cfg = { OPS_ALERT_EMAIL: 'ops@go2joy.example' };

    it('sends a key once, then suppresses repeats inside the cooldown (default 30 min)', async () => {
      const { svc, send } = build(cfg);

      expect((await svc.alert(alert, T0)).outcome).toBe('sent');
      expect((await svc.alert(alert, minutes(5))).outcome).toBe('suppressed');
      expect((await svc.alert(alert, minutes(29))).outcome).toBe('suppressed');
      expect(send).toHaveBeenCalledTimes(1);
      expect(m.opsAlerts.get({ kind: 'llm_breaker', result: 'suppressed' })).toBe(2);
    });

    it('sends again once the cooldown has elapsed', async () => {
      const { svc, send } = build(cfg);
      await svc.alert(alert, T0);

      expect((await svc.alert(alert, minutes(31))).outcome).toBe('sent');
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('a different key is a different problem and is not suppressed', async () => {
      const { svc, send } = build(cfg);
      await svc.alert(alert, T0);

      expect((await svc.alert({ ...alert, key: 'llm_breaker:engine:6' }, minutes(1))).outcome).toBe('sent');
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('the cooldown is configurable; 0 turns dedupe off', async () => {
      process.env.OPS_ALERT_COOLDOWN_SEC = '60';
      const { svc } = build(cfg);
      await svc.alert(alert, T0);
      expect((await svc.alert(alert, new Date(T0.getTime() + 30_000))).outcome).toBe('suppressed');
      expect((await svc.alert(alert, new Date(T0.getTime() + 61_000))).outcome).toBe('sent');

      process.env.OPS_ALERT_COOLDOWN_SEC = '0';
      const off = build(cfg).svc;
      await off.alert(alert, T0);
      expect((await off.alert(alert, T0)).outcome).toBe('sent');
    });

    it('shares the cooldown through Redis when it is available (several API instances)', async () => {
      const redis = { setIfAbsent: jest.fn(async () => false), del: jest.fn() };
      const { svc, send } = build(cfg, { redis });

      // Another instance already claimed the slot.
      expect((await svc.alert(alert, T0)).outcome).toBe('suppressed');
      expect(send).not.toHaveBeenCalled();
      expect(redis.setIfAbsent).toHaveBeenCalledWith('ops:alert:llm_breaker:engine:5', expect.any(String), 1800);
    });

    it('falls back to the in-process cooldown when Redis cannot answer', async () => {
      const redis = { setIfAbsent: jest.fn(async () => null), del: jest.fn() };
      const { svc } = build(cfg, { redis });

      expect((await svc.alert(alert, T0)).outcome).toBe('sent');
      expect((await svc.alert(alert, minutes(1))).outcome).toBe('suppressed');
    });
  });

  describe('resolve', () => {
    const cfg = { OPS_ALERT_EMAIL: 'ops@go2joy.example' };

    it('sends ONE resolved notice for an alert this process raised, and re-arms the key', async () => {
      const { svc, send } = build(cfg);
      await svc.alert(alert, T0);

      await svc.resolve(alert.key, alert.kind, 'Circuit breaker closed: anthropic', undefined, minutes(10));
      await svc.resolve(alert.key, alert.kind, 'Circuit breaker closed: anthropic', undefined, minutes(11));

      expect(send).toHaveBeenCalledTimes(2); // the alert + exactly one RESOLVED
      const resolved = send.mock.calls[1][0] as { subject: string; text: string };
      expect(resolved.subject).toContain('RESOLVED: Circuit breaker closed: anthropic');
      expect(resolved.text).toContain('The condition has cleared.');
      // A relapse alerts immediately instead of waiting out the old cooldown.
      expect((await svc.alert(alert, minutes(12))).outcome).toBe('sent');
    });

    it('says nothing for a key that never alerted', async () => {
      const { svc, send } = build(cfg);
      await svc.resolve('never:raised', 'x', 'All good');
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('content hygiene', () => {
    it('redacts keys and personal data and caps the detail', () => {
      const out = sanitizeDetail(
        'POST failed for jane.doe@example.com with Bearer abcdef0123456789abcdef and key sk-ant-api03-ABCDEFGH1234 call 415-555-0100 ' + 'x'.repeat(2000),
      )!;

      expect(out).not.toContain('jane.doe@example.com');
      expect(out).not.toContain('abcdef0123456789abcdef');
      expect(out).not.toContain('sk-ant-api03');
      expect(out).not.toContain('415-555-0100');
      expect(out.length).toBeLessThanOrEqual(800);
    });

    it('returns undefined for empty detail', () => {
      expect(sanitizeDetail('')).toBeUndefined();
      expect(sanitizeDetail('   ')).toBeUndefined();
      expect(sanitizeDetail(undefined)).toBeUndefined();
    });

    it('formats subject and body in English with the cooldown stated', () => {
      const { subject, text } = formatOpsAlert(
        { severity: 'warning', title: 'Vector retrieval backend failing', detail: 'x' },
        { name: 'staging', at: T0, cooldownSec: 1800 },
      );
      expect(subject).toBe('[SharpTalk staging] WARNING: Vector retrieval backend failing');
      expect(text).toContain('suppressed for 30 minutes');
    });
  });
});
