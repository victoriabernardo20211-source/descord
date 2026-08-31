import { Injectable } from '@nestjs/common';
import { PRESENCE_TTL_MS, PresenceState, PresenceStatus } from '@nexus/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EventsService, room } from '../realtime/events.service';

const key = {
  sockets: (userId: string) => `presence:sockets:${userId}`,
  status: (userId: string) => `presence:status:${userId}`,
};

/**
 * Presença ao vivo mora no Redis (efêmero). O Postgres guarda apenas o último
 * status escolhido pelo usuário, para restaurar depois de um restart.
 */
@Injectable()
export class PresenceService {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async handleConnect(userId: string, socketId: string): Promise<void> {
    await this.redis.client.sadd(key.sockets(userId), socketId);
    await this.redis.client.pexpire(key.sockets(userId), PRESENCE_TTL_MS);

    const stored = await this.prisma.presence.findUnique({ where: { userId } });
    // Quem escolheu INVISIBLE continua invisível ao reconectar.
    const status: PresenceStatus =
      stored?.status === 'INVISIBLE' ? 'INVISIBLE' : 'ONLINE';
    await this.applyStatus(userId, {
      status,
      customStatus: stored?.customStatus ?? null,
      customEmoji: stored?.customEmoji ?? null,
    });
  }

  async handleDisconnect(userId: string, socketId: string): Promise<void> {
    await this.redis.client.srem(key.sockets(userId), socketId);
    const remaining = await this.redis.client.scard(key.sockets(userId));
    // Só fica offline quando o último dispositivo cai.
    if (remaining === 0) {
      await this.applyStatus(userId, { status: 'OFFLINE' });
    }
  }

  /** Renova o TTL — se o heartbeat parar, a chave expira e o usuário some. */
  async heartbeat(userId: string, socketId: string): Promise<void> {
    await this.redis.client.sadd(key.sockets(userId), socketId);
    await this.redis.client.pexpire(key.sockets(userId), PRESENCE_TTL_MS);
    await this.redis.client.pexpire(key.status(userId), PRESENCE_TTL_MS);
  }

  async setStatus(
    userId: string,
    input: { status: PresenceStatus; customStatus?: string | null; customEmoji?: string | null },
  ): Promise<void> {
    await this.prisma.presence.upsert({
      where: { userId },
      create: {
        userId,
        status: input.status,
        customStatus: input.customStatus ?? null,
        customEmoji: input.customEmoji ?? null,
      },
      update: {
        status: input.status,
        customStatus: input.customStatus ?? null,
        customEmoji: input.customEmoji ?? null,
      },
    });
    await this.applyStatus(userId, input);
  }

  async get(userId: string): Promise<PresenceState> {
    const raw = await this.redis.client.get(key.status(userId));
    if (!raw) return { userId, status: 'OFFLINE' };
    return { userId, ...(JSON.parse(raw) as Omit<PresenceState, 'userId'>) };
  }

  async getMany(userIds: string[]): Promise<PresenceState[]> {
    if (userIds.length === 0) return [];
    const values = await this.redis.client.mget(userIds.map(key.status));
    return userIds.map((userId, i) => {
      const raw = values[i];
      if (!raw) return { userId, status: 'OFFLINE' as PresenceStatus };
      return { userId, ...(JSON.parse(raw) as Omit<PresenceState, 'userId'>) };
    });
  }

  private async applyStatus(
    userId: string,
    input: { status: PresenceStatus; customStatus?: string | null; customEmoji?: string | null },
  ): Promise<void> {
    const state: PresenceState = {
      userId,
      status: input.status,
      customStatus: input.customStatus ?? null,
      customEmoji: input.customEmoji ?? null,
    };

    if (input.status === 'OFFLINE') {
      await this.redis.client.del(key.status(userId));
    } else {
      await this.redis.client.set(
        key.status(userId),
        JSON.stringify({
          status: input.status,
          customStatus: state.customStatus,
          customEmoji: state.customEmoji,
        }),
        'PX',
        PRESENCE_TTL_MS,
      );
    }

    // INVISIBLE é anunciado aos outros como OFFLINE; o próprio usuário vê a verdade.
    const publicState: PresenceState =
      input.status === 'INVISIBLE' ? { ...state, status: 'OFFLINE' } : state;

    await this.broadcast(userId, publicState);
    this.events.emit(room.user(userId), 'presence.updated', state);
  }

  /** Envia a presença para quem tem motivo de ver: amigos e colegas de servidor. */
  private async broadcast(userId: string, state: PresenceState): Promise<void> {
    const [memberships, friendships] = await Promise.all([
      this.prisma.serverMember.findMany({ where: { userId }, select: { serverId: true } }),
      this.prisma.friendship.findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
        select: { userAId: true, userBId: true },
      }),
    ]);

    const targets = new Set<string>();
    for (const m of memberships) targets.add(room.server(m.serverId));
    for (const f of friendships) {
      targets.add(room.user(f.userAId === userId ? f.userBId : f.userAId));
    }
    if (targets.size > 0) this.events.emit([...targets], 'presence.updated', state);
  }
}
