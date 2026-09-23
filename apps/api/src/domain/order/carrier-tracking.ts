/**
 * Carrier name + tracking number → the carrier's own tracking page
 * (PLN-260923 P2).
 *
 * Used only when the platform did not hand us a `tracking_url` itself — for
 * rows cached before we stored it, and for carriers Shopify has no link for.
 *
 * Matching is on the WHOLE normalized name, never a substring. `includes('ups')`
 * would claim "Pups Express" and "UPS Mail Innovations" (which hands off to the
 * postal service and is tracked elsewhere) — the same trap that once read
 * "Unfulfilled" as fulfilled. An unknown name returns null and the widget keeps
 * its inline stepper; a wrong link is worse than no link.
 */

/** `{n}` is replaced with the URL-encoded tracking number. */
const TEMPLATES: Record<string, string> = {
  ups: 'https://www.ups.com/track?tracknum={n}',
  usps: 'https://tools.usps.com/go/TrackConfirmAction?tLabels={n}',
  fedex: 'https://www.fedex.com/fedextrack/?trknbr={n}',
  dhl: 'https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id={n}',
  dhlecommerce: 'https://webtrack.dhlecs.com/?trackingnumber={n}',
  amazonlogistics: 'https://track.amazon.com/tracking/{n}',
  anpost: 'https://www.anpost.com/Post-Parcels/Track/History?item={n}',
  canadapost: 'https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor={n}',
  royalmail: 'https://www.royalmail.com/track-your-item#/tracking-results/{n}',
  australiapost: 'https://auspost.com.au/mypost/track/#/details/{n}',
  japanpost: 'https://trackings.post.japanpost.jp/services/srv/search/?requestNo1={n}&locale=en',
  ontrac: 'https://www.ontrac.com/tracking/?number={n}',
  purolator: 'https://www.purolator.com/en/shipping/tracker?pin={n}',
  cjlogistics: 'https://trace.cjlogistics.com/next/tracking.html?wblNo={n}',
};

/** Other spellings platforms use for the same carrier, already normalized. */
const ALIASES: Record<string, keyof typeof TEMPLATES> = {
  unitedstatespostalservice: 'usps',
  federalexpress: 'fedex',
  dhlexpress: 'dhl',
  dhlecommerceasia: 'dhlecommerce',
  amazon: 'amazonlogistics',
  amazonlogisticsus: 'amazonlogistics',
  auspost: 'australiapost',
  cj대한통운: 'cjlogistics',
  cjkoreaexpress: 'cjlogistics',
};

/** Lowercase, keep letters/digits only ("DHL eCommerce" → "dhlecommerce"). */
export function normalizeCarrier(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Tracking page for a known carrier, or null. */
export function carrierTrackingUrl(
  carrier: string | null | undefined,
  trackingNumber: string | null | undefined,
): string | null {
  const number = trackingNumber?.trim();
  if (!carrier || !number) return null;
  const key = normalizeCarrier(carrier);
  const template = TEMPLATES[key] ?? TEMPLATES[ALIASES[key] ?? ''];
  return template ? template.replace('{n}', encodeURIComponent(number)) : null;
}

/**
 * A platform-supplied URL we are willing to put behind a button: absolute
 * http(s) only. Anything else (javascript:, data:, relative) is dropped rather
 * than stored — the widget opens it in a new window without further checks.
 */
export function safeTrackingUrl(url: string | null | undefined): string | null {
  const raw = url?.trim();
  if (!raw || raw.length > 1024) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}
