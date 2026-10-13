import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { KnowledgeController } from './knowledge.controller';
import { KbCategoryService } from './kb-category.service';
import { SetCategoryAccessRequest, SetCategoryGuestVisibleRequest } from './dto/request/knowledge.request';
import { CATEGORY_ORIGIN, KbCategory } from './entity/kb-category.entity';

/**
 * The category-access endpoint (PLN-261012 SG-10, wireframe W1) and its compatibility with
 * the older /guest-visible one. Controllers are glue only: the request is validated, the
 * console user is handed on for the audit trail, and the response carries the tier.
 */
describe('PUT /knowledge/categories/:id/access', () => {
  const row = (over: Partial<KbCategory> = {}): KbCategory =>
    ({
      id: 3,
      tenantId: 1,
      name: 'settlement',
      label: null,
      docGroup: 'counsel',
      origin: CATEGORY_ORIGIN.MANUAL,
      sortOrder: 10,
      hidden: 0,
      agentIds: null,
      guestVisible: 0,
      minAudience: 'manager',
      ...over,
    }) as KbCategory;

  const build = () => {
    const kbCategories = {
      setAccess: jest.fn(async () => row()),
      setGuestVisible: jest.fn(async () => row({ guestVisible: 1, minAudience: 'public' })),
    };
    const args = Array(13).fill({}) as never[];
    args[9] = kbCategories as unknown as KbCategoryService; // 10th constructor parameter
    const ctrl = new KnowledgeController(...(args as ConstructorParameters<typeof KnowledgeController>));
    return { ctrl, kbCategories };
  };
  const user = { actorType: 'user', userId: 7, tenantId: 1 } as never;

  describe('request validation', () => {
    const check = async (access: unknown) => validate(plainToInstance(SetCategoryAccessRequest, { access }));

    it.each(['public', 'partner', 'manager'])('accepts %s', async (access) => {
      expect(await check(access)).toHaveLength(0);
    });

    it.each([undefined, null, '', 'Manager', 'admin', 'guest', 2, true, ['manager']])('rejects %j', async (access) => {
      expect((await check(access)).length).toBeGreaterThan(0);
    });
  });

  it('hands the tenant, the category, the tier and the console user to the service, and returns the tier', async () => {
    const { ctrl, kbCategories } = build();

    const res = await ctrl.setCategoryAccess(user, '3', { access: 'manager' });

    expect(kbCategories.setAccess).toHaveBeenCalledWith(1, 3, 'manager', { userId: 7 });
    expect(res).toMatchObject({ id: '3', guestVisible: false, access: 'manager', minAudience: 'manager' });
  });

  it('the older /guest-visible endpoint keeps its contract: same body, same service call, now also reports the tier', async () => {
    const { ctrl, kbCategories } = build();
    const body = plainToInstance(SetCategoryGuestVisibleRequest, { guest_visible: true });
    expect(await validate(body)).toHaveLength(0);

    const res = await ctrl.setCategoryGuestVisible(user, '3', body);

    expect(kbCategories.setGuestVisible).toHaveBeenCalledWith(1, 3, true, { userId: 7 });
    expect(res).toMatchObject({ guestVisible: true, access: 'public', minAudience: 'public' });
  });

  it('a legacy row (NULL min_audience) reads by its flag in the response', async () => {
    const { ctrl, kbCategories } = build();
    kbCategories.setAccess.mockResolvedValueOnce(row({ guestVisible: 1, minAudience: null }));

    const res = await ctrl.setCategoryAccess(user, '3', { access: 'public' });

    expect(res).toMatchObject({ guestVisible: true, access: 'public', minAudience: null });
  });
});
