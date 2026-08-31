import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

/**
 * Persistência do material criptográfico do dispositivo.
 *
 * O estado do Olm (conta e sessões) é serializado com uma "pickle key" aleatória
 * de 32 bytes. Essa chave é guardada com o `safeStorage` do Electron, que no
 * Windows usa a DPAPI — ou seja, ela fica atrelada à conta de usuário do sistema
 * operacional. Copiar os arquivos para outro PC não dá acesso a nada.
 *
 * Se o SO não oferecer criptografia (Linux sem keyring), o arquivo é gravado
 * com permissão 600 e o app avisa que a proteção em repouso é mais fraca.
 */
export interface DeviceState {
  deviceId: string;
  account: string;
  /** identityKey (curve25519) do interlocutor → sessão Olm serializada. */
  olmSessions: Record<string, string>;
  /** conversationId → sessão Megolm de saída. */
  outboundSessions: Record<string, { pickle: string; createdAt: number; messageCount: number }>;
  /** `${senderKey}|${sessionId}` → sessão Megolm de entrada. */
  inboundSessions: Record<string, string>;
}

const EMPTY: Omit<DeviceState, 'deviceId' | 'account'> = {
  olmSessions: {},
  outboundSessions: {},
  inboundSessions: {},
};

export class CryptoStore {
  private pickleKey: string | null = null;
  private state: DeviceState | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  /**
   * Resolvido uma única vez. Recalcular o caminho a cada acesso deixava uma
   * janela em que a gravação começava num diretório e terminava em outro.
   */
  private readonly dir: string = join(app.getPath('userData'), 'e2ee');
  private readonly statePath: string = join(this.dir, 'device.json');
  private readonly keyPath: string = join(this.dir, 'pickle.key');

  /** True quando o sistema operacional protege a chave em repouso. */
  get encryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  async loadPickleKey(): Promise<string> {
    if (this.pickleKey) return this.pickleKey;
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });

    try {
      const raw = await fs.readFile(this.keyPath);
      this.pickleKey = this.encryptionAvailable
        ? safeStorage.decryptString(raw)
        : raw.toString('utf8');
      return this.pickleKey;
    } catch {
      // Primeira execução: gera a chave.
    }

    const key = randomBytes(32).toString('base64');
    const payload = this.encryptionAvailable
      ? safeStorage.encryptString(key)
      : Buffer.from(key, 'utf8');
    await fs.writeFile(this.keyPath, payload, { mode: 0o600 });
    this.pickleKey = key;
    return key;
  }

  async read(): Promise<DeviceState | null> {
    if (this.state) return this.state;
    try {
      const raw = await fs.readFile(this.statePath, 'utf8');
      const parsed = JSON.parse(raw) as DeviceState;
      this.state = { ...EMPTY, ...parsed };
      return this.state;
    } catch {
      return null;
    }
  }

  /** Escrita serializada: duas mensagens simultâneas não corrompem o arquivo. */
  async write(state: DeviceState): Promise<void> {
    this.state = state;
    const snapshot = JSON.stringify(state);
    this.writeQueue = this.writeQueue
      // catch antes do próximo passo: uma falha não pode travar a fila inteira.
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
        // Nome único por gravação: duas escritas concorrentes nunca disputam
        // o mesmo arquivo temporário.
        const tmp = `${this.statePath}.${randomBytes(6).toString('hex')}.tmp`;
        await fs.writeFile(tmp, snapshot, { mode: 0o600 });
        // Rename atômico: uma queda no meio da escrita não deixa estado pela metade.
        try {
          await fs.rename(tmp, this.statePath);
        } catch (err) {
          await fs.rm(tmp, { force: true });
          throw err;
        }
      });
    return this.writeQueue;
  }

  /**
   * Espera todas as gravações pendentes terminarem. Chamado antes de o app
   * fechar, para que uma chave de sessão recebida no último segundo não se perca.
   */
  async flush(): Promise<void> {
    await this.writeQueue.catch(() => undefined);
  }

  /** Apaga todo o material criptográfico (logout ou "esquecer este dispositivo"). */
  async destroy(): Promise<void> {
    this.state = null;
    this.pickleKey = null;
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}
