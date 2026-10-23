import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SESSION_IDENTITY } from '@sharptalk/types';
import { Customer } from '../customer/entity/customer.entity';
import { Session } from '../session/entity/session.entity';
import { OrderCache } from '../order/entity/order-cache.entity';
import { OrderItem } from '../order/entity/order-item.entity';
import { Fulfillment } from '../order/entity/fulfillment.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';
import { Notification } from '../notification/entity/notification.entity';
import { NotificationPref } from '../notification/entity/notification-pref.entity';
import { Review } from '../review/entity/review.entity';
import { Inquiry } from '../inquiry/entity/inquiry.entity';
import { CjmEvent } from '../cjm/entity/cjm-event.entity';
import { Affiliate } from '../affiliate/entity/affiliate.entity';
import { Subscription } from '../subscription/entity/subscription.entity';
import { RestockSubscription } from '../restock/entity/restock-subscription.entity';
import { ProductSave } from '../save/entity/product-save.entity';
import { Nudge } from '../nudge/entity/nudge.entity';
import { DiaryNote } from '../diary/entity/diary-note.entity';
import { DeviceToken } from '../push/entity/device-token.entity';
import { Campaign } from '../campaign/entity/campaign.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { SessionService, sessionCacheKey } from '../session/session.service';
import { AnswerReuseService } from '../answer-reuse/answer-reuse.service';
import { AttachmentService } from '../attachment/attachment.service';
import { TenantService } from '../tenant/tenant.service';
import { ShopifyAdminClient } from '../order/shopify-admin.client';
import { ErasureSuppressionService } from './erasure-suppression.service';
import { ERASURE_SOURCE, ErasureSource } from './entity/erased-identity.entity';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { maskPii } from '../../global/util/pii.util';
import { blindIndex } from '../../global/util/crypto.util';

const REDACTED = '[redacted]';
const EXTERNAL_CHANNELS = ['email', 'sms', 'web_push', 'push'];
const PREF_CATEGORIES = ['payment', 'shipping', 'event', 'review', 'chat'];

/**
 * Privacy / consumer-rights logic (audit High-2 GDPR webhooks, High-3 DSAR/CCPA).
 * Anonymization is best-effort: PII is scrubbed while keeping referential rows
 * (orders, inquiries) for operational integrity, unlinked from the customer.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    @InjectRepository(OrderCache) private readonly orderRepo: Repository<OrderCache>,
    @InjectRepository(OrderItem) private readonly orderItemRepo: Repository<OrderItem>,
    @InjectRepository(Fulfillment) private readonly fulfillmentRepo: Repository<Fulfillment>,
    @InjectRepository(Conversation) private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly messageRepo: Repository<Message>,
    @InjectRepository(Notification) private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(NotificationPref) private readonly prefRepo: Repository<NotificationPref>,
    @InjectRepository(Review) private readonly reviewRepo: Repository<Review>,
    @InjectRepository(Inquiry) private readonly inquiryRepo: Repository<Inquiry>,
    @InjectRepository(CjmEvent) private readonly cjmRepo: Repository<CjmEvent>,
    @InjectRepository(Affiliate) private readonly affiliateRepo: Repository<Affiliate>,
    @InjectRepository(Subscription) private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(RestockSubscription)
    private readonly restockRepo: Repository<RestockSubscription>,
    @InjectRepository(DeviceToken) private readonly deviceTokenRepo: Repository<DeviceToken>,
    @InjectRepository(Campaign) private readonly campaignRepo: Repository<Campaign>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(ProductSave) private readonly productSaveRepo: Repository<ProductSave>,
    @InjectRepository(Nudge) private readonly nudgeRepo: Repository<Nudge>,
    @InjectRepository(DiaryNote) private readonly diaryRepo: Repository<DiaryNote>,
    private readonly sessionService: SessionService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly suppression: ErasureSuppressionService,
    private readonly tenantService: TenantService,
    private readonly adminClient: ShopifyAdminClient,
    // Appended last so positional test doubles stay valid; uses `?.`-guarded.
    private readonly answerReuse?: AnswerReuseService,
    /** Attachments carry the same personal data as the text (PLN-260814 SI-5). */
    private readonly attachments?: AttachmentService,
  ) {}

  // ---- session resolution (widget DSAR/CCPA) ----

  /** Widget-session authorization — single implementation in SessionService. */
  async requireCustomerId(sessionToken: string): Promise<number> {
    return this.sessionService.requireCustomerId(sessionToken);
  }

  /**
   * Resolve the bound customer but demand Shopify-verified identity (SEC-C3).
   * Guest order-number+email lookup binds a session too, but those data points
   * (both printed on packing slips) must not unlock a full-account export or an
   * irreversible erasure — only the Shopify App Proxy path is strong enough.
   */
  async requireVerifiedCustomerId(sessionToken: string): Promise<number> {
    // The rule itself is delegated so it lives in one place (SessionService is the
    // single widget-session gate). One deliberate difference from the inline version
    // this replaced: an *unbound* session now gets 401 (not authenticated) while a
    // bound-but-guest one still gets 403 — both already read as "sign in first".
    //
    // The 'denied' audit trail is kept: a refused consumer-rights request is exactly
    // the kind a regulator asks about, so it must leave a record either way.
    try {
      return await this.sessionService.requireCustomerId(sessionToken, { verified: true });
    } catch (err) {
      await this.auditDsarDenied(sessionToken);
      throw err;
    }
  }

  /**
   * Record a refused DSAR attempt (Stage 4). Best-effort on purpose: an audit
   * failure must never mask the rejection, and a token that resolves to no session
   * is a bad token rather than a denied consumer right — nothing to attribute.
   */
  private async auditDsarDenied(sessionToken: string): Promise<void> {
    try {
      const session = await this.sessionRepo.findOne({ where: { sessionToken } });
      if (!session) return;
      await this.audit.write({
        tenantId: session.tenantId ?? null,
        actorType: 'user',
        actorId: 0,
        action: 'dsar.denied',
        target: session.customerId != null ? `customer:${session.customerId}` : undefined,
        result: 'denied',
        metadata: { reason: 'identity_not_verified' },
      });
    } catch (err) {
      this.logger.warn(`dsar.denied audit write failed: ${String(err)}`);
    }
  }

  // ---- Shopify GDPR webhooks ----

  /** GDPR "request customer data" — logged; data is compiled out-of-band. */
  async handleCustomerDataRequest(email: string | null): Promise<void> {
    // Machine writer (Shopify webhook) — 'system', not a phantom admin (Stage 4).
    await this.audit.write({
      tenantId: null,
      actorType: 'system',
      actorId: 0,
      action: 'gdpr.data_request',
      // Masked (PRV-M5): audit rows must not replicate raw PII.
      target: email ? maskPii(email) : undefined,
    });
  }

  /** GDPR "redact customer" — anonymize the matching customer. */
  async handleCustomerRedact(email: string | null, shopifyCustomerId: string | null): Promise<void> {
    const customer = await this.findCustomer(email, shopifyCustomerId);
    if (customer) {
      // Shopify initiated this one; propagating would bounce it back at the sender.
      await this.anonymizeCustomer(customer, { source: ERASURE_SOURCE.SHOPIFY });
    }
    await this.audit.write({
      tenantId: customer?.tenantId ?? null,
      actorType: 'system',
      actorId: 0,
      action: 'gdpr.customers_redact',
      target: email ? maskPii(email) : (shopifyCustomerId ?? undefined),
    });
  }

  /**
   * GDPR "redact shop" — full tenant purge. Resolve the tenant from shop_domain,
   * anonymize its customers, and delete all tenant-scoped rows by tenant_id.
   * Returns { purged: false } (without 500) when the shop does not resolve.
   */
  async handleShopRedact(shopDomain: string | null): Promise<{ purged: boolean; tenantId?: number }> {
    const tenant = shopDomain
      ? await this.tenantRepo.findOne({ where: { shopDomain } })
      : null;

    if (!tenant) {
      await this.audit.write({
        tenantId: null,
        actorType: 'system',
        actorId: 0,
        action: 'gdpr.shop_redact',
        target: shopDomain ?? undefined,
        metadata: { purged: false },
      });
      return { purged: false };
    }

    const tenantId = tenant.id;
    await this.purgeTenant(tenantId);

    await this.audit.write({
      tenantId,
      actorType: 'system',
      actorId: 0,
      action: 'gdpr.shop_redact',
      target: shopDomain ?? String(tenantId),
      metadata: { purged: true },
    });

    return { purged: true, tenantId };
  }

  /**
   * Anonymize the tenant's customers and delete all tenant-scoped rows. Wrapped in
   * a transaction so a partial failure rolls back. Order items/fulfillments are
   * deleted by tenant_id (they also carry tenant_id), alongside the order cache.
   */
  private async purgeTenant(tenantId: number): Promise<void> {
    // Files first, outside the transaction: unlinking bytes cannot be rolled
    // back, so it must not run inside one that might. Deleting them before the
    // rows means a failure leaves rows pointing at missing files (visible, and
    // fixable) rather than files nothing points at (invisible, and permanent).
    if (this.attachments) {
      await this.attachments
        .deleteByTenant(tenantId)
        .catch((e: Error) => this.logger.warn(`attachment purge failed: ${e.message}`));
    }

    // Deliberately does NOT add these customers to the erasure suppression list.
    // shop/redact means the app was uninstalled, not that each shopper objected to
    // processing — and a merchant who reinstalls has a lawful basis again. Blocking
    // every past customer forever would quietly break that reinstall. Nothing here
    // needs the block either: the tenant's orders and sessions are deleted outright,
    // so there is no link left to re-establish.
    await this.customerRepo.manager.transaction(async (mgr) => {
      // Anonymize customers (keep rows; scrub PII). email_hash is cleared
      // explicitly — .update() bypasses the entity's BeforeUpdate hook (PRV-M6).
      await mgr.getRepository(Customer).update(
        { tenantId },
        { email: null, emailHash: null, name: REDACTED, shopifyCustomerId: null, tier: 'guest' },
      );

      // Delete tenant-scoped rows. Children before parents where applicable.
      await mgr.getRepository(Message).delete({ tenantId });
      await mgr.getRepository(Conversation).delete({ tenantId });
      await mgr.getRepository(Notification).delete({ tenantId });
      await mgr.getRepository(NotificationPref).delete({ tenantId });
      await mgr.getRepository(Review).delete({ tenantId });
      await mgr.getRepository(Affiliate).delete({ tenantId });
      await mgr.getRepository(Subscription).delete({ tenantId });
      await mgr.getRepository(RestockSubscription).delete({ tenantId });
      await mgr.getRepository(ProductSave).delete({ tenantId });
      await mgr.getRepository(Nudge).delete({ tenantId });
      await mgr.getRepository(DiaryNote).delete({ tenantId });
      await mgr.getRepository(DeviceToken).delete({ tenantId });
      await mgr.getRepository(Inquiry).delete({ tenantId });
      await mgr.getRepository(CjmEvent).delete({ tenantId });
      await mgr.getRepository(Campaign).delete({ tenantId });
      await mgr.getRepository(Fulfillment).delete({ tenantId });
      await mgr.getRepository(OrderItem).delete({ tenantId });
      await mgr.getRepository(OrderCache).delete({ tenantId });
      await mgr.getRepository(Session).delete({ tenantId });
    });
  }

  // ---- DSAR access / portability ----

  /**
   * Assemble a machine-readable export of the customer's own data (DSAR access,
   * PRV-H1). Covers every table holding the customer's data: profile (incl.
   * phone), orders, chat transcripts, journey events, subscriptions, restock
   * alerts, notification preferences, affiliate status, reviews, inquiries.
   */
  async exportData(sessionToken: string) {
    const customerId = await this.requireVerifiedCustomerId(sessionToken);
    const customer = await this.customerRepo.findOne({ where: { id: customerId } });

    const [orders, notifications, reviews, inquiries, cjmEvents, subscriptions, restocks, prefs, affiliates, saves, nudges, diaryNotes] =
      await Promise.all([
        this.orderRepo.find({ where: { customerId } }),
        this.notificationRepo.find({ where: { customerId } }),
        this.reviewRepo.find({ where: { customerId } }),
        this.inquiryRepo.find({ where: { customerId } }),
        this.cjmRepo.find({ where: { customerId } }),
        this.subscriptionRepo.find({ where: { customerId } }),
        this.restockRepo.find({ where: { customerId } }),
        this.prefRepo.find({ where: { customerId } }),
        this.affiliateRepo.find({ where: { customerId } }),
        this.productSaveRepo.find({ where: { customerId } }),
        this.nudgeRepo.find({ where: { customerId } }),
        this.diaryRepo.find({ where: { customerId } }),
      ]);

    // Chat transcripts — the most sensitive free-text PII — via sessions → conversations.
    const sessions = await this.sessionRepo.find({ where: { customerId } });
    const sessionIds = sessions.map((s) => s.id);
    const conversations = sessionIds.length
      ? await this.conversationRepo.find({ where: { sessionId: In(sessionIds) } })
      : [];
    const conversationIds = conversations.map((c) => c.id);
    const messages = conversationIds.length
      ? await this.messageRepo.find({
          where: { conversationId: In(conversationIds) },
          order: { id: 'ASC' },
        })
      : [];
    // Keys normalized to Number: bigint PKs hydrate as strings (no transformer)
    // while messages.conversation_id is transformed to number — a raw Map key
    // mismatch silently drops every transcript.
    const messagesByConversation = new Map<number, Message[]>();
    for (const m of messages) {
      const key = Number(m.conversationId);
      const list = messagesByConversation.get(key) ?? [];
      list.push(m);
      messagesByConversation.set(key, list);
    }

    // PII-access audit (best-effort; never fail the export on audit error).
    // Machine-assembled export — 'system' actor, not a phantom user (Stage 4).
    try {
      await this.audit.write({
        tenantId: customer?.tenantId ?? null,
        actorType: 'system',
        actorId: 0,
        action: 'dsar.export',
        target: maskPii(customer?.email ?? null),
        result: 'success',
        metadata: { kind: 'export', customerId },
      });
    } catch (err) {
      this.logger.warn(`dsar.export audit write failed: ${String(err)}`);
    }

    return {
      exportedAt: new Date().toISOString(),
      customer: customer
        ? {
            id: customer.id,
            email: customer.email,
            name: customer.name,
            phone: customer.phone,
            tier: customer.tier,
            shopifyCustomerId: customer.shopifyCustomerId,
            createdAt: customer.createdAt,
          }
        : null,
      // Addresses the widget was used from (PLN-261023 S2) — personal data, so
      // part of what the person gets back.
      visitorIps: sessions
        .filter((sn) => sn.firstIp || sn.lastIp)
        .map((sn) => ({ firstIp: sn.firstIp, lastIp: sn.lastIp, lastIpAt: sn.lastIpAt, sessionCreatedAt: sn.createdAt })),
      orders: orders.map((o) => ({
        orderNumber: o.orderNumber,
        status: o.statusUi ?? o.statusInternal,
        total: o.total,
        currency: o.currency,
      })),
      conversations: conversations.map((c) => ({
        id: c.id,
        channel: c.channel,
        status: c.status,
        createdAt: c.createdAt,
        endedAt: c.endedAt,
        messages: (messagesByConversation.get(Number(c.id)) ?? []).map((m) => ({
          senderType: m.senderType,
          body: m.body,
          lang: m.lang,
          createdAt: m.createdAt,
        })),
      })),
      journeyEvents: cjmEvents.map((e) => ({
        stage: e.stage,
        eventType: e.eventType,
        createdAt: e.createdAt,
      })),
      subscriptions: subscriptions.map((s) => ({
        shopifySubscriptionId: s.shopifySubscriptionId,
        status: s.status,
        plan: s.plan,
        nextBilling: s.nextBilling,
      })),
      restockSubscriptions: restocks.map((r) => ({
        productId: r.productId,
        channel: r.channel,
        createdAt: r.createdAt,
        notifiedAt: r.notifiedAt,
      })),
      productSaves: saves.map((s) => ({
        list: s.list,
        productHandle: s.productHandle,
        note: s.note,
        createdAt: s.createdAt,
      })),
      nudges: nudges.map((n) => ({
        productHandle: n.productHandle,
        message: n.message,
        createdAt: n.createdAt,
        views: n.views,
      })),
      diaryNotes: diaryNotes.map((d) => ({
        body: d.body,
        productHandle: d.productHandle,
        createdAt: d.createdAt,
      })),
      notificationPrefs: prefs.map((p) => ({
        channel: p.channel,
        category: p.category,
        enabled: p.enabled === 1,
      })),
      affiliate: affiliates.map((a) => ({
        status: a.status,
        linkCode: a.linkCode,
        appliedAt: a.appliedAt,
        reviewedAt: a.reviewedAt,
      })),
      notifications: notifications.map((n) => ({
        category: n.category,
        title: n.title,
        body: n.body,
        channel: n.channel,
        createdAt: n.createdAt,
      })),
      reviews: reviews.map((r) => ({
        orderItemId: r.orderItemId,
        rating: r.rating,
        body: r.body,
        status: r.status,
        createdAt: r.createdAt,
      })),
      inquiries: inquiries.map((i) => ({
        id: i.id,
        orderId: i.orderId,
        status: i.status,
        createdAt: i.createdAt,
      })),
    };
  }

  // ---- DSAR erasure ----

  /** Anonymize the session's own customer (DSAR right to erasure). */
  async deleteData(sessionToken: string, confirm: boolean): Promise<void> {
    if (!confirm) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    const customerId = await this.requireVerifiedCustomerId(sessionToken);
    const customer = await this.customerRepo.findOne({ where: { id: customerId } });
    // The shopper asked us directly, so the request goes upstream as well — leaving
    // it in Shopify is what let the next order sync hand their data straight back.
    if (customer) {
      await this.anonymizeCustomer(customer, {
        source: ERASURE_SOURCE.DSAR,
        propagate: true,
      });
    }
    // Machine-executed erasure — 'system' actor, not a phantom admin (Stage 4).
    await this.audit.write({
      tenantId: customer?.tenantId ?? null,
      actorType: 'system',
      actorId: 0,
      action: 'dsar.delete',
      target: String(customerId),
      metadata: { kind: 'erasure' },
    });
  }

  // ---- CCPA / CPRA "Do Not Sell or Share" ----

  /** Toggle external-channel opt-out across all categories (in_app stays on). */
  async setOptOut(sessionToken: string, optOut: boolean): Promise<void> {
    // Shared gate; we keep the session because the audit row is attributed to the
    // consumer's own tenant, not a phantom admin (PRV-M2).
    const session = await this.sessionService.requireCustomer(sessionToken);
    const customerId = session.customerId as number;
    const enabled = optOut ? 0 : 1;

    // Bulk upsert the full external-channel × category grid in one statement,
    // keyed on the uk_pref (customer_id, channel, category) unique constraint.
    const rows = EXTERNAL_CHANNELS.flatMap((channel) =>
      PREF_CATEGORIES.map((category) => ({ customerId, channel, category, enabled })),
    );
    await this.prefRepo.upsert(rows, ['customerId', 'channel', 'category']);

    // Attribute the action to the consumer's own session, in their tenant —
    // not to a phantom admin (PRV-M2 audit-actor fix).
    await this.audit.write({
      tenantId: session.tenantId ?? null,
      actorType: 'user',
      actorId: 0,
      action: 'ccpa.opt_out',
      target: `customer:${customerId} optOut=${optOut}`,
      result: 'success',
      metadata: { optOut, customerId },
    });
  }

  /** Opt-out is true when every external channel is disabled. */
  async getOptOutStatus(sessionToken: string): Promise<boolean> {
    const customerId = await this.requireCustomerId(sessionToken);
    const prefs = await this.prefRepo.find({
      where: { customerId, channel: In(EXTERNAL_CHANNELS) },
    });
    // Zero rows = the customer never touched prefs and never opted out → false.
    // (Delivery-side suppression is separate: with no rows, marketing categories
    // are still default-denied at NotificationService.isSuppressed — D-4.)
    if (prefs.length === 0) return false;
    return prefs.every((p) => p.enabled === 0);
  }

  // ---- shared anonymization (best-effort PII scrub) ----

  private async findCustomer(
    email: string | null,
    shopifyCustomerId: string | null,
  ): Promise<Customer | null> {
    // Stable identifier first (PRV-H2): a redact can arrive after the email was
    // already nulled by an earlier partial run — the Shopify id still matches.
    if (shopifyCustomerId) {
      const byId = await this.customerRepo.findOne({ where: { shopifyCustomerId } });
      if (byId) return byId;
    }
    if (email) {
      // Email is encrypted — match via the blind index (PRV-M6).
      return this.customerRepo.findOne({ where: { emailHash: blindIndex(email) ?? '__none__' } });
    }
    return null;
  }

  /**
   * Scrub a single customer's PII while preserving referential rows. Messages are
   * reached via sessions -> conversations (best-effort); orders/inquiries are kept
   * but unlinked; reviews/notifications are redacted in place.
   *
   * `source` records who asked. `propagate` sends the erasure upstream to Shopify —
   * on for a shopper's own DSAR, off when Shopify's own customers/redact webhook
   * triggered us, which would otherwise bounce the request back at its sender.
   */
  private async anonymizeCustomer(
    customer: Customer,
    opts: { source?: ErasureSource; propagate?: boolean } = {},
  ): Promise<void> {
    const customerId = customer.id;
    // FIRST, before anything is scrubbed: remember the identity. The scrub below
    // nulls both the email and the Shopify id, and those are the only things that
    // can recognise this person when Shopify feeds them back on the next sync. If
    // this throws we have not destroyed anything yet — the caller fails and can
    // retry, rather than scrubbing the row and quietly losing the enforcement key.
    await this.suppression.record(
      customer.tenantId,
      { emailHash: customer.emailHash, shopifyCustomerId: customer.shopifyCustomerId },
      opts.source ?? ERASURE_SOURCE.DSAR,
    );
    if (opts.propagate) {
      await this.propagateErasureToShopify(customer);
    }

    // Redact chat messages reachable from the customer's sessions.
    const sessions = await this.sessionRepo.find({ where: { customerId } });
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length) {
      // Visitor addresses go with the person (PLN-261023 S2).
      await this.sessionRepo.update({ id: In(sessionIds) }, { firstIp: null, lastIp: null, lastIpAt: null });
      const conversations = await this.conversationRepo.find({
        where: { sessionId: In(sessionIds) },
      });
      const conversationIds = conversations.map((c) => c.id);
      if (conversationIds.length) {
        // Reuse entries derived from this person's turns go first (PLN-260808
        // Track C): they carry scrubbed copies of the conversation and must not
        // outlive the erasure. Ids are read before the redact below.
        if (this.answerReuse && customer.tenantId != null) {
          const msgs = await this.messageRepo.find({
            where: { conversationId: In(conversationIds) },
            select: ['id'],
          });
          await this.answerReuse
            .eraseByMessageIds(
              customer.tenantId,
              msgs.map((m) => Number(m.id)),
            )
            .catch((e: Error) => this.logger.warn(`reuse erasure failed: ${e.message}`));
        }
        // Attachments are deleted, not redacted: a photo has no body to
        // overwrite, and redacting the text while the picture of the person's
        // parcel stays on disk is exactly the failure this erasure exists to
        // prevent (PLN-260814 SI-5).
        if (this.attachments) {
          await this.attachments
            .deleteByConversationIds(conversationIds.map((id) => Number(id)))
            .catch((e: Error) => this.logger.warn(`attachment erasure failed: ${e.message}`));
        }
        await this.messageRepo.update(
          { conversationId: In(conversationIds) },
          { body: REDACTED },
        );
      }
    }

    // Notifications: redact title/body.
    await this.notificationRepo.update({ customerId }, { title: REDACTED, body: REDACTED });

    // Marketing/engagement state tied to the person: delete outright (PRV-H2).
    // Device push tokens are contact endpoints — same treatment.
    await this.prefRepo.delete({ customerId });
    await this.subscriptionRepo.delete({ customerId });
    await this.restockRepo.delete({ customerId });
    await this.affiliateRepo.delete({ customerId });
    await this.deviceTokenRepo.delete({ customerId });
    // Engagement rows (F2): saves carry free-text notes, nudges free-text
    // messages — both are the person's own expression. Delete outright.
    await this.productSaveRepo.delete({ customerId });
    await this.nudgeRepo.delete({ customerId });
    // Diary memos (F3): private free text — same treatment.
    await this.diaryRepo.delete({ customerId });

    // Reviews: null out free-text body.
    await this.reviewRepo.update({ customerId }, { body: null });

    // Inquiries: keep the row but unlink from the customer.
    await this.inquiryRepo.update({ customerId }, { customerId: null });

    // CJM events: unlink from the customer.
    await this.cjmRepo.update({ customerId }, { customerId: null });

    // Orders: keep operational record but unlink PII association.
    await this.orderRepo.update({ customerId }, { customerId: null });

    // Sessions: unbind the customer (+ drop their token→session cache entries).
    if (sessionIds.length) {
      await this.sessionRepo.update({ customerId }, { customerId: null });
      for (const s of sessions) {
        await this.redis.del(sessionCacheKey(s.sessionToken));
      }
    }

    // Finally, anonymize the customer record itself (incl. phone — PRV-H2).
    customer.email = null;
    customer.name = REDACTED;
    customer.phone = null;
    customer.shopifyCustomerId = null;
    customer.tier = 'guest';
    await this.customerRepo.save(customer);
  }

  /**
   * Ask Shopify to erase the customer too (PRV-H2). Scrubbing only our copy leaves
   * the data alive at the source, which is what let a later sync re-import it.
   *
   * Best-effort by design: the shopper's request must not fail because the store's
   * credential expired or the app lacks `write_customer_data_erasure` (it currently
   * does — the scope is not requested yet, so this records an access-denied until
   * the app is reinstalled with it). The suppression list holds the line meanwhile
   * and is what actually keeps the erasure enforced locally. Every
   * outcome is audited, because "we asked and Shopify refused" is the answer a
   * regulator asks for, and silence would be indistinguishable from never asking.
   */
  private async propagateErasureToShopify(customer: Customer): Promise<void> {
    const shopifyCustomerId = customer.shopifyCustomerId;
    const tenantId = customer.tenantId;
    if (!shopifyCustomerId || tenantId == null) return;

    let outcome: string;
    try {
      const conn = await this.tenantService.getShopifyConnection(tenantId);
      if (!conn) {
        outcome = 'skipped: no Shopify connection';
      } else {
        const res = await this.adminClient.requestCustomerErasure(
          conn.shopDomain,
          conn.token,
          shopifyCustomerId,
        );
        outcome = res.accepted
          ? 'accepted'
          : `refused: ${res.userErrors.join('; ') || 'no customerId returned'}`;
      }
    } catch (e) {
      outcome = `failed: ${(e as Error).message}`;
    }
    if (!outcome.startsWith('accepted')) {
      this.logger.warn(`Shopify erasure for customer ${customer.id} — ${outcome}`);
    }
    await this.audit.write({
      tenantId,
      actorType: 'admin',
      actorId: 0,
      action: 'dsar.delete.upstream',
      target: `customer:${customer.id} ${outcome}`,
    });
  }
}
