import { BulkExportService } from './bulk-export.service';
import { KbDocument } from './entity/kb-document.entity';
import { parseCsvRecords, parseCsv, toCsv } from './csv.util';
import { parseXlsxRecords } from './xlsx.util';

const doc = (over: Partial<KbDocument>): KbDocument =>
  ({
    id: 1,
    category: 'faq',
    title: 'Title',
    content: 'Content',
    externalKey: null,
    sourceUrl: null,
    ...over,
  }) as KbDocument;

function serviceWith(docs: KbDocument[]) {
  const find = jest.fn().mockResolvedValue(docs);
  const service = new BulkExportService({ find } as never);
  return { service, find };
}

describe('toCsv', () => {
  it('escapes commas, quotes and newlines, and round-trips through parseCsv', () => {
    const rows = [
      ['a,b', 'say "hi"', 'line1\nline2'],
      ['plain', '', 'ok'],
    ];
    const parsed = parseCsv(toCsv(['c1', 'c2', 'c3'], rows));
    expect(parsed).toEqual([['c1', 'c2', 'c3'], ...rows]);
  });
});

describe('BulkExportService', () => {
  it('queries only the tenant + group + active documents, ordered for diffing', async () => {
    const { service, find } = serviceWith([]);
    await service.exportRows(7, 'counsel');
    expect(find).toHaveBeenCalledWith({
      where: { tenantId: 7, docGroup: 'counsel', active: 1 },
      order: { category: 'ASC', id: 'ASC' },
    });
  });

  it('maps documents into the bulk-import column order with empty strings for nulls', async () => {
    const { service } = serviceWith([
      doc({ category: null, title: 'T', content: null, externalKey: 'K-1', sourceUrl: 'http://s' }),
    ]);
    const rows = await service.exportRows(1, 'counsel');
    expect(rows).toEqual([['', 'T', '', 'K-1', 'http://s', '']]);
  });

  it('CSV starts with a BOM so Korean Excel opens it as UTF-8', async () => {
    const { service } = serviceWith([]);
    const buffer = service.toCsvBuffer(await service.exportRows(1, 'counsel'));
    expect(buffer[0]).toBe(0xef);
    expect(buffer[1]).toBe(0xbb);
    expect(buffer[2]).toBe(0xbf);
  });

  it('CSV round-trips through the importer parser unchanged (the contract)', async () => {
    const { service } = serviceWith([
      doc({ category: '배송', title: '배송 안내, 상세', content: '1행\n"2행"', externalKey: 'GUIDE-1' }),
      doc({ id: 2, title: 'Plain', content: 'Text' }),
    ]);
    const buffer = service.toCsvBuffer(await service.exportRows(1, 'counsel'));
    const { headers, records } = parseCsvRecords(buffer.toString('utf8'));
    expect(headers).toEqual(['category', 'title', 'content', 'external_key', 'source_url', 'video_ref']);
    expect(records).toEqual([
      { category: '배송', title: '배송 안내, 상세', content: '1행\n"2행"', external_key: 'GUIDE-1', source_url: '', video_ref: '' },
      { category: 'faq', title: 'Plain', content: 'Text', external_key: '', source_url: '', video_ref: '' },
    ]);
  });

  it('XLSX round-trips through the importer parser unchanged', async () => {
    const { service } = serviceWith([
      doc({ category: '운영', title: '제목', content: '여러 줄\n내용', externalKey: 'OPS-1' }),
    ]);
    const buffer = await service.toXlsxBuffer(await service.exportRows(1, 'operation'));
    const { headers, records } = await parseXlsxRecords(buffer);
    expect(headers).toEqual(['category', 'title', 'content', 'external_key', 'source_url', 'video_ref']);
    expect(records).toEqual([
      { category: '운영', title: '제목', content: '여러 줄\n내용', external_key: 'OPS-1', source_url: '', video_ref: '' },
    ]);
  });
});
