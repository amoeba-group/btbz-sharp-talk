import 'reflect-metadata';
import { DataSource, Repository } from 'typeorm';
import { join } from 'path';
import { Message } from '../domain/chat/entity/message.entity';
import { Conversation } from '../domain/chat/entity/conversation.entity';
import { MessageAttachment } from '../domain/attachment/entity/message-attachment.entity';
import { AttachmentService } from '../domain/attachment/attachment.service';
import { ImageDecodeService } from '../domain/attachment/image-decode.service';
import { parseDataUri, extensionForMime } from '../domain/messenger/adapter/data-uri.util';
import type { ConfigService } from '@nestjs/config';
import { envNumber } from '../global/util/env-number.util';

/**
 * One-time backfill for FIX-260817: messages whose whole body is a `data:` URI.
 *
 * Before the relay adapter learned to split them, every KakaoTalk photo was
 * stored as ~50KB of base64 in `messages.body`. Two consequences the console
 * shows: the agent sees a wall of text instead of the photo, and the message
 * list ships those 50KB per turn on every open.
 *
 * Each row becomes a real attachment — the same `store()` a live upload takes,
 * so the file gets a thumbnail, EXIF stripping and a signed URL — and the body
 * is emptied. Idempotent: a message that already has an attachment only has its
 * body cleared, and a body that no longer parses is skipped.
 *
 * Deliberately NOT built on AppModule: booting it would start every scheduler
 * in this process — a second relay poller, the outbox worker, the idle sweep —
 * beside the ones the API container is already running. A migration should
 * touch the database and nothing else. It also avoids `AppDataSource`, whose
 * `synchronize: true` has no business running against staging.
 *
 * Run inside the API container:
 *   node apps/api/dist/database/migrate-data-uri-attachments.js [--dry-run] [--limit=N]
 */
const BATCH = 25;

/** AttachmentService only ever reads env-backed settings through `get`. */
const envConfig = {
  get: <T>(key: string, fallback?: T): T => (process.env[key] as unknown as T) ?? (fallback as T),
} as unknown as ConfigService;

interface Stats {
  scanned: number;
  converted: number;
  skipped: number;
  failed: number;
  bytesFreed: number;
}

async function convertOne(
  row: Message,
  deps: {
    attachments: AttachmentService;
    messageRepo: Repository<Message>;
    conversationRepo: Repository<Conversation>;
    dryRun: boolean;
  },
  stats: Stats,
): Promise<void> {
  const { attachments, messageRepo, conversationRepo, dryRun } = deps;
  const body = (row.body ?? '').trim();
  const parsed = parseDataUri(body);
  if (!parsed) {
    stats.skipped++;
    return;
  }

  // A previous run may have stored the file and then failed before clearing the
  // body. Finish that run rather than giving the message a second copy.
  const already = await attachments.findByMessageIds([Number(row.id)]);
  if (already.get(String(row.id))?.length) {
    if (!dryRun) await messageRepo.update({ id: Number(row.id) }, { body: '' });
    console.log(`message ${row.id}: already had an attachment — body cleared only`);
    stats.skipped++;
    return;
  }

  const conversation = await conversationRepo.findOne({
    where: { id: Number(row.conversationId) },
  });
  if (!conversation) {
    console.warn(`message ${row.id}: conversation ${row.conversationId} is gone — skipped`);
    stats.skipped++;
    return;
  }

  const filename = `photo-${row.id}.${extensionForMime(parsed.mime)}`;
  if (dryRun) {
    console.log(
      `[dry-run] message ${row.id} (conv ${row.conversationId}): ` +
        `${parsed.mime}, ${(parsed.data.length / 1024).toFixed(0)}KB → ${filename}`,
    );
    stats.converted++;
    stats.bytesFreed += body.length;
    return;
  }

  try {
    const saved = await attachments.store(
      {
        originalname: filename,
        mimetype: parsed.mime,
        size: parsed.data.length,
        buffer: parsed.data,
      },
      {
        tenantId: Number(conversation.tenantId),
        conversationId: Number(row.conversationId),
        sessionId: null,
        uploaderType: 'user',
        uploaderId: null,
        source: 'btbz_relay',
      },
    );
    const claimed = await attachments.attachToMessage([saved.uuid], {
      tenantId: Number(conversation.tenantId),
      messageId: Number(row.id),
      conversationId: Number(row.conversationId),
    });
    if (!claimed.length) {
      // Stored but bound to nothing: remove it rather than leaving bytes on
      // disk that no message will ever point at.
      await attachments.deleteByIds([Number(saved.id)]);
      throw new Error('attachment could not be bound to the message');
    }
    // The bytes now live on disk; leaving the base64 in the body would keep
    // shipping it to the console on every conversation open.
    await messageRepo.update({ id: Number(row.id) }, { body: '' });
    stats.bytesFreed += body.length;
    stats.converted++;
  } catch (e) {
    // A photo we cannot decode keeps its body: losing the evidence would be
    // worse than the wall of base64 it currently shows.
    console.warn(`message ${row.id}: ${(e as Error).message} — left as-is`);
    stats.failed++;
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const rawLimit = limitArg?.slice('--limit='.length);
  // `--limit=abc` would be NaN, every comparison against it false, and the
  // operator who asked for a careful ten rows would get the whole table.
  if (rawLimit !== undefined && !/^[1-9]\d*$/.test(rawLimit)) {
    throw new Error(`--limit must be a positive integer, got '${rawLimit}'`);
  }
  const limit = rawLimit === undefined ? Infinity : Number(rawLimit);

  const ds = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: envNumber('DB_PORT', 3306),
    username: process.env.DB_USER ?? 'sharptalk',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'db_sharptalk',
    charset: 'utf8mb4',
    timezone: 'Z',
    // Never let a data migration reshape the schema.
    synchronize: false,
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  });
  await ds.initialize();

  const decoder = new ImageDecodeService(envConfig);
  const attachments = new AttachmentService(
    ds.getRepository(MessageAttachment),
    envConfig,
    decoder,
  );
  const deps = {
    attachments,
    messageRepo: ds.getRepository(Message),
    conversationRepo: ds.getRepository(Conversation),
    dryRun,
  };

  const stats: Stats = { scanned: 0, converted: 0, skipped: 0, failed: 0, bytesFreed: 0 };
  let lastId = 0;

  try {
    for (;;) {
      if (stats.scanned >= limit) break;
      const rows = await deps.messageRepo
        .createQueryBuilder('m')
        .where('m.id > :lastId', { lastId })
        .andWhere('m.body LIKE :prefix', { prefix: 'data:%' })
        .orderBy('m.id', 'ASC')
        .take(BATCH)
        .getMany();
      if (!rows.length) break;

      for (const row of rows) {
        lastId = Number(row.id);
        if (stats.scanned >= limit) break;
        stats.scanned++;
        await convertOne(row, deps, stats);
      }

      console.log(
        `… scanned ${stats.scanned}, converted ${stats.converted}, ` +
          `skipped ${stats.skipped}, failed ${stats.failed}`,
      );
    }

    console.log(
      `\n${dryRun ? '[dry-run] ' : ''}done — scanned ${stats.scanned}, converted ${stats.converted}, ` +
        `skipped ${stats.skipped}, failed ${stats.failed}, ` +
        `${(stats.bytesFreed / 1024 / 1024).toFixed(1)}MB of base64 removed from message bodies`,
    );
  } finally {
    await decoder.onModuleDestroy();
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('data-uri backfill failed:', err);
  process.exit(1);
});
