import { Logger } from '@nestjs/common';
import { ModerationService, ModerateInput } from './moderation.service';
import { MODERATION_DECISION } from '@sharptalk/types';

/**
 * The moderation audit row must not vanish silently (PLN-261012 SG-50 d, REQ D-13).
 *
 * `moderation_logs` is the only record of what the outbound gate decided. Its write used
 * to be `.catch(() => undefined)`: a database hiccup left a delivered or blocked message
 * with no row and nothing anywhere saying so. Now one retry covers a transient failure and
 * a persistent one is logged at ERROR — with ids, never with the customer's text.
 *
 * The DECISION is unaffected either way: a failing log must neither block a clean message
 * nor release a blocked one (FR-069 stays fail-safe).
 */
const input: ModerateInput = {
  tenantId: 3,
  scope: 'ai',
  authorType: 'ai',
  authorId: 42,
  conversationId: 7,
  text: 'my phone is 0901234567 and this contains a badword',
};

const rule = { id: 1, tenantId: 3, scope: 'both', type: 'word', patternOrPrompt: 'badword', action: 'block', isActive: 1 };

function build(opts: { rules?: unknown[]; save?: jest.Mock } = {}) {
  const logRepo = { create: jest.fn((x) => ({ ...x })), save: opts.save ?? jest.fn(async (x) => x) };
  const service = new ModerationService(
    { find: jest.fn(async () => opts.rules ?? []) } as never,
    logRepo as never,
    { complete: jest.fn() } as never,
    { available: () => false, get: jest.fn(async () => null), set: jest.fn(), del: jest.fn() } as never,
  );
  return { service, logRepo };
}

describe('ModerationService — moderation_logs write failures', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  it('a healthy write is made once and logs no error', async () => {
    const h = build();

    await h.service.moderate(input);

    expect(h.logRepo.save).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('a transient failure is retried once and the row lands — no error is logged', async () => {
    const save = jest.fn().mockRejectedValueOnce(new Error('deadlock found')).mockResolvedValueOnce({});
    const h = build({ save });

    const result = await h.service.moderate(input);

    expect(save).toHaveBeenCalledTimes(2);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(result.decision).toBe(MODERATION_DECISION.DELIVERED);
  });

  it('the retry writes a fresh row object, not the one the failed attempt may have half-filled', async () => {
    const save = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({});
    const h = build({ save });

    await h.service.moderate(input);

    expect(h.logRepo.create).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][0]).not.toBe(save.mock.calls[1][0]);
  });

  it('a failure that persists is logged at ERROR with the ids and both reasons', async () => {
    const save = jest.fn().mockRejectedValueOnce(new Error('connection lost')).mockRejectedValueOnce(new Error('table is full'));
    const h = build({ save });

    await h.service.moderate(input);

    expect(save).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0][0]);
    expect(line).toContain('moderation_logs write failed after retry');
    expect(line).toContain('tenant 3');
    expect(line).toContain('conversation 7');
    expect(line).toContain('table is full');
    expect(line).toContain('connection lost');
  });

  it('the error line never carries the customer\'s text (it can hold a phone number)', async () => {
    const save = jest.fn().mockRejectedValue(new Error('boom'));
    const h = build({ save });

    await h.service.moderate(input);

    expect(String(errorSpy.mock.calls[0][0])).not.toContain('0901234567');
    expect(String(errorSpy.mock.calls[0][0])).not.toContain('badword');
  });

  it('a BLOCKED decision survives a log that cannot be written (fail-safe is not weakened)', async () => {
    const save = jest.fn().mockRejectedValue(new Error('db down'));
    const h = build({ rules: [rule], save });

    const result = await h.service.moderate(input);

    expect(result).toMatchObject({ decision: MODERATION_DECISION.BLOCKED, action: 'block', text: '' });
  });

  it('a DELIVERED decision survives it too — the message is not held hostage to its own audit row', async () => {
    const save = jest.fn().mockRejectedValue(new Error('db down'));
    const h = build({ save });

    const result = await h.service.moderate(input);

    expect(result).toMatchObject({ decision: MODERATION_DECISION.DELIVERED, text: input.text });
  });

  it('the stored excerpt is still PII-scrubbed on the retried row', async () => {
    const save = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({});
    const h = build({ save });

    await h.service.moderate(input);

    expect(String(save.mock.calls[1][0].excerpt)).not.toContain('0901234567');
  });
});
