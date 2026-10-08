import type { JourneyMetrics } from './journey-metrics.service';
import type { JourneyReportCriteria } from './entity/journey-report-criteria.entity';
import { TRUNCATION_MARK, type SampleUtterance } from './journey-sample';
import { CONTENT_SCHEMA_HINT } from './journey-report-content';

// Kept importable from here — the service and specs already do.
export { TRUNCATION_MARK, clip, type SampleUtterance } from './journey-sample';


/**
 * The instruction that keeps the model out of the arithmetic.
 *
 * Every figure in the report is already computed. Left free to derive its own,
 * a model produces numbers that are plausible, wrong, and — because they sit in
 * a report — read as evidence.
 */
const GROUND_RULES = [
  'Every number you print must be copied from the METRICS block. Do not compute, estimate, or round any figure yourself.',
  'If a figure you want is not in METRICS, say it was not measured rather than supplying one.',
  'Quote only from the SAMPLES block, verbatim and in its original language.',
  `A sample ending in ${TRUNCATION_MARK} was cut short. Quote it with the mark and never present it as a complete sentence.`,
  'Kotler 5A: Aware and Appeal are not observable from support conversations alone. Use the touchpoint event counts in METRICS.stages5a where they exist; otherwise state that they were not observable instead of guessing them.',
  'Maslow: never assert a level. Give a quoted utterance, the hypothesis it suggests, and what would disprove it.',
];

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
    `SAMPLES (${samples.length} utterances, the only source of quotes):`,
    ...samples.map((s, i) =>
      json ? `#${i + 1} [${s.at}] ${s.who}: ${s.text}` : `- [${s.at}] ${s.who}: ${s.text}`,
    ),
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
