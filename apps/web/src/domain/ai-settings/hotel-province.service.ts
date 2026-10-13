import { apiDelete, apiGet, apiPostForm } from '@/lib/api-client';

/** One malformed CSV row: `code` is what the console localises, `reason` is the English log text. */
export interface HotelCsvProblem {
  line: number;
  code: string;
  reason: string;
  hotelSn?: string;
}

/** What an upload (or its dry run) found — mirrors the API's HotelProvinceImportReport. */
export interface HotelProvinceReport {
  dryRun: boolean;
  applied: boolean;
  rows: number;
  duplicates: number;
  problemCount: number;
  problems: HotelCsvProblem[];
  provinces: number;
  unmappedProvinces: Array<{ province: string; hotels: number }>;
  unmappedCount: number;
  regionRoutingEnabled: boolean;
  existingRows: number;
}

export const hotelProvinceService = {
  summary: () => apiGet<{ rows: number; updatedAt: string | null }>('/ai-config/hotel-provinces'),
  /** `dryRun` previews the file without touching the table; false replaces the whole table. */
  importCsv: (file: File, dryRun: boolean) => {
    const form = new FormData();
    form.append('file', file);
    return apiPostForm<HotelProvinceReport>(`/ai-config/hotel-provinces/import?dry_run=${dryRun}`, form);
  },
  clear: () => apiDelete<{ removed: number }>('/ai-config/hotel-provinces'),
};
