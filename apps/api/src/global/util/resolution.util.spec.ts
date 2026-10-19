import { classifyOutcome, RESOLUTION_REASON, UNRESOLVED_REASON } from './resolution.util';

/**
 * The survey's own "was it resolved?" answer outranks "they answered" (PLN-261019 D1).
 * Rating-mode rows carry no answer and keep the rule every dashboard has used.
 */
describe('classifyOutcome — survey answer (PLN-261019)', () => {
  const ended = { status: 'ended', endedAt: new Date() };

  it('rating answered, no survey question → resolved as before', () => {
    expect(classifyOutcome({ ...ended, csatRating: 4 }, 'ai', true)).toEqual({ resolved: true, reason: RESOLUTION_REASON.CSAT_ANSWERED });
    expect(classifyOutcome({ ...ended, csatRating: 4, csatResolved: null }, 'user', false).resolved).toBe(true);
  });

  it('survey says resolved → resolved', () => {
    expect(classifyOutcome({ ...ended, csatRating: 2, csatResolved: 1 }, 'user', true)).toEqual({ resolved: true, reason: RESOLUTION_REASON.CSAT_ANSWERED });
  });

  it('survey says NOT resolved → unresolved, even with a high rating', () => {
    expect(classifyOutcome({ ...ended, csatRating: 5, csatResolved: 0 }, 'ai', true)).toEqual({ resolved: false, reason: UNRESOLVED_REASON.CUSTOMER_UNRESOLVED });
  });

  it('no rating at all → the older rules decide', () => {
    expect(classifyOutcome({ ...ended, csatRating: null, csatResolved: 0 }, 'user', true).reason).toBe(UNRESOLVED_REASON.CUSTOMER_LAST);
  });
});
