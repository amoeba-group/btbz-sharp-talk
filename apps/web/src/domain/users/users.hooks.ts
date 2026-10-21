import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usersService } from './users.service';
import type { InviteUserBody, OrgItemBody, UpdateUserBody } from './users.service';
import { toast } from '@/store/toast-store';
import { useTenantKey } from '@/lib/use-tenant-key';

export const useUsers = () => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['users', tenantKey],
    queryFn: () => usersService.list(),
  });
};

export const useJobLabels = () => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['job-labels', tenantKey],
    queryFn: () => usersService.jobLabels(),
  });
};

export const useUnits = () => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['units', tenantKey],
    queryFn: () => usersService.units(),
  });
};

/**
 * Label / unit create + rename (PLN-261019 P2). Toasts are the caller's: the
 * modal knows which row it was saving, so the message can name it.
 */
export function useOrgMutations() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['job-labels', tenantKey] });
    qc.invalidateQueries({ queryKey: ['units', tenantKey] });
    qc.invalidateQueries({ queryKey: ['users', tenantKey] });
  };
  const createLabel = useMutation({ mutationFn: (b: OrgItemBody) => usersService.createJobLabel(b), onSuccess: refresh });
  const renameLabel = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => usersService.renameJobLabel(id, name),
    onSuccess: refresh,
  });
  const createUnit = useMutation({ mutationFn: (b: OrgItemBody) => usersService.createUnit(b), onSuccess: refresh });
  const renameUnit = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => usersService.renameUnit(id, name),
    onSuccess: refresh,
  });
  const deleteLabel = useMutation({ mutationFn: (id: string) => usersService.deleteJobLabel(id), onSuccess: refresh });
  const deleteUnit = useMutation({ mutationFn: (id: string) => usersService.deleteUnit(id), onSuccess: refresh });
  return { createLabel, renameLabel, createUnit, renameUnit, deleteLabel, deleteUnit };
}

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
