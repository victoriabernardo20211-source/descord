import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Job, Queue, Worker } from 'bullmq';
import { AppConfig, CONFIG } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { FilesService } from '../files/files.service';
import { EventsService, room } from '../realtime/events.service';

const QUEUE_NAME = 'dm-expiration';

interface ExpireJobData {
  messageId: string;
}

/**
 * Remoção permanente das mensagens privadas, em quatro camadas redundantes.
 *
 *  1. Filtro de leitura (em DirectMessagesService) — a API nunca devolve vencida.
 *  2. Delayed job (BullMQ) — apaga no instante exato.
 *  3. Reconciliação (cron a cada 60s) — cobre job perdido / Redis reiniciado.
 *  4. Purge no boot — cobre downtime e restauração de backup antigo.
 *
 * setTimeout NÃO é usado: não sobreviveria a um restart do backend.
 */
@Injectable()
export class ExpirationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ExpirationService.name);
  private readonly queue: Queue<ExpireJobData>;
  private worker: Worker<ExpireJobData> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly files: FilesService,
    private readonly events: EventsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    const connection = this.redis.client.duplicate();
    this.queue = new Queue<ExpireJobData>(QUEUE_NAME, {
      connection,
      defaultJobOptions: { removeOnComplete: true, removeOnFail: 100, attempts: 3 },
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    this.worker = new Worker<ExpireJobData>(
      QUEUE_NAME,
      async (job: Job<ExpireJobData>) => {
        await this.deleteMessages([job.data.messageId]);
      },
      { connection: this.redis.client.duplicate(), concurrency: 4 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Job de expiração falhou (${job?.id}): ${err.message}`),
    );

    // Purge de boot: roda antes de qualquer cliente conseguir ler o histórico.
    const removed = await this.reconcile();
    if (removed > 0) {
      this.logger.warn(
        `Purge de inicialização: ${removed} mensagem(ns) privada(s) vencida(s) removida(s).`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue.close()]);
  }

  /** Agenda a exclusão no milissegundo exato de expiresAt. */
  async schedule(messageId: string, expiresAt: Date): Promise<void> {
    const delay = Math.max(0, expiresAt.getTime() - Date.now());
    try {
      await this.queue.add('expire', { messageId }, { delay, jobId: `dm:${messageId}` });
    } catch (err) {
      // Fila indisponível não é fatal: a reconciliação de 60s cobre este caso.
      this.logger.error(`Não foi possível agendar a expiração de ${messageId}: ${(err as Error).message}`);
    }
  }

  /**
   * Reconciliação periódica — a rede de segurança de todo o mecanismo.
   * Também é o que garante que um backup restaurado não ressuscite nada.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async reconcile(): Promise<number> {
    const expired = await this.prisma.directMessage.findMany({
      where: { expiresAt: { lte: new Date() } },
      select: { id: true },
      take: 1000,
    });
    if (expired.length === 0) return 0;
    await this.deleteMessages(expired.map((m) => m.id));
    return expired.length;
  }

  /**
   * Exclusão definitiva: anexos do storage + linhas do banco + evento dm.expired.
   * Idempotente — pode rodar duas vezes para a mesma mensagem sem efeito colateral.
   */
  async deleteMessages(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;

    const messages = await this.prisma.directMessage.findMany({
      where: { id: { in: messageIds } },
      select: {
        id: true,
        conversationId: true,
        attachments: { select: { storageKey: true, thumbnailKey: true } },
      },
    });
    if (messages.length === 0) return;

    // Arquivos primeiro: se o processo morrer no meio, a próxima passada refaz.
    const keys = messages.flatMap((m) =>
      m.attachments.flatMap((a) => [a.storageKey, a.thumbnailKey]),
    );
    await this.files.remove(keys);

    // Uma transação: anexos e mensagem somem juntos, sem registro órfão.
    const ids = messages.map((m) => m.id);
    await this.prisma.$transaction([
      this.prisma.directMessageAttachment.deleteMany({ where: { messageId: { in: ids } } }),
      this.prisma.directMessage.deleteMany({ where: { id: { in: ids } } }),
    ]);

    // Avisa todos os dispositivos: some da tela na hora, sem refresh.
    const byConversation = new Map<string, string[]>();
    for (const m of messages) {
      const list = byConversation.get(m.conversationId) ?? [];
      list.push(m.id);
      byConversation.set(m.conversationId, list);
    }
    for (const [conversationId, messageIdList] of byConversation) {
      this.events.emit(room.conversation(conversationId), 'dm.expired', {
        conversationId,
        messageIds: messageIdList,
      });
    }

    this.logger.log(`${ids.length} mensagem(ns) privada(s) removida(s) permanentemente.`);
  }
}
