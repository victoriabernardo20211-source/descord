import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  ALL_PERMISSIONS,
  DEFAULT_EVERYONE_PERMISSIONS,
  Permission,
  has,
  listPermissions,
} from '@nexus/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';
import { EventsService, room } from '../realtime/events.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ServersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  async listForUser(userId: string) {
    const memberships = await this.prisma.serverMember.findMany({
      where: { userId },
      include: { server: true },
      orderBy: { joinedAt: 'asc' },
    });
    return memberships.map((m) => ({
      id: m.server.id,
      name: m.server.name,
      iconUrl: m.server.iconUrl,
      ownerId: m.server.ownerId,
    }));
  }

  /** Cria servidor com @everyone, categoria padrão e um canal de texto + um de voz. */
  async create(userId: string, name: string) {
    const server = await this.prisma.$transaction(async (tx) => {
      const created = await tx.server.create({ data: { name, ownerId: userId } });

      const everyone = await tx.role.create({
        data: {
          serverId: created.id,
          name: '@everyone',
          isEveryone: true,
          position: 0,
          permissions: DEFAULT_EVERYONE_PERMISSIONS,
        },
      });

      const member = await tx.serverMember.create({
        data: { serverId: created.id, userId },
      });
      await tx.memberRole.create({ data: { memberId: member.id, roleId: everyone.id } });

      const category = await tx.category.create({
        data: { serverId: created.id, name: 'Geral', position: 0 },
      });
      await tx.channel.create({
        data: {
          serverId: created.id,
          categoryId: category.id,
          name: 'geral',
          type: 'TEXT',
          position: 0,
        },
      });
      await tx.channel.create({
        data: {
          serverId: created.id,
          categoryId: category.id,
          name: 'Sala de voz',
          type: 'VOICE',
          position: 1,
        },
      });

      return created;
    });

    await this.events.joinRoom(userId, room.server(server.id));
    for (const channel of await this.prisma.channel.findMany({
      where: { serverId: server.id },
      select: { id: true },
    })) {
      await this.events.joinRoom(userId, room.channel(channel.id));
    }

    return this.detail(server.id, userId);
  }

  /** Visão completa do servidor, já filtrando canais que o usuário não pode ver. */
  async detail(serverId: string, userId: string) {
    const ctx = await this.permissions.assertMember(serverId, userId);
    const server = await this.prisma.server.findUniqueOrThrow({
      where: { id: serverId },
      include: {
        categories: { orderBy: { position: 'asc' } },
        channels: { orderBy: { position: 'asc' } },
        roles: { orderBy: { position: 'desc' } },
        members: {
          include: {
            user: {
              select: { id: true, username: true, displayName: true, avatarUrl: true, bio: true },
            },
            roles: { select: { roleId: true } },
          },
        },
      },
    });

    const visibleChannels = [];
    for (const channel of server.channels) {
      const bits = await this.permissions.resolveChannel(channel.id, userId);
      if (has(bits, Permission.VIEW_CHANNEL)) {
        visibleChannels.push({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          topic: channel.topic,
          categoryId: channel.categoryId,
          position: channel.position,
        });
      }
    }

    return {
      id: server.id,
      name: server.name,
      iconUrl: server.iconUrl,
      ownerId: server.ownerId,
      permissions: ctx.basePermissions.toString(),
      permissionNames: listPermissions(ctx.basePermissions),
      categories: server.categories.map((c) => ({
        id: c.id,
        name: c.name,
        position: c.position,
      })),
      channels: visibleChannels,
      roles: server.roles.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        position: r.position,
        isEveryone: r.isEveryone,
        permissions: r.permissions.toString(),
      })),
      members: server.members.map((m) => ({
        userId: m.userId,
        nickname: m.nickname,
        joinedAt: m.joinedAt.toISOString(),
        roleIds: m.roles.map((r) => r.roleId),
        user: m.user,
      })),
    };
  }

  async update(serverId: string, userId: string, data: { name?: string; iconUrl?: string }) {
    await this.permissions.assertServerPermission(serverId, userId, Permission.MANAGE_SERVER);
    const server = await this.prisma.server.update({ where: { id: serverId }, data });
    await this.audit.record(serverId, userId, 'server.updated', serverId, data);
    return { id: server.id, name: server.name, iconUrl: server.iconUrl };
  }

  /** Só o dono apaga o servidor. */
  async remove(serverId: string, userId: string): Promise<void> {
    const server = await this.prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    if (server.ownerId !== userId) {
      throw new ForbiddenException({
        code: 'OWNER_ONLY',
        message: 'Apenas o dono pode excluir o servidor.',
      });
    }
    await this.prisma.server.delete({ where: { id: serverId } });
  }

  /** O dono não sai do próprio servidor — precisa transferir ou excluir antes. */
  async leave(serverId: string, userId: string): Promise<void> {
    const server = await this.prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    if (server.ownerId === userId) {
      throw new ForbiddenException({
        code: 'OWNER_CANNOT_LEAVE',
        message: 'Transfira a propriedade ou exclua o servidor antes de sair.',
      });
    }
    await this.prisma.serverMember.deleteMany({ where: { serverId, userId } });
    await this.events.leaveRoom(userId, room.server(serverId));
    this.events.emit(room.server(serverId), 'member.left', { serverId, userId });
  }

  async transferOwnership(serverId: string, userId: string, targetUserId: string): Promise<void> {
    const server = await this.prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    if (server.ownerId !== userId) {
      throw new ForbiddenException({
        code: 'OWNER_ONLY',
        message: 'Apenas o dono pode transferir a propriedade.',
      });
    }
    await this.permissions.assertMember(serverId, targetUserId);
    await this.prisma.server.update({ where: { id: serverId }, data: { ownerId: targetUserId } });
    await this.audit.record(serverId, userId, 'server.ownership_transferred', targetUserId);
  }

  async createInvite(
    serverId: string,
    userId: string,
    input: { maxAgeSeconds: number; maxUses: number },
  ) {
    await this.permissions.assertServerPermission(serverId, userId, Permission.CREATE_INVITE);
    const invite = await this.prisma.serverInvite.create({
      data: {
        serverId,
        createdById: userId,
        code: randomBytes(9).toString('base64url'),
        maxUses: input.maxUses,
        expiresAt:
          input.maxAgeSeconds > 0 ? new Date(Date.now() + input.maxAgeSeconds * 1000) : null,
      },
    });
    return {
      code: invite.code,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
      maxUses: invite.maxUses,
    };
  }

  async acceptInvite(code: string, userId: string) {
    const invite = await this.prisma.serverInvite.findUnique({
      where: { code },
      include: { server: true },
    });
    if (!invite) {
      throw new NotFoundException({ code: 'INVITE_INVALID', message: 'Convite inválido.' });
    }
    if (invite.expiresAt && invite.expiresAt <= new Date()) {
      throw new NotFoundException({ code: 'INVITE_EXPIRED', message: 'Esse convite expirou.' });
    }
    if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
      throw new NotFoundException({
        code: 'INVITE_EXHAUSTED',
        message: 'Esse convite já atingiu o limite de usos.',
      });
    }

    const banned = await this.prisma.serverBan.findUnique({
      where: { serverId_userId: { serverId: invite.serverId, userId } },
    });
    if (banned) {
      throw new ForbiddenException({
        code: 'BANNED',
        message: 'Você está banido desse servidor.',
      });
    }

    const already = await this.prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId: invite.serverId, userId } },
    });
    if (already) return this.detail(invite.serverId, userId);

    const everyone = await this.prisma.role.findFirstOrThrow({
      where: { serverId: invite.serverId, isEveryone: true },
    });

    await this.prisma.$transaction(async (tx) => {
      const member = await tx.serverMember.create({
        data: { serverId: invite.serverId, userId },
      });
      await tx.memberRole.create({ data: { memberId: member.id, roleId: everyone.id } });
      await tx.serverInvite.update({
        where: { id: invite.id },
        data: { uses: { increment: 1 } },
      });
    });

    await this.events.joinRoom(userId, room.server(invite.serverId));
    for (const channel of await this.prisma.channel.findMany({
      where: { serverId: invite.serverId },
      select: { id: true },
    })) {
      await this.events.joinRoom(userId, room.channel(channel.id));
    }
    this.events.emit(room.server(invite.serverId), 'member.joined', {
      serverId: invite.serverId,
      userId,
    });

    return this.detail(invite.serverId, userId);
  }

  async kick(serverId: string, actorId: string, targetId: string): Promise<void> {
    await this.permissions.assertServerPermission(serverId, actorId, Permission.KICK_MEMBERS);
    await this.permissions.assertHigherThan(serverId, actorId, targetId);
    await this.prisma.serverMember.deleteMany({ where: { serverId, userId: targetId } });
    await this.events.leaveRoom(targetId, room.server(serverId));
    this.events.emit(room.server(serverId), 'member.left', { serverId, userId: targetId });
    await this.audit.record(serverId, actorId, 'member.kicked', targetId);
  }

  async ban(serverId: string, actorId: string, targetId: string, reason?: string): Promise<void> {
    await this.permissions.assertServerPermission(serverId, actorId, Permission.BAN_MEMBERS);
    await this.permissions.assertHigherThan(serverId, actorId, targetId);
    await this.prisma.$transaction([
      this.prisma.serverBan.create({
        data: { serverId, userId: targetId, bannedById: actorId, reason: reason ?? null },
      }),
      this.prisma.serverMember.deleteMany({ where: { serverId, userId: targetId } }),
    ]);
    await this.events.leaveRoom(targetId, room.server(serverId));
    this.events.emit(room.server(serverId), 'member.left', { serverId, userId: targetId });
    await this.audit.record(serverId, actorId, 'member.banned', targetId, { reason });
  }

  async unban(serverId: string, actorId: string, targetId: string): Promise<void> {
    await this.permissions.assertServerPermission(serverId, actorId, Permission.BAN_MEMBERS);
    await this.prisma.serverBan.deleteMany({ where: { serverId, userId: targetId } });
    await this.audit.record(serverId, actorId, 'member.unbanned', targetId);
  }

  async createRole(serverId: string, userId: string, name: string) {
    await this.permissions.assertServerPermission(serverId, userId, Permission.MANAGE_ROLES);
    const highest = await this.prisma.role.findFirst({
      where: { serverId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const role = await this.prisma.role.create({
      data: { serverId, name, position: (highest?.position ?? 0) + 1 },
    });
    await this.audit.record(serverId, userId, 'role.created', role.id, { name });
    return { id: role.id, name: role.name, color: role.color, position: role.position };
  }

  /**
   * Um membro não pode conceder permissão que ele próprio não tem — evita
   * escalada de privilégio por quem tem MANAGE_ROLES.
   */
  async updateRole(
    serverId: string,
    userId: string,
    roleId: string,
    data: { name?: string; color?: string; permissions?: string },
  ) {
    await this.permissions.assertServerPermission(serverId, userId, Permission.MANAGE_ROLES);
    const actor = await this.permissions.resolveServer(serverId, userId);
    const role = await this.prisma.role.findFirstOrThrow({ where: { id: roleId, serverId } });

    let permissions: bigint | undefined;
    if (data.permissions !== undefined) {
      permissions = BigInt(data.permissions) & ALL_PERMISSIONS;
      const granting = permissions & ~role.permissions;
      if (!has(actor, Permission.ADMINISTRATOR) && (granting & ~actor) !== 0n) {
        throw new ForbiddenException({
          code: 'CANNOT_GRANT',
          message: 'Você não pode conceder uma permissão que não possui.',
        });
      }
    }

    const updated = await this.prisma.role.update({
      where: { id: roleId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(permissions !== undefined ? { permissions } : {}),
      },
    });
    await this.audit.record(serverId, userId, 'role.updated', roleId, data);
    return {
      id: updated.id,
      name: updated.name,
      color: updated.color,
      permissions: updated.permissions.toString(),
    };
  }

  async deleteRole(serverId: string, userId: string, roleId: string): Promise<void> {
    await this.permissions.assertServerPermission(serverId, userId, Permission.MANAGE_ROLES);
    const role = await this.prisma.role.findFirstOrThrow({ where: { id: roleId, serverId } });
    if (role.isEveryone) {
      throw new ForbiddenException({
        code: 'EVERYONE_ROLE',
        message: 'O cargo @everyone não pode ser removido.',
      });
    }
    await this.prisma.role.delete({ where: { id: roleId } });
    await this.audit.record(serverId, userId, 'role.deleted', roleId);
  }

  async assignRole(
    serverId: string,
    actorId: string,
    targetId: string,
    roleId: string,
    assign: boolean,
  ): Promise<void> {
    await this.permissions.assertServerPermission(serverId, actorId, Permission.MANAGE_ROLES);
    const actor = await this.permissions.assertMember(serverId, actorId);
    const role = await this.prisma.role.findFirstOrThrow({ where: { id: roleId, serverId } });
    if (!actor.isOwner && role.position >= actor.highestPosition) {
      throw new ForbiddenException({
        code: 'ROLE_TOO_HIGH',
        message: 'Você não pode gerenciar um cargo igual ou acima do seu.',
      });
    }
    const member = await this.prisma.serverMember.findUniqueOrThrow({
      where: { serverId_userId: { serverId, userId: targetId } },
    });

    if (assign) {
      await this.prisma.memberRole.upsert({
        where: { memberId_roleId: { memberId: member.id, roleId } },
        create: { memberId: member.id, roleId },
        update: {},
      });
    } else {
      if (role.isEveryone) {
        throw new ConflictException({
          code: 'EVERYONE_ROLE',
          message: 'O cargo @everyone não pode ser retirado.',
        });
      }
      await this.prisma.memberRole.deleteMany({ where: { memberId: member.id, roleId } });
    }
    await this.audit.record(serverId, actorId, 'member.roles_updated', targetId, {
      roleId,
      assign,
    });
  }
}
