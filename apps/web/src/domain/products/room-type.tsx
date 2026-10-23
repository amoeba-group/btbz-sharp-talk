import { useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Pencil, X } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Input } from '@/components/Field';
import { toast } from '@/store/toast-store';
import { useUpdateRoomCount } from './products.hooks';

const VND = new Intl.NumberFormat('vi-VN');

/** `60.000đ`; anything that is not a number reads as `—`. */
export function fmtVnd(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${VND.format(value)}đ` : '—';
}

/** HA room-type status: 1 selling, 4 rejected, 5 stopped selling, anything else by code. */
export function HaStatusBadge({ code }: { code: number | null | undefined }) {
  const { t } = useTranslation('products');
  if (code === 1) return <Badge tone="success">{t('ha.status.selling')}</Badge>;
  if (code === 4) return <Badge tone="error">{t('ha.status.rejected')}</Badge>;
  if (code === 5) return <Badge tone="gray">{t('ha.status.stopped')}</Badge>;
  if (code == null) return <span className="text-gray-300">—</span>;
  return <Badge tone="warning">{t('ha.status.other', { code })}</Badge>;
}

const MAX_ROOMS = 100000;

/**
 * Room count with an inline editor (pencil → number → save/cancel).
 *
 * Lives inside a clickable table row, so every interaction stops propagation —
 * otherwise opening the editor would also open the detail dialog.
 */
export function RoomCountEditor({ handle, value }: { handle: string; value: number | null }) {
  const { t } = useTranslation('products');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const update = useUpdateRoomCount();

  const stop = (e: MouseEvent) => e.stopPropagation();

  const open = (e: MouseEvent) => {
    e.stopPropagation();
    setDraft(value == null ? '' : String(value));
    setEditing(true);
  };

  const save = () => {
    const raw = draft.trim();
    const next = raw === '' ? null : Number(raw);
    if (next !== null && (!Number.isInteger(next) || next < 0 || next > MAX_ROOMS)) {
      toast.error(t('ha.roomCount.invalid', { max: MAX_ROOMS.toLocaleString() }));
      return;
    }
    update.mutate(
      { handle, roomCount: next },
      {
        onSuccess: () => {
          toast.success(t('ha.roomCount.saved'));
          setEditing(false);
        },
        onError: (e) => toast.error((e as Error).message || t('ha.roomCount.failed')),
      },
    );
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') setEditing(false);
  };

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="tabular-nums">{value ?? '—'}</span>
        <button
          type="button"
          onClick={open}
          className="text-gray-400 hover:text-primary-600"
          aria-label={t('ha.roomCount.edit')}
          title={t('ha.roomCount.edit')}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1" onClick={stop}>
      <span className="w-20">
        <Input
          type="number"
          min={0}
          max={MAX_ROOMS}
          step={1}
          value={draft}
          autoFocus
          disabled={update.isPending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          className="px-2 py-1"
          aria-label={t('ha.roomCount.label')}
        />
      </span>
      <button
        type="button"
        onClick={save}
        disabled={update.isPending}
        className="text-success hover:opacity-80 disabled:opacity-50"
        aria-label={t('ha.roomCount.save')}
        title={t('ha.roomCount.save')}
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        disabled={update.isPending}
        className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
        aria-label={t('ha.roomCount.cancel')}
        title={t('ha.roomCount.cancel')}
      >
        <X className="h-4 w-4" />
      </button>
    </span>
  );
}
