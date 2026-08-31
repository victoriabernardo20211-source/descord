import type { EncryptedEnvelope } from '@nexus/shared';
import { bridge, isDesktop } from './bridge';
import type { ApiClient } from './api';

export interface RemoteDevice {
  userId: string;
  deviceId: string;
  identityKey: string;
  signingKey: string;
  displayName?: string | null;
}

const ONE_TIME_KEY_TARGET = 50;

/**
 * Orquestra a criptografia ponta a ponta do lado do cliente.
 *
 * Esta classe NÃO faz criptografia: ela coordena a rede (buscar chaves
 * públicas, reivindicar prekeys, encaminhar envelopes) e delega toda operação
 * criptográfica ao processo principal, onde as chaves privadas vivem.
 */
export class E2eeManager {
  deviceId = '';
  identityKey = '';
  signingKey = '';
  /** false quando o SO não protege a chave em repouso (Linux sem keyring). */
  encryptionAtRest = true;
  ready = false;

  /** conversationId → dispositivos para os quais a sessão já foi compartilhada. */
  private sharedWith = new Map<string, Set<string>>();

  constructor(private readonly api: ApiClient) {}

  get available(): boolean {
    return isDesktop;
  }

  /** Cria (ou recupera) o dispositivo e publica suas chaves públicas. */
  async register(displayName: string): Promise<void> {
    const identity = await bridge.e2ee.init();
    this.deviceId = identity.deviceId;
    this.identityKey = identity.identityKey;
    this.signingKey = identity.signingKey;
    this.encryptionAtRest = identity.encryptionAtRest;

    const oneTimeKeys = await bridge.e2ee.generateOneTimeKeys(ONE_TIME_KEY_TARGET);
    const result = await this.api.post<{ oneTimeKeyCount: number }>('/e2ee/devices', {
      deviceId: identity.deviceId,
      identityKey: identity.identityKey,
      signingKey: identity.signingKey,
      displayName,
      oneTimeKeys,
    });

    this.ready = true;
    if (result.oneTimeKeyCount < ONE_TIME_KEY_TARGET / 2) await this.replenishKeys();
    await this.drainToDevice();
  }

  /** Repõe o estoque de prekeys para que ninguém fique sem conseguir te escrever. */
  async replenishKeys(): Promise<void> {
    const oneTimeKeys = await bridge.e2ee.generateOneTimeKeys(ONE_TIME_KEY_TARGET);
    await this.api.post('/e2ee/keys/upload', { deviceId: this.deviceId, oneTimeKeys });
  }

  /** Busca e importa as chaves de sessão que outros dispositivos nos enviaram. */
  async drainToDevice(): Promise<number> {
    if (!this.ready) return 0;
    const messages = await this.api.get<
      { senderUserId: string; senderDeviceId: string; payload: string }[]
    >(`/e2ee/to-device/${this.deviceId}`);
    if (messages.length === 0) return 0;
    const result = await bridge.e2ee.receiveToDevice(messages);
    return result.imported;
  }

  /**
   * Garante que todos os dispositivos dos participantes conseguem ler a próxima
   * mensagem desta conversa. Chamado antes de cada envio; é barato depois da
   * primeira vez, porque só age sobre dispositivos ainda não atendidos.
   */
  async ensureSession(conversationId: string, participantIds: string[]): Promise<RemoteDevice[]> {
    const keys = await this.api.post<Record<string, RemoteDevice[]>>('/e2ee/keys/query', {
      userIds: participantIds,
    });

    const devices: RemoteDevice[] = [];
    for (const [userId, list] of Object.entries(keys)) {
      for (const device of list) {
        // O próprio dispositivo não precisa receber a chave por Olm.
        if (device.deviceId === this.deviceId) continue;
        devices.push({ ...device, userId });
      }
    }
    if (devices.length === 0) return [];

    // 1. Abrir sessão Olm com quem ainda não tem uma.
    const missing = await bridge.e2ee.missingSessions(devices);
    if (missing.length > 0) {
      const claimed = await this.api.post<
        Record<string, Record<string, { keyId: string; key: string }>>
      >('/e2ee/keys/claim', {
        requests: missing.map((d) => ({ userId: d.userId, deviceId: d.deviceId })),
      });

      const entries: { device: RemoteDevice; oneTimeKey: string }[] = [];
      for (const device of missing) {
        const key = claimed[device.userId]?.[device.deviceId];
        // Sem prekey disponível o dispositivo fica de fora até repor o estoque.
        if (key) entries.push({ device, oneTimeKey: key.key });
      }
      if (entries.length > 0) await bridge.e2ee.createSessions(entries);
    }

    // 2. Entregar a chave da sessão de grupo a quem ainda não a recebeu.
    const already = this.sharedWith.get(conversationId) ?? new Set<string>();
    const pending = devices.filter((d) => !already.has(`${d.userId}:${d.deviceId}`));
    if (pending.length > 0) {
      const payloads = await bridge.e2ee.shareSession(conversationId, pending);
      if (payloads.length > 0) {
        await this.api.post('/e2ee/to-device', {
          deviceId: this.deviceId,
          messages: payloads,
        });
        for (const payload of payloads) already.add(`${payload.userId}:${payload.deviceId}`);
        this.sharedWith.set(conversationId, already);
      }
    }

    return devices;
  }

  async encrypt(conversationId: string, plaintext: string): Promise<EncryptedEnvelope> {
    return (await bridge.e2ee.encrypt(conversationId, plaintext)) as EncryptedEnvelope;
  }

  async decrypt(envelope: EncryptedEnvelope): Promise<string | null> {
    const result = await bridge.e2ee.decrypt(envelope);
    return 'plaintext' in result ? result.plaintext : null;
  }

  /**
   * Alguém entrou ou saiu: a sessão de grupo é descartada para que a próxima
   * mensagem use uma chave nova. Quem saiu não lê o que vier depois.
   */
  async rotate(conversationId: string): Promise<void> {
    this.sharedWith.delete(conversationId);
    await bridge.e2ee.rotateSession(conversationId);
  }

  /** Um dispositivo novo apareceu: reenviar a chave para ele na próxima mensagem. */
  invalidateDevice(userId: string): void {
    for (const [conversationId, set] of this.sharedWith) {
      for (const entry of [...set]) {
        if (entry.startsWith(`${userId}:`)) set.delete(entry);
      }
      this.sharedWith.set(conversationId, set);
    }
  }

  fingerprint(signingKey?: string): Promise<string> {
    return bridge.e2ee.fingerprint(signingKey);
  }

  async reset(): Promise<void> {
    this.sharedWith.clear();
    this.ready = false;
    await bridge.e2ee.reset();
  }
}
