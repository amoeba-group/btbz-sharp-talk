import type { SessionResponse } from '@sharptalk/types';
import { Session } from './entity/session.entity';
import { PrivacyNoticeInfo } from './session.service';

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
  ): SessionResponse {
    return {
      sessionToken: s.sessionToken,
      language: s.language,
      consentState: s.consentState,
      authenticated: s.customerId != null,
      customerName,
      privacyPolicyUrl: notice.privacyPolicyUrl,
      consentNoticeVersion: notice.consentNoticeVersion,
      noticeOutdated: s.consentVersion != null && s.consentVersion !== notice.consentNoticeVersion,
      consentAt: s.consentAt ? new Date(s.consentAt).toISOString() : null,
      widgetLoginMode: notice.widgetLoginMode,
      widgetTabs: notice.widgetTabs,
      widgetTabPosition: notice.widgetTabPosition,
      widgetTheme: notice.widgetTheme,
      widgetCopy: notice.widgetCopy,
      aiProcessingRegion: notice.aiProcessingRegion ?? 'US',
      issueFeed: notice.issueFeed ?? false,
    };
  }
}
