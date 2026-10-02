import { HttpStatus } from '@nestjs/common';
import { SessionService } from './session.service';
import { Tenant } from '../tenant/entity/tenant.entity';
import { BusinessException } from '../../global/exception/business.exception';
import { runWithRequestContext } from '../../global/middleware/request-context.middleware';

/**
 * The authoritative half of the exposure restriction (PLN-260929 P3).
 *
 * The loader decides what the shopper SEES; this decides whether a session
 * exists at all. It has to stand on its own: a stale loader that never asked,
 * or a direct call to the API, must not get a session the restriction denies.
 */
describe('SessionService — widget access restriction on ensure', () => {
  const restricted = (over: Partial<Tenant> = {}): Tenant =>
    ({
      id: 1,
      status: 'active',
      shopDomain: 'shop.example.com',
      embedOrigins: null,
      widgetAccessKey: null,
      widgetAccess: {
        enabled: true,
        startsAt: null,
        endsAt: null,
        ips: ['203.0.113.7'],
        urls: ['https://shop.example.com/collections/test'],
      },
      ...over,
    }) as Tenant;

  /** Only the collaborators this path touches. */
  function service(tenant: Tenant) {
    const sessionRepo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((x: object) => x),
      save: jest.fn(async (x: object) => ({ ...x, id: 1, tenantId: tenant.id })),
      update: jest.fn(),
    };
    const tenantRepo = {
      findOne: jest.fn(async () => tenant),
      findAndCount: jest.fn(async () => [[tenant], 1]),
    };
    return new SessionService(
      sessionRepo as never,
      tenantRepo as never,
      { findOne: jest.fn(async () => null) } as never, // customers
      { publish: jest.fn(async () => undefined) } as never, // event bus
      { del: jest.fn(), get: jest.fn(async () => null), set: jest.fn() } as never, // redis
      { findOne: jest.fn(async () => null) } as never, // ai agents (optional)
    );
  }

  const ensure = (
    svc: SessionService,
    opts: { ip?: string | null; origin?: string; path?: string; key?: string } = {},
  ) =>
    runWithRequestContext({ requestId: 'r-1', ip: opts.ip ?? null }, () =>
      svc.ensure(undefined, 'en', 'shop.example.com', opts.origin, undefined, opts.path, opts.key),
    );

  it('lets an unrestricted tenant through untouched', async () => {
    const svc = service(restricted({ widgetAccess: null }));
    await expect(ensure(svc, { origin: 'https://anywhere.example', ip: '198.51.100.1' })).resolves.toBeTruthy();
  });

  it('refuses a visitor who matches no rule', async () => {
    const svc = service(restricted());
    await expect(
      ensure(svc, { origin: 'https://shop.example.com', path: '/', ip: '198.51.100.1' }),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
  });

  it('admits the allowed IP from any page', async () => {
    const svc = service(restricted());
    await expect(
      ensure(svc, { origin: 'https://shop.example.com', path: '/', ip: '203.0.113.7' }),
    ).resolves.toBeTruthy();
  });

  it('admits the allowed URL from any IP — origin + landing path rebuild the page', async () => {
    const svc = service(restricted());
    await expect(
      ensure(svc, {
        origin: 'https://shop.example.com',
        path: '/collections/test/item-1',
        ip: '198.51.100.1',
      }),
    ).resolves.toBeTruthy();
  });

  it('reads the real widget\u2019s landing value, which is a full URL (FIX-261002)', async () => {
    // The loader sends window.location.href as `landing_path`. Joining that onto
    // the parent origin produced "https://shophttps://shop/" and the URL rule
    // matched nothing in production while hand-made calls with a bare path
    // passed — the exact shape of this test is the bug it closes.
    const svc = service(restricted());
    await expect(
      ensure(svc, {
        origin: 'https://shop.example.com',
        path: 'https://shop.example.com/collections/test/item-1',
        ip: '198.51.100.1',
      }),
    ).resolves.toBeTruthy();
  });

  it('still refuses a full URL that no rule covers', async () => {
    const svc = service(restricted());
    await expect(
      ensure(svc, {
        origin: 'https://shop.example.com',
        path: 'https://shop.example.com/cart',
        ip: '198.51.100.1',
      }),
    ).rejects.toThrow(BusinessException);
  });

  it('matches on the landing URL even when the parent origin is missing', async () => {
    const svc = service(restricted());
    await expect(
      ensure(svc, { path: 'https://shop.example.com/collections/test', ip: '198.51.100.1' }),
    ).resolves.toBeTruthy();
  });

  it('admits the invite key holder', async () => {
    const svc = service(restricted({ widgetAccessKey: 'k-123' }));
    await expect(
      ensure(svc, { origin: 'https://shop.example.com', path: '/', ip: '198.51.100.1', key: 'k-123' }),
    ).resolves.toBeTruthy();
    const svc2 = service(restricted({ widgetAccessKey: 'k-123' }));
    await expect(
      ensure(svc2, { origin: 'https://shop.example.com', path: '/', ip: '198.51.100.1', key: 'wrong' }),
    ).rejects.toThrow(BusinessException);
  });

  it('stops restricting once the window has closed', async () => {
    const svc = service(
      restricted({
        widgetAccess: {
          enabled: true,
          startsAt: '2020-01-01T00:00:00.000Z',
          endsAt: '2020-01-02T00:00:00.000Z',
          ips: ['203.0.113.7'],
          urls: [],
        },
      }),
    );
    await expect(
      ensure(svc, { origin: 'https://shop.example.com', path: '/', ip: '198.51.100.1' }),
    ).resolves.toBeTruthy();
  });

  it('refuses a suspended tenant even with no restriction configured', async () => {
    const svc = service(restricted({ status: 'suspended', widgetAccess: null }));
    await expect(
      ensure(svc, { origin: 'https://shop.example.com', ip: '203.0.113.7' }),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
  });

  it('without a parent origin the URL rule cannot apply — IP still decides', async () => {
    // A host app WebView or a direct open: there is no storefront page.
    const denied = service(restricted());
    await expect(ensure(denied, { ip: '198.51.100.1' })).rejects.toThrow(BusinessException);
    const allowed = service(restricted());
    await expect(ensure(allowed, { ip: '203.0.113.7' })).resolves.toBeTruthy();
  });
});
