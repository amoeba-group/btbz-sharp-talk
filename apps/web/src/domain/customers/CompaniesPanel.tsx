import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Select } from '@/components/Field';
import { Modal } from '@/components/Modal';
import { Pagination } from '@/components/Pagination';
import { Table } from '@/components/Table';
import type { Column } from '@/components/Table';
import { REGION_CODES } from '../../../../../packages/types/src/common/region';
import { ConversationTranscript } from '../history/ConversationTranscript';
import { useCompanies, useCompany } from './customers.hooks';
import type { Company } from './customers.service';

const PAGE_SIZE = 20;

function fmtDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/**
 * Customers › Business customers tab (PLN-261022 stage 2, wireframe 3.4): one
 * row per company (a partner hotel), its contacts and every conversation of
 * the company across sessions and staff. Contact names are shown in the
 * clear like the consumer list (2026-10-23); a conversation opens read-only in place.
 */
export function CompaniesPanel() {
  const { t } = useTranslation('customers');
  const { t: tc } = useTranslation('common');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const { data, isLoading, error } = useCompanies({ page, pageSize: PAGE_SIZE, q: q || undefined, region: region || undefined });
  const regionLabel = (r: string | null) => (r ? t(`region.${r}`, { defaultValue: r }) : '—');

  const columns: Column<Company>[] = [
    { key: 'name', header: t('companyName'), render: (c) => <span className="font-medium text-gray-900">{c.name ?? c.externalKey}</span> },
    { key: 'region', header: t('companyRegion'), render: (c) => (c.region ? <Badge tone="info">{regionLabel(c.region)}</Badge> : '—') },
    { key: 'province', header: t('companyProvince'), render: (c) => c.province ?? '—' },
    { key: 'contacts', header: t('companyContacts'), render: (c) => c.contactCount },
    { key: 'conversations', header: t('companyConversations'), render: (c) => c.conversationCount },
    { key: 'last', header: t('companyLastActivity'), render: (c) => fmtDateTime(c.lastConversationAt ?? c.lastSeenAt) },
    {
      key: 'open',
      header: '',
      className: 'text-right',
      render: (c) => (
        <Button size="sm" variant="secondary" onClick={() => setOpenId(c.id)}>
          {t('companyOpen')}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('companySearchPlaceholder')}
          aria-label={t('companySearchPlaceholder')}
          className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
        />
        <div className="w-48">
          <Select
            aria-label={t('companyRegion')}
            value={region}
            onChange={(e) => {
              setRegion(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('allRegions')}</option>
            {REGION_CODES.map((r) => (
              <option key={r} value={r}>
                {regionLabel(r)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <p className="mb-3 text-xs text-gray-500">{t('companyHint')}</p>
      <Table
        columns={columns}
        data={data?.items}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        emptyMessage={t('companyEmpty')}
        rowKey={(c) => c.id}
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPageChange={setPage} />
      <CompanyDetailModal id={openId} onClose={() => setOpenId(null)} regionLabel={regionLabel} closeLabel={tc('close')} />
    </div>
  );
}

function CompanyDetailModal({
  id,
  onClose,
  regionLabel,
  closeLabel,
}: {
  id: string | null;
  onClose: () => void;
  regionLabel: (r: string | null) => string;
  closeLabel: string;
}) {
  const { t } = useTranslation('customers');
  const { data, isLoading, error } = useCompany(id);
  const [conversationId, setConversationId] = useState<string | null>(null);
  useEffect(() => setConversationId(null), [id]);

  return (
    <Modal
      open={!!id}
      onClose={onClose}
      size="lg"
      title={data?.name ?? data?.externalKey ?? t('companyDetail')}
      footer={
        <Button variant="ghost" onClick={conversationId ? () => setConversationId(null) : onClose}>
          {conversationId ? t('companyBack') : closeLabel}
        </Button>
      }
    >
      {isLoading && <p className="text-sm text-gray-400">{t('companyLoading')}</p>}
      {error && <p className="text-sm text-error">{(error as Error).message}</p>}
      {data && conversationId && <ConversationTranscript conversationId={conversationId} />}
      {data && !conversationId && (
        <div className="space-y-4 text-sm">
          <p className="text-gray-600">
            <span className="font-mono text-xs text-gray-500">{data.externalKey}</span>
            {' · '}
            {regionLabel(data.region)}
            {' · '}
            {data.province ?? '—'}
          </p>
          <section>
            <h3 className="mb-1 text-xs font-semibold text-gray-500">{t('companyContactsTitle', { count: data.contacts.length })}</h3>
            {data.contacts.length === 0 ? (
              <p className="text-xs text-gray-400">—</p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                {data.contacts.map((c) => (
                  <li key={c.customerId} className="flex items-center justify-between px-3 py-2">
                    <span>{c.name ?? `#${c.customerId}`}</span>
                    <span className="text-xs text-gray-500">
                      {c.role ?? '—'} · {fmtDateTime(c.lastSeenAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="mb-1 text-xs font-semibold text-gray-500">{t('companyConversationsTitle', { count: data.conversationCount })}</h3>
            {data.conversations.length === 0 ? (
              <p className="text-xs text-gray-400">—</p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                {data.conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setConversationId(c.id)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-50"
                    >
                      <span>
                        #{c.id} · {fmtDateTime(c.createdAt)}
                        {c.customerName && <span className="ml-2 text-xs text-gray-500">{c.customerName}</span>}
                      </span>
                      <Badge tone={c.status === 'ended' ? 'gray' : 'primary'}>{t(`status.${c.status}`, { defaultValue: c.status })}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
