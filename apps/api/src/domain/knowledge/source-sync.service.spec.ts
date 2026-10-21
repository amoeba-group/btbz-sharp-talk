import { Repository } from 'typeorm';
import { SourceSyncService } from './source-sync.service';
import { KbDocument } from './entity/kb-document.entity';
import { KnowledgeSource } from './entity/knowledge-source.entity';
import { KbRevisionService } from './kb-revision.service';
import { GdriveAdapter } from './adapters/gdrive.adapter';
import { NotionAdapter } from './adapters/notion.adapter';
import { SourceItem } from './source-adapter.interface';

const source = (over: Partial<KnowledgeSource> = {}) =>
  ({ id: 5, tenantId: 1, type: 'gdrive', name: 'IVY Help Center', ...over }) as KnowledgeSource;

const item = (over: Partial<SourceItem> = {}): SourceItem => ({
  externalKey: 'post:1',
  title: 'Return policy',
  content: 'Returns accepted within 30 days.',
  sourceUrl: null,
  category: 'IVY Help Center',
  ...over,
});

describe('SourceSyncService.sync', () => {
  let saved: KbDocument[];
  let recorded: string[];

  const build = (
    opts: {
      items?: SourceItem[];
      existing?: Partial<KbDocument>[];
      dropped?: number;
      /** A row of another (or deleted) source holding the same key. */
      holder?: Partial<KbDocument>;
      /** Source ids that still exist. */
      liveSources?: number[];
    } = {},
  ) => {
    saved = [];
    recorded = [];
    let nextId = 700;

    const docRepo = {
      find: jest.fn(async () => (opts.existing ?? []) as KbDocument[]),
      findOne: jest.fn(async () => (opts.holder ? ({ ...opts.holder } as KbDocument) : null)),
      create: (d: Partial<KbDocument>) => d as KbDocument,
      save: jest.fn(async (d: KbDocument) => {
        const withId = { ...d, id: d.id ?? nextId++ } as KbDocument;
        saved.push(withId);
        return withId;
      }),
    } as unknown as Repository<KbDocument>;

    const sourceRepo = {
      save: jest.fn(async (s: KnowledgeSource) => s),
      findOne: jest.fn(async ({ where }: { where: { id: number } }) =>
        (opts.liveSources ?? []).includes(Number(where.id)) ? ({ id: where.id } as KnowledgeSource) : null,
      ),
    } as unknown as Repository<KnowledgeSource>;
    const revisions = {
      record: jest.fn(async (_t: number, _d: unknown, _b: unknown, kind: string) => {
        recorded.push(kind);
        return null;
      }),
    } as unknown as KbRevisionService;

    // Every adapter now sits behind someone else's API, so an empty listing is
    // never proof the source is empty — the reconcile tests below make an item
    // disappear by listing a different one, which is how a file actually goes
    // missing from a Drive folder.
    const gdrive = {
      type: 'gdrive',
      trustEmptyListing: false,
      validateConfig: () => null,
      fetchAll: jest.fn(async () => opts.items ?? [item()]),
    } as unknown as GdriveAdapter;

    // Notion answers with { items, dropped } rather than a bare array — the
    // pipeline has to accept both shapes.
    const notion = {
      type: 'notion',
      trustEmptyListing: false,
      validateConfig: () => null,
      fetchAll: jest.fn(async () => ({ items: opts.items ?? [], dropped: opts.dropped ?? 0 })),
    } as unknown as NotionAdapter;

    return new SourceSyncService(docRepo, sourceRepo, revisions, gdrive, notion);
  };

  it('creates a document for a new source item', async () => {
    const svc = build();
    const { result, touchedIds } = await svc.sync(1, source(), 7);
    expect(result).toMatchObject({ fetched: 1, created: 1, updated: 0, skipped: 0, hidden: 0 });
    expect(touchedIds).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      sourceId: 5,
      docGroup: 'counsel',
      externalKey: 'post:1',
      status: 'pending',
    });
  });

  it('leaves an unchanged, already-indexed item alone', async () => {
    const svc = build({
      existing: [
        {
          id: 10,
          tenantId: 1,
          sourceId: 5,
          externalKey: 'post:1',
          title: 'Return policy',
          content: 'Returns accepted within 30 days.',
          category: 'IVY Help Center',
          sourceUrl: null,
          active: 1,
          status: 'embedded',
        },
      ],
    });
    const { result, touchedIds } = await svc.sync(1, source(), 7);
    expect(result).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(touchedIds).toHaveLength(0);
    expect(saved).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });

  it('re-indexes an unchanged item that was never embedded', async () => {
    // "Unchanged" is not the same as "searchable" — a row left at pending by an
    // earlier partial run would otherwise stay invisible forever (PR #104).
    const svc = build({
      existing: [
        {
          id: 10,
          tenantId: 1,
          sourceId: 5,
          externalKey: 'post:1',
          title: 'Return policy',
          content: 'Returns accepted within 30 days.',
          category: 'IVY Help Center',
          sourceUrl: null,
          active: 1,
          status: 'pending',
        },
      ],
    });
    const { result, touchedIds } = await svc.sync(1, source(), 7);
    expect(result.skipped).toBe(1);
    expect(touchedIds).toEqual([10]);
    expect(recorded).toHaveLength(0); // no revision for a body that did not move
  });

  it('updates an item whose content moved', async () => {
    const svc = build({
      existing: [
        {
          id: 10,
          tenantId: 1,
          sourceId: 5,
          externalKey: 'post:1',
          title: 'Old title',
          content: 'stale',
          category: 'IVY Help Center',
          sourceUrl: null,
          active: 1,
          status: 'embedded',
        },
      ],
    });
    const { result } = await svc.sync(1, source(), 7);
    expect(result).toMatchObject({ created: 0, updated: 1 });
    expect(saved[0]).toMatchObject({ id: 10, title: 'Return policy', status: 'pending' });
    expect(recorded).toEqual(['update']);
  });

  it('hides a document whose source item disappeared, never deletes it', async () => {
    // Hiding is reversible and is what retrieval honours; a hard delete would
    // destroy the revision history's subject (D7).
    const svc = build({
      items: [item({ externalKey: 'post:2', title: 'Still here' })],
      existing: [
        { id: 10, tenantId: 1, sourceId: 5, externalKey: 'post:1', title: 'Gone', active: 1 },
      ],
    });
    const { result } = await svc.sync(1, source(), 7);
    expect(result).toMatchObject({ fetched: 1, hidden: 1 });
    expect(saved.find((d) => d.id === 10)).toMatchObject({ id: 10, active: 0 });
  });

  it('does not re-hide something already hidden', async () => {
    const svc = build({
      items: [item({ externalKey: 'post:2' })],
      existing: [
        { id: 10, tenantId: 1, sourceId: 5, externalKey: 'post:1', title: 'Gone', active: 0 },
        {
          id: 11,
          tenantId: 1,
          sourceId: 5,
          externalKey: 'post:2',
          title: 'Return policy',
          content: 'Returns accepted within 30 days.',
          category: 'IVY Help Center',
          sourceUrl: null,
          active: 1,
          status: 'embedded',
        },
      ],
    });
    expect((await svc.sync(1, source(), 7)).result.hidden).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it('brings a hidden item back to life when it reappears', async () => {
    const svc = build({
      existing: [
        {
          id: 10,
          tenantId: 1,
          sourceId: 5,
          externalKey: 'post:1',
          title: 'Return policy',
          content: 'Returns accepted within 30 days.',
          category: 'IVY Help Center',
          sourceUrl: null,
          active: 0,
          status: 'embedded',
        },
      ],
    });
    const { result } = await svc.sync(1, source(), 7);
    expect(result.updated).toBe(1);
    expect(saved[0]).toMatchObject({ id: 10, active: 1, status: 'pending' });
  });

  it('reports a duplicate key from the adapter rather than letting the last one win', async () => {
    const svc = build({ items: [item(), item({ title: 'Different' })] });
    const { result } = await svc.sync(1, source(), 7);
    expect(result).toMatchObject({ created: 1, failed: 1 });
  });

  it('rejects a sync for a source type with no adapter, loudly', async () => {
    // Registering a source whose type has no adapter and seeing nothing happen
    // is the confusion this work exists to remove.
    const svc = build();
    await expect(svc.sync(1, source({ type: 'repository' }), 7)).rejects.toThrow();
  });

  it('reports which source types can actually ingest', async () => {
    // `board` left this list on 2026-08-26 (REQ-260826 R5) and `repository`
    // never joined it; rows of either type report unsupported and stay put.
    expect(build().supportedTypes()).toEqual(['gdrive', 'notion']);
  });

  it('never embeds inline — it hands ids back for batching', async () => {
    const svc = build({ items: [item(), item({ externalKey: 'post:2', title: 'Second' })] });
    const { touchedIds } = await svc.sync(1, source(), 7);
    expect(touchedIds).toHaveLength(2);
    expect(saved.every((d) => d.status === 'pending')).toBe(true);
  });

  describe('a page another source used to hold (FIX-261021-Notion-Resync)', () => {
    const page = item({ externalKey: 'page:8968', title: 'Hotel Admin guide', content: 'new text' });

    it('adopts the hidden row of a deleted source instead of failing on the unique key', async () => {
      const svc = build({
        items: [page],
        holder: { id: 2501, tenantId: 1, sourceId: 7, externalKey: 'page:8968', active: 0, title: 'old', content: 'old' },
      });
      const { result, touchedIds } = await svc.sync(1, source({ id: 18 }), 22);
      expect(result).toMatchObject({ created: 0, updated: 1, adopted: 1, failed: 0 });
      expect(result.error).toBeUndefined();
      expect(saved[0]).toMatchObject({ id: 2501, sourceId: 18, active: 1, content: 'new text', status: 'pending' });
      expect(touchedIds).toEqual([2501]);
      expect(recorded).toEqual(['update']);
    });

    it('adopts a still-active row whose source no longer exists', async () => {
      const svc = build({
        items: [page],
        holder: { id: 2501, tenantId: 1, sourceId: 7, externalKey: 'page:8968', active: 1, title: 'old', content: 'old' },
        liveSources: [],
      });
      const { result } = await svc.sync(1, source({ id: 18 }), 22);
      expect(result).toMatchObject({ adopted: 1, updated: 1, failed: 0 });
    });

    it('leaves a live document of another source alone and says why, without failing the rest', async () => {
      const svc = build({
        items: [page, item({ externalKey: 'page:other' })],
        holder: { id: 2501, tenantId: 1, sourceId: 7, externalKey: 'page:8968', active: 1 },
        liveSources: [7],
      });
      // findOne answers for every key in this double; only the first item collides.
      const repo = (svc as unknown as { docRepo: { findOne: jest.Mock } }).docRepo;
      repo.findOne.mockImplementation(async ({ where }: { where: { externalKey: string } }) =>
        where.externalKey === 'page:8968' ? { id: 2501, sourceId: 7, active: 1 } : null,
      );
      const { result } = await svc.sync(1, source({ id: 18 }), 22);
      expect(result).toMatchObject({ created: 1, failed: 1 });
      expect(result.error).toContain('page:8968 (source #7 #2501)');
      expect(saved.some((d) => Number(d.id) === 2501)).toBe(false);
    });

    it('never takes over a live hand-written document', async () => {
      const svc = build({
        items: [page],
        holder: { id: 3580, tenantId: 1, sourceId: null, externalKey: 'page:8968', active: 1 },
      });
      const { result } = await svc.sync(1, source({ id: 18 }), 22);
      expect(result).toMatchObject({ failed: 1, updated: 0, created: 0 });
      expect(result.error).toContain('manual document');
    });
  });
});

describe('SourceSyncService — empty-listing guard for external sources', () => {
  const gdriveSource = { id: 9, tenantId: 1, type: 'gdrive', name: '정책 문서' } as KnowledgeSource;

  const buildFor = (
    existing: Partial<KbDocument>[],
    items: SourceItem[] = [],
    opts: { trustEmptyListing?: boolean } = {},
  ) => {
    const saved: KbDocument[] = [];
    const docRepo = {
      find: jest.fn(async () => existing as KbDocument[]),
      findOne: jest.fn(async () => null),
      create: (d: Partial<KbDocument>) => d as KbDocument,
      save: jest.fn(async (d: KbDocument) => {
        saved.push(d);
        return d;
      }),
    } as unknown as Repository<KbDocument>;
    const sourceRepo = { save: jest.fn(async (s: KnowledgeSource) => s) } as unknown as Repository<KnowledgeSource>;
    const revisions = { record: jest.fn(async () => null) } as unknown as KbRevisionService;
    const gdrive = {
      type: 'gdrive',
      trustEmptyListing: opts.trustEmptyListing ?? false,
      validateConfig: () => null,
      fetchAll: jest.fn(async () => items),
    } as unknown as GdriveAdapter;
    const notion = {
      type: 'notion',
      trustEmptyListing: false,
      validateConfig: () => null,
      fetchAll: jest.fn(async () => ({ items })),
    } as unknown as NotionAdapter;
    return { svc: new SourceSyncService(docRepo, sourceRepo, revisions, gdrive, notion), saved };
  };

  const live = (id: number) =>
    ({ id, tenantId: 1, sourceId: 9, externalKey: `file:${id}`, title: `doc ${id}`, active: 1 }) as Partial<KbDocument>;

  it('refuses to hide everything when the listing comes back empty', async () => {
    // Drive returns "no files" for a folder whose sharing was revoked. Hiding
    // here would take the whole source out of retrieval on a transient
    // permission problem — and the result would not say why.
    const { svc, saved } = buildFor([live(1), live(2), live(3)]);
    const { result } = await svc.sync(1, gdriveSource, 7);
    expect(result.guardedEmpty).toBe(true);
    expect(result.hidden).toBe(0);
    expect(saved).toHaveLength(0);
    // The refusal carries its reason (REQ-260828 B1) — the console prints it.
    expect(result.error).toContain('check the source');
  });

  it('still hides normally when the source returned something', async () => {
    // The guard must not become a blanket refusal to ever hide: a file that
    // really was deleted should still disappear.
    const { svc, saved } = buildFor(
      [live(1), live(2)],
      [{ externalKey: 'file:1', title: 'doc 1', content: 'body', sourceUrl: null, category: null }],
    );
    const { result } = await svc.sync(1, gdriveSource, 7);
    expect(result.guardedEmpty).toBeUndefined();
    expect(result.hidden).toBe(1);
    expect(saved.some((d) => Number(d.id) === 2 && d.active === 0)).toBe(true);
  });

  it('does not trip on an empty source that has no documents yet', async () => {
    // First sync of a genuinely empty folder is not an error.
    const { svc } = buildFor([]);
    const { result } = await svc.sync(1, gdriveSource, 7);
    expect(result.guardedEmpty).toBeUndefined();
  });

  it('does not trip when every document is already hidden', async () => {
    const hidden = { ...live(1), active: 0 };
    const { svc } = buildFor([hidden]);
    const { result } = await svc.sync(1, gdriveSource, 7);
    expect(result.guardedEmpty).toBeUndefined();
  });

  it('leaves an adapter that vouches for its own emptiness free to hide', async () => {
    // The guard reads the adapter's own claim rather than the source type. No
    // shipped adapter makes that claim today — every one of them is behind
    // someone else's API — but the flag is what the code branches on, so both
    // sides of it stay described.
    const { svc, saved } = buildFor([{ ...live(1), externalKey: 'file:1' }], [], {
      trustEmptyListing: true,
    });
    const { result } = await svc.sync(1, { id: 9, tenantId: 1, type: 'gdrive', name: 'Help' } as KnowledgeSource, 7);
    expect(result.guardedEmpty).toBeUndefined();
    expect(result.hidden).toBe(1);
    expect(saved[0]).toMatchObject({ active: 0 });
  });
});

describe('SourceSyncService — adapters that hold work back', () => {
  const notionSource = { id: 9, tenantId: 1, type: 'notion', name: 'Manual' } as KnowledgeSource;

  const build = (fetched: unknown) => {
    const docRepo = {
      find: jest.fn(async () => [] as KbDocument[]),
      findOne: jest.fn(async () => null),
      create: (d: Partial<KbDocument>) => d as KbDocument,
      save: jest.fn(async (d: KbDocument) => ({ ...d, id: 1 }) as KbDocument),
    } as unknown as Repository<KbDocument>;
    const sourceRepo = { save: jest.fn(async (s: KnowledgeSource) => s) } as unknown as Repository<KnowledgeSource>;
    const revisions = { record: jest.fn(async () => null) } as unknown as KbRevisionService;
    const stub = (type: string) =>
      ({ type, trustEmptyListing: false, validateConfig: () => null, fetchAll: jest.fn(async () => fetched) }) as unknown as NotionAdapter;
    return new SourceSyncService(
      docRepo,
      sourceRepo,
      revisions,
      stub('gdrive') as unknown as GdriveAdapter,
      stub('notion'),
    );
  };

  it('carries an adapter’s dropped count into the result', async () => {
    // A run that converted 1 of 3 pages must not report the same shape as one
    // that converted everything.
    const svc = build({ items: [item()], dropped: 2 });
    const { result } = await svc.sync(1, notionSource, 7);
    expect(result.fetched).toBe(1);
    expect(result.dropped).toBe(2);
  });

  it('leaves dropped out entirely when nothing was held back', async () => {
    const svc = build({ items: [item()] });
    const { result } = await svc.sync(1, notionSource, 7);
    expect(result.dropped).toBeUndefined();
  });

  it('still accepts an adapter that answers with a bare array', async () => {
    // board and gdrive were written before the richer shape existed.
    const svc = build([item()]);
    const { result } = await svc.sync(1, notionSource, 7);
    expect(result.created).toBe(1);
    expect(result.dropped).toBeUndefined();
  });

  it('times the run, because a Notion sync is minutes not milliseconds', async () => {
    const svc = build({ items: [item()] });
    const { result } = await svc.sync(1, notionSource, 7);
    expect(typeof result.elapsedMs).toBe('number');
  });
});
