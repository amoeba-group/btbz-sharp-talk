import type { PrivacyNoticeContext } from '@sharptalk/types';

/**
 * Retention settings in one place (PLN-261012 SG-70).
 *
 * The conversation-log window used to be parsed inside RetentionService alone,
 * while the consent notice kept its own "365 days" in the widget bundle. Two
 * copies of one promise is how a notice drifts from the job that enforces it.
 * Both now read the same env through this file: the purge job enforces
 * `conversationRetentionDays()`, and the notice quotes the same number.
 */

/** What an unset / zero / non-numeric CONVERSATION_LOG_RETENTION_DAYS means. */
export const DEFAULT_CONVERSATION_RETENTION_DAYS = 365;

/**
 * Conversation-log window in days. Env values arrive as strings, so this
 * coerces; a blank, `0`, negative or non-numeric value falls back to 365 — it
 * does NOT mean "keep forever" (the old `.env.self-hosted.example` comment said
 * it did, which is the opposite of what retention.service has always done).
 */
export function conversationRetentionDays(raw: unknown): number {
  const days = Number(raw);
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_CONVERSATION_RETENTION_DAYS;
}

/**
 * An OPT-IN window: blank, `0`, negative or non-numeric means the purge is OFF
 * (null), never a default. Used for the tables whose disposal is a legal
 * decision rather than housekeeping (customers, audit_logs) — a deployment that
 * has not chosen a number must keep its rows exactly as before.
 */
export function optionalRetentionDays(raw: unknown): number | null {
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return null;
  const days = Number(raw);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : null;
}

/** Region named in the notice and the AI footer (AI_PROCESSING_REGION, default US). */
export function aiProcessingRegionFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return (env.AI_PROCESSING_REGION || 'US').trim().toUpperCase();
}

/**
 * The values the consent notice interpolates, read from the deployment's env at
 * call time. Server-side on purpose: the widget cannot know either number.
 */
export function noticeContextFromEnv(env: NodeJS.ProcessEnv = process.env): PrivacyNoticeContext {
  return {
    retentionDays: conversationRetentionDays(env.CONVERSATION_LOG_RETENTION_DAYS),
    region: aiProcessingRegionFromEnv(env),
  };
}
