import { apiGet, apiPatch } from '@/lib/api-client';

/** One notice line, keyed the way the widget renders them. */
export type NoticeLineKey = 'title' | 'body' | 'items' | 'purpose' | 'retention' | 'aiProcessor';
export type NoticeLines = Partial<Record<NoticeLineKey, string>>;

/** Tenant-facing consent notice configuration (camelCase response). */
export interface PrivacyNoticeSettings {
  privacyPolicyUrl: string | null;
  consentNoticeVersion: string | null;
  /** Stored choice; null = inferred from whether this tenant sells (PLN-261001). */
  privacyProfile: string | null;
  /** What is in force right now — what the placeholders below belong to. */
  effectiveProfile: string;
  /** Per-language rewrites of single lines, exactly as stored. */
  privacyNoticeCopy: Record<string, NoticeLines> | null;
  /** The profile's own wording per language — shown as the placeholder. */
  profileCopy: Record<string, NoticeLines>;
}

/** PATCH body is snake_case per API convention. */
export interface UpdatePrivacyNoticeBody {
  privacy_policy_url?: string | null;
  consent_notice_version?: string;
  privacy_profile?: string | null;
  privacy_notice_copy?: Record<string, NoticeLines> | null;
  /**
   * Only for a material change: it raises the notice version, which asks every
   * shopper who already consented to consent again.
   */
  bump_version?: boolean;
}

export const privacyNoticeService = {
  get: () => apiGet<PrivacyNoticeSettings>('/tenants/privacy-notice'),
  update: (body: UpdatePrivacyNoticeBody) =>
    apiPatch<PrivacyNoticeSettings>('/tenants/privacy-notice', body),
};
