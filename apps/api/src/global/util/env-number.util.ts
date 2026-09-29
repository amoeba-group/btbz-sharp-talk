/**
 * A numeric setting from the environment, falling back when it is absent,
 * blank or not a number (FIX-260930-Env-Blank-Numbers).
 *
 * `Number(process.env.X ?? d)` was the pattern everywhere, and `??` only
 * catches `undefined`. The deploy templates ship keys with empty values
 * (`RAG_MIN_SIMILARITY=`), docker passes them through as `''`, and
 * `Number('')` is 0 — so production ran with a similarity floor of 0 (the
 * "don't know → hand off" path could never fire) and an answer-reuse
 * threshold of 0, while staging, which happened to set the values, looked
 * fine. A blank line in an env file means "not configured", never zero.
 */
export function envNumber(name: string, fallback: number | string): number {
  const raw = process.env[name];
  const fb = Number(fallback);
  if (raw === undefined || raw.trim() === '') return fb;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fb;
}
