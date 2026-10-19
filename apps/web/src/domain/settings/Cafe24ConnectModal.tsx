import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { FormRow, Input } from '@/components/Field';
import { toast } from '@/store/toast-store';
import { settingsService } from './settings.service';

/**
 * Cafe24 OAuth connect (PLN-260807 P-A1), now the "add Cafe24" dialog
 * (PLN-261019 D6). Unlike the generic credential modal this begins the
 * Authorization-Code flow: enter the mall id and the browser is sent to
 * Cafe24's consent screen; the public callback stores the tenant's token and
 * returns here with `?cafe24_connected=` / `?cafe24_error=`.
 *
 * Always mounted (closed or not) so the round-trip result toast fires on the
 * page the callback lands on.
 */
export function Cafe24ConnectModal({
  open,
  reconnectMallId,
  onClose,
  onManual,
}: {
  open: boolean;
  /**
   * Set when a mall is already connected through OAuth and the operator chose
   * "configure": the dialog reads as "reconnect" and starts from that mall id
   * (PLN-261019-Cafe24 D4).
   */
  reconnectMallId?: string;
  onClose: () => void;
  /** Switch to the credential modal for operators who already hold a token. */
  onManual: () => void;
}) {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const [mallId, setMallId] = useState('');
  const [connecting, setConnecting] = useState(false);
  const reconnect = reconnectMallId !== undefined;

  // Pre-fill the connected mall each time the dialog opens as "reconnect".
  useEffect(() => {
    if (open) setMallId(reconnectMallId ?? '');
  }, [open, reconnectMallId]);

  // Surface the OAuth round-trip outcome the callback appended to the URL.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const connected = p.get('cafe24_connected');
    const failure = p.get('cafe24_error');
    if (connected) toast.success(t('cafe24.oauth.connectedToast', { mall: connected }));
    // Cafe24's own refusal reason, when it gave one. `invalid_scope` and
    // `access_denied` are fixed in Cafe24's developer admin, not here, so a
    // generic "connect failed" sends the operator looking in the wrong place.
    else if (failure === 'invalid_scope') toast.error(t('cafe24.oauth.errorInvalidScope'));
    else if (failure === 'access_denied') toast.error(t('cafe24.oauth.errorAccessDenied'));
    else if (failure) toast.error(t('cafe24.oauth.connectFailed'));
    if (connected || p.get('cafe24_error')) {
      p.delete('cafe24_connected');
      p.delete('cafe24_error');
      const qs = p.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  }, [t]);

  const connect = async () => {
    const mall = mallId.trim();
    if (!mall) return;
    setConnecting(true);
    try {
      const { authorizeUrl } = await settingsService.connectCafe24(mall);
      window.location.href = authorizeUrl;
    } catch {
      toast.error(t('cafe24.oauth.connectFailed'));
      setConnecting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={reconnect ? t('cafe24.oauth.reconnectTitle') : t('cafe24.oauth.modalTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('close')}
          </Button>
          <Button disabled={!mallId.trim() || connecting} onClick={() => void connect()}>
            {t('cafe24.oauth.connect')}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-gray-500">
        {reconnect
          ? t('cafe24.oauth.reconnectHint', { mall: reconnectMallId || '—' })
          : t('cafe24.oauth.hint')}
      </p>
      <FormRow label={t('cafe24.oauth.mallId')}>
        <div className="flex items-center gap-2">
          <Input value={mallId} placeholder="amoebaorder" onChange={(e) => setMallId(e.target.value)} />
          <span className="text-sm text-gray-400">.cafe24.com</span>
        </div>
      </FormRow>
      <button
        type="button"
        onClick={onManual}
        className="mt-2 text-xs font-medium text-primary-700 hover:underline"
      >
        {t('cafe24.oauth.manualEntry')}
      </button>
    </Modal>
  );
}
