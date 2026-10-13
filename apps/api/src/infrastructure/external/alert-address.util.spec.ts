import { resolveAlertRecipient, resolveMailFrom } from './alert-address.util';

/** PLN-261012 SG-80 — no Amoeba address survives as a default recipient or sender. */
describe('resolveAlertRecipient', () => {
  it('prefers the dedicated AI_ALERT_EMAIL, trimmed', () => {
    expect(resolveAlertRecipient({ AI_ALERT_EMAIL: ' ops@example.com ', ALERT_EMAIL_TO: 'noc@example.com' })).toBe(
      'ops@example.com',
    );
  });

  it('falls back to ALERT_EMAIL_TO when the dedicated one is blank or absent', () => {
    expect(resolveAlertRecipient({ AI_ALERT_EMAIL: '', ALERT_EMAIL_TO: 'noc@example.com' })).toBe('noc@example.com');
    expect(resolveAlertRecipient({ ALERT_EMAIL_TO: 'noc@example.com' })).toBe('noc@example.com');
  });

  it('is null — not an Amoeba mailbox — when nothing is configured', () => {
    expect(resolveAlertRecipient({})).toBeNull();
    expect(resolveAlertRecipient({ AI_ALERT_EMAIL: '  ', ALERT_EMAIL_TO: ' ' })).toBeNull();
  });
});

describe('resolveMailFrom', () => {
  it('uses ALERT_EMAIL_FROM when set', () => {
    expect(resolveMailFrom({ from: 'support@go2joy.vn', smtpUser: 'u', appPublicUrl: 'https://talk.go2joy.vn' })).toBe(
      'support@go2joy.vn',
    );
  });

  it('treats a BLANK ALERT_EMAIL_FROM as unset (an env file line "ALERT_EMAIL_FROM=" is an empty string)', () => {
    expect(resolveMailFrom({ from: '', smtpUser: 'mailer@go2joy.vn' })).toBe('mailer@go2joy.vn');
    expect(resolveMailFrom({ from: '   ', smtpUser: '', appPublicUrl: 'https://talk.go2joy.vn' })).toBe(
      'noreply@talk.go2joy.vn',
    );
  });

  it('derives the sender from the deployment public URL and drops the port', () => {
    expect(resolveMailFrom({ appPublicUrl: 'https://talk.example.com:8443/x' })).toBe('noreply@talk.example.com');
  });

  it('never returns the old Amoeba placeholder', () => {
    expect(resolveMailFrom({})).toBe('noreply@localhost');
    expect(resolveMailFrom({ appPublicUrl: 'not a url' })).toBe('noreply@localhost');
    expect(resolveMailFrom({})).not.toContain('ivyusa');
  });
});
