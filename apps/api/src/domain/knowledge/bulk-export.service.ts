import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workbook } from 'exceljs';
import { KbDocument } from './entity/kb-document.entity';
import { toCsv } from './csv.util';

/**
 * Export column set == the bulk importer's column set, on purpose
 * (PLN-260903 D1). The whole point of the export is the round-trip:
 * download → edit in a spreadsheet → upload, with untouched rows skipping and
 * edited rows updating. Internal fields (id, status, source) would ride along
 * as dead columns the importer ignores, and invite edits that do nothing.
 */
const EXPORT_COLUMNS = ['category', 'title', 'content', 'external_key', 'source_url', 'video_ref'] as const;

/** Bulk document export for the download → edit → re-upload loop (PLN-260903). */
@Injectable()
export class BulkExportService {
  constructor(
    @InjectRepository(KbDocument) private readonly docRepo: Repository<KbDocument>,
  ) {}

  /**
   * Active documents only: inactive rows are "not the KB right now", and the
   * importer would resurrect them as new active documents on re-upload.
   */
  async exportRows(tenantId: number, docGroup: string): Promise<string[][]> {
    const docs = await this.docRepo.find({
      where: { tenantId, docGroup, active: 1 },
      order: { category: 'ASC', id: 'ASC' },
    });
    return docs.map((d) => [
      d.category ?? '',
      d.title,
      d.content ?? '',
      d.externalKey ?? '',
      d.sourceUrl ?? '',
      d.videoRef ?? '',
    ]);
  }

  /** BOM so Korean-locale Excel opens the file as UTF-8 instead of CP949. */
  toCsvBuffer(rows: string[][]): Buffer {
    return Buffer.from('\uFEFF' + toCsv([...EXPORT_COLUMNS], rows), 'utf8');
  }

  async toXlsxBuffer(rows: string[][]): Promise<Buffer> {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('documents');
    sheet.columns = EXPORT_COLUMNS.map((header) => ({
      header,
      // content dominates every document; the rest are identifiers.
      width: header === 'content' ? 80 : header === 'title' ? 40 : 20,
    }));
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
