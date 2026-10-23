import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { INTEGRATION_PROVIDER } from '@sharptalk/types';
import { PRODUCT_STATUS, ProductCache } from '../product/entity/product-cache.entity';
import { stripHtml } from '../product/product-sync.service';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { IntegrationService } from '../integration/integration.service';
import { parseProviderConfig } from '../ecommerce/provider-config.util';
import { WooClient, WooConfig, WooProduct } from './woocommerce.client';

const WOO = INTEGRATION_PROVIDER.WOOCOMMERCE;
const PAGE_LIMIT = 100;
const MAX_PAGES = 100;
const HANDLE_PREFIX = 'woo-';

export interface WooProductSyncResult {
  ok: boolean;
  synced: number;
  archived: number;
  detail: string;
}

/**
 * WooCommerce catalogue → products_cache (REQ-260826). Handle is `woo-{id}` so
 * the archive pass owns its own rows; the catalog→knowledge bridge runs
 * unchanged. permalink is a ready product URL; category names double as tags so
 * a thin-description product still reaches the knowledge base.
 */
@Injectable()
export class WooProductSyncService {
  private readonly logger = new Logger(WooProductSyncService.name);

  constructor(
    @InjectRepository(ProductCache) private readonly productRepo: Repository<ProductCache>,
    @InjectRepository(IntegrationCredential) private readonly credRepo: Repository<IntegrationCredential>,
    private readonly client: WooClient,
    private readonly integration: IntegrationService,
  ) {}

  private async getConfig(tenantId: number): Promise<WooConfig | null> {
    const cred = await this.credRepo.findOne({ where: { tenantId, provider: WOO } });
    return parseProviderConfig<WooConfig>(cred?.secretEnc, ['store_url', 'consumer_key', 'consumer_secret']);
  }

  async syncProducts(tenantId: number): Promise<WooProductSyncResult> {
    const config = await this.getConfig(tenantId);
    if (!config) {
      return { ok: false, synced: 0, archived: 0, detail: 'WooCommerce is not connected — fill in and save the credentials first' };
    }

    // Storefront rows only: a B2B company's products (Go2Joy room types,
    // PLN-261023) are not on this storefront and must never be archived by it.
    const existing = await this.productRepo.find({ where: { tenantId, companyId: IsNull() } });
    const byHandle = new Map(existing.map((p) => [p.handle, p]));
    const seen = new Set<string>();
    const now = new Date();
    let written = 0;
    let complete = false;

    try {
      const currency = (await this.client.storeCurrency(config)) ?? 'USD';
      for (let page = 1; page <= MAX_PAGES; page++) {
        const products = await this.client.pullProducts(config, { page, limit: PAGE_LIMIT });
        if (products.length === 0) { complete = true; break; }
        for (const raw of products) {
          if (await this.upsertProduct(tenantId, currency, byHandle, raw, now, seen)) written += 1;
        }
        if (products.length < PAGE_LIMIT) { complete = true; break; }
      }
    } catch (e) {
      const message = (e as Error).message;
      this.logger.warn(`woocommerce product sync tenant ${tenantId} failed: ${message}`);
      await this.integration.upsert(WOO, written > 0 ? 'connected' : 'error', message);
      return {
        ok: written > 0,
        synced: written,
        archived: 0,
        detail: written ? `Synced ${written} product(s), interrupted: ${message}` : `Sync failed: ${message}`,
      };
    }

    const archived = complete ? await this.archiveMissing(byHandle, seen) : 0;
    this.logger.log(`woocommerce product sync tenant ${tenantId}: ${written} synced, ${archived} archived`);
    await this.integration.upsert(WOO, 'connected', `Synced ${written} product(s)`);
    return {
      ok: true,
      synced: written,
      archived,
      detail: `Synced ${written} product(s), archived ${archived}${complete ? '' : ' (incomplete: page cap)'}`,
    };
  }

  private async upsertProduct(
    tenantId: number,
    currency: string,
    byHandle: Map<string, ProductCache>,
    raw: WooProduct,
    now: Date,
    seen: Set<string>,
  ): Promise<boolean> {
    if (raw.id == null) return false;
    const handle = `${HANDLE_PREFIX}${raw.id}`;
    if (seen.has(handle)) return false;
    seen.add(handle);

    const image = raw.images?.find((i) => i.src)?.src ?? null;
    const categoryNames = (raw.categories ?? []).map((c) => (c.name ?? '').trim()).filter(Boolean);
    const tagNames = (raw.tags ?? []).map((t) => (t.name ?? '').trim()).filter(Boolean);
    const tags = [...categoryNames, ...tagNames].join(', ');
    const price = raw.price != null && raw.price !== '' && !Number.isNaN(Number(raw.price)) ? Number(raw.price) : null;

    const mapped: Partial<ProductCache> = {
      title: String(raw.name || handle).slice(0, 255),
      description: stripHtml(raw.short_description || raw.description || null),
      tags: tags ? tags.slice(0, 1024) : null,
      category: categoryNames[0] ? categoryNames[0].slice(0, 128) : null,
      sku: raw.sku ? String(raw.sku).slice(0, 64) : null,
      price,
      currency: currency.slice(0, 8),
      imageUrl: image ? String(image).slice(0, 1024) : null,
      productUrl: raw.permalink ? String(raw.permalink).slice(0, 1024) : null,
      publishedAt: raw.date_created ? new Date(raw.date_created) : null,
      status: raw.status === 'publish' ? PRODUCT_STATUS.ACTIVE : PRODUCT_STATUS.ARCHIVED,
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
