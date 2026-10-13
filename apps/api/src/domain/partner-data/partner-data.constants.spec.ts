import { REFUSAL_REASON, isRefusalReason } from '@sharptalk/types';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { PARTNER_REFUSAL_REASON } from './partner-data.constants';
import { partnerNoticePolicy } from './partner-messages';

/**
 * The partner step's refusal words are members of the closed REFUSAL_REASON vocabulary
 * (PLN-261012 SG-50 / SG-52 follow-up). They were free-form `partner_*` strings first;
 * the pilot analytics group by the closed set, so a reason the step can store that is
 * not in it would split a chart silently.
 */
describe('PARTNER_REFUSAL_REASON', () => {
  it('is exactly the five reasons the step stores, spelled as stored traces already carry them', () => {
    expect(Object.values(PARTNER_REFUSAL_REASON).sort()).toEqual(
      [
        'partner_claims_stale',
        'partner_param_rejected',
        'partner_role_denied',
        'partner_unavailable',
        'partner_unverified',
      ].sort(),
    );
  });

  it('every member is in the closed REFUSAL_REASON set', () => {
    for (const reason of Object.values(PARTNER_REFUSAL_REASON)) {
      expect(isRefusalReason(reason)).toBe(true);
      expect(Object.values(REFUSAL_REASON)).toContain(reason);
    }
  });

  it('every error code the step can meet maps to a stored reason inside the closed set', () => {
    const codes = [
      ...Object.values(ERROR_CODE)
        .map((e) => e.code)
        .filter((c) => /^E51(0\d)$/.test(c)),
      'E9999', // an unknown code falls through to "unavailable"
    ];
    expect(codes.length).toBeGreaterThan(5);
    for (const code of codes) {
      expect(isRefusalReason(partnerNoticePolicy(code).reason)).toBe(true);
    }
  });
});
