import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usersService } from './users.service';
import type { InviteUserBody, UpdateUserBody, UserListFilter } from './users.service';
import { toast } from '@/store/toast-store';
import { useTenantKey } from '@/lib/use-tenant-key';

/** Tenant users; optional role/region filter (PLN-261007). Unfiltered callers keep the old key. */
export const useUsers = (filter?: UserListFilter) => {
  const tenantKey = useTenantKey();
  const active = filter && (filter.label || filter.region) ? filter : undefined;
  return useQuery({
    queryKey: active ? ['users', tenantKey, active] : ['users', tenantKey],
    queryFn: () => usersService.list(active),
  });
};

export const useJobLabels = () => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['job-labels', tenantKey],
    queryFn: () => usersService.jobLabels(),
  });
};

export function useInviteUser() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (body: InviteUserBody) => usersService.invite(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users', tenantKey] });
      toast.success('User invited.');
    },
    onError: (e: Error) => {
      toast.error(e.message || 'Failed to invite user.');
    },
  });
}

export function useIssueTempPassword() {
  return useMutation({
    mutationFn: ({ id, sendEmail }: { id: string; sendEmail: boolean }) =>
      usersService.issueTempPassword(id, sendEmail),
    onError: (e: Error) => {
      toast.error(e.message || 'Failed to issue temporary password.');
    },
  });
}

export function useResetUserMfa() {
  return useMutation({
    mutationFn: (id: string) => usersService.resetMfa(id),
    onError: (e: Error) => {
      toast.error(e.message || 'Failed to reset MFA.', { sticky: true });
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserBody }) =>
      usersService.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users', tenantKey] });
      toast.success('User updated.');
    },
    onError: (e: Error) => {
      toast.error(e.message || 'Failed to update user.');
    },
  });
}
