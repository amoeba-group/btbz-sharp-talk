# SQL Migrations

- The first-boot schema is **`docker/init-sql/01-schema.sql`** (MySQL 8, utf8mb4/InnoDB; there is no
  `sql/01-schema.sql` any more). It is what a fresh install builds from, because `DB_SYNCHRONIZE=false`.
  Every migration in this directory must ALSO be reflected there (add the column to the matching
  `CREATE TABLE`); `npm run initsql:check` fails when `sql/artefacts.tsv` promises a table, column or
  index that file lacks (REQ-261012 D-18). Run it after `npm run migrations:manifest`.

## Dev
`synchronize=true` builds the schema automatically; then run `npm run db:seed`.
Seed inserts real bcrypt hashes (the DDL's `<BCRYPT(...)>` placeholders are illustrative).

## Staging / Production
A first install runs `docker/init-sql/01-schema.sql` by itself; an upgrade applies the new files from this directory in RELEASE order (`scripts/check-migrations.sh` lists them) BEFORE the code that needs them.
Seed admin/master via a controlled script (never commit production hashes).
