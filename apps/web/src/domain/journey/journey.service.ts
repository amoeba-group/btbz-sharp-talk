import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api-client';

export interface JourneyReportSummary {
  id: string;
  groupId: string;
  kind: 'journey' | 'comparison';
  periodFrom: string | null;
  periodTo: string | null;
  criteriaVersion: number;
  sessionCount: number;
  status: 'pending' | 'ready' | 'failed';
  error: string | null;
  language: string;
  provider: string | null;
  model: string | null;
  sourceReportIds: string[] | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface JourneyReportDetail extends JourneyReportSummary {
  bodyMd: string | null;
  /** What the code counted. The body is written from this — never instead. */
  metrics: Record<string, unknown> | null;
}

export interface JourneyCriteria {
  id: string;
  version: number;
  sections: Record<string, string>;
  topQuestionsN: number;
  sampleCap: number;
  quoteMaxChars: number;
  tone: string | null;
  banned: string[];
  createdAt: string;
}

// ---- journey management (PLN-261006) ----

export interface JourneyStage {
  key: string;
  /** Per language code (EN, KO, …); EN is the fallback. */
  label: Record<string, string>;
  color: string | null;
  sortOrder: number;
}

export interface JourneyTask {
  id: string;
  title: string;
  dueAt: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  done: boolean;
  doneAt: string | null;
  source: 'manual' | 'report';
  reportId: string | null;
  createdAt: string;
}

export interface JourneyCard {
  groupId: string;
  stageKey: string | null;
  stageChangedAt: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  tasks: JourneyTask[];
}

export interface JourneyBoardCard {
  groupId: string;
  title: string;
  kind: 'timeline' | 'project';
  stageKey: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  stageChangedAt: string | null;
  openTasks: number;
  overdueTasks: number;
  memberCount: number;
  lastMessageAt: string | null;
}

export interface JourneyTimelineItem {
  at: string;
  kind: 'cjm' | 'conversation_started' | 'conversation_ended' | 'csat';
  stage: string | null;
  eventType: string | null;
  sessionId: string | null;
  conversationId: string | null;
  channel: string | null;
  csat: number | null;
}

export interface JourneyStageChange {
  at: string;
  actorName: string | null;
  from: string | null;
  to: string | null;
}

export interface JourneyPerson {
  id: string;
  name: string;
}

/** The stage name in the console language, EN as the fallback. */
export function stageLabel(stage: JourneyStage | undefined, lang: string): string {
  if (!stage) return '';
  const l = stage.label;
  return l[lang.slice(0, 2).toUpperCase()] || l.EN || Object.values(l)[0] || stage.key;
}

export const journeyService = {
  reports: (groupId: string) =>
    apiGet<JourneyReportSummary[]>(`/journey/groups/${groupId}/reports`),
  report: (id: string) => apiGet<JourneyReportDetail>(`/journey/reports/${id}`),
  create: (groupId: string, body: { period_from?: string; period_to?: string }) =>
    apiPost<JourneyReportSummary>(`/journey/groups/${groupId}/reports`, body),
  compare: (reportIds: string[]) =>
    apiPost<JourneyReportSummary>('/journey/reports/compare', {
      report_ids: reportIds.map(Number),
    }),
  hide: (id: string) => apiDelete<{ hidden: boolean }>(`/journey/reports/${id}`),
  criteria: () =>
    apiGet<{ current: JourneyCriteria; history: JourneyCriteria[] }>('/journey/criteria'),
  saveCriteria: (body: Partial<Record<string, unknown>>) =>
    apiPut<JourneyCriteria>('/journey/criteria', body),
  // ---- journey management (PLN-261006) ----
  stages: () => apiGet<JourneyStage[]>('/journey/stages'),
  saveStages: (stages: Array<{ key: string; label: Record<string, string>; color?: string | null }>) =>
    apiPut<JourneyStage[]>('/journey/stages', { stages }),
  people: () => apiGet<JourneyPerson[]>('/journey/people'),
  board: (q: { kind?: string; owner?: string; overdue?: boolean }) =>
    apiGet<{ stages: JourneyStage[]; cards: JourneyBoardCard[] }>('/journey/board', {
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.owner ? { owner: q.owner } : {}),
      ...(q.overdue ? { overdue: '1' } : {}),
    }),
  card: (groupId: string) => apiGet<JourneyCard>(`/journey/groups/${groupId}/journey`),
  setStage: (groupId: string, stageKey: string | null) =>
    apiPut<JourneyCard>(`/journey/groups/${groupId}/stage`, { stage_key: stageKey }),
  setOwner: (groupId: string, ownerUserId: string | null) =>
    apiPut<JourneyCard>(`/journey/groups/${groupId}/owner`, {
      owner_user_id: ownerUserId != null ? Number(ownerUserId) : null,
    }),
  history: (groupId: string) => apiGet<JourneyStageChange[]>(`/journey/groups/${groupId}/history`),
  timeline: (groupId: string, before?: string) =>
    apiGet<{ items: JourneyTimelineItem[]; hasMore: boolean }>(
      `/journey/groups/${groupId}/timeline`,
      before ? { before } : {},
    ),
  addTask: (
    groupId: string,
    body: { title: string; due_at?: string; assignee_user_id?: number; source?: 'manual' | 'report'; report_id?: number },
  ) => apiPost<JourneyCard>(`/journey/groups/${groupId}/tasks`, body),
  updateTask: (
    id: string,
    body: { title?: string; due_at?: string | null; assignee_user_id?: number | null; done?: boolean },
  ) => apiPatch<JourneyTask>(`/journey/tasks/${id}`, body),
  deleteTask: (id: string) => apiDelete<{ deleted: boolean }>(`/journey/tasks/${id}`),
};
