import { HttpStatus } from '@nestjs/common';
import { ChatService } from './chat.service';
import type { Conversation } from './entity/conversation.entity';
import type { Session } from '../session/entity/session.entity';
import type { TeamQuestion } from '../ai-engine/handoff-router.service';
import { TEAM_CHIP_PREFIX } from '../ai-engine/handoff-router.service';
import { BusinessException } from '../../global/exception/business.exception';

/**
 * Team routing on "talk to an agent" (PLN-261007-Handoff-Team-Routing).
 *
 * The first escalate call asks which team; nobody is paged and the thread is
 * not WAITING until the customer picks one. The second call (with the chip's
 * option id) echoes the choice, stamps the conversation and pages the agents
 * holding that option's job label. A tenant with the question off keeps the
 * one-call handoff exactly as before.
 */
describe('ChatService.escalate — team routing', () => {
  const QUESTION: TeamQuestion = {
    prompt: 'What do you need help with?',
    options: [
      { id: 'cs', jobLabel: 'consult', label: 'Customer Service Support' },
      { id: 'business', jobLabel: 'sales_admin', label: 'Business Support' },
    ],
  };

  function build(opts: { teams: TeamQuestion | null; channel?: string }) {
    const conversation = { id: 77, sessionId: 5, tenantId: 1 } as Conversation;
    const convUpdate = jest.fn();
    const saved: Array<Record<string, unknown>> = [];
    const publish = jest.fn();
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
        teamQuestion: jest.fn(async () => opts.teams),
        route: jest.fn(async () => ({ mode: 'agents', targetUserIds: [9] })),
      } as never, // HandoffRouterService
      { publish } as never, // EventBusService
      {} as never, // CustomerService
      {} as never, // RedisService
    );
    const session = { id: 5, tenantId: 1, language: 'EN', channel: opts.channel ?? 'widget' } as Session;
    return { svc, session, convUpdate, saved, publish };
  }

  it('asks the team question first: no WAITING, no alert, chips on the stored row', async () => {
    const h = build({ teams: QUESTION });

    const out = await h.svc.escalate(h.session, 77);

    expect(out).toEqual({
      escalated: false,
      choose: true,
      body: QUESTION.prompt,
      followUps: [
        { id: `${TEAM_CHIP_PREFIX}cs`, label: 'Customer Service Support' },
        { id: `${TEAM_CHIP_PREFIX}business`, label: 'Business Support' },
      ],
    });
    // The question is persisted as a system turn with its chips on the trace,
    // so a reload (or the next poll) still shows the two buttons.
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]).toMatchObject({
      senderType: 'system',
      body: QUESTION.prompt,
      retrievalTrace: { kind: 'team_question', followUps: out.followUps },
    });
    expect(h.convUpdate).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });

  it('routes the chosen team: echoes the choice, stamps the conversation, pages by job label', async () => {
    const h = build({ teams: QUESTION });

    const out = await h.svc.escalate(h.session, 77, 'business');

    expect(out).toEqual({ escalated: true, choose: false, body: expect.stringContaining('connecting') });
    // The choice is the customer's own words in the transcript, then the
    // stored "connecting you" line (it used to be widget-local and got lost).
    expect(h.saved[0]).toMatchObject({
      senderType: 'user',
      body: 'Business Support',
      retrievalTrace: { kind: 'team_choice', supportType: 'business' },
    });
    expect(h.saved[1]).toMatchObject({ senderType: 'system', body: out.body });
    expect(h.convUpdate).toHaveBeenCalledWith({ id: 77 }, { supportType: 'business' });
    expect(h.convUpdate).toHaveBeenCalledWith({ id: 77 }, expect.objectContaining({ status: 'waiting' }));
    expect(h.publish).toHaveBeenCalledTimes(1);
    expect(h.publish.mock.calls[0][1]).toMatchObject({
      conversationId: 77,
      reason: 'user_request',
      issueLabel: 'sales_admin',
      supportType: 'business',
      supportLabel: 'Business Support',
      // The configured assignee still travels — the alert falls back to it
      // when no sales_admin agent is online.
      targetUserIds: [9],
    });
  });

  it('refuses an option id the tenant does not offer (400), paging nobody', async () => {
    const h = build({ teams: QUESTION });

    await expect(h.svc.escalate(h.session, 77, 'legal')).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
    await expect(h.svc.escalate(h.session, 77, 'legal')).rejects.toBeInstanceOf(BusinessException);
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.convUpdate).not.toHaveBeenCalled();
  });

  it('with the question off, hands off on the first call exactly as before', async () => {
    const h = build({ teams: null });

    const out = await h.svc.escalate(h.session, 77);

    expect(out).toEqual({ escalated: true, choose: false, body: expect.stringContaining('connecting') });
    expect(h.saved).toHaveLength(1); // only the connecting line — no question, no echo
    expect(h.convUpdate).toHaveBeenCalledWith({ id: 77 }, expect.objectContaining({ status: 'waiting' }));
    const event = h.publish.mock.calls[0][1] as Record<string, unknown>;
    expect(event.issueLabel).toBeUndefined();
    expect(event.supportType).toBeUndefined();
  });

  it('ignores a stale option id once the tenant switched the question off', async () => {
    const h = build({ teams: null });

    const out = await h.svc.escalate(h.session, 77, 'business');

    expect(out.escalated).toBe(true);
    expect(h.convUpdate).not.toHaveBeenCalledWith({ id: 77 }, { supportType: 'business' });
    expect(h.publish).toHaveBeenCalledTimes(1);
  });

  it('preview sandbox: asks and records the choice but never pages the agents', async () => {
    const h = build({ teams: QUESTION, channel: 'preview' });

    const asked = await h.svc.escalate(h.session, 77);
    expect(asked.choose).toBe(true);

    const chosen = await h.svc.escalate(h.session, 77, 'cs');
    expect(chosen).toEqual({ escalated: true, choose: false, body: null });
    expect(h.convUpdate).toHaveBeenCalledWith({ id: 77 }, { supportType: 'cs' });
    expect(h.convUpdate).not.toHaveBeenCalledWith({ id: 77 }, expect.objectContaining({ status: 'waiting' }));
    expect(h.publish).not.toHaveBeenCalled();
  });
});
