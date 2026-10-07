import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AiEngine } from '../../../domain/ai-engine/entity/ai-engine.entity';
import { TenantAiSetting } from '../../../domain/ai-engine/entity/tenant-ai-setting.entity';
import { Tenant } from '../../../domain/tenant/entity/tenant.entity';
import { AiUsageService } from '../../../domain/ai-engine/ai-usage.service';
import { RedisService } from '../../cache/redis.service';
import { MailerService } from '../mailer.service';

/** One alert per engine per this window while the outage lasts (PLN-261007-AI-Credit-Alert D2). */
export const CREDIT_ALERT_TTL_SEC = 6 * 60 * 60;
const DEFAULT_RECIPIENT = 'dev@amoeba.group';

export interface CreditAlertFacts {
  env: string;
  consoleUrl: string | null;
  engineName: string;
  provider: string;
  model: string;
  /** null = platform engine. */
  tenantSlug: string | null;
  isSystemDefault: boolean;
  detectedAt: Date;
  todayFailures: number;
  detail: string;
  /** Platform engines: tenants pinned to it explicitly. */
  affectedTenants: string[];
}

const fmt = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

/**
 * The credit-shortage mail (pure). Written for the operator: what broke, who
 * is affected, and the one thing to do — switch the tenant to the system
 * default engine, or top up the platform key when the default itself is dry.
 * No API key and no customer text ever goes in; `detail` is the provider's
 * own message, already secret-redacted where it was produced.
 */
export function creditAlertMail(f: CreditAlertFacts): { subject: string; text: string } {
  const owner = f.tenantSlug ? `테넌트 ${f.tenantSlug} (자체 법인 엔진)` : f.isSystemDefault ? '시스템 기본 엔진' : '플랫폼 엔진';
  const subject = `[SharpTalk ${f.env}] AI 크레딧 부족 — ${f.tenantSlug ?? (f.isSystemDefault ? '시스템 기본 엔진' : '플랫폼')} · ${f.engineName}`;
  const settings = f.consoleUrl ? `${f.consoleUrl}/settings/basic` : '콘솔 › 설정 › 기본';
  const admin = f.consoleUrl ? `${f.consoleUrl}/admin/ai-engines` : '어드민 › AI 엔진';
  const action = f.tenantSlug
    ? [
        '조치 (둘 중 하나):',
        `  1) 시스템 기본 엔진으로 전환 — ${settings} › AI 엔진 › [시스템 기본 엔진으로 전환]`,
        '     (테넌트 콘솔 로그인 필요. 사용료는 운영자 키로 청구됩니다)',
        '  2) 해당 프로바이더 계정 충전 — 예: Anthropic Console › Plans & Billing',
      ]
    : [
        '조치:',
        '  플랫폼 키의 크레딧을 충전하세요 — 예: Anthropic Console › Plans & Billing',
        '  (시스템 기본 엔진이 멈추면 전환할 곳이 없습니다)',
        `  상태 확인: ${admin}`,
        f.affectedTenants.length
          ? `  이 엔진을 지정한 테넌트: ${f.affectedTenants.join(', ')}`
          : '  이 엔진을 직접 지정한 테넌트는 없습니다.',
        ...(f.isSystemDefault ? ['  엔진을 지정하지 않은 기능은 모두 이 엔진을 씁니다.'] : []),
      ];
  const text = [
    `AI 엔진의 크레딧이 부족해 답변이 만들어지지 않고 있습니다.`,
    '',
    `환경        : ${f.env}`,
    `엔진        : ${f.engineName} (${f.provider} / ${f.model})`,
    `소유        : ${owner}`,
    `감지 시각   : ${fmt(f.detectedAt)}`,
    `오늘 실패 수: ${f.todayFailures}`,
    `프로바이더  : ${f.detail}`,
    '',
    '영향: 이 엔진을 쓰는 고객 응답은 상담원 연결로 넘어가고 있습니다(자동 응답 중단).',
    '',
    ...action,
    '',
    `같은 엔진에 대해서는 ${CREDIT_ALERT_TTL_SEC / 3600}시간마다 한 번만 다시 알립니다. 복구되면 복구 메일을 보냅니다.`,
  ].join('\n');
  return { subject, text };
}

export function creditRecoveredMail(f: {
  env: string;
  engineName: string;
  tenantSlug: string | null;
  isSystemDefault: boolean;
  since: Date | null;
  recoveredAt: Date;
}): { subject: string; text: string } {
  const who = f.tenantSlug ?? (f.isSystemDefault ? '시스템 기본 엔진' : '플랫폼');
  const mins = f.since ? Math.max(1, Math.round((f.recoveredAt.getTime() - f.since.getTime()) / 60_000)) : null;
  return {
    subject: `[SharpTalk ${f.env}] AI 크레딧 복구 — ${who} · ${f.engineName}`,
    text: [
      `${f.engineName} 엔진이 다시 응답하고 있습니다.`,
      '',
      `복구 시각: ${fmt(f.recoveredAt)}`,
      ...(f.since ? [`최초 알림: ${fmt(f.since)} (약 ${mins}분)`] : []),
      '',
      '시스템 기본 엔진으로 임시 전환했다면, 필요할 때 콘솔에서 원래 엔진으로 되돌리세요.',
    ].join('\n'),
  };
}

/**
 * Mails the operator when an engine runs out of credit, and once more when it
 * recovers (PLN-261007-AI-Credit-Alert). Called fire-and-forget from the
 * gateway: nothing here may delay or fail a customer's turn.
 */
@Injectable()
export class AiCreditAlertService {
  private readonly logger = new Logger(AiCreditAlertService.name);
  /** Fallback when Redis is down: engineId → alert time. A restart may send one extra mail. */
  private readonly memory = new Map<number, number>();

  constructor(
    @InjectRepository(AiEngine) private readonly engineRepo: Repository<AiEngine>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(TenantAiSetting) private readonly settingRepo: Repository<TenantAiSetting>,
    private readonly usage: AiUsageService,
    private readonly redis: RedisService,
    private readonly mailer: MailerService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  private key(engineId: number): string {
    return `ai:credit-alert:${engineId}`;
  }

  private recipient(): string {
    return process.env.AI_ALERT_EMAIL?.trim() || DEFAULT_RECIPIENT;
  }

  private env(): string {
    return process.env.NODE_ENV || 'development';
  }

  /** Claim the alert slot for this engine; false = already alerted inside the window. */
  private async claim(engineId: number, now: Date): Promise<boolean> {
    const viaRedis = await this.redis.setIfAbsent(this.key(engineId), now.toISOString(), CREDIT_ALERT_TTL_SEC);
    if (viaRedis !== null) {
      if (viaRedis) this.memory.set(engineId, now.getTime());
      return viaRedis;
    }
    const last = this.memory.get(engineId);
    if (last && now.getTime() - last < CREDIT_ALERT_TTL_SEC * 1000) return false;
    this.memory.set(engineId, now.getTime());
    return true;
  }

  async onCredit(engineId: number, detail: string, now = new Date()): Promise<void> {
    try {
      if (!(await this.claim(engineId, now))) return;
      const engine = await this.engineRepo.findOne({ where: { id: engineId } });
      if (!engine) return;
      const tenant =
        engine.tenantId != null
          ? await this.tenantRepo.findOne({ where: { id: Number(engine.tenantId) }, select: { id: true, slug: true } })
          : null;
      let affected: string[] = [];
      if (engine.tenantId == null) {
        const rows = await this.settingRepo.find({ where: { engineId: Number(engine.id) }, select: { tenantId: true } });
        const ids = [...new Set(rows.map((r) => Number(r.tenantId)))];
        affected = ids.length
          ? (await this.tenantRepo.find({ where: { id: In(ids) }, select: { id: true, slug: true } })).map((t) => t.slug)
          : [];
      }
      const today = await this.usage.todayByEngine(now);
      const mail = creditAlertMail({
        env: this.env(),
        consoleUrl: this.config?.get<string>('APP_PUBLIC_URL') ?? process.env.APP_PUBLIC_URL ?? null,
        engineName: engine.name,
        provider: engine.provider,
        model: engine.model,
        tenantSlug: tenant?.slug ?? (engine.tenantId != null ? `#${engine.tenantId}` : null),
        isSystemDefault: engine.tenantId == null && engine.isDefault === 1,
        detectedAt: now,
        todayFailures: today.get(Number(engine.id))?.failures ?? 0,
        detail: detail.slice(0, 300),
        affectedTenants: affected,
      });
      const sent = await this.mailer.send({ to: this.recipient(), ...mail });
      this.logger.warn(`credit alert for engine ${engineId} ${sent ? 'mailed' : 'NOT mailed'} to ${this.recipient()}`);
    } catch (e) {
      this.logger.warn(`credit alert failed for engine ${engineId}: ${(e as Error).message}`);
    }
  }

  /** First success after an alert: clear the slot and send the recovery mail (D3). */
  async onRecovered(engineId: number, now = new Date()): Promise<void> {
    try {
      let since: string | null = null;
      if (this.redis.available()) {
        since = await this.redis.get(this.key(engineId));
        if (!since) {
          this.memory.delete(engineId);
          return;
        }
        await this.redis.del(this.key(engineId));
      } else {
        const t = this.memory.get(engineId);
        if (!t) return;
        since = new Date(t).toISOString();
      }
      this.memory.delete(engineId);
      const engine = await this.engineRepo.findOne({ where: { id: engineId } });
      if (!engine) return;
      const tenant =
        engine.tenantId != null
          ? await this.tenantRepo.findOne({ where: { id: Number(engine.tenantId) }, select: { id: true, slug: true } })
          : null;
      const mail = creditRecoveredMail({
        env: this.env(),
        engineName: engine.name,
        tenantSlug: tenant?.slug ?? (engine.tenantId != null ? `#${engine.tenantId}` : null),
        isSystemDefault: engine.tenantId == null && engine.isDefault === 1,
        since: since ? new Date(since) : null,
        recoveredAt: now,
      });
      await this.mailer.send({ to: this.recipient(), ...mail });
      this.logger.log(`credit recovery mailed for engine ${engineId}`);
    } catch (e) {
      this.logger.warn(`credit recovery mail failed for engine ${engineId}: ${(e as Error).message}`);
    }
  }
}
