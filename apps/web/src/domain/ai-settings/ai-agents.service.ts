import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';

/** One AI counter persona of this tenant (PLN-260820-Multi-AI-Agent-Personas). */
export interface AiAgentRow {
  id: number;
  /** Routing key used in embed snippets / channel bindings; locked after create. */
  code: string;
  name: string;
  /** Shopper-facing name (REQ-260825 R4); null = tenant display name. */
  displayName: string | null;
  persona: string | null;
  rules: string[];
  /** Per-agent first message, lang→text (REQ-260825 R3); {} = tenant copy. */
  greeting: Record<string, string>;
  active: boolean;
  isDefault: boolean;
  /**
   * What an unidentified visitor gets (PLN-261001 W1): `open` answers as
   * usual; `login_guidance` grounds only on guest-visible categories and
   * otherwise asks the visitor to sign in.
   */
  guestPolicy: GuestPolicy;
  updatedAt: string;
}

export type GuestPolicy = 'open' | 'login_guidance';
export const GUEST_POLICIES: GuestPolicy[] = ['open', 'login_guidance'];

export const aiAgentsService = {
  list: async (): Promise<AiAgentRow[]> => {
    const d = await apiGet<{ items: AiAgentRow[] }>('/ai-agents');
    return d.items ?? [];
  },
  create: (body: { code: string; name: string }) => apiPost<AiAgentRow>('/ai-agents', body),
  update: (
    id: number,
    body: {
      name?: string;
      active?: boolean;
      display_name?: string;
      greeting?: Record<string, string>;
      guest_policy?: GuestPolicy;
    },
  ) => apiPatch<AiAgentRow>(`/ai-agents/${id}`, body),
  remove: (id: number) => apiDelete<{ deleted: true }>(`/ai-agents/${id}`),
  setDefault: (id: number) => apiPost<AiAgentRow>(`/ai-agents/${id}/default`),
};
