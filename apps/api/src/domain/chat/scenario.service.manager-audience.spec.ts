import { Repository } from 'typeorm';
import { CONSENT_STATE, MODERATION_DECISION, SESSION_IDENTITY } from '@sharptalk/types';
import type { EventBusService } from '../../infrastructure/infrastructure.module';
import { ScenarioService } from './scenario.service';
import { ChatService } from './chat.service';
import { Message } from './entity/message.entity';
import { Session } from '../session/entity/session.entity';
import { ModerationService } from '../moderation/moderation.service';
import { SessionService } from '../session/session.service';
import type { AiConfigService } from '../ai-engine/ai-config.service';
import type { ScenarioButton } from '../ai-engine/entity/tenant-ai-config.entity';

/**
 * A manager-only scenario button is ENFORCED when pressed (PLN-261012 SG-10).
 *
 * Until now the audience steered only what the widget LISTED: the endpoint ran whatever
 * action it was handed, so a receptionist who called it directly read the manager's
 * script. The refusal is soft (like the pilot gate): a localized notice that points to
 * the manager account, the "Talk to an agent" chip, and NOTHING stored or run.
 */
describe('ScenarioService — manager-only buttons at press time', () => {
  const HOUR = 3_600_000;
  let msgSave: jest.Mock;
  let getOrCreateConversation: jest.Mock;
  let handleUserMessage: jest.Mock;
  let moderate: jest.Mock;
  let getScenarioButtons: jest.Mock;
  let svc: ScenarioService;

  const session = (viewer: 'guest' | 'v1' | 'receptionist' | 'manager' | 'internal', over: Partial<Session> = {}): Session => {
    const signed = viewer === 'receptionist' || viewer === 'manager' || viewer === 'internal';
    return {
      id: 9,
      tenantId: 1,
      channel: null,
      language: 'VI',
      customerId: viewer === 'guest' ? null : 40,
      identityLevel: viewer === 'guest' ? SESSION_IDENTITY.GUEST : SESSION_IDENTITY.VERIFIED,
      identityClaims: signed
        ? { hotelSn: '1721', role: viewer, signed: true, verifiedAt: new Date().toISOString() }
        : null,
      ...over,
    } as unknown as Session;
  };

  const btn = (id: string, action: string, audience?: ScenarioButton['audience'], enabled = true): ScenarioButton => ({
    id,
    label: id,
    action,
    enabled,
    ...(audience ? { audience } : {}),
  });

  function build(buttons: ScenarioButton[], opts: { identityOf?: boolean; managerNotice?: string } = {}) {
    msgSave = jest.fn(async (m: Message) => m);
    getOrCreateConversation = jest.fn(async () => ({ id: 42, sessionId: 9 }));
    handleUserMessage = jest.fn(async () => ({ conversationId: '42', reply: { senderType: 'ai', body: 'typed answer' } }));
    moderate = jest.fn(async () => ({ decision: MODERATION_DECISION.DELIVERED, text: 'script reply' }));
    getScenarioButtons = jest.fn(async () => buttons);
    const sessionService = {
      effectiveConsentFor: jest.fn(async () => CONSENT_STATE.GRANTED),
      // The real service applies the tenant's max age; a positional double that predates it is also valid.
      ...(opts.identityOf === false
        ? {}
        : {
            identityOf: jest.fn(async (s: Session) => {
              const claims = s.identityClaims as { verifiedAt: string } | null;
              const lapsed = claims && Date.now() - Date.parse(claims.verifiedAt) > 8 * HOUR;
              return lapsed
                ? { level: SESSION_IDENTITY.GUEST, claims: null, customerId: null, expired: true, expiresAt: null }
                : { level: s.identityLevel, claims, customerId: s.customerId, expired: false, expiresAt: null };
            }),
          }),
    } as unknown as SessionService;

    svc = new ScenarioService(
      { save: msgSave, create: (m: Partial<Message>) => m } as unknown as Repository<Message>,
      {
        getOrCreateConversation,
        handleUserMessage,
        handoff: jest.fn(),
        managerOnlyMessage: jest.fn(async (_t: number, lang: string) =>
          opts.managerNotice ?? `built-in manager-only notice (${lang})`,
        ),
      } as unknown as ChatService,
      { moderate } as unknown as ModerationService,
      sessionService,
      {
        getScenarioOverride: jest.fn().mockResolvedValue(null),
        getScenarioButtons,
      } as unknown as AiConfigService,
      { publish: jest.fn(async () => undefined) } as unknown as EventBusService,
    );
  }

  const refusedSoftly = (res: Awaited<ReturnType<ScenarioService['handle']>>) => {
    expect(res.conversationId).toBeNull();
    expect(res.reply.senderType).toBe('system');
    expect(res.followUps).toEqual([{ id: 'agent_connect', label: 'Gặp nhân viên hỗ trợ' }]);
    // Nothing was stored, moderated, answered or opened.
    expect(getOrCreateConversation).not.toHaveBeenCalled();
    expect(msgSave).not.toHaveBeenCalled();
    expect(moderate).not.toHaveBeenCalled();
    expect(handleUserMessage).not.toHaveBeenCalled();
  };

  const buttons = [btn('delivery', 'delivery_status'), btn('payout', 'cancel_refund', 'manager')];

  it.each(['guest', 'v1', 'receptionist'] as const)('a %s pressing the manager-only button is refused softly', async (viewer) => {
    build(buttons);

    refusedSoftly(await svc.handle(session(viewer), 'cancel_refund'));
  });

  it('the refusal carries the manager-only notice (and the tenant wording, when set)', async () => {
    build(buttons, { managerNotice: 'Hãy hỏi tài khoản Quản lý.' });

    const res = await svc.handle(session('receptionist'), 'cancel_refund');

    expect(res.reply.body).toBe('Hãy hỏi tài khoản Quản lý.');
  });

  it.each(['manager', 'internal'] as const)('a %s may press it: the script runs', async (viewer) => {
    build(buttons);

    const res = await svc.handle(session(viewer), 'cancel_refund');

    expect(res.reply.senderType).toBe('ai');
    expect(getOrCreateConversation).toHaveBeenCalled();
    expect(msgSave).toHaveBeenCalled();
  });

  it('a manager whose claims LAPSED is refused like a guest', async () => {
    build(buttons);
    const lapsed = session('manager', {
      identityClaims: { hotelSn: '1721', role: 'manager', signed: true, verifiedAt: new Date(Date.now() - 9 * HOUR).toISOString() },
    } as Partial<Session>);

    refusedSoftly(await svc.handle(lapsed, 'cancel_refund'));
  });

  it('judges the script an action resolves to: the manager-only "delivery_status" button guards shipping_policy too', async () => {
    build([btn('delivery', 'delivery_status', 'manager')]);

    refusedSoftly(await svc.handle(session('receptionist'), 'shipping_policy'));
    expect(getScenarioButtons).toHaveBeenCalledWith(1);
  });

  it('is enforced for a scriptless (message) action too, before anything is typed on the shopper’s behalf', async () => {
    build([btn('ask', 'message', 'manager')]);

    refusedSoftly(await svc.handle(session('receptionist'), 'message', 'How do I change the payout bank account?'));
  });

  it('an ordinary button is untouched: everyone may press it', async () => {
    build(buttons);

    for (const viewer of ['guest', 'v1', 'receptionist', 'manager'] as const) {
      getOrCreateConversation.mockClear();
      const res = await svc.handle(session(viewer), 'delivery_status');
      expect(res.reply.senderType).toBe('ai');
      expect(getOrCreateConversation).toHaveBeenCalled();
    }
  });

  it('when another, open button runs the same action it is allowed (only an all-manager action is guarded)', async () => {
    build([btn('a', 'cancel_refund', 'manager'), btn('b', 'cancel_refund')]);

    const res = await svc.handle(session('receptionist'), 'cancel_refund');

    expect(res.reply.senderType).toBe('ai');
  });

  it('a DISABLED manager-only button still guards its script (disabling must not make it public)', async () => {
    build([btn('payout', 'cancel_refund', 'manager', false)]);

    refusedSoftly(await svc.handle(session('receptionist'), 'cancel_refund'));
  });

  it('an action no button uses (a follow-up chip) is not judged', async () => {
    build(buttons);

    const res = await svc.handle(session('guest'), 'return_exchange');

    expect(res.reply.senderType).toBe('ai');
  });

  it('the admin preview sandbox is not a hotel user and is never refused (nor does it read the buttons)', async () => {
    build(buttons);

    const res = await svc.handle(session('guest', { channel: 'preview' } as Partial<Session>), 'cancel_refund');

    expect(res.reply.senderType).toBe('ai');
    expect(getScenarioButtons).not.toHaveBeenCalled();
  });

  it('a SessionService double that predates identityOf falls back to the platform default', async () => {
    build(buttons, { identityOf: false });

    refusedSoftly(await svc.handle(session('receptionist'), 'cancel_refund'));
  });

  it('a tenant with no manager-only button is served exactly as before', async () => {
    build([btn('delivery', 'delivery_status'), btn('ask', 'message', 'verified')]);

    const res = await svc.handle(session('guest'), 'delivery_status');

    expect(res.reply.senderType).toBe('ai');
  });
});
