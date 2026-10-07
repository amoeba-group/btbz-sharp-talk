import type { INestApplicationContext } from '@nestjs/common';

/**
 * End a CLI that booted the full app context (FIX-261007-CLI-Exit-Stale-Runs).
 *
 * The context starts every module's timers (sync schedulers, sweeps), and
 * those keep the event loop alive: `kb:reindex` printed "complete" and then
 * never returned (found while re-embedding go2joy's FAQ, 2026-10-07). Close
 * gracefully, but give up after a few seconds, then exit with the code.
 */
export async function closeAndExit(app: INestApplicationContext, code = process.exitCode ?? 0): Promise<never> {
  await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
  process.exit(typeof code === 'number' ? code : 0);
}
