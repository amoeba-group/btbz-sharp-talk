import { useEffect, useRef, useState } from 'react';
import { Check, FileText, Paperclip, Send, Sparkles, Headphones, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WIDGET_COPY_DEFAULTS } from '../../../../../packages/types/src/common/widget-copy';
import { useWidgetStore } from '../../store/widgetStore';
import { useChat } from '../../hooks/useChat';
import { useScenario } from '../../hooks/useScenario';
import { useAttachmentUpload } from '../../hooks/useAttachmentUpload';
import { getShopDomain } from '../../hooks/useSession';
import { ensureSession, setConsent } from '../../services/sessionService';
import { getStoredConsent, setStoredConsent } from '../../lib/consent';
import { useAnalytics } from '../../lib/analytics';
import type {
  ChatAttachment,
  ScenarioButton,
  ScenarioPostAction,
  WidgetCopyText,
} from '../../lib/types';
import { MessageBubble } from './MessageBubble';
import { TypingBubble } from './TypingBubble';
import { CsatCard } from './CsatCard';
import { ContactEmailCard } from './ContactEmailCard';
import { ConsentBanner } from './ConsentBanner';
import { ScenarioMenu, type SubAction } from './ScenarioMenu';
import { AuthGate } from './AuthGate';
import { ContactCard } from './ContactCard';
import { AffiliateCard } from './AffiliateCard';
import { InlineOrdersAnswer } from './InlineOrderCard';

type Inline = 'auth' | 'contact' | 'affiliate' | 'contactEmail' | 'orders' | null;

/** Pick the tenant-configured copy for the active language, if any. */
function pickCopy(bag: WidgetCopyText | undefined, language: string): string | null {
  const key = (language || 'en').toUpperCase() as keyof WidgetCopyText;
  return bag?.[key]?.trim() || null;
}

/** Substitute a template placeholder everywhere (ES2020-safe replaceAll). */
function fill(template: string, key: string, value: string): string {
  return template.split(key).join(value);
}

export function ChatTab() {
  const { t } = useTranslation();
  const aiRegion = useWidgetStore((s) => s.aiProcessingRegion);
  const sessionToken = useWidgetStore((s) => s.sessionToken);
  const authenticated = useWidgetStore((s) => s.authenticated);
  const customerName = useWidgetStore((s) => s.customerName);
  const setAuthenticated = useWidgetStore((s) => s.setAuthenticated);
  const setSessionToken = useWidgetStore((s) => s.setSessionToken);
  const setSettingsOpen = useWidgetStore((s) => s.setSettingsOpen);
  const consent = useWidgetStore((s) => s.consent);
  const updateConsentState = useWidgetStore((s) => s.updateConsentState);
  const language = useWidgetStore((s) => s.language);
  const pendingChatMessage = useWidgetStore((s) => s.pendingChatMessage);
  const consumeChatMessage = useWidgetStore((s) => s.consumeChatMessage);
  const analytics = useAnalytics();

  const { messages, send, scenario, sending, status, escalate, endChat, canRate, rate, conversationId } =
    useChat(sessionToken);
  // Reply-pending indicator (PLN-260804, corrected by FIX-260806).
  //  · sending  → the AI completion runs synchronously inside the send request.
  //  · agent    → a human took the thread; their reply arrives via the poll.
  //  · waiting  → handed off but nobody has picked it up. This is NOT someone
  //    typing: the bot deliberately stays silent in this state, so an animated
  //    "an agent is writing…" made a queued thread look like an imminent reply
  //    and left the shopper watching dots indefinitely.
  const waitMode: 'ai' | 'agent' | 'queued' | null = sending
    ? 'ai'
    : status === 'agent' && messages[messages.length - 1]?.senderType === 'user'
      ? 'agent'
      : status === 'waiting'
        ? 'queued'
        : null;
  const scenarioButtons = useScenario(sessionToken);
  const quickReplyStyle = useWidgetStore((s) => s.widgetTheme?.design?.quickReplyStyle) ?? 'chip';
  // Recent orders for the in-thread "My orders" answer. Only fetched once the
  // shopper actually asks — `enabled` follows the inline card being shown.
  const activeTab = useWidgetStore((s) => s.activeTab);
  const bumpChatUnread = useWidgetStore((s) => s.bumpChatUnread);

  // CCPA notice choice — local cache only used until session/ensure reports the
  // server-side state (the server is the source of truth; see showConsentBanner).
  const [consentChoice, setConsentChoice] = useState<'granted' | 'denied' | null>(
    () => getStoredConsent(),
  );
  const [input, setInput] = useState('');
  const [inline, setInline] = useState<Inline>(null);
  // Where the shopper was headed when the sign-in card interrupted them. Without
  // it, AuthGate's success handler just cleared `inline` and they landed back on
  // the menu having to pick "My orders" a second time.
  const [afterAuth, setAfterAuth] = useState<Inline>(null);
  // Attachments the shopper picked but has not sent yet (PLN-260814 S3).
  const uploads = useAttachmentUpload(sessionToken);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showEscalate, setShowEscalate] = useState(false);
  // End-chat confirm row (요구 3, PLN-260808 Track B).
  const [endConfirm, setEndConfirm] = useState(false);
  const chatLive = status === 'ai_active' || status === 'waiting' || status === 'agent';
  const scrollRef = useRef<HTMLDivElement>(null);

  // Tenant-configured greetings (session/ensure); fall back to the built-in
  // defaults with {shop} = tenant display name (no hardcoded brand — a second
  // tenant's shoppers must never be welcomed to "IVY USA").
  const widgetCopy = useWidgetStore((s) => s.widgetCopy);
  const shopName = widgetCopy?.displayName || t('appName');
  // The default text comes from the shared registry rather than this app's
  // i18n bundle, so the console shows the very string a shopper would see
  // (PLN-260903 S2). Same wording as before — one source instead of two.
  const defaultCopy = (field: 'firstVisit' | 'loginGreeting'): string =>
    (WIDGET_COPY_DEFAULTS[field] as Record<string, string>)[language.toUpperCase()] ??
    WIDGET_COPY_DEFAULTS[field].EN;

  const greetingFor = (name: string | null): string => {
    const template = name
      ? (pickCopy(widgetCopy?.loginGreeting, language) ?? defaultCopy('loginGreeting'))
      : (pickCopy(widgetCopy?.firstVisit, language) ?? defaultCopy('firstVisit'));
    const withShop = fill(template, '{shop}', shopName);
    return name ? fill(withShop, '{name}', name) : withShop;
  };

  // Requirement 4 (PLN-260808-Widget-Greetings): when the shopper signs in
  // mid-conversation, greet them by name once. Render-only — never persisted.
  const [loginGreeting, setLoginGreeting] = useState<string | null>(null);
  const prevNameRef = useRef<string | null>(customerName);
  useEffect(() => {
    if (!prevNameRef.current && customerName && messages.length > 0) {
      setLoginGreeting(greetingFor(customerName));
    }
    prevNameRef.current = customerName;
    // greetingFor is stable enough for this transition-only effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerName]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, inline, showEscalate, waitMode, endConfirm, status]);

  /**
   * Chat tab badge (PLN-260817 W-1). The thread keeps polling while the shopper
   * is on the notification tab, so an agent reply that lands there would
   * otherwise be invisible until they wandered back. Counts inbound messages
   * only; `setActiveTab('chat')` clears the tally.
   */
  const seenCount = useRef(messages.length);
  useEffect(() => {
    const added = messages.slice(seenCount.current);
    seenCount.current = messages.length;
    if (activeTab === 'chat') return;
    const inbound = added.filter((m) => m.senderType !== 'user').length;
    if (inbound > 0) bumpChatUnread(inbound);
  }, [messages, activeTab, bumpChatUnread]);

  /**
   * Fail-closed consent recording (ConsentBanner awaits this): the banner only
   * dismisses after the server acknowledged the choice. Also refreshes the
   * local cache that gates GA4 before the next ensure.
   */
  async function recordConsent(granted: boolean): Promise<void> {
    let token = sessionToken;
    if (!token) {
      // Session may not exist yet (e.g. first ensure failed) — establish one.
      const res = await ensureSession(null, language, getShopDomain());
      token = res.sessionToken;
      setSessionToken(token);
    }
    const result = await setConsent(token, granted);
    setStoredConsent(granted, result.consentVersion);
    setConsentChoice(granted ? 'granted' : 'denied');
    updateConsentState(
      granted ? 'granted' : 'declined',
      new Date().toISOString(),
      result.consentVersion,
    );
  }

  // Server truth wins; an outdated notice version re-prompts regardless of the
  // local cache. Before the first ensure resolves (or offline), fall back to
  // the local choice.
  const showConsentBanner = consent
    ? consent.state === 'pending' || consent.noticeOutdated
    : consentChoice === null;

  async function doSend(
    text: string,
    attachments?: ChatAttachment[],
    via: 'input' | 'scenario' | 'quick_reply' = 'input',
  ) {
    analytics.chatStart();
    analytics.messageSent(via);
    const res = await send(text, attachments);
    setShowEscalate(res.escalate);
    if (res.needsAuth && !authenticated) setInline('auth');
    // Handed off outside business hours and we hold no address: the reply has
    // to travel by email, so ask before the shopper walks away (PLN-260806).
    else if (res.needsContactEmail) setInline('contactEmail');
  }

  // Auto-send a message queued from another tab (e.g. "Ask about this order").
  useEffect(() => {
    if (!pendingChatMessage || !sessionToken) return;
    const msg = consumeChatMessage();
    if (msg) void doSend(msg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingChatMessage, sessionToken]);

  function handleScenario(button: ScenarioButton) {
    analytics.scenarioClick(button.action, button.label);
    switch (button.action) {
      case 'delivery_status':
        // Scripted shipping scenario (FR-S1); order tracking via follow-up chip.
        void scenario('shipping_policy', button.label).then(runPostAction);
        return;
      case 'my_orders':
        // Answer in the thread (frame 57) rather than throwing the shopper into
        // another tab — which no longer exists anyway (PLN-260817 S3).
        openOrAuth('orders');
        return;
      case 'contact_support':
        setInline('contact');
        return;
      case 'affiliate':
        setInline('affiliate');
        return;
      case 'cancel_refund':
        void scenario('cancel_refund', button.label).then(runPostAction);
        return;
      case 'message':
      default:
        // Custom button: send its label as a chat message (RAG path).
        void doSend(button.label);
        return;
    }
  }

  /**
   * Tenant-configured navigation after a scripted reply (PLN-AiSetting W2).
   * Mirrors the scenario-button destinations so an admin can send a shopper
   * straight to their orders, the contact form, or an external page.
   */
  function runPostAction(post?: ScenarioPostAction) {
    if (!post || post.type === 'none') return;
    switch (post.type) {
      case 'open_orders':
        openOrAuth('orders');
        return;
      case 'open_contact':
        setInline('contact');
        return;
      case 'open_affiliate':
        setInline('affiliate');
        return;
      case 'connect_agent':
        void escalate();
        return;
      case 'open_url':
        // noopener/noreferrer: the destination is tenant-supplied.
        if (post.url) window.open(post.url, '_blank', 'noopener,noreferrer');
        return;
    }
  }

  /** Show `target`, or the sign-in card first and `target` once that succeeds. */
  function openOrAuth(target: Inline) {
    if (authenticated) {
      setInline(target);
      return;
    }
    setAfterAuth(target);
    setInline('auth');
  }

  function handleSubAction(a: SubAction) {
    switch (a) {
      case 'usage':
        return doSend(t('chat.templates.usage'));
      case 'ingredients':
        return doSend(t('chat.templates.ingredients'));
      case 'exchange':
        return void scenario('return_exchange', t('chat.templates.exchange'));
      case 'restock':
        return doSend(t('chat.templates.restock'));
    }
  }

  /** Scenario follow-up chip clicks: control actions or another script. */
  function handleQuickReply(id: string, label: string) {
    switch (id) {
      case 'agent_connect':
        setShowEscalate(false);
        analytics.escalate();
        void escalate();
        return;
      case 'my_orders':
        openOrAuth('orders');
        return;
      default:
        void scenario(id, label).then(runPostAction);
        return;
    }
  }

  /**
   * Follow-ups shown when a reply arrives without its own chips (the RAG path has
   * none). Without this the thread auto-scrolls to a bottom that has nothing to
   * act on — the scenario menu is far above, out of view — so a shopper who asked
   * about an order hits a dead end. Ids match handleQuickReply/scenario handling.
   */
  const lastMessage = messages[messages.length - 1];
  const showFallbackActions =
    !!lastMessage &&
    lastMessage.senderType !== 'user' &&
    !lastMessage.quickReplies?.length &&
    !sending &&
    !showEscalate &&
    inline === null;
  const fallbackActions: { id: string; label: string }[] = [
    { id: 'my_orders', label: t('chat.nextActions.myOrders') },
    { id: 'shipping_policy', label: t('chat.nextActions.shipping') },
    { id: 'return_exchange', label: t('chat.nextActions.returns') },
    { id: 'agent_connect', label: t('chat.nextActions.agent') },
  ];

  function submitInput(e: React.FormEvent) {
    e.preventDefault();
    // Files alone are a valid turn; an upload still in flight is not — sending
    // then would drop the file the shopper is watching upload (PLN-260814).
    if ((!input.trim() && !uploads.ready.length) || sending || uploads.busy) return;
    const text = input;
    const attachments = uploads.ready;
    setInput('');
    uploads.clear();
    void doSend(text, attachments);
  }

  async function pickFiles(files: FileList | null) {
    if (!files?.length) return;
    const problem = await uploads.add(Array.from(files));
    // Rejections are reported, never swallowed (dev-kit §4.3).
    if (problem) setUploadNotice(problem);
  }

  return (
    <div className="flex h-full flex-col">
      {/* AI disclosure + end-chat control */}
      <div className="flex items-center gap-1.5 border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-[11px] text-gray-500">
        <Sparkles className="h-3 w-3 flex-shrink-0 text-primary-400" />
        <span className="min-w-0 flex-1">{t('chat.aiDisclosure', { region: t(`regions.${aiRegion}`, { defaultValue: aiRegion }) })}</span>
        {chatLive && (
          <button
            onClick={() => setEndConfirm(true)}
            className="flex-shrink-0 whitespace-nowrap font-medium text-gray-400 underline-offset-2 hover:text-gray-600 hover:underline"
          >
            {t('chat.endChat')}
          </button>
        )}
      </div>

      {/* Thread */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={sending}
        aria-label={t('a11y.messageThread')}
        className="scroll-thin flex-1 space-y-3 overflow-y-auto p-3"
      >
        {showConsentBanner && (
          <ConsentBanner
            version={consent?.noticeVersion}
            privacyPolicyUrl={consent?.privacyPolicyUrl}
            noticeOutdated={consent?.noticeOutdated}
            onAccept={() => recordConsent(true)}
            onDecline={() => recordConsent(false)}
            onOpenPrivacySettings={() => setSettingsOpen(true)}
          />
        )}

        {/* Welcome bubble — tenant-configured copy; greets by name when known. */}
        <MessageBubble
          message={{
            id: 'welcome',
            senderType: 'ai',
            body: greetingFor(customerName),
            createdAt: new Date().toISOString(),
          }}
        />

        {/* 0 buttons = a real answer (all scoped away / disabled, REQ-260825
            R1) — render nothing rather than an empty grid box. */}
        {scenarioButtons.length > 0 && (
          <ScenarioMenu
            buttons={scenarioButtons}
            onScenario={handleScenario}
            onSubAction={handleSubAction}
            style={quickReplyStyle}
          />
        )}

        {messages.map((m, i) => (
          <div key={m.id} className="space-y-2">
            <MessageBubble message={m} />
            {/* Scenario follow-up chips on the latest message only (FR-S1). */}
            {i === messages.length - 1 && !!m.quickReplies?.length && (
              <div className="flex flex-wrap gap-1.5 pl-1">
                {m.quickReplies.map((q) => (
                  <button
                    key={q.id}
                    onClick={() => handleQuickReply(q.id, q.label)}
                    disabled={sending}
                    className={`rounded-full border bg-white px-3.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                      /* The design outlines only the conversation-ending chip in
                         blue (frame 65) — everything else is a quiet gray pill. */
                      q.id === 'end_chat'
                        ? 'border-primary-400 text-primary-600 hover:bg-primary-50'
                        : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Sign-in greeting for a mid-conversation login (render-only, once). */}
        {loginGreeting && (
          <MessageBubble
            message={{
              id: 'login-greeting',
              senderType: 'ai',
              body: loginGreeting,
              createdAt: new Date().toISOString(),
            }}
          />
        )}

        {/* End-chat confirm (render-only; the session and sign-in survive). */}
        {endConfirm && chatLive && (
          <div className="flex flex-col items-center gap-2 rounded-st-md border border-gray-200 bg-gray-50 p-3">
            <span className="text-xs text-gray-600">{t('chat.endConfirm')}</span>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEndConfirm(false);
                  void endChat();
                }}
                className="rounded-full bg-gray-700 px-4 py-1 text-xs font-medium text-white hover:bg-gray-800"
              >
                {t('chat.endChat')}
              </button>
              <button
                onClick={() => setEndConfirm(false)}
                className="rounded-full border border-gray-300 bg-white px-4 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
              >
                {t('chat.endCancel')}
              </button>
            </div>
          </div>
        )}

        {/* Ended — set by our end button OR an agent ending the thread. The
            design closes the conversation with a mark rather than a hairline
            divider (frame 69), which reads as a finished errand. */}
        {status === 'ended' && (
          <div className="flex flex-col items-center gap-2 py-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15">
              <Check className="h-6 w-6 text-success" />
            </span>
            <span className="text-sm font-bold text-gray-900">{t('chat.endedTitle')}</span>
            <span className="text-xs text-gray-400">{t('chat.endedThanks')}</span>
          </div>
        )}

        {/* Satisfaction (PLN-260810 P3). The server decides whether the window
            is still open, so the card cannot outlive what the API accepts. */}
        {status === 'ended' && canRate && conversationId && (
          <CsatCard conversationId={conversationId} onRate={rate} />
        )}

        {waitMode && <TypingBubble mode={waitMode} />}

        {showFallbackActions && (
          <div className="flex flex-wrap gap-1.5 pl-1">
            {fallbackActions.map((a) => (
              <button
                key={a.id}
                onClick={() => handleQuickReply(a.id, a.label)}
                className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50"
              >
                {a.label}
              </button>
            ))}
          </div>
        )}

        {inline === 'auth' && (
          <AuthGate
            sessionToken={sessionToken}
            onSuccess={() => {
              setAuthenticated(true);
              setInline(afterAuth);
              setAfterAuth(null);
            }}
            onCancel={() => {
              setInline(null);
              setAfterAuth(null);
            }}
          />
        )}
        {inline === 'contactEmail' && (
          <ContactEmailCard sessionToken={sessionToken} onSaved={() => setInline(null)} />
        )}
        {inline === 'contact' && (
          <ContactCard
            onChatAgent={() => {
              setInline(null);
              setShowEscalate(true);
              void escalate();
            }}
          />
        )}
        {inline === 'affiliate' && (
          <AffiliateCard sessionToken={sessionToken} />
        )}
        {inline === 'orders' && <InlineOrdersAnswer sessionToken={sessionToken} />}

        {showEscalate && (
          <button
            onClick={() => {
              setShowEscalate(false);
              void escalate();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-st-md border border-primary-400 bg-primary-500/5 px-3 py-2 text-sm font-medium text-primary-600 hover:bg-primary-500/10"
          >
            <Headphones className="h-4 w-4" />
            {t('chat.connectAgent')}
          </button>
        )}
      </div>

      {/* Attachment tray: what is uploading, what failed, what is ready to send */}
      {(uploads.pending.length > 0 || uploadNotice) && (
        <div className="space-y-1 border-t border-gray-100 px-2 pt-2">
          {uploadNotice && (
            <div className="flex items-start gap-1.5 rounded-st-xs bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
              <span className="min-w-0 flex-1">{uploadNotice}</span>
              <button
                type="button"
                onClick={() => setUploadNotice(null)}
                aria-label={t('chat.attachment.close')}
                className="flex-shrink-0 opacity-70 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {uploads.pending.map((p) => (
            <div
              key={p.key}
              className={`flex items-center gap-2 rounded-st-xs border px-2 py-1 text-[11px] ${
                p.error ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200 bg-gray-50'
              }`}
            >
              {p.previewUrl ? (
                <img src={p.previewUrl} alt="" className="h-8 w-8 flex-shrink-0 rounded-st-xs object-cover" />
              ) : (
                <FileText className="h-4 w-4 flex-shrink-0 text-gray-400" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate">{p.error ?? p.name}</div>
                {!p.attachment && !p.error && (
                  <>
                    <div className="mt-0.5 h-1 w-full overflow-hidden rounded-st-xs bg-gray-200">
                      <div
                        className="h-full bg-primary-500 transition-all"
                        style={{ width: `${p.progress}%` }}
                      />
                    </div>
                    {/* The bytes are up but the server is still converting (a HEIC
                        takes about a second). Without this the bar sits at the end
                        and looks stuck. */}
                    {p.progress >= 99 && (
                      <div className="mt-0.5 text-[10px] text-gray-500">
                        {t('chat.attachment.processing')}
                      </div>
                    )}
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => uploads.remove(p.key)}
                aria-label={t('chat.attachment.remove', { name: p.name })}
                className="flex-shrink-0 text-gray-400 hover:text-gray-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={submitInput}
        className="st-composer flex items-center gap-2 border-t border-gray-100 px-3 py-3"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.avif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx"
          className="hidden"
          onChange={(e) => {
            void pickFiles(e.target.files);
            // Reset so picking the same file twice still fires a change event.
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          aria-label={t('chat.attachment.attach')}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-st-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('chat.inputPlaceholder')}
          className="st-input flex-1 rounded-full border border-gray-200 px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-50"
        />
        <button
          type="submit"
          disabled={sending || uploads.busy || (!input.trim() && !uploads.ready.length)}
          aria-label={t('chat.send')}
          className="st-send flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary-500 text-on-primary hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-40"
        >
          <Send className="h-[18px] w-[18px]" />
        </button>
      </form>
    </div>
  );
}
