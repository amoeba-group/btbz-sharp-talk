import { gateFailed, gateMail, parseGateTargets, type GateResult } from './golden-gate.util';

/** PLN-261008 — post-deploy regression gate. */
describe('parseGateTargets', () => {
  it('reads tenant:agent pairs, agent optional', () => {
    expect(parseGateTargets('4:10, 1:3 ,7')).toEqual([
      { tenantId: 4, aiAgentId: 10 },
      { tenantId: 1, aiAgentId: 3 },
      { tenantId: 7, aiAgentId: null },
    ]);
  });
  it('is off when empty and skips malformed entries', () => {
    expect(parseGateTargets(undefined)).toEqual([]);
    expect(parseGateTargets('  ')).toEqual([]);
    expect(parseGateTargets('x:1,0:2,4:y,5:6')).toEqual([{ tenantId: 5, aiAgentId: 6 }]);
  });
});

describe('gateFailed / gateMail', () => {
  const base: GateResult = { tenantId: 4, aiAgentId: 10, runId: 11, pass: 41, fail: 0, total: 44, failed: [], regressed: [] };

  it('fails on any failing question or regression (D1), passes otherwise', () => {
    expect(gateFailed(base)).toBe(false);
    expect(gateFailed({ ...base, fail: 1, pass: 40 })).toBe(true);
    expect(gateFailed({ ...base, regressed: ['E1'] })).toBe(true);
  });

  it('names the tenant, the run and what is missing', () => {
    const m = gateMail(
      [{ ...base, pass: 40, fail: 1, failed: [{ question: 'Tôi có thể thanh toán cho Go2Joy như nào?', checks: ['missing: Techcombank'] }], regressed: ['D3'] }],
      'staging',
      'abc1234',
    );
    expect(m.subject).toBe('[SharpTalk staging] 배포 후 FAQ 회귀 실패 — tenant 4: ✗1 (abc1234)');
    expect(m.text).toContain('run #11: 통과 40 / 실패 1 / 전체 44');
    expect(m.text).toContain('회귀(통과→실패): D3');
    expect(m.text).toContain('missing: Techcombank');
  });
});
