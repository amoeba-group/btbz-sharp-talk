import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import { liveChatService, type VisitorIp } from './live-chat.service';
import { toast } from '@/store/toast-store';

interface Props {
  conversationId: string;
  ip: VisitorIp | null;
  /** customer.pii_reveal (master/director) — the same holders as the customer reveal. */
  canReveal: boolean;
}

/**
 * The visitor's IP in the customer panel (PLN-261023 S2): masked, with an
 * audited reveal. Nothing was recorded for relay channels or for sessions from
 * before addresses were kept, so those read "—".
 */
export function VisitorIpRow({ conversationId, ip, canReveal }: Props) {
  const { t } = useTranslation('livechat');
  const [revealed, setRevealed] = useState<{ firstIp: string | null; lastIp: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setRevealed(null), [conversationId]);

  const onReveal = async () => {
    setBusy(true);
    try {
      setRevealed(await liveChatService.revealVisitorIp(conversationId));
    } catch (e) {
      toast.error((e as Error).message || t('visitorIp.revealFailed'));
    } finally {
      setBusy(false);
    }
  };

  const shown = revealed?.lastIp ?? ip?.masked ?? null;
  return (
    <div className="mt-2 border-t border-gray-100 pt-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-500">{t('visitorIp.label')}</span>
        <span className="flex items-center gap-1 font-mono text-xs text-gray-700" title={ip?.at ? new Date(ip.at).toLocaleString() : undefined}>
          {shown ?? '—'}
          {ip && canReveal && !revealed && (
            <button
              type="button"
              onClick={() => void onReveal()}
              disabled={busy}
              title={t('visitorIp.reveal')}
              aria-label={t('visitorIp.reveal')}
              className="rounded p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-40"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>
      {ip?.changed && (
        <p className="mt-0.5 text-right text-[11px] text-gray-400">
          {revealed?.firstIp ? t('visitorIp.firstWas', { ip: revealed.firstIp }) : t('visitorIp.changed')}
        </p>
      )}
      {revealed && <p className="mt-0.5 text-right text-[11px] text-gray-400">{t('revealedNotice')}</p>}
    </div>
  );
}
