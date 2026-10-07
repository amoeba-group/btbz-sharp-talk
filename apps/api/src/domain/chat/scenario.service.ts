import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CJM_STAGE, CONSENT_STATE, MODERATION_DECISION, SENDER_TYPE, languageBySession } from '@sharptalk/types';
import type {
  ScenarioFollowUpResponse,
  ScenarioTurnResponse,
  SessionLanguage,
} from '@sharptalk/types';
import { Message } from './entity/message.entity';
import { Session } from '../session/entity/session.entity';
import { ChatService, sysMsg } from './chat.service';
import { ModerationService } from '../moderation/moderation.service';
import { SessionService } from '../session/session.service';
import { AiConfigService } from '../ai-engine/ai-config.service';
import { EventBusService, EVENTS } from '../../infrastructure/infrastructure.module';
import type {
  ScenarioOverride,
  ScenarioPostAction,
} from '../ai-engine/entity/tenant-ai-config.entity';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { SCENARIOS, resolveScriptAction, isValidFollowUpId } from './scenario-scripts';

/** The console's "Send a message" action — a button with no script, by design. */
const MESSAGE_ACTION = 'message';
import type { Lang, ScenarioScript } from './scenario-scripts';

/** Response shapes live in `@sharptalk/types` — the widget imports the same contract. */
export type ScenarioFollowUp = ScenarioFollowUpResponse;
export type ScenarioTurnResult = ScenarioTurnResponse;

function lang(session: Session): Lang {
  return languageBySession(session.language)?.session ?? 'EN';
}

/**
 * Scenario-based deterministic replies (FR-S1). Runs outside RAG: the pressed
 * button (or quick reply) is echoed as the user's turn, the script is persisted
 * as the AI turn, and localized follow-up quick replies are returned. Scenario
 * output still passes the mandatory moderation gate (FR-069).
 */
@Injectable()
export class ScenarioService {
  private readonly logger = new Logger(ScenarioService.name);

  constructor(
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    private readonly chatService: ChatService,
    private readonly moderation: ModerationService,
    private readonly sessionService: SessionService,
    private readonly aiConfig: AiConfigService,
    // Optional so the existing positional-constructor specs keep compiling;
    // Nest always supplies it.
    @Optional() private readonly bus?: EventBusService,
  ) {}

  isScenarioAction(action: string): boolean {
    return Object.prototype.hasOwnProperty.call(SCENARIOS, action);
  }

  /**
   * A button whose action has no script is answered as if the shopper had typed
   * it (PLN-261001 §1-1).
   *
   * The console offers "Send a message" (`message`) as a button action, but that
   * action has no entry in SCENARIOS, so every client that routed it here got a
   * 404 — the console preview still does, and so would any older widget build or
   * SDK host. Answering here fixes all of them at once; the widget's own
   * branching stays as it is.
   *
   * `message` is the configured, expected case. Any OTHER unknown action is a
   * misconfiguration we should hear about: 4xx responses are not server-logged,
   * which is exactly why this 404 was visible to operators and invisible to us.
   */
  private async answerAsMessage(
    session: Session,
    action: string,
    text: string,
  ): Promise<ScenarioTurnResult> {
    if (action === MESSAGE_ACTION) {
      this.logger.debug(`scenario action "${action}" → chat message`);
    } else {
      this.logger.warn(
        `scenario action "${action}" has no script — answering it as a chat message`,
      );
    }
    const turn = await this.chatService.handleUserMessage(session, text);
    // Shaped as a scenario turn because that is what the caller asked for; a
    // different shape here would break the clients this is meant to rescue.
    //
    // `turn.reply` is null in agent mode — the human answers through polling.
    // The scenario contract promises a reply object, and widening it to null
    // would make every existing client's `res.reply.body` throw, so the empty
    // body carries that case instead; clients skip rendering an empty one.
    return {
      conversationId: turn.conversationId,
      reply: {
        senderType: turn.reply?.senderType ?? SENDER_TYPE.SYSTEM,
        body: turn.reply?.body ?? '',
      },
      followUps: [],
    };
  }

  async handle(session: Session, action: string, text?: string): Promise<ScenarioTurnResult> {
    // A console BUTTON action is not always a script key: "delivery_status"
    // runs `shipping_policy`. Resolve first, or the fallback below would treat
    // a perfectly good scripted button as scriptless and answer it with RAG —
    // which a test caught while this was being written.
    const scriptAction = resolveScriptAction(action);
    const builtIn = SCENARIOS[scriptAction];
    if (!builtIn) {
      // The caller sends the button's own text when it has one; the label is the
      // fallback, and an action with neither is nothing we can ask on the
      // shopper's behalf.
      const asked = (text ?? '').trim();
      if (!asked) {
        throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
      }
      return this.answerAsMessage(session, action, asked);
    }
    const l = lang(session);
    // Tenant edits (FR-003, PLN-AiSetting W2) layer over the built-in script:
    // any field the tenant left empty keeps the shipped copy.
    const override = await this.aiConfig.getScenarioOverride(session.tenantId, action);
    const script = mergeScript(builtIn, override, l);

    // Consent gate (PLN-Privacy-Control-Gap D-1, fail-closed) — mirrors the
    // chat path: without an effective GRANTED (fresh read, current notice
    // version) nothing is persisted and no conversation is created; the widget
    // gets a soft system reply pointing back to the consent banner.
    const consent =
      session.channel === 'preview' // admin sandbox — see chat.service consent gate note
        ? CONSENT_STATE.GRANTED
        : await this.sessionService.effectiveConsentFor(session.id, session.tenantId);
    if (consent !== CONSENT_STATE.GRANTED) {
      return {
        // No conversation was created — null, not 0: the client guards on falsiness
        // and a stringified '0' would pass that guard (see ScenarioTurnResponse).
        conversationId: null,
        reply: { senderType: 'system', body: sysMsg('consentRequired', session.language) },
        followUps: [],
      };
    }

    const conversation = await this.chatService.getOrCreateConversation(session.id);

    await this.msgRepo.save(
      this.msgRepo.create({
        // Explicit tenant stamp — see ChatService.persist for why we don't rely
        // on TenantSubscriber's request-context auto-stamp alone.
        tenantId: session.tenantId ?? null,
        conversationId: conversation.id,
        senderType: SENDER_TYPE.USER,
        body: script.utterance,
        lang: session.language,
        retrievalTrace: { scenario: action, kind: 'button' },
      }),
    );

    // A tapped chip is the shopper asking, the same as a typed message. Only
    // the chat path published this, so a conversation started from a chip read
    // as "Awareness only" in the journey report (REQ-261008 F3).
    await this.bus?.publish(EVENTS.CJM, {
      tenantId: session.tenantId,
      sessionId: session.id,
      customerId: session.customerId,
      stage: CJM_STAGE.INQUIRY,
      eventType: 'scenario_button',
      payload: { action },
    });

    // Non-bypassable moderation gate (FR-069) — scripts are trusted copy, but
    // the gate stays in the path so tenant rules always apply. A blocked script
    // hands off to a human instead of bypassing the gate (POL-020).
    // PII minimization (PRV Stage 5): no scrub here by design — the egress is
    // static script copy (no user free text reaches the AI on this path), and
    // moderated.text is delivered to the customer, so scrubbing pre-moderation
    // would corrupt delivery.
    const moderated = await this.moderation.moderate({
      tenantId: session.tenantId ?? 0,
      scope: 'ai',
      authorType: 'ai',
      conversationId: conversation.id,
      text: script.reply,
    });
    if (moderated.decision === MODERATION_DECISION.BLOCKED) {
      const notice = await this.chatService.handoff(
        conversation.id,
        session,
        session.tenantId ?? 0,
        'moderation_blocked',
        script.utterance,
      );
      return {
        conversationId: String(conversation.id),
        reply: { senderType: 'system', body: notice.body },
        followUps: [],
      };
    }
    const body = moderated.text;

    const followUps = script.followUps;

    await this.msgRepo.save(
      this.msgRepo.create({
        tenantId: session.tenantId ?? null,
        conversationId: conversation.id,
        senderType: SENDER_TYPE.AI,
        body,
        lang: session.language,
        // Persist the follow-up chips alongside the turn. They used to live only in
        // this response, so re-reading the conversation (switching widget tab, or a
        // page reload) lost them and left the shopper with no next action. Stored in
        // retrieval_trace, which already carries this turn's UI metadata — keeps the
        // chips durable without a schema change.
        retrievalTrace: { scenario: action, kind: 'script', followUps },
      }),
    );

    return {
      conversationId: String(conversation.id),
      reply: { senderType: 'ai', body },
      followUps,
      ...(script.postAction && script.postAction.type !== 'none'
        ? { postAction: script.postAction }
        : {}),
    };
  }
}

/** Language pick with EN fallback — tenants may translate only some languages. */
function pick(text: Partial<Record<Lang, string>> | undefined, l: Lang): string | undefined {
  const value = text?.[l]?.trim() || text?.EN?.trim();
  return value || undefined;
}

/**
 * Resolve one scenario turn's copy for a language: tenant override first,
 * built-in script as the fallback for anything left blank.
 */
function mergeScript(
  builtIn: ScenarioScript,
  override: ScenarioOverride | null,
  l: Lang,
): { utterance: string; reply: string; followUps: ScenarioFollowUp[]; postAction?: ScenarioPostAction } {
  const overriddenFollowUps = override?.followUps
    ?.map((f) => ({ id: f.id, label: pick(f.label, l) }))
    .filter((f): f is ScenarioFollowUp => !!f.id && !!f.label)
    // Stored before ids were checked: show only chips that lead somewhere,
    // rather than one that answers a tap with a failure notice.
    .filter((f) => isValidFollowUpId(f.id));

  return {
    // The shipped phrasing unless the tenant wrote their own (PLN-260903):
    // a hotel's guest never asks about shipping.
    utterance: pick(override?.utterance, l) ?? builtIn.utterance[l],
    reply: pick(override?.reply, l) ?? builtIn.reply[l],
    followUps:
      overriddenFollowUps && overriddenFollowUps.length > 0
        ? overriddenFollowUps
        : builtIn.followUps.map((f) => ({ id: f.id, label: f.label[l] })),
    postAction: override?.postAction,
  };
}
