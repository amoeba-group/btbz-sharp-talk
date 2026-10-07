import { useTranslation } from 'react-i18next';
import { Badge } from './Badge';

/** Engine states both consoles show (PLN-261007 §1) — the server decides, this only labels. */
export type EngineHealthValue =
  | 'ok'
  | 'unknown'
  | 'no_key'
  | 'stub'
  | 'disabled'
  | 'credit'
  | 'auth'
  | 'model'
  | 'rate_limit'
  | 'unreachable';

const TONE: Record<EngineHealthValue, 'success' | 'warning' | 'error' | 'gray' | 'info'> = {
  ok: 'success',
  unknown: 'gray',
  stub: 'gray',
  disabled: 'gray',
  no_key: 'warning',
  rate_limit: 'warning',
  credit: 'error',
  auth: 'error',
  model: 'error',
  unreachable: 'error',
};

export function EngineHealthBadge({ health }: { health: string }) {
  const { t } = useTranslation('aiEngines');
  const h = (health in TONE ? health : 'unknown') as EngineHealthValue;
  return <Badge tone={TONE[h]}>{t(`health.${h}`)}</Badge>;
}

/** States in which the engine cannot answer — what the warning banners count. */
export function isEngineFailing(health: string): boolean {
  return ['credit', 'auth', 'model', 'unreachable', 'no_key'].includes(health);
}

/** Local short date-time for "last ok / last error" columns. */
export function shortTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(
    d.getHours(),
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
