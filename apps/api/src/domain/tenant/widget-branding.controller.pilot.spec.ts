import type { Response } from 'express';
import { WidgetBrandingController } from './widget-branding.controller';

/**
 * `GET /public/widget/visibility` and the pilot allowlist (PLN-261012 SG-40).
 *
 * The loader asks this BEFORE it shows anything. All it learns about the pilot is
 * whether the tenant keeps a hotel list at all, so it can hold the widget hidden
 * until the widget reports a verdict for the visitor. It must say nothing else
 * about the list, and nothing new for a tenant without one.
 */
describe('WidgetBrandingController.visibility — pilot hint', () => {
  const res = { setHeader: jest.fn() } as unknown as Response;

  function controller(tenant: Record<string, unknown> | null) {
    const tenants = { findByShopDomain: jest.fn(async () => tenant) };
    return new WidgetBrandingController(tenants as never, {} as never, {} as never);
  }
  const call = (c: WidgetBrandingController, shop: string | undefined = 'shop.example.com') =>
    c.visibility(shop, undefined, undefined, undefined, res) as Promise<Record<string, unknown>>;

  it('tells the loader a pilot list is in force when it is switched on', async () => {
    const out = await call(controller({ status: 'active', widgetAccess: null, pilotAccess: { enabled: true } }));
    expect(out).toMatchObject({ visible: true, restricted: false, pilot: { enabled: true } });
  });

  it('says no for a tenant that never configured it, or switched it off', async () => {
    expect((await call(controller({ status: 'active', widgetAccess: null, pilotAccess: null }))).pilot).toEqual({ enabled: false });
    expect((await call(controller({ status: 'active', widgetAccess: null, pilotAccess: { enabled: false } }))).pilot).toEqual({ enabled: false });
  });

  it('reveals nothing about the list itself — only the one boolean', async () => {
    const out = await call(
      controller({
        status: 'active',
        widgetAccess: null,
        pilotAccess: { enabled: true, guestAllowed: false, nonPilot: 'notice', notice: { VI: 'x' } },
      }),
    );
    expect(out.pilot).toEqual({ enabled: true });
  });

  it('leaves the exposure-restriction verdict exactly as it was', async () => {
    const out = await call(controller({ status: 'suspended', widgetAccess: null, pilotAccess: { enabled: true } }));
    expect(out).toMatchObject({ visible: false, restricted: true });
  });

  it('an unknown shop stays the old answer, with no pilot key', async () => {
    expect(await call(controller(null))).toEqual({ visible: true, restricted: false });
  });
});
