import { claimedUserId, threadEligible, unsignedIdentifyAllowed } from './unsigned-identify';

/** The unsigned-host switch (PLN-261022) and the one thread rule built on it. */
describe('unsigned identify helpers', () => {
  const ENV = 'EMBED_UNSIGNED_IDENTIFY_TENANT_IDS';
  afterEach(() => {
    delete process.env[ENV];
  });

  it('reads a comma list of tenant ids; unset or blank allows nobody', () => {
    expect(unsignedIdentifyAllowed(4)).toBe(false);
    process.env[ENV] = '';
    expect(unsignedIdentifyAllowed(4)).toBe(false);
    process.env[ENV] = ' 7 , 4 ';
    expect(unsignedIdentifyAllowed(4)).toBe(true);
    expect(unsignedIdentifyAllowed('4')).toBe(true);
    expect(unsignedIdentifyAllowed(5)).toBe(false);
    expect(unsignedIdentifyAllowed(null)).toBe(false);
  });

  it('claimedUserId is only for claimed sessions with a user id', () => {
    expect(claimedUserId({ identityLevel: 'claimed', identityAttributes: { user_id: ' ha:8818 ' } })).toBe('ha:8818');
    expect(claimedUserId({ identityLevel: 'claimed', identityAttributes: { hotel_id: '1' } })).toBeNull();
    expect(claimedUserId({ identityLevel: 'verified', identityAttributes: { user_id: 'ha:1' } })).toBeNull();
  });

  it('threadEligible: a verified customer always; a claimed user only on an allowed tenant (P7)', () => {
    expect(threadEligible({ tenantId: 4, identityLevel: 'verified', customerId: 9 })).toBe(true);
    expect(threadEligible({ tenantId: 4, identityLevel: 'verified', customerId: null })).toBe(false);
    expect(threadEligible({ tenantId: 4, identityLevel: 'guest', customerId: 9 })).toBe(false);
    const claimed = { tenantId: 4, identityLevel: 'claimed', customerId: null, identityAttributes: { user_id: 'ha:8818' } };
    expect(threadEligible(claimed)).toBe(false);
    process.env[ENV] = '4';
    expect(threadEligible(claimed)).toBe(true);
    // The list was emptied after the session was claimed: the thread closes with it.
    process.env[ENV] = '';
    expect(threadEligible(claimed)).toBe(false);
  });
});
