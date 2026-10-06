import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Field';
import { cn } from '@/lib/cn';
import {
  useJourneyActions,
  useJourneyCard,
  useJourneyHistory,
  useJourneyPeople,
  useJourneyStages,
} from './journey.hooks';
import { stageLabel } from './journey.service';
import { JourneyTimeline } from './JourneyTimeline';

/** Whole days since an ISO time — the board's and the card's "in stage for". */
export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Journey card in the group room (PLN-261006 P2): where this person or client
 * company stands, who looks after it, and what happens next. Everything here
 * is an operator's decision — the analysis report below only suggests.
 */
export function JourneyCard({ groupId }: { groupId: string }) {
  const { t, i18n } = useTranslation('journey');
  const { t: tc } = useTranslation('common');
  const { data: stages } = useJourneyStages();
  const { data: people } = useJourneyPeople();
  const { data: card, isLoading } = useJourneyCard(groupId);
  const actions = useJourneyActions(groupId);

  const [showHistory, setShowHistory] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState('');
  const history = useJourneyHistory(groupId, showHistory);

  const stageName = (key: string | null) =>
    key ? stageLabel(stages?.find((s) => s.key === key), i18n.language) || key : t('card.noStage');
  const inStage = daysSince(card?.stageChangedAt ?? null);
  const openTasks = (card?.tasks ?? []).filter((x) => !x.done);
  const doneTasks = (card?.tasks ?? []).filter((x) => x.done);

  const add = () => {
    if (!title.trim()) return;
    actions.addTask.mutate(
      {
        title: title.trim(),
        ...(due ? { due_at: due } : {}),
        ...(assignee ? { assignee_user_id: Number(assignee) } : {}),
      },
      {
        onSuccess: () => {
          setTitle('');
          setDue('');
          setAssignee('');
        },
      },
    );
  };

  return (
    <Card title={t('card.title')}>
      {isLoading ? (
        <p className="text-sm text-gray-500">{tc('loading')}</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-[3.5rem_1fr] items-center gap-2">
            <label htmlFor={`jstage-${groupId}`} className="text-xs text-gray-500">
              {t('card.stage')}
            </label>
            <Select
              id={`jstage-${groupId}`}
              value={card?.stageKey ?? ''}
              disabled={actions.setStage.isPending}
              onChange={(e) => actions.setStage.mutate({ stageKey: e.target.value || null })}
            >
              <option value="">{t('card.noStage')}</option>
              {stages?.map((s) => (
                <option key={s.key} value={s.key}>
                  {stageLabel(s, i18n.language)}
                </option>
              ))}
            </Select>
            <label htmlFor={`jowner-${groupId}`} className="text-xs text-gray-500">
              {t('card.owner')}
            </label>
            <Select
              id={`jowner-${groupId}`}
              value={card?.ownerUserId ?? ''}
              disabled={actions.setOwner.isPending}
              onChange={(e) => actions.setOwner.mutate(e.target.value || null)}
            >
              <option value="">{t('card.noOwner')}</option>
              {people?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          {card?.stageKey && (
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
            >
              {showHistory ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {t('card.inStage', { stage: stageName(card.stageKey), days: inStage ?? 0 })}
              <span className="text-primary-600">· {t('card.history')}</span>
            </button>
          )}
          {showHistory && (
            <ul className="space-y-1 rounded-md bg-gray-50 p-2 text-xs text-gray-600">
              {(history.data ?? []).map((h, i) => (
                <li key={i}>
                  {new Date(h.at).toLocaleDateString(i18n.language)} · {stageName(h.from)} → {stageName(h.to)}
                  {h.actorName ? ` · ${h.actorName}` : ''}
                </li>
              ))}
              {!history.isLoading && !(history.data ?? []).length && <li>{t('card.noHistory')}</li>}
            </ul>
          )}

          <div className="border-t border-gray-100 pt-3">
            <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">{t('tasks.title')}</h4>
            <ul className="space-y-1">
              {[...openTasks, ...doneTasks].map((task) => {
                const overdue = !task.done && !!task.dueAt && task.dueAt < today();
                return (
                  <li key={task.id} className="group flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={task.done}
                      aria-label={task.title}
                      onChange={(e) => actions.updateTask.mutate({ id: task.id, body: { done: e.target.checked } })}
                    />
                    <span className={cn('min-w-0 flex-1', task.done && 'text-gray-400 line-through')}>
                      <span className="block break-words">{task.title}</span>
                      <span className={cn('text-[11px]', overdue ? 'font-medium text-red-600' : 'text-gray-400')}>
                        {[task.dueAt, task.assigneeName, task.source === 'report' ? t('tasks.fromReport') : null]
                          .filter(Boolean)
                          .join(' · ')}
                        {overdue ? ` · ${t('tasks.overdue')}` : ''}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => actions.deleteTask.mutate(task.id)}
                      aria-label={t('tasks.delete')}
                      title={t('tasks.delete')}
                      className="rounded p-0.5 text-gray-300 opacity-0 hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
              {!card?.tasks.length && <li className="text-xs text-gray-400">{t('tasks.empty')}</li>}
            </ul>

            <div className="mt-2 space-y-1.5">
              <Input
                value={title}
                maxLength={300}
                placeholder={t('tasks.placeholder')}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) add();
                }}
              />
              <div className="flex gap-1.5">
                <Input type="date" value={due} aria-label={t('tasks.due')} onChange={(e) => setDue(e.target.value)} />
                <Select value={assignee} aria-label={t('tasks.assignee')} onChange={(e) => setAssignee(e.target.value)}>
                  <option value="">{t('tasks.noAssignee')}</option>
                  {people?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Button size="sm" disabled={!title.trim() || actions.addTask.isPending} onClick={add}>
                  {t('tasks.add')}
                </Button>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-2">
            <button
              type="button"
              onClick={() => setShowTimeline((v) => !v)}
              className="flex items-center gap-1 text-xs font-semibold uppercase text-gray-500 hover:text-gray-700"
            >
              {showTimeline ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {t('timeline.title')}
            </button>
            {showTimeline && <JourneyTimeline groupId={groupId} />}
          </div>
        </div>
      )}
    </Card>
  );
}
