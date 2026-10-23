import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useCategoryName } from '../routing-categories/routing-categories.hooks';
import type { AgentAlert } from '../live-chat/live-chat.service';

/** i18n key for an alarm's reason (shared by the popup, bell and center). */
export function reasonKey(reason: string): string {
  switch (reason) {
    case 'low_confidence':
      return 'alarmReasonLowConfidence';
    case 'moderation_blocked':
      return 'alarmReasonModeration';
    case 'category_selected':
      return 'alarmReasonCategory';
    default:
      return 'alarmReasonUserRequest';
  }
}

/**
 * Text helpers for an alarm (PLN-261024 D1): who it is addressed to, and the
 * hotel · region · consult category line.
 */
export function useAlarmText() {
  const { t } = useTranslation('livechat');
  const { t: ta } = useTranslation('aiSetting');
  const categoryName = useCategoryName();

  const assignee = useCallback(
    (a: AgentAlert) => {
      const list = a.assignees ?? [];
      if (!list.length) return t('alarmCenter.assigneeAll');
      const first = a.assignedToMe ? t('alarmCenter.me') : list[0].name;
      return list.length > 1 ? t('alarmCenter.assigneeMany', { name: first, count: list.length - 1 }) : first;
    },
    [t],
  );

  const facts = useCallback(
    (a: AgentAlert) =>
      [
        a.hotel,
        a.region ? ta(`handoff.routing.customer.value.region.${a.region}`, { defaultValue: a.region }) : null,
        a.consultCategory ? t('consultCategoryBadge', { name: categoryName(a.consultCategory) }) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    [t, ta, categoryName],
  );

  return { assignee, facts };
}
