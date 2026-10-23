import { maskName } from '../../global/util/pii-display.util';
import type { Company } from './entity/company.entity';
import type { CompanyContact } from './entity/company-contact.entity';
import type { Conversation } from '../chat/entity/conversation.entity';
import type {
  CompanyContactResponse,
  CompanyConversationResponse,
  CompanyResponse,
} from './dto/response/company.response';

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** Entity → camelCase response (PLN-261022 stage 2). */
export class CompanyMapper {
  static toResponse(
    c: Company,
    stats: { contactCount?: number; conversationCount?: number; lastConversationAt?: Date | string | null } = {},
  ): CompanyResponse {
    return {
      id: String(c.id),
      externalKey: c.externalKey,
      name: c.name,
      province: c.province,
      region: c.region,
      contactCount: stats.contactCount ?? 0,
      conversationCount: stats.conversationCount ?? 0,
      lastSeenAt: iso(c.lastSeenAt),
      lastConversationAt: iso(stats.lastConversationAt ?? null),
    };
  }

  static toContact(link: CompanyContact, name: string | null): CompanyContactResponse {
    return { customerId: String(link.customerId), name, role: link.role, lastSeenAt: iso(link.lastSeenAt) };
  }

  /**
   * `masked` = shown inside a live conversation (the "earlier conversations at
   * this hotel" panel); the customers screen lists names in the clear (2026-10-23).
   */
  static toConversation(c: Conversation, customerName: string | null, masked = false): CompanyConversationResponse {
    return {
      id: String(c.id),
      status: c.status,
      customerId: c.customerId != null ? String(c.customerId) : null,
      customerName: masked ? maskName(customerName) : customerName,
      agentId: c.agentId != null ? String(c.agentId) : null,
      createdAt: iso(c.createdAt) ?? '',
      endedAt: iso(c.endedAt),
    };
  }
}
