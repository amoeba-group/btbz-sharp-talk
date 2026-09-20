import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Table } from '@/components/Table';
import type { Column } from '@/components/Table';
import { Pagination } from '@/components/Pagination';
import { Modal } from '@/components/Modal';
import { FormRow, Select } from '@/components/Field';
import { useCustomers, useRevealCustomer, useUpdateTier } from './customers.hooks';
import type { Customer } from './customers.service';
import { useAuthStore } from '@/store/auth-store';
import { makeCan } from '@/lib/rbac';
import { toast } from '@/store/toast-store';

const PAGE_SIZE = 20;
/**
 * How long a revealed record stays on screen.
 *
 * Long enough to finish the call that needed it, short enough that a console
 * left open on a shared desk goes back to masked on its own (PLN-260920).
 */
const REVEAL_TTL_MS = 5 * 60_000;
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
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [editing, setEditing] = useState<Customer | null>(null);
  const [tier, setTier] = useState<string>('guest');
  // Revealed records live here only, never in the query cache: they expire,
  // and a cached copy would outlive the reveal the operator asked for.
  const [revealed, setRevealed] = useState<Record<number, Customer>>({});
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const principal = useAuthStore((s) => s.principal);
  const canReveal = useMemo(() => makeCan(principal)('customer_pii_reveal'), [principal]);
  const reveal = useRevealCustomer();

  // Drop pending expiry timers when the page unmounts.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      Object.values(pending).forEach(clearTimeout);
    };
  }, []);

  const onReveal = useCallback(
    async (c: Customer) => {
      if (revealed[c.id]) return;
      const full = await reveal.mutateAsync(c.id);
      setRevealed((prev) => ({ ...prev, [c.id]: full }));
      toast.success(t('revealAudited'));
      timers.current[c.id] = setTimeout(() => {
        setRevealed((prev) => {
          const next = { ...prev };
          delete next[c.id];
          return next;
        });
        delete timers.current[c.id];
      }, REVEAL_TTL_MS);
    },
    [reveal, revealed, t],
  );

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

  const shown = (c: Customer): Customer => revealed[c.id] ?? c;

  const columns: Column<Customer>[] = [
    { key: 'name', header: t('name'), render: (c) => shown(c).name ?? '—' },
    {
      key: 'email',
      header: t('email'),
      render: (c) => {
        const row = shown(c);
        return (
          <span className={revealed[c.id] ? 'font-medium text-gray-900' : 'text-gray-600'}>
            {row.email ?? '—'}
          </span>
        );
      },
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
          {canReveal && !revealed[c.id] && (
            <Button
              size="sm"
              variant="ghost"
              title={t('reveal')}
              aria-label={t('reveal')}
              disabled={reveal.isPending}
              onClick={(e) => {
                e.stopPropagation();
                void onReveal(c);
              }}
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
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

      <p className="mb-3 text-xs text-gray-500">
        {canReveal ? t('maskedHintWithReveal') : t('maskedHint')}
      </p>

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
          <FormRow label={t('tierFor', { name: shown(editing).name ?? editing.id })}>
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
