import { SessionMapper } from './session.mapper';
import { Session } from './entity/session.entity';
import type { PrivacyNoticeInfo } from './session.service';

/** SessionMapper.toResponse — widget session shape: greeting name (#4) + consent notice. */
describe('SessionMapper.toResponse', () => {
  const notice: PrivacyNoticeInfo = {
    privacyPolicyUrl: 'https://shop.example/privacy',
    consentNoticeVersion: 'v2',
    widgetLoginMode: 'redirect',
    widgetCopy: { displayName: 'Shop', firstVisit: {}, loginGreeting: {} },
  };

  function session(over: Partial<Session> = {}): Session {
    return {
      sessionToken: 'tok',
      language: 'EN',
      consentState: 'pending',
      customerId: null,
      ...over,
    } as Session;
  }

  it('marks a session with a bound customer as authenticated', () => {
    expect(SessionMapper.toResponse(session({ customerId: 4 }), notice).authenticated).toBe(true);
    expect(SessionMapper.toResponse(session(), notice).authenticated).toBe(false);
  });

  it('carries the customer name through when one is resolved', () => {
    const res = SessionMapper.toResponse(session({ customerId: 4 }), notice, 'Huy Tester');
    expect(res).toEqual({
      sessionToken: 'tok',
      language: 'EN',
      consentState: 'pending',
      authenticated: true,
      customerName: 'Huy Tester',
      privacyPolicyUrl: 'https://shop.example/privacy',
      consentNoticeVersion: 'v2',
      noticeOutdated: false,
      consentAt: null,
      widgetLoginMode: 'redirect',
      widgetCopy: { displayName: 'Shop', firstVisit: {}, loginGreeting: {} },
      aiProcessingRegion: 'US',
      issueFeed: false,
    });
  });

  it('defaults customerName to null (guest, or profile not resolved yet)', () => {
    expect(SessionMapper.toResponse(session(), notice).customerName).toBeNull();
    // Authenticated but the Shopify name backfill has not landed yet.
    expect(SessionMapper.toResponse(session({ customerId: 4 }), notice).customerName).toBeNull();
  });

  describe('consent notice', () => {
    it('flags a consent recorded against an older notice version', () => {
      const res = SessionMapper.toResponse(session({ consentVersion: 'v1' }), notice);
      expect(res.noticeOutdated).toBe(true);
    });

    it('does not flag a consent recorded against the effective version', () => {
      const res = SessionMapper.toResponse(session({ consentVersion: 'v2' }), notice);
      expect(res.noticeOutdated).toBe(false);
    });

    it('does not flag a session that never recorded a consent', () => {
      // consentVersion null: nothing to be out of date with yet.
      expect(SessionMapper.toResponse(session(), notice).noticeOutdated).toBe(false);
    });

    it('serializes consentAt as ISO 8601', () => {
      const at = new Date('2026-08-03T07:14:21.000Z');
      const res = SessionMapper.toResponse(session({ consentAt: at }), notice);
      expect(res.consentAt).toBe('2026-08-03T07:14:21.000Z');
    });
  });
});
