import type { JourneyMetrics } from './journey-metrics.service';
import type { JourneyReportCriteria } from './entity/journey-report-criteria.entity';
import { TRUNCATION_MARK, type SampleUtterance } from './journey-sample';
import { CONTENT_SCHEMA_HINT } from './journey-report-content';
import { metricStates } from './journey-value-state';

// Kept importable from here — the service and specs already do.
export { TRUNCATION_MARK, clip, type SampleUtterance } from './journey-sample';


/** Follows a cut sample in the prompt — never stored, never shown. */
export const CUT_NOTE = '[cut by this report; the full message was delivered]';

/**
 * The instruction that keeps the model out of the arithmetic.
 *
 * Every figure in the report is already computed. Left free to derive its own,
 * a model produces numbers that are plausible, wrong, and — because they sit in
 * a report — read as evidence.
 */
const CUT_NOTE_RULE =
  'was cut short by this report\'s own length limit — the customer received the whole message.';

const GROUND_RULES = [
  'Every number you print must be copied from the METRICS block. Do not compute, estimate, or round any figure yourself.',
  'If a figure you want is not in METRICS, say it was not measured rather than supplying one.',
  // The code already knows why a figure is empty; left to itself the model
  // called "nothing was resolved" "not measured" — the opposite next step
  // (REQ-261008 F1, seen again on the first structured report).
  'When a figure is null or zero, explain it with its state from VALUE STATES: not_applicable = there was nothing to compute it from (e.g. nothing was resolved), not_measured = it was not recorded, not_observable = support conversations cannot see it. Never call a not_applicable figure "not measured".',
  'Quote only from the SAMPLES block, verbatim and in its original language.',
  `A sample ending in ${TRUNCATION_MARK} ${CUT_NOTE_RULE} Quote it with the mark and never present it as a complete sentence. The cut is not a data problem and not a service problem: do not flag it or propose an action about it.`,
  'Kotler 5A: Aware and Appeal are not observable from support conversations alone. Use the touchpoint event counts in METRICS.stages5a where they exist; otherwise state that they were not observable instead of guessing them.',
  'Maslow: never assert a level. Give a quoted utterance, the hypothesis it suggests, and what would disprove it.',
];

/**
 * How `resolved` and the median were counted, in words — the resolution
 * section is asked to print it verbatim, and until now nothing gave it the
 * rule, so the model reported the rule as missing. Mirrors `classifyOutcome`
 * and `JourneyMetricsService.compute`; the spec pins the wording to the reasons.
 */
export const RESOLUTION_RULE = [
  'Resolved: the customer answered the satisfaction survey (csat_answered); or an agent closed the conversation (agent_closed); or it was closed after an "anything else?" prompt and the last word before the silence was ours (prompted_closed).',
  'Unresolved: still open (open); ended with no close and no prompt (abandoned); or closed after the prompt while the customer had spoken last — they were still asking (customer_last).',
  'Resolution time: median minutes from the first message to the recorded end, over resolved conversations. A resolved conversation without a recorded end time is counted as resolved but excluded from the median.',
].join('\n');

/** Sections in report order; the criteria supply the instruction for each. */
export const SECTION_ORDER = [
  'summary',
  'contact',
  'questions',
  'resolution',
  'path',
  'needs',
  'actions',
] as const;

export function buildJourneyPrompt(input: {
  criteria: JourneyReportCriteria;
  metrics: JourneyMetrics;
  samples: SampleUtterance[];
  language: string;
  period: { from: string | null; to: string | null };
  /**
   * `json` asks for the structured report (PLN-261008 P2); `markdown` is the
   * original prose report, kept as the fallback when the JSON does not hold up.
   */
  format?: 'markdown' | 'json';
}): { system: string; user: string } {
  const { criteria, metrics, samples, language, period } = input;
  const json = input.format === 'json';
  const sections = SECTION_ORDER.filter((key) => criteria.sectionsJson[key]).map(
    (key, i) => `${i + 1}. [${key}] ${criteria.sectionsJson[key]}`,
  );
  const banned = criteria.bannedJson?.length
    ? `\nNever use these phrases: ${criteria.bannedJson.join(', ')}. A score nobody can derive reads as evidence.`
    : '';

  const system = [
    json
      ? 'You write a customer journey report for a support team as ONE JSON object and nothing else — no Markdown, no code fence.'
      : 'You write a customer journey report for a support team, in Markdown.',
    `Write in the tenant's language: ${language}. Keep quoted utterances in their original language.`,
    ...GROUND_RULES,
    ...(json
      ? [
          // The code copies each quote from the numbered sample and drops any
          // item that points nowhere; retyping a quote gains nothing.
          'Quote by reference: list a quote as {"id", "sample"} where sample is the #number of a SAMPLES line. Never retype the words.',
          'Every hypothesis must cite a quoteId from your quotes. A hypothesis without one is discarded.',
          `At most ${criteria.topQuestionsN} questions. "narrative" uses the section keys given in SECTIONS, one short paragraph each.`,
          'Do not put figures in JSON fields of their own — the figures are shown from METRICS. Mention them in sentences only, copied exactly.',
          `JSON shape:\n${CONTENT_SCHEMA_HINT}`,
        ]
      : []),
    criteria.tone ? `Tone: ${criteria.tone}.` : '',
    banned,
  ]
    .filter(Boolean)
    .join('\n');

  const user = [
    `PERIOD: ${period.from ?? 'all'} ~ ${period.to ?? 'all'}`,
    '',
    'SECTIONS (write these, in this order):',
    ...sections,
    '',
    'METRICS (the only source of figures):',
    JSON.stringify(metrics, null, 2),
    '',
    'RESOLUTION RULE (print verbatim where the resolution section asks for the rule):',
    RESOLUTION_RULE,
    '',
    'VALUE STATES (why a figure looks the way it does — decided by the code):',
    JSON.stringify(metricStates(metrics), null, 2),
    '',
    `SAMPLES (${samples.length} utterances, the only source of quotes):`,
    ...samples.map((s, i) => {
      // Said on the line itself: told only in the rules, the model still read
      // a cut sample as an answer the customer received half of, and proposed
      // fixing it (staging report #9).
      const cut = s.text.endsWith(TRUNCATION_MARK) ? ` ${CUT_NOTE}` : '';
      return json ? `#${i + 1} [${s.at}] ${s.who}: ${s.text}${cut}` : `- [${s.at}] ${s.who}: ${s.text}${cut}`;
    }),
  ].join('\n');

  return { system, user };
}

export function buildComparisonPrompt(input: {
  criteria: JourneyReportCriteria;
  older: { createdAt: string; criteriaVersion: number; metrics: JourneyMetrics; body: string };
  newer: { createdAt: string; criteriaVersion: number; metrics: JourneyMetrics; body: string };
  language: string;
}): { system: string; user: string } {
  const { criteria, older, newer, language } = input;
  const versionsDiffer = older.criteriaVersion !== newer.criteriaVersion;

  const system = [
    'You compare two customer journey reports for the same group and write what changed, in Markdown.',
    `Write in the tenant's language: ${language}.`,
    ...GROUND_RULES,
    versionsDiffer
      ? // Said to the model, and printed for the reader: otherwise a change in
        // our own rules is read as a change in the customer.
        `The two reports were written under different criteria versions (v${older.criteriaVersion} and v${newer.criteriaVersion}). Open the report by saying so: part of any difference comes from the rules, not the customer.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const user = [
    'SECTIONS: what changed · what improved and the events that support it · what worsened and a hypothesis · how the 5A and Maslow hypotheses moved, including whether an earlier hypothesis was disproved · whether the previous next-actions were carried out and what came of them',
    '',
    `OLDER REPORT (${older.createdAt}, criteria v${older.criteriaVersion})`,
    'METRICS:',
    JSON.stringify(older.metrics, null, 2),
    'BODY:',
    older.body,
    '',
    `NEWER REPORT (${newer.createdAt}, criteria v${newer.criteriaVersion})`,
    'METRICS:',
    JSON.stringify(newer.metrics, null, 2),
    'BODY:',
    newer.body,
    '',
    criteria.tone ? `Tone: ${criteria.tone}.` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}
