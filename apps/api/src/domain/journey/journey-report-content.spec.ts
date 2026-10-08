import { MODERATION_DECISION } from '@sharptalk/types';
import {
  contentTexts,
  contentToMarkdown,
  extractJson,
  groundContent,
  withContentTexts,
} from './journey-report-content';
import { buildJourneyPrompt, CUT_NOTE, RESOLUTION_RULE } from './journey-prompt';
import { RESOLUTION_REASON, UNRESOLVED_REASON } from '../../global/util/resolution.util';
import { JourneyReportService } from './journey-report.service';
import { REPORT_STATUS } from './entity/journey-report.entity';
import type { SampleUtterance } from './journey-sample';
import type { JourneyReportCriteria } from './entity/journey-report-criteria.entity';
import type { JourneyMetrics } from './journey-metrics.service';

// The report behind REQ-261008: the same chip question on two days, an AI
// answer cut at 200 characters, and a human agent's early check-in reply.
const SAMPLES: SampleUtterance[] = [
  { at: '2026-08-25', who: 'user', text: 'How long does shipping take?' },
  { at: '2026-08-25', who: 'ai', text: 'Orders ship within 1–2 business days…' },
  { at: '2026-08-26', who: 'user', text: 'How long does shipping take?' },
  { at: '2026-08-28', who: 'agent', text: 'Standard check-in time is after 2:00 PM.' },
];
const SECTIONS = ['summary', 'questions', 'actions'];

const reply = (over: Record<string, unknown> = {}) => ({
  headline: 'Answered, but neither conversation was closed.',
  subline: 'Close them first.',
  narrative: { summary: 'Two sessions, both open.', bogus: 'not a section' },
  quotes: [
    // A paraphrase: the code must replace it with the sample.
    { id: 1, sample: 1, text: 'how long is delivery??' },
    { id: 2, sample: 2 },
    { id: 3, sample: 99 }, // points nowhere
  ],
  questions: [{ text: 'Shipping time', quoteIds: [1, 3], answered: 'answered', count: 40 }],
  stages: [
    { key: 'ask', customer: 'Asked shipping time twice', response: 'Ships in 1–2 days' },
    { key: 'teleport', customer: 'x' },
  ],
  hypotheses: [
    { layer: 'Safety', quoteId: 1, hypothesis: 'Wants certainty of arrival', disproveIf: 'No pending order' },
    { layer: 'Comfort', quoteId: 7, hypothesis: 'No evidence', disproveIf: 'x' },
  ],
  dataFlags: [{ text: 'Answer cut mid-sentence', section: 'questions' }],
  actions: [
    { title: 'Close the 2 open conversations', successCriterion: 'open 0', section: 'summary', urgency: 'now' },
    { title: '', urgency: 'now' },
  ],
  ...over,
});

describe('groundContent (PLN-261008 P2)', () => {
  const ground = (raw: unknown) => groundContent(raw, SAMPLES, SECTIONS, 5)!;

  it('replaces a paraphrased quote with the sample it points at', () => {
    const c = ground(reply());
    expect(c.quotes.find((q) => q.id === 1)?.text).toBe('How long does shipping take?');
    expect(c.quotes.find((q) => q.id === 1)?.who).toBe('user');
  });

  it('drops a quote whose sample does not exist, and counts it', () => {
    const c = ground(reply());
    expect(c.quotes.map((q) => q.id)).toEqual([1, 2]);
    expect(c.dropped).toBe(2); // quote #3 and the hypothesis citing quote 7
  });

  it('marks a quote of a cut sample as truncated', () => {
    expect(ground(reply()).quotes.find((q) => q.id === 2)?.truncated).toBe(true);
  });

  it('recounts a question from the samples and ignores the model’s number', () => {
    const q = ground(reply()).questions[0];
    expect(q.quoteIds).toEqual([1]);
    expect(q.count).toBe(2); // the same words on 08-25 and 08-26, not 40
  });

  it('drops a question that cites no quote', () => {
    const c = ground(reply({ questions: [{ text: 'Refunds', quoteIds: [] }] }));
    expect(c.questions).toHaveLength(0);
  });

  it('keeps only customer quotes as a question’s evidence (staging #11)', () => {
    const c = ground(
      reply({
        quotes: [
          { id: 1, sample: 1 }, // user
          { id: 4, sample: 4 }, // agent: early check-in
        ],
        questions: [
          { text: 'Shipping time', quoteIds: [1, 4] },
          { text: 'Is early check-in possible?', quoteIds: [4] },
        ],
      }),
    );
    expect(c.questions.map((q) => q.text)).toEqual(['Shipping time']);
    expect(c.questions[0].quoteIds).toEqual([1]);
    expect(c.dropped).toBe(2); // the agent-only question + the hypothesis citing quote 7
  });

  it('keeps only 5A stages and hypotheses with a real quote', () => {
    const c = ground(reply());
    expect(c.stages.map((s) => s.key)).toEqual(['ask']);
    expect(c.hypotheses.map((h) => h.layer)).toEqual(['Safety']);
  });

  it('keeps narrative only for the tenant’s sections and actions only with a title', () => {
    const c = ground(reply());
    expect(Object.keys(c.narrative)).toEqual(['summary']);
    expect(c.actions).toHaveLength(1);
    expect(c.actions[0].urgency).toBe('now');
  });

  it('caps questions at the criteria’s top-N', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ text: `Q${i}`, quoteIds: [1] }));
    expect(groundContent(reply({ questions: many }), SAMPLES, SECTIONS, 3)!.questions).toHaveLength(3);
  });

  it('rejects a reply without a headline or without JSON', () => {
    expect(groundContent(reply({ headline: '' }), SAMPLES, SECTIONS, 5)).toBeNull();
    expect(groundContent(extractJson('Here is your report: # Title'), SAMPLES, SECTIONS, 5)).toBeNull();
  });

  it('reads JSON wrapped in a code fence', () => {
    expect(extractJson('```json\n{"headline":"h"}\n```')).toEqual({ headline: 'h' });
  });
});

describe('content text round trip', () => {
  it('writes moderated texts back to the same fields', () => {
    const c = groundContent(reply(), SAMPLES, SECTIONS, 5)!;
    const texts = contentTexts(c);
    const back = withContentTexts(c, texts.map((t) => (t ? `[${t}]` : t)));
    expect(back.headline).toBe(`[${c.headline}]`);
    expect(back.actions[0].title).toBe(`[${c.actions[0].title}]`);
    expect(back.quotes[0].text).toBe(`[${c.quotes[0].text}]`);
    expect(back.stages[0].pain).toBeNull(); // empty stays empty
    expect(contentTexts(back)).toHaveLength(texts.length);
  });

  it('renders Markdown in the report language', () => {
    const md = contentToMarkdown(groundContent(reply(), SAMPLES, SECTIONS, 5)!, 'KO');
    expect(md.startsWith('# Answered')).toBe(true);
    expect(md).toContain('## 질문과 응답');
    expect(md).toContain('> How long does shipping take? — user, 2026-08-25');
  });
});

describe('journey prompt, JSON format', () => {
  it('numbers the samples and asks for quotes by reference', () => {
    const { system, user } = buildJourneyPrompt({
      criteria: { sectionsJson: { summary: 'x' }, bannedJson: [], tone: null, topQuestionsN: 5 } as unknown as JourneyReportCriteria,
      metrics: {} as JourneyMetrics,
      samples: SAMPLES,
      language: 'EN',
      period: { from: null, to: null },
      format: 'json',
    });
    expect(system).toContain('ONE JSON object');
    expect(system).toContain('Never retype the words');
    expect(system).toContain('"questions" are what the customer asked');
    expect(system).toContain('never supported by an ai/agent quote alone');
    expect(user).toContain('#1 [2026-08-25] user: How long does shipping take?');
  });

  it('hands the model the value states and says what each one means (REQ-261008 F1)', () => {
    const { system, user } = buildJourneyPrompt({
      criteria: { sectionsJson: { summary: 'x' }, bannedJson: [], tone: null, topQuestionsN: 5 } as unknown as JourneyReportCriteria,
      metrics: { conversations: 2, resolved: 0, medianResolutionMinutes: null } as unknown as JourneyMetrics,
      samples: SAMPLES,
      language: 'EN',
      period: { from: null, to: null },
    });
    expect(user).toContain('VALUE STATES');
    expect(user).toContain('"medianResolutionMinutes": "not_applicable"');
    expect(system).toContain('Never call a not_applicable figure "not measured"');
    expect(system).toContain('do not flag it or propose an action about it');
  });

  it('labels a cut sample on its own line and gives the resolution rule', () => {
    const { user } = buildJourneyPrompt({
      criteria: { sectionsJson: { resolution: 'x' }, bannedJson: [], tone: null, topQuestionsN: 5 } as unknown as JourneyReportCriteria,
      metrics: {} as JourneyMetrics,
      samples: SAMPLES,
      language: 'EN',
      period: { from: null, to: null },
      format: 'json',
    });
    expect(user).toContain(`#2 [2026-08-25] ai: Orders ship within 1–2 business days… ${CUT_NOTE}`);
    expect(user).not.toContain(`take? ${CUT_NOTE}`);
    expect(user).toContain(RESOLUTION_RULE);
  });

  it('names every resolution reason the code can produce', () => {
    for (const reason of [...Object.values(RESOLUTION_REASON), ...Object.values(UNRESOLVED_REASON)]) {
      expect(RESOLUTION_RULE).toContain(`(${reason})`);
    }
  });
});

describe('JourneyReportService — structured generation', () => {
  function build(replies: string[], moderate: jest.Mock) {
    const report = {
      id: 7,
      tenantId: 4,
      kind: 'journey',
      criteriaVersion: 1,
      sessionIdsJson: [2005, 2581],
      language: 'EN',
      periodFrom: null,
      periodTo: null,
      createdBy: 1,
    } as Record<string, unknown>;
    const repo = {
      findOne: jest.fn(async () => report),
      save: jest.fn(async (r: unknown) => r),
    };
    const messages = SAMPLES.map((s, i) => ({
      senderType: s.who,
      body: s.text,
      createdAt: new Date(`${s.at}T00:00:0${i}Z`),
    }));
    const ai = { complete: jest.fn() };
    for (const text of replies) ai.complete.mockResolvedValueOnce({ text, provider: 'stub', model: 'm' });
    const svc = new JourneyReportService(
      repo as never,
      { find: jest.fn(async () => messages) } as never,
      { find: jest.fn(async () => [{ id: 1 }]) } as never,
      {} as never,
      { compute: jest.fn(async () => ({ conversations: 2 })) } as never,
      {
        version: jest.fn(async () => ({
          version: 1,
          sectionsJson: { summary: 's', questions: 'q', actions: 'a' },
          sampleCap: 200,
          quoteMaxChars: 200,
          topQuestionsN: 5,
          bannedJson: [],
          tone: null,
        })),
      } as never,
      ai as never,
      { moderate } as never,
      { write: jest.fn() } as never,
    );
    const run = () => (svc as unknown as { run(id: number): Promise<void> }).run(7);
    return { svc, run, report, ai };
  }
  const pass = jest.fn(async ({ text }: { text: string }) => ({ decision: MODERATION_DECISION.DELIVERED, text }));

  it('stores grounded content and a Markdown body from one JSON reply', async () => {
    const h = build([JSON.stringify(reply())], pass);
    await h.run();
    expect(h.report.status).toBe(REPORT_STATUS.READY);
    expect((h.report.contentJson as { headline: string }).headline).toContain('Answered');
    expect(h.report.bodyMd).toContain('# Answered');
    expect(h.ai.complete).toHaveBeenCalledTimes(1);
    expect(h.ai.complete.mock.calls[0][0].maxTokens).toBe(6000);
  });

  it('retries once, then falls back to the Markdown report', async () => {
    const h = build(['not json', '{"oops":1}', '# Markdown report'], pass);
    await h.run();
    expect(h.ai.complete).toHaveBeenCalledTimes(3);
    expect(h.report.contentJson).toBeNull();
    expect(h.report.bodyMd).toBe('# Markdown report');
    expect(h.report.status).toBe(REPORT_STATUS.READY);
  });

  it('fails the report when moderation blocks any field', async () => {
    const block = jest.fn(async () => ({ decision: MODERATION_DECISION.BLOCKED, text: '' }));
    const h = build([JSON.stringify(reply())], block);
    await h.run();
    expect(h.report.status).toBe(REPORT_STATUS.FAILED);
    expect(h.report.error).toBe('blocked by moderation');
  });

  it('moderates all fields in one pass and applies a mask to the right field', async () => {
    const mask = jest.fn(async ({ text }: { text: string }) => ({
      decision: MODERATION_DECISION.EDITED,
      text: text.replace('2 open', '[N] open'),
    }));
    const h = build([JSON.stringify(reply())], mask);
    await h.run();
    expect(mask).toHaveBeenCalledTimes(1);
    expect((h.report.contentJson as { actions: Array<{ title: string }> }).actions[0].title).toBe(
      'Close the [N] open conversations',
    );
  });

  it('moderates field by field when a rewrite loses the separators', async () => {
    const rephrase = jest.fn(async ({ text }: { text: string }) => ({
      decision: MODERATION_DECISION.EDITED,
      text: text.includes('§§§') ? 'one rewritten paragraph' : text,
    }));
    const h = build([JSON.stringify(reply())], rephrase);
    await h.run();
    expect(rephrase.mock.calls.length).toBeGreaterThan(1);
    expect((h.report.contentJson as { headline: string }).headline).toContain('Answered');
  });
});
