import { WidgetDesignService } from './widget-design.service';
import { Tenant } from './entity/tenant.entity';
import { WidgetDesignRow } from './entity/widget-design.entity';

/**
 * Custom widget library (PLN-260910 P3 D-12′): the live pointer + live copy,
 * the guards around the live design, and the preview token round trip.
 */
describe('WidgetDesignService', () => {
  beforeAll(() => {
    process.env.CRED_ENC_KEY = Buffer.alloc(32, 9).toString('base64');
  });

  const design = { font: { preset: 'inter', baseSize: 15 }, radius: 'lg', panel: { width: 420, height: 700 } };

  function build() {
    const rows: WidgetDesignRow[] = [];
    const tenant = {
      id: 1,
      widgetTheme: { brand: '#2B7FFF', headerStyle: 'white', launcher: { position: 'right', size: 'md', icon: 'chat' } },
      activeWidgetDesignId: null,
    } as unknown as Tenant;
    let nextId = 10;
    const repo = {
      create: (d: Partial<WidgetDesignRow>) => d as WidgetDesignRow,
      save: jest.fn(async (d: WidgetDesignRow) => {
        if (d.id == null) d.id = nextId++;
        const i = rows.findIndex((r) => r.id === d.id);
        if (i >= 0) rows[i] = d;
        else rows.push(d);
        return d;
      }),
      find: jest.fn(async () => rows),
      findOne: jest.fn(async ({ where }: any) =>
        rows.find((r) => (where.id == null || r.id === where.id) && (where.name == null || r.name === where.name)) ?? null),
      delete: jest.fn(async ({ id }: any) => {
        const i = rows.findIndex((r) => r.id === id);
        if (i >= 0) rows.splice(i, 1);
      }),
    };
    const tenantRepo = { save: jest.fn(async (t: Tenant) => t), findOne: jest.fn(async () => tenant) };
    const tenants = {
      findById: jest.fn(async () => tenant),
      resolveDesign: jest.fn(async (_t: number, d: any) => ({
        font: d.font ? { preset: d.font.preset, asset: null, baseSize: d.font.base_size } : null,
        radius: d.radius ?? null,
        panel: d.panel ?? null,
        launcherIcon: null,
      })),
    };
    const audit = { write: jest.fn() };
    const live = { publish: jest.fn() };
    const assets = { get: jest.fn(), readBuffer: jest.fn(), store: jest.fn() };
    const revs: any[] = [];
    const revRepo = {
      create: (d: any) => d,
      save: jest.fn(async (d: any) => { d.id = revs.length + 1; revs.push(d); return d; }),
      delete: jest.fn(async ({ designId }: any) => { for (let i = revs.length - 1; i >= 0; i--) if (revs[i].designId === designId) revs.splice(i, 1); }),
      find: jest.fn(async ({ where }: any) => revs.filter((r) => r.designId === where.designId).sort((a, b) => b.revisionNo - a.revisionNo)),
      findOne: jest.fn(async ({ where, order }: any) => {
        const list = revs.filter((r) => (where.designId == null || r.designId === where.designId) && (where.id == null || r.id === where.id));
        return (order ? list.sort((a, b) => b.revisionNo - a.revisionNo)[0] : list[0]) ?? null;
      }),
    };
    const svc = new WidgetDesignService(repo as never, tenantRepo as never, revRepo as never, tenants as never, audit as never, live as never, assets as never);
    return { svc, rows, tenant, audit, live, assets, revs };
  }

  const wire = { font: { preset: 'inter', base_size: 15 }, radius: 'lg', panel: { width: 420, height: 700 } };

  it('create keeps the design in the library without touching the live theme; apply copies it live', async () => {
    const h = build();
    const row = await h.svc.create(1, { name: '봄', design: wire } as never, 7);
    expect(row.designJson).toEqual(design);
    expect(h.tenant.activeWidgetDesignId).toBeNull();
    expect(h.tenant.widgetTheme?.design).toBeUndefined();

    await h.svc.apply(1, Number(row.id), 7);
    expect(h.tenant.activeWidgetDesignId).toBe(Number(row.id));
    expect(h.tenant.widgetTheme?.design).toEqual(design);
    expect(h.tenant.widgetTheme?.brand).toBe('#2B7FFF');
    expect(h.audit.write).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'tenant.widget_design_applied' }));
    // The static live file follows every live write (P4 D-14).
    expect(h.live.publish).toHaveBeenCalledWith(h.tenant);
  });

  it('export embeds the assets as base64 and import re-creates them through the validating store', async () => {
    const h = build();
    const font = '94c2949c-3ce5-47be-acb3-3c4cfa7c58b3';
    h.assets.get.mockResolvedValue({ uuid: font, kind: 'font', filename: 'Brand.woff2', label: 'Brand', mime: 'font/woff2' });
    h.assets.readBuffer.mockResolvedValue(Buffer.from('wOF2....'));
    h.assets.store.mockResolvedValue({ uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', version: 1 });
    const row = await h.svc.create(1, { name: 'A', design: wire } as never, 7);
    row.designJson = { ...row.designJson, font: { preset: 'custom', asset: { uuid: font, version: 1 }, baseSize: 15 } };
    const pkg = await h.svc.exportPackage(1, Number(row.id));
    expect(pkg.format).toBe('sharptalk-widget-design/1');
    expect((pkg.assets as any[])[0]).toMatchObject({ role: 'font', kind: 'font', base64: Buffer.from('wOF2....').toString('base64') });

    const imported = await h.svc.importPackage(1, Buffer.from(JSON.stringify(pkg)), 7);
    expect(h.assets.store).toHaveBeenCalledWith(1, expect.objectContaining({ area: 'design', kind: 'font' }), expect.objectContaining({ originalname: 'Brand.woff2' }), { userId: 7 });
    expect(imported.name).toBe('A (2)'); // name taken → suffixed
    expect(imported.designJson.font).toEqual({ preset: 'custom', asset: { uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', version: 1 }, baseSize: 15 });
    await expect(h.svc.importPackage(1, Buffer.from('{"format":"x"}'), 7)).rejects.toMatchObject({ errorCode: 'E5003' });
  });

  it('export/import carries the avatar slots and the file-less options (PLN-261019)', async () => {
    const h = build();
    const bot = '11111111-2222-4333-8444-555555555555';
    h.assets.get.mockResolvedValue({ uuid: bot, kind: 'icon', filename: 'joybot.png', label: 'JoyBot', mime: 'image/png' });
    h.assets.readBuffer.mockResolvedValue(Buffer.from('PNG'));
    h.assets.store.mockResolvedValue({ uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', version: 1 });
    const row = await h.svc.create(1, { name: 'B', design: wire } as never, 7);
    row.designJson = {
      ...row.designJson,
      headerLayout: 'logo-title',
      messageStyle: 'avatar',
      attachIcon: 'image',
      quickReplyStyle: 'card',
      icons: { botAvatar: { uuid: bot, version: 1 } },
    };
    const pkg = await h.svc.exportPackage(1, Number(row.id));
    expect((pkg.assets as any[]).map((a) => a.role)).toEqual(['botAvatar']);
    const imported = await h.svc.importPackage(1, Buffer.from(JSON.stringify(pkg)), 7);
    expect(imported.designJson).toMatchObject({
      headerLayout: 'logo-title',
      messageStyle: 'avatar',
      attachIcon: 'image',
      quickReplyStyle: 'card',
      icons: { botAvatar: { uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', version: 1 } },
    });
  });

  it('refuses to archive or delete the live design, and revert clears pointer + live copy', async () => {
    const h = build();
    const row = await h.svc.create(1, { name: 'A', design: wire } as never, 7);
    await h.svc.apply(1, Number(row.id), 7);
    await expect(h.svc.setStatus(1, Number(row.id), 'archived', 7)).rejects.toMatchObject({ errorCode: 'E5086' });
    await expect(h.svc.remove(1, Number(row.id), 7)).rejects.toMatchObject({ errorCode: 'E5086' });

    await h.svc.revert(1, 7);
    expect(h.tenant.activeWidgetDesignId).toBeNull();
    expect(h.tenant.widgetTheme?.design).toBeUndefined();
    expect(h.tenant.widgetTheme?.launcher?.icon).toBe('chat');
    await h.svc.update(1, Number(row.id), { design: { ...wire, radius: 'sm' } } as never, 7); // leaves a revision
    await h.svc.remove(1, Number(row.id), 7);
    expect(h.rows).toHaveLength(0);
    expect(h.revs).toHaveLength(0); // history goes with the design
  });

  it('update snapshots the previous state (max+1) and a snapshot can be restored, re-syncing the live copy', async () => {
    const h = build();
    const row = await h.svc.create(1, { name: 'A', design: wire } as never, 7);
    await h.svc.apply(1, Number(row.id), 7);
    await h.svc.update(1, Number(row.id), { design: { ...wire, radius: 'sm' } } as never, 7);
    await h.svc.update(1, Number(row.id), { design: { ...wire, radius: 'md' } } as never, 7);
    await h.svc.update(1, Number(row.id), { name: 'A2' } as never, 7); // name-only: no revision
    const list = await h.svc.revisions(1, Number(row.id));
    expect(list.map((r) => [r.revisionNo, r.designJson.radius])).toEqual([[2, 'sm'], [1, 'lg']]);
    await h.svc.restoreRevision(1, Number(row.id), list[1].id, 7);
    expect(h.rows[0].designJson.radius).toBe('lg');
    expect(h.tenant.widgetTheme?.design?.radius).toBe('lg');
    expect((await h.svc.revisions(1, Number(row.id)))[0].revisionNo).toBe(3); // restore itself is undoable
  });

  it('rejects a duplicate name, and duplicate() picks a free copy name', async () => {
    const h = build();
    await h.svc.create(1, { name: 'A', design: wire } as never, 7);
    await expect(h.svc.create(1, { name: 'A', design: wire } as never, 7)).rejects.toMatchObject({ errorCode: 'E5087' });
    const copy = await h.svc.duplicate(1, 10, 7);
    expect(copy.name).toBe('A (copy)');
    const copy2 = await h.svc.duplicate(1, 10, 7);
    expect(copy2.name).toBe('A (copy 2)');
  });

  it('editing the live design updates the live copy; preview token resolves to basic ⊕ design', async () => {
    const h = build();
    const row = await h.svc.create(1, { name: 'A', design: wire } as never, 7);
    await h.svc.apply(1, Number(row.id), 7);
    await h.svc.update(1, Number(row.id), { design: { ...wire, radius: 'sm' } } as never, 7);
    expect(h.tenant.widgetTheme?.design?.radius).toBe('sm');

    const { token } = await h.svc.previewToken(1, Number(row.id));
    const theme = await h.svc.previewTheme(token);
    expect(theme?.brand).toBe('#2B7FFF');
    expect(theme?.design?.radius).toBe('sm');
    expect(await h.svc.previewTheme(token.replace(/[0-9a-f]{4}$/, '0000'))).toBeNull();
  });
});
