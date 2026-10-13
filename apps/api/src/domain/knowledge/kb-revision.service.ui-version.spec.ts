import { Repository } from 'typeorm';
import { KbRevisionService } from './kb-revision.service';
import { KbDocument } from './entity/kb-document.entity';
import { KbDocumentRevision } from './entity/kb-document-revision.entity';
import { AuditService } from '../audit/audit.service';

/**
 * The UI version in the document history (PLN-261012 SG-20).
 *
 * The three states of `kb_document_revisions.ui_version` are the point:
 * a label, '' = "recorded, the document was unversioned", NULL = "not recorded"
 * (a revision written before the column existed). A restore applies the first
 * two and must NOT treat NULL as "unversioned" — that would wipe a version
 * stamped since the day someone rolls back to an old revision.
 */
const doc = (over: Partial<KbDocument> = {}): KbDocument =>
  ({
    id: 10,
    tenantId: 1,
    title: 'Reconciliation',
    category: 'policy',
    content: 'Closes on the 5th.',
    sourceUrl: null,
    effectiveFrom: null,
    reviewIntervalDays: null,
    uiVersion: null,
    active: 1,
    ...over,
  }) as KbDocument;

describe('KbRevisionService — ui_version', () => {
  let saved: Array<Partial<KbDocumentRevision>>;
  let docSaved: KbDocument[];

  const build = (opts: { existingMax?: number | null; revision?: Partial<KbDocumentRevision>; current?: KbDocument } = {}) => {
    saved = [];
    docSaved = [];
    const revRepo = {
      create: (r: Partial<KbDocumentRevision>) => r as KbDocumentRevision,
      save: jest.fn(async (r: KbDocumentRevision) => {
        const withId = { ...r, id: 500 + saved.length } as KbDocumentRevision;
        saved.push(withId);
        return withId;
      }),
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => (opts.revision ?? null) as KbDocumentRevision | null),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn(async () => ({ max: opts.existingMax ?? null })),
      })),
    } as unknown as Repository<KbDocumentRevision>;
    const docRepo = {
      findOne: jest.fn(async () => opts.current ?? doc()),
      save: jest.fn(async (d: KbDocument) => {
        docSaved.push(d);
        return d;
      }),
    } as unknown as Repository<KbDocument>;
    const audit = { write: jest.fn(async () => undefined) } as unknown as AuditService;
    return new KbRevisionService(docRepo, revRepo, audit);
  };

  describe('snapshots', () => {
    it('keeps the version in the snapshot', async () => {
      const svc = build({ existingMax: 2 });
      await svc.record(1, doc({ uiVersion: 'v0.12.0', title: 'x' }), doc({ uiVersion: 'v0.12.0' }), 'update', 7);
      expect(saved[0].uiVersion).toBe('v0.12.0');
    });

    it('an unversioned document is recorded as "recorded, unversioned" (empty), never as NULL', async () => {
      const svc = build({ existingMax: 2 });
      await svc.record(1, doc({ title: 'x' }), doc(), 'update', 7);
      expect(saved[0].uiVersion).toBe('');
    });

    it('the baseline written before the first edit carries the pre-edit version', async () => {
      const svc = build({ existingMax: null });
      await svc.record(1, doc({ uiVersion: 'v0.12.0' }), doc({ uiVersion: 'v0.9.2' }), 'update', 7);
      expect(saved.map((s) => [s.changeKind, s.uiVersion])).toEqual([
        ['baseline', 'v0.9.2'],
        ['update', 'v0.12.0'],
      ]);
    });
  });

  describe('the diff', () => {
    it('a re-stamp alone is a change, and is named', async () => {
      const svc = build({ existingMax: 2 });
      await svc.record(1, doc({ uiVersion: 'v0.12.0' }), doc({ uiVersion: 'v0.9.2' }), 'update', 7);
      expect(saved[0].changedFields).toEqual(['uiVersion']);
    });

    it('stamping a previously unversioned document, and clearing one, both count', async () => {
      const a = build({ existingMax: 2 });
      await a.record(1, doc({ uiVersion: 'v1' }), doc({ uiVersion: null }), 'update', 7);
      expect(saved[0].changedFields).toEqual(['uiVersion']);
      const b = build({ existingMax: 2 });
      await b.record(1, doc({ uiVersion: null }), doc({ uiVersion: 'v1' }), 'update', 7);
      expect(saved[0].changedFields).toEqual(['uiVersion']);
    });

    it('null and undefined are the same "unversioned" — saving an untouched legacy row records nothing', async () => {
      const svc = build({ existingMax: 3 });
      const legacy = doc();
      delete (legacy as Partial<KbDocument>).uiVersion;
      expect(await svc.record(1, doc(), legacy, 'update', 7)).toBeNull();
    });
  });

  describe('restore', () => {
    const rev = (over: Partial<KbDocumentRevision>): Partial<KbDocumentRevision> => ({
      id: 77,
      revisionNo: 2,
      title: 'Reconciliation',
      category: 'policy',
      content: 'Closes on the 5th.',
      sourceUrl: null,
      effectiveFrom: null,
      reviewIntervalDays: null,
      active: 1,
      ...over,
    });

    it('brings back the version the text was written for', async () => {
      const svc = build({ existingMax: 3, revision: rev({ uiVersion: 'v0.9.2' }), current: doc({ uiVersion: 'v0.12.0' }) });
      const { doc: restored, versionChanged } = await svc.restore(1, 10, 77, 7);
      expect(restored.uiVersion).toBe('v0.9.2');
      expect(versionChanged).toBe(true);
    });

    it('restoring a revision that recorded "unversioned" clears the stamp', async () => {
      const svc = build({ existingMax: 3, revision: rev({ uiVersion: '' }), current: doc({ uiVersion: 'v0.12.0' }) });
      const { doc: restored, versionChanged } = await svc.restore(1, 10, 77, 7);
      expect(restored.uiVersion).toBeNull();
      expect(versionChanged).toBe(true);
    });

    it.each([
      ['NULL (a revision from before the column existed)', null],
      ['absent', undefined],
    ])('a revision with %s recorded nothing — the stamped version is NOT wiped', async (_n, value) => {
      const r = rev({});
      if (value === null) r.uiVersion = null;
      const svc = build({ existingMax: 3, revision: r, current: doc({ uiVersion: 'v0.12.0' }) });
      const { doc: restored, versionChanged } = await svc.restore(1, 10, 77, 7);
      expect(restored.uiVersion).toBe('v0.12.0');
      expect(versionChanged).toBe(false);
    });

    it('reports no version change when the restored label equals the current one', async () => {
      const svc = build({ existingMax: 3, revision: rev({ uiVersion: 'v0.12.0' }), current: doc({ uiVersion: 'v0.12.0' }) });
      expect((await svc.restore(1, 10, 77, 7)).versionChanged).toBe(false);
    });

    it('the restore is itself a revision that names the version among the changed fields', async () => {
      const svc = build({ existingMax: 3, revision: rev({ uiVersion: 'v0.9.2' }), current: doc({ uiVersion: 'v0.12.0' }) });
      await svc.restore(1, 10, 77, 7);
      const last = saved[saved.length - 1];
      expect(last).toMatchObject({ changeKind: 'restore', restoredFrom: 2, uiVersion: 'v0.9.2' });
      expect(last.changedFields).toContain('uiVersion');
    });
  });
});
