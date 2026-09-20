import { RetentionService } from './retention.service';

/**
 * The AI usage window is separate from the conversation one on purpose: the
 * conversation window disposes of personal data, these rows are counters, and
 * thirteen months is what makes a year-over-year comparison possible.
 */
describe('RetentionService — AI usage window', () => {
  const day = 24 * 60 * 60 * 1000;

  const build = (env: Record<string, string | number> = {}) => {
    const deletes: Array<{ repo: string; where: unknown }> = [];
    const repo = (name: string) => ({
      delete: jest.fn(async (where: unknown) => {
        deletes.push({ repo: name, where });
        return { affected: 1 };
      }),
      createQueryBuilder: () => ({
        delete: function () { return this; },
        where: function () { return this; },
        andWhere: function () { return this; },
        execute: async () => ({ affected: 0 }),
      }),
    });
    const audits: unknown[] = [];
    const svc = new RetentionService(
      repo('conversations') as never,
      repo('messages') as never,
      repo('cjm') as never,
      repo('notifications') as never,
      repo('sessions') as never,
      repo('aiUsage') as never,
      repo('moderationLogs') as never,
      repo('agentAlerts') as never,
      { get: (k: string, d: unknown) => env[k] ?? d } as never,
      { write: jest.fn(async (a: unknown) => audits.push(a)) } as never,
      { deleteOlderThan: jest.fn(async () => 0), purgeUnattached: jest.fn(async () => 0) } as never,
    );
    return { svc, deletes, audits };
  };

  const cutoffOf = (deletes: Array<{ repo: string; where: any }>, name: string) => {
    const d = deletes.find((x) => x.repo === name);
    const value = d?.where?.statDate ?? d?.where?.createdAt;
    // TypeORM's LessThan wraps the value; the double records it as given.
    return (value as { value?: unknown })?.value ?? value;
  };

  it('keeps usage for 400 days by default, not the conversation window', async () => {
    const { svc, deletes } = build();

    await svc.purgeExpired();

    const usage = cutoffOf(deletes, 'aiUsage') as string;
    const expected = new Date(Date.now() - 400 * day).toISOString().slice(0, 10);
    expect(usage).toBe(expected);
  });

  it('purges usage by stat_date, the day the tokens were spent', async () => {
    // The row's own timestamps move when a later call accumulates into it; the
    // statistic belongs to the day it counts, not the day it was last touched.
    const { svc, deletes } = build();

    await svc.purgeExpired();

    expect(deletes.find((d) => d.repo === 'aiUsage')?.where).toHaveProperty('statDate');
  });

  it('does not follow the conversation window down', async () => {
    // Disposing usage on the conversation clock would quietly remove the
    // year-over-year comparison the longer window exists for.
    const { svc, deletes } = build({ CONVERSATION_LOG_RETENTION_DAYS: 30 });

    await svc.purgeExpired();

    const usage = cutoffOf(deletes, 'aiUsage') as string;
    expect(usage).toBe(new Date(Date.now() - 400 * day).toISOString().slice(0, 10));
  });

  it('honours an explicit window', async () => {
    const { svc, deletes } = build({ AI_USAGE_RETENTION_DAYS: 60 });

    await svc.purgeExpired();

    expect(cutoffOf(deletes, 'aiUsage')).toBe(
      new Date(Date.now() - 60 * day).toISOString().slice(0, 10),
    );
  });

  it('falls back rather than deleting everything on a bad value', async () => {
    // A zero or NaN window read literally would purge the whole table.
    const { svc, deletes } = build({ AI_USAGE_RETENTION_DAYS: 'not-a-number' });

    await svc.purgeExpired();

    expect(cutoffOf(deletes, 'aiUsage')).toBe(
      new Date(Date.now() - 400 * day).toISOString().slice(0, 10),
    );
  });

  it('reports what it dropped, in the result and the audit entry', async () => {
    const { svc, audits } = build();

    const res = await svc.purgeExpired();

    expect(res).toMatchObject({ aiUsage: 1, aiUsageRetentionDays: 400 });
    expect((audits[0] as { metadata: Record<string, unknown> }).metadata).toMatchObject({
      aiUsage: 1,
      aiUsageRetentionDays: 400,
    });
  });
});
