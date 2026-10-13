import { useTranslation } from 'react-i18next';
import { Input, Label, Select } from '@/components/Field';
import { cn } from '@/lib/cn';
// Source-path imports: a value import of the package entry point breaks the browser build (CJS).
import { LANGUAGE_TIMEZONES } from '../../../../../packages/types/src/common/language';
import type { HoursDraft } from '../../../../../packages/types/src/common/handoff-hours';

const DAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * Picker zones = every language's registry zone (Seoul, New York, Ho Chi Minh,
 * Tokyo, Shanghai, Madrid …) + the remaining US zones + UTC. The server accepts
 * any IANA zone; a stored value outside this list is kept as the first option
 * so saving never silently rewrites it (REQ-260913-VN-Prerequisite-Gaps G3).
 */
export const TIMEZONES = Array.from(
  new Set([...LANGUAGE_TIMEZONES.map((z) => z.zone), 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC']),
).sort();
const TZ_LABEL = new Map(LANGUAGE_TIMEZONES.map((z) => [z.zone, z.label]));

const toggle = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

/**
 * One set of business hours: the tenant-wide hours and a team's own override share this editor
 * (PLN-261012 SG-67). The leading checkbox turns the hours on (for a team: overrides the shared
 * hours); everything below it edits a `HoursDraft`, whose round trip to the stored shape is
 * `hoursDraftFrom` / `hoursConfigFrom` in packages/types — pure and unit-tested.
 */
export function BusinessHoursEditor({
  value,
  onChange,
  toggleLabel,
  compact = false,
}: {
  value: HoursDraft;
  onChange: (next: HoursDraft) => void;
  /** Label of the on/off checkbox. */
  toggleLabel: string;
  /** Tighter spacing, for the per-team editor inside a row. */
  compact?: boolean;
}) {
  const { t } = useTranslation('aiSetting');
  const set = (patch: Partial<HoursDraft>) => onChange({ ...value, ...patch });
  const zones = TIMEZONES.includes(value.timezone) ? TIMEZONES : [value.timezone, ...TIMEZONES];

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={value.on}
          onChange={(e) => set({ on: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
        />
        {toggleLabel}
      </label>

      {value.on && (
        <div className={cn('space-y-2', compact ? 'pl-2' : 'pl-6')}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px]">
              <Label>{t('handoff.timezone')}</Label>
              <Select value={value.timezone} onChange={(e) => set({ timezone: e.target.value })}>
                {zones.map((tz) => (
                  <option key={tz} value={tz}>
                    {TZ_LABEL.has(tz) ? `${tz} — ${TZ_LABEL.get(tz)}` : tz}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-28">
              <Label>{t('handoff.start')}</Label>
              <Input type="time" value={value.start} onChange={(e) => set({ start: e.target.value })} />
            </div>
            <div className="w-28">
              <Label>{t('handoff.end')}</Label>
              <Input type="time" value={value.end} onChange={(e) => set({ end: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={value.breakOn}
                onChange={(e) => set({ breakOn: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
              />
              {t('handoff.useBreak')}
            </label>
            {value.breakOn && (
              <>
                <div className="w-28">
                  <Label>{t('handoff.breakStart')}</Label>
                  <Input type="time" value={value.breakStart} onChange={(e) => set({ breakStart: e.target.value })} />
                </div>
                <div className="w-28">
                  <Label>{t('handoff.breakEnd')}</Label>
                  <Input type="time" value={value.breakEnd} onChange={(e) => set({ breakEnd: e.target.value })} />
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
                  onClick={() => set({ days: toggle(value.days, d) })}
                  className={cn(
                    'h-8 w-9 rounded border text-xs',
                    value.days.includes(d)
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
  );
}
