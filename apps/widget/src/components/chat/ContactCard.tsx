import { Mail, MessageSquare, Phone } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The "how would you like to reach us" answer (PLN-260817 W-6, frame 61).
 *
 * Three method cards — phone, email, live agent — each with its own hours line,
 * replacing the single stacked block this used to be.
 *
 * Every value still comes from the translation bundle / tenant settings. The
 * design's `1588-0000` and `help@ivy.com` are IVY's own and MUST NOT be hardcoded
 * here: that hardcoding was the exact defect PLN-260808 removed from the widget.
 */
function MethodCard({
  icon,
  title,
  hours,
  action,
}: {
  icon: ReactNode;
  title: string;
  hours: string;
  action: ReactNode;
}) {
  return (
    <div className="rounded-st-lg border border-gray-200 bg-white px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <span className="text-gray-500">{icon}</span>
        {title}
      </div>
      <p className="mt-1 text-xs text-gray-500">{hours}</p>
      <div className="mt-1 text-sm font-medium text-primary-600">{action}</div>
    </div>
  );
}

export function ContactCard({ onChatAgent }: { onChatAgent: () => void }) {
  const { t } = useTranslation();
  const phone = t('contact.phone');
  const email = t('contact.email');

  return (
    <div className="space-y-2">
      <div className="max-w-[85%] rounded-st-lg bg-gray-100 px-3.5 py-2.5 text-sm text-gray-800">
        {t('contact.title')}
      </div>
      <MethodCard
        icon={<Phone className="h-4 w-4" />}
        title={t('contact.methods.phone')}
        hours={t('contact.hours')}
        action={
          <a href={`tel:${phone}`} className="hover:underline">
            {phone}
          </a>
        }
      />
      <MethodCard
        icon={<Mail className="h-4 w-4" />}
        title={t('contact.methods.email')}
        hours={t('contact.emailHours')}
        action={
          <a href={`mailto:${email}`} className="hover:underline">
            {email}
          </a>
        }
      />
      <MethodCard
        icon={<MessageSquare className="h-4 w-4" />}
        title={t('contact.methods.chat')}
        hours={t('contact.hours')}
        action={
          <button onClick={onChatAgent} className="hover:underline">
            {t('contact.chatAgent')}
          </button>
        }
      />
    </div>
  );
}
