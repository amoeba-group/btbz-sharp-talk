import { create } from 'zustand';
import { setStoredSessionToken } from '../lib/api-client';
import { initialLanguage } from '../i18n/i18n';
import { WIDGET_TABS_DEFAULT } from '../lib/widget-tabs';
import { isAppMode } from '../lib/host-bridge';
import type {
  ConsentState,
  WidgetCopy,
  WidgetTheme,
  WidgetLoginMode,
  WidgetTab,
  WidgetTabPosition,
} from '../lib/types';

/**
 * Which tabs exist at all. Which of them a given tenant SHOWS is a setting
 * (`visibleTabs`), not a constant — see PLN-260817-Widget-Tab-Config.
 */
export type TabKey = WidgetTab;

/** Server-confirmed consent snapshot (from session/ensure — source of truth). */
export interface ConsentInfo {
  state: ConsentState;
  consentAt: string | null;
  noticeVersion: string | null;
  privacyPolicyUrl: string | null;
  noticeOutdated: boolean;
}

interface WidgetState {
  sessionToken: string | null;
  activeTab: TabKey;
  panelOpen: boolean;
  /** Whether the settings/preferences panel overlays the tabs. */
  settingsOpen: boolean;
  authenticated: boolean;
  /** True while a storefront sign-in popup is in flight (embed brokers it). */
  authPending: boolean;
  /** Tenant setting: how "Sign in" opens the storefront login (session/ensure). */
  loginMode: WidgetLoginMode;
  /** Tenant widget copy (display name + greetings) from session/ensure. */
  widgetCopy: WidgetCopy | null;
  /** Signed-in shopper's name, once the backend resolves it; null otherwise. */
  customerName: string | null;
  /**
   * Outcome of the storefront identity handshake (embedded only). 'pending' until
   * the embed loader reports back — the widget must not open a throwaway guest
   * session while a verified one may still be on its way.
   */
  embedIdentity: 'pending' | 'verified' | 'anonymous';
  language: string;
  /** Region named in the AI disclosure (from session ensure; default US). */
  aiProcessingRegion: string;
  /** Loader could not find the configured trigger element, so the floating launcher stands in (FIX-260916). */
  triggerUnavailable: boolean;
  /**
   * Privacy consent — gates chat persistence AND GA4 (Consent Mode).
   * Null until session/ensure has reported the server-side state (server is
   * the source of truth; lib/consent.ts holds the local bootstrap cache).
   */
  consent: ConsentInfo | null;
  /** A message queued from another tab to be auto-sent when Chat opens. */
  pendingChatMessage: string | null;
  /**
   * Selected notification filter chip. Store-held rather than tab-local so other
   * surfaces can deep-link into one — a redirect sign-in returning with
   * `?reopen=orders` lands on Shipping, which is where orders live when the
   * orders tab is switched off.
   */
  notificationFilter: string;
  /**
   * Tabs this tenant shows, in display order (session/ensure). Seeded with the
   * built-in default so the first paint — before ensure resolves — is the same
   * bar the majority of tenants will keep, not an empty flash.
   */
  visibleTabs: TabKey[];
  /** Where the tab bar sits (session/ensure). */
  tabPosition: WidgetTabPosition;
  /**
   * True once session/ensure has actually delivered a layout. Before that
   * `visibleTabs` is only the seeded default, which is not the same thing —
   * anything that must not act on a guess (deep links) waits for this.
   */
  tabsResolved: boolean;
  /**
   * Inbound chat messages that arrived while the Chat tab was not the active one
   * — the count on the Chat tab's badge (PLN-260817 W-1). Cleared the moment the
   * shopper opens the tab, since the messages are then on screen.
   */
  chatUnread: number;
  setSessionToken: (t: string | null) => void;
  setActiveTab: (t: TabKey) => void;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  setSettingsOpen: (open: boolean) => void;
  setAuthenticated: (v: boolean) => void;
  setAuthPending: (v: boolean) => void;
  setLoginMode: (m: WidgetLoginMode) => void;
  setWidgetCopy: (c: WidgetCopy | null) => void;
  setCustomerName: (n: string | null) => void;
  /** Tenant theme, for the parts that are markup rather than CSS (logo, launcher). */
  widgetTheme: WidgetTheme | null;
  setWidgetTheme: (t: WidgetTheme | null) => void;
  setEmbedIdentity: (v: 'pending' | 'verified' | 'anonymous') => void;
  setLanguage: (l: string) => void;
  setAiProcessingRegion: (r: string) => void;
  setTriggerUnavailable: (v: boolean) => void;
  setConsentInfo: (c: ConsentInfo | null) => void;
  /** Record a fresh, server-acknowledged consent choice (clears outdated flag). */
  updateConsentState: (
    state: ConsentState,
    consentAt: string | null,
    noticeVersion?: string,
  ) => void;
  setNotificationFilter: (f: string) => void;
  setTabLayout: (tabs: TabKey[], position: WidgetTabPosition) => void;
  bumpChatUnread: (n: number) => void;
  queueChatMessage: (m: string) => void;
  consumeChatMessage: () => string | null;
}

export const useWidgetStore = create<WidgetState>()((set, get) => ({
  // Always null at bootstrap — a persisted token is only used as a resume hint
  // for session/ensure (useEnsureSession) and reaches queries after the backend
  // validates or replaces it. This kills startup 401 noise from stale tokens and,
  // when embedded, keeps a previous customer's persisted session from resuming
  // for a different visitor (privacy) — the app-proxy handshake decides instead.
  sessionToken: null,
  activeTab: 'chat',
  // App mode has no launcher, so a closed panel would render an empty WebView.
  panelOpen: isAppMode(),
  settingsOpen: false,
  authenticated: false,
  authPending: false,
  loginMode: 'redirect',
  widgetCopy: null,
  customerName: null,
  embedIdentity: 'pending',
  // Also the `locale` hint sent to session/ensure, so the server derives the
  // session language from the shopper's own preference rather than a hardcoded
  // 'en' (PLN-260813 P4).
  language: initialLanguage(),
  aiProcessingRegion: 'US',
  triggerUnavailable: false,
  consent: null,
  pendingChatMessage: null,
  notificationFilter: 'all',
  visibleTabs: [...WIDGET_TABS_DEFAULT],
  tabPosition: 'top',
  tabsResolved: false,
  chatUnread: 0,
  setSessionToken: (t) => {
    setStoredSessionToken(t);
    set({ sessionToken: t });
  },
  setActiveTab: (t) => set({ activeTab: t, chatUnread: t === 'chat' ? 0 : get().chatUnread }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setAuthenticated: (v) => set({ authenticated: v }),
  setAuthPending: (v) => set({ authPending: v }),
  setLoginMode: (m) => set({ loginMode: m }),
  setWidgetCopy: (c) => set({ widgetCopy: c }),
  setCustomerName: (n) => set({ customerName: n }),
  widgetTheme: null,
  setWidgetTheme: (t) => set({ widgetTheme: t }),
  setEmbedIdentity: (v) => set({ embedIdentity: v }),
  setLanguage: (l) => set({ language: l }),
  setAiProcessingRegion: (r) => set({ aiProcessingRegion: r }),
  setTriggerUnavailable: (v) => set({ triggerUnavailable: v }),
  setConsentInfo: (c) => set({ consent: c }),
  setNotificationFilter: (f) => set({ notificationFilter: f }),
  /**
   * Apply the tenant's tab layout. If the tab the shopper is currently on is not
   * in the new set — a setting changed under them, or the default no longer
   * includes it — fall back to the first visible tab rather than rendering a
   * panel with no tab selected.
   */
  setTabLayout: (tabs, position) =>
    set((s) => ({
      visibleTabs: tabs,
      tabPosition: position,
      tabsResolved: true,
      activeTab: tabs.includes(s.activeTab) ? s.activeTab : tabs[0],
    })),
  bumpChatUnread: (n) => set((s) => ({ chatUnread: s.chatUnread + n })),
  updateConsentState: (state, consentAt, noticeVersion) =>
    set((s) => ({
      consent: {
        state,
        consentAt,
        noticeVersion: noticeVersion ?? s.consent?.noticeVersion ?? null,
        privacyPolicyUrl: s.consent?.privacyPolicyUrl ?? null,
        // A just-recorded choice is always against the current notice version.
        noticeOutdated: false,
      },
    })),
  queueChatMessage: (m) => set({ pendingChatMessage: m, activeTab: 'chat' }),
  consumeChatMessage: () => {
    const m = get().pendingChatMessage;
    if (m) set({ pendingChatMessage: null });
    return m;
  },
}));
