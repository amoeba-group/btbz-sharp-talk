import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useToastStore, type ToastTone } from '@/store/toast-store';

const icons: Record<ToastTone, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const colors: Record<ToastTone, string> = {
  success: 'text-success',
  error: 'text-error',
  info: 'text-info',
  warning: 'text-warning',
};

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
      {toasts.map((t) => {
        const Icon = icons[t.tone];
        return (
          <div
            key={t.id}
            className="flex w-80 items-start gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-lg"
          >
            <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${colors[t.tone]}`} />
            {/* pre-line: a sync failure arrives as title / reason / fix on
                separate lines (PLN-261019); single-line messages are unaffected. */}
            <p className="flex-1 whitespace-pre-line text-sm text-gray-700">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
