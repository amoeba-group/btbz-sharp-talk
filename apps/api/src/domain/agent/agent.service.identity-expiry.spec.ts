import { AgentService } from './agent.service';
import { toSessionResponse } from './agent.mapper';
import { Conversation } from '../chat/entity/conversation.entity';
import type { IdentityClaims } from '@sharptalk/types';

/**
 * The console header of a partner session whose signed claims lapsed (PLN-261012 SG-03).
 *
 * The console keeps showing WHICH hotel the conversation was with — that is history — but
 * must not keep vouching with the "signed" tick for someone the API now treats as a guest.
 * `identityExpired` rides only when true, so an older console reads the row it always did.
 */
const HOUR = 3_600_000;
const claims = (ageMs: number): IdentityClaims => ({
  hotelSn: '1721',
  role: 'receptionist',
  hotelName: 'A In Hotel Del Luna',
  signed: true,
  verifiedAt: new Date(Date.now() - ageMs).toISOString(),
});

function build(sessionClaims: IdentityClaims | null, policy: unknown = null) {
  const session = { id: 30, alias: null, autoReplyMode: 'inherit', aiAgentId: null, identityClaims: sessionClaims };
  const conversation = { id: 3, tenantId: 1, sessionId: 30, status: 'waiting', createdAt: new Date() } as Conversation;
  const qb: Record<string, unknown> = {
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    addOrderBy: jest.fn(() => qb),
    skip: jest.fn(() => qb),
    take: jest.fn(() => qb),
    getManyAndCount: jest.fn(async () => [[conversation], 1]),
  };
  const sessionService = { identityPolicyFor: jest.fn(async () => policy) };
  const svc = new AgentService(
    { createQueryBuilder: () => qb } as never,
    {
      createQueryBuilder: () => ({ select: () => ({ where: () => ({ getMany: async () => [] }) }) }),
      find: jest.fn(async () => []),
    } as never,
    {} as never,
    { find: jest.fn(async () => [session]) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { contactsByIds: jest.fn(async () => new Map()), searchByEmailOrName: jest.fn(async () => []) } as never,
    {} as never,
    {} as never,
    {} as never,
    sessionService as never,
    {} as never,
  );
  return { svc, sessionService };
}

describe('AgentService — identityExpired on the queue row and the thread header', () => {
  it('queue row: claims in force are not flagged', async () => {
    const { svc } = build(claims(HOUR));

    const { items } = await svc.listSessions(1, 1, 20);

    expect(items[0].identityExpired).toBe(false);
    expect(items[0].identityClaims).toMatchObject({ hotelSn: '1721' });
  });

  it('queue row: lapsed claims are flagged but the hotel stays visible (it is history, not a login)', async () => {
    const { svc } = build(claims(9 * HOUR));

    const { items } = await svc.listSessions(1, 1, 20);

    expect(items[0].identityExpired).toBe(true);
    expect(items[0].identityClaims).toMatchObject({ hotelSn: '1721', role: 'receptionist' });
  });

  it('queue row: the tenant policy sets the limit, read ONCE per page', async () => {
    const { svc, sessionService } = build(claims(3 * HOUR), { maxAgeHours: 2 });

    const { items } = await svc.listSessions(1, 1, 20);

    expect(items[0].identityExpired).toBe(true);
    expect(sessionService.identityPolicyFor).toHaveBeenCalledTimes(1);
  });

  it('queue row: a conversation with no claims (guest, v1) is never flagged', async () => {
    const { svc } = build(null);

    const { items } = await svc.listSessions(1, 1, 20);

    expect(items[0].identityExpired).toBe(false);
  });

  it('thread header: sessionStateFor reports the same', async () => {
    const lapsed = await build(claims(9 * HOUR)).svc.sessionStateFor(3, 30, 1);
    const fresh = await build(claims(HOUR)).svc.sessionStateFor(3, 30, 1);

    expect(lapsed.identityExpired).toBe(true);
    expect(fresh.identityExpired).toBe(false);
  });

  it('a SessionService double that predates the policy read does not break the console (platform default)', async () => {
    const { svc } = build(claims(9 * HOUR));
    (svc as unknown as { sessionService: unknown }).sessionService = {};

    const { items } = await svc.listSessions(1, 1, 20);

    expect(items[0].identityExpired).toBe(true);
  });
});

describe('toSessionResponse — identityExpired key', () => {
  const conv = { id: 3, status: 'waiting', sessionId: 30, createdAt: new Date() } as Conversation;

  it('present (true) only when the claims lapsed', () => {
    const lapsed = toSessionResponse(conv, null, undefined, undefined, undefined, undefined, claims(9 * HOUR), null, true);
    const fresh = toSessionResponse(conv, null, undefined, undefined, undefined, undefined, claims(HOUR), null, false);
    const legacy = toSessionResponse(conv, null);

    expect(lapsed.identityExpired).toBe(true);
    expect(fresh).not.toHaveProperty('identityExpired');
    expect(legacy).not.toHaveProperty('identityExpired');
  });
});
