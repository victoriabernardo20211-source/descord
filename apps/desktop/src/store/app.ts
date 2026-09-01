import { create } from 'zustand';
import type { DirectMessage, Message, PresenceState, PublicUser } from '@nexus/shared';
import { ApiClient, ApiError } from '../lib/api';
import { E2eeManager } from '../lib/e2ee';
import { voice, type StreamQuality, type VoicePeer } from '../lib/voice';
import { dmPayloadSchema, type DmPayload, type EncryptedFile } from '@nexus/shared';
import { realtime, type ConnectionStatus } from '../lib/socket';
import { bridge } from '../lib/bridge';

export interface ServerSummary {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
}

export interface ChannelSummary {
  id: string;
  name: string;
  type: 'TEXT' | 'VOICE';
  topic: string | null;
  categoryId: string | null;
  position: number;
}

export interface ServerDetail extends ServerSummary {
  permissions: string;
  permissionNames: string[];
  categories: { id: string; name: string; position: number }[];
  channels: ChannelSummary[];
  roles: { id: string; name: string; color: string; position: number; isEveryone: boolean }[];
  members: { userId: string; nickname: string | null; roleIds: string[]; user: PublicUser }[];
}

export interface Conversation {
  id: string;
  isGroup: boolean;
  name: string | null;
  iconUrl: string | null;
  participants: PublicUser[];
}

export interface Me {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isGlobalAdmin: boolean;
}

/**
 * DM já processada para exibição: `content` traz o texto decifrado. Quando a
 * chave desta sessão não existe neste dispositivo, `decryptionFailed` fica
 * verdadeiro e a UI explica o motivo em vez de mostrar lixo cifrado.
 */
/** Anexo de DM pronto para exibir, já com a chave que o abre. */
export interface DecryptedAttachment {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  /** Material de chave vindo de dentro do envelope; ausente = anexo antigo em claro. */
  key?: string;
  iv?: string;
  thumbnailIv?: string;
}

export type DecryptedDirectMessage = Omit<DirectMessage, 'attachments'> & {
  attachments: DecryptedAttachment[];
  decryptionFailed?: boolean;
};

/** Mensagem otimista: aparece na hora e vira `sent` quando o servidor confirma. */
export interface PendingMessage {
  clientMessageId: string;
  content: string;
  status: 'sending' | 'failed';
}

type View =
  | { kind: 'friends' }
  | { kind: 'dm'; conversationId: string }
  | { kind: 'server'; serverId: string }
  /** Chamada aberta na área principal, como no canal de voz. */
  | { kind: 'call'; channelId: string };

interface AppState {
  api: ApiClient | null;
  e2ee: E2eeManager | null;
  /** Estado da criptografia mostrado na UI. */
  e2eeStatus: 'off' | 'ready' | 'unavailable' | 'weak-storage';
  apiUrl: string | null;
  status: 'boot' | 'needs-server' | 'server-unreachable' | 'login' | 'ready';
  connection: ConnectionStatus;
  me: Me | null;

  view: View;
  activeChannelId: string | null;

  servers: ServerSummary[];
  serverDetail: ServerDetail | null;
  conversations: Conversation[];
  presences: Record<string, PresenceState>;
  friends: {
    friends: (PublicUser & { presence: PresenceState })[];
    incoming: { id: string; user: PublicUser }[];
    outgoing: { id: string; user: PublicUser }[];
    blocked: PublicUser[];
  };

  /** Quem está em cada canal de voz, vindo do servidor. */
  voiceState: Record<string, { userId: string; selfMuted: boolean; selfDeafened: boolean; serverMuted: boolean; streaming: boolean }[]>;
  /** Estado ao vivo da MINHA conexão de voz (LiveKit). */
  voicePeers: VoicePeer[];
  voiceChannelId: string | null;
  voiceConnecting: boolean;
  voiceError: string | null;
  selfMuted: boolean;
  selfDeafened: boolean;
  streaming: boolean;
  voiceAvailable: boolean;
  /** Stream em destaque na visualização. */
  watchingUserId: string | null;
  /** O seletor de fonte de tela vive no store: é aberto de dois lugares. */
  sharePickerOpen: boolean;

  messages: Record<string, Message[]>;
  directMessages: Record<string, DecryptedDirectMessage[]>;
  pending: Record<string, PendingMessage[]>;
  typing: Record<string, { userId: string; displayName: string }[]>;
  error: string | null;

  configureServer: (url: string) => Promise<void>;
  boot: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    username: string;
    displayName: string;
    password: string;
    inviteCode?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;

  openServer: (serverId: string) => Promise<void>;
  openChannel: (channelId: string) => Promise<void>;
  openConversation: (conversationId: string) => Promise<void>;
  openFriends: () => void;
  startDm: (userId: string) => Promise<void>;

  sendMessage: (content: string, attachmentIds?: string[], dmFiles?: EncryptedFile[]) => Promise<void>;
  loadOlder: () => Promise<void>;
  react: (messageId: string, emoji: string, add: boolean) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  notifyTyping: () => void;

  joinVoice: (channelId: string) => Promise<void>;
  leaveVoice: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
  setUserVolume: (userId: string, volume: number) => void;
  startScreenShare: (sourceId: string, quality: StreamQuality, withAudio: boolean) => Promise<void>;
  stopScreenShare: () => Promise<void>;
  watchStream: (userId: string | null) => void;
  setSharePickerOpen: (open: boolean) => void;
  openCall: (channelId: string) => void;
  moderateVoice: (userId: string, action: 'mute' | 'unmute' | 'deafen' | 'undeafen' | 'disconnect') => Promise<void>;

  createServer: (name: string) => Promise<void>;
  joinServer: (code: string) => Promise<void>;
  createInvite: (
    serverId: string,
    maxAgeSeconds: number,
    maxUses: number,
  ) => Promise<{ code: string; expiresAt: string | null }>;
  addFriend: (username: string) => Promise<string>;
  respondFriendRequest: (id: string, accept: boolean) => Promise<void>;
  refreshFriends: () => Promise<void>;
  setError: (message: string | null) => void;
}

const randomId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const useApp = create<AppState>((set, get) => ({
  api: null,
  e2ee: null,
  e2eeStatus: 'off',
  apiUrl: null,
  status: 'boot',
  connection: 'offline',
  me: null,
  view: { kind: 'friends' },
  activeChannelId: null,
  servers: [],
  serverDetail: null,
  conversations: [],
  presences: {},
  friends: { friends: [], incoming: [], outgoing: [], blocked: [] },
  voiceState: {},
  voicePeers: [],
  voiceChannelId: null,
  voiceConnecting: false,
  voiceError: null,
  selfMuted: false,
  selfDeafened: false,
  streaming: false,
  voiceAvailable: false,
  watchingUserId: null,
  sharePickerOpen: false,
  messages: {},
  directMessages: {},
  pending: {},
  typing: {},
  error: null,

  setError: (message) => set({ error: message }),

  /** Primeira execução: o app precisa saber onde fica o nosso servidor. */
  configureServer: async (url) => {
    const typed = url.trim().replace(/\/+$/, '');
    if (!typed) return;

    // Errar o esquema custou tempo de mais para valer a pena exigir do usuário:
    // se ele não escrever, tentamos os dois. HTTPS primeiro, HTTP como segunda
    // opção (é o caso de servidor em rede privada, onde não há certificado).
    const candidates = /^https?:\/\//i.test(typed)
      ? [typed]
      : [`https://${typed}`, `http://${typed}`];

    for (const candidate of candidates) {
      const api = new ApiClient(candidate);
      const health = await api.syncClock().catch(() => ({ ok: false }));
      if (health.ok) {
        await bridge.setConfig({ apiUrl: candidate });
        set({ api, apiUrl: candidate, status: 'login', error: null });
        return;
      }
    }

    set({
      status: 'server-unreachable',
      error: 'Não foi possível conectar ao servidor.',
    });
  },

  boot: async () => {
    const config = await bridge.getConfig();
    // Um instalador pode vir com o servidor embutido (VITE_DEFAULT_SERVER_URL),
    // para que quem recebe o .exe só instale, abra e entre.
    const apiUrl = config.apiUrl ?? (import.meta.env.VITE_DEFAULT_SERVER_URL as string | undefined);
    if (!apiUrl) {
      set({ status: 'needs-server' });
      return;
    }

    const api = new ApiClient(apiUrl);
    set({ api, apiUrl });

    const health = await api.syncClock().catch(() => ({ ok: false }));
    if (!health.ok) {
      set({ status: 'server-unreachable', error: 'Não foi possível conectar ao servidor.' });
      return;
    }

    if (!config.refreshToken) {
      set({ status: 'login' });
      return;
    }

    // Sessão persistente: o refresh token guardado ressuscita o login.
    api.setRefreshToken(config.refreshToken);
    try {
      await api.request('/users/me');
    } catch (err) {
      // Só descartamos a sessão quando ela foi REALMENTE recusada. Antes, um
      // erro de rede qualquer apagava o login salvo e obrigava a digitar tudo
      // de novo — era o que acontecia a cada tropeço de configuração.
      const rejected =
        err instanceof ApiError &&
        (err.status === 401 || err.code === 'SESSION_EXPIRED' || err.code === 'INVALID_TOKEN');

      if (rejected) {
        await bridge.clearSession();
        set({ status: 'login', error: 'Sua sessão expirou. Entre novamente.' });
      } else {
        set({
          status: 'server-unreachable',
          error: 'Não foi possível conectar ao servidor.',
        });
      }
      return;
    }

    // Uma falha aqui (criptografia, listagem inicial) não é motivo para perder
    // a sessão: o login continua válido.
    await afterLogin(set, get).catch((err: unknown) => {
      set({
        status: 'server-unreachable',
        error: err instanceof Error ? err.message : 'Falha ao carregar seus dados.',
      });
    });
  },

  login: async (email, password) => {
    const api = get().api;
    if (!api) return;
    // O e-mail é lembrado para preencher o campo; a senha nunca é guardada.
    await bridge.setConfig({ lastEmail: email });
    const result = await api.post<{ accessToken: string; refreshToken: string }>('/auth/login', {
      email,
      password,
      deviceName: 'Nexus Desktop',
    });
    api.setTokens(result);
    await afterLogin(set, get);
  },

  register: async (input) => {
    const api = get().api;
    if (!api) return;
    const result = await api.post<{ accessToken: string; refreshToken: string }>(
      '/auth/register',
      input,
    );
    api.setTokens(result);
    await afterLogin(set, get);
  },

  logout: async () => {
    const api = get().api;
    await api?.post('/auth/logout').catch(() => undefined);
    api?.setTokens(null);
    realtime.disconnect();
    // O material criptográfico não sobrevive ao logout.
    await get().e2ee?.reset().catch(() => undefined);
    await bridge.clearSession();
    // Nada de conteúdo privado sobrando em memória depois do logout.
    set({
      status: 'login',
      e2ee: null,
      e2eeStatus: 'off',
      me: null,
      servers: [],
      serverDetail: null,
      conversations: [],
      messages: {},
      directMessages: {},
      pending: {},
      friends: { friends: [], incoming: [], outgoing: [], blocked: [] },
      view: { kind: 'friends' },
      activeChannelId: null,
    });
  },

  openFriends: () => set({ view: { kind: 'friends' }, activeChannelId: null }),

  openServer: async (serverId) => {
    const api = get().api;
    if (!api) return;
    const detail = await api.get<ServerDetail>(`/servers/${serverId}`);
    const voiceState = await api
      .get<AppState['voiceState']>(`/voice/servers/${serverId}`)
      .catch(() => ({}));
    set((state) => ({ voiceState: { ...state.voiceState, ...voiceState } }));
    const firstText = detail.channels.find((c) => c.type === 'TEXT');
    set({ serverDetail: detail, view: { kind: 'server', serverId } });
    if (firstText) await get().openChannel(firstText.id);
    else set({ activeChannelId: null });
  },

  openChannel: async (channelId) => {
    const api = get().api;
    if (!api) return;
    set({ activeChannelId: channelId });
    const messages = await api.get<Message[]>(`/channels/${channelId}/messages`);
    set((state) => ({ messages: { ...state.messages, [channelId]: messages } }));
    const last = messages[messages.length - 1];
    if (last) await api.post(`/channels/${channelId}/read`, { messageId: last.id });
  },

  openConversation: async (conversationId) => {
    const api = get().api;
    if (!api) return;
    set({ view: { kind: 'dm', conversationId }, activeChannelId: conversationId });
    const raw = await api.get<DirectMessage[]>(`/dm/conversations/${conversationId}/messages`);
    const messages = await decryptAll(raw);
    set((state) => ({
      directMessages: { ...state.directMessages, [conversationId]: messages },
    }));
  },

  startDm: async (userId) => {
    const api = get().api;
    if (!api) return;
    const conversation = await api.post<Conversation>('/dm/conversations', { userIds: [userId] });
    set((state) => ({
      conversations: state.conversations.some((c) => c.id === conversation.id)
        ? state.conversations
        : [conversation, ...state.conversations],
    }));
    await get().openConversation(conversation.id);
  },

  sendMessage: async (content, attachmentIds, dmFiles) => {
    const { api, view, activeChannelId } = get();
    if (!api || !activeChannelId) return;

    const clientMessageId = randomId();
    // Aparece imediatamente como "enviando" — a confirmação vem do servidor.
    set((state) => ({
      pending: {
        ...state.pending,
        [activeChannelId]: [
          ...(state.pending[activeChannelId] ?? []),
          { clientMessageId, content, status: 'sending' },
        ],
      },
    }));

    try {
      if (view.kind === 'dm') {
        const e2ee = get().e2ee;
        if (!e2ee?.ready) {
          // Nunca cai para texto puro: preferimos falhar a enviar sem cifrar.
          throw new Error(
            'A criptografia ainda não está pronta neste dispositivo. Tente de novo em instantes.',
          );
        }
        const conversation = get().conversations.find((c) => c.id === activeChannelId);
        await e2ee.ensureSession(
          activeChannelId,
          conversation?.participants.map((p) => p.id) ?? [],
        );

        // O texto e as chaves dos anexos são cifrados juntos, num payload só.
        const payload: DmPayload = { v: 1, text: content, files: dmFiles ?? [] };
        const encryption = await e2ee.encrypt(activeChannelId, JSON.stringify(payload));
        await api.post(`/dm/conversations/${activeChannelId}/messages`, {
          encryption,
          clientMessageId,
          attachmentIds,
        });
      } else {
        await api.post(`/channels/${activeChannelId}/messages`, {
          content,
          clientMessageId,
          attachmentIds,
        });
      }
      // A mensagem real chega pelo WebSocket; aqui só limpamos o otimista.
      set((state) => ({
        pending: {
          ...state.pending,
          [activeChannelId]: (state.pending[activeChannelId] ?? []).filter(
            (p) => p.clientMessageId !== clientMessageId,
          ),
        },
      }));
    } catch (err) {
      set((state) => ({
        pending: {
          ...state.pending,
          [activeChannelId]: (state.pending[activeChannelId] ?? []).map((p) =>
            p.clientMessageId === clientMessageId ? { ...p, status: 'failed' as const } : p,
          ),
        },
        error: err instanceof Error ? err.message : 'Falha ao enviar a mensagem.',
      }));
    }
  },

  loadOlder: async () => {
    const { api, view, activeChannelId, messages, directMessages } = get();
    if (!api || !activeChannelId) return;

    if (view.kind === 'dm') {
      const current = directMessages[activeChannelId] ?? [];
      const oldest = current[0];
      if (!oldest) return;
      const olderRaw = await api.get<DirectMessage[]>(
        `/dm/conversations/${activeChannelId}/messages?before=${oldest.id}`,
      );
      if (olderRaw.length === 0) return;
      const older = await decryptAll(olderRaw);
      set((state) => ({
        directMessages: {
          ...state.directMessages,
          [activeChannelId]: [...older, ...(state.directMessages[activeChannelId] ?? [])],
        },
      }));
      return;
    }

    const current = messages[activeChannelId] ?? [];
    const oldest = current[0];
    if (!oldest) return;
    const older = await api.get<Message[]>(
      `/channels/${activeChannelId}/messages?before=${oldest.id}`,
    );
    if (older.length === 0) return;
    set((state) => ({
      messages: {
        ...state.messages,
        [activeChannelId]: [...older, ...(state.messages[activeChannelId] ?? [])],
      },
    }));
  },

  react: async (messageId, emoji, add) => {
    const api = get().api;
    if (!api) return;
    const path = `/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`;
    if (add) await api.put(path);
    else await api.del(path);
  },

  deleteMessage: async (messageId) => {
    const { api, view } = get();
    if (!api) return;
    await api.del(view.kind === 'dm' ? `/dm/messages/${messageId}` : `/messages/${messageId}`);
  },

  notifyTyping: () => {
    const { activeChannelId } = get();
    if (activeChannelId) realtime.emit('typing.start', { channelId: activeChannelId });
  },

  joinVoice: async (channelId) => {
    const { api, me } = get();
    if (!api || !me) return;
    set({ voiceConnecting: true, voiceError: null });

    try {
      const ticket = await api.post<{
        token: string;
        url: string;
        canSpeak: boolean;
        canStream: boolean;
      }>(`/voice/channels/${channelId}/token`);

      const settings = await api.get<{
        settings: {
          inputDeviceId: string | null;
          noiseSuppression: boolean;
          echoCancellation: boolean;
          autoGainControl: boolean;
          inputMode: string;
        } | null;
      }>('/users/me');
      const s = settings.settings;

      await voice.connect({
        url: ticket.url,
        token: ticket.token,
        channelId,
        inputDeviceId: s?.inputDeviceId ?? null,
        noiseSuppression: s?.noiseSuppression ?? true,
        echoCancellation: s?.echoCancellation ?? true,
        autoGainControl: s?.autoGainControl ?? true,
        pushToTalk: s?.inputMode === 'PUSH_TO_TALK',
      });

      if (voice.error) {
        set({ voiceError: voice.error, voiceConnecting: false });
        return;
      }

      // O servidor mantém a lista de quem está na sala e avisa os outros.
      const participants = await api.post<AppState['voiceState'][string]>(
        `/voice/channels/${channelId}/join`,
      );
      set({
        voiceChannelId: channelId,
        voiceConnecting: false,
        selfMuted: voice.selfMuted,
        voiceState: { ...get().voiceState, [channelId]: participants },
        // Sem isto a pessoa entra na chamada e nada muda na tela — foi
        // exatamente o que fez parecer que o clique não tinha funcionado.
        view: { kind: 'call', channelId },
      });
    } catch (err) {
      set({
        voiceConnecting: false,
        voiceError: err instanceof Error ? err.message : 'Não foi possível entrar na voz.',
      });
    }
  },

  leaveVoice: async () => {
    const { api, voiceChannelId } = get();
    await voice.disconnect();
    if (api && voiceChannelId) {
      await api.post(`/voice/channels/${voiceChannelId}/leave`).catch(() => undefined);
    }
    set({
      voiceChannelId: null,
      voicePeers: [],
      streaming: false,
      watchingUserId: null,
  sharePickerOpen: false,
      selfMuted: false,
      selfDeafened: false,
    });
  },

  toggleMute: async () => {
    const next = !get().selfMuted;
    await voice.setMuted(next);
    set({ selfMuted: next });
    await get().api?.post('/voice/state', { selfMuted: next }).catch(() => undefined);
  },

  toggleDeafen: async () => {
    const next = !get().selfDeafened;
    await voice.setDeafened(next);
    set({ selfDeafened: next, selfMuted: next ? true : get().selfMuted });
    await get()
      .api?.post('/voice/state', { selfDeafened: next, selfMuted: next ? true : undefined })
      .catch(() => undefined);
  },

  setUserVolume: (userId, volume) => {
    // Preferência puramente local: não vai para o servidor.
    voice.setVolume(userId, volume);
    set({ voicePeers: [...voice.peers] });
  },

  startScreenShare: async (sourceId, quality, withAudio) => {
    await voice.startScreenShare(sourceId, quality, withAudio);
    set({ streaming: voice.streaming, voiceError: voice.error });
    if (voice.streaming) {
      await get().api?.post('/voice/state', { streaming: true }).catch(() => undefined);
    }
  },

  stopScreenShare: async () => {
    await voice.stopScreenShare();
    set({ streaming: false });
    await get().api?.post('/voice/state', { streaming: false }).catch(() => undefined);
  },

  watchStream: (userId) => set({ watchingUserId: userId }),

  setSharePickerOpen: (open) => set({ sharePickerOpen: open }),

  openCall: (channelId) => set({ view: { kind: 'call', channelId }, watchingUserId: null }),

  moderateVoice: async (userId, action) => {
    await get().api?.post(`/voice/members/${userId}/moderate`, { action });
  },

  createServer: async (name) => {
    const api = get().api;
    if (!api) return;
    const detail = await api.post<ServerDetail>('/servers', { name });
    set((state) => ({
      servers: [
        ...state.servers,
        { id: detail.id, name: detail.name, iconUrl: detail.iconUrl, ownerId: detail.ownerId },
      ],
    }));
    await get().openServer(detail.id);
  },

  joinServer: async (code) => {
    const api = get().api;
    if (!api) return;
    const detail = await api.post<ServerDetail>(`/servers/invites/${code}`);
    set((state) => ({
      servers: state.servers.some((s) => s.id === detail.id)
        ? state.servers
        : [
            ...state.servers,
            { id: detail.id, name: detail.name, iconUrl: detail.iconUrl, ownerId: detail.ownerId },
          ],
    }));
    await get().openServer(detail.id);
  },

  createInvite: async (serverId, maxAgeSeconds, maxUses) => {
    const api = get().api;
    if (!api) throw new Error('Sem conexão com o servidor.');
    return api.post<{ code: string; expiresAt: string | null }>(
      `/servers/${serverId}/invites`,
      { maxAgeSeconds, maxUses },
    );
  },

  addFriend: async (username) => {
    const api = get().api;
    if (!api) return 'ERROR';
    const result = await api.post<{ status: string }>('/friends/requests', { username });
    await get().refreshFriends();
    return result.status;
  },

  respondFriendRequest: async (id, accept) => {
    const api = get().api;
    if (!api) return;
    await api.post(`/friends/requests/${id}/${accept ? 'accept' : 'reject'}`);
    await get().refreshFriends();
  },

  refreshFriends: async () => {
    const api = get().api;
    if (!api) return;
    set({ friends: await api.get('/friends') });
  },
}));

/** Carrega o estado inicial e liga o WebSocket depois de qualquer login. */
async function afterLogin(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
): Promise<void> {
  const api = get().api;
  if (!api) return;

  const [me, servers, conversations, friends] = await Promise.all([
    api.get<Me>('/users/me'),
    api.get<ServerSummary[]>('/servers'),
    api.get<Conversation[]>('/dm/conversations'),
    api.get<AppState['friends']>('/friends'),
  ]);

  set({ me, servers, conversations, friends, status: 'ready', error: null });

  // Criptografia ponta a ponta: registra este dispositivo e publica as chaves
  // públicas. As privadas ficam no processo principal e nunca chegam aqui.
  const e2ee = new E2eeManager(api);
  set({ e2ee });
  if (!e2ee.available) {
    set({ e2eeStatus: 'unavailable' });
  } else {
    try {
      await e2ee.register(`${me.displayName} — Nexus Desktop`);
      set({ e2eeStatus: e2ee.encryptionAtRest ? 'ready' : 'weak-storage' });
    } catch (err) {
      set({
        e2eeStatus: 'unavailable',
        error:
          err instanceof Error
            ? `Criptografia indisponível: ${err.message}`
            : 'Não foi possível preparar a criptografia deste dispositivo.',
      });
    }
  }

  // A voz pode não estar configurada neste servidor; a UI precisa saber para
  // desabilitar os canais em vez de deixar o usuário clicar e nada acontecer.
  const voiceStatus = await api
    .get<{ configured: boolean }>('/voice/status')
    .catch(() => ({ configured: false }));
  set({ voiceAvailable: voiceStatus.configured });

  if (api.token) realtime.connect(api.baseUrl, api.token);
  registerRealtimeHandlers();
}

/** Decifra uma lista de DMs preservando a ordem. */
async function decryptAll(messages: DirectMessage[]): Promise<DecryptedDirectMessage[]> {
  const e2ee = useApp.getState().e2ee;
  return Promise.all(messages.map((message) => decryptOne(message, e2ee)));
}

async function decryptOne(
  message: DirectMessage,
  e2ee: E2eeManager | null,
): Promise<DecryptedDirectMessage> {
  const asPlain = (extra: Partial<DecryptedDirectMessage> = {}): DecryptedDirectMessage => ({
    ...message,
    attachments: message.attachments.map((a) => ({
      id: a.id,
      url: a.url,
      thumbnailUrl: a.thumbnailUrl,
      fileName: a.fileName,
      mimeType: a.mimeType,
      size: a.size,
      width: a.width,
      height: a.height,
    })),
    ...extra,
  });

  // Mensagem sem envelope é conteúdo legado, anterior ao E2EE.
  if (!message.encryption) return asPlain();
  if (!e2ee) return asPlain({ content: '', decryptionFailed: true });

  const plaintext = await e2ee.decrypt(message.encryption).catch(() => null);
  if (plaintext === null) {
    // Falhar aqui é o comportamento esperado quando este dispositivo não
    // possui a chave daquela sessão — não é um erro a ser escondido.
    return asPlain({ content: '', decryptionFailed: true });
  }

  // Mensagens antigas cifravam só o texto; as novas cifram um payload com o
  // texto e as chaves dos anexos. Aceitamos as duas formas.
  const parsed = dmPayloadSchema.safeParse(safeJson(plaintext));
  if (!parsed.success) return asPlain({ content: plaintext });

  const byUploadId = new Map(
    message.attachments.filter((a) => a.uploadId).map((a) => [a.uploadId as string, a]),
  );

  const attachments: DecryptedAttachment[] = [];
  for (const file of parsed.data.files) {
    const row = byUploadId.get(file.uploadId);
    // Sem a linha correspondente o anexo já foi apagado (expiração, por exemplo).
    if (!row) continue;
    const thumbRow = file.thumbnailUploadId
      ? byUploadId.get(file.thumbnailUploadId)
      : undefined;

    attachments.push({
      id: row.id,
      url: row.url,
      thumbnailUrl: thumbRow?.url ?? null,
      // Nome e tipo REAIS vêm de dentro do envelope — o servidor só tem placeholders.
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: file.size,
      width: file.width ?? null,
      height: file.height ?? null,
      key: file.key,
      iv: file.iv,
      ...(file.thumbnailIv ? { thumbnailIv: file.thumbnailIv } : {}),
    });
  }

  return { ...asPlain(), content: parsed.data.text, attachments };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

let handlersRegistered = false;

function registerRealtimeHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  realtime.onStatus((connection) => useApp.setState({ connection }));

  realtime.on('message.created', (message) => {
    useApp.setState((state) => {
      const list = state.messages[message.channelId];
      if (!list) return state;
      if (list.some((m) => m.id === message.id)) return state;
      return { messages: { ...state.messages, [message.channelId]: [...list, message] } };
    });
    void maybeNotify(message.author.displayName, message.content, message.author.id);
  });

  realtime.on('message.updated', (message) => {
    useApp.setState((state) => {
      const list = state.messages[message.channelId];
      if (!list) return state;
      return {
        messages: {
          ...state.messages,
          [message.channelId]: list.map((m) => (m.id === message.id ? message : m)),
        },
      };
    });
  });

  realtime.on('message.deleted', ({ id, channelId }) => {
    useApp.setState((state) => {
      const list = state.messages[channelId];
      if (!list) return state;
      return { messages: { ...state.messages, [channelId]: list.filter((m) => m.id !== id) } };
    });
  });

  realtime.on('dm.created', (message) => {
    void (async () => {
      const decrypted = await decryptOne(message, useApp.getState().e2ee);
      useApp.setState((state) => {
        const list = state.directMessages[message.conversationId] ?? [];
        if (list.some((m) => m.id === message.id)) return state;
        return {
          directMessages: {
            ...state.directMessages,
            [message.conversationId]: [...list, decrypted],
          },
        };
      });
      void maybeNotify(message.author.displayName, decrypted.content, message.author.id);
    })();
  });

  realtime.on('dm.updated', (message) => {
    void (async () => {
      const decrypted = await decryptOne(message, useApp.getState().e2ee);
      useApp.setState((state) => {
        const list = state.directMessages[message.conversationId] ?? [];
        return {
          directMessages: {
            ...state.directMessages,
            [message.conversationId]: list.map((m) => (m.id === message.id ? decrypted : m)),
          },
        };
      });
    })();
  });

  // Chegou chave de sessão para este dispositivo: importa e reabre a conversa
  // atual, para que mensagens que não abriam passem a abrir.
  realtime.on('e2ee.to_device', ({ targetDeviceId }) => {
    const state = useApp.getState();
    if (!state.e2ee || state.e2ee.deviceId !== targetDeviceId) return;
    void (async () => {
      const imported = await state.e2ee!.drainToDevice().catch(() => 0);
      if (imported > 0 && state.view.kind === 'dm') {
        await state.openConversation(state.view.conversationId);
      }
    })();
  });

  // Alguém adicionou ou removeu um dispositivo: a chave da sessão precisa ser
  // reenviada, senão o aparelho novo não lê as próximas mensagens.
  realtime.on('e2ee.devices_changed', ({ userId }) => {
    useApp.getState().e2ee?.invalidateDevice(userId);
  });

  realtime.on('dm.deleted', ({ id, conversationId }) => {
    useApp.setState((state) => ({
      directMessages: {
        ...state.directMessages,
        [conversationId]: (state.directMessages[conversationId] ?? []).filter((m) => m.id !== id),
      },
    }));
  });

  // Mensagem privada expirou no servidor: some da tela imediatamente.
  realtime.on('dm.expired', ({ conversationId, messageIds }) => {
    useApp.setState((state) => ({
      directMessages: {
        ...state.directMessages,
        [conversationId]: (state.directMessages[conversationId] ?? []).filter(
          (m) => !messageIds.includes(m.id),
        ),
      },
    }));
  });

  realtime.on('presence.updated', (presence) => {
    useApp.setState((state) => ({
      presences: { ...state.presences, [presence.userId]: presence },
    }));
  });

  realtime.on('typing.started', ({ channelId, userId, displayName }) => {
    useApp.setState((state) => {
      const current = state.typing[channelId] ?? [];
      if (current.some((t) => t.userId === userId)) return state;
      return { typing: { ...state.typing, [channelId]: [...current, { userId, displayName }] } };
    });
  });

  realtime.on('typing.stopped', ({ channelId, userId }) => {
    useApp.setState((state) => ({
      typing: {
        ...state.typing,
        [channelId]: (state.typing[channelId] ?? []).filter((t) => t.userId !== userId),
      },
    }));
  });

  realtime.on('reaction.added', ({ messageId, channelId, emoji, userId }) =>
    applyReaction(messageId, channelId, emoji, userId, true),
  );
  realtime.on('reaction.removed', ({ messageId, channelId, emoji, userId }) =>
    applyReaction(messageId, channelId, emoji, userId, false),
  );

  // Estado ao vivo da conexão local (falando, mudo, transmitindo).
  voice.onChange(() => {
    useApp.setState({
      voicePeers: [...voice.peers],
      streaming: voice.streaming,
      selfMuted: voice.selfMuted,
      selfDeafened: voice.selfDeafened,
      voiceError: voice.error,
      // A conexão pode cair sozinha; o estado precisa refletir isso.
      voiceChannelId: voice.channelId,
    });
  });

  // Push-to-talk: o atalho global funciona com o app minimizado.
  bridge.onPushToTalk(() => {
    if (voice.connected) void voice.pushToTalkPulse();
  });

  const applyVoiceState = (channelId: string): void => {
    const api = useApp.getState().api;
    if (!api) return;
    void api
      .get<AppState['voiceState'][string]>(`/voice/channels/${channelId}`)
      .then((participants) =>
        useApp.setState((state) => ({
          voiceState: { ...state.voiceState, [channelId]: participants },
        })),
      )
      .catch(() => undefined);
  };

  realtime.on('voice.joined', ({ channelId }) => applyVoiceState(channelId));
  realtime.on('voice.left', ({ channelId }) => applyVoiceState(channelId));
  realtime.on('stream.started', ({ channelId }) => applyVoiceState(channelId));
  realtime.on('stream.ended', ({ channelId, userId }) => {
    applyVoiceState(channelId);
    // Se eu estava assistindo justamente essa transmissão, fecho a visualização.
    if (useApp.getState().watchingUserId === userId) useApp.setState({ watchingUserId: null });
  });

  realtime.on('friend.requested', () => void useApp.getState().refreshFriends());
  realtime.on('friend.accepted', () => void useApp.getState().refreshFriends());
  realtime.on('friend.removed', () => void useApp.getState().refreshFriends());
}

function applyReaction(
  messageId: string,
  channelId: string,
  emoji: string,
  userId: string,
  add: boolean,
): void {
  useApp.setState((state) => {
    const list = state.messages[channelId];
    if (!list) return state;
    const me = state.me?.id;
    return {
      messages: {
        ...state.messages,
        [channelId]: list.map((message) => {
          if (message.id !== messageId) return message;
          const reactions = [...message.reactions];
          const index = reactions.findIndex((r) => r.emoji === emoji);
          const existing = index >= 0 ? reactions[index] : undefined;

          if (add) {
            if (existing) {
              reactions[index] = {
                ...existing,
                count: existing.count + 1,
                me: existing.me || userId === me,
              };
            } else {
              reactions.push({ emoji, count: 1, me: userId === me });
            }
          } else if (existing) {
            const count = existing.count - 1;
            if (count <= 0) reactions.splice(index, 1);
            else reactions[index] = { ...existing, count, me: existing.me && userId !== me };
          }
          return { ...message, reactions };
        }),
      },
    };
  });
}

async function maybeNotify(title: string, body: string, authorId: string): Promise<void> {
  const state = useApp.getState();
  if (state.me?.id === authorId) return;
  if (document.hasFocus()) return;
  await bridge.notify(title, body || 'Enviou um anexo');
}
