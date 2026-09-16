import { apiClient } from '../lib/api-client';
import type {
  NotifChannel,
  NotificationCategory,
  NotificationItem,
  NotifPref,
} from '../lib/types';

export function listNotifications(
  sessionToken: string,
  category?: NotificationCategory,
  scope?: string,
): Promise<NotificationItem[]> {
  return apiClient.get<NotificationItem[]>('/notifications', {
    session_token: sessionToken,
    category: category && category !== 'all' ? category : undefined,
    // Decides what "all" covers when the widget shows two list tabs, so the
    // same order notification never appears under both.
    scope,
  });
}

export function markRead(
  id: string,
  sessionToken: string,
): Promise<unknown> {
  return apiClient.post(`/notifications/${id}/read`, {
    session_token: sessionToken,
  });
}

/** Shopper-side delete: selected ids, or everything (PLN-260916 P3). */
export function deleteNotifications(
  input: { ids?: string[]; all?: boolean },
  sessionToken: string,
): Promise<{ deleted: number }> {
  return apiClient.delete<{ deleted: number }>('/notifications', {
    session_token: sessionToken,
    ...(input.all ? { all: true } : { ids: (input.ids ?? []).map(Number) }),
  });
}

export function unreadCount(sessionToken: string, scope?: string): Promise<{ count: number }> {
  return apiClient.get<{ count: number }>('/notifications/unread-count', {
    session_token: sessionToken,
    scope,
  });
}

export function getPrefs(sessionToken: string): Promise<NotifPref[]> {
  return apiClient.get<NotifPref[]>('/notifications/prefs', {
    session_token: sessionToken,
  });
}

export function setPref(
  sessionToken: string,
  channel: NotifChannel,
  category: NotificationCategory,
  enabled: boolean,
): Promise<unknown> {
  return apiClient.put('/notifications/prefs', {
    session_token: sessionToken,
    channel,
    category,
    enabled,
  });
}

/**
 * Marketing refusal — one call, because the server owns which categories count
 * as marketing (PLN-260817-Widget-Header-Prefs-Cleanup §6.1).
 */
export function getMarketingOptOut(sessionToken: string): Promise<{ optOut: boolean }> {
  return apiClient.get<{ optOut: boolean }>('/notifications/marketing-opt-out', {
    session_token: sessionToken,
  });
}

export function setMarketingOptOut(
  sessionToken: string,
  optOut: boolean,
): Promise<{ optOut: boolean }> {
  return apiClient.put<{ optOut: boolean }>('/notifications/marketing-opt-out', {
    session_token: sessionToken,
    opt_out: optOut,
  });
}
