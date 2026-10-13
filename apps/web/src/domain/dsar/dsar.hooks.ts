import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dsarService } from './dsar.service';
import type { DsarLookupBy } from './dsar.service';
import { toast } from '@/store/toast-store';

/** Server error codes this screen can raise, localised here (backend messages are English). */
const KNOWN_CODES = ['E5115', 'E5116', 'E5117'];

function useErrorText() {
  const { t } = useTranslation('dsar');
  return (e: Error & { code?: string }, fallbackKey: string): string =>
    e.code && KNOWN_CODES.includes(e.code) ? t(`error.${e.code}`) : e.message || t(fallbackKey);
}

export function useDsarLookup() {
  const errorText = useErrorText();
  return useMutation({
    mutationFn: (v: { by: DsarLookupBy; term: string }) => dsarService.lookup(v.by, v.term),
    // A lookup is a read: its result is the feedback, an empty one included.
    onError: (e: Error) => toast.error(errorText(e, 'lookupError'), { sticky: true }),
  });
}

/** Save the export as a JSON file — the operator hands it to the requester out-of-band. */
function downloadJson(data: unknown, customerId: number): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `customer-${customerId}-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function useDsarExport() {
  const { t } = useTranslation('dsar');
  const errorText = useErrorText();
  return useMutation({
    mutationFn: (v: { customerId: number; reference?: string }) =>
      dsarService.export(v.customerId, v.reference),
    onSuccess: (data, v) => {
      downloadJson(data, v.customerId);
      toast.success(t('exportDone'));
    },
    onError: (e: Error) => toast.error(errorText(e, 'exportError'), { sticky: true }),
  });
}

export function useDsarErase(onErased?: (customerId: number) => void) {
  const { t } = useTranslation('dsar');
  const errorText = useErrorText();
  return useMutation({
    mutationFn: (v: { customerId: number; reference?: string }) =>
      dsarService.erase(v.customerId, v.reference),
    onSuccess: (_d, v) => {
      toast.success(t('erased'));
      onErased?.(v.customerId);
    },
    onError: (e: Error) => toast.error(errorText(e, 'eraseError'), { sticky: true }),
  });
}
