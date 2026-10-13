import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { aiSettingsService, type AiFunction } from './ai-settings.service';
import { toast } from '@/store/toast-store';
import { useTenantKey } from '@/lib/use-tenant-key';
// Source deep-import: the package entry point is CJS and fails the browser build for values.
import { errorDetailText } from '../../../../../packages/types/src/common/error-detail';

export const useAiSettings = () => {
  const tenantKey = useTenantKey();
  return useQuery({ queryKey: ['ai-settings', tenantKey], queryFn: aiSettingsService.list });
};

export function useUpdateAiSetting() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: ({
      fn,
      engineId,
      params,
    }: {
      fn: AiFunction;
      engineId: string;
      params?: Record<string, unknown>;
    }) => aiSettingsService.update(fn, { engine_id: engineId, params }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-settings', tenantKey] });
      toast.success('AI setting updated.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export const useAiConfig = () => {
  const tenantKey = useTenantKey();
  return useQuery({ queryKey: ['ai-config', tenantKey], queryFn: aiSettingsService.getConfig });
};

/**
 * The shipped copy behind every scenario. Static per deploy, so it is cached
 * for the session rather than refetched beside the tenant's own config.
 */
export const useAiConfigDefaults = () => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['ai-config-defaults', tenantKey],
    queryFn: aiSettingsService.getDefaults,
    staleTime: Infinity,
  });
};

export function useUpdateAiConfig() {
  const { t } = useTranslation('aiSetting');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: aiSettingsService.updateConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-config', tenantKey] });
      // Persona/rules live on the agent rows now — keep the agent bar in sync.
      qc.invalidateQueries({ queryKey: ['ai-agents', tenantKey] });
      toast.success('AI configuration saved.');
    },
    // The server says WHICH row it refused (PLN-261012 SG-65): a region table or hand-off setting
    // that fails validation used to show only the generic code message. Error toasts stay until
    // dismissed (feedback rule), so the detail can actually be read.
    onError: (e: Error & { code?: string; details?: Record<string, string[]> }) => {
      const detail = errorDetailText(e.details);
      const message = !detail
        ? e.message
        : e.code === 'E5095'
          ? t('handoff.regionInvalid', { detail })
          : e.code === 'E5128'
            ? t('handoff.configInvalid', { detail })
            : `${e.message}: ${detail}`;
      toast.error(message, { sticky: true });
    },
  });
}

export const useModerationRules = () => {
  const tenantKey = useTenantKey();
  return useQuery({ queryKey: ['moderation', tenantKey, 'rules'], queryFn: aiSettingsService.rules });
};

export function useCreateRule() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: aiSettingsService.createRule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['moderation', tenantKey, 'rules'] });
      toast.success('Rule added.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (id: string) => aiSettingsService.deleteRule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['moderation', tenantKey, 'rules'] });
      toast.success('Rule deleted.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
