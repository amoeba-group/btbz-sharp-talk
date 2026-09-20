import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { INTEGRATION_PROVIDER } from '@sharptalk/types';
import { PRODUCT_STATUS, ProductCache } from './entity/product-cache.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/** Storefront page size (Shopify's `/products.json` maximum). */
const PAGE_LIMIT = 250;
/** Hard page cap — 10k products; a runaway/looping storefront must not spin forever. */
const MAX_PAGES = 40;
/** Description display cap (plain text, HTML already stripped). */
const MAX_DESCRIPTION_LEN = 2000;

export interface ProductSyncResult {
  ok: boolean;
  synced: number;
  archived: number;
  detail: string;
}

/** A product row as served by the public storefront `/products.json`. */
interface StorefrontProduct {
  id?: number;
  title?: string;
  handle?: string;
  body_html?: string | null;
  published_at?: string | null;
  vendor?: string | null;
  product_type?: string | null;
  tags?: string[] | string | null;
  variants?: Array<{ price?: string | number | null; sku?: string | null }>;
  images?: Array<{ src?: string | null }>;
}

/**
 * Strip HTML down to display-safe plain text (storefront `body_html`).
 * Exported for tests. Null when nothing readable remains.
 */
export function stripHtml(html: unknown): string | null {
  if (typeof html !== 'string' || html.trim() === '') return null;
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, MAX_DESCRIPTION_LEN) : null;
}

/**
 * Product catalog sync from the tenant storefront's PUBLIC `/products.json`
 * (PLN-260807-IvyusaApp-Revamp F1, A-1). No Shopify Admin API, no new scopes:
 * the same pages any shopper's browser can read.
 *
 * - Upserts by (tenant_id, handle); rows a COMPLETE run no longer sees flip to
 *   'archived' (never hard-deleted). An aborted run archives nothing — a
 *   storefront hiccup must not blank the catalog.
 * - Initial fill: on boot, any tenant with a storefront and zero cached rows
 *   gets a detached sync (setImmediate — boot is never blocked).
 * - Steady state: PRODUCT_SYNC_INTERVAL_MIN scheduler (0/unset = disabled),
 *   same pattern as order/scheduled-shopify-sync.service.ts.
 */
@Injectable()
export class ProductSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProductSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(ProductCache) private readonly productRepo: Repository<ProductCache>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(IntegrationCredential)
    private readonly credRepo: Repository<IntegrationCredential>,
  ) {}

  onModuleInit(): void {
    const minutes = Number(process.env.PRODUCT_SYNC_INTERVAL_MIN ?? '0');
    if (Number.isFinite(minutes) && minutes > 0) {
      this.logger.log(`Product auto-sync enabled — every ${minutes} min`);
      this.timer = setInterval(() => void this.runAll(), minutes * 60_000);
      this.timer.unref?.(); // don't keep the process alive for the timer
    } else {
      this.logger.log('Product auto-sync disabled (set PRODUCT_SYNC_INTERVAL_MIN to enable)');
    }
    // Initial catalog fill — detached so a slow storefront never blocks boot.
    setImmediate(() => {
      void this.initialSyncAll().catch((e) =>
        this.logger.warn(`initial product sync failed: ${(e as Error).message}`),
      );
    });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Tenants whose catalogue comes from Cafe24, not a Shopify storefront.
   *
   * `/products.json` is a Shopify route: a Cafe24 mall answers it with a 404 HTML
   * page (measured on amoebaorder.cafe24.com), so polling one produces nothing
   * but an `aborted:` warning every tick. Their catalogue arrives through
   * Cafe24ProductSyncService instead.
   *
   * Compared as strings, not numbers. `Tenant.id` is a bigint PK with no
   * transformer, so TypeORM hands it back as a string, while the credential's
   * `tenant_id` carries `bigintTransformer` and arrives as a number — a
   * `Set<number>.has('3')` miss that let the Cafe24 tenant get crawled anyway
   * (measured on staging: `Initial product sync tenant 3: aborted: HTTP 404`).
   */
  private async cafe24TenantIds(): Promise<Set<string>> {
    const creds = await this.credRepo.find({
      where: { provider: INTEGRATION_PROVIDER.CAFE24 },
      select: ['tenantId'],
    });
    return new Set(creds.filter((c) => c.tenantId != null).map((c) => String(c.tenantId)));
  }

  /** First-boot fill: sync each storefront-capable tenant that has no cached products yet. */
  async initialSyncAll(): Promise<void> {
    const tenants = await this.tenantRepo.find();
    const cafe24 = await this.cafe24TenantIds();
    for (const tenant of tenants) {
      if (cafe24.has(String(tenant.id))) continue;
      if (!tenant.storefrontUrl && !tenant.shopDomain) continue;
      const count = await this.productRepo.count({ where: { tenantId: tenant.id } });
      if (count > 0) continue;
      try {
        const res = await this.syncTenant(tenant);
        this.logger.log(`Initial product sync tenant ${tenant.id}: ${res.detail}`);
      } catch (e) {
        this.logger.warn(`Initial product sync tenant ${tenant.id} failed: ${(e as Error).message}`);
      }
    }
  }

  /** Scheduled tick: sync every storefront-capable tenant; per-tenant failures isolated. */
  async runAll(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous product auto-sync still running — skipping this tick');
      return;
    }
    this.running = true;
    try {
      const tenants = await this.tenantRepo.find();
      const cafe24 = await this.cafe24TenantIds();
      for (const tenant of tenants) {
        if (cafe24.has(String(tenant.id))) continue;
        if (!tenant.storefrontUrl && !tenant.shopDomain) continue;
        try {
          const res = await this.syncTenant(tenant);
          this.logger.log(`Product auto-sync tenant ${tenant.id}: ${res.detail}`);
        } catch (e) {
          this.logger.warn(`Product auto-sync tenant ${tenant.id} failed: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Admin trigger entry point — resolves the tenant, then runs a full sync. */
  async syncTenantById(tenantId: number): Promise<ProductSyncResult> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    if ((await this.cafe24TenantIds()).has(String(tenant.id))) {
      return {
        ok: false,
        synced: 0,
        archived: 0,
        detail: 'This tenant’s catalogue comes from Cafe24 — use the Cafe24 product sync',
      };
    }
    return this.syncTenant(tenant);
  }

  /**
   * Full catalog sync for one tenant. Aborts (warn, ok:false) on non-200,
   * non-JSON, or a password-page redirect; only a COMPLETE run archives rows
   * the storefront no longer serves.
   */
  async syncTenant(tenant: Tenant): Promise<ProductSyncResult> {
    const origin = (tenant.storefrontUrl ?? `https://${tenant.shopDomain}`).trim().replace(/\/+$/, '');
    const existing = await this.productRepo.find({ where: { tenantId: tenant.id } });
    const byHandle = new Map(existing.map((p) => [p.handle, p]));
    const seen = new Set<string>();
    const now = new Date();
    let synced = 0;
    let complete = false;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${origin}/products.json?limit=${PAGE_LIMIT}&page=${page}`;
      let res: Response;
      try {
        res = await fetch(url, { headers: { accept: 'application/json' } });
      } catch (e) {
        return this.abort(tenant.id, synced, `fetch failed on page ${page}: ${(e as Error).message}`);
      }
      // A password-protected storefront redirects /products.json to /password.
      if (res.url && res.url.includes('/password')) {
        return this.abort(tenant.id, synced, 'storefront is password-protected (redirected to /password)');
      }
      if (res.status !== 200) {
        return this.abort(tenant.id, synced, `HTTP ${res.status} on page ${page}`);
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return this.abort(tenant.id, synced, `non-JSON response on page ${page}`);
      }
      const products = (body as { products?: unknown })?.products;
      if (!Array.isArray(products)) {
        return this.abort(tenant.id, synced, `unexpected payload shape on page ${page}`);
      }
      if (products.length === 0) {
        complete = true;
        break;
      }
      for (const raw of products as StorefrontProduct[]) {
        const upserted = await this.upsertProduct(tenant.id, origin, byHandle, raw, now, seen);
        if (upserted) synced += 1;
      }
      if (products.length < PAGE_LIMIT) {
        complete = true;
        break;
      }
    }

    let archived = 0;
    if (complete) {
      for (const row of byHandle.values()) {
        if (seen.has(row.handle) || row.status === PRODUCT_STATUS.ARCHIVED) continue;
        row.status = PRODUCT_STATUS.ARCHIVED;
        await this.productRepo.save(row);
        archived += 1;
      }
    } else {
      this.logger.warn(
        `product sync tenant ${tenant.id}: page cap (${MAX_PAGES}) reached — run incomplete, skipping archive pass`,
      );
    }
    return {
      ok: true,
      synced,
      archived,
      detail: `Synced ${synced} product(s), archived ${archived}${complete ? '' : ' (incomplete: page cap)'}`,
    };
  }

  /** Map one storefront product onto the cache row (upsert by tenant+handle). */
  private async upsertProduct(
    tenantId: number,
    origin: string,
    byHandle: Map<string, ProductCache>,
    raw: StorefrontProduct,
    now: Date,
    seen: Set<string>,
  ): Promise<boolean> {
    const handle = typeof raw.handle === 'string' ? raw.handle.trim().slice(0, 255) : '';
    if (!handle || seen.has(handle)) return false;
    seen.add(handle);

    const mapped: Partial<ProductCache> = {
      // Join key for order lines (P4) — present in the payload all along.
      externalId: raw.id != null ? String(raw.id).slice(0, 64) : null,
      title: String(raw.title || handle).slice(0, 255),
      vendor: raw.vendor ? String(raw.vendor).slice(0, 128) : null,
      category: raw.product_type ? String(raw.product_type).slice(0, 128) : null,
      tags: this.joinTags(raw.tags),
      description: stripHtml(raw.body_html),
      price: this.firstVariantPrice(raw),
      sku: this.firstVariantSku(raw),
      imageUrl: raw.images?.[0]?.src ? String(raw.images[0].src).slice(0, 1024) : null,
      productUrl: `${origin}/products/${handle}`.slice(0, 1024),
      publishedAt: this.parseDate(raw.published_at),
      status: PRODUCT_STATUS.ACTIVE,
      syncedAt: now,
    };

    const found = byHandle.get(handle);
    if (found) {
      Object.assign(found, mapped);
      await this.productRepo.save(found);
      return true;
    }
    const created = await this.productRepo.save(
      this.productRepo.create({ tenantId, handle, ...mapped }),
    );
    byHandle.set(handle, created);
    return true;
  }

  /** Storefronts serve tags as an array OR a comma string — normalize to one comma string. */
  private joinTags(tags: StorefrontProduct['tags']): string | null {
    const joined = Array.isArray(tags)
      ? tags.map((t) => String(t).trim()).filter(Boolean).join(', ')
      : typeof tags === 'string'
        ? tags.trim()
        : '';
    return joined ? joined.slice(0, 1024) : null;
  }

  private firstVariantPrice(raw: StorefrontProduct): number | null {
    const price = Number(raw.variants?.[0]?.price);
    return Number.isFinite(price) ? price : null;
  }

  /**
   * First non-empty variant SKU — not `variants[0].sku`. A product whose first
   * variant is a placeholder ("Default Title" with no SKU) still carries real
   * codes on the variants that follow, and taking position 0 would drop them.
   */
  private firstVariantSku(raw: StorefrontProduct): string | null {
    for (const v of raw.variants ?? []) {
      const sku = typeof v?.sku === 'string' ? v.sku.trim() : '';
      if (sku) return sku.slice(0, 64);
    }
    return null;
  }

  private parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private abort(tenantId: number, synced: number, reason: string): ProductSyncResult {
    this.logger.warn(`product sync tenant ${tenantId} aborted: ${reason}`);
    return { ok: false, synced, archived: 0, detail: `aborted: ${reason}` };
  }
}
