/**
 * True inside a one-off CLI that boots the full app context (kb:reindex,
 * golden:gate …). Set by the CLI entrypoints before NestFactory runs.
 *
 * Booting the context starts every module's schedulers, so a CLI used to run
 * a second copy of each next to the live API — commerce syncs, but also the
 * messenger outbox and idle-conversation sweeps, which send messages
 * (FIX-261007 known limit, PLN-261008 D2). Schedulers return early here.
 */
export const CLI_CONTEXT_ENV = 'SHARPTALK_CLI';

export function isCliContext(): boolean {
  return process.env[CLI_CONTEXT_ENV] === '1';
}
