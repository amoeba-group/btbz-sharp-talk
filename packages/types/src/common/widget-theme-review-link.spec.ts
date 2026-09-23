import { normalizeDesign, normalizeReviewLinkTemplate, reviewLinkFor } from './widget-theme';

/** Review chip link template (PLN-260923 P3). */
describe('normalizeReviewLinkTemplate', () => {
  it('keeps a template that leads with the product URL (review-app anchor)', () => {
    expect(normalizeReviewLinkTemplate(' {productUrl}#judgeme_product_reviews ')).toBe(
      '{productUrl}#judgeme_product_reviews',
    );
  });

  it('keeps an absolute http(s) template carrying the token', () => {
    expect(normalizeReviewLinkTemplate('https://reviews.example/write?p={productUrl}')).toBe(
      'https://reviews.example/write?p={productUrl}',
    );
  });

  it('drops the bare token, missing token, other schemes and oversize input', () => {
    expect(normalizeReviewLinkTemplate('{productUrl}')).toBeNull();
    expect(normalizeReviewLinkTemplate('https://reviews.example/write')).toBeNull();
    expect(normalizeReviewLinkTemplate('javascript:alert({productUrl})')).toBeNull();
    expect(normalizeReviewLinkTemplate(`{productUrl}#${'a'.repeat(600)}`)).toBeNull();
    expect(normalizeReviewLinkTemplate(42)).toBeNull();
  });

  it('survives normalizeDesign and a bad value does not cost the rest', () => {
    expect(normalizeDesign({ radius: 'lg', reviewLinkTemplate: '{productUrl}#reviews' })).toEqual({
      radius: 'lg',
      reviewLinkTemplate: '{productUrl}#reviews',
    });
    expect(normalizeDesign({ radius: 'lg', reviewLinkTemplate: 'nope' })).toEqual({ radius: 'lg' });
  });
});

describe('reviewLinkFor', () => {
  const url = 'https://ivy.example/products/rose-hip?variant=1';

  it('is the product page when no template is set', () => {
    expect(reviewLinkFor(null, url)).toBe(url);
  });

  it('appends a leading-token template verbatim', () => {
    expect(reviewLinkFor('{productUrl}#reviews', url)).toBe(`${url}#reviews`);
  });

  it('URL-encodes the product URL inside an absolute template', () => {
    expect(reviewLinkFor('https://r.example/w?p={productUrl}', url)).toBe(
      `https://r.example/w?p=${encodeURIComponent(url)}`,
    );
  });

  it('is null without a usable product URL — the widget falls back to its own form', () => {
    expect(reviewLinkFor('{productUrl}#reviews', null)).toBeNull();
    expect(reviewLinkFor(null, 'javascript:alert(1)')).toBeNull();
  });
});
