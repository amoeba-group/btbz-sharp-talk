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

/**
 * A group member's label (PLN-261023 S3): the name and number the conversation
 * list shows for the same thread — "customer / company · Session 887", where
 * 887 is the member's open (else latest) conversation, not its session id.
 */
export function groupMemberLabel(
  m: {
    alias?: string | null;
    customerName?: string | null;
    companyName?: string | null;
    identityName?: string | null;
    identityHotelName?: string | null;
    sessionId: string;
    targetConversationId?: string | null;
  },
  numberLabel: (id: string) => string,
): string {
  const name = m.alias || sessionTitle(m.customerName || m.identityName, m.companyName || m.identityHotelName);
  const number = numberLabel(m.targetConversationId ?? m.sessionId);
  return name ? `${name} · ${number}` : number;
}
