import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import {
  initGa4,
  isEnabled,
  resolveMeasurementId,
  setCommonParams,
  setConsent,
  track,
} from './ga4';
import { attributionParams, resolveAttribution } from './utm';
import {
  FUNNEL_STAGE,
  GA_EVENT,
  type FunnelStage,
  type GaItem,
  type PurchasePayload,
} from './events';

/** The analytics surface exposed to components via `useAnalytics()`. */
export interface Analytics {
  enabled: boolean;
  /** Low-level escape hatch — prefer the typed helpers below. */
  track: (name: string, params?: Record<string, unknown>) => void;
  funnel: (stage: FunnelStage, params?: Record<string, unknown>) => void;
  widgetOpen: () => void;
  widgetClose: () => void;
  tabView: (tab: string) => void;
  chatStart: () => void;
  messageSent: (via: 'input' | 'scenario' | 'quick_reply') => void;
  scenarioClick: (action: string, label?: string) => void;
  escalate: () => void;
  orderSearch: (found: boolean) => void;
  orderView: (order: { id: string; value?: number; currency?: string }) => void;
  /** `outbound`: Track left for the carrier's own page (PLN-260923 P2) rather than the inline stepper. */
  trackingView: (orderId: string, outbound?: boolean) => void;
  beginCheckout: (params?: { value?: number; currency?: string; items?: GaItem[] }) => void;
  /** Payment-conversion key event (deduped per transaction within the session). */
  purchase: (payload: PurchasePayload) => void;
}

const noop = () => undefined;
const DISABLED: Analytics = {
  enabled: false,
  track: noop,
  funnel: noop,
  widgetOpen: noop,
  widgetClose: noop,
  tabView: noop,
  chatStart: noop,
  messageSent: noop,
  scenarioClick: noop,
  escalate: noop,
  orderSearch: noop,
  orderView: noop,
  trackingView: noop,
  beginCheckout: noop,
  purchase: noop,
};

const Ga4Context = createContext<Analytics>(DISABLED);

interface Ga4ProviderProps {
  children: ReactNode;
  /** Explicit measurement ID (else iframe `?ga4=` / VITE_GA4_MEASUREMENT_ID). */
  measurementId?: string | null;
  /** Whether the visitor has granted the privacy/analytics consent. */
  consent?: boolean;
  /** Extra context merged into every event (tenant shop, language). */
  context?: Record<string, unknown>;
}

/**
 * Initializes GA4 once (Consent Mode v2, UTM attribution as common params) and
 * provides the typed `useAnalytics()` API. When no measurement ID resolves,
 * every call is a no-op — the widget behaves exactly as before.
 */
export function Ga4Provider({ children, measurementId, consent = false, context }: Ga4ProviderProps) {
  const purchased = useRef<Set<string>>(new Set());
  const started = useRef(false);

  useEffect(() => {
    const id = resolveMeasurementId(measurementId);
    if (!id) return;
    const attribution = resolveAttribution();
    setCommonParams({ ...attributionParams(attribution), ...(context ?? {}) });
    initGa4(id, consent);
    // First-load impression (queued until consent, then flushed).
    track(GA_EVENT.WIDGET_VIEW, {});
    track(GA_EVENT.FUNNEL_STAGE, { stage: FUNNEL_STAGE.AWARENESS });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep common context (tenant/language) fresh as it resolves post-mount.
  useEffect(() => {
    if (isEnabled() && context) setCommonParams(context);
  }, [context]);

  // Propagate consent changes to GA4 Consent Mode.
  useEffect(() => {
    if (isEnabled()) setConsent(consent);
  }, [consent]);

  const api = useMemo<Analytics>(() => {
    if (!resolveMeasurementId(measurementId)) return DISABLED;
    return {
      enabled: true,
      track,
      funnel: (stage, params) => track(GA_EVENT.FUNNEL_STAGE, { stage, ...params }),
      widgetOpen: () => {
        track(GA_EVENT.WIDGET_OPEN, {});
        track(GA_EVENT.FUNNEL_STAGE, { stage: FUNNEL_STAGE.ENGAGEMENT });
      },
      widgetClose: () => track(GA_EVENT.WIDGET_CLOSE, {}),
      tabView: (tab) => track(GA_EVENT.TAB_VIEW, { tab }),
      chatStart: () => {
        if (started.current) return;
        started.current = true;
        track(GA_EVENT.CHAT_START, {});
        track(GA_EVENT.FUNNEL_STAGE, { stage: FUNNEL_STAGE.CONSIDERATION });
      },
      messageSent: (via) => track(GA_EVENT.MESSAGE_SENT, { via }),
      scenarioClick: (action, label) => track(GA_EVENT.SCENARIO_CLICK, { action, label }),
      escalate: () => track(GA_EVENT.ESCALATE, {}),
      orderSearch: (found) => track(GA_EVENT.SEARCH, { search_term: 'order_lookup', found }),
      orderView: (order) => {
        track(GA_EVENT.VIEW_ITEM, {
          items: [{ item_id: order.id }],
          ...(order.value != null ? { value: order.value, currency: order.currency } : {}),
        });
        track(GA_EVENT.FUNNEL_STAGE, { stage: FUNNEL_STAGE.CONSIDERATION });
      },
      trackingView: (orderId, outbound = false) =>
        track(GA_EVENT.TRACKING_VIEW, { order_id: orderId, outbound }),
      beginCheckout: (params) => {
        track(GA_EVENT.BEGIN_CHECKOUT, { ...params });
        track(GA_EVENT.FUNNEL_STAGE, { stage: FUNNEL_STAGE.INTENT });
      },
      purchase: (payload) => {
        // Dedup: a page can re-report the same order — count each conversion once.
        if (purchased.current.has(payload.transaction_id)) return;
        purchased.current.add(payload.transaction_id);
        track(GA_EVENT.PURCHASE, { ...payload });
        track(GA_EVENT.FUNNEL_STAGE, {
          stage: FUNNEL_STAGE.PURCHASE,
          value: payload.value,
          currency: payload.currency,
        });
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurementId]);

  return <Ga4Context.Provider value={api}>{children}</Ga4Context.Provider>;
}

export function useAnalytics(): Analytics {
  return useContext(Ga4Context);
}
