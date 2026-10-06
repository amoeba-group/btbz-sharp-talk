import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { SENDER_TYPE } from '@sharptalk/types';
import { ExternalTicket } from './entity/external-ticket.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { ModerationService } from '../moderation/moderation.service';
import { externalNotice, externalReplyNotice } from './issue-notice';
import { Message } from '../chat/entity/message.entity';
import { Session } from '../session/entity/session.entity';
import { Customer } from '../customer/entity/customer.entity';
import { OrderCache } from '../order/entity/order-cache.entity';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { blindIndex, decryptSecret } from '../../global/util/crypto.util';
import { EventBusService, EVENTS } from '../../infrastructure/infrastructure.module';
import {
  appendGorgiasMessage,
  createGorgiasTicket,
  GorgiasConfig,
  GorgiasMessage,
} from './gorgias.client';

const PROVIDER = 'gorgias';
const TRANSCRIPT_CAP = 100;

interface EscalationLike {
  tenantId?: number;
  conversationId?: number;
  sessionId?: number;
  reason?: string;
}

/**
 * Gorgias L1 connector (PLN-260808-Issue-Workflow-P2 S4, 결정 11·13): a
 * bridge-mode tenant's escalation becomes an external Gorgias ticket carrying
 * the full transcript + reason (+ recent-order note). Mode exclusivity (§11.1)
 * is structural — native/base tenants no-op here, bridge tenants no-op in
 * IssueService. Re-escalations append to the existing ticket via the message
 * cursor (open/closed split arrives with the L2 webhook, 결정 12). Best-effort
 * with one retry — a connector failure never breaks the escalation itself.
 */
@Injectable()
export class ExternalTicketService implements OnModuleInit {
  private readonly logger = new Logger(ExternalTicketService.name);

  constructor(
    @InjectRepository(ExternalTicket) private readonly extRepo: Repository<ExternalTicket>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(OrderCache) private readonly orderRepo: Repository<OrderCache>,
    @InjectRepository(IntegrationCredential)
    private readonly credRepo: Repository<IntegrationCredential>,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    private readonly bus: EventBusService,
    private readonly moderation: ModerationService,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe(EVENTS.ESCALATION, async (payload: unknown) => {
      try {
        await this.relayEscalation((payload ?? {}) as EscalationLike);
      } catch (e) {
        this.logger.warn(`gorgias relay failed: ${(e as Error).message}`);
      }
    });
  }

  async relayEscalation(payload: EscalationLike): Promise<void> {
    const { tenantId, conversationId, sessionId } = payload;
    if (!tenantId || !conversationId || !sessionId) return;
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (tenant?.workflowMode !== 'bridge') return;
    const cfg = await this.gorgiasConfig(tenantId);
    if (!cfg) {
      this.logger.warn(`bridge tenant ${tenantId} has no usable gorgias credentials — relay skipped`);
      return;
    }
    // Gorgias dedups/threads customers by email — without one we cannot file a
    // ticket that routes anywhere useful (REQ §11.2.1).
    const email = await this.customerEmail(tenantId, sessionId);
    if (!email) {
      this.logger.warn(`gorgias relay skipped: no customer email (conversation=${conversationId})`);
      return;
    }

    const existing = await this.extRepo.findOne({ where: { conversationId, provider: PROVIDER } });
    if (existing) {
      // 결정 12 (완성, L2): a ticket the webhook reported CLOSED gets a fresh
      // ticket on re-escalation; an open one gets the new messages appended.
      if (existing.status === 'closed') {
        await this.createTicket(cfg, tenantId, conversationId, email, payload.reason ?? 'escalation', existing);
        return;
      }
      await this.appendNewMessages(cfg, existing, email);
      return;
    }
    await this.createTicket(cfg, tenantId, conversationId, email, payload.reason ?? 'escalation');
  }

  /**
   * Gorgias L2 webhook (ticket-updated): authenticate by the tenant's stored
   * webhook_secret, mirror the external status, and tell the shopper when the
   * ticket closes. Returns false when the token matches no tenant (→ 401).
   */
  async handleWebhook(
    token: string,
    externalId: string,
    status: string,
    message?: { id: number; fromAgent: boolean; bodyText: string },
  ): Promise<boolean> {
    if (!token?.trim() || !externalId) return false;
    const creds = await this.credRepo.find({ where: { provider: PROVIDER } });
    let tenantId: number | null = null;
    for (const cred of creds) {
      try {
        const parsed = JSON.parse(decryptSecret(cred.secretEnc!)) as Record<string, string>;
        if (parsed.webhook_secret && parsed.webhook_secret === token.trim()) {
          tenantId = Number(cred.tenantId);
          break;
        }
      } catch {
        /* unreadable blob — not this tenant */
      }
    }
    if (tenantId == null) return false;
    const ref = await this.extRepo.findOne({
      where: { tenantId, provider: PROVIDER, externalId: String(externalId) },
    });
    if (!ref) return true; // authenticated, but not a ticket we created — ack quietly

    // Status mirror only when the event carries one — a message-created event
    // without `status` must not silently flip a closed ticket back to open.
    if (status?.trim()) {
      const normalized = status.trim().toLowerCase() === 'closed' ? 'closed' : 'open';
      const newlyClosed = ref.status !== 'closed' && normalized === 'closed';
      ref.status = normalized;
      await this.extRepo.save(ref);
      if (newlyClosed) {
        await this.notifyExternalClosed(tenantId, ref.conversationId).catch((e: Error) =>
          this.logger.warn(`external-closed notice failed: ${e.message}`),
        );
        this.logger.log(`gorgias ticket ${ref.externalId} closed (tenant=${tenantId})`);
      }
    }

    // L3 (백로그 B1): relay the helpdesk agent's reply into the widget thread.
    if (message?.fromAgent && message.bodyText.trim()) {
      await this.relayAgentReply(tenantId, ref, message).catch((e: Error) =>
        this.logger.warn(`L3 relay failed (ticket ${ref.externalId}): ${e.message}`),
      );
    }
    return true;
  }

  /**
   * L3 inbound relay: moderate (FR-069, scope agent) → persist as an agent turn
   * → notify the shopper. Idempotent via the inbound message-id cursor.
   */
  private async relayAgentReply(
    tenantId: number,
    ref: ExternalTicket,
    message: { id: number; bodyText: string },
  ): Promise<void> {
    if (
      Number.isFinite(message.id) &&
      ref.lastInboundMessageId != null &&
      message.id <= Number(ref.lastInboundMessageId)
    ) {
      return; // already relayed (at-least-once webhook)
    }
    const moderated = await this.moderation.moderate({
      tenantId,
      scope: 'agent',
      authorType: 'agent',
      conversationId: ref.conversationId,
      text: message.bodyText,
    });
    if (moderated.decision === 'blocked') {
      this.logger.warn(`L3 relay blocked by moderation (ticket ${ref.externalId})`);
      return;
    }
    await this.msgRepo.save(
      this.msgRepo.create({
        tenantId,
        conversationId: ref.conversationId,
        senderType: SENDER_TYPE.AGENT,
        senderId: null,
        body: moderated.text,
        lang: null,
        retrievalTrace: { relayedFrom: PROVIDER, externalMessageId: message.id },
      }),
    );
    if (Number.isFinite(message.id) && message.id > 0) {
      ref.lastInboundMessageId = message.id;
      await this.extRepo.save(ref);
    }
    await this.notifyExternalReply(tenantId, ref.conversationId).catch(() => undefined);
    this.logger.log(`L3 relayed gorgias msg ${message.id} → conversation ${ref.conversationId}`);
  }

  private async notifyExternalReply(tenantId: number, conversationId: number): Promise<void> {
    const conv = await this.convRepo.findOne({ where: { id: conversationId } });
    if (!conv) return;
    const session = await this.sessionRepo.findOne({ where: { id: conv.sessionId } });
    const copy = externalReplyNotice(session?.language);
    await this.bus.publish(EVENTS.NOTIFICATION, {
      tenantId,
      customerId: session?.customerId ?? null,
      sessionId: conv.sessionId,
      category: 'issue',
      title: copy.title,
      body: copy.body,
      channel: 'push',
    });
  }

  private async notifyExternalClosed(tenantId: number, conversationId: number): Promise<void> {
    const conv = await this.convRepo.findOne({ where: { id: conversationId } });
    if (!conv) return;
    const session = await this.sessionRepo.findOne({ where: { id: conv.sessionId } });
    const copy = externalNotice(session?.language);
    await this.bus.publish(EVENTS.NOTIFICATION, {
      tenantId,
      customerId: session?.customerId ?? null,
      sessionId: conv.sessionId,
      category: 'issue',
      title: copy.title,
      body: copy.body,
      channel: 'push',
    });
  }

  /* ------------------------------ internals ------------------------------ */

  private async createTicket(
    cfg: GorgiasConfig,
    tenantId: number,
    conversationId: number,
    email: string,
    reason: string,
    reuseRef?: ExternalTicket,
  ): Promise<void> {
    const transcript = await this.msgRepo.find({
      where: { conversationId },
      order: { id: 'ASC' },
      take: TRANSCRIPT_CAP,
    });
    if (!transcript.length) return;
    const messages: GorgiasMessage[] = transcript.map((m) => ({
      // Customer turns come from the shopper; ai/agent/system are our side.
      fromAgent: m.senderType !== SENDER_TYPE.USER,
      bodyText: m.body,
      createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : undefined,
    }));
    const orderNote = await this.orderNote(tenantId, email);
    if (orderNote) messages.push({ fromAgent: true, bodyText: orderNote });
    // Signed partner context (REQ-261006 H4) — which hotel the ticket is about.
    const partnerNote = await this.partnerNote(conversationId);
    if (partnerNote) messages.push({ fromAgent: true, bodyText: partnerNote });

    const lastUser = [...transcript].reverse().find((m) => m.senderType === SENDER_TYPE.USER);
    const subject = `[SharpTalk] ${reason} — ${(lastUser?.body ?? 'chat escalation').slice(0, 80)}`;
    const externalId = await this.withRetry(() =>
      createGorgiasTicket(cfg, {
        customerEmail: email,
        subject,
        messages,
        tags: ['shoptalk', reason],
      }),
    );
    if (reuseRef) {
      // Same conversation row (unique key) — repoint it at the fresh ticket.
      reuseRef.externalId = externalId;
      reuseRef.status = 'open';
      reuseRef.lastRelayedMessageId = transcript[transcript.length - 1]?.id ?? null;
      await this.extRepo.save(reuseRef);
    } else {
      await this.extRepo.save(
        this.extRepo.create({
          tenantId,
          conversationId,
          provider: PROVIDER,
          externalId,
          status: 'open',
          lastRelayedMessageId: transcript[transcript.length - 1]?.id ?? null,
        }),
      );
    }
    this.logger.log(
      `gorgias ticket ${externalId} created (tenant=${tenantId} conversation=${conversationId})`,
    );
  }

  /** Re-escalation: relay customer messages newer than the cursor (결정 12 L1). */
  private async appendNewMessages(
    cfg: GorgiasConfig,
    ref: ExternalTicket,
    email: string,
  ): Promise<void> {
    const fresh = await this.msgRepo.find({
      where: {
        conversationId: ref.conversationId,
        senderType: SENDER_TYPE.USER,
        ...(ref.lastRelayedMessageId != null ? { id: MoreThan(ref.lastRelayedMessageId) } : {}),
      },
      order: { id: 'ASC' },
      take: 20,
    });
    if (!fresh.length) return;
    const body = fresh.map((m) => m.body).join('\n\n');
    await this.withRetry(() =>
      appendGorgiasMessage(cfg, ref.externalId, email, { fromAgent: false, bodyText: body }),
    );
    ref.lastRelayedMessageId = fresh[fresh.length - 1].id;
    await this.extRepo.save(ref);
    this.logger.log(`gorgias ticket ${ref.externalId} appended ${fresh.length} message(s)`);
  }

  private async gorgiasConfig(tenantId: number): Promise<GorgiasConfig | null> {
    const cred = await this.credRepo.findOne({ where: { tenantId, provider: PROVIDER } });
    if (!cred?.secretEnc) return null;
    try {
      const parsed = JSON.parse(decryptSecret(cred.secretEnc)) as Record<string, string>;
      if (!parsed.subdomain || !parsed.email || !parsed.api_key) return null;
      return { subdomain: parsed.subdomain, email: parsed.email, apiKey: parsed.api_key };
    } catch {
      return null;
    }
  }

  private async customerEmail(tenantId: number, sessionId: number): Promise<string | null> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session?.customerId) return null;
    const customer = await this.customerRepo.findOne({
      where: { id: session.customerId, tenantId },
    });
    return customer?.email?.trim() || null;
  }

  /**
   * The session's signed partner claims as an internal-style note
   * (REQ-261006 H4), or null for guests / v1 identities. Only the signed key
   * and the display fields travel; nothing that could be a person's contact.
   */
  private async partnerNote(conversationId: number): Promise<string | null> {
    try {
      const conv = await this.convRepo.findOne({ where: { id: conversationId } });
      if (!conv) return null;
      const session = await this.sessionRepo.findOne({ where: { id: conv.sessionId } });
      const claims = session?.identityClaims;
      if (!claims?.signed || !claims.hotelSn) return null;
      const name = claims.hotelName?.trim() || 'hotel';
      const code = claims.hotelCode?.trim() ? ` · ${claims.hotelCode.trim()}` : '';
      return `[SharpTalk] Partner: ${name} (hotelSn ${claims.hotelSn}${code}) · role ${claims.role}`;
    } catch {
      return null;
    }
  }

  /** Recent-order context as an internal-style note (§11.2 packaging). */
  private async orderNote(tenantId: number, email: string): Promise<string | null> {
    try {
      // Email is encrypted at rest — equality goes through the blind index (PRV-M6).
      const customer = await this.customerRepo.findOne({
        where: { tenantId, emailHash: blindIndex(email) ?? '__none__' },
      });
      if (!customer) return null;
      const orders = await this.orderRepo.find({
        where: { tenantId, customerId: customer.id },
        order: { id: 'DESC' },
        take: 3,
      });
      if (!orders.length) return null;
      const lines = orders.map(
        (o) => `#${o.orderNumber} · ${o.statusUi ?? o.statusInternal ?? '-'} · ${o.total ?? '-'} ${o.currency ?? ''}`,
      );
      return `[SharpTalk] Recent orders:\n${lines.join('\n')}`;
    } catch {
      return null;
    }
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch {
      return fn();
    }
  }
}
