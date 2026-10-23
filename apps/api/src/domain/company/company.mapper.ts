import type { Company } from './entity/company.entity';
import type { ProductCache } from '../product/entity/product-cache.entity';
import type { CompanyContact } from './entity/company-contact.entity';
import type { Conversation } from '../chat/entity/conversation.entity';
import type {
  CompanyContactResponse,
  CompanyConversationResponse,
  CompanyProfileResponse,
  CompanyResponse,
  CompanyRoomResponse,
} from './dto/response/company.response';

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** Entity → camelCase response (PLN-261022 stage 2). */
export class CompanyMapper {
  static toResponse(
    c: Company,
    stats: {
      contactCount?: number;
      conversationCount?: number;
      lastConversationAt?: Date | string | null;
      roomCount?: number;
    } = {},
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
      code: c.code ?? null,
      phone: c.phone ?? null,
      address: c.address ?? null,
      roomCount: stats.roomCount ?? 0,
      partnerSyncedAt: iso(c.partnerSyncedAt),
    };
  }

  /** Operator-entered profile — columns + the profile JSON, flattened (PLN-261023). */
  static toProfile(c: Company, updatedByName: string | null): CompanyProfileResponse {
    const p = c.profile ?? {};
    return {
      code: c.code ?? null,
      phone: c.phone ?? null,
      district: c.district ?? null,
      address: c.address ?? null,
      groupName: p.groupName ?? null,
      promotion: p.promotion ?? null,
      hot: p.hot ?? null,
      isNew: p.isNew ?? null,
      contractStart: p.contractStart ?? null,
      contractEnd: p.contractEnd ?? null,
      payment: p.payment ?? null,
      hotelType: p.hotelType ?? null,
      enterpriseName: p.enterpriseName ?? null,
      enterpriseRegNo: p.enterpriseRegNo ?? null,
      extraFee: p.extraFee ?? null,
      descriptionEn: p.descriptionEn ?? null,
      descriptionVi: p.descriptionVi ?? null,
      policyEn: p.policyEn ?? null,
      policyVi: p.policyVi ?? null,
      updatedAt: iso(c.profileUpdatedAt),
      updatedBy: updatedByName,
    };
  }

  static toRoom(p: ProductCache): CompanyRoomResponse {
    return {
      handle: p.handle,
      title: p.title,
      status: p.status,
      imageUrl: p.imageUrl,
      currency: p.currency,
      attributes: p.attributes ?? null,
      syncedAt: iso(p.syncedAt),
    };
  }

  static toContact(link: CompanyContact, name: string | null): CompanyContactResponse {
    return { customerId: String(link.customerId), name, role: link.role, lastSeenAt: iso(link.lastSeenAt) };
  }

  static toConversation(c: Conversation, customerName: string | null): CompanyConversationResponse {
    return {
      id: String(c.id),
      sessionId: String(c.sessionId),
      status: c.status,
      customerId: c.customerId != null ? String(c.customerId) : null,
      customerName,
      agentId: c.agentId != null ? String(c.agentId) : null,
      createdAt: iso(c.createdAt) ?? '',
      endedAt: iso(c.endedAt),
    };
  }
}
