import { MODERATION_DECISION } from '@sharptalk/types';
import { ModerationService } from './moderation.service';

/**
 * FIX-261023-AI-Empty-Answer — empty text never reaches the classifier: the
 * provider rejects an empty message with a 400, and the fail-safe used to
 * turn that into a "moderation_blocked" handoff.
 */
describe('ModerationService — empty text', () => {
  const build = () => {
    const ruleRepo = {
      find: jest.fn(async () => [
        { id: 21, tenantId: 4, scope: 'ai', type: 'context', patternOrPrompt: 'unsafe', action: 'warn', isActive: 1 },
      ]),
    };
    const logRepo = { create: jest.fn((x) => x), save: jest.fn(async (x) => x) };
    const ai = { complete: jest.fn(async () => { throw new Error('Anthropic API error 400'); }) };
    const redis = { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() };
    return { svc: new ModerationService(ruleRepo as never, logRepo as never, ai as never, redis as never), ai, logRepo };
  };
  const input = { tenantId: 4, scope: 'ai' as const, authorType: 'ai' as const, conversationId: 888 };

  it.each(['', '   \n'])('passes %j without calling the classifier, and still logs it', async (text) => {
    const { svc, ai, logRepo } = build();
    const res = await svc.moderate({ ...input, text });
    expect(res.decision).toBe(MODERATION_DECISION.DELIVERED);
    expect(ai.complete).not.toHaveBeenCalled();
    expect(logRepo.save).toHaveBeenCalledTimes(1);
  });

  it('still blocks real text when the classifier fails (FR-069)', async () => {
    const { svc } = build();
    const res = await svc.moderate({ ...input, text: 'Open Trang chủ.' });
    expect(res.decision).toBe(MODERATION_DECISION.BLOCKED);
  });
});
