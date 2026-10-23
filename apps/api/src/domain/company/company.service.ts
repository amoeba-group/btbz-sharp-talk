import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Company } from './entity/company.entity';
import { CompanyContact } from './entity/company-contact.entity';
import { Customer } from '../customer/entity/customer.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { PRODUCT_STATUS, ProductCache } from '../product/entity/product-cache.entity';
import { User } from '../user/entity/user.entity';
import { TenantAiConfig } from '../ai-engine/entity/tenant-ai-config.entity';
import { regionForProvince } from '../embed/identity-attributes';
import { CompanyMapper } from './company.mapper';
import type {
  CompanyDetailResponse,
  CompanyResponse,
  CompanyConversationResponse,
  HotelSummaryResponse,
} from './dto/response/company.response';
import type { UpdateCompanyProfileRequest } from './dto/request/company.request';
import type { CompanyProfile } from './entity/company.entity';
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
    @InjectRepository(ProductCache) private readonly productRepo: Repository<ProductCache>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @Optional() @InjectRepository(TenantAiConfig) private readonly aiConfigRepo?: Repository<TenantAiConfig>,
  ) {}

  /**
   * A company with a province but no region takes the region the tenant's
   * province map gives it (PLN-261023 H1-c). Never throws — a missing map
   * leaves the region empty, as before.
   */
  private async fillRegion(company: Company): Promise<void> {
    if (company.region || !company.province || !this.aiConfigRepo) return;
    try {
      const config = await this.aiConfigRepo.findOne({ where: { tenantId: company.tenantId } });
      const region = regionForProvince(company.province, config?.handoffConfig?.provinceRegions);
      if (region) company.region = region;
    } catch (err) {
      this.logger.warn(`company region not filled (tenant ${company.tenantId}): ${(err as Error).message}`);
    }
  }

  /** The company of a Go2Joy hotel, or null (tenant-scoped). */
  findHotel(tenantId: number, hotelSn: number): Promise<Company | null> {
    return this.companyRepo.findOne({ where: { tenantId, externalKey: `hotel:${hotelSn}` } });
  }

  /**
   * The hotel card of a conversation (PLN-261023): the thread's company when a
   * signed sign-in set one, else the company of the hotel number the session
   * carries — shown as unverified when that number came unsigned. Display only;
   * nothing is linked. Null when there is no such company (yet).
   */
  async hotelSummary(
    tenantId: number,
    threadCompanyId: number | null,
    hotelId: string | null | undefined,
    verified: boolean,
  ): Promise<HotelSummaryResponse | null> {
    let company: Company | null = null;
    if (threadCompanyId != null) company = await this.companyRepo.findOne({ where: { id: threadCompanyId, tenantId } });
    if (!company && hotelId && /^\d{1,10}$/.test(String(hotelId).trim())) {
      company = await this.findHotel(tenantId, Number(String(hotelId).trim()));
    }
    if (!company) return null;
    const selling = await this.productRepo.find({
      where: { tenantId, companyId: Number(company.id), status: PRODUCT_STATUS.ACTIVE },
      order: { price: 'ASC' },
    });
    return {
      companyId: String(company.id),
      // The caller's identity level decides: a claimed user's conversation is
      // filed under the company too (PLN-261023 S4), so "on the thread" no
      // longer implies a signed identify.
      verified,
      name: company.name,
      code: company.code ?? null,
      address: company.address ?? null,
      phone: company.phone ?? null,
      hotelType: company.profile?.hotelType ?? null,
      partnerInfo: (company.partnerInfo as unknown as Record<string, unknown>) ?? null,
      sellingRooms: selling.length,
      rooms: selling.slice(0, 5).map((r) => ({
        title: r.title,
        price: r.price,
        currency: r.currency,
        attributes: r.attributes ?? null,
      })),
    };
  }

  /** One company row or E5098 (tenant-scoped). */
  async getOrThrow(tenantId: number, id: number): Promise<Company> {
    const company = await this.companyRepo.findOne({ where: { id, tenantId } });
    if (!company) {
      this.logger.warn(`company ${id} not found in tenant ${tenantId}`);
      throw new BusinessException(ERROR_CODE.COMPANY_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return company;
  }

  /**
   * Operator edit of the hotel profile (PLN-261023 D3). Only keys present in
   * the request change; '' and null clear. Returns the fields that changed so
   * the caller can audit them (names only — values may be personal).
   */
  async updateProfile(
    tenantId: number,
    id: number,
    dto: UpdateCompanyProfileRequest,
    actorUserId: number,
  ): Promise<string[]> {
    const company = await this.getOrThrow(tenantId, id);
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() || null : null);
    const changed: string[] = [];
    const column = (key: 'name' | 'code' | 'phone' | 'province' | 'district' | 'address') => {
      if (!(key in dto)) return;
      const next = text(dto[key]);
      if ((company[key] ?? null) !== next) {
        company[key] = next;
        changed.push(key);
      }
    };
    (['name', 'code', 'phone', 'province', 'district', 'address'] as const).forEach(column);
    if (changed.includes('province') && !company.region) await this.fillRegion(company);
    const profile: CompanyProfile = { ...(company.profile ?? {}) };
    const map: Array<[keyof UpdateCompanyProfileRequest, keyof CompanyProfile, 'text' | 'bool']> = [
      ['group_name', 'groupName', 'text'],
      ['promotion', 'promotion', 'bool'],
      ['hot', 'hot', 'bool'],
      ['is_new', 'isNew', 'bool'],
      ['contract_start', 'contractStart', 'text'],
      ['contract_end', 'contractEnd', 'text'],
      ['payment', 'payment', 'text'],
      ['hotel_type', 'hotelType', 'text'],
      ['enterprise_name', 'enterpriseName', 'text'],
      ['enterprise_reg_no', 'enterpriseRegNo', 'text'],
      ['extra_fee', 'extraFee', 'bool'],
      ['description_en', 'descriptionEn', 'text'],
      ['description_vi', 'descriptionVi', 'text'],
      ['policy_en', 'policyEn', 'text'],
      ['policy_vi', 'policyVi', 'text'],
    ];
    for (const [from, to, kind] of map) {
      if (!(from in dto)) continue;
      const raw = dto[from];
      const next = kind === 'bool' ? (typeof raw === 'boolean' ? raw : null) : text(raw);
      if ((profile[to] ?? null) !== next) {
        (profile as Record<string, unknown>)[to] = next;
        changed.push(from);
      }
    }
    if (!changed.length) return [];
    company.profile = profile;
    company.profileUpdatedAt = new Date();
    company.profileUpdatedBy = actorUserId;
    await this.companyRepo.save(company);
    return changed;
  }

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
    await this.fillRegion(company);
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
    if (filter.q?.trim()) {
      qb.andWhere('(c.name LIKE :q OR c.code LIKE :q OR c.externalKey LIKE :q)', { q: `%${filter.q.trim()}%` });
    }
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
    const company = await this.getOrThrow(tenantId, id);
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
    const rooms = await this.productRepo.find({
      where: { tenantId, companyId: Number(company.id) },
      order: { status: 'ASC', title: 'ASC' },
    });
    const editor =
      company.profileUpdatedBy != null
        ? await this.userRepo.findOne({ where: { id: Number(company.profileUpdatedBy) }, select: ['id', 'name', 'email'] })
        : null;
    return {
      ...CompanyMapper.toResponse(company, stats),
      profile: CompanyMapper.toProfile(company, editor ? editor.name || editor.email : null),
      partnerInfo: (company.partnerInfo as unknown as Record<string, unknown>) ?? null,
      partnerSyncedAt: company.partnerSyncedAt ? new Date(company.partnerSyncedAt).toISOString() : null,
      partnerSyncError: company.partnerSyncError ?? null,
      rooms: rooms.map((r) => CompanyMapper.toRoom(r)),
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
      items: rows.map((c) => CompanyMapper.toConversation(c, c.customerId != null ? (names.get(String(c.customerId)) ?? null) : null)),
    };
  }

  private async stats(
    tenantId: number,
    ids: number[],
  ): Promise<Map<string, { contactCount: number; conversationCount: number; lastConversationAt: Date | null; roomCount: number }>> {
    const out = new Map<string, { contactCount: number; conversationCount: number; lastConversationAt: Date | null; roomCount: number }>();
    if (!ids.length) return out;
    for (const id of ids) out.set(String(id), { contactCount: 0, conversationCount: 0, lastConversationAt: null, roomCount: 0 });
    const rooms: Array<{ companyId: string; n: string }> = await this.productRepo
      .createQueryBuilder('p')
      .select('p.companyId', 'companyId')
      .addSelect('COUNT(*)', 'n')
      .where('p.tenantId = :tenantId AND p.companyId IN (:...ids) AND p.status = :active', {
        tenantId,
        ids,
        active: PRODUCT_STATUS.ACTIVE,
      })
      .groupBy('p.companyId')
      .getRawMany();
    for (const r of rooms) {
      const s = out.get(String(r.companyId));
      if (s) s.roomCount = Number(r.n);
    }
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
