import { apiGetList } from '@/lib/api-client';

export interface WorkLogEntry {
  id: string;
  actorName?: string | null;
  actorType?: string;
  actorId?: string;
  action: string;
  target?: string | null;
  ip?: string | null;
  result?: string;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
}

export interface WorkLogParams {
  page: number;
  pageSize: number;
  action?: string;
  actorId?: string;
  from?: string;
  to?: string;
}

/**
 * The agent work log is the audit trail filtered to `agent.*` actions, plus
 * host-app sign-ins (`host.*`, PLN-261022 P6). It is the same store the
 * platform audit page reads — one trail, two lenses — so a new action added to
 * the console shows up here without further wiring.
 */
export const workLogService = {
  list: (params: WorkLogParams) =>
    apiGetList<WorkLogEntry>('/audit', {
      page: params.page,
      size: params.pageSize,
      action: params.action,
      action_prefix: params.action ? undefined : 'agent.,host.',
      actor_id: params.actorId,
      // An agent filter means console users only: a host row's actor id is a
      // session id and could collide with a user id.
      actor_type: params.actorId ? 'user' : undefined,
      from: params.from,
      to: params.to,
    }),
};

/** Console actions an agent can take, in the order they occur in a shift. */
export const AGENT_ACTIONS = [
  'agent.conversation_accepted',
  'agent.message_sent',
  'agent.customer_linked',
  'agent.customer_created',
  'agent.conversation_ended',
  'agent.conversation_viewed',
  'agent.transcript_viewed',
] as const;

/** Host-app events on the same log (PLN-261022 P6): a Hotel Admin user signing in. */
export const HOST_ACTIONS = ['host.user_signed_in'] as const;
