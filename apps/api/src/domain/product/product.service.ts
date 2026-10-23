import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Like, Repository } from 'typeorm';
import { PRODUCT_STATUS, ProductCache } from './entity/product-cache.entity';
import { ProductSave } from '../save/entity/product-save.entity';
import { DOC_GROUP, KbDocument } from '../knowledge/entity/kb-document.entity';
import { Company } from '../company/entity/company.entity';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/** Normalized tag list of a catalog row (comma-joined column → trimmed, lowercased). */
function splitTags(p: ProductCache): string[] {
  return (p.tags ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Customer-facing catalog reads (PLN-260807-IvyusaApp-Revamp F1, A-3).
 * All reads are tenant-scoped; a session without a tenant sees an empty catalog
 * rather than someone else's (fail-closed, POL multitenancy).
 */
@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(ProductCache) private readonly productRepo: Repository<ProductCache>,
    @InjectRepository(ProductSave) private readonly saveRepo: Repository<ProductSave>,
    // Repository-only: the console list reports whether each catalogue row
    // reached the knowledge base, which is a read across one column.
    @InjectRepository(KbDocument) private readonly docRepo: Repository<KbDocument>,
    // Repository-only: the company column/filter needs names, nothing more.
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
  ) {}

  /** Company id → name for the given ids (tenant-scoped). */
  async companyNames(tenantId: number | null, ids: Array<number | null>): Promise<Map<string, string | null>> {
    const unique = [...new Set(ids.filter((i): i is number => i != null).map(Number))];
    if (tenantId == null || !unique.length) return new Map();
    const rows = await this.companyRepo.find({ where: { tenantId, id: In(unique) }, select: ['id', 'name'] });
    return new Map(rows.map((r) => [String(r.id), r.name ?? null]));
  }

  /**
   * Active products, newest first. `q` matches title OR tags (LIKE contains);
   * `category` is an exact match on the storefront product_type.
   */
  async list(
    tenantId: number | null,
    q: string | undefined,
    category: string | undefined,
    page: number,
    size: number,
  ): Promise<[ProductCache[], number]> {
    if (tenantId == null) return [[], 0];
    // Storefront catalogue only — a B2B company's products (Go2Joy room types,
    // PLN-261023) are not for sale to shoppers.
    const base: Record<string, unknown> = { tenantId, status: PRODUCT_STATUS.ACTIVE, companyId: IsNull() };
    if (category) base.category = category;
    const where = q ? [{ ...base, title: Like(`%${q}%`) }, { ...base, tags: Like(`%${q}%`) }] : base;
    return this.productRepo.findAndCount({
      where,
      order: { publishedAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
  }

  /**
   * Console catalogue listing (PLN-260808-Console-Product-List P1).
   *
   * Deliberately not `list()`: the customer-facing one pins `status='active'`,
   * and the whole point of the console view is seeing what the sync ARCHIVED —
   * a product that quietly left the storefront is exactly what an operator is
   * looking for. `status: 'all'` (the default) therefore returns both.
   */
  async adminList(
    tenantId: number | null,
    filters: { q?: string; category?: string; status?: string; companyId?: string },
    page: number,
    size: number,
  ): Promise<[ProductCache[], number]> {
    if (tenantId == null) return [[], 0];
    const base: Record<string, unknown> = { tenantId };
    // B2B company filter (PLN-261023): 'none' = storefront rows, an id = that company's.
    if (filters.companyId === 'none') base.companyId = IsNull();
    else if (filters.companyId && /^\d+$/.test(filters.companyId)) base.companyId = Number(filters.companyId);
    if (filters.category) base.category = filters.category;
    if (filters.status === PRODUCT_STATUS.ACTIVE || filters.status === PRODUCT_STATUS.ARCHIVED) {
      base.status = filters.status;
    }
    const q = filters.q?.trim();
    // Search spans title OR tags — on a Cafe24 mall the tags carry the category
    // and option values, which is often the only text a product has.
    const where = q ? [{ ...base, title: Like(`%${q}%`) }, { ...base, tags: Like(`%${q}%`) }] : base;
    return this.productRepo.findAndCount({
      where,
      order: { status: 'ASC', publishedAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
  }

  /** Header counters for the console list. */
  async adminSummary(tenantId: number | null): Promise<{
    total: number;
    active: number;
    archived: number;
    lastSyncedAt: string | null;
  }> {
    if (tenantId == null) return { total: 0, active: 0, archived: 0, lastSyncedAt: null };
    const rows = await this.productRepo.find({
      where: { tenantId },
      select: ['status', 'syncedAt'],
    });
    let active = 0;
    let last: Date | null = null;
    for (const row of rows) {
      if (row.status === PRODUCT_STATUS.ACTIVE) active += 1;
      if (row.syncedAt && (!last || row.syncedAt > last)) last = row.syncedAt;
    }
    return {
      total: rows.length,
      active,
      archived: rows.length - active,
      lastSyncedAt: last ? last.toISOString() : null,
    };
  }

  /**
   * Which of these handles already back a product knowledge document.
   *
   * This is the column the console screen exists for: a row in `products_cache`
   * is only display data, and a product that never became a `kb_documents` entry
   * is invisible to the chat no matter how good it looks in the catalogue. One
   * query for the whole page — per-row lookups would be N+1.
   */
  async knowledgeHandles(tenantId: number | null, handles: string[]): Promise<Set<string>> {
    if (tenantId == null || handles.length === 0) return new Set();
    const docs = await this.docRepo.find({
      where: { tenantId, docGroup: DOC_GROUP.PRODUCT, externalKey: In(handles) },
      select: ['externalKey'],
    });
    return new Set(docs.map((d) => d.externalKey).filter((k): k is string => !!k));
  }

  /** How many product knowledge documents the tenant has (console header). */
  async knowledgeDocumentCount(tenantId: number | null): Promise<number> {
    if (tenantId == null) return 0;
    return this.docRepo.count({ where: { tenantId, docGroup: DOC_GROUP.PRODUCT } });
  }

  /** Every distinct category in the tenant's catalogue, archived rows included. */
  async adminCategories(tenantId: number | null): Promise<string[]> {
    if (tenantId == null) return [];
    const rows = await this.productRepo.find({ where: { tenantId }, select: ['category'] });
    const set = new Set<string>();
    for (const row of rows) {
      if (row.category && row.category.trim() !== '') set.add(row.category);
    }
    return [...set].sort();
  }

  /** Distinct non-empty categories of the tenant's active products (filter dropdown). */
  async categories(tenantId: number | null): Promise<string[]> {
    if (tenantId == null) return [];
    const rows = await this.productRepo.find({
      where: { tenantId, status: PRODUCT_STATUS.ACTIVE, companyId: IsNull() },
      select: ['category'],
    });
    const set = new Set<string>();
    for (const row of rows) {
      if (row.category && row.category.trim() !== '') set.add(row.category);
    }
    return [...set].sort();
  }

  /**
   * Deterministic recommendations v1 (PLN-260807-IvyusaApp-Revamp F3, A-10 —
   * the home feed "AI 추천" rail; LLM personalization is P2).
   *
   * Signal = the categories + tags of products the customer saved (product_saves
   * joined to the tenant catalog by handle). Order items are deliberately NOT
   * mined: order_items carries only a Shopify product_id/title — no handle and no
   * category — so deriving a category from orders is not cheap here (A-10 says
   * skip rather than overreach).
   *
   * Scoring over the tenant's active products, excluding already-saved handles:
   * shared category = 2, any tag intersection = +1; order score DESC then
   * publishedAt DESC (the candidate query is newest-first and the sort is
   * stable, so zero-score rows fill the remainder as "newest actives").
   * Anonymous or zero-signal → newest actives.
   */
  async recommendations(
    tenantId: number | null,
    customerId: number | null,
    size: number,
  ): Promise<ProductCache[]> {
    if (tenantId == null) return [];
    if (customerId == null) return this.newestActive(tenantId, size);

    const saves = await this.saveRepo.find({ where: { customerId } });
    if (saves.length === 0) return this.newestActive(tenantId, size);

    const savedHandles = new Set(saves.map((s) => s.productHandle));
    const savedProducts = await this.productRepo.find({
      where: { tenantId, handle: In([...savedHandles]) },
    });
    const categories = new Set(
      savedProducts.map((p) => p.category).filter((c): c is string => !!c && c.trim() !== ''),
    );
    const tags = new Set(savedProducts.flatMap(splitTags));

    const candidates = await this.productRepo.find({
      where: { tenantId, status: PRODUCT_STATUS.ACTIVE, companyId: IsNull() },
      order: { publishedAt: 'DESC', id: 'DESC' },
    });
    const scored = candidates
      .filter((p) => !savedHandles.has(p.handle))
      .map((p) => ({
        p,
        score:
          (p.category && categories.has(p.category) ? 2 : 0) +
          (splitTags(p).some((t) => tags.has(t)) ? 1 : 0),
      }));
    // Array#sort is stable: equal scores keep the newest-first candidate order.
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, size).map((s) => s.p);
  }

  /** Cold-start / anonymous fallback: the tenant's newest active products. */
  private async newestActive(tenantId: number, size: number): Promise<ProductCache[]> {
    return this.productRepo.find({
      where: { tenantId, status: PRODUCT_STATUS.ACTIVE, companyId: IsNull() },
      order: { publishedAt: 'DESC', id: 'DESC' },
      take: size,
    });
  }

  /**
   * Companies that own products, with counts — the console's company filter
   * (PLN-261023). Empty for a storefront-only tenant, which hides the filter.
   */
  async companyFacets(tenantId: number | null): Promise<Array<{ companyId: string; count: number }>> {
    if (tenantId == null) return [];
    const rows: Array<{ companyId: string; n: string }> = await this.productRepo
      .createQueryBuilder('p')
      .select('p.companyId', 'companyId')
      .addSelect('COUNT(*)', 'n')
      .where('p.tenantId = :tenantId AND p.companyId IS NOT NULL', { tenantId })
      .groupBy('p.companyId')
      .getRawMany();
    return rows.map((r) => ({ companyId: String(r.companyId), count: Number(r.n) }));
  }

  /**
   * Operator-entered room count of a room type (PLN-261023) — the Partner API
   * has none. Kept in `attributes`, which the hotel sync preserves.
   */
  async setRoomCount(tenantId: number, handle: string, count: number | null): Promise<ProductCache> {
    const product = await this.productRepo.findOne({ where: { tenantId, handle } });
    if (!product || product.companyId == null) {
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    product.attributes = { ...(product.attributes ?? {}), roomCount: count };
    return this.productRepo.save(product);
  }

  /** One product by handle — archived rows stay reachable (deep links from old pushes). */
  async detail(tenantId: number | null, handle: string): Promise<ProductCache> {
    const product =
      tenantId == null ? null : await this.productRepo.findOne({ where: { tenantId, handle } });
    if (!product) {
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return product;
  }
}
