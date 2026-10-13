import { Repository } from 'typeorm';
import { BulkImportService } from './bulk-import.service';
import { BulkExportService } from './bulk-export.service';
import { KbDocument } from './entity/kb-document.entity';
import { KbRevisionService } from './kb-revision.service';
import { KbCategoryService } from './kb-category.service';

/**
 * The ui_version CSV column (PLN-261012 SG-20), import and export.
 *
 * The trap this pins: a file WITHOUT the column — every export made before it
 * existed, and the Go2Joy policy CSV — must never wipe versions stamped since.
 * Same guard as `video_ref`; a file that HAS the column speaks for every row, so
 * a blank cell clears. And a row differing only in its version is a change, not
 * "unchanged" (re-uploading a re-stamped file must not skip every row).
 */
describe('Bulk import/export — ui_version', () => {
  let saved: KbDocument[];
  let recorded: Array<{ kind: string; before: Partial<KbDocument>; after: Partial<KbDocument> }>;
  let svc: BulkImportService;

  const build = (existing: Partial<KbDocument>[] = []) => {
    saved = [];
    recorded = [];
    let nextId = 900;
    const docRepo = {
      find: jest.fn(async () => existing as KbDocument[]),
      create: (d: Partial<KbDocument>) => d as KbDocument,
      save: jest.fn(async (d: KbDocument) => {
        const withId = { ...d, id: d.id ?? nextId++ } as KbDocument;
        saved.push(withId);
        return withId;
      }),
    } as unknown as Repository<KbDocument>;
    const revisions = {
      record: jest.fn(async (_t: number, after: Partial<KbDocument>, before: Partial<KbDocument>, kind: string) => {
        recorded.push({ kind, before, after });
        return null;
      }),
    } as unknown as KbRevisionService;
    const categories = { ensure: jest.fn() } as unknown as KbCategoryService;
    svc = new BulkImportService(docRepo, revisions, categories);
    return svc;
  };

  const importCsv = (csv: string, existing: Partial<KbDocument>[] = []) => {
    build(existing);
    return svc
      .parseFile('upload.csv', Buffer.from(csv, 'utf8'))
      .then((parsed) => svc.importRecords(1, 'operation', parsed, 7));
  };

  const OLD_HEADER = 'category,title,content,external_key,source_url';
  const NEW_HEADER = `${OLD_HEADER},ui_version`;
  const stored = (over: Partial<KbDocument> = {}): Partial<KbDocument> => ({
    id: 10,
    tenantId: 1,
    docGroup: 'operation',
    externalKey: 'POL-01',
    category: 'Cat',
    title: 'Reconciliation',
    content: 'Closes on the 5th.',
    sourceUrl: null,
    videoRef: null,
    uiVersion: 'v0.9.2',
    status: 'embedded',
    ...over,
  });

  describe('a file WITHOUT the column never wipes a stamped version', () => {
    it('same text: the row is skipped and the version is untouched', async () => {
      const { result } = await importCsv(`${OLD_HEADER}\nCat,Reconciliation,Closes on the 5th.,POL-01,`, [stored()]);
      expect(result).toMatchObject({ skipped: 1, updated: 0, versionChanged: 0 });
      expect(saved).toHaveLength(0);
    });

    it('changed text: the row is updated and KEEPS its version', async () => {
      const { result } = await importCsv(`${OLD_HEADER}\nCat,Reconciliation,Closes on the 6th.,POL-01,`, [stored()]);
      expect(result).toMatchObject({ updated: 1, versionChanged: 0 });
      expect(saved[0].uiVersion).toBe('v0.9.2');
      expect(saved[0].content).toBe('Closes on the 6th.');
    });

    it('a created row is unversioned', async () => {
      const { result } = await importCsv(`${OLD_HEADER}\nCat,New,Body,POL-02,`);
      expect(result.created).toBe(1);
      expect(saved[0].uiVersion).toBeNull();
    });
  });

  describe('a file WITH the column speaks for every row', () => {
    it('creates a row with the version as typed', async () => {
      const { result } = await importCsv(`${NEW_HEADER}\nCat,New,Body,POL-02,,v23.3.0`);
      expect(result).toMatchObject({ created: 1, invalid: 0 });
      expect(saved[0].uiVersion).toBe('v23.3.0');
    });

    it('a blank cell clears a stamped version (the download -> edit -> upload round trip)', async () => {
      const { result } = await importCsv(`${NEW_HEADER}\nCat,Reconciliation,Closes on the 5th.,POL-01,,`, [stored()]);
      expect(result).toMatchObject({ updated: 1, versionChanged: 1 });
      expect(saved[0].uiVersion).toBeNull();
    });

    it('a row that differs ONLY in its version is updated, not skipped, and does not re-embed', async () => {
      const { result, touchedIds } = await importCsv(
        `${NEW_HEADER}\nCat,Reconciliation,Closes on the 5th.,POL-01,,v0.12.0`,
        [stored()],
      );
      expect(result).toMatchObject({ updated: 1, skipped: 0, versionChanged: 1 });
      expect(saved[0].uiVersion).toBe('v0.12.0');
      expect(touchedIds).toEqual([]); // metadata only — the vector is still right
      expect(saved[0].status).toBe('embedded');
    });

    it('records the re-stamp in the document history', async () => {
      await importCsv(`${NEW_HEADER}\nCat,Reconciliation,Closes on the 5th.,POL-01,,v0.12.0`, [stored()]);
      expect(recorded).toHaveLength(1);
      expect(recorded[0].kind).toBe('update');
      expect(recorded[0].before.uiVersion).toBe('v0.9.2');
      expect(recorded[0].after.uiVersion).toBe('v0.12.0');
    });

    it('an identical version is "unchanged": skipped, nothing saved', async () => {
      const { result } = await importCsv(
        `${NEW_HEADER}\nCat,Reconciliation,Closes on the 5th.,POL-01,,v0.9.2`,
        [stored()],
      );
      expect(result).toMatchObject({ skipped: 1, updated: 0, versionChanged: 0 });
      expect(saved).toHaveLength(0);
    });

    it('text AND version changed: one update, re-embedded, version counted', async () => {
      const { result, touchedIds } = await importCsv(
        `${NEW_HEADER}\nCat,Reconciliation,Closes on the 6th.,POL-01,,v0.12.0`,
        [stored()],
      );
      expect(result).toMatchObject({ updated: 1, versionChanged: 1 });
      expect(saved[0]).toMatchObject({ uiVersion: 'v0.12.0', status: 'pending', content: 'Closes on the 6th.' });
      expect(touchedIds).toEqual([10]);
    });

    it('is case-insensitive about the header, like every other column', async () => {
      const { result } = await importCsv(`${OLD_HEADER},UI_Version\nCat,New,Body,POL-02,,v1.0`);
      expect(result.created).toBe(1);
      expect(saved[0].uiVersion).toBe('v1.0');
    });
  });

  describe('refuses a bad label as a row error, importing the rest', () => {
    it.each([
      ['an inner space', 'v 1.0'],
      ['over 16 characters', 'v1.2.3.4.5.6.7.8.9'],
      ['a slash', 'v1/2'],
    ])('%s', async (_n, label) => {
      const { result } = await importCsv(`${NEW_HEADER}\nCat,Good,Body,POL-02,,v1.0\nCat,Bad,Body,POL-03,,${label}`);
      expect(result).toMatchObject({ created: 1, invalid: 1 });
      expect(result.errors).toEqual([{ row: 3, reason: expect.stringContaining('ui_version') }]);
    });
  });

  describe('export', () => {
    const exporter = (docs: Partial<KbDocument>[]) =>
      new BulkExportService({ find: jest.fn(async () => docs) } as unknown as Repository<KbDocument>);

    it('writes ui_version as the last column, blank for an unversioned document', async () => {
      const ex = exporter([stored(), stored({ id: 11, externalKey: 'POL-02', title: 'Other', uiVersion: null })]);
      const rows = await ex.exportRows(1, 'operation');
      expect(rows.map((r) => r[6])).toEqual(['v0.9.2', '']);
      const csv = ex.toCsvBuffer(rows).toString('utf8');
      expect(csv.split(/\r?\n/)[0]).toBe('﻿category,title,content,external_key,source_url,video_ref,ui_version');
    });

    it('round-trips: downloading and re-uploading unchanged is a no-op', async () => {
      const docs = [stored(), stored({ id: 11, externalKey: 'POL-02', title: 'Other', content: 'Body 2', uiVersion: null })];
      const ex = exporter(docs);
      const csv = ex.toCsvBuffer(await ex.exportRows(1, 'operation')).toString('utf8').replace(/^﻿/, '');
      build(docs);
      const parsed = await svc.parseFile('kb.csv', Buffer.from(csv, 'utf8'));
      const { result } = await svc.importRecords(1, 'operation', parsed, 7);
      expect(result).toMatchObject({ parsed: 2, skipped: 2, updated: 0, created: 0, versionChanged: 0, invalid: 0 });
      expect(saved).toHaveLength(0);
    });
  });
});
