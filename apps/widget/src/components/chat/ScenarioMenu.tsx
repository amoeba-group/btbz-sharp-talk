import { useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircle, Headphones, MessageCircle, Package, RotateCcw, Truck, UserPlus } from 'lucide-react';
import type { ScenarioButton } from '../../lib/types';

/** Card style (PLN-260916 P4): a lucide icon per scenario action; unknown actions get the chat bubble. */
const ACTION_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  my_orders: Package,
  delivery_status: Truck,
  cancel_refund: RotateCcw,
  product_help: HelpCircle,
  contact_support: Headphones,
  affiliate: UserPlus,
};

/** Product Help submenu actions (client-only, not server-driven). */
export type SubAction = 'usage' | 'ingredients' | 'exchange' | 'restock';

/**
 * The opening menu and the Product Help submenu (PLN-260817 W-5, frames 54/60).
 *
 * These were bordered cards with a lucide icon each. The Master Shots use plain
 * chips — no icons — and split them by role: the opening menu is filled blue
 * (it is the primary thing to do on an empty thread), while submenu options are
 * quiet white pills that wrap.
 */
function MenuChip({
  label,
  onClick,
  variant,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  variant: 'primary' | 'quiet' | 'card';
  icon?: ComponentType<{ className?: string }>;
}) {
  if (variant === 'card') {
    // Outlined card with a leading icon (the IVY design, PLN-260916 P4).
    return (
      <button
        onClick={onClick}
        className="st-quick-reply flex items-center gap-2 rounded-st-lg border border-gray-200 bg-white px-3.5 py-2.5 text-left text-sm font-medium text-gray-800 transition-colors hover:border-primary-300 hover:bg-primary-50"
      >
        {Icon && <Icon className="h-4 w-4 flex-shrink-0 text-primary-600" />}
        <span className="min-w-0 truncate">{label}</span>
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className={
        variant === 'primary'
          ? 'st-quick-reply rounded-full bg-primary-100 px-4 py-2.5 text-center text-sm font-medium text-primary-700 transition-colors hover:bg-primary-200'
          : 'rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50'
      }
    >
      {label}
    </button>
  );
}

export function ScenarioMenu({
  buttons,
  onScenario,
  onSubAction,
  style = 'chip',
}: {
  buttons: ScenarioButton[];
  /** Tenant design option (PLN-260916 P4). */
  style?: 'chip' | 'card';
  /** Fired for a top-level config button (Product Help is handled internally). */
  onScenario: (button: ScenarioButton) => void;
  /** Fired for a Product Help submenu button. */
  onSubAction: (a: SubAction) => void;
}) {
  const { t } = useTranslation();
  const [sub, setSub] = useState(false);

  if (sub) {
    return (
      // Wraps rather than a fixed 2-column grid: these labels are translated into
      // six languages and "Exchange / Return" is far wider in some of them.
      <div className="flex flex-wrap gap-2">
        <MenuChip variant="quiet" label={t('chat.productHelp.usage')} onClick={() => onSubAction('usage')} />
        <MenuChip variant="quiet" label={t('chat.productHelp.ingredients')} onClick={() => onSubAction('ingredients')} />
        <MenuChip variant="quiet" label={t('chat.productHelp.exchange')} onClick={() => onSubAction('exchange')} />
        <MenuChip variant="quiet" label={t('chat.productHelp.restock')} onClick={() => onSubAction('restock')} />
        <MenuChip variant="quiet" label={t('chat.productHelp.back')} onClick={() => setSub(false)} />
      </div>
    );
  }

  return (
    <div className={style === 'card' ? 'flex flex-wrap gap-2' : 'grid grid-cols-2 gap-2'}>
      {buttons.map((b) => (
        <MenuChip
          key={b.id}
          variant={style === 'card' ? 'card' : 'primary'}
          icon={style === 'card' ? ACTION_ICONS[b.action] ?? MessageCircle : undefined}
          label={b.label}
          onClick={() => (b.action === 'product_help' ? setSub(true) : onScenario(b))}
        />
      ))}
    </div>
  );
}
