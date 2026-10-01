import type { ScenarioButton } from '../../lib/types';

/**
 * Chips shown under a reply that brought none of its own (the RAG path), so
 * the thread never ends at a dead end.
 *
 * A store gets its order chips. A tenant with no orders (PLN-261001 — a hotel
 * partner desk, a B2B help desk) gets its own scenario buttons instead: they
 * are already scoped to the session's AI agent and resolved to its language,
 * so the operator configures the menu and these chips in one place. "Talk to
 * an agent" closes the row either way.
 */
export interface ReplyChip {
  id: string;
  label: string;
  /** Set for a scenario button — clicking it behaves exactly as in the menu. */
  button?: ScenarioButton;
}

/**
 * Three plus the agent chip fits one or two rows of the docked panel; the full
 * set stays in the menu at the top of the thread.
 */
export const NON_COMMERCE_REPLY_CHIPS = 3;

export type ReplyChipLabels = Record<'myOrders' | 'shipping' | 'returns' | 'agent', string>;

export function replyChips(
  commerceEnabled: boolean,
  scenarioButtons: ScenarioButton[],
  labels: ReplyChipLabels,
): ReplyChip[] {
  const agent: ReplyChip = { id: 'agent_connect', label: labels.agent };
  if (commerceEnabled) {
    return [
      { id: 'my_orders', label: labels.myOrders },
      { id: 'shipping_policy', label: labels.shipping },
      { id: 'return_exchange', label: labels.returns },
      agent,
    ];
  }
  return [
    ...scenarioButtons
      .filter((b) => b.enabled !== false)
      .slice(0, NON_COMMERCE_REPLY_CHIPS)
      .map((b) => ({ id: b.id, label: b.label, button: b })),
    agent,
  ];
}
