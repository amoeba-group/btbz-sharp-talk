import { AUDIENCE } from '@sharptalk/types';
import { scenarioAudienceShows, scenarioPressAllowed } from './scenario-audience.util';

/**
 * Who sees a scenario button and who may press it (PLN-261012 SG-10).
 * The press rule is the one the endpoint ENFORCES; showing is presentation.
 */
describe('scenarioAudienceShows', () => {
  it.each([
    [undefined, 'public', true],
    [undefined, 'partner', true],
    [undefined, 'manager', true],
    ['all', 'public', true],
    ['guest', 'public', true],
    ['guest', 'partner', false],
    ['guest', 'manager', false],
    ['verified', 'public', false],
    ['verified', 'partner', true],
    ['verified', 'manager', true],
    ['manager', 'public', false],
    ['manager', 'partner', false],
    ['manager', 'manager', true],
  ] as const)('audience %s shown to %s: %s', (audience, viewer, expected) => {
    expect(scenarioAudienceShows(audience, viewer)).toBe(expected);
  });
});

describe('scenarioPressAllowed', () => {
  const resolve = (a: string) => (a === 'delivery_status' ? 'shipping_policy' : a);
  const btn = (action: string, audience?: 'all' | 'guest' | 'verified' | 'manager') => ({ action, ...(audience ? { audience } : {}) });

  it('a manager may press anything', () => {
    expect(scenarioPressAllowed([btn('payout', 'manager')], 'payout', AUDIENCE.MANAGER)).toBe(true);
  });

  it.each([AUDIENCE.PUBLIC, AUDIENCE.PARTNER])('a %s viewer is REFUSED a manager-only button', (viewer) => {
    expect(scenarioPressAllowed([btn('payout', 'manager')], 'payout', viewer)).toBe(false);
  });

  it('an action no button uses is not judged (a follow-up chip, an older client)', () => {
    expect(scenarioPressAllowed([btn('payout', 'manager')], 'return_exchange', AUDIENCE.PARTNER)).toBe(true);
    expect(scenarioPressAllowed([], 'anything', AUDIENCE.PUBLIC)).toBe(true);
  });

  it('is allowed when ANY button that runs the action is open to the viewer', () => {
    const buttons = [btn('payout', 'manager'), btn('payout', 'all')];
    expect(scenarioPressAllowed(buttons, 'payout', AUDIENCE.PARTNER)).toBe(true);
    expect(scenarioPressAllowed([btn('payout', 'manager'), btn('payout')], 'payout', AUDIENCE.PUBLIC)).toBe(true);
  });

  it('is refused only when EVERY button that runs the action is manager-only', () => {
    expect(scenarioPressAllowed([btn('payout', 'manager'), btn('payout', 'manager')], 'payout', AUDIENCE.PARTNER)).toBe(false);
  });

  it('judges the SCRIPT the action resolves to, not the spelling the caller used', () => {
    const buttons = [btn('delivery_status', 'manager')];
    expect(scenarioPressAllowed(buttons, 'shipping_policy', AUDIENCE.PARTNER, resolve)).toBe(false);
    expect(scenarioPressAllowed(buttons, 'delivery_status', AUDIENCE.PARTNER, resolve)).toBe(false);
  });

  it('guest / verified stay presentation-only: they are not enforced at press time', () => {
    expect(scenarioPressAllowed([btn('login', 'guest')], 'login', AUDIENCE.MANAGER)).toBe(true);
    expect(scenarioPressAllowed([btn('desk', 'verified')], 'desk', AUDIENCE.PUBLIC)).toBe(true);
    expect(scenarioPressAllowed([btn('login', 'guest')], 'login', AUDIENCE.PARTNER)).toBe(true);
  });
});
