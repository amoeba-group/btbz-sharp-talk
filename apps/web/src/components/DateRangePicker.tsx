import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/Field';
import { cn } from '@/lib/cn';

/**
 * The window every statistics screen is read through (PLN-260920b).
 *
 * Presets first, dates second: "last 30 days" is what an operator actually
 * asks, and making them type two dates for the common case is the reason the
 * existing filter got used at its default and nowhere else. Custom stays, for
 * the month-end question that presets cannot express.
 *
 * Shared rather than copied because the admin overview and the tenant console
 * must agree on what "last 7 days" means — two implementations would quietly
 * disagree on whether today counts.
 */
export type RangePreset = 'd7' | 'd30' | 'd90' | 'custom';

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/** Inclusive of today, so "7 days" is today plus the six before it. */
export function rangeFor(preset: Exclude<RangePreset, 'custom'>): { from: string; to: string } {
  const today = new Date();
  const days = preset === 'd7' ? 7 : preset === 'd30' ? 30 : 90;
  const from = new Date(today);
  from.setDate(from.getDate() - (days - 1));
  return { from: ymd(from), to: ymd(today) };
}

export interface DateRange {
  from: string;
  to: string;
}

/**
 * Keeps the preset and the resolved dates together so a caller only has to
 * hold one piece of state.
 */
export function useDateRange(initial: Exclude<RangePreset, 'custom'> = 'd30') {
  const [preset, setPreset] = useState<RangePreset>(initial);
  const [custom, setCustom] = useState<DateRange>(() => rangeFor(initial));
  const range = useMemo<DateRange>(
    () => (preset === 'custom' ? custom : rangeFor(preset)),
    [preset, custom],
  );
  return { preset, setPreset, custom, setCustom, range };
}

interface Props extends ReturnType<typeof useDateRange> {
  className?: string;
}

export function DateRangePicker({ preset, setPreset, custom, setCustom, range, className }: Props) {
  const { t } = useTranslation('common');
  const presets: Exclude<RangePreset, 'custom'>[] = ['d7', 'd30', 'd90'];

  return (
    <div className={cn('flex flex-wrap items-end gap-3', className)}>
      <div className="flex gap-1">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPreset(p)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              preset === p
                ? 'border-primary-500 bg-primary-50 text-primary-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50',
            )}
          >
            {t(`range.${p}`)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            // Seed the custom fields from whatever is on screen, so switching
            // to "custom" never blanks the range the operator was just reading.
            setCustom(range);
            setPreset('custom');
          }}
          className={cn(
            'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
            preset === 'custom'
              ? 'border-primary-500 bg-primary-50 text-primary-700'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50',
          )}
        >
          {t('range.custom')}
        </button>
      </div>

      {preset === 'custom' && (
        <div className="flex items-end gap-2">
          <Input
            type="date"
            aria-label={t('range.from')}
            value={custom.from}
            max={custom.to}
            onChange={(e) => setCustom({ ...custom, from: e.target.value })}
            className="w-40"
          />
          <span className="pb-2 text-gray-400">–</span>
          <Input
            type="date"
            aria-label={t('range.to')}
            value={custom.to}
            min={custom.from}
            onChange={(e) => setCustom({ ...custom, to: e.target.value })}
            className="w-40"
          />
        </div>
      )}
    </div>
  );
}
