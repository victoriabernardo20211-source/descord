import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateMessageInput, DM_TTL_MS, DirectMessage, MESSAGE_PAGE_SIZE } from '@nexus/shared';
import { AppConfig, CONFIG } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService, room } from '../realtime/events.service';
import { PendingUploadService } from '../files/pending-upload.service';
import { ExpirationService } from './expiration.service';

type DmWithRelations = Awaited<
  ReturnType<PrismaService['directMessage']['findFirstOrThrow']>
>;

/**
 * Mensagens privadas.
 *
 * REGRA INVIOLÁVEL: expiresAt = createdAt + TTL (8h em produção), definido só aqui.
 * Nenhuma rota aceita expiresAt do cliente, não existe pin de DM e nem o
 * administrador global consegue preservar uma mensagem privada.
 *
 * Toda leitura filtra por `expiresAt > now()`: mesmo que a fila e o cron estejam
 * parados, a API nunca devolve uma mensagem vencida.
 */
@Injectable()
export class DirectMessagesService {
  private readonly logger = new Logger(DirectMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly uploads: PendingUploadService,
    private readonly expiration: ExpirationService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  get ttlMs(): number {
    return this.config.dmTtlMs ?? DM_TTL_MS;
  }

  async assertParticipant(conversationId: string, userId: string): Promise<void> {
    const participant = await this.prisma.directConversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { id: true },
    });
    if (!participant) {
      // 404 em vez de 403: não confirma sequer que a conversa existe.
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Conversa não encontrada.',
      });
    }
  }

  async listConversations(userId: string) {
    const conversations = await this.prisma.directConversation.findMany({
      where: { participants: { some: { userId } } },
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, username: true, displayName: true, avatarUrl: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return conversations.map((c) => ({
      id: c.id,
      isGroup: c.isGroup,
      name: c.name,
      iconUrl: c.iconUrl,
      ownerId: c.ownerId,
      participants: c.participants.map((p) => p.user),
    }));
  }

  /** DM 1:1 é sempre reaproveitada; grupo (3+) sempre cria uma conversa nova. */
  async openConversation(userId: string, targetUserIds: string[]) {
    const ids = [...new Set([userId, ...targetUserIds])];
    if (ids.length < 2) {
      throw new ForbiddenException({
        code: 'INVALID_CONVERSATION',
        message: 'Selecione ao menos uma pessoa.',
      });
    }

    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: { in: ids }, blockedId: userId },
          { blockerId: userId, blockedId: { in: ids } },
        ],
      },
    });
    if (blocked) {
      throw new ForbiddenException({
        code: 'BLOCKED',
        message: 'Não é possível iniciar essa conversa.',
      });
    }

    if (ids.length === 2) {
      const existing = await this.prisma.directConversation.findFirst({
        where: {
          isGroup: false,
          AND: ids.map((id) => ({ participants: { some: { userId: id } } })),
        },
        include: { participants: true },
      });
      if (existing && existing.participants.length === 2) return this.hydrate(existing.id);
    }

    const created = await this.prisma.directConversation.create({
      data: {
        isGroup: ids.length > 2,
        ownerId: ids.length > 2 ? userId : null,
        participants: { create: ids.map((id) => ({ userId: id })) },
      },
    });

    for (const id of ids) await this.events.joinRoom(id, room.conversation(created.id));
    return this.hydrate(created.id);
  }

  /**
   * Histórico. O filtro `expiresAt > now()` é obrigatório e não tem exceção:
   * uma mensagem vencida some da API mesmo antes do job de limpeza rodar.
   */
  async listMessages(
    conversationId: string,
    userId: string,
    options: { before?: string; limit?: number } = {},
  ): Promise<DirectMessage[]> {
    await this.assertParticipant(conversationId, userId);
    const limit = Math.min(options.limit ?? MESSAGE_PAGE_SIZE, MESSAGE_PAGE_SIZE);

    let cursorDate: Date | undefined;
    if (options.before) {
      const cursor = await this.prisma.directMessage.findUnique({
        where: { id: options.before },
        select: { createdAt: true, conversationId: true },
      });
      if (cursor?.conversationId === conversationId) cursorDate = cursor.createdAt;
    }

    const messages = await this.prisma.directMessage.findMany({
      where: {
        conversationId,
        expiresAt: { gt: new Date() },
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      },
      include: { author: true, attachments: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return messages.reverse().map((m) => this.toDto(m));
  }

  async send(
    conversationId: string,
    userId: string,
    input: CreateMessageInput,
  ): Promise<DirectMessage> {
    await this.assertParticipant(conversationId, userId);

    if (!input.content.trim() && !(input.attachmentIds?.length ?? 0)) {
      throw new ForbiddenException({
        code: 'EMPTY_MESSAGE',
        message: 'Escreva algo ou anexe um arquivo.',
      });
    }

    // Idempotência: reenviar o mesmo clientMessageId devolve a mensagem existente.
    if (input.clientMessageId) {
      const existing = await this.prisma.directMessage.findUnique({
        where: {
          conversationId_clientMessageId: {
            conversationId,
            clientMessageId: input.clientMessageId,
          },
        },
        include: { author: true, attachments: true },
      });
      if (existing) return this.toDto(existing);
    }

    const attachments = await this.uploads.claim(userId, input.attachmentIds ?? []);

    const now = new Date();
    // Aritmética em milissegundos sobre UTC — sem string, sem timezone, sem DST.
    const expiresAt = new Date(now.getTime() + this.ttlMs);

    const message = await this.prisma.directMessage.create({
      data: {
        conversationId,
        authorId: userId,
        content: input.content,
        createdAt: now,
        expiresAt,
        replyToId: input.replyToId ?? null,
        clientMessageId: input.clientMessageId ?? null,
        mentionedUserIds: extractMentions(input.content),
        attachments: {
          create: attachments.map((a) => ({
            storageKey: a.storageKey,
            thumbnailKey: a.thumbnailKey,
            fileName: a.fileName,
            mimeType: a.mimeType,
            size: a.size,
            width: a.width,
            height: a.height,
          })),
        },
      },
      include: { author: true, attachments: true },
    });

    // Agenda a remoção no instante exato. Se a fila falhar, o cron e o boot cobrem.
    await this.expiration.schedule(message.id, expiresAt);

    const dto = this.toDto(message);
    this.events.emit(room.conversation(conversationId), 'dm.created', dto);
    return dto;
  }

  async edit(messageId: string, userId: string, content: string): Promise<DirectMessage> {
    const message = await this.prisma.directMessage.findFirst({
      where: { id: messageId, expiresAt: { gt: new Date() } },
      include: { author: true, attachments: true },
    });
    if (!message) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Mensagem não encontrada.' });
    }
    await this.assertParticipant(message.conversationId, userId);
    if (message.authorId !== userId) {
      throw new ForbiddenException({
        code: 'NOT_AUTHOR',
        message: 'Você só pode editar suas próprias mensagens.',
      });
    }

    // Editar NÃO renova expiresAt: o prazo conta do envio original.
    const updated = await this.prisma.directMessage.update({
      where: { id: messageId },
      data: { content, editedAt: new Date(), mentionedUserIds: extractMentions(content) },
      include: { author: true, attachments: true },
    });

    const dto = this.toDto(updated);
    this.events.emit(room.conversation(message.conversationId), 'dm.updated', dto);
    return dto;
  }

  async remove(messageId: string, userId: string): Promise<void> {
    const message = await this.prisma.directMessage.findUnique({
      where: { id: messageId },
      include: { attachments: true },
    });
    if (!message) return;
    await this.assertParticipant(message.conversationId, userId);
    if (message.authorId !== userId) {
      throw new ForbiddenException({
        code: 'NOT_AUTHOR',
        message: 'Você só pode apagar suas próprias mensagens.',
      });
    }
    await this.expiration.deleteMessages([messageId]);
    this.events.emit(room.conversation(message.conversationId), 'dm.deleted', {
      id: messageId,
      conversationId: message.conversationId,
    });
  }

  private async hydrate(conversationId: string) {
    const c = await this.prisma.directConversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: {
        participants: {
          include: {
            user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          },
        },
      },
    });
    return {
      id: c.id,
      isGroup: c.isGroup,
      name: c.name,
      iconUrl: c.iconUrl,
      ownerId: c.ownerId,
      participants: c.participants.map((p) => p.user),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toDto(message: any): DirectMessage {
    return {
      id: message.id,
      conversationId: message.conversationId,
      author: {
        id: message.author.id,
        username: message.author.username,
        displayName: message.author.displayName,
        avatarUrl: message.author.avatarUrl,
        bannerUrl: message.author.bannerUrl ?? null,
        bio: message.author.bio ?? null,
        createdAt: message.author.createdAt.toISOString(),
      },
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null,
      expiresAt: message.expiresAt.toISOString(),
      replyToId: message.replyToId,
      clientMessageId: message.clientMessageId,
      mentionsEveryone: message.mentionsEveryone,
      mentionedUserIds: message.mentionedUserIds,
      reactions: [],
      // O download exige autorização — nunca é um caminho público no disco.
      attachments: (message.attachments ?? []).map((a: DmWithRelations & any) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        size: a.size,
        width: a.width,
        height: a.height,
        url: `/files/dm/${a.id}`,
        thumbnailUrl: a.thumbnailKey ? `/files/dm/${a.id}?thumb=1` : null,
      })),
    };
  }
}

/** Menções por id (<@id>) — resolvidas no cliente para nome de exibição. */
export function extractMentions(content: string): string[] {
  const matches = content.matchAll(/<@([a-z0-9]{20,32})>/gi);
  return [...new Set([...matches].map((m) => m[1] as string))];
}
