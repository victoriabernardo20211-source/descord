import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig, CONFIG } from '../config/configuration';

/**
 * Estado efêmero: presença, typing, rate limit, salas de voz.
 * Nada aqui é fonte da verdade — Redis pode ser reiniciado sem perda de dados duráveis.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;
  /** Conexões dedicadas: ioredis bloqueia comandos normais em um cliente inscrito. */
  readonly subscriber: Redis;
  readonly publisher: Redis;

  constructor(@Inject(CONFIG) config: AppConfig) {
    const opts = { maxRetriesPerRequest: null as null, lazyConnect: false };
    this.client = new Redis(config.REDIS_URL, opts);
    this.subscriber = this.client.duplicate();
    this.publisher = this.client.duplicate();
    this.client.on('error', (err) => this.logger.error(`Redis: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.client.quit(),
      this.subscriber.quit(),
      this.publisher.quit(),
    ]);
  }
}
