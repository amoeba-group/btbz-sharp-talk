import { Injectable, Logger } from '@nestjs/common';
import { localized, normalizeProvince, regionLabelOf, resolveHotelRegion } from '@sharptalk/types';
import type { HotelRegion, IdentityClaims, LocalizedText } from '@sharptalk/types';
import { AiConfigService } from './ai-config.service';
import { DENY_MODE } from './entity/tenant-ai-config.entity';
import type { DenyMode, HandoffConfig } from './entity/tenant-ai-config.entity';

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

/** A province the table does not list is warned about once per this long, per tenant. */
const UNMAPPED_WARN_TTL_MS = 60 * 60 * 1000;
/** Bound on remembered (tenant, province) pairs, so hostile input cannot grow the map. */
const UNMAPPED_WARN_MAX = 500;

/** Result of resolving a hotel's province (PLN-261012 SG-61). */
export interface RegionLookup {
  region: (HotelRegion & { label: string }) | null;
  /**
   * Set only when region routing is ON, the province is signed and non-blank, and
   * the table does not list it — the case an operator must be able to see.
   */
  unmapped?: string;
}

/** One team the customer can pick, resolved to the session language. */
export interface TeamOption {
  id: string;
  /** JobLabel whose agents get paged (consult | sales_admin | …). */
  jobLabel: string;
  label: string;
}

/** The team question as the chat pipeline asks it (PLN-261007 Team Routing). */
export interface TeamQuestion {
  prompt: string;
  options: TeamOption[];
}

/** Chip id prefix the widget sends back as `support_type` (minus the prefix). */
export const TEAM_CHIP_PREFIX = 'team:';
export const TEAM_OPTIONS_MAX = 4;

const DEFAULT_TEAM_PROMPT: LocalizedText = {
  EN: 'What do you need help with?',
  ES: '¿Con qué necesitas ayuda?',
  KO: '어떤 도움이 필요하신가요?',
  VI: 'Bạn cần hỗ trợ về việc gì?',
  JA: 'どのようなご用件でしょうか？',
  ZH: '您需要哪方面的帮助？',
};

/**
 * Built-in options and wording. Keyed by option id so a tenant that enables
 * the feature without editing anything gets the CS / Business pair, and a
 * tenant that keeps the ids but blanks a label still shows sensible text.
 */
const DEFAULT_TEAM_OPTIONS: Array<{ id: string; jobLabel: string; label: LocalizedText }> = [
  {
    id: 'cs',
    jobLabel: 'consult',
    label: {
      EN: 'Customer Service Support',
      ES: 'Atención al cliente',
      KO: '고객 서비스 지원',
      VI: 'Hỗ trợ khách hàng',
      JA: 'カスタマーサポート',
      ZH: '客户服务支持',
    },
  },
  {
    id: 'business',
    jobLabel: 'sales_admin',
    label: {
      EN: 'Business Support',
      ES: 'Soporte comercial',
      KO: '비즈니스 지원',
      VI: 'Hỗ trợ kinh doanh',
      JA: 'ビジネスサポート',
      ZH: '商务支持',
    },
  },
];

/**
 * Decides who to notify on escalation and what to tell the customer.
 * Kept separate from AgentAlertService so the chat pipeline can pick the
 * customer-facing wording before the alert fan-out happens.
 */
@Injectable()
export class HandoffRouterService {
  private readonly logger = new Logger(HandoffRouterService.name);
  /** "tenant|normalised province" → when it was last warned about. */
  private readonly unmappedWarned = new Map<string, number>();

  constructor(private readonly aiConfig: AiConfigService) {}

  /**
   * The regional team that looks after this visitor's hotel, or null when the
   * tenant has region routing off, the visitor carries no signed province, or
   * the table does not list it (PLN-261007 Hotel Region Routing).
   *
   * Only SIGNED claims count: an unsigned province is display text a visitor
   * could type, and the whole point of putting it under the signature is that
   * routing may rely on it. A province the table misses is logged so an operator
   * can see which spellings to add — silence here would just look like "region
   * routing does nothing" — but once per tenant and province per hour, so one
   * unlisted hotel does not write a line per hand-off (PLN-261012 SG-61).
   */
  async regionOf(
    tenantId: number | null,
    claims: Pick<IdentityClaims, 'province' | 'signed'> | null | undefined,
  ): Promise<(HotelRegion & { label: string }) | null> {
    return (await this.regionLookup(tenantId, claims)).region;
  }

  /**
   * `regionOf` plus the one fact it cannot carry in a null: that the province was
   * NOT in the table. The hand-off puts that on the alert ("Region: ? (unmapped:
   * …)") so the person paged can see why no regional team was asked.
   */
  async regionLookup(
    tenantId: number | null,
    claims: Pick<IdentityClaims, 'province' | 'signed'> | null | undefined,
  ): Promise<RegionLookup> {
    const province = claims?.signed ? claims.province?.trim() : '';
    if (!province) return { region: null };
    const config = await this.aiConfig.getHandoffConfig(tenantId);
    const routing = config?.regionRouting;
    if (!routing?.enabled) return { region: null };
    const region = resolveHotelRegion(routing, province);
    if (!region) {
      this.warnUnmapped(tenantId, province);
      return { region: null, unmapped: province };
    }
    const rule = routing.categories?.find((c) => c.id === region.category);
    return { region: { ...region, label: regionLabelOf(region, localized(rule?.label, 'EN')) } };
  }

  /** Log an unmapped province, at most once per (tenant, province) per hour per process. */
  private warnUnmapped(tenantId: number | null, province: string, nowMs = Date.now()): void {
    const key = `${tenantId}|${normalizeProvince(province) || province}`;
    const last = this.unmappedWarned.get(key);
    if (last !== undefined && nowMs - last < UNMAPPED_WARN_TTL_MS) return;
    if (this.unmappedWarned.size >= UNMAPPED_WARN_MAX) {
      for (const [k, at] of this.unmappedWarned) {
        if (nowMs - at >= UNMAPPED_WARN_TTL_MS) this.unmappedWarned.delete(k);
      }
      // Still full of fresh entries: forget the oldest rather than grow.
      if (this.unmappedWarned.size >= UNMAPPED_WARN_MAX) {
        const oldest = this.unmappedWarned.keys().next().value;
        if (oldest !== undefined) this.unmappedWarned.delete(oldest);
      }
    }
    this.unmappedWarned.set(key, nowMs);
    // One log line however the partner's value is written.
    const shown = province.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 80);
    this.logger.warn(`region routing: province "${shown}" is not in the table (tenant ${tenantId})`);
  }

  /**
   * The team question for this tenant in the customer's language, or null
   * when the tenant does not ask (PLN-261007 Team Routing). Malformed rows are
   * dropped rather than failing the handoff: a typo in the console must never
   * leave a customer unable to reach anyone. No usable row → null, i.e. the
   * pre-feature straight handoff.
   */
  async teamQuestion(tenantId: number | null, language: string): Promise<TeamQuestion | null> {
    const config = await this.aiConfig.getHandoffConfig(tenantId);
    const routing = config?.teamRouting;
    if (!routing?.enabled) return null;
    const rows = Array.isArray(routing.options) && routing.options.length ? routing.options : DEFAULT_TEAM_OPTIONS;
    const seen = new Set<string>();
    const options: TeamOption[] = [];
    for (const row of rows) {
      const id = String(row?.id ?? '').trim();
      const jobLabel = String(row?.jobLabel ?? '').trim();
      if (!id || !jobLabel || seen.has(id)) continue;
      seen.add(id);
      const builtIn = DEFAULT_TEAM_OPTIONS.find((d) => d.id === id);
      const label =
        localized(row.label, language).trim() || localized(builtIn?.label, language).trim() || id;
      options.push({ id, jobLabel, label });
      if (options.length >= TEAM_OPTIONS_MAX) break;
    }
    if (!options.length) return null;
    const prompt = localized(routing.prompt, language).trim() || localized(DEFAULT_TEAM_PROMPT, language);
    return { prompt, options };
  }

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

  async route(tenantId: number | null, language: string): Promise<HandoffRoute> {
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
