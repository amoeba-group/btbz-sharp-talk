import { Repository } from 'typeorm';
import { CONSENT_STATE } from '@sharptalk/types';
import { SessionService } from './session.service';
import { Session } from './entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { RedisService } from '../../infrastructure/cache/redis.service';

/**
 * Consent evidence in audit_logs + the Vietnam notice profile
 * (PLN-261012 SG-70). The session row only holds the CURRENT choice and the
 * widget re-records a remembered one on every new session, so the audit trail
 * is what proves a decision — and it must carry no PII.
 */
describe('SessionService consent evidence (SG-70)', () => {
  let session: Session;
  let tenant: Tenant;
  let writes: Array<Record<string, unknown>>;
  let auditFails: boolean;
  let svc: SessionService;

  beforeEach(() => {
    session = {
      id: 21,
      sessionToken: 'tok-21',
      tenantId: 4,
      language: 'VI',
      consentState: CONSENT_STATE.PENDING,
      consentAt: null,
      consentVersion: null,
    } as Session;
    tenant = { id: 4, consentNoticeVersion: '2026-10', commerceEnabled: 0 } as Tenant;
    writes = [];
    auditFails = false;
    const audit = {
      write: jest.fn(async (p: Record<string, unknown>) => {
        if (auditFails) throw new Error('audit down');
        writes.push(p);
      }),
    };
    svc = new SessionService(
      { findOne: jest.fn(async () => session), save: jest.fn(async (s: Session) => s) } as unknown as Repository<Session>,
      { findOne: jest.fn(async () => tenant) } as unknown as Repository<Tenant>,
      {} as never,
      { publish: jest.fn() } as never,
      { available: () => false, del: jest.fn() } as unknown as RedisService,
      undefined,
      undefined,
      audit as never,
    );
  });

  it('records a grant with the notice version and no personal data', async () => {
    await svc.setConsent('tok-21', true);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      tenantId: 4,
      actorType: 'system',
      actorId: 0,
      action: 'consent.granted',
      target: 'session:21',
      // AuditService would otherwise stamp the visitor's IP from the request.
      ip: null,
      metadata: { state: 'granted', previousState: 'pending', noticeVersion: '2026-10', language: 'VI' },
    });
    // Nothing identifying: no token, no email, no ip value anywhere in the row.
    expect(JSON.stringify(writes[0])).not.toContain('tok-21');
  });

  it('a first refusal is "declined"; refusing after granting is a withdrawal', async () => {
    await svc.setConsent('tok-21', false);
    expect(writes[0].action).toBe('consent.declined');

    session.consentState = CONSENT_STATE.GRANTED;
    await svc.setConsent('tok-21', false);
    expect(writes[1].action).toBe('consent.withdrawn');
    expect(writes[1].metadata).toMatchObject({ state: 'declined', previousState: 'granted' });
  });

  it('does not write evidence for a replayed choice (one per page load would drown the table)', async () => {
    const saved = await svc.setConsent('tok-21', true, true);
    expect(saved.consentState).toBe(CONSENT_STATE.GRANTED); // still recorded on the session
    expect(writes).toHaveLength(0);
  });

  it('never fails the shopper when the evidence write fails', async () => {
    auditFails = true;
    await expect(svc.setConsent('tok-21', true)).resolves.toMatchObject({
      consentState: CONSENT_STATE.GRANTED,
    });
  });

  describe('vn_pdpl notice from the server', () => {
    const OLD = { ...process.env };
    afterEach(() => {
      process.env = { ...OLD };
    });

    it('fills retention and region from the deployment env, never from the widget bundle', async () => {
      process.env.CONVERSATION_LOG_RETENTION_DAYS = '180';
      process.env.AI_PROCESSING_REGION = 'US';
      tenant.privacyProfile = 'vn_pdpl';
      const notice = await svc.privacyNotice(4, null, 'VI');
      const copy = notice.privacyNoticeCopy ?? {};
      expect(copy.retention).toContain('180 ngày');
      expect(copy.crossBorder).toContain('Hoa Kỳ');
      expect(copy.controller).toBeTruthy();
      expect(copy.rights).toBeTruthy();
      for (const text of Object.values(copy)) expect(text).not.toContain('{{');
    });

    it('a blank retention env resolves to the same 365 the purge job enforces', async () => {
      process.env.CONVERSATION_LOG_RETENTION_DAYS = '';
      tenant.privacyProfile = 'vn_pdpl';
      const notice = await svc.privacyNotice(4, null, 'EN');
      expect(notice.privacyNoticeCopy?.retention).toContain('365 days');
    });

    it('a language the profile has no copy for reads the EN lines, not a blank', async () => {
      tenant.privacyProfile = 'vn_pdpl';
      const notice = await svc.privacyNotice(4, null, 'KO');
      expect(notice.privacyNoticeCopy?.title).toBe('Personal data processing notice');
    });

    it('leaves a tenant on another profile exactly as it was', async () => {
      tenant.privacyProfile = 'lodging';
      const notice = await svc.privacyNotice(4, null, 'EN');
      expect(Object.keys(notice.privacyNoticeCopy ?? {}).sort()).toEqual(['items', 'purpose']);
    });
  });
});
