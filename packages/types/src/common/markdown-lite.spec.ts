import { parseInline, parseLiteMarkdown, stripLiteMarkdown } from './markdown-lite';

/** PLN-261008-Chat-Markdown-Render — what AI replies actually use. */
describe('parseInline', () => {
  it('bold, italic, code, link', () => {
    expect(parseInline('**Số tài khoản:** 1913')).toEqual([
      { t: 'strong', c: [{ t: 'text', v: 'Số tài khoản:' }] },
      { t: 'text', v: ' 1913' },
    ]);
    expect(parseInline('Vào `Quản lý đặt phòng` nhé')).toEqual([
      { t: 'text', v: 'Vào ' },
      { t: 'code', v: 'Quản lý đặt phòng' },
      { t: 'text', v: ' nhé' },
    ]);
    expect(parseInline('a *b* c')[1]).toEqual({ t: 'em', c: [{ t: 'text', v: 'b' }] });
    expect(parseInline('__x__')[0]).toEqual({ t: 'strong', c: [{ t: 'text', v: 'x' }] });
  });

  it('nests inside bold and keeps code literal', () => {
    expect(parseInline('**see `a*b*c`**')).toEqual([
      { t: 'strong', c: [{ t: 'text', v: 'see ' }, { t: 'code', v: 'a*b*c' }] },
    ]);
  });

  it('links http(s) URLs and gives trailing punctuation back as text', () => {
    expect(parseInline('Form: https://bit.ly/3YZ8egt.')).toEqual([
      { t: 'text', v: 'Form: ' },
      { t: 'link', href: 'https://bit.ly/3YZ8egt', v: 'https://bit.ly/3YZ8egt' },
      { t: 'text', v: '.' },
    ]);
    expect(parseInline('javascript:alert(1)')).toEqual([{ t: 'text', v: 'javascript:alert(1)' }]);
  });

  it('leaves look-alikes as text', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ t: 'text', v: '2 * 3 * 4' }]);
    expect(parseInline('file_name_v2')).toEqual([{ t: 'text', v: 'file_name_v2' }]);
    expect(parseInline('**unclosed bold')).toEqual([{ t: 'text', v: '**unclosed bold' }]);
    expect(parseInline('<script>alert(1)</script>')).toEqual([{ t: 'text', v: '<script>alert(1)</script>' }]);
  });
});

describe('parseLiteMarkdown', () => {
  it('splits paragraphs on blank lines and keeps line breaks', () => {
    const b = parseLiteMarkdown('Kính chào,\nQuý khách.\n\nĐoạn hai');
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({ t: 'p', lines: [[{ v: 'Kính chào,' }], [{ v: 'Quý khách.' }]] });
  });

  it('reads bullet and numbered lists, one level of nesting', () => {
    const b = parseLiteMarkdown('1. Đăng xuất\n   - Bước con\n2. Liên hệ\n\n- **Email:** a@b.vn\n• Hotline');
    expect(b[0]).toMatchObject({ t: 'list', ordered: true, start: 1 });
    const ol = b[0] as { items: Array<{ children?: { items: unknown[] } }> };
    expect(ol.items).toHaveLength(2);
    expect(ol.items[0].children?.items).toHaveLength(1);
    expect(b[1]).toMatchObject({ t: 'list', ordered: false });
    expect((b[1] as { items: unknown[] }).items).toHaveLength(2);
  });

  it('a bold-wrapped "**1. Step:**" is a paragraph, not a list', () => {
    expect(parseLiteMarkdown('**1. Đăng xuất:**')[0].t).toBe('p');
  });

  it('keeps an ordered list starting number', () => {
    expect(parseLiteMarkdown('3. ba\n4. bốn')[0]).toMatchObject({ start: 3 });
  });
});

describe('stripLiteMarkdown', () => {
  it('removes markers and keeps structure for plain channels', () => {
    expect(stripLiteMarkdown('Liên hệ:\n- **Email:** support@go2joy.vn\n- **Hotline:** 1900 638 838')).toBe(
      'Liên hệ:\n\n• Email: support@go2joy.vn\n• Hotline: 1900 638 838',
    );
    expect(stripLiteMarkdown('1. `Quản lý đặt phòng`\n   - con')).toBe('1. Quản lý đặt phòng\n  • con');
  });

  it('is a no-op for plain text', () => {
    expect(stripLiteMarkdown('Xin chào')).toBe('Xin chào');
  });
});
