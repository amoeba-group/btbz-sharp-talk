import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { usersService } from './users.service';
import type { InviteUserBody, JobLabel, UpdateUserBody, UserListFilter } from './users.service';
import { localizeJobLabels } from './job-label-name';
import { toast } from '@/store/toast-store';
import { useAuthStore } from '@/store/auth-store';
import { useTenantKey } from '@/lib/use-tenant-key';

/** Ranks that may list tenant users (`GET /users` is `@RequireRank(MASTER, DIRECTOR, MANAGER)`). */
const USER_LIST_RANKS: readonly string[] = ['master', 'director', 'manager'];

/**
 * Tenant users; optional role/region filter (PLN-261007). Unfiltered callers keep the old key.
 * `refetchMs` keeps a screen that shows live presence (PLN-261012 SG-60) fresh.
 * The query stays idle for a rank that may not list users (w3c, ops-manual finding 15): `GET /users`
 * is manager-and-above, and a staff member's Live Chat, issue panel and history used to fire it
 * anyway and collect a silent 403 on every page load. `enabled` overrides that default.
 */
export const useUsers = (filter?: UserListFilter, opts?: { refetchMs?: number; enabled?: boolean }) => {
  const tenantKey = useTenantKey();
  const rank = useAuthStore((s) => s.principal?.rank);
  const rankMayList = !!rank && USER_LIST_RANKS.includes(rank);
  const active = filter && (filter.label || filter.region) ? filter : undefined;
  return useQuery({
    queryKey: active ? ['users', tenantKey, active] : ['users', tenantKey],
    queryFn: () => usersService.list(active),
    refetchInterval: opts?.refetchMs,
    enabled: opts?.enabled ?? rankMayList,
  });
};

/**
 * The tenant's role labels, named for the console language (w3c, ops-manual finding 1): a label
 * that still has its built-in name reads in the console's language, a renamed one as typed. The
 * stored name stays on `storedName` for the rename dialog.
 */
export const useJobLabels = () => {
  const tenantKey = useTenantKey();
  const { t } = useTranslation('users');
  // `t` changes with the language, so the select re-runs and the names follow a language switch.
  const select = useCallback(
    (rows: JobLabel[]) =>
      localizeJobLabels(rows, (code) => {
        const v = t(`roleNames.${code}`, { defaultValue: '' });
        return v || undefined;
      }),
    [t],
  );
  return useQuery({
    queryKey: ['job-labels', tenantKey],
    queryFn: () => usersService.jobLabels(),
    select,
    // GET /job-labels follows the Users menu grant; a screen that only wants nicer names falls back
    // to its static ones instead of hammering a 403.
    retry: false,
  });
};

/** Error text for the calls that name a user or a role: known codes get their own line. */
function useUserErrorText() {
  const { t } = useTranslation('users');
  return (e: Error & { code?: string }, fallbackKey: string): string =>
    e.code === 'E5004'
      ? t('roleNames.errorDuplicate')
      : e.code === 'E5003'
        ? t('roleNames.errorBlank')
        : e.message || t(fallbackKey);
}

export function useInviteUser() {
  const { t } = useTranslation('users');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (body: InviteUserBody) => usersService.invite(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users', tenantKey] });
      toast.success(t('invited'));
    },
    onError: (e: Error) => {
      toast.error(e.message || t('inviteError'), { sticky: true });
    },
  });
}

export function useIssueTempPassword() {
  const { t } = useTranslation('users');
  return useMutation({
    mutationFn: ({ id, sendEmail }: { id: string; sendEmail: boolean }) =>
      usersService.issueTempPassword(id, sendEmail),
    onError: (e: Error) => {
      toast.error(e.message || t('tempPwError'), { sticky: true });
    },
  });
}

export function useResetUserMfa() {
  const { t } = useTranslation('users');
  return useMutation({
    mutationFn: (id: string) => usersService.resetMfa(id),
    onError: (e: Error) => {
      toast.error(e.message || t('mfaResetError'), { sticky: true });
    },
  });
}

export function useUpdateUser() {
  const { t } = useTranslation('users');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserBody }) =>
      usersService.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users', tenantKey] });
      toast.success(t('updated'));
    },
    onError: (e: Error) => {
      toast.error(e.message || t('updateError'), { sticky: true });
    },
  });
}

/**
 * Rename role labels in one go (w3c, ops-manual finding 1). One PATCH per changed label, in order;
 * the first refusal stops the run and is reported (a name another role already has, a blank name),
 * and whatever was already saved stays saved. Both lists are re-read either way, so the dialog and
 * the Users table never show a half-old state.
 */
export function useRenameJobLabels() {
  const { t } = useTranslation('users');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const errorText = useUserErrorText();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['job-labels', tenantKey] });
    qc.invalidateQueries({ queryKey: ['users', tenantKey] });
  };
  return useMutation({
    mutationFn: async (changes: Array<{ id: string | number; name: string }>) => {
      for (const c of changes) await usersService.renameJobLabel(c.id, c.name);
      return changes.length;
    },
    onSuccess: () => {
      refresh();
      toast.success(t('roleNames.saved'));
    },
    onError: (e: Error & { code?: string }) => {
      refresh();
      toast.error(errorText(e, 'roleNames.saveError'), { sticky: true });
    },
  });
}
