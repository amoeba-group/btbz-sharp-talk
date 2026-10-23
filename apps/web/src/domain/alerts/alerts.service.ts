import { apiGet, apiGetList, apiPost, apiPut } from '@/lib/api-client';
import type { AgentAlert } from '../live-chat/live-chat.service';

export type AlertPopup = 'all' | 'mine' | 'off';

/** A user's own alarm preferences (PLN-261024 D4). */
export interface AlertSettings {
  popup: AlertPopup;
  sound: boolean;
  desktop: boolean;
  email: boolean;
}

export interface AlarmCenterParams {
  scope?: 'all' | 'mine' | 'broadcast';
  status?: 'new' | 'acked' | 'all';
  days?: number;
  category?: string;
  page?: number;
  size?: number;
}

export const alertsService = {
  center: (p: AlarmCenterParams) => apiGetList<AgentAlert>('/agent/alerts/center', p),
  read: (id: string) => apiPost<{ read: true }>(`/agent/alerts/${id}/read`),
  settings: () => apiGet<AlertSettings>('/agent/alerts/settings'),
  saveSettings: (body: Partial<AlertSettings>) => apiPut<AlertSettings>('/agent/alerts/settings', body),
};
