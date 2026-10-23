import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Company } from './entity/company.entity';
import { CompanyContact } from './entity/company-contact.entity';
import { Customer } from '../customer/entity/customer.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { CompanyMapper } from './company.mapper';
import type { CompanyDetailResponse, CompanyResponse, CompanyConversationResponse } from './dto/response/company.response';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/** The signed identity attributes a company is built from (stored form). */
export interface CompanyIdentity {
  hotel_id?: string;
  hotel_name?: string;
  province?: string;
  region?: string;
}

/** `hotel:{id}` — the only company source today (Go2Joy Hotel Admin). */
export const companyKeyFor = (attrs: CompanyIdentity | null | undefined): string | null =>
  attrs?.hotel_id?.trim() ? `hotel:${attrs.hotel_id.trim()}` : null;

/** MySQL duplicate-entry, whichever driver shape it arrives in. */
function isDuplicateKey(err: unknown): boolean {
  const e = err as { code?: string; errno?: number; driverError?: { code?: string; errno?: number } };
  return e?.code === 'ER_DUP_ENTRY' || e?.errno === 1062 || e?.driverError?.code === 'ER_DUP_ENTRY' || e?.driverError?.errno === 1062;
}

/**
 * B2B companies (PLN-261022 stage 2). A company exists only because a host
 * SIGNED an identify naming it, so nothing here trusts browser input; every
 * read is tenant-scoped and a foreign tenant's id reads as not found.
 */
@Injectable()
export class CompanyService {
  private readonly logger = new Logger(CompanyService.name);

  constructor(
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    @InjectRepository(CompanyContact) private readonly contactRepo: Repository<CompanyContact>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
  ) {}

  /**
   * Find-or-create the company a signed identify names, refreshing its name /
   * province / region from the attributes (the host is the source of truth).
   * No `hotel_id` → null (no company: a chain operator viewing "all hotels").
   */
  async upsertFromIdentity(tenantId: number, attrs: CompanyIdentity | null): Promise<Company | null> {
    const externalKey = companyKeyFor(attrs);
    if (!externalKey) return null;
    const existing = await this.companyRepo.findOne({ where: { tenantId, externalKey } });
    const company = existing ?? this.companyRepo.create({ tenantId, externalKey, name: null, province: null, region: null });
    if (attrs?.hotel_name) company.name = attrs.hotel_name;
    if (attrs?.province) company.province = attrs.province;
    if (attrs?.region) company.region = attrs.region;
    company.lastSeenAt = new Date();
    try {
      return await this.companyRepo.save(company);
    } catch (err) {
      // Two tabs signing in at once both miss the lookup; the unique key makes
      // that safe — read back the winner's row instead of failing the identify.
      if (!existing && isDuplicateKey(err)) {
        const winner = await this.companyRepo.findOne({ where: { tenantId, externalKey } });
        if (winner) return winner;
      }
      throw err;
    }
  }

  /** Link a contact to a company (idempotent); refreshes role and last-seen. */
  async linkContact(tenantId: number, companyId: number, customerId: number, role: string | null): Promise<void> {
    const existing = await this.contactRepo.findOne({ where: { companyId, customerId } });
    const link = existing ?? this.contactRepo.create({ tenantId, companyId, customerId });
    link.role = role ?? link.role ?? null;
    link.lastSeenAt = new Date();
    try {
      await this.contactRepo.save(link);
    } catch (err) {
      if (!existing && isDuplicateKey(err)) return; // the concurrent insert won; nothing to add
      throw err;
    }
  }

  async list(
    tenantId: number,
    page: number,
    size: number,
    filter: { q?: string; region?: string } = {},
  ): Promise<{ items: CompanyResponse[]; total: number }> {
    const qb = this.companyRepo.createQueryBuilder('c').where('c.tenantId = :tenantId', { tenantId });
    if (filter.q?.trim()) qb.andWhere('c.name LIKE :q', { q: `%${filter.q.trim()}%` });
    if (filter.region) qb.andWhere('c.region = :region', { region: filter.region });
    const [rows, total] = await qb
      .orderBy('c.lastSeenAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .skip((page - 1) * size)
      .take(size)
      .getManyAndCount();
    const stats = await this.stats(tenantId, rows.map((r) => Number(r.id)));
    return { items: rows.map((r) => CompanyMapper.toResponse(r, stats.get(String(r.id)))), total };
  }

  /**
   * Company names by id, tenant-scoped — the live-chat title "customer /
   * company" (PLN-261023). A foreign or missing id is simply absent.
   */
  async namesByIds(tenantId: number, ids: number[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(ids.filter((n) => Number.isFinite(n) && n > 0))];
    if (!unique.length) return new Map();
    const rows = await this.companyRepo.find({ where: { tenantId, id: In(unique) }, select: ['id', 'name'] });
    return new Map(rows.map((r) => [String(r.id), r.name ?? null]));
  }

  async detail(tenantId: number, id: number): Promise<CompanyDetailResponse> {
    const company = await this.companyRepo.findOne({ where: { id, tenantId } });
    if (!company) {
      this.logger.warn(`company ${id} not found in tenant ${tenantId}`);
      throw new BusinessException(ERROR_CODE.COMPANY_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    const links = await this.contactRepo.find({ where: { tenantId, companyId: id }, order: { lastSeenAt: 'DESC' } });
    const conversations = await this.convRepo.find({
      where: { tenantId, companyId: id },
      order: { id: 'DESC' },
      take: 50,
    });
    const names = await this.customerNames(tenantId, [
      ...links.map((l) => Number(l.customerId)),
      ...conversations.map((c) => Number(c.customerId)).filter((n) => Number.isFinite(n) && n > 0),
    ]);
    const stats = (await this.stats(tenantId, [Number(company.id)])).get(String(company.id));
    return {
      ...CompanyMapper.toResponse(company, stats),
      contacts: links.map((l) => CompanyMapper.toContact(l, names.get(String(l.customerId)) ?? null)),
      conversations: conversations.map((c) =>
        CompanyMapper.toConversation(c, c.customerId != null ? (names.get(String(c.customerId)) ?? null) : null),
      ),
    };
  }

  /**
   * The company's other conversations, newest first — the console's "earlier
   * conversations at this hotel" panel. Tenant-scoped; `excludeId` drops the
   * one being viewed.
   */
  async conversationsOf(
    tenantId: number,
    companyId: number,
    excludeId: number | null,
    limit = 20,
  ): Promise<{ total: number; items: CompanyConversationResponse[] }> {
    const qb = this.convRepo
      .createQueryBuilder('c')
      .where('c.tenantId = :tenantId AND c.companyId = :companyId', { tenantId, companyId });
    if (excludeId != null) qb.andWhere('c.id <> :excludeId', { excludeId });
    // limit 0 = count only (TypeORM reads take(0) as "no limit").
    if (limit <= 0) return { total: await qb.getCount(), items: [] };
    const [rows, total] = await qb.orderBy('c.id', 'DESC').take(limit).getManyAndCount();
    const names = await this.customerNames(
      tenantId,
      rows.map((c) => Number(c.customerId)).filter((n) => Number.isFinite(n) && n > 0),
    );
    return {
      total,
      // Inside a live conversation → masked, like the rest of the room.
      items: rows.map((c) =>
        CompanyMapper.toConversation(c, c.customerId != null ? (names.get(String(c.customerId)) ?? null) : null, true),
      ),
    };
  }

  private async stats(
    tenantId: number,
    ids: number[],
  ): Promise<Map<string, { contactCount: number; conversationCount: number; lastConversationAt: Date | null }>> {
    const out = new Map<string, { contactCount: number; conversationCount: number; lastConversationAt: Date | null }>();
    if (!ids.length) return out;
    for (const id of ids) out.set(String(id), { contactCount: 0, conversationCount: 0, lastConversationAt: null });
    const contacts: Array<{ companyId: string; n: string }> = await this.contactRepo
      .createQueryBuilder('l')
      .select('l.companyId', 'companyId')
      .addSelect('COUNT(*)', 'n')
      .where('l.tenantId = :tenantId AND l.companyId IN (:...ids)', { tenantId, ids })
      .groupBy('l.companyId')
      .getRawMany();
    for (const r of contacts) out.get(String(r.companyId))!.contactCount = Number(r.n);
    const convs: Array<{ companyId: string; n: string; last: Date | null }> = await this.convRepo
      .createQueryBuilder('c')
      .select('c.companyId', 'companyId')
      .addSelect('COUNT(*)', 'n')
      .addSelect('MAX(c.createdAt)', 'last')
      .where('c.tenantId = :tenantId AND c.companyId IN (:...ids)', { tenantId, ids })
      .groupBy('c.companyId')
      .getRawMany();
    for (const r of convs) {
      const s = out.get(String(r.companyId));
      if (s) {
        s.conversationCount = Number(r.n);
        s.lastConversationAt = r.last ?? null;
      }
    }
    return out;
  }

  private async customerNames(tenantId: number, ids: number[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(ids)].filter((n) => Number.isFinite(n) && n > 0);
    if (!unique.length) return new Map();
    const rows = await this.customerRepo.find({ where: { tenantId, id: In(unique) }, select: ['id', 'name'] });
    return new Map(rows.map((c) => [String(c.id), c.name]));
  }
}
