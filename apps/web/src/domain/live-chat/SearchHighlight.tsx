/**
 * Marks every occurrence of `term` in `text` (PLN-261023 S1). Matching ignores
 * case and accents, like the database collation that found the row — "hoan"
 * marks "hoàn" — so the mark lands where the server matched.
 */
export function SearchHighlight({ text, term }: { text: string; term: string }) {
  const needle = fold(term.trim());
  if (!needle) return <>{text}</>;
  const hay = fold(text);
  const parts: Array<{ text: string; hit: boolean }> = [];
  let from = 0;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) {
    if (at > from) parts.push({ text: text.slice(from, at), hit: false });
    parts.push({ text: text.slice(at, at + needle.length), hit: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false });
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-amber-100 px-0.5 text-gray-900">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** Lower-case, accents dropped, one output unit per input unit (positions stay aligned). */
function fold(value: string): string {
  let out = '';
  for (const unit of value.split('')) {
    const base = unit.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    out += base.length === 1 ? base : unit;
  }
  return out;
}
