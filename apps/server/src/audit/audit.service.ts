import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Registro de ações administrativas de servidor. Nunca registra conteúdo de DM
 * — mensagens privadas não deixam rastro em lugar nenhum.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    serverId: string,
    actorId: string,
    action: string,
    targetId?: string,
    metadata?: unknown,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          serverId,
          actorId,
          action,
          targetId: targetId ?? null,
          metadata: (metadata ?? undefined) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      // Auditoria nunca derruba a ação principal.
      this.logger.warn(`Falha ao registrar auditoria ${action}: ${(err as Error).message}`);
    }
  }

  async list(serverId: string, limit = 50) {
    return this.prisma.auditLog.findMany({
      where: { serverId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      include: { actor: { select: { id: true, username: true, displayName: true } } },
    });
  }
}
