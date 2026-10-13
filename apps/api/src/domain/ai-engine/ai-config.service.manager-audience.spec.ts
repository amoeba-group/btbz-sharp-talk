import { AiConfigService } from './ai-config.service';
import type { ScenarioButton } from './entity/tenant-ai-config.entity';

/**
 * The `manager` scenario-button audience and the manager-notice wording
 * (PLN-261012 SG-10). Which buttons the widget LISTS is decided here; whether a press
 * may RUN is scenario.service's (scenario.service.manager-audience.spec.ts).
 */
describe('AiConfigService — manager audience', () => {
  const HOUR = 3_600_000;

  function build(opts: { buttons?: ScenarioButton[]; viewer?: 'guest' | 'v1' | 'receptionist' | 'manager' | 'internal'; claimsAgeMs?: number } = {}) {
    const viewer = opts.viewer ?? 'guest';
    const signed = viewer === 'receptionist' || viewer === 'manager' || viewer === 'internal';
    const session = {
      id: 9,
      tenantId: 1,
      aiAgentId: null,
      language: 'VI',
      identityLevel: viewer === 'guest' ? 'guest' : 'verified',
      identityClaims: signed
        ? { hotelSn: '1721', role: viewer, signed: true, verifiedAt: new Date(Date.now() - (opts.claimsAgeMs ?? 0)).toISOString() }
        : null,
    };
    const svc = new AiConfigService(
      { findOne: jest.fn(async () => ({ tenantId: 1, scenarioButtons: opts.buttons ?? [] })) } as never,
      { findOne: jest.fn(async () => null) } as never,
      { findOne: jest.fn(async () => session) } as never,
      { findOne: jest.fn(async () => ({ id: 1, identityPolicy: null })) } as never,
      { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as never,
      { record: jest.fn() } as never,
      {} as never,
    );
    return svc;
  }

  const btn = (id: string, audience?: ScenarioButton['audience']): ScenarioButton => ({
    id,
    label: id,
    action: 'payout_guide',
    enabled: true,
    ...(audience ? { audience } : {}),
  });
  const buttons = [btn('login', 'guest'), btn('desk', 'verified'), btn('settlement', 'manager'), btn('contact', 'all')];
  const shown = async (svc: AiConfigService) => (await svc.getScenarioForSession('tok')).scenarioButtons.map((b) => b.id);

  it.each([
    ['a guest', { viewer: 'guest' as const }, ['login', 'contact']],
    ['a v1-verified user', { viewer: 'v1' as const }, ['desk', 'contact']],
    ['a receptionist', { viewer: 'receptionist' as const }, ['desk', 'contact']],
    ['a manager', { viewer: 'manager' as const }, ['desk', 'settlement', 'contact']],
    ['an internal account', { viewer: 'internal' as const }, ['desk', 'settlement', 'contact']],
  ])('%s sees the right menu', async (_who, cfg, expected) => {
    expect(await shown(build({ buttons, ...cfg }))).toEqual(expected);
  });

  it('a manager whose claims lapsed gets the guest menu back, not the manager one', async () => {
    expect(await shown(build({ buttons, viewer: 'manager', claimsAgeMs: 9 * HOUR }))).toEqual(['login', 'contact']);
  });

  it('keeps `manager` on save and still drops unknown values', () => {
    const svc = build();
    const out = (svc as unknown as { sanitize: (b: ScenarioButton[]) => ScenarioButton[] }).sanitize([
      btn('m', 'manager'),
      btn('g', 'guest'),
      { ...btn('x'), audience: 'admin' as never },
    ]);
    expect(out.map((b) => b.audience)).toEqual(['manager', 'guest', undefined]);
  });

  describe('guest guidance: the manager notice', () => {
    const sanitize = (input: Record<string, unknown> | null) =>
      (build() as unknown as { sanitizeGuestGuidance: (i: Record<string, unknown> | null) => unknown }).sanitizeGuestGuidance(input);

    it('keeps a per-language manager notice, trimmed, known languages only', () => {
      expect(
        sanitize({ manager_notice: { VI: ' Hãy hỏi Quản lý ', EN: 'Ask your manager', xx: 'nope', KO: '  ' } }),
      ).toEqual({
        managerNotice: { VI: 'Hãy hỏi Quản lý', EN: 'Ask your manager' },
        loginUrl: null,
        signupUrl: null,
        hostLinkTemplate: null,
      });
    });

    it('accepts the camelCase spelling and keeps the sign-in notice separate', () => {
      expect(sanitize({ managerNotice: { VI: 'a' }, notice: { VI: 'b' } })).toMatchObject({
        notice: { VI: 'b' },
        managerNotice: { VI: 'a' },
      });
    });

    it('a manager notice alone is a configuration (not "empty")', () => {
      expect(sanitize({ managerNotice: { VI: 'a' } })).not.toBeNull();
    });

    it('with no manager notice the stored shape is exactly what it was', () => {
      expect(sanitize({ notice: { VI: 'b' } })).toEqual({
        notice: { VI: 'b' },
        loginUrl: null,
        signupUrl: null,
        hostLinkTemplate: null,
      });
    });
  });
});
