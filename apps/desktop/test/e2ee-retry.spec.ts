import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * A corrida que este arquivo cobre:
 *
 * quem envia publica a chave da sessão e a mensagem em duas requisições, e nada
 * garante que a chave chegue primeiro. Quando a mensagem chegava antes, a
 * decifragem falhava e o cliente desistia — a mensagem ficava ilegível para
 * sempre, dizendo que era anterior a este computador.
 *
 * O `bridge` é substituído porque aqui só interessa a coordenação (falhou →
 * buscar chaves → tentar de novo); a criptografia real tem os seus testes.
 */
const decrypt = vi.fn();
const receiveToDevice = vi.fn();

vi.mock('../src/lib/bridge', () => ({
  isDesktop: true,
  bridge: {
    e2ee: {
      decrypt: (...args: unknown[]) => decrypt(...args),
      receiveToDevice: (...args: unknown[]) => receiveToDevice(...args),
    },
  },
}));

const { E2eeManager } = await import('../src/lib/e2ee');

const envelope = {
  algorithm: 'm.megolm.v1.aes-sha2',
  sessionId: 's1',
  senderKey: 'k1',
  ciphertext: 'c1',
} as never;

function makeManager(pending: unknown[]): InstanceType<typeof E2eeManager> {
  const api = { get: vi.fn(async () => pending), post: vi.fn() };
  const manager = new E2eeManager(api as never);
  manager.deviceId = 'd1';
  manager.ready = true;
  return manager;
}

describe('E2eeManager.decryptWithRefresh', () => {
  beforeEach(() => {
    decrypt.mockReset();
    receiveToDevice.mockReset();
  });

  it('busca a chave pendente e decifra na segunda tentativa', async () => {
    decrypt
      .mockResolvedValueOnce({ error: 'UNKNOWN_SESSION' })
      .mockResolvedValueOnce({ plaintext: 'oi' });
    receiveToDevice.mockResolvedValue({ imported: 1 });

    const manager = makeManager([{ senderUserId: 'u2', senderDeviceId: 'd2', payload: 'p' }]);

    await expect(manager.decryptWithRefresh(envelope)).resolves.toBe('oi');
    expect(decrypt).toHaveBeenCalledTimes(2);
  });

  it('não tenta de novo quando não havia chave nenhuma para buscar', async () => {
    decrypt.mockResolvedValue({ error: 'UNKNOWN_SESSION' });

    const manager = makeManager([]);

    await expect(manager.decryptWithRefresh(envelope)).resolves.toBeNull();
    // Uma tentativa só: sem chave nova, repetir daria o mesmo resultado.
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it('coalesce a busca quando várias mensagens falham juntas', async () => {
    decrypt.mockImplementation(async () =>
      receiveToDevice.mock.calls.length > 0 ? { plaintext: 'oi' } : { error: 'UNKNOWN_SESSION' },
    );
    receiveToDevice.mockResolvedValue({ imported: 1 });

    const manager = makeManager([{ senderUserId: 'u2', senderDeviceId: 'd2', payload: 'p' }]);

    const results = await Promise.all([
      manager.decryptWithRefresh(envelope),
      manager.decryptWithRefresh(envelope),
      manager.decryptWithRefresh(envelope),
    ]);

    expect(results).toEqual(['oi', 'oi', 'oi']);
    // Três falhas simultâneas, uma única ida ao servidor.
    expect(receiveToDevice).toHaveBeenCalledTimes(1);
  });
});
