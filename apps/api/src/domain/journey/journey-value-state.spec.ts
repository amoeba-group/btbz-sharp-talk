import { CJM_STAGE } from '@sharptalk/types';
import { toFiveA } from './journey-stage-map';
import { metricStates, VALUE_STATE } from './journey-value-state';
import { buildJourneyPrompt, clip, TRUNCATION_MARK } from './journey-prompt';
import { JourneyMapper } from './journey.mapper';
import type { JourneyReport } from './entity/journey-report.entity';
import type { JourneyReportCriteria } from './entity/journey-report-criteria.entity';
import type { JourneyMetrics } from './journey-metrics.service';

const { MEASURED, NOT_APPLICABLE, NOT_MEASURED, NOT_OBSERVABLE } = VALUE_STATE;

describe('toFiveA (REQ-261008 T10)', () => {
  it('maps every funnel stage onto one 5A step, Purchase and Delivery both to act', () => {
    const out = toFiveA([
      { stage: CJM_STAGE.AWARENESS, events: 2 },
      { stage: CJM_STAGE.BROWSE, events: 3 },
      { stage: CJM_STAGE.INQUIRY, events: 4 },
      { stage: CJM_STAGE.PURCHASE, events: 1 },
      { stage: CJM_STAGE.DELIVERY, events: 1 },
      { stage: CJM_STAGE.POST, events: 1 },
    ]);
    expect(out).toEqual([
      { stage: 'aware', events: 2 },
      { stage: 'appeal', events: 3 },
      { stage: 'ask', events: 4 },
      { stage: 'act', events: 2 },
      { stage: 'advocate', events: 1 },
    ]);
  });

  it('keeps all five steps and drops an unknown stage instead of guessing a column', () => {
    const out = toFiveA([{ stage: 'Mystery', events: 9 }]);
    expect(out.map((s) => s.events)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('metricStates (REQ-261008 D3)', () => {
  // The report that prompted this: two open conversations, nothing resolved.
  const report = {
    conversations: 2,
    resolved: 0,
    medianResolutionMinutes: null,
    csatResponses: 0,
    stages: [{ stage: CJM_STAGE.AWARENESS, events: 2 }],
  };

  it('calls a null median with nothing resolved "not applicable", not "not measured"', () => {
    expect(metricStates(report).medianResolutionMinutes).toBe(NOT_APPLICABLE);
  });

  it('calls a null median with resolved conversations "not measured"', () => {
    expect(metricStates({ ...report, resolved: 2 }).medianResolutionMinutes).toBe(NOT_MEASURED);
  });

  it('calls a median that exists "measured"', () => {
    expect(metricStates({ ...report, resolved: 1, medianResolutionMinutes: 4 }).medianResolutionMinutes).toBe(MEASURED);
  });

  it('makes per-conversation figures not applicable when there are no conversations', () => {
    const s = metricStates({ conversations: 0 });
    expect(s.avgLoops).toBe(NOT_APPLICABLE);
    expect(s.resolutionRate).toBe(NOT_APPLICABLE);
    expect(s.conversations).toBe(MEASURED);
  });

  it('treats an empty Aware/Appeal as not observable but an empty later step as a count', () => {
    const s = metricStates(report);
    expect(s['stage.aware']).toBe(MEASURED);
    expect(s['stage.appeal']).toBe(NOT_OBSERVABLE);
    expect(s['stage.ask']).toBe(MEASURED);
    expect(s['stage.act']).toBe(MEASURED);
  });

  it('copes with a report that has no metrics at all', () => {
    expect(metricStates(null).medianResolutionMinutes).toBe(NOT_APPLICABLE);
  });
});

describe('truncated quotes (REQ-261008 F2)', () => {
  it('marks a cut sample and leaves a short one alone', () => {
    expect(clip('a'.repeat(278), 200)).toBe(`${'a'.repeat(200)}${TRUNCATION_MARK}`);
    expect(clip('How long does shipping take?', 200)).toBe('How long does shipping take?');
  });

  it('tells the model what the mark means', () => {
    const { system } = buildJourneyPrompt({
      criteria: { sectionsJson: { summary: 'x' }, bannedJson: [], tone: null } as unknown as JourneyReportCriteria,
      metrics: {} as JourneyMetrics,
      samples: [],
      language: 'EN',
      period: { from: null, to: null },
    });
    expect(system).toContain(`ending in ${TRUNCATION_MARK} was cut short`);
    expect(system).toContain('METRICS.stages5a');
  });
});

describe('JourneyMapper report detail', () => {
  const row = {
    id: '7',
    groupId: '9',
    sessionIdsJson: [2005, 2581],
    sourceReportIds: null,
    bodyMd: '# r',
    // Written before 5A or value states existed.
    metricsJson: { conversations: 2, resolved: 0, medianResolutionMinutes: null, stages: [{ stage: 'Awareness', events: 2 }] },
  } as unknown as JourneyReport;

  it('derives 5A and value states for a report written before they existed', () => {
    const out = JourneyMapper.toReport(row, true) as Record<string, any>;
    expect(out.metrics.stages5a[0]).toEqual({ stage: 'aware', events: 2 });
    expect(out.metricStates.medianResolutionMinutes).toBe(NOT_APPLICABLE);
  });

  it('keeps lists light', () => {
    expect((JourneyMapper.toReport(row) as Record<string, any>).metrics).toBeUndefined();
  });
});
