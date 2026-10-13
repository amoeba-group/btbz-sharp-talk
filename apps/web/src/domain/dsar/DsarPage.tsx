import { useState } from 'react';
import { AlertTriangle, Download, Search, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { FormRow, Input, Select } from '@/components/Field';
import { Table, type Column } from '@/components/Table';
import { useDsarErase, useDsarExport, useDsarLookup } from './dsar.hooks';
import type { DsarCustomerRow, DsarLookupBy } from './dsar.service';

/**
 * Operator-side data-subject requests (PLN-261012 SG-70, settings tab, master and
 * director). Until now only a Shopify-verified shopper could export or erase their
 * own data; this lets an operator do it for someone who asked by email or phone.
 *
 * Verifying that the requester is who they claim to be is a PROCEDURE, not
 * something this screen can do — the notice below says so, and the PDPL checklist
 * describes it. Everything here is audited server-side.
 */
export function DsarPage() {
  const { t } = useTranslation('dsar');
  const { t: tc } = useTranslation('common');

  const [by, setBy] = useState<DsarLookupBy>('email');
  const [term, setTerm] = useState('');
  const [reference, setReference] = useState('');
  const [erasing, setErasing] = useState<DsarCustomerRow | null>(null);
  const [typedId, setTypedId] = useState('');

  const lookup = useDsarLookup();
  const exporter = useDsarExport();
  const eraser = useDsarErase(() => {
    setErasing(null);
    setTypedId('');
    // The row it acted on is anonymised now; a stale hit would invite a second erase.
    lookup.reset();
  });

  const rows = lookup.data?.items;
  const canSearch = term.trim().length >= 3 && !lookup.isPending;

  const onSearch = () => {
    if (!canSearch) return;
    lookup.mutate({ by, term: term.trim() });
  };

  const columns: Column<DsarCustomerRow>[] = [
    { key: 'id', header: t('col.id'), render: (r) => <span className="font-mono text-sm">{r.id}</span> },
    { key: 'name', header: t('col.name'), render: (r) => r.name ?? '—' },
    { key: 'email', header: t('col.email'), render: (r) => r.email ?? '—' },
    { key: 'phone', header: t('col.phone'), render: (r) => r.phone ?? '—' },
    {
      key: 'ext',
      header: t('col.externalId'),
      render: (r) => <span className="font-mono text-xs">{r.externalCustomerId ?? '—'}</span>,
    },
    {
      key: 'hotel',
      header: t('col.hotel'),
      render: (r) => r.lastHotel?.hotelName || r.lastHotel?.hotelSn || '—',
    },
    {
      key: 'created',
      header: t('col.created'),
      render: (r) => new Date(r.createdAt).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-px whitespace-nowrap',
      render: (r) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={exporter.isPending}
            onClick={() => exporter.mutate({ customerId: r.id, reference: reference.trim() || undefined })}
          >
            <Download className="h-4 w-4" />
            {t('export')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setTypedId('');
              setErasing(r);
            }}
          >
            <Trash2 className="h-4 w-4" />
            {t('erase')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">{t('subtitle')}</p>

      <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p className="text-xs leading-relaxed text-gray-700">{t('verifyFirst')}</p>
      </div>

      <Card title={t('lookupTitle')}>
        <form
          className="grid max-w-3xl gap-4 md:grid-cols-[12rem_1fr_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch();
          }}
        >
          <FormRow label={t('by')}>
            <Select value={by} onChange={(e) => setBy(e.target.value as DsarLookupBy)}>
              <option value="email">{t('by_email')}</option>
              <option value="phone">{t('by_phone')}</option>
              <option value="external_id">{t('by_external_id')}</option>
            </Select>
          </FormRow>
          <FormRow label={t('term')}>
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              maxLength={320}
              autoComplete="off"
              placeholder={t(`placeholder_${by}`)}
            />
          </FormRow>
          <div className="mb-4">
            <Button type="submit" disabled={!canSearch}>
              <Search className="h-4 w-4" />
              {lookup.isPending ? t('searching') : t('search')}
            </Button>
          </div>
        </form>
        <FormRow label={t('reference')}>
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={120}
            placeholder={t('referencePlaceholder')}
            className="max-w-md"
          />
          <p className="mt-1 text-xs text-gray-400">{t('referenceHint')}</p>
        </FormRow>
      </Card>

      {lookup.data && (
        <Card title={t('results')}>
          <Table
            columns={columns}
            data={rows}
            rowKey={(r) => String(r.id)}
            emptyMessage={t('noMatch')}
          />
          {lookup.data.truncated && (
            <p className="mt-2 text-xs text-warning" role="status">
              {t('truncated')}
            </p>
          )}
          <p className="mt-3 text-xs text-gray-400">{t('maskedNote')}</p>
        </Card>
      )}

      <Modal
        open={erasing != null}
        onClose={eraser.isPending ? undefined : () => setErasing(null)}
        title={t('eraseTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setErasing(null)} disabled={eraser.isPending}>
              {tc('cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={eraser.isPending || String(erasing?.id) !== typedId.trim()}
              onClick={() =>
                erasing && eraser.mutate({ customerId: erasing.id, reference: reference.trim() || undefined })
              }
            >
              {eraser.isPending ? tc('saving') : t('eraseConfirm')}
            </Button>
          </>
        }
      >
        {erasing && (
          <div className="space-y-3 text-sm text-gray-700">
            <p>{t('eraseBody', { id: erasing.id })}</p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-gray-500">
              <li>{t('eraseEffect1')}</li>
              <li>{t('eraseEffect2')}</li>
              <li>{t('eraseEffect3')}</li>
            </ul>
            <p className="text-xs text-warning">{t('legalHold')}</p>
            <FormRow label={t('eraseTypeId', { id: erasing.id })}>
              <Input
                value={typedId}
                onChange={(e) => setTypedId(e.target.value)}
                autoComplete="off"
                inputMode="numeric"
              />
            </FormRow>
          </div>
        )}
      </Modal>
    </div>
  );
}
