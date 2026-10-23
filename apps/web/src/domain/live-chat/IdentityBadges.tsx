import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/Badge';
import type { SessionIdentity } from './live-chat.service';

/**
 * Hotel · region · role the host app signed for this user (PLN-261015 D5).
 *
 * Go2Joy's Hotel Admin signs these with the user id, so an agent sees which
 * hotel is asking — and why the handoff landed on them (region routing, D3) —
 * without asking the customer again. Renders nothing for sessions without host
 * facts, which is every storefront tenant. A claimed session (the host could not
 * sign yet, PLN-261022) shows the same facts with an "unverified" badge.
 */
export function IdentityBadges({ identity, compact = false }: { identity?: SessionIdentity | null; compact?: boolean }) {
  const { t } = useTranslation('livechat');
  if (!identity) return null;
  const hotel = identity.hotelName || identity.hotelId;
  const region = identity.region
    ? t(`identity.region.${identity.region}`, { defaultValue: identity.region })
    : identity.province;
  const role = identity.role ? t(`identity.role.${identity.role}`, { defaultValue: identity.role }) : null;
  const unverified = identity.verified === false;
  if (!hotel && !region && !role && !unverified) return null;
  const sourceHint = unverified ? t('identity.unverifiedHint') : t('identity.signed');

  if (compact) {
    const text = [hotel, region].filter(Boolean).join(' · ');
    if (unverified) {
      // A queue row has room for an icon only: the warning stays visible, the
      // words and the hotel live in the tooltip (the header lists everything).
      const label = [t('identity.unverified'), text, sourceHint].filter(Boolean).join(' — ');
      return (
        <span className="inline-flex shrink-0 text-warning" title={label} aria-label={label}>
          <ShieldAlert className="h-3.5 w-3.5" />
        </span>
      );
    }
    return text ? (
      <span className="truncate text-[11px] text-gray-500" title={sourceHint}>
        {text}
      </span>
    ) : null;
  }
  return (
    <>
      {hotel && (
        <span title={sourceHint}>
          <Badge tone="gray">
            {t('identity.hotel')}: {hotel}
          </Badge>
        </span>
      )}
      {region && <Badge tone="warning">{region}</Badge>}
      {role && <Badge tone="gray">{role}</Badge>}
      {unverified && (
        <span title={sourceHint}>
          <Badge tone="warning">{t('identity.unverified')}</Badge>
        </span>
      )}
    </>
  );
}
