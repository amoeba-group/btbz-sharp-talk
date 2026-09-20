import { normalizeLandingPath } from './landing-path.util';

/**
 * The column this feeds is an analytics grouping key, and it is fed by whatever
 * a storefront page happened to have in its address bar. Both facts are why the
 * query string has to go: it is the part that carries order tokens and emails,
 * and it is the part that would split one product page into a hundred rows.
 */
describe('normalizeLandingPath', () => {
  it('keeps scheme, host and path', () => {
    expect(normalizeLandingPath('https://shop.example/products/rose-serum')).toBe(
      'https://shop.example/products/rose-serum',
    );
  });

  it('drops the query string — it is where the PII rides', () => {
    expect(normalizeLandingPath('https://shop.example/orders?email=a@b.com&token=secret')).toBe(
      'https://shop.example/orders',
    );
    expect(normalizeLandingPath('https://shop.example/p?utm_source=x#frag')).toBe(
      'https://shop.example/p',
    );
  });

  it('folds the trailing slash so one page is one row', () => {
    expect(normalizeLandingPath('https://shop.example/products/x/')).toBe(
      'https://shop.example/products/x',
    );
    expect(normalizeLandingPath('https://shop.example/')).toBe('https://shop.example/');
  });

  it('keeps the port, which distinguishes real hosts', () => {
    expect(normalizeLandingPath('http://localhost:3000/a')).toBe('http://localhost:3000/a');
  });

  it('refuses anything that is not a web page', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<script>',
      'file:///etc/passwd',
      'not a url',
      '',
      '   ',
      null,
      undefined,
      42,
      {},
    ]) {
      expect(normalizeLandingPath(bad as never)).toBeNull();
    }
  });

  it('drops rather than truncates an over-long path', () => {
    // A truncated path names a page nobody visited; NULL at least says
    // "not collected" instead of inventing a row.
    const long = `https://shop.example/${'a'.repeat(300)}`;
    expect(normalizeLandingPath(long)).toBeNull();
  });
});
