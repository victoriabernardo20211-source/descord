// Arnês de conferência visual: monta a tela principal com dados falsos, sem
// servidor. Não faz parte do produto — usado só para revisar o layout.
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import './styles/global.css';
import { Home } from './screens/Home';
import { useApp } from './store/app';

const user = (id: string, displayName: string, username: string) => ({
  id,
  username,
  displayName,
  avatarUrl: null,
});

const now = Date.now();
const msg = (id: string, author: ReturnType<typeof user>, content: string, minutesAgo: number) => ({
  id,
  channelId: 'c1',
  author,
  content,
  attachments: [],
  reactions: [],
  createdAt: new Date(now - minutesAgo * 60_000).toISOString(),
  editedAt: null,
  replyToId: null,
});

const bel = user('u1', 'Bel', 'bel');
const lucas = user('u2', 'Lucas Prado', 'lucas');
const ana = user('u3', 'Ana Reis', 'ana');

useApp.setState({
  status: 'ready',
  connection: 'connected',
  me: { ...bel, isGlobalAdmin: true },
  view: { kind: 'server', serverId: 's1' },
  activeChannelId: 'c1',
  servers: [
    { id: 's1', name: 'Os Cria', iconUrl: null, ownerId: 'u1' },
    { id: 's2', name: 'Estudos', iconUrl: null, ownerId: 'u1' },
  ],
  serverDetail: {
    id: 's1',
    name: 'Os Cria',
    iconUrl: null,
    ownerId: 'u1',
    permissions: '0',
    permissionNames: [],
    categories: [{ id: 'cat1', name: 'Texto', position: 0 }, { id: 'cat2', name: 'Voz', position: 1 }],
    channels: [
      { id: 'c1', name: 'geral', type: 'TEXT', topic: 'o que der na telha', categoryId: 'cat1', position: 0 },
      { id: 'c2', name: 'links', type: 'TEXT', topic: null, categoryId: 'cat1', position: 1 },
      { id: 'c3', name: 'Sala 1', type: 'VOICE', topic: null, categoryId: 'cat2', position: 0 },
    ],
    roles: [],
    members: [
      { userId: 'u1', nickname: null, roleIds: [], user: bel },
      { userId: 'u2', nickname: null, roleIds: [], user: lucas },
      { userId: 'u3', nickname: null, roleIds: [], user: ana },
    ],
  },
  presences: {
    u1: { status: 'ONLINE', customStatus: null },
    u2: { status: 'ONLINE', customStatus: null },
    u3: { status: 'OFFLINE', customStatus: null },
  },
  voiceState: {
    c3: [
      { userId: 'u2', selfMuted: false, selfDeafened: false, serverMuted: false, streaming: true },
      { userId: 'u3', selfMuted: true, selfDeafened: false, serverMuted: false, streaming: false },
    ],
  },
  voiceChannelId: 'c3',
  voicePeers: [
    { userId: 'u1', displayName: 'Bel', speaking: true, micMuted: false, streaming: false, volume: 100 },
    { userId: 'u2', displayName: 'Lucas Prado', speaking: false, micMuted: false, streaming: true, volume: 100 },
    { userId: 'u3', displayName: 'Ana Reis', speaking: false, micMuted: true, streaming: false, volume: 100 },
  ],
  voiceAvailable: true,
  conversations: [
    { id: 'd1', isGroup: false, name: null, iconUrl: null, participants: [bel, lucas] },
  ],
  messages: {
    c1: [
      msg('m1', lucas, 'alguém pra jogar hoje à noite?', 180),
      msg('m2', lucas, 'tô livre depois das 21h', 179),
      msg('m3', bel, 'eu topo, só preciso terminar uma coisa antes', 90),
      msg('m4', ana, 'conta comigo também', 12),
    ],
  },
  pending: {},
  friends: {
    friends: [
      { ...lucas, presence: { status: 'ONLINE', customStatus: null } },
      { ...ana, presence: { status: 'OFFLINE', customStatus: null } },
    ],
    incoming: [{ id: 'r1', user: user('u4', 'Pomba Preta', 'pombapreta') }],
    outgoing: [],
    blocked: [],
  },
  directMessages: {
    d1: [
      { id: 'p1', conversationId: 'd1', author: lucas, content: 'chega em casa que horas?', attachments: [], reactions: [], createdAt: new Date(now - 40 * 60_000).toISOString(), editedAt: null, expiresAt: new Date(now + 7.3 * 3600_000).toISOString() },
      { id: 'p2', conversationId: 'd1', author: bel, content: 'umas oito, por quê?', attachments: [], reactions: [], createdAt: new Date(now - 20 * 60_000).toISOString(), editedAt: null, expiresAt: new Date(now + 7.6 * 3600_000).toISOString() },
    ],
  },
  e2eeStatus: 'ready',
  typing: { c1: [{ userId: 'u2', displayName: 'Lucas Prado' }] },
} as never);

// A vista inicial vem do hash: #dm abre a conversa privada, para conferir o
// selo de 8 horas e o aviso de criptografia sem precisar de servidor.
if (location.hash === '#dm') {
  useApp.setState({ view: { kind: 'dm', conversationId: 'd1' }, activeChannelId: 'd1' } as never);
}

createRoot(document.getElementById('root') as HTMLElement).render(<Home />);
