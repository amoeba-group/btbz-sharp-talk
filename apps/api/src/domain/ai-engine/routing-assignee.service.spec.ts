import { RoutingAssigneeService } from './routing-assignee.service';

function repo(find: jest.Mock): never {
  return { find } as never;
}

/** Ids as TypeORM really hands them back: bigint PKs are STRINGS, link columns numbers. */
describe('RoutingAssigneeService.resolve', () => {
  const users = [
    { id: '10', tenantId: 4, status: 'active', unitId: 7 },
    { id: '11', tenantId: 4, status: 'active', unitId: 8 },
    { id: '12', tenantId: 4, status: 'active', unitId: 7 },
  ];
  const userRepo = repo(jest.fn(async () => users));
  const labelRepo = repo(jest.fn(async () => [{ id: '1', tenantId: 4, code: 'consult' }, { id: '2', tenantId: 4, code: 'accounting' }]));
  const userLabelRepo = repo(
    jest.fn(async () => [
      { userId: 10, jobLabelId: 1 },
      { userId: 11, jobLabelId: 1 },
      { userId: 12, jobLabelId: 2 },
    ]),
  );

  it('unit × label intersection, numeric ids out', async () => {
    const svc = new RoutingAssigneeService(userRepo, labelRepo, userLabelRepo);
    await expect(svc.resolve(4, { unitIds: [7], labelCodes: ['consult'] })).resolves.toEqual([10]);
    await expect(svc.resolve(4, { unitIds: [7] })).resolves.toEqual([10, 12]);
    await expect(svc.resolve(4, { labelCodes: ['consult'] })).resolves.toEqual([10, 11]);
  });

  it('only queries active users of the tenant and skips the label join when no label is asked', async () => {
    const userFind = jest.fn(async () => users);
    const linkFind = jest.fn(async () => []);
    const svc = new RoutingAssigneeService(repo(userFind), labelRepo, repo(linkFind));
    await svc.resolve(4, { unitIds: [8] });
    expect(userFind).toHaveBeenCalledWith({ where: { tenantId: 4, status: 'active' } });
    expect(linkFind).not.toHaveBeenCalled();
  });
});

/** Region match (PLN-261022 stage 1): a user covers unit scope ∪ held labels' scopes. */
describe('RoutingAssigneeService.resolveDetailed — byRegion', () => {
  const users = [
    { id: '10', tenantId: 4, status: 'active', unitId: 1 }, // Hanoi team, cs
    { id: '11', tenantId: 4, status: 'active', unitId: 1 }, // Hanoi team, sales
    { id: '20', tenantId: 4, status: 'active', unitId: 2 }, // HCM team, cs + backup label (north_center)
    { id: '30', tenantId: 4, status: 'active', unitId: null }, // no team, Da Nang desk label
  ];
  const units = [
    { id: '1', tenantId: 4, code: 'hn', regions: ['north', 'north_center'], provinces: null },
    { id: '2', tenantId: 4, code: 'hcm', regions: ['south', 'south_center'], provinces: null },
  ];
  const labels = [
    { id: '5', tenantId: 4, code: 'cs', regions: null, provinces: null },
    { id: '6', tenantId: 4, code: 'sales', regions: null, provinces: null },
    { id: '7', tenantId: 4, code: 'backup_nc', regions: ['north_center'], provinces: null },
    { id: '8', tenantId: 4, code: 'dn_desk', regions: null, provinces: ['Đà Nẵng'] },
  ];
  const links = [
    { userId: 10, jobLabelId: 5 },
    { userId: 11, jobLabelId: 6 },
    { userId: 20, jobLabelId: 5 },
    { userId: 20, jobLabelId: 7 },
    { userId: 30, jobLabelId: 5 },
    { userId: 30, jobLabelId: 8 },
  ];
  const svc = () =>
    new RoutingAssigneeService(
      repo(jest.fn(async () => users)),
      repo(jest.fn(async () => labels)),
      repo(jest.fn(async () => links)),
      repo(jest.fn(async () => units)),
    );

  it('region: unit scope, narrowed by the line-of-work label', async () => {
    await expect(svc().resolveDetailed(4, { byRegion: true, labelCodes: ['cs'] }, { region: 'north' })).resolves.toEqual({
      ids: [10],
      match: 'region',
    });
    await expect(svc().resolveDetailed(4, { byRegion: true, labelCodes: ['sales'] }, { region: 'North Center' })).resolves.toEqual({
      ids: [11],
      match: 'region',
    });
  });

  it('a label scope extends the unit scope (HCM member backing up north_center)', async () => {
    await expect(svc().resolveDetailed(4, { byRegion: true, labelCodes: ['cs'] }, { region: 'north_center' })).resolves.toEqual({
      ids: [10, 20],
      match: 'region',
    });
  });

  it('province scope wins over region scope; NFD input matches', async () => {
    await expect(
      svc().resolveDetailed(4, { byRegion: true, labelCodes: ['cs'] }, { region: 'south_center', province: 'Đà Nẵng'.normalize('NFD') }),
    ).resolves.toEqual({ ids: [30], match: 'province' });
  });

  it('nobody covering → empty, match none', async () => {
    await expect(svc().resolveDetailed(4, { byRegion: true }, { region: 'central' })).resolves.toEqual({ ids: [], match: 'none' });
  });
});
