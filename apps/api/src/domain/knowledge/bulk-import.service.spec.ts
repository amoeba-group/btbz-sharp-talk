import { Repository } from 'typeorm';
import { Workbook } from 'exceljs';
import { BulkImportService } from './bulk-import.service';
import { KbDocument } from './entity/kb-document.entity';
import { KbRevisionService } from './kb-revision.service';
import { KbCategoryService } from './kb-category.service';
import { BusinessException } from '../../global/exception/business.exception';

const HEADER = 'category,title,content,external_key,source_url';
const row = (over: Partial<Record<string, string>> = {}) => {
  const f = {
    category: '리뷰 관리',
    title: '리뷰 답글 등록',
    content: '"하나의 리뷰당 답글은 1회만 등록 가능하다."',
    key: 'GTJ-REV-01',
    url: '',
    ...over,
  };
  return `${f.category},${f.title},${f.content},${f.key},${f.url}`;
};

describe('BulkImportService', () => {
  let saved: KbDocument[];
  let recorded: string[];
  let ensured: string[];
  let svc: BulkImportService;

  const build = (existing: Partial<KbDocument>[] = []) => {
    saved = [];
    recorded = [];
    ensured = [];
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
      record: jest.fn(async (_t: number, _d: unknown, _b: unknown, kind: string) => {
        recorded.push(kind);
        return null;
      }),
    } as unknown as KbRevisionService;
    const categories = {
      ensure: jest.fn(async (_t: number, name: string) => {
        ensured.push(name);
      }),
    } as unknown as KbCategoryService;
    svc = new BulkImportService(docRepo, revisions, categories);
    return svc;
  };

  const importCsv = (csv: string, group = 'operation', existing: Partial<KbDocument>[] = []) => {
    build(existing);
    return svc
      .parseFile('upload.csv', Buffer.from(csv, 'utf8'))
      .then((parsed) => svc.importRecords(1, group, parsed, 7));
  };

  it('creates a document in the requested group, pending for the batch embedder', async () => {
    const { result, touchedIds } = await importCsv(`${HEADER}\n${row()}`);
    expect(result).toMatchObject({ parsed: 1, created: 1, updated: 0, skipped: 0, invalid: 0 });
    expect(touchedIds).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      docGroup: 'operation',
      externalKey: 'GTJ-REV-01',
      category: '리뷰 관리',
      title: '리뷰 답글 등록',
      status: 'pending',
      active: 1,
    });
    expect(recorded).toEqual(['create']);
  });

  it('matches a stored title with stray whitespace instead of duplicating it', async () => {
    const { result } = await importCsv(`${HEADER}\n${row({ title: '아시아 배송', key: '' })}`, 'counsel', [
      {
        id: 21,
        tenantId: 1,
        docGroup: 'counsel',
        externalKey: null,
        category: '리뷰 관리',
        title: '아시아 배송 ',
        content: '"하나의 리뷰당 답글은 1회만 등록 가능하다."',
        status: 'embedded',
      },
    ]);
    // The padded title differs from the row's trimmed one, so this lands as a
    // one-time normalizing update — never as a new document.
    expect(result).toMatchObject({ created: 0, updated: 1, invalid: 0 });
    expect(saved[0]).toMatchObject({ id: 21, title: '아시아 배송' });
  });

  it('accepts an empty category as uncategorized — the export round-trip depends on it', async () => {
    const { result } = await importCsv(`${HEADER}\n${row({ category: '' })}`);
    expect(result).toMatchObject({ created: 1, invalid: 0 });
    expect(saved[0]).toMatchObject({ category: null });
    expect(ensured).toEqual([]);
  });

  it('ensures each category exists without touching existing rows', async () => {
    await importCsv(`${HEADER}\n${row()}\n${row({ category: '대시보드', title: '대시보드 조회', key: 'GTJ-DSH-01' })}`);
    expect(ensured.sort()).toEqual(['대시보드', '리뷰 관리']);
  });

  it('matches header names case-insensitively', async () => {
    const { result } = await importCsv(`Category,TITLE,Content\nfaq,환불 안내,7일 이내 환불 가능`);
    expect(result.created).toBe(1);
    expect(saved[0]).toMatchObject({ title: '환불 안내', externalKey: null });
  });

  it('updates by external_key and re-queues for embedding', async () => {
    const { result } = await importCsv(`${HEADER}\n${row({ content: '개정된 내용' })}`, 'operation', [
      {
        id: 10,
        tenantId: 1,
        docGroup: 'operation',
        externalKey: 'GTJ-REV-01',
        category: '리뷰 관리',
        title: '리뷰 답글 등록',
        content: '옛 내용',
        status: 'embedded',
      },
    ]);
    expect(result).toMatchObject({ created: 0, updated: 1 });
    expect(saved[0]).toMatchObject({ id: 10, content: '개정된 내용', status: 'pending' });
    expect(recorded).toEqual(['update']);
  });

  it('falls back to a title match and adopts the file external_key', async () => {
    // The next upload of the same file must then match by the stable key.
    const { result } = await importCsv(`${HEADER}\n${row({ content: '새 내용' })}`, 'operation', [
      {
        id: 11,
        tenantId: 1,
        docGroup: 'operation',
        externalKey: null,
        category: '리뷰 관리',
        title: '리뷰 답글 등록',
        content: '옛 내용',
        status: 'embedded',
      },
    ]);
    expect(result).toMatchObject({ updated: 1, created: 0 });
    expect(saved[0]).toMatchObject({ id: 11, externalKey: 'GTJ-REV-01' });
  });

  it('skips an unchanged row but re-queues one that never embedded', async () => {
    const base = {
      tenantId: 1,
      docGroup: 'operation',
      externalKey: 'GTJ-REV-01',
      category: '리뷰 관리',
      title: '리뷰 답글 등록',
      content: '하나의 리뷰당 답글은 1회만 등록 가능하다.',
      sourceUrl: null,
    };
    const embedded = await importCsv(`${HEADER}\n${row()}`, 'operation', [
      { ...base, id: 10, status: 'embedded' },
    ]);
    expect(embedded.result).toMatchObject({ skipped: 1 });
    expect(embedded.touchedIds).toHaveLength(0);

    const pending = await importCsv(`${HEADER}\n${row()}`, 'operation', [
      { ...base, id: 10, status: 'pending' },
    ]);
    expect(pending.result).toMatchObject({ skipped: 1 });
    expect(pending.touchedIds).toEqual([10]);
    expect(recorded).toHaveLength(0);
  });

  it('reports in-file duplicates instead of letting the last row win', async () => {
    const dupKey = await importCsv(`${HEADER}\n${row()}\n${row({ title: '다른 제목' })}`);
    expect(dupKey.result).toMatchObject({ created: 1, invalid: 1 });
    expect(dupKey.result.errors[0].reason).toContain('duplicate external_key');

    const dupTitle = await importCsv(
      `category,title,content\nfaq,같은 제목,본문 A\nfaq,같은 제목,본문 B`,
    );
    expect(dupTitle.result).toMatchObject({ created: 1, invalid: 1 });
    expect(dupTitle.result.errors[0].reason).toContain('duplicate title');
  });

  it('reports empty and over-length fields as row errors, not import failures', async () => {
    const { result } = await importCsv(
      [
        HEADER,
        row({ content: '' }),
        row({ title: '', key: 'GTJ-X-01' }),
        row({ title: 'ㅋ'.repeat(256), key: 'GTJ-X-02' }),
        row({ title: '정상 행', key: 'GTJ-X-03' }),
      ].join('\n'),
    );
    expect(result).toMatchObject({ parsed: 4, created: 1, invalid: 3 });
    expect(result.errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(result.errors[0].reason).toBe('content is empty');
    expect(result.errors[2].reason).toContain('255');
  });

  it('rejects a file missing required columns with the specific code', async () => {
    await expect(importCsv('title,content\nA,B')).rejects.toMatchObject({ errorCode: 'E5063' });
  });

  it('rejects an empty file with the specific code', async () => {
    await expect(importCsv(HEADER)).rejects.toMatchObject({ errorCode: 'E5065' });
  });

  it('rejects a non-UTF-8 CSV (Korean-Excel CP949) with the encoding code', async () => {
    build();
    // '가나다' in CP949 — invalid UTF-8, decodes to U+FFFD.
    const cp949 = Buffer.from([0xb0, 0xa1, 0xb3, 0xaa, 0xb4, 0xd9]);
    await expect(svc.parseFile('list.csv', cp949)).rejects.toMatchObject({ errorCode: 'E5062' });
  });

  it('rejects an unsupported extension with the specific code', async () => {
    build();
    await expect(svc.parseFile('list.xls', Buffer.from('x'))).rejects.toThrow(BusinessException);
    await expect(svc.parseFile('list.xls', Buffer.from('x'))).rejects.toMatchObject({ errorCode: 'E5061' });
  });

  it('imports an .xlsx workbook through the same pipeline', async () => {
    build();
    const wb = new Workbook();
    const ws = wb.addWorksheet('docs');
    ws.addRow(['category', 'title', 'content', 'external_key']);
    ws.addRow(['대시보드', '대시보드 조회', '예약량·성과·리뷰를 한 화면에서 본다.', 'GTJ-DSH-01']);
    ws.addRow([]); // formatting-only row must not become a record
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const parsed = await svc.parseFile('docs.xlsx', buffer);
    const { result } = await svc.importRecords(1, 'operation', parsed, 7);
    expect(result).toMatchObject({ parsed: 1, created: 1, invalid: 0 });
    expect(saved[0]).toMatchObject({ title: '대시보드 조회', externalKey: 'GTJ-DSH-01' });
  });

  describe('video_ref (PLN-261006-KB-Video-Links)', () => {
    const VHEADER = `${HEADER},video_ref`;
    const BLOCK = 'notion:4648fee0bb548292bc6381250b79b647';
    const existingDoc = (over: Partial<KbDocument> = {}): Partial<KbDocument> => ({
      id: 5,
      tenantId: 1,
      docGroup: 'operation',
      externalKey: 'GTJ-REV-01',
      category: '리뷰 관리',
      title: '리뷰 답글 등록',
      content: '하나의 리뷰당 답글은 1회만 등록 가능하다.',
      sourceUrl: null,
      videoRef: null,
      status: 'embedded',
      ...over,
    });

    it('sets the video on create when the column is present', async () => {
      await importCsv(`${VHEADER}\n${row()},${BLOCK}`);
      expect(saved[0].videoRef).toBe(BLOCK);
    });

    it('a video-only change updates the link without re-embedding', async () => {
      const { result, touchedIds } = await importCsv(`${VHEADER}\n${row()},${BLOCK}`, 'operation', [existingDoc()]);
      expect(result).toMatchObject({ updated: 1, skipped: 0 });
      expect(saved[0]).toMatchObject({ videoRef: BLOCK, status: 'embedded' });
      expect(touchedIds).toHaveLength(0);
      expect(recorded).toHaveLength(0);
    });

    it('an older file without the column leaves an existing link alone', async () => {
      const { result } = await importCsv(`${HEADER}\n${row()}`, 'operation', [existingDoc({ videoRef: BLOCK })]);
      expect(result).toMatchObject({ skipped: 1 });
      expect(saved).toHaveLength(0);
    });

    it('an empty cell in a file WITH the column clears the link', async () => {
      await importCsv(`${VHEADER}\n${row()},`, 'operation', [existingDoc({ videoRef: BLOCK })]);
      expect(saved[0].videoRef).toBeNull();
    });

    it('rejects anything but https:// or notion:<32 hex>', async () => {
      const { result } = await importCsv(`${VHEADER}\n${row({ key: 'A' })},javascript:alert(1)\n${row({ key: 'B', title: 'b' })},notion:xyz`);
      expect(result).toMatchObject({ invalid: 2, created: 0 });
    });
  });
});
