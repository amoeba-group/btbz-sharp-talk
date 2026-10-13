import { useEffect, useMemo, useState } from 'react';
import { UserPlus, KeyRound, Copy, Check, ShieldOff, AlertTriangle, Tags } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/StatusBadge';
import { Table } from '@/components/Table';
import type { Column } from '@/components/Table';
import { Modal } from '@/components/Modal';
import { FormRow, Input, Select } from '@/components/Field';
import { toast } from '@/store/toast-store';
import { useAuthStore } from '@/store/auth-store';
import {
  useUsers,
  useJobLabels,
  useInviteUser,
  useUpdateUser,
  useIssueTempPassword,
  useResetUserMfa,
  useRenameJobLabels,
} from './users.hooks';
// Source deep-import: the package entry point is CJS and fails the browser build for values.
import {
  hasBlankJobLabelName,
  planJobLabelRenames,
} from '../../../../../packages/types/src/common/job-label-name';
import { USER_REGIONS } from './users.service';
import type { JobLabel, TenantUser, UpdateUserBody, UserPresence } from './users.service';

const RANKS = ['master', 'director', 'manager', 'staff'] as const;
const STATUSES = ['active', 'suspended'] as const;

/**
 * Duty state of one user (PLN-261012 SG-60). Green = on duty and connected (what
 * routing counts); amber = switched on but the console has not been seen lately,
 * so alerts skip them; grey = off duty.
 */
function PresenceCell({ presence }: { presence?: UserPresence }) {
  const { t } = useTranslation('users');
  if (!presence) return <span className="text-gray-400">—</span>;
  const dot = (cls: string) => (
    <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} aria-hidden="true" />
  );
  if (presence.present) {
    const sec = presence.lastSeenAt
      ? Math.max(0, Math.round((Date.now() - new Date(presence.lastSeenAt).getTime()) / 1000))
      : 0;
    const ago =
      sec < 60 ? t('presence.agoSec', { n: sec }) : t('presence.agoMin', { n: Math.round(sec / 60) });
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
        {dot('bg-emerald-500')}
        {t('presence.seen', { ago })}
      </span>
    );
  }
  if (presence.onDuty) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-sm text-amber-700"
        title={t('presence.staleHint')}
      >
        {dot('bg-amber-400')}
        {t('presence.stale')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-gray-500">
      {dot('bg-gray-300')}
      {t('presence.off')}
    </span>
  );
}

/** Region select (PLN-261007): '' = nationwide, which the API stores as NULL. */
function RegionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation('users');
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('region')}>
      <option value="">{t('region_all')}</option>
      {USER_REGIONS.map((r) => (
        <option key={r} value={r}>
          {t(`region_${r}`)}
        </option>
      ))}
    </Select>
  );
}

function fmtDate(value?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

function LabelCheckboxes({
  labels,
  selected,
  onToggle,
}: {
  labels: JobLabel[];
  selected: string[];
  onToggle: (code: string) => void;
}) {
  const { t } = useTranslation('users');
  if (labels.length === 0) {
    return <p className="text-sm text-gray-400">{t('noJobLabels')}</p>;
  }
  return (
    <div className="space-y-2">
      {labels.map((l) => (
        <label key={l.code} className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={selected.includes(l.code)}
            onChange={() => onToggle(l.code)}
            className="h-4 w-4 rounded border-gray-300"
          />
          {l.name}
        </label>
      ))}
      {/* "Others" is the absence of a role (PLN-261007) — said, not left to guess. */}
      <p className="text-xs text-gray-400">{t('rolesHint')}</p>
    </div>
  );
}

/**
 * "Role names" dialog (w3c, ops-manual finding 1): one input per role label, prefilled with what
 * the console shows today. Only the rows the operator changed are saved; a label left alone keeps
 * its built-in name and keeps following the console language. "Use default" writes the neutral
 * English default back, which the console again shows in its own language.
 */
function RoleNamesModal({
  open,
  onClose,
  labels,
}: {
  open: boolean;
  onClose: () => void;
  labels: JobLabel[];
}) {
  const { t } = useTranslation('users');
  const { t: tc } = useTranslation('common');
  const rename = useRenameJobLabels();
  const [draft, setDraft] = useState<Record<string, string>>({});
  // Rows marked "use default": saved as the English-neutral default, not as the text on screen.
  const [reset, setReset] = useState<Set<string>>(new Set());

  // Re-seed the inputs from the server list every time the dialog opens.
  useEffect(() => {
    if (open) {
      setDraft(Object.fromEntries(labels.map((l) => [l.code, l.name])));
      setReset(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const changes = planJobLabelRenames(labels, draft, reset);
  const blank = hasBlankJobLabelName(labels, draft, reset);

  const onSave = async () => {
    if (changes.length === 0 || blank) return;
    try {
      await rename.mutateAsync(changes);
      onClose();
    } catch {
      /* error toast handled by the hook; keep the dialog open */
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('roleNames.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={onSave} disabled={rename.isPending || changes.length === 0 || blank}>
            {rename.isPending ? tc('saving') : tc('save')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-gray-600">{t('roleNames.intro')}</p>
      <div className="space-y-3">
        {labels.map((l) => (
          <div key={l.code}>
            <label className="mb-1 flex items-center gap-2 text-xs text-gray-500">
              <code className="rounded bg-gray-100 px-1.5 py-0.5">{l.code}</code>
              {t(`roleNames.meaning.${l.code}`, { defaultValue: '' })}
            </label>
            <div className="flex items-center gap-2">
              <Input
                value={draft[l.code] ?? l.name}
                maxLength={64}
                aria-label={t('roleNames.nameOf', { code: l.code })}
                onChange={(e) => {
                  setDraft((prev) => ({ ...prev, [l.code]: e.target.value }));
                  setReset((prev) => {
                    const next = new Set(prev);
                    next.delete(l.code);
                    return next;
                  });
                }}
              />
              <button
                type="button"
                className="shrink-0 text-xs font-medium text-primary-600 hover:underline"
                onClick={() => {
                  setDraft((prev) => ({
                    ...prev,
                    [l.code]: t(`roleNames.${l.code}`, { defaultValue: l.name }),
                  }));
                  setReset((prev) => new Set(prev).add(l.code));
                }}
              >
                {t('roleNames.useDefault')}
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-gray-400">{t('roleNames.hint')}</p>
    </Modal>
  );
}

export function UsersPage() {
  const { t } = useTranslation('users');
  const { t: tc } = useTranslation('common');
  // Role/region filters (PLN-261007) — server-side, so they work past page one.
  const [filterLabel, setFilterLabel] = useState('');
  const [filterRegion, setFilterRegion] = useState('');
  // The presence column (PLN-261012 SG-60) is live, so the list re-reads every 15 s.
  const { data: users, isLoading, error } = useUsers(
    { label: filterLabel, region: filterRegion },
    { refetchMs: 15000 },
  );
  const { data: jobLabels } = useJobLabels();
  // Naming people and renaming roles follow the API: master and director (USER_INVITE / LABEL_EDIT).
  const principal = useAuthStore((s) => s.principal);
  const canNameStaff =
    principal?.actorType === 'user' && (principal.rank === 'master' || principal.rank === 'director');
  const [roleNamesOpen, setRoleNamesOpen] = useState(false);
  const inviteUser = useInviteUser();
  const updateUser = useUpdateUser();
  const issueTempPw = useIssueTempPassword();
  const resetMfa = useResetUserMfa();

  // Result of a temp-password issuance / invite — shown once for manual hand-off.
  const [tempResult, setTempResult] = useState<{
    email: string;
    tempPassword: string;
    emailSent?: boolean;
  } | null>(null);
  // Issuance confirm step (PLN-260824 S4): pick whether to also email it.
  const [tempPwTarget, setTempPwTarget] = useState<TenantUser | null>(null);
  const [tempPwSendEmail, setTempPwSendEmail] = useState(true);
  const [copied, setCopied] = useState(false);

  // Target of a pending MFA reset (confirm dialog).
  const [mfaResetTarget, setMfaResetTarget] = useState<TenantUser | null>(null);

  const onResetMfa = async () => {
    if (!mfaResetTarget) return;
    try {
      await resetMfa.mutateAsync(mfaResetTarget.id);
      setMfaResetTarget(null);
      toast.success(t('mfaResetDone'));
    } catch {
      /* error toast handled by the hook; keep the dialog open */
    }
  };

  const copyTempPw = async () => {
    if (!tempResult) return;
    try {
      await navigator.clipboard.writeText(tempResult.tempPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const labels = useMemo<JobLabel[]>(() => jobLabels ?? [], [jobLabels]);
  const labelNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    labels.forEach((l) => m.set(l.code, l.name));
    return m;
  }, [labels]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [inviteRank, setInviteRank] = useState<string>('staff');
  const [inviteCodes, setInviteCodes] = useState<string[]>([]);
  const [inviteRegion, setInviteRegion] = useState<string>('');
  const [inviteName, setInviteName] = useState('');

  const [editing, setEditing] = useState<TenantUser | null>(null);
  const [editName, setEditName] = useState('');
  const [editRank, setEditRank] = useState<string>('staff');
  const [editCodes, setEditCodes] = useState<string[]>([]);
  const [editRegion, setEditRegion] = useState<string>('');
  const [editStatus, setEditStatus] = useState<string>('active');

  const toggle = (codes: string[], code: string): string[] =>
    codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code];

  const openInvite = () => {
    setEmail('');
    setInviteRank('staff');
    setInviteCodes([]);
    setInviteRegion('');
    setInviteName('');
    setInviteOpen(true);
  };

  const onInvite = async () => {
    const res = await inviteUser.mutateAsync({
      email,
      rank: inviteRank,
      label_codes: inviteCodes,
      region: inviteRegion,
      ...(inviteName.trim() ? { name: inviteName.trim() } : {}),
    });
    setInviteOpen(false);
    // Show the generated temp password so the admin can relay it (besides email).
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
    const res = await issueTempPw.mutateAsync({ id: u.id, sendEmail: tempPwSendEmail });
    setTempPwTarget(null);
    setCopied(false);
    setTempResult({
      email: res.email ?? u.email,
      tempPassword: res.tempPassword,
      emailSent: res.emailSent,
    });
    toast.success(t('tempPwIssued'));
  };

  const openEdit = (u: TenantUser) => {
    setEditing(u);
    setEditName(u.name ?? '');
    setEditRank(u.rank);
    setEditCodes(u.labelCodes ?? []);
    setEditRegion(u.region ?? '');
    setEditStatus(u.status ?? 'active');
  };

  const onUpdate = async () => {
    if (!editing) return;
    // Only submit changed fields — each maps to its own endpoint with its own RBAC.
    const prevCodes = editing.labelCodes ?? [];
    const codesChanged =
      prevCodes.length !== editCodes.length || editCodes.some((c) => !prevCodes.includes(c));
    const body: UpdateUserBody = {};
    if (canNameStaff && editName.trim() !== (editing.name ?? '').trim()) body.name = editName.trim();
    if (editRank !== editing.rank) body.rank = editRank;
    if (codesChanged) body.label_codes = editCodes;
    if (editRegion !== (editing.region ?? '')) body.region = editRegion;
    if (editStatus !== (editing.status ?? 'active')) body.status = editStatus;
    if (Object.keys(body).length > 0) {
      await updateUser.mutateAsync({ id: editing.id, body });
    }
    setEditing(null);
  };

  const columns: Column<TenantUser>[] = [
    {
      // Name over e-mail in one column: a separate Name column squeezed the action buttons.
      key: 'user',
      header: t('title'),
      render: (u) => (
        <div className="min-w-0">
          {/* No name yet: the e-mail's words are what the re-route toast and notes use, so say it's unset. */}
          <div className="font-medium text-gray-900">
            {u.name || <span className="font-normal text-gray-400">{t('nameUnset')}</span>}
          </div>
          <div className="truncate text-xs text-gray-500">{u.email}</div>
        </div>
      ),
    },
    {
      key: 'rank',
      header: t('rank'),
      render: (u) => <Badge tone="primary">{t(`rankName.${u.rank}`, { defaultValue: u.rank })}</Badge>,
    },
    {
      key: 'labels',
      header: t('roles'),
      render: (u) => {
        const codes = u.labelCodes ?? [];
        if (codes.length === 0) return <span className="text-gray-400">{t('roleOthers')}</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {codes.map((c) => (
              <Badge key={c}>{labelNameByCode.get(c) ?? c}</Badge>
            ))}
          </div>
        );
      },
    },
    {
      key: 'region',
      header: t('region'),
      render: (u) => (u.region ? t(`region_${u.region}`, { defaultValue: u.region }) : t('region_all')),
    },
    {
      key: 'presence',
      header: t('presence.header'),
      render: (u) => <PresenceCell presence={u.presence} />,
    },
    {
      key: 'status',
      header: t('status'),
      render: (u) => (
        <StatusBadge status={u.status} label={t(`statusName.${u.status}`, { defaultValue: u.status ?? '' })} />
      ),
    },
    { key: 'createdAt', header: t('created'), render: (u) => fmtDate(u.createdAt) },
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
            title={t('issueTempPassword')}
          >
            <KeyRound className="mr-1 h-3.5 w-3.5" />
            {t('tempPassword')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setMfaResetTarget(u)}
            disabled={resetMfa.isPending}
            title={t('mfaResetTitle')}
          >
            <ShieldOff className="mr-1 h-3.5 w-3.5" />
            {t('mfaReset')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => openEdit(u)}>
            {tc('edit')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          <div className="flex items-center gap-2">
            {canNameStaff && (
              <Button variant="secondary" onClick={() => setRoleNamesOpen(true)}>
                <Tags className="mr-1.5 h-4 w-4" />
                {t('roleNames.open')}
              </Button>
            )}
            <Button onClick={openInvite}>
              <UserPlus className="mr-1.5 h-4 w-4" />
              {t('inviteUser')}
            </Button>
          </div>
        }
      />

      <Card>
        {/* Role / region filters (PLN-261007). */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="w-48">
            <Select
              value={filterLabel}
              onChange={(e) => setFilterLabel(e.target.value)}
              aria-label={t('filterRole')}
            >
              <option value="">{t('filterRoleAll')}</option>
              {labels.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-48">
            <Select
              value={filterRegion}
              onChange={(e) => setFilterRegion(e.target.value)}
              aria-label={t('filterRegion')}
            >
              <option value="">{t('filterRegionAll')}</option>
              <option value="none">{t('region_all')}</option>
              {USER_REGIONS.map((r) => (
                <option key={r} value={r}>
                  {t(`region_${r}`)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <Table<TenantUser>
          columns={columns}
          data={users}
          loading={isLoading}
          error={error ? (error as Error).message : null}
          emptyMessage={t('empty')}
          rowKey={(u) => u.id}
        />
      </Card>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={t('inviteUser')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button onClick={onInvite} disabled={inviteUser.isPending || !email}>
              {inviteUser.isPending ? tc('sending') : t('sendInvite')}
            </Button>
          </>
        }
      >
        <FormRow label={t('email')}>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('emailPlaceholder')}
          />
        </FormRow>
        <FormRow label={t('name')}>
          <Input
            value={inviteName}
            maxLength={80}
            onChange={(e) => setInviteName(e.target.value)}
            placeholder={t('namePlaceholder')}
          />
          <p className="mt-1 text-xs text-gray-400">{t('nameHint')}</p>
        </FormRow>
        <FormRow label={t('rank')}>
          <Select value={inviteRank} onChange={(e) => setInviteRank(e.target.value)}>
            {RANKS.map((r) => (
              <option key={r} value={r}>
                {t(`rankName.${r}`)}
              </option>
            ))}
          </Select>
        </FormRow>
        <FormRow label={t('roles')}>
          <LabelCheckboxes
            labels={labels}
            selected={inviteCodes}
            onToggle={(code) => setInviteCodes((prev) => toggle(prev, code))}
          />
        </FormRow>
        <FormRow label={t('region')}>
          <RegionSelect value={inviteRegion} onChange={setInviteRegion} />
        </FormRow>
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t('editUser')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {tc('cancel')}
            </Button>
            <Button onClick={onUpdate} disabled={updateUser.isPending}>
              {updateUser.isPending ? tc('saving') : tc('save')}
            </Button>
          </>
        }
      >
        <FormRow label={t('name')}>
          <Input
            value={editName}
            maxLength={80}
            disabled={!canNameStaff}
            onChange={(e) => setEditName(e.target.value)}
            placeholder={t('namePlaceholder')}
          />
          <p className="mt-1 text-xs text-gray-400">{t('nameHint')}</p>
        </FormRow>
        <FormRow label={t('rank')}>
          <Select value={editRank} onChange={(e) => setEditRank(e.target.value)}>
            {RANKS.map((r) => (
              <option key={r} value={r}>
                {t(`rankName.${r}`)}
              </option>
            ))}
          </Select>
        </FormRow>
        <FormRow label={t('roles')}>
          <LabelCheckboxes
            labels={labels}
            selected={editCodes}
            onToggle={(code) => setEditCodes((prev) => toggle(prev, code))}
          />
        </FormRow>
        <FormRow label={t('region')}>
          <RegionSelect value={editRegion} onChange={setEditRegion} />
        </FormRow>
        <FormRow label={t('status')}>
          <Select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statusName.${s}`)}
              </option>
            ))}
          </Select>
        </FormRow>
      </Modal>

      <RoleNamesModal open={roleNamesOpen} onClose={() => setRoleNamesOpen(false)} labels={labels} />

      <Modal
        open={tempPwTarget !== null}
        onClose={() => setTempPwTarget(null)}
        title={t('issueTempPassword')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTempPwTarget(null)}>
              {tc('cancel')}
            </Button>
            <Button onClick={confirmIssueTempPw} disabled={issueTempPw.isPending}>
              {t('tempPwIssue')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          {t('tempPwConfirm')}{' '}
          <span className="font-medium text-gray-900">{tempPwTarget?.email}</span>
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={tempPwSendEmail}
            onChange={(e) => setTempPwSendEmail(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          {t('tempPwSendEmail')}
        </label>
      </Modal>

      <Modal
        open={tempResult !== null}
        onClose={() => setTempResult(null)}
        title={t('tempPwTitle')}
        footer={
          <Button onClick={() => setTempResult(null)}>{tc('close')}</Button>
        }
      >
        {tempResult && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {t('tempPwFor')} <span className="font-medium text-gray-900">{tempResult.email}</span>
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 select-all rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-base text-gray-900">
                {tempResult.tempPassword}
              </code>
              <Button variant="secondary" size="sm" onClick={copyTempPw} aria-label={t('copy')}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-1">{copied ? t('copied') : t('copy')}</span>
              </Button>
            </div>
            {tempResult.emailSent === true && (
              <p className="text-sm text-emerald-700">{t('tempPwEmailSent')}</p>
            )}
            {tempResult.emailSent === false && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {t('tempPwEmailFailed')}
              </p>
            )}
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t('tempPwDesc')}
            </p>
            <p className="text-sm text-emerald-700">{t('tempPwLockReset')}</p>
          </div>
        )}
      </Modal>

      <Modal
        open={mfaResetTarget !== null}
        onClose={() => setMfaResetTarget(null)}
        title={t('mfaResetTitle')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMfaResetTarget(null)}>
              {tc('cancel')}
            </Button>
            <Button variant="danger" onClick={onResetMfa} disabled={resetMfa.isPending}>
              {t('mfaReset')}
            </Button>
          </>
        }
      >
        {mfaResetTarget && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {t('mfaResetConfirm', { email: mfaResetTarget.email })}
            </p>
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>{t('mfaResetWarning')}</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
