import { SENDER_TYPE, localized } from '@sharptalk/types';
import type { LocalizedText } from '@sharptalk/types';
import type { AiMessage } from '../../infrastructure/external/ai/ai-adapter.interface';
import { scrubPii } from '../../global/util/pii-scrub.util';

/**
 * Conversation memory for the AI turn (PLN-260929-AI-Conversation-Memory S1).
 *
 * Until this existed every model call saw the current message alone, so the
 * assistant asked for a booking's name, phone and address, received them, and
 * asked for them again on the next turn (conversation 652, skyliving). The
 * earlier turns only ever reached the retrieval query (FIX-260806 A2).
 *
 * Pure: the caller loads the rows, this shapes them. Everything that leaves
 * here goes to an AI provider, so what a person typed (customer and agent
 * turns) is scrubbed exactly like the current message (PRV Stage 5) — the
 * model sees `[PHONE]`, never the customer's number. The AI's own replies are
 * passed as written (REQ-261007 R1).
 */

/** Most recent messages replayed to the answering model. */
export const HISTORY_MESSAGES = 12;
/** Character budget for that replay, newest kept first (PLN D1). */
export const HISTORY_CHARS = 6000;
/** The classifier only needs the exchange the current message answers. */
export const INTENT_HISTORY_MESSAGES = 4;

/** Marks a human agent's words so the model does not take them as its own. */
const AGENT_PREFIX = '[Agent] ';

export interface HistoryRow {
  senderType: string;
  body: string;
}

/**
 * Rows oldest → newest in, provider-safe messages out. Customer and agent
 * turns are PII-scrubbed; the AI's own turns are passed as written.
 *
 * - system turns are dropped: consent notices and handoff copy are fixed text
 *   the model must not imitate or answer;
 * - `ai` and `agent` both speak as the shop (`assistant`);
 * - the budget is filled from the newest turn backwards, and a single turn
 *   larger than what is left keeps its tail — the end of a message is the part
 *   the next turn replies to;
 * - a leading assistant turn is removed (Anthropic requires the first message
 *   to come from the user) and same-role neighbours are merged.
 */
export function buildHistory(rows: HistoryRow[], maxChars = HISTORY_CHARS): AiMessage[] {
  const shaped: AiMessage[] = [];
  for (const row of rows) {
    if (row.senderType === SENDER_TYPE.SYSTEM) continue;
    // Only what a person typed is masked (customer and agent turns). The AI's
    // own replies are not personal data — they only ever saw scrubbed customer
    // text, and the numbers in them come from the knowledge base. Masking them
    // turned go2joy's northern hotline into [PHONE] in the history, the model
    // copied the token, and customers read "the phone number you provided"
    // (REQ-261007 I-2, conversation 786: 21 + 19 answers).
    const raw = (row.body ?? '').trim();
    const text = row.senderType === SENDER_TYPE.AI ? raw : scrubPii(raw).text.trim();
    if (!text) continue;
    if (row.senderType === SENDER_TYPE.USER) {
      shaped.push({ role: 'user', content: text });
    } else if (row.senderType === SENDER_TYPE.AGENT) {
      shaped.push({ role: 'assistant', content: `${AGENT_PREFIX}${text}` });
    } else if (row.senderType === SENDER_TYPE.AI) {
      shaped.push({ role: 'assistant', content: text });
    }
  }

  const kept: AiMessage[] = [];
  let budget = maxChars;
  for (let i = shaped.length - 1; i >= 0 && budget > 0; i--) {
    const m = shaped[i];
    const content = m.content.length > budget ? m.content.slice(m.content.length - budget) : m.content;
    budget -= content.length;
    kept.unshift({ role: m.role, content });
  }

  while (kept.length && kept[0].role !== 'user') kept.shift();
  return mergeSameRole(kept);
}

/** Append the current message, merging when the history already ends on the user. */
export function withCurrentTurn(history: AiMessage[] | undefined, query: string): AiMessage[] {
  return mergeSameRole([...(history ?? []), { role: 'user', content: query }]);
}

/** Whether the shop has already spoken in this conversation (reuse gate, PLN S5). */
export function hasAssistantTurn(history: AiMessage[] | undefined): boolean {
  return !!history?.some((m) => m.role === 'assistant');
}

/** Earlier customer turns folded into the retrieval query (FIX-260806 A2). */
export const RETRIEVAL_CONTEXT_TURNS = 2;
/** Per-turn cap on that borrowed context, so one long message can't drown the query. */
export const RETRIEVAL_CONTEXT_CHARS = 200;

/**
 * Search text for this turn: the shopper's last two turns and the shop's last
 * reply, then the current message. Retrieval only.
 *
 * Customer turns alone were FIX-260806 A2 ("and for my young son?" needs the
 * skincare question before it). The shop's reply joined in PLN-260929 S8: a
 * confirmation such as "예약 진행" after "1. 김익용" carries no topic word on
 * the customer side at all — the topic lives in what the assistant just said
 * ("예약 내용 최종 확인 …"), and without it the turn scored low and was handed
 * off as unanswerable. Already scrubbed: `history` comes from buildHistory.
 */
export function retrievalQuery(history: AiMessage[], current: string): string {
  const picked = new Set<AiMessage>();
  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant');
  if (lastAssistant) picked.add(lastAssistant);
  history
    .filter((m) => m.role === 'user')
    .slice(-RETRIEVAL_CONTEXT_TURNS)
    .forEach((m) => picked.add(m));
  const parts = history
    .filter((m) => picked.has(m))
    .map((m) =>
      m.content
        .replace(AGENT_PREFIX, '')
        // Markdown and emoji are noise to a keyword index.
        .replace(/[*#>`_~|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, RETRIEVAL_CONTEXT_CHARS),
    )
    .filter(Boolean);
  return parts.length ? [...parts, current].join('\n') : current;
}

/** The recent exchange as a plain transcript, for the classifier's system block. */
export function transcript(history: AiMessage[]): string {
  return history
    .map((m) => `${m.role === 'user' ? 'SHOPPER' : 'ASSISTANT'}: ${m.content.replace(/\s+/g, ' ')}`)
    .join('\n');
}

function mergeSameRole(messages: AiMessage[]): AiMessage[] {
  const out: AiMessage[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n${m.content}`;
    else out.push({ ...m });
  }
  return out;
}

/**
 * Instructions added to an answering prompt whenever history rides along.
 * Absent history the prompt is left byte-for-byte as it was, so the console's
 * single-question paths (KB query, board simulation) do not change.
 */
export const CONVERSATION_RULES =
  '\nConversation rules:\n' +
  '- The earlier messages of this conversation are included. Continue from them.\n' +
  '- Never ask again for information the customer already gave. Confirm what ' +
  'you have and ask only for what is still missing.\n' +
  '- If you asked a question and the customer replies, read the reply as the ' +
  'answer to it even when it is very short (a number, one word, "go ahead").\n' +
  "- Facts about the shop (prices, policies, availability) come from the " +
  'context; details the customer told you (name, date, quantity, choices) ' +
  'come from the conversation.\n' +
  // The context is retrieved for the CURRENT question only. An earlier answer
  // missing from it is not evidence that answer was wrong — the old wording
  // ("your earlier replies are not a source of shop facts") made the model
  // retract a correct delivery estimate when the next question was about
  // Canada (FIX-261007-Topic-Switch, staging conversation 780).
  '- The context was looked up for the current question only. If an earlier ' +
  'reply of yours is not covered by it, that does not mean it was wrong: ' +
  'never retract, correct or apologise for an earlier reply unless the ' +
  'context contradicts it. Answer the current question.\n' +
  '- Tokens like [PHONE], [EMAIL], [ADDR], [CARD] or [ORDER] mean the customer ' +
  'DID provide that detail; it is hidden from you for privacy. Treat it as ' +
  'received, never write the token, and refer to it naturally (e.g. "the ' +
  'phone number you gave").';

/**
 * Safety net for the rule above (PLN S7): a token the model copied anyway is
 * replaced with a phrase in the session language. The original value is never
 * restored — minimisation holds even on the way back.
 */
const TOKEN_PHRASES: Record<string, LocalizedText> = {
  PHONE: {
    EN: 'the phone number you provided',
    ES: 'el teléfono que nos indicaste',
    KO: '말씀하신 연락처',
    VI: 'số điện thoại bạn đã cung cấp',
    JA: 'お知らせいただいた電話番号',
    ZH: '您提供的电话号码',
  },
  EMAIL: {
    EN: 'the email you provided',
    ES: 'el correo que nos indicaste',
    KO: '말씀하신 이메일',
    VI: 'email bạn đã cung cấp',
    JA: 'お知らせいただいたメールアドレス',
    ZH: '您提供的电子邮箱',
  },
  ADDR: {
    EN: 'the address you provided',
    ES: 'la dirección que nos indicaste',
    KO: '말씀하신 주소',
    VI: 'địa chỉ bạn đã cung cấp',
    JA: 'お知らせいただいた住所',
    ZH: '您提供的地址',
  },
  CARD: {
    EN: 'the card you provided',
    ES: 'la tarjeta que nos indicaste',
    KO: '말씀하신 카드',
    VI: 'thẻ bạn đã cung cấp',
    JA: 'お知らせいただいたカード',
    ZH: '您提供的银行卡',
  },
  ORDER: {
    EN: 'the order number you provided',
    ES: 'el número de pedido que nos indicaste',
    KO: '말씀하신 주문번호',
    VI: 'mã đơn hàng bạn đã cung cấp',
    JA: 'お知らせいただいた注文番号',
    ZH: '您提供的订单号',
  },
};

const TOKEN_RE = /\[(PHONE|EMAIL|ADDR|CARD|ORDER)\]/g;

export function replacePiiTokens(text: string, lang: string): string {
  return text.replace(TOKEN_RE, (_, kind: string) => localized(TOKEN_PHRASES[kind], lang));
}
