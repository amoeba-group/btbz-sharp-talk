import { UserService } from './user.service';
import { EVENTS } from '../../infrastructure/infrastructure.module';

/**
 * A staff member's region or status changes (PLN-261012 SG-65, REQ D-20): the user service tells the
 * alert side (EVENTS.USER_ROUTING_CHANGED) so alerts still pinned to them for the other region are
 * re-pointed. The re-pointing itself is tested with the alert service; this is the publishing half.
 */
describe('UserService — routing change events', () => {
  function build(withBus = true) {
    const user = { id: 11, tenantId: 1, email: 'lan@example.com', name: 'Lan', rank: 'staff', status: 'active', region: 'north' };
    const userRepo = {
      findOne: jest.fn(async () => user),
      save: jest.fn(async (u: unknown) => u),
    };
    const userLabelRepo = { find: jest.fn(async () => []) };
    const labelRepo = { find: jest.fn(async () => []) };
    const publish = jest.fn(async () => undefined);
    const svc = new UserService(
      userRepo as never,
      labelRepo as never,
      userLabelRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { get: jest.fn() } as never,
      undefined,
      withBus ? ({ publish } as never) : undefined,
    );
    return { svc, user, publish };
  }

  it('publishes the new region when it changes', async () => {
    const h = build();
    await h.svc.updateRegion(1, 11, 'south');
    expect(h.user.region).toBe('south');
    expect(h.publish).toHaveBeenCalledWith(EVENTS.USER_ROUTING_CHANGED, { tenantId: 1, userId: 11, region: 'south' });
  });

  it('publishes null when the user becomes nationwide', async () => {
    const h = build();
    await h.svc.updateRegion(1, 11, '');
    expect(h.user.region).toBeNull();
    expect(h.publish).toHaveBeenCalledWith(EVENTS.USER_ROUTING_CHANGED, { tenantId: 1, userId: 11, region: null });
  });

  it('publishes the new status, with the region, so a suspended user loses their pinned alerts', async () => {
    const h = build();
    await h.svc.updateStatus(1, 11, 'suspended');
    expect(h.publish).toHaveBeenCalledWith(EVENTS.USER_ROUTING_CHANGED, {
      tenantId: 1,
      userId: 11,
      region: 'north',
      status: 'suspended',
    });
  });

  it('saves first, then tells the alert side (it reads the saved user)', async () => {
    const order: string[] = [];
    const h = build();
    (h.svc as unknown as { userRepo: { save: jest.Mock } }).userRepo.save.mockImplementation(async (u: unknown) => {
      order.push('save');
      return u;
    });
    h.publish.mockImplementation(async () => void order.push('publish'));
    await h.svc.updateRegion(1, 11, 'south');
    expect(order).toEqual(['save', 'publish']);
  });

  it('works without the bus (a service built the old way) — nothing is published, nothing breaks', async () => {
    const h = build(false);
    await expect(h.svc.updateRegion(1, 11, 'south')).resolves.toBeDefined();
    expect(h.publish).not.toHaveBeenCalled();
  });
});
