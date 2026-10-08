/** One utterance handed to the model as evidence. */
export interface SampleUtterance {
  at: string;
  who: string;
  text: string;
}

/** Appended to a sample cut at `quote_max_chars` (REQ-261008 F2). */
export const TRUNCATION_MARK = '…';

/** Cut to `max` characters, marking the cut so nobody reads it as the whole message. */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}${TRUNCATION_MARK}` : text;
}
