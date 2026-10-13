import { FindOperator } from 'typeorm';
import { KB_VERSION_CAVEAT_DEFAULTS } from '@sharptalk/types';
import type { KbVersionPolicy } from '@sharptalk/types';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeMapper } from './knowledge.mapper';
import { ListDocumentsQuery } from './dto/request/knowledge.request';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/**
 * UI-version stamping on the document side of the knowledge service
 * (PLN-261012 SG-20): editing the label, the list filter, the console Q&A, and
 * retiring stored replays under the `hide` policy.
 */
describe('KnowledgeService — KB UI version', () => {
  const REF: KbVersionPolicy = { referenceVersion: 'v0.12.0', onMismatch: 'caveat' };

  function build(opts: { policy?: KbVersionPolicy | null; doc?: Record<string, unknown>; cited?: Array<Record<string, unknown>> } = {}) {
    const stored = { id: 10, tenantId: 1, title: 'Reconciliation', content: 'Body', category: 'c', active: 1, embeddingModel: 'm', uiVersion: null, ...opts.doc };
    const docRepo = {
      findOne: jest.fn(async () => ({ ...stored })),
      save: jest.fn(async (d: Record<string, unknown>) => d),
      create: jest.fn((d: Record<string, unknown>) => d),
      findAndCount: jest.fn(async () => [[], 0]),
      find: jest.fn(async () => opts.cited ?? []),
    };
    const revisions = { record: jest.fn(async () => null), recordAudit: jest.fn(), restore: jest.fn() };
    const rag = {
      kbVersionPolicy: jest.fn(async () => opts.policy ?? null),
      versionCaveat: jest.fn(async () => null),
      answer: jest.fn(),
    };
    const answerReuse = { deactivateAll: jest.fn(async () => 2) };
    const svc = new KnowledgeService(
      {} as never,
      docRepo as never,
      {} as never,
      { embed: jest.fn(async () => ({ vectors: [[1]], model: 'm' })) } as never,
      { enabled: false } as never,
      rag as never,
      { moderate: jest.fn() } as never,
      { forDocuments: jest.fn(async () => new Set()) } as never,
      revisions as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      answerReuse as never,
    );
    return { svc, docRepo, revisions, rag, answerReuse };
  }

  const errorCode = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      return e instanceof BusinessException ? e.errorCode : `unexpected ${String(e)}`;
    }
  };

  describe('editing a document', () => {
    it('stamps a version, trimmed, as typed', async () => {
      const h = build();
      const saved = await h.svc.updateDocument(1, 10, { ui_version: ' v23.3.0 ' } as never);
      expect(saved.uiVersion).toBe('v23.3.0');
    });

    it('a blank or null label clears it back to unversioned', async () => {
      for (const cleared of ['', '  ', null]) {
        const h = build({ doc: { uiVersion: 'v0.9.2' } });
        const saved = await h.svc.updateDocument(1, 10, { ui_version: cleared } as never);
        expect(saved.uiVersion).toBeNull();
      }
    });

    it('leaves the stored version alone when the request does not mention it', async () => {
      const h = build({ doc: { uiVersion: 'v0.9.2' } });
      const saved = await h.svc.updateDocument(1, 10, { title: 'New title' } as never);
      expect(saved.uiVersion).toBe('v0.9.2');
    });

    it('refuses a malformed label with E5110 and saves nothing', async () => {
      const h = build();
      expect(await errorCode(h.svc.updateDocument(1, 10, { ui_version: 'v 1 / 2' } as never))).toBe(
        ERROR_CODE.KB_UI_VERSION_INVALID.code,
      );
      expect(h.docRepo.save).not.toHaveBeenCalled();
    });

    it('a version change is metadata: it does not re-embed', async () => {
      const h = build();
      await h.svc.updateDocument(1, 10, { ui_version: 'v0.9.2' } as never);
      expect(h.docRepo.save).toHaveBeenCalledTimes(1); // embedOnce would save a second time
    });

    it('records the change in the history, with the pre-edit state as the diff base', async () => {
      const h = build({ doc: { uiVersion: 'v0.9.2' } });
      await h.svc.updateDocument(1, 10, { ui_version: 'v0.12.0' } as never, 7);
      const call = h.revisions.record.mock.calls[0] as unknown as [number, { uiVersion: string }, { uiVersion: string }, string, number];
      expect(call[1].uiVersion).toBe('v0.12.0');
      expect(call[2].uiVersion).toBe('v0.9.2');
      expect(call[3]).toBe('update');
    });

    it('creates a document with a version', async () => {
      const h = build();
      const created = await h.svc.createDocument(1, { category: 'c', title: 't', content: 'x', ui_version: 'v23.4.0' } as never);
      expect(created.uiVersion).toBe('v23.4.0');
    });

    it('creates a document without one as unversioned', async () => {
      const h = build();
      const created = await h.svc.createDocument(1, { category: 'c', title: 't', content: 'x' } as never);
      expect(created.uiVersion).toBeNull();
    });

    it('refuses a malformed label on create (E5110) before anything is written', async () => {
      const h = build();
      expect(
        await errorCode(h.svc.createDocument(1, { category: 'c', title: 't', content: 'x', ui_version: 'a b' } as never)),
      ).toBe(ERROR_CODE.KB_UI_VERSION_INVALID.code);
      expect(h.docRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('stored replays under the hide policy', () => {
    it('re-stamping a document retires them (a hidden document must not be replayed)', async () => {
      const h = build({ policy: { ...REF, onMismatch: 'hide' }, doc: { uiVersion: 'v0.12.0' } });
      await h.svc.updateDocument(1, 10, { ui_version: 'v0.9.2' } as never);
      expect(h.answerReuse.deactivateAll).toHaveBeenCalledWith(1);
    });

    it.each([
      ['caveat (read live at delivery)', REF],
      ['off', { ...REF, onMismatch: 'off' } as KbVersionPolicy],
      ['no policy', null],
    ])('is not needed for %s', async (_n, policy) => {
      const h = build({ policy, doc: { uiVersion: 'v0.12.0' } });
      await h.svc.updateDocument(1, 10, { ui_version: 'v0.9.2' } as never);
      expect(h.answerReuse.deactivateAll).not.toHaveBeenCalled();
    });

    it('an edit that does not touch the version leaves them be', async () => {
      const h = build({ policy: { ...REF, onMismatch: 'hide' }, doc: { uiVersion: 'v0.12.0' } });
      await h.svc.updateDocument(1, 10, { title: 'Reworded' } as never);
      expect(h.answerReuse.deactivateAll).not.toHaveBeenCalled();
    });

    it('a restore that moves the version retires them', async () => {
      const h = build({ policy: { ...REF, onMismatch: 'hide' } });
      h.revisions.restore.mockResolvedValueOnce({ doc: { id: 10 }, contentChanged: false, versionChanged: true } as never);
      await h.svc.restoreRevision(1, 10, 77, 7);
      expect(h.answerReuse.deactivateAll).toHaveBeenCalledWith(1);
    });

    it('a failing reuse store never turns a saved edit into an error', async () => {
      const h = build({ policy: { ...REF, onMismatch: 'hide' }, doc: { uiVersion: 'v0.12.0' } });
      h.answerReuse.deactivateAll.mockRejectedValueOnce(new Error('redis down'));
      await expect(h.svc.updateDocument(1, 10, { ui_version: 'v0.9.2' } as never)).resolves.toBeDefined();
    });
  });

  describe('the list filter', () => {
    const q = (extra: Partial<ListDocumentsQuery>): ListDocumentsQuery =>
      ({ page: '1', size: '20', ...extra }) as ListDocumentsQuery;
    const whereOf = (h: ReturnType<typeof build>) =>
      (h.docRepo.findAndCount.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;

    it('selects the version column (the list drops the body, not this)', async () => {
      const h = build();
      await h.svc.listDocuments(1, q({}));
      const sel = (h.docRepo.findAndCount.mock.calls[0] as unknown as [{ select: string[] }])[0].select;
      expect(sel).toContain('uiVersion');
    });

    it('unversioned: NULL or blank, no reference needed', async () => {
      const h = build();
      await h.svc.listDocuments(1, q({ ui_version_state: 'unversioned' }));
      const op = whereOf(h).uiVersion as FindOperator<string> & { getSql: (c: string) => string };
      expect(op.getSql('d.ui_version')).toBe("(d.ui_version IS NULL OR TRIM(d.ui_version) = '')");
      expect(whereOf(h).tenantId).toBe(1);
    });

    it('mismatch: stamped and different from the NORMALISED reference', async () => {
      const h = build({ policy: { referenceVersion: 'V0.12.0', onMismatch: 'caveat' } });
      await h.svc.listDocuments(1, q({ ui_version_state: 'mismatch' }));
      const op = whereOf(h).uiVersion as FindOperator<string> & {
        getSql: (c: string) => string;
        objectLiteralParameters: Record<string, string>;
      };
      expect(op.getSql('d.ui_version')).toContain("NOT (d.ui_version IS NULL OR TRIM(d.ui_version) = '')");
      expect(op.getSql('d.ui_version')).toContain('<> :uiVerRef');
      expect(op.objectLiteralParameters).toEqual({ uiVerRef: '0.12.0' });
    });

    it('mismatch also works for a tenant whose mode is off (the filter is a review tool)', async () => {
      const h = build({ policy: { referenceVersion: 'v1', onMismatch: 'off' } });
      await h.svc.listDocuments(1, q({ ui_version_state: 'mismatch' }));
      expect(h.docRepo.findAndCount).toHaveBeenCalled();
    });

    it('mismatch with no reference version set is an empty page, not a query', async () => {
      const h = build({ policy: null });
      const res = await h.svc.listDocuments(1, q({ ui_version_state: 'mismatch', page: '2' }));
      expect(res).toEqual({ items: [], total: 0, page: 2, size: 20 });
      expect(h.docRepo.findAndCount).not.toHaveBeenCalled();
    });

    it('no version filter leaves the where clause exactly as before', async () => {
      const h = build();
      await h.svc.listDocuments(1, q({}));
      expect(whereOf(h)).toEqual({ tenantId: 1 });
    });
  });

  describe('console Q&A', () => {
    const answer = {
      text: 'Reconciliation closes on the 5th.',
      confidence: 0.9,
      citations: [
        { id: 5, title: 'A', category: null, similarity: 0.8, snippet: 's' },
        { id: 6, title: 'B', category: null, similarity: 0.7, snippet: 's' },
        { id: 7, title: 'C', category: null, similarity: 0.6, snippet: 's' },
      ],
    };
    const cited = [
      { id: 5, tenantId: 1, source: 'knowledge_store', uiVersion: 'v0.9.2' },
      { id: 6, tenantId: 1, source: 'knowledge_store', uiVersion: 'v0.12.0' },
      { id: 7, tenantId: 1, source: 'knowledge_store', uiVersion: null },
    ];
    const moderate = (svc: KnowledgeService) =>
      ((svc as unknown as { moderation: { moderate: jest.Mock } }).moderation.moderate.mockImplementation(async (p: { text: string }) => ({
        decision: 'delivered',
        text: p.text,
      })));

    it('returns each source\'s version and where it stands against the reference', async () => {
      const h = build({ policy: REF, cited });
      h.rag.answer.mockResolvedValueOnce(answer as never);
      moderate(h.svc);
      const res = await h.svc.ask(1, 'q', 'en');
      expect(res.sources.map((s) => [s.id, s.uiVersion, s.versionState])).toEqual([
        [5, 'v0.9.2', 'mismatch'],
        [6, 'v0.12.0', 'match'],
        [7, null, 'unversioned'],
      ]);
    });

    it('versionState is null while the tenant has no reference (the feature is not in use)', async () => {
      const h = build({ policy: null, cited });
      h.rag.answer.mockResolvedValueOnce(answer as never);
      moderate(h.svc);
      const res = await h.svc.ask(1, 'q', 'en');
      expect(res.sources.map((s) => s.versionState)).toEqual([null, null, null]);
      expect(res.sources.map((s) => s.uiVersion)).toEqual(['v0.9.2', 'v0.12.0', null]);
    });

    it('shows the operator the caveat a shopper would read, after moderation', async () => {
      const h = build({ policy: REF, cited });
      h.rag.answer.mockResolvedValueOnce(answer as never);
      h.rag.versionCaveat.mockResolvedValueOnce(KB_VERSION_CAVEAT_DEFAULTS.EN as never);
      moderate(h.svc);
      const res = await h.svc.ask(1, 'q', 'en');
      expect(res.answer).toBe(`${answer.text}\n\n${KB_VERSION_CAVEAT_DEFAULTS.EN}`);
      const moderated = ((h.svc as unknown as { moderation: { moderate: jest.Mock } }).moderation.moderate.mock
        .calls[0] as unknown as [{ text: string }])[0].text;
      expect(moderated).toBe(answer.text);
    });

    it('adds no caveat to a blocked answer', async () => {
      const h = build({ policy: REF, cited });
      h.rag.answer.mockResolvedValueOnce(answer as never);
      ((h.svc as unknown as { moderation: { moderate: jest.Mock } }).moderation.moderate).mockResolvedValueOnce({
        decision: 'blocked',
        text: '',
      });
      const res = await h.svc.ask(1, 'q', 'en');
      expect(res.blocked).toBe(true);
      expect(res.answer).toBe('');
      expect(h.rag.versionCaveat).not.toHaveBeenCalled();
    });
  });

  describe('document response', () => {
    it('carries uiVersion (null = unversioned)', () => {
      expect(KnowledgeMapper.toDocument({ id: 1, uiVersion: 'v1.0' } as never).uiVersion).toBe('v1.0');
      expect(KnowledgeMapper.toDocument({ id: 1 } as never).uiVersion).toBeNull();
    });

    it('a revision detail carries it too; null means the revision recorded none', () => {
      expect(KnowledgeMapper.toRevision({ id: 1, uiVersion: 'v1.0' } as never, true)).toMatchObject({ uiVersion: 'v1.0' });
      expect(KnowledgeMapper.toRevision({ id: 1 } as never, true)).toMatchObject({ uiVersion: null });
    });
  });
});
