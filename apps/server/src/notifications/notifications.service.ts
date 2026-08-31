import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService, room } from '../realtime/events.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /**
   * Cria notificação apenas para quem foi realmente mencionado e pode ver o canal.
   * O contador de menções por canal é incrementado no mesmo passo.
   */
  async notifyChannelMessage(
    messageId: string,
    channelId: string,
    authorId: string,
    input: { mentionsEveryone: boolean; mentionedUserIds: string[]; preview: string },
  ): Promise<void> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true },
    });
    if (!channel) return;

    let targets: string[];
    if (input.mentionsEveryone) {
      const members = await this.prisma.serverMember.findMany({
        where: { serverId: channel.serverId },
        select: { userId: true },
      });
      targets = members.map((m) => m.userId);
    } else {
      targets = input.mentionedUserIds;
    }
    targets = [...new Set(targets)].filter((id) => id !== authorId);
    if (targets.length === 0) return;

    // Só notifica quem de fato é membro (menção a um id qualquer não vale nada).
    const members = await this.prisma.serverMember.findMany({
      where: { serverId: channel.serverId, userId: { in: targets } },
      select: { userId: true },
    });

    for (const member of members) {
      const notification = await this.prisma.notification.create({
        data: {
          userId: member.userId,
          type: 'MENTION',
          serverId: channel.serverId,
          channelId,
          messageId,
          actorId: authorId,
          preview: input.preview,
        },
      });
      await this.prisma.channelRead.upsert({
        where: { channelId_userId: { channelId, userId: member.userId } },
        create: { channelId, userId: member.userId, mentionCount: 1 },
        update: { mentionCount: { increment: 1 } },
      });
      this.events.emit(room.user(member.userId), 'notification.created', {
        id: notification.id,
        type: notification.type,
        channelId,
        messageId,
      });
    }
  }

  async list(userId: string, limit = 50) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  /** Estado de não lidas por canal, usado pelos badges do cliente. */
  async unreadState(userId: string) {
    const reads = await this.prisma.channelRead.findMany({
      where: { userId },
      select: { channelId: true, lastReadMessageId: true, mentionCount: true },
    });
    return reads;
  }
}
