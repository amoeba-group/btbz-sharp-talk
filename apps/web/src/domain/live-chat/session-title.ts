/**
 * A live-chat session's title: "customer / company" (PLN-261023), so an agent
 * sees which registered customer and which hotel a session belongs to. Either
 * half alone when only one is known; null when neither is — the caller then
 * falls back to its own label (e-mail, "Session ab12cd").
 */
export function sessionTitle(person: string | null | undefined, company: string | null | undefined): string | null {
  const p = person?.trim() || null;
  const c = company?.trim() || null;
  if (p && c) return `${p} / ${c}`;
  return p ?? c;
}
