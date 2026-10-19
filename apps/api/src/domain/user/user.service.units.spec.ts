import { UserService } from './user.service';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/**
 * Units (teams) — PLN-261019-Users-Unit-Labels-Routing-Conditions P1.
 * Ids are STRINGS where TypeORM would hand back a BIGINT PK (bigint-PK-as-string
 * trap): a numeric fixture would pass a join that misses in production.
 */
function repo(overrides: Record<string, unknown> = {}): never {
  return {
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    findAndCount: jest.fn(),
    save: jest.fn(async (x: unknown) => x),
    delete: jest.fn(),
    count: jest.fn(),
    create: jest.fn((x: unknown) => x),
    ...overrides,
  } as never;
}

const audit = () => ({ write: jest.fn() }) as never;

function service(parts: { userRepo?: never; unitRepo?: never; auditSvc?: never } = {}) {
  return new UserService(
    parts.userRepo ?? repo(),
    repo(),
    repo(),
    repo(),
    parts.auditSvc ?? audit(),
    { clearAccountLock: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    parts.unitRepo ?? repo(),
  );
}

const user = () => ({
  id: '7',
  tenantId: 1,
  email: 'cs1@example.com',
  name: null,
  rank: 'staff',
  status: 'active',
  mustChangePassword: 0,
  unitId: null as number | null,
  invitedAt: null,
  createdAt: new Date('2026-10-19T00:00:00.000Z'),
});

describe('UserService units', () => {
  it('listUsers maps unitName through a String()-keyed join and skips the query when nobody has a unit', async () => {
    const u1 = { ...user(), unitId: 3 };
    const u2 = { ...user(), id: '8', unitId: null };
    const unitRepo = repo({ find: jest.fn(async () => [{ id: '3', tenantId: 1, code: 'north', name: 'North', sortOrder: 40 }]) });
    const svc = service({
      userRepo: repo({ findAndCount: jest.fn(async () => [[u1, u2], 2]) }),
      unitRepo,
    });
    const res = await svc.listUsers(1, 1, 20);
    expect(res.items.map((i) => [i.unitId, i.unitName])).toEqual([
      [3, 'North'],
      [null, null],
    ]);

    const noUnits = repo();
    const svc2 = service({ userRepo: repo({ findAndCount: jest.fn(async () => [[u2], 1]) }), unitRepo: noUnits });
    await svc2.listUsers(1, 1, 20);
    expect((noUnits as { find: jest.Mock }).find).not.toHaveBeenCalled();
  });

  it('updateUnit rejects a unit from another tenant with E2005 and leaves the user untouched', async () => {
    const u = user();
    const userRepo = repo({ findOne: jest.fn(async () => u) });
    // The where clause includes tenantId, so a foreign unit simply is not found.
    const unitRepo = repo({ findOne: jest.fn(async () => null) });
    const svc = service({ userRepo, unitRepo });
    await expect(svc.updateUnit(1, 7, 99, 1)).rejects.toMatchObject({ errorCode: ERROR_CODE.UNIT_NOT_FOUND.code });
    expect((userRepo as { save: jest.Mock }).save).not.toHaveBeenCalled();
    expect((unitRepo as { findOne: jest.Mock }).findOne).toHaveBeenCalledWith({ where: { id: 99, tenantId: 1 } });
  });

  it('updateUnit with null clears the assignment and audits it', async () => {
    const u = { ...user(), unitId: 3 };
    const userRepo = repo({ findOne: jest.fn(async () => u) });
    const auditSvc = audit();
    const svc = service({ userRepo, auditSvc });
    const res = await svc.updateUnit(1, 7, null, 2);
    expect(res.unitId).toBeNull();
    expect(res.unitName).toBeNull();
    expect((auditSvc as { write: jest.Mock }).write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.unit_changed', actorId: 2, target: 'user:7 unit:-' }),
    );
  });

  it('createUnit refuses a duplicate code (409) and otherwise appends after the last sort order', async () => {
    const dup = repo({ findOne: jest.fn(async () => ({ id: '1', code: 'cs' })) });
    await expect(service({ unitRepo: dup }).createUnit(1, 1, 'cs', 'CS')).rejects.toMatchObject({
      errorCode: ERROR_CODE.DUPLICATE_RESOURCE.code,
    });

    const findOne = jest
      .fn()
      .mockResolvedValueOnce(null) // duplicate check
      .mockResolvedValueOnce({ id: '3', sortOrder: 30 }); // last row
    const unitRepo = repo({ findOne, save: jest.fn(async (x: object) => ({ id: '4', ...x })) });
    const res = await service({ unitRepo }).createUnit(1, 1, 'north', 'North');
    expect(res).toMatchObject({ code: 'north', name: 'North', sortOrder: 40 });
  });

  it('renameUnit changes only the name and keeps the code', async () => {
    const unit = { id: '3', tenantId: 1, code: 'north', name: 'North', sortOrder: 40 };
    const unitRepo = repo({ findOne: jest.fn(async () => unit) });
    const res = await service({ unitRepo }).renameUnit(1, 1, 3, 'Miền Bắc');
    expect(res).toMatchObject({ code: 'north', name: 'Miền Bắc' });
  });
});
