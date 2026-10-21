import { CompanyService, companyKeyFor } from './company.service';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

function repo(overrides: Record<string, unknown> = {}): never {
  return {
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    create: jest.fn((x: object) => ({ ...x })),
    save: jest.fn(async (x: object) => ({ id: '9', ...x })),
    ...overrides,
  } as never;
}

/** B2B companies (PLN-261022 stage 2). Ids as TypeORM hands them back: bigint PKs are strings. */
describe('CompanyService', () => {
  const attrs = { hotel_id: '1721', hotel_name: 'A In Hotel Del Luna', province: 'Hồ Chí Minh', region: 'south', role: 'Lễ tân' };

  it('keys a company by the signed hotel id; no hotel id → no company', () => {
    expect(companyKeyFor(attrs)).toBe('hotel:1721');
    expect(companyKeyFor({ hotel_id: '  ' })).toBeNull();
    expect(companyKeyFor(null)).toBeNull();
  });

  it('creates the company from the signed attributes', async () => {
    const companyRepo = repo();
    const svc = new CompanyService(companyRepo, repo(), repo(), repo());
    const c = await svc.upsertFromIdentity(4, attrs);
    expect(c).toMatchObject({ tenantId: 4, externalKey: 'hotel:1721', name: 'A In Hotel Del Luna', province: 'Hồ Chí Minh', region: 'south' });
    expect((c as { lastSeenAt: Date }).lastSeenAt).toBeInstanceOf(Date);
  });

  it('refreshes an existing company and keeps fields a later identify leaves out', async () => {
    const existing = { id: '3', tenantId: 4, externalKey: 'hotel:1721', name: 'Old', province: 'Hà Nội', region: 'north', lastSeenAt: null };
    const svc = new CompanyService(repo({ findOne: jest.fn(async () => existing) }), repo(), repo(), repo());
    const c = await svc.upsertFromIdentity(4, { hotel_id: '1721', hotel_name: 'New name' });
    expect(c).toMatchObject({ id: '3', name: 'New name', province: 'Hà Nội', region: 'north' });
  });

  it('returns null without a hotel id (chain operator on "all hotels")', async () => {
    const companyRepo = repo();
    const svc = new CompanyService(companyRepo, repo(), repo(), repo());
    await expect(svc.upsertFromIdentity(4, { role: 'Quản lý' })).resolves.toBeNull();
    expect((companyRepo as unknown as { save: jest.Mock }).save).not.toHaveBeenCalled();
  });

  it('a concurrent insert that loses the unique key reads back the winner', async () => {
    const winner = { id: '7', tenantId: 4, externalKey: 'hotel:1721' };
    const findOne = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    const save = jest.fn(async () => {
      throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    });
    const svc = new CompanyService(repo({ findOne, save }), repo(), repo(), repo());
    await expect(svc.upsertFromIdentity(4, attrs)).resolves.toBe(winner);
  });

  it('linkContact is idempotent and refreshes role and last seen', async () => {
    const link = { id: '1', companyId: 3, customerId: 5, role: 'Lễ tân', lastSeenAt: null };
    const save = jest.fn(async (x: object) => x);
    const svc = new CompanyService(repo(), repo({ findOne: jest.fn(async () => link), save }), repo(), repo());
    await svc.linkContact(4, 3, 5, 'Quản lý');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: '1', role: 'Quản lý' }));
  });

  it("another tenant's company id reads as not found (E5098)", async () => {
    const svc = new CompanyService(repo({ findOne: jest.fn(async () => null) }), repo(), repo(), repo());
    await expect(svc.detail(4, 99)).rejects.toMatchObject({ errorCode: ERROR_CODE.COMPANY_NOT_FOUND.code });
  });
});
