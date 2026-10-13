import { ExecutionContext, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ADMIN_LEVEL, USER_RANK } from '@sharptalk/types';
import type { Principal, UserRank } from '@sharptalk/types';
import { AuthorizationGuard } from '../../global/guard/authorization.guard';
import { PilotController } from './pilot.controller';
import {
  AddPilotHotelRequest,
  ImportPilotHotelsRequest,
  UpdatePilotAccessRequest,
  UpdatePilotHotelRequest,
} from './dto/request/pilot.request';
import { PilotMapper } from './pilot.mapper';
import { parseHotelInput, planHotelImport } from './pilot.util';

/**
 * Permissions, validation and the camelCase contract of the pilot console API
 * (PLN-261012 SG-40). The permission checks run the REAL AuthorizationGuard
 * against the REAL decorator metadata of each handler, so a route that lost its
 * @RequireRank fails here rather than silently opening to every console user.
 */

const user = (rank: UserRank): Principal => ({
  actorType: 'user',
  userId: 10,
  tenantId: 1,
  email: 'u@x.com',
  rank,
  labels: [],
});
const admin: Principal = { actorType: 'admin', adminId: 1, email: 'a@x.com', level: ADMIN_LEVEL.SUPER_ADMIN };

function allowed(handler: keyof PilotController, principal: Principal): boolean {
  const guard = new AuthorizationGuard(new Reflector());
  const ctx = {
    getHandler: () => PilotController.prototype[handler],
    getClass: () => PilotController,
    switchToHttp: () => ({ getRequest: () => ({ user: principal }) }),
  } as unknown as ExecutionContext;
  try {
    return guard.canActivate(ctx);
  } catch {
    return false;
  }
}

const READS: Array<keyof PilotController> = ['get', 'listHotels'];
const WRITES: Array<keyof PilotController> = ['update', 'addHotel', 'importHotels', 'setActive', 'removeHotel'];

describe('PilotController — permissions (MASTER writes, MASTER/DIRECTOR read)', () => {
  it.each(READS)('%s: master and director may read', (handler) => {
    expect(allowed(handler, user(USER_RANK.MASTER))).toBe(true);
    expect(allowed(handler, user(USER_RANK.DIRECTOR))).toBe(true);
  });

  it.each(READS)('%s: manager and staff may not read', (handler) => {
    expect(allowed(handler, user(USER_RANK.MANAGER))).toBe(false);
    expect(allowed(handler, user(USER_RANK.STAFF))).toBe(false);
  });

  it.each(WRITES)('%s: only the master may change the pilot', (handler) => {
    expect(allowed(handler, user(USER_RANK.MASTER))).toBe(true);
    expect(allowed(handler, user(USER_RANK.DIRECTOR))).toBe(false);
    expect(allowed(handler, user(USER_RANK.MANAGER))).toBe(false);
    expect(allowed(handler, user(USER_RANK.STAFF))).toBe(false);
  });

  it.each([...READS, ...WRITES])('%s: a platform admin has no tenant, so the tenant console API is closed to them', (handler) => {
    expect(allowed(handler, admin)).toBe(false);
  });

  it('no request without a principal gets in', () => {
    const guard = new AuthorizationGuard(new Reflector());
    const ctx = {
      getHandler: () => PilotController.prototype.update,
      getClass: () => PilotController,
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(ctx)).toThrow();
  });

  it('every handler carries a rank decorator — none is left to the default', () => {
    for (const name of [...READS, ...WRITES]) {
      expect(Reflect.getMetadata('requireRank', PilotController.prototype[name])).toBeDefined();
    }
  });
});

describe('PilotController — handlers', () => {
  const make = () => {
    const admin = {
      getAccess: jest.fn(),
      updateAccess: jest.fn(),
      listHotels: jest.fn(),
      addHotel: jest.fn(),
      importHotels: jest.fn(),
      setHotelActive: jest.fn(),
      removeHotel: jest.fn(),
    };
    return { admin, controller: new PilotController(admin as never) };
  };
  const master = user(USER_RANK.MASTER);

  it('scopes every call to the caller\'s own tenant, never a client-supplied one', async () => {
    const { controller, admin: svc } = make();
    svc.getAccess.mockResolvedValue({ stored: null, counts: { active: 0, total: 0 } });
    svc.updateAccess.mockResolvedValue({ stored: { enabled: false, guestAllowed: true, nonPilot: 'hide', notice: {} }, counts: { active: 0, total: 0 } });
    svc.listHotels.mockResolvedValue({ items: [], total: 0 });
    svc.addHotel.mockResolvedValue({ id: 1, hotelSn: '1', note: null, active: 1, addedBy: 10, createdAt: new Date() });
    svc.setHotelActive.mockResolvedValue({ id: 1, hotelSn: '1', note: null, active: 0, addedBy: 10, createdAt: new Date() });
    svc.removeHotel.mockResolvedValue(undefined);

    await controller.get(master);
    await controller.update(master, { enabled: false, guest_allowed: true, non_pilot: 'hide' });
    await controller.listHotels(master, {});
    await controller.addHotel(master, { hotel_sn: '1' });
    await controller.setActive(master, '1', { active: false });
    await controller.removeHotel(master, '1');

    expect(svc.getAccess).toHaveBeenCalledWith(1);
    expect(svc.updateAccess.mock.calls[0].slice(0, 2)).toEqual([1, 10]);
    expect(svc.listHotels.mock.calls[0][0]).toBe(1);
    expect(svc.addHotel.mock.calls[0].slice(0, 2)).toEqual([1, 10]);
    expect(svc.setHotelActive).toHaveBeenCalledWith(1, 10, '1', false);
    expect(svc.removeHotel).toHaveBeenCalledWith(1, 10, '1');
  });

  it('refuses a non-tenant principal even if a guard let it through', async () => {
    const { controller } = make();
    await expect(controller.get(admin)).rejects.toMatchObject({ errorCode: 'E1004' });
  });

  it('GET answers camelCase with the list size and its ceiling', async () => {
    const { controller, admin: svc } = make();
    svc.getAccess.mockResolvedValue({
      stored: { enabled: true, guestAllowed: false, nonPilot: 'notice', notice: { VI: 'Chưa áp dụng.' } },
      counts: { active: 12, total: 14 },
    });
    expect(await controller.get(master)).toEqual({
      enabled: true,
      guestAllowed: false,
      nonPilot: 'notice',
      notice: { VI: 'Chưa áp dụng.' },
      activeCount: 12,
      totalCount: 14,
      limit: 5000,
    });
  });

  it('a tenant that never configured it reads as off with the documented defaults', async () => {
    const { controller, admin: svc } = make();
    svc.getAccess.mockResolvedValue({ stored: null, counts: { active: 0, total: 0 } });
    expect(await controller.get(master)).toMatchObject({ enabled: false, guestAllowed: true, nonPilot: 'hide', notice: {} });
  });

  it('the list is paginated and maps rows to camelCase, active as a boolean', async () => {
    const { controller, admin: svc } = make();
    svc.listHotels.mockResolvedValue({
      items: [{ id: 7, tenantId: 1, hotelSn: '1721', note: 'batch 1', active: 1, addedBy: 10, createdAt: new Date('2026-10-13T09:00:00Z') }],
      total: 41,
    });
    const res = (await controller.listHotels(master, { page: '2', size: '20', q: '17', active: 'true' })) as {
      items: unknown[];
      pagination: Record<string, unknown>;
    };
    expect(svc.listHotels).toHaveBeenCalledWith(1, { page: 2, size: 20, q: '17', active: true });
    expect(res.items).toEqual([
      { id: '7', hotelSn: '1721', note: 'batch 1', active: true, addedBy: 10, createdAt: '2026-10-13T09:00:00.000Z' },
    ]);
    expect(res.pagination).toMatchObject({ page: 2, size: 20, totalCount: 41, totalPages: 3 });
  });

  it('an absent active filter lists both, not "inactive only"', async () => {
    const { controller, admin: svc } = make();
    svc.listHotels.mockResolvedValue({ items: [], total: 0 });
    await controller.listHotels(master, {});
    expect(svc.listHotels.mock.calls[0][1]).toMatchObject({ active: undefined, page: 1, size: 20 });
  });

  it('the import answers with counts, rows and the unusable lines', async () => {
    const { controller, admin: svc } = make();
    const plan = planHotelImport(parseHotelInput('1721\nnope!\n1721').rows, new Map());
    svc.importHotels.mockResolvedValue({ plan, dryRun: true, headerSkipped: false, exceedsLimit: false });
    const res = await controller.importHotels(master, { text: '1721\nnope!\n1721', dry_run: true });
    expect(res).toMatchObject({ dryRun: true, total: 3, added: 1, duplicate: 1, invalid: 1, exceedsLimit: false });
    expect((res as { invalidRows: Array<{ line: number; raw: string }> }).invalidRows).toEqual([
      expect.objectContaining({ line: 2, raw: 'nope!', status: 'invalid' }),
    ]);
  });

  it('echoes only a bounded preview of a huge import, while the counts cover every line', () => {
    const rows = parseHotelInput(Array.from({ length: 400 }, (_, i) => String(i + 1)).join('\n')).rows;
    const res = PilotMapper.toImport(planHotelImport(rows, new Map()), { dryRun: true, headerSkipped: false, exceedsLimit: false });
    expect(res.total).toBe(400);
    expect(res.added).toBe(400);
    expect(res.rows).toHaveLength(100);
  });
});

describe('Pilot request DTOs — snake_case validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false });
  const run = (metatype: new () => unknown, body: unknown) => pipe.transform(body, { type: 'body', metatype });

  it('the switch needs enabled, guest_allowed and a known non_pilot', async () => {
    await expect(run(UpdatePilotAccessRequest, { enabled: true, guest_allowed: true, non_pilot: 'notice' })).resolves.toMatchObject({ non_pilot: 'notice' });
    await expect(run(UpdatePilotAccessRequest, { enabled: true, guest_allowed: true, non_pilot: 'block' })).rejects.toBeDefined();
    await expect(run(UpdatePilotAccessRequest, { enabled: 'yes', guest_allowed: true, non_pilot: 'hide' })).rejects.toBeDefined();
    await expect(run(UpdatePilotAccessRequest, { enabled: true, non_pilot: 'hide' })).rejects.toBeDefined();
  });

  it('camelCase keys are not accepted in place of the snake_case ones', async () => {
    await expect(run(UpdatePilotAccessRequest, { enabled: true, guestAllowed: true, nonPilot: 'hide' })).rejects.toBeDefined();
  });

  it('a hotel needs a text hotel_sn; the note is bounded', async () => {
    await expect(run(AddPilotHotelRequest, { hotel_sn: '1721', note: 'batch 1' })).resolves.toMatchObject({ hotel_sn: '1721' });
    await expect(run(AddPilotHotelRequest, {})).rejects.toBeDefined();
    await expect(run(AddPilotHotelRequest, { hotel_sn: 1721 })).rejects.toBeDefined();
    await expect(run(AddPilotHotelRequest, { hotel_sn: '1721', note: 'x'.repeat(300) })).rejects.toBeDefined();
  });

  it('the import needs text; dry_run must be a boolean', async () => {
    await expect(run(ImportPilotHotelsRequest, { text: '1721', dry_run: true })).resolves.toMatchObject({ dry_run: true });
    await expect(run(ImportPilotHotelsRequest, { dry_run: true })).rejects.toBeDefined();
    await expect(run(ImportPilotHotelsRequest, { text: '1721', dry_run: 'yes' })).rejects.toBeDefined();
    await expect(run(ImportPilotHotelsRequest, { text: 'x'.repeat(500_001) })).rejects.toBeDefined();
  });

  it('pausing needs a boolean active', async () => {
    await expect(run(UpdatePilotHotelRequest, { active: false })).resolves.toMatchObject({ active: false });
    await expect(run(UpdatePilotHotelRequest, { active: 'no' })).rejects.toBeDefined();
    await expect(run(UpdatePilotHotelRequest, {})).rejects.toBeDefined();
  });
});
