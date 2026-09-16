import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  getMarketingOptOut,
  getPrefs,
  listNotifications,
  deleteNotifications, markRead,
  setMarketingOptOut,
  setPref,
  unreadCount,
} from '../services/notificationService';
import type {
  NotifChannel,
  NotificationCategory,
} from '../lib/types';

export function useNotifications(
  sessionToken: string | null,
  category: NotificationCategory,
  scope?: string,
) {
  return useQuery({
    queryKey: ['notifications', sessionToken, category, scope ?? null],
    queryFn: () => listNotifications(sessionToken!, category, scope),
    enabled: !!sessionToken,
  });
}

/**
 * Unread badge poll. Gated on `authenticated`: notifications are customer-bound,
 * so an anonymous session would just collect 401s from /notifications/unread-count
 * (FIX-Widget-UnreadCount-Anon401-20260803). The query auto-enables the moment the
 * app-proxy handshake or AuthGate binds a customer and sets `authenticated`.
 */
export function useUnreadCount(
  sessionToken: string | null,
  authenticated: boolean,
  scope?: string,
) {
  return useQuery({
    queryKey: ['unread-count', sessionToken, scope ?? null],
    queryFn: () => unreadCount(sessionToken!, scope),
    enabled: !!sessionToken && authenticated,
    refetchInterval: 30_000,
  });
}

export function useMarkRead(sessionToken: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markRead(id, sessionToken!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });
}

export function useDeleteNotifications(sessionToken: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids?: string[]; all?: boolean }) => deleteNotifications(input, sessionToken!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });
}

export function usePrefs(sessionToken: string | null) {
  return useQuery({
    queryKey: ['prefs', sessionToken],
    queryFn: () => getPrefs(sessionToken!),
    enabled: !!sessionToken,
  });
}

export function useSetPref(sessionToken: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: {
      channel: NotifChannel;
      category: NotificationCategory;
      enabled: boolean;
    }) => setPref(sessionToken!, p.channel, p.category, p.enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prefs'] });
    },
  });
}

/** Marketing refusal state for the widget's single remaining channel control. */
export function useMarketingOptOut(sessionToken: string | null, authenticated: boolean) {
  return useQuery({
    queryKey: ['marketing-opt-out', sessionToken],
    queryFn: () => getMarketingOptOut(sessionToken!),
    enabled: !!sessionToken && authenticated,
  });
}

export function useSetMarketingOptOut(sessionToken: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (optOut: boolean) => setMarketingOptOut(sessionToken!, optOut),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['marketing-opt-out'] });
    },
  });
}
