import { apiGet, apiGetList } from '@/lib/api-client';

/** The four lenses a question can be counted through (PLN D2). */
export const DIMENSIONS = ['intent', 'category', 'document', 'keyword', 'cluster'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** Tabs shown in the console; `category` rides along inside the document tab. */
export const DIMENSION_TABS: Dimension[] = ['intent', 'document', 'keyword', 'cluster'];

export interface StatRow {
  key: string;
  label: string | null;
  asked: number;
  escalated: number;
  noSource: number;
  escalationRate: number;
  avgConfidence: number | null;
}

export interface QuestionStats {
  top: StatRow[];
  trend: Array<{ date: string; asked: number }>;
  total: number;
  /** Latest day the snapshot job has written; null when it has never run. */
  lastAggregated: string | null;
  /** Whole days behind yesterday — 0 when current (the job aggregates yesterday). */
  staleDays: number;
}


export interface ChannelRow {
  channel: string;
  conversations: number;
  messages: number;
  inbound: number;
  avgMessages: number;
  medianMessages: number;
  escalated: number;
  escalationRate: number;
}

export interface AgentRow {
  id: number | null;
  name: string;
  conversations: number;
  replies: number;
  resolved: number;
  resolutionRate: number;
  csatRated: number;
  csatAvg: number | null;
}

export interface ResolutionBreakdown {
  ended: number;
  resolved: number;
  resolutionRate: number;
  byReason: Array<{ reason: string; resolved: boolean; count: number }>;
}

export interface HourGrid {
  timezone: string;
  timezoneSource: 'tenant' | 'default';
  grid: number[][];
  total: number;
}

export interface QuestionStatsParams {
  dimension: Dimension;
  from: string;
  to: string;
  limit?: number;
}

// ---- CSAT (PLN-260826-Dashboard-Integration-CSAT-Stats) ----

export interface CsatSummary {
  from: string;
  to: string;
  ended: number;
  rated: number;
  avg: number | null;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

export interface CsatAgentRow {
  agentId: number | null;
  agentName: string | null;
  rated: number;
  avg: number;
}

export interface CsatConversationRow {
  id: number;
  sessionId: string;
  alias: string | null;
  customerName: string | null;
  agentId: number | null;
  agentName: string | null;
  channel: string;
  rating: number | null;
  ratedAt: string | null;
  endedAt: string | null;
}

export interface CsatListParams {
  from: string;
  to: string;
  rating?: string;
  agentId?: string;
  page: number;
  size: number;
}

/** Widget funnel: shown → opened → talked (PLN-260920). */
export interface AccessRow {
  key: string;
  id?: number | null;
  impressions: number;
  opens: number;
  openedSessions: number;
  conversations: number;
  openRate: number;
  chatRate: number;
}

export interface AccessDaily {
  day: string;
  impressions: number;
  opens: number;
  openedSessions: number;
  conversations: number;
}

export interface AccessBreakdown {
  totals: AccessRow;
  daily: AccessDaily[];
  byAgent: AccessRow[];
  byPath: AccessRow[];
  otherPaths: (AccessRow & { paths: number }) | null;
  collectingSince: string | null;
}

export const statisticsService = {
  access: (from: string, to: string) => apiGet<AccessBreakdown>('/analytics/access', { from, to }),

  channels: (from: string, to: string) =>
    apiGet<ChannelRow[]>('/analytics/channels', { from, to }),
  agents: (from: string, to: string) =>
    apiGet<{ ai: AgentRow[]; human: AgentRow[] }>('/analytics/agents', { from, to }),
  resolution: (from: string, to: string) =>
    apiGet<ResolutionBreakdown>('/analytics/resolution', { from, to }),
  hours: (from: string, to: string) => apiGet<HourGrid>('/analytics/hours', { from, to }),

  questions: (params: QuestionStatsParams) =>
    apiGet<QuestionStats>('/analytics/questions', {
      dimension: params.dimension,
      from: params.from,
      to: params.to,
      limit: params.limit,
    }),
  csatSummary: (from: string, to: string) =>
    apiGet<CsatSummary>('/agent/csat/summary', { from, to }),
  csatAgents: (from: string, to: string) =>
    apiGet<CsatAgentRow[]>('/agent/csat/agents', { from, to }),
  csatConversations: (params: CsatListParams) =>
    apiGetList<CsatConversationRow>('/agent/csat/conversations', {
      from: params.from,
      to: params.to,
      page: params.page,
      size: params.size,
      ...(params.rating ? { rating: params.rating } : {}),
      ...(params.agentId ? { agent_id: params.agentId } : {}),
    }),
};
