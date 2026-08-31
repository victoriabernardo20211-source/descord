import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  serverTime: string;
  services: Record<string, 'ok' | 'down'>;
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async check(): Promise<HealthReport> {
    const services: HealthReport['services'] = { api: 'ok', postgres: 'down', redis: 'down' };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      services.postgres = 'ok';
    } catch {
      services.postgres = 'down';
    }
    try {
      await this.redis.client.ping();
      services.redis = 'ok';
    } catch {
      services.redis = 'down';
    }

    return {
      status: Object.values(services).every((s) => s === 'ok') ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      // O cliente usa isso para calcular serverTimeOffset e exibir o contador de DM.
      serverTime: new Date().toISOString(),
      services,
    };
  }
}
