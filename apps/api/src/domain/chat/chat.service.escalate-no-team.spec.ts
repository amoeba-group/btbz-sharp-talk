import { ChatService } from './chat.service';
import type { Conversation } from './entity/conversation.entity';
import type { Session } from '../session/entity/session.entity';
import type { TeamQuestion } from '../ai-engine/handoff-router.service';

/**
 * Channels that cannot show the team chips (PLN-261012 SG-65, REQ D-12).
 *
 * The messenger ingest called escalate() without a team. With the team question on,
 * that stored a question in a chat room nobody could answer, returned `choose: true`
 * and paged no one — a customer on Telegram asked for a person and the agents never
 * heard. `{ askTeam: false }` skips the question: the hand-off happens at once and
 * is routed as it was before team routing existed.
 */
describe('ChatService.escalate — askTeam: false', () => {
  const QUESTION: TeamQuestion = {
    prompt: 'What do you need help with?',
    options: [
      { id: 'cs', jobLabel: 'consult', label: 'Customer Service Support' },
      { id: 'business', jobLabel: 'sales_admin', label: 'Business Support' },
    ],
  };

  function build(teams: TeamQuestion | null = QUESTION) {
    const conversation = { id: 77, sessionId: 5, tenantId: 1 } as Conversation;
    const convUpdate = jest.fn();
    const saved: Array<Record<string, unknown>> = [];
    const publish = jest.fn();
    const teamQuestion = jest.fn(async () => teams);
    const svc = new ChatService(
      { findOne: jest.fn(async () => conversation), update: convUpdate } as never,
      {
        create: jest.fn((m: Record<string, unknown>) => m),
        save: jest.fn(async (m: Record<string, unknown>) => {
          saved.push(m);
          return m;
        }),
        findOne: jest.fn(async () => ({ body: 'I need a person' })),
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
        teamQuestion,
        route: jest.fn(async () => ({ mode: 'agents', targetUserIds: [9] })),
        regionLookup: jest.fn(async () => ({ region: null })),
      } as never, // HandoffRouterService
      { publish } as never, // EventBusService
      {} as never, // CustomerService
      {} as never, // RedisService
    );
    const session = { id: 5, tenantId: 1, language: 'EN', channel: 'telegram' } as Session;
    return { svc, session, convUpdate, saved, publish, teamQuestion };
  }

  it('hands off at once instead of asking, and pages the agents', async () => {
    const h = build();

    const out = await h.svc.escalate(h.session, 77, undefined, { askTeam: false });

    expect(out).toMatchObject({ escalated: true, choose: false });
    expect(out.followUps).toBeUndefined();
    // Nothing asked: no chips row stored, the thread is queued, an alert is published.
    expect(h.saved.some((m) => (m.retrievalTrace as { kind?: string } | undefined)?.kind === 'team_question')).toBe(false);
    expect(h.convUpdate.mock.calls.some(([, set]) => (set as Record<string, unknown>).status === 'waiting')).toBe(true);
    expect(h.publish).toHaveBeenCalledTimes(1);
  });

  it('routes it as before team routing existed: no team label, so the default one', async () => {
    const h = build();

    await h.svc.escalate(h.session, 77, undefined, { askTeam: false });

    const event = h.publish.mock.calls[0][1] as Record<string, unknown>;
    expect(event).toMatchObject({ conversationId: 77, reason: 'user_request', targetUserIds: [9] });
    expect(event.issueLabel).toBeUndefined();
    expect(event.supportType).toBeUndefined();
    expect(h.convUpdate.mock.calls.some(([, set]) => 'supportType' in (set as object))).toBe(false);
  });

  it('does not even read the team configuration', async () => {
    const h = build();
    await h.svc.escalate(h.session, 77, undefined, { askTeam: false });
    expect(h.teamQuestion).not.toHaveBeenCalled();
  });

  it('ignores a stray team id: this caller has no chips to have chosen from', async () => {
    const h = build();

    const out = await h.svc.escalate(h.session, 77, 'business', { askTeam: false });

    expect(out.escalated).toBe(true);
    expect((h.publish.mock.calls[0][1] as Record<string, unknown>).issueLabel).toBeUndefined();
  });

  describe('the widget path is unchanged', () => {
    it('still asks the team question on the first call, paging nobody', async () => {
      const h = build();

      const out = await h.svc.escalate(h.session, 77);

      expect(out).toMatchObject({ escalated: false, choose: true, body: QUESTION.prompt });
      expect(h.publish).not.toHaveBeenCalled();
    });

    it('askTeam: true is the default spelled out', async () => {
      const h = build();

      const out = await h.svc.escalate(h.session, 77, undefined, { askTeam: true });

      expect(out.choose).toBe(true);
      expect(h.publish).not.toHaveBeenCalled();
    });

    it('with the question off, askTeam does not matter', async () => {
      const withFlag = build(null);
      const without = build(null);

      const a = await withFlag.svc.escalate(withFlag.session, 77, undefined, { askTeam: false });
      const b = await without.svc.escalate(without.session, 77);

      expect(a).toEqual(b);
    });
  });
});
