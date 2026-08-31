import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ALL_PERMISSIONS, has, Permission } from '@nexus/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface MemberContext {
  memberId: string;
  serverId: string;
  isOwner: boolean;
  roleIds: string[];
  /** Maior position entre os cargos do membro — define a hierarquia. */
  highestPosition: number;
  basePermissions: bigint;
}

/**
 * ÚNICO lugar do sistema que decide permissão. Controllers e gateways chamam
 * daqui — nunca reimplementam a regra.
 *
 * Ordem de resolução (do mais genérico ao mais específico):
 *   owner → @everyone → cargos do membro → override @everyone no canal →
 *   overrides dos cargos no canal (deny agregado, depois allow agregado) →
 *   override do próprio membro no canal.
 */
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMemberContext(serverId: string, userId: string): Promise<MemberContext | null> {
    const member = await this.prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId } },
      include: {
        server: { select: { ownerId: true } },
        roles: { include: { role: true } },
      },
    });
    if (!member) return null;

    const isOwner = member.server.ownerId === userId;
    let basePermissions = 0n;
    let highestPosition = 0;
    for (const mr of member.roles) {
      basePermissions |= mr.role.permissions;
      if (mr.role.position > highestPosition) highestPosition = mr.role.position;
    }

    return {
      memberId: member.id,
      serverId,
      isOwner,
      roleIds: member.roles.map((r) => r.roleId),
      highestPosition: isOwner ? Number.MAX_SAFE_INTEGER : highestPosition,
      basePermissions: isOwner ? ALL_PERMISSIONS : basePermissions,
    };
  }

  /** Permissões efetivas no servidor, ignorando overrides de canal. */
  async resolveServer(serverId: string, userId: string): Promise<bigint> {
    const ctx = await this.getMemberContext(serverId, userId);
    if (!ctx) return 0n;
    if (ctx.isOwner || has(ctx.basePermissions, Permission.ADMINISTRATOR)) return ALL_PERMISSIONS;
    return ctx.basePermissions;
  }

  /** Permissões efetivas dentro de um canal, já aplicando os overrides. */
  async resolveChannel(channelId: string, userId: string): Promise<bigint> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true },
    });
    if (!channel) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Canal não encontrado.' });

    const ctx = await this.getMemberContext(channel.serverId, userId);
    if (!ctx) return 0n;
    if (ctx.isOwner || has(ctx.basePermissions, Permission.ADMINISTRATOR)) return ALL_PERMISSIONS;

    const [everyoneRole, overrides] = await Promise.all([
      this.prisma.role.findFirst({
        where: { serverId: channel.serverId, isEveryone: true },
        select: { id: true },
      }),
      this.prisma.channelPermission.findMany({ where: { channelId } }),
    ]);

    let permissions = ctx.basePermissions;

    const everyoneOverride = overrides.find((o) => o.roleId && o.roleId === everyoneRole?.id);
    if (everyoneOverride) {
      permissions &= ~everyoneOverride.deny;
      permissions |= everyoneOverride.allow;
    }

    // Cargos: todos os denies primeiro, depois todos os allows (allow vence).
    let roleAllow = 0n;
    let roleDeny = 0n;
    for (const o of overrides) {
      if (!o.roleId || o.roleId === everyoneRole?.id) continue;
      if (!ctx.roleIds.includes(o.roleId)) continue;
      roleAllow |= o.allow;
      roleDeny |= o.deny;
    }
    permissions &= ~roleDeny;
    permissions |= roleAllow;

    // Override do próprio membro é o mais específico e tem a palavra final.
    const memberOverride = overrides.find((o) => o.userId === userId);
    if (memberOverride) {
      permissions &= ~memberOverride.deny;
      permissions |= memberOverride.allow;
    }

    return permissions;
  }

  async assertServerPermission(
    serverId: string,
    userId: string,
    permission: bigint,
  ): Promise<void> {
    const bits = await this.resolveServer(serverId, userId);
    if (!has(bits, permission)) throw this.forbidden();
  }

  async assertChannelPermission(
    channelId: string,
    userId: string,
    ...permissions: bigint[]
  ): Promise<void> {
    const bits = await this.resolveChannel(channelId, userId);
    // VIEW_CHANNEL é pré-requisito de qualquer ação dentro do canal.
    if (!has(bits, Permission.VIEW_CHANNEL)) throw this.forbidden();
    for (const permission of permissions) {
      if (!has(bits, permission)) throw this.forbidden();
    }
  }

  async assertMember(serverId: string, userId: string): Promise<MemberContext> {
    const ctx = await this.getMemberContext(serverId, userId);
    if (!ctx) throw this.forbidden();
    return ctx;
  }

  /**
   * Um membro só pode agir sobre outro (expulsar, banir, editar cargos) se estiver
   * estritamente acima na hierarquia. O dono está acima de todos e é intocável.
   */
  async assertHigherThan(serverId: string, actorId: string, targetId: string): Promise<void> {
    const [actor, target] = await Promise.all([
      this.getMemberContext(serverId, actorId),
      this.getMemberContext(serverId, targetId),
    ]);
    if (!actor || !target) throw this.forbidden();
    if (target.isOwner) throw this.forbidden();
    if (actor.isOwner) return;
    if (actor.highestPosition <= target.highestPosition) throw this.forbidden();
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'MISSING_PERMISSION',
      message: 'Você não tem permissão para fazer isso.',
    });
  }
}
