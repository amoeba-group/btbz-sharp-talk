import { useState } from 'react';
import { Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { saveContactEmail } from '../../services/chatService';

/**
 * Off-hours address capture (PLN-260806). The thread was handed off when nobody
 * was on shift, so the answer has to travel by email — and for a shopper we
 * hold no address for, this is the only place to get one. Kept inline in the
 * thread rather than as a modal: the widget iframe is sandboxed without
 * `allow-modals`, and the conversation stays readable behind it.
 */
export function ContactEmailCard({
  sessionToken,
  onSaved,
}: {
  sessionToken: string | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function submit() {
    if (!sessionToken || !valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveContactEmail(sessionToken, email.trim());
      onSaved();
    } catch {
      // Backend messages are English by design; localize by intent here.
      setError(t('chat.contactEmail.failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-st-md border border-gray-200 bg-gray-50 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-800">
        <Mail className="h-4 w-4 shrink-0 text-primary-500" />
        {t('chat.contactEmail.title')}
      </div>
      <p className="mb-2 text-xs text-gray-600">{t('chat.contactEmail.body')}</p>
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={t('chat.contactEmail.placeholder')}
          className="min-w-0 flex-1 rounded-st-md border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <button
          onClick={submit}
          disabled={!valid || saving}
          className="shrink-0 rounded-st-md bg-primary-500 px-3 py-2 text-sm font-medium text-on-primary hover:bg-primary-600 disabled:opacity-50"
        >
          {saving ? t('common.loading') : t('chat.contactEmail.submit')}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-error">{error}</p>}
      <p className="mt-2 text-[11px] text-gray-400">{t('chat.contactEmail.privacy')}</p>
    </div>
  );
}
