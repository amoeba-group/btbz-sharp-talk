import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '../external/mailer.service';
import { RedisService } from '../cache/redis.service';
import { redactSecrets } from '../../global/util/secret-redact.util';
import { scrubPii } from '../../global/util/pii-scrub.util';
import { envNumber } from '../../global/util/env-number.util';
import { m, safeLabel } from './app-metrics';

/**
 * Generic operational alerting (PLN-261012 SG-83).
 *
 * Until now the only alert paths were the escalation Slack/email (a CUSTOMER needs a person) and a
 * Korean-language AI-credit mail whose recipient defaults to an Amoeba mailbox. This is the missing
 * "the SERVICE needs a person" channel: provider failure rate, an open circuit breaker, a dead vector
 * backend, a failing database or Redis, a failed retention purge, a failed backup.
 *
 * Properties that matter:
 *  - NO built-in recipients. `OPS_ALERT_EMAIL` and `OPS_ALERT_WEBHOOK_URL` are the only targets; with
 *    neither set the alert is logged and counted but goes nowhere (a self-hosted install must not mail
 *    its failures to the vendor by default).
 *  - Dedupe with a cooldown, per alert key. A dead engine fails on every customer turn; without this
 *    the first outage minute would send hundreds of messages. A different key is a different problem.
 *  - English only, no customer text. `detail` is secret-redacted and PII-scrubbed and capped.
 *  - Never throws. An alert that cannot be sent must not break the code path that raised it.
 */
export type OpsSeverity = 'info' | 'warning' | 'critical';

export interface OpsAlert {
  /** Dedupe identity: `kind` plus whatever distinguishes two instances of the problem (`:anthropic`). */
  key: string;
  /** Bounded vocabulary, used as a metric label: `llm_breaker`, `backup_failed`, … */
  kind: string;
  severity: OpsSeverity;
  title: string;
  /** What the operator needs to act on; machine text, never customer text. */
  detail?: string;
}

export type OpsAlertOutcome = 'sent' | 'suppressed' | 'failed' | 'unconfigured';

export interface OpsAlertResult {
  outcome: OpsAlertOutcome;
  /** Which channels accepted it. */
  channels: Array<'webhook' | 'email'>;
}

/** Default repeat window per key. `OPS_ALERT_COOLDOWN_SEC` overrides. */
export const DEFAULT_COOLDOWN_SEC = 30 * 60;
const MAX_DETAIL = 800;
const WEBHOOK_TIMEOUT_MS = 5_000;

/** The deliverable text, shared by the webhook and the mail so the two never disagree. */
export function formatOpsAlert(
  a: Pick<OpsAlert, 'severity' | 'title' | 'detail'>,
  env: { name: string; at: Date; cooldownSec: number; resolved?: boolean },
): { subject: string; text: string } {
  const tag = env.resolved ? 'RESOLVED' : a.severity.toUpperCase();
  const subject = `[SharpTalk ${env.name}] ${tag}: ${a.title}`;
  const text = [
    `${tag}: ${a.title}`,
    '',
    `Environment : ${env.name}`,
    `Time (UTC)  : ${env.at.toISOString()}`,
    ...(a.detail ? ['', `Detail: ${a.detail}`] : []),
    '',
    env.resolved
      ? 'The condition has cleared.'
      : `Repeats of this alert are suppressed for ${Math.round(env.cooldownSec / 60)} minutes; a RESOLVED notice follows when it clears.`,
  ].join('\n');
  return { subject, text };
}

/** Secret-redact, PII-scrub and cap free text before it leaves the process. */
export function sanitizeDetail(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = redactSecrets(scrubPii(raw).text).replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, MAX_DETAIL) : undefined;
}

@Injectable()
export class OpsAlertService {
  private readonly logger = new Logger(OpsAlertService.name);
  /** key → last send time (ms). The fallback when Redis is unavailable; also the active-alert set. */
  private readonly lastSent = new Map<string, number>();
  /** Alerts raised and not yet resolved, for the RESOLVED notice. */
  private readonly active = new Set<string>();
  private warnedUnconfigured = false;

  constructor(
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
    // Appended and optional so positional test doubles stay valid; without Redis the cooldown is per process.
    @Optional() private readonly redis?: RedisService,
  ) {}

  private recipients(): string[] {
    return (this.config.get<string>('OPS_ALERT_EMAIL') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private webhookUrl(): string {
    return (this.config.get<string>('OPS_ALERT_WEBHOOK_URL') ?? '').trim();
  }

  private cooldownSec(): number {
    return Math.max(0, envNumber('OPS_ALERT_COOLDOWN_SEC', DEFAULT_COOLDOWN_SEC));
  }

  /** Which channels are configured — shown by the ops hook and the docs. */
  configured(): { webhook: boolean; email: boolean } {
    return { webhook: !!this.webhookUrl(), email: this.recipients().length > 0 && this.mailer.configured() };
  }

  /**
   * Raise an alert unless the same key was sent inside the cooldown. Returns what happened so the
   * ops hook can tell its caller; every other caller ignores it.
   */
  async alert(a: OpsAlert, now: Date = new Date()): Promise<OpsAlertResult> {
    try {
      const cooldown = this.cooldownSec();
      if (!(await this.claim(a.key, now.getTime(), cooldown))) {
        m.opsAlerts.inc({ kind: safeLabel(a.kind), result: 'suppressed' });
        return { outcome: 'suppressed', channels: [] };
      }
      this.active.add(a.key);
      const channels = await this.deliver(a, now, cooldown, false);
      return this.record(a.kind, channels);
    } catch (e) {
      this.logger.warn(`ops alert failed (${a.key}): ${(e as Error).message}`);
      m.opsAlerts.inc({ kind: safeLabel(a.kind), result: 'failed' });
      return { outcome: 'failed', channels: [] };
    }
  }

  /**
   * The condition behind `key` cleared. Sends ONE "resolved" notice if this process had alerted, and
   * re-arms the key so a relapse alerts again immediately instead of waiting out the cooldown.
   */
  async resolve(key: string, kind: string, title: string, detail?: string, now: Date = new Date()): Promise<void> {
    if (!this.active.delete(key)) return;
    this.lastSent.delete(key);
    await this.redis?.del(this.redisKey(key));
    try {
      await this.deliver({ key, kind, severity: 'info', title, detail }, now, this.cooldownSec(), true);
    } catch (e) {
      this.logger.warn(`ops resolve notice failed (${key}): ${(e as Error).message}`);
    }
  }

  private record(kind: string, channels: Array<'webhook' | 'email'>): OpsAlertResult {
    const cfg = this.configured();
    const outcome: OpsAlertOutcome = channels.length ? 'sent' : cfg.webhook || cfg.email ? 'failed' : 'unconfigured';
    m.opsAlerts.inc({ kind: safeLabel(kind), result: outcome });
    return { outcome, channels };
  }

  private redisKey(key: string): string {
    return `ops:alert:${key}`;
  }

  /** Claim the slot for `key`; false = already alerted inside the cooldown. */
  private async claim(key: string, nowMs: number, cooldownSec: number): Promise<boolean> {
    if (cooldownSec <= 0) return true;
    const viaRedis = await this.redis?.setIfAbsent(this.redisKey(key), String(nowMs), cooldownSec);
    if (viaRedis !== undefined && viaRedis !== null) {
      if (viaRedis) this.lastSent.set(key, nowMs);
      return viaRedis;
    }
    const last = this.lastSent.get(key);
    if (last !== undefined && nowMs - last < cooldownSec * 1000) return false;
    this.lastSent.set(key, nowMs);
    return true;
  }

  private async deliver(
    a: OpsAlert,
    at: Date,
    cooldownSec: number,
    resolved: boolean,
  ): Promise<Array<'webhook' | 'email'>> {
    const env = process.env.NODE_ENV || 'development';
    const detail = sanitizeDetail(a.detail);
    const { subject, text } = formatOpsAlert({ ...a, detail }, { name: env, at, cooldownSec, resolved });
    const cfg = this.configured();
    const log = a.severity === 'critical' ? this.logger.error : this.logger.warn;
    log.call(this.logger, `[ops-alert] ${resolved ? 'RESOLVED ' : ''}${a.key}: ${a.title}${detail ? ` — ${detail}` : ''}`);
    if (!cfg.webhook && !cfg.email && !this.warnedUnconfigured) {
      this.warnedUnconfigured = true;
      this.logger.warn('Ops alerts are not delivered anywhere: set OPS_ALERT_EMAIL and/or OPS_ALERT_WEBHOOK_URL');
    }
    const sent: Array<'webhook' | 'email'> = [];
    const jobs: Array<Promise<void>> = [];
    if (cfg.webhook) {
      jobs.push(
        this.postWebhook({ a, detail, subject, text, at, env, resolved }).then((ok) => {
          if (ok) sent.push('webhook');
        }),
      );
    }
    if (cfg.email) {
      jobs.push(
        (async () => {
          const oks = await Promise.all(this.recipients().map((to) => this.mailer.send({ to, subject, text })));
          if (oks.some(Boolean)) sent.push('email');
        })(),
      );
    }
    await Promise.allSettled(jobs);
    return sent;
  }

  /**
   * JSON POST. `text` (Slack, Teams) and `content` (Discord) carry the readable message so the
   * common incoming-webhook formats work unmodified; the structured fields are for a custom receiver.
   */
  private async postWebhook(p: {
    a: OpsAlert;
    detail?: string;
    subject: string;
    text: string;
    at: Date;
    env: string;
    resolved: boolean;
  }): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const res = await fetch(this.webhookUrl(), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: p.text,
          content: p.text,
          source: 'sharptalk',
          environment: p.env,
          key: p.a.key,
          kind: p.a.kind,
          severity: p.resolved ? 'resolved' : p.a.severity,
          title: p.a.title,
          detail: p.detail ?? null,
          timestamp: p.at.toISOString(),
        }),
      });
      if (!res.ok) this.logger.warn(`ops alert webhook answered HTTP ${res.status}`);
      return res.ok;
    } catch (e) {
      // The URL can embed a secret (Slack/Teams tokens live in the path): log the failure, not the target.
      this.logger.warn(`ops alert webhook failed: ${(e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
