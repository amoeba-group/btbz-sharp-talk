import { AiConfigService } from './ai-config.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import type { KbVersionPolicy } from '@sharptalk/types';

/**
 * Saving the tenant's KB reference version (PLN-261012 SG-20).
 *
 * The rules under test: a malformed policy is refused before anything else in
 * the request is written; a changed reference version or mode retires the
 * answer-reuse store (stored replays were generated under the old rule); a
 * wording-only change, or no change, does not; the change is audited; a tenant
 * that never sends the field is untouched.
 */
describe('AiConfigService — KB version policy', () => {
  const REF: KbVersionPolicy = { referenceVersion: 'v0.12.0', onMismatch: 'caveat' };

  function build(stored: KbVersionPolicy | null = null) {
    const row = { tenantId: 1, kbVersionPolicy: stored } as { tenantId: number; kbVersionPolicy: KbVersionPolicy | null };
    const configRepo = {
      findOne: jest.fn(async () => row),
      create: jest.fn((r: object) => r),
      save: jest.fn(async (r: typeof row) => {
        Object.assign(row, r);
        return row;
      }),
    };
    const agentRepo = { findOne: jest.fn(async () => ({ id: 3, isDefault: 1 })), save: jest.fn() };
    const redis = { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() };
    const answerReuse = { deactivateAll: jest.fn(async () => 4) };
    const audit = { write: jest.fn(async () => undefined) };
    const agents = { ensureDefault: jest.fn(async () => ({ id: 3, isDefault: 1 })) };
    const svc = new AiConfigService(
      configRepo as never,
      agentRepo as never,
      {} as never,
      {} as never,
      redis as never,
      { record: jest.fn() } as never,
      agents as never,
      answerReuse as never,
      audit as never,
    );
    return { svc, row, configRepo, agentRepo, answerReuse, audit };
  }

  const save = (svc: AiConfigService, kbVersionPolicy: unknown) =>
    svc.upsertConfig(1, { kbVersionPolicy }, { kind: 'manual', actorUserId: 77 } as never);

  it('stores the cleaned policy and returns it with the config', async () => {
    const h = build();
    const res = await save(h.svc, { referenceVersion: ' v0.12.0 ', onMismatch: 'hide', notice: { VI: ' Bản cũ. ' } });
    expect(h.row.kbVersionPolicy).toEqual({ referenceVersion: 'v0.12.0', onMismatch: 'hide', notice: { VI: 'Bản cũ.' } });
    expect(res.kbVersionPolicy).toEqual(h.row.kbVersionPolicy);
  });

  it('reads back as null for a tenant that never configured it', async () => {
    const h = build();
    expect((await h.svc.getConfig(1)).kbVersionPolicy).toBeNull();
    expect(await h.svc.getKbVersionPolicy(1)).toBeNull();
    expect(await h.svc.getKbVersionPolicy(null)).toBeNull();
  });

  it('null clears the policy', async () => {
    const h = build(REF);
    await save(h.svc, null);
    expect(h.row.kbVersionPolicy).toBeNull();
  });

  it('refuses a malformed policy with E5111 and writes nothing — not even the persona sent with it', async () => {
    const h = build();
    const attempt = h.svc.upsertConfig(1, { persona: 'new persona', kbVersionPolicy: { onMismatch: 'delete' } });
    await expect(attempt).rejects.toBeInstanceOf(BusinessException);
    await expect(attempt).rejects.toMatchObject({ errorCode: ERROR_CODE.KB_VERSION_POLICY_INVALID.code });
    expect(h.agentRepo.save).not.toHaveBeenCalled();
    expect(h.configRepo.save).not.toHaveBeenCalled();
    expect(h.answerReuse.deactivateAll).not.toHaveBeenCalled();
  });

  describe('retires the answer-reuse store when what answers may cite changed', () => {
    it('a new reference version', async () => {
      const h = build(REF);
      await save(h.svc, { referenceVersion: 'v0.13.0', onMismatch: 'caveat' });
      expect(h.answerReuse.deactivateAll).toHaveBeenCalledWith(1);
    });

    it('a new mode', async () => {
      const h = build(REF);
      await save(h.svc, { referenceVersion: 'v0.12.0', onMismatch: 'hide' });
      expect(h.answerReuse.deactivateAll).toHaveBeenCalledWith(1);
    });

    it('switching it on for the first time', async () => {
      const h = build(null);
      await save(h.svc, REF);
      expect(h.answerReuse.deactivateAll).toHaveBeenCalledWith(1);
    });

    it('switching it off', async () => {
      const h = build(REF);
      await save(h.svc, null);
      expect(h.answerReuse.deactivateAll).toHaveBeenCalledWith(1);
    });
  });

  describe('leaves the store alone', () => {
    it('when only the caveat wording changed (it is appended at delivery, replays included)', async () => {
      const h = build(REF);
      await save(h.svc, { ...REF, notice: { EN: 'Different wording.' } });
      expect(h.answerReuse.deactivateAll).not.toHaveBeenCalled();
      expect(h.audit.write).not.toHaveBeenCalled();
    });

    it('when the same version is merely re-spelled', async () => {
      const h = build(REF);
      await save(h.svc, { referenceVersion: 'V0.12.0', onMismatch: 'caveat' });
      expect(h.answerReuse.deactivateAll).not.toHaveBeenCalled();
    });

    it('when the request does not mention the policy at all', async () => {
      const h = build(REF);
      await h.svc.upsertConfig(1, { answerFooter: { enabled: false, text: {}, protected: [] } });
      expect(h.answerReuse.deactivateAll).not.toHaveBeenCalled();
      expect(h.row.kbVersionPolicy).toEqual(REF);
    });
  });

  it('audits who changed what customers are told, with the old and new reference', async () => {
    const h = build(REF);
    await save(h.svc, { referenceVersion: 'v0.13.0', onMismatch: 'hide' });
    expect(h.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 1,
        actorType: 'user',
        actorId: 77,
        action: 'ai_config.kb_version_policy',
        metadata: {
          from: { referenceVersion: 'v0.12.0', onMismatch: 'caveat' },
          to: { referenceVersion: 'v0.13.0', onMismatch: 'hide' },
        },
      }),
    );
  });

  it('a reuse-store outage does not turn a saved policy into an error', async () => {
    const h = build(REF);
    h.answerReuse.deactivateAll.mockRejectedValueOnce(new Error('redis down'));
    await expect(save(h.svc, { referenceVersion: 'v0.13.0', onMismatch: 'caveat' })).resolves.toBeDefined();
    expect(h.row.kbVersionPolicy?.referenceVersion).toBe('v0.13.0');
  });

  it('an audit failure does not either', async () => {
    const h = build(REF);
    h.audit.write.mockRejectedValueOnce(new Error('audit down'));
    await expect(save(h.svc, { referenceVersion: 'v0.13.0', onMismatch: 'caveat' })).resolves.toBeDefined();
  });

  it('works for service instances built without the optional collaborators', async () => {
    const h = build(REF);
    const bare = new AiConfigService(
      h.configRepo as never,
      h.agentRepo as never,
      {} as never,
      {} as never,
      { available: () => false, del: jest.fn() } as never,
      { record: jest.fn() } as never,
      {} as never,
    );
    await expect(save(bare, { referenceVersion: 'v9', onMismatch: 'caveat' })).resolves.toBeDefined();
  });
});
