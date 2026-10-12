import { useState } from 'react';
import { Languages, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { LANGUAGES } from '../../../../../packages/types/src/common/language';
import { useBriefing, useGenerateBriefing, useTranslateBriefing } from './live-chat.hooks';
import type { IdentityClaims } from './live-chat.service';
import { hotelLabel, roleLabel } from './PartnerContext';

/**
 * On-demand AI briefing (REQ-260824 R3). Opening a conversation only reads the
 * stored briefing; the model runs when the operator asks — generate, or
 * translate into one of the system languages. Both results are persisted, so
 * re-opening the thread later shows them instantly.
 *
 * `claims` (REQ-261006 W6) adds one fixed line above the generated text: the
 * hotel the partner acts for. Fixed rather than generated, so it is there before
 * anyone presses "generate" and does not depend on the model noticing it.
 */
export function BriefingCard({
  conversationId,
  claims = null,
}: {
  conversationId: string | null;
  claims?: IdentityClaims | null;
}) {
  const { t, i18n } = useTranslation('livechat');
  const { data, isLoading } = useBriefing(conversationId);
  const generate = useGenerateBriefing(conversationId);
  const translate = useTranslateBriefing(conversationId);
  // Default translation target: the console language the agent is reading in.
  const [lang, setLang] = useState(() => (i18n.language || 'en').slice(0, 2));

  const stored = data?.briefing ? data : null;
  const translation = stored?.translations?.[lang];

  const generatedAt = (() => {
    if (!stored?.createdAt) return '';
    const d = new Date(stored.createdAt);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  })();

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <Sparkles className="h-4 w-4 text-primary-500" /> {t('aiBriefing')}
        </div>
        {stored && (
          <Button
            size="sm"
            variant="ghost"
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
            title={t('briefing.regenerate')}
            aria-label={t('briefing.regenerate')}
          >
            {generate.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </div>

      {conversationId && claims && (
        <p className="mb-2 text-xs text-gray-600">
          {t('partner.briefingLine', {
            hotel: hotelLabel(claims),
            role: roleLabel(claims.role, t),
          })}
          {!claims.signed ? ` (${t('partner.unsigned')})` : ''}
        </p>
      )}
      {!conversationId ? (
        <p className="text-sm text-gray-600">{t('selectConversation')}</p>
      ) : isLoading ? (
        <p className="text-sm text-gray-600">{t('briefingLoading')}</p>
      ) : !stored ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-500">{t('briefing.none')}</p>
          <Button size="sm" disabled={generate.isPending} onClick={() => generate.mutate()}>
            {generate.isPending ? t('briefing.generating') : t('briefing.generate')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="whitespace-pre-wrap text-sm text-gray-600">{stored.briefing}</p>
          <p className="text-[11px] text-gray-400">
            {t('briefing.generatedAt', { time: generatedAt })}
            {stored.requestedByName ? ` · ${stored.requestedByName}` : ''}
          </p>

          {/* Translation panel: pick a system language, translate once, reuse. */}
          <div className="rounded-md border border-gray-100 bg-gray-50 p-2">
            <div className="flex items-center gap-2">
              <Languages className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              <select
                className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs outline-none focus:border-primary-500"
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                aria-label={t('briefing.targetLanguage')}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.nativeLabel}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="secondary"
                disabled={translate.isPending || !stored.id || !!translation}
                onClick={() =>
                  stored.id && translate.mutate({ briefingId: stored.id, lang })
                }
              >
                {translate.isPending ? t('briefing.translating') : t('briefing.translate')}
              </Button>
            </div>
            {translation && (
              <p className="mt-2 whitespace-pre-wrap border-t border-gray-200 pt-2 text-sm text-gray-700">
                {translation}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
