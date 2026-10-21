import { hasAssigneeGroup, resolveAssigneeGroup, resolveRegionAssignees } from './routing-assignee';

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

/** Region match (PLN-261022 stage 1): scope = unit ∪ labels, province before region. */
describe('resolveRegionAssignees', () => {
  const users = [
    // Hanoi team member, CS
    { id: '10', status: 'active', unitId: 1, labelCodes: ['cs'], regions: ['north', 'north_center'], provinces: [] },
    // Hanoi team member, Sales
    { id: '11', status: 'active', unitId: 1, labelCodes: ['sales'], regions: ['north', 'north_center'], provinces: [] },
    // HCM team, CS
    { id: '20', status: 'active', unitId: 2, labelCodes: ['cs'], regions: ['south', 'south_center'], provinces: [] },
    // Da Nang desk: province-scoped, CS
    { id: '30', status: 'active', unitId: 3, labelCodes: ['cs'], regions: [], provinces: ['Đà Nẵng', 'Quảng Nam'] },
    // suspended Hanoi member
    { id: '12', status: 'suspended', unitId: 1, labelCodes: ['cs'], regions: ['north'], provinces: [] },
  ];

  it('region match picks the users covering that region', () => {
    expect(resolveRegionAssignees(users, { byRegion: true }, { region: 'north' })).toEqual({ ids: ['10', '11'], match: 'region' });
    expect(resolveRegionAssignees(users, { byRegion: true }, { region: 'North Center' })).toEqual({ ids: ['10', '11'], match: 'region' });
  });

  it('a province scope beats the wider region scope', () => {
    expect(resolveRegionAssignees(users, { byRegion: true }, { region: 'south_center', province: 'Đà Nẵng' })).toEqual({
      ids: ['30'],
      match: 'province',
    });
    // decomposed input still matches
    expect(resolveRegionAssignees(users, { byRegion: true }, { province: 'Quảng Nam'.normalize('NFD') }).match).toBe('province');
  });

  it('falls back to the region when no one covers the province', () => {
    expect(resolveRegionAssignees(users, { byRegion: true }, { region: 'south', province: 'Cần Thơ' })).toEqual({
      ids: ['20'],
      match: 'region',
    });
  });

  it('unit / label lists narrow the pool (label = line of work)', () => {
    expect(resolveRegionAssignees(users, { byRegion: true, labelCodes: ['sales'] }, { region: 'north' }).ids).toEqual(['11']);
    expect(resolveRegionAssignees(users, { byRegion: true, unitIds: [2] }, { region: 'north' })).toEqual({ ids: [], match: 'none' });
  });

  it('nobody covering the place, or no place at all, resolves to nobody', () => {
    expect(resolveRegionAssignees(users, { byRegion: true }, { region: 'central' })).toEqual({ ids: [], match: 'none' });
    expect(resolveRegionAssignees(users, { byRegion: true }, {})).toEqual({ ids: [], match: 'none' });
    expect(resolveAssigneeGroup(users, { byRegion: true })).toEqual([]);
  });

  it('byRegion alone counts as a group; resolveAssigneeGroup delegates', () => {
    expect(hasAssigneeGroup({ byRegion: true })).toBe(true);
    expect(resolveAssigneeGroup(users, { byRegion: true }, { region: 'south' })).toEqual(['20']);
  });
});
