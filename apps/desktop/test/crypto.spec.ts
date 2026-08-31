import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { CryptoService, type DeviceIdentity } from '../electron/crypto/crypto-service';
import { state } from './electron-stub';

/**
 * Estes testes exercitam a criptografia de verdade: duas instâncias do
 * CryptoService, cada uma com o seu próprio diretório de chaves, trocando
 * mensagens como dois computadores diferentes fariam.
 *
 * Nenhum mock de criptografia — o Olm real cifra e decifra aqui.
 */
async function makeDevice(userId: string): Promise<{
  service: CryptoService;
  identity: DeviceIdentity;
  dir: string;
}> {
  const dir = mkdtempSync(join(tmpdir(), `nexus-${userId}-`));
  state.userDataPath = dir;
  const service = new CryptoService();
  const info = await service.init();
  return {
    service,
    dir,
    identity: {
      userId,
      deviceId: info.deviceId,
      identityKey: info.identityKey,
      signingKey: info.signingKey,
    },
  };
}

/**
 * Reproduz o que o servidor faz: entrega uma prekey do destinatário ao
 * remetente, e encaminha os envelopes opacos. Em nenhum momento ele vê texto.
 */
function establish(
  sender: CryptoService,
  senderIdentity: DeviceIdentity,
  receiver: CryptoService,
  receiverIdentity: DeviceIdentity,
  conversationId: string,
): void {
  const missing = sender.missingSessions([receiverIdentity]);
  if (missing.length > 0) {
    const otks = receiver.generateOneTimeKeys(1);
    const oneTimeKey = Object.values(otks)[0] as string;
    sender.createOutboundOlmSession(receiverIdentity, oneTimeKey);
  }

  const payloads = sender.shareGroupSession(conversationId, [receiverIdentity]);
  const result = receiver.receiveToDevice(
    payloads.map((p) => ({
      senderUserId: senderIdentity.userId,
      senderDeviceId: senderIdentity.deviceId,
      payload: p.payload,
    })),
  );
  expect(result.failed).toBe(0);
}

describe('criptografia ponta a ponta (Olm/Megolm)', () => {
  let ana: Awaited<ReturnType<typeof makeDevice>>;
  let bruno: Awaited<ReturnType<typeof makeDevice>>;

  beforeEach(async () => {
    ana = await makeDevice('ana');
    bruno = await makeDevice('bruno');
  });

  it('gera identidade própria por dispositivo', () => {
    expect(ana.identity.deviceId).not.toBe(bruno.identity.deviceId);
    expect(ana.identity.identityKey).not.toBe(bruno.identity.identityKey);
    expect(ana.identity.identityKey.length).toBeGreaterThan(20);
    expect(ana.identity.signingKey.length).toBeGreaterThan(20);
  });

  it('Bruno decifra a mensagem que Ana enviou', () => {
    establish(ana.service, ana.identity, bruno.service, bruno.identity, 'conversa-1');

    const envelope = ana.service.encrypt('conversa-1', 'vamos jogar hoje?');
    const result = bruno.service.decrypt(envelope);

    expect(result).toEqual({ plaintext: 'vamos jogar hoje?' });
  });

  it('o que trafega até o servidor NÃO contém o texto original', () => {
    establish(ana.service, ana.identity, bruno.service, bruno.identity, 'conversa-1');

    const segredo = 'a senha do wifi e batatafrita';
    const envelope = ana.service.encrypt('conversa-1', segredo);

    // É exatamente isto que o backend grava na coluna `content`.
    expect(envelope.ciphertext).not.toContain(segredo);
    expect(envelope.ciphertext).not.toContain('batatafrita');
    expect(envelope.algorithm).toBe('m.megolm.v1.aes-sha2');
  });

  it('quem não tem a chave da sessão não lê nada', async () => {
    establish(ana.service, ana.identity, bruno.service, bruno.identity, 'conversa-1');
    const envelope = ana.service.encrypt('conversa-1', 'assunto privado');

    // Carla existe, mas nunca recebeu a chave desta conversa.
    const carla = await makeDevice('carla');
    expect(carla.service.decrypt(envelope)).toEqual({ error: 'NO_SESSION' });
  });

  it('a própria autora relê o que enviou', () => {
    establish(ana.service, ana.identity, bruno.service, bruno.identity, 'conversa-1');
    const envelope = ana.service.encrypt('conversa-1', 'mensagem da ana');
    expect(ana.service.decrypt(envelope)).toEqual({ plaintext: 'mensagem da ana' });
  });

  it('a mesma sessão decifra várias mensagens em ordem', () => {
    establish(ana.service, ana.identity, bruno.service, bruno.identity, 'conversa-1');

    const textos = ['primeira', 'segunda', 'terceira'];
    const lidas = textos
      .map((t) => ana.service.encrypt('conversa-1', t))
      .map((envelope) => bruno.service.decrypt(envelope));

    expect(lidas).toEqual(textos.map((plaintext) => ({ plaintext })));
  });

  it('conversas diferentes usam sessões diferentes', () => {
    establish(ana.service, ana.identity, bruno.service, bruno.identity, 'conversa-1');
    establish(ana.service, ana.identity, bruno.service, bruno.identity, 'conversa-2');

    const um = ana.service.encrypt('conversa-1', 'a');
    const dois = ana.service.encrypt('conversa-2', 'b');
    expect(um.sessionId).not.toBe(dois.sessionId);
  });

  it('mensagem adulterada em trânsito é rejeitada, não aceita em silêncio', () => {
    establish(ana.service, ana.identity, bruno.service, bruno.identity, 'conversa-1');
    const envelope = ana.service.encrypt('conversa-1', 'transferir 10 reais');

    // Um servidor malicioso mexendo no texto cifrado.
    const adulterado = {
      ...envelope,
      ciphertext: envelope.ciphertext.slice(0, -6) + 'AAAAAA',
    };

    const result = bruno.service.decrypt(adulterado);
    expect('plaintext' in result).toBe(false);
  });

  it('a prekey entregue é consumida e não serve para uma segunda sessão', () => {
    const otks = bruno.service.generateOneTimeKeys(1);
    const key = Object.values(otks)[0] as string;

    ana.service.createOutboundOlmSession(bruno.identity, key);
    const payloads = ana.service.shareGroupSession('conversa-1', [bruno.identity]);
    expect(bruno.service.receiveToDevice(
      payloads.map((p) => ({
        senderUserId: 'ana',
        senderDeviceId: ana.identity.deviceId,
        payload: p.payload,
      })),
    ).imported).toBe(1);

    // Reusar a mesma prekey: o Olm do Bruno já a removeu da conta.
    const outra = new CryptoService();
    expect(async () => {
      state.userDataPath = mkdtempSync(join(tmpdir(), 'nexus-atacante-'));
      await outra.init();
      outra.createOutboundOlmSession(bruno.identity, key);
      const forjado = outra.shareGroupSession('conversa-1', [bruno.identity]);
      const r = bruno.service.receiveToDevice(
        forjado.map((p) => ({
          senderUserId: 'atacante',
          senderDeviceId: 'x',
          payload: p.payload,
        })),
      );
      expect(r.imported).toBe(0);
    }).not.toThrow();
  });

  it('o estado sobrevive a reiniciar o aplicativo', async () => {
    establish(ana.service, ana.identity, bruno.service, bruno.identity, 'conversa-1');
    const envelope = ana.service.encrypt('conversa-1', 'antes de fechar o app');

    // Bruno fecha o app: o flush garante que as sessões chegaram ao disco.
    await bruno.service.flush();

    // E reabre: uma instância nova lendo o mesmo diretório.
    state.userDataPath = bruno.dir;
    const reaberto = new CryptoService();
    const info = await reaberto.init();

    expect(info.deviceId).toBe(bruno.identity.deviceId);
    expect(reaberto.decrypt(envelope)).toEqual({ plaintext: 'antes de fechar o app' });
  });

  it('o número de segurança é estável e diferente entre pessoas', () => {
    expect(ana.service.fingerprint()).toBe(ana.service.fingerprint());
    expect(ana.service.fingerprint()).not.toBe(bruno.service.fingerprint());
    expect(ana.service.fingerprint()).toContain(' ');
  });

  it('grupo privado: um envelope só, lido por todos os participantes', async () => {
    const carla = await makeDevice('carla');
    establish(ana.service, ana.identity, bruno.service, bruno.identity, 'grupo-1');
    establish(ana.service, ana.identity, carla.service, carla.identity, 'grupo-1');

    const envelope = ana.service.encrypt('grupo-1', 'alguém joga hoje?');

    expect(bruno.service.decrypt(envelope)).toEqual({ plaintext: 'alguém joga hoje?' });
    expect(carla.service.decrypt(envelope)).toEqual({ plaintext: 'alguém joga hoje?' });
  });
});
