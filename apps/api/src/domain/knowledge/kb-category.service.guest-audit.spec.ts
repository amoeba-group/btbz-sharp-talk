import { KbCategoryService } from './kb-category.service';
import { CATEGORY_ORIGIN, KbCategory } from './entity/kb-category.entity';

/**
 * Who opened a category to signed-out visitors (PLN-261012 SG-50, REQ D-13).
 *
 * `guest_visible` decides what an unidentified visitor of a login_guidance agent may be
 * answered from. Flipping it used to leave a log line and nothing else; after a gate
 * incident "who opened that category, and when" is the first question.
 */
describe('KbCategoryService.setGuestVisible — audit', () => {
  const row = (over: Partial<KbCategory> = {}): KbCategory =>
    ({ id: 1, tenantId: 1, name: 'settlement', label: null, origin: CATEGORY_ORIGIN.MANUAL, sortOrder: 10, hidden: 0, guestVisible: 0, ...over }) as KbCategory;

  function build(r: KbCategory, audit: { write: jest.Mock } | undefined) {
    const repo = {
      findOne: jest.fn(async () => r),
      save: jest.fn(async (d: KbCategory) => ({ ...d })),
    };
    const svc = new KbCategoryService(repo as never, {} as never, {} as never, {} as never, audit as never);
    return { svc, repo };
  }

  it('opening a category writes one audit row naming the console user', async () => {
    const audit = { write: jest.fn(async () => ({})) };
    const { svc } = build(row(), audit);

    await svc.setGuestVisible(1, 1, true, { userId: 42 });

    expect(audit.write).toHaveBeenCalledTimes(1);
    expect(audit.write).toHaveBeenCalledWith({
      tenantId: 1,
      actorType: 'user',
      actorId: 42,
      action: 'kb.category_guest_visible_changed',
      target: 'kb_category:1',
      metadata: { category: 'settlement', from: false, to: true },
    });
  });

  it('closing it is audited the same way, with the direction reversed', async () => {
    const audit = { write: jest.fn(async () => ({})) };
    const { svc } = build(row({ guestVisible: 1 } as never), audit);

    await svc.setGuestVisible(1, 1, false, { userId: 42 });

    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ metadata: { category: 'settlement', from: true, to: false } }));
  });

  it('a repeated PUT that changes nothing is not audited', async () => {
    const audit = { write: jest.fn(async () => ({})) };

    await build(row({ guestVisible: 1 } as never), audit).svc.setGuestVisible(1, 1, true, { userId: 42 });
    await build(row({ guestVisible: 0 } as never), audit).svc.setGuestVisible(1, 1, false, { userId: 42 });

    expect(audit.write).not.toHaveBeenCalled();
  });

  it('without a console user (a script) the actor is the system, never a made-up person', async () => {
    const audit = { write: jest.fn(async () => ({})) };

    await build(row(), audit).svc.setGuestVisible(1, 1, true);

    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ actorType: 'system', actorId: 0 }));
  });

  it('a failing audit write does not undo or fail the flip', async () => {
    const audit = { write: jest.fn(async () => { throw new Error('audit down'); }) };
    const { svc, repo } = build(row(), audit);

    await expect(svc.setGuestVisible(1, 1, true, { userId: 42 })).resolves.toMatchObject({ guestVisible: 1 });
    expect(repo.save).toHaveBeenCalled();
  });

  it('built without an audit service (older positional doubles) the flip still works', async () => {
    const { svc } = build(row(), undefined);

    await expect(svc.setGuestVisible(1, 1, true, { userId: 42 })).resolves.toMatchObject({ guestVisible: 1 });
  });

  it('a catalogue category is refused before anything is saved or audited', async () => {
    const audit = { write: jest.fn(async () => ({})) };
    const { svc, repo } = build(row({ origin: CATEGORY_ORIGIN.CATALOG }), audit);

    await expect(svc.setGuestVisible(1, 1, true, { userId: 42 })).rejects.toThrow();
    expect(repo.save).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });
});
