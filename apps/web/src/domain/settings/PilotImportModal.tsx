import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileUp } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { toast } from '@/store/toast-store';
import { useImportPilotHotels } from './pilot.hooks';
import type { PilotImportResult, PilotImportStatus } from './pilot.service';

/** The API refuses more than this; checked here so the operator hears it before uploading. */
const MAX_IMPORT_CHARS = 500_000;

const STATUS_TONE: Record<PilotImportStatus, 'success' | 'info' | 'gray' | 'warning' | 'error'> = {
  added: 'success',
  reactivated: 'info',
  existing: 'gray',
  duplicate: 'warning',
  invalid: 'error',
};

/**
 * Paste a list or import a CSV (PLN-261012 SG-40, W4: "Dán danh sách" / "Nhập CSV").
 *
 * Two steps on purpose: PREVIEW shows what the import would do — new, resumed, already
 * listed, repeated, unusable lines — and only then does APPLY write. The preview is the
 * server's own dry run (the same function the real import uses), so what is shown is
 * what happens. Editing the text drops the preview: it would describe other text.
 */
export function PilotImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const run = useImportPilotHotels();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<PilotImportResult | null>(null);

  const reset = () => {
    setText('');
    setFileName(null);
    setPreview(null);
    run.reset();
  };
  const close = () => {
    reset();
    onClose();
  };

  const edit = (value: string, name: string | null = null) => {
    setText(value);
    setFileName(name);
    setPreview(null); // the preview described other text
  };

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_IMPORT_CHARS) {
      toast.error(t('pilot.import.fileTooLarge'), { sticky: true });
      return;
    }
    try {
      edit(await file.text(), file.name);
    } catch {
      toast.error(t('pilot.import.fileReadError'), { sticky: true });
    }
  }

  const doPreview = () => run.mutate({ text, dryRun: true }, { onSuccess: setPreview });
  const doApply = () => run.mutate({ text, dryRun: false }, { onSuccess: close });

  const writes = (preview?.added ?? 0) + (preview?.reactivated ?? 0);
  const canApply = !!preview && writes > 0 && !preview.exceedsLimit && !run.isPending;

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={t('pilot.import.title')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {tc('cancel')}
          </Button>
          <Button variant="secondary" disabled={!text.trim() || run.isPending} onClick={doPreview}>
            {t('pilot.import.preview')}
          </Button>
          <Button disabled={!canApply} onClick={doApply}>
            {t('pilot.import.apply', { count: writes })}
          </Button>
        </>
      }
    >
      <p className="text-xs text-gray-500">{t('pilot.import.hint')}</p>

      <div className="mt-3 flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = ''; // the same file picked again must still fire
          }}
        />
        <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
          <FileUp className="h-3.5 w-3.5" /> {t('pilot.import.chooseFile')}
        </Button>
        {fileName && <span className="truncate text-xs text-gray-500">{fileName}</span>}
      </div>

      <textarea
        rows={8}
        value={text}
        onChange={(e) => edit(e.target.value)}
        placeholder={t('pilot.import.placeholder')}
        aria-label={t('pilot.import.title')}
        className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-primary-500"
      />

      {preview && (
        <div className="mt-4 space-y-3" aria-live="polite">
          <div className="flex flex-wrap gap-2">
            <Badge tone="success">{t('pilot.import.countAdded', { count: preview.added })}</Badge>
            <Badge tone="info">{t('pilot.import.countResumed', { count: preview.reactivated })}</Badge>
            <Badge tone="gray">{t('pilot.import.countExisting', { count: preview.existing })}</Badge>
            <Badge tone="warning">{t('pilot.import.countDuplicate', { count: preview.duplicate })}</Badge>
            <Badge tone={preview.invalid ? 'error' : 'gray'}>
              {t('pilot.import.countInvalid', { count: preview.invalid })}
            </Badge>
          </div>
          {preview.headerSkipped && <p className="text-xs text-gray-400">{t('pilot.import.headerSkipped')}</p>}
          {preview.exceedsLimit && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">{t('pilot.import.exceedsLimit')}</p>
          )}
          {preview.invalidRows.length > 0 && (
            <ul className="max-h-32 space-y-0.5 overflow-y-auto rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              {preview.invalidRows.map((r) => (
                <li key={r.line}>{t('pilot.import.invalidLine', { line: r.line, value: r.raw })}</li>
              ))}
            </ul>
          )}
          {writes === 0 && !preview.exceedsLimit && (
            <p className="text-xs text-gray-500">{t('pilot.import.nothingToAdd')}</p>
          )}
          {preview.rows.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-md border border-gray-100">
              <table className="w-full text-left text-xs">
                <tbody className="divide-y divide-gray-50">
                  {preview.rows.map((r) => (
                    <tr key={r.line}>
                      <td className="w-12 px-3 py-1.5 text-gray-400">{r.line}</td>
                      <td className="px-3 py-1.5 font-mono text-gray-700">{r.hotelSn ?? r.raw}</td>
                      <td className="px-3 py-1.5 text-gray-500">{r.note}</td>
                      <td className="px-3 py-1.5 text-right">
                        <Badge tone={STATUS_TONE[r.status]}>{t(`pilot.import.status.${r.status}`)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
