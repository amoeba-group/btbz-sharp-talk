import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { FormRow, Input } from '@/components/Field';
import { Modal } from '@/components/Modal';
import { cn } from '@/lib/cn';
import { ConversationTranscript } from '../history/ConversationTranscript';
import { useAddHotel, useCompany, useSyncCompany, useUpdateCompanyProfile } from './customers.hooks';
import type { CompanyDetail, CompanyPartnerInfo, CompanyProfileUpdate, CompanyRoom } from './customers.service';

function fmtDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

const vnd = new Intl.NumberFormat('vi-VN');
const money = (v: number | null | undefined) => (typeof v === 'number' ? `${vnd.format(v)}đ` : '—');

type Tab = 'info' | 'rooms' | 'contacts' | 'conversations';

/** HA room status codes (PLN-261023): 1 selling, 4 rejected, 5 stopped. */
function haStatusKey(code: number | null | undefined): string {
  return code === 1 ? 'selling' : code === 4 ? 'rejected' : code === 5 ? 'stopped' : 'other';
}

/**
 * Business customer (hotel) detail (PLN-261023 wireframe 3.1): Go2Joy Partner
 * values read-only, operator-entered profile editable in place, room types,
 * contacts and conversations as tabs. Opened from the list or a deep link.
 */
export function CompanyDetailModal({
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
  const sync = useSyncCompany();
  const [tab, setTab] = useState<Tab>('info');
  const [conversationId, setConversationId] = useState<string | null>(null);
  useEffect(() => {
    setConversationId(null);
    setTab('info');
  }, [id]);
  const isHotel = !!data?.externalKey.startsWith('hotel:');

  const tabs: Array<[Tab, string]> = [
    ['info', t('companyTabInfo')],
    ['rooms', t('companyTabRooms', { count: data?.rooms.length ?? 0 })],
    ['contacts', t('companyTabContacts', { count: data?.contacts.length ?? 0 })],
    ['conversations', t('companyTabConversations', { count: data?.conversationCount ?? 0 })],
  ];

  return (
    <Modal
      open={!!id}
      onClose={onClose}
      size="lg"
      title={data?.name ?? data?.externalKey ?? t('companyDetail')}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {isHotel && !conversationId ? (
            <Button variant="secondary" size="sm" disabled={sync.isPending} onClick={() => data && sync.mutate(data.id)}>
              <RefreshCw className={cn('mr-1 h-4 w-4', sync.isPending && 'animate-spin')} aria-hidden="true" />
              {t('companySyncNow')}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="ghost" onClick={conversationId ? () => setConversationId(null) : onClose}>
            {conversationId ? t('companyBack') : closeLabel}
          </Button>
        </div>
      }
    >
      {isLoading && <p className="text-sm text-gray-400">{t('companyLoading')}</p>}
      {error && <p className="text-sm text-error">{(error as Error).message}</p>}
      {data && conversationId && <ConversationTranscript conversationId={conversationId} />}
      {data && !conversationId && (
        <div className="space-y-4 text-sm">
          <p className="text-gray-600">
            <span className="font-mono text-xs text-gray-500">{data.externalKey}</span>
            {data.profile.code && <> · {data.profile.code}</>}
            {' · '}
            {regionLabel(data.region)}
            {' · '}
            {[data.province, data.profile.district].filter(Boolean).join(' / ') || '—'}
          </p>
          {isHotel && <SyncState data={data} />}
          <div className="flex gap-1 border-b border-gray-200" role="tablist">
            {tabs.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm',
                  tab === key ? 'border-primary-500 font-medium text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'info' && <InfoTab data={data} />}
          {tab === 'rooms' && <RoomsTab rooms={data.rooms} />}
          {tab === 'contacts' && (
            <List empty={data.contacts.length === 0}>
              {data.contacts.map((c) => (
                <li key={c.customerId} className="flex items-center justify-between px-3 py-2">
                  <span>{c.name ?? `#${c.customerId}`}</span>
                  <span className="text-xs text-gray-500">
                    {c.role ?? '—'} · {fmtDateTime(c.lastSeenAt)}
                  </span>
                </li>
              ))}
            </List>
          )}
          {tab === 'conversations' && (
            <List empty={data.conversations.length === 0}>
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
            </List>
          )}
        </div>
      )}
    </Modal>
  );
}

function List({ empty, children }: { empty: boolean; children: ReactNode }) {
  if (empty) return <p className="text-xs text-gray-400">—</p>;
  return <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">{children}</ul>;
}

function SyncState({ data }: { data: CompanyDetail }) {
  const { t } = useTranslation('customers');
  if (data.partnerSyncError) {
    return <p className="text-xs text-error">{t('companySyncError', { error: data.partnerSyncError })}</p>;
  }
  return (
    <p className="text-xs text-gray-500">
      {data.partnerSyncedAt ? t('companySyncedAt', { at: fmtDateTime(data.partnerSyncedAt) }) : t('companyNotSynced')}
    </p>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 py-1">
      <dt className="text-gray-500">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-gray-800">{children}</dd>
    </div>
  );
}

function hoursText(p: CompanyPartnerInfo, t: (k: string, o?: Record<string, unknown>) => string): string {
  const part = (key: 'hourly' | 'overnight' | 'daily') => {
    const w = p[key];
    if (!w?.enabled) return null;
    return `${t(`hours_${key}`)} ${w.start ?? '?'}–${w.end ?? '?'}`;
  };
  return [part('hourly'), part('overnight'), part('daily')].filter(Boolean).join(' · ') || '—';
}

function InfoTab({ data }: { data: CompanyDetail }) {
  const { t } = useTranslation('customers');
  const [editing, setEditing] = useState(false);
  const p = data.profile;
  const yesNo = (v: boolean | null) => (v == null ? '—' : v ? t('yes') : t('no'));
  const pi = data.partnerInfo;

  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-1 text-xs font-semibold text-gray-500">{t('companyFromGo2Joy')}</h3>
        {pi ? (
          <dl>
            <Row label={t('field_hours')}>
              {hoursText(pi, t)}
              {pi.firstHours != null && <span className="ml-2 text-xs text-gray-500">{t('firstHours', { n: pi.firstHours })}</span>}
            </Row>
            {pi.rightNowTonight && (
              <Row label={t('field_rightNowTonight')}>
                {t('rightNowTonightText', { start: pi.rightNowTonight.start, end: pi.rightNowTonight.end })}
              </Row>
            )}
            {pi.cancellation && (
              <Row label={t('field_cancellation')}>
                {t('cancellationText', {
                  hourly: pi.cancellation.hourlyMinutes ?? '—',
                  overnight: pi.cancellation.overnightMinutes ?? '—',
                  daily: pi.cancellation.dailyMinutes ?? '—',
                  after: pi.cancellation.afterBookingMinutes ?? '—',
                })}
              </Row>
            )}
            {pi.cancelBeforeHours != null && (
              <Row label={t('field_cancelBefore')}>{t('cancelBeforeText', { n: pi.cancelBeforeHours })}</Row>
            )}
          </dl>
        ) : (
          <p className="text-xs text-gray-400">{t('companyNoPartnerData')}</p>
        )}
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-500">{t('companyEntered')}</h3>
          {!editing && (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              {t('companyEdit')}
            </Button>
          )}
        </div>
        {editing ? (
          <ProfileForm data={data} onDone={() => setEditing(false)} />
        ) : (
          <dl>
            <Row label={t('field_code')}>{p.code ?? '—'}</Row>
            <Row label={t('field_groupName')}>{p.groupName ?? '—'}</Row>
            <Row label={t('field_phone')}>{p.phone ?? '—'}</Row>
            <Row label={t('field_provinceDistrict')}>{[data.province, p.district].filter(Boolean).join(' / ') || '—'}</Row>
            <Row label={t('field_address')}>{p.address ?? '—'}</Row>
            <Row label={t('field_flags')}>
              {t('flagsText', { promotion: yesNo(p.promotion), hot: yesNo(p.hot), isNew: yesNo(p.isNew) })}
            </Row>
            <Row label={t('field_contract')}>
              {p.contractStart ?? '—'} ~ {p.contractEnd ?? '—'}
            </Row>
            <Row label={t('field_payment')}>{p.payment ?? '—'}</Row>
            <Row label={t('field_hotelType')}>{p.hotelType ?? '—'}</Row>
            <Row label={t('field_enterpriseName')}>{p.enterpriseName ?? '—'}</Row>
            <Row label={t('field_enterpriseRegNo')}>{p.enterpriseRegNo ?? '—'}</Row>
            <Row label={t('field_extraFee')}>{yesNo(p.extraFee)}</Row>
            <Row label={t('field_descriptionEn')}>{p.descriptionEn ?? '—'}</Row>
            <Row label={t('field_descriptionVi')}>{p.descriptionVi ?? '—'}</Row>
            <Row label={t('field_policyEn')}>{p.policyEn ?? '—'}</Row>
            <Row label={t('field_policyVi')}>{p.policyVi ?? '—'}</Row>
            {p.updatedAt && (
              <p className="mt-2 text-right text-xs text-gray-400">
                {t('companyUpdated', { at: fmtDateTime(p.updatedAt), by: p.updatedBy ?? '—' })}
              </p>
            )}
          </dl>
        )}
      </section>
    </div>
  );
}

const TEXT_FIELDS = [
  ['code', 'field_code'],
  ['group_name', 'field_groupName'],
  ['phone', 'field_phone'],
  ['province', 'field_province'],
  ['district', 'field_district'],
  ['address', 'field_address'],
  ['payment', 'field_payment'],
  ['hotel_type', 'field_hotelType'],
  ['enterprise_name', 'field_enterpriseName'],
  ['enterprise_reg_no', 'field_enterpriseRegNo'],
] as const;
const DATE_FIELDS = [
  ['contract_start', 'field_contractStart'],
  ['contract_end', 'field_contractEnd'],
] as const;
const BOOL_FIELDS = [
  ['promotion', 'field_promotion'],
  ['hot', 'field_hot'],
  ['is_new', 'field_isNew'],
  ['extra_fee', 'field_extraFee'],
] as const;
const LONG_FIELDS = [
  ['description_en', 'field_descriptionEn'],
  ['description_vi', 'field_descriptionVi'],
  ['policy_en', 'field_policyEn'],
  ['policy_vi', 'field_policyVi'],
] as const;

type FormState = Record<string, string | boolean | null>;

function initialForm(data: CompanyDetail): FormState {
  const p = data.profile;
  return {
    code: p.code ?? '',
    group_name: p.groupName ?? '',
    phone: p.phone ?? '',
    province: data.province ?? '',
    district: p.district ?? '',
    address: p.address ?? '',
    payment: p.payment ?? '',
    hotel_type: p.hotelType ?? '',
    enterprise_name: p.enterpriseName ?? '',
    enterprise_reg_no: p.enterpriseRegNo ?? '',
    contract_start: p.contractStart ?? '',
    contract_end: p.contractEnd ?? '',
    promotion: p.promotion,
    hot: p.hot,
    is_new: p.isNew,
    extra_fee: p.extraFee,
    description_en: p.descriptionEn ?? '',
    description_vi: p.descriptionVi ?? '',
    policy_en: p.policyEn ?? '',
    policy_vi: p.policyVi ?? '',
  };
}

function ProfileForm({ data, onDone }: { data: CompanyDetail; onDone: () => void }) {
  const { t } = useTranslation('customers');
  const { t: tc } = useTranslation('common');
  const save = useUpdateCompanyProfile();
  const [form, setForm] = useState<FormState>(() => initialForm(data));
  const set = (k: string, v: string | boolean | null) => setForm((f) => ({ ...f, [k]: v }));

  const onSave = () => {
    // Send only what changed; '' clears on the server.
    const before = initialForm(data);
    const body: Record<string, string | boolean | null> = {};
    for (const [k, v] of Object.entries(form)) if (v !== before[k]) body[k] = v === '' ? null : v;
    if (!Object.keys(body).length) return onDone();
    save.mutate({ id: data.id, body: body as CompanyProfileUpdate }, { onSuccess: onDone });
  };

  const triState = (k: string) => (
    <select
      value={form[k] == null ? '' : form[k] ? 'yes' : 'no'}
      onChange={(e) => set(k, e.target.value === '' ? null : e.target.value === 'yes')}
      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
    >
      <option value="">—</option>
      <option value="yes">{t('yes')}</option>
      <option value="no">{t('no')}</option>
    </select>
  );

  return (
    <div>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        {TEXT_FIELDS.map(([k, label]) => (
          <FormRow key={k} label={t(label)}>
            <Input value={String(form[k] ?? '')} onChange={(e) => set(k, e.target.value)} />
          </FormRow>
        ))}
        {DATE_FIELDS.map(([k, label]) => (
          <FormRow key={k} label={t(label)}>
            <Input type="date" value={String(form[k] ?? '')} onChange={(e) => set(k, e.target.value)} />
          </FormRow>
        ))}
        {BOOL_FIELDS.map(([k, label]) => (
          <FormRow key={k} label={t(label)}>
            {triState(k)}
          </FormRow>
        ))}
      </div>
      {LONG_FIELDS.map(([k, label]) => (
        <FormRow key={k} label={t(label)}>
          <textarea
            rows={3}
            value={String(form[k] ?? '')}
            onChange={(e) => set(k, e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          />
        </FormRow>
      ))}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={save.isPending}>
          {tc('cancel')}
        </Button>
        <Button onClick={onSave} disabled={save.isPending}>
          {tc('save')}
        </Button>
      </div>
    </div>
  );
}

function RoomsTab({ rooms }: { rooms: CompanyRoom[] }) {
  const { t } = useTranslation('customers');
  if (!rooms.length) return <p className="text-xs text-gray-400">{t('companyNoRooms')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-gray-500">
          <tr>
            <th className="py-2 pr-3">{t('room_name')}</th>
            <th className="py-2 pr-3">{t('room_count')}</th>
            <th className="py-2 pr-3">{t('room_hourly')}</th>
            <th className="py-2 pr-3">{t('room_overnight')}</th>
            <th className="py-2 pr-3">{t('room_daily')}</th>
            <th className="py-2">{t('room_status')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rooms.map((r) => {
            const a = r.attributes;
            const key = haStatusKey(a?.haStatus);
            return (
              <tr key={r.handle}>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    {r.imageUrl && <img src={r.imageUrl} alt="" className="h-8 w-8 rounded object-cover" />}
                    <span>{r.title}</span>
                  </div>
                </td>
                <td className="py-2 pr-3">{a?.roomCount ?? '—'}</td>
                <td className="py-2 pr-3">
                  {a?.prices.firstHours != null || a?.prices.additional != null
                    ? `${money(a?.prices.firstHours)} / ${money(a?.prices.additional)}`
                    : '—'}
                </td>
                <td className="py-2 pr-3">{money(a?.prices.overnight)}</td>
                <td className="py-2 pr-3">{money(a?.prices.oneDay)}</td>
                <td className="py-2">
                  <Badge tone={key === 'selling' ? 'success' : key === 'rejected' ? 'error' : 'gray'}>
                    {t(`haStatus_${key}`, { code: a?.haStatus ?? '?' })}
                  </Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-gray-400">{t('roomsHint')}</p>
    </div>
  );
}

/** "Add hotel" (PLN-261023 wireframe 3.2): a Go2Joy hotel number, confirmed by the Partner API. */
export function AddHotelModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (id: string) => void }) {
  const { t } = useTranslation('customers');
  const { t: tc } = useTranslation('common');
  const add = useAddHotel();
  const [value, setValue] = useState('');
  useEffect(() => {
    if (open) setValue('');
  }, [open]);
  const sn = /^\d{1,10}$/.test(value.trim()) ? Number(value.trim()) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('addHotel')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={add.isPending}>
            {tc('cancel')}
          </Button>
          <Button
            disabled={!sn || add.isPending}
            onClick={() => sn && add.mutate(sn, { onSuccess: (d) => onAdded(d.id) })}
          >
            {t('addHotelConfirm')}
          </Button>
        </>
      }
    >
      <FormRow label={t('hotelSn')}>
        <Input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="4118" autoFocus />
      </FormRow>
      <p className="text-xs text-gray-500">{t('addHotelHint')}</p>
    </Modal>
  );
}
