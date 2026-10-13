import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { runSeed } from './seed.runner';

/** CLI entrypoint: `npm run db:seed`. Initializes the standalone DataSource then seeds. */
async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const seeded = await runSeed(AppDataSource);
    console.log('✅ Seed complete.');
    // Development keeps printing its well-known login; a generated or env-supplied
    // password is never echoed here (the generated one is logged once by runSeed).
    const shown = seeded.passwordSource === 'dev-default' ? ' / amb2026!@' : '';
    console.log(`   System Admin: ${seeded.adminEmail}${shown}`);
    console.log(`   Tenant Master (${seeded.tenantSlug}): ${seeded.masterEmail}${shown}`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
