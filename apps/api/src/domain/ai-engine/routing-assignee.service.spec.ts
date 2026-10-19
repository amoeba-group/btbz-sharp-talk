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
