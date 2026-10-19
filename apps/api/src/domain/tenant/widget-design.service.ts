import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ICON_SLOTS, normalizeDesign, normalizeWidgetTheme, stripCustomCss, WidgetTheme } from '@sharptalk/types';
import { Tenant } from './entity/tenant.entity';
import { WIDGET_DESIGN_STATUS, WidgetDesignRow } from './entity/widget-design.entity';
import { WidgetDesignRevision } from './entity/widget-design-revision.entity';
import { TenantService } from './tenant.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { signFileUrl, verifyFileUrl } from '../../global/util/crypto.util';
import { CreateWidgetDesignRequest, UpdateWidgetDesignRequest } from './dto/request/tenant.request';
import { WidgetLiveService } from './widget-live.service';
import { TenantAssetService } from '../tenant-asset/tenant-asset.service';
import { WIDGET_DESIGN_STATUS as STATUS } from './entity/widget-design.entity';

const PREVIEW_TTL_SEC = 10 * 60;

/**
 * Custom widget library (PLN-260910 P3 D-12′): named designs a tenant keeps,
 * one of which may be live. "Live" is a pointer plus a copy of the design in
 * `tenants.widget_theme.design`, so nothing downstream (session/ensure, the
 * widget, the theme cache) learns a new contract. Reverting clears both.
 */
@Injectable()
export class WidgetDesignService {
  private readonly logger = new Logger(WidgetDesignService.name);

  constructor(
    @InjectRepository(WidgetDesignRow) private readonly repo: Repository<WidgetDesignRow>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(WidgetDesignRevision) private readonly revRepo: Repository<WidgetDesignRevision>,
    private readonly tenants: TenantService,
    private readonly audit: AuditService,
    private readonly live: WidgetLiveService,
    private readonly assets: TenantAssetService,
  ) {}

  async list(tenantId: number): Promise<{ items: WidgetDesignRow[]; activeId: number | null }> {
    const [items, tenant] = await Promise.all([
      this.repo.find({ where: { tenantId }, order: { updatedAt: 'DESC' } }),
      this.tenants.findById(tenantId),
    ]);
    return { items, activeId: tenant.activeWidgetDesignId ?? null };
  }

  async get(tenantId: number, id: number): Promise<WidgetDesignRow> {
    const row = await this.repo.findOne({ where: { id, tenantId } });
    if (!row) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    return row;
  }

  private async assertNameFree(tenantId: number, name: string, exceptId?: number): Promise<void> {
    const dup = await this.repo.findOne({ where: { tenantId, name } });
    if (dup && Number(dup.id) !== exceptId) {
      throw new BusinessException(ERROR_CODE.WIDGET_DESIGN_NAME_TAKEN, HttpStatus.BAD_REQUEST);
    }
  }

  /** Snake payload → verified, normalized design JSON (asset uuids checked like the theme card). */
  private async toDesignJson(tenantId: number, payload: CreateWidgetDesignRequest['design']) {
    const resolved = await this.tenants.resolveDesign(tenantId, payload);
    const design = normalizeDesign(resolved);
    if (!design) throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    return design;
  }

  async create(tenantId: number, dto: CreateWidgetDesignRequest, actorId: number): Promise<WidgetDesignRow> {
    const name = dto.name.trim();
    await this.assertNameFree(tenantId, name);
    const row = await this.repo.save(
      this.repo.create({
        tenantId,
        name,
        designJson: await this.toDesignJson(tenantId, dto.design),
        status: WIDGET_DESIGN_STATUS.READY,
        note: dto.note?.trim() || null,
        createdBy: actorId,
        updatedBy: null,
        appliedAt: null,
      }),
    );
    await this.write(tenantId, actorId, 'tenant.widget_design_created', row);
    return row;
  }

  async update(tenantId: number, id: number, dto: UpdateWidgetDesignRequest, actorId: number): Promise<WidgetDesignRow> {
    const row = await this.get(tenantId, id);
    // History: the design as it was before this edit (follow-up "변경 이력").
    // Only a design change earns a revision — restore puts back the design,
    // not the name, so a name-only revision would be one restore cannot use.
    if (dto.design !== undefined) await this.snapshot(row, actorId);
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      await this.assertNameFree(tenantId, name, Number(row.id));
      row.name = name;
    }
    if (dto.note !== undefined) row.note = dto.note?.trim() || null;
    if (dto.design !== undefined) row.designJson = await this.toDesignJson(tenantId, dto.design);
    row.updatedBy = actorId;
    const saved = await this.repo.save(row);
    // Editing the live design is live immediately — the console warns before
    // saving; the alternative (silent divergence) is worse.
    const tenant = await this.tenants.findById(tenantId);
    if (Number(tenant.activeWidgetDesignId) === Number(saved.id)) {
      await this.writeLive(tenant, saved.designJson);
    }
    await this.write(tenantId, actorId, 'tenant.widget_design_updated', saved);
    return saved;
  }

  /** Make this design the live widget (pointer + live copy). */
  async apply(tenantId: number, id: number, actorId: number): Promise<WidgetDesignRow> {
    const row = await this.get(tenantId, id);
    if (row.status === WIDGET_DESIGN_STATUS.ARCHIVED) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    const tenant = await this.tenants.findById(tenantId);
    tenant.activeWidgetDesignId = Number(row.id);
    await this.writeLive(tenant, row.designJson);
    row.appliedAt = new Date();
    const saved = await this.repo.save(row);
    await this.write(tenantId, actorId, 'tenant.widget_design_applied', saved);
    return saved;
  }

  /** Back to the basic widget: no design on the live theme, no pointer. */
  async revert(tenantId: number, actorId: number): Promise<void> {
    const tenant = await this.tenants.findById(tenantId);
    tenant.activeWidgetDesignId = null;
    await this.writeLive(tenant, null);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'tenant.widget_design_reverted',
      target: 'basic',
    });
  }

  async duplicate(tenantId: number, id: number, actorId: number): Promise<WidgetDesignRow> {
    const src = await this.get(tenantId, id);
    let name = `${src.name} (copy)`.slice(0, 64);
    for (let n = 2; await this.repo.findOne({ where: { tenantId, name } }); n += 1) {
      name = `${src.name} (copy ${n})`.slice(0, 64);
    }
    const row = await this.repo.save(
      this.repo.create({
        tenantId,
        name,
        designJson: src.designJson,
        status: WIDGET_DESIGN_STATUS.READY,
        note: src.note,
        createdBy: actorId,
        updatedBy: null,
        appliedAt: null,
      }),
    );
    await this.write(tenantId, actorId, 'tenant.widget_design_created', row);
    return row;
  }

  async setStatus(tenantId: number, id: number, status: string, actorId: number): Promise<WidgetDesignRow> {
    const row = await this.get(tenantId, id);
    if (status === WIDGET_DESIGN_STATUS.ARCHIVED) await this.assertNotActive(tenantId, row);
    row.status = status;
    row.updatedBy = actorId;
    const saved = await this.repo.save(row);
    await this.write(tenantId, actorId, `tenant.widget_design_${status}`, saved);
    return saved;
  }

  async remove(tenantId: number, id: number, actorId: number): Promise<void> {
    const row = await this.get(tenantId, id);
    await this.assertNotActive(tenantId, row);
    await this.repo.delete({ id: Number(row.id), tenantId });
    // History belongs to the design row; no FK, so cascade by hand (staging smoke left orphans).
    await this.revRepo.delete({ designId: Number(row.id), tenantId });
    await this.write(tenantId, actorId, 'tenant.widget_design_deleted', row);
  }

  // ---- history (follow-up) --------------------------------------------------

  async revisions(tenantId: number, id: number): Promise<WidgetDesignRevision[]> {
    await this.get(tenantId, id);
    return this.revRepo.find({ where: { tenantId, designId: id }, order: { revisionNo: 'DESC' }, take: 50 });
  }

  /** Copy a snapshot back over the design (the current state is snapshotted first, so restore is itself undoable). */
  async restoreRevision(tenantId: number, id: number, revisionId: number, actorId: number): Promise<WidgetDesignRow> {
    const row = await this.get(tenantId, id);
    const rev = await this.revRepo.findOne({ where: { id: revisionId, tenantId, designId: id } });
    if (!rev) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    await this.snapshot(row, actorId);
    row.designJson = rev.designJson;
    row.note = rev.note;
    row.updatedBy = actorId;
    const saved = await this.repo.save(row);
    const tenant = await this.tenants.findById(tenantId);
    if (Number(tenant.activeWidgetDesignId) === Number(saved.id)) await this.writeLive(tenant, saved.designJson);
    await this.write(tenantId, actorId, 'tenant.widget_design_restored', saved);
    return saved;
  }

  private async snapshot(row: WidgetDesignRow, actorId: number): Promise<void> {
    const last = await this.revRepo.findOne({ where: { designId: Number(row.id) }, order: { revisionNo: 'DESC' } });
    await this.revRepo.save(
      this.revRepo.create({
        tenantId: row.tenantId,
        designId: Number(row.id),
        revisionNo: (last?.revisionNo ?? 0) + 1,
        name: row.name,
        designJson: row.designJson,
        note: row.note,
        actorUserId: actorId,
      }),
    );
  }

  // ---- preview (D-15) ------------------------------------------------------

  /** Short-lived token the console's preview iframe passes as ?preview=. */
  async previewToken(tenantId: number, id: number): Promise<{ token: string; expiresAt: number }> {
    const row = await this.get(tenantId, id);
    const exp = Math.floor(Date.now() / 1000) + PREVIEW_TTL_SEC;
    const sig = signFileUrl(`preview:${tenantId}:${row.id}`, 'full', exp);
    return { token: `${tenantId}.${row.id}.${exp}.${sig}`, expiresAt: exp };
  }

  /** The theme the widget should paint for a preview token, or null when invalid/expired. */
  async previewTheme(token: string): Promise<WidgetTheme | null> {
    const [t, d, e, sig] = String(token).split('.');
    const tenantId = Number(t);
    const designId = Number(d);
    const exp = Number(e);
    if (!tenantId || !designId || !exp || !sig) return null;
    if (!verifyFileUrl(`preview:${tenantId}:${designId}`, 'full', exp, sig)) return null;
    const [tenant, row] = await Promise.all([
      this.tenantRepo.findOne({ where: { id: tenantId } }),
      this.repo.findOne({ where: { id: designId, tenantId } }),
    ]);
    if (!tenant || !row) return null;
    return stripCustomCss(
      normalizeWidgetTheme({ ...(tenant.widgetTheme ?? { brand: '#2B7FFF' }), design: row.designJson }),
      Number(tenant.customCssEnabled) === 1,
    );
  }

  // ---- package export / import (D-13, JSON instead of zip — no archive dependency) --

  static readonly PACKAGE_FORMAT = 'sharptalk-widget-design/1';

  async exportPackage(tenantId: number, id: number): Promise<Record<string, unknown>> {
    const row = await this.get(tenantId, id);
    const assets: Array<Record<string, unknown>> = [];
    const embed = async (role: string, ref: { uuid: string } | null | undefined) => {
      if (!ref) return;
      try {
        const a = await this.assets.get(tenantId, ref.uuid);
        const buf = await this.assets.readBuffer(a);
        assets.push({ role, kind: a.kind, filename: a.filename, label: a.label, mime: a.mime, base64: buf.toString('base64') });
      } catch (e) {
        this.logger.warn(`package export: asset ${ref.uuid} skipped — ${(e as Error).message}`);
      }
    };
    await embed('font', row.designJson.font?.asset);
    await embed('launcherIcon', row.designJson.launcherIcon);
    // Avatar slots (PLN-261019 P3) travel under their slot name.
    for (const slot of ICON_SLOTS) await embed(slot, row.designJson.icons?.[slot]);
    return {
      format: WidgetDesignService.PACKAGE_FORMAT,
      exportedAt: new Date().toISOString(),
      name: row.name,
      note: row.note,
      design: row.designJson,
      assets,
    };
  }

  /** Re-create the assets (content-validated like any upload), then the design as a new library row. */
  async importPackage(tenantId: number, buffer: Buffer, actorId: number): Promise<WidgetDesignRow> {
    let pkg: any;
    try {
      pkg = JSON.parse(buffer.toString('utf8'));
    } catch {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    if (pkg?.format !== WidgetDesignService.PACKAGE_FORMAT || typeof pkg.name !== 'string' || !pkg.design) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    const byRole = new Map<string, { uuid: string; version: number }>();
    for (const a of Array.isArray(pkg.assets) ? pkg.assets : []) {
      if (!a?.role || !a?.kind || typeof a.base64 !== 'string') continue;
      const stored = await this.assets.store(
        tenantId,
        { area: 'design', kind: String(a.kind), label: a.label ?? undefined },
        { originalname: String(a.filename ?? `${a.role}.bin`), mimetype: String(a.mime ?? ''), size: 0, buffer: Buffer.from(a.base64, 'base64') },
        { userId: actorId },
      );
      byRole.set(String(a.role), { uuid: stored.uuid, version: stored.version });
    }
    const d = pkg.design;
    const design = normalizeDesign({
      font: d.font
        ? { preset: d.font.preset, asset: d.font.preset === 'custom' ? byRole.get('font') ?? null : null, baseSize: d.font.baseSize }
        : null,
      radius: d.radius ?? null,
      panel: d.panel ?? null,
      launcherIcon: byRole.get('launcherIcon') ?? null,
      // Options without a file travel as-is (normalizeDesign re-checks every
      // enum). Custom CSS stays behind on purpose: it is sanitized per tenant
      // and delivered only under the add-on, so it is re-entered, not imported.
      quickReplyStyle: d.quickReplyStyle ?? null,
      reviewLinkTemplate: d.reviewLinkTemplate ?? null,
      headerLayout: d.headerLayout ?? null,
      messageStyle: d.messageStyle ?? null,
      attachIcon: d.attachIcon ?? null,
      icons: Object.fromEntries(ICON_SLOTS.map((slot) => [slot, byRole.get(slot) ?? null])),
    });
    if (!design) throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    let name = String(pkg.name).slice(0, 64);
    for (let n = 2; await this.repo.findOne({ where: { tenantId, name } }); n += 1) {
      name = `${String(pkg.name).slice(0, 56)} (${n})`;
    }
    const row = await this.repo.save(
      this.repo.create({
        tenantId,
        name,
        designJson: design,
        status: STATUS.READY,
        note: typeof pkg.note === 'string' ? pkg.note.slice(0, 255) : null,
        createdBy: actorId,
        updatedBy: null,
        appliedAt: null,
      }),
    );
    await this.write(tenantId, actorId, 'tenant.widget_design_imported', row);
    return row;
  }

  // ---- internals ----------------------------------------------------------

  private async assertNotActive(tenantId: number, row: WidgetDesignRow): Promise<void> {
    const tenant = await this.tenants.findById(tenantId);
    if (Number(tenant.activeWidgetDesignId) === Number(row.id)) {
      this.logger.warn(`widget design ${row.id} is live — archive/delete refused (tenant ${tenantId})`);
      throw new BusinessException(ERROR_CODE.WIDGET_DESIGN_ACTIVE, HttpStatus.BAD_REQUEST);
    }
  }

  /** Live copy: the theme card's basic fields + this design (or none). */
  private async writeLive(tenant: Tenant, design: WidgetDesignRow['designJson'] | null): Promise<void> {
    const base = tenant.widgetTheme ?? null;
    tenant.widgetTheme = base
      ? normalizeWidgetTheme({ ...base, design })
      : design
        ? normalizeWidgetTheme({ brand: '#2B7FFF', headerStyle: 'white', design })
        : null;
    await this.tenantRepo.save(tenant);
    await this.live.publish(tenant);
  }

  private async write(tenantId: number, actorId: number, action: string, row: WidgetDesignRow): Promise<void> {
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action,
      target: `widget_design:${row.id}`,
      metadata: { name: row.name, status: row.status },
    });
  }
}
