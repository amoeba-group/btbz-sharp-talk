import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardPaste, FileUp, Plus } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Field';
import { Badge } from '@/components/Badge';
import { Pagination } from '@/components/Pagination';
import { Table, type Column } from '@/components/Table';
import { PilotImportModal } from './PilotImportModal';
import { useAddPilotHotel, usePilotHotels, useRemovePilotHotel, useSetPilotHotelActive } from './pilot.hooks';
import type { PilotHotel } from './pilot.service';

const PAGE_SIZE = 20;

/**
 * The hotel list of the pilot allowlist (PLN-261012 SG-40, W4): add one, paste a
 * list, import a CSV, pause / resume, remove. Unlike the switch above it, these act
 * at once — each change is its own audited, toasted action and is live on the next
 * message (the server drops its cache), so there is no draft to hold back.
 */
export function PilotHotelsPanel({ total, disabled }: { total: number; disabled: boolean }) {
  const { t } = useTranslation('settings');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search);
  const { data, isLoading, error } = usePilotHotels({ page, size: PAGE_SIZE, q });
  const add = useAddPilotHotel();
  const setActive = useSetPilotHotelActive();
  const remove = useRemovePilotHotel();

  const [adding, setAdding] = useState(false);
  const [serial, setSerial] = useState('');
  const [note, setNote] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  const submitAdd = () => {
    const hotelSn = serial.trim();
    if (!hotelSn) return;
    add.mutate(
      { hotelSn, note },
      {
        onSuccess: () => {
          setSerial('');
          setNote('');
        },
      },
    );
  };

  const columns: Column<PilotHotel>[] = [
    {
      key: 'serial',
      header: t('pilot.serial'),
      render: (h) => <code className="rounded bg-gray-50 px-1.5 py-0.5 text-sm">{h.hotelSn}</code>,
    },
    { key: 'note', header: t('pilot.note'), render: (h) => <span className="text-sm text-gray-600">{h.note ?? '—'}</span> },
    {
      key: 'status',
      header: t('pilot.status'),
      render: (h) => (
        <button
          type="button"
          disabled={disabled || setActive.isPending}
          aria-pressed={h.active}
          title={h.active ? t('pilot.pause') : t('pilot.resume')}
          onClick={() => setActive.mutate({ hotelSn: h.hotelSn, active: !h.active })}
          className="disabled:opacity-60"
        >
          <Badge tone={h.active ? 'success' : 'gray'}>{h.active ? t('pilot.active') : t('pilot.paused')}</Badge>
        </button>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-24 text-right',
      render: (h) => (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || remove.isPending}
          onClick={() => {
            if (window.confirm(t('pilot.removeConfirm', { serial: h.hotelSn }))) remove.mutate(h.hotelSn);
          }}
        >
          {t('pilot.remove')}
        </Button>
      ),
    },
  ];

  return (
    <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-700">{t('pilot.hotels', { count: total })}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t('pilot.search')}
            aria-label={t('pilot.search')}
            className="w-52"
          />
          <Button variant="secondary" size="sm" disabled={disabled} onClick={() => setAdding((v) => !v)}>
            <Plus className="h-3.5 w-3.5" /> {t('pilot.add')}
          </Button>
          <Button variant="secondary" size="sm" disabled={disabled} onClick={() => setImportOpen(true)}>
            <ClipboardPaste className="h-3.5 w-3.5" /> {t('pilot.paste')}
          </Button>
          <Button variant="secondary" size="sm" disabled={disabled} onClick={() => setImportOpen(true)}>
            <FileUp className="h-3.5 w-3.5" /> {t('pilot.importCsv')}
          </Button>
        </div>
      </div>

      {adding && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-gray-50 p-3">
          <Input
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submitAdd())}
            placeholder={t('pilot.serialPlaceholder')}
            aria-label={t('pilot.serial')}
            maxLength={64}
            className="w-40"
          />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submitAdd())}
            placeholder={t('pilot.notePlaceholder')}
            aria-label={t('pilot.note')}
            maxLength={255}
            className="w-64"
          />
          <Button size="sm" disabled={!serial.trim() || add.isPending} onClick={submitAdd}>
            {t('pilot.add')}
          </Button>
        </div>
      )}

      <Table
        columns={columns}
        data={data?.items}
        loading={isLoading}
        error={error ? (error instanceof Error ? error.message : t('pilot.listError')) : null}
        emptyMessage={q.trim() ? undefined : t('pilot.empty')}
        rowKey={(h) => h.id}
      />
      {(data?.total ?? 0) > PAGE_SIZE && (
        <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPageChange={setPage} />
      )}

      <PilotImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
