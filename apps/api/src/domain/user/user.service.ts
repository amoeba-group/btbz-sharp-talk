import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { generateToken } from '@sharptalk/common';
import { JOB_LABEL, canonicalRegion, isRegionCode, provinceKey } from '@sharptalk/types';
import { User } from './entity/user.entity';
import { JobLabel } from './entity/job-label.entity';
import { UserJobLabel } from './entity/user-job-label.entity';
import { Unit } from './entity/unit.entity';
import { Invitation } from './entity/invitation.entity';
import { TenantAiConfig } from '../ai-engine/entity/tenant-ai-config.entity';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import {
  InviteUserResponse,
  JobLabelMapper,
  JobLabelResponse,
  UnitMapper,
  UnitResponse,
  UserMapper,
  UserResponse,
} from './dto/response/user.response';

import { BCRYPT_ROUNDS } from '../../global/constant/security.constant';
import { generateTempPassword, validatePassword } from '../../global/util/password-policy.util';
import { buildTempPasswordMail } from '../../global/util/temp-password-mail.util';
import { AuditService } from '../audit/audit.service';
import { maskPii } from '../../global/util/pii.util';
import { LoginRateLimitService } from '../auth/login-rate-limit.service';
import { MailerService } from '../../infrastructure/infrastructure.module';
import { TenantService } from '../tenant/tenant.service';
import { ConfigService } from '@nestjs/config';
const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * Tenant user / staff management (FR-052, FR-055, FR-063). Invitations,
 * rank/label/status adjustments and editable job labels — all tenant-scoped.
 */
@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(JobLabel) private readonly labelRepo: Repository<JobLabel>,
    @InjectRepository(UserJobLabel) private readonly userLabelRepo: Repository<UserJobLabel>,
    @InjectRepository(Invitation) private readonly invitationRepo: Repository<Invitation>,
    private readonly audit: AuditService,
    private readonly loginLimiter: LoginRateLimitService,
    private readonly mailer: MailerService,
    private readonly tenantService: TenantService,
    private readonly config: ConfigService,
    // Last on purpose: existing specs construct the service positionally.
    @InjectRepository(Unit) private readonly unitRepo: Repository<Unit>,
    // Read-only: delete refuses a unit/label a routing or deny rule still names.
    @InjectRepository(TenantAiConfig) private readonly aiConfigRepo: Repository<TenantAiConfig>,
  ) {}

  // ---- Users ----

  async listUsers(
    tenantId: number,
    page: number,
    size: number,
  ): Promise<{ items: UserResponse[]; total: number }> {
    const [users, total] = await this.userRepo.findAndCount({
      where: { tenantId },
      order: { id: 'ASC' },
      skip: (page - 1) * size,
      take: size,
    });

    const labelsByUser = await this.loadLabelCodes(users.map((u) => u.id));
    const unitsById = await this.loadUnits(users.map((u) => u.unitId));
    const items = users.map((u) =>
      UserMapper.toResponse(u, labelsByUser.get(String(u.id)) ?? [], unitsById.get(String(u.unitId)) ?? null),
    );
    return { items, total };
  }

  async invite(
    tenantId: number,
    invitedBy: number,
    email: string,
    rank: string,
    labelCodes: string[] = [],
    actorType: 'user' | 'admin' = 'user',
    unitId: number | null = null,
  ): Promise<InviteUserResponse> {
    const existing = await this.userRepo.findOne({ where: { tenantId, email } });
    if (existing) {
      throw new BusinessException(ERROR_CODE.EMAIL_TAKEN, HttpStatus.CONFLICT);
    }
    // Resolve before the user row exists: a bad unit id must not leave a half-made invite.
    const unit = unitId != null ? await this.getTenantUnit(tenantId, unitId) : null;

    const now = new Date();
    const tempPassword = this.genTempPassword();
    const tempPasswordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

    const user = await this.userRepo.save(
      this.userRepo.create({
        tenantId,
        email,
        passwordHash: tempPasswordHash,
        rank,
        status: 'invited',
        mustChangePassword: 1,
        invitedAt: now,
        unitId: unit ? unit.id : null,
      }),
    );

    const token = generateToken();
    await this.invitationRepo.save(
      this.invitationRepo.create({
        tenantId,
        email,
        rank,
        token,
        tempPasswordHash,
        status: 'pending',
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        createdBy: invitedBy,
      }),
    );

    await this.assignLabels(tenantId, user.id, labelCodes);

    // Temp-password issuance is a privileged action (PRV-H4) — the plaintext is
    // returned once to the inviter; the audit row records who triggered it.
    await this.audit.write({
      tenantId,
      actorType,
      actorId: invitedBy,
      action: 'user.invited',
      target: `user:${user.id} ${maskPii(email)}`,
    });

    return { invitationToken: token, tempPassword, userId: user.id };
  }

  /**
   * Issue a fresh temporary password for an existing user (FR-063 / POL-018).
   * Besides the email-invitation flow, this lets an admin generate a temp password
   * and hand it to the user out-of-band. The user must change it on first login.
   * Returns the plaintext ONCE so the admin can relay it manually.
   */
  async issueTempPassword(
    tenantId: number,
    userId: number,
    issuedBy: number,
    actorType: 'user' | 'admin' = 'user',
    opts?: { sendEmail?: boolean },
  ): Promise<{ userId: number; email: string; tempPassword: string; emailSent?: boolean }> {
    const user = await this.getTenantUser(tenantId, userId);
    const tempPassword = this.genTempPassword();
    user.passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    user.mustChangePassword = 1;
    await this.userRepo.save(user);
    await this.loginLimiter.clearAccountLock('user', user.email);
    await this.audit.write({
      tenantId,
      actorType,
      actorId: issuedBy,
      action: 'user.temp_password_issued',
      target: `user:${user.id} ${maskPii(user.email)}`,
    });
    if (!opts?.sendEmail) {
      return { userId: user.id, email: user.email, tempPassword };
    }
    // Email delivery is best-effort (PLN-260824 S4): the plaintext is still
    // returned so the admin can fall back to manual hand-off when it fails.
    let emailSent = false;
    if (this.mailer.configured()) {
      const tenant = await this.tenantService.findById(tenantId);
      emailSent = await this.mailer.send(
        buildTempPasswordMail(
          this.config.get<string>('APP_PUBLIC_URL'),
          `/user/${tenant.slug}`,
          user.email,
          tempPassword,
        ),
      );
    }
    if (!emailSent) {
      this.logger.warn(`Temp-password mail not delivered (tenant ${tenantId}, user ${user.id})`);
    }
    return { userId: user.id, email: user.email, tempPassword, emailSent };
  }

  async acceptInvite(token: string, newPassword: string): Promise<{ accepted: true }> {
    const invitation = await this.invitationRepo.findOne({ where: { token } });
    if (
      !invitation ||
      invitation.status !== 'pending' ||
      !invitation.expiresAt ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      throw new BusinessException(ERROR_CODE.INVITATION_INVALID, HttpStatus.BAD_REQUEST);
    }

    const user = await this.userRepo.findOne({
      where: { tenantId: invitation.tenantId, email: invitation.email },
    });
    if (!user) {
      throw new BusinessException(ERROR_CODE.INVITATION_INVALID, HttpStatus.BAD_REQUEST);
    }

    // Service-layer double enforcement (DTO validation can be bypassed) with
    // identity context; failures are E1009 + warn (4xx are not logged by default).
    const policy = validatePassword(newPassword, { email: user.email, name: user.name });
    if (!policy.ok) {
      this.logger.warn(
        `accept-invite password rejected by policy [${policy.failed.join(', ')}] for ${maskPii(user.email)}`,
      );
      throw new BusinessException(ERROR_CODE.PASSWORD_POLICY_VIOLATION, HttpStatus.BAD_REQUEST, {
        password: policy.failed,
      });
    }

    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    user.status = 'active';
    user.mustChangePassword = 0;
    await this.userRepo.save(user);

    invitation.status = 'accepted';
    await this.invitationRepo.save(invitation);

    return { accepted: true };
  }

  async updateRank(tenantId: number, userId: number, rank: string): Promise<UserResponse> {
    const user = await this.getTenantUser(tenantId, userId);
    user.rank = rank;
    await this.userRepo.save(user);
    return this.toResponseWithLabels(user);
  }

  async updateLabels(
    tenantId: number,
    userId: number,
    labelCodes: string[],
  ): Promise<UserResponse> {
    const user = await this.getTenantUser(tenantId, userId);
    this.logger.log(
      `updateLabels tenant=${tenantId} user=${userId} codes=[${(labelCodes ?? []).join(',')}]`,
    );
    await this.userLabelRepo.delete({ userId: user.id });
    await this.assignLabels(tenantId, user.id, labelCodes);
    return this.toResponseWithLabels(user);
  }

  /** Move a user to a unit, or out of any (`unitId` null). PLN-261019 P1. */
  async updateUnit(
    tenantId: number,
    userId: number,
    unitId: number | null,
    actorId: number,
    actorType: 'user' | 'admin' = 'user',
  ): Promise<UserResponse> {
    const user = await this.getTenantUser(tenantId, userId);
    const unit = unitId != null ? await this.getTenantUnit(tenantId, unitId) : null;
    user.unitId = unit ? unit.id : null;
    await this.userRepo.save(user);
    await this.audit.write({
      tenantId,
      actorType,
      actorId,
      action: 'user.unit_changed',
      target: `user:${user.id} unit:${unit ? unit.code : '-'}`,
    });
    return this.toResponseWithLabels(user);
  }

  async updateStatus(tenantId: number, userId: number, status: string): Promise<UserResponse> {
    const user = await this.getTenantUser(tenantId, userId);
    user.status = status;
    await this.userRepo.save(user);
    return this.toResponseWithLabels(user);
  }

  // ---- Job labels ----

  async listLabels(tenantId: number): Promise<JobLabelResponse[]> {
    const labels = await this.labelRepo.find({ where: { tenantId }, order: { id: 'ASC' } });
    const counts = new Map<string, number>();
    if (labels.length) {
      const links = await this.userLabelRepo.find({ where: { jobLabelId: In(labels.map((l) => l.id)) } });
      for (const l of links) counts.set(String(l.jobLabelId), (counts.get(String(l.jobLabelId)) ?? 0) + 1);
    }
    return labels.map((l) => JobLabelMapper.toResponse(l, counts.get(String(l.id)) ?? 0));
  }

  async createLabel(tenantId: number, code: string, name: string): Promise<JobLabelResponse> {
    const existing = await this.labelRepo.findOne({ where: { tenantId, code } });
    if (existing) {
      throw new BusinessException(ERROR_CODE.DUPLICATE_RESOURCE, HttpStatus.CONFLICT);
    }
    const label = await this.labelRepo.save(this.labelRepo.create({ tenantId, code, name }));
    return JobLabelMapper.toResponse(label);
  }

  /** Rename a label and/or set the places it covers (PLN-261022 stage 1); an omitted field is left alone. */
  async updateLabel(
    tenantId: number,
    id: number,
    name?: string,
    scope?: RegionScopeInput,
    actorId?: number,
  ): Promise<JobLabelResponse> {
    const label = await this.labelRepo.findOne({ where: { id, tenantId } });
    if (!label) {
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    if (name !== undefined) label.name = name;
    const scopeChanged = applyRegionScope(label, scope);
    await this.labelRepo.save(label);
    if (scopeChanged && actorId != null) {
      await this.audit.write({
        tenantId,
        actorType: 'user',
        actorId,
        action: 'label.scope_changed',
        target: `label:${label.id} ${label.code}`,
        metadata: { regions: label.regions, provinces: label.provinces },
      });
    }
    return JobLabelMapper.toResponse(label);
  }

  /**
   * Delete a job label and release its holders (PLN-261021-Users-Labels-Units-Delete).
   * The permission codes are refused (D1), as is a label a rule still routes on (D2) —
   * the rule's group would resolve to nobody and hand off to the next rule silently.
   */
  async deleteLabel(tenantId: number, actorId: number, id: number): Promise<{ released: number }> {
    const label = await this.labelRepo.findOne({ where: { id, tenantId } });
    if (!label) {
      this.logger.warn(`deleteLabel tenant=${tenantId}: label ${id} not found`);
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    if ((Object.values(JOB_LABEL) as string[]).includes(label.code)) {
      this.logger.warn(`deleteLabel tenant=${tenantId}: '${label.code}' is permission-linked`);
      throw new BusinessException(ERROR_CODE.LABEL_PROTECTED, HttpStatus.CONFLICT);
    }
    await this.refuseIfRuleUses(tenantId, { labelCode: label.code });
    const released = await this.labelRepo.manager.transaction(async (m) => {
      const links = await m.delete(UserJobLabel, { jobLabelId: label.id });
      await m.delete(JobLabel, { id: label.id, tenantId });
      return links.affected ?? 0;
    });
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'label.deleted',
      target: `label:${label.id} ${label.code}`,
      metadata: { name: label.name, released },
    });
    return { released };
  }

  // ---- Units (teams) — PLN-261019 P1 ----

  async listUnits(tenantId: number): Promise<UnitResponse[]> {
    const units = await this.unitRepo.find({ where: { tenantId }, order: { sortOrder: 'ASC', id: 'ASC' } });
    const counts = new Map<string, number>();
    if (units.length) {
      const members = await this.userRepo.find({ where: { tenantId, unitId: In(units.map((u) => u.id)) } });
      for (const u of members) counts.set(String(u.unitId), (counts.get(String(u.unitId)) ?? 0) + 1);
    }
    return units.map((u) => UnitMapper.toResponse(u, counts.get(String(u.id)) ?? 0));
  }

  async createUnit(tenantId: number, actorId: number, code: string, name: string): Promise<UnitResponse> {
    const existing = await this.unitRepo.findOne({ where: { tenantId, code } });
    if (existing) {
      this.logger.warn(`createUnit tenant=${tenantId}: code '${code}' already exists`);
      throw new BusinessException(ERROR_CODE.DUPLICATE_RESOURCE, HttpStatus.CONFLICT);
    }
    // Appended after the current last row so the console order is creation order.
    const last = await this.unitRepo.findOne({ where: { tenantId }, order: { sortOrder: 'DESC' } });
    const sortOrder = (last?.sortOrder ?? 0) + 10;
    const unit = await this.unitRepo.save(this.unitRepo.create({ tenantId, code, name, sortOrder }));
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'unit.created',
      target: `unit:${unit.id} ${code}`,
    });
    return UnitMapper.toResponse(unit);
  }

  /** Rename a unit and/or set the places it covers (PLN-261022 stage 1); an omitted field is left alone. */
  async renameUnit(
    tenantId: number,
    actorId: number,
    id: number,
    name?: string,
    scope?: RegionScopeInput,
  ): Promise<UnitResponse> {
    const unit = await this.getTenantUnit(tenantId, id);
    const before = unit.name;
    if (name !== undefined) unit.name = name;
    const scopeChanged = applyRegionScope(unit, scope);
    await this.unitRepo.save(unit);
    if (name !== undefined && name !== before) {
      await this.audit.write({
        tenantId,
        actorType: 'user',
        actorId,
        action: 'unit.renamed',
        target: `unit:${unit.id} ${unit.code}`,
        metadata: { before, after: name },
      });
    }
    if (scopeChanged) {
      await this.audit.write({
        tenantId,
        actorType: 'user',
        actorId,
        action: 'unit.scope_changed',
        target: `unit:${unit.id} ${unit.code}`,
        metadata: { regions: unit.regions, provinces: unit.provinces },
      });
    }
    return UnitMapper.toResponse(unit);
  }

  /** Delete a unit; its members become unassigned (PLN-261021 D3). Refused while a rule names it (D2). */
  async deleteUnit(tenantId: number, actorId: number, id: number): Promise<{ released: number }> {
    const unit = await this.getTenantUnit(tenantId, id);
    await this.refuseIfRuleUses(tenantId, { unitId: unit.id });
    const released = await this.unitRepo.manager.transaction(async (m) => {
      const moved = await m.update(User, { tenantId, unitId: unit.id }, { unitId: null });
      await m.delete(Unit, { id: unit.id, tenantId });
      return moved.affected ?? 0;
    });
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'unit.deleted',
      target: `unit:${unit.id} ${unit.code}`,
      metadata: { name: unit.name, released },
    });
    return { released };
  }

  // ---- helpers ----

  /**
   * 409 E2007 when a routing rule's group or label filter, or a deny rule's label,
   * names this unit/label. `details.rules` carries the rule names for the console.
   */
  private async refuseIfRuleUses(tenantId: number, ref: { unitId?: number; labelCode?: string }): Promise<void> {
    const config = await this.aiConfigRepo.findOne({ where: { tenantId } });
    const handoff = config?.handoffConfig;
    const rules: string[] = [];
    (handoff?.routingRules ?? []).forEach((r, i) => {
      const byUnit = ref.unitId != null && (r.assigneeUnitIds ?? []).some((u) => String(u) === String(ref.unitId));
      const byLabel =
        ref.labelCode != null &&
        ((r.assigneeLabelCodes ?? []).includes(ref.labelCode) || (r.labels ?? []).includes(ref.labelCode));
      if (byUnit || byLabel) rules.push(r.name?.trim() || `Routing rule ${i + 1}`);
    });
    if (ref.labelCode != null) {
      (handoff?.denyRules ?? []).forEach((d, i) => {
        if (d.label === ref.labelCode) rules.push(`Deny rule ${i + 1} (${(d.keywords ?? []).slice(0, 3).join(', ')})`);
      });
    }
    if (rules.length) {
      this.logger.warn(
        `delete refused tenant=${tenantId} ${ref.unitId != null ? `unit:${ref.unitId}` : `label:${ref.labelCode}`}: used by [${rules.join(' | ')}]`,
      );
      throw new BusinessException(ERROR_CODE.ORG_IN_USE_BY_RULE, HttpStatus.CONFLICT, { rules });
    }
  }

  /** The tenant's unit by id; a foreign tenant's id reads as not found (never leaks). */
  private async getTenantUnit(tenantId: number, unitId: number): Promise<Unit> {
    const unit = await this.unitRepo.findOne({ where: { id: unitId, tenantId } });
    if (!unit) {
      this.logger.warn(`unit ${unitId} not found in tenant ${tenantId}`);
      throw new BusinessException(ERROR_CODE.UNIT_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return unit;
  }

  /** Map String(unit id) -> Unit for the ids given (nulls skipped; no query when none). */
  private async loadUnits(unitIds: Array<number | null | undefined>): Promise<Map<string, Unit>> {
    const ids = [...new Set(unitIds.filter((id): id is number => id != null))];
    const result = new Map<string, Unit>();
    if (!ids.length) return result;
    const units = await this.unitRepo.find({ where: { id: In(ids) } });
    for (const u of units) result.set(String(u.id), u);
    return result;
  }

  /** Readable one-time temp password that satisfies the password policy (e.g. "TmpK7Q2MA3B9X!"). */
  private genTempPassword(): string {
    return generateTempPassword();
  }

  private async getTenantUser(tenantId: number, userId: number): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new BusinessException(ERROR_CODE.USER_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    if (user.tenantId !== tenantId) {
      throw new BusinessException(ERROR_CODE.TENANT_MISMATCH, HttpStatus.FORBIDDEN);
    }
    return user;
  }

  /** Create user_job_labels for the tenant's job_labels matching the given codes. */
  private async assignLabels(tenantId: number, userId: number, codes: string[]): Promise<void> {
    if (!codes.length) return;
    const labels = await this.labelRepo.find({ where: { tenantId, code: In(codes) } });
    // A checked label whose code isn't a tenant job_label would otherwise be dropped
    // silently with a 200 — the invisible-fallback trap. Surface it so "checked but
    // not saved" is diagnosable (4xx-style events aren't logged by default).
    const found = new Set(labels.map((l) => l.code));
    const unknown = codes.filter((c) => !found.has(c));
    if (unknown.length) {
      this.logger.warn(
        `assignLabels tenant=${tenantId} user=${userId}: ignored ${unknown.length} code(s) not in job_labels [${unknown.join(',')}]`,
      );
    }
    if (!labels.length) return;
    const links = labels.map((l) => this.userLabelRepo.create({ userId, jobLabelId: l.id }));
    await this.userLabelRepo.save(links);
  }

  private async toResponseWithLabels(user: User): Promise<UserResponse> {
    const labelsByUser = await this.loadLabelCodes([user.id]);
    const unitsById = await this.loadUnits([user.unitId]);
    return UserMapper.toResponse(
      user,
      labelsByUser.get(String(user.id)) ?? [],
      unitsById.get(String(user.unitId)) ?? null,
    );
  }

  /**
   * Map userId -> label codes (join user_job_labels + job_labels). Every key is
   * String()-normalized: User.id / JobLabel.id are BIGINT PKs TypeORM hands back as
   * strings, while UserJobLabel.userId / .jobLabelId are transformed to numbers, so
   * BOTH joins (label id AND user id) miss unless both sides share a representation
   * (bigint-PK-as-string trap). Callers must read with String(id).
   */
  private async loadLabelCodes(userIds: number[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (!userIds.length) return result;

    const links = await this.userLabelRepo.find({ where: { userId: In(userIds) } });
    if (!links.length) return result;

    const labelIds = [...new Set(links.map((l) => l.jobLabelId))];
    const labels = await this.labelRepo.find({ where: { id: In(labelIds) } });
    const codeById = new Map(labels.map((l) => [String(l.id), l.code]));

    for (const link of links) {
      const code = codeById.get(String(link.jobLabelId));
      if (!code) continue;
      const key = String(link.userId);
      const list = result.get(key) ?? [];
      list.push(code);
      result.set(key, list);
    }
    return result;
  }
}

/** Places a unit/label covers, as the API accepts them (PLN-261022 stage 1). */
export interface RegionScopeInput {
  regions?: string[];
  provinces?: string[];
}

/**
 * Write the covered places onto a unit/label row; returns whether anything
 * changed. Regions are folded to catalogue codes (unknown dropped — the DTO
 * already refused them), provinces NFC-normalised and de-duplicated by their
 * comparison key keeping the first spelling. An empty list stores NULL.
 */
export function applyRegionScope(
  row: { regions: string[] | null; provinces: string[] | null },
  scope: RegionScopeInput | undefined,
): boolean {
  if (!scope) return false;
  const before = JSON.stringify([row.regions ?? [], row.provinces ?? []]);
  if (scope.regions !== undefined) {
    const regions = [...new Set(scope.regions.map(canonicalRegion).filter(isRegionCode))];
    row.regions = regions.length ? regions : null;
  }
  if (scope.provinces !== undefined) {
    const seen = new Set<string>();
    const provinces: string[] = [];
    for (const p of scope.provinces) {
      const key = provinceKey(p);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      provinces.push(p.normalize('NFC').replace(/\s+/g, ' ').trim());
    }
    row.provinces = provinces.length ? provinces : null;
  }
  return JSON.stringify([row.regions ?? [], row.provinces ?? []]) !== before;
}
