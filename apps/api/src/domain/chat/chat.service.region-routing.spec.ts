import { ChatService } from './chat.service';
import type { Conversation } from './entity/conversation.entity';
import type { Session } from '../session/entity/session.entity';

/**
 * Hotel region on hand-off (PLN-261007-Hotel-Region-Routing). When a person is
 * asked for, the hotel's regional team is resolved from the signed province,
 * stamped on the conversation for the queue badge and filter, and carried on the
 * escalation event so the alert prefers that team. A lookup that fails must never
 * stop a customer reaching someone.
 */
describe('ChatService — hotel region on hand-off', () => {
  const REGION = { category: 'south_central', team: 'south', label: 'South (South Central)' };

  function build(opts: { region?: typeof REGION | null; regionThrows?: boolean; unmapped?: string }) {
    const conversation = { id: 77, sessionId: 5, tenantId: 1 } as Conversation;
    const convUpdate = jest.fn();
    const publish = jest.fn();
    const regionOf = jest.fn(async () => {
      if (opts.regionThrows) throw new Error('config unavailable');
      return {
        region: opts.region ?? null,
        ...(opts.unmapped ? { unmapped: opts.unmapped } : {}),
      };
    });
    const svc = new ChatService(
      { findOne: jest.fn(async () => conversation), update: convUpdate } as never,
      {
        create: jest.fn((m: Record<string, unknown>) => m),
        save: jest.fn(async (m: Record<string, unknown>) => m),
        findOne: jest.fn(async () => ({ body: 'Hoa hồng tính thế nào?' })),
      } as never,
      {} as never, // Session repo
      {} as never, // Tenant repo
      {} as never, // User repo
      {} as never, // Assignment repo
      {} as never, // RagService
      {} as never, // ModerationService
      {} as never, // OrderService
      {} as never, // SessionService
      {
        teamQuestion: jest.fn(async () => null),
        route: jest.fn(async () => ({ mode: 'agents', targetUserIds: [] })),
        regionLookup: regionOf,
      } as never, // HandoffRouterService
      { publish } as never, // EventBusService
      {} as never, // CustomerService
      {} as never, // RedisService
    );
    const claims = { hotelSn: '1721', role: 'manager', signed: true, province: 'Đà Nẵng', verifiedAt: new Date().toISOString() };
    const session = {
      id: 5,
      tenantId: 1,
      language: 'EN',
      channel: 'widget',
      identityClaims: claims,
    } as unknown as Session;
    return { svc, session, claims, convUpdate, publish, regionOf };
  }

  const stamped = (convUpdate: jest.Mock) =>
    convUpdate.mock.calls.some(([, set]) => set && 'supportRegion' in (set as object));

  it('escalate: stamps the region and carries it on the event', async () => {
    const h = build({ region: REGION });

    await h.svc.escalate(h.session, 77);

    expect(h.regionOf).toHaveBeenCalledWith(1, h.claims);
    expect(h.convUpdate).toHaveBeenCalledWith({ id: 77 }, { supportRegion: 'south' });
    expect(h.publish.mock.calls[0][1]).toMatchObject({
      conversationId: 77,
      supportRegion: 'south',
      regionLabel: 'South (South Central)',
      partnerLabel: expect.stringContaining('1721'),
    });
  });

  it('escalate: no region (guest, table off, province unlisted) leaves everything as before', async () => {
    const h = build({ region: null });

    await h.svc.escalate(h.session, 77);

    expect(stamped(h.convUpdate)).toBe(false);
    const event = h.publish.mock.calls[0][1] as Record<string, unknown>;
    expect(event.supportRegion).toBeUndefined();
    expect(event.regionLabel).toBeUndefined();
    expect(h.publish).toHaveBeenCalledTimes(1);
  });

  it('escalate: an unmapped province rides on the event, and stamps nothing', async () => {
    const h = build({ region: null, unmapped: 'Tp Quy Nhơn' });

    await h.svc.escalate(h.session, 77);

    expect(stamped(h.convUpdate)).toBe(false);
    const event = h.publish.mock.calls[0][1] as Record<string, unknown>;
    expect(event.regionUnmapped).toBe('Tp Quy Nhơn');
    expect(event.supportRegion).toBeUndefined();
    expect(event.regionLabel).toBeUndefined();
  });

  it('automatic hand-off carries the unmapped province too', async () => {
    const h = build({ region: null, unmapped: 'Pleiku' });

    await h.svc.handoff(77, h.session, 1, 'low_confidence', 'Hoa hồng tính thế nào?');

    expect((h.publish.mock.calls[0][1] as Record<string, unknown>).regionUnmapped).toBe('Pleiku');
  });

  it('a resolved region never carries an unmapped marker', async () => {
    const h = build({ region: REGION });

    await h.svc.escalate(h.session, 77);

    expect((h.publish.mock.calls[0][1] as Record<string, unknown>).regionUnmapped).toBeUndefined();
  });

  it('a failing region lookup never stops the hand-off', async () => {
    const h = build({ regionThrows: true });

    const out = await h.svc.escalate(h.session, 77);

    expect(out.escalated).toBe(true);
    expect(stamped(h.convUpdate)).toBe(false);
    expect(h.publish).toHaveBeenCalledTimes(1);
    expect((h.publish.mock.calls[0][1] as Record<string, unknown>).supportRegion).toBeUndefined();
  });

  it('automatic hand-off (low confidence) is routed by region too', async () => {
    const h = build({ region: REGION });

    await h.svc.handoff(77, h.session, 1, 'low_confidence', 'Hoa hồng tính thế nào?');

    expect(h.convUpdate).toHaveBeenCalledWith({ id: 77 }, { supportRegion: 'south' });
    expect(h.publish.mock.calls[0][1]).toMatchObject({
      reason: 'low_confidence',
      supportRegion: 'south',
      regionLabel: 'South (South Central)',
    });
  });

  it('preview sandbox neither resolves nor stamps a region', async () => {
    const h = build({ region: REGION });
    const preview = { ...h.session, channel: 'preview' } as unknown as Session;

    await h.svc.handoff(77, preview, 1, 'user_request', 'hi');
    await h.svc.escalate(preview, 77);

    expect(h.regionOf).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });
});
