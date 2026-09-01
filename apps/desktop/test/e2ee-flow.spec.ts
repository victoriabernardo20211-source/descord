import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CryptoService } from '../electron/crypto/crypto-service';
import { state } from './electron-stub';

/**
 * Conversa de ponta a ponta com a orquestração real no meio.
 *
 * Os testes de `crypto.spec.ts` provam que o Olm cifra e decifra. Estes provam
 * a camada de cima — quem pede prekey, quem entrega a chave da sessão, quem
 * guarda o que já foi entregue —, que é onde os defeitos de verdade apareceram:
 * cada lado lia só as próprias mensagens, porque a chave nunca chegava.
 *
 * O servidor é falso, mas copia o comportamento do real: guarda os envelopes,
 * entrega uma vez e apaga.
 */
type Device = { userId: string; deviceId: string; identityKey: string; signingKey: string };

class FakeServer {
  private oneTimeKeys = new Map<string, Record<string, string>>();
  private toDevice: { target: string; senderUserId: string; senderDeviceId: string; payload: string }[] = [];
  devices = new Map<string, Device>();

  publish(device: Device, keys: Record<string, string>): void {
    this.devices.set(device.deviceId, device);
    this.oneTimeKeys.set(device.deviceId, { ...(this.oneTimeKeys.get(device.deviceId) ?? {}), ...keys });
  }

  query(userIds: string[]): Record<string, Device[]> {
    const out: Record<string, Device[]> = {};
    for (const device of this.devices.values()) {
      if (userIds.includes(device.userId)) (out[device.userId] ??= []).push(device);
    }
    return out;
  }

  /** Uma prekey é consumida e nunca reaproveitada — como no servidor. */
  claim(requests: { userId: string; deviceId: string }[]): Record<string, Record<string, { keyId: string; key: string }>> {
    const out: Record<string, Record<string, { keyId: string; key: string }>> = {};
    for (const request of requests) {
      const pool = this.oneTimeKeys.get(request.deviceId) ?? {};
      const [keyId, key] = Object.entries(pool)[0] ?? [];
      if (!keyId || !key) continue;
      delete pool[keyId];
      (out[request.userId] ??= {})[request.deviceId] = { keyId, key };
    }
    return out;
  }

  send(senderUserId: string, senderDeviceId: string, messages: { userId: string; deviceId: string; payload: string }[]): void {
    for (const message of messages) {
      this.toDevice.push({ target: message.deviceId, senderUserId, senderDeviceId, payload: message.payload });
    }
  }

  drain(deviceId: string): { senderUserId: string; senderDeviceId: string; payload: string }[] {
    const mine = this.toDevice.filter((m) => m.target === deviceId);
    this.toDevice = this.toDevice.filter((m) => m.target !== deviceId);
    return mine.map(({ senderUserId, senderDeviceId, payload }) => ({ senderUserId, senderDeviceId, payload }));
  }
}

/** Um cliente: CryptoService real por trás do E2eeManager real. */
async function makeClient(server: FakeServer, userId: string) {
  state.userDataPath = mkdtempSync(join(tmpdir(), `nexus-flow-${userId}-`));
  const crypto = new CryptoService();
  const info = await crypto.init();
  const device: Device = { ...info, userId };

  vi.doMock('../src/lib/bridge', () => ({
    isDesktop: true,
    bridge: {
      e2ee: {
        init: async () => info,
        generateOneTimeKeys: async (count: number) => crypto.generateOneTimeKeys(count),
        missingSessions: async (devices: Device[]) => crypto.missingSessions(devices),
        createSessions: async (entries: { device: Device; oneTimeKey: string }[]) => {
          for (const entry of entries) crypto.createOutboundOlmSession(entry.device, entry.oneTimeKey);
          return { created: entries.length };
        },
        shareSession: async (conversationId: string, devices: Device[]) =>
          crypto.shareGroupSession(conversationId, devices),
        receiveToDevice: async (messages: never[]) => crypto.receiveToDevice(messages),
        rotateSession: async (conversationId: string) => crypto.rotateGroupSession(conversationId),
        encrypt: async (conversationId: string, plaintext: string) =>
          crypto.encrypt(conversationId, plaintext),
        decrypt: async (envelope: never) => crypto.decrypt(envelope),
      },
    },
  }));
  vi.resetModules();
  const { E2eeManager } = await import('../src/lib/e2ee');

  const api = {
    get: async (path: string) => server.drain(path.split('/').pop() as string),
    post: async (path: string, body: never) => {
      const payload = body as Record<string, never>;
      if (path === '/e2ee/devices') {
        server.publish(device, payload.oneTimeKeys as unknown as Record<string, string>);
        return { oneTimeKeyCount: 50 };
      }
      if (path === '/e2ee/keys/upload') {
        server.publish(device, payload.oneTimeKeys as unknown as Record<string, string>);
        return {};
      }
      if (path === '/e2ee/keys/query') return server.query(payload.userIds as unknown as string[]);
      if (path === '/e2ee/keys/claim')
        return server.claim(payload.requests as unknown as { userId: string; deviceId: string }[]);
      if (path === '/e2ee/to-device') {
        server.send(userId, device.deviceId, payload.messages as unknown as never[]);
        return { sent: 1 };
      }
      throw new Error(`rota não prevista no teste: ${path}`);
    },
  };

  const manager = new E2eeManager(api as never);
  await manager.register(userId);
  return { manager, crypto, device };
}

const CONVERSA = 'conv-1';

describe('conversa privada entre dois computadores', () => {
  it('cada lado lê o que o outro escreveu', async () => {
    const server = new FakeServer();
    const bel = await makeClient(server, 'bel');
    const amigo = await makeClient(server, 'amigo');
    const participantes = ['bel', 'amigo'];

    await bel.manager.ensureSession(CONVERSA, participantes);
    const daBel = await bel.manager.encrypt(CONVERSA, 'oi, tudo bem?');

    await amigo.manager.ensureSession(CONVERSA, participantes);
    const doAmigo = await amigo.manager.encrypt(CONVERSA, 'tudo, e você?');

    // O ponto do teste: cada um lê a mensagem do OUTRO, não só a sua.
    await expect(amigo.manager.decryptWithRefresh(daBel)).resolves.toBe('oi, tudo bem?');
    await expect(bel.manager.decryptWithRefresh(doAmigo)).resolves.toBe('tudo, e você?');
  });

  it('continua legível depois de a sessão do remetente ser trocada', async () => {
    const server = new FakeServer();
    const bel = await makeClient(server, 'bel');
    const amigo = await makeClient(server, 'amigo');
    const participantes = ['bel', 'amigo'];

    await bel.manager.ensureSession(CONVERSA, participantes);
    const antes = await bel.manager.encrypt(CONVERSA, 'antes da troca');
    await expect(amigo.manager.decryptWithRefresh(antes)).resolves.toBe('antes da troca');

    // O Megolm troca a sessão de saída por idade ou volume. Quando isso
    // acontece, a chave nova precisa ser entregue de novo — senão o remetente
    // segue lendo o que escreve e o outro lado para de ler, para sempre.
    await bel.manager.rotate(CONVERSA);
    await bel.manager.ensureSession(CONVERSA, participantes);
    const depois = await bel.manager.encrypt(CONVERSA, 'depois da troca');

    await expect(amigo.manager.decryptWithRefresh(depois)).resolves.toBe('depois da troca');
  });
});
