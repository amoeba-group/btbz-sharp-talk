import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';
import { envNumber } from '../global/util/env-number.util';

loadEnv({ path: join(__dirname, '../../../../env/backend/.env.development') });

/**
 * Standalone DataSource for seeding / CLI migrations. Globs all *.entity files so
 * it stays in sync with the domain modules.
 */
export const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: envNumber('DB_PORT', 3306),
  username: process.env.DB_USER ?? 'sharptalk',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'db_sharptalk',
  charset: 'utf8mb4',
  timezone: 'Z',
  synchronize: true, // seed bootstraps schema in dev
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
});
