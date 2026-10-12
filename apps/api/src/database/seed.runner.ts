import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import { BCRYPT_ROUNDS } from '../global/constant/security.constant';
import { Tenant } from '../domain/tenant/entity/tenant.entity';
import { AdminUser } from '../domain/auth/entity/admin-user.entity';
import { User } from '../domain/user/entity/user.entity';
import { JobLabel } from '../domain/user/entity/job-label.entity';
import { UserJobLabel } from '../domain/user/entity/user-job-label.entity';
import { AiEngine } from '../domain/ai-engine/entity/ai-engine.entity';
import { TenantAiSetting } from '../domain/ai-engine/entity/tenant-ai-setting.entity';
import { TenantAiConfig } from '../domain/ai-engine/entity/tenant-ai-config.entity';
import { AiAgent } from '../domain/ai-engine/entity/ai-agent.entity';
import { DEFAULT_PERSONA, DEFAULT_SCENARIO_BUTTONS } from '../domain/ai-engine/ai-config.service';
import { ContentFilterRule } from '../domain/moderation/entity/content-filter-rule.entity';
import { KbDocument } from '../domain/knowledge/entity/kb-document.entity';
import { Customer } from '../domain/customer/entity/customer.entity';
import { OrderCache } from '../domain/order/entity/order-cache.entity';
import { OrderItem } from '../domain/order/entity/order-item.entity';
import { Fulfillment } from '../domain/order/entity/fulfillment.entity';
import { Notification } from '../domain/notification/entity/notification.entity';
import { IntegrationStatusEntity } from '../domain/integration/entity/integration-status.entity';

/**
 * Functions given an explicit stub row at bootstrap.
 *
 * 'coach' is deliberately absent. Seeding it would pin coaching to the stub
 * forever: once a row exists, the gateway stops inheriting, so a tenant that
 * later points chat/rag at a real provider would keep getting canned stub text
 * from the coaching channel with nothing in the console to explain it. Left
 * unset, coach inherits rag→chat (FUNCTION_INHERITS in ai-gateway.service) and
 * the settings page shows it as inherited.
 */
const AI_FUNCTIONS = ['chat', 'rag', 'summary', 'assist', 'moderation'];

/**
 * Output ceiling per function. Left unset the gateway falls back to 1024 for
 * everything, which is both too much for the JSON-only calls and — for a
 * channel that rewrites a whole message — the only thing standing between a
 * long reply and a truncated one. Providers bill actual output tokens, so
 * these are truncation guards, not a cost lever.
 *
 * `moderation` stays high on purpose: the same engine runs the `rephrase`
 * action, which rewrites a full outbound message, not a verdict.
 */
const AI_FUNCTION_MAX_TOKENS: Record<string, number> = {
  chat: 512, // intent classification + KB conflict verdict — JSON only
  rag: 1024, // the customer-facing answer
  summary: 512,
  assist: 512, // agent briefing
  moderation: 1024, // verdict JSON *and* full-message rephrase
};

export interface SeedOptions {
  /** Bootstrap password for admin@ / dev@ (default from SEED_PASSWORD or 'amb2026!@'). */
  password?: string;
  /** Seed demo customer/orders/notifications (default true; set false for clean prod). */
  includeDemoData?: boolean;
  /** Baseline KB to seed: 'us-cosmetics' (default, current behaviour) or 'none' (REQ-260913 G11). */
  kbProfile?: 'us-cosmetics' | 'none';
}

/**
 * Idempotent bootstrap seed (FR-062) operating on an existing DataSource. Used by
 * the CLI (`npm run db:seed`) and the optional SEED_ON_BOOT hook in main.ts so
 * staging/production can self-bootstrap without ts-node in the runtime image.
 */
export async function runSeed(ds: DataSource, opts: SeedOptions = {}): Promise<void> {
  const logger = new Logger('Seed');
  const password = opts.password ?? process.env.SEED_PASSWORD ?? 'amb2026!@';
  const includeDemoData = opts.includeDemoData ?? process.env.SEED_DEMO_DATA !== 'false';
  const kbProfile = opts.kbProfile ?? (process.env.SEED_KB_PROFILE === 'none' ? 'none' : 'us-cosmetics');
  if (kbProfile === 'none') logger.log('SEED_KB_PROFILE=none — baseline KB documents skipped');
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const tenantRepo = ds.getRepository(Tenant);
  let tenant = await tenantRepo.findOne({ where: { name: 'ivyusa' } });
  if (!tenant) {
    tenant = await tenantRepo.save(
      tenantRepo.create({
        uuid: randomUUID(),
        shopDomain: 'ivyusa.myshopify.com',
        slug: 'ivyusa',
        name: 'ivyusa',
        status: 'active',
        plan: 'custom',
      }),
    );
  } else {
    // Rows predating the slug/uuid columns get their identifiers backfilled.
    let dirty = false;
    if (!tenant.slug) {
      tenant.slug = 'ivyusa';
      dirty = true;
    }
    if (!tenant.uuid) {
      tenant.uuid = randomUUID();
      dirty = true;
    }
    if (dirty) tenant = await tenantRepo.save(tenant);
  }

  // System admin + tenant master — bootstrap credentials (re)asserted each run.
  const adminRepo = ds.getRepository(AdminUser);
  const admin =
    (await adminRepo.findOne({ where: { email: 'admin@amoeba.group' } })) ??
    adminRepo.create({ email: 'admin@amoeba.group', level: 'super_admin', status: 'active' });
  admin.passwordHash = hash;
  admin.mustChangePassword = 1;
  await adminRepo.save(admin);

  const userRepo = ds.getRepository(User);
  const master =
    (await userRepo.findOne({ where: { tenantId: tenant.id, email: 'dev@amoeba.group' } })) ??
    userRepo.create({ tenantId: tenant.id, email: 'dev@amoeba.group', name: 'Master Owner', rank: 'master', status: 'active' });
  master.passwordHash = hash;
  master.mustChangePassword = 1;
  await userRepo.save(master);

  // Job labels + assign all to master
  const labelRepo = ds.getRepository(JobLabel);
  const ujlRepo = ds.getRepository(UserJobLabel);
  for (const [code, name] of [
    ['consult', '상담'],
    ['accounting', '회계'],
    ['operations', '운영'],
    ['sales_admin', '영업관리'], // PLN-261007
  ]) {
    let label = await labelRepo.findOne({ where: { tenantId: tenant.id, code } });
    if (!label) label = await labelRepo.save(labelRepo.create({ tenantId: tenant.id, code, name }));
    if (!(await ujlRepo.findOne({ where: { userId: master.id, jobLabelId: label.id } }))) {
      await ujlRepo.save(ujlRepo.create({ userId: master.id, jobLabelId: label.id }));
    }
  }

  // AI engines: platform stub default + anthropic
  const engineRepo = ds.getRepository(AiEngine);
  let stub = await engineRepo.findOne({ where: { provider: 'stub', isDefault: 1 } });
  if (!stub) {
    stub = await engineRepo.save(
      engineRepo.create({ tenantId: null, provider: 'stub', name: 'Built-in Stub', model: 'stub-1', capabilities: 'chat,rag,summary,assist,moderation', status: 'enabled', isDefault: 1 }),
    );
  }
  if (!(await engineRepo.findOne({ where: { provider: 'anthropic' } }))) {
    await engineRepo.save(
      engineRepo.create({ tenantId: null, provider: 'anthropic', name: 'Anthropic Claude', model: 'claude-opus-4-8', capabilities: 'chat,rag,summary,assist,moderation', status: 'enabled', isDefault: 0 }),
    );
  }

  const settingRepo = ds.getRepository(TenantAiSetting);
  for (const fn of AI_FUNCTIONS) {
    if (!(await settingRepo.findOne({ where: { tenantId: tenant.id, func: fn } }))) {
      await settingRepo.save(
        settingRepo.create({
          tenantId: tenant.id,
          func: fn,
          engineId: stub.id,
          paramsJson: { temperature: 0.3, max_tokens: AI_FUNCTION_MAX_TOKENS[fn] ?? 1024 },
        }),
      );
    }
  }

  const ruleRepo = ds.getRepository(ContentFilterRule);
  if ((await ruleRepo.count({ where: { tenantId: tenant.id } })) === 0) {
    await ruleRepo.save([
      ruleRepo.create({ tenantId: tenant.id, scope: 'both', type: 'word', patternOrPrompt: 'guarantee', severity: 'med', action: 'warn', isActive: 1 }),
      ruleRepo.create({ tenantId: tenant.id, scope: 'both', type: 'context', patternOrPrompt: 'Flag medical/legal advice or unverifiable refund promises.', severity: 'high', action: 'block', isActive: 1 }),
    ]);
  }

  // Seeded knowledge is written by hand, so it carries no source: it never came
  // through a pipe (REQ-260826 R5). It used to be filed under a board source,
  // which meant un-designating that one source took a tenant's entire baseline
  // policy out of retrieval — a lever nobody would expect to find there.
  // Existing rows keep their source id; the value is harmless while the source
  // stays designated, and an irreversible UPDATE to tidy a fact is not worth it.
  const kbRepo = ds.getRepository(KbDocument);
  if (kbProfile !== 'none' && (await kbRepo.count({ where: { tenantId: tenant.id } })) === 0) {
    const docs = [
      ['policy', 'Shipping & Delivery', 'Orders ship within 1-2 business days. Standard delivery is 3-5 business days in the US. You can track your order from the Orders panel once it ships.'],
      ['policy', 'Returns & Exchanges', 'Items can be returned within 7 days of receipt if unopened and unused. Opened or out-of-window items require a support agent. (POL-005)'],
      ['warranty', 'Warranty (Electronics & Hair Tools)', 'Electronics and hair tools include a category-specific limited warranty. Other categories follow the general return/refund policy. (POL-006)'],
      ['faq', 'Order Cancellation', 'Orders can be canceled before they enter preparing status. After shipping, please request a return instead.'],
      ['product', 'Product Usage & Ingredients', 'Product usage instructions and full ingredient lists are available on each product detail page and in this help center.'],
    ];
    for (const [category, title, content] of docs) {
      const doc = await kbRepo.save(kbRepo.create({ tenantId: tenant.id, source: 'knowledge_store', category, title, content, active: 1, status: 'embedded' }));
      doc.embeddingRef = `emb_${doc.id}`;
      await kbRepo.save(doc);
    }
  }

  // CS policy reference docs — US cosmetics industry standard (research-based draft).
  // Source summary: docs/guide/KB-US-Cosmetics-CS-Policy-Reference-20260707.md.
  // Idempotent per title so already-seeded databases pick these up on re-seed.
  // NOTE: the 30-day window below intentionally follows the US industry standard and
  // conflicts with the legacy 'Returns & Exchanges' doc (POL-005, 7 days) — see the
  // Open Issues section of the reference doc for the pending decision.
  const csPolicyDocs = [
    ['policy', 'CS Policy — Returns (US Cosmetics Standard)', 'Returns are accepted within 30 days of purchase for products in new or gently used condition, with proof of purchase (order number, confirmation email, or account lookup). Refunds go to the original payment method. Return shipping is free with our prepaid label. Original shipping fees are non-refundable unless the return results from our error. Items outside the 30-day window, without proof of purchase, or in worse than gently used condition may be declined. Return activity is monitored for abuse. (US industry standard: Sephora and Ulta both use a 30-day window and accept gently used cosmetics.)'],
    ['policy', 'CS Policy — Exchanges', 'Exchanges are accepted within 30 days for items in new or gently used condition. The fastest option is to return the original item for a refund and place a new order for the desired shade, size, or product. A direct exchange ships once the returned item is received and inspected. Items that arrive damaged, defective, or incorrect are replaced free of charge, including shipping.'],
    ['faq', 'CS Policy — Order Cancellation', 'Orders can be canceled free of charge before they enter preparing status — typically within about 1 hour of placement. Orders cannot be modified after checkout (address, items, payment); cancel and reorder instead. Once an order ships it can no longer be canceled; please request a return after delivery. Canceled orders are refunded in full to the original payment method; card pre-authorizations drop off within 1-7 business days.'],
    ['policy', 'CS Policy — Refunds (Method & Timeline)', 'Refunds are issued to the original payment method: card purchases back to the card, PayPal to PayPal, gift card purchases as store credit. Card refunds are typically processed within 5-10 business days after the return is received and inspected; mail-in returns can take up to 30 days end to end. Gift returns are issued as store credit to the recipient. Loyalty points earned on the purchase are removed when the refund is processed. Original shipping charges are refunded only when the return results from our error.'],
    ['policy', 'CS Policy — Final Sale & Non-returnable Items', 'Gift cards, items marked final sale, and certain intimate or hygiene-sensitive care items cannot be returned or exchanged. Products that are more than gently used, missing original components, or unsellable for hygiene reasons are not eligible. Opened cosmetics are returnable only in gently used condition within the 30-day window. Final-sale status is shown on the product page and at checkout before purchase.'],
    ['faq', 'CS Policy — Damaged, Defective, or Wrong Items', 'If an item arrives damaged, defective, or different from what was ordered, contact support within 7 days of delivery with the order number and a photo of the item and packaging. We arrange a free replacement or a full refund including shipping. Please keep the item and packaging until the claim is resolved. Claims for parcels delivered to a parcel-forwarding address may not be eligible.'],
    ['policy', 'CS Policy — US Compliance Notes', 'Agent reference. California Civil Code 1723: a return policy stricter than a 7-day full refund/equal exchange must be conspicuously disclosed before purchase (online: a clear policy page link); if not disclosed, customers may return within 7 days. Exemptions include perishables, final-sale items, and goods unsellable for health reasons. FTC Mail/Internet Order Rule: if we cannot ship within the promised time (30 days if none stated), we must notify the customer and offer cancellation with a prompt full refund.'],
  ];
  for (const [category, title, content] of kbProfile === 'none' ? [] : csPolicyDocs) {
    if (!(await kbRepo.findOne({ where: { tenantId: tenant.id, title } }))) {
      const doc = await kbRepo.save(kbRepo.create({ tenantId: tenant.id, source: 'knowledge_store', category, title, content, active: 1, status: 'embedded' }));
      doc.embeddingRef = `emb_${doc.id}`;
      await kbRepo.save(doc);
    }
  }

  // Tenant AI config: persona, response rules, scenario buttons (FR-047/FN-040)
  const aiConfigRepo = ds.getRepository(TenantAiConfig);
  if (!(await aiConfigRepo.findOne({ where: { tenantId: tenant.id } }))) {
    await aiConfigRepo.save(
      aiConfigRepo.create({
        tenantId: tenant.id,
        persona: DEFAULT_PERSONA,
        rules: [
          'Be concise, friendly, and professional.',
          'Answer only from the knowledge base; never invent policies.',
          'Offer to connect a human agent when unsure or out of scope.',
        ],
        scenarioButtons: DEFAULT_SCENARIO_BUTTONS,
      }),
    );
  }

  // Default AI agent (PLN-260820): persona/rules live per-agent now; the
  // default row is the routing fallback every unpinned session answers as.
  const aiAgentRepo = ds.getRepository(AiAgent);
  if (!(await aiAgentRepo.findOne({ where: { tenantId: tenant.id, isDefault: 1 } }))) {
    const cfg = await aiConfigRepo.findOne({ where: { tenantId: tenant.id } });
    await aiAgentRepo.save(
      aiAgentRepo.create({
        tenantId: tenant.id,
        code: 'default',
        name: 'Default',
        persona: cfg?.persona ?? DEFAULT_PERSONA,
        rules: cfg?.rules ?? null,
        active: 1,
        isDefault: 1,
      }),
    );
  }

  const intRepo = ds.getRepository(IntegrationStatusEntity);
  for (const name of ['shopify', 'fulfillment', 'klaviyo', 'odoo', 'google_drive']) {
    if (!(await intRepo.findOne({ where: { name } }))) {
      await intRepo.save(intRepo.create({ name, status: 'connected', detail: 'Seeded (mock)' }));
    }
  }

  if (includeDemoData) {
    const customerRepo = ds.getRepository(Customer);
    let customer = await customerRepo.findOne({ where: { tenantId: tenant.id, email: 'shopper@example.com' } });
    if (!customer) {
      customer = await customerRepo.save(
        customerRepo.create({ tenantId: tenant.id, email: 'shopper@example.com', name: 'Demo Shopper', tier: 'regular', shopifyCustomerId: 'shopify-cust-1' }),
      );
    }
    const orderRepo = ds.getRepository(OrderCache);
    const itemRepo = ds.getRepository(OrderItem);
    const fulfillRepo = ds.getRepository(Fulfillment);
    if ((await orderRepo.count({ where: { customerId: customer.id } })) === 0) {
      const o1 = await orderRepo.save(orderRepo.create({ shopifyOrderId: 'shopify-1001', customerId: customer.id, orderNumber: 'IVY-1001', statusInternal: 'shipping', statusUi: 'In Transit', total: 79.0, currency: 'USD' }));
      await itemRepo.save(itemRepo.create({ orderId: o1.id, productId: 'prod-burgundy', title: 'IVY Signature Hair Tool', optionText: 'Burgundy / 6-8', qty: 1, price: 79.0 }));
      await fulfillRepo.save(fulfillRepo.create({ orderId: o1.id, status: 'in_transit', trackingNumber: '1Z999AA10123456784', carrier: 'UPS' }));
      const o2 = await orderRepo.save(orderRepo.create({ shopifyOrderId: 'shopify-1002', customerId: customer.id, orderNumber: 'IVY-1002', statusInternal: 'delivered', statusUi: 'Delivered', total: 32.5, currency: 'USD' }));
      await itemRepo.save(itemRepo.create({ orderId: o2.id, productId: 'prod-serum', title: 'IVY Repair Serum', optionText: '50ml', qty: 1, price: 32.5 }));
      await fulfillRepo.save(fulfillRepo.create({ orderId: o2.id, status: 'delivered', trackingNumber: '1Z999AA10123456785', carrier: 'UPS' }));
    }
    const notifRepo = ds.getRepository(Notification);
    if ((await notifRepo.count({ where: { customerId: customer.id } })) === 0) {
      await notifRepo.save([
        notifRepo.create({ customerId: customer.id, category: 'shipping', title: 'Your order is on the way', body: 'IVY-1001 shipped via UPS.', statusBadge: 'In Transit', channel: 'in_app' }),
        notifRepo.create({ customerId: customer.id, category: 'review', title: 'How was your order?', body: 'Leave a review for IVY-1002.', statusBadge: 'Review', channel: 'in_app' }),
      ]);
    }
  }

  // Backfill tenant_id on tenant-scoped tables (rows created outside a request context).
  const tenantScopedTables = [
    'sessions', 'conversations', 'messages', 'orders_cache', 'order_items',
    'fulfillments', 'notifications', 'notification_prefs', 'reviews', 'affiliates',
    'subscriptions', 'restock_subscriptions', 'inquiries', 'cjm_events', 'campaigns',
  ];
  for (const table of tenantScopedTables) {
    await ds.query(`UPDATE ${table} SET tenant_id = ? WHERE tenant_id IS NULL`, [tenant.id]);
  }

  logger.log('Seed complete (tenant=ivyusa, admin@amoeba.group / dev@amoeba.group).');
}
