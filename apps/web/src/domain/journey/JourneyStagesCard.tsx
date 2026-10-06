import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input } from '@/components/Field';
import { useJourneyStages, useSaveJourneyStages } from './journey.hooks';

interface Draft {
  key: string;
  label: Record<string, string>;
  color: string;
}

/**
 * Journey stages (PLN-261006 P3) — the board's columns. Starts as Kotler's
 * 5A; a hotel partner desk or a B2B help desk renames, reorders or replaces
 * them. The name is edited in the console language (other languages keep
 * theirs); `key` is fixed once saved, so renaming never moves a journey.
 * Removing a stage that still holds journeys is refused by the API.
 */
export function JourneyStagesCard() {
  const { t, i18n } = useTranslation('journey');
  const { t: tc } = useTranslation('common');
  const { data } = useJourneyStages();
  const save = useSaveJourneyStages();
  const lang = i18n.language.slice(0, 2).toUpperCase();
  const [draft, setDraft] = useState<Draft[] | null>(null);

  useEffect(() => {
    if (data && !draft) {
      setDraft(data.map((s) => ({ key: s.key, label: { ...s.label }, color: s.color ?? '#94A3B8' })));
    }
  }, [data, draft]);

  if (!draft) return null;
  const saved = new Set((data ?? []).map((s) => s.key));

  const update = (i: number, patch: Partial<Draft>) =>
    setDraft((d) => d!.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) =>
    setDraft((d) => {
      const next = [...d!];
      const [row] = next.splice(i, 1);
      next.splice(i + by, 0, row);
      return next;
    });
  const nameOf = (s: Draft) => s.label[lang] ?? s.label.EN ?? '';
  const keyOk = (k: string) => /^[a-z0-9_-]{1,32}$/.test(k);
  const valid =
    draft.length > 0 &&
    draft.length <= 12 &&
    draft.every((s) => keyOk(s.key) && nameOf(s).trim()) &&
    new Set(draft.map((s) => s.key)).size === draft.length;

  return (
    <Card title={t('stages.title')}>
      <p className="mb-3 text-sm text-gray-500">{t('stages.desc')}</p>
      <ul className="space-y-2">
        {draft.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <input
              type="color"
              value={s.color}
              aria-label={t('stages.color')}
              onChange={(e) => update(i, { color: e.target.value })}
              className="h-8 w-8 shrink-0 cursor-pointer rounded border border-gray-200"
            />
            <Input
              value={nameOf(s)}
              maxLength={40}
              aria-label={t('stages.name')}
              onChange={(e) => update(i, { label: { ...s.label, [lang]: e.target.value } })}
            />
            <Input
              value={s.key}
              maxLength={32}
              disabled={saved.has(s.key)}
              aria-label={t('stages.key')}
              title={t('stages.keyHint')}
              onChange={(e) => update(i, { key: e.target.value.toLowerCase() })}
              className="w-28 font-mono text-xs"
            />
            <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('stages.up')} className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30">
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button type="button" disabled={i === draft.length - 1} onClick={() => move(i, 1)} aria-label={t('stages.down')} className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30">
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={draft.length <= 1}
              onClick={() => setDraft((d) => d!.filter((_, j) => j !== i))}
              aria-label={t('stages.remove')}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500 disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={draft.length >= 12}
          onClick={() => setDraft((d) => [...d!, { key: `stage-${d!.length + 1}`, label: { [lang]: '' }, color: '#94A3B8' }])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('stages.add')}
        </Button>
        <Button
          size="sm"
          className="ml-auto"
          disabled={!valid || save.isPending}
          onClick={() =>
            save.mutate(
              draft.map((s) => ({ key: s.key, label: s.label, color: s.color })),
              // Take the server's list: keys are normalized there.
              {
                onSuccess: (rows) =>
                  setDraft(rows.map((r) => ({ key: r.key, label: { ...r.label }, color: r.color ?? '#94A3B8' }))),
              },
            )
          }
        >
          {save.isPending ? tc('saving') : tc('save')}
        </Button>
      </div>
      <p className="mt-2 text-xs text-gray-400">{t('stages.inUseHint')}</p>
    </Card>
  );
}
