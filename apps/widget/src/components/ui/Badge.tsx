import type { ReactNode } from 'react';

/**
 * Status pills (PLN-260817, frames 34/49/57/64).
 *
 * The Master Shots use SOLID fills with white text, not the tinted /10
 * backgrounds this component used to carry — a status is meant to be the loudest
 * thing on the row after the order number.
 */
const tones: Record<string, string> = {
  default: 'bg-gray-100 text-gray-600',
  /** Finished and no longer actionable — deliberately quiet (frame 49). */
  neutral: 'bg-gray-500 text-white',
  success: 'bg-success text-white',
  warning: 'bg-warning text-white',
  error: 'bg-error text-white',
  info: 'bg-info text-white',
  review: 'bg-review text-white',
  primary: 'bg-primary-500 text-on-primary',
};

export function Badge({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: keyof typeof tones | string;
}) {
  const cls = tones[tone] ?? tones.default;
  return (
    <span
      className={`inline-flex items-center rounded-st-sm px-2 py-0.5 text-xs font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}

/**
 * Maps an arbitrary status string to a tone heuristically.
 *
 * Order matters. "Delivered" and "Confirmed" both used to resolve to green,
 * but the design separates them: a confirmed order is good news (green), a
 * delivered one is done business (gray). Test the terminal states first so
 * "delivered" cannot be captured by the success branch.
 */
export function toneForStatus(status?: string | null): string {
  const s = (status ?? '').toLowerCase();
  if (/(cancel|refund|fail|reject|error)/.test(s)) return 'error';
  if (/(deliver|complete|closed|done)/.test(s)) return 'neutral';
  if (/review/.test(s)) return 'review';
  if (/(ship|transit|process)/.test(s)) return 'warning';
  if (/(paid|approv|confirm|success)/.test(s)) return 'success';
  if (/(hold|wait|prepar|pending)/.test(s)) return 'default';
  return 'default';
}
