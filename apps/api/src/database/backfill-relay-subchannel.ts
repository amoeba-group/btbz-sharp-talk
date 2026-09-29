import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { join } from 'path';
import { ChannelThread } from '../domain/messenger/entity/channel-thread.entity';
import { MessengerChannel } from '../domain/messenger/entity/messenger-channel.entity';
import { Conversation } from '../domain/chat/entity/conversation.entity';
import { Session } from '../domain/session/entity/session.entity';
import { channelField } from '../domain/messenger/messenger-secret.util';
import { extractCookieToken, subChannelFrom } from '../domain/messenger/adapter/btbz-relay.adapter';
import { envNumber } from '../global/util/env-number.util';

/**
 * One-time backfill for REQ-260826: relay threads stored as the generic
 * 'relay'.
 *
 * The adapter mapped two of the relay's eight channel types, so zalo, line,
 * wechat, viber, telegram and whatsapp rooms all landed as "some relay" — 29%
 * of traffic, and 32 stored threads whose counterpart names read "Rakuten
 * Viber" and "WeChat 사용자". Widening the map fixes new messages only: the
 * value is written at ingest, so without this those conversations stay
 * unattributed forever and every per-channel figure stays wrong by that much.
 *
 * The relay is asked what each thread actually is. Nothing is inferred from the
 * counterpart name: a room called "Rakuten Viber" is evidence, not a source of
 * truth, and guessing here would be indistinguishable from the bug.
 *
 * Three tables move together — the thread, the conversation the console badges
 * from, and the session the AI reads its channel from. Updating one would leave
 * the badge and the answer disagreeing.
 *
 * Run inside the API container:
 *   node apps/api/dist/database/backfill-relay-subchannel.js [--dry-run] [--limit=N]
 */
const RELAY_PROVIDER = 'btbz_relay';
const PAGE_LIMIT = 100;
const MAX_PAGES = 40;

interface RelayConversation {
  id?: string | number;
  channel_type?: string;
}

async function login(baseUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`relay login failed: HTTP ${res.status}`);
  const token = extractCookieToken(res.headers.get('set-cookie'));
  if (!token) throw new Error('relay login returned no ksr_token cookie');
  return token;
}

/** external_thread_id → channel_type, read from the relay's own listing. */
async function loadChannelTypes(baseUrl: string, token: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(
      `${baseUrl}/api/inbox/conversations?limit=${PAGE_LIMIT}&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`relay conversations failed: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: RelayConversation[] };
    const rows = body.data ?? [];
    if (!rows.length) break;
    for (const row of rows) {
      if (row.id == null || !row.channel_type) continue;
      map.set(String(row.id), row.channel_type);
    }
    if (rows.length < PAGE_LIMIT) break;
  }
  return map;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Number.POSITIVE_INFINITY;

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

  const threadRepo = ds.getRepository(ChannelThread);
  const channelRepo = ds.getRepository(MessengerChannel);
  const convRepo = ds.getRepository(Conversation);
  const sessionRepo = ds.getRepository(Session);

  let updated = 0;
  let unknown = 0;
  let missing = 0;
  let scanned = 0;

  try {
    const channels = await channelRepo.find({ where: { provider: RELAY_PROVIDER } });
    for (const channel of channels) {
      const stale = await threadRepo.find({
        where: { channelId: Number(channel.id), subChannel: 'relay' },
        order: { id: 'ASC' },
      });
      if (!stale.length) {
        console.log(`channel ${channel.id}: nothing to backfill`);
        continue;
      }

      const baseUrl = (channelField(channel, 'base_url') || 'https://messenger.amoeba.site')
        .trim()
        .replace(/\/+$/, '');
      const email = channelField(channel, 'email');
      const password = channelField(channel, 'password', { secret: true });
      if (!email || !password) {
        console.warn(`channel ${channel.id}: no credentials — ${stale.length} thread(s) skipped`);
        missing += stale.length;
        continue;
      }

      const token = await login(baseUrl, email, password);
      const types = await loadChannelTypes(baseUrl, token);
      console.log(
        `channel ${channel.id}: ${stale.length} thread(s) to check, ` +
          `relay knows ${types.size} conversation(s)`,
      );

      for (const thread of stale) {
        if (scanned >= limit) break;
        scanned++;
        const channelType = types.get(String(thread.externalThreadId));
        if (!channelType) {
          // The relay no longer lists it. Left as 'relay': a thread we cannot
          // ask about is exactly the case where guessing would be wrong.
          missing++;
          continue;
        }
        const resolved = subChannelFrom(channelType);
        if (resolved === 'relay') {
          console.warn(
            `thread ${thread.id}: relay says '${channelType}', still unmapped — left as 'relay'`,
          );
          unknown++;
          continue;
        }

        // Printed before the write so a bad run can be reversed from the log.
        console.log(
          `${dryRun ? '[dry-run] ' : ''}thread ${thread.id} (relay conv ${thread.externalThreadId}): ` +
            `relay → ${resolved} · conversation ${thread.conversationId ?? '-'} · session ${thread.sessionId ?? '-'}`,
        );
        if (dryRun) {
          updated++;
          continue;
        }

        await threadRepo.update({ id: Number(thread.id) }, { subChannel: resolved });
        if (thread.conversationId) {
          await convRepo.update({ id: Number(thread.conversationId) }, { channel: resolved });
        }
        if (thread.sessionId) {
          await sessionRepo.update({ id: Number(thread.sessionId) }, { channel: resolved });
        }
        updated++;
      }
    }

    console.log(
      `\n${dryRun ? '[dry-run] ' : ''}done — scanned ${scanned}, updated ${updated}, ` +
        `still unmapped ${unknown}, not listed by the relay ${missing}`,
    );
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('relay sub-channel backfill failed:', err);
  process.exit(1);
});
