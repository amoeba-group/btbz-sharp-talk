import { MODERATION_DECISION } from '@sharptalk/types';
import { ModerationService } from './moderation.service';

/**
 * Fail-safe when the moderation engine is down (PLN-261007 D4, FR-069).
 * The gateway answers with the stub, whose verdict is always "not flagged";
 * on 2026-10-06 that stood in for go2joy's classifier through an outage.
 */
describe('ModerationService — degraded engine', () => {
  const build = (rule: Record<string, unknown>) => {
    const ruleRepo = {
      find: jest.fn(async () => [
        { id: 9, tenantId: 1, scope: 'both', lang: null, severity: 'high', isActive: 1, createdAt: new Date(), ...rule },
      ]),
    };
    const logRepo = { create: jest.fn((x) => x), save: jest.fn(async (x) => x) };
    const ai = {
      complete: jest.fn(async () => ({ text: '{"flagged":false}', degraded: true, tokensIn: 0, tokensOut: 0, provider: 'stub', model: 'stub-1' })),
    };
    const redis = { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() };
    return new ModerationService(ruleRepo as never, logRepo as never, ai as never, redis as never);
  };
  const input = { tenantId: 1, scope: 'ai' as const, authorType: 'ai' as const, authorId: 1, conversationId: 1, text: 'hello there' };

  it('blocks when the context classifier came back from the stub', async () => {
    const res = await build({ type: 'context', patternOrPrompt: 'unsafe', action: 'block' }).moderate(input);
    expect(res.decision).toBe(MODERATION_DECISION.BLOCKED);
  });

  it('blocks when a rephrase came back from the stub', async () => {
    const res = await build({ type: 'word', patternOrPrompt: 'hello', action: 'rephrase' }).moderate(input);
    expect(res.decision).toBe(MODERATION_DECISION.BLOCKED);
  });
});
