import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { aiAgentsService } from './ai-agents.service';
import type { GuestPolicy } from './ai-agents.service';
import { toast } from '@/store/toast-store';
import { useTenantKey } from '@/lib/use-tenant-key';

export const useAiAgents = () => {
  const tenantKey = useTenantKey();
  return useQuery({ queryKey: ['ai-agents', tenantKey], queryFn: aiAgentsService.list });
};

/** Invalidate the list plus /ai-config — the default agent backs both views. */
function useAgentInvalidate() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return () => {
    void qc.invalidateQueries({ queryKey: ['ai-agents', tenantKey] });
    void qc.invalidateQueries({ queryKey: ['ai-config', tenantKey] });
  };
}

export function useCreateAiAgent() {
  const { t } = useTranslation('aiSetting');
  const invalidate = useAgentInvalidate();
  return useMutation({
    mutationFn: aiAgentsService.create,
    onSuccess: () => {
      invalidate();
      toast.success(t('agents.created'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateAiAgent() {
  const { t } = useTranslation('aiSetting');
  const invalidate = useAgentInvalidate();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      name?: string;
      active?: boolean;
      display_name?: string;
      greeting?: Record<string, string>;
      guest_policy?: GuestPolicy;
    }) => aiAgentsService.update(id, body),
    onSuccess: () => {
      invalidate();
      toast.success(t('agents.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteAiAgent() {
  const { t } = useTranslation('aiSetting');
  const invalidate = useAgentInvalidate();
  return useMutation({
    mutationFn: aiAgentsService.remove,
    onSuccess: () => {
      invalidate();
      toast.success(t('agents.deleted'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSetDefaultAiAgent() {
  const { t } = useTranslation('aiSetting');
  const invalidate = useAgentInvalidate();
  return useMutation({
    mutationFn: aiAgentsService.setDefault,
    onSuccess: () => {
      invalidate();
      toast.success(t('agents.defaultSet'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
