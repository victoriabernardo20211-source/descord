import { ForbiddenException, Injectable } from '@nestjs/common';
import { Permission } from '@nexus/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';
import { EventsService, room } from '../realtime/events.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  async createCategory(serverId: string, userId: string, name: string) {
    await this.permissions.assertServerPermission(serverId, userId, Permission.MANAGE_CHANNELS);
    const last = await this.prisma.category.findFirst({
      where: { serverId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const category = await this.prisma.category.create({
      data: { serverId, name, position: (last?.position ?? -1) + 1 },
    });
    await this.audit.record(serverId, userId, 'category.created', category.id, { name });
    return { id: category.id, name: category.name, position: category.position };
  }

  async create(
    serverId: string,
    userId: string,
    input: { name: string; type: 'TEXT' | 'VOICE'; categoryId?: string | null; topic?: string | null },
  ) {
    await this.permissions.assertServerPermission(serverId, userId, Permission.MANAGE_CHANNELS);
    const last = await this.prisma.channel.findFirst({
      where: { serverId, categoryId: input.categoryId ?? null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const channel = await this.prisma.channel.create({
      data: {
        serverId,
        name: input.name,
        type: input.type,
        categoryId: input.categoryId ?? null,
        topic: input.topic ?? null,
        position: (last?.position ?? -1) + 1,
      },
    });

    // Todos os membros já conectados passam a receber eventos do canal novo.
    const members = await this.prisma.serverMember.findMany({
      where: { serverId },
      select: { userId: true },
    });
    for (const m of members) await this.events.joinRoom(m.userId, room.channel(channel.id));

    this.events.emit(room.server(serverId), 'channel.created', {
      serverId,
      channelId: channel.id,
    });
    await this.audit.record(serverId, userId, 'channel.created', channel.id, {
      name: input.name,
      type: input.type,
    });

    return {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      topic: channel.topic,
      categoryId: channel.categoryId,
      position: channel.position,
    };
  }

  async update(
    channelId: string,
    userId: string,
    data: { name?: string; topic?: string | null; categoryId?: string | null; position?: number },
  ) {
    const channel = await this.prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    await this.permissions.assertServerPermission(
      channel.serverId,
      userId,
      Permission.MANAGE_CHANNELS,
    );
    const updated = await this.prisma.channel.update({ where: { id: channelId }, data });
    this.events.emit(room.server(channel.serverId), 'channel.updated', {
      serverId: channel.serverId,
      channelId,
    });
    await this.audit.record(channel.serverId, userId, 'channel.updated', channelId, data);
    return {
      id: updated.id,
      name: updated.name,
      type: updated.type,
      topic: updated.topic,
      categoryId: updated.categoryId,
      position: updated.position,
    };
  }

  async remove(channelId: string, userId: string): Promise<void> {
    const channel = await this.prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    await this.permissions.assertServerPermission(
      channel.serverId,
      userId,
      Permission.MANAGE_CHANNELS,
    );
    await this.prisma.channel.delete({ where: { id: channelId } });
    this.events.emit(room.server(channel.serverId), 'channel.deleted', {
      serverId: channel.serverId,
      channelId,
    });
    await this.audit.record(channel.serverId, userId, 'channel.deleted', channelId);
  }

  /** Override de permissão por canal, para um cargo OU para um membro. */
  async setOverride(
    channelId: string,
    userId: string,
    target: { roleId?: string; userId?: string },
    allow: bigint,
    deny: bigint,
  ): Promise<void> {
    const channel = await this.prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    await this.permissions.assertServerPermission(
      channel.serverId,
      userId,
      Permission.MANAGE_ROLES,
    );
    if (!target.roleId && !target.userId) {
      throw new ForbiddenException({
        code: 'INVALID_TARGET',
        message: 'Informe um cargo ou um membro.',
      });
    }

    const where = target.roleId
      ? { channelId_roleId: { channelId, roleId: target.roleId } }
      : { channelId_userId: { channelId, userId: target.userId as string } };

    await this.prisma.channelPermission.upsert({
      where,
      create: {
        channelId,
        roleId: target.roleId ?? null,
        userId: target.userId ?? null,
        allow,
        deny,
      },
      update: { allow, deny },
    });
    await this.audit.record(channel.serverId, userId, 'channel.permissions_updated', channelId, {
      ...target,
      allow: allow.toString(),
      deny: deny.toString(),
    });
  }

  async listOverrides(channelId: string, userId: string) {
    const channel = await this.prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    await this.permissions.assertMember(channel.serverId, userId);
    const overrides = await this.prisma.channelPermission.findMany({ where: { channelId } });
    return overrides.map((o) => ({
      id: o.id,
      roleId: o.roleId,
      userId: o.userId,
      allow: o.allow.toString(),
      deny: o.deny.toString(),
    }));
  }
}
