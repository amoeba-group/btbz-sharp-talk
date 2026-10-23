import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Archive, BookOpen, ExternalLink, Package, ShoppingBag } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { KpiCard } from '@/components/KpiCard';
import { Badge } from '@/components/Badge';
import { Input, Select } from '@/components/Field';
import { Table } from '@/components/Table';
import type { Column } from '@/components/Table';
import { Pagination } from '@/components/Pagination';
import { useProductCategories, useProductCompanies, useProducts, useProductSummary } from './products.hooks';
import { ProductDetailModal } from './ProductDetailModal';
import { roomTypeAttrs } from './products.service';
import type { AdminProduct } from './products.service';
import { HaStatusBadge, RoomCountEditor, fmtVnd } from './room-type';

const PAGE_SIZE = 20;

function fmtMoney(value: number | null, currency: string): string {
  if (typeof value !== 'number') return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toLocaleString()} ${currency}`;
  }
}

function fmtDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

/**
 * The synced catalogue (PLN-260808-Console-Product-List).
 *
 * Shows archived rows too — a product that quietly left the storefront is one of
 * the things an operator opens this screen to find, and the customer-facing
 * catalogue endpoint hides them by design.
 */
export function ProductsPage() {
  const { t } = useTranslation('products');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [openHandle, setOpenHandle] = useState<string | null>(null);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, error } = useProducts({ page, pageSize: PAGE_SIZE, q, category, status, companyId });
  const { data: summary } = useProductSummary();
  const { data: categories } = useProductCategories();
  const { data: companies } = useProductCompanies();
  // A plain storefront tenant has no companies and must look exactly as before.
  const hasCompanies = (companies?.length ?? 0) > 0;

  const dash = <span className="text-gray-300">—</span>;

  // Company + HA room-type columns (PLN-261022 HA hotel profile). Storefront
  // rows in a company tenant show `—` in the room cells.
  const companyColumns: Column<AdminProduct>[] = [
    {
      key: 'company',
      header: t('columns.company'),
      render: (p) => p.companyName ?? (p.companyId ? `#${p.companyId}` : dash),
    },
    {
      key: 'rooms',
      header: t('columns.rooms'),
      render: (p) => {
        const room = roomTypeAttrs(p);
        return room ? <RoomCountEditor handle={p.handle} value={room.roomCount ?? null} /> : dash;
      },
    },
    {
      key: 'hourly',
      header: t('columns.hourly'),
      render: (p) => {
        const room = roomTypeAttrs(p);
        if (!room) return dash;
        return (
          <div className="whitespace-nowrap">
            <p className="tabular-nums">
              {fmtVnd(room.prices?.firstHours)} / {fmtVnd(room.prices?.additional)}
            </p>
            {room.firstHours != null && (
              <p className="text-xs text-gray-500">
                {t('ha.hours', { first: room.firstHours, additional: room.additionalHours ?? 1 })}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: 'overnight',
      header: t('columns.overnight'),
      render: (p) => {
        const room = roomTypeAttrs(p);
        return room ? <span className="whitespace-nowrap tabular-nums">{fmtVnd(room.prices?.overnight)}</span> : dash;
      },
    },
    {
      key: 'daily',
      header: t('columns.daily'),
      render: (p) => {
        const room = roomTypeAttrs(p);
        return room ? <span className="whitespace-nowrap tabular-nums">{fmtVnd(room.prices?.oneDay)}</span> : dash;
      },
    },
  ];

  const columns: Column<AdminProduct>[] = [
    {
      key: 'title',
      header: t('columns.product'),
      render: (p) => (
        <div className="flex max-w-[460px] items-center gap-3">
          {p.imageUrl ? (
            <img
              src={p.imageUrl}
              alt=""
              loading="lazy"
              className="h-10 w-10 shrink-0 rounded object-cover"
              // A dead image URL must not leave a broken-image glyph in the row.
              onError={(e) => {
                e.currentTarget.style.visibility = 'hidden';
              }}
            />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-gray-100 text-gray-300">
              <Package className="h-4 w-4" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate font-medium text-gray-900">{p.title}</p>
            {/* The API sends ~100 characters; `line-clamp-2` keeps a long one
                from stretching the row. Full text lives in the detail dialog. */}
            {p.descriptionSnippet && (
              <p className="line-clamp-2 text-xs text-gray-500">{p.descriptionSnippet}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: t('columns.category'),
      render: (p) => p.category ?? <span className="text-gray-300">—</span>,
    },
    {
      key: 'price',
      header: t('columns.price'),
      render: (p) => fmtMoney(p.price, p.currency),
    },
    {
      key: 'status',
      header: t('columns.status'),
      render: (p) => {
        const room = roomTypeAttrs(p);
        if (room) return <HaStatusBadge code={room.haStatus} />;
        return p.status === 'archived' ? (
          <Badge tone="gray">{t('status.archived')}</Badge>
        ) : (
          <Badge tone="success">{t('status.active')}</Badge>
        );
      },
    },
    {
      key: 'knowledge',
      header: t('columns.knowledge'),
      render: (p) =>
        p.inKnowledge ? (
          <Badge tone="primary">{t('knowledge.registered')}</Badge>
        ) : (
          // Not a cosmetic gap: a row with no document is invisible to the chat.
          <Badge tone="warning">{t('knowledge.missing')}</Badge>
        ),
    },
    {
      key: 'link',
      header: '',
      render: (p) =>
        p.productUrl ? (
          <a
            href={p.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            // The row opens the dialog; the shop link must not do both.
            onClick={(e) => e.stopPropagation()}
            className="text-gray-400 hover:text-primary-600"
            aria-label={t('columns.openInShop')}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : null,
    },
  ];

  // Company columns go right after the product, before category/price.
  const visibleColumns = hasCompanies ? [columns[0], ...companyColumns, ...columns.slice(1)] : columns;

  const filtered = Boolean(q || category || status || companyId);

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label={t('kpi.total')} value={summary?.total ?? '—'} icon={Package} />
        <KpiCard label={t('kpi.active')} value={summary?.active ?? '—'} icon={ShoppingBag} />
        <KpiCard label={t('kpi.archived')} value={summary?.archived ?? '—'} icon={Archive} />
        <KpiCard
          label={t('kpi.inKnowledge')}
          value={summary ? `${summary.inKnowledge} / ${summary.total}` : '—'}
          icon={BookOpen}
          hint={t('kpi.lastSynced', { at: fmtDateTime(summary?.lastSyncedAt ?? null) })}
        />
      </div>

      {/* Widths live on the wrappers. Input/Select carry `w-full` from their
          shared base class and `cn` joins classes without merging them, so a
          `w-auto` on the control loses to it and every filter went full-width,
          each on its own row. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-72">
          <Input
            value={search}
            placeholder={t('filters.searchPlaceholder')}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {hasCompanies && (
          <div className="w-60">
            <Select
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setPage(1);
              }}
              aria-label={t('columns.company')}
            >
              <option value="">{t('filters.allCompanies')}</option>
              <option value="none">{t('filters.storeProducts')}</option>
              {(companies ?? []).map((c) => (
                <option key={c.companyId} value={c.companyId}>
                  {`${c.name ?? `#${c.companyId}`} (${c.count})`}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="w-52">
          <Select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            aria-label={t('columns.category')}
          >
            <option value="">{t('filters.allCategories')}</option>
            {(categories ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label={t('columns.status')}
          >
            <option value="">{t('filters.allStatuses')}</option>
            <option value="active">{t('status.active')}</option>
            <option value="archived">{t('status.archived')}</option>
          </Select>
        </div>
      </div>

      <Table
        columns={visibleColumns}
        data={data?.items}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        // An empty catalogue and an empty filter result are different problems:
        // one needs an import, the other needs a different search.
        emptyMessage={filtered ? t('emptyFiltered') : t('empty')}
        rowKey={(p) => p.handle}
        onRowClick={(p) => setOpenHandle(p.handle)}
      />

      <ProductDetailModal handle={openHandle} onClose={() => setOpenHandle(null)} />

      {!isLoading && !filtered && (data?.total ?? 0) === 0 && (
        <p className="mt-3 text-sm text-gray-500">
          {t('emptyHint')}{' '}
          <Link to="/settings" className="text-primary-600 hover:underline">
            {t('emptyHintLink')}
          </Link>
        </p>
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPageChange={setPage} />
    </div>
  );
}
