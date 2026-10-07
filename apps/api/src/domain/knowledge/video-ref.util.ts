/**
 * The video a KB document explains (PLN-261006-KB-Video-Links): `https://…`,
 * played as is, or `notion:<32 hex block id>` for a file uploaded to Notion.
 */
export const VIDEO_REF_PATTERN = /^(https:\/\/\S+|notion:[0-9a-f]{32})$/i;

export type VideoRef = { kind: 'url'; url: string } | { kind: 'notion'; blockId: string };

export function parseVideoRef(ref: string | null | undefined): VideoRef | null {
  const v = (ref ?? '').trim();
  if (!VIDEO_REF_PATTERN.test(v)) return null;
  return v.toLowerCase().startsWith('notion:')
    ? { kind: 'notion', blockId: v.slice('notion:'.length).toLowerCase() }
    : { kind: 'url', url: v };
}

/**
 * The link a customer clicks — a path on our API, signed per tenant and
 * document. Clients resolve it against their API origin like attachments.
 */
export function kbVideoPath(docId: number, tenantId: number, sig: string): string {
  return `/api/v1/kb-videos/${docId}?t=${tenantId}&sig=${sig}`;
}
