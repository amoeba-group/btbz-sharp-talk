import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { INTEGRATION_PROVIDER } from '@sharptalk/types';
import { PRODUCT_STATUS, ProductCache } from '../product/entity/product-cache.entity';
import { stripHtml } from '../product/product-sync.service';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { IntegrationService } from '../integration/integration.service';
import { parseProviderConfig } from '../ecommerce/provider-config.util';
import { HaravanClient, HaravanConfig, HaravanProduct } from './haravan.client';

const HARAVAN = INTEGRATION_PROVIDER.HARAVAN;
const PAGE_LIMIT = 250;
const MAX_PAGES = 100;
const HANDLE_PREFIX = 'haravan-';

export interface HaravanProductSyncResult {
  ok: boolean;
  synced: number;
  archived: number;
  detail: string;
}

/**
 * Haravan catalogue → products_cache (REQ-260826, Woo/Haravan phase). Haravan's
 * Admin API is Shopify-compatible, so products carry a native handle, variants
 * and images. Handle is `haravan-{id}` (not the native slug) so the archive pass
 * owns only its own rows and a renamed product keeps one knowledge document.
 * The catalog→knowledge bridge (CatalogSyncService) runs unchanged.
 */
@Injectable()
export class HaravanProductSyncService {
  private readonly logger = new Logger(HaravanProductSyncService.name);

  constructor(
    @InjectRepository(ProductCache) private readonly productRepo: Repository<ProductCache>,
    @InjectRepository(IntegrationCredential)
    private readonly credRepo: Repository<IntegrationCredential>,
    private readonly client: HaravanClient,
    private readonly integration: IntegrationService,
  ) {}

  private async getConfig(tenantId: number): Promise<HaravanConfig | null> {
    const cred = await this.credRepo.findOne({ where: { tenantId, provider: HARAVAN } });
    return parseProviderConfig<HaravanConfig>(cred?.secretEnc, ['shop_domain', 'access_token']);
  }

  async syncProducts(tenantId: number): Promise<HaravanProductSyncResult> {
    const config = await this.getConfig(tenantId);
    if (!config) {
      return { ok: false, synced: 0, archived: 0, detail: 'Haravan is not connected — fill in and save the credentials first' };
    }
    const host = String(config.shop_domain).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');

    // Storefront rows only: a B2B company's products (Go2Joy room types,
    // PLN-261023) are not on this storefront and must never be archived by it.
    const existing = await this.productRepo.find({ where: { tenantId, companyId: IsNull() } });
    const byHandle = new Map(existing.map((p) => [p.handle, p]));
    const seen = new Set<string>();
    const now = new Date();
    let written = 0;
    let complete = false;

    try {
      const currency = (await this.client.shopCurrency(config)) ?? 'USD';
      for (let page = 1; page <= MAX_PAGES; page++) {
        const products = await this.client.pullProducts(config, { page, limit: PAGE_LIMIT });
        if (products.length === 0) {
          complete = true;
          break;
        }
        for (const raw of products) {
          if (await this.upsertProduct(tenantId, host, currency, byHandle, raw, now, seen)) written += 1;
        }
        if (products.length < PAGE_LIMIT) {
          complete = true;
          break;
        }
      }
    } catch (e) {
      const message = (e as Error).message;
      this.logger.warn(`haravan product sync tenant ${tenantId} failed: ${message}`);
      await this.integration.upsert(HARAVAN, written > 0 ? 'connected' : 'error', message);
      return {
        ok: written > 0,
        synced: written,
        archived: 0,
        detail: written ? `Synced ${written} product(s), interrupted: ${message}` : `Sync failed: ${message}`,
      };
    }

    const archived = complete ? await this.archiveMissing(byHandle, seen) : 0;
    this.logger.log(`haravan product sync tenant ${tenantId}: ${written} synced, ${archived} archived`);
    await this.integration.upsert(HARAVAN, 'connected', `Synced ${written} product(s)`);
    return {
      ok: true,
      synced: written,
      archived,
      detail: `Synced ${written} product(s), archived ${archived}${complete ? '' : ' (incomplete: page cap)'}`,
    };
  }

  private async upsertProduct(
    tenantId: number,
    host: string,
    currency: string,
    byHandle: Map<string, ProductCache>,
    raw: HaravanProduct,
    now: Date,
    seen: Set<string>,
  ): Promise<boolean> {
    if (raw.id == null) return false;
    const handle = `${HANDLE_PREFIX}${raw.id}`;
    if (seen.has(handle)) return false;
    seen.add(handle);

    const variant = raw.variants?.[0];
    const image = raw.images?.find((i) => i.src)?.src ?? null;
    const tagList = [raw.tags, raw.product_type].map((t) => (t ?? '').trim()).filter(Boolean).join(', ');
    const price = variant?.price != null && !Number.isNaN(Number(variant.price)) ? Number(variant.price) : null;

    const mapped: Partial<ProductCache> = {
      title: String(raw.title || handle).slice(0, 255),
      vendor: raw.vendor ? String(raw.vendor).slice(0, 128) : null,
      description: stripHtml(raw.body_html || null),
      tags: tagList ? tagList.slice(0, 1024) : null,
      category: raw.product_type ? String(raw.product_type).slice(0, 128) : null,
      sku: variant?.sku ? String(variant.sku).slice(0, 64) : null,
      price,
      currency: currency.slice(0, 8),
      imageUrl: image ? String(image).slice(0, 1024) : null,
      productUrl: raw.handle ? `https://${host}/products/${raw.handle}`.slice(0, 1024) : null,
      publishedAt: raw.published_at ? new Date(raw.published_at) : null,
      status: raw.published_at ? PRODUCT_STATUS.ACTIVE : PRODUCT_STATUS.ARCHIVED,
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
