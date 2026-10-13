import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ChangePasswordModal } from '@/domain/auth/ChangePasswordModal';
import { MfaSettings } from '@/domain/auth/MfaSettings';
import { useAuthStore } from '@/store/auth-store';

/** Signed-in user's profile: identity, role and password change. */
export function MyPage() {
  const { t } = useTranslation('mypage');
  const { t: ta } = useTranslation('auth');
  const { t: tUsers } = useTranslation('users');
  const principal = useAuthStore((s) => s.principal);
  const tenantName = useAuthStore((s) => s.tenantName);
  const tenantSlug = useAuthStore((s) => s.tenantSlug);
  const [pwOpen, setPwOpen] = useState(false);

  const isAdmin = principal?.actorType === 'admin';

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Card title={t('profile')}>
        <dl className="divide-y divide-gray-100 text-sm">
          <div className="flex items-center justify-between py-3">
            <dt className="text-gray-500">{t('email')}</dt>
            <dd className="font-medium text-gray-900">{principal?.email}</dd>
          </div>
          <div className="flex items-center justify-between py-3">
            <dt className="text-gray-500">{t('role')}</dt>
            <dd>
              <Badge tone={isAdmin ? 'primary' : 'info'}>
                {isAdmin
                  ? 'admin'
                  : principal?.rank
                    ? tUsers(`rankName.${principal.rank}`, { defaultValue: principal.rank })
                    : 'user'}
              </Badge>
            </dd>
          </div>
          {!isAdmin && (
            <div className="flex items-center justify-between py-3">
              <dt className="text-gray-500">{t('workspace')}</dt>
              <dd className="font-medium text-gray-900">
                {tenantName ?? tenantSlug ?? '—'}
                {tenantSlug && <span className="ml-2 font-mono text-xs text-gray-400">/{tenantSlug}</span>}
              </dd>
            </div>
          )}
          {!isAdmin && (principal?.labels?.length ?? 0) > 0 && (
            <div className="flex items-center justify-between py-3">
              <dt className="text-gray-500">{t('labels')}</dt>
              <dd className="flex flex-wrap justify-end gap-1">
                {principal?.labels?.map((l) => <Badge key={l}>{l}</Badge>)}
              </dd>
            </div>
          )}
        </dl>
      </Card>

      <Card title={t('security')}>
        <p className="mb-3 text-sm text-gray-500">{t('securityDesc')}</p>
        <Button variant="secondary" onClick={() => setPwOpen(true)}>
          <KeyRound className="mr-1.5 h-4 w-4" />
          {ta('changePassword')}
        </Button>
      </Card>

      <Card title={ta('mfaTitle')}>
        <p className="mb-4 text-sm text-gray-500">{ta('mfaDesc')}</p>
        <MfaSettings />
      </Card>

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
