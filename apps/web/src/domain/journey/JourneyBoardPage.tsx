import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, User, Users } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Select } from '@/components/Field';
import { cn } from '@/lib/cn';
import { useJourneyActions, useJourneyBoard, useJourneyPeople } from './journey.hooks';
import { stageLabel } from './journey.service';
import type { JourneyBoardCard } from './journey.service';
import { daysSince } from './JourneyCard';

/** Drop target id for cards that have no stage yet. */
const UNSTAGED = '__none__';

/**
 * Journey board (PLN-261006 P3): every timeline (a person) and project (a
 * client company) as a card under its stage. Dragging a card to another
 * column changes its stage — the same audited call as the card's selector in
 * the group room. A card opens its group room.
 */
export function JourneyBoardPage() {
  const { t, i18n } = useTranslation('journey');
  const { t: tc } = useTranslation('common');
  const navigate = useNavigate();
  const [kind, setKind] = useState('');
  const [owner, setOwner] = useState('');
  const [overdue, setOverdue] = useState(false);
  const { data, isLoading } = useJourneyBoard({ kind: kind || undefined, owner: owner || undefined, overdue });
  const { data: people } = useJourneyPeople();
  const actions = useJourneyActions(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const stages = data?.stages ?? [];
  const cards = data?.cards ?? [];
  const columns = [
    { key: UNSTAGED, label: t('card.noStage'), color: '#CBD5E1' },
    ...stages.map((s) => ({ key: s.key, label: stageLabel(s, i18n.language), color: s.color ?? '#94A3B8' })),
  ];
  const inColumn = (key: string) => cards.filter((c) => (c.stageKey ?? UNSTAGED) === key);

  const drop = (column: string) => {
    const card = cards.find((c) => c.groupId === dragging);
    setDragging(null);
    setOver(null);
    if (!card || (card.stageKey ?? UNSTAGED) === column) return;
    actions.setStage.mutate({ groupId: card.groupId, stageKey: column === UNSTAGED ? null : column });
  };

  return (
    <div>
      <PageHeader title={t('board.title')} subtitle={t('board.subtitle')} />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Select className="w-auto" value={kind} aria-label={t('board.kind')} onChange={(e) => setKind(e.target.value)}>
          <option value="">{t('board.allKinds')}</option>
          <option value="timeline">{t('board.kindTimeline')}</option>
          <option value="project">{t('board.kindProject')}</option>
        </Select>
        <Select className="w-auto" value={owner} aria-label={t('card.owner')} onChange={(e) => setOwner(e.target.value)}>
          <option value="">{t('board.allOwners')}</option>
          {people?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-gray-700">
          <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
          {t('board.overdueOnly')}
        </label>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">{tc('loading')}</p>
      ) : !cards.length && !kind && !owner && !overdue ? (
        <p className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-sm text-gray-500">
          {t('board.empty')}
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {columns.map((col) => {
            const list = inColumn(col.key);
            return (
              <section
                key={col.key}
                aria-label={col.label}
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  setOver(col.key);
                }}
                onDragLeave={() => setOver((v) => (v === col.key ? null : v))}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(col.key);
                }}
                className={cn(
                  'flex w-64 shrink-0 flex-col rounded-lg border bg-gray-50',
                  over === col.key ? 'border-primary-400 bg-primary-50/40' : 'border-gray-200',
                )}
              >
                <header
                  className="flex items-center gap-2 rounded-t-lg border-b border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800"
                  style={{ borderTop: `3px solid ${col.color}` }}
                >
                  <span className="truncate">{col.label}</span>
                  <span className="ml-auto text-xs font-normal text-gray-400">{list.length}</span>
                </header>
                <ul className="min-h-24 flex-1 space-y-2 p-2">
                  {list.map((c) => (
                    <BoardCardItem
                      key={c.groupId}
                      card={c}
                      onOpen={() => navigate(`/live-chat?group=${c.groupId}`)}
                      onDragStart={() => setDragging(c.groupId)}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BoardCardItem({
  card,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  card: JourneyBoardCard;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { t } = useTranslation('journey');
  const days = daysSince(card.stageChangedAt);
  const KindIcon = card.kind === 'project' ? Users : User;
  return (
    <li>
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', card.groupId);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onClick={onOpen}
        className="w-full cursor-grab rounded-md border border-gray-200 bg-white p-2.5 text-left text-sm shadow-sm hover:border-primary-300 active:cursor-grabbing"
      >
        <span className="flex items-center gap-1.5 font-medium text-gray-800">
          <KindIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-label={t(`board.kind_${card.kind}`)} />
          <span className="truncate">{card.title}</span>
        </span>
        <span className="mt-1 block text-[11px] text-gray-500">
          {[
            card.ownerName ?? t('card.noOwner'),
            days != null ? t('board.days', { n: days }) : null,
            t('board.members', { n: card.memberCount }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {(card.openTasks > 0 || card.overdueTasks > 0) && (
          <span
            className={cn(
              'mt-1 flex items-center gap-1 text-[11px]',
              card.overdueTasks ? 'font-medium text-red-600' : 'text-gray-500',
            )}
          >
            {card.overdueTasks > 0 && <AlertTriangle className="h-3 w-3" />}
            {card.overdueTasks > 0
              ? t('board.overdueTasks', { n: card.overdueTasks, open: card.openTasks })
              : t('board.openTasks', { n: card.openTasks })}
          </span>
        )}
      </button>
    </li>
  );
}
