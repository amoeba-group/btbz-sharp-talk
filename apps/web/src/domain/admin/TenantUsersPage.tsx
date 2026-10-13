import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  UserPlus,
  ExternalLink,
  ShieldOff,
  AlertTriangle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/StatusBadge';
import { Table } from '@/components/Table';
import type { Column } from '@/components/Table';
import { Pagination } from '@/components/Pagination';
import { Modal } from '@/components/Modal';
import { FormRow, Input, Select } from '@/components/Field';
import { toast } from '@/store/toast-store';
import { tenantLoginPath } from '@/lib/tenant-path';
import type { JobLabel, TenantUser } from '@/domain/users/users.service';
import { localizeJobLabels } from '@/domain/users/job-label-name';
import {
  useAdminTenant,
  useInviteTenantUser,
  useIssueTenantUserTempPassword,
  useResetTenantUserMfa,
  useSetTenantUserStatus,
  useTenantJobLabels,
  useTenantUsers,
} from './admin.hooks';

const PAGE_SIZE = 20;
const RANKS = ['master', 'director', 'manager', 'staff'] as const;

function fmtDate(value?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

/** Platform-admin management of a single tenant's users (/admin/tenants/:tenantId/users). */
export function TenantUsersPage() {
  const { t } = useTranslation('tenants');
  const { t: tu } = useTranslation('users');
  const { t: tc } = useTranslation('common');
  // Param name must match the router's `tenants/:tenantUuid/users` definition.
  const { tenantUuid = '' } = useParams<{ tenantUuid: string }>();

  const [page, setPage] = useState(1);
  const { data: tenant } = useAdminTenant(tenantUuid);
  const { data, isLoading, error } = useTenantUsers(tenantUuid, { page, pageSize: PAGE_SIZE });
  const { data: jobLabels } = useTenantJobLabels(tenantUuid);
  const inviteUser = useInviteTenantUser(tenantUuid);
  const issueTempPw = useIssueTenantUserTempPassword(tenantUuid);
  const resetMfa = useResetTenantUserMfa(tenantUuid);
  const setUserStatus = useSetTenantUserStatus(tenantUuid);

  // Built-in role names read in the console language (w3c); renamed ones as typed.
  const labels = useMemo<JobLabel[]>(
    () => localizeJobLabels(jobLabels ?? [], (code) => tu(`roleNames.${code}`, { defaultValue: '' }) || undefined),
    [jobLabels, tu],
  );

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [rank, setRank] = useState<string>('master');
  const [labelCodes, setLabelCodes] = useState<string[]>([]);

  // One-time temp password shown for manual hand-off (mirrors tenant console UX).
  const [tempResult, setTempResult] = useState<{
    email: string;
    tempPassword: string;
    emailSent?: boolean;
  } | null>(null);
  // Issuance confirm step (PLN-260824 S4): pick whether to also email it.
  const [tempPwTarget, setTempPwTarget] = useState<TenantUser | null>(null);
  const [tempPwSendEmail, setTempPwSendEmail] = useState(true);
  const [copied, setCopied] = useState(false);

  const loginUrl = tenant?.slug ? `${window.location.origin}${tenantLoginPath(tenant.slug)}` : null;

  const copyText = async (text: string, onDone?: () => void) => {
    try {
      await navigator.clipboard.writeText(text);
      onDone?.();
    } catch {
      /* clipboard unavailable (http/permission) — user can select manually */
    }
  };

  const openInvite = () => {
    setEmail('');
    setRank('master');
    setLabelCodes([]);
    setInviteOpen(true);
  };

  const onInvite = async () => {
    const res = await inviteUser.mutateAsync({ email, rank, label_codes: labelCodes });
    setInviteOpen(false);
    setCopied(false);
    setTempResult({ email, tempPassword: res.tempPassword });
  };

  const onIssueTempPw = (u: TenantUser) => {
    setTempPwSendEmail(true);
    setTempPwTarget(u);
  };

  const confirmIssueTempPw = async () => {
    if (!tempPwTarget) return;
    const u = tempPwTarget;
    const res = await issueTempPw.mutateAsync({ userId: u.id, sendEmail: tempPwSendEmail });
    setTempPwTarget(null);
    setCopied(false);
    setTempResult({
      email: res.email ?? u.email,
      tempPassword: res.tempPassword,
      emailSent: res.emailSent,
    });
    toast.success(tu('tempPwIssued'));
  };

  // Target of a pending MFA reset (confirm dialog).
  const [mfaResetTarget, setMfaResetTarget] = useState<TenantUser | null>(null);

  const onResetMfa = async () => {
    if (!mfaResetTarget) return;
    try {
      await resetMfa.mutateAsync(mfaResetTarget.id);
      setMfaResetTarget(null);
      toast.success(tu('mfaResetDone'));
    } catch {
      /* error toast handled by the hook; keep the dialog open */
    }
  };

  const columns: Column<TenantUser>[] = [
    { key: 'email', header: tu('email'), render: (u) => u.email },
    {
      key: 'rank',
      header: tu('rank'),
      render: (u) => <Badge tone="primary">{tu(`rankName.${u.rank}`, { defaultValue: u.rank })}</Badge>,
    },
    {
      key: 'status',
      header: tu('status'),
      render: (u) => (
        <StatusBadge status={u.status} label={tu(`statusName.${u.status}`, { defaultValue: u.status ?? '' })} />
      ),
    },
    { key: 'createdAt', header: tu('created'), render: (u) => fmtDate(u.createdAt) },
    {
      key: 'action',
      header: '',
      render: (u) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onIssueTempPw(u)}
            disabled={issueTempPw.isPending}
            title={tu('issueTempPassword')}
          >
            <KeyRound className="mr-1 h-3.5 w-3.5" />
            {tu('tempPassword')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setMfaResetTarget(u)}
            disabled={resetMfa.isPending}
            title={tu('mfaResetTitle')}
          >
            <ShieldOff className="mr-1 h-3.5 w-3.5" />
            {tu('mfaReset')}
          </Button>
          {u.status === 'suspended' ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={setUserStatus.isPending}
              onClick={() => setUserStatus.mutate({ userId: u.id, status: 'active' })}
            >
              {t('activate')}
            </Button>
          ) : (
            <Button
              variant="danger"
              size="sm"
              disabled={setUserStatus.isPending}
              onClick={() => setUserStatus.mutate({ userId: u.id, status: 'suspended' })}
            >
              {t('suspend')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <Link
        to="/admin/tenants"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('title')}
      </Link>

      <PageHeader
        title={t('usersOf', { name: tenant?.name ?? tenant?.slug ?? '…' })}
        subtitle={t('usersOfSubtitle')}
        action={
          <Button onClick={openInvite}>
            <UserPlus className="mr-1.5 h-4 w-4" />
            {tu('inviteUser')}
          </Button>
        }
      />

      {loginUrl && (
        <Card>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-500">{t('loginUrl')}</span>
            <a
              href={loginUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-primary-600 hover:underline"
            >
              {loginUrl}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => copyText(loginUrl, () => toast.success(tc('copied')))}
            >
              <Copy className="mr-1 h-3.5 w-3.5" />
              {tc('copy')}
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <Table<TenantUser>
          columns={columns}
          data={data?.items}
          loading={isLoading}
          error={error ? (error as Error).message : null}
          emptyMessage={t('usersEmpty')}
          rowKey={(u) => u.id}
        />
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={data?.total ?? 0}
          onPageChange={setPage}
        />
      </Card>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={tu('inviteUser')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button onClick={onInvite} disabled={inviteUser.isPending || !email}>
              {tu('sendInvite')}
            </Button>
          </>
        }
      >
        <FormRow label={tu('email')}>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={tu('emailPlaceholder')}
          />
        </FormRow>
        <FormRow label={tu('rank')}>
          <Select value={rank} onChange={(e) => setRank(e.target.value)}>
            {RANKS.map((r) => (
              <option key={r} value={r}>
                {tu(`rankName.${r}`)}
              </option>
            ))}
          </Select>
        </FormRow>
        {labels.length > 0 && (
          <FormRow label={tu('jobLabels')}>
            <div className="space-y-2">
              {labels.map((l) => (
                <label key={l.code} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={labelCodes.includes(l.code)}
                    onChange={() =>
                      setLabelCodes((prev) =>
                        prev.includes(l.code) ? prev.filter((c) => c !== l.code) : [...prev, l.code],
                      )
                    }
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  {l.name}
                </label>
              ))}
            </div>
          </FormRow>
        )}
      </Modal>

      <Modal
        open={tempPwTarget !== null}
        onClose={() => setTempPwTarget(null)}
        title={tu('issueTempPassword')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTempPwTarget(null)}>
              {tc('cancel')}
            </Button>
            <Button onClick={confirmIssueTempPw} disabled={issueTempPw.isPending}>
              {tu('tempPwIssue')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          {tu('tempPwConfirm')}{' '}
          <span className="font-medium text-gray-900">{tempPwTarget?.email}</span>
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={tempPwSendEmail}
            onChange={(e) => setTempPwSendEmail(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          {tu('tempPwSendEmail')}
        </label>
      </Modal>

      <Modal
        open={tempResult !== null}
        onClose={() => setTempResult(null)}
        title={tu('tempPwTitle')}
        footer={<Button onClick={() => setTempResult(null)}>{tc('close')}</Button>}
      >
        {tempResult && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {tu('tempPwFor')}{' '}
              <span className="font-medium text-gray-900">{tempResult.email}</span>
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 select-all rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-base text-gray-900">
                {tempResult.tempPassword}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => copyText(tempResult.tempPassword, () => setCopied(true))}
                aria-label={tu('copy')}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-1">{copied ? tu('copied') : tu('copy')}</span>
              </Button>
            </div>
            {tempResult.emailSent === true && (
              <p className="text-sm text-emerald-700">{tu('tempPwEmailSent')}</p>
            )}
            {tempResult.emailSent === false && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {tu('tempPwEmailFailed')}
              </p>
            )}
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {tu('tempPwDesc')}
            </p>
            <p className="text-sm text-emerald-700">{tu('tempPwLockReset')}</p>
          </div>
        )}
      </Modal>

      <Modal
        open={mfaResetTarget !== null}
        onClose={() => setMfaResetTarget(null)}
        title={tu('mfaResetTitle')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMfaResetTarget(null)}>
              {tc('cancel')}
            </Button>
            <Button variant="danger" onClick={onResetMfa} disabled={resetMfa.isPending}>
              {tu('mfaReset')}
            </Button>
          </>
        }
      >
        {mfaResetTarget && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {tu('mfaResetConfirm', { email: mfaResetTarget.email })}
            </p>
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>{tu('mfaResetWarning')}</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
