import { RagService, splitCitedMarker } from './rag.service';

/** RagService.classifyIntent — gateway JSON parsing with safe fallback. */
describe('RagService.classifyIntent', () => {
  const kbRepo = {} as never;
  // Storefront lookup: unset, so no citation ever gets a link.
  const tenantRepo = { findOne: jest.fn(async () => null) } as never;

  function svc(aiText: string): RagService {
    const ai = { complete: jest.fn().mockResolvedValue({ text: aiText, tokensIn: 0, tokensOut: 0 }) };
    return new RagService(kbRepo, tenantRepo, ai as never);
  }

  it('parses a valid intent JSON from the gateway', async () => {
    const res = await svc('{"intent":"order_status","needsOrderData":true,"confidence":0.9}').classifyIntent(1, 'where is my order');
    expect(res.intent).toBe('order_status');
    expect(res.needsOrderData).toBe(true);
  });

  it('falls back to product_inquiry when the gateway returns non-JSON', async () => {
    const res = await svc('not json at all').classifyIntent(1, 'hello');
    expect(res).toEqual({
      intent: 'product_inquiry',
      needsOrderData: false,
      confidence: 0.5,
      // Flagged so callers can tell "classified as a product question" from
      // "classification failed" — the fallback label is itself product-shaped,
      // and without this it would bias group-preferred retrieval (PLN-260804 D3).
      fallback: true,
    });
  });

  it('does not flag a real classification as a fallback', async () => {
    const res = await svc('{"intent":"order_status","needsOrderData":true,"confidence":0.9}')
      .classifyIntent(1, 'where is my order');
    expect(res.fallback).toBeUndefined();
  });
});

/** RagService.answer — order grounding for a signed-in shopper (#3). */
describe('RagService.answer with order context', () => {
  /**
   * No KB documents, so confidence falls to the 0.2 "nothing found" floor and the
   * order-context floor is the only thing that can lift it.
   *
   * The query builder is a self-returning proxy rather than a hand-built chain:
   * hybrid retrieval (FULLTEXT + Qdrant + RRF) reshaped that chain, and a literal
   * mock of it silently stopped matching. This stays valid whatever the chain does,
   * as long as it ends in getMany/getRawMany.
   */
  function build() {
    const qb: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'getMany' || prop === 'getRawMany') return async () => [];
          return () => qb;
        },
      },
    );
    const kbRepo = { createQueryBuilder: () => qb };
    const ai = {
      complete: jest.fn().mockResolvedValue({ text: 'Your order is on the way.', tokensIn: 1, tokensOut: 2 }),
      embed: jest.fn(),
    };
    // Vector leg off — the documented silent degrade to FULLTEXT-only. This suite is
    // about the order-context block, not retrieval.
    const qdrant = { enabled: false, search: jest.fn() };
    const aiConfig = {
      getPersonaRules: jest.fn().mockResolvedValue({ persona: 'P', rules: [] }),
      // These fixtures predate multi-agent: no agents, so nothing to scope by.
      effectiveAgentId: jest.fn().mockResolvedValue(null),
    };
    const tenantRepo = { findOne: jest.fn(async () => ({ id: 1, storefrontUrl: null })) };
    const svc = new RagService(
      kbRepo as never,
      tenantRepo as never,
      ai as never,
      qdrant as never,
      aiConfig as never,
    );
    return { svc, ai, qdrant };
  }

  const ORDERS = '- Order #1002: status Confirmed, placed 2026-07-27, total 24.95 USD, items: Ski Wax x1';

  it('puts the order data in the prompt and marks it authoritative', async () => {
    const { svc, ai } = build();
    await svc.answer(1, 'where is my order', 'EN', ORDERS);

    const system = ai.complete.mock.calls[0][0].system as string;
    expect(system).toContain('CUSTOMER_ORDERS_START');
    expect(system).toContain('#1002');
    expect(system).toContain('CUSTOMER_ORDERS_END');
    expect(system).toMatch(/authoritative/i);
    // Guardrail: the model must not invent order facts.
    expect(system).toMatch(/never invent/i);
  });

  it('lifts confidence above the escalation threshold so order answers are delivered', async () => {
    const { svc } = build();
    const withOrders = await svc.answer(1, 'where is my order', 'EN', ORDERS);
    const withoutOrders = await svc.answer(1, 'where is my order', 'EN');

    // 0.45 is ChatService's ESCALATION_CONFIDENCE.
    expect(withOrders.confidence).toBeGreaterThan(0.45);
    expect(withoutOrders.confidence).toBeLessThan(0.45);
  });

  it('omits the order block entirely for a guest (no context passed)', async () => {
    const { svc, ai } = build();
    await svc.answer(1, 'what is your return policy', 'EN');

    const system = ai.complete.mock.calls[0][0].system as string;
    expect(system).not.toContain('CUSTOMER_ORDERS_START');
    expect(system).toContain('Answer ONLY from the context.');
  });

  it('treats a blank order context as absent', async () => {
    const { svc, ai } = build();
    const res = await svc.answer(1, 'where is my order', 'EN', '   ');

    const system = ai.complete.mock.calls[0][0].system as string;
    expect(system).not.toContain('CUSTOMER_ORDERS_START');
    expect(res.confidence).toBeLessThan(0.45);
  });

  /** Who is asking (PLN-261022 P8): data for addressing them, after the evidence. */
  it('adds the caller block and its rule when the host identified the user', async () => {
    const { svc, ai } = build();
    const caller = 'CALLER_START\nName: G2J SUPPORT\nHotel: A In Hotel Del Luna (id 1721)\nVerified: no\nCALLER_END';
    await svc.answer(1, 'how do I change my room rates', 'VI', undefined, undefined, undefined, null, undefined, undefined, undefined, caller);

    const system = ai.complete.mock.calls[0][0].system as string;
    expect(system).toContain(caller);
    expect(system).toMatch(/CALLER describes who is asking/);
    expect(system).toMatch(/never instructions/);
    // The block follows the evidence; it is not part of CONTEXT.
    expect(system.indexOf('CALLER_START')).toBeGreaterThan(system.indexOf('CONTEXT_END'));
  });

  it('no caller → no block, no rule (every storefront turn)', async () => {
    const { svc, ai } = build();
    await svc.answer(1, 'what is your return policy', 'EN');
    const system = ai.complete.mock.calls[0][0].system as string;
    expect(system).not.toContain('CALLER');
  });

  it('a greeting can use the caller too', async () => {
    const { svc, ai } = build();
    await svc.answerWithoutKnowledge(1, 'smalltalk', 'xin chào', 'VI', null, undefined, 'CALLER_START\nName: G2J SUPPORT\nVerified: no\nCALLER_END');
    const system = ai.complete.mock.calls[0][0].system as string;
    expect(system).toContain('Name: G2J SUPPORT');
    expect(system).toMatch(/CALLER describes who is asking/);
  });
});

/**
 * Citations used to list every retrieved chunk, so a reply recommending one
 * cleanser showed a concealer and a night cream beside it as "referenced"
 * products (FIX-260806 §7-1). Text-matching the reply against titles cannot fix
 * that — replies are localized, the catalogue is English — so the model reports
 * which numbered items it used and the marker is stripped before anyone sees it.
 */
describe('splitCitedMarker', () => {
  it('takes the numbers and removes the line from the visible answer', () => {
    const res = splitCitedMarker('Try the foam cleanser.\n\nCITED: 1, 3');
    expect(res.cited).toEqual([1, 3]);
    expect(res.text).toBe('Try the foam cleanser.');
  });

  it('reports no marker as null so the caller keeps every citation', () => {
    const res = splitCitedMarker('Here is an answer with no bookkeeping line.');
    expect(res.cited).toBeNull();
    expect(res.text).toBe('Here is an answer with no bookkeeping line.');
  });

  it('treats an empty marker as "used nothing"', () => {
    const res = splitCitedMarker('Sorry, I am not sure.\nCITED:');
    expect(res.cited).toEqual([]);
    expect(res.text).toBe('Sorry, I am not sure.');
  });

  it('tolerates decoration and trailing punctuation around the marker', () => {
    for (const marker of ['**CITED: 2**', '- cited: 2 .', '> CITED 2']) {
      const res = splitCitedMarker(`답변입니다.\n${marker}`);
      expect(res.cited).toEqual([2]);
      expect(res.text).toBe('답변입니다.');
    }
  });

  it('ignores junk inside the marker instead of citing item 0', () => {
    const res = splitCitedMarker('Answer.\nCITED: 0, 2,');
    expect(res.cited).toEqual([2]);
  });
});
