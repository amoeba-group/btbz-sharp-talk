import { createHash } from 'crypto';
import { CJM_STAGE } from '@sharptalk/types';
import { CLAIMS_IAT_WINDOW_SEC, IDENTIFY_REPLAY_TTL_SEC } from './embed.service';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import {
  OTHER_TENANT_SECRET,
  TENANT_SECRET,
  buildEmbedHarness,
  guestSessionRow,
  signedV1,
  signedV2,
} from './embed-test-doubles-spec';

/**
 * Replay protection, v1 refusal and the identity audit trail (PLN-261012 SG-04 / SG-50,
 * REQ D-05).
 *
 * A v2 signature is bound to ONE widget session: it verifies once, and is remembered
 * (Redis SET NX, tenant + hash) for twice the iat window. The same session presenting it
 * again is a retry; any other session presenting it inside the window is refused with the
 * SAME error as a bad signature — a prober must not be able to tell "replayed" from
 * "wrong".
 */
const INVALID = { errorCode: ERROR_CODE.EMBED_IDENTITY_INVALID.code };

const twoSessions = () => [
  guestSessionRow({ id: 5, sessionToken: 'tok-a' }),
  guestSessionRow({ id: 6, sessionToken: 'tok-b' }),
];

describe('identify replay guard (SG-04)', () => {
  it('a verified v2 signature is remembered for 2 x the iat window, keyed by tenant + hash digest', async () => {
    const h = buildEmbedHarness();
    const body = signedV2(TENANT_SECRET, 'tok', 'staff-A');

    await h.service.identify(body);

    const [key, entry] = [...h.redis.store.entries()].find(([k]) => k.startsWith('embed:idrep:'))!;
    expect(IDENTIFY_REPLAY_TTL_SEC).toBe(2 * CLAIMS_IAT_WINDOW_SEC);
    expect(entry.ttlSec).toBe(1200);
    // The hash itself never becomes a key, and the token is stored as a digest, not as itself.
    expect(key).toBe(`embed:idrep:4:${createHash('sha256').update(body.hash).digest('hex')}`);
    expect(key).not.toContain(body.hash);
    expect(entry.value).not.toContain('tok');
    expect(JSON.parse(entry.value).t).toBe(createHash('sha256').update('tok').digest('hex'));
  });

  it('the SAME session sending the same signature again is idempotent (a retry, not a replay)', async () => {
    const h = buildEmbedHarness();
    const body = signedV2(TENANT_SECRET, 'tok', 'staff-A');

    const first = await h.service.identify(body);
    const again = await h.service.identify(body);
    const third = await h.service.identify(body);

    expect(again.sessionToken).toBe(first.sessionToken);
    expect(third.sessionToken).toBe('tok');
    expect(h.sessions).toHaveLength(1);
  });

  it('a DIFFERENT session token presenting the same signature inside the window is refused', async () => {
    const h = buildEmbedHarness({ sessions: twoSessions() });
    const body = signedV2(TENANT_SECRET, 'tok-a', 'staff-A');
    await h.service.identify(body);

    await expect(h.service.identify({ ...body, sessionToken: 'tok-b' })).rejects.toMatchObject(INVALID);

    // …and changed nothing: the second session is still a guest.
    expect(h.sessions.find((s) => s.sessionToken === 'tok-b')).toMatchObject({ customerId: null, identityLevel: 'guest' });
  });

  it('the refusal is indistinguishable from a bad signature (same code, status, message) — no oracle', async () => {
    const h = buildEmbedHarness({ sessions: twoSessions() });
    const body = signedV2(TENANT_SECRET, 'tok-a', 'staff-A');
    await h.service.identify(body);

    const replay = await h.service.identify({ ...body, sessionToken: 'tok-b' }).catch((e) => e);
    const forged = await h.service
      .identify({ ...signedV2(TENANT_SECRET, 'tok-b', 'staff-B'), hash: `${'0'.repeat(63)}1` })
      .catch((e) => e);

    expect(replay.errorCode).toBe(forged.errorCode);
    expect(replay.getStatus()).toBe(forged.getStatus());
    expect(replay.message).toBe(forged.message);
    expect(JSON.stringify(replay.getResponse())).toBe(JSON.stringify(forged.getResponse()));
  });

  it('after the window the signature is no longer remembered — but its iat is, by then, out of range anyway', async () => {
    const h = buildEmbedHarness({ sessions: twoSessions() });
    const body = signedV2(TENANT_SECRET, 'tok-a', 'staff-A');
    await h.service.identify(body);

    h.redis.expireAll(); // what the TTL does 20 minutes later

    // The memory is gone, so the replay guard has nothing to say; the iat window (checked
    // first) is the one that refuses a signature that old. Inside the window it would pass.
    await expect(h.service.identify({ ...body, sessionToken: 'tok-b' })).resolves.toMatchObject({ customerId: 100 });
  });

  it('a prober cannot fill the memory: a signature that does NOT verify is never recorded', async () => {
    const h = buildEmbedHarness();
    const body = signedV2(TENANT_SECRET, 'tok', 'staff-A');

    await h.service.identify({ ...body, hash: `${'0'.repeat(63)}1` }).catch(() => undefined);
    await h.service.identify({ ...body, claims: { ...body.claims, hotelSn: '999' } }).catch(() => undefined);

    expect([...h.redis.store.keys()].filter((k) => k.startsWith('embed:idrep:'))).toHaveLength(0);
  });

  it('is per tenant: the same hash value in another tenant is a different key', async () => {
    const h = buildEmbedHarness();
    const body = signedV2(TENANT_SECRET, 'tok', 'staff-A');
    await h.service.identify(body);

    // A different tenant's session with a hash that happens to collide is not a replay.
    expect([...h.redis.store.keys()].some((k) => k.startsWith('embed:idrep:4:'))).toBe(true);
    expect([...h.redis.store.keys()].some((k) => k.startsWith('embed:idrep:5:'))).toBe(false);
  });

  it('Redis down: fails OPEN (sign-in must not break), says so in the audit row, and the iat window still applies', async () => {
    const h = buildEmbedHarness({ sessions: twoSessions() });
    h.redis.down = true;
    const body = signedV2(TENANT_SECRET, 'tok-a', 'staff-A');

    await expect(h.service.identify(body)).resolves.toMatchObject({ customerId: 100 });
    // A stale signature is still refused without Redis.
    await expect(
      h.service.identify(signedV2(TENANT_SECRET, 'tok-b', 'staff-B', { iat: Math.floor(Date.now() / 1000) - 5000 })),
    ).rejects.toMatchObject(INVALID);

    expect(h.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'embed.identify_ok', metadata: expect.objectContaining({ replayGuard: 'unavailable' }) }),
    );
  });

  it('v1 has no iat and is a standing credential: it is never put through the replay guard', async () => {
    const h = buildEmbedHarness({ sessions: twoSessions() });
    const v1a = signedV1(TENANT_SECRET, 'tok-a', 'odoo-user-1');

    await h.service.identify(v1a);
    await expect(h.service.identify({ ...v1a, sessionToken: 'tok-b' })).resolves.toMatchObject({ customerId: 100 });

    expect([...h.redis.store.keys()].filter((k) => k.startsWith('embed:idrep:'))).toHaveLength(0);
  });

  it('IDENTIFY_REPLAY_GUARD=false switches the guard off (operator kill switch)', async () => {
    const before = process.env.IDENTIFY_REPLAY_GUARD;
    process.env.IDENTIFY_REPLAY_GUARD = 'false';
    try {
      const h = buildEmbedHarness({ sessions: twoSessions() });
      const body = signedV2(TENANT_SECRET, 'tok-a', 'staff-A');
      await h.service.identify(body);

      await expect(h.service.identify({ ...body, sessionToken: 'tok-b' })).resolves.toMatchObject({ customerId: 100 });
    } finally {
      if (before === undefined) delete process.env.IDENTIFY_REPLAY_GUARD;
      else process.env.IDENTIFY_REPLAY_GUARD = before;
    }
  });

  describe('a retry of an identify that FORKED answers with the session it made', () => {
    async function forked() {
      const h = buildEmbedHarness();
      await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'));
      const bodyB = signedV2(TENANT_SECRET, 'tok', 'staff-B');
      const first = await h.service.identify(bodyB);
      return { h, bodyB, first };
    }

    it('the first token re-sending B\'s signature gets the SAME forked session, not a second fork', async () => {
      const { h, bodyB, first } = await forked();
      expect(first.sessionToken).not.toBe('tok');
      const sessionsBefore = h.sessions.length;

      const retry = await h.service.identify(bodyB);

      expect(retry.sessionToken).toBe(first.sessionToken);
      expect(h.sessions).toHaveLength(sessionsBefore);
    });

    it('the forked session may present the same signature itself (the widget identifies again after adopting it)', async () => {
      const { h, bodyB, first } = await forked();

      const again = await h.service.identify({ ...bodyB, sessionToken: first.sessionToken });

      expect(again.sessionToken).toBe(first.sessionToken);
      expect(h.sessions).toHaveLength(2);
    });

    it('a THIRD session still cannot use it', async () => {
      const { h, bodyB } = await forked();
      h.sessions.push(guestSessionRow({ id: 90, sessionToken: 'tok-3' }));

      await expect(h.service.identify({ ...bodyB, sessionToken: 'tok-3' })).rejects.toMatchObject(INVALID);
    });
  });
});

describe('identify after the secret rotates', () => {
  it('a signature made with the OLD secret is refused; one made with the new secret is accepted', async () => {
    const h = buildEmbedHarness();
    const oldSigned = signedV2(TENANT_SECRET, 'tok', 'staff-A');

    const fresh = await h.service.rotateSecret(4);
    expect(h.tenant.embedSecret).toBe(fresh);

    await expect(h.service.identify(oldSigned)).rejects.toMatchObject(INVALID);
    await expect(h.service.identify(signedV2(fresh, 'tok', 'staff-A'))).resolves.toMatchObject({ customerId: 100 });
  });
});

describe('identity_policy.refuseV1 (SG-04)', () => {
  it('rejects a v1 identify (no claims) like any other bad signature', async () => {
    const h = buildEmbedHarness({ identityPolicy: { refuseV1: true } });

    await expect(h.service.identify(signedV1(TENANT_SECRET, 'tok', 'odoo-user-1'))).rejects.toMatchObject(INVALID);

    expect(h.customers).toHaveLength(0);
    expect(h.sessions[0]).toMatchObject({ customerId: null, identityLevel: 'guest' });
  });

  it('…and says why in the audit row, never in the response', async () => {
    const h = buildEmbedHarness({ identityPolicy: { refuseV1: true } });

    const err = await h.service.identify(signedV1(TENANT_SECRET, 'tok', 'odoo-user-1')).catch((e) => e);

    expect(JSON.stringify(err.getResponse())).not.toMatch(/v1|policy|refuse/i);
    expect(h.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'embed.identify_rejected', result: 'denied', metadata: expect.objectContaining({ reason: 'v1_refused', v: 1 }) }),
    );
  });

  it('a v2 identify still works for the same tenant', async () => {
    const h = buildEmbedHarness({ identityPolicy: { refuseV1: true } });

    await expect(h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'))).resolves.toMatchObject({ customerId: 100 });
  });

  it('a tenant with NO policy (or one that sets only maxAgeHours) still accepts v1 — byte-identical to before', async () => {
    for (const identityPolicy of [null, undefined, {}, { maxAgeHours: 4 }, { refuseV1: false }, { refuseV1: 'true' }]) {
      const h = buildEmbedHarness({ identityPolicy });

      await expect(h.service.identify(signedV1(TENANT_SECRET, 'tok', 'odoo-user-1'))).resolves.toMatchObject({
        identityLevel: 'verified',
        identityClaims: null,
      });
    }
  });
});

describe('identity audit trail (SG-50 c) — actor system, no PII', () => {
  const rows = (h: ReturnType<typeof buildEmbedHarness>) => h.audit.write.mock.calls.map(([p]) => p);
  const actions = (h: ReturnType<typeof buildEmbedHarness>) => rows(h).map((p) => p.action);

  it('identify_ok: one row, system actor, the business key and role but never the user id or profile', async () => {
    const h = buildEmbedHarness();

    await h.service.identify({ ...signedV2(TENANT_SECRET, 'tok', 'staff-A@go2joy.vn'), name: 'Nguyen Lan', email: 'lan@example.vn', phone: '0901234567' });

    expect(actions(h)).toEqual(['embed.identify_ok']);
    const [row] = rows(h);
    expect(row).toMatchObject({ tenantId: 4, actorType: 'system', actorId: 0, target: 'session:5', result: 'success' });
    expect(row.metadata).toMatchObject({ v: 2, hotelSn: '1721', role: 'receptionist', forked: false });
    const json = JSON.stringify(row);
    for (const pii of ['staff-A@go2joy.vn', 'Nguyen Lan', 'lan@example.vn', '0901234567', 'Del Luna']) {
      expect(json).not.toContain(pii);
    }
    // The user is a stable, non-reversible key — enough to correlate, useless to read.
    expect(row.metadata.user).toMatch(/^[0-9a-f]{16}$/);
  });

  it('the user key is per tenant and stable', async () => {
    const a = buildEmbedHarness();
    const b = buildEmbedHarness();
    await a.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'));
    await b.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'));

    expect(rows(a)[0].metadata.user).toBe(rows(b)[0].metadata.user);
  });

  it('a fork writes identify_ok AND identity_forked, linking the two sessions', async () => {
    const h = buildEmbedHarness();
    await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'));
    h.audit.write.mockClear();

    const forkedSession = await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-B'));

    expect(actions(h)).toEqual(['embed.identify_ok', 'embed.identity_forked']);
    const forked = rows(h)[1];
    expect(forked).toMatchObject({ target: 'session:5', actorType: 'system' });
    expect(forked.metadata).toMatchObject({ toSession: Number(forkedSession.id), sameCustomer: false });
  });

  it('identify_rejected: system actor, result denied, the reason in the audit row only', async () => {
    const h = buildEmbedHarness();

    await h.service.identify({ ...signedV2(TENANT_SECRET, 'tok', 'staff-A'), hash: `${'0'.repeat(63)}1` }).catch(() => undefined);

    expect(rows(h)).toEqual([
      expect.objectContaining({
        action: 'embed.identify_rejected',
        actorType: 'system',
        actorId: 0,
        result: 'denied',
        target: 'session:5',
        metadata: expect.objectContaining({ reason: 'bad_signature', v: 2 }),
      }),
    ]);
  });

  it.each([
    ['iat outside the window', (h: ReturnType<typeof buildEmbedHarness>) => signedV2(TENANT_SECRET, 'tok', 'u', { iat: Math.floor(Date.now() / 1000) - 5000 }), 'iat_window'],
    ['a bad v1 hash', () => ({ ...signedV1(TENANT_SECRET, 'tok', 'u'), hash: 'f'.repeat(64) }), 'bad_signature'],
    ['a signature from another tenant', () => signedV2(OTHER_TENANT_SECRET, 'tok', 'u'), 'bad_signature'],
  ])('records the reason for %s', async (_name, make, reason) => {
    const h = buildEmbedHarness();

    await h.service.identify(make(h)).catch(() => undefined);

    expect(rows(h)[0].metadata.reason).toBe(reason);
  });

  it('a replay is recorded as "replay"', async () => {
    const h = buildEmbedHarness({ sessions: twoSessions() });
    const body = signedV2(TENANT_SECRET, 'tok-a', 'staff-A');
    await h.service.identify(body);
    h.audit.write.mockClear();

    await h.service.identify({ ...body, sessionToken: 'tok-b' }).catch(() => undefined);

    expect(rows(h)[0].metadata).toMatchObject({ reason: 'replay' });
  });

  it('a tenant with no secret is recorded as no_secret', async () => {
    const h = buildEmbedHarness({ secret: null });

    await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'u')).catch(() => undefined);

    expect(rows(h)[0].metadata.reason).toBe('no_secret');
  });

  it('a flood of refusals writes ONE row per (tenant, reason, user) per minute — the rest are not audited', async () => {
    const h = buildEmbedHarness();
    const bad = { ...signedV2(TENANT_SECRET, 'tok', 'staff-A'), hash: `${'0'.repeat(63)}1` };

    for (let i = 0; i < 30; i++) await h.service.identify(bad).catch(() => undefined);

    expect(actions(h)).toEqual(['embed.identify_rejected']);
    // A different reason, or a different user, is a new row.
    await h.service.identify({ ...bad, claims: { ...bad.claims, iat: 1 } }).catch(() => undefined);
    await h.service.identify({ ...bad, userId: 'staff-Z' }).catch(() => undefined);
    expect(actions(h)).toHaveLength(3);
  });

  it('a failing audit write never turns a sign-in into an error, nor a refusal into a 500', async () => {
    const h = buildEmbedHarness();
    h.audit.write.mockRejectedValue(new Error('audit down'));

    await expect(h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'))).resolves.toMatchObject({ customerId: 100 });
    await expect(
      h.service.identify({ ...signedV2(TENANT_SECRET, 'tok', 'staff-B'), hash: `${'0'.repeat(63)}1` }),
    ).rejects.toMatchObject(INVALID);
  });

  it('built without an audit service (older positional doubles) everything still works', async () => {
    const h = buildEmbedHarness({ withAudit: false });

    await expect(h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'))).resolves.toMatchObject({ customerId: 100 });
    await expect(h.service.logout('tok')).resolves.toEqual({ loggedOut: true });
  });

  it('logout: one row with the counts, no identity', async () => {
    const h = buildEmbedHarness();
    await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'));
    h.conversations.push({ id: 1, sessionId: 5, status: 'ai_active', endedAt: null });
    h.audit.write.mockClear();

    await h.service.logout('tok');

    expect(rows(h)).toEqual([
      expect.objectContaining({
        action: 'embed.logout',
        actorType: 'system',
        target: 'session:5',
        metadata: { wasBound: true, endedConversations: 1 },
      }),
    ]);
  });
});

describe('S1 follow-ups: consent per data subject, CJM on fork, logout issue hook, stamp backfill', () => {
  const CONSENT_AT = new Date('2026-10-01T09:00:00.000Z');

  it('the SAME customer on another hotel carries consent over', async () => {
    const h = buildEmbedHarness();
    await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'mgr-M', { role: 'manager', hotelSn: '1721' }));

    const out = await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'mgr-M', { role: 'manager', hotelSn: '2204' }));

    expect(out.sessionToken).not.toBe('tok');
    expect(out).toMatchObject({ consentState: 'granted', consentVersion: '2026-07' });
    expect(out.consentAt).toEqual(CONSENT_AT);
  });

  it('a DIFFERENT customer starts with consent PENDING and no timestamp/version', async () => {
    const h = buildEmbedHarness();
    await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'));

    const out = await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-B'));

    expect(out).toMatchObject({ consentState: 'pending', consentVersion: null });
    expect(out.consentAt ?? null).toBeNull();
    // The previous person's own consent is untouched.
    expect(h.sessions[0]).toMatchObject({ consentState: 'granted', consentVersion: '2026-07' });
  });

  it('a guest → user upgrade is the SAME session and keeps whatever consent it had', async () => {
    const h = buildEmbedHarness();

    const out = await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'));

    expect(out.sessionToken).toBe('tok');
    expect(out.consentState).toBe('granted');
  });

  it('a forked session announces itself to the journey like a fresh one (session_start, awareness)', async () => {
    const h = buildEmbedHarness();
    await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'));
    expect(h.bus.publish).not.toHaveBeenCalled(); // an in-place identify is not a new visit

    const out = await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-B'));

    expect(h.bus.publish).toHaveBeenCalledTimes(1);
    expect(h.bus.publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: 4, sessionId: out.id, customerId: 101, stage: CJM_STAGE.AWARENESS, eventType: 'session_start' }),
    );
  });

  it('a failing event bus does not fail the sign-in', async () => {
    const h = buildEmbedHarness();
    await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'));
    h.bus.publish.mockRejectedValue(new Error('bus down'));

    await expect(h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-B'))).resolves.toMatchObject({ customerId: 101 });
  });

  it('logout closes the issue of every AI thread it ends (not customer-ended: nothing is auto-resolved)', async () => {
    const h = buildEmbedHarness();
    await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'));
    h.conversations.push(
      { id: 11, sessionId: 5, status: 'ai_active', endedAt: null },
      { id: 12, sessionId: 5, status: 'agent', endedAt: null },
      { id: 13, sessionId: 77, status: 'ai_active', endedAt: null },
    );

    await h.service.logout('tok');

    expect(h.issue.onConversationEnded).toHaveBeenCalledTimes(1);
    expect(h.issue.onConversationEnded).toHaveBeenCalledWith(11, false);
  });

  it('a failing issue hook is logged, never thrown', async () => {
    const h = buildEmbedHarness();
    await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'));
    h.conversations.push({ id: 11, sessionId: 5, status: 'ai_active', endedAt: null });
    h.issue.onConversationEnded.mockRejectedValue(new Error('issue down'));

    await expect(h.service.logout('tok')).resolves.toEqual({ loggedOut: true });
  });

  it('logout with nothing to end never touches the issue service', async () => {
    const h = buildEmbedHarness();
    await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'));

    await h.service.logout('tok');

    expect(h.issue.onConversationEnded).not.toHaveBeenCalled();
  });

  describe('conversation stamp backfill when a guest signs in on the same session', () => {
    it('stamps the open, unstamped conversation with the signed hotel and role', async () => {
      const h = buildEmbedHarness();
      h.conversations.push({ id: 1, sessionId: 5, status: 'ai_active', hotelSn: null, actorRole: null });

      await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A', { hotelSn: '1721', role: 'manager' }));

      expect(h.conversations[0]).toMatchObject({ hotelSn: '1721', actorRole: 'manager' });
    });

    it('never overwrites a stamp that is already there', async () => {
      const h = buildEmbedHarness();
      h.conversations.push({ id: 1, sessionId: 5, status: 'ai_active', hotelSn: '999', actorRole: 'internal' });

      await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'));

      expect(h.conversations[0]).toMatchObject({ hotelSn: '999', actorRole: 'internal' });
    });

    it('leaves finished conversations and other sessions\' conversations alone', async () => {
      const h = buildEmbedHarness();
      h.conversations.push(
        { id: 1, sessionId: 5, status: 'ended', hotelSn: null, actorRole: null },
        { id: 2, sessionId: 77, status: 'ai_active', hotelSn: null, actorRole: null },
      );

      await h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'));

      expect(h.conversations[0].hotelSn).toBeNull();
      expect(h.conversations[1].hotelSn).toBeNull();
    });

    it('a v1 identify (no claims) stamps nothing', async () => {
      const h = buildEmbedHarness();
      h.conversations.push({ id: 1, sessionId: 5, status: 'ai_active', hotelSn: null, actorRole: null });

      await h.service.identify(signedV1(TENANT_SECRET, 'tok', 'odoo-user-1'));

      expect(h.conversations[0].hotelSn).toBeNull();
    });

    it('a failing backfill does not fail the sign-in', async () => {
      const h = buildEmbedHarness();
      h.convRepo.update.mockRejectedValue(new Error('db down'));

      await expect(h.service.identify(signedV2(TENANT_SECRET, 'tok', 'staff-A'))).resolves.toMatchObject({ customerId: 100 });
    });
  });
});
