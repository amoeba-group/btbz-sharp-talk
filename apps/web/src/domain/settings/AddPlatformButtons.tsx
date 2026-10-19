import { Check, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import type { PlatformConnection } from './platform-connections.hooks';
import type { PlatformChoice } from './integration-providers';

/**
 * "Add a platform" row (PLN-261019 D3): every supported platform as a chip.
 * A platform that already has a credential is ticked and inert — its card
 * above is where it is managed — so the row reads as "what else could I add".
 */
export function AddPlatformButtons({
  connections,
  onAdd,
}: {
  connections: PlatformConnection[];
  onAdd: (provider: PlatformChoice) => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <div className="flex flex-wrap gap-2">
      {connections.map((c) => (
        <button
          key={c.provider}
          type="button"
          disabled={c.configured}
          title={c.configured ? t('platforms.alreadyAdded') : undefined}
          onClick={() => onAdd(c.provider)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
            c.configured
              ? 'cursor-default border-success/30 bg-success/5 text-success'
              : 'border-gray-200 bg-white text-gray-700 hover:border-primary-300 hover:text-primary-700',
          )}
        >
          {c.configured ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {t(`integrations.${c.provider}.title`)}
        </button>
      ))}
    </div>
  );
}
