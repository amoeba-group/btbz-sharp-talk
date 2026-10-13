import { RetentionService } from './retention.service';

/**
 * PLN-261012 SG-83 — a scheduled purge that fails is an operational alert, not a log line: a purge
 * that silently stops is a retention-policy breach nobody sees until an audit does.
 */
describe('RetentionService — scheduled purge failure → ops alert', () => {
  const build = (failWith?: Error) => {
    const repo = (name: string) => ({
      delete: jest.fn(async () => {
        if (failWith && name === 'messages') throw failWith;
        return { affected: 0 };
      }),
      createQueryBuilder: () => ({
        delete() { return this; },
        where() { return this; },
        andWhere() { return this; },
        execute: async () => ({ affected: 0 }),
      }),
    });
    const opsAlert = { alert: jest.fn(async () => ({ outcome: 'sent', channels: ['email'] })) };
    const svc = new RetentionService(
      repo('conversations') as never,
      repo('messages') as never,
      repo('cjm') as never,
      repo('notifications') as never,
      repo('sessions') as never,
      repo('aiUsage') as never,
      repo('moderationLogs') as never,
      repo('agentAlerts') as never,
      { get: (_k: string, d: unknown) => d } as never,
      { write: jest.fn(async () => undefined) } as never,
      { deleteOlderThan: jest.fn(async () => 0), purgeUnattached: jest.fn(async () => 0) } as never,
      opsAlert as never,
    );
    return { svc, opsAlert };
  };
  const runScheduled = (svc: RetentionService) => (svc as unknown as { runScheduled: () => Promise<void> }).runScheduled();

  it('raises a critical ops alert when the scheduled purge throws', async () => {
    const { svc, opsAlert } = build(new Error('lock wait timeout exceeded'));

    await runScheduled(svc);

    expect(opsAlert.alert).toHaveBeenCalledTimes(1);
    expect(opsAlert.alert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'retention_purge_failed',
        kind: 'retention_purge_failed',
        severity: 'critical',
        title: 'Scheduled data-retention purge failed',
        detail: expect.stringContaining('lock wait timeout exceeded'),
      }),
    );
  });

  it('does not alert when the purge succeeds', async () => {
    const { svc, opsAlert } = build();

    await runScheduled(svc);

    expect(opsAlert.alert).not.toHaveBeenCalled();
  });

  it('works unchanged when no alert service is wired (test doubles that predate it)', async () => {
    const { svc } = build(new Error('boom'));
    (svc as unknown as { opsAlert?: unknown }).opsAlert = undefined;

    await expect(runScheduled(svc)).resolves.toBeUndefined();
  });

  it('a MANUAL purge failure still throws to its caller (the admin sees it) and does not alert', async () => {
    const { svc, opsAlert } = build(new Error('boom'));

    await expect(svc.purgeExpired()).rejects.toThrow('boom');
    expect(opsAlert.alert).not.toHaveBeenCalled();
  });
});
