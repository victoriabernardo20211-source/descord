import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
  ) {}

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { settings: true, presence: true },
    });
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bannerUrl: user.bannerUrl,
      bio: user.bio,
      isGlobalAdmin: user.isGlobalAdmin,
      createdAt: user.createdAt.toISOString(),
      settings: user.settings,
      presence: {
        status: user.presence?.status ?? 'OFFLINE',
        customStatus: user.presence?.customStatus ?? null,
        customEmoji: user.presence?.customEmoji ?? null,
      },
    };
  }

  async profile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bannerUrl: true,
        bio: true,
        createdAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Usuário não encontrado.' });
    }
    return { ...user, presence: await this.presence.get(userId) };
  }

  async updateProfile(
    userId: string,
    data: { displayName?: string; bio?: string | null; avatarUrl?: string; bannerUrl?: string },
  ) {
    const user = await this.prisma.user.update({ where: { id: userId }, data });
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bannerUrl: user.bannerUrl,
      bio: user.bio,
    };
  }

  async updateSettings(userId: string, data: Record<string, unknown>) {
    return this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  /** Busca por nome de usuário — usada pelo quick switcher e por "adicionar amigo". */
  async search(query: string, limit = 10) {
    if (query.trim().length < 2) return [];
    return this.prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: query.toLowerCase() } },
          { displayName: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
      take: Math.min(limit, 25),
    });
  }
}
