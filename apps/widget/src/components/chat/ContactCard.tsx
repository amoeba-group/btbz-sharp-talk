import { Mail, MessageSquare, Phone } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { contactMethods } from '../../lib/contact-card';

/**
 * The "how would you like to reach us" answer (PLN-260817 W-6, frame 61).
 *
 * Three method cards — phone, email, live agent — each with its own hours line,
 * replacing the single stacked block this used to be.
 *
 * Every value comes from the translation bundle and the bundle ships NONE (w3c, ops-manual
 * finding 8): the design's `1588-0000` and `help@ivy.com` are IVY's own, and leaving them as
 * defaults showed them to every other tenant's customers. A method with no value is simply not
 * drawn (`contactMethods`), so an unconfigured tenant offers just "chat with an agent".
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
      {hours && <p className="mt-1 text-xs text-gray-500">{hours}</p>}
      <div className="mt-1 text-sm font-medium text-primary-600">{action}</div>
    </div>
  );
}

export function ContactCard({ onChatAgent }: { onChatAgent: () => void }) {
  const { t } = useTranslation();
  // Empty defaults: the bundles ship none of these (a missing key would otherwise render as the key).
  const phone = t('contact.phone', { defaultValue: '' });
  const email = t('contact.email', { defaultValue: '' });
  const hoursText = t('contact.hours', { defaultValue: '' });
  const emailHoursText = t('contact.emailHours', { defaultValue: '' });
  const show = contactMethods({ phone, email, hours: hoursText, emailHours: emailHoursText });

  return (
    <div className="space-y-2">
      <div className="max-w-[85%] rounded-st-lg bg-gray-100 px-3.5 py-2.5 text-sm text-gray-800">
        {t('contact.title')}
      </div>
      {show.phone && (
        <MethodCard
          icon={<Phone className="h-4 w-4" />}
          title={t('contact.methods.phone')}
          hours={show.hours ? hoursText : ''}
          action={
            <a href={`tel:${phone.trim()}`} className="hover:underline">
              {phone.trim()}
            </a>
          }
        />
      )}
      {show.email && (
        <MethodCard
          icon={<Mail className="h-4 w-4" />}
          title={t('contact.methods.email')}
          hours={show.emailHours ? emailHoursText : ''}
          action={
            <a href={`mailto:${email.trim()}`} className="hover:underline">
              {email.trim()}
            </a>
          }
        />
      )}
      <MethodCard
        icon={<MessageSquare className="h-4 w-4" />}
        title={t('contact.methods.chat')}
        hours={show.hours ? hoursText : ''}
        action={
          <button onClick={onChatAgent} className="hover:underline">
            {t('contact.chatAgent')}
          </button>
        }
      />
    </div>
  );
}
