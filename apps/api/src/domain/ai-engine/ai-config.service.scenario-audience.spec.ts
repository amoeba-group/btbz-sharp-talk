import { AiConfigService } from './ai-config.service';
import type { ScenarioButton } from './entity/tenant-ai-config.entity';

/**
 * Guest gate configuration (PLN-261001 v1.1): scenario-button audience, the
 * guest guidance sanitizer, and the guest policy riding in the persona payload.
 */
describe('AiConfigService — guest gate configuration', () => {
  function build(opts: {
    buttons?: ScenarioButton[];
    identityLevel?: string;
    agentRow?: Record<string, unknown> | null;
    /** Signed claims on the session (identify v2), and the tenant's identity policy. */
    claims?: Record<string, unknown> | null;
    policy?: unknown;
  } = {}) {
    const session = {
      id: 9,
      tenantId: 1,
      aiAgentId: null,
      language: 'VI',
      identityLevel: opts.identityLevel ?? 'guest',
      identityClaims: opts.claims ?? null,
    };
    const sessionRepo = { findOne: jest.fn(async () => session) };
    const configRepo = {
      findOne: jest.fn(async () => ({ tenantId: 1, scenarioButtons: opts.buttons ?? [] })),
    };
    const agentRepo = { findOne: jest.fn(async () => opts.agentRow ?? null) };
    const svc = new AiConfigService(
      configRepo as never,
      agentRepo as never,
      sessionRepo as never,
      { findOne: jest.fn(async () => ({ id: 1, identityPolicy: opts.policy ?? null })) } as never,
      { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as never,
      { record: jest.fn() } as never,
      {} as never,
    );
    return { svc };
  }

  const btn = (id: string, audience?: 'all' | 'guest' | 'verified'): ScenarioButton => ({
    id,
    label: id,
    action: 'message',
    enabled: true,
    ...(audience ? { audience } : {}),
  });

  describe('scenario audience', () => {
    it('buttons without an audience show to everyone (pre-v1.1 shape)', async () => {
      const h = build({ buttons: [btn('a'), btn('b')] });
      const res = await h.svc.getScenarioForSession('tok');
      expect(res.scenarioButtons.map((b) => b.id)).toEqual(['a', 'b']);
    });

    it('a guest sees guest + all buttons, never verified-only ones', async () => {
      const h = build({
        buttons: [btn('login', 'guest'), btn('settlement', 'verified'), btn('contact', 'all')],
        identityLevel: 'guest',
      });
      const res = await h.svc.getScenarioForSession('tok');
      expect(res.scenarioButtons.map((b) => b.id)).toEqual(['login', 'contact']);
    });

    it('an identified session sees verified + all buttons, never guest-only ones', async () => {
      const h = build({
        buttons: [btn('login', 'guest'), btn('settlement', 'verified'), btn('contact', 'all')],
        identityLevel: 'verified',
      });
      const res = await h.svc.getScenarioForSession('tok');
      expect(res.scenarioButtons.map((b) => b.id)).toEqual(['settlement', 'contact']);
    });

    describe('lapsed signed claims read as a guest (PLN-261012 SG-03)', () => {
      const HOUR = 3_600_000;
      const signed = (ageMs: number) => ({
        hotelSn: '1721',
        role: 'receptionist',
        signed: true,
        verifiedAt: new Date(Date.now() - ageMs).toISOString(),
      });
      const buttons = [btn('login', 'guest'), btn('settlement', 'verified'), btn('contact', 'all')];

      it('claims in force keep the partner menu', async () => {
        const h = build({ buttons, identityLevel: 'verified', claims: signed(HOUR) });
        const res = await h.svc.getScenarioForSession('tok');
        expect(res.scenarioButtons.map((b) => b.id)).toEqual(['settlement', 'contact']);
      });

      it('claims past the default 8 h bring the guest menu back (sign in again), not the partner one', async () => {
        const h = build({ buttons, identityLevel: 'verified', claims: signed(9 * HOUR) });
        const res = await h.svc.getScenarioForSession('tok');
        expect(res.scenarioButtons.map((b) => b.id)).toEqual(['login', 'contact']);
      });

      it('the tenant policy sets the limit', async () => {
        const longer = build({ buttons, identityLevel: 'verified', claims: signed(9 * HOUR), policy: { maxAgeHours: 12 } });
        const shorter = build({ buttons, identityLevel: 'verified', claims: signed(3 * HOUR), policy: { maxAgeHours: 2 } });
        expect((await longer.svc.getScenarioForSession('tok')).scenarioButtons.map((b) => b.id)).toEqual(['settlement', 'contact']);
        expect((await shorter.svc.getScenarioForSession('tok')).scenarioButtons.map((b) => b.id)).toEqual(['login', 'contact']);
      });

      it('a platform login (verified, no claims) is never aged', async () => {
        const h = build({ buttons, identityLevel: 'verified', claims: null });
        const res = await h.svc.getScenarioForSession('tok');
        expect(res.scenarioButtons.map((b) => b.id)).toEqual(['settlement', 'contact']);
      });
    });

    it('the save-path sanitizer keeps a narrowed audience and drops unknown values', () => {
      const h = build();
      const out = (
        h.svc as unknown as { sanitize: (b: ScenarioButton[]) => ScenarioButton[] }
      ).sanitize([
        btn('g', 'guest'),
        btn('v', 'verified'),
        btn('a', 'all'),
        { ...btn('x'), audience: 'everyone' as never },
      ]);
      expect(out.map((b) => b.audience)).toEqual(['guest', 'verified', undefined, undefined]);
    });
  });

  describe('guest guidance sanitizer', () => {
    const sanitize = (svc: AiConfigService, input: Record<string, unknown> | null) =>
      (svc as unknown as { sanitizeGuestGuidance: (i: Record<string, unknown> | null) => unknown })
        .sanitizeGuestGuidance(input);

    it('keeps https links, per-language notice and a template that carries {hotelSn}', () => {
      const h = build();
      expect(
        sanitize(h.svc, {
          login_url: ' https://ha.go2joy.vn/sign-in ',
          signup_url: 'https://ha.go2joy.vn/sign-up',
          notice: { VI: ' Vui lòng đăng nhập ', EN: 'Please sign in', xx: 'nope', KO: '  ' },
          host_link_template: 'https://ha.go2joy.vn/hotel?hotelSn={hotelSn}',
        }),
      ).toEqual({
        loginUrl: 'https://ha.go2joy.vn/sign-in',
        signupUrl: 'https://ha.go2joy.vn/sign-up',
        notice: { VI: 'Vui lòng đăng nhập', EN: 'Please sign in' },
        hostLinkTemplate: 'https://ha.go2joy.vn/hotel?hotelSn={hotelSn}',
      });
    });

    it('drops non-https links and a template without the placeholder', () => {
      const h = build();
      expect(
        sanitize(h.svc, {
          loginUrl: 'javascript:alert(1)',
          signupUrl: 'http://ha.go2joy.vn/sign-up',
          hostLinkTemplate: 'https://ha.go2joy.vn/hotels',
        }),
      ).toBeNull();
    });

    it('accepts camelCase as well as snake_case keys and returns null when empty', () => {
      const h = build();
      expect(sanitize(h.svc, { loginUrl: 'https://x.test/login' })).toEqual({
        loginUrl: 'https://x.test/login',
        signupUrl: null,
        hostLinkTemplate: null,
      });
      expect(sanitize(h.svc, {})).toBeNull();
      expect(sanitize(h.svc, null)).toBeNull();
    });
  });

  describe('guest policy in the persona payload', () => {
    it("reads the agent's policy, defaulting to open when the row predates the column", async () => {
      const gated = build({ agentRow: { id: 10, tenantId: 1, persona: 'p', rules: [], guestPolicy: 'login_guidance' } });
      expect((await gated.svc.getPersonaRules(1, 10)).guestPolicy).toBe('login_guidance');

      const legacy = build({ agentRow: { id: 10, tenantId: 1, persona: 'p', rules: [] } });
      expect((await legacy.svc.getPersonaRules(1, 10)).guestPolicy).toBe('open');
    });

    it('a tenant with no agent rows is open', async () => {
      const h = build({ agentRow: null });
      expect((await h.svc.getPersonaRules(1, null)).guestPolicy).toBe('open');
    });
  });
});
