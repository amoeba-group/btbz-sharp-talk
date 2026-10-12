import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { generateToken } from '@sharptalk/common';
import { User } from './entity/user.entity';
import { JobLabel } from './entity/job-label.entity';
import { UserJobLabel } from './entity/user-job-label.entity';
import { Invitation } from './entity/invitation.entity';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import {
  InviteUserResponse,
  JobLabelMapper,
  JobLabelResponse,
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
  ) {}

  // ---- Users ----

  async listUsers(
    tenantId: number,
    page: number,
    size: number,
    /** Role/region filters (PLN-261007): label code; region 'north'|'south'|'none' (nationwide). */
    filter: { label?: string; region?: string } = {},
  ): Promise<{ items: UserResponse[]; total: number }> {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .where('u.tenantId = :tenantId', { tenantId })
      .orderBy('u.id', 'ASC')
      .skip((page - 1) * size)
      .take(size);
    if (filter.region === 'none') qb.andWhere('u.region IS NULL');
    else if (filter.region) qb.andWhere('u.region = :region', { region: filter.region });
    if (filter.label) {
      // Held-label filter through the join tables, tenant-fenced on the label row.
      qb.andWhere(
        `EXISTS (SELECT 1 FROM user_job_labels ujl JOIN job_labels jl ON jl.id = ujl.job_label_id
                 WHERE ujl.user_id = u.id AND jl.tenant_id = :tenantId AND jl.code = :label)`,
        { label: filter.label },
      );
    }
    const [users, total] = await qb.getManyAndCount();

    const labelsByUser = await this.loadLabelCodes(users.map((u) => u.id));
    const items = users.map((u) => UserMapper.toResponse(u, labelsByUser.get(String(u.id)) ?? []));
    return { items, total };
  }

  async invite(
    tenantId: number,
    invitedBy: number,
    email: string,
    rank: string,
    labelCodes: string[] = [],
    actorType: 'user' | 'admin' = 'user',
    /** Operational region (PLN-261007); ''/undefined = nationwide. */
    region?: string | null,
  ): Promise<InviteUserResponse> {
    const existing = await this.userRepo.findOne({ where: { tenantId, email } });
    if (existing) {
      throw new BusinessException(ERROR_CODE.EMAIL_TAKEN, HttpStatus.CONFLICT);
    }

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
        region: region || null,
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

  /** Operational region (PLN-261007): '' clears it (nationwide). */
  async updateRegion(tenantId: number, userId: number, region: string): Promise<UserResponse> {
    const user = await this.getTenantUser(tenantId, userId);
    user.region = region || null;
    await this.userRepo.save(user);
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
    return labels.map((l) => JobLabelMapper.toResponse(l));
  }

  async createLabel(tenantId: number, code: string, name: string): Promise<JobLabelResponse> {
    const existing = await this.labelRepo.findOne({ where: { tenantId, code } });
    if (existing) {
      throw new BusinessException(ERROR_CODE.DUPLICATE_RESOURCE, HttpStatus.CONFLICT);
    }
    const label = await this.labelRepo.save(this.labelRepo.create({ tenantId, code, name }));
    return JobLabelMapper.toResponse(label);
  }

  async updateLabel(tenantId: number, id: number, name: string): Promise<JobLabelResponse> {
    const label = await this.labelRepo.findOne({ where: { id, tenantId } });
    if (!label) {
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    label.name = name;
    await this.labelRepo.save(label);
    return JobLabelMapper.toResponse(label);
  }

  // ---- helpers ----

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
    return UserMapper.toResponse(user, labelsByUser.get(String(user.id)) ?? []);
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
