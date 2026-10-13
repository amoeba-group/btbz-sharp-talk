import { conversationAudience, historyExceedsViewer } from './conversation-audience.util';

/**
 * Was a thread held at a higher tier than the viewer's tier now? (PLN-261012 SG-11.)
 * The guard that keeps a manager's earlier turns out of a lower-tier viewer's prompt on
 * the paths that KEEP the old conversation (claims lapsing mid-thread).
 */
describe('conversationAudience', () => {
  it.each([
    ['manager', 'manager'],
    ['internal', 'manager'],
    ['receptionist', 'partner'],
  ])('a thread stamped %s was held at %s', (role, tier) => {
    expect(conversationAudience(role)).toBe(tier);
  });

  it.each([null, undefined, ''])('no stamp (%j) reads as public — nothing is known to have been shown higher', (role) => {
    expect(conversationAudience(role)).toBe('public');
  });

  it('an unrecognised stamp reads as partner, never manager', () => {
    expect(conversationAudience('admin')).toBe('partner');
    expect(conversationAudience('MANAGER')).toBe('partner');
  });
});

describe('historyExceedsViewer', () => {
  it.each([
    ['manager', 'partner', true],
    ['manager', 'public', true],
    ['receptionist', 'public', true],
    ['manager', 'manager', false],
    ['receptionist', 'partner', false],
    ['receptionist', 'manager', false],
    [null, 'public', false],
    [null, 'partner', false],
  ] as const)('thread %s, viewer %s → withhold: %s', (role, viewer, expected) => {
    expect(historyExceedsViewer(role, viewer)).toBe(expected);
  });
});
