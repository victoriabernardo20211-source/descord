import { randomBytes } from 'node:crypto';
import { CryptoStore, type DeviceState } from './store';

// O @matrix-org/olm é CommonJS e carrega um .wasm do próprio pacote.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Olm = require('@matrix-org/olm');

const MEGOLM_ALGORITHM = 'm.megolm.v1.aes-sha2';
const MEGOLM_ROTATION_MS = 8 * 60 * 60 * 1000;
const MEGOLM_MAX_MESSAGES = 200;
/** Quantas sessões Olm por contato guardar antes de descartar as mais antigas. */
const MAX_OLM_SESSIONS = 8;

export interface DeviceIdentity {
  userId: string;
  deviceId: string;
  identityKey: string;
  signingKey: string;
}

export interface EncryptedEnvelope {
  algorithm: typeof MEGOLM_ALGORITHM;
  ciphertext: string;
  senderDeviceId: string;
  senderKey: string;
  sessionId: string;
}

export interface ToDevicePayload {
  userId: string;
  deviceId: string;
  payload: string;
}

/**
 * Criptografia ponta a ponta com Olm/Megolm (a mesma base usada em produção
 * pelo Matrix). Roda **apenas no processo principal** do Electron: a janela e
 * qualquer coisa carregada nela jamais têm acesso a uma chave privada.
 *
 * Duas camadas, como manda o protocolo:
 *   • **Olm** (Double Ratchet 1:1) — canal seguro entre dois dispositivos.
 *     Usado só para entregar a chave da sessão de grupo.
 *   • **Megolm** (ratchet de grupo) — cifra a mensagem uma única vez, mesmo
 *     que a conversa tenha 9 pessoas com vários dispositivos cada.
 *
 * Nada aqui é criptografia caseira: não escrevemos nenhuma primitiva. O que
 * este arquivo faz é gerenciar o ciclo de vida das sessões da biblioteca.
 */
export class CryptoService {
  private readonly store = new CryptoStore();
  private ready = false;
  private pickleKey = '';
  private state: DeviceState | null = null;
  /** Última falha de gravação, exposta para a UI avisar o usuário. */
  lastPersistError: string | null = null;

  /** Objetos Olm vivos em memória; o disco guarda só a forma serializada. */
  private account: any = null;
  private olmSessions = new Map<string, any[]>();
  private outbound = new Map<string, any>();
  private inbound = new Map<string, any>();

  async init(): Promise<DeviceIdentity & { encryptionAtRest: boolean }> {
    if (!this.ready) {
      await Olm.init();
      this.ready = true;
    }
    this.pickleKey = await this.store.loadPickleKey();

    const stored = await this.store.read();
    if (stored) {
      this.state = stored;
      this.account = new Olm.Account();
      this.account.unpickle(this.pickleKey, stored.account);
    } else {
      this.account = new Olm.Account();
      this.account.create();
      this.state = {
        // O deviceId é gerado aqui e nunca reutilizado entre instalações.
        deviceId: randomBytes(16).toString('hex'),
        account: this.account.pickle(this.pickleKey),
        olmSessions: {},
        outboundSessions: {},
        inboundSessions: {},
      };
      await this.persist();
    }

    const keys = JSON.parse(this.account.identity_keys()) as {
      curve25519: string;
      ed25519: string;
    };

    return {
      userId: '',
      deviceId: this.state.deviceId,
      identityKey: keys.curve25519,
      signingKey: keys.ed25519,
      encryptionAtRest: this.store.encryptionAvailable,
    };
  }

  /** Gera prekeys novas para publicar no servidor. */
  generateOneTimeKeys(count: number): Record<string, string> {
    this.assertReady();
    this.account.generate_one_time_keys(count);
    const keys = JSON.parse(this.account.one_time_keys()).curve25519 as Record<string, string>;
    // Marcar como publicadas evita reenviar as mesmas na próxima reposição.
    this.account.mark_keys_as_published();
    this.schedulePersist();
    return keys;
  }

  /** Quais dos dispositivos alvo ainda não têm uma sessão Olm estabelecida. */
  missingSessions(devices: DeviceIdentity[]): DeviceIdentity[] {
    this.assertReady();
    return devices.filter((d) => (this.state?.olmSessions[d.identityKey]?.length ?? 0) === 0);
  }

  /** Cria a sessão Olm de saída a partir de uma prekey obtida do servidor. */
  createOutboundOlmSession(device: DeviceIdentity, oneTimeKey: string): void {
    this.assertReady();
    const session = new Olm.Session();
    session.create_outbound(this.account, device.identityKey, oneTimeKey);
    // Acrescenta, nunca substitui: a sessão que já existia pode ser a única
    // capaz de ler o que o outro lado enviou.
    this.rememberOlmSession(device.identityKey, session);
    this.schedulePersist();
  }

  /**
   * Entrega a chave da sessão Megolm da conversa para cada dispositivo,
   * cifrada individualmente com Olm. O servidor só encaminha o envelope.
   */
  shareGroupSession(conversationId: string, devices: DeviceIdentity[]): ToDevicePayload[] {
    this.assertReady();
    const session = this.ensureOutboundSession(conversationId);

    const message = JSON.stringify({
      type: 'megolm.session',
      conversationId,
      sessionId: session.session_id(),
      sessionKey: session.session_key(),
      senderKey: this.identityKey,
    });

    const payloads: ToDevicePayload[] = [];
    for (const device of devices) {
      // Para enviar, a mais recente: é a que o outro lado com certeza conhece.
      const sessions = this.loadOlmSessions(device.identityKey);
      const olmSession = sessions[sessions.length - 1];
      if (!olmSession) continue;
      const encrypted = olmSession.encrypt(message);
      this.rememberOlmSession(device.identityKey, olmSession);
      payloads.push({
        userId: device.userId,
        deviceId: device.deviceId,
        payload: JSON.stringify({
          type: encrypted.type,
          body: encrypted.body,
          senderKey: this.identityKey,
        }),
      });
    }
    this.schedulePersist();
    return payloads;
  }

  /** Decifra envelopes recebidos e importa as sessões Megolm que vierem neles. */
  receiveToDevice(
    messages: { senderUserId: string; senderDeviceId: string; payload: string }[],
  ): { imported: number; failed: number } {
    this.assertReady();
    let imported = 0;
    let failed = 0;

    for (const message of messages) {
      try {
        const envelope = JSON.parse(message.payload) as {
          type: number;
          body: string;
          senderKey: string;
        };

        const decrypted = this.decryptOlm(envelope);
        if (!decrypted) {
          failed += 1;
          continue;
        }
        const { plaintext, session } = decrypted;
        this.rememberOlmSession(envelope.senderKey, session);

        const content = JSON.parse(plaintext) as {
          type: string;
          sessionId: string;
          sessionKey: string;
          senderKey: string;
        };
        if (content.type !== 'megolm.session') {
          failed += 1;
          continue;
        }

        const inbound = new Olm.InboundGroupSession();
        inbound.create(content.sessionKey);
        const key = `${content.senderKey}|${inbound.session_id()}`;
        this.inbound.set(key, inbound);
        this.state!.inboundSessions[key] = inbound.pickle(this.pickleKey);
        imported += 1;
      } catch {
        // Envelope corrompido ou de uma sessão que já não existe: descarta.
        failed += 1;
      }
    }

    this.schedulePersist();
    return { imported, failed };
  }

  encrypt(conversationId: string, plaintext: string): EncryptedEnvelope {
    this.assertReady();
    const session = this.ensureOutboundSession(conversationId);
    const ciphertext = session.encrypt(plaintext);

    const record = this.state!.outboundSessions[conversationId];
    if (record) record.messageCount += 1;
    this.state!.outboundSessions[conversationId] = {
      pickle: session.pickle(this.pickleKey),
      createdAt: record?.createdAt ?? Date.now(),
      messageCount: (record?.messageCount ?? 0) + 1,
    };
    this.schedulePersist();

    return {
      algorithm: MEGOLM_ALGORITHM,
      ciphertext,
      senderDeviceId: this.state!.deviceId,
      senderKey: this.identityKey,
      sessionId: session.session_id(),
    };
  }

  /**
   * Decifra. Falhar é normal e esperado: uma mensagem enviada antes deste
   * dispositivo existir não tem como ser lida — é justamente o que o E2EE
   * garante. Nesse caso devolvemos o motivo, e a UI mostra um aviso claro
   * em vez de um erro técnico.
   */
  decrypt(envelope: EncryptedEnvelope): { plaintext: string } | { error: string } {
    this.assertReady();
    const key = `${envelope.senderKey}|${envelope.sessionId}`;
    const session = this.loadInboundSession(key);
    if (!session) return { error: 'NO_SESSION' };

    try {
      const result = session.decrypt(envelope.ciphertext);
      this.state!.inboundSessions[key] = session.pickle(this.pickleKey);
      this.schedulePersist();
      return { plaintext: result.plaintext as string };
    } catch (err) {
      return { error: (err as Error).message || 'DECRYPT_FAILED' };
    }
  }

  /** Número de segurança: o que dois amigos comparam para confirmar identidade. */
  fingerprint(signingKey?: string): string {
    this.assertReady();
    const key = signingKey ?? this.signingKey;
    // Grupos de 5 caracteres facilitam ler em voz alta.
    return (key.match(/.{1,5}/g) ?? []).join(' ');
  }

  /** Descarta a sessão de grupo: usada quando alguém entra ou sai da conversa. */
  rotateGroupSession(conversationId: string): void {
    this.assertReady();
    this.outbound.delete(conversationId);
    delete this.state!.outboundSessions[conversationId];
    this.schedulePersist();
  }

  /** Garante que tudo que está em memória já foi para o disco. */
  async flush(): Promise<void> {
    await this.persist().catch(() => undefined);
    await this.store.flush();
  }

  async reset(): Promise<void> {
    this.olmSessions.clear();
    this.outbound.clear();
    this.inbound.clear();
    this.account = null;
    this.state = null;
    await this.store.destroy();
  }

  get identityKey(): string {
    return (JSON.parse(this.account.identity_keys()) as { curve25519: string }).curve25519;
  }
  get signingKey(): string {
    return (JSON.parse(this.account.identity_keys()) as { ed25519: string }).ed25519;
  }
  get deviceId(): string {
    return this.state?.deviceId ?? '';
  }

  /**
   * Uma sessão Megolm não vive para sempre: trocá-la periodicamente limita
   * quanto do histórico uma chave comprometida conseguiria abrir.
   */
  private ensureOutboundSession(conversationId: string): any {
    const record = this.state!.outboundSessions[conversationId];
    const stale =
      record &&
      (Date.now() - record.createdAt > MEGOLM_ROTATION_MS ||
        record.messageCount >= MEGOLM_MAX_MESSAGES);

    if (record && !stale) {
      let session = this.outbound.get(conversationId);
      if (!session) {
        session = new Olm.OutboundGroupSession();
        session.unpickle(this.pickleKey, record.pickle);
        this.outbound.set(conversationId, session);
      }
      return session;
    }

    const session = new Olm.OutboundGroupSession();
    session.create();
    this.outbound.set(conversationId, session);
    this.state!.outboundSessions[conversationId] = {
      pickle: session.pickle(this.pickleKey),
      createdAt: Date.now(),
      messageCount: 0,
    };

    // O próprio remetente precisa conseguir reler o que enviou.
    const selfInbound = new Olm.InboundGroupSession();
    selfInbound.create(session.session_key());
    const key = `${this.identityKey}|${session.session_id()}`;
    this.inbound.set(key, selfInbound);
    this.state!.inboundSessions[key] = selfInbound.pickle(this.pickleKey);

    this.schedulePersist();
    return session;
  }

  /**
   * Decifra um envelope Olm tentando, nesta ordem: uma sessão existente que
   * reconheça a mensagem, e só então uma sessão nova.
   *
   * A ordem importa. Uma mensagem de abertura (`type === 0`) chega quando o
   * outro lado inicia a conversa — e isso pode acontecer com uma sessão nossa
   * já criada para ele. Tentar decifrar com a sessão errada não devolve lixo:
   * lança, e a chave se perde. Por isso perguntamos antes se a sessão combina.
   */
  private decryptOlm(envelope: { type: number; body: string; senderKey: string }):
    | { plaintext: string; session: any }
    | null {
    for (const session of this.loadOlmSessions(envelope.senderKey)) {
      const matches =
        envelope.type === 0
          ? session.matches_inbound_from(envelope.senderKey, envelope.body)
          : true;
      if (!matches) continue;
      try {
        return { plaintext: session.decrypt(envelope.type, envelope.body), session };
      } catch {
        // Sessão parecida mas não é esta: segue para a próxima.
        continue;
      }
    }

    if (envelope.type !== 0) return null;

    try {
      const session = new Olm.Session();
      session.create_inbound_from(this.account, envelope.senderKey, envelope.body);
      // A prekey consumida é removida da conta para nunca ser reaproveitada.
      this.account.remove_one_time_keys(session);
      return { plaintext: session.decrypt(envelope.type, envelope.body), session };
    } catch {
      return null;
    }
  }

  /** Guarda a sessão em memória e no disco, sem descartar as anteriores. */
  private rememberOlmSession(identityKey: string, session: any): void {
    const live = this.olmSessions.get(identityKey) ?? [];
    if (!live.includes(session)) live.push(session);
    // Um teto evita que um contato acumule sessões para sempre; as mais antigas
    // já não são usadas para enviar e raramente voltam a ser necessárias. A
    // poda vale para a memória também, não só para o disco.
    const kept = live.slice(-MAX_OLM_SESSIONS);
    this.olmSessions.set(identityKey, kept);
    this.state!.olmSessions[identityKey] = kept.map((s) => s.pickle(this.pickleKey));
  }

  private loadOlmSessions(identityKey: string): any[] {
    const live = this.olmSessions.get(identityKey);
    if (live) return live;
    const pickles = this.state?.olmSessions[identityKey] ?? [];
    const sessions = pickles.map((pickle) => {
      const session = new Olm.Session();
      session.unpickle(this.pickleKey, pickle);
      return session;
    });
    this.olmSessions.set(identityKey, sessions);
    return sessions;
  }

  private loadInboundSession(key: string): any | null {
    const live = this.inbound.get(key);
    if (live) return live;
    const pickle = this.state?.inboundSessions[key];
    if (!pickle) return null;
    const session = new Olm.InboundGroupSession();
    session.unpickle(this.pickleKey, pickle);
    this.inbound.set(key, session);
    return session;
  }

  /**
   * Gravação em segundo plano com erro tratado. Um `void promise` aqui viraria
   * unhandled rejection e derrubaria o processo principal do Electron.
   */
  private schedulePersist(): void {
    void this.persist().catch((err: unknown) => {
      this.lastPersistError = err instanceof Error ? err.message : String(err);
      console.error('[e2ee] falha ao gravar o estado criptográfico:', this.lastPersistError);
    });
  }

  private async persist(): Promise<void> {
    if (!this.state || !this.account) return;
    this.state.account = this.account.pickle(this.pickleKey);
    await this.store.write(this.state);
  }

  private assertReady(): void {
    if (!this.account || !this.state) {
      throw new Error('Criptografia não inicializada.');
    }
  }
}

export const cryptoService = new CryptoService();
