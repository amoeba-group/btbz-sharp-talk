import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import {
  PushMessage,
  PushProvider,
  PushReceipt,
  PushTicket,
} from './push-provider.interface';

/** Web Push subscription shape stored in device_tokens.token (JSON string). */
interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Web Push (VAPID) provider (PLN-PWA W-2). `message.to` carries the
 * JSON.stringify'd PushSubscription; delivery goes straight to the browser
 * push service, so there are no deferred receipts (getReceipts = no-op).
 * VAPID keys come from env (VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT — generate
 * with `npx web-push generate-vapid-keys`); when unset, sends degrade to
 * failed tickets — never thrown (the in-app notification row is the fallback).
 */
@Injectable()
export class WebPushProvider implements PushProvider {
  private readonly logger = new Logger(WebPushProvider.name);
  private vapidReady = false;
  private warnedNotConfigured = false;

  /** Lazy one-time VAPID setup; returns false when keys are not configured. */
  private ensureVapid(): boolean {
    if (this.vapidReady) return true;
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    if (!pub || !priv) {
      if (!this.warnedNotConfigured) {
        this.warnedNotConfigured = true;
        this.logger.warn('web push disabled: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not configured');
      }
      return false;
    }
    // The VAPID subject is the contact a push service may use to reach THIS
    // deployment's operator, so it must not name Amoeba on a customer's host: an
    // https APP_PUBLIC_URL is a valid subject and is always the deployment's own.
    // The Amoeba mailbox survives only as the last resort for local development.
    const publicUrl = process.env.APP_PUBLIC_URL?.trim();
    const subject =
      process.env.VAPID_SUBJECT || (publicUrl && /^https:\/\//i.test(publicUrl) ? publicUrl : 'mailto:dev@amoeba.group');
    webpush.setVapidDetails(subject, pub, priv);
    this.vapidReady = true;
    return true;
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (!this.ensureVapid()) {
      return messages.map((m) => ({
        token: m.to,
        ok: false,
        shouldRevoke: false,
        error: 'vapid_not_configured',
      }));
    }
    const tickets: PushTicket[] = [];
    for (const message of messages) {
      try {
        const subscription = JSON.parse(message.to) as WebPushSubscription;
        const payload = JSON.stringify({
          title: message.title,
          body: message.body,
          data: message.data,
        });
        await webpush.sendNotification(subscription, payload, { TTL: 3600 });
        // Web Push has no deferred receipts — a 2xx from the push service is final.
        tickets.push({ token: message.to, ok: true, shouldRevoke: false });
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        // 404/410 = subscription expired or unsubscribed — revoke the row.
        const gone = statusCode === 404 || statusCode === 410;
        if (!gone) this.logger.warn(`web push send failed (status=${statusCode ?? 'n/a'})`);
        tickets.push({
          token: message.to,
          ok: false,
          shouldRevoke: gone,
          error: gone ? 'subscription_gone' : statusCode ? `http_${statusCode}` : 'send_error',
        });
      }
    }
    return tickets;
  }

  /** Web Push has no receipt API. */
  async getReceipts(_receiptIds: string[]): Promise<PushReceipt[]> {
    return [];
  }
}
