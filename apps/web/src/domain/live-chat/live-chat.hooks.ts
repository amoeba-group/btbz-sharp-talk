import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { liveChatService } from './live-chat.service';
import type { CustomerLead } from './live-chat.service';
import { useTenantKey } from '@/lib/use-tenant-key';
import { toast } from '@/store/toast-store';

/**
 * Set or clear the operator's name for a session (PLN-260812).
 *
 * Keyed by conversation because that is what a queue row holds; the server
 * resolves the session. The row, the open conversation and the issue board all
 * re-read after, so the new name appears everywhere it is shown.
 */
export function useSetSessionAlias() {
  const { t } = useTranslation('livechat');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: ({ id, alias }: { id: string; alias: string | null }) =>
      liveChatService.setAlias(id, alias),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'sessions'] });
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'conversation', variables.id] });
      // The board prints the alias on its cards too.
      qc.invalidateQueries({ queryKey: ['issue-board', tenantKey] });
      toast.success(variables.alias ? t('alias.saved') : t('alias.cleared'));
    },
    onError: (e: Error) => toast.error(e.message || t('alias.saveError'), { sticky: true }),
  });
}

/**
 * Turn the AI on or off for one session (PLN-260812).
 *
 * Only applies to messages received from here on — nothing already in the
 * thread is answered retroactively, and the control says so.
 */
export function useSetSessionAutoReply() {
  const { t } = useTranslation('livechat');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: string }) =>
      liveChatService.setAutoReply(id, mode),
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'sessions'] });
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'conversation', variables.id] });
      toast.success(
        data.autoReplyEffective ? t('autoReply.savedOn') : t('autoReply.savedOff'),
      );
    },
    onError: (e: Error) => toast.error(e.message || t('autoReply.saveError'), { sticky: true }),
  });
}

/** Approve or drop the AI draft waiting on this conversation (PLN-260812). */
export function useDraftActions(id: string | null) {
  const { t } = useTranslation('livechat');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'conversation', id] });
    qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'sessions'] });
  };

  const approve = useMutation({
    mutationFn: (body?: string) => liveChatService.approveDraft(id as string, body),
    onSuccess: () => {
      invalidate();
      toast.success(t('draft.sent'));
    },
    onError: (e: Error) => toast.error(e.message || t('draft.sendError'), { sticky: true }),
  });

  const discard = useMutation({
    mutationFn: () => liveChatService.discardDraft(id as string),
    onSuccess: () => {
      invalidate();
      toast.success(t('draft.discarded'));
    },
    onError: (e: Error) => toast.error(e.message || t('draft.discardError'), { sticky: true }),
  });

  return { approve, discard };
}

export const useSessions = (
  q = '',
  status = 'all',
  channel = 'all',
  aiAgentId = 'all',
  hotel = '',
) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['agent', tenantKey, 'sessions', q, status, channel, aiAgentId, hotel],
    queryFn: () => liveChatService.sessions(q, status, channel, aiAgentId, hotel),
    // 5s (was 15s): a new escalation should surface within a beat, not a
    // quarter-minute — the endpoint is a few ms (PLN-260804).
    refetchInterval: 5000,
  });
};

/** Slim AI-agent roster for the filter/picker (REQ-260825 R7) — staff-readable. */
export const useAiAgentRoster = () => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['agent', tenantKey, 'ai-agents'],
    queryFn: () => liveChatService.aiAgents(),
    staleTime: 60_000,
  });
};

/** Re-pin the conversation's session to another AI agent (REQ-260825 R8-①). */
export function useSetSessionAiAgent(id: string | null) {
  const { t } = useTranslation('livechat');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (aiAgentId: number) => liveChatService.setAiAgent(id as string, aiAgentId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'conversation', id] });
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'sessions'] });
      toast.success(t('agentControls.aiAgentSaved', { name: data.aiAgentName }));
    },
    onError: (e: Error) => toast.error(e.message || t('agentControls.aiAgentError'), { sticky: true }),
  });
}

/** Hand the conversation to a specific human agent (manager+, REQ-260825 R8-②). */
export function useAssignConversation(id: string | null) {
  const { t } = useTranslation('livechat');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (userId: number) => liveChatService.assignConversation(id as string, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'conversation', id] });
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'sessions'] });
      qc.invalidateQueries({ queryKey: ['issue', tenantKey, id] });
      toast.success(t('agentControls.assigned'));
    },
    onError: (e: Error) => toast.error(e.message || t('agentControls.assignError'), { sticky: true }),
  });
}

/** File the conversation as an issue (REQ-260825 R8-③). With a messageId the
 * filing targets that customer message (PLN-260826 R5) — a second filing lands
 * as a memo on the conversation's existing issue instead of failing. */
export function useFileIssue(id: string | null) {
  const { t } = useTranslation('livechat');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (v: { type: string; messageId?: string; memo?: string }) =>
      liveChatService.fileIssue(id as string, v.type, { messageId: v.messageId, memo: v.memo }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['issue', tenantKey, id] });
      toast.success(
        data.appended
          ? t('agentControls.issueAppended', { no: data.issueNo })
          : t('agentControls.issueFiled', { no: data.issueNo }),
      );
    },
    onError: (e: Error) => toast.error(e.message || t('agentControls.issueError'), { sticky: true }),
  });
}

/** Pin/unpin a conversation in the queue — team-shared, max 3 (PLN-260826 R1). */
export function useSetPin() {
  const { t } = useTranslation('livechat');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (v: { id: string; pinned: boolean }) => liveChatService.setPin(v.id, v.pinned),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'sessions'] });
      toast.success(data.pinned ? t('pin.saved') : t('pin.cleared'));
    },
    onError: (e: Error & { code?: string }) =>
      toast.error(
        e.code === 'E5060' ? t('pin.limitReached') : e.message || t('pin.saveError'),
        { sticky: true },
      ),
  });
}

/**
 * Translate one customer message for the console (PLN-260826 R2). A mutation —
 * the agent decides when to spend the LLM call; results land in component
 * state per message+lang, and the server caches so repeats are free.
 */
export function useTranslateMessage() {
  const { t } = useTranslation('livechat');
  return useMutation({
    mutationFn: (v: { messageId: string; lang: string }) =>
      liveChatService.translateMessage(v.messageId, v.lang),
    onError: (e: Error) => toast.error(e.message || t('msgActions.translateError'), { sticky: true }),
  });
}

export const useConversation = (id: string | null) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['agent', tenantKey, 'conversation', id],
    queryFn: () => liveChatService.conversation(id as string),
    enabled: !!id,
    // The customer keeps typing while the agent watches: without a poll their
    // new messages only appeared after the agent acted (PLN-260804).
    refetchInterval: 5000,
  });
};

/**
 * The STORED briefing for a conversation (REQ-260824 R3). Cheap read, no model
 * call — generation only ever happens through useGenerateBriefing.
 */
export const useBriefing = (id: string | null) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['agent', tenantKey, 'briefing', id],
    queryFn: () => liveChatService.briefing(id as string),
    enabled: !!id,
    staleTime: 60_000,
  });
};

/** Operator-requested generation; the result lands in the briefing query. */
export function useGenerateBriefing(id: string | null) {
  const { t } = useTranslation('livechat');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: () => liveChatService.generateBriefing(id as string),
    onSuccess: (data) => {
      qc.setQueryData(['agent', tenantKey, 'briefing', id], data);
    },
    onError: (e: Error) => toast.error(e.message || t('briefing.generateError'), { sticky: true }),
  });
}

/** Translate the stored briefing into one system language (stored copy wins). */
export function useTranslateBriefing(id: string | null) {
  const { t } = useTranslation('livechat');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (v: { briefingId: string; lang: string }) =>
      liveChatService.translateBriefing(v.briefingId, v.lang),
    onSuccess: (data) => {
      qc.setQueryData(['agent', tenantKey, 'briefing', id], data);
    },
    onError: (e: Error) => toast.error(e.message || t('briefing.translateError'), { sticky: true }),
  });
}

/** Internal notes on the open thread + its session (REQ-260824 R4). */
export const useComments = (id: string | null) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['agent', tenantKey, 'comments', id],
    queryFn: () => liveChatService.comments(id as string),
    enabled: !!id,
  });
};

export function useCommentActions(id: string | null) {
  const { t } = useTranslation('livechat');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'comments', id] });

  const create = useMutation({
    mutationFn: (v: { scope: 'conversation' | 'session'; body: string }) =>
      liveChatService.createComment(id as string, v.scope, v.body),
    onSuccess: () => {
      invalidate();
      toast.success(t('comments.saved'));
    },
    onError: (e: Error) => toast.error(e.message || t('comments.saveError'), { sticky: true }),
  });

  const update = useMutation({
    mutationFn: (v: { commentId: string; body: string }) =>
      liveChatService.updateComment(v.commentId, v.body),
    onSuccess: () => {
      invalidate();
      toast.success(t('comments.saved'));
    },
    onError: (e: Error) => toast.error(e.message || t('comments.saveError'), { sticky: true }),
  });

  const remove = useMutation({
    mutationFn: (commentId: string) => liveChatService.deleteComment(commentId),
    onSuccess: () => {
      invalidate();
      toast.success(t('comments.deleted'));
    },
    onError: (e: Error) => toast.error(e.message || t('comments.deleteError'), { sticky: true }),
  });

  return { create, update, remove };
}

/** Session groups (timeline/project) for the list's group tab (REQ-260824). */
/** Same-person suggestion for the open conversation (PLN-261006 P1). */
export const useRelatedSessions = (conversationId: string | null) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['agent', tenantKey, 'related', conversationId],
    queryFn: () => liveChatService.relatedSessions(conversationId as string),
    enabled: !!conversationId,
    staleTime: 30_000,
  });
};

export const useGroups = (enabled = true) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['agent', tenantKey, 'groups'],
    queryFn: () => liveChatService.groups(),
    refetchInterval: 10000,
    enabled,
  });
};

export const useGroup = (id: string | null) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['agent', tenantKey, 'group', id],
    queryFn: () => liveChatService.group(id as string),
    enabled: !!id,
    refetchInterval: 10000,
  });
};

/** Merged feed of the group room — same 5s cadence as a normal thread. */
export const useGroupMessages = (id: string | null) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['agent', tenantKey, 'group-messages', id],
    queryFn: () => liveChatService.groupMessages(id as string),
    enabled: !!id,
    refetchInterval: 5000,
  });
};

export function useGroupActions(id: string | null) {
  const { t } = useTranslation('livechat');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'groups'] });
    if (id) {
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'group', id] });
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'group-messages', id] });
    }
  };

  const create = useMutation({
    mutationFn: (v: { kind: 'timeline' | 'project'; title: string; sessionIds: string[] }) =>
      liveChatService.createGroup(v.kind, v.title, v.sessionIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'groups'] });
      // Grouped sessions drop out of every open same-person suggestion.
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'related'] });
      toast.success(t('groups.created'));
    },
    onError: (e: Error) => toast.error(e.message || t('groups.createError'), { sticky: true }),
  });

  const update = useMutation({
    mutationFn: (v: { title?: string; kind?: 'timeline' | 'project' }) =>
      liveChatService.updateGroup(id as string, v),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('groups.saved'));
    },
    onError: (e: Error) => toast.error(e.message || t('groups.saveError'), { sticky: true }),
  });

  const addMembers = useMutation({
    mutationFn: (v: { groupId: string; sessionIds: string[] }) =>
      liveChatService.addGroupMembers(v.groupId, v.sessionIds),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'groups'] });
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'group', v.groupId] });
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'group-messages', v.groupId] });
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'related'] });
      toast.success(t('groups.membersAdded'));
    },
    onError: (e: Error) => toast.error(e.message || t('groups.saveError'), { sticky: true }),
  });

  const removeMember = useMutation({
    mutationFn: (sessionId: string) =>
      liveChatService.removeGroupMember(id as string, sessionId),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('groups.memberRemoved'));
    },
    onError: (e: Error) => toast.error(e.message || t('groups.saveError'), { sticky: true }),
  });

  const dissolve = useMutation({
    mutationFn: () => liveChatService.dissolveGroup(id as string),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('groups.dissolved'));
    },
    onError: (e: Error) => toast.error(e.message || t('groups.dissolveError'), { sticky: true }),
  });

  const send = useMutation({
    mutationFn: (v: { sessionId: string; body: string }) =>
      liveChatService.sendGroupMessage(id as string, v.sessionId, v.body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'group-messages', id] }),
    onError: (e: Error) => toast.error(e.message || t('sendFailed'), { sticky: true }),
  });

  return { create, update, addMembers, removeMember, dissolve, send };
}

/** New escalation alerts for the alarm modal (FR-S3) — 10s poll. */
export const useAgentAlerts = (enabled = true) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['agent', tenantKey, 'alerts'],
    queryFn: () => liveChatService.alerts('new'),
    refetchInterval: 10000,
    enabled,
  });
};

export const useAckAlert = () => {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (id: string) => liveChatService.ackAlert(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'alerts'] }),
  });
};

/**
 * Ask the knowledge base from the chat screen (PLN-260810 S2).
 *
 * A mutation, not a query: the agent decides when to spend an LLM call, and
 * nothing should re-fire it on a window focus or a cache miss.
 */
export function useAskKnowledge() {
  return useMutation({
    mutationFn: (v: { question: string; language: string }) =>
      liveChatService.askKnowledge(v.question, v.language),
    onError: (err: Error) => toast.error(err.message),
  });
}

/** Send an answer to the knowledge owners for review (PLN-260810 S4). */
export function useProposeAnswer() {
  return useMutation({
    mutationFn: (v: { conversationId?: number; question: string; answer: string }) =>
      liveChatService.proposeAnswer({
        conversation_id: v.conversationId,
        question: v.question,
        answer: v.answer,
      }),
    onSuccess: () => toast.success('Sent for review'),
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useConversationActions(id: string | null) {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'conversation', id] });
    qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'sessions'] });
  };

  const accept = useMutation({
    mutationFn: () => liveChatService.accept(id as string),
    onSuccess: invalidate,
  });

  const end = useMutation({
    mutationFn: () => liveChatService.end(id as string),
    onSuccess: invalidate,
  });

  const send = useMutation({
    // A reply may carry files, text, or both (PLN-260814 S4).
    mutationFn: (input: string | { body: string; attachmentIds?: string[] }) =>
      typeof input === 'string'
        ? liveChatService.sendMessage(id as string, input)
        : liveChatService.sendMessage(id as string, input.body, input.attachmentIds),
    onSuccess: invalidate,
  });

  const handBack = useMutation({
    mutationFn: () => liveChatService.handBack(id as string),
    onSuccess: invalidate,
  });

  return { accept, end, send, handBack };
}

/** Link an existing customer or create a new one for the current conversation. */
export function useCustomerActions(id: string | null) {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'conversation', id] });
    qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'sessions'] });
  };

  const link = useMutation({
    mutationFn: (customerId: number) => liveChatService.linkCustomer(id as string, customerId),
    onSuccess: invalidate,
  });

  const create = useMutation({
    mutationFn: (lead: CustomerLead) => liveChatService.createCustomer(id as string, lead),
    onSuccess: invalidate,
  });

  return { link, create };
}
