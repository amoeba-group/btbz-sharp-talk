import { useEffect, useId, useRef, useState } from 'react';
import { LogIn, Search, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { guestLookup } from '../../services/orderService';
import { useStorefrontLogin } from '../../hooks/useStorefrontLogin';
import { useWidgetStore } from '../../store/widgetStore';
import { useAnalytics } from '../../lib/analytics';
import { isAuthError } from '../../lib/errors';
import { openHostUrl } from '../../lib/host-bridge';
import { Spinner } from '../ui/Spinner';

export function AuthGate({
  sessionToken,
  reason = 'order',
  onSuccess,
  onCancel,
}: {
  sessionToken: string | null;
  /**
   * Why the card is up (PLN-261001 V1): the order gate offers the storefront
   * sign-in and the guest order lookup; the agent's guest policy offers the
   * tenant's partner sign-in / registration links instead — there is no order
   * to look up on a partner desk.
   */
  reason?: 'order' | 'login';
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { canLogin, pending, login, cancel } = useStorefrontLogin();
  const guestGuidance = useWidgetStore((s) => s.guestGuidance);
  const commerceEnabled = useWidgetStore((s) => s.commerceEnabled);
  const loginMode = useWidgetStore((s) => s.loginMode);
  const analytics = useAnalytics();
  const [mode, setMode] = useState<'choice' | 'guest'>('choice');
  const [orderNumber, setOrderNumber] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  // Partner mode: the policy asked for a sign-in, or this tenant has no orders
  // to look up but did give sign-in links — a help desk, not a store.
  const hasLinks = !!(guestGuidance?.loginUrl || guestGuidance?.signupUrl);
  const partnerMode = reason === 'login' || (!commerceEnabled && hasLinks);

  // Keep the latest onCancel without re-running the mount effect: the parent
  // re-renders every few seconds (chat poll) and passes a fresh onCancel each
  // time. If that were an effect dep, the effect would re-run and re-focus the
  // dialog, stealing focus from the inputs mid-typing.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  // Esc cancels; focus the dialog once on open.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    containerRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  async function submit() {
    if (!sessionToken) return;
    setError(null);
    setLoading(true);
    try {
      await guestLookup(sessionToken, orderNumber.trim(), email.trim());
      analytics.orderSearch(true);
      onSuccess();
    } catch (e) {
      // Backend messages are English by design (the client localizes by code), so
      // don't surface them raw. A rejected lookup means the pair didn't match —
      // say that, and keep the rate-limit case distinct so a blocked shopper knows
      // to wait rather than retyping.
      const code = (e as { code?: string })?.code;
      setError(
        code === 'E1007' // GUEST_LOOKUP_LIMIT
          ? t('auth.lookupThrottled')
          : code === 'E5001' || isAuthError(e) // ORDER_NOT_FOUND / unbound session
            ? t('auth.lookupFailed')
            : t('common.error'),
      );
    } finally {
      setLoading(false);
    }
  }

  /** Leave for the tenant's page in the host window (never inside the iframe). */
  function openLink(url: string) {
    openHostUrl(url, loginMode);
  }

  if (partnerMode) {
    return (
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="rounded-st-md border border-gray-200 bg-white p-3 focus:outline-none"
      >
        <div id={titleId} className="mb-1 text-sm font-semibold text-gray-800">
          {t('auth.loginTitle')}
        </div>
        <p className="mb-3 text-xs text-gray-600">{t('auth.loginBody')}</p>
        <div className="flex flex-col gap-2">
          {guestGuidance?.loginUrl ? (
            <button
              onClick={() => openLink(guestGuidance.loginUrl as string)}
              className="flex items-center justify-center gap-2 rounded-st-md bg-primary-500 px-3 py-2 text-sm font-medium text-on-primary hover:bg-primary-600"
            >
              <LogIn className="h-4 w-4" />
              {t('auth.partnerSignIn')}
            </button>
          ) : (
            // No partner link configured: the storefront sign-in is the only
            // way in the widget knows, when embedded somewhere it exists.
            canLogin && (
              <button
                onClick={login}
                disabled={pending}
                className="flex items-center justify-center gap-2 rounded-st-md bg-primary-500 px-3 py-2 text-sm font-medium text-on-primary hover:bg-primary-600 disabled:opacity-50"
              >
                <LogIn className="h-4 w-4" />
                {pending ? t('auth.waiting') : t('auth.signIn')}
              </button>
            )
          )}
          {guestGuidance?.signupUrl && (
            <button
              onClick={() => openLink(guestGuidance.signupUrl as string)}
              className="flex items-center justify-center gap-2 rounded-st-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <UserPlus className="h-4 w-4" />
              {t('auth.partnerSignUp')}
            </button>
          )}
          <button onClick={onCancel} className="py-1 text-xs text-gray-400 hover:text-gray-600">
            {t('auth.continueGuest')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="rounded-st-md border border-gray-200 bg-white p-3 focus:outline-none"
    >
      <div id={titleId} className="mb-1 text-sm font-semibold text-gray-800">
        {t('auth.title')}
      </div>
      <p className="mb-3 text-xs text-gray-600">{t('auth.body')}</p>

      {mode === 'choice' && pending ? (
        <div className="flex flex-col items-center gap-3 py-3">
          <Spinner label={t('auth.waiting')} />
          <button
            onClick={() => {
              cancel();
              setMode('guest');
            }}
            className="text-xs text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline"
          >
            {t('auth.useGuestInstead')}
          </button>
        </div>
      ) : mode === 'choice' ? (
        <div className="flex flex-col gap-2">
          {canLogin && (
            <button
              onClick={login}
              className="flex items-center justify-center gap-2 rounded-st-md bg-primary-500 px-3 py-2 text-sm font-medium text-on-primary hover:bg-primary-600"
            >
              <LogIn className="h-4 w-4" />
              {t('auth.signIn')}
            </button>
          )}
          <button
            onClick={() => setMode('guest')}
            className="flex items-center justify-center gap-2 rounded-st-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Search className="h-4 w-4" />
            {t('auth.guestLookup')}
          </button>
          <button
            onClick={onCancel}
            className="py-1 text-xs text-gray-400 hover:text-gray-600"
          >
            {t('auth.cancel')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <input
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            placeholder={t('auth.orderNumber')}
            className="rounded-st-md border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('auth.email')}
            type="email"
            className="rounded-st-md border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {error && <p className="text-xs text-error">{error}</p>}
          <button
            disabled={loading || !orderNumber || !email}
            onClick={submit}
            className="rounded-st-md bg-primary-500 px-3 py-2 text-sm font-medium text-on-primary hover:bg-primary-600 disabled:opacity-50"
          >
            {loading ? t('common.loading') : t('auth.submit')}
          </button>
          <button
            onClick={() => setMode('choice')}
            className="py-1 text-xs text-gray-400 hover:text-gray-600"
          >
            {t('auth.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}
