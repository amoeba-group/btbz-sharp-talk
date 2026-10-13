import 'reflect-metadata';
import helmet from 'helmet';
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { AllExceptionFilter } from './global/filter/all-exception.filter';
import { TransformInterceptor } from './global/interceptor/transform.interceptor';
import { TenantContextInterceptor } from './global/interceptor/tenant-context.interceptor';
import { LoggingInterceptor } from './global/interceptor/logging.interceptor';
import { CacheControlInterceptor } from './global/interceptor/cache-control.interceptor';
import { runSeed } from './database/seed.runner';
import { collectSecretProblems } from './global/config/assert-secrets';
import { ErrorReporterService } from './infrastructure/observability/error-reporter';

async function bootstrap(): Promise<void> {
  // rawBody: preserve the exact request bytes so webhook HMAC (Shopify) can be
  // verified against the raw payload, not a re-stringified JSON copy.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);
  const prefix = config.get<string>('API_PREFIX', 'api/v1');
  const isProd = config.get<string>('NODE_ENV') === 'production';

  // Secret hygiene (SEC-M5): in production, refuse to boot on missing / short /
  // placeholder secrets. Elsewhere, warn but continue (dev placeholders are OK).
  const secretProblems = collectSecretProblems(config, isProd);
  if (secretProblems.length) {
    const log = new Logger('SecretCheck');
    for (const p of secretProblems) log.error(p);
    if (isProd) {
      log.error('Refusing to start in production with insecure secrets. Aborting.');
      process.exit(1);
    }
    log.warn('Insecure secrets detected (allowed outside production).');
  }

  // CORS (SEC-L1): explicit allowlist via CORS_ORIGINS (comma-separated). When
  // unset, dev reflects any origin (local Vite ports vary) but prod sends no
  // CORS headers at all — the edge proxy serves web/widget/api same-origin, so
  // cross-origin browser calls are only ever needed when explicitly configured.
  const corsOrigins = (config.get<string>('CORS_ORIGINS', '') || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins.length ? corsOrigins : !isProd });

  // Security response headers (SEC-L2). CSP is disabled because the API serves
  // JSON + the Swagger UI (which uses inline assets); HSTS/nosniff/frameguard/etc.
  // still apply. CORP is set cross-origin so the storefront widget (a different
  // origin) can consume the API — CORS still governs who may call it.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // `/metrics` stays at the root (Prometheus convention); every product route is prefixed (PLN-261012 SG-83).
  app.setGlobalPrefix(prefix, { exclude: ['metrics'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  // The reporter hears about 5xx and unhandled errors only (PLN-261012 SG-83).
  app.useGlobalFilters(new AllExceptionFilter(app.get(ErrorReporterService)));
  // CacheControl (outer-most) stamps `no-store` before anything can write a
  // response; Tenant context wraps the handler in AsyncLocalStorage; Transform
  // wraps the response; Logging (inner-most) records method/path/status/duration
  // with no PII.
  app.useGlobalInterceptors(
    new CacheControlInterceptor(),
    new TenantContextInterceptor(app.get(DataSource)),
    new TransformInterceptor(),
    new LoggingInterceptor(),
  );

  // Swagger exposes the full API surface — keep it out of production (SEC-M4).
  if (!isProd) {
    const swagger = new DocumentBuilder()
      .setTitle('btbz-SharpTalk API')
      .setDescription('CHATWIDGET — NestJS + MySQL. Follows Amoeba standards.')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(`${prefix}/docs`, app, SwaggerModule.createDocument(app, swagger));
  }

  // Optional self-bootstrap for staging/managed envs (no ts-node in the image).
  if (config.get<string>('SEED_ON_BOOT') === 'true') {
    try {
      await runSeed(app.get(DataSource));
      new Logger('Bootstrap').log('SEED_ON_BOOT: seed applied.');
    } catch (e) {
      new Logger('Bootstrap').error(`SEED_ON_BOOT failed: ${(e as Error).message}`);
    }
  }

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on http://localhost:${port}/${prefix}`);
}

void bootstrap();
