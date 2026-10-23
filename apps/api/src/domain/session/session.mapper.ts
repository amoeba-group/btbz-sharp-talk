import type { SessionResponse } from '@sharptalk/types';
import { Session } from './entity/session.entity';
import { PrivacyNoticeInfo } from './session.service';
import { threadEligible } from '../embed/unsigned-identify';

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
    consultCategories: Array<{ code: string; label: string }> = [],
  ): SessionResponse {
    return {
      sessionToken: s.sessionToken,
      language: s.language,
      languages: notice.languages,
      headerControls: notice.headerControls,
      consentState: s.consentState,
      authenticated: s.customerId != null,
      customerName,
      privacyPolicyUrl: notice.privacyPolicyUrl,
      consentNoticeVersion: notice.consentNoticeVersion,
      privacyNoticeCopy: notice.privacyNoticeCopy,
      noticeOutdated: s.consentVersion != null && s.consentVersion !== notice.consentNoticeVersion,
      consentAt: s.consentAt ? new Date(s.consentAt).toISOString() : null,
      widgetLoginMode: notice.widgetLoginMode,
      csatMode: notice.csatMode,
      termsUrl: notice.termsUrl,
      widgetTabs: notice.widgetTabs,
      widgetTabPosition: notice.widgetTabPosition,
      commerceEnabled: notice.commerceEnabled ?? true,
      widgetTheme: notice.widgetTheme,
      widgetCopy: notice.widgetCopy,
      aiProcessingRegion: notice.aiProcessingRegion ?? 'US',
      issueFeed: notice.issueFeed ?? false,
      // Earlier conversations (PLN-261022 stage 2): only a host-signed user of a
      // tenant that switched continuity on — never a guest or a lookup-only
      // session. A claimed user of an unsigned-host tenant sees its own (P7).
      threadAvailable: !!notice.threadContinuity && threadEligible(s),
      consultCategories,
    };
  }
}
