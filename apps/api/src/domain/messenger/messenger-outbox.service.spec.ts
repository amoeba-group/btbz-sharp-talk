import { Repository } from 'typeorm';
import { MessengerOutboxService } from './messenger-outbox.service';
import { MessengerChannel } from './entity/messenger-channel.entity';
import { ChannelThread } from './entity/channel-thread.entity';
import { ChannelMessageMap } from './entity/channel-message-map.entity';
import { ChannelOutbox } from './entity/channel-outbox.entity';
import { Message } from '../chat/entity/message.entity';
import { AdapterRegistry } from './adapter/adapter.registry';
import { MessengerAdapter } from './adapter/messenger-adapter';

/**
 * Outbound relay (PLN-260810 §4.1/§4.2): what gets queued, what never does,
 * and how a failure is recorded instead of being lost.
 */
describe('MessengerOutboxService', () => {
  const OLD = process.env;
  beforeAll(() => {
    process.env = { ...OLD, CRED_ENC_KEY: Buffer.alloc(32, 3).toString('base64') };
  });
  afterAll(() => {
    process.env = OLD;
  });

  function build(opts: {
    thread?: Partial<ChannelThread> | null;
    channel?: Partial<MessengerChannel> | null;
    messages?: Array<Partial<Message>>;
    outboxRows?: Array<Partial<ChannelOutbox>>;
    inboundOriginIds?: number[];
    outboundSent?: number[];
    send?: MessengerAdapter['send'];
    confirm?: MessengerAdapter['confirm'];
  }) {
    const thread = {
      id: 55,
      tenantId: 1,
      channelId: 10,
      conversationId: 300,
      externalThreadId: 'chat-1',
      replyEnabled: 1,
      outboundCursor: 0,
      ...opts.thread,
    } as ChannelThread;

    const threadUpdates: Array<Partial<ChannelThread>> = [];
    const threadRepo = {
      findOne: jest.fn(async () => (opts.thread === null ? null : thread)),
      update: jest.fn(async (_w: unknown, patch: Partial<ChannelThread>) => {
        threadUpdates.push(patch);
        return { affected: 1 };
      }),
      createQueryBuilder: jest.fn(),
    } as unknown as Repository<ChannelThread>;

    const savedOutbox: Partial<ChannelOutbox>[] = [];
    const outboxUpdates: Array<Partial<ChannelOutbox>> = [];
    const outboxRepo = {
      create: (o: Partial<ChannelOutbox>) => o as ChannelOutbox,
      save: jest.fn(async (o: ChannelOutbox) => {
        savedOutbox.push(o);
        return o;
      }),
      find: jest.fn(async () => (opts.outboxRows ?? []) as ChannelOutbox[]),
      update: jest.fn(async (_w: unknown, patch: Partial<ChannelOutbox>) => {
        outboxUpdates.push(patch);
        return { affected: 1 };
      }),
    } as unknown as Repository<ChannelOutbox>;

    const savedMaps: Partial<ChannelMessageMap>[] = [];
    const mapRepo = {
      findOne: jest.fn(async (q: { where?: { messageId?: number; direction?: string } }) => {
        const id = Number(q?.where?.messageId);
        const dir = q?.where?.direction;
        if (dir === 'inbound' && (opts.inboundOriginIds ?? []).includes(id)) {
          return { id: 1 } as ChannelMessageMap;
        }
        if (dir === 'outbound' && (opts.outboundSent ?? []).includes(id)) {
          return { id: 2 } as ChannelMessageMap;
        }
        return null;
      }),
      create: (m: Partial<ChannelMessageMap>) => m as ChannelMessageMap,
      save: jest.fn(async (m: ChannelMessageMap) => {
        savedMaps.push(m);
        return m;
      }),
    } as unknown as Repository<ChannelMessageMap>;

    const channelUpdates: Array<Partial<MessengerChannel>> = [];
    const channelRepo = {
      findOne: jest.fn(async () =>
        opts.channel === null
          ? null
          : ({
              id: 10,
              tenantId: 1,
              provider: 'telegram',
              active: 1,
              status: 'connected',
              secretEnc: null,
              ...opts.channel,
            } as MessengerChannel),
      ),
      update: jest.fn(async (_w: unknown, patch: Partial<MessengerChannel>) => {
        channelUpdates.push(patch);
        return { affected: 1 };
      }),
    } as unknown as Repository<MessengerChannel>;

    const msgRepo = {
      find: jest.fn(async () => (opts.messages ?? []) as Message[]),
      findOne: jest.fn(async (q: { where?: { id?: number } }) => {
        const id = Number(q?.where?.id);
        return ((opts.messages ?? []).find((m) => Number(m.id) === id) ?? null) as Message | null;
      }),
    } as unknown as Repository<Message>;

    const adapter = {
      provider: 'telegram',
      kind: 'webhook' as const,
      test: jest.fn(),
      send: opts.send ?? jest.fn(async () => ({ externalMessageId: 'ext-out-1' })),
      confirm: opts.confirm,
    } as unknown as MessengerAdapter;
    const registry = { find: () => adapter } as unknown as AdapterRegistry;

    const service = new MessengerOutboxService(
      outboxRepo,
      threadRepo,
      mapRepo,
      channelRepo,
      msgRepo,
      registry,
    );
    return { service, savedOutbox, outboxUpdates, savedMaps, threadUpdates, channelUpdates, adapter };
  }

  describe('flushThread', () => {
    it('queues AI and agent messages but never the shopper own turn', async () => {
      const h = build({
        messages: [
          { id: 501, senderType: 'user', body: 'where is my order?' },
          { id: 502, senderType: 'ai', body: 'It ships tomorrow.' },
          { id: 503, senderType: 'agent', body: 'Anything else?' },
        ],
      });

      await h.service.flushThread(55);

      expect(h.savedOutbox.map((o) => o.messageId)).toEqual([502, 503]);
      // Cursor advances past the skipped user turn too, so it is never rescanned.
      expect(h.threadUpdates[0]).toMatchObject({ outboundCursor: 503 });
    });

    it('never relays an inbound-origin message back out — loop prevention #3', async () => {
      const h = build({
        messages: [{ id: 601, senderType: 'system', body: 'mirrored inbound' }],
        inboundOriginIds: [601],
      });

      await h.service.flushThread(55);

      expect(h.savedOutbox).toHaveLength(0);
    });

    it('skips empty bodies', async () => {
      const h = build({ messages: [{ id: 700, senderType: 'ai', body: '   ' }] });
      await h.service.flushThread(55);
      expect(h.savedOutbox).toHaveLength(0);
    });

    // FIX-260908: the consent notice on a receive-only SMS thread was queued and
    // then failed terminally on every such thread — an outbox row nothing could
    // ever deliver.
    it('queues nothing on a receive-only thread but still advances the cursor', async () => {
      const h = build({
        thread: { replyEnabled: 0 },
        messages: [
          { id: 801, senderType: 'system', body: 'Hi! Before we start: messages are processed by AI.' },
          { id: 802, senderType: 'ai', body: 'Your parcel ships tomorrow.' },
        ],
      });

      await h.service.flushThread(55);

      expect(h.savedOutbox).toHaveLength(0);
      expect(h.threadUpdates[0]).toMatchObject({ outboundCursor: 802 });
    });
  });

  describe('deliverDue', () => {
    const row = { id: 1, tenantId: 1, threadId: 55, messageId: 502, status: 'pending', attempts: 0 };

    it('sends, maps the outbound id and marks sent', async () => {
      const h = build({
        outboxRows: [row],
        messages: [{ id: 502, senderType: 'ai', body: 'It ships tomorrow.' }],
      });

      await h.service.deliverDue();

      expect(h.adapter.send).toHaveBeenCalled();
      expect(h.savedMaps[0]).toMatchObject({ externalMessageId: 'ext-out-1', direction: 'outbound' });
      expect(h.outboxUpdates[0]).toMatchObject({ status: 'sent' });
    });

    it('sends markdown as plain text — channels cannot show ** (PLN-261008 S5)', async () => {
      const h = build({
        outboxRows: [row],
        messages: [{ id: 502, senderType: 'ai', body: 'Liên hệ:\n- **Email:** support@go2joy.vn\n- `Hotline` 1900 638 838' }],
      });

      await h.service.deliverDue();

      const sent = JSON.stringify((h.adapter.send as jest.Mock).mock.calls[0]);
      expect(sent).toContain('• Email: support@go2joy.vn');
      expect(sent).toContain('• Hotline 1900 638 838');
      expect(sent).not.toContain('**');
    });

    it('marks unconfirmed when the provider cannot prove delivery', async () => {
      const h = build({
        outboxRows: [row],
        messages: [{ id: 502, senderType: 'ai', body: 'hi' }],
        send: jest.fn(async () => ({ externalMessageId: 'cmd-9', unconfirmed: true })),
      });

      await h.service.deliverDue();

      expect(h.outboxUpdates[0]).toMatchObject({ status: 'unconfirmed', externalCommandId: 'cmd-9' });
    });

    it('does not re-send a message already mapped outbound (retry idempotency)', async () => {
      const h = build({
        outboxRows: [row],
        messages: [{ id: 502, senderType: 'ai', body: 'hi' }],
        outboundSent: [502],
      });

      await h.service.deliverDue();

      expect(h.adapter.send).not.toHaveBeenCalled();
      expect(h.outboxUpdates[0]).toMatchObject({ status: 'sent' });
    });

    it('fails a receive-only thread terminally instead of retrying forever', async () => {
      const h = build({
        thread: { replyEnabled: 0 },
        outboxRows: [row],
        messages: [{ id: 502, senderType: 'ai', body: 'hi' }],
      });

      await h.service.deliverDue();

      expect(h.adapter.send).not.toHaveBeenCalled();
      expect(h.outboxUpdates[0]).toMatchObject({ status: 'failed', lastError: 'thread is receive-only' });
    });

    it('backs off and records the error when the provider rejects the send', async () => {
      const h = build({
        outboxRows: [row],
        messages: [{ id: 502, senderType: 'ai', body: 'hi' }],
        send: jest.fn(async () => {
          throw new Error('telegram sendMessage failed: 403 bot was blocked by the user');
        }),
      });

      await h.service.deliverDue();

      expect(h.outboxUpdates[0]).toMatchObject({ status: 'pending', attempts: 1 });
      expect(h.outboxUpdates[0].nextAttemptAt).toBeInstanceOf(Date);
      // The failure surfaces on the channel card, not only in the logs.
      expect(h.channelUpdates[0]).toMatchObject({ status: 'error' });
    });

    it('gives up after the attempt budget is spent', async () => {
      const h = build({
        outboxRows: [{ ...row, attempts: 4 }],
        messages: [{ id: 502, senderType: 'ai', body: 'hi' }],
        send: jest.fn(async () => {
          throw new Error('boom');
        }),
      });

      await h.service.deliverDue();

      expect(h.outboxUpdates[0]).toMatchObject({ status: 'failed', attempts: 5, nextAttemptAt: null });
    });

    it('records unconfirmed with the provider command id', async () => {
      const h = build({
        outboxRows: [row],
        messages: [{ id: 502, senderType: 'ai', body: 'hi' }],
        send: jest.fn(async () => ({ externalMessageId: 'cmd-77', unconfirmed: true })),
      });

      await h.service.deliverDue();

      expect(h.outboxUpdates[0]).toMatchObject({
        status: 'unconfirmed',
        externalCommandId: 'cmd-77',
      });
    });

    it('keeps the row retryable when the channel is disabled', async () => {
      const h = build({
        channel: { active: 0 },
        outboxRows: [row],
        messages: [{ id: 502, senderType: 'ai', body: 'hi' }],
      });

      await h.service.deliverDue();

      expect(h.outboxUpdates[0]).toMatchObject({ status: 'pending', lastError: 'channel inactive' });
    });
  });

  describe('confirmUnconfirmed', () => {
    const unconfirmed = {
      id: 2,
      tenantId: 1,
      threadId: 55,
      messageId: 502,
      status: 'unconfirmed',
      attempts: 1,
      externalCommandId: 'cmd-77',
    };

    it('promotes to sent only once the provider confirms delivery', async () => {
      const h = build({ outboxRows: [unconfirmed], confirm: jest.fn(async () => 'sent' as const) });

      const resolved = await h.service.confirmUnconfirmed();

      expect(resolved).toBe(1);
      expect(h.outboxUpdates[0]).toMatchObject({ status: 'sent' });
    });

    it('leaves the row unconfirmed while the device agent has not answered', async () => {
      const h = build({ outboxRows: [unconfirmed], confirm: jest.fn(async () => 'pending' as const) });

      const resolved = await h.service.confirmUnconfirmed();

      expect(resolved).toBe(0);
      // Never silently promoted — an unproven delivery stays unproven.
      expect(h.outboxUpdates).toHaveLength(0);
    });

    it('marks failed when the agent reports failure', async () => {
      const h = build({ outboxRows: [unconfirmed], confirm: jest.fn(async () => 'failed' as const) });

      await h.service.confirmUnconfirmed();

      expect(h.outboxUpdates[0]).toMatchObject({ status: 'failed' });
    });

    it('ignores providers that deliver synchronously', async () => {
      const h = build({ outboxRows: [unconfirmed] }); // adapter has no confirm()

      const resolved = await h.service.confirmUnconfirmed();

      expect(resolved).toBe(0);
      expect(h.outboxUpdates).toHaveLength(0);
    });
  });
});
