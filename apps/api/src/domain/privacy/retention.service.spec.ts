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

/**
 * The partner-data lookup log ages out with the conversations (PLN-261012 SG-31/SG-52
 * follow-up): it names the hotel, the role and the topic of every question a hotel user
 * asked about their own rates and settlement, so it must not outlive the window the
 * consent notice quotes.
 */
describe('RetentionService — partner lookup log', () => {
  const day = 24 * 60 * 60 * 1000;
  const repo = (deletes?: Array<{ name: string; where: any }>, name = 'x', affected = 0) => ({
    delete: jest.fn(async (where: unknown) => {
      deletes?.push({ name, where });
      return { affected };
    }),
    createQueryBuilder: () => ({
      delete: function () { return this; },
      where: function () { return this; },
      andWhere: function () { return this; },
      execute: async () => ({ affected: 0 }),
    }),
  });

  const build = (opts: { partner?: unknown; env?: Record<string, string | number> } = {}) => {
    const audits: Array<{ metadata: Record<string, unknown> }> = [];
    const svc = new RetentionService(
      repo() as never, repo() as never, repo() as never, repo() as never, repo() as never,
      repo() as never, repo() as never, repo() as never,
      { get: (k: string, d: unknown) => opts.env?.[k] ?? d } as never,
      { write: jest.fn(async (a: never) => audits.push(a)) } as never,
      { deleteOlderThan: jest.fn(async () => 0), purgeUnattached: jest.fn(async () => 0) } as never,
      undefined, // opsAlert (SG-83)
      undefined, // opt-in retention (SG-70)
      opts.partner as never,
    );
    return { svc, audits };
  };

  it('deletes lookup rows older than the CONVERSATION window, not their own clock', async () => {
    const deletes: Array<{ name: string; where: any }> = [];
    const { svc } = build({ partner: repo(deletes, 'partner', 7), env: { CONVERSATION_LOG_RETENTION_DAYS: 30 } });

    const res = await svc.purgeExpired();

    expect(deletes).toHaveLength(1);
    const cutoff = (deletes[0].where.createdAt as { value: Date }).value;
    // Same cutoff the conversations were cut at: the result reports it.
    expect(cutoff.toISOString()).toBe(res.cutoff);
    expect((Date.now() - cutoff.getTime()) / day).toBeCloseTo(30, 1);
    expect(res.partnerLookupLogs).toBe(7);
  });

  it('defaults to the conversation default (365 days) when nothing is configured', async () => {
    const deletes: Array<{ name: string; where: any }> = [];
    const { svc } = build({ partner: repo(deletes, 'partner', 1) });
    await svc.purgeExpired();
    const cutoff = (deletes[0].where.createdAt as { value: Date }).value;
    expect((Date.now() - cutoff.getTime()) / day).toBeCloseTo(365, 1);
  });

  it('reports the count in the audit row', async () => {
    const { svc, audits } = build({ partner: repo(undefined, 'partner', 4) });
    await svc.purgeExpired();
    expect(audits[0].metadata).toMatchObject({ partnerLookupLogs: 4 });
  });

  it('positional specs that predate the repository keep working: nothing is touched, the count is 0', async () => {
    const { svc, audits } = build();
    const res = await svc.purgeExpired();
    expect(res.partnerLookupLogs).toBe(0);
    expect(audits[0].metadata).toMatchObject({ partnerLookupLogs: 0 });
  });

  it('a failing delete never swallows the audit row for the purge that already happened', async () => {
    const broken = { delete: jest.fn(async () => { throw new Error('table is gone'); }) };
    const { svc, audits } = build({ partner: broken });
    await expect(svc.purgeExpired()).resolves.toMatchObject({ partnerLookupLogs: 0 });
    expect(audits).toHaveLength(1);
  });
});
