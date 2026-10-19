import { Injectable, Logger } from '@nestjs/common';
import { localized, routingConditionDef } from '@sharptalk/types';
import type { LocalizedText, RoutingCondition, RoutingConditionField } from '@sharptalk/types';
import { AiConfigService } from './ai-config.service';
import { DENY_MODE, ROUTING_MODE } from './entity/tenant-ai-config.entity';
import type { DenyMode, HandoffConfig, RoutingMode, RoutingRule } from './entity/tenant-ai-config.entity';

/** What the chat pipeline should do with one escalation (PLN-AiSetting W3). */
export interface HandoffRoute {
  /** 'agents' = page the console/Slack/email fan-out; 'email' = off-hours only. */
  mode: 'agents' | 'email';
  /** Agents to address the alert to. Empty = broadcast to everyone. */
  targetUserIds: number[];
  /** Mailbox for the off-hours summary (mode='email'), when configured. */
  email?: string;
  /** Customer-facing notice override for this route, if the tenant set one. */
  notice?: string;
  /**
   * Set when a routing rule picked the group (PLN-261015 D3): how the alert
   * fan-out chooses inside it. Absent = the legacy assignee list.
   */
  assignMode?: RoutingMode;
  /** The matched rule's name (or `#n`), for logs and the alert. */
  ruleName?: string;
}

/** What routing may look at (PLN-261015 D3, PLN-261019 P4). All optional. */
export interface RoutingContext {
  /** Signed session region — `sessions.identity_attributes.region`. */
  region?: string | null;
  /** The customer's message that triggered the handoff. */
  text?: string | null;
  /** Deny-rule label stamp, when a deny rule forced the handoff. */
  label?: string | null;
  /** `sessions.language` (EN/VI/…); compared case-insensitively to a rule's language codes. */
  language?: string | null;
  /** `sessions.identity_level` — guest | verified. */
  identityLevel?: string | null;
  /** `customers.tier` — guest | subscriber | regular; null when the session has no customer. */
  customerTier?: string | null;
  /** Every signed attribute (hotel_id, hotel_name, province, role, region). */
  identityAttributes?: Record<string, string> | null;
  /** `sessions.landing_path`. */
  landingPath?: string | null;
}

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const ruleLogger = new Logger('RoutingRules');

/** The context value a condition field reads; null when the session does not carry it. */
function conditionValue(ctx: RoutingContext, field: RoutingConditionField): string | null {
  switch (field) {
    case 'language':
      return ctx.language ?? null;
    case 'identity_level':
      return ctx.identityLevel ?? null;
    case 'customer_tier':
      return ctx.customerTier ?? null;
    case 'landing_path':
      return ctx.landingPath ?? null;
    case 'hotel_id':
    case 'hotel_name':
    case 'province':
    case 'role':
      return ctx.identityAttributes?.[field] ?? null;
    default:
      return null;
  }
}

/**
 * Does one stored condition hold for this context? Empty values hold (nothing
 * was asked). A field outside the allow-list never holds: matching wide on a
 * condition we cannot read would page the wrong team silently (REQ D6).
 */
export function conditionHolds(cond: RoutingCondition, ctx: RoutingContext): boolean {
  const values = (cond?.values ?? []).map(norm).filter(Boolean);
  if (!values.length) return true;
  const def = routingConditionDef(String(cond?.field));
  if (!def) {
    ruleLogger.warn(`routing condition field '${String(cond?.field)}' is not in the catalog — rule skipped`);
    return false;
  }
  const actual = norm(conditionValue(ctx, def.field));
  if (!actual) return false;
  return def.op === 'contains' ? values.some((v) => actual.includes(v)) : values.includes(actual);
}

/** `language=vi, hotel_name~hanoi` — for the routing log line. */
export function describeConditions(conds: RoutingCondition[] | undefined): string {
  return (conds ?? [])
    .filter((c) => (c?.values ?? []).length)
    .map((c) => `${c.field}${routingConditionDef(String(c.field))?.op === 'contains' ? '~' : '='}${c.values.join('|')}`)
    .join(', ');
}

/**
 * First rule whose filters all match (PLN-261015 D3). An empty filter list
 * matches anything; a rule with no usable assignee is skipped, because a match
 * that pages nobody would be worse than the fallback. Pure — tested directly.
 */
export function matchRoutingRule(
  rules: RoutingRule[] | undefined,
  ctx: RoutingContext,
): { rule: RoutingRule; index: number; assigneeUserIds: number[] } | null {
  const region = norm(ctx.region);
  const text = norm(ctx.text);
  const label = norm(ctx.label);
  for (const [index, rule] of (rules ?? []).entries()) {
    const assigneeUserIds = (rule?.assigneeUserIds ?? []).map(Number).filter((id) => Number.isFinite(id) && id > 0);
    if (!assigneeUserIds.length) continue;
    const regions = (rule.regions ?? []).map(norm).filter(Boolean);
    if (regions.length && !regions.includes(region)) continue;
    const keywords = (rule.keywords ?? []).map(norm).filter(Boolean);
    if (keywords.length && !keywords.some((k) => text.includes(k))) continue;
    const labels = (rule.labels ?? []).map(norm).filter(Boolean);
    if (labels.length && !labels.includes(label)) continue;
    // Customer-information conditions (PLN-261019 P4): all must hold.
    if ((rule.conditions ?? []).some((c) => !conditionHolds(c, ctx))) continue;
    return { rule, index, assigneeUserIds };
  }
  return null;
}

/** Built-in off-hours wording (used when the tenant left the notice blank). */
const DEFAULT_OFF_HOURS_NOTICE: LocalizedText = {
  EN: "We're outside our support hours right now. I've passed your message to our team — they'll reply by email as soon as they're back.",
  ES: 'Ahora mismo estamos fuera del horario de atención. He enviado tu mensaje al equipo y te responderán por correo en cuanto vuelvan.',
  KO: '지금은 상담 가능 시간이 아니에요. 남겨주신 내용은 담당자에게 전달했고, 업무 시간에 이메일로 회신드릴게요.',
  VI: 'Hiện tại đang ngoài giờ hỗ trợ. Tôi đã chuyển tin nhắn của bạn cho đội ngũ của chúng tôi — họ sẽ trả lời qua email ngay khi làm việc trở lại.',
  JA: 'ただいまサポート時間外です。いただいたメッセージは担当チームに引き継ぎました。営業時間になり次第、メールでご返信いたします。',
  ZH: '现在是客服工作时间之外。我已将您的留言转交给我们的团队，他们上班后会尽快通过电子邮件回复您。',
};

/**
 * Decides who to notify on escalation and what to tell the customer.
 * Kept separate from AgentAlertService so the chat pipeline can pick the
 * customer-facing wording before the alert fan-out happens.
 */
@Injectable()
export class HandoffRouterService {
  private readonly logger = new Logger(HandoffRouterService.name);

  constructor(private readonly aiConfig: AiConfigService) {}

  /**
   * Policy deny-list check (PLN-260808-Issue-Workflow-P2): does this customer
   * message hit a tenant rule that forces a human regardless of AI confidence?
   * Returns the rule's issue type/label stamp, or null. Case-insensitive
   * substring match — cheap and predictable for operators.
   */
  async denyMatch(
    tenantId: number | null,
    text: string,
  ): Promise<{ type?: string; label?: string; mode: DenyMode } | null> {
    const config = await this.aiConfig.getHandoffConfig(tenantId);
    const rules = config?.denyRules ?? [];
    if (!rules.length) return null;
    const lower = text.toLowerCase();
    for (const rule of rules) {
      const hit = (rule.keywords ?? []).some((k) => {
        const kw = (k ?? '').trim().toLowerCase();
        return kw.length > 0 && lower.includes(kw);
      });
      // A rule written before `mode` existed reads as SILENT — the behaviour
      // its author chose, and the only safe reading of an absent field here.
      if (hit) return { type: rule.type, label: rule.label, mode: rule.mode ?? DENY_MODE.SILENT };
    }
    return null;
  }

  /** Does any routing rule of this tenant condition on the customer tier? (Saves the customer read otherwise.) */
  async needsCustomerTier(tenantId: number | null): Promise<boolean> {
    const config = await this.aiConfig.getHandoffConfig(tenantId);
    return (config?.routingRules ?? []).some((r) =>
      (r.conditions ?? []).some((c) => c?.field === 'customer_tier' && (c.values ?? []).length > 0),
    );
  }

  async route(tenantId: number | null, language: string, ctx: RoutingContext = {}): Promise<HandoffRoute> {
    const config = await this.aiConfig.getHandoffConfig(tenantId);
    const targetUserIds = config?.assigneeUserIds?.filter((id) => Number.isFinite(id)) ?? [];

    if (config?.businessHours && !this.withinBusinessHours(config.businessHours)) {
      const email = config.offHours?.email?.trim();
      // Off hours without a mailbox configured: nothing to hand the message to,
      // so fall back to paging agents rather than silently dropping the request.
      if (email) {
        return {
          mode: 'email',
          targetUserIds: [],
          email,
          notice: this.notice(config, language),
        };
      }
    }
    // Region × topic rules (PLN-261015 D3). Off hours wins above: nobody in
    // any group is on shift, so the mailbox route stands.
    const hit = matchRoutingRule(config?.routingRules, ctx);
    if (hit) {
      const ruleName = hit.rule.name?.trim() || `#${hit.index + 1}`;
      const conds = describeConditions(hit.rule.conditions);
      this.logger.log(
        `handoff routed by rule ${ruleName} (tenant ${tenantId}, region ${ctx.region ?? '-'}${conds ? `, ${conds}` : ''}, ${hit.assigneeUserIds.length} agent(s))`,
      );
      return {
        mode: 'agents',
        targetUserIds: hit.assigneeUserIds,
        assignMode: hit.rule.mode === ROUTING_MODE.BROADCAST ? ROUTING_MODE.BROADCAST : ROUTING_MODE.LEAST_LOADED,
        ruleName,
      };
    }
    return { mode: 'agents', targetUserIds };
  }

  private notice(config: HandoffConfig, language: string): string {
    return (
      localized(config.offHours?.notice, language).trim() ||
      localized(DEFAULT_OFF_HOURS_NOTICE, language)
    );
  }

  /**
   * Day + time-of-day check in the tenant's timezone. Public holidays are out
   * of scope (PLN §5-2) — weekday and clock only. An overnight window
   * (start > end, e.g. 22:00–06:00) is treated as spanning midnight.
   */
  private withinBusinessHours(hours: NonNullable<HandoffConfig['businessHours']>): boolean {
    const start = this.minutes(hours.start);
    const end = this.minutes(hours.end);
    if (start == null || end == null) return true; // malformed config → never block

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: hours.timezone || 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const dayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    // Intl renders midnight as '24' in some locales/engines — normalise to 0.
    const now = (Number(get('hour')) % 24) * 60 + Number(get('minute'));

    const days = hours.days?.length ? hours.days : [0, 1, 2, 3, 4, 5, 6];
    const onShift = (() => {
      if (start <= end) {
        return days.includes(dayIndex) && now >= start && now < end;
      }
      // Overnight window: the tail after midnight belongs to the previous day's shift.
      const prevDay = (dayIndex + 6) % 7;
      return (days.includes(dayIndex) && now >= start) || (days.includes(prevDay) && now < end);
    })();
    if (!onShift) return false;

    // Breaks (lunch, standup) carve holes in the shift: nobody is at the console,
    // so the shopper should get the email-reply route rather than a promise of a
    // live agent. A malformed entry is ignored, never treated as "closed".
    for (const b of hours.breaks ?? []) {
      const from = this.minutes(b?.start);
      const to = this.minutes(b?.end);
      if (from == null || to == null || from === to) continue;
      const inBreak = from < to ? now >= from && now < to : now >= from || now < to;
      if (inBreak) return false;
    }
    return true;
  }

  private minutes(hhmm: string | undefined): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm?.trim() ?? '');
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
}
