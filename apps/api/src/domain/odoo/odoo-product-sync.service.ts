import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { INTEGRATION_PROVIDER } from '@sharptalk/types';
import { PRODUCT_STATUS, ProductCache } from '../product/entity/product-cache.entity';
import { stripHtml } from '../product/product-sync.service';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { decryptSecret } from '../../global/util/crypto.util';
import { IntegrationService } from '../integration/integration.service';
import { OdooClient, OdooConfig, OdooProduct } from './odoo.client';

/** product.template rows per page. Odoo has no offset ceiling like Cafe24. */
const PAGE_LIMIT = 200;
/** Runaway guard: 100 pages × 200 = 20k products. */
const MAX_PAGES = 100;
/** Handles this sync owns — keeps the archive pass off other sources' rows. */
const HANDLE_PREFIX = 'odoo-';

export interface OdooProductSyncResult {
  ok: boolean;
  synced: number;
  archived: number;
  detail: string;
}

/**
 * Odoo catalogue → `products_cache` (REQ/PLN-260826, W2).
 *
 * Mirrors `Cafe24ProductSyncService`: the rest of the product-knowledge pipeline
 * is already provider-agnostic (`CatalogSyncService` turns `products_cache` into
 * `kb_documents` for RAG), so the only missing step for an Odoo shop was filling
 * the cache. Two mapping decisions carry the feature:
 * - `handle` is `odoo-{template_id}`, never a name slug — the KB document keys on
 *   the handle, so a renamed product must not become a second document.
 * - `tags` is always the category path when present, so a product with a thin
 *   `description_sale` still reaches the knowledge base (the converter holds back
 *   only products that are thin AND tagless).
 *
 * Image bytes are never pulled; `image_url` is the stable Odoo web-image route
 * (`/web/image/product.template/{id}/image_1920`), which serves a placeholder
 * when the product has no image.
 */
@Injectable()
export class OdooProductSyncService {
  private readonly logger = new Logger(OdooProductSyncService.name);

  constructor(
    @InjectRepository(ProductCache) private readonly productRepo: Repository<ProductCache>,
    @InjectRepository(IntegrationCredential)
    private readonly credRepo: Repository<IntegrationCredential>,
    private readonly client: OdooClient,
    private readonly integration: IntegrationService,
  ) {}

  private async getConfig(tenantId: number): Promise<OdooConfig | null> {
    const cred = await this.credRepo.findOne({
      where: { tenantId, provider: INTEGRATION_PROVIDER.ODOO },
    });
    if (!cred?.secretEnc) return null;
    try {
      const c = JSON.parse(decryptSecret(cred.secretEnc)) as Partial<OdooConfig>;
      if (!c.url || !c.db || !c.username || !c.api_key) return null;
      return c as OdooConfig;
    } catch {
      return null;
    }
  }

  async syncProducts(tenantId: number): Promise<OdooProductSyncResult> {
    const config = await this.getConfig(tenantId);
    if (!config) {
      return { ok: false, synced: 0, archived: 0, detail: 'Odoo is not connected — fill in and save the credentials first' };
    }
    const base = String(config.url).trim().replace(/\/+$/, '');

    // Storefront rows only: a B2B company's products (Go2Joy room types,
    // PLN-261023) are not on this storefront and must never be archived by it.
    const existing = await this.productRepo.find({ where: { tenantId, companyId: IsNull() } });
    const byHandle = new Map(existing.map((p) => [p.handle, p]));
    const seen = new Set<string>();
    const now = new Date();
    let written = 0;
    let complete = false;

    try {
      const uid = await this.client.authenticate(config);
      const currency = (await this.client.companyCurrency(config, uid)) ?? 'USD';

      for (let page = 0; page < MAX_PAGES; page++) {
        const products = await this.client.pullProducts(config, uid, {
          offset: page * PAGE_LIMIT,
          limit: PAGE_LIMIT,
        });
        if (products.length === 0) {
          complete = true;
          break;
        }
        for (const raw of products) {
          if (await this.upsertProduct(tenantId, base, currency, byHandle, raw, now, seen)) written += 1;
        }
        if (products.length < PAGE_LIMIT) {
          complete = true;
          break;
        }
      }
    } catch (e) {
      const message = (e as Error).message;
      this.logger.warn(`odoo product sync tenant ${tenantId} failed: ${message}`);
      await this.integration.upsert(INTEGRATION_PROVIDER.ODOO, written > 0 ? 'connected' : 'error', message);
      // A partial run must not archive — products it never reached are still live.
      return {
        ok: written > 0,
        synced: written,
        archived: 0,
        detail: written ? `Synced ${written} product(s), interrupted: ${message}` : `Sync failed: ${message}`,
      };
    }

    const archived = complete ? await this.archiveMissing(byHandle, seen) : 0;
    if (!complete) {
      this.logger.warn(`odoo product sync tenant ${tenantId}: page cap (${MAX_PAGES}) reached — skipping archive pass`);
    }
    this.logger.log(
      `odoo product sync tenant ${tenantId}: ${written} synced, ${archived} archived${complete ? '' : ' (incomplete)'}`,
    );
    await this.integration.upsert(INTEGRATION_PROVIDER.ODOO, 'connected', `Synced ${written} product(s)`);
    return {
      ok: true,
      synced: written,
      archived,
      detail: `Synced ${written} product(s), archived ${archived}${complete ? '' : ' (incomplete: page cap)'}`,
    };
  }

  private async upsertProduct(
    tenantId: number,
    base: string,
    currency: string,
    byHandle: Map<string, ProductCache>,
    raw: OdooProduct,
    now: Date,
    seen: Set<string>,
  ): Promise<boolean> {
    if (raw.id == null) return false;
    const handle = `${HANDLE_PREFIX}${raw.id}`;
    if (seen.has(handle)) return false;
    seen.add(handle);

    const categoryPath = Array.isArray(raw.categ_id) ? String(raw.categ_id[1]) : null;
    const websitePath = typeof raw.website_url === 'string' && raw.website_url ? raw.website_url : null;

    const mapped: Partial<ProductCache> = {
      title: String(raw.name || handle).slice(0, 255),
      description: stripHtml(raw.description_sale || null),
      // Category path doubles as tags so a thin-description product still reaches
      // the knowledge base (CatalogSyncService holds back thin AND tagless only).
      tags: categoryPath ? categoryPath.slice(0, 1024) : null,
      category: categoryPath ? categoryPath.split('/').pop()!.trim().slice(0, 128) : null,
      sku: raw.default_code ? String(raw.default_code).slice(0, 64) : null,
      price: typeof raw.list_price === 'number' ? raw.list_price : null,
      currency: currency.slice(0, 8),
      // Odoo serves a placeholder image when the product has none, so this is
      // always safe to point at — and it never pulls the base64 bytes.
      imageUrl: `${base}/web/image/product.template/${raw.id}/image_1920`.slice(0, 1024),
      productUrl: (websitePath ? `${base}${websitePath}` : `${base}/shop`).slice(0, 1024),
      status: PRODUCT_STATUS.ACTIVE, // domain filters to sale_ok & active
      syncedAt: now,
    };

    const found = byHandle.get(handle);
    if (found) {
      Object.assign(found, mapped);
      await this.productRepo.save(found);
    } else {
      const created = await this.productRepo.save(this.productRepo.create({ tenantId, handle, ...mapped }));
      byHandle.set(handle, created);
    }
    return true;
  }

  /** Rows this run owns but no longer saw — archived, never deleted. */
  private async archiveMissing(byHandle: Map<string, ProductCache>, seen: Set<string>): Promise<number> {
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
}
