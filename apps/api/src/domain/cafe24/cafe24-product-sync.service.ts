import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { PRODUCT_STATUS, ProductCache } from '../product/entity/product-cache.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { stripHtml } from '../product/product-sync.service';
import { normalizeStorefrontUrl } from '../../global/util/storefront-url.util';
import { Cafe24TokenService } from './cafe24-token.service';
import { Cafe24AdminClient, Cafe24Product, cafe24AuthHost } from './cafe24-admin.client';

/** Page size for `GET /products` (Cafe24 maximum is 100). */
const PAGE_LIMIT = 100;
/** Cafe24 rejects an offset beyond this — paging switches to since_product_no. */
const OFFSET_CAP = 8000;
/** Runaway guard: 100 pages × 100 = 10k products. */
const MAX_PAGES = 100;
/**
 * Extra per-product calls one run may spend on detail/option enrichment.
 *
 * Each costs a slot in Cafe24's 40-call leaky bucket, so an unbounded catalogue
 * would spend the run crawling. When the budget runs out the products already
 * mapped still sync — with whatever the list row carried — and the shortfall is
 * logged rather than passed off as full coverage.
 */
const ENRICH_CALL_BUDGET = 400;
/** Below this, a description is not worth grounding an answer in — fetch the detail. */
const THIN_DESCRIPTION = 80;
/** Handles this sync owns. Keeps the archive pass off rows from another source. */
const HANDLE_PREFIX = 'cafe24-';

export interface Cafe24ProductSyncResult {
  ok: boolean;
  synced: number;
  archived: number;
  detail: string;
}

/**
 * Cafe24 catalogue → `products_cache` (PLN-260808-Cafe24-Product-Knowledge P2).
 *
 * The rest of the product-knowledge pipeline is already provider-agnostic:
 * `CatalogSyncService` turns `products_cache` into `kb_documents`, which RAG
 * answers out of. The only thing missing for a Cafe24 mall was this one step —
 * Shopify's public `/products.json` does not exist there (amoebaorder returns
 * 404), so the cache stayed empty and every product question was answered "we
 * don't carry that".
 *
 * Two mapping decisions carry the whole feature:
 * - `handle` is `cafe24-{product_no}`, never a name slug. The KB document keys on
 *   the handle, so a renamed product must not become a second document.
 * - `tags` is always filled with something (category, brand, option values,
 *   product tags). The converter holds back a product only when its description
 *   is thin AND it has no tags, and Korean malls routinely publish the detail as
 *   images with no text at all — without the tag fallback those products would
 *   silently never reach the knowledge base.
 */
@Injectable()
export class Cafe24ProductSyncService {
  private readonly logger = new Logger(Cafe24ProductSyncService.name);

  constructor(
    @InjectRepository(ProductCache) private readonly productRepo: Repository<ProductCache>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    private readonly tokenService: Cafe24TokenService,
    private readonly client: Cafe24AdminClient,
  ) {}

  async syncProducts(tenantId: number): Promise<Cafe24ProductSyncResult> {
    const conn = await this.tokenService.getConnection(tenantId);
    if (!conn) {
      return {
        ok: false,
        synced: 0,
        archived: 0,
        detail: 'Cafe24 store is not connected — reconnect the mall',
      };
    }
    const { mallId, accessToken } = conn;
    const origin = await this.storefrontOrigin(tenantId, mallId);
    const categories = await this.client.listCategoryNames(mallId, accessToken);

    // Storefront rows only: a B2B company's products (Go2Joy room types,
    // PLN-261023) are not on this storefront and must never be archived by it.
    const existing = await this.productRepo.find({ where: { tenantId, companyId: IsNull() } });
    const byHandle = new Map(existing.map((p) => [p.handle, p]));
    const seen = new Set<string>();
    const now = new Date();
    // Rows actually written. Counting attempts instead would report a product as
    // synced after its save threw — the run's own summary would then disagree
    // with the database.
    let written = 0;
    let complete = false;
    let budget = ENRICH_CALL_BUDGET;
    let offset = 0;
    let sinceProductNo: number | null = null;

    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const products = await this.client.pullProducts(mallId, accessToken, {
          limit: PAGE_LIMIT,
          offset,
          sinceProductNo,
        });
        if (products.length === 0) {
          complete = true;
          break;
        }
        for (const raw of products) {
          const outcome = await this.upsertProduct(
            tenantId,
            { mallId, accessToken, origin, categories, budget },
            byHandle,
            raw,
            now,
            seen,
          );
          budget -= outcome.spent;
          written += outcome.written;
        }
        if (products.length < PAGE_LIMIT) {
          complete = true;
          break;
        }
        // Past the offset ceiling Cafe24 stops answering, so paging carries on
        // from the last product number. Once switched it must STAY switched and
        // advance every page — leaving `sinceProductNo` pinned while `offset`
        // creeps forward re-requests the same page until the page cap.
        if (sinceProductNo != null || offset + PAGE_LIMIT > OFFSET_CAP) {
          const last = products[products.length - 1]?.product_no;
          if (last == null) break; // nothing to advance on; not a complete run
          sinceProductNo = Number(last);
        } else {
          offset += PAGE_LIMIT;
        }
      }
    } catch (e) {
      const message = (e as Error).message;
      this.logger.warn(`cafe24 product sync tenant ${tenantId} failed: ${message}`);
      // A partial run must not archive: the products it never reached are still
      // on the storefront.
      return {
        ok: written > 0,
        synced: written,
        archived: 0,
        detail: written
          ? `Synced ${written} product(s), interrupted: ${message}`
          : `Sync failed: ${message}`,
      };
    }

    const synced = written;
    const archived = complete ? await this.archiveMissing(byHandle, seen) : 0;
    if (!complete) {
      this.logger.warn(
        `cafe24 product sync tenant ${tenantId}: page cap (${MAX_PAGES}) reached — skipping archive pass`,
      );
    }
    if (budget <= 0) {
      this.logger.warn(
        `cafe24 product sync tenant ${tenantId}: enrichment budget (${ENRICH_CALL_BUDGET} calls) exhausted — ` +
          'later products mapped from list fields only',
      );
    }
    this.logger.log(
      `cafe24 product sync tenant ${tenantId}: ${synced} synced, ${archived} archived${complete ? '' : ' (incomplete)'}`,
    );
    return {
      ok: true,
      synced,
      archived,
      detail: `Synced ${synced} product(s), archived ${archived}${complete ? '' : ' (incomplete: page cap)'}`,
    };
  }

  /**
   * Map one Cafe24 product onto the cache row.
   *
   * Reports the enrichment calls it spent and whether a row was actually written
   * — the caller's counts must describe the database, not the attempt.
   */
  private async upsertProduct(
    tenantId: number,
    ctx: {
      mallId: string;
      accessToken: string;
      origin: string;
      categories: Map<number, string>;
      budget: number;
    },
    byHandle: Map<string, ProductCache>,
    raw: Cafe24Product,
    now: Date,
    seen: Set<string>,
  ): Promise<{ spent: number; written: number }> {
    const productNo = raw.product_no;
    if (productNo == null) return { spent: 0, written: 0 };
    const handle = `${HANDLE_PREFIX}${productNo}`;
    if (seen.has(handle)) return { spent: 0, written: 0 };
    seen.add(handle);

    let spent = 0;
    let product = raw;
    // The list row may not carry the detail HTML at all. Ask the single-product
    // resource — but only when the row is actually thin, and only while there is
    // budget for it. "Thin" includes a short line, not just an absent one: a
    // 12-character `simple_description` is not something to ground an answer in.
    if (ctx.budget - spent > 0 && (this.describe(product)?.length ?? 0) < THIN_DESCRIPTION) {
      const full = await this.safeCall(() =>
        this.client.fetchProduct(ctx.mallId, ctx.accessToken, Number(productNo)),
      );
      spent += 1;
      if (full) product = { ...product, ...full };
    }

    let optionValues: string[] = [];
    if (product.has_option === 'T' && ctx.budget - spent > 0) {
      const options = await this.safeCall(() =>
        this.client.fetchProductOptions(ctx.mallId, ctx.accessToken, Number(productNo)),
      );
      spent += 1;
      optionValues = (options ?? []).flatMap((o) =>
        (o.option_value ?? []).map((v) => (v.option_text ?? '').trim()).filter(Boolean),
      );
    }

    const mapped: Partial<ProductCache> = {
      title: String(product.product_name || handle).slice(0, 255),
      description: this.describe(product),
      tags: this.buildTags(product, optionValues, ctx.categories),
      category: this.categoryName(product, ctx.categories),
      sku: product.product_code ? String(product.product_code).slice(0, 64) : null,
      price: this.parsePrice(product.price),
      currency: 'KRW',
      imageUrl: this.absoluteImage(product.detail_image ?? product.list_image, ctx.origin),
      // The canonical form: the pretty URL embeds a name slug and a category, both
      // of which change without the product changing.
      productUrl: `${ctx.origin}/product/detail.html?product_no=${productNo}`.slice(0, 1024),
      publishedAt: this.parseDate(product.created_date),
      status: this.isOnSale(product) ? PRODUCT_STATUS.ACTIVE : PRODUCT_STATUS.ARCHIVED,
      syncedAt: now,
    };

    const found = byHandle.get(handle);
    if (found) {
      Object.assign(found, mapped);
      await this.productRepo.save(found);
    } else {
      const created = await this.productRepo.save(
        this.productRepo.create({ tenantId, handle, ...mapped }),
      );
      byHandle.set(handle, created);
    }
    return { spent, written: 1 };
  }

  /**
   * Rows this run owns but no longer saw. Archived, never deleted — an order
   * still references the product, and a shopper may still ask about it.
   */
  private async archiveMissing(
    byHandle: Map<string, ProductCache>,
    seen: Set<string>,
  ): Promise<number> {
    let archived = 0;
    for (const row of byHandle.values()) {
      if (!row.handle.startsWith(HANDLE_PREFIX)) continue;
      if (seen.has(row.handle) || row.status === PRODUCT_STATUS.ARCHIVED) continue;
      row.status = PRODUCT_STATUS.ARCHIVED;
      await this.productRepo.save(row);
      archived += 1;
    }
    return archived;
  }

  /**
   * The best readable description Cafe24 gave us, or null when there is none
   * worth storing. Korean malls publish the detail as images often enough that
   * the summary lines are the real text source, not a fallback.
   */
  private describe(p: Cafe24Product): string | null {
    for (const candidate of [p.description, p.summary_description, p.simple_description]) {
      const text = stripHtml(candidate);
      if (text && text.length >= THIN_DESCRIPTION) return text;
    }
    // Nothing long enough — keep the longest short line rather than nothing, so
    // the document at least names what the product is.
    const shorts = [p.summary_description, p.simple_description, p.description]
      .map((c) => stripHtml(c))
      .filter((t): t is string => Boolean(t))
      .sort((a, b) => b.length - a.length);
    return shorts[0] ?? null;
  }

  /**
   * Category, brand and option values as a tag list.
   *
   * This is what keeps an image-only product reachable: `CatalogSyncService`
   * holds back a product whose description is thin AND whose tags are empty, so
   * the tags are the difference between a knowledge document and silence.
   */
  private buildTags(
    p: Cafe24Product,
    optionValues: string[],
    categories: Map<number, string>,
  ): string | null {
    const tags: string[] = [];
    for (const entry of p.category ?? []) {
      const name = entry?.category_no != null ? categories.get(Number(entry.category_no)) : null;
      if (name) tags.push(name);
    }
    // `brand_code` is deliberately absent. It is an opaque code (`B0000000` is
    // Cafe24's "no brand" default, carried by all 28 products on the pilot mall),
    // so it discriminates nothing in retrieval and shows up verbatim in the
    // snippet a shopper reads. Same rule as `category`: a code no human can read
    // is worse than a blank.
    const declared = Array.isArray(p.product_tag)
      ? p.product_tag
      : typeof p.product_tag === 'string'
        ? p.product_tag.split(',')
        : [];
    tags.push(...declared.map((t) => String(t).trim()).filter(Boolean));
    tags.push(...optionValues);
    // The product name is the last resort: a mall with no categories, brands,
    // options or tags would otherwise produce an empty tag list and lose the
    // product entirely.
    if (tags.length === 0 && p.product_name) tags.push(String(p.product_name));

    const unique = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    const joined = unique.join(', ');
    return joined ? joined.slice(0, 1024) : null;
  }

  private categoryName(p: Cafe24Product, categories: Map<number, string>): string | null {
    for (const entry of p.category ?? []) {
      const name = entry?.category_no != null ? categories.get(Number(entry.category_no)) : null;
      // A bare category number would read as noise in the console and in the
      // knowledge document's category field — blank is the honest value.
      if (name) return name.slice(0, 128);
    }
    return null;
  }

  /** On sale = on display AND being sold. Either flag off takes it out of recommendations. */
  private isOnSale(p: Cafe24Product): boolean {
    return (p.display ?? 'T') !== 'F' && (p.selling ?? 'T') !== 'F';
  }

  private parsePrice(value: Cafe24Product['price']): number | null {
    if (value == null || value === '') return null;
    const price = Number(value);
    return Number.isFinite(price) ? price : null;
  }

  private parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /**
   * Cafe24 image paths come in three shapes: absolute, protocol-relative
   * (`//mall.cafe24.com/...`) and host-relative (`/web/product/big/x.jpg`).
   * Dropping the last two would blank the thumbnail on most of the catalogue.
   */
  private absoluteImage(src: string | null | undefined, origin: string): string | null {
    const raw = (src ?? '').trim();
    if (!raw) return null;
    const url = raw.startsWith('//')
      ? `https:${raw}`
      : raw.startsWith('/')
        ? `${origin}${raw}`
        : raw;
    return /^https?:\/\//i.test(url) ? url.slice(0, 1024) : null;
  }

  /**
   * The origin product links must point at.
   *
   * `productLinkFor` only renders a citation as a link when its host matches the
   * tenant's storefront, so building URLs on `{mall}.cafe24.com` while the tenant
   * is configured with its own domain would produce recommendations nobody can
   * click. The tenant's own storefront wins whenever it is set.
   */
  private async storefrontOrigin(tenantId: number, mallId: string): Promise<string> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    return normalizeStorefrontUrl(tenant?.storefrontUrl) ?? cafe24AuthHost(mallId);
  }

  /** Enrichment is best-effort: a failed extra call must not lose the product. */
  private async safeCall<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      this.logger.warn(`cafe24 product enrichment call failed: ${(e as Error).message}`);
      return null;
    }
  }
}
