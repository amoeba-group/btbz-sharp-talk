import { escalationPreview, isTeamChoiceMessage } from './escalation-preview.util';

type Msg = { id: number; body: string; retrievalTrace?: unknown };

/** An in-memory customer thread: fetch the latest message, or the latest older than `beforeId`. */
function thread(rows: Msg[]) {
  return jest.fn(async (beforeId?: number) =>
    [...rows].sort((a, b) => b.id - a.id).find((m) => beforeId == null || m.id < beforeId) ?? null,
  );
}

const CHIP = { kind: 'team_choice', supportType: 'business' };

describe('escalationPreview — the question, not the team chip (w3c, ops-manual finding 16)', () => {
  it('quotes the last customer message when no team was chosen', async () => {
    const fetch = thread([{ id: 1, body: 'Làm sao đổi giá phòng?' }]);
    expect(await escalationPreview(fetch)).toBe('Làm sao đổi giá phòng?');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('skips the team chip and quotes the message the customer asked before it', async () => {
    const fetch = thread([
      { id: 10, body: 'Hoa hồng tháng này là bao nhiêu?' },
      { id: 12, body: 'Hỗ trợ kinh doanh', retrievalTrace: CHIP },
    ]);
    expect(await escalationPreview(fetch)).toBe('Hoa hồng tháng này là bao nhiêu?');
  });

  it('steps back over several chips (a customer who changed their mind)', async () => {
    const fetch = thread([
      { id: 3, body: 'Hóa đơn bị sai' },
      { id: 5, body: 'Hỗ trợ khách hàng', retrievalTrace: { ...CHIP, supportType: 'cs' } },
      { id: 9, body: 'Hỗ trợ kinh doanh', retrievalTrace: CHIP },
    ]);
    expect(await escalationPreview(fetch)).toBe('Hóa đơn bị sai');
  });

  it('is empty, not the chip text, when the chip is all the customer ever said', async () => {
    expect(await escalationPreview(thread([{ id: 4, body: 'Hỗ trợ kinh doanh', retrievalTrace: CHIP }]))).toBe('');
    expect(await escalationPreview(thread([]))).toBe('');
  });

  it('keeps the preview to 300 characters', async () => {
    expect((await escalationPreview(thread([{ id: 1, body: 'x'.repeat(500) }]))).length).toBe(300);
  });

  it('gives up on a long pile of chips instead of scanning the thread', async () => {
    const rows: Msg[] = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, body: 'chip', retrievalTrace: CHIP }));
    const fetch = thread(rows);
    expect(await escalationPreview(fetch, 3)).toBe('');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('does not loop on a row without an id (a double): no quote rather than the chip text', async () => {
    const fetch = jest.fn(async () => ({ body: 'Business Support', retrievalTrace: CHIP }));
    expect(await escalationPreview(fetch)).toBe('');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('recognises a chip only by its trace kind, never by its wording', () => {
    expect(isTeamChoiceMessage({ retrievalTrace: CHIP })).toBe(true);
    expect(isTeamChoiceMessage({ body: 'team_choice', retrievalTrace: { kind: 'team_question' } })).toBe(false);
    expect(isTeamChoiceMessage({ retrievalTrace: null })).toBe(false);
    expect(isTeamChoiceMessage(null)).toBe(false);
  });
});
