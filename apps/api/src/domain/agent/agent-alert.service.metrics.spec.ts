import { AgentAlertService } from './agent-alert.service';
import { m, metrics } from '../../infrastructure/observability/app-metrics';

/**
 * PLN-261012 SG-83 — handoffs by reason and alert deliveries by channel, counted where each is
 * decided: once per NEW escalation (a replayed duplicate is not a second handoff) and once per
 * delivery attempt.
 */
describe('AgentAlertService — metrics', () => {
  const build = (opts: { existing?: boolean; slack?: boolean; slackOk?: boolean; mailOk?: boolean; mailConfigured?: boolean } = {}) => {
    const alertRepo = {
      findOne: jest.fn(async () => (opts.existing ? { id: 1 } : null)),
      save: jest.fn(async (a: unknown) => ({ id: 2, ...(a as object) })),
      create: jest.fn((a: unknown) => a),
    };
    const cfg: Record<string, string> = {
      ...(opts.slack ? { SLACK_WEBHOOK_URL: 'https://hooks.example.test/x' } : {}),
      ALERT_EMAIL_TO: 'cs@example.test',
    };
    const svc = new AgentAlertService(
      alertRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { subscribe: jest.fn() } as never,
      { get: (k: string) => cfg[k] } as never,
      { send: jest.fn(async () => opts.mailOk ?? true), configured: () => opts.mailConfigured ?? true } as never,
    );
    global.fetch = jest.fn(async () => ({ ok: opts.slackOk ?? true, status: opts.slackOk === false ? 500 : 200 })) as unknown as typeof fetch;
    return svc;
  };
  const payload = { tenantId: 1, conversationId: 77, reason: 'engine_unavailable', preview: 'hi' };

  beforeEach(() => metrics.reset());

  it('counts a new escalation by reason', async () => {
    await build().onEscalation(payload);
    await build().onEscalation({ ...payload, conversationId: 78, reason: 'low_confidence' });

    expect(m.handoffs.get({ reason: 'engine_unavailable' })).toBe(1);
    expect(m.handoffs.get({ reason: 'low_confidence' })).toBe(1);
  });

  it('does NOT count a replayed duplicate (at-least-once bus) as another handoff', async () => {
    await build({ existing: true }).onEscalation(payload);

    expect(m.handoffs.sum()).toBe(0);
  });

  it('counts Slack and email deliveries by result', async () => {
    await build({ slack: true }).onEscalation(payload);
    await build({ slack: true, slackOk: false, mailOk: false }).onEscalation({ ...payload, conversationId: 79 });

    expect(m.alertSends.get({ channel: 'slack', result: 'ok' })).toBe(1);
    expect(m.alertSends.get({ channel: 'slack', result: 'failed' })).toBe(1);
    expect(m.alertSends.get({ channel: 'email', result: 'ok' })).toBe(1);
    expect(m.alertSends.get({ channel: 'email', result: 'failed' })).toBe(1);
  });

  it('an unconfigured mailer is reported as such, not as a failure', async () => {
    await build({ mailOk: false, mailConfigured: false }).onEscalation(payload);

    expect(m.alertSends.get({ channel: 'email', result: 'unconfigured' })).toBe(1);
    expect(m.alertSends.get({ channel: 'email', result: 'failed' })).toBe(0);
  });

  it('the alert text names an engine outage as such, not as missing knowledge', () => {
    const svc = build();
    const text = svc.summary({ conversationId: 77, reason: 'engine_unavailable', preview: 'hi' } as never);
    expect(text).toContain('AI engine unavailable');
    expect(text).not.toContain('could not answer from the knowledge base');
  });
});
