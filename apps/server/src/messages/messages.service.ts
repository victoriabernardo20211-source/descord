import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateMessageInput, MESSAGE_PAGE_SIZE, Message, Permission, has } from '@nexus/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';
import { EventsService, room } from '../realtime/events.service';
import { PendingUploadService } from '../files/pending-upload.service';
import { NotificationsService } from '../notifications/notifications.service';
import { extractMentions } from '../direct-messages/direct-messages.service';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly events: EventsService,
    private readonly uploads: PendingUploadService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(
    channelId: string,
    userId: string,
    options: { before?: string; limit?: number } = {},
  ): Promise<Message[]> {
    await this.permissions.assertChannelPermission(
      channelId,
      userId,
      Permission.READ_MESSAGE_HISTORY,
    );
    const limit = Math.min(options.limit ?? MESSAGE_PAGE_SIZE, MESSAGE_PAGE_SIZE);

    let cursorDate: Date | undefined;
    if (options.before) {
      const cursor = await this.prisma.message.findUnique({
        where: { id: options.before },
        select: { createdAt: true, channelId: true },
      });
      if (cursor?.channelId === channelId) cursorDate = cursor.createdAt;
    }

    const messages = await this.prisma.message.findMany({
      where: { channelId, ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}) },
      include: {
        author: true,
        attachments: true,
        reactions: true,
        pin: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return messages.reverse().map((m) => this.toDto(m, userId));
  }

  async send(channelId: string, userId: string, input: CreateMessageInput): Promise<Message> {
    const bits = await this.permissions.resolveChannel(channelId, userId);
    if (!has(bits, Permission.VIEW_CHANNEL) || !has(bits, Permission.SEND_MESSAGES)) {
      throw new ForbiddenException({
        code: 'MISSING_PERMISSION',
        message: 'Você não pode enviar mensagens nesse canal.',
      });
    }

    const attachmentIds = input.attachmentIds ?? [];
    if (attachmentIds.length > 0 && !has(bits, Permission.ATTACH_FILES)) {
      throw new ForbiddenException({
        code: 'MISSING_PERMISSION',
        message: 'Você não pode enviar arquivos nesse canal.',
      });
    }
    if (!input.content.trim() && attachmentIds.length === 0) {
      throw new ForbiddenException({
        code: 'EMPTY_MESSAGE',
        message: 'Escreva algo ou anexe um arquivo.',
      });
    }

    if (input.clientMessageId) {
      const existing = await this.prisma.message.findUnique({
        where: { channelId_clientMessageId: { channelId, clientMessageId: input.clientMessageId } },
        include: { author: true, attachments: true, reactions: true, pin: true },
      });
      if (existing) return this.toDto(existing, userId);
    }

    // @everyone só é honrado se o autor tiver a permissão; senão vira texto comum.
    const mentionsEveryone =
      /(^|\s)@everyone(\s|$)/.test(input.content) && has(bits, Permission.MENTION_EVERYONE);

    const attachments = await this.uploads.claim(userId, attachmentIds);
    const message = await this.prisma.message.create({
      data: {
        channelId,
        authorId: userId,
        content: input.content,
        replyToId: input.replyToId ?? null,
        clientMessageId: input.clientMessageId ?? null,
        mentionsEveryone,
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
      include: { author: true, attachments: true, reactions: true, pin: true },
    });

    const dto = this.toDto(message, userId);
    this.events.emit(room.channel(channelId), 'message.created', dto);
    await this.notifications.notifyChannelMessage(message.id, channelId, userId, {
      mentionsEveryone,
      mentionedUserIds: message.mentionedUserIds,
      preview: input.content.slice(0, 120),
    });
    return dto;
  }

  async edit(messageId: string, userId: string, content: string): Promise<Message> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw this.notFound();
    await this.permissions.assertChannelPermission(message.channelId, userId);
    if (message.authorId !== userId) {
      throw new ForbiddenException({
        code: 'NOT_AUTHOR',
        message: 'Você só pode editar suas próprias mensagens.',
      });
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { content, editedAt: new Date(), mentionedUserIds: extractMentions(content) },
      include: { author: true, attachments: true, reactions: true, pin: true },
    });
    const dto = this.toDto(updated, userId);
    this.events.emit(room.channel(message.channelId), 'message.updated', dto);
    return dto;
  }

  /** Autor apaga a própria; MANAGE_MESSAGES apaga a de qualquer um. */
  async remove(messageId: string, userId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return;
    const bits = await this.permissions.resolveChannel(message.channelId, userId);
    if (!has(bits, Permission.VIEW_CHANNEL)) throw this.notFound();
    if (message.authorId !== userId && !has(bits, Permission.MANAGE_MESSAGES)) {
      throw new ForbiddenException({
        code: 'MISSING_PERMISSION',
        message: 'Você não pode apagar essa mensagem.',
      });
    }
    await this.prisma.message.delete({ where: { id: messageId } });
    this.events.emit(room.channel(message.channelId), 'message.deleted', {
      id: messageId,
      channelId: message.channelId,
    });
  }

  async react(messageId: string, userId: string, emoji: string, add: boolean): Promise<void> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw this.notFound();
    await this.permissions.assertChannelPermission(
      message.channelId,
      userId,
      Permission.ADD_REACTIONS,
    );

    if (add) {
      await this.prisma.messageReaction.upsert({
        where: { messageId_userId_emoji: { messageId, userId, emoji } },
        create: { messageId, userId, emoji },
        update: {},
      });
    } else {
      await this.prisma.messageReaction.deleteMany({ where: { messageId, userId, emoji } });
    }

    this.events.emit(
      room.channel(message.channelId),
      add ? 'reaction.added' : 'reaction.removed',
      { messageId, channelId: message.channelId, emoji, userId },
    );
  }

  async setPin(messageId: string, userId: string, pinned: boolean): Promise<void> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) throw this.notFound();
    await this.permissions.assertChannelPermission(
      message.channelId,
      userId,
      Permission.MANAGE_MESSAGES,
    );

    if (pinned) {
      await this.prisma.pinnedMessage.upsert({
        where: { messageId },
        create: { messageId, channelId: message.channelId, pinnedById: userId },
        update: {},
      });
    } else {
      await this.prisma.pinnedMessage.deleteMany({ where: { messageId } });
    }
    this.events.emit(room.channel(message.channelId), 'message.updated', {
      ...(await this.byId(messageId, userId)),
    });
  }

  async listPins(channelId: string, userId: string): Promise<Message[]> {
    await this.permissions.assertChannelPermission(
      channelId,
      userId,
      Permission.READ_MESSAGE_HISTORY,
    );
    const pins = await this.prisma.pinnedMessage.findMany({
      where: { channelId },
      include: {
        message: {
          include: { author: true, attachments: true, reactions: true, pin: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return pins.map((p) => this.toDto(p.message, userId));
  }

  /**
   * Busca por full-text do Postgres. Suficiente para 9 usuários — não vale a
   * complexidade de um Elasticsearch aqui.
   */
  async search(
    serverId: string,
    userId: string,
    query: string,
    filters: { authorId?: string; channelId?: string; hasFile?: boolean } = {},
  ): Promise<Message[]> {
    await this.permissions.assertMember(serverId, userId);

    const channels = await this.prisma.channel.findMany({
      where: { serverId, type: 'TEXT' },
      select: { id: true },
    });
    const allowed: string[] = [];
    for (const c of channels) {
      const bits = await this.permissions.resolveChannel(c.id, userId);
      if (has(bits, Permission.VIEW_CHANNEL) && has(bits, Permission.READ_MESSAGE_HISTORY)) {
        allowed.push(c.id);
      }
    }
    if (allowed.length === 0) return [];
    const searchable = filters.channelId
      ? allowed.filter((id) => id === filters.channelId)
      : allowed;
    if (searchable.length === 0) return [];

    const messages = await this.prisma.message.findMany({
      where: {
        channelId: { in: searchable },
        ...(query ? { content: { contains: query, mode: 'insensitive' } } : {}),
        ...(filters.authorId ? { authorId: filters.authorId } : {}),
        ...(filters.hasFile ? { attachments: { some: {} } } : {}),
      },
      include: { author: true, attachments: true, reactions: true, pin: true },
      orderBy: { createdAt: 'desc' },
      take: MESSAGE_PAGE_SIZE,
    });
    return messages.map((m) => this.toDto(m, userId));
  }

  /** Marca o canal como lido e zera o contador de menções. */
  async markRead(channelId: string, userId: string, messageId: string): Promise<void> {
    await this.permissions.assertChannelPermission(channelId, userId);
    await this.prisma.channelRead.upsert({
      where: { channelId_userId: { channelId, userId } },
      create: { channelId, userId, lastReadMessageId: messageId, mentionCount: 0 },
      update: { lastReadMessageId: messageId, lastReadAt: new Date(), mentionCount: 0 },
    });
  }

  private async byId(messageId: string, userId: string): Promise<Message> {
    const message = await this.prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      include: { author: true, attachments: true, reactions: true, pin: true },
    });
    return this.toDto(message, userId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toDto(message: any, viewerId: string): Message {
    const grouped = new Map<string, { count: number; me: boolean }>();
    for (const r of message.reactions ?? []) {
      const entry = grouped.get(r.emoji) ?? { count: 0, me: false };
      entry.count += 1;
      if (r.userId === viewerId) entry.me = true;
      grouped.set(r.emoji, entry);
    }

    return {
      id: message.id,
      channelId: message.channelId,
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
      replyToId: message.replyToId,
      pinned: Boolean(message.pin),
      clientMessageId: message.clientMessageId,
      mentionsEveryone: message.mentionsEveryone,
      mentionedUserIds: message.mentionedUserIds,
      reactions: [...grouped.entries()].map(([emoji, v]) => ({ emoji, ...v })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      attachments: (message.attachments ?? []).map((a: any) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        size: a.size,
        width: a.width,
        height: a.height,
        url: `/files/channel/${a.id}`,
        thumbnailUrl: a.thumbnailKey ? `/files/channel/${a.id}?thumb=1` : null,
      })),
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'NOT_FOUND', message: 'Mensagem não encontrada.' });
  }
}
