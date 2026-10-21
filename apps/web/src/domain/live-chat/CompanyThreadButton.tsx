import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { useTenantKey } from '@/lib/use-tenant-key';
import { liveChatService } from './live-chat.service';

/**
 * "Business" badge + the company's other conversations (PLN-261022 stage 2,
 * wireframe 3.4). A partner hotel's staff change and sessions end; the agent
 * still sees what this hotel asked before. Picking one opens it here.
 */
export function CompanyThreadButton({
  conversationId,
  company,
  onOpen,
}: {
  conversationId: string;
  company?: { id: string; otherConversations: number } | null;
  onOpen: (conversationId: string) => void;
}) {
  const { t } = useTranslation('livechat');
  const { t: tc } = useTranslation('common');
  const tenantKey = useTenantKey();
  const [open, setOpen] = useState(false);
  const list = useQuery({
    queryKey: ['company-conversations', tenantKey, conversationId],
    queryFn: () => liveChatService.companyConversations(conversationId),
    enabled: open && !!company,
  });
  if (!company) return null;
  const fmt = (iso: string) => new Date(iso).toLocaleString();

  return (
    <>
      <Badge tone="info">{t('company.badge')}</Badge>
      {company.otherConversations > 0 && (
        <button type="button" className="text-xs text-primary-600 hover:underline" onClick={() => setOpen(true)}>
          {t('company.earlier', { count: company.otherConversations })} ▸
        </button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="md"
        title={t('company.earlierTitle')}
        footer={
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {tc('close')}
          </Button>
        }
      >
        {list.isLoading && <p className="text-sm text-gray-400">{tc('loading')}</p>}
        {list.error && <p className="text-sm text-error">{(list.error as Error).message}</p>}
        {list.data && (
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 text-sm">
            {list.data.items.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-50"
                  onClick={() => {
                    setOpen(false);
                    onOpen(c.id);
                  }}
                >
                  <span>
                    #{c.id} · {fmt(c.createdAt)}
                    {c.customerName && <span className="ml-2 text-xs text-gray-500">{c.customerName}</span>}
                  </span>
                  <Badge tone={c.status === 'ended' ? 'gray' : 'primary'}>{t(`company.status.${c.status}`, { defaultValue: c.status })}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
