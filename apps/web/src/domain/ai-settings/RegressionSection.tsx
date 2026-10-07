import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Play, Plus, Repeat, Trash2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Modal } from '@/components/Modal';
import { Input, Select } from '@/components/Field';
import { toast } from '@/store/toast-store';
import { useTenantKey } from '@/lib/use-tenant-key';
import { goldenService, type Comparison, type GoldenRun } from './golden.service';
import { ComparisonModal } from './ComparisonModal';
import { useAiAgents } from './ai-agents.hooks';

/** "fact1 | fact2" ⇄ ["fact1", "fact2"]. */
const splitFacts = (s: string) =>
  s
    .split('|')
    .map((v) => v.trim())
    .filter(Boolean);

/**
 * Regression set (FR-073). Re-asks a fixed list of questions so a config change
 * can be judged on more than one reply.
 *
 * Wording still renders no verdict — the model rewords every time (TCR-260813
 * §3 O-1). Facts do (PLN-261007 R7): a question that lists what its answer
 * must contain gets pass/fail, the built-in masks (▇▇▇, [PHONE]…) fail any
 * graded answer, and a comparison puts pass → fail regressions first. Runs go
 * in the background (up to 60 questions take minutes) and the list polls.
 */
export function RegressionSection() {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const agents = useAiAgents();
  const [draft, setDraft] = useState('');
  const [draftFacts, setDraftFacts] = useState('');
  const [agentId, setAgentId] = useState('');
  const [editing, setEditing] = useState<{ id: number; facts: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkLang, setBulkLang] = useState('VI');
  const [comparison, setComparison] = useState<Comparison | null>(null);

  const questions = useQuery({
    queryKey: ['golden', tenantKey, 'questions'],
    queryFn: goldenService.listQuestions,
  });
  const runs = useQuery({
    queryKey: ['golden', tenantKey, 'runs'],
    queryFn: goldenService.listRuns,
    // A background run is in progress → keep the list fresh until it closes.
    refetchInterval: (q) => ((q.state.data?.items ?? []).some((r) => r.status === 'running') ? 5000 : false),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['golden', tenantKey] });
  };

  const add = useMutation({
    mutationFn: () => goldenService.addQuestion({ question: draft.trim(), expected: splitFacts(draftFacts) }),
    onSuccess: () => {
      setDraft('');
      setDraftFacts('');
      invalidate();
      toast.success(t('regression.toastAdded'));
    },
    onError: (e: Error) => toast.error(e.message, { sticky: true }),
  });

  const saveFacts = useMutation({
    mutationFn: (v: { id: number; facts: string }) =>
      goldenService.updateQuestion(v.id, { expected: splitFacts(v.facts) }),
    onSuccess: () => {
      setEditing(null);
      invalidate();
      toast.success(t('regression.toastFactsSaved'));
    },
    onError: (e: Error) => toast.error(e.message, { sticky: true }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => goldenService.removeQuestion(id),
    onSuccess: () => {
      invalidate();
      toast.success(t('regression.toastRemoved'));
    },
    onError: (e: Error) => toast.error(e.message, { sticky: true }),
  });

  const bulk = useMutation({
    mutationFn: () => goldenService.bulkImport({ text: bulkText, language: bulkLang }),
    onSuccess: (r) => {
      setBulkOpen(false);
      setBulkText('');
      invalidate();
      toast.success(t('regression.toastBulk', r));
    },
    onError: (e: Error) => toast.error(e.message, { sticky: true }),
  });

  const run = useMutation({
    mutationFn: (kind: 'manual' | 'noise') => goldenService.createRun(kind, agentId ? Number(agentId) : null),
    onSuccess: (r: GoldenRun) => {
      invalidate();
      toast.success(t('regression.toastStarted', { count: r.questionCount }));
    },
    onError: (e: Error) => toast.error(e.message, { sticky: true }),
  });

  const compare = useMutation({
    mutationFn: ({ base, target }: { base: number; target: number }) => goldenService.compare(base, target),
    onSuccess: (c) => setComparison(c),
    onError: (e: Error) => toast.error(e.message, { sticky: true }),
  });

  const items = questions.data?.items ?? [];
  const max = questions.data?.max ?? 60;
  const runList = runs.data?.items ?? [];
  const running = runList.some((r) => r.status === 'running');
  const busy =
    add.isPending || remove.isPending || run.isPending || compare.isPending || bulk.isPending || running;
  const bulkLines = bulkText.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  const agentName = (id: number | null) =>
    id == null ? t('regression.noAgent') : (agents.data?.find((a) => a.id === id)?.name ?? `#${id}`);

  /** A run is comparable against the one before it in the list (newest first). */
  const previousOf = (idx: number) => runList[idx + 1];

  return (
    <Card
      title={t('regression.title')}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            aria-label={t('regression.agent')}
            className="h-8 text-xs"
          >
            <option value="">{t('regression.noAgent')}</option>
            {(agents.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setBulkOpen(true)}>
            <Upload className="h-4 w-4" /> {t('regression.bulk')}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => run.mutate('noise')}>
            <Repeat className="h-4 w-4" /> {t('regression.measureVariance')}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => run.mutate('manual')}>
            <Play className="h-4 w-4" /> {t('regression.runNow')}
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-xs text-gray-400">{t('regression.hint')}</p>

      {questions.isLoading && <p className="text-sm text-gray-400">{tc('loading')}</p>}

      {!questions.isLoading && items.length === 0 && (
        <p className="mb-3 text-sm text-gray-400">{t('regression.empty')}</p>
      )}

      <div className="space-y-1.5">
        {items.map((q) => (
          <div key={q.id} className="rounded-lg border border-gray-200 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate text-sm text-gray-800" title={q.question}>
                {q.question}
              </span>
              <Badge tone="gray">{q.language}</Badge>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing({ id: q.id, facts: q.expected.join(' | ') })}
                className="rounded p-1 text-gray-400 hover:text-primary-600 disabled:opacity-50"
                aria-label={t('regression.editFacts')}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => remove.mutate(q.id)}
                className="rounded p-1 text-gray-400 hover:text-error disabled:opacity-50"
                aria-label={t('regression.remove')}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {editing?.id === q.id ? (
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  value={editing.facts}
                  placeholder={t('regression.factsPlaceholder')}
                  onChange={(e) => setEditing({ id: q.id, facts: e.target.value })}
                  className="text-xs"
                />
                <Button size="sm" disabled={saveFacts.isPending} onClick={() => saveFacts.mutate(editing)}>
                  <Check className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-gray-500">
                {q.expected.length ? (
                  <>
                    <span className="text-gray-400">{t('regression.expected')}: </span>
                    {q.expected.join(' · ')}
                  </>
                ) : (
                  <span className="text-gray-400">{t('regression.notGraded')}</span>
                )}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          value={draft}
          disabled={busy || items.length >= max}
          placeholder={t('regression.addPlaceholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && draft.trim()) add.mutate();
          }}
          className="min-w-0 flex-[2]"
        />
        <Input
          value={draftFacts}
          disabled={busy || items.length >= max}
          placeholder={t('regression.factsPlaceholder')}
          onChange={(e) => setDraftFacts(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Button size="sm" disabled={busy || !draft.trim() || items.length >= max} onClick={() => add.mutate()}>
          <Plus className="h-4 w-4" />
        </Button>
        <span className="whitespace-nowrap text-xs text-gray-400">
          {items.length} / {max}
        </span>
      </div>

      {runList.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold text-gray-500">{t('regression.recentRuns')}</p>
          <div className="space-y-1">
            {runList.map((r, idx) => {
              const prev = previousOf(idx);
              const graded = r.passCount + r.failCount;
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                  <Badge tone={r.kind === 'after' ? 'success' : r.kind === 'noise' ? 'warning' : 'gray'}>
                    {t(`regression.kind_${r.kind}`)}
                  </Badge>
                  <span className="text-gray-400">{new Date(r.createdAt).toLocaleString()}</span>
                  <span>{agentName(r.aiAgentId)}</span>
                  <span>{t('regression.itemCount', { count: r.questionCount })}</span>
                  {r.status === 'running' ? (
                    <Badge tone="info">{t('regression.running')}</Badge>
                  ) : graded > 0 ? (
                    <span>
                      <span className="text-green-700">✓ {r.passCount}</span>
                      {' · '}
                      <span className={r.failCount ? 'font-semibold text-red-700' : ''}>✗ {r.failCount}</span>
                      {r.questionCount > graded ? ` · — ${r.questionCount - graded}` : ''}
                    </span>
                  ) : null}
                  {r.truncated && <Badge tone="warning">{t('regression.truncated')}</Badge>}
                  {prev && r.status !== 'running' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => compare.mutate({ base: prev.id, target: r.id })}
                      className="ml-auto text-primary-600 hover:underline disabled:opacity-50"
                    >
                      {t('regression.compareWithPrevious')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={t('regression.bulkTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button disabled={!bulkLines.length || bulk.isPending} onClick={() => bulk.mutate()}>
              {bulk.isPending ? tc('loading') : t('regression.bulkSubmit')}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            {t('regression.language')}
            <Select value={bulkLang} onChange={(e) => setBulkLang(e.target.value)} className="w-24">
              {['VI', 'EN', 'KO', 'JA', 'ZH', 'ES'].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </label>
          <textarea
            className="h-56 w-full rounded-lg border border-gray-300 p-2 font-mono text-xs"
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={t('regression.bulkPlaceholder')}
            aria-label={t('regression.bulkTitle')}
          />
          <p className="text-xs text-gray-500">{t('regression.bulkHint', { count: bulkLines.length, max })}</p>
        </div>
      </Modal>

      <ComparisonModal comparison={comparison} onClose={() => setComparison(null)} />
    </Card>
  );
}
