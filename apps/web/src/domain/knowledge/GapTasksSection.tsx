import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { toast } from '@/store/toast-store';
import { useTenantKey } from '@/lib/use-tenant-key';
import { apiGet, apiPost } from '@/lib/api-client';

interface GapTask {
  id: string;
  source: string; // escalation_cluster | no_source | agent_resolution | answer_rating
  title: string;
  detail: string | null;
  metric: Record<string, unknown>;
  status: string;
  createdAt: string;
}

const gapService = {
  list: () => apiGet<{ tasks: GapTask[] }>('/knowledge/gap-tasks'),
  accept: (id: string, title: string, content: string) =>
    apiPost<{ documentId: string }>(`/knowledge/gap-tasks/${id}/accept`, { title, content }),
  dismiss: (id: string) => apiPost(`/knowledge/gap-tasks/${id}/dismiss`, {}),
};

function sourceTone(source: string) {
  if (source === 'agent_resolution') return 'success' as const;
  if (source === 'no_source') return 'warning' as const;
  if (source === 'answer_rating') return 'info' as const;
  return 'error' as const; // escalation_cluster
}

function metricLine(task: GapTask): string {
  const m = task.metric as { asked?: number; escalated?: number; noSource?: number; issueNo?: number };
  const parts: string[] = [];
  if (m.asked != null) parts.push(`asked ${m.asked}`);
  if (m.escalated != null) parts.push(`escalated ${m.escalated}`);
  if (m.noSource != null) parts.push(`no-source ${m.noSource}`);
  if (m.issueNo != null) parts.push(`issue #${m.issueNo}`);
  return parts.join(' · ');
}

/**
 * Knowledge-gap proposal inbox (PLN-260809-Issue-Workflow-P5, 결정 9): batch
 * analytics and agent resolutions propose; a human edits then accepts (→
 * existing KB create+embed pipeline) or dismisses. Nothing is auto-applied.
 */
export function GapTasksSection() {
  const { t } = useTranslation('knowledge');
  const { t: tc } = useTranslation('common');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();

  const { data, isLoading } = useQuery({
    queryKey: ['gap-tasks', tenantKey],
    queryFn: () => gapService.list(),
  });
  const tasks = data?.tasks ?? [];
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['gap-tasks', tenantKey] });
    // Accepting creates a document — refresh the corpus views too.
    qc.invalidateQueries({ queryKey: ['kb-documents'] });
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const accept = useMutation({
    mutationFn: (v: { id: string; title: string; content: string }) =>
      gapService.accept(v.id, v.title, v.content),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      toast.success(t('gap.accepted'));
    },
    onError: (e: Error) => toast.error(e.message || t('gap.actionError'), { sticky: true }),
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => gapService.dismiss(id),
    onSuccess: () => {
      invalidate();
      toast.success(t('gap.dismissed'));
    },
    onError: (e: Error) => toast.error(e.message || t('gap.actionError'), { sticky: true }),
  });

  if (!isLoading && tasks.length === 0) return null; // quiet when the inbox is empty

  return (
    <Card title={`${t('gap.title')} (${tasks.length})`}>
      <p className="mb-3 text-sm text-gray-500">{t('gap.desc')}</p>
      <div className="space-y-2">
        {tasks.map((task) => (
          <div key={task.id} className="rounded-lg border border-gray-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={sourceTone(task.source)}>{t(`gap.source.${task.source}`)}</Badge>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
                {task.title}
              </span>
              <span className="text-xs text-gray-400">{metricLine(task)}</span>
              {editingId !== task.id && (
                <>
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingId(task.id);
                      setTitle(task.title);
                      setContent(task.detail ?? '');
                    }}
                  >
                    {t('gap.accept')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={dismiss.isPending}
                    onClick={() => dismiss.mutate(task.id)}
                  >
                    {t('gap.dismiss')}
                  </Button>
                </>
              )}
            </div>
            {task.detail && editingId !== task.id && (
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-gray-500">
                {task.detail}
              </p>
            )}
            {editingId === task.id && (
              <div className="mt-2 space-y-2">
                <input
                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                  value={title}
                  maxLength={300}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('gap.titlePlaceholder')}
                />
                <textarea
                  className="w-full rounded-lg border border-gray-200 p-2 text-sm"
                  rows={4}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={t('gap.contentPlaceholder')}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={accept.isPending || !title.trim() || !content.trim()}
                    onClick={() => accept.mutate({ id: task.id, title, content })}
                  >
                    {t('gap.acceptConfirm')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>
                    {tc('cancel')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
