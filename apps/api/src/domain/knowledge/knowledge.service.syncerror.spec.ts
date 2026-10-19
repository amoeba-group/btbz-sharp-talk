import { KnowledgeService } from './knowledge.service';
import { NotionRequestError } from './notion.client';
import { BusinessException } from '../../global/exception/business.exception';

/**
 * Sync-failure reason persistence (REQ-260828 B1): a thrown sync must record
 * WHY on the source row, clamped, not just a red zeroed result — the actual
 * cause used to live only in the server log (the go2joy 404 case).
 */
describe('KnowledgeService — syncSource failure reason', () => {
  function build(err: Error) {
    const recorded: Array<[string, Record<string, unknown>]> = [];
    const sourceSync = {
      sync: jest.fn(async () => {
        throw err;
      }),
      recordSyncState: jest.fn(async (_s: unknown, status: string, result: Record<string, unknown>) => {
        recorded.push([status, result]);
      }),
      supportedTypes: jest.fn(() => ['gdrive', 'notion']),
    };
    const sourceRepo = {
      findOne: jest.fn(async () => ({ id: 7, tenantId: 4, type: 'notion', name: 'n' })),
    };
    const audited: Array<Record<string, unknown>> = [];
    const revisions = {
      recordAudit: jest.fn(
        async (_t: number, _d: number, _a: string, _u: unknown, meta?: Record<string, unknown>) => {
          audited.push(meta ?? {});
        },
      ),
    };
    const auditRows: Array<Record<string, unknown>> = [];
    const auditQb = {
      where: jest.fn(() => auditQb),
      andWhere: jest.fn(() => auditQb),
      orderBy: jest.fn(() => auditQb),
      take: jest.fn(() => auditQb),
      getMany: jest.fn(async () => auditRows),
    };
    const auditRepo = { createQueryBuilder: jest.fn(() => auditQb) };
    const svc = new KnowledgeService(
      sourceRepo as never,
      {} as never, // docRepo
      {} as never, // fileRepo
      {} as never, // ai
      {} as never, // qdrant
      {} as never, // rag
      {} as never, // moderation
      {} as never, // conflicts
      revisions as never,
      {} as never, // productImport
      {} as never, // bulkImport
      {} as never, // catalogSync
      {} as never, // usageGuides
      sourceSync as never,
      {} as never, // credRepo
      auditRepo as never,
    );
    return { svc, recorded, audited, auditRows, auditQb };
  }

  it('persists the thrown message on the failed row, clamped to 200 chars', async () => {
    const h = build(new Error('x'.repeat(300)));

    await expect(h.svc.syncSource(4, 7, 1)).rejects.toThrow();

    expect(h.recorded).toHaveLength(1);
    const [status, result] = h.recorded[0];
    expect(status).toBe('failed');
    expect((result.error as string).length).toBe(200);
    expect(result.fetched).toBe(0);
  });

  it('answers an unshared Notion target with E5095/422 carrying the reason (PLN-261019)', async () => {
    const h = build(new NotionRequestError('Could not find page with ID: abc', 404, 'object_not_found'));

    const err = await h.svc.syncSource(4, 7, 1).catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect(err.errorCode).toBe('E5095');
    expect(err.getStatus()).toBe(422);
    expect(err.details.reason[0]).toContain('Could not find page');
    // The row keeps the same reason the response carries.
    expect(h.recorded[0][1].error as string).toContain('Could not find page');
  });

  it('keeps a plain error propagating as-is — that one is a real 500', async () => {
    const h = build(new TypeError('Cannot read properties of undefined'));

    await expect(h.svc.syncSource(4, 7, 1)).rejects.toThrow(TypeError);
    expect(h.recorded[0][1].error as string).toContain('Cannot read');
  });

  it('audits the failed run too — history must not be all-green (PLN-260828)', async () => {
    const h = build(new Error('Could not find page with ID: abc'));

    await expect(h.svc.syncSource(4, 7, 1)).rejects.toThrow();

    expect(h.audited).toHaveLength(1);
    expect(h.audited[0]).toMatchObject({ sourceId: 7, status: 'failed' });
    expect(h.audited[0].error as string).toContain('Could not find page');
  });

  it('listSourceRuns filters by tenant+action+sourceId and defaults old rows to ok', async () => {
    const h = build(new Error('unused'));
    h.auditRows.push(
      {
        createdAt: new Date('2026-08-28T10:00:00Z'),
        actorId: '39',
        metadata: { sourceId: 7, type: 'notion', status: 'failed', error: 'boom', fetched: 0 },
      },
      {
        // Pre-feature row: success-only, no status field.
        createdAt: new Date('2026-08-28T09:00:00Z'),
        actorId: '0',
        metadata: { sourceId: 7, type: 'notion', fetched: 1, created: 1 },
      },
    );

    const runs = await h.svc.listSourceRuns(4, 7);

    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ status: 'failed', actorId: 39 });
    expect(runs[0].result).toMatchObject({ error: 'boom' });
    expect(runs[1]).toMatchObject({ status: 'ok', actorId: null });
    expect(runs[1].result).toMatchObject({ created: 1 });
    // sourceId/type/status are lifted out of the row payload.
    expect(runs[1].result).not.toHaveProperty('sourceId');
    const dump = JSON.stringify([
      h.auditQb.where.mock.calls,
      h.auditQb.andWhere.mock.calls,
    ]);
    expect(dump).toContain('"tenantId":4');
    expect(dump).toContain('knowledge.source_synced');
    expect(dump).toContain('"sourceId":7');
  });
});
