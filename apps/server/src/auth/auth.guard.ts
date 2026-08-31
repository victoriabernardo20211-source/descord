import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../common/public.decorator';
import { TokenService } from './token.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'NO_TOKEN', message: 'Autenticação necessária.' });
    }

    let payload;
    try {
      payload = await this.tokens.verifyAccessToken(header.slice(7));
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Sessão inválida.' });
    }

    // Revogação precisa valer imediatamente, então a sessão é conferida no banco.
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      select: { revokedAt: true, expiresAt: true, userId: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: 'Sessão encerrada.' });
    }

    req.user = {
      id: session.userId,
      username: payload.username,
      sessionId: payload.sid,
      isGlobalAdmin: payload.adm,
    };
    return true;
  }
}
