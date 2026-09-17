import { useRef, useState } from 'react';
import { CircleHelp, Headset, MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { Card } from '@/components/Card';
import { apiBaseUrl } from '@/lib/api-client';
import { Button } from '@/components/Button';
import { FormRow, Input, Select } from '@/components/Field';
// Type-only: @sharptalk/types ships CJS whose runtime exports Rollup cannot see.
import type {
  WidgetHeaderStyle,
  WidgetLauncher,
  WidgetLoginMode,
  WidgetTab,
  WidgetTabPosition,
} from '@sharptalk/types';
import { LanguageTabs } from '../ai-settings/LanguageTabs';
// Runtime table from the registry source (see apps/web/src/i18n/i18n.ts for why).
import { LANGUAGES, LANGUAGE_TIMEZONES } from '../../../../../packages/types/src/common/language';
import { WIDGET_COPY_DEFAULTS } from '../../../../../packages/types/src/common/widget-copy';
// Same source-path import as the language registry above: a value import of the
// package entry point breaks the browser build (CJS `export *`).
import {
  WIDGET_TABS_DEFAULT,
  WIDGET_TAB_ORDER,
} from '../../../../../packages/types/src/common/enum.types';
import {
  LAUNCHER_METRICS,
  buildThemeVariables,
  resolveLauncher,
} from '../../../../../packages/types/src/common/widget-theme';
import type { ScenarioLang } from '../ai-settings/ai-settings.service';
import {
  useShopifySettings,
  useSaveShopify,
  useNotificationChannels,
  useSaveNotificationChannels,
  useSaveWidgetTheme,
  useWidgetTheme,
  useUploadWidgetLogo,
  useDeleteWidgetLogo,
  useSaveWidgetSettings,
  useStorefront,
  useUpdateStorefront,
  useWidgetSettings,
} from './settings.hooks';
import type { WidgetCopyDraft } from './settings.service';
import { MessengerChannelCard } from './MessengerChannelCard';
import { MessengerChannelModal } from './MessengerChannelModal';
import {
  useMessengerChannels,
  useSyncMessengerChannel,
  useTestMessengerChannel,
} from './messenger.hooks';
import {
  COMMUNICATION_PROVIDERS,
  MESSENGER_PROVIDERS,
  PLANNED_MESSENGER_PROVIDERS,
  type AnyMessengerProvider,
  type MessengerChannel,
} from './messenger.service';
import { toast } from '@/store/toast-store';
import { WIDGET_URL } from '@/lib/widget-url';


type InstallMethod = 'appEmbed' | 'scriptTag' | 'manual';

/** Which store's config modal is open: Shopify, an e-commerce provider, or none. */

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const { t } = useTranslation('settings');
  const onCopy = async () => {
    const ok = await copyToClipboard(code);
    if (ok) toast.success(t('shopify.install.copied'));
    else toast.error(t('shopify.install.copyFailed'));
  };
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 pr-24 text-xs leading-relaxed text-gray-100">
        <code>{code}</code>
      </pre>
      <Button
        variant="secondary"
        size="sm"
        className="absolute right-2 top-2"
        onClick={onCopy}
        aria-label={label}
      >
        {t('shopify.install.copy')}
      </Button>
    </div>
  );
}

type InstallPlatform = 'shopify' | 'cafe24' | 'woocommerce' | 'odoo';

/**
 * External messenger + communication channels (PLN-260810 PR-M5).
 *
 * Unlike the credential tiles above, a channel is a *conversation source*: the
 * card carries live operating state (last inbound, last error, whether AI
 * answers) because a channel that quietly stopped receiving is otherwise
 * invisible until a customer complains.
 */
/** Providers where several accounts make sense (one card per mailbox). */
const MULTI_ACCOUNT_PROVIDERS = new Set<string>(['gmail']);

export function MessengerChannelsSection() {
  const { t } = useTranslation('settings');
  const { data, isLoading } = useMessengerChannels();
  const test = useTestMessengerChannel();
  const sync = useSyncMessengerChannel();
  const [editing, setEditing] = useState<{
    provider: AnyMessengerProvider;
    channel?: MessengerChannel;
  } | null>(null);

  const channels = data?.channels ?? [];
  const supported = new Set(data?.supported ?? []);
  const byProvider = (provider: string) => channels.filter((c) => c.provider === provider);

  const renderCards = (providers: readonly string[]) =>
    providers.flatMap((provider) => {
      const existing = byProvider(provider);
      const cards = existing.map((channel) => (
        <MessengerChannelCard
          key={channel.id}
          provider={provider}
          channel={channel}
          onConfigure={() => setEditing({ provider: provider as AnyMessengerProvider, channel })}
          onTest={() => test.mutate(channel.id)}
          onSync={() => sync.mutate(channel.id)}
        />
      ));
      // An empty "add" card only where a second account is meaningful — Gmail
      // has one card per mailbox, but a bot or hub account is single, and a
      // trailing blank card there just reads as a duplicate of the real one.
      const acceptsMore = MULTI_ACCOUNT_PROVIDERS.has(provider) || existing.length === 0;
      if (acceptsMore) {
        cards.push(
          <MessengerChannelCard
            key={`${provider}:new`}
            provider={provider}
            planned={!supported.has(provider)}
            onConfigure={() => setEditing({ provider: provider as AnyMessengerProvider })}
          />,
        );
      }
      return cards;
    });

  return (
    <>
      <section>
        <h2 className="mb-1 text-sm font-semibold text-gray-700">{t('messenger.groupTitle')}</h2>
        <p className="mb-3 text-xs text-gray-500">{t('messenger.groupHint')}</p>
        {isLoading ? (
          <p className="text-sm text-gray-400">{t('messenger.loading')}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {renderCards([...MESSENGER_PROVIDERS, ...PLANNED_MESSENGER_PROVIDERS])}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold text-gray-700">
          {t('messenger.communicationTitle')}
        </h2>
        <p className="mb-3 text-xs text-gray-500">{t('messenger.communicationHint')}</p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {renderCards(COMMUNICATION_PROVIDERS)}
        </div>
      </section>

      {editing && (
        <MessengerChannelModal
          provider={editing.provider}
          channel={editing.channel}
          open
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function InstallGuideCard() {
  const { t } = useTranslation('settings');
  const { data } = useShopifySettings();
  const [platform, setPlatform] = useState<InstallPlatform>('shopify');
  const [method, setMethod] = useState<InstallMethod>('appEmbed');

  const shop = (data?.shopDomain || '').trim() || 'your-store.example.com';
  const hasShop = Boolean((data?.shopDomain || '').trim());

  // Generic HTML embed — works on any platform that lets you edit theme HTML.
  const htmlSnippet =
    `<!-- SharpTalk widget -->\n` +
    `<script>\n` +
    `  window.SHARPTALK_WIDGET_CONFIG = {\n` +
    `    shop: ${JSON.stringify(shop)},\n` +
    `    widgetUrl: ${JSON.stringify(WIDGET_URL)}\n` +
    `  };\n` +
    `</script>\n` +
    `<script src="${WIDGET_URL}/embed.js" defer></script>`;

  // Cafe24 classic mall: point sign-in at the mall's own login page (no login API;
  // login happens in the top window, then the widget reopens) — PLN-260807.
  const cafe24Snippet =
    `<!-- SharpTalk widget (Cafe24) -->\n` +
    `<script>\n` +
    `  window.SHARPTALK_WIDGET_CONFIG = {\n` +
    `    shop: ${JSON.stringify(shop)},\n` +
    `    locale: "ko",\n` +
    `    widgetUrl: ${JSON.stringify(WIDGET_URL)},\n` +
    `    loginPath: "/member/login.html",\n` +
    `    loginReturnParam: "returnUrl"\n` +
    `  };\n` +
    `</script>\n` +
    `<script src="${WIDGET_URL}/embed.js" defer></script>`;

  // Odoo (REQ-260825 R2): the mall's real login page is /web/login?redirect=…,
  // not the Shopify-style /account/login default — and /web/login must join the
  // hide list or the widget mounts on the login page and burns the one-shot
  // reopen flag (same failure mode as the tenant login page, PR #321).
  const odooSnippet =
    `<!-- SharpTalk widget (Odoo) -->\n` +
    `<script>\n` +
    `  window.SHARPTALK_WIDGET_CONFIG = {\n` +
    `    shop: ${JSON.stringify(shop)},\n` +
    `    widgetUrl: ${JSON.stringify(WIDGET_URL)},\n` +
    `    loginPath: "/web/login",\n` +
    `    loginReturnParam: "redirect",\n` +
    `    hideOnPaths: ["/web/login", "/web/signup", "/web/reset_password"]\n` +
    `  };\n` +
    `</script>\n` +
    `<script src="${WIDGET_URL}/embed.js" defer></script>`;

  const scriptTagSnippet =
    `POST https://${shop}/admin/api/2024-10/script_tags.json\n` +
    `{\n` +
    `  "script_tag": {\n` +
    `    "event": "onload",\n` +
    `    "src": "${WIDGET_URL}/embed.js?shop=${encodeURIComponent(shop)}"\n` +
    `  }\n` +
    `}`;

  const wooSnippet =
    `// SharpTalk widget — add to your (child) theme's functions.php\n` +
    `add_action( 'wp_footer', function () { ?>\n` +
    `  <script>\n` +
    `    window.SHARPTALK_WIDGET_CONFIG = {\n` +
    `      shop: ${JSON.stringify(shop)},\n` +
    `      widgetUrl: ${JSON.stringify(WIDGET_URL)}\n` +
    `    };\n` +
    `  </script>\n` +
    `  <script src="${WIDGET_URL}/embed.js" defer></script>\n` +
    `<?php } );`;

  const platforms: { key: InstallPlatform; label: string }[] = [
    { key: 'shopify', label: t('shopify.title') },
    { key: 'cafe24', label: t('integrations.cafe24.title') },
    { key: 'woocommerce', label: t('integrations.woocommerce.title') },
    { key: 'odoo', label: t('integrations.odoo.title') },
  ];

  const methods: { key: InstallMethod; label: string }[] = [
    { key: 'appEmbed', label: t('shopify.install.tabAppEmbed') },
    { key: 'scriptTag', label: t('shopify.install.tabScriptTag') },
    { key: 'manual', label: t('shopify.install.tabManual') },
  ];

  /** Non-Shopify platforms: description + 3 steps + one snippet. */
  const simpleGuide = (key: Exclude<InstallPlatform, 'shopify'>, code: string) => (
    <div className="space-y-3 text-sm text-gray-600">
      <p>{t(`install.${key}.desc`)}</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>{t(`install.${key}.step1`)}</li>
        <li>{t(`install.${key}.step2`)}</li>
        <li>{t(`install.${key}.step3`)}</li>
      </ol>
      <CodeBlock code={code} label={t('shopify.install.copy')} />
    </div>
  );

  return (
    <Card title={t('shopify.install.title')}>
      <p className="mb-1 text-sm text-gray-500">{t('install.subtitle')}</p>
      <p className="mb-4 text-xs text-gray-400">
        {hasShop
          ? t('shopify.install.shopHint', { shop })
          : t('shopify.install.shopMissing')}
      </p>

      {/* Platform tabs */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-100">
        {platforms.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPlatform(p.key)}
            className={
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors ' +
              (platform === p.key
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700')
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      {platform === 'shopify' && (
        <>
          <div className="mb-4 flex gap-1">
            {methods.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setMethod(tab.key)}
                className={
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ' +
                  (method === tab.key
                    ? 'bg-primary-500/10 text-primary-600'
                    : 'text-gray-500 hover:text-gray-700')
                }
              >
                {tab.label}
              </button>
            ))}
          </div>

          {method === 'appEmbed' && (
            <div className="space-y-2 text-sm text-gray-600">
              <p>{t('shopify.install.appEmbed.desc')}</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>{t('shopify.install.appEmbed.step1')}</li>
                <li>{t('shopify.install.appEmbed.step2')}</li>
                <li>{t('shopify.install.appEmbed.step3')}</li>
              </ol>
            </div>
          )}

          {method === 'scriptTag' && (
            <div className="space-y-3 text-sm text-gray-600">
              <p>{t('shopify.install.scriptTag.desc')}</p>
              <CodeBlock code={scriptTagSnippet} label={t('shopify.install.copy')} />
              <p className="text-xs text-gray-400">{t('shopify.install.scriptTag.note')}</p>
            </div>
          )}

          {method === 'manual' && (
            <div className="space-y-3 text-sm text-gray-600">
              <p>{t('shopify.install.manual.desc')}</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>{t('shopify.install.manual.step1')}</li>
                <li>{t('shopify.install.manual.step2')}</li>
                <li>{t('shopify.install.manual.step3')}</li>
              </ol>
              <CodeBlock code={htmlSnippet} label={t('shopify.install.copy')} />
            </div>
          )}
        </>
      )}

      {platform === 'cafe24' && simpleGuide('cafe24', cafe24Snippet)}
      {platform === 'woocommerce' && simpleGuide('woocommerce', wooSnippet)}
      {platform === 'odoo' && simpleGuide('odoo', odooSnippet)}
    </Card>
  );
}

/** True for a Shopify store domain; the tenant field also holds Cafe24 malls etc. */
export function isShopifyDomain(domain?: string | null): boolean {
  return /\.myshopify\.com\/?$/i.test((domain ?? '').trim());
}

/**
 * Customer-facing shop origin (PLN-260804-Product-Link-Recommendation).
 *
 * This is what decides whether a product citation becomes a clickable link in a
 * shopper's chat. Product URLs arrive in an uploaded CSV, so the server only
 * links the ones on this origin — until it is set, citations stay plain text.
 */
export function StorefrontCard() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { data, isLoading } = useStorefront();
  const save = useUpdateStorefront();
  const [value, setValue] = useState<string | null>(null);
  const current = value ?? data?.storefrontUrl ?? '';
  const dirty = data != null && current !== (data.storefrontUrl ?? '');

  // The store domain that identifies this tenant to the widget. It is platform
  // neutral — Shopify, Cafe24, anything — but the only editor used to be inside
  // the Shopify modal, which is why a Cafe24 mall appeared as a Shopify store.
  const shopify = useShopifySettings();
  const saveShopDomain = useSaveShopify();
  const [domainDraft, setDomainDraft] = useState<string | null>(null);
  const shopDomain = domainDraft ?? shopify.data?.shopDomain ?? '';
  const domainDirty = shopify.data != null && shopDomain !== (shopify.data.shopDomain ?? '');

  return (
    <Card title={t('storefront.title')}>
      {isLoading ? (
        <p className="text-sm text-gray-400">{tc('loading')}</p>
      ) : (
        <div className="space-y-2">
          <FormRow label={t('storefront.url')}>
            <Input
              value={current}
              placeholder="https://ivyusa.com"
              onChange={(e) => setValue(e.target.value)}
            />
          </FormRow>
          <p className="text-xs text-gray-500">{t('storefront.hint')}</p>
          {!data?.storefrontUrl && (
            <p className="text-xs text-warning">{t('storefront.unsetWarning')}</p>
          )}
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(current)}>
            {tc('save')}
          </Button>

          <div className="mt-4 border-t border-gray-100 pt-4">
            <FormRow label={t('storefront.shopDomain')}>
              <Input
                value={shopDomain}
                placeholder="your-store.myshopify.com / your-mall.cafe24.com"
                onChange={(e) => setDomainDraft(e.target.value)}
              />
            </FormRow>
            <p className="text-xs text-gray-500">{t('storefront.shopDomainHint')}</p>
            <Button
              className="mt-2"
              disabled={!domainDirty || saveShopDomain.isPending}
              onClick={() => saveShopDomain.mutate({ shop_domain: shopDomain.trim() })}
            >
              {tc('save')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Widget sign-in behavior (PLN-Widget-Login-Redirect-Orders): whole-tab redirect
 * to the store's hosted login (default) vs a popup window. Delivered to the
 * widget via session/ensure; takes effect on the shopper's next page load.
 */
type CopyLang = ScenarioLang;

export function WidgetBehaviorCard() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { data, isLoading } = useWidgetSettings();
  const save = useSaveWidgetSettings();
  // Local pick, if any; otherwise whatever is stored (redirect until loaded).
  const [picked, setPicked] = useState<WidgetLoginMode | null>(null);
  const [tzPicked, setTzPicked] = useState<string | null>(null);
  const value: WidgetLoginMode = picked ?? data?.loginMode ?? 'redirect';
  const tz = tzPicked ?? data?.timezone ?? '';
  // Explicit default language ('' = follow the timezone) — REQ-260913 G1/G2.
  const [langPicked, setLangPicked] = useState<string | null>(null);
  const defaultLang = langPicked ?? data?.defaultLanguage ?? '';

  // Widget copy draft (PLN-260808-Widget-Greetings) — lazily seeded from the
  // stored values; one language tab shared by both message editors.
  const [copyLang, setCopyLang] = useState<CopyLang>('EN');
  const [copyDraft, setCopyDraft] = useState<WidgetCopyDraft | null>(null);
  const storedCopy: WidgetCopyDraft = {
    displayName: data?.displayName ?? '',
    firstVisit: data?.firstVisit ?? {},
    loginGreeting: data?.loginGreeting ?? {},
  };
  const copy = copyDraft ?? storedCopy;
  const setCopyText = (field: 'firstVisit' | 'loginGreeting', text: string) =>
    setCopyDraft({ ...copy, [field]: { ...copy[field], [copyLang]: text } });

  const copyDirty = copyDraft != null && JSON.stringify(copyDraft) !== JSON.stringify(storedCopy);

  /**
   * The shipped greeting for the selected language, shown BELOW the field
   * rather than inside it (PLN-260903 S2-9): an operator has to be able to read
   * what a shopper sees today, but filling the field would mark the form dirty
   * and freeze today's default into this tenant's row on the next save.
   */
  const defaultCopy = (field: 'firstVisit' | 'loginGreeting') =>
    (WIDGET_COPY_DEFAULTS[field] as Record<string, string>)[copyLang] ??
    WIDGET_COPY_DEFAULTS[field].EN;

  const dirty =
    data != null &&
    (value !== data.loginMode ||
      tz !== (data.timezone ?? '') ||
      defaultLang !== (data.defaultLanguage ?? '') ||
      copyDirty);

  return (
    <Card title={t('widgetBehavior.title')}>
      <p className="mb-4 text-sm text-gray-500">{t('widgetBehavior.desc')}</p>
      <div className="max-w-md">
        <FormRow label={t('widgetBehavior.loginMode')}>
          <Select
            value={value}
            disabled={isLoading}
            onChange={(e) => setPicked(e.target.value as WidgetLoginMode)}
          >
            <option value="redirect">{t('widgetBehavior.redirect')}</option>
            <option value="popup">{t('widgetBehavior.popup')}</option>
          </Select>
        </FormRow>
        <p className="mb-4 text-xs text-gray-400">
          {value === 'popup' ? t('widgetBehavior.popupHint') : t('widgetBehavior.redirectHint')}
        </p>
        <FormRow label={t('widgetBehavior.timezone')}>
          <Select value={tz} disabled={isLoading} onChange={(e) => setTzPicked(e.target.value)}>
            <option value="">{t('widgetBehavior.tzUnset')}</option>
            {LANGUAGE_TIMEZONES.map((tz) => (
              <option key={tz.zone} value={tz.zone}>
                {tz.zone} — {tz.label}
              </option>
            ))}
          </Select>
        </FormRow>
        <p className="mb-4 text-xs text-gray-400">{t('widgetBehavior.timezoneHint')}</p>
        <FormRow label={t('widgetBehavior.defaultLanguage')}>
          <Select value={defaultLang} disabled={isLoading} onChange={(e) => setLangPicked(e.target.value)}>
            <option value="">{t('widgetBehavior.defaultLanguageFollow')}</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeLabel}
                {l.reviewed ? '' : ' (β)'}
              </option>
            ))}
          </Select>
        </FormRow>
        <p className="mb-4 text-xs text-gray-400">{t('widgetBehavior.defaultLanguageHint')}</p>

        {/* Widget copy (display name + greetings) — PLN-260808-Widget-Greetings */}
        <div className="mb-2 border-t border-gray-100 pt-4 text-sm font-medium text-gray-700">
          {t('widgetBehavior.copyTitle')}
        </div>
        <FormRow label={t('widgetBehavior.displayName')}>
          <Input
            value={copy.displayName}
            maxLength={80}
            disabled={isLoading}
            placeholder={data?.displayNameFallback ?? ''}
            onChange={(e) => setCopyDraft({ ...copy, displayName: e.target.value })}
          />
        </FormRow>
        <p className="mb-3 text-xs text-gray-400">{t('widgetBehavior.displayNameHint')}</p>

        <div className="mb-2">
          <LanguageTabs value={copyLang} onChange={setCopyLang} filled={copy.firstVisit} />
        </div>
        <FormRow label={t('widgetBehavior.firstVisit')}>
          <textarea
            className="w-full rounded-lg border border-gray-200 p-2 text-sm focus:border-primary-400 focus:outline-none"
            rows={3}
            maxLength={500}
            disabled={isLoading}
            value={copy.firstVisit[copyLang] ?? ''}
            onChange={(e) => setCopyText('firstVisit', e.target.value)}
          />
        </FormRow>
        <p className="text-xs text-gray-400">{t('widgetBehavior.firstVisitHint')}</p>
        <p className="mb-3 text-xs text-gray-400">
          <span className="text-gray-500">{t('widgetBehavior.defaultCopy')}</span>{' '}
          {defaultCopy('firstVisit')}
        </p>
        <FormRow label={t('widgetBehavior.loginGreeting')}>
          <textarea
            className="w-full rounded-lg border border-gray-200 p-2 text-sm focus:border-primary-400 focus:outline-none"
            rows={3}
            maxLength={500}
            disabled={isLoading}
            value={copy.loginGreeting[copyLang] ?? ''}
            onChange={(e) => setCopyText('loginGreeting', e.target.value)}
          />
        </FormRow>
        <p className="text-xs text-gray-400">{t('widgetBehavior.loginGreetingHint')}</p>
        <p className="mb-4 text-xs text-gray-400">
          <span className="text-gray-500">{t('widgetBehavior.defaultCopy')}</span>{' '}
          {defaultCopy('loginGreeting')}
        </p>

        <Button
          onClick={() =>
            save.mutate(
              {
                loginMode: value,
                timezone: tz,
                defaultLanguage: defaultLang,
                // Tabs are NOT sent from this card any more — they have their own
                // (PLN-260818). Omitting them keeps `widget_tabs = NULL` meaning
                // "never configured", which is what lets a future change to the
                // built-in default reach tenants who never chose.
                ...(copyDirty ? { copy } : {}),
              },
              { onSuccess: () => { setCopyDraft(null); setLangPicked(null); } },
            )
          }
          disabled={!dirty || save.isPending}
        >
          {save.isPending ? tc('saving') : tc('save')}
        </Button>
      </div>
    </Card>
  );
}


/**
 * Which channels this shop may use, per notification category
 * (PLN-260817-Widget-Header-Prefs-Cleanup §2.2).
 *
 * A CEILING, not a customer preference: the widget's own control is now a single
 * marketing opt-out, and the per-channel grid that used to live there is this.
 * Below this ceiling a customer's stored preference — including the mobile app's
 * push toggle — still decides.
 */
export function NotificationChannelsCard() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { data, isLoading } = useNotificationChannels();
  const save = useSaveNotificationChannels();
  const [draft, setDraft] = useState<Record<string, string[]> | null>(null);

  const stored = data?.channels ?? {};
  const channels = draft ?? stored;
  const dirty = draft != null && JSON.stringify(draft) !== JSON.stringify(stored);

  // An absent category means "no ceiling", which reads as every channel allowed.
  const isOn = (category: string, channel: string) =>
    !Array.isArray(channels[category]) || channels[category].includes(channel);

  const toggle = (category: string, channel: string) => {
    const current = Array.isArray(channels[category])
      ? channels[category]
      : [...(data?.channelKeys ?? [])];
    const next = current.includes(channel)
      ? current.filter((c) => c !== channel)
      : [...current, channel];
    setDraft({ ...channels, [category]: next });
  };

  return (
    <Card title={t('notifChannels.title')}>
      <p className="mb-4 text-sm text-gray-500">{t('notifChannels.desc')}</p>
      {isLoading ? (
        <p className="text-sm text-gray-400">{tc('loading')}</p>
      ) : (
        <div className="max-w-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500">
                <th className="p-2 text-left font-medium">{t('notifChannels.category')}</th>
                <th className="p-2 text-center font-medium">{t('notifChannels.inApp')}</th>
                {(data?.channelKeys ?? []).map((ch) => (
                  <th key={ch} className="p-2 text-center font-medium">
                    {t(`notifChannels.channel.${ch}`, { defaultValue: ch })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.categories ?? []).map((cat) => (
                <tr key={cat} className="border-t border-gray-100">
                  <td className="p-2 font-medium text-gray-700">
                    {t(`notifChannels.category.${cat}`, { defaultValue: cat })}
                  </td>
                  {/* In-app is the widget's own feed — always on, never a choice. */}
                  <td className="p-2 text-center text-xs text-gray-400">
                    {t('notifChannels.always')}
                  </td>
                  {(data?.channelKeys ?? []).map((ch) => (
                    <td key={ch} className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={isOn(cat, ch)}
                        onChange={() => toggle(cat, ch)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-gray-400">{t('notifChannels.hint')}</p>
      <p className="mb-4 text-xs text-gray-400">{t('notifChannels.unsetHint')}</p>
      <Button
        onClick={() => save.mutate(channels, { onSuccess: () => setDraft(null) })}
        disabled={!dirty || save.isPending}
      >
        {save.isPending ? tc('saving') : tc('save')}
      </Button>
    </Card>
  );
}


/**
 * Widget tabs — its own card since 2026-08-18 (PLN-260818, requirement 2).
 *
 * These two settings used to live in the middle of "Widget behaviour", between
 * the timezone and the greeting copy. Nobody looking for tab settings opens a
 * card called Widget behaviour, and twice in a row the question came back as
 * "where is it?". Discoverability was the actual defect, so the fix is a card
 * with the word Tabs on it, not another paragraph of documentation.
 */
export function WidgetTabsCard() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { data, isLoading } = useWidgetSettings();
  const save = useSaveWidgetSettings();

  const [tabsPicked, setTabsPicked] = useState<WidgetTab[] | null>(null);
  const [positionPicked, setPositionPicked] = useState<WidgetTabPosition | null>(null);
  const tabs = tabsPicked ?? data?.tabs ?? [...WIDGET_TABS_DEFAULT];
  const tabPosition: WidgetTabPosition = positionPicked ?? data?.tabPosition ?? 'top';

  /**
   * Toggle a tab, refusing to remove the last one. A widget with no tabs cannot
   * be navigated at all, so the control is disabled rather than letting the save
   * fail server-side with a validation error the admin has to decode.
   */
  const toggleTab = (key: WidgetTab) => {
    const next = tabs.includes(key) ? tabs.filter((k) => k !== key) : [...tabs, key];
    if (next.length === 0) return;
    setTabsPicked(WIDGET_TAB_ORDER.filter((k) => next.includes(k)));
  };

  // Send ONLY the field the admin actually changed. `data.tabs` is the RESOLVED
  // list — an unconfigured tenant reads back the default — so posting it while
  // saving a position change would freeze today's default into the row as an
  // explicit choice, and a later change to the default would skip this tenant.
  // NULL means unconfigured, and it has to survive a save of its neighbour.
  const tabsChanged = tabsPicked != null && JSON.stringify(tabsPicked) !== JSON.stringify(data?.tabs);
  const positionChanged = positionPicked != null && positionPicked !== data?.tabPosition;
  const dirty = data != null && (tabsChanged || positionChanged);

  return (
    <Card title={t('widgetTabs.title')}>
      <p className="mb-4 text-sm text-gray-500">{t('widgetTabs.desc')}</p>
      <div className="max-w-md">
        {/* Tab configuration — PLN-260817-Widget-Tab-Config */}
        <div className="mb-2 border-t border-gray-100 pt-4 text-sm font-medium text-gray-700">
          {t('widgetBehavior.tabsTitle')}
        </div>
        <FormRow label={t('widgetBehavior.tabs')}>
          <div className="flex flex-wrap gap-3">
            {WIDGET_TAB_ORDER.map((key) => {
              const checked = tabs.includes(key);
              // Disabling the last checked box is the guard: an empty tab bar is
              // refused by the API too, but the admin should never get that far.
              const isLast = checked && tabs.length === 1;
              return (
                <label
                  key={key}
                  className={`flex items-center gap-1.5 text-sm ${
                    isLast ? 'text-gray-400' : 'text-gray-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isLoading || isLast}
                    onChange={() => toggleTab(key)}
                  />
                  {t(`widgetBehavior.tab.${key}`)}
                </label>
              );
            })}
          </div>
        </FormRow>
        <p className="mb-4 text-xs text-gray-400">{t('widgetBehavior.tabsHint')}</p>
        {/* FormRow renders the label as a SIBLING, so each control carries its
            own accessible name rather than relying on wrapping. */}
        <FormRow label={t('widgetBehavior.tabPosition')}>
          <Select
            aria-label={t('widgetBehavior.tabPosition')}
            value={tabPosition}
            disabled={isLoading}
            onChange={(e) => setPositionPicked(e.target.value as WidgetTabPosition)}
          >
            <option value="top">{t('widgetBehavior.tabPositionTop')}</option>
            <option value="bottom">{t('widgetBehavior.tabPositionBottom')}</option>
          </Select>
        </FormRow>
        <p className="mb-4 text-xs text-gray-400">{t('widgetBehavior.tabPositionHint')}</p>

        <Button
          onClick={() =>
            save.mutate({
              loginMode: data?.loginMode ?? 'redirect',
              ...(tabsChanged ? { tabs } : {}),
              ...(positionChanged ? { tabPosition } : {}),
            })
          }
          disabled={!dirty || save.isPending}
        >
          {save.isPending ? tc('saving') : tc('save')}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Widget brand theme (PLN-260818). One colour in, whole palette out.
 *
 * There is no text-colour control on purpose: the readable foreground is
 * computed from the brand colour, because a UI that lets someone keep white on
 * yellow eventually ships a button nobody can read.
 */
export function WidgetThemeCard() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const { data, isLoading } = useWidgetTheme();
  const save = useSaveWidgetTheme();

  const uploadLogo = useUploadWidgetLogo();
  const deleteLogo = useDeleteWidgetLogo();
  const fileRef = useRef<HTMLInputElement>(null);

  const [brandPicked, setBrandPicked] = useState<string | null>(null);
  const [headerPicked, setHeaderPicked] = useState<WidgetHeaderStyle | null>(null);
  const [launcherPicked, setLauncherPicked] = useState<WidgetLauncher | null>(null);
  const storedBrand = data?.theme?.brand ?? data?.defaultBrand ?? '#2B7FFF';
  const storedHeader = data?.theme?.headerStyle ?? 'white';
  const storedLauncher = resolveLauncher(data?.theme ?? null);
  const brand = brandPicked ?? storedBrand;
  const headerStyle = headerPicked ?? storedHeader;
  const logo = data?.theme?.logo ?? null;
  const pickedLauncher = launcherPicked ?? storedLauncher;
  // Deleting the logo removes the "your logo" option, but the stored value can
  // still say `logo`. Show what the widget will actually draw in that case.
  const launcher =
    pickedLauncher.icon === 'logo' && !logo
      ? { ...pickedLauncher, icon: 'chat' as const }
      : pickedLauncher;
  // Same URL the widget uses, so the preview shows the real file rather than a
  // local object URL that would look right even when serving is broken.
  // Without a shop domain the URL would resolve to a 404 and show a broken
  // image; the "no logo" state is the honest thing to render.
  const logoSrc =
    logo && data?.shopDomain
      ? `${apiBaseUrl()}/public/widget/logo?shop=${encodeURIComponent(data.shopDomain)}&v=${logo.id}`
      : null;
  const dirty =
    data != null &&
    (brand !== storedBrand ||
      headerStyle !== storedHeader ||
      launcher.position !== storedLauncher.position ||
      launcher.size !== storedLauncher.size ||
      launcher.icon !== storedLauncher.icon ||
      (launcher.mode ?? 'floating') !== (storedLauncher.mode ?? 'floating') ||
      (launcher.offsetTop ?? 72) !== (storedLauncher.offsetTop ?? 72) ||
      (launcher.triggerSelector ?? '') !== (storedLauncher.triggerSelector ?? ''));
  const triggerMode = (launcher.mode ?? 'floating') === 'trigger';
  const triggerSnippet =
    `<!-- storefront header: the element that opens SharpTalk (any selector works) -->\n` +
    `<button id="st-bell" type="button" aria-label="Notifications">🔔 <span data-sharptalk-badge style="display:none"></span></button>\n` +
    `<script>\n` +
    `  window.SHARPTALK_WIDGET_CONFIG = {\n` +
    `    shop: ${JSON.stringify(data?.shopDomain ?? '')},\n` +
    `    widgetUrl: ${JSON.stringify(WIDGET_URL)},\n` +
    `    trigger: ${JSON.stringify(launcher.triggerSelector || '#st-bell')}\n` +
    `  };\n` +
    `</script>\n` +
    `<script src="${WIDGET_URL}/embed.js" defer></script>`;

  // Same computation the widget runs, so this preview cannot promise a colour
  // the widget would not paint.
  const vars = buildThemeVariables({ brand, headerStyle });
  const onPrimary = vars['--ivy-on-primary'] ?? '255 255 255';
  const headerBg = vars['--ivy-header-bg'];
  const headerFg = vars['--ivy-header-fg'] ?? '17 24 39';

  return (
    <Card title={t('widgetTheme.title')}>
      <p className="mb-4 text-sm text-gray-500">{t('widgetTheme.desc')}</p>
      <div className="flex flex-wrap gap-8">
        <div className="max-w-md flex-1">
          <FormRow label={t('widgetTheme.brand')}>
            <div className="flex items-center gap-2">
              {/* Two inputs edit ONE value, so they need names that tell them
                  apart — "brand colour" twice is no better than unlabelled. */}
              <input
                type="color"
                aria-label={t('widgetTheme.brandPickerA11y')}
                value={brand}
                disabled={isLoading}
                onChange={(e) => setBrandPicked(e.target.value.toUpperCase())}
                className="h-9 w-12 cursor-pointer rounded border border-gray-200"
              />
              <input
                type="text"
                aria-label={t('widgetTheme.brandHexA11y')}
                value={brand}
                disabled={isLoading}
                onChange={(e) => setBrandPicked(e.target.value.toUpperCase())}
                className="w-32 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
              />
            </div>
          </FormRow>
          <p className="mb-4 text-xs text-gray-400">{t('widgetTheme.brandHint')}</p>

          <FormRow label={t('widgetTheme.header')}>
            <Select
              aria-label={t('widgetTheme.header')}
              value={headerStyle}
              disabled={isLoading}
              onChange={(e) => setHeaderPicked(e.target.value as WidgetHeaderStyle)}
            >
              <option value="white">{t('widgetTheme.headerWhite')}</option>
              <option value="brand">{t('widgetTheme.headerBrand')}</option>
            </Select>
          </FormRow>
          <p className="mb-4 text-xs text-gray-400">{t('widgetTheme.autoContrast')}</p>
          <p className="mb-4 text-xs text-gray-400">{t('widgetTheme.statusFixed')}</p>

          {/* --- logo (PLN-260819 S4 FR-T1) --- */}
          <FormRow label={t('widgetTheme.logo')}>
            <div className="flex items-center gap-3">
              {logoSrc ? (
                <img
                  src={logoSrc}
                  alt={t('widgetTheme.logoAlt')}
                  className="max-h-10 max-w-[160px] rounded border border-gray-200 bg-white object-contain p-1"
                />
              ) : (
                <span className="text-xs text-gray-400">{t('widgetTheme.logoNone')}</span>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadLogo.mutate(file);
                  e.target.value = '';
                }}
              />
              <Button
                variant="secondary"
                disabled={uploadLogo.isPending}
                onClick={() => fileRef.current?.click()}
              >
                {logo ? t('widgetTheme.logoChange') : t('widgetTheme.logoUpload')}
              </Button>
              {logo && (
                <Button
                  variant="secondary"
                  disabled={deleteLogo.isPending}
                  onClick={() => deleteLogo.mutate()}
                >
                  {tc('delete')}
                </Button>
              )}
            </div>
          </FormRow>
          <p className="mb-4 text-xs text-gray-400">{t('widgetTheme.logoHint')}</p>

          {/* --- launcher (FR-T2) --- */}
          <FormRow label={t('widgetTheme.launcherPosition')}>
            <Select
              aria-label={t('widgetTheme.launcherPosition')}
              value={launcher.position}
              disabled={isLoading}
              onChange={(e) =>
                setLauncherPicked({ ...launcher, position: e.target.value as WidgetLauncher['position'] })
              }
            >
              <option value="right">{t('widgetTheme.launcherRight')}</option>
              <option value="left">{t('widgetTheme.launcherLeft')}</option>
            </Select>
          </FormRow>
          <FormRow label={t('widgetTheme.launcherSize')}>
            <Select
              aria-label={t('widgetTheme.launcherSize')}
              value={launcher.size}
              disabled={isLoading}
              onChange={(e) =>
                setLauncherPicked({ ...launcher, size: e.target.value as WidgetLauncher['size'] })
              }
            >
              <option value="sm">{t('widgetTheme.launcherSm')}</option>
              <option value="md">{t('widgetTheme.launcherMd')}</option>
              <option value="lg">{t('widgetTheme.launcherLg')}</option>
            </Select>
          </FormRow>
          <FormRow label={t('widgetTheme.launcherIcon')}>
            <Select
              aria-label={t('widgetTheme.launcherIcon')}
              value={launcher.icon}
              disabled={isLoading}
              onChange={(e) =>
                setLauncherPicked({ ...launcher, icon: e.target.value as WidgetLauncher['icon'] })
              }
            >
              <option value="chat">{t('widgetTheme.iconChat')}</option>
              <option value="question">{t('widgetTheme.iconQuestion')}</option>
              <option value="headset">{t('widgetTheme.iconHeadset')}</option>
              {/* Only offered once there is a logo to show. */}
              {logo && <option value="logo">{t('widgetTheme.iconLogo')}</option>}
            </Select>
          </FormRow>
          <p className="mb-4 text-xs text-gray-400">{t('widgetTheme.launcherHint')}</p>

          {/* Launcher mode (PLN-260916 P2): floating button vs the storefront's own header trigger. */}
          <FormRow label={t('widgetTheme.launcherMode')}>
            <div className="flex flex-col gap-1.5 text-sm text-gray-700">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="launcher-mode"
                  checked={!triggerMode}
                  disabled={isLoading}
                  onChange={() => setLauncherPicked({ ...launcher, mode: 'floating' })}
                />
                {t('widgetTheme.launcherModeFloating')}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="launcher-mode"
                  checked={triggerMode}
                  disabled={isLoading}
                  onChange={() =>
                    setLauncherPicked({
                      ...launcher,
                      mode: 'trigger',
                      offsetTop: launcher.offsetTop ?? 72,
                      triggerSelector: launcher.triggerSelector ?? '#st-bell',
                    })
                  }
                />
                {t('widgetTheme.launcherModeTrigger')}
              </label>
            </div>
          </FormRow>
          {triggerMode && (
            <>
              <FormRow label={t('widgetTheme.triggerSelector')}>
                <Input
                  value={launcher.triggerSelector ?? ''}
                  disabled={isLoading}
                  maxLength={80}
                  placeholder="#st-bell"
                  onChange={(e) => setLauncherPicked({ ...launcher, triggerSelector: e.target.value })}
                />
              </FormRow>
              <FormRow label={t('widgetTheme.triggerOffset')}>
                <Input
                  type="number"
                  min={0}
                  max={240}
                  value={launcher.offsetTop ?? 72}
                  disabled={isLoading}
                  onChange={(e) => setLauncherPicked({ ...launcher, offsetTop: Number(e.target.value) })}
                />
              </FormRow>
              <p className="mb-2 text-xs text-gray-400">{t('widgetTheme.triggerHint')}</p>
              <pre className="mb-4 overflow-x-auto rounded-md bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-700">
                {triggerSnippet}
              </pre>
            </>
          )}

          <Button
            onClick={() =>
              save.mutate(
                {
                  brand,
                  headerStyle,
                  launcher,
                },
                {
                  onSuccess: () => {
                    setBrandPicked(null);
                    setHeaderPicked(null);
                    setLauncherPicked(null);
                  },
                },
              )
            }
            disabled={!dirty || save.isPending}
          >
            {save.isPending ? tc('saving') : tc('save')}
          </Button>
        </div>

        {/* Live preview */}
        <div className="w-[260px]">
          <div className="mb-2 text-xs font-medium text-gray-500">{t('widgetTheme.preview')}</div>
          <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm">
            <div
              className="flex items-center justify-between px-3 py-2.5 text-sm font-bold"
              style={{
                backgroundColor: headerBg ? `rgb(${headerBg})` : '#FFFFFF',
                color: `rgb(${headerFg})`,
              }}
            >
              {logoSrc ? (
                <img src={logoSrc} alt="" className="max-h-6 max-w-[55%] object-contain" />
              ) : (
                <span>{t('widgetTheme.previewTitle')}</span>
              )}
              <span className="opacity-60">⚙ ✕</span>
            </div>
            <div className="space-y-2 bg-white px-3 py-3">
              <div className="w-4/5 rounded-xl bg-gray-100 px-3 py-2 text-xs text-gray-800">
                {t('widgetTheme.previewBubble')}
              </div>
              <div className="flex justify-end">
                <span
                  className="rounded-xl px-3 py-2 text-xs font-medium"
                  style={{ backgroundColor: brand, color: `rgb(${onPrimary})` }}
                >
                  {t('widgetTheme.previewUser')}
                </span>
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <span className="rounded-md bg-success px-2 py-0.5 text-[10px] font-semibold text-white">
                  {t('widgetTheme.previewStatus')}
                </span>
                <span className="text-[10px] text-gray-400">{t('widgetTheme.statusFixedShort')}</span>
              </div>
            </div>
          </div>

          {/* Launcher, on the side and at the size it will actually render.
              Drawn here rather than in a live widget iframe on purpose: booting
              the real widget would open a guest session on every keystroke. */}
          <div
            className={`mt-2 flex ${launcher.position === 'left' ? 'justify-start' : 'justify-end'}`}
          >
            <span
              className="flex items-center justify-center rounded-full shadow-lg"
              style={{
                backgroundColor: brand,
                color: `rgb(${onPrimary})`,
                width: LAUNCHER_METRICS[launcher.size].button * 0.75,
                height: LAUNCHER_METRICS[launcher.size].button * 0.75,
              }}
            >
              {launcher.icon === 'logo' && logoSrc ? (
                <img src={logoSrc} alt="" className="h-full w-full rounded-full object-cover" />
              ) : launcher.icon === 'question' ? (
                <CircleHelp className="h-5 w-5" />
              ) : launcher.icon === 'headset' ? (
                <Headset className="h-5 w-5" />
              ) : (
                <MessageCircle className="h-5 w-5" />
              )}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * `/settings` no longer renders anything: it is six screens now (PLN-260824 B).
 *
 * Kept as a redirect rather than deleted — links, bookmarks and the menu
 * catalog's `settings` code all still point here, and breaking those to save a
 * file would be a poor trade.
 */
export function SettingsPage() {
  return <Navigate to="/settings/basic" replace />;
}
