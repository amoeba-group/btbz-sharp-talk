import { AiEngine } from './entity/ai-engine.entity';
import { TenantAiSetting } from './entity/tenant-ai-setting.entity';
import type { AiSettingView } from './ai-setting.service';
import { engineHealth } from '../../infrastructure/external/ai/engine-health';

/** Entity -> camelCase response mapping. NEVER exposes encrypted API keys. */
export class AiEngineMapper {
  /** Full catalog entry (admin view) — masks the key as a boolean flag. */
  static toEngine(e: AiEngine) {
    return {
      id: e.id,
      tenantId: e.tenantId ?? null,
      provider: e.provider,
      name: e.name,
      model: e.model,
      endpoint: e.endpoint ?? null,
      hasKey: e.apiKeyEncrypted != null,
      capabilities: e.capabilities,
      status: e.status,
      isDefault: e.isDefault,
      tenantSelectable: e.tenantSelectable === 1,
      ...this.healthOf(e),
      createdAt: e.createdAt,
    };
  }

  static toEngineList(engines: AiEngine[]) {
    return engines.map((e) => this.toEngine(e));
  }

  /**
   * Last observed health (PLN-261007). `lastErrorDetail` is the provider's own
   * wording, already secret-redacted where it was produced; the key itself is
   * never part of it.
   */
  static healthOf(e: AiEngine) {
    return {
      health: engineHealth({
        provider: e.provider,
        status: e.status,
        hasKey: e.apiKeyEncrypted != null,
        lastOkAt: e.lastOkAt ?? null,
        lastErrorAt: e.lastErrorAt ?? null,
        lastErrorReason: e.lastErrorReason ?? null,
      }),
      lastOkAt: e.lastOkAt ?? null,
      lastErrorAt: e.lastErrorAt ?? null,
      lastErrorReason: e.lastErrorReason ?? null,
      lastErrorDetail: e.lastErrorDetail ?? null,
    };
  }

  /** Admin catalog row: the engine plus whose it is and today's traffic. */
  static toAdminEngine(
    e: AiEngine,
    tenantSlug: string | null,
    today: { calls: number; failures: number } | undefined,
  ) {
    return {
      ...this.toEngine(e),
      tenantSlug,
      todayCalls: today?.calls ?? 0,
      todayFailures: today?.failures ?? 0,
    };
  }

  /** Compact engine descriptor used in the tenant settings chooser. */
  static toEngineOption(e: AiEngine) {
    return {
      id: e.id,
      provider: e.provider,
      name: e.name,
      model: e.model,
    };
  }

  static toEngineOptionList(engines: AiEngine[]) {
    return engines.map((e) => this.toEngineOption(e));
  }

  /** Tenant function->engine mapping, joined with the engine name. */
  static toSetting(s: TenantAiSetting, engineName: string | null) {
    return {
      function: s.func,
      engineId: s.engineId,
      engineName,
      params: s.paramsJson ?? null,
    };
  }

  /**
   * A console row for one AI function. `engineId` stays null when the tenant
   * never chose one — the Select must show "unset" rather than pre-selecting an
   * inherited engine, or saving the form would silently pin the inheritance in
   * place. The effective fields describe what runs meanwhile.
   */
  static toSettingView(v: AiSettingView) {
    return {
      function: v.func,
      engineId: v.setting?.engineId ?? null,
      engineName: v.setting ? v.effectiveEngineName : null,
      params: v.setting?.paramsJson ?? null,
      effectiveEngineId: v.effectiveEngineId,
      effectiveEngineName: v.effectiveEngineName,
      effectiveProvider: v.effectiveProvider,
      source: v.source,
      inheritedFrom: v.inheritedFrom ?? null,
    };
  }

  /**
   * Tenant-facing engine shape (PLN-260824).
   *
   * The key never leaves as plaintext — only whether one is stored and its last
   * four characters, which is enough to tell two keys apart when rotating and
   * useless to anyone who reads the response.
   */
  static toTenantEngine(e: AiEngine) {
    return {
      id: String(e.id),
      name: e.name,
      provider: e.provider,
      model: e.model,
      endpoint: e.endpoint,
      status: e.status,
      isDefault: e.isDefault === 1,
      hasApiKey: !!e.apiKeyEncrypted,
      /** Read-only here: platform engines are the admin's to change. */
      platform: e.tenantId == null,
      /**
       * May this tenant apply it (PLN-261007 D1): its own enabled engine, or a
       * platform engine the operator opened for selection. Never the stub.
       */
      selectable:
        e.provider !== 'stub' &&
        e.status === 'enabled' &&
        (e.tenantId != null || e.tenantSelectable === 1),
      ...this.healthOf(e),
    };
  }

  static toTenantEngineList(rows: AiEngine[]) {
    return rows.map((e) => this.toTenantEngine(e));
  }
}
