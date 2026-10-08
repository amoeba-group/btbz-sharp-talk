import { SENDER_TYPE } from '@sharptalk/types';
import { FIVE_A, FiveA } from './journey-stage-map';
import { TRUNCATION_MARK, type SampleUtterance } from './journey-sample';

/**
 * A report as data, not prose (PLN-261008 P2).
 *
 * The model writes sentences; it does not get to supply evidence. Every quote
 * is copied from the sample it points at, every count is recounted here, and an
 * item whose evidence cannot be found is dropped rather than shown. Figures stay
 * in `metrics_json` and their reading in the value-state judge — nothing in
 * here is a number the model made up.
 */
export interface JourneyReportContent {
  headline: string;
  subline: string | null;
  /** One short paragraph per criteria section the tenant kept. */
  narrative: Record<string, string>;
  questions: Array<{
    text: string;
    /**
     * Times the quoted utterance itself recurs among the samples. Null only in
     * reports stored before questions required a customer quote.
     */
    count: number | null;
    quoteIds: number[];
    answered: Answered;
  }>;
  quotes: Array<{
    id: number;
    sampleIndex: number;
    text: string;
    who: string;
    at: string;
    truncated: boolean;
  }>;
  stages: Array<{
    key: FiveA;
    customer: string | null;
    response: string | null;
    pain: string | null;
    opportunity: string | null;
  }>;
  hypotheses: Array<{ layer: string; quoteId: number; hypothesis: string; disproveIf: string }>;
  dataFlags: Array<{ text: string; section: string | null }>;
  actions: Array<{
    title: string;
    successCriterion: string | null;
    section: string | null;
    urgency: Urgency;
  }>;
  /** Items removed because their evidence did not check out — shown to the reader. */
  dropped: number;
}

const ANSWERED = ['answered', 'unanswered', 'escalated'] as const;
type Answered = (typeof ANSWERED)[number];
const URGENCY = ['now', 'week', 'improve'] as const;
type Urgency = (typeof URGENCY)[number];

const MAX_TEXT = 500;
const LIMITS = { questions: 10, quotes: 20, hypotheses: 6, dataFlags: 6, actions: 5 };

/** The shape asked of the model — kept beside the validator so the two cannot drift. */
export const CONTENT_SCHEMA_HINT = `{
  "headline": "one sentence: the conclusion",
  "subline": "one sentence: what comes first, and what cannot be judged" | null,
  "narrative": { "<section key>": "a short paragraph" },
  "quotes": [ { "id": 1, "sample": <the #number of a SAMPLES line> } ],
  "questions": [ { "text": "a question the CUSTOMER asked, in the report language", "quoteIds": [<quotes of the CUSTOMER asking it — never ai/agent quotes>], "answered": "whether WE answered the customer: answered" | "unanswered" | "escalated" } ],
  "stages": [ { "key": "aware" | "appeal" | "ask" | "act" | "advocate", "customer": string | null, "response": string | null, "pain": string | null, "opportunity": string | null } ],
  "hypotheses": [ { "layer": "Maslow layer", "quoteId": 1, "hypothesis": string, "disproveIf": string } ],
  "dataFlags": [ { "text": "a data quality problem you noticed", "section": "<section key>" | null } ],
  "actions": [ { "title": string, "successCriterion": string | null, "section": "<section key>" | null, "urgency": "now" | "week" | "improve" } ]
}`;

/** The first JSON object in a reply — models fence it, or say a word before it. */
export function extractJson(reply: string): unknown {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Validate the model's reply against the samples it was given.
 *
 * Returns null when the reply is not usable as a whole (no JSON, no headline);
 * the caller then falls back to the Markdown report. Individual bad items are
 * dropped and counted instead — one wrong quote should not cost the report.
 */
export function groundContent(
  raw: unknown,
  samples: SampleUtterance[],
  sectionKeys: string[],
  topQuestionsN: number,
): JourneyReportContent | null {
  if (!isObject(raw)) return null;
  const headline = text(raw.headline);
  if (!headline) return null;

  let dropped = 0;
  const sections = new Set(sectionKeys);
  const section = (v: unknown): string | null => {
    const s = text(v, 32);
    return s && sections.has(s) ? s : null;
  };

  // Quotes: only the sample number is trusted. The text the model "copied" is
  // replaced by the sample itself — a paraphrase inside quotation marks is the
  // most convincing thing a report can get wrong.
  const quotes: JourneyReportContent['quotes'] = [];
  const seenIds = new Set<number>();
  for (const q of list(raw.quotes).slice(0, LIMITS.quotes)) {
    const id = int(q?.id);
    const index = int(q?.sample);
    const sample = index != null ? samples[index - 1] : undefined;
    if (id == null || seenIds.has(id) || !sample) {
      dropped += 1;
      continue;
    }
    seenIds.add(id);
    quotes.push({
      id,
      sampleIndex: index as number,
      text: sample.text,
      who: sample.who,
      at: sample.at,
      truncated: sample.text.endsWith(TRUNCATION_MARK),
    });
  }
  const quoteById = new Map(quotes.map((q) => [q.id, q]));

  // A question is something the customer asked, so its evidence is the
  // customer's own words. Staging report #11 listed "is early check-in
  // possible?" on the strength of the agent's reply alone; an agent quote is
  // dropped from a question, and a question left with no customer quote is
  // dropped with it (REQ-261008, follow-up).
  const questions: JourneyReportContent['questions'] = [];
  for (const q of list(raw.questions)) {
    if (questions.length >= Math.max(1, topQuestionsN)) break;
    const t = text(q?.text);
    const ids = list(q?.quoteIds)
      .map(int)
      .filter((id): id is number => id != null && quoteById.get(id)?.who === SENDER_TYPE.USER);
    if (!t || !ids.length) {
      dropped += 1;
      continue;
    }
    questions.push({
      text: t,
      count: recurrence(ids.map((id) => quoteById.get(id)!.text), samples),
      quoteIds: ids,
      answered: oneOf(q?.answered, ANSWERED, 'answered'),
    });
  }

  const stagesByKey = new Map<FiveA, JourneyReportContent['stages'][number]>();
  for (const s of list(raw.stages)) {
    const key = oneOf(s?.key, FIVE_A, null as unknown as FiveA);
    if (!key || stagesByKey.has(key)) continue;
    stagesByKey.set(key, {
      key,
      customer: text(s?.customer),
      response: text(s?.response),
      pain: text(s?.pain),
      opportunity: text(s?.opportunity),
    });
  }
  const stages = FIVE_A.filter((k) => stagesByKey.has(k)).map((k) => stagesByKey.get(k)!);

  // A Maslow hypothesis without its utterance is a profile, not a hypothesis.
  const hypotheses: JourneyReportContent['hypotheses'] = [];
  for (const h of list(raw.hypotheses).slice(0, LIMITS.hypotheses)) {
    const quoteId = int(h?.quoteId);
    const hypothesis = text(h?.hypothesis);
    const disproveIf = text(h?.disproveIf);
    if (quoteId == null || !quoteById.has(quoteId) || !hypothesis || !disproveIf) {
      dropped += 1;
      continue;
    }
    hypotheses.push({ layer: text(h?.layer, 64) ?? '', quoteId, hypothesis, disproveIf });
  }

  const dataFlags = list(raw.dataFlags)
    .slice(0, LIMITS.dataFlags)
    .map((f) => ({ text: text(f?.text), section: section(f?.section) }))
    .filter((f): f is { text: string; section: string | null } => !!f.text);

  const actions = list(raw.actions)
    .slice(0, LIMITS.actions)
    .map((a) => ({
      title: text(a?.title, 200),
      successCriterion: text(a?.successCriterion),
      section: section(a?.section),
      urgency: oneOf(a?.urgency, URGENCY, 'improve'),
    }))
    .filter((a): a is JourneyReportContent['actions'][number] => !!a.title);

  const narrative: Record<string, string> = {};
  if (isObject(raw.narrative)) {
    for (const key of sectionKeys) {
      const t = text(raw.narrative[key], 1500);
      if (t) narrative[key] = t;
    }
  }

  return {
    headline,
    subline: text(raw.subline),
    narrative,
    questions,
    quotes,
    stages,
    hypotheses,
    dataFlags,
    actions,
    dropped,
  };
}

/**
 * How often the quoted utterance recurs among the samples — counted here, not
 * taken from the model. Exact after normalising case, space and the cut mark;
 * it says "the same words N times", never "the same intent".
 */
function recurrence(quoted: string[], samples: SampleUtterance[]): number {
  const wanted = new Set(quoted.map(normalise));
  return samples.filter((s) => wanted.has(normalise(s.text))).length;
}

const normalise = (s: string) =>
  s.replace(TRUNCATION_MARK, '').replace(/\s+/g, ' ').trim().toLowerCase();

// ---- the text fields, for moderation ----

/**
 * Every text field, in a fixed order, for one moderation pass (FR-069). Quotes
 * go through too: they were inside the Markdown body the gate used to see.
 */
export function contentTexts(c: JourneyReportContent): string[] {
  return [
    c.headline,
    c.subline ?? '',
    ...Object.values(c.narrative),
    ...c.questions.map((q) => q.text),
    ...c.stages.flatMap((s) => [s.customer ?? '', s.response ?? '', s.pain ?? '', s.opportunity ?? '']),
    ...c.hypotheses.flatMap((h) => [h.layer, h.hypothesis, h.disproveIf]),
    ...c.dataFlags.map((f) => f.text),
    ...c.actions.flatMap((a) => [a.title, a.successCriterion ?? '']),
    ...c.quotes.map((q) => q.text),
  ];
}

/** The inverse of `contentTexts`: the same order, moderated values written back. */
export function withContentTexts(c: JourneyReportContent, texts: string[]): JourneyReportContent {
  let i = 0;
  const next = () => texts[i++] ?? '';
  const orNull = (v: string) => (v === '' ? null : v);
  const headline = next();
  const subline = orNull(next());
  const narrative = Object.fromEntries(Object.keys(c.narrative).map((k) => [k, next()]));
  const questions = c.questions.map((q) => ({ ...q, text: next() }));
  const stages = c.stages.map((s) => ({
    ...s,
    customer: orNull(next()),
    response: orNull(next()),
    pain: orNull(next()),
    opportunity: orNull(next()),
  }));
  const hypotheses = c.hypotheses.map((h) => ({ ...h, layer: next(), hypothesis: next(), disproveIf: next() }));
  const dataFlags = c.dataFlags.map((f) => ({ ...f, text: next() }));
  const actions = c.actions.map((a) => ({ ...a, title: next(), successCriterion: orNull(next()) }));
  const quotes = c.quotes.map((q) => ({ ...q, text: next() }));
  return { ...c, headline, subline, narrative, questions, stages, hypotheses, dataFlags, actions, quotes };
}

// ---- Markdown, for the comparison prompt, export and old readers ----

const HEADINGS: Record<string, Record<string, string>> = {
  EN: { questions: 'Questions and answers', hypotheses: 'Needs (hypotheses)', dataFlags: 'Data quality flags', actions: 'Next actions', path: 'Customer path (5A)', disprove: 'Disproved if', success: 'Success' },
  KO: { questions: '질문과 응답', hypotheses: '니즈 가설', dataFlags: '데이터 품질 플래그', actions: '다음 조치', path: '고객 경로(5A)', disprove: '반증 조건', success: '성공 기준' },
  ES: { questions: 'Preguntas y respuestas', hypotheses: 'Necesidades (hipótesis)', dataFlags: 'Alertas de calidad de datos', actions: 'Próximas acciones', path: 'Recorrido del cliente (5A)', disprove: 'Se refuta si', success: 'Éxito' },
  VI: { questions: 'Câu hỏi và trả lời', hypotheses: 'Nhu cầu (giả thuyết)', dataFlags: 'Cảnh báo chất lượng dữ liệu', actions: 'Hành động tiếp theo', path: 'Hành trình khách hàng (5A)', disprove: 'Bác bỏ nếu', success: 'Tiêu chí thành công' },
  JA: { questions: '質問と回答', hypotheses: 'ニーズ(仮説)', dataFlags: 'データ品質の注意点', actions: '次のアクション', path: '顧客の経路(5A)', disprove: '反証条件', success: '成功基準' },
  ZH: { questions: '问题与回答', hypotheses: '需求(假设)', dataFlags: '数据质量提示', actions: '下一步行动', path: '客户路径(5A)', disprove: '证伪条件', success: '成功标准' },
};

export function contentToMarkdown(c: JourneyReportContent, language: string): string {
  const h = HEADINGS[language.toUpperCase()] ?? HEADINGS.EN;
  const quote = new Map(c.quotes.map((q) => [q.id, q]));
  const out: string[] = [`# ${c.headline}`];
  if (c.subline) out.push('', c.subline);
  for (const text of Object.values(c.narrative)) out.push('', text);
  if (c.questions.length) {
    out.push('', `## ${h.questions}`);
    for (const q of c.questions) {
      out.push(`- **${q.text}**${q.count ? ` ×${q.count}` : ''}`);
      for (const id of q.quoteIds) {
        const s = quote.get(id);
        if (s) out.push(`  > ${s.text} — ${s.who}, ${s.at}`);
      }
    }
  }
  if (c.stages.length) {
    out.push('', `## ${h.path}`);
    for (const s of c.stages) {
      const cells = [s.customer, s.response, s.pain, s.opportunity].filter(Boolean).join(' · ');
      if (cells) out.push(`- **${s.key}**: ${cells}`);
    }
  }
  if (c.hypotheses.length) {
    out.push('', `## ${h.hypotheses}`);
    for (const x of c.hypotheses) {
      out.push(`- ${x.layer ? `${x.layer}: ` : ''}${x.hypothesis} — “${quote.get(x.quoteId)?.text ?? ''}” (${h.disprove}: ${x.disproveIf})`);
    }
  }
  if (c.dataFlags.length) {
    out.push('', `## ${h.dataFlags}`, ...c.dataFlags.map((f) => `- ${f.text}`));
  }
  if (c.actions.length) {
    out.push('', `## ${h.actions}`);
    c.actions.forEach((a, i) =>
      out.push(`${i + 1}. ${a.title}${a.successCriterion ? ` (${h.success}: ${a.successCriterion})` : ''}`),
    );
  }
  return out.join('\n');
}

// ---- small readers ----

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function isObject(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function list(v: unknown): Obj[] {
  return Array.isArray(v) ? v : [];
}
function text(v: unknown, max = MAX_TEXT): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}
function int(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace('#', '')) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
