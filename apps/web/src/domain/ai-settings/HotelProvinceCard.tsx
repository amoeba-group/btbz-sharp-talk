import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Label } from '@/components/Field';
import {
  useHotelProvinceApply,
  useHotelProvinceClear,
  useHotelProvincePreview,
  useHotelProvinceSummary,
} from './hotel-province.hooks';
import type { HotelProvinceReport } from './hotel-province.service';

/** Problems listed in the preview; the count above them is always exact. */
const PROBLEMS_SHOWN = 10;
const UNMAPPED_SHOWN = 8;

/**
 * Hotel → province table upload (PLN-261012 SG-67, REQ-261007 R3), under the region table: for
 * hosts that sign the hotel but not its province. Pick a CSV, PREVIEW it (nothing is stored), read
 * what it holds — rows, provinces the region table does not list, malformed rows — and only then
 * replace the table. A file with a malformed row cannot be applied; fix it and preview again.
 * The signed hotelSn is the only key: a hotel name in the file is ignored.
 */
export function HotelProvinceCard() {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  const summary = useHotelProvinceSummary();
  const preview = useHotelProvincePreview();
  const apply = useHotelProvinceApply();
  const clear = useHotelProvinceClear();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<HotelProvinceReport | null>(null);

  const reset = () => {
    setFile(null);
    setReport(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const pick = (f: File | null) => {
    setFile(f);
    setReport(null); // a new file invalidates the previous preview
  };

  const runPreview = () => {
    if (file) preview.mutate(file, { onSuccess: setReport });
  };

  const runApply = () => {
    if (file) apply.mutate(file, { onSuccess: reset });
  };

  const rows = summary.data?.rows ?? 0;
  const blocked = !!report && report.problemCount > 0;

  return (
    <div className="space-y-2 border-t border-gray-100 pt-3" data-testid="hotel-province-card">
      <Label>{t('handoff.hotelTitle')}</Label>
      <p className="text-[11px] text-gray-400">{t('handoff.hotelHint')}</p>
      <p className="text-[11px] text-gray-400">{t('handoff.hotelFormat')}</p>

      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <span>
          {rows > 0
            ? t('handoff.hotelRows', { count: rows })
            : summary.isLoading
              ? tc('loading')
              : t('handoff.hotelEmpty')}
        </span>
        {summary.data?.updatedAt && (
          <span className="text-gray-400">
            {t('handoff.hotelUpdated', { at: new Date(summary.data.updatedAt).toLocaleString() })}
          </span>
        )}
        {rows > 0 && (
          <button
            type="button"
            className="font-medium text-red-500 hover:underline disabled:opacity-50"
            disabled={clear.isPending}
            onClick={() => {
              if (window.confirm(t('handoff.hotelClearConfirm', { count: rows }))) clear.mutate();
            }}
          >
            {t('handoff.hotelClear')}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          aria-label={t('handoff.hotelChoose')}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          className="text-xs text-gray-600 file:mr-2 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-2 file:py-1 file:text-xs"
        />
        <Button type="button" size="sm" variant="secondary" disabled={!file || preview.isPending} onClick={runPreview}>
          {preview.isPending ? tc('loading') : t('handoff.hotelPreview')}
        </Button>
      </div>

      {report && (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
          <p className="font-medium">
            {t('handoff.hotelPreviewResult', {
              rows: report.rows,
              provinces: report.provinces,
              duplicates: report.duplicates,
              problems: report.problemCount,
            })}
          </p>

          {report.problemCount > 0 && (
            <div>
              <p className="font-medium text-red-600">{t('handoff.hotelProblems', { count: report.problemCount })}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {report.problems.slice(0, PROBLEMS_SHOWN).map((p) => (
                  <li key={`${p.line}-${p.code}`}>
                    {t('handoff.hotelProblemRow', {
                      line: p.line,
                      reason: t(`handoff.hotelProblem.${p.code}`, { defaultValue: p.reason }),
                    })}
                  </li>
                ))}
              </ul>
              {report.problemCount > PROBLEMS_SHOWN && (
                <p className="mt-1 text-gray-500">{t('handoff.hotelMore', { count: report.problemCount - PROBLEMS_SHOWN })}</p>
              )}
              <p className="mt-1 text-gray-500">{t('handoff.hotelFixFirst')}</p>
            </div>
          )}

          {report.unmappedCount > 0 && (
            <div>
              <p className="font-medium text-amber-700">{t('handoff.hotelUnmapped', { count: report.unmappedCount })}</p>
              <p className="mt-1">
                {report.unmappedProvinces
                  .slice(0, UNMAPPED_SHOWN)
                  .map((u) => `${u.province} (${u.hotels})`)
                  .join(', ')}
                {report.unmappedCount > UNMAPPED_SHOWN && ` … +${report.unmappedCount - UNMAPPED_SHOWN}`}
              </p>
            </div>
          )}

          {!report.regionRoutingEnabled && <p className="text-amber-700">{t('handoff.hotelRoutingOff')}</p>}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="button" size="sm" disabled={blocked || report.rows === 0 || apply.isPending} onClick={runApply}>
              {apply.isPending ? tc('saving') : t('handoff.hotelApply')}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={reset}>
              {tc('cancel')}
            </Button>
            {report.existingRows > 0 && !blocked && (
              <span className="text-gray-500">{t('handoff.hotelReplaces', { old: report.existingRows, count: report.rows })}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
