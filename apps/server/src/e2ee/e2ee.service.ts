import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService, room } from '../realtime/events.service';

/**
 * Serviço de suporte à criptografia ponta a ponta (Olm/Megolm).
 *
 * O QUE ESTE SERVIÇO **NÃO** FAZ: ele nunca cifra, nunca decifra e nunca vê uma
 * chave privada. Ele é um diretório de chaves públicas e um encaminhador de
 * envelopes opacos. Toda a criptografia acontece nos dispositivos.
 *
 * O servidor consegue ver: quem conversa com quem, quando, e o tamanho das
 * mensagens. Isso é metadado e não é protegido — ver docs/E2EE.md.
 */
@Injectable()
export class E2eeService {
  private readonly logger = new Logger(E2eeService.name);

  /** Abaixo disso o dispositivo repõe o estoque de prekeys. */
  static readonly ONE_TIME_KEY_TARGET = 50;
  private static readonly TO_DEVICE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /** Registra (ou atualiza) o dispositivo e publica suas chaves públicas. */
  async registerDevice(
    userId: string,
    input: {
      deviceId: string;
      identityKey: string;
      signingKey: string;
      displayName?: string;
      oneTimeKeys?: Record<string, string>;
    },
  ) {
    const existing = await this.prisma.device.findUnique({
      where: { userId_deviceId: { userId, deviceId: input.deviceId } },
    });

    // Trocar a chave de identidade de um deviceId já registrado seria um
    // ataque de substituição de dispositivo. Recusamos: o app gera um deviceId
    // novo quando reinstala, e os contatos veem um dispositivo novo (não confiável).
    if (existing && existing.identityKey !== input.identityKey) {
      throw new ForbiddenException({
        code: 'DEVICE_KEY_MISMATCH',
        message:
          'Esse dispositivo já está registrado com outra chave. Gere um dispositivo novo.',
      });
    }

    const device = existing
      ? await this.prisma.device.update({
          where: { id: existing.id },
          data: { lastSeenAt: new Date(), displayName: input.displayName ?? existing.displayName },
        })
      : await this.prisma.device.create({
          data: {
            userId,
            deviceId: input.deviceId,
            identityKey: input.identityKey,
            signingKey: input.signingKey,
            displayName: input.displayName ?? null,
          },
        });

    if (input.oneTimeKeys) await this.uploadOneTimeKeys(userId, input.deviceId, input.oneTimeKeys);

    if (!existing) {
      this.logger.log(`Novo dispositivo E2EE registrado para o usuário ${userId}`);
      // Os contatos precisam saber que existe um dispositivo novo para reenviar
      // as chaves de sessão — e para desconfiar, se não foi o dono que criou.
      await this.announceDevice(userId, device.deviceId);
    }

    return {
      deviceId: device.deviceId,
      identityKey: device.identityKey,
      signingKey: device.signingKey,
      oneTimeKeyCount: await this.prisma.oneTimeKey.count({ where: { deviceId: device.id } }),
    };
  }

  async uploadOneTimeKeys(
    userId: string,
    deviceId: string,
    keys: Record<string, string>,
  ): Promise<{ count: number }> {
    const device = await this.requireDevice(userId, deviceId);

    // createMany + skipDuplicates: reenviar a mesma prekey não gera erro nem
    // sobrescreve uma que já foi reivindicada.
    await this.prisma.oneTimeKey.createMany({
      data: Object.entries(keys).map(([keyId, key]) => ({ deviceId: device.id, keyId, key })),
      skipDuplicates: true,
    });

    const count = await this.prisma.oneTimeKey.count({ where: { deviceId: device.id } });
    await this.prisma.device.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });
    return { count };
  }

  /** Chaves públicas de todos os dispositivos de um conjunto de usuários. */
  async queryKeys(userIds: string[]) {
    const devices = await this.prisma.device.findMany({
      where: { userId: { in: [...new Set(userIds)] } },
      orderBy: { createdAt: 'asc' },
    });

    const byUser: Record<
      string,
      { deviceId: string; identityKey: string; signingKey: string; displayName: string | null }[]
    > = {};
    for (const device of devices) {
      (byUser[device.userId] ??= []).push({
        deviceId: device.deviceId,
        identityKey: device.identityKey,
        signingKey: device.signingKey,
        displayName: device.displayName,
      });
    }
    return byUser;
  }

  /**
   * Entrega uma prekey por dispositivo pedido, APAGANDO-A no mesmo passo.
   * A remoção é o que garante que a mesma prekey nunca inicie duas sessões.
   */
  async claimOneTimeKeys(requests: { userId: string; deviceId: string }[]) {
    const claimed: Record<string, Record<string, { keyId: string; key: string }>> = {};

    for (const request of requests) {
      const device = await this.prisma.device.findUnique({
        where: { userId_deviceId: { userId: request.userId, deviceId: request.deviceId } },
      });
      if (!device) continue;

      // deleteMany devolve a contagem, então buscamos e apagamos em transação
      // para que dois pedidos simultâneos não recebam a mesma chave.
      const key = await this.prisma.$transaction(async (tx) => {
        const candidate = await tx.oneTimeKey.findFirst({
          where: { deviceId: device.id },
          orderBy: { createdAt: 'asc' },
        });
        if (!candidate) return null;
        const removed = await tx.oneTimeKey.deleteMany({ where: { id: candidate.id } });
        return removed.count === 1 ? candidate : null;
      });

      if (!key) {
        this.logger.warn(
          `Dispositivo ${request.deviceId} sem prekeys disponíveis — ele precisa repor.`,
        );
        continue;
      }
      (claimed[request.userId] ??= {})[request.deviceId] = { keyId: key.keyId, key: key.key };
    }

    return claimed;
  }

  /**
   * Encaminha um envelope cifrado de um dispositivo para outro (distribuição de
   * chave de sessão Megolm). O payload é opaco: o servidor não abre.
   */
  async sendToDevice(
    senderUserId: string,
    senderDeviceId: string,
    messages: { userId: string; deviceId: string; payload: string }[],
  ): Promise<{ sent: number }> {
    await this.requireDevice(senderUserId, senderDeviceId);

    const expiresAt = new Date(Date.now() + E2eeService.TO_DEVICE_TTL_MS);
    let sent = 0;

    for (const message of messages) {
      await this.prisma.toDeviceMessage.create({
        data: {
          targetUserId: message.userId,
          targetDeviceId: message.deviceId,
          senderUserId,
          senderDeviceId,
          payload: message.payload,
          expiresAt,
        },
      });
      sent += 1;
      // Acorda o destinatário se ele estiver online; senão ele busca no próximo login.
      this.events.emit(room.user(message.userId), 'e2ee.to_device', {
        targetDeviceId: message.deviceId,
      });
    }

    return { sent };
  }

  /** Busca e consome os envelopes destinados a este dispositivo. */
  async drainToDevice(userId: string, deviceId: string) {
    await this.requireDevice(userId, deviceId);

    const messages = await this.prisma.toDeviceMessage.findMany({
      where: { targetUserId: userId, targetDeviceId: deviceId, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    if (messages.length === 0) return [];

    await this.prisma.toDeviceMessage.deleteMany({
      where: { id: { in: messages.map((m) => m.id) } },
    });

    return messages.map((m) => ({
      senderUserId: m.senderUserId,
      senderDeviceId: m.senderDeviceId,
      payload: m.payload,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  async listMyDevices(userId: string, currentDeviceId?: string) {
    const devices = await this.prisma.device.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { oneTimeKeys: true } } },
    });
    return devices.map((d) => ({
      deviceId: d.deviceId,
      displayName: d.displayName,
      identityKey: d.identityKey,
      signingKey: d.signingKey,
      createdAt: d.createdAt.toISOString(),
      lastSeenAt: d.lastSeenAt.toISOString(),
      oneTimeKeyCount: d._count.oneTimeKeys,
      current: d.deviceId === currentDeviceId,
    }));
  }

  /** Remove um dispositivo próprio (PC perdido, reinstalação). */
  async deleteDevice(userId: string, deviceId: string): Promise<void> {
    const result = await this.prisma.device.deleteMany({ where: { userId, deviceId } });
    if (result.count === 0) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Dispositivo não encontrado.',
      });
    }
    await this.announceDevice(userId, deviceId, true);
  }

  /** Avisa amigos e colegas de conversa que a lista de dispositivos mudou. */
  private async announceDevice(userId: string, deviceId: string, removed = false): Promise<void> {
    const conversations = await this.prisma.directConversationParticipant.findMany({
      where: { conversation: { participants: { some: { userId } } } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const targets = [...new Set(conversations.map((c) => room.user(c.userId)))];
    if (targets.length > 0) {
      this.events.emit(targets, 'e2ee.devices_changed', { userId, deviceId, removed });
    }
  }

  private async requireDevice(userId: string, deviceId: string) {
    const device = await this.prisma.device.findUnique({
      where: { userId_deviceId: { userId, deviceId } },
    });
    if (!device) {
      throw new NotFoundException({
        code: 'DEVICE_NOT_REGISTERED',
        message: 'Dispositivo não registrado.',
      });
    }
    return device;
  }

  /** Envelopes não buscados não ficam guardados para sempre. */
  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredToDevice(): Promise<void> {
    const result = await this.prisma.toDeviceMessage.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    if (result.count > 0) {
      this.logger.log(`${result.count} envelope(s) de dispositivo expirado(s) removido(s).`);
    }
  }
}
