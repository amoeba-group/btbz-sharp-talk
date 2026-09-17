import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, KeyRound, Plus, X } from 'lucide-react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input } from '@/components/Field';
import { useEmbedSettings, useRotateEmbedSecret, useSaveEmbedOrigins } from './settings.hooks';
import { EMBED_LOADER_URL } from '@/lib/widget-url';

/**
 * Embed & SDK settings (PLN-260819 §5).
 *
 * Two things share this card because they are the two halves of one install:
 * WHERE the widget may be embedded, and HOW the host proves who its visitor is.
 */
export function EmbedCard() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { data, isLoading } = useEmbedSettings();
  const saveOrigins = useSaveEmbedOrigins();
  const rotate = useRotateEmbedSecret();

  const [draft, setDraft] = useState<string[] | null>(null);
  const [entry, setEntry] = useState('');
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const origins = draft ?? data?.origins ?? [];
  const dirty = draft !== null;

  const snippet = useMemo(() => {
    // Config BEFORE the deferred script, through the queue: an inline
    // `ShopTalk.init(...)` placed after a `defer` tag runs first and throws,
    // because the loader has not been evaluated yet.
    return [
      '<script>',
      '  window.ShopTalk = window.ShopTalk || { q: [] };',
      `  ShopTalk.q.push(['init', { shop: ${JSON.stringify(data?.shopDomain ?? '')} }]);`,
      '</script>',
      `<script src="${EMBED_LOADER_URL}" defer></script>`,
    ].join('\n');
  }, [data?.shopDomain]);

  function copy(text: string, key: string) {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    });
  }

  function addEntry() {
    const value = entry.trim();
    if (!value || origins.includes(value)) {
      setEntry('');
      return;
    }
    setDraft([...origins, value]);
    setEntry('');
  }

  return (
    <Card title={t('embed.title')}>
      {isLoading ? (
        <p className="text-sm text-gray-400">{tc('loading')}</p>
      ) : (
        <div className="space-y-5">
          <p className="text-xs text-gray-500">{t('embed.description')}</p>

          {/* --- install snippet --- */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">{t('embed.snippet')}</span>
              <button
                type="button"
                onClick={() => copy(snippet, 'snippet')}
                className="flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                {copied === 'snippet' ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {t('embed.copy')}
              </button>
            </div>
            <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 text-xs leading-relaxed text-gray-700">
              {snippet}
            </pre>
          </div>

          {/* --- allowed domains --- */}
          <div>
            <span className="text-sm font-medium text-gray-700">{t('embed.origins')}</span>
            <p className="mt-0.5 text-xs text-gray-500">{t('embed.originsHint')}</p>

            <ul className="mt-2 space-y-1">
              {origins.map((origin) => (
                <li
                  key={origin}
                  className="flex items-center justify-between rounded border border-gray-200 px-2 py-1 text-sm"
                >
                  <span className="truncate text-gray-800">{origin}</span>
                  <button
                    type="button"
                    aria-label={t('embed.remove', { origin })}
                    onClick={() => setDraft(origins.filter((o) => o !== origin))}
                    className="text-gray-400 hover:text-gray-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
              {!origins.length && (
                // An empty list is not "nothing allowed" — say what is actually
                // in force, or the screen reads as if the widget were switched off.
                <li className="rounded border border-dashed border-gray-300 px-2 py-1.5 text-xs text-gray-500">
                  {t('embed.originsEmpty', {
                    origins: data?.effectiveOrigins.join(', ') || t('embed.originsNone'),
                  })}
                </li>
              )}
            </ul>

            <div className="mt-2 flex gap-2">
              <Input
                value={entry}
                placeholder={t('embed.originPlaceholder')}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEntry(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addEntry();
                  }
                }}
              />
              <Button variant="secondary" onClick={addEntry}>
                <Plus className="mr-1 inline h-3.5 w-3.5" />
                {t('embed.add')}
              </Button>
            </div>

            {dirty && (
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setDraft(null)}>
                  {tc('cancel')}
                </Button>
                <Button
                  disabled={saveOrigins.isPending}
                  onClick={() => saveOrigins.mutate(origins, { onSuccess: () => setDraft(null) })}
                >
                  {tc('save')}
                </Button>
              </div>
            )}
          </div>

          {/* --- signing secret --- */}
          <div className="border-t border-gray-100 pt-4">
            <span className="text-sm font-medium text-gray-700">{t('embed.secret')}</span>
            <p className="mt-0.5 text-xs text-gray-500">{t('embed.secretHint')}</p>

            <div className="mt-2 flex items-center gap-2">
              <KeyRound className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="flex-1 font-mono text-xs text-gray-600">
                {data?.secretConfigured ? '••••••••••••••••••••••••' : t('embed.secretMissing')}
              </span>
              <Button variant="secondary" onClick={() => setConfirmRotate(true)}>
                {data?.secretConfigured ? t('embed.rotate') : t('embed.generate')}
              </Button>
            </div>

            {confirmRotate && (
              <div className="mt-2 rounded border border-warning/40 bg-warning/10 p-2">
                <p className="text-xs text-gray-800">{t('embed.rotateWarning')}</p>
                <div className="mt-2 flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setConfirmRotate(false)}>
                    {tc('cancel')}
                  </Button>
                  <Button
                    disabled={rotate.isPending}
                    onClick={() =>
                      rotate.mutate(undefined, {
                        onSuccess: (res) => {
                          setFreshSecret(res.secret);
                          setConfirmRotate(false);
                        },
                      })
                    }
                  >
                    {t('embed.rotate')}
                  </Button>
                </div>
              </div>
            )}

            {freshSecret && (
              <div className="mt-2 rounded border border-gray-300 bg-gray-50 p-2">
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate font-mono text-xs text-gray-900">
                    {freshSecret}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(freshSecret, 'secret')}
                    className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                  >
                    {copied === 'secret' ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {t('embed.copy')}
                  </button>
                </div>
                <p className="mt-1 text-xs text-warning">{t('embed.secretOnce')}</p>
                <div className="mt-1 flex justify-end">
                  <Button variant="secondary" onClick={() => setFreshSecret(null)}>
                    {tc('close')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
