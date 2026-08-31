import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createAdapter } from '@socket.io/redis-adapter';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { AppModule } from './app.module';
import { AppConfig, CONFIG } from './config/configuration';
import { RedisService } from './redis/redis.service';
import { installBigIntJson } from './common/serialize';

/** Adapter Redis: broadcasts continuam corretos entre reinícios e processos. */
class RedisIoAdapter extends IoAdapter {
  constructor(
    app: NestExpressApplication,
    private readonly redis: RedisService,
    private readonly origins: string[] | true,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins, credentials: true },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server as any).adapter(createAdapter(this.redis.publisher, this.redis.subscriber));
    return server;
  }
}

async function bootstrap(): Promise<void> {
  installBigIntJson();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });
  const config = app.get<AppConfig>(CONFIG);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useWebSocketAdapter(new RedisIoAdapter(app, app.get(RedisService), config.corsOrigins));

  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    next();
  });

  // Documentação só em desenvolvimento — em produção a superfície fica fechada.
  if (!config.isProduction) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Nexus API')
        .setDescription('API privada de comunicação')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
    logger.log('Swagger disponível em /api/docs');
  }

  app.enableShutdownHooks();
  await app.listen(config.PORT, '0.0.0.0');
  logger.log(`Nexus server ouvindo em :${config.PORT} (${config.NODE_ENV})`);
  logger.log(`Expiração de mensagens privadas: ${config.dmTtlMs / 1000 / 60} minutos`);
}

void bootstrap();
