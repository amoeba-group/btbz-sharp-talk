import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Label, Select } from '@/components/Field';
import { cn } from '@/lib/cn';
import { useUsers } from '../users/users.hooks';
import { useAiConfig, useUpdateAiConfig } from './ai-settings.hooks';
import { LanguageTabs } from './LanguageTabs';
import { DENY_MODE } from './ai-settings.service';
import type { DenyMode, HandoffConfig, ScenarioLang } from './ai-settings.service';
// Source-path import: a value import of the package entry point breaks the browser build (CJS).
import { LANGUAGE_TIMEZONES } from '../../../../../packages/types/src/common/language';

const DAYS = [0, 1, 2, 3, 4, 5, 6];
/**
 * Picker zones = every language's registry zone (Seoul, New York, Ho Chi Minh,
 * Tokyo, Shanghai, Madrid …) + the remaining US zones + UTC. The server accepts
 * any IANA zone; a stored value outside this list is kept as the first option
 * so saving never silently rewrites it (REQ-260913-VN-Prerequisite-Gaps G3).
 */
const TIMEZONES = Array.from(
  new Set([...LANGUAGE_TIMEZONES.map((z) => z.zone), 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC']),
).sort();
const TZ_LABEL = new Map(LANGUAGE_TIMEZONES.map((z) => [z.zone, z.label]));

/** One team the customer can pick (PLN-261007 Team Routing). */
interface TeamRow {
  id: string;
  jobLabel: string;
  label: Partial<Record<ScenarioLang, string>>;
}
const TEAM_OPTIONS_MAX = 4;
/** Seed on first enable — the pair Go2Joy asked for; the API holds the wording. */
const DEFAULT_TEAM_ROWS: TeamRow[] = [
  { id: 'cs', jobLabel: 'consult', label: {} },
  { id: 'business', jobLabel: 'sales_admin', label: {} },
];

/**
 * Escalation routing (PLN-AiSetting W3): who gets paged, when agents are on
 * duty, and what happens (plus what the shopper is told) outside those hours.
 */
export function HandoffSection() {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  const { data: config, isLoading, error } = useAiConfig();
  const updateConfig = useUpdateAiConfig();
  const users = useUsers();

  const [assignees, setAssignees] = useState<string[]>([]);
  const [hoursOn, setHoursOn] = useState(false);
  const [timezone, setTimezone] = useState(TIMEZONES[0]);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('18:00');
  // One break window (lunch) is what tenants actually configure; the stored
  // shape is a list so a second one needs no schema change (PLN-260806 D2).
  const [breakOn, setBreakOn] = useState(false);
  const [breakStart, setBreakStart] = useState('12:00');
  const [breakEnd, setBreakEnd] = useState('13:00');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<Partial<Record<ScenarioLang, string>>>({});
  const [lang, setLang] = useState<ScenarioLang>('KO');
  // Policy deny-list rows (P2) — keywords edited as a comma-joined string.
  const [denyRows, setDenyRows] = useState<
    Array<{ keywords: string; type: string; label: string; mode: DenyMode }>
  >(
    [],
  );
  // Issue-board SLA targets (B2) — string state, validated on save (1..168h).
  const [slaNormal, setSlaNormal] = useState('24');
  const [slaUrgent, setSlaUrgent] = useState('4');
  // Team question (PLN-261007 Team Routing): asked only after the customer
  // requests a human. Rows are edited per language through the shared tab.
  const [teamOn, setTeamOn] = useState(false);
  const [teamPrompt, setTeamPrompt] = useState<Partial<Record<ScenarioLang, string>>>({});
  const [teamRows, setTeamRows] = useState<TeamRow[]>([]);

  useEffect(() => {
    const h = config?.handoffConfig;
    if (!h) return;
    setAssignees((h.assigneeUserIds ?? []).map(String));
    if (h.businessHours) {
      setHoursOn(true);
      setTimezone(h.businessHours.timezone || TIMEZONES[0]);
      setDays(h.businessHours.days ?? [1, 2, 3, 4, 5]);
      setStart(h.businessHours.start || '09:00');
      setEnd(h.businessHours.end || '18:00');
      const firstBreak = h.businessHours.breaks?.[0];
      if (firstBreak) {
        setBreakOn(true);
        setBreakStart(firstBreak.start || '12:00');
        setBreakEnd(firstBreak.end || '13:00');
      }
    }
    setEmail(h.offHours?.email ?? '');
    setNotice(h.offHours?.notice ?? {});
    setDenyRows(
      (h.denyRules ?? []).map((r) => ({
        keywords: (r.keywords ?? []).join(', '),
        type: r.type ?? 'other',
        label: r.label ?? 'consult',
        // Absent — or anything not one of the two — means silent: the
        // behaviour its author picked, and the only safe reading here.
        mode: r.mode === DENY_MODE.ANSWER_THEN_HANDOFF ? r.mode : DENY_MODE.SILENT,
      })),
    );
    if (h.sla?.normalHours != null) setSlaNormal(String(h.sla.normalHours));
    if (h.sla?.urgentHours != null) setSlaUrgent(String(h.sla.urgentHours));
    setTeamOn(h.teamRouting?.enabled === true);
    setTeamPrompt(h.teamRouting?.prompt ?? {});
    setTeamRows(
      (h.teamRouting?.options ?? []).map((o) => ({
        id: o.id ?? '',
        jobLabel: o.jobLabel ?? 'consult',
        label: o.label ?? {},
      })),
    );
  }, [config]);

  // Only consult-label agents handle conversations, so only they can be assigned.
  const agents = (users.data ?? []).filter(
    (u) => u.labelCodes?.includes('consult') && u.status !== 'inactive',
  );

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const save = () => {
    const handoff: HandoffConfig = {
      assigneeUserIds: assignees.map(Number).filter(Number.isFinite),
      ...(hoursOn
        ? {
            businessHours: {
              timezone,
              days,
              start,
              end,
              // Written even when empty: the console owns the whole config
              // object, so omitting the key would silently drop a stored break.
              breaks: breakOn ? [{ start: breakStart, end: breakEnd }] : [],
            },
          }
        : {}),
      ...(email.trim() || Object.keys(notice).length
        ? { offHours: { email: email.trim() || undefined, notice } }
        : {}),
    };
    const denyRules = denyRows
      .map((r) => ({
        keywords: r.keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
        type: r.type,
        label: r.label,
        mode: r.mode,
      }))
      .filter((r) => r.keywords.length > 0);
    if (denyRules.length) handoff.denyRules = denyRules;
    const clamp = (v: string, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 1 && n <= 168 ? n : fallback;
    };
    handoff.sla = { normalHours: clamp(slaNormal, 24), urgentHours: clamp(slaUrgent, 4) };
    // Rows are kept even while disabled, so switching the question off and on
    // again does not lose the labels a tenant translated.
    const teamOptions = teamRows
      .map((r) => ({ id: r.id.trim(), jobLabel: r.jobLabel, label: r.label }))
      .filter((r) => r.id.length > 0)
      .slice(0, TEAM_OPTIONS_MAX);
    if (teamOn || teamOptions.length || Object.keys(teamPrompt).length) {
      handoff.teamRouting = { enabled: teamOn, prompt: teamPrompt, options: teamOptions };
    }
    updateConfig.mutate({ handoff_config: handoff });
  };

  const enableTeam = (on: boolean) => {
    setTeamOn(on);
    // First switch-on seeds the CS / Business pair the feature was built for;
    // the labels stay blank so the API's built-in wording (six languages) shows.
    if (on && teamRows.length === 0) setTeamRows(DEFAULT_TEAM_ROWS.map((r) => ({ ...r, label: {} })));
  };

  const smtpWarning = hoursOn && !email.trim();

  return (
    <Card title={t('handoff.title')}>
      {isLoading && <p className="text-sm text-gray-400">{tc('loading')}</p>}
      {!isLoading && error && (
        <p className="text-sm text-error">{error instanceof Error ? error.message : tc('empty')}</p>
      )}
      {!isLoading && !error && (
        <div className="space-y-4">
          <div>
            <Label>{t('handoff.assignees')}</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {agents.length === 0 && (
                <p className="text-xs text-gray-400">{t('handoff.noAgents')}</p>
              )}
              {agents.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setAssignees((prev) => toggle(prev, u.id))}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs',
                    assignees.includes(u.id)
                      ? 'border-primary-500 bg-primary-500 text-white'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
                  )}
                >
                  {u.email}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-gray-400">{t('handoff.assigneesHint')}</p>
          </div>

          <div className="space-y-2 border-t border-gray-100 pt-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={hoursOn}
                onChange={(e) => setHoursOn(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
              />
              {t('handoff.useBusinessHours')}
            </label>

            {hoursOn && (
              <div className="space-y-2 pl-6">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[200px]">
                    <Label>{t('handoff.timezone')}</Label>
                    <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                      {(TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES]).map((tz) => (
                        <option key={tz} value={tz}>
                          {TZ_LABEL.has(tz) ? `${tz} — ${TZ_LABEL.get(tz)}` : tz}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-28">
                    <Label>{t('handoff.start')}</Label>
                    <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
                  </div>
                  <div className="w-28">
                    <Label>{t('handoff.end')}</Label>
                    <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={breakOn}
                      onChange={(e) => setBreakOn(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                    />
                    {t('handoff.useBreak')}
                  </label>
                  {breakOn && (
                    <>
                      <div className="w-28">
                        <Label>{t('handoff.breakStart')}</Label>
                        <Input
                          type="time"
                          value={breakStart}
                          onChange={(e) => setBreakStart(e.target.value)}
                        />
                      </div>
                      <div className="w-28">
                        <Label>{t('handoff.breakEnd')}</Label>
                        <Input
                          type="time"
                          value={breakEnd}
                          onChange={(e) => setBreakEnd(e.target.value)}
                        />
                      </div>
                      <p className="pb-2 text-xs text-gray-400">{t('handoff.breakHint')}</p>
                    </>
                  )}
                </div>
                <div>
                  <Label>{t('handoff.days')}</Label>
                  <div className="mt-1 flex gap-1">
                    {DAYS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDays((prev) => toggle(prev, d))}
                        className={cn(
                          'h-8 w-9 rounded border text-xs',
                          days.includes(d)
                            ? 'border-primary-500 bg-primary-500 text-white'
                            : 'border-gray-200 bg-white text-gray-600',
                        )}
                      >
                        {t(`handoff.day_${d}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2 border-t border-gray-100 pt-3">
            <Label>{t('handoff.offHoursEmail')}</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cs@example.com"
            />
            {smtpWarning && <p className="text-[11px] text-warning">{t('handoff.emailWarning')}</p>}

            <div className="flex items-center gap-2 pt-1">
              <Label>{t('handoff.offHoursNotice')}</Label>
              <LanguageTabs value={lang} onChange={setLang} filled={notice} />
            </div>
            <textarea
              rows={2}
              value={notice[lang] ?? ''}
              onChange={(e) => setNotice((prev) => ({ ...prev, [lang]: e.target.value }))}
              placeholder={t('handoff.noticePlaceholder')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500"
            />
          </div>

          {/* Issue-board SLA targets (B2) — drives the board's ⚠/🔥 badges. */}
          <div className="border-t border-gray-100 pt-4">
            <Label>{t('handoff.slaTitle')}</Label>
            <div className="mt-1 flex flex-wrap items-end gap-3">
              <div className="w-36">
                <Label>{t('handoff.slaNormal')}</Label>
                <Input
                  type="number"
                  min={1}
                  max={168}
                  value={slaNormal}
                  onChange={(e) => setSlaNormal(e.target.value)}
                />
              </div>
              <div className="w-36">
                <Label>{t('handoff.slaUrgent')}</Label>
                <Input
                  type="number"
                  min={1}
                  max={168}
                  value={slaUrgent}
                  onChange={(e) => setSlaUrgent(e.target.value)}
                />
              </div>
            </div>
            <p className="mt-1 text-[11px] text-gray-400">{t('handoff.slaHint')}</p>
          </div>

          {/* Policy deny-list (P2): matched topics skip the AI and go to a human. */}
          <div className="border-t border-gray-100 pt-4">
            <Label>{t('handoff.denyTitle')}</Label>
            <p className="mb-2 mt-0.5 text-[11px] text-gray-400">{t('handoff.denyHint')}</p>
            <p className="mb-2 text-[11px] text-gray-400">{t('handoff.denyModeHint')}</p>
            <div className="space-y-2">
              {denyRows.map((row, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Input
                    value={row.keywords}
                    placeholder={t('handoff.denyKeywordsPh')}
                    onChange={(e) =>
                      setDenyRows((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, keywords: e.target.value } : r)),
                      )
                    }
                  />
                  <Select
                    value={row.type}
                    onChange={(e) =>
                      setDenyRows((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, type: e.target.value } : r)),
                      )
                    }
                  >
                    {['order_status', 'delivery', 'cancel', 'refund', 'partnership', 'other'].map(
                      (v) => (
                        <option key={v} value={v}>
                          {t(`handoff.denyType.${v}`)}
                        </option>
                      ),
                    )}
                  </Select>
                  <Select
                    value={row.label}
                    onChange={(e) =>
                      setDenyRows((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)),
                      )
                    }
                  >
                    {['consult', 'sales_admin', 'accounting', 'operations'].map((v) => (
                      <option key={v} value={v}>
                        {t(`handoff.denyLabel.${v}`)}
                      </option>
                    ))}
                  </Select>
                  {/* Whether the customer hears anything while the agent is
                      paged (REQ-260826). The handoff happens either way. */}
                  <Select
                    aria-label={t('handoff.denyModeLabel')}
                    value={row.mode}
                    onChange={(e) =>
                      setDenyRows((rows) =>
                        rows.map((r, j) =>
                          j === i ? { ...r, mode: e.target.value as DenyMode } : r,
                        ),
                      )
                    }
                  >
                    {Object.values(DENY_MODE).map((v) => (
                      <option key={v} value={v}>
                        {t(`handoff.denyMode.${v}`)}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    className="text-xs font-medium text-red-500 hover:underline"
                    onClick={() => setDenyRows((rows) => rows.filter((_, j) => j !== i))}
                  >
                    {tc('delete')}
                  </button>
                </div>
              ))}
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() =>
                setDenyRows((rows) => [...rows, { keywords: '', type: 'other', label: 'consult', mode: DENY_MODE.SILENT }])
              }
            >
              {t('handoff.denyAdd')}
            </Button>
          </div>

          {/* Team question (PLN-261007): asked only after the customer requests a human. */}
          <div className="border-t border-gray-100 pt-4">
            <Label>{t('handoff.teamTitle')}</Label>
            <p className="mb-2 mt-0.5 text-[11px] text-gray-400">{t('handoff.teamHint')}</p>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={teamOn}
                onChange={(e) => enableTeam(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
              />
              {t('handoff.teamEnable')}
            </label>
            {teamOn && (
              <div className="mt-2 space-y-2 pl-6">
                <div className="flex items-center gap-2">
                  <Label>{t('handoff.teamPrompt')}</Label>
                  <LanguageTabs value={lang} onChange={setLang} filled={teamPrompt} />
                </div>
                <Input
                  value={teamPrompt[lang] ?? ''}
                  onChange={(e) => setTeamPrompt((prev) => ({ ...prev, [lang]: e.target.value }))}
                  placeholder={t('handoff.teamBlankHint')}
                />
                <div className="grid grid-cols-[6rem_1fr_10rem_auto] items-center gap-2 text-[11px] text-gray-400">
                  <span>{t('handoff.teamOptionId')}</span>
                  <span>{t('handoff.teamOptionLabel')}</span>
                  <span>{t('handoff.teamOptionRole')}</span>
                  <span />
                </div>
                {teamRows.map((row, i) => (
                  <div key={i} className="grid grid-cols-[6rem_1fr_10rem_auto] items-center gap-2">
                    <Input
                      value={row.id}
                      aria-label={t('handoff.teamOptionId')}
                      onChange={(e) =>
                        setTeamRows((rows) => rows.map((r, j) => (j === i ? { ...r, id: e.target.value } : r)))
                      }
                    />
                    <Input
                      value={row.label[lang] ?? ''}
                      aria-label={t('handoff.teamOptionLabel')}
                      placeholder={t('handoff.teamBlankHint')}
                      onChange={(e) =>
                        setTeamRows((rows) =>
                          rows.map((r, j) =>
                            j === i ? { ...r, label: { ...r.label, [lang]: e.target.value } } : r,
                          ),
                        )
                      }
                    />
                    <Select
                      value={row.jobLabel}
                      aria-label={t('handoff.teamOptionRole')}
                      onChange={(e) =>
                        setTeamRows((rows) =>
                          rows.map((r, j) => (j === i ? { ...r, jobLabel: e.target.value } : r)),
                        )
                      }
                    >
                      {['consult', 'sales_admin', 'accounting', 'operations'].map((v) => (
                        <option key={v} value={v}>
                          {t(`handoff.denyLabel.${v}`)}
                        </option>
                      ))}
                    </Select>
                    <button
                      type="button"
                      className="text-xs font-medium text-red-500 hover:underline"
                      onClick={() => setTeamRows((rows) => rows.filter((_, j) => j !== i))}
                    >
                      {tc('delete')}
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={teamRows.length >= TEAM_OPTIONS_MAX}
                    onClick={() =>
                      setTeamRows((rows) => [...rows, { id: '', jobLabel: 'consult', label: {} }])
                    }
                  >
                    {t('handoff.teamAdd')}
                  </Button>
                  <span className="text-[11px] text-gray-400">{t('handoff.teamMax')}</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button size="sm" disabled={updateConfig.isPending} onClick={save}>
              {t('save')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
