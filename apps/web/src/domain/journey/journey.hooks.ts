import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@/store/toast-store';
import { useTenantKey } from '@/lib/use-tenant-key';
import { journeyService } from './journey.service';

/**
 * A pending report is polled; a finished one is not.
 *
 * Generation runs after the request returns, so without this the operator
 * watches a row that says "pending" until they reload — which reads as broken
 * rather than as working.
 */
export function useJourneyReports(groupId: string | null) {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['journey', tenantKey, 'reports', groupId],
    queryFn: () => journeyService.reports(groupId as string),
    enabled: !!groupId,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((r) => r.status === 'pending') ? 5000 : false,
  });
}

export function useJourneyReport(id: string | null) {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['journey', tenantKey, 'report', id],
    queryFn: () => journeyService.report(id as string),
    enabled: !!id,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 5000 : false),
  });
}

export function useCreateJourneyReport(groupId: string | null) {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const { t } = useTranslation('journey');
  return useMutation({
    mutationFn: (v: { period_from?: string; period_to?: string }) =>
      journeyService.create(groupId as string, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journey', tenantKey, 'reports', groupId] });
      // Said explicitly because nothing appears yet: the row is queued, not written.
      toast.success(t('queued'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCompareJourneyReports(groupId: string | null) {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const { t } = useTranslation('journey');
  return useMutation({
    mutationFn: (reportIds: string[]) => journeyService.compare(reportIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journey', tenantKey, 'reports', groupId] });
      toast.success(t('queued'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useJourneyCriteria() {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['journey', tenantKey, 'criteria'],
    queryFn: () => journeyService.criteria(),
  });
}

export function useSaveJourneyCriteria() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const { t } = useTranslation('journey');
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => journeyService.saveCriteria(body),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['journey', tenantKey, 'criteria'] });
      // The version number is the point: past reports keep the one they used.
      toast.success(t('criteria.saved', { version: saved.version }));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ---- journey management (PLN-261006) ----

export function useJourneyStages() {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['journey', tenantKey, 'stages'],
    queryFn: () => journeyService.stages(),
    staleTime: 60_000,
  });
}

export function useSaveJourneyStages() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const { t } = useTranslation('journey');
  return useMutation({
    mutationFn: journeyService.saveStages,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journey', tenantKey, 'stages'] });
      qc.invalidateQueries({ queryKey: ['journey', tenantKey, 'board'] });
      toast.success(t('stages.saved'));
    },
    onError: (e: Error) => toast.error(e.message || t('stages.saveError'), { sticky: true }),
  });
}

export function useJourneyPeople() {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['journey', tenantKey, 'people'],
    queryFn: () => journeyService.people(),
    staleTime: 5 * 60_000,
  });
}

export function useJourneyCard(groupId: string | null) {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['journey', tenantKey, 'card', groupId],
    queryFn: () => journeyService.card(groupId as string),
    enabled: !!groupId,
  });
}

export function useJourneyHistory(groupId: string | null, enabled: boolean) {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['journey', tenantKey, 'history', groupId],
    queryFn: () => journeyService.history(groupId as string),
    enabled: !!groupId && enabled,
  });
}

export function useJourneyTimeline(groupId: string | null, enabled: boolean) {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['journey', tenantKey, 'timeline', groupId],
    queryFn: () => journeyService.timeline(groupId as string),
    enabled: !!groupId && enabled,
  });
}

export function useJourneyBoard(q: { kind?: string; owner?: string; overdue?: boolean }) {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['journey', tenantKey, 'board', q],
    queryFn: () => journeyService.board(q),
    refetchInterval: 30_000,
  });
}

/**
 * Every write on a journey refreshes the same three views: the card in the
 * group room, the board, and the stage history.
 */
export function useJourneyActions(groupId: string | null) {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const { t } = useTranslation('journey');
  const refresh = (gid: string | null = groupId) => {
    qc.invalidateQueries({ queryKey: ['journey', tenantKey, 'card', gid] });
    qc.invalidateQueries({ queryKey: ['journey', tenantKey, 'board'] });
    qc.invalidateQueries({ queryKey: ['journey', tenantKey, 'history', gid] });
  };
  const fail = (key: string) => (e: Error) => toast.error(e.message || t(key), { sticky: true });

  const setStage = useMutation({
    // groupId travels with the call so the board can move any card.
    mutationFn: (v: { groupId?: string; stageKey: string | null }) =>
      journeyService.setStage(v.groupId ?? (groupId as string), v.stageKey),
    onSuccess: (_d, v) => {
      refresh(v.groupId ?? groupId);
      toast.success(t('card.stageSaved'));
    },
    onError: fail('card.saveError'),
  });
  const setOwner = useMutation({
    mutationFn: (ownerUserId: string | null) => journeyService.setOwner(groupId as string, ownerUserId),
    onSuccess: () => {
      refresh();
      toast.success(t('card.ownerSaved'));
    },
    onError: fail('card.saveError'),
  });
  const addTask = useMutation({
    mutationFn: (body: Parameters<typeof journeyService.addTask>[1]) =>
      journeyService.addTask(groupId as string, body),
    onSuccess: () => {
      refresh();
      toast.success(t('tasks.added'));
    },
    onError: fail('tasks.saveError'),
  });
  const updateTask = useMutation({
    mutationFn: (v: { id: string; body: Parameters<typeof journeyService.updateTask>[1] }) =>
      journeyService.updateTask(v.id, v.body),
    // A checkbox tick is self-evident on screen; no toast for it (dev-kit §4.3 exemption).
    onSuccess: () => refresh(),
    onError: fail('tasks.saveError'),
  });
  const deleteTask = useMutation({
    mutationFn: (id: string) => journeyService.deleteTask(id),
    onSuccess: () => {
      refresh();
      toast.success(t('tasks.deleted'));
    },
    onError: fail('tasks.saveError'),
  });
  return { setStage, setOwner, addTask, updateTask, deleteTask };
}
