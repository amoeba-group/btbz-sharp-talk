import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/Badge';
import type { SessionIdentity } from './live-chat.service';

/**
 * Hotel · region · role the host app signed for this user (PLN-261015 D5).
 *
 * Go2Joy's Hotel Admin signs these with the user id, so an agent sees which
 * hotel is asking — and why the handoff landed on them (region routing, D3) —
 * without asking the customer again. Renders nothing for unsigned sessions,
 * which is every storefront tenant.
 */
export function IdentityBadges({ identity, compact = false }: { identity?: SessionIdentity | null; compact?: boolean }) {
  const { t } = useTranslation('livechat');
  if (!identity) return null;
  const hotel = identity.hotelName || identity.hotelId;
  const region = identity.region
    ? t(`identity.region.${identity.region}`, { defaultValue: identity.region })
    : identity.province;
  const role = identity.role ? t(`identity.role.${identity.role}`, { defaultValue: identity.role }) : null;
  if (!hotel && !region && !role) return null;

  if (compact) {
    const text = [hotel, region].filter(Boolean).join(' · ');
    return text ? (
      <span className="truncate text-[11px] text-gray-500" title={t('identity.signed')}>
        {text}
      </span>
    ) : null;
  }
  return (
    <>
      {hotel && (
        <span title={t('identity.signed')}>
          <Badge tone="gray">
            {t('identity.hotel')}: {hotel}
          </Badge>
        </span>
      )}
      {region && <Badge tone="warning">{region}</Badge>}
      {role && <Badge tone="gray">{role}</Badge>}
    </>
  );
}
