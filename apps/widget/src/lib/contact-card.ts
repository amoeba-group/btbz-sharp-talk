/**
 * Which rows of the "Contact support" card have something to show (w3c, ops-manual finding 8).
 *
 * The card's phone, e-mail and opening-hours text come from the translation bundle. The bundle used
 * to hold IVY's own placeholder values ("1588-0000", "help@ivy.com", "Mon-Fri 10:00-18:00") for
 * every language, so a Go2Joy customer was shown another company's number. The bundles now ship
 * empty strings, and a method (or an hours line) that has no value is not drawn - never an empty
 * "tel:" link and never an invented number. A host that does ship values (a translation override)
 * gets exactly the card it had before.
 *
 * Pure, no imports: the widget's node tests bundle this file on its own.
 */
export interface ContactValues {
  phone?: string | null;
  email?: string | null;
  hours?: string | null;
  emailHours?: string | null;
}

export interface ContactMethodsShown {
  phone: boolean;
  email: boolean;
  /** The opening-hours line of the phone and live-chat cards. */
  hours: boolean;
  /** The reply-time line of the e-mail card. */
  emailHours: boolean;
}

const has = (v: string | null | undefined): boolean => String(v ?? '').trim().length > 0;

export function contactMethods(v: ContactValues): ContactMethodsShown {
  return { phone: has(v.phone), email: has(v.email), hours: has(v.hours), emailHours: has(v.emailHours) };
}
