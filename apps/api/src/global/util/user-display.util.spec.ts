import { displayNameOf, nameFromEmail } from './user-display.util';

describe('user display name (w3c, ops-manual finding 13)', () => {
  it('prefers the real name, trimmed', () => {
    expect(displayNameOf({ name: '  Linh Tran ', email: 'cs01@go2joy.example' })).toBe('Linh Tran');
  });

  it('derives a readable name from the e-mail local part when no name is set', () => {
    expect(displayNameOf({ name: null, email: 'hung.nguyen@go2joy.example' })).toBe('Hung Nguyen');
    expect(displayNameOf({ name: '', email: 'minh_anh-le+cs@go2joy.example' })).toBe('Minh Anh Le Cs');
    expect(displayNameOf({ email: 'cs01@go2joy.example' })).toBe('Cs01');
  });

  it('never returns the domain, so a customer-irrelevant address part is not copied', () => {
    expect(displayNameOf({ email: 'sa@go2joy.example' })).toBe('Sa');
    expect(nameFromEmail('sa@go2joy.example')).not.toContain('go2joy');
  });

  it('is null when there is nothing to show (the caller supplies its own fallback)', () => {
    expect(displayNameOf(null)).toBeNull();
    expect(displayNameOf(undefined)).toBeNull();
    expect(displayNameOf({ name: ' ', email: '' })).toBeNull();
    expect(displayNameOf({ email: '@go2joy.example' })).toBeNull();
    expect(displayNameOf({ email: '...@x.y' })).toBeNull();
  });

  it('caps a very long name so a toast and a note stay readable', () => {
    expect(displayNameOf({ name: 'x'.repeat(300) })!.length).toBe(80);
  });
});
