import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, KeyRound, Plus, X } from 'lucide-react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input } from '@/components/Field';
import {
  useRotateWidgetAccessKey,
  useSaveWidgetAccess,
  useWidgetAccess,
} from './settings.hooks';

/**
 * Widget exposure restriction (PLN-260929).
 *
 * "Show the widget only from these IPs or these URLs, only during this window,
 * plus whoever holds the invite link." Exposure control for a test rollout —
 * NOT an access boundary (the URL comes from the browser and the IP from our
 * own edge header), which is why the copy says "노출" and never "차단".
 */

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in local time; the wire is ISO. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function WidgetAccessCard() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { data, isLoading } = useWidgetAccess();
  const save = useSaveWidgetAccess();
  const rotate = useRotateWidgetAccessKey();

  const [draft, setDraft] = useState<{
    enabled: boolean;
    startsAt: string | null;
    endsAt: string | null;
    ips: string[];
    urls: string[];
  } | null>(null);
  const [ipEntry, setIpEntry] = useState('');
  const [urlEntry, setUrlEntry] = useState('');
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const current = draft ?? {
    enabled: data?.enabled ?? false,
    startsAt: data?.startsAt ?? null,
    endsAt: data?.endsAt ?? null,
    ips: data?.ips ?? [],
    urls: data?.urls ?? [],
  };
  const dirty = draft !== null;
  // Switched on but the window has passed: the restriction lifts itself, and
  // the badge says so rather than leaving the operator to infer it.
  const expired = (data?.enabled ?? false) && !(data?.activeNow ?? false);

  const patch = (next: Partial<typeof current>) => setDraft({ ...current, ...next });

  function addIp() {
    const value = ipEntry.trim();
    if (!value || current.ips.includes(value)) return setIpEntry('');
    patch({ ips: [...current.ips, value] });
    setIpEntry('');
  }

  function addUrl() {
    const value = urlEntry.trim();
    if (!value || current.urls.includes(value)) return setUrlEntry('');
    patch({ urls: [...current.urls, value] });
    setUrlEntry('');
  }

  const inviteLink =
    data?.shopDomain && freshKey
      ? `https://${data.shopDomain}/?st_access=${freshKey}`
      : null;

  function copyLink() {
    if (!inviteLink) return;
    void navigator.clipboard?.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Card
      title={t('widgetAccess.title')}
      action={
        expired ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            {t('widgetAccess.expiredBadge')}
          </span>
        ) : undefined
      }
    >
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={current.enabled}
          disabled={isLoading}
          onChange={(e) => patch({ enabled: e.target.checked })}
          className="mt-1"
        />
        <span>
          <span className="text-sm font-medium text-gray-800">
            {current.enabled ? t('widgetAccess.on') : t('widgetAccess.off')}
          </span>
          <p className="mt-0.5 text-xs text-gray-500">{t('widgetAccess.hint')}</p>
        </span>
      </label>

      {current.enabled && (
        <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
          {/* --- window --- */}
          <div>
            <span className="text-sm font-medium text-gray-700">{t('widgetAccess.period')}</span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Input
                type="datetime-local"
                aria-label={t('widgetAccess.start')}
                value={toLocalInput(current.startsAt)}
                onChange={(e) => patch({ startsAt: fromLocalInput(e.target.value) })}
                className="w-56"
              />
              <span className="text-gray-400">~</span>
              <Input
                type="datetime-local"
                aria-label={t('widgetAccess.end')}
                value={toLocalInput(current.endsAt)}
                onChange={(e) => patch({ endsAt: fromLocalInput(e.target.value) })}
                className="w-56"
              />
            </div>
            <p className="mt-1 text-xs text-gray-400">{t('widgetAccess.periodHint')}</p>
          </div>

          {/* --- IPs --- */}
          <div>
            <span className="text-sm font-medium text-gray-700">{t('widgetAccess.ips')}</span>
            <ul className="mt-1 space-y-1">
              {current.ips.map((ip) => (
                <li key={ip} className="flex items-center gap-2 text-sm text-gray-700">
                  <code className="rounded bg-gray-50 px-1.5 py-0.5">{ip}</code>
                  <button
                    type="button"
                    aria-label={t('widgetAccess.remove', { value: ip })}
                    onClick={() => patch({ ips: current.ips.filter((v) => v !== ip) })}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-1 flex items-center gap-2">
              <Input
                value={ipEntry}
                placeholder="203.0.113.7 / 10.0.0.0/24"
                onChange={(e) => setIpEntry(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addIp())}
                className="w-64"
              />
              <Button variant="ghost" size="sm" onClick={addIp}>
                <Plus className="h-3.5 w-3.5" /> {t('widgetAccess.add')}
              </Button>
            </div>
            <p className="mt-1 text-xs text-gray-400">{t('widgetAccess.ipsHint')}</p>
          </div>

          {/* --- URLs --- */}
          <div>
            <span className="text-sm font-medium text-gray-700">{t('widgetAccess.urls')}</span>
            <ul className="mt-1 space-y-1">
              {current.urls.map((url) => (
                <li key={url} className="flex items-center gap-2 text-sm text-gray-700">
                  <code className="truncate rounded bg-gray-50 px-1.5 py-0.5">{url}</code>
                  <button
                    type="button"
                    aria-label={t('widgetAccess.remove', { value: url })}
                    onClick={() => patch({ urls: current.urls.filter((v) => v !== url) })}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-1 flex items-center gap-2">
              <Input
                value={urlEntry}
                placeholder="https://shop.example.com/collections/test"
                onChange={(e) => setUrlEntry(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addUrl())}
                className="w-96 max-w-full"
              />
              <Button variant="ghost" size="sm" onClick={addUrl}>
                <Plus className="h-3.5 w-3.5" /> {t('widgetAccess.add')}
              </Button>
            </div>
            <p className="mt-1 text-xs text-gray-400">{t('widgetAccess.urlsHint')}</p>
          </div>

          {/* --- invite key --- */}
          <div>
            <span className="text-sm font-medium text-gray-700">{t('widgetAccess.invite')}</span>
            <p className="mt-0.5 text-xs text-gray-500">{t('widgetAccess.inviteHint')}</p>
            {inviteLink ? (
              <div className="mt-1 flex items-center gap-2">
                <code className="truncate rounded bg-gray-50 px-2 py-1 text-xs">{inviteLink}</code>
                <Button variant="ghost" size="sm" onClick={copyLink}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? tc('copied') : tc('copy')}
                </Button>
              </div>
            ) : (
              <p className="mt-1 text-xs text-gray-500">
                {data?.keyConfigured
                  ? t('widgetAccess.inviteExisting')
                  : t('widgetAccess.inviteNone')}
              </p>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-1"
              disabled={rotate.isPending}
              onClick={() => {
                // Rotating invalidates every link already handed out, exactly
                // like the embed secret — say so before doing it.
                if (data?.keyConfigured && !window.confirm(t('widgetAccess.inviteRotateConfirm'))) {
                  return;
                }
                rotate.mutate(undefined, { onSuccess: (r) => setFreshKey(r.key) });
              }}
            >
              <KeyRound className="h-3.5 w-3.5" />
              {data?.keyConfigured ? t('widgetAccess.inviteRotate') : t('widgetAccess.inviteIssue')}
            </Button>
          </div>

          {/* --- what this adds up to --- */}
          <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
            {t('widgetAccess.summary', {
              ips: current.ips.length,
              urls: current.urls.length,
              key: data?.keyConfigured || freshKey ? t('widgetAccess.summaryKey') : '',
            })}
          </p>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate(
              {
                enabled: current.enabled,
                startsAt: current.startsAt,
                endsAt: current.endsAt,
                ips: current.ips,
                urls: current.urls,
              },
              { onSuccess: () => setDraft(null) },
            )
          }
        >
          {tc('save')}
        </Button>
      </div>
    </Card>
  );
}
