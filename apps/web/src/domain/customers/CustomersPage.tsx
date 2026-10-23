import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Table } from '@/components/Table';
import type { Column } from '@/components/Table';
import { Pagination } from '@/components/Pagination';
import { Modal } from '@/components/Modal';
import { FormRow, Select } from '@/components/Field';
import { useCustomers, useUpdateTier } from './customers.hooks';
import type { Customer } from './customers.service';
import { cn } from '@/lib/cn';
import { CompaniesPanel } from './CompaniesPanel';

const PAGE_SIZE = 20;
const TIERS = ['guest', 'subscriber', 'regular'] as const;

function fmtMoney(value?: number, currency?: string | null): string {
  if (typeof value !== 'number') return '—';
  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
    } catch {
      /* unknown currency code — fall back to a plain amount + code */
      return `${value.toLocaleString()} ${currency}`;
    }
  }
  return value.toLocaleString();
}

function fmtDate(value?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

export function CustomersPage() {
  const { t } = useTranslation('customers');
  const { t: tc } = useTranslation('common');
  // All / business customers (companies) / booking customers (PLN-261022 stage 2).
  // ?tab=b2b&company=ID opens a business customer directly (live-chat hotel card, PLN-261023).
  const [params] = useSearchParams();
  const linkedCompany = params.get('tab') === 'b2b' ? params.get('company') : null;
  const [tab, setTab] = useState<'all' | 'b2b' | 'b2c'>(linkedCompany ? 'b2b' : 'all');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [editing, setEditing] = useState<Customer | null>(null);
  const [tier, setTier] = useState<string>('guest');
  // Debounce the search box and reset to the first page on a new query.
  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const { data, isLoading, error } = useCustomers({
    page,
    pageSize: PAGE_SIZE,
    email: debouncedSearch || undefined,
    customerType: tab === 'b2c' ? 'b2c' : undefined,
  });
  const updateTier = useUpdateTier();

  const openEdit = (c: Customer) => {
    setEditing(c);
    setTier(c.tier ?? 'guest');
  };

  const onSave = async () => {
    if (!editing) return;
    await updateTier.mutateAsync({ id: editing.id, tier });
    setEditing(null);
  };

  const columns: Column<Customer>[] = [
    // In the clear since 2026-10-23: the list is where an operator finds a
    // customer. Masking applies inside conversations and to AI-bound text.
    { key: 'name', header: t('name'), render: (c) => c.name ?? '—' },
    {
      key: 'email',
      header: t('email'),
      render: (c) => <span className="text-gray-600">{c.email ?? '—'}</span>,
    },
    {
      key: 'type',
      header: t('customerType'),
      render: (c) =>
        c.customerType === 'b2b_contact' ? <Badge tone="info">{t('typeB2b')}</Badge> : <Badge tone="gray">{t('typeB2c')}</Badge>,
    },
    {
      key: 'tier',
      header: t('tier'),
      render: (c) => (c.tier ? <Badge tone="primary">{c.tier}</Badge> : '—'),
    },
    { key: 'orders', header: t('orders'), render: (c) => c.orders ?? 0 },
    { key: 'totalSpent', header: t('totalSpent'), render: (c) => fmtMoney(c.totalSpent, c.currency) },
    { key: 'createdAt', header: t('created'), render: (c) => fmtDate(c.createdAt) },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (c) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              openEdit(c);
            }}
          >
            {t('editTier')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="mb-4 flex gap-2" role="tablist">
        {(['all', 'b2b', 'b2c'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setPage(1);
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium',
              tab === key ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            {t(`tab_${key}`)}
          </button>
        ))}
      </div>

      {tab === 'b2b' ? (
        <CompaniesPanel initialOpenId={linkedCompany} />
      ) : (
      <>
      <div className="mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
        />
      </div>

      <Table
        columns={columns}
        data={data?.items}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        emptyMessage={t('empty')}
        rowKey={(c) => String(c.id)}
      />

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={data?.total ?? 0}
        onPageChange={setPage}
      />
      </>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={t('editTierTitle')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {tc('cancel')}
            </Button>
            <Button onClick={onSave} disabled={updateTier.isPending}>
              {tc('save')}
            </Button>
          </>
        }
      >
        {editing && (
          <FormRow label={t('tierFor', { name: editing.name ?? editing.id })}>
            <Select value={tier} onChange={(e) => setTier(e.target.value)}>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </FormRow>
        )}
      </Modal>
    </div>
  );
}
