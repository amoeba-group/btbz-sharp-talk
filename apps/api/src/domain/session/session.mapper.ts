import type { SessionResponse } from '@sharptalk/types';
import { Session } from './entity/session.entity';
import { PrivacyNoticeInfo } from './session.service';
import type { EffectiveIdentity } from './identity.util';

/**
 * Response shape lives in `@sharptalk/types` — the widget imports the same contract, so
 * the privacy-notice fields added here cannot drift from what the widget reads.
 */
export type { SessionResponse };

export class SessionMapper {
  static toResponse(
    s: Session,
    notice: PrivacyNoticeInfo,
    customerName: string | null = null,
    /**
     * What the session may be treated as right now (PLN-261012 SG-03). Omitted =
     * the stored binding as is, which is every caller that predates expiry.
     */
    identity?: EffectiveIdentity,
  ): SessionResponse {
    return {
      sessionToken: s.sessionToken,
      language: s.language,
      consentState: s.consentState,
      // Lapsed signed claims no longer count as a login: the widget shows a guest
      // until the host signs again.
      authenticated: (identity ? identity.customerId : s.customerId) != null,
      // Present only when there is something to say, so tenants and widgets that
      // never see signed claims get the exact response they always had.
      ...(identity?.expired ? { identityExpired: true } : {}),
      ...(identity?.expiresAt ? { identityExpiresAt: identity.expiresAt } : {}),
      customerName,
      privacyPolicyUrl: notice.privacyPolicyUrl,
      consentNoticeVersion: notice.consentNoticeVersion,
      privacyNoticeCopy: notice.privacyNoticeCopy,
      noticeOutdated: s.consentVersion != null && s.consentVersion !== notice.consentNoticeVersion,
      consentAt: s.consentAt ? new Date(s.consentAt).toISOString() : null,
      widgetLoginMode: notice.widgetLoginMode,
      guestPolicy: (notice.guestPolicy as 'open' | 'login_guidance' | undefined) ?? 'open',
      guestGuidance: notice.guestGuidance ?? null,
      widgetTabs: notice.widgetTabs,
      widgetTabPosition: notice.widgetTabPosition,
      commerceEnabled: notice.commerceEnabled ?? true,
      widgetTheme: notice.widgetTheme,
      widgetCopy: notice.widgetCopy,
      aiProcessingRegion: notice.aiProcessingRegion ?? 'US',
      issueFeed: notice.issueFeed ?? false,
    };
  }
}
