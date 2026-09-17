import { useId, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
  Loader2,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

type Action = 'accept' | 'decline';

/**
 * CCPA/GDPR consent notice (wireframe 5.1). Fail-closed: the banner only goes
 * away after the parent's async handler resolves (server acknowledged); on
 * failure an inline error + retry keeps the choice available.
 */
export function ConsentBanner({
  version,
  privacyPolicyUrl,
  noticeOutdated,
  onAccept,
  onDecline,
  onOpenPrivacySettings,
}: {
  /** Consent notice version currently in force (chip next to the title). */
  version?: string | null;
  /** Tenant privacy-policy link; hidden when not configured. */
  privacyPolicyUrl?: string | null;
  /** True when a previous consent predates the current notice version. */
  noticeOutdated?: boolean;
  onAccept: () => Promise<void>;
  onDecline: () => Promise<void>;
  /** Opens the settings/preferences area (DSAR export/delete + opt-out). */
  onOpenPrivacySettings: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const [saving, setSaving] = useState<Action | null>(null);
  const [failed, setFailed] = useState<Action | null>(null);

  async function run(action: Action) {
    if (saving) return;
    setSaving(action);
    setFailed(null);
    try {
      await (action === 'accept' ? onAccept() : onDecline());
    } catch {
      setFailed(action);
    } finally {
      setSaving(null);
    }
  }

  const disclosures: string[] = [
    t('chat.consent.items'),
    t('chat.consent.purpose'),
    t('chat.consent.retention'),
    t('chat.consent.aiProcessor'),
  ];

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="rounded-st-md border border-gray-200 bg-gray-50 p-3"
    >
      <div
        id={titleId}
        className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-800"
      >
        <ShieldCheck className="h-4 w-4 shrink-0 text-primary-500" />
        <span className="flex-1">{t('chat.consent.title')}</span>
        {version && (
          <span
            className="rounded-full border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-500"
            aria-label={t('chat.consent.versionLabel', { version })}
          >
            {version}
          </span>
        )}
      </div>

      {noticeOutdated && (
        <p className="mb-1 text-xs font-medium text-warning">
          {t('chat.consent.updated')}
        </p>
      )}

      <p className="mb-2 text-xs leading-relaxed text-gray-600">
        {t('chat.consent.body')}
      </p>

      <ul className="mb-2 space-y-0.5 text-[11px] leading-relaxed text-gray-500">
        {disclosures.map((line) => (
          <li key={line} className="flex gap-1">
            <span aria-hidden="true">•</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        {privacyPolicyUrl && (
          <a
            href={privacyPolicyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary-600 underline hover:text-primary-500"
          >
            {t('chat.consent.policyLink')}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        <button
          type="button"
          onClick={onOpenPrivacySettings}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary-600 underline hover:text-primary-500"
        >
          <SlidersHorizontal className="h-3 w-3" />
          {t('chat.consent.privacyChoices')}
        </button>
      </div>

      {failed && (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-error" role="alert">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{t('chat.consent.saveError')}</span>
          <button
            type="button"
            onClick={() => void run(failed)}
            className="font-medium underline hover:opacity-80"
          >
            {t('chat.consent.retry')}
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => void run('accept')}
          disabled={saving !== null}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-st-md bg-primary-500 px-3 py-2 text-xs font-medium text-on-primary hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
        >
          {saving === 'accept' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('chat.consent.accept')}
        </button>
        <button
          onClick={() => void run('decline')}
          disabled={saving !== null}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-st-md border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
        >
          {saving === 'decline' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('chat.consent.decline')}
        </button>
      </div>
    </div>
  );
}
