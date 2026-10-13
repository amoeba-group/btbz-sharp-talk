import { AUDIT_LOG_RETENTION_FLOOR_DAYS, OptInRetentionService } from './opt-in-retention.service';
import { RetentionService } from './retention.service';

/**
 * Opt-in disposal of customers and audit_logs (PLN-261012 SG-70). The property
 * that matters most is the default: with nothing configured NOTHING is touched,
 * because these windows are legal decisions a deployment has not made yet.
 */
describe('OptInRetentionService (SG-70)', () => {
  const build = (env: Record<string, string> = {}, customers: Array<Record<string, unknown>> = []) => {
    const queries: string[] = [];
    const deletes: Array<unknown[]> = [];
    const qb: Record<string, jest.Mock> = {};
    for (const m of ['where', 'andWhere', 'orderBy', 'take']) qb[m] = jest.fn(() => qb);
    let served = false;
    qb.getMany = jest.fn(async () => {
      if (served) return [];
      served = true;
      return customers;
    });
    const customerRepo = { createQueryBuilder: jest.fn(() => qb) };
    const auditRepo = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        queries.push(sql);
        deletes.push(params);
        return { affectedRows: deletes.length === 1 ? 5000 : 7 };
      }),
    };
    const privacy = { anonymizeInactiveCustomer: jest.fn(async () => undefined) };
    const svc = new OptInRetentionService(
      { get: (k: string) => env[k] } as never,
      customerRepo as never,
      auditRepo as never,
      privacy as never,
    );
    return { svc, qb, customerRepo, auditRepo, privacy, queries, deletes };
  };

  it('does nothing at all by default — no query, no scrub, null windows', async () => {
    const h = build();
    await expect(h.svc.purge()).resolves.toEqual({
      customerRetentionDays: null,
      customersAnonymised: 0,
      auditLogRetentionDays: null,
      auditLogs: 0,
    });
    expect(h.customerRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(h.auditRepo.query).not.toHaveBeenCalled();
    expect(h.privacy.anonymizeInactiveCustomer).not.toHaveBeenCalled();
  });

  it.each(['0', '', '  ', '-30', 'forever'])('treats CUSTOMER_RETENTION_DAYS=%p as off, not as "delete everything"', async (raw) => {
    const h = build({ CUSTOMER_RETENTION_DAYS: raw, AUDIT_LOG_RETENTION_DAYS: raw });
    const res = await h.svc.purge();
    expect(res.customerRetentionDays).toBeNull();
    expect(res.auditLogRetentionDays).toBeNull();
    expect(h.customerRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('anonymises each inactive customer through the privacy service, without suppression', async () => {
    const rows = [{ id: 5 }, { id: 9 }];
    const h = build({ CUSTOMER_RETENTION_DAYS: '730' }, rows);
    const res = await h.svc.purge();
    expect(res.customersAnonymised).toBe(2);
    expect(res.customerRetentionDays).toBe(730);
    expect(h.privacy.anonymizeInactiveCustomer).toHaveBeenCalledWith(rows[0]);
    expect(h.privacy.anonymizeInactiveCustomer).toHaveBeenCalledWith(rows[1]);
  });

  it('selects only customers with a personal identifier left and no recent session or order', async () => {
    const h = build({ CUSTOMER_RETENTION_DAYS: '30' }, [{ id: 1 }]);
    await h.svc.purge();
    const sql = h.qb.andWhere.mock.calls.map((c) => String(c[0])).join(' ');
    expect(sql).toContain('c.email IS NOT NULL');
    expect(sql).toContain('c.external_customer_id IS NOT NULL');
    expect(sql).toContain('FROM sessions s WHERE s.customer_id = c.id');
    expect(sql).toContain('FROM orders_cache o WHERE o.customer_id = c.id');
    // A cutoff the right distance back.
    const cutoff = h.qb.andWhere.mock.calls.find((c) => String(c[0]).includes('c.updated_at'))?.[1] as { cutoff: Date };
    const days = (Date.now() - cutoff.cutoff.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('one customer failing does not stop the rest', async () => {
    const h = build({ CUSTOMER_RETENTION_DAYS: '30' }, [{ id: 1 }, { id: 2 }]);
    h.privacy.anonymizeInactiveCustomer.mockRejectedValueOnce(new Error('boom'));
    const res = await h.svc.purge();
    expect(res.customersAnonymised).toBe(1);
    expect(h.privacy.anonymizeInactiveCustomer).toHaveBeenCalledTimes(2);
  });

  describe('audit_logs', () => {
    it('deletes in bounded chunks until a short chunk', async () => {
      const h = build({ AUDIT_LOG_RETENTION_DAYS: '365' });
      const res = await h.svc.purge();
      expect(res.auditLogs).toBe(5007);
      expect(h.queries).toHaveLength(2);
      expect(h.queries[0]).toContain('DELETE FROM `audit_logs`');
      expect(h.queries[0]).toContain('LIMIT ?');
      expect((h.deletes[0][1] as number)).toBe(5000);
    });

    it('never goes below the floor, however low the env is set', async () => {
      const h = build({ AUDIT_LOG_RETENTION_DAYS: '7' });
      const res = await h.svc.purge();
      expect(res.auditLogRetentionDays).toBe(AUDIT_LOG_RETENTION_FLOOR_DAYS);
      const cutoff = h.deletes[0][0] as Date;
      const days = (Date.now() - cutoff.getTime()) / 86_400_000;
      expect(days).toBeGreaterThan(AUDIT_LOG_RETENTION_FLOOR_DAYS - 0.1);
    });
  });
});

describe('RetentionService wiring of the opt-in purge (SG-70)', () => {
  const repo = () => ({
    delete: jest.fn(async () => ({ affected: 0 })),
    createQueryBuilder: () => ({
      delete: function () { return this; },
      where: function () { return this; },
      andWhere: function () { return this; },
      execute: async () => ({ affected: 0 }),
    }),
  });
  const build = (optIn?: unknown) => {
    const audits: Array<{ metadata: Record<string, unknown> }> = [];
    const svc = new RetentionService(
      repo() as never, repo() as never, repo() as never, repo() as never, repo() as never,
      repo() as never, repo() as never, repo() as never,
      { get: (_k: string, d: unknown) => d } as never,
      { write: jest.fn(async (a: never) => audits.push(a)) } as never,
      { deleteOlderThan: jest.fn(async () => 0), purgeUnattached: jest.fn(async () => 0) } as never,
      undefined, // opsAlert (SG-83) sits before the opt-in service in the constructor
      optIn as never,
    );
    return { svc, audits };
  };

  it('without the opt-in service the result carries zeros and null windows (byte-identical behaviour)', async () => {
    const { svc, audits } = build();
    const res = await svc.purgeExpired();
    expect(res).toMatchObject({ customersAnonymised: 0, customerRetentionDays: null, auditLogs: 0, auditLogRetentionDays: null });
    expect(audits[0].metadata).toMatchObject({ customersAnonymised: 0, auditLogs: 0 });
  });

  it('reports the opt-in counts in the result and the audit row', async () => {
    const { svc, audits } = build({
      purge: async () => ({ customersAnonymised: 3, customerRetentionDays: 730, auditLogs: 11, auditLogRetentionDays: 365 }),
    });
    const res = await svc.purgeExpired();
    expect(res).toMatchObject({ customersAnonymised: 3, customerRetentionDays: 730, auditLogs: 11, auditLogRetentionDays: 365 });
    expect(audits[0].metadata).toMatchObject({ customersAnonymised: 3, auditLogs: 11 });
  });

  it('a failing opt-in purge never swallows the audit row for the conversation purge', async () => {
    const { svc, audits } = build({ purge: async () => { throw new Error('db down'); } });
    await expect(svc.purgeExpired()).resolves.toMatchObject({ customersAnonymised: 0 });
    expect(audits).toHaveLength(1);
  });
});
