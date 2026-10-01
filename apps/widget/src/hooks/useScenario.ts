import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getScenario } from '../services/scenarioService';
import { useWidgetStore } from '../store/widgetStore';
import type { ScenarioButton } from '../lib/types';

/**
 * Resolves the scenario menu buttons. Reads the admin-managed config from the
 * backend (labels come from config). The hardcoded fallback applies ONLY when
 * the fetch failed or hasn't answered — a successful EMPTY list is a real
 * answer (every button disabled, or scoped to other AI agents, REQ-260825 R1)
 * and must render as no menu, not as the full default set. The old
 * `length === 0 → fallback` branch inverted agent scoping exactly there.
 */
export function useScenario(sessionToken: string | null): ScenarioButton[] {
  const { t } = useTranslation();
  const commerceEnabled = useWidgetStore((s) => s.commerceEnabled);

  const { data, isError } = useQuery({
    queryKey: ['scenario', sessionToken],
    queryFn: () => getScenario(sessionToken!),
    enabled: !!sessionToken,
    retry: false,
    // 60s (was 5min): an operator scoping buttons expects the open widget to
    // follow within a beat, not a coffee break.
    staleTime: 60 * 1000,
  });

  const fallback: ScenarioButton[] = [
    { id: 'delivery_status', label: t('chat.scenarios.delivery'), action: 'delivery_status', enabled: true },
    { id: 'cancel_refund', label: t('chat.scenarios.cancelRefund'), action: 'cancel_refund', enabled: true },
    { id: 'product_help', label: t('chat.scenarios.productHelp'), action: 'product_help', enabled: true },
    { id: 'contact_support', label: t('chat.scenarios.contact'), action: 'contact_support', enabled: true },
    { id: 'affiliate', label: t('chat.scenarios.affiliate'), action: 'affiliate', enabled: true },
    { id: 'my_orders', label: t('chat.scenarios.myOrders'), action: 'my_orders', enabled: true },
  ];

  // No data yet (loading) or a failed fetch → the widget still shows a menu —
  // but only a store has a sensible built-in one. A hotel partner desk shown
  // "Delivery Status / Cancel / Refund" while loading is the defect PLN-261001
  // removed; there it waits for the tenant's own buttons.
  if (isError || !data) return commerceEnabled ? fallback : [];
  return data.scenarioButtons ?? [];
}
