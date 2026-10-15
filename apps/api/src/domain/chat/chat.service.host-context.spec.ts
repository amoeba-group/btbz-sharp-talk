import { ChatService } from './chat.service';

/**
 * A native host's "opened from booking #…" line (PLN-261015) must be written once
 * per place — not on every message, not again after the shopper merely types —
 * and it must be written again when the place changes.
 */
describe('ChatService — host context line', () => {
  const svc = Object.create(ChatService.prototype) as ChatService;

  const isNew = async (
    rows: { id: number; retrievalTrace: unknown }[],
    ctx: { screen: string; ref?: string; label?: string },
  ) => {
    const find = jest.fn(async () => rows);
    Object.assign(svc as unknown as Record<string, unknown>, { msgRepo: { find } });
    const res = await (
      svc as unknown as {
        isNewHostContext: (id: number, c: unknown) => Promise<boolean>;
      }
    ).isNewHostContext(7, ctx);
    return { res, find };
  };

  it('is new when the thread has no context line yet', async () => {
    expect((await isNew([], { screen: 'bookings', ref: 'G2J-8841' })).res).toBe(true);
    // system rows exist (consent, handoff) but none carries a host context
    expect((await isNew([{ id: 3, retrievalTrace: null }, { id: 2, retrievalTrace: { reason: 'x' } }], { screen: 'home' })).res).toBe(
      true,
    );
  });

  it('is not new for the same screen and ref, whatever the label says', async () => {
    const rows = [{ id: 5, retrievalTrace: { hostContext: { screen: 'bookings', ref: 'G2J-8841', label: 'Chờ nhận phòng' } } }];
    expect((await isNew(rows, { screen: 'bookings', ref: 'G2J-8841', label: 'Đã nhận phòng' })).res).toBe(false);
  });

  it('is new again when the place changes', async () => {
    const rows = [{ id: 5, retrievalTrace: { hostContext: { screen: 'bookings', ref: 'G2J-8841' } } }];
    expect((await isNew(rows, { screen: 'bookings', ref: 'G2J-8847' })).res).toBe(true);
    expect((await isNew(rows, { screen: 'reconciliation' })).res).toBe(true);
  });

  it('compares against the NEWEST context line, not an older one', async () => {
    // Newest first: the shopper went A → B, and is now back to A, so A is new again.
    const rows = [
      { id: 9, retrievalTrace: { hostContext: { screen: 'bookings', ref: 'B' } } },
      { id: 4, retrievalTrace: { hostContext: { screen: 'bookings', ref: 'A' } } },
    ];
    expect((await isNew(rows, { screen: 'bookings', ref: 'A' })).res).toBe(true);
    expect((await isNew(rows, { screen: 'bookings', ref: 'B' })).res).toBe(false);
  });

  it('only looks at system rows of this conversation, newest first, and a bounded few', async () => {
    const { find } = await isNew([], { screen: 'home' });
    expect(find).toHaveBeenCalledWith({
      where: { conversationId: 7, senderType: 'system' },
      order: { id: 'DESC' },
      take: 20,
    });
  });
});
