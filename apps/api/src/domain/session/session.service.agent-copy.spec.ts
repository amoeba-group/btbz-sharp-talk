import { SessionService } from './session.service';
import { RedisService } from '../../infrastructure/cache/redis.service';

/**
 * Per-agent widget identity (REQ-260825 R3/R4): the session's AI agent (or the
 * tenant default for NULL pins) overrides displayName/firstVisit; everything
 * the agent leaves NULL falls back to the tenant's widget copy.
 */
describe('SessionService.privacyNotice — agent copy overrides', () => {
  function build(agents: Array<Record<string, unknown>>) {
    const tenant = {
      id: 1,
      name: 'IVY USA',
      widgetCopy: {
        displayName: '상점 상담',
        firstVisit: { KO: '상점 공통 인사' },
        loginGreeting: { KO: '로그인 인사' },
      },
    };
    const tenantRepo = { findOne: jest.fn(async () => tenant) };
    const aiAgentRepo = {
      findOne: jest.fn(async (q: { where: Record<string, unknown> }) => {
        if (q.where.id != null) {
          return agents.find((a) => Number(a.id) === Number(q.where.id)) ?? null;
        }
        return agents.find((a) => a.isDefault === 1) ?? null;
      }),
    };
    const redis = { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() };
    const svc = new SessionService(
      {} as never,
      tenantRepo as never,
      {} as never,
      { publish: jest.fn() } as never,
      redis as unknown as RedisService,
      aiAgentRepo as never,
    );
    return { svc, aiAgentRepo };
  }

  it('overrides displayName and firstVisit with the pinned agent values', async () => {
    const h = build([
      { id: 7, tenantId: 1, displayName: 'Livy', greeting: { KO: 'Livy 인사' }, isDefault: 0 },
    ]);

    const notice = await h.svc.privacyNotice(1, 7);

    expect(notice.widgetCopy.displayName).toBe('Livy');
    expect(notice.widgetCopy.firstVisit).toEqual({ KO: 'Livy 인사' });
    // Login greeting stays tenant-level — no per-agent field exists for it.
    expect(notice.widgetCopy.loginGreeting).toEqual({ KO: '로그인 인사' });
  });

  it('a NULL pin resolves to the tenant DEFAULT agent, whose overrides apply', async () => {
    const h = build([
      { id: 3, tenantId: 1, displayName: '기본이', greeting: null, isDefault: 1 },
    ]);

    const notice = await h.svc.privacyNotice(1, null);

    expect(notice.widgetCopy.displayName).toBe('기본이');
    // Agent greeting NULL → tenant firstVisit shows through.
    expect(notice.widgetCopy.firstVisit).toEqual({ KO: '상점 공통 인사' });
  });

  it('PLN-261019 bags pass through as stored, empty when the tenant never set them', async () => {
    const h = build([{ id: 7, tenantId: 1, displayName: 'Livy', greeting: {}, isDefault: 0 }]);
    const notice = await h.svc.privacyNotice(1, 7);
    expect(notice.widgetCopy).toMatchObject({ headerTitle: {}, aiSenderName: {}, agentSenderName: {}, launcherTeaser: {} });
  });

  it('an agent with no overrides changes nothing', async () => {
    const h = build([{ id: 7, tenantId: 1, displayName: null, greeting: {}, isDefault: 0 }]);

    const notice = await h.svc.privacyNotice(1, 7);

    expect(notice.widgetCopy.displayName).toBe('상점 상담');
    expect(notice.widgetCopy.firstVisit).toEqual({ KO: '상점 공통 인사' });
  });
});
