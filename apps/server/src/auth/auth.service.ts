import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { loginSchema, registerSchema } from '@nexus/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig, CONFIG } from '../config/configuration';
import { TokenService } from './token.service';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string; displayName: string; avatarUrl: string | null };
}

interface DeviceInfo {
  deviceName?: string;
  ipAddress?: string;
  userAgent?: string;
}

/** Parâmetros Argon2id: perfil interativo, adequado para login desktop. */
const ARGON_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async register(
    input: z.infer<typeof registerSchema>,
    device: DeviceInfo,
  ): Promise<AuthResult> {
    // Servidor privado: cadastro exige o código combinado, se configurado.
    if (this.config.REGISTRATION_INVITE_CODE) {
      if (input.inviteCode !== this.config.REGISTRATION_INVITE_CODE) {
        throw new ForbiddenException({
          code: 'INVITE_REQUIRED',
          message: 'Código de convite inválido.',
        });
      }
    }

    const email = input.email.toLowerCase();
    const username = input.username.toLowerCase();

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
      select: { email: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'ALREADY_EXISTS',
        message: 'Já existe uma conta com esse e-mail ou nome de usuário.',
      });
    }

    const passwordHash = await argon2.hash(input.password, ARGON_OPTIONS);
    const user = await this.prisma.user.create({
      data: {
        email,
        username,
        displayName: input.displayName,
        passwordHash,
        isGlobalAdmin: this.config.INITIAL_ADMIN_EMAIL?.toLowerCase() === email,
        settings: { create: {} },
        presence: { create: { status: 'OFFLINE' } },
      },
    });

    this.logger.log(`Nova conta criada: ${user.username}`);
    return this.issueSession(user, device);
  }

  async login(input: z.infer<typeof loginSchema>, device: DeviceInfo): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });

    // Compara mesmo sem usuário para não vazar quais e-mails existem por timing.
    const hash =
      user?.passwordHash ??
      '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2E$0000000000000000000000000000000000000000000';
    const valid = await argon2.verify(hash, input.password).catch(() => false);

    if (!user || !valid) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'E-mail ou senha incorretos.',
      });
    }

    return this.issueSession(user, { ...device, deviceName: input.deviceName ?? device.deviceName });
  }

  /** Rotaciona o refresh token: o token usado é invalidado no mesmo instante. */
  async refresh(refreshToken: string, device: DeviceInfo): Promise<AuthResult> {
    const hash = this.tokens.hashRefreshToken(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hash },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException({
        code: 'SESSION_EXPIRED',
        message: 'Sua sessão expirou. Entre novamente.',
      });
    }

    const next = this.tokens.generateRefreshToken();
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: next.hash,
        lastUsedAt: new Date(),
        expiresAt: this.tokens.refreshExpiry(),
        ipAddress: device.ipAddress ?? session.ipAddress,
      },
    });

    const accessToken = await this.tokens.signAccessToken({
      sub: session.user.id,
      username: session.user.username,
      sid: session.id,
      adm: session.user.isGlobalAdmin,
    });

    return {
      accessToken,
      refreshToken: next.token,
      user: {
        id: session.user.id,
        username: session.user.username,
        displayName: session.user.displayName,
        avatarUrl: session.user.avatarUrl,
      },
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      current: s.id === currentSessionId,
    }));
  }

  /** Revoga a sessão de outro dispositivo. Só o próprio dono pode fazê-lo. */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      throw new UnauthorizedException({ code: 'NOT_FOUND', message: 'Sessão não encontrada.' });
    }
  }

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = await argon2.verify(user.passwordHash, current).catch(() => false);
    if (!ok) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Senha atual incorreta.',
      });
    }
    const passwordHash = await argon2.hash(next, ARGON_OPTIONS);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      // Trocar a senha derruba todos os dispositivos.
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async issueSession(
    user: { id: string; username: string; displayName: string; avatarUrl: string | null; isGlobalAdmin: boolean },
    device: DeviceInfo,
  ): Promise<AuthResult> {
    const refresh = this.tokens.generateRefreshToken();
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: refresh.hash,
        deviceName: device.deviceName ?? null,
        ipAddress: device.ipAddress ?? null,
        userAgent: device.userAgent ?? null,
        expiresAt: this.tokens.refreshExpiry(),
      },
    });

    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      username: user.username,
      sid: session.id,
      adm: user.isGlobalAdmin,
    });

    return {
      accessToken,
      refreshToken: refresh.token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
    };
  }
}
