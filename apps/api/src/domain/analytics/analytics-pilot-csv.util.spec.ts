import {
  CSV_BOM,
  PILOT_CSV_COLUMNS,
  TRANSCRIPT_MAX_CHARS,
  TRANSCRIPT_MAX_MESSAGES,
  TRANSCRIPT_MESSAGE_MAX_CHARS,
  buildTranscript,
  csvCell,
  csvLine,
  pilotCsvHeader,
  pilotCsvRow,
  pilotCsvTruncationLine,
  scrubTranscriptText,
} from './analytics-pilot-csv.util';
import { classifyConversation } from './analytics-pilot.util';
import { facts } from './testing/pilot-fixtures';

/** A tiny RFC-4180 reader so the tests check what a spreadsheet would SEE, not just substrings. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      cur.push(field);
      field = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = '';
      i += 1;
    } else field += ch;
  }
  if (field || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

describe('csvCell / csvLine — escaping', () => {
  it('quotes a field that holds a comma, a quote or a line break, and doubles the quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('cr\rhere')).toBe('"cr\rhere"');
  });

  it('leaves a plain field bare and treats null / undefined / non-finite numbers as empty', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(NaN)).toBe('');
    expect(csvCell(12)).toBe('12');
    expect(csvCell(0.65)).toBe('0.65');
  });

  it('keeps Vietnamese, Korean and emoji intact (the whole point of the BOM)', () => {
    expect(csvCell('Giá ưu đãi đặc biệt ễ ợ ữ ặ ậ')).toBe('Giá ưu đãi đặc biệt ễ ợ ữ ặ ậ');
    expect(csvCell('환불 계좌 😀')).toBe('환불 계좌 😀');
  });

  it('a record ends with CRLF and round-trips through a reader', () => {
    const line = csvLine(['1', 'a,b', 'say "x"', 'multi\nline', null, 7]);
    expect(line.endsWith('\r\n')).toBe(true);
    expect(parseCsv(line)).toEqual([['1', 'a,b', 'say "x"', 'multi\nline', '', '7']]);
  });
});

describe('CSV injection — a cell must never be a formula', () => {
  it.each(['=HYPERLINK("http://evil","x")', '+1+1', '-2+3', '@SUM(A1:A2)', '\t=1', '\r=1'])(
    'prefixes an apostrophe to %j',
    (cell) => {
      const out = csvCell(cell);
      expect(out.startsWith("'") || out.startsWith('"\'')).toBe(true);
    },
  );

  it('a formula typed by a customer inside a transcript line cannot start a cell (lines start with a label)', () => {
    const t = buildTranscript([{ id: 1, senderType: 'user', body: '=cmd|"/c calc"!A1' }]);
    expect(t.startsWith('USER: ')).toBe(true);
  });

  it('numbers are never apostrophe-prefixed (a negative number is a number, not text)', () => {
    expect(csvCell(-5)).toBe('-5');
  });
});

describe('header, BOM, column order', () => {
  it('starts with the UTF-8 BOM, exactly once', () => {
    const header = pilotCsvHeader();
    expect(header.startsWith(CSV_BOM)).toBe(true);
    expect(header.indexOf(CSV_BOM, 1)).toBe(-1);
    expect(Buffer.from(header, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('the column order is pinned — people grade this file by hand and scripts read it by position', () => {
    expect(PILOT_CSV_COLUMNS).toEqual([
      'conversation_id',
      'started_at',
      'hotel_sn',
      'role',
      'ai_agent_id',
      'language',
      'outcome',
      'handoff_reason',
      'refusals',
      'csat',
      'message_count',
      'avg_confidence',
      'transcript',
    ]);
    expect(parseCsv(pilotCsvHeader().slice(1))[0]).toEqual([...PILOT_CSV_COLUMNS]);
  });

  it('every data row has exactly as many fields as the header', () => {
    const f = facts({ row: { escalated: true }, reasons: [{ reason: 'low_confidence', turns: 1, firstId: 1 }] });
    const rec = parseCsv(pilotCsvRow(f, classifyConversation(f), 'USER: a, "b"\nAI: c'))[0];
    expect(rec).toHaveLength(PILOT_CSV_COLUMNS.length);
  });
});

describe('a conversation row', () => {
  it('writes the agreed fields, in order', () => {
    const f = facts({
      row: { id: 4821, createdAt: new Date('2026-10-12T03:04:05Z'), hotelSn: '1721', actorRole: 'manager', aiAgentId: 3, language: 'VI', csatRating: 4 },
      messages: { total: 7, answers: 2, confidenceSum: 1.5 },
      reasons: [{ reason: 'guest_gate', turns: 2, firstId: 1 }, { reason: 'auth_gate', turns: 1, firstId: 2 }],
    });
    const rec = parseCsv(pilotCsvRow(f, classifyConversation(f), 'USER: hi'))[0];
    const by = Object.fromEntries(PILOT_CSV_COLUMNS.map((c, i) => [c, rec[i]]));
    expect(by).toEqual({
      conversation_id: '4821',
      started_at: '2026-10-12T03:04:05.000Z',
      hotel_sn: '1721',
      role: 'manager',
      ai_agent_id: '3',
      language: 'VI',
      outcome: 'ai_only',
      handoff_reason: '',
      refusals: 'auth_gate:1;guest_gate:2', // sorted: two exports of the same data are byte-identical
      csat: '4',
      message_count: '7',
      avg_confidence: '0.75',
      transcript: 'USER: hi',
    });
  });

  it('a hand-off carries its reason; a legacy row with no stamps leaves the cells empty (no "null", no crash)', () => {
    const f = facts({
      row: { hotelSn: null, actorRole: null, aiAgentId: null, language: null, escalated: true },
      reasons: [{ reason: 'partner_unavailable', turns: 1, firstId: 3 }],
    });
    const rec = parseCsv(pilotCsvRow(f, classifyConversation(f), ''))[0];
    const by = Object.fromEntries(PILOT_CSV_COLUMNS.map((c, i) => [c, rec[i]]));
    expect(by).toMatchObject({ hotel_sn: '', role: '', ai_agent_id: '', language: '', outcome: 'handoff', handoff_reason: 'partner_unavailable', csat: '', avg_confidence: '' });
    expect(pilotCsvRow(f, classifyConversation(f), '')).not.toMatch(/null|undefined|NaN/);
  });

  it('two renderings of the same data are byte-identical (stable for diffing two exports)', () => {
    const f = facts({ reasons: [{ reason: 'b_reason', turns: 1, firstId: 1 }, { reason: 'a_reason', turns: 1, firstId: 2 }] });
    const v = classifyConversation(f);
    expect(pilotCsvRow(f, v, 'x')).toBe(pilotCsvRow(f, v, 'x'));
  });

  it('the row holds no customer / session identifier at all', () => {
    const f = facts({ row: { customerId: 998877, sessionId: 554433 } });
    const out = pilotCsvRow(f, classifyConversation(f), 'USER: hi');
    expect(out).not.toContain('998877');
    expect(out).not.toContain('554433');
  });
});

describe('truncation record', () => {
  it('is one record with the same width as the header, flagged in its first cell', () => {
    const rec = parseCsv(pilotCsvTruncationLine(5000))[0];
    expect(rec).toHaveLength(PILOT_CSV_COLUMNS.length);
    expect(rec[0]).toBe('#truncated');
    expect(rec[1]).toContain('5000');
  });
});

describe('transcript PII scrub — no emails, phones or ids leave the system', () => {
  it.each([
    ['an email', 'contact me at nguyen.van.a@gmail.com please', 'nguyen.van.a@gmail.com'],
    ['a Vietnamese mobile', 'gọi 0901 234 567 nhé', '0901 234 567'],
    ['a Vietnamese mobile unspaced', 'sdt 0901234567', '0901234567'],
    ['an intl number', 'whatsapp +84 90 123 4567', '+84 90 123 4567'],
    ['a Korean mobile', '010-1234-5678 로 연락', '010-1234-5678'],
    ['a card number', 'thẻ 4111 1111 1111 1111', '4111 1111 1111 1111'],
    ['a long id', 'mã giao dịch 12345678901234', '12345678901234'],
    ['a 9-digit run', 'mã 123456789', '123456789'],
    ['a booking code', 'đặt phòng BK1234567 bị lỗi', 'BK1234567'],
    ['a dated code', 'mã HTL-20261013-01 chưa thanh toán', 'HTL-20261013-01'],
    ['an order ref', 'đơn #123456 chưa giao', '#123456'],
  ])('masks %s', (_label, text, secret) => {
    const out = scrubTranscriptText(text);
    expect(out).not.toContain(secret);
    expect(out).toMatch(/\[(EMAIL|PHONE|CARD|ORDER|ID)\]/);
  });

  it('drops the query string and fragment of a link (tokens, ids) but keeps the page', () => {
    const out = scrubTranscriptText('xem https://hotel.example.com/booking/view?token=abc123&guest=42#top giúp mình');
    expect(out).toContain('https://hotel.example.com/booking/view');
    expect(out).not.toContain('token');
    expect(out).not.toContain('abc123');
  });

  it('KEEPS the figures a grader needs to check an answer: rates, counts and formatted money', () => {
    const out = scrubTranscriptText('Hoa hồng 15%, giá qua đêm 480.000 ₫, phòng 12, check-in 2026-10-13, 3 khách');
    expect(out).toBe('Hoa hồng 15%, giá qua đêm 480.000 ₫, phòng 12, check-in 2026-10-13, 3 khách');
  });

  it('is idempotent (scrubbing a scrubbed text changes nothing)', () => {
    const once = scrubTranscriptText('a@b.co 0901234567 BK1234567 https://x.io/p?q=1');
    expect(scrubTranscriptText(once)).toBe(once);
  });

  it('empty text is empty', () => {
    expect(scrubTranscriptText('')).toBe('');
  });
});

describe('transcript layout and caps', () => {
  it('labels each turn and adds the machine note: the AI confidence, the system reason', () => {
    const t = buildTranscript([
      { id: 1, senderType: 'user', body: 'Hoa hồng bao nhiêu?' },
      { id: 2, senderType: 'ai', body: 'Hoa hồng là 15%.', confidence: 0.7432 },
      { id: 3, senderType: 'system', body: 'Vui lòng đăng nhập.', reason: 'guest_gate' },
      { id: 4, senderType: 'agent', body: 'Em chào anh' },
    ]);
    expect(t.split('\n')).toEqual([
      'USER: Hoa hồng bao nhiêu?',
      'AI [0.74]: Hoa hồng là 15%.',
      'SYSTEM [guest_gate]: Vui lòng đăng nhập.',
      'AGENT: Em chào anh',
    ]);
  });

  it('scrubs every turn, including the AI answers and the agent replies', () => {
    const t = buildTranscript([
      { id: 1, senderType: 'user', body: 'mail a@b.co' },
      { id: 2, senderType: 'agent', body: 'em gọi 0901234567 nhé' },
    ]);
    expect(t).not.toContain('a@b.co');
    expect(t).not.toContain('0901234567');
  });

  it('collapses a message to one line so each turn is one line of the cell', () => {
    expect(buildTranscript([{ id: 1, senderType: 'user', body: 'a\n\n  b\tc' }])).toBe('USER: a b c');
  });

  it('cuts one very long message, with an ellipsis', () => {
    const t = buildTranscript([{ id: 1, senderType: 'user', body: 'x'.repeat(TRANSCRIPT_MESSAGE_MAX_CHARS + 500) }]);
    expect(t.length).toBe('USER: '.length + TRANSCRIPT_MESSAGE_MAX_CHARS + 1);
    expect(t.endsWith('…')).toBe(true);
  });

  it('stops after the message cap and says how many were left out', () => {
    const msgs = Array.from({ length: TRANSCRIPT_MAX_MESSAGES + 30 }, (_, i) => ({ id: i, senderType: 'user', body: `m${i}` }));
    const lines = buildTranscript(msgs).split('\n');
    expect(lines).toHaveLength(TRANSCRIPT_MAX_MESSAGES + 1);
    expect(lines[lines.length - 1]).toBe('… (30 more messages not shown)');
  });

  it('never exceeds the total cap, so a cell stays under the spreadsheet limit', () => {
    const msgs = Array.from({ length: TRANSCRIPT_MAX_MESSAGES }, (_, i) => ({
      id: i, senderType: 'ai', body: 'y'.repeat(TRANSCRIPT_MESSAGE_MAX_CHARS),
    }));
    const t = buildTranscript(msgs);
    expect(t.length).toBeLessThanOrEqual(TRANSCRIPT_MAX_CHARS + 1);
    expect(t.length).toBeLessThan(32_767);
  });

  it('an unknown sender label is shown, capped, not dropped; a bad reason cannot inject text into the note', () => {
    const t = buildTranscript([{ id: 1, senderType: 'bot_x', body: 'hi' }, { id: 2, senderType: 'system', body: 'n', reason: 'a]: injected\nUSER' }]);
    expect(t).toContain('BOT_X: hi');
    expect(t).toContain('SYSTEM [ainjectedUSER]: n');
    expect(t.split('\n')).toHaveLength(2);
  });

  it('a conversation with no messages has an empty transcript', () => {
    expect(buildTranscript([])).toBe('');
  });
});
