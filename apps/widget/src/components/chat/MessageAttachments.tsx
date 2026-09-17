import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, X } from 'lucide-react';
import type { ChatAttachment } from '../../lib/types';
import { resolveFileUrl } from '../../lib/api-client';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Files on a widget bubble (PLN-260814 S3). The viewer is deliberately smaller
 * than the console's: a shopper wants to check the photo they just sent, not
 * page through a gallery, and the widget is 380px wide on a phone.
 */
export function MessageAttachments({
  attachments,
  mine,
}: {
  attachments: ChatAttachment[];
  mine: boolean;
}) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState<ChatAttachment | null>(null);
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  const images = attachments.filter((a) => a.kind === 'image');
  const files = attachments.filter((a) => a.kind !== 'image');

  return (
    <div className="mt-1 space-y-1">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {images.map((a) =>
            broken[a.id] ? (
              <div
                key={a.id}
                className="flex h-20 w-20 items-center justify-center rounded-st-xs border border-dashed border-gray-300 bg-gray-50 px-1 text-center text-[10px] text-gray-500"
              >
                {t('chat.attachment.unavailable')}
              </div>
            ) : (
              <button
                key={a.id}
                type="button"
                onClick={() => setZoom(a)}
                className="overflow-hidden rounded-st-xs border border-black/5"
                aria-label={t('chat.attachment.open', { name: a.filename })}
              >
                <img
                  src={resolveFileUrl(a.thumbUrl || a.url)}
                  alt={a.filename}
                  loading="lazy"
                  className="h-20 w-20 object-cover"
                  onError={() => setBroken((prev) => ({ ...prev, [a.id]: true }))}
                />
              </button>
            ),
          )}
        </div>
      )}

      {files.map((a) => (
        <a
          key={a.id}
          href={resolveFileUrl(a.url)}
          target="_blank"
          rel="noopener noreferrer"
          className={
            mine
              ? 'flex items-center gap-1.5 rounded-st-xs bg-white/20 px-2 py-1 text-[11px]'
              : 'flex items-center gap-1.5 rounded-st-xs bg-white px-2 py-1 text-[11px] text-gray-700'
          }
        >
          <FileText className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate">{a.filename}</span>
          <span className="flex-shrink-0 opacity-70">{formatBytes(a.size)}</span>
        </a>
      ))}

      {zoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoom(null)}
          role="dialog"
          aria-modal="true"
          aria-label={zoom.filename}
        >
          <button
            type="button"
            onClick={() => setZoom(null)}
            aria-label={t('chat.attachment.close')}
            className="absolute right-3 top-3 rounded-st-xs p-1 text-white hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={resolveFileUrl(zoom.url)}
            alt={zoom.filename}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )}
    </div>
  );
}
