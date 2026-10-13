import { Repository } from 'typeorm';
import { CONSENT_STATE, MODERATION_DECISION, SESSION_IDENTITY } from '@sharptalk/types';
import type { IdentityClaims, PilotAccess } from '@sharptalk/types';
import type { EventBusService } from '../../infrastructure/infrastructure.module';
import { ScenarioService } from './scenario.service';
import { ChatService, sysMsg } from './chat.service';
import { Message } from './entity/message.entity';
import { Session } from '../session/entity/session.entity';
import { ModerationService } from '../moderation/moderation.service';
import { SessionService } from '../session/session.service';
import type { AiConfigService } from '../ai-engine/ai-config.service';
import { PilotService } from '../pilot/pilot.service';
import { PILOT_NOTICE } from '../pilot/pilot.messages';

/**
 * The pilot allowlist on the scenario-button path (PLN-261012 SG-40, REQ §3.5).
 *
 * A scripted button is a turn like any other: it echoes the shopper's utterance,
 * persists the script and may start a conversation, so a hotel outside the list
 * must be stopped here too — the chat path's gate does not cover it. Same
 * contract as the chat path: a soft localized system reply, nothing stored, no
 * moderation or model call, no journey step.
 */
describe('ScenarioService pilot gate', () => {
  const ON: PilotAccess = { enabled: true, guestAllowed: true, nonPilot: 'hide', notice: {} };

  let msgSave: jest.Mock;
  let getOrCreateConversation: jest.Mock;
  let handleUserMessage: jest.Mock;
  let moderate: jest.Mock;
  let effectiveConsentFor: jest.Mock;
  let publish: jest.Mock;
  let svc: ScenarioService;
  let fixture: { pilotAccess: PilotAccess | null; hotels: string[] };

  const claims = (hotelSn: string, over: Partial<IdentityClaims> = {}): IdentityClaims => ({
    hotelSn,
    role: 'receptionist',
    signed: true,
    verifiedAt: new Date().toISOString(),
    ...over,
  });
  const make = (over: Partial<Session> = {}): Session =>
    ({
      id: 9,
      tenantId: 1,
      channel: null,
      language: 'VI',
      customerId: 40,
      identityLevel: SESSION_IDENTITY.VERIFIED,
      identityClaims: claims('1721'),
      ...over,
    }) as unknown as Session;

  function build(pilotAccess: PilotAccess | null = ON, hotels: string[] = ['1721'], wired = true) {
    fixture = { pilotAccess, hotels };
    msgSave = jest.fn(async (m: Message) => m);
    getOrCreateConversation = jest.fn(async () => ({ id: 42, sessionId: 9 }));
    handleUserMessage = jest.fn();
    moderate = jest.fn(async () => ({ decision: MODERATION_DECISION.DELIVERED, text: 'script reply' }));
    effectiveConsentFor = jest.fn(async () => CONSENT_STATE.GRANTED);
    publish = jest.fn(async () => undefined);

    const store = new Map<string, string>();
    const pilot = new PilotService(
      { findOne: jest.fn(async () => ({ id: 1, pilotAccess: fixture.pilotAccess })) } as never,
      { find: jest.fn(async () => fixture.hotels.map((hotelSn) => ({ hotelSn }))) } as never,
      {
        get: async (k: string) => store.get(k) ?? null,
        set: async (k: string, v: string) => void store.set(k, v),
        del: async (k: string) => void store.delete(k),
      } as never,
    );

    svc = new ScenarioService(
      { save: msgSave, create: (m: Partial<Message>) => m } as unknown as Repository<Message>,
      { getOrCreateConversation, handleUserMessage, handoff: jest.fn() } as unknown as ChatService,
      { moderate } as unknown as ModerationService,
      { effectiveConsentFor } as unknown as SessionService,
      { getScenarioOverride: jest.fn().mockResolvedValue(null) } as unknown as AiConfigService,
      { publish } as unknown as EventBusService,
      wired ? pilot : undefined,
    );
  }

  const expectNothingDone = () => {
    expect(getOrCreateConversation).not.toHaveBeenCalled();
    expect(msgSave).not.toHaveBeenCalled();
    expect(moderate).not.toHaveBeenCalled();
    expect(handleUserMessage).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  };

  it('a signed hotel on the list gets its scripted reply as always', async () => {
    build();
    const res = await svc.handle(make(), 'cancel_refund');
    expect(res.conversationId).toBe('42');
    expect(res.reply.senderType).toBe('ai');
    expect(res.pilotDenied).toBeUndefined();
    expect(msgSave).toHaveBeenCalledTimes(2);
  });

  it('a signed hotel NOT on the list gets a soft notice — no conversation, no rows, no moderation, no journey step', async () => {
    build();
    const res = await svc.handle(make({ identityClaims: claims('3307') }), 'cancel_refund');
    expect(res).toEqual({
      conversationId: null,
      reply: { senderType: 'system', body: PILOT_NOTICE.VI },
      followUps: [],
      pilotDenied: true,
    });
    expectNothingDone();
  });

  it('guests follow guestAllowed', async () => {
    build({ ...ON, guestAllowed: true });
    const guest = make({ identityLevel: SESSION_IDENTITY.GUEST, identityClaims: null, customerId: null });
    expect((await svc.handle(guest, 'cancel_refund')).reply.senderType).toBe('ai');

    build({ ...ON, guestAllowed: false });
    expect(await svc.handle(guest, 'cancel_refund')).toMatchObject({ pilotDenied: true, conversationId: null });
    expectNothingDone();
  });

  it('unsigned claims are a guest, not a hotel', async () => {
    build({ ...ON, guestAllowed: false }, ['1721']);
    const res = await svc.handle(make({ identityClaims: claims('1721', { signed: false }) }), 'cancel_refund');
    expect(res.pilotDenied).toBe(true);
    expectNothingDone();
  });

  it('feature off: unchanged', async () => {
    build(null);
    const res = await svc.handle(make({ identityClaims: claims('3307') }), 'cancel_refund');
    expect(res.reply.senderType).toBe('ai');
    expect(res.pilotDenied).toBeUndefined();
  });

  it('consent comes first, as on the chat path', async () => {
    build();
    effectiveConsentFor.mockResolvedValue(CONSENT_STATE.PENDING);
    const res = await svc.handle(make({ identityClaims: claims('3307') }), 'cancel_refund');
    expect(res.pilotDenied).toBeUndefined();
    expect(res.reply.body).toBe(sysMsg('consentRequired', 'VI'));
  });

  it('a console preview session is exempt', async () => {
    build({ ...ON, guestAllowed: false }, []);
    const res = await svc.handle(make({ channel: 'preview', identityLevel: SESSION_IDENTITY.GUEST, identityClaims: null }), 'cancel_refund');
    expect(res.reply.senderType).toBe('ai');
  });

  it('a button with no script is answered as a chat turn — and the chat path\'s refusal is carried through', async () => {
    build();
    handleUserMessage.mockResolvedValue({
      conversationId: null,
      reply: { senderType: 'system', body: PILOT_NOTICE.VI },
      escalate: false,
      needsAuth: false,
      pilotDenied: true,
    });
    const res = await svc.handle(make({ identityClaims: claims('3307') }), 'message', 'Xin chào');
    expect(handleUserMessage).toHaveBeenCalled();
    expect(res).toMatchObject({ conversationId: null, reply: { senderType: 'system', body: PILOT_NOTICE.VI }, pilotDenied: true });
  });

  it('a service built without PilotService keeps every behaviour (opt-in only)', async () => {
    build(ON, [], false);
    const res = await svc.handle(make({ identityClaims: claims('3307') }), 'cancel_refund');
    expect(res.reply.senderType).toBe('ai');
  });
});
