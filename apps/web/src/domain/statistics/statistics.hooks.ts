import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { statisticsService } from './statistics.service';
import type {
  AccessBreakdown,
  JourneyStages,
  AgentRow,
  ChannelRow,
  CsatListParams,
  HourGrid,
  QuestionStatsParams,
  ResolutionBreakdown,
} from './statistics.service';
import { useTenantKey } from '@/lib/use-tenant-key';

export const useQuestionStats = (params: QuestionStatsParams) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['question-stats', tenantKey, params],
    queryFn: () => statisticsService.questions(params),
    // Switching tabs should redraw, not blank out — the shape is identical
    // across lenses, only the rows change.
    placeholderData: keepPreviousData,
  });
};

export const useCsatSummary = (from: string, to: string) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['csat', tenantKey, 'summary', from, to],
    queryFn: () => statisticsService.csatSummary(from, to),
    placeholderData: keepPreviousData,
  });
};

export const useCsatAgents = (from: string, to: string) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['csat', tenantKey, 'agents', from, to],
    queryFn: () => statisticsService.csatAgents(from, to),
    placeholderData: keepPreviousData,
  });
};

export const useCsatConversations = (params: CsatListParams) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['csat', tenantKey, 'conversations', params],
    queryFn: () => statisticsService.csatConversations(params),
    placeholderData: keepPreviousData,
  });
};


/**
 * Keep the previous rows only while the tenant is the same.
 *
 * `keepPreviousData` alone redraws the last tenant's statistics under the new
 * tenant's name for as long as the fetch takes. It looks like data, not like
 * loading, and it is another tenant's.
 */
const keepWithinTenant =
  <T,>(tenantKey: unknown) =>
  (previous: T | undefined, previousQuery?: { queryKey: readonly unknown[] }): T | undefined =>
    previousQuery?.queryKey?.[1] === tenantKey ? previous : undefined;

export const useJourneyStats = (from: string, to: string) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['stats-journey', tenantKey, from, to],
    queryFn: () => statisticsService.journey(from, to),
    placeholderData: keepWithinTenant<JourneyStages>(tenantKey),
  });
};

export const useAccessStats = (from: string, to: string) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['stats-access', tenantKey, from, to],
    queryFn: () => statisticsService.access(from, to),
    placeholderData: keepWithinTenant<AccessBreakdown>(tenantKey),
  });
};

/** The four AN-260826 P1 lenses. One shape each; the window is shared with the rest. */
export const useChannelStats = (from: string, to: string) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['stats-channels', tenantKey, from, to],
    queryFn: () => statisticsService.channels(from, to),
    placeholderData: keepWithinTenant<ChannelRow[]>(tenantKey),
  });
};

export const useAgentStats = (from: string, to: string) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['stats-agents', tenantKey, from, to],
    queryFn: () => statisticsService.agents(from, to),
    placeholderData: keepWithinTenant<{ ai: AgentRow[]; human: AgentRow[] }>(tenantKey),
  });
};

export const useResolutionStats = (from: string, to: string) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['stats-resolution', tenantKey, from, to],
    queryFn: () => statisticsService.resolution(from, to),
    placeholderData: keepWithinTenant<ResolutionBreakdown>(tenantKey),
  });
};

export const useHourStats = (from: string, to: string) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['stats-hours', tenantKey, from, to],
    queryFn: () => statisticsService.hours(from, to),
    placeholderData: keepWithinTenant<HourGrid>(tenantKey),
  });
};
