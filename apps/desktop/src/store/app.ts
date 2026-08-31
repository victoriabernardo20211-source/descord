import { create } from 'zustand';
import type { DirectMessage, Message, PresenceState, PublicUser } from '@nexus/shared';
import { ApiClient } from '../lib/api';
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

/** Mensagem otimista: aparece na hora e vira `sent` quando o servidor confirma. */
export interface PendingMessage {
  clientMessageId: string;
  content: string;
  status: 'sending' | 'failed';
}

type View = { kind: 'friends' } | { kind: 'dm'; conversationId: string } | { kind: 'server'; serverId: string };

interface AppState {
  api: ApiClient | null;
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

  messages: Record<string, Message[]>;
  directMessages: Record<string, DirectMessage[]>;
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

  sendMessage: (content: string, attachmentIds?: string[]) => Promise<void>;
  loadOlder: () => Promise<void>;
  react: (messageId: string, emoji: string, add: boolean) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  notifyTyping: () => void;

  createServer: (name: string) => Promise<void>;
  joinServer: (code: string) => Promise<void>;
  addFriend: (username: string) => Promise<string>;
  respondFriendRequest: (id: string, accept: boolean) => Promise<void>;
  refreshFriends: () => Promise<void>;
  setError: (message: string | null) => void;
}

const randomId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const useApp = create<AppState>((set, get) => ({
  api: null,
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
  messages: {},
  directMessages: {},
  pending: {},
  typing: {},
  error: null,

  setError: (message) => set({ error: message }),

  /** Primeira execução: o app precisa saber onde fica o nosso servidor. */
  configureServer: async (url) => {
    const clean = url.trim().replace(/\/+$/, '');
    const api = new ApiClient(clean);
    const health = await api.syncClock().catch(() => ({ ok: false }));
    if (!health.ok) {
      set({ status: 'server-unreachable', error: 'Não foi possível conectar ao servidor.' });
      return;
    }
    await bridge.setConfig({ apiUrl: clean });
    set({ api, apiUrl: clean, status: 'login', error: null });
  },

  boot: async () => {
    const config = await bridge.getConfig();
    if (!config.apiUrl) {
      set({ status: 'needs-server' });
      return;
    }

    const api = new ApiClient(config.apiUrl);
    set({ api, apiUrl: config.apiUrl });

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
      await afterLogin(set, get);
    } catch {
      await bridge.clearSession();
      set({ status: 'login' });
    }
  },

  login: async (email, password) => {
    const api = get().api;
    if (!api) return;
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
    await bridge.clearSession();
    // Nada de conteúdo privado sobrando em memória depois do logout.
    set({
      status: 'login',
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
    const messages = await api.get<DirectMessage[]>(
      `/dm/conversations/${conversationId}/messages`,
    );
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

  sendMessage: async (content, attachmentIds) => {
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

    const path =
      view.kind === 'dm'
        ? `/dm/conversations/${activeChannelId}/messages`
        : `/channels/${activeChannelId}/messages`;

    try {
      await api.post(path, { content, clientMessageId, attachmentIds });
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
      const older = await api.get<DirectMessage[]>(
        `/dm/conversations/${activeChannelId}/messages?before=${oldest.id}`,
      );
      if (older.length === 0) return;
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

  if (api.token) realtime.connect(api.baseUrl, api.token);
  registerRealtimeHandlers();
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
    useApp.setState((state) => {
      const list = state.directMessages[message.conversationId] ?? [];
      if (list.some((m) => m.id === message.id)) return state;
      return {
        directMessages: { ...state.directMessages, [message.conversationId]: [...list, message] },
      };
    });
    void maybeNotify(message.author.displayName, message.content, message.author.id);
  });

  realtime.on('dm.updated', (message) => {
    useApp.setState((state) => {
      const list = state.directMessages[message.conversationId] ?? [];
      return {
        directMessages: {
          ...state.directMessages,
          [message.conversationId]: list.map((m) => (m.id === message.id ? message : m)),
        },
      };
    });
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
