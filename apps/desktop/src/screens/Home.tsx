import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { PresenceStatus } from '@nexus/shared';
import { Avatar } from '../components/Avatar';
import { Composer } from '../components/Composer';
import { MessageList } from '../components/MessageList';
import { TypingIndicator } from '../components/TypingIndicator';
import { AddServerDialog } from '../components/AddServerDialog';
import { CallView } from '../components/CallView';
import { InviteDialog } from '../components/InviteDialog';
import { VoiceSettings } from '../components/VoiceSettings';
import { ScreenSharePicker } from '../components/ScreenSharePicker';
import { useApp } from '../store/app';
import { Logo } from './Connect';

export function Home(): JSX.Element {
  const connection = useApp((s) => s.connection);
  const error = useApp((s) => s.error);
  const setError = useApp((s) => s.setError);

  return (
    <div className="flex h-full flex-col">
      {connection !== 'connected' && (
        <div className="bg-warn-500/15 py-1 text-center text-xs text-warn-500">
          {connection === 'reconnecting' ? 'Reconectando…' : 'Conectando ao servidor…'}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <ServerRail />
        <Sidebar />
        <MainPane />
      </div>

      {error && (
        <button
          onClick={() => setError(null)}
          className="absolute bottom-4 right-4 rounded-lg border border-alert-500/40 bg-alert-500/15 px-4 py-2 text-sm text-alert-500"
        >
          {error} — clique para dispensar
        </button>
      )}
    </div>
  );
}

function ServerRail(): JSX.Element {
  const servers = useApp((s) => s.servers);
  const view = useApp((s) => s.view);
  const openServer = useApp((s) => s.openServer);
  const openFriends = useApp((s) => s.openFriends);
  const [adding, setAdding] = useState(false);

  return (
    <nav className="flex w-rail shrink-0 flex-col items-center gap-2 bg-ink-950 py-3">
      <button
        onClick={openFriends}
        title="Início"
        aria-label="Início"
        className={`flex h-11 w-11 items-center justify-center rounded-2xl transition-all hover:rounded-xl ${
          view.kind !== 'server' ? 'bg-pulse-500' : 'bg-ink-800 hover:bg-pulse-500'
        }`}
      >
        <svg width="22" height="22" viewBox="0 0 36 36" aria-hidden>
          <path
            d="M11 25V11l14 14V11"
            fill="none"
            stroke="#fff"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div className="my-1 h-px w-8 bg-ink-700" />

      <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto">
        {servers.map((server) => {
          const active = view.kind === 'server' && view.serverId === server.id;
          return (
            <button
              key={server.id}
              onClick={() => void openServer(server.id)}
              title={server.name}
              className={`group relative flex h-11 w-11 items-center justify-center rounded-2xl font-semibold transition-all hover:rounded-xl ${
                active ? 'rounded-xl bg-pulse-500 text-white' : 'bg-ink-800 text-mist-200 hover:bg-pulse-500 hover:text-white'
              }`}
            >
              {server.iconUrl ? (
                <img src={server.iconUrl} alt="" className="h-full w-full rounded-[inherit] object-cover" />
              ) : (
                server.name.slice(0, 2).toUpperCase()
              )}
              <span
                className={`absolute -left-3 w-1 rounded-r bg-mist-50 transition-all ${active ? 'h-6' : 'h-0 group-hover:h-3'}`}
              />
            </button>
          );
        })}
      </div>

      <button
        onClick={() => setAdding(true)}
        title="Adicionar servidor"
        aria-label="Adicionar servidor"
        className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink-800 text-xl text-signal-500 transition-all hover:rounded-xl hover:bg-signal-500 hover:text-white"
      >
        +
      </button>

      {adding && <AddServerDialog onClose={() => setAdding(false)} />}
    </nav>
  );
}

function Sidebar(): JSX.Element {
  const view = useApp((s) => s.view);
  const detail = useApp((s) => s.serverDetail);
  const conversations = useApp((s) => s.conversations);
  const activeChannelId = useApp((s) => s.activeChannelId);
  const openChannel = useApp((s) => s.openChannel);
  const openConversation = useApp((s) => s.openConversation);
  const openFriends = useApp((s) => s.openFriends);
  const me = useApp((s) => s.me);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [inviting, setInviting] = useState(false);

  const isServer = view.kind === 'server' && detail;

  return (
    <aside className="flex w-sidebar shrink-0 flex-col bg-ink-850">
      <header className="flex h-header items-center gap-2 border-b border-ink-950/60 px-4 shadow-sm">
        <h2 className="min-w-0 flex-1 truncate font-semibold">
          {isServer ? detail.name : 'Mensagens'}
        </h2>
        {isServer && (
          <button
            onClick={() => setInviting(true)}
            title="Convidar pessoas"
            aria-label="Convidar pessoas"
            className="rounded p-1 text-mist-400 transition-colors hover:bg-ink-800 hover:text-mist-50"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M15 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" />
              <circle cx="8.5" cy="8" r="3.5" />
              <path d="M19 8v6M22 11h-6" />
            </svg>
          </button>
        )}
      </header>

      {isServer && inviting && (
        <InviteDialog
          serverId={detail.id}
          serverName={detail.name}
          onClose={() => setInviting(false)}
        />
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {isServer ? (
          <ChannelTree
            detail={detail}
            activeChannelId={activeChannelId}
            collapsed={collapsed}
            onToggle={(id) => setCollapsed((c) => ({ ...c, [id]: !c[id] }))}
            onOpen={(id) => void openChannel(id)}
          />
        ) : (
          <>
            <button
              onClick={openFriends}
              className={`mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                view.kind === 'friends' ? 'bg-ink-700 text-mist-50' : 'text-mist-400 hover:bg-ink-800 hover:text-mist-200'
              }`}
            >
              👥 Amigos
            </button>

            <p className="mb-1 mt-3 px-2 text-[11px] font-semibold uppercase tracking-wide text-mist-400">
              Conversas privadas
            </p>

            {conversations.length === 0 && (
              <p className="px-2 py-3 text-xs text-mist-400">
                Nenhuma conversa ainda. Abra uma pela lista de amigos.
              </p>
            )}

            {conversations.map((conversation) => {
              const others = conversation.participants.filter((p) => p.id !== me?.id);
              const title =
                conversation.name ?? (others.map((o) => o.displayName).join(', ') || 'Conversa');
              const active = view.kind === 'dm' && view.conversationId === conversation.id;
              return (
                <button
                  key={conversation.id}
                  onClick={() => void openConversation(conversation.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                    active ? 'bg-ink-700 text-mist-50' : 'text-mist-400 hover:bg-ink-800 hover:text-mist-200'
                  }`}
                >
                  <Avatar name={title} size={28} />
                  <span className="truncate">{title}</span>
                </button>
              );
            })}
          </>
        )}
      </div>

      <VoicePanel />
      <UserPanel />
    </aside>
  );
}

function ChannelTree({
  detail,
  activeChannelId,
  collapsed,
  onToggle,
  onOpen,
}: {
  detail: NonNullable<ReturnType<typeof useApp.getState>['serverDetail']>;
  activeChannelId: string | null;
  collapsed: Record<string, boolean>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}): JSX.Element {
  const uncategorized = detail.channels.filter((c) => !c.categoryId);

  const channelButton = (channel: (typeof detail.channels)[number]): JSX.Element => {
    if (channel.type === 'VOICE') return <VoiceChannel key={channel.id} channel={channel} />;
    return (
      <button
        key={channel.id}
        onClick={() => onOpen(channel.id)}
        title={channel.topic ?? channel.name}
        className={`flex h-row w-full items-center gap-1.5 rounded-md px-2 text-left transition-colors ${
          activeChannelId === channel.id
            ? 'bg-ink-700 text-mist-50'
            : 'text-mist-400 hover:bg-ink-800 hover:text-mist-200'
        }`}
      >
        <span className="text-mist-400">#</span>
        <span className="truncate">{channel.name}</span>
      </button>
    );
  };

  return (
    <>
      {uncategorized.map(channelButton)}

      {detail.categories.map((category) => {
        const channels = detail.channels.filter((c) => c.categoryId === category.id);
        const isCollapsed = collapsed[category.id];
        return (
          <div key={category.id} className="mt-3">
            <button
              onClick={() => onToggle(category.id)}
              className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-mist-400 hover:text-mist-200"
            >
              <span className={`transition-transform ${isCollapsed ? '-rotate-90' : ''}`}>▾</span>
              {category.name}
            </button>
            {!isCollapsed && channels.map(channelButton)}
          </div>
        );
      })}
    </>
  );
}

/** Um canal de voz na barra lateral, com quem está dentro. */
function VoiceChannel({
  channel,
}: {
  channel: { id: string; name: string };
}): JSX.Element {
  const voiceState = useApp((s) => s.voiceState[channel.id] ?? []);
  const voiceAvailable = useApp((s) => s.voiceAvailable);
  const voiceChannelId = useApp((s) => s.voiceChannelId);
  const connecting = useApp((s) => s.voiceConnecting);
  const joinVoice = useApp((s) => s.joinVoice);
  const openCall = useApp((s) => s.openCall);
  const members = useApp((s) => s.serverDetail?.members);
  const active = voiceChannelId === channel.id;

  const nameOf = (userId: string): string =>
    members?.find((m) => m.userId === userId)?.user.displayName ?? 'alguém';

  return (
    <div>
      <button
        onClick={() => {
          if (!voiceAvailable) return;
          // Já conectado: só traz a chamada de volta para a área principal.
          if (active) openCall(channel.id);
          else void joinVoice(channel.id);
        }}
        disabled={!voiceAvailable || connecting}
        title={
          voiceAvailable
            ? `Entrar em ${channel.name}`
            : 'A voz não está configurada neste servidor'
        }
        className={`flex h-row w-full items-center gap-1.5 rounded-md px-2 text-left transition-colors ${
          active ? 'bg-ink-700 text-mist-50' : 'text-mist-400 hover:bg-ink-800 hover:text-mist-200'
        } ${!voiceAvailable ? 'opacity-50' : ''}`}
      >
        <span>🔊</span>
        <span className="truncate">{channel.name}</span>
      </button>

      {voiceState.map((participant) => (
        <div
          key={participant.userId}
          className="ml-5 flex items-center gap-1.5 rounded px-2 py-0.5 text-xs text-mist-400"
        >
          <Avatar name={nameOf(participant.userId)} size={18} />
          <span className="truncate">{nameOf(participant.userId)}</span>
          {(participant.selfMuted || participant.serverMuted) && <span title="Sem microfone">🔇</span>}
          {participant.streaming && (
            <span className="rounded bg-alert-500 px-1 text-[9px] font-semibold text-white">
              AO VIVO
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Barra de voz conectada: o que aparece quando você está numa sala. */
function VoicePanel(): JSX.Element | null {
  const voiceChannelId = useApp((s) => s.voiceChannelId);
  const detail = useApp((s) => s.serverDetail);
  const streaming = useApp((s) => s.streaming);
  const error = useApp((s) => s.voiceError);
  const leaveVoice = useApp((s) => s.leaveVoice);
  const stopScreenShare = useApp((s) => s.stopScreenShare);
  const startScreenShare = useApp((s) => s.startScreenShare);
  const picking = useApp((s) => s.sharePickerOpen);
  const setPicking = useApp((s) => s.setSharePickerOpen);

  if (!voiceChannelId) return null;
  const channel = detail?.channels.find((c) => c.id === voiceChannelId);

  return (
    <>
      <div className="border-t border-ink-950/60 bg-ink-900 px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-signal-500">Voz conectada</p>
            <p className="truncate text-[11px] text-mist-400">
              {channel?.name ?? 'Canal de voz'}
            </p>
          </div>
          <button
            onClick={() => void leaveVoice()}
            title="Desconectar"
            aria-label="Desconectar da voz"
            className="rounded p-1.5 text-mist-400 hover:bg-ink-700 hover:text-alert-500"
          >
            ⏏
          </button>
        </div>

        {error && <p className="mt-1 text-[11px] text-alert-500">{error}</p>}

        <button
          onClick={() => (streaming ? void stopScreenShare() : setPicking(true))}
          className={`mt-2 w-full rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            streaming
              ? 'bg-alert-500 text-white hover:bg-alert-500/80'
              : 'bg-ink-700 text-mist-200 hover:bg-ink-600'
          }`}
        >
          {streaming ? 'Parar transmissão' : 'Compartilhar tela'}
        </button>
      </div>

      {picking && (
        <ScreenSharePicker
          onCancel={() => setPicking(false)}
          onShare={(sourceId, quality, withAudio) => {
            setPicking(false);
            void startScreenShare(sourceId, quality, withAudio);
          }}
        />
      )}
    </>
  );
}

function UserPanel(): JSX.Element {
  const me = useApp((s) => s.me);
  const logout = useApp((s) => s.logout);
  const selfMuted = useApp((s) => s.selfMuted);
  const selfDeafened = useApp((s) => s.selfDeafened);
  const inVoice = useApp((s) => s.voiceChannelId !== null);
  const toggleMute = useApp((s) => s.toggleMute);
  const toggleDeafen = useApp((s) => s.toggleDeafen);
  const [settingsOpen, setSettingsOpen] = useState(false);
  if (!me) return <div />;

  return (
    <div className="flex items-center gap-1 border-t border-ink-950/60 bg-ink-900 px-2 py-2">
      <Avatar name={me.displayName} url={me.avatarUrl} size={32} status="ONLINE" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{me.displayName}</p>
        <p className="truncate text-[11px] text-mist-400">@{me.username}</p>
      </div>
      {inVoice && (
        <>
          <button
            onClick={() => void toggleMute()}
            title={selfMuted ? 'Ativar microfone' : 'Silenciar microfone'}
            aria-label={selfMuted ? 'Ativar microfone' : 'Silenciar microfone'}
            className={`rounded p-1.5 transition-colors hover:bg-ink-700 ${
              selfMuted ? 'text-alert-500' : 'text-mist-400 hover:text-mist-50'
            }`}
          >
            {selfMuted ? '🔇' : '🎙'}
          </button>
          <button
            onClick={() => void toggleDeafen()}
            title={selfDeafened ? 'Voltar a ouvir' : 'Ensurdecer'}
            aria-label={selfDeafened ? 'Voltar a ouvir' : 'Ensurdecer'}
            className={`rounded p-1.5 transition-colors hover:bg-ink-700 ${
              selfDeafened ? 'text-alert-500' : 'text-mist-400 hover:text-mist-50'
            }`}
          >
            {selfDeafened ? '🔕' : '🎧'}
          </button>
        </>
      )}
      <button
        onClick={() => setSettingsOpen(true)}
        title="Voz e vídeo"
        aria-label="Configurações de voz e vídeo"
        className="rounded p-1.5 text-mist-400 transition-colors hover:bg-ink-700 hover:text-mist-50"
      >
        ⚙
      </button>
      <button
        onClick={() => void logout()}
        title="Sair"
        aria-label="Sair"
        className="rounded p-1.5 text-mist-400 transition-colors hover:bg-ink-700 hover:text-alert-500"
      >
        ⏻
      </button>

      {settingsOpen && <VoiceSettings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function MainPane(): JSX.Element {
  const view = useApp((s) => s.view);
  if (view.kind === 'friends') return <FriendsView />;
  if (view.kind === 'call') return <CallView channelId={view.channelId} />;
  return <ChatView />;
}

function ChatView(): JSX.Element {
  const view = useApp((s) => s.view);
  const activeChannelId = useApp((s) => s.activeChannelId);
  const detail = useApp((s) => s.serverDetail);
  const conversations = useApp((s) => s.conversations);
  const messages = useApp((s) => s.messages);
  const directMessages = useApp((s) => s.directMessages);
  const pending = useApp((s) => s.pending);
  const typing = useApp((s) => s.typing);
  const loadOlder = useApp((s) => s.loadOlder);
  const me = useApp((s) => s.me);
  const e2eeStatus = useApp((s) => s.e2eeStatus);

  const isDm = view.kind === 'dm';
  const list = activeChannelId
    ? isDm
      ? (directMessages[activeChannelId] ?? [])
      : (messages[activeChannelId] ?? [])
    : [];

  const channel = detail?.channels.find((c) => c.id === activeChannelId);
  const conversation = conversations.find((c) => c.id === activeChannelId);
  const title = isDm
    ? (conversation?.name ??
      conversation?.participants
        .filter((p) => p.id !== me?.id)
        .map((p) => p.displayName)
        .join(', ') ??
      'Conversa')
    : (channel?.name ?? '');

  if (!activeChannelId) {
    return (
      <div className="flex flex-1 items-center justify-center bg-ink-900 text-mist-400">
        Selecione um canal para começar.
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-ink-900">
      <header className="flex h-header shrink-0 items-center gap-2 border-b border-ink-950/60 px-4 shadow-sm">
        <span className="text-mist-400">{isDm ? '@' : '#'}</span>
        <h2 className="truncate font-semibold">{title}</h2>
        {channel?.topic && (
          <>
            <span className="h-4 w-px bg-ink-700" />
            <p className="truncate text-xs text-mist-400">{channel.topic}</p>
          </>
        )}
      </header>

      {isDm && <PrivacyBanner />}

      <MessageList
        messages={list}
        pending={pending[activeChannelId] ?? []}
        onLoadOlder={() => void loadOlder()}
      />

      <TypingIndicator
        names={(typing[activeChannelId] ?? [])
          .filter((t) => t.userId !== me?.id)
          .map((t) => t.displayName)}
      />

      <Composer
        placeholder={
          isDm && e2eeStatus === 'unavailable'
            ? 'Criptografia indisponível — não é possível enviar'
            : `Conversar em ${isDm ? title : `#${title}`}`
        }
        disabled={isDm && e2eeStatus === 'unavailable'}
      />
    </div>
  );
}

/**
 * Duas garantias da conversa privada, ditas de forma direta: ninguém fora dela
 * consegue ler, e nada sobrevive a 8 horas.
 */
function PrivacyBanner(): JSX.Element {
  const e2eeStatus = useApp((s) => s.e2eeStatus);

  if (e2eeStatus === 'unavailable') {
    return (
      <div className="flex items-center gap-2 border-b border-alert-500/30 bg-alert-500/10 px-4 py-2 text-xs text-alert-500">
        <LockIcon />
        Criptografia indisponível neste dispositivo. O envio está bloqueado — nenhuma mensagem
        privada sai sem estar cifrada.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-ink-800 bg-ink-850/60 px-4 py-2 text-xs text-mist-400">
      <span className="flex items-center gap-1.5">
        <LockIcon />
        Criptografada ponta a ponta — nem o servidor consegue ler.
      </span>
      <span className="flex items-center gap-1.5">
        <ClockIcon />
        Apagada permanentemente 8 horas após o envio.
      </span>
      {e2eeStatus === 'weak-storage' && (
        <span className="text-warn-500">
          Atenção: o sistema não protege as chaves em repouso neste computador.
        </span>
      )}
    </div>
  );
}

function LockIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" />
    </svg>
  );
}

function FriendsView(): JSX.Element {
  const friends = useApp((s) => s.friends);
  const presences = useApp((s) => s.presences);
  const startDm = useApp((s) => s.startDm);
  const addFriend = useApp((s) => s.addFriend);
  const respond = useApp((s) => s.respondFriendRequest);
  const refreshFriends = useApp((s) => s.refreshFriends);
  const [tab, setTab] = useState<'online' | 'all' | 'pending' | 'blocked'>('online');
  const [username, setUsername] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    void refreshFriends();
  }, [refreshFriends]);

  const statusOf = (id: string): PresenceStatus =>
    presences[id]?.status ?? friends.friends.find((f) => f.id === id)?.presence.status ?? 'OFFLINE';

  const visible = useMemo(() => {
    if (tab === 'online') return friends.friends.filter((f) => statusOf(f.id) !== 'OFFLINE');
    if (tab === 'all') return friends.friends;
    return [];
  }, [tab, friends, presences]);

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-ink-900">
      <header className="flex h-header shrink-0 items-center gap-4 border-b border-ink-950/60 px-4 shadow-sm">
        <h2 className="font-semibold">Amigos</h2>
        <nav className="flex gap-1">
          {(
            [
              ['online', 'Online'],
              ['all', 'Todos'],
              ['pending', `Pendentes${friends.incoming.length ? ` (${friends.incoming.length})` : ''}`],
              ['blocked', 'Bloqueados'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
                tab === key ? 'bg-ink-700 text-mist-50' : 'text-mist-400 hover:bg-ink-800 hover:text-mist-200'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="border-b border-ink-800 px-6 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-mist-400">
          Adicionar amigo
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="nome de usuário"
            aria-label="Nome de usuário do amigo"
            className="flex-1 rounded-lg border border-ink-600 bg-ink-850 px-3 py-2 text-sm focus:border-pulse-400 focus:outline-none"
          />
          <button
            onClick={async () => {
              try {
                const status = await addFriend(username.trim().toLowerCase());
                setUsername('');
                setFeedback(
                  status === 'ACCEPTED'
                    ? 'Vocês agora são amigos.'
                    : status === 'ALREADY_FRIENDS'
                      ? 'Vocês já são amigos.'
                      : 'Solicitação enviada.',
                );
              } catch (err) {
                setFeedback(err instanceof Error ? err.message : 'Não foi possível enviar.');
              }
            }}
            disabled={username.trim().length < 3}
            className="rounded-lg bg-pulse-500 px-4 text-sm font-medium text-white transition-colors hover:bg-pulse-400 disabled:opacity-40"
          >
            Enviar
          </button>
        </div>
        {feedback && <p className="mt-2 text-xs text-mist-400">{feedback}</p>}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {tab === 'pending' && (
          <>
            {friends.incoming.length === 0 && friends.outgoing.length === 0 && (
              <Empty text="Nenhuma solicitação pendente." />
            )}
            {friends.incoming.map((request) => (
              <div key={request.id} className="flex items-center gap-3 rounded-lg py-2 hover:bg-ink-850">
                <Avatar name={request.user.displayName} url={request.user.avatarUrl} size={36} />
                <div className="flex-1">
                  <p className="text-sm font-medium">{request.user.displayName}</p>
                  <p className="text-xs text-mist-400">quer ser seu amigo</p>
                </div>
                <button
                  onClick={() => void respond(request.id, true)}
                  className="rounded-md bg-signal-500/20 px-3 py-1 text-sm text-signal-500 hover:bg-signal-500/30"
                >
                  Aceitar
                </button>
                <button
                  onClick={() => void respond(request.id, false)}
                  className="rounded-md bg-ink-700 px-3 py-1 text-sm text-mist-200 hover:bg-ink-600"
                >
                  Recusar
                </button>
              </div>
            ))}
            {friends.outgoing.map((request) => (
              <div key={request.id} className="flex items-center gap-3 rounded-lg py-2 opacity-70">
                <Avatar name={request.user.displayName} url={request.user.avatarUrl} size={36} />
                <div className="flex-1">
                  <p className="text-sm font-medium">{request.user.displayName}</p>
                  <p className="text-xs text-mist-400">solicitação enviada</p>
                </div>
              </div>
            ))}
          </>
        )}

        {tab === 'blocked' && (
          <>
            {friends.blocked.length === 0 && <Empty text="Ninguém bloqueado." />}
            {friends.blocked.map((user) => (
              <div key={user.id} className="flex items-center gap-3 rounded-lg py-2">
                <Avatar name={user.displayName} url={user.avatarUrl} size={36} />
                <p className="flex-1 text-sm">{user.displayName}</p>
              </div>
            ))}
          </>
        )}

        {(tab === 'online' || tab === 'all') && (
          <>
            {visible.length === 0 && (
              <Empty text={tab === 'online' ? 'Ninguém online agora.' : 'Sua lista de amigos está vazia.'} />
            )}
            {visible.map((friend) => (
              <button
                key={friend.id}
                onClick={() => void startDm(friend.id)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-ink-850"
              >
                <Avatar
                  name={friend.displayName}
                  url={friend.avatarUrl}
                  size={36}
                  status={statusOf(friend.id)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{friend.displayName}</p>
                  <p className="truncate text-xs text-mist-400">@{friend.username}</p>
                </div>
                <span className="text-xs text-mist-400">Abrir conversa</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-mist-400">
      <Logo />
      <p className="text-sm">{text}</p>
    </div>
  );
}
