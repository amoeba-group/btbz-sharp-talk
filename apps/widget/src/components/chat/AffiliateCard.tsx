import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  affiliateApply,
  affiliateStatus,
} from '../../services/miscService';
import type { AffiliateStatus } from '../../lib/types';
import { isAuthError } from '../../lib/errors';
import { AuthGate } from './AuthGate';
import { useWidgetStore } from '../../store/widgetStore';

export function AffiliateCard({
  sessionToken,
}: {
  sessionToken: string | null;
}) {
  const { t } = useTranslation();
  const steps = t('affiliate.steps', { returnObjects: true }) as string[];
  const [applying, setApplying] = useState(false);
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery<AffiliateStatus>({
    queryKey: ['affiliate-status', sessionToken],
    queryFn: () => affiliateStatus(sessionToken!),
    enabled: !!sessionToken,
    retry: false,
  });

  const status = localStatus ?? data?.status ?? 'none';
  const setAuthenticated = useWidgetStore((st) => st.setAuthenticated);

  async function apply() {
    if (!sessionToken) return;
    setApplying(true);
    try {
      await affiliateApply(sessionToken);
      setLocalStatus('pending');
    } catch (e) {
      // A 401 here just means "not signed in" — the comment used to claim the
      // disabled state surfaced it, but nothing did: the button stayed enabled and
      // the click did nothing at all. Show the sign-in card instead.
      if (isAuthError(e)) setNeedsAuth(true);
      else setError(t('common.error'));
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-2">
      {/* Lead-in reads as the bot speaking, matching frame 65 — the programme
          used to be introduced by a bordered card header instead. */}
      <div className="max-w-[85%] rounded-st-lg bg-gray-100 px-3.5 py-2.5 text-sm text-gray-800">
        {t('affiliate.title')}
      </div>
      {/* Steps are the tenant's own copy (`affiliate.steps`), rendered as the
          design's tinted cards. Deliberately title-only: the design's per-step
          descriptions quote IVY's own terms ("10% back"), which must not be
          baked into a multi-tenant widget. */}
      <ol className="space-y-2 pl-3">
        {steps.map((step, i) => (
          <li key={i} className="rounded-st-lg bg-primary-50 px-3.5 py-3 text-sm font-medium text-gray-800">
            {step}
          </li>
        ))}
      </ol>
      {status === 'approved' ? (
        <div className="flex items-center gap-1.5 text-sm font-medium text-success">
          <CheckCircle2 className="h-4 w-4" />
          {t('affiliate.approved')}
        </div>
      ) : status === 'pending' ? (
        <p className="text-sm font-medium text-warning">{t('affiliate.pending')}</p>
      ) : needsAuth ? (
        <AuthGate
          sessionToken={sessionToken}
          onSuccess={() => {
            setAuthenticated(true);
            setNeedsAuth(false);
          }}
          onCancel={() => setNeedsAuth(false)}
        />
      ) : (
        <button
          disabled={applying}
          onClick={apply}
          className="rounded-full border border-primary-400 bg-white px-4 py-1.5 text-sm font-medium text-primary-600 transition-colors hover:bg-primary-50 disabled:opacity-50"
        >
          {applying ? t('common.loading') : t('affiliate.apply')}
        </button>
      )}
      {error && <p className="mt-2 text-xs text-error">{error}</p>}
    </div>
  );
}
