import { FindOperator } from 'typeorm';
import { ChatGroupService } from './chat-group.service';
import { ChatGroup } from './entity/chat-group.entity';
import { ChatGroupMember } from './entity/chat-group-member.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';

/**
 * Session grouping (PLN-260824-Session-Grouping): tenancy fences, the
 * one-member floor, 1:1 send target resolution, and the merged id-cursor feed.
 */
describe('ChatGroupService', () => {
  function build(
    opts: {
      group?: Partial<ChatGroup> | null;
      members?: Partial<ChatGroupMember>[];
      sessionCount?: number;
      conversations?: Partial<Conversation>[];
      messages?: Partial<Message>[];
    } = {},
  ) {
    const group =
      opts.group === null ? null : ({ id: 50, tenantId: 1, kind: 'timeline', title: 'T', ...opts.group } as ChatGroup);
    const members = (opts.members ?? []) as ChatGroupMember[];
    const conversations = (opts.conversations ?? []) as Conversation[];

    const savedGroups: Partial<ChatGroup>[] = [];
    const savedMembers: unknown[] = [];
    const deleted: Array<Record<string, unknown>> = [];
    const groupRepo = {
      findOne: jest.fn(async (q: { where: { id: number; tenantId: number } }) =>
        group && group.id === q.where.id && group.tenantId === q.where.tenantId ? group : null,
      ),
      find: jest.fn(async () => (group ? [group] : [])),
      create: jest.fn((v: Partial<ChatGroup>) => v as ChatGroup),
      save: jest.fn(async (v: ChatGroup) => {
        savedGroups.push(v);
        return { ...v, id: v.id ?? 50 };
      }),
      delete: jest.fn(async (w: Record<string, unknown>) => {
        deleted.push({ table: 'groups', ...w });
        return { affected: 1 };
      }),
    };
    const memberRepo = {
      find: jest.fn(async () => members),
      findOne: jest.fn(
        async (q: { where: { sessionId: number } }) =>
          members.find((m) => Number(m.sessionId) === Number(q.where.sessionId)) ?? null,
      ),
      count: jest.fn(async () => members.length),
      create: jest.fn((v: unknown) => v as ChatGroupMember),
      save: jest.fn(async (v: unknown) => {
        savedMembers.push(v);
        return v;
      }),
      delete: jest.fn(async (w: Record<string, unknown>) => {
        deleted.push({ table: 'members', ...w });
        return { affected: 1 };
      }),
    };
    const sessionRepo = {
      count: jest.fn(async (q: { where: { id: FindOperator<number> } }) =>
        opts.sessionCount ?? ((q.where.id as unknown as { value: number[] }).value ?? []).length,
      ),
      find: jest.fn(async () => []),
    };
    const convFinds: Array<Record<string, unknown>> = [];
    const convRepo = {
      find: jest.fn(async () => conversations),
      findOne: jest.fn(async (q: { where: Record<string, unknown> }) => {
        convFinds.push(q.where);
        const wantOpen = q.where.status != null;
        const match = conversations.find((c) => {
          if (Number(c.sessionId) !== Number(q.where.sessionId)) return false;
          if (wantOpen) return ['ai_active', 'waiting', 'agent'].includes(c.status as string);
          return true;
        });
        return match ?? null;
      }),
    };
    const msgFinds: Array<Record<string, unknown>> = [];
    const msgRepo = {
      find: jest.fn(async (q: Record<string, unknown>) => {
        msgFinds.push(q);
        return (opts.messages ?? []) as Message[];
      }),
    };
    const customerRepo = { find: jest.fn(async () => []) };
    const agentService = {
      sendMessage: jest.fn(async () => ({ id: 900, body: 'sent' }) as unknown as Message),
    };

    const svc = new ChatGroupService(
      groupRepo as never,
      memberRepo as never,
      sessionRepo as never,
      convRepo as never,
      msgRepo as never,
      customerRepo as never,
      agentService as never,
    );
    return { svc, groupRepo, memberRepo, sessionRepo, convRepo, msgRepo, agentService, savedGroups, savedMembers, deleted, msgFinds, convFinds };
  }

  it('refuses creating a group with no sessions', async () => {
    const h = build();

    await expect(h.svc.create(1, 7, 'timeline', '제목', [])).rejects.toThrow();
    expect(h.groupRepo.save).not.toHaveBeenCalled();
  });

  it('creates a one-session timeline — a first-time customer can have a journey (PLN-261006 D2)', async () => {
    const h = build();

    await h.svc.create(1, 7, 'timeline', '김OO', [10, 10]);

    expect(h.savedMembers[0]).toHaveLength(1);
  });

  it("refuses creating a group holding another tenant's session", async () => {
    const h = build({ sessionCount: 1 }); // only 1 of 2 ids belongs to the tenant

    await expect(h.svc.create(1, 7, 'timeline', '제목', [10, 11])).rejects.toThrow();
    expect(h.groupRepo.save).not.toHaveBeenCalled();
  });

  it('creates the group and one membership row per session', async () => {
    const h = build();

    const group = await h.svc.create(1, 7, 'project', '  ACME 입점  ', [10, 11]);

    expect(group.title).toBe('ACME 입점');
    expect(h.savedMembers[0]).toHaveLength(2);
  });

  it("treats another tenant's group id as not found", async () => {
    const h = build({ group: { tenantId: 2 } });

    await expect(h.svc.detail(50, 1)).rejects.toThrow();
  });

  it('merges the feed over member conversations with one id cursor', async () => {
    const h = build({
      members: [{ sessionId: 10 }, { sessionId: 11 }] as never,
      conversations: [
        { id: 100, sessionId: 10, channel: 'widget' },
        { id: 101, sessionId: 11, channel: 'telegram' },
      ] as never,
      messages: [
        { id: 3, conversationId: 101 },
        { id: 2, conversationId: 100 },
        { id: 1, conversationId: 100 },
      ] as never,
    });

    const { messages, conversationMeta } = await h.svc.messages(50, 1, { beforeId: 9, limit: 30 });

    const where = h.msgFinds[0].where as Record<string, FindOperator<unknown>>;
    expect((where.conversationId as unknown as { value: number[] }).value).toEqual([100, 101]);
    expect(where.id).toBeInstanceOf(FindOperator); // LessThan(beforeId)
    expect(messages.map((m) => m.id)).toEqual([1, 2, 3]); // returned ascending
    expect(conversationMeta.get('101')).toEqual({ sessionId: 11, channel: 'telegram' });
  });

  it('refuses a 1:1 send to a session that is not a member', async () => {
    const h = build({ members: [{ sessionId: 10 }] as never });

    await expect(h.svc.sendTo(50, 1, 7, 99, 'hi')).rejects.toThrow();
    expect(h.agentService.sendMessage).not.toHaveBeenCalled();
  });

  it('sends to the OPEN conversation of the chosen member via the normal agent path', async () => {
    const h = build({
      members: [{ sessionId: 10 }] as never,
      conversations: [
        { id: 200, sessionId: 10, status: 'ended', channel: 'widget' },
        { id: 201, sessionId: 10, status: 'agent', channel: 'widget' },
      ] as never,
    });

    const result = await h.svc.sendTo(50, 1, 7, 10, '안내드립니다');

    expect(result.conversationId).toBe(201);
    expect(h.agentService.sendMessage).toHaveBeenCalledWith(201, 7, 1, '안내드립니다');
  });

  it('refuses sending toward a receive-only channel (sms relay)', async () => {
    const h = build({
      members: [{ sessionId: 10 }] as never,
      conversations: [{ id: 200, sessionId: 10, status: 'agent', channel: 'sms' }] as never,
    });

    await expect(h.svc.sendTo(50, 1, 7, 10, 'hi')).rejects.toThrow();
    expect(h.agentService.sendMessage).not.toHaveBeenCalled();
  });

  it('refuses removing the last member — dissolve instead', async () => {
    const h = build({ members: [{ id: 1, sessionId: 10 }] as never });

    await expect(h.svc.removeMember(50, 1, 10)).rejects.toThrow();
    expect(h.memberRepo.delete).not.toHaveBeenCalled();
  });

  it('removes a member when another one remains', async () => {
    const h = build({
      members: [{ id: 1, sessionId: 10 }, { id: 2, sessionId: 11 }] as never,
    });

    await h.svc.removeMember(50, 1, 10);

    expect(h.memberRepo.delete).toHaveBeenCalledWith({ id: 1 });
  });

  it('dissolve deletes memberships and the group, nothing else', async () => {
    const h = build();

    await h.svc.dissolve(50, 1);

    expect(h.deleted).toEqual([
      { table: 'members', groupId: 50, tenantId: 1 },
      { table: 'groups', id: 50, tenantId: 1 },
    ]);
    expect(h.convRepo.find).not.toHaveBeenCalled();
  });

  it("dissolve also removes the group's journey and its next actions (PLN-261006)", async () => {
    const h = build();
    const journeyRepo = {
      findOne: jest.fn(async () => ({ id: 3, tenantId: 1, groupId: 50 })),
      delete: jest.fn(async () => ({ affected: 1 })),
    };
    const taskRepo = { delete: jest.fn(async () => ({ affected: 2 })) };
    const svc = new ChatGroupService(
      h.groupRepo as never,
      h.memberRepo as never,
      h.sessionRepo as never,
      h.convRepo as never,
      h.msgRepo as never,
      { find: jest.fn(async () => []) } as never,
      h.agentService as never,
      journeyRepo as never,
      taskRepo as never,
    );

    await svc.dissolve(50, 1);

    expect(taskRepo.delete).toHaveBeenCalledWith({ tenantId: 1, journeyId: 3 });
    expect(journeyRepo.delete).toHaveBeenCalledWith({ id: 3, tenantId: 1 });
  });
});
