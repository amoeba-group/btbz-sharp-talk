import { CONSENT_STATE, CONVERSATION_STATUS, MODERATION_DECISION } from '@sharptalk/types';
import { ChatService } from './chat.service';
import type { Session } from '../session/entity/session.entity';
import { HandoffRouterService } from '../ai-engine/handoff-router.service';
import type { AiConfigService } from '../ai-engine/ai-config.service';
import type { HandoffConfig } from '../ai-engine/entity/tenant-ai-config.entity';
import { fakeRepo } from '../agent/testing/fake-table';
import type { Row } from '../agent/testing/fake-table';

/**
 * What the hand-off writes and decides (PLN-261012 SG-63/SG-65/SG-67): the start of the waiting
 * spell (`escalated_at`, first hand-off only), the "?" hint for a province the table does not list,
 * the strict-mode flag on the event, and the region/team scope the route decision is made with —
 * which is what makes the regional off-hours mailbox and a team's own business hours work end to end.
 */
const REGION = { category: 'south_central', team: 'south', label: 'South (South Central)' };
const T0 = Date.parse('2026-10-14T09:00:00.000Z'); // Wednesday 16:00 in Ho Chi Minh City

describe('ChatService — hand-off bookkeeping and route scope', () => {
  function build(
    opts: {
      lookup?: Record<string, unknown>;
      conv?: Row;
      route?: jest.Mock;
      router?: unknown;
    } = {},
  ) {
    const convs = fakeRepo<Row>([{ id: 77, sessionId: 5, tenantId: 1, status: 'ai_active', escalatedAt: null, unclaimedPages: 0, ...opts.conv }]);
    const publish = jest.fn();
    const calls: string[] = [];
    const regionLookup = jest.fn(async () => {
      calls.push('lookup');
      return opts.lookup ?? { region: null };
    });
    const route =
      opts.route ??
      jest.fn(async () => {
        calls.push('route');
        return { mode: 'agents', targetUserIds: [] };
      });
    const svc = new ChatService(
      { findOne: convs.findOne, update: convs.update } as never,
      {
        create: jest.fn((m: Record<string, unknown>) => m),
        save: jest.fn(async (m: Record<string, unknown>) => m),
        findOne: jest.fn(async () => ({ body: 'Hoa hồng tính thế nào?' })),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      (opts.router ?? { teamQuestion: jest.fn(async () => null), route, regionLookup }) as never,
      { publish } as never,
      { contactEmail: jest.fn(async () => 'shopper@example.com') } as never,
      {} as never,
    );
    const session = {
      id: 5,
      tenantId: 1,
      language: 'EN',
      channel: 'widget',
      identityClaims: { hotelSn: '1721', role: 'manager', signed: true, province: 'Đà Nẵng', verifiedAt: new Date().toISOString() },
    } as unknown as Session;
    return { svc, session, convs, conv: convs.table[0], publish, regionLookup, route, calls };
  }

  describe('escalated_at — the start of the waiting spell (SG-63/SG-66)', () => {
    afterEach(() => jest.useRealTimers());

    it('escalate stamps it, and resets the unclaimed counters', async () => {
      jest.useFakeTimers().setSystemTime(T0);
      const h = build({ conv: { unclaimedPages: 2, unclaimedPagedAt: new Date(T0 - 1000) } });
      await h.svc.escalate(h.session, 77);
      expect(h.conv.status).toBe('waiting');
      expect(new Date(h.conv.escalatedAt as Date).getTime()).toBe(T0);
      expect(h.conv.unclaimedPages).toBe(0);
      expect(h.conv.unclaimedPagedAt).toBeNull();
    });

    it('the automatic hand-off stamps it too', async () => {
      jest.useFakeTimers().setSystemTime(T0);
      const h = build();
      await h.svc.handoff(77, h.session, 1, 'low_confidence', 'Hoa hồng tính thế nào?');
      expect(new Date(h.conv.escalatedAt as Date).getTime()).toBe(T0);
    });

    it('a repeat request on a thread that is already waiting keeps the ORIGINAL time', async () => {
      jest.useFakeTimers().setSystemTime(T0);
      const h = build();
      await h.svc.escalate(h.session, 77);
      jest.setSystemTime(T0 + 20 * 60_000);
      await h.svc.escalate(h.session, 77);
      await h.svc.handoff(77, h.session, 1, 'user_request', 'again');
      expect(new Date(h.conv.escalatedAt as Date).getTime()).toBe(T0);
    });

    it('after a hand-back cleared it, the next hand-off starts a fresh spell', async () => {
      jest.useFakeTimers().setSystemTime(T0);
      const h = build();
      await h.svc.escalate(h.session, 77);
      h.conv.escalatedAt = null; // what AgentService.handBack does
      jest.setSystemTime(T0 + 3_600_000);
      await h.svc.escalate(h.session, 77);
      expect(new Date(h.conv.escalatedAt as Date).getTime()).toBe(T0 + 3_600_000);
    });

    it('the preview sandbox is never stamped', async () => {
      const h = build();
      const preview = { ...h.session, channel: 'preview' } as unknown as Session;
      await h.svc.escalate(preview, 77);
      await h.svc.handoff(77, preview, 1, 'user_request', 'hi');
      expect(h.conv.escalatedAt).toBeNull();
    });
  });

  describe('the "?" hint for an unmapped province (SG-65)', () => {
    it('persists the province on the conversation, and stamps no region', async () => {
      const h = build({ lookup: { region: null, unmapped: 'Tp Quy Nhơn' } });
      await h.svc.escalate(h.session, 77);
      expect(h.conv.supportRegionHint).toBe('Tp Quy Nhơn');
      expect(h.conv.supportRegion).toBeUndefined();
    });

    it('persists it on the automatic hand-off too, bounded to the column', async () => {
      const h = build({ lookup: { region: null, unmapped: 'x'.repeat(100) } });
      await h.svc.handoff(77, h.session, 1, 'low_confidence', 'q');
      expect(h.conv.supportRegionHint).toBe('x'.repeat(64));
    });

    it('a resolved region stamps the team and leaves the hint alone', async () => {
      const h = build({ lookup: { region: REGION } });
      await h.svc.escalate(h.session, 77);
      expect(h.conv.supportRegion).toBe('south');
      expect(h.conv.supportRegionHint).toBeUndefined();
    });

    it('no region and no unmapped province writes neither', async () => {
      const h = build({ lookup: { region: null } });
      await h.svc.escalate(h.session, 77);
      expect(h.conv.supportRegion).toBeUndefined();
      expect(h.conv.supportRegionHint).toBeUndefined();
    });
  });

  describe('the strict flag on the event (SG-67)', () => {
    it('carries the table mode with a resolved region, and with an unmapped one', async () => {
      const resolved = build({ lookup: { region: REGION, mode: 'strict' } });
      await resolved.svc.escalate(resolved.session, 77);
      expect(resolved.publish.mock.calls[0][1]).toMatchObject({ supportRegion: 'south', regionMode: 'strict' });

      const unmapped = build({ lookup: { region: null, unmapped: 'Pleiku', mode: 'strict' } });
      await unmapped.svc.handoff(77, unmapped.session, 1, 'low_confidence', 'q');
      expect(unmapped.publish.mock.calls[0][1]).toMatchObject({ regionUnmapped: 'Pleiku', regionMode: 'strict' });
    });

    it('is absent in prefer mode — the event is what it always was', async () => {
      const h = build({ lookup: { region: REGION } });
      await h.svc.escalate(h.session, 77);
      expect((h.publish.mock.calls[0][1] as Record<string, unknown>).regionMode).toBeUndefined();
    });
  });

  describe('the route decision gets the hotel region and the picked team (SG-67)', () => {
    it('escalate resolves the region first, then routes with region and team', async () => {
      const route = jest.fn(async () => ({ mode: 'agents', targetUserIds: [] }));
      const calls: string[] = [];
      const router = {
        teamQuestion: jest.fn(async () => ({
          prompt: 'q',
          options: [{ id: 'business', jobLabel: 'sales_admin', label: 'Business Support' }],
        })),
        regionLookup: jest.fn(async () => {
          calls.push('lookup');
          return { region: REGION };
        }),
        route: jest.fn(async (...args: unknown[]) => {
          calls.push('route');
          return route(...(args as []));
        }),
      };
      const h = build({ router });
      await h.svc.escalate(h.session, 77, 'business');
      expect(calls).toEqual(['lookup', 'route']);
      expect(router.route).toHaveBeenCalledWith(1, 'EN', { region: 'south', supportType: 'business' });
    });

    it('with no team question the scope still carries the conversation own team', async () => {
      const h = build({ conv: { supportType: 'cs' }, lookup: { region: REGION } });
      await h.svc.escalate(h.session, 77);
      expect(h.route).toHaveBeenCalledWith(1, 'EN', { region: 'south', supportType: 'cs' });
    });

    it('the automatic hand-off routes with the region (no team is known there)', async () => {
      const h = build({ lookup: { region: REGION } });
      await h.svc.handoff(77, h.session, 1, 'low_confidence', 'q');
      expect(h.calls).toEqual(['lookup', 'route']);
      expect(h.route).toHaveBeenCalledWith(1, 'EN', { region: 'south' });
    });

    it('a failing region lookup still routes (by label alone), with no region', async () => {
      const h = build();
      h.regionLookup.mockRejectedValueOnce(new Error('config unavailable'));
      await h.svc.escalate(h.session, 77);
      expect(h.route).toHaveBeenCalledWith(1, 'EN', { region: null, supportType: undefined });
    });
  });

  describe('end to end with the real router: regional mailbox and per-team hours (SG-67)', () => {
    afterEach(() => jest.useRealTimers());

    const HOURS = { timezone: 'Asia/Ho_Chi_Minh', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };
    function realRouter(config: HandoffConfig) {
      return new HandoffRouterService({ getHandoffConfig: jest.fn(async () => config) } as unknown as AiConfigService);
    }
    const teamRouting = (businessHours?: HandoffConfig['businessHours']) => ({
      enabled: true,
      options: [
        { id: 'cs', jobLabel: 'consult', businessHours },
        { id: 'business', jobLabel: 'sales_admin' },
      ],
    });

    it('off hours, a hotel of a region with its own mailbox is mailed THERE, not at the shared one', async () => {
      // Wed 2026-10-14 20:00 in Ho Chi Minh City: after hours.
      jest.useFakeTimers().setSystemTime(Date.parse('2026-10-14T13:00:00Z'));
      const router = realRouter({
        businessHours: HOURS,
        offHours: { email: 'cs@example.com', emailByRegion: { south: 'south@example.com' } },
        regionRouting: { enabled: true, categories: [{ id: 'south_central', team: 'south', provinces: ['Đà Nẵng'] }] },
      });
      const h = build({ router });
      await h.svc.escalate(h.session, 77);
      expect(h.publish.mock.calls[0][1]).toMatchObject({ offHoursEmail: 'south@example.com', supportRegion: 'south' });
    });

    it('a hotel of a region with no mailbox of its own falls back to the shared one', async () => {
      jest.useFakeTimers().setSystemTime(Date.parse('2026-10-14T13:00:00Z'));
      const router = realRouter({
        businessHours: HOURS,
        offHours: { email: 'cs@example.com', emailByRegion: { north: 'north@example.com' } },
        regionRouting: { enabled: true, categories: [{ id: 'south_central', team: 'south', provinces: ['Đà Nẵng'] }] },
      });
      const h = build({ router });
      await h.svc.escalate(h.session, 77);
      expect(h.publish.mock.calls[0][1]).toMatchObject({ offHoursEmail: 'cs@example.com' });
    });

    it('a team with its own hours is paged while the tenant-wide hours say closed', async () => {
      // 20:00: the shared hours are over, but the CS team works until 22:00.
      jest.useFakeTimers().setSystemTime(Date.parse('2026-10-14T13:00:00Z'));
      const router = realRouter({
        businessHours: HOURS,
        offHours: { email: 'cs@example.com' },
        teamRouting: teamRouting({ ...HOURS, start: '12:00', end: '22:00' }),
      });
      const cs = build({ router });
      await cs.svc.escalate(cs.session, 77, 'cs');
      expect((cs.publish.mock.calls[0][1] as Record<string, unknown>).offHoursEmail).toBeUndefined();

      // The Business team has no hours of its own, so the closed tenant-wide hours apply to it.
      const business = build({ router });
      await business.svc.escalate(business.session, 77, 'business');
      expect(business.publish.mock.calls[0][1]).toMatchObject({ offHoursEmail: 'cs@example.com' });
    });

    it('and the reverse: a team that is closed is emailed while the shared hours are open', async () => {
      jest.useFakeTimers().setSystemTime(T0); // Wed 16:00 local: shared hours are open
      const router = realRouter({
        businessHours: HOURS,
        offHours: { email: 'cs@example.com' },
        teamRouting: teamRouting({ ...HOURS, start: '08:00', end: '12:00' }),
      });
      const cs = build({ router });
      await cs.svc.escalate(cs.session, 77, 'cs');
      expect(cs.publish.mock.calls[0][1]).toMatchObject({ offHoursEmail: 'cs@example.com' });
    });

    it('a tenant with neither feature configured routes exactly as before', async () => {
      jest.useFakeTimers().setSystemTime(Date.parse('2026-10-14T13:00:00Z'));
      const router = realRouter({ businessHours: HOURS, offHours: { email: 'cs@example.com' } });
      const h = build({ router });
      await h.svc.escalate(h.session, 77);
      expect(h.publish.mock.calls[0][1]).toMatchObject({ offHoursEmail: 'cs@example.com' });
    });
  });
});

describe('ChatService — keeping the email reply channel with the hand-off scope (SG-67)', () => {
  function build(conv: Row) {
    const conversation = { id: 77, tenantId: 1, sessionId: 5, status: CONVERSATION_STATUS.WAITING, agentId: null, replyChannel: 'email', ...conv };
    const route = jest.fn(async () => ({ mode: 'email', targetUserIds: [] }));
    const svc = new ChatService(
      { findOne: jest.fn(async () => conversation), update: jest.fn(), create: (c: unknown) => c, save: jest.fn() } as never,
      { save: jest.fn(async (m: Record<string, unknown>) => ({ ...m, id: 1 })), create: (m: unknown) => m, update: jest.fn(), find: jest.fn(async () => []) } as never,
      {} as never,
      {} as never,
      {} as never,
      { update: jest.fn() } as never,
      {
        effectiveAgentId: jest.fn(async () => null),
        agentGuestPolicy: jest.fn(async () => 'open'),
        classifyIntent: jest.fn(async () => ({ intent: 'x', needsOrderData: false, confidence: 0.9 })),
        answer: jest.fn(async () => ({ text: 'ok', confidence: 0.9, citations: [] })),
      } as never,
      { moderate: jest.fn(async () => ({ decision: MODERATION_DECISION.DELIVERED, text: 'ok' })) } as never,
      {} as never,
      { effectiveConsentFor: jest.fn(async () => CONSENT_STATE.GRANTED) } as never,
      { route, denyMatch: jest.fn(async () => null) } as never,
      { publish: jest.fn() } as never,
      { contactEmail: jest.fn(async () => 'shopper@example.com') } as never,
      { del: jest.fn() } as never,
    );
    const session = { id: 5, sessionToken: 'tok', tenantId: 1, customerId: 9, language: 'KO' } as unknown as Session;
    return { svc, session, route };
  }

  it('asks the router with the conversation own team and region, so a per-team schedule agrees with the hand-off', async () => {
    const h = build({ supportType: 'business', supportRegion: 'south' });
    await h.svc.handleUserMessage(h.session, 'any update?');
    expect(h.route).toHaveBeenCalledWith(1, 'KO', { region: 'south', supportType: 'business' });
  });
});
