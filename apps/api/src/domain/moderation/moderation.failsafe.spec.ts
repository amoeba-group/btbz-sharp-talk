import { MODERATION_DECISION } from '@sharptalk/types';
import { ModerationService } from './moderation.service';
import { m, metrics } from '../../infrastructure/observability/app-metrics';

/**
 * PLN-261012 SG-84 — a fail-safe block must say WHY, so the chat can tell an outage from a rule.
 * The block itself is FR-069 and unchanged: on any failure the message is never delivered.
 */
describe('ModerationService — fail-safe cause', () => {
  const build = (opts: { rule?: Record<string, unknown>; degraded?: boolean; ruleLookupFails?: boolean }) => {
    const ruleRepo = {
      find: jest.fn(async () => {
        if (opts.ruleLookupFails) throw new Error('db down');
        return opts.rule ? [{ id: 9, tenantId: 1, scope: 'both', isActive: 1, ...opts.rule }] : [];
      }),
    };
    const logRepo = { create: jest.fn((x) => x), save: jest.fn(async (x) => x) };
    const ai = {
      complete: jest.fn(async () => ({
        text: '{"flagged":false}',
        degraded: opts.degraded ?? false,
        tokensIn: 0,
        tokensOut: 0,
        provider: opts.degraded ? 'stub' : 'anthropic',
      })),
    };
    const redis = { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() };
    return new ModerationService(ruleRepo as never, logRepo as never, ai as never, redis as never);
  };
  const input = { tenantId: 1, scope: 'ai' as const, authorType: 'ai' as const, text: 'hello there' };

  beforeEach(() => metrics.reset());

  it('engine degraded (classifier fell back to the stub) → blocked, failsafe engine_degraded', async () => {
    const res = await build({ rule: { type: 'context', patternOrPrompt: 'unsafe', action: 'block' }, degraded: true }).moderate(input);

    expect(res.decision).toBe(MODERATION_DECISION.BLOCKED);
    expect(res.failsafe).toBe('engine_degraded');
    expect(res.text).toBe('');
    expect(m.moderationFailsafe.get({ cause: 'engine_degraded' })).toBe(1);
  });

  it('any other failure on the moderation path → blocked, failsafe error', async () => {
    const res = await build({ ruleLookupFails: true }).moderate(input);

    expect(res.decision).toBe(MODERATION_DECISION.BLOCKED);
    expect(res.failsafe).toBe('error');
  });

  it('a rule that fires is a normal block — NOT a failsafe', async () => {
    const res = await build({ rule: { type: 'word', patternOrPrompt: 'hello', action: 'block' } }).moderate(input);

    expect(res.decision).toBe(MODERATION_DECISION.BLOCKED);
    expect(res).not.toHaveProperty('failsafe');
    expect(m.moderationFailsafe.sum()).toBe(0);
  });

  it('a healthy pass delivers and is counted', async () => {
    const res = await build({}).moderate(input);

    expect(res.decision).toBe(MODERATION_DECISION.DELIVERED);
    expect(res).not.toHaveProperty('failsafe');
    expect(m.moderation.get({ scope: 'ai', decision: 'delivered' })).toBe(1);
  });
});
