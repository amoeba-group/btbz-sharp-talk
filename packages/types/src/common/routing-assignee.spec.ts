import { hasAssigneeGroup, resolveAssigneeGroup } from './routing-assignee';

/** Shared resolver (PLN-261019-Routing-Assignee-Groups): console preview == server. */
describe('resolveAssigneeGroup', () => {
  const users = [
    { id: '1', status: 'active', unitId: 4, labelCodes: ['consult'] },
    { id: 2, status: 'active', unitId: '4', labelCodes: ['accounting'] },
    { id: '3', status: 'suspended', unitId: 4, labelCodes: ['consult'] },
    { id: '4', status: 'active', unitId: null, labelCodes: ['consult', 'operations'] },
    { id: '5', status: 'invited', unitId: 5, labelCodes: [] },
  ];

  it('unit only: active members of the unit, ids compared as strings', () => {
    expect(resolveAssigneeGroup(users, { unitIds: ['4'] })).toEqual(['1', '2']);
    expect(resolveAssigneeGroup(users, { unitIds: [4] })).toEqual(['1', '2']);
  });

  it('label only: active holders of any chosen label', () => {
    expect(resolveAssigneeGroup(users, { labelCodes: ['consult'] })).toEqual(['1', '4']);
    expect(resolveAssigneeGroup(users, { labelCodes: ['Consult', 'operations'] })).toEqual(['1', '4']);
  });

  it('unit and label intersect', () => {
    expect(resolveAssigneeGroup(users, { unitIds: [4], labelCodes: ['consult'] })).toEqual(['1']);
    expect(resolveAssigneeGroup(users, { unitIds: [5], labelCodes: ['consult'] })).toEqual([]);
  });

  it('an empty selector is not a group', () => {
    expect(hasAssigneeGroup({})).toBe(false);
    expect(hasAssigneeGroup({ unitIds: [], labelCodes: [' '] })).toBe(false);
    expect(hasAssigneeGroup({ unitIds: [4] })).toBe(true);
    expect(resolveAssigneeGroup(users, { unitIds: [] })).toEqual([]);
    expect(resolveAssigneeGroup(users, undefined)).toEqual([]);
  });
});
