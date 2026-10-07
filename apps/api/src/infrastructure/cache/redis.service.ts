import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis wrapper (session cache, unread counts). Keys are tenant-prefixed by callers.
 * Degrades gracefully if Redis is unavailable (returns null / no-ops) so local dev
 * works without the container.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor(private readonly config: ConfigService) {
    try {
      this.client = new Redis({
        host: config.get<string>('REDIS_HOST', '127.0.0.1'),
        port: config.get<number>('REDIS_PORT', 6379),
        lazyConnect: false,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      });
      this.client.on('error', (e) => this.logger.warn(`Redis unavailable: ${e.message}`));
    } catch (e) {
      this.logger.warn(`Redis init failed: ${(e as Error).message}`);
    }
  }

  /**
   * Whether Redis is currently connected. Lets security-sensitive callers
   * (e.g. refresh-token rotation) distinguish "key absent = revoked" from
   * "Redis down = cannot check" and choose their degrade behavior explicitly.
   */
  available(): boolean {
    return this.client?.status === 'ready';
  }

  async get(key: string): Promise<string | null> {
    try {
      return (await this.client?.get(key)) ?? null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    try {
      if (ttlSec) await this.client?.set(key, value, 'EX', ttlSec);
      else await this.client?.set(key, value);
    } catch {
      /* no-op when unavailable */
    }
  }

  /**
   * SET NX with a TTL — true when this call created the key, false when it
   * already existed, null when Redis cannot answer (caller picks a fallback).
   */
  async setIfAbsent(key: string, value: string, ttlSec: number): Promise<boolean | null> {
    if (!this.available()) return null;
    try {
      return (await this.client!.set(key, value, 'EX', ttlSec, 'NX')) === 'OK';
    } catch {
      return null;
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return (await this.client?.incr(key)) ?? 0;
    } catch {
      return 0;
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client?.del(key);
    } catch {
      /* no-op */
    }
  }

  onModuleDestroy(): void {
    this.client?.disconnect();
  }
}
