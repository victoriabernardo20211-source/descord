import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { EventsService, room } from '../realtime/events.service';

/** A amizade é guardada uma vez só, com o par ordenado. */
function pair(a: string, b: string): { userAId: string; userBId: string } {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly presence: PresenceService,
  ) {}

  async list(userId: string) {
    const [friendships, incoming, outgoing, blocks] = await Promise.all([
      this.prisma.friendship.findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
        include: {
          userA: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          userB: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        },
      }),
      this.prisma.friendRequest.findMany({
        where: { toUserId: userId },
        include: {
          fromUser: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        },
      }),
      this.prisma.friendRequest.findMany({
        where: { fromUserId: userId },
        include: {
          toUser: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        },
      }),
      this.prisma.block.findMany({
        where: { blockerId: userId },
        include: {
          blocked: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        },
      }),
    ]);

    const friends = friendships.map((f) => (f.userAId === userId ? f.userB : f.userA));
    const presences = await this.presence.getMany(friends.map((f) => f.id));
    const byId = new Map(presences.map((p) => [p.userId, p]));

    return {
      friends: friends.map((f) => ({
        ...f,
        presence: byId.get(f.id) ?? { userId: f.id, status: 'OFFLINE' as const },
      })),
      incoming: incoming.map((r) => ({ id: r.id, user: r.fromUser, createdAt: r.createdAt })),
      outgoing: outgoing.map((r) => ({ id: r.id, user: r.toUser, createdAt: r.createdAt })),
      blocked: blocks.map((b) => b.blocked),
    };
  }

  async request(userId: string, username: string): Promise<{ status: string }> {
    const target = await this.prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'Não encontramos ninguém com esse nome de usuário.',
      });
    }
    if (target.id === userId) {
      throw new ConflictException({
        code: 'SELF_REQUEST',
        message: 'Você não pode adicionar a si mesmo.',
      });
    }

    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: target.id, blockedId: userId },
          { blockerId: userId, blockedId: target.id },
        ],
      },
    });
    if (blocked) {
      throw new ForbiddenException({
        code: 'BLOCKED',
        message: 'Não é possível enviar essa solicitação.',
      });
    }

    const existingFriendship = await this.prisma.friendship.findUnique({
      where: { userAId_userBId: pair(userId, target.id) },
    });
    if (existingFriendship) return { status: 'ALREADY_FRIENDS' };

    // Se a outra pessoa já tinha convidado, aceitar é o comportamento esperado.
    const reciprocal = await this.prisma.friendRequest.findUnique({
      where: { fromUserId_toUserId: { fromUserId: target.id, toUserId: userId } },
    });
    if (reciprocal) {
      await this.accept(userId, reciprocal.id);
      return { status: 'ACCEPTED' };
    }

    const request = await this.prisma.friendRequest.upsert({
      where: { fromUserId_toUserId: { fromUserId: userId, toUserId: target.id } },
      create: { fromUserId: userId, toUserId: target.id },
      update: {},
    });

    this.events.emit(room.user(target.id), 'friend.requested', {
      requestId: request.id,
      fromUserId: userId,
    });
    return { status: 'PENDING' };
  }

  async accept(userId: string, requestId: string): Promise<void> {
    const request = await this.prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!request || request.toUserId !== userId) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Solicitação não encontrada.',
      });
    }

    await this.prisma.$transaction([
      this.prisma.friendship.create({ data: pair(request.fromUserId, request.toUserId) }),
      this.prisma.friendRequest.deleteMany({
        where: {
          OR: [
            { fromUserId: request.fromUserId, toUserId: request.toUserId },
            { fromUserId: request.toUserId, toUserId: request.fromUserId },
          ],
        },
      }),
    ]);

    this.events.emit(room.user(request.fromUserId), 'friend.accepted', { userId: request.toUserId });
    this.events.emit(room.user(request.toUserId), 'friend.accepted', { userId: request.fromUserId });
  }

  async reject(userId: string, requestId: string): Promise<void> {
    await this.prisma.friendRequest.deleteMany({ where: { id: requestId, toUserId: userId } });
  }

  async cancel(userId: string, requestId: string): Promise<void> {
    await this.prisma.friendRequest.deleteMany({ where: { id: requestId, fromUserId: userId } });
  }

  async remove(userId: string, targetId: string): Promise<void> {
    await this.prisma.friendship.deleteMany({ where: pair(userId, targetId) });
    this.events.emit(room.user(targetId), 'friend.removed', { userId });
    this.events.emit(room.user(userId), 'friend.removed', { userId: targetId });
  }

  /** Bloquear desfaz a amizade e limpa solicitações pendentes nos dois sentidos. */
  async block(userId: string, targetId: string): Promise<void> {
    if (userId === targetId) {
      throw new ConflictException({
        code: 'SELF_BLOCK',
        message: 'Você não pode bloquear a si mesmo.',
      });
    }
    await this.prisma.$transaction([
      this.prisma.block.upsert({
        where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } },
        create: { blockerId: userId, blockedId: targetId },
        update: {},
      }),
      this.prisma.friendship.deleteMany({ where: pair(userId, targetId) }),
      this.prisma.friendRequest.deleteMany({
        where: {
          OR: [
            { fromUserId: userId, toUserId: targetId },
            { fromUserId: targetId, toUserId: userId },
          ],
        },
      }),
    ]);
  }

  async unblock(userId: string, targetId: string): Promise<void> {
    await this.prisma.block.deleteMany({ where: { blockerId: userId, blockedId: targetId } });
  }
}
