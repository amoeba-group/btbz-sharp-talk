import { Building2, ExternalLink, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/Button';
import { cn } from '@/lib/cn';
import type { IdentityClaims } from './live-chat.service';

/**
 * Signed partner context of a session (REQ-261006 W6): which hotel the staff
 * member on the other end is acting for, in what role, and whether the host
 * system actually signed that — or merely declared it.
 *
 * The hotel KEY is always shown next to the name: the name is not signed and
 * can be wrong, the key is what the signature covers and what the operator
 * pastes into the host system (PLN §5 risk "unsigned hotel name").
 */

/** "Receptionist" / "Manager" / "Internal", localized; unknown roles pass through. */
export function roleLabel(role: string | undefined, t: TFunction<'livechat'>): string {
  if (!role) return '';
  return t(`partner.role.${role}`, { defaultValue: role });
}

/** `A In Hotel Del Luna · HCM_001_001721` — name when known, else the key. */
export function hotelLabel(claims: IdentityClaims): string {
  const name = claims.hotelName?.trim();
  const code = claims.hotelCode?.trim() || claims.hotelSn;
  if (!name) return claims.hotelSn;
  return code && code !== name ? `${name} · ${code}` : name;
}

/** One line under a queue row: hotel, key, signed/unsigned. */
export function PartnerLine({ claims, className }: { claims: IdentityClaims; className?: string }) {
  return (
    <p
      className={cn('mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-gray-500', className)}
      title={`hotelSn ${claims.hotelSn}`}
    >
      <Building2 className="h-3 w-3 shrink-0 text-gray-400" />
      <span className="truncate">{hotelLabel(claims)}</span>
      <SignedMark claims={claims} />
    </p>
  );
}

/** ✓ signed / ⚠ unsigned — the trust mark every partner display carries. */
export function SignedMark({ claims }: { claims: IdentityClaims }) {
  const { t } = useTranslation('livechat');
  return claims.signed ? (
    <span className="inline-flex shrink-0 items-center gap-0.5 text-success" title={t('partner.signedHint')}>
      <ShieldCheck className="h-3 w-3" /> {t('partner.signed')}
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-0.5 text-warning" title={t('partner.unsignedHint')}>
      <ShieldAlert className="h-3 w-3" /> {t('partner.unsigned')}
    </span>
  );
}

/**
 * Header strip above a thread: role @ hotel (key) · verified time, plus the
 * jump into the tenant's own system when the API resolved a link for it.
 */
export function PartnerHeader({
  claims,
  partnerLink,
}: {
  claims: IdentityClaims;
  partnerLink?: string | null;
}) {
  const { t } = useTranslation('livechat');
  const verifiedAt = (() => {
    if (!claims.verifiedAt) return '';
    const d = new Date(claims.verifiedAt);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  })();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-gray-100 bg-gray-50 px-2 py-1 text-xs text-gray-700">
      <Building2 className="h-3.5 w-3.5 shrink-0 text-gray-500" />
      <span className="min-w-0 truncate">
        {roleLabel(claims.role, t)}
        {roleLabel(claims.role, t) ? ' @ ' : ''}
        {hotelLabel(claims)}
        <span className="text-gray-400"> (hotelSn {claims.hotelSn})</span>
      </span>
      <SignedMark claims={claims} />
      {verifiedAt && (
        <span className="text-[11px] text-gray-400" title={t('partner.verifiedAt')}>
          {verifiedAt}
        </span>
      )}
      {partnerLink && (
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          onClick={() => window.open(partnerLink, '_blank', 'noopener,noreferrer')}
          title={partnerLink}
        >
          <ExternalLink className="h-3.5 w-3.5" /> {t('partner.openInHost')}
        </Button>
      )}
    </div>
  );
}
