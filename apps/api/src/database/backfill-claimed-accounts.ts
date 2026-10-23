import 'reflect-metadata';
import { DataSource, In, IsNull } from 'typeorm';
import { join } from 'path';
import { Session } from '../domain/session/entity/session.entity';
import { Conversation } from '../domain/chat/entity/conversation.entity';
import { Customer } from '../domain/customer/entity/customer.entity';
import { Company } from '../domain/company/entity/company.entity';
import { CompanyContact } from '../domain/company/entity/company-contact.entity';
import { claimedUserId, unsignedIdentifyAllowed } from '../domain/embed/unsigned-identify';
import { envNumber } from '../global/util/env-number.util';

/**
 * One-time backfill for PLN-261023 S4: conversations of CLAIMED (unsigned)
 * host sign-ins made before the identify started filing them.
 *
 * Applies the same rule as `EmbedService.registerClaimedAccount` to every
 * claimed session of a tenant on the unsigned list
 * (EMBED_UNSIGNED_IDENTIFY_TENANT_IDS — staging only): a customer row for the
 * claimed user id (created with the claimed name, an existing row is never
 * changed), a contact link to the hotel's EXISTING company (none is created),
 * and the session's conversations that have no customer yet filed under both.
 * Sessions are not touched. Goes through TypeORM, not SQL, because customer
 * names are encrypted at rest.
 *
 * Run inside the API container:
 *   node apps/api/dist/database/backfill-claimed-accounts.js [--dry-run]
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const tenantIds = String(process.env.EMBED_UNSIGNED_IDENTIFY_TENANT_IDS ?? '')
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && unsignedIdentifyAllowed(n));
  if (!tenantIds.length) {
    console.log('no tenant on EMBED_UNSIGNED_IDENTIFY_TENANT_IDS — nothing to do');
    return;
  }

  const ds = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: envNumber('DB_PORT', 3306),
    username: process.env.DB_USER ?? 'sharptalk',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'db_sharptalk',
    charset: 'utf8mb4',
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    synchronize: false,
  });
  await ds.initialize();
  const sessions = ds.getRepository(Session);
  const convs = ds.getRepository(Conversation);
  const customers = ds.getRepository(Customer);
  const companies = ds.getRepository(Company);
  const contacts = ds.getRepository(CompanyContact);

  let filed = 0;
  try {
    const claimed = await sessions.find({ where: { tenantId: In(tenantIds), identityLevel: 'claimed' } });
    for (const session of claimed) {
      const userId = claimedUserId(session as never);
      if (!userId) continue;
      const tenantId = Number(session.tenantId);
      const open = await convs.find({ where: { sessionId: session.id, customerId: IsNull() } });
      if (!open.length) continue;

      let customer = await customers.findOne({ where: { tenantId, externalCustomerId: userId } });
      const created = !customer;
      const hotelId = session.identityAttributes?.hotel_id?.trim();
      const company =
        hotelId && /^\d{1,10}$/.test(hotelId)
          ? await companies.findOne({ where: { tenantId, externalKey: `hotel:${hotelId}` } })
          : null;
      console.log(
        `${dryRun ? '[dry-run] ' : ''}session ${session.id} (tenant ${tenantId}): conversations ${open
          .map((c) => c.id)
          .join(',')} → customer ${customer ? customer.id : '(new)'} company ${company?.id ?? '-'}`,
      );
      if (dryRun) {
        filed += open.length;
        continue;
      }
      if (!customer) {
        customer = await customers.save(
          customers.create({
            tenantId,
            externalCustomerId: userId,
            tier: 'guest',
            name: session.identityAttributes?.name?.trim() || null,
            email: null,
            phone: null,
            ...(company ? { customerType: 'b2b_contact' } : {}),
          }),
        );
      }
      if (company) {
        const link = await contacts.findOne({ where: { companyId: Number(company.id), customerId: Number(customer.id) } });
        if (!link) {
          await contacts.save(
            contacts.create({
              tenantId,
              companyId: Number(company.id),
              customerId: Number(customer.id),
              role: session.identityAttributes?.role ?? null,
              lastSeenAt: new Date(),
            }),
          );
        }
      }
      const res = await convs.update(
        { id: In(open.map((c) => Number(c.id))), customerId: IsNull() },
        { customerId: Number(customer.id), companyId: company ? Number(company.id) : null },
      );
      filed += res.affected ?? 0;
      if (created) console.log(`  created customer ${customer.id}`);
    }
    console.log(`\n${dryRun ? '[dry-run] ' : ''}done — ${filed} conversation(s) filed`);
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
