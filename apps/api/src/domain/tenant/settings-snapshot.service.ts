import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { normalizeWidgetTheme } from '@sharptalk/types';
import { Tenant } from './entity/tenant.entity';
import { WidgetDesignRow, WIDGET_DESIGN_STATUS } from './entity/widget-design.entity';
import { TenantService } from './tenant.service';
import { WidgetLiveService } from './widget-live.service';
import { TenantAssetService } from '../tenant-asset/tenant-asset.service';
import { TenantAsset, TENANT_ASSET_AREA, TENANT_ASSET_KIND } from '../tenant-asset/entity/tenant-asset.entity';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

export const SNAPSHOT_FORMAT = 'sharptalk-tenant-settings/1';

/** Exactly what a snapshot carries — never credentials or secrets (REQ SI-8). */
const FIELDS = [
  'widgetTheme',
  'widgetCopy',
  'widgetTabs',
  'widgetTabPosition',
  'widgetLoginMode',
  'notificationChannels',
  'embedOrigins',
  'usageGuidesEnabled',
  'commerceEnabled',
  'timezone',
  'defaultLanguage',
  'storefrontUrl',
  'privacyPolicyUrl',
  'consentNoticeVersion',
] as const;
type Field = (typeof FIELDS)[number];

export interface SnapshotBody {
  format: string;
  createdAt: string;
  tenantSlug: string | null;
  settings: Partial<Record<Field, unknown>>;
  widgetDesigns: Array<{ name: string; note: string | null; status: string; design: unknown; active: boolean }>;
}

/**
 * Tenant settings snapshots (PLN-260910 P4 D-8): the whitelisted settings and
 * the custom-widget library as one JSON file in `tenants/{id}/settings/`.
 * Restore shows a field diff first and then writes the same fields back —
 * a backup that survives deployments and can move between environments.
 */
@Injectable()
export class SettingsSnapshotService {
  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(WidgetDesignRow) private readonly designRepo: Repository<WidgetDesignRow>,
    private readonly tenants: TenantService,
    private readonly assets: TenantAssetService,
    private readonly live: WidgetLiveService,
    private readonly audit: AuditService,
  ) {}

  async build(tenantId: number): Promise<SnapshotBody> {
    const tenant = await this.tenants.findById(tenantId);
    const designs = await this.designRepo.find({ where: { tenantId }, order: { name: 'ASC' } });
    const settings: Partial<Record<Field, unknown>> = {};
    for (const f of FIELDS) settings[f] = (tenant as unknown as Record<string, unknown>)[f] ?? null;
    return {
      format: SNAPSHOT_FORMAT,
      createdAt: new Date().toISOString(),
      tenantSlug: tenant.slug ?? null,
      settings,
      widgetDesigns: designs.map((d) => ({
        name: d.name,
        note: d.note,
        status: d.status,
        design: d.designJson,
        active: Number(tenant.activeWidgetDesignId) === Number(d.id),
      })),
    };
  }

  async create(tenantId: number, label: string | undefined, actorId: number): Promise<TenantAsset> {
    const body = await this.build(tenantId);
    const stamp = body.createdAt.replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
    return this.assets.storeGenerated(
      tenantId,
      {
        area: TENANT_ASSET_AREA.SETTINGS,
        kind: TENANT_ASSET_KIND.SETTINGS_SNAPSHOT,
        filename: `settings-${stamp}.json`,
        mime: 'application/json',
        ext: 'json',
        label,
      },
      Buffer.from(JSON.stringify(body, null, 2)),
      { userId: actorId },
    );
  }

  list(tenantId: number) {
    return this.assets.list(tenantId, { area: TENANT_ASSET_AREA.SETTINGS, kind: TENANT_ASSET_KIND.SETTINGS_SNAPSHOT });
  }

  private async load(tenantId: number, uuid: string): Promise<{ row: TenantAsset; body: SnapshotBody }> {
    const row = await this.assets.get(tenantId, uuid);
    if (row.kind !== TENANT_ASSET_KIND.SETTINGS_SNAPSHOT) {
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    let body: SnapshotBody;
    try {
      body = JSON.parse((await this.assets.readBuffer(row)).toString('utf8'));
    } catch {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    if (body?.format !== SNAPSHOT_FORMAT || !body.settings) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    return { row, body };
  }

  /** Field-by-field comparison the console shows before a restore. */
  async diff(tenantId: number, uuid: string) {
    const { body } = await this.load(tenantId, uuid);
    const current = await this.build(tenantId);
    const fields = FIELDS.map((f) => ({
      field: f,
      current: current.settings[f] ?? null,
      snapshot: body.settings[f] ?? null,
      changed: JSON.stringify(current.settings[f] ?? null) !== JSON.stringify(body.settings[f] ?? null),
    }));
    const currentNames = new Set(current.widgetDesigns.map((d) => d.name));
    const designs = (body.widgetDesigns ?? []).map((d) => ({
      name: d.name,
      action: currentNames.has(d.name) ? 'update' : 'create',
      active: d.active,
    }));
    return { createdAt: body.createdAt, fields, designs };
  }

  /** Write the whitelisted fields back and upsert the design library by name. */
  async restore(tenantId: number, uuid: string, actorId: number): Promise<void> {
    const { body } = await this.load(tenantId, uuid);
    const tenant = await this.tenants.findById(tenantId);
    const t = tenant as unknown as Record<string, unknown>;
    for (const f of FIELDS) {
      if (!(f in body.settings)) continue;
      t[f] = f === 'widgetTheme' ? normalizeWidgetTheme(body.settings[f]) : body.settings[f];
    }
    let activeId: number | null = null;
    for (const d of body.widgetDesigns ?? []) {
      if (!d?.name || !d.design) continue;
      const existing = await this.designRepo.findOne({ where: { tenantId, name: d.name } });
      const row = existing ?? this.designRepo.create({ tenantId, name: d.name, createdBy: actorId, appliedAt: null });
      row.designJson = d.design as WidgetDesignRow['designJson'];
      row.note = d.note ?? null;
      row.status = d.status === WIDGET_DESIGN_STATUS.ARCHIVED ? WIDGET_DESIGN_STATUS.ARCHIVED : WIDGET_DESIGN_STATUS.READY;
      row.updatedBy = actorId;
      const saved = await this.designRepo.save(row);
      if (d.active) activeId = Number(saved.id);
    }
    tenant.activeWidgetDesignId = activeId;
    await this.tenantRepo.save(tenant);
    await this.live.publish(tenant);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'tenant.settings_restored',
      target: `settings_snapshot:${uuid}`,
      metadata: { createdAt: body.createdAt, fields: FIELDS.length, designs: (body.widgetDesigns ?? []).length },
    });
  }

  remove(tenantId: number, uuid: string, actorId: number) {
    return this.assets.remove(tenantId, uuid, { userId: actorId });
  }
}
