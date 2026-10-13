import { AsyncLocalStorage } from 'node:async_hooks';
import { HTTP_BUCKETS, LLM_BUCKETS, MetricsRegistry } from './metrics.registry';

/**
 * The application's metric catalogue (PLN-261012 SG-83) on one process-wide registry.
 *
 * A module-level singleton rather than a Nest provider on purpose: the call sites are adapters,
 * the gateway, the exception filter and middleware — several of them built with `new` in specs
 * and by positional constructors — so threading an injected collaborator through all of them
 * would widen constructor signatures other streams are editing. Counters here are cheap,
 * side-effect-only and safe to bump from anywhere.
 *
 * Label policy: no tenant ids, no user ids, no free text. Every label below takes a value from a
 * small set the code chooses.
 */
export const metrics = new MetricsRegistry();

export const m = {
  httpRequests: metrics.counter(
    'sharptalk_http_requests_total',
    'HTTP requests by route group, method and status class',
    ['route_group', 'method', 'status_class'],
  ),
  httpDuration: metrics.histogram(
    'sharptalk_http_request_duration_seconds',
    'HTTP request duration by route group',
    HTTP_BUCKETS,
    ['route_group'],
  ),
  chatTurns: metrics.counter(
    'sharptalk_chat_turns_total',
    'Customer chat turns by outcome (answered, handoff, refused, needs_auth, draft, silent, notice)',
    ['outcome'],
  ),
  llmCalls: metrics.counter(
    'sharptalk_llm_calls_total',
    'LLM calls by feature, provider and status (ok, error, timeout, breaker_open)',
    ['feature', 'provider', 'status'],
  ),
  llmDuration: metrics.histogram(
    'sharptalk_llm_call_duration_seconds',
    'LLM call duration (including retries) by provider',
    LLM_BUCKETS,
    ['provider'],
  ),
  llmRetries: metrics.counter('sharptalk_llm_retries_total', 'LLM calls retried after a transient failure', ['provider']),
  embedFailures: metrics.counter(
    'sharptalk_embedding_failures_total',
    'Embedding requests that failed (the turn fell back to the stub embedder)',
    ['provider', 'reason'],
  ),
  qdrantFailures: metrics.counter(
    'sharptalk_qdrant_failures_total',
    'Qdrant requests that failed or were skipped by the breaker',
    ['operation'],
  ),
  vectorDegradedTurns: metrics.counter(
    'sharptalk_vector_degraded_turns_total',
    'Turns answered while the vector leg was unavailable',
    ['reason', 'result'],
  ),
  moderation: metrics.counter(
    'sharptalk_moderation_decisions_total',
    'Moderation decisions by scope and decision (delivered, edited, blocked)',
    ['scope', 'decision'],
  ),
  moderationFailsafe: metrics.counter(
    'sharptalk_moderation_failsafe_blocks_total',
    'Messages blocked because the moderation path itself failed (fail-safe, FR-069)',
    ['cause'],
  ),
  handoffs: metrics.counter(
    'sharptalk_handoffs_total',
    'Conversations handed to a person by reason',
    ['reason'],
  ),
  alertSends: metrics.counter(
    'sharptalk_alert_sends_total',
    'Escalation alert deliveries by channel and result',
    ['channel', 'result'],
  ),
  opsAlerts: metrics.counter(
    'sharptalk_ops_alerts_total',
    'Operational alerts by kind and result (sent, suppressed, failed, unconfigured)',
    ['kind', 'result'],
  ),
  breakerTransitions: metrics.counter(
    'sharptalk_circuit_breaker_transitions_total',
    'Circuit breaker state changes by component and new state',
    ['component', 'to'],
  ),
  breakerState: metrics.gauge(
    'sharptalk_circuit_breaker_state',
    'Worst circuit breaker state per component (0 closed, 1 half-open, 2 open)',
    ['component'],
  ),
  errorReports: metrics.counter(
    'sharptalk_error_reports_total',
    'Server errors handed to the error reporter by sink and result',
    ['sink', 'result'],
  ),
  conversationsOpen: metrics.gauge(
    'sharptalk_conversations_open',
    'Open conversations by status (waiting = queued for a person, agent = owned by a person)',
    ['status'],
  ),
  dbPool: metrics.gauge('sharptalk_db_pool_connections', 'MySQL pool connections by state', ['state']),
  dependencyUp: metrics.gauge(
    'sharptalk_dependency_up',
    'Last readiness probe per dependency (1 up, 0 down)',
    ['dependency'],
  ),
  uptime: metrics.gauge('sharptalk_process_uptime_seconds', 'Seconds since the API process started'),
  rss: metrics.gauge('sharptalk_process_resident_memory_bytes', 'Resident set size of the API process'),
  heapUsed: metrics.gauge('sharptalk_process_heap_used_bytes', 'V8 heap in use'),
};

export const BREAKER_STATE_VALUE = { closed: 0, half_open: 1, open: 2 } as const;

/** Keep a free-form code (a feature name) inside a safe, bounded label alphabet. */
export function safeLabel(raw: string | undefined | null, fallback = 'other'): string {
  const v = (raw ?? '').toLowerCase().replace(/[^a-z0-9_.-]/g, '_').slice(0, 40);
  return v || fallback;
}

// ---------------------------------------------------------------------------------------------
// Chat-turn outcome. The branches of ChatService.handleUserMessage are many and shared with other
// streams, so the outcome is read off the RESULT by a method decorator, and the one refinement
// the result cannot carry ("refused", an out-of-scope reply) is marked from inside through an
// AsyncLocalStorage slot — a one-line hunk at the branch instead of a counter at every return.
// ---------------------------------------------------------------------------------------------

export type TurnOutcome =
  | 'answered'
  | 'handoff'
  | 'refused'
  | 'needs_auth'
  | 'draft'
  | 'silent'
  | 'notice'
  | 'error';

const turnSlot = new AsyncLocalStorage<{ outcome?: TurnOutcome }>();

/** Override the derived outcome for the turn in progress (no-op outside a turn). */
export function markTurnOutcome(outcome: TurnOutcome): void {
  const store = turnSlot.getStore();
  if (store) store.outcome = outcome;
}

/** The outcome a `ChatTurnResult` implies when nothing marked it explicitly. */
export function deriveTurnOutcome(result: {
  escalate?: boolean;
  needsAuth?: boolean;
  draft?: unknown;
  reply?: { senderType?: string } | null;
}): TurnOutcome {
  if (result.escalate) return 'handoff';
  if (result.needsAuth) return 'needs_auth';
  if (result.draft) return 'draft';
  if (!result.reply) return 'silent';
  return result.reply.senderType === 'ai' ? 'answered' : 'notice';
}

/**
 * Method decorator: count the turn by outcome. Never alters the result or swallows an error — a
 * metric must not be able to break a conversation.
 */
export function ObserveChatTurn(): MethodDecorator {
  return (_target, _key, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (...args: unknown[]) => Promise<unknown>;
    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      const store: { outcome?: TurnOutcome } = {};
      return turnSlot.run(store, async () => {
        let result: unknown;
        try {
          result = await original.apply(this, args);
        } catch (e) {
          m.chatTurns.inc({ outcome: 'error' });
          throw e;
        }
        try {
          const derived = deriveTurnOutcome((result ?? {}) as Parameters<typeof deriveTurnOutcome>[0]);
          // A handoff or sign-in prompt keeps its meaning even when a branch also marked "refused".
          const outcome = derived === 'handoff' || derived === 'needs_auth' ? derived : (store.outcome ?? derived);
          m.chatTurns.inc({ outcome });
        } catch {
          /* metrics are best-effort */
        }
        return result;
      });
    };
    return descriptor;
  };
}
