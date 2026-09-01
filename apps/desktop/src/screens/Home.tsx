import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { PresenceStatus } from '@nexus/shared';
import { Avatar } from '../components/Avatar';
import { Composer } from '../components/Composer';
import { Icon, Mark } from '../components/Icon';
import { MessageList } from '../components/MessageList';
import { TypingIndicator } from '../components/TypingIndicator';
import { AddServerDialog } from '../components/AddServerDialog';
import { CallView } from '../components/CallView';
import { MembersPanel } from '../components/MembersPanel';
import { InviteDialog } from '../components/InviteDialog';
import { VoiceSettings } from '../components/VoiceSettings';
import { ScreenSharePicker } from '../components/ScreenSharePicker';
import { useApp } from '../store/app';

export function Home(): JSX.Element {
  const connection = useApp((s) => s.connection);
  const error = useApp((s) => s.error);
  const setError = useApp((s) => s.setError);

  return (
    <div className="flex h-full flex-col bg-ink-975">
      <TopBar />

      <UpdateBanner />

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

/**
 * Uma atualização já foi baixada e entra na próxima abertura.
 *
 * Não oferece "reiniciar agora" de propósito: reiniciar no meio de uma chamada
 * ou de uma conversa é pior do que esperar até a pessoa fechar o app.
 */
function UpdateBanner(): JSX.Element | null {
  const version = useApp((s) => s.updateReady);
  if (!version) return null;

  return (
    <div className="flex shrink-0 items-center justify-center gap-2 bg-signal-500/15 py-1 text-xs text-signal-500">
      <Icon name="download" size={13} />
      Versão {version} baixada — ela entra na próxima vez que você abrir o Nexus.
    </div>
  );
}

/**
 * Faixa de contexto no topo. A janela usa a moldura nativa do Windows, então
 * aqui não há botões de minimizar ou fechar: seriam desenho sem função.
 */
function TopBar(): JSX.Element {
  const view = useApp((s) => s.view);
  const detail = useApp((s) => s.serverDetail);
  const channelName = useApp((s) => {
    const channel = s.serverDetail?.channels.find((c) => c.id === s.activeChannelId);
    return channel?.name ?? null;
  });

  const crumb =
    view.kind === 'friends'
      ? 'Amigos'
      : view.kind === 'dm'
        ? 'Mensagens privadas'
        : [detail?.name, channelName && `#${channelName}`].filter(Boolean).join(' / ');

  return (
    <div className="flex h-row shrink-0 items-center justify-center gap-2 border-b border-ink-900 text-[11.5px] text-mist-500">
      <span className="text-[10.5px] font-bold tracking-[0.22em] text-mist-400">NEXUS</span>
      {crumb && (
        <>
          <span className="text-ink-600">/</span>
          <span className="max-w-[40ch] truncate">{crumb}</span>
        </>
      )}
    </div>
  );
}

function ServerRail(): JSX.Element {
  const servers = useApp((s) => s.servers);
  const openServer = useApp((s) => s.openServer);
  const openFriends = useApp((s) => s.openFriends);
  // Numa chamada a `view` não diz o servidor, mas o detalhe carregado diz: sem
  // isto o servidor perdia o destaque no rail no momento em que você entra nele.
  const currentServerId = useApp((s) =>
    s.view.kind === 'server' ? s.view.serverId : s.view.kind === 'call' ? (s.serverDetail?.id ?? null) : null,
  );
  const [adding, setAdding] = useState(false);

  const atHome = currentServerId === null;

  return (
    <nav className="flex w-rail shrink-0 flex-col items-center gap-1.5 overflow-y-auto bg-ink-950 py-2">
      <RailTile active={atHome} label="Início" onClick={openFriends}>
        <div
          className={`flex h-tile w-tile items-center justify-center text-white transition-all duration-150 ${
            atHome ? 'rounded-xl bg-pulse-500' : 'rounded-[14px] bg-ink-800 hover:rounded-xl hover:bg-pulse-500'
          }`}
        >
          <Mark size={21} />
        </div>
      </RailTile>

      <div className="my-0.5 h-px w-7 bg-ink-800" />

      {servers.map((server) => {
        const active = currentServerId === server.id;
        return (
          <RailTile
            key={server.id}
            active={active}
            label={server.name}
            onClick={() => void openServer(server.id)}
          >
            <div
              className={`flex h-tile w-tile items-center justify-center border border-white/5 text-[13px] font-semibold text-mist-50 transition-all duration-150 ${
                active ? 'rounded-xl bg-pulse-500' : 'rounded-[14px] bg-ink-850 hover:rounded-xl hover:bg-pulse-500'
              }`}
            >
              {server.iconUrl ? (
                <img src={server.iconUrl} alt="" className="h-full w-full rounded-[inherit] object-cover" />
              ) : (
                server.name.slice(0, 2).toUpperCase()
              )}
            </div>
          </RailTile>
        );
      })}

      <RailTile label="Criar ou entrar em um servidor" onClick={() => setAdding(true)}>
        <div className="flex h-tile w-tile items-center justify-center rounded-[14px] bg-ink-900 text-signal-500 transition-all duration-150 hover:rounded-xl hover:bg-signal-500 hover:text-ink-950">
          <Icon name="plus" size={19} />
        </div>
      </RailTile>

      {adding && <AddServerDialog onClose={() => setAdding(false)} />}
    </nav>
  );
}

/** Um item do rail, com a pílula branca que cresce à esquerda quando ativo. */
function RailTile({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: JSX.Element;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="group relative flex w-full justify-center"
    >
      <span
        className={`absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-[3px] bg-mist-50 transition-all duration-200 ${
          active ? 'h-6' : 'h-0 group-hover:h-2'
        }`}
      />
      {children}
    </button>
  );
}

function Sidebar(): JSX.Element {
  const view = useApp((s) => s.view);
  const detail = useApp((s) => s.serverDetail);
  const isServer = (view.kind === 'server' || view.kind === 'call') && detail;

  return (
    <aside className="flex w-sidebar shrink-0 flex-col border-r border-ink-950 bg-ink-900">
      {isServer ? <ServerSidebar /> : <HomeSidebar />}
      <VoicePanel />
      <UserPanel />
    </aside>
  );
}

function ServerSidebar(): JSX.Element {
  const detail = useApp((s) => s.serverDetail);
  const activeChannelId = useApp((s) => s.activeChannelId);
  const openChannel = useApp((s) => s.openChannel);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [inviting, setInviting] = useState(false);

  if (!detail) return <div className="flex-1" />;

  const uncategorized = detail.channels.filter((c) => !c.categoryId);
  const groups = [
    ...(uncategorized.length > 0
      ? [{ id: '__none__', name: 'Canais', channels: uncategorized }]
      : []),
    ...detail.categories.map((category) => ({
      id: category.id,
      name: category.name,
      channels: detail.channels.filter((c) => c.categoryId === category.id),
    })),
  ];

  return (
    <>
      <button
        onClick={() => setInviting(true)}
        title="Convidar pessoas"
        className="flex h-header shrink-0 items-center justify-between border-b border-ink-950/70 px-3.5 transition-colors hover:bg-ink-850"
      >
        <span className="truncate text-sm font-semibold text-mist-50">{detail.name}</span>
        <Icon name="user-plus" size={15} className="text-mist-400" />
      </button>

      {inviting && (
        <InviteDialog
          serverId={detail.id}
          serverName={detail.name}
          onClose={() => setInviting(false)}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.map((group) => {
          const isCollapsed = collapsed[group.id];
          return (
            <div key={group.id} className="mb-3">
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [group.id]: !c[group.id] }))}
                className="flex items-center gap-[3px] px-1 pb-1 pt-0.5 text-[10.5px] font-bold tracking-[0.07em] text-mist-500 transition-colors hover:text-mist-200"
              >
                <Icon
                  name="chev-d"
                  size={11}
                  strokeWidth={2.6}
                  className={`transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                />
                {group.name.toUpperCase()}
              </button>

              {!isCollapsed &&
                group.channels.map((channel) =>
                  channel.type === 'VOICE' ? (
                    <VoiceChannel key={channel.id} channel={channel} />
                  ) : (
                    <button
                      key={channel.id}
                      onClick={() => void openChannel(channel.id)}
                      title={channel.topic ?? channel.name}
                      className={`flex h-row w-full items-center gap-[7px] rounded-md px-2 transition-colors ${
                        activeChannelId === channel.id
                          ? 'bg-ink-800 font-medium text-mist-50'
                          : 'text-mist-400 hover:bg-ink-850 hover:text-mist-200'
                      }`}
                    >
                      <Icon name="hash" size={16} className="shrink-0 text-mist-500" />
                      <span className="truncate">{channel.name}</span>
                    </button>
                  ),
                )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function HomeSidebar(): JSX.Element {
  const view = useApp((s) => s.view);
  const conversations = useApp((s) => s.conversations);
  const openConversation = useApp((s) => s.openConversation);
  const openFriends = useApp((s) => s.openFriends);
  const incoming = useApp((s) => s.friends.incoming.length);
  const presences = useApp((s) => s.presences);
  const me = useApp((s) => s.me);

  return (
    <>
      <div className="flex h-header shrink-0 items-center border-b border-ink-950/70 px-2.5">
        <div className="flex h-7 flex-1 items-center rounded-md bg-ink-975 px-2.5 text-[12.5px] text-mist-500">
          Encontrar ou iniciar conversa
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <button
          onClick={openFriends}
          className={`flex h-[34px] w-full items-center gap-[9px] rounded-md px-2 font-medium transition-colors ${
            view.kind === 'friends'
              ? 'bg-ink-800 text-mist-50'
              : 'text-mist-400 hover:bg-ink-850 hover:text-mist-200'
          }`}
        >
          <Icon name="users" size={18} />
          Amigos
          {incoming > 0 && <Badge count={incoming} className="ml-auto" />}
        </button>

        <p className="px-1.5 pb-1 pt-3.5 text-[10.5px] font-bold tracking-[0.07em] text-mist-500">
          MENSAGENS PRIVADAS
        </p>

        {conversations.length === 0 && (
          <p className="px-2 py-3 text-xs text-mist-500">
            Nenhuma conversa ainda. Abra uma pela lista de amigos.
          </p>
        )}

        {conversations.map((conversation) => {
          const others = conversation.participants.filter((p) => p.id !== me?.id);
          const title =
            conversation.name ?? (others.map((o) => o.displayName).join(', ') || 'Conversa');
          const active = view.kind === 'dm' && view.conversationId === conversation.id;
          const solo = others.length === 1 ? others[0] : null;

          return (
            <button
              key={conversation.id}
              onClick={() => void openConversation(conversation.id)}
              className={`flex h-10 w-full items-center gap-[9px] rounded-md px-2 text-left transition-colors ${
                active ? 'bg-ink-800' : 'hover:bg-ink-850'
              }`}
            >
              <Avatar
                name={title}
                url={conversation.iconUrl}
                size={30}
                status={solo ? (presences[solo.id]?.status ?? 'OFFLINE') : undefined}
                ringColor="#101114"
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-[13.5px] ${
                    active ? 'font-medium text-mist-50' : 'text-mist-200'
                  }`}
                >
                  {title}
                </span>
                <span className="block truncate text-[11px] text-mist-500">
                  {solo ? `@${solo.username}` : `${others.length + 1} pessoas`}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Badge({ count, className = '' }: { count: number; className?: string }): JSX.Element {
  return (
    <span
      className={`flex h-4 min-w-4 items-center justify-center rounded-lg bg-alert-500 px-1 text-[10px] font-bold text-white ${className}`}
    >
      {count}
    </span>
  );
}

/** Um canal de voz na barra lateral, com quem está dentro. */
function VoiceChannel({ channel }: { channel: { id: string; name: string } }): JSX.Element {
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
          voiceAvailable ? `Entrar em ${channel.name}` : 'A voz não está configurada neste servidor'
        }
        className={`flex h-row w-full items-center gap-[7px] rounded-md px-2 transition-colors ${
          active ? 'bg-ink-800 font-medium text-mist-50' : 'text-mist-400 hover:bg-ink-850 hover:text-mist-200'
        } ${!voiceAvailable ? 'opacity-50' : ''}`}
      >
        <Icon name="speaker" size={16} className="shrink-0 text-mist-500" />
        <span className="truncate">{channel.name}</span>
      </button>

      {voiceState.map((participant) => (
        <div
          key={participant.userId}
          className="flex h-7 items-center gap-[7px] rounded-md py-0 pl-[22px] pr-2 hover:bg-ink-850"
        >
          <Avatar name={nameOf(participant.userId)} size={20} />
          <span className="flex-1 truncate text-[13px] text-mist-400">
            {nameOf(participant.userId)}
          </span>
          {participant.streaming && <LiveTag />}
          {(participant.selfMuted || participant.serverMuted) && (
            <Icon name="mic-off" size={13} className="text-alert-500" />
          )}
        </div>
      ))}
    </div>
  );
}

export function LiveTag(): JSX.Element {
  return (
    <span className="rounded border border-live-500/45 px-1 py-px text-[9px] font-extrabold tracking-[0.08em] text-live-500">
      LIVE
    </span>
  );
}

/** Barra de voz conectada: o que aparece quando você está numa sala. */
function VoicePanel(): JSX.Element | null {
  const voiceChannelId = useApp((s) => s.voiceChannelId);
  const detail = useApp((s) => s.serverDetail);
  const streaming = useApp((s) => s.streaming);
  const error = useApp((s) => s.voiceError);
  const leaveVoice = useApp((s) => s.leaveVoice);
  const openCall = useApp((s) => s.openCall);
  const stopScreenShare = useApp((s) => s.stopScreenShare);
  const startScreenShare = useApp((s) => s.startScreenShare);
  const picking = useApp((s) => s.sharePickerOpen);
  const setPicking = useApp((s) => s.setSharePickerOpen);

  if (!voiceChannelId) return null;
  const channel = detail?.channels.find((c) => c.id === voiceChannelId);

  return (
    <>
      <div className="border-t border-ink-950 bg-ink-950/60 px-2.5 pb-1.5 pt-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-signal-500">
              <Icon name="signal" size={13} strokeWidth={2.4} />
              Voz conectada
            </p>
            <p className="truncate text-[11.5px] text-mist-400">
              {channel?.name ?? 'Canal de voz'}
              {detail && <span className="text-mist-500"> · {detail.name}</span>}
            </p>
          </div>
          <button
            onClick={() => void leaveVoice()}
            title="Desconectar"
            aria-label="Desconectar da voz"
            className="flex h-7 w-7 items-center justify-center rounded-md text-mist-400 transition-colors hover:bg-alert-tint hover:text-alert-500"
          >
            <Icon name="phone-off" size={16} />
          </button>
        </div>

        {error && <p className="mt-1 text-[11px] text-alert-500">{error}</p>}

        <div className="mt-2 flex gap-1.5">
          <button
            onClick={() => openCall(voiceChannelId)}
            className="flex h-[30px] flex-1 items-center justify-center gap-1.5 rounded-md bg-ink-850 text-xs text-mist-200 transition-colors hover:bg-ink-800"
          >
            <Icon name="monitor" size={14} />
            Ver call
          </button>
          <button
            onClick={() => (streaming ? void stopScreenShare() : setPicking(true))}
            className={`flex h-[30px] flex-1 items-center justify-center gap-1.5 rounded-md text-xs transition-colors ${
              streaming
                ? 'bg-alert-500 text-white hover:brightness-110'
                : 'bg-ink-850 text-mist-200 hover:bg-ink-800'
            }`}
          >
            <Icon name="share" size={14} />
            {streaming ? 'Parar' : 'Transmitir'}
          </button>
        </div>
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

  const square = (
    label: string,
    onClick: () => void,
    icon: JSX.Element,
    danger = false,
  ): JSX.Element => (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-[30px] w-[30px] items-center justify-center rounded-md transition-colors hover:bg-ink-850 ${
        danger ? 'text-alert-500' : 'text-mist-400 hover:text-mist-50'
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex h-user shrink-0 items-center gap-1 bg-ink-950 pl-2 pr-1.5">
      <div
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1"
        title={`Nexus · build ${__BUILD_ID__}`}
      >
        <Avatar name={me.displayName} url={me.avatarUrl} size={30} status="ONLINE" ringColor="#0a0b0d" />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold leading-tight text-mist-50">
            {me.displayName}
          </p>
          <p className="truncate text-[11px] leading-tight text-mist-500">@{me.username}</p>
        </div>
      </div>

      {inVoice &&
        square(
          selfMuted ? 'Ativar microfone' : 'Silenciar microfone',
          () => void toggleMute(),
          <Icon name={selfMuted ? 'mic-off' : 'mic'} size={17} />,
          selfMuted,
        )}
      {inVoice &&
        square(
          selfDeafened ? 'Voltar a ouvir' : 'Ensurdecer',
          () => void toggleDeafen(),
          <Icon name={selfDeafened ? 'head-off' : 'head'} size={17} />,
          selfDeafened,
        )}
      {square('Configurações de voz', () => setSettingsOpen(true), <Icon name="gear" size={17} />)}
      {square('Sair da conta', () => void logout(), <Icon name="x" size={17} />)}

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
  const [membersOpen, setMembersOpen] = useState(true);

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
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-ink-925 text-mist-500">
        <Icon name="hash" size={30} strokeWidth={1.4} />
        <p className="text-[13.5px]">Selecione um canal para começar.</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-ink-925">
      <header className="flex h-header shrink-0 items-center gap-2.5 border-b border-ink-900 px-3">
        <Icon name={isDm ? 'at' : 'hash'} size={18} className="shrink-0 text-mist-500" />
        <h2 className="shrink-0 text-[15px] font-semibold text-mist-50">{title}</h2>

        {channel?.topic && (
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="h-[18px] w-px bg-ink-700" />
            <p className="truncate text-[12.5px] text-mist-400">{channel.topic}</p>
          </div>
        )}

        {isDm && (
          <span
            title="As mensagens desta conversa são apagadas 8 horas após o envio."
            className="flex h-6 shrink-0 items-center gap-1.5 rounded-xl border border-pulse-500/25 bg-pulse-500/10 px-2 text-[11.5px] font-semibold text-pulse-300"
          >
            <Icon name="eph" size={13} />
            8h
          </span>
        )}

        <div className="flex-1" />

        {!isDm && detail && (
          <button
            onClick={() => setMembersOpen((open) => !open)}
            title="Lista de membros"
            aria-label="Lista de membros"
            className={`flex h-[30px] w-[30px] items-center justify-center rounded-md transition-colors hover:bg-ink-850 ${
              membersOpen ? 'bg-ink-850 text-mist-50' : 'text-mist-400'
            }`}
          >
            <Icon name="users" size={17} />
          </button>
        )}
      </header>

      {isDm && <PrivacyNotice />}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
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

        {!isDm && detail && membersOpen && <MembersPanel />}
      </div>
    </div>
  );
}


/**
 * Duas garantias da conversa privada, ditas de forma direta: ninguém fora dela
 * consegue ler, e nada sobrevive a 8 horas.
 */
function PrivacyNotice(): JSX.Element {
  const e2eeStatus = useApp((s) => s.e2eeStatus);

  if (e2eeStatus === 'unavailable') {
    return (
      <div className="flex items-center gap-2 border-b border-alert-500/30 bg-alert-500/10 px-4 py-2 text-xs text-alert-500">
        <Icon name="lock" size={13} strokeWidth={2.2} />
        Criptografia indisponível neste dispositivo. O envio está bloqueado — nenhuma mensagem
        privada sai sem estar cifrada.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-ink-900 bg-ink-950/40 px-4 py-2 text-xs text-mist-400">
      <span className="flex items-center gap-1.5">
        <Icon name="lock" size={13} strokeWidth={2.2} />
        Criptografada ponta a ponta — nem o servidor consegue ler.
      </span>
      <span className="flex items-center gap-1.5">
        <Icon name="eph" size={13} strokeWidth={2.2} />
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

function FriendsView(): JSX.Element {
  const friends = useApp((s) => s.friends);
  const presences = useApp((s) => s.presences);
  const startDm = useApp((s) => s.startDm);
  const addFriend = useApp((s) => s.addFriend);
  const respond = useApp((s) => s.respondFriendRequest);
  const refreshFriends = useApp((s) => s.refreshFriends);
  const [tab, setTab] = useState<'online' | 'all' | 'pending' | 'blocked' | 'add'>('online');
  const [username, setUsername] = useState('');
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);

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

  const tabs = [
    ['online', 'Online'],
    ['all', 'Todos'],
    ['pending', `Pendentes${friends.incoming.length ? ` (${friends.incoming.length})` : ''}`],
    ['blocked', 'Bloqueados'],
    ['add', 'Adicionar amigo'],
  ] as const;

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-ink-925">
      <header className="flex h-header shrink-0 items-center gap-2.5 border-b border-ink-900 px-3">
        <Icon name="users" size={18} className="text-mist-500" />
        <h2 className="text-[15px] font-semibold text-mist-50">Amigos</h2>
      </header>

      <nav className="flex h-[42px] shrink-0 items-center gap-1 border-b border-ink-900 px-4">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex h-[26px] items-center rounded-md px-2.5 text-[13px] font-medium transition-colors ${
              tab === key
                ? key === 'add'
                  ? 'bg-signal-500 text-ink-950'
                  : 'bg-ink-800 text-mist-50'
                : 'text-mist-400 hover:bg-ink-850 hover:text-mist-200'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
        {tab === 'add' && (
          <div className="flex max-w-[520px] flex-col gap-2.5 pt-1">
            <p className="text-[15px] font-semibold text-mist-50">Adicionar amigo</p>
            <p className="text-[13px] text-mist-400">
              Você pode adicionar amigos pelo nome de usuário.
            </p>
            <div className="flex items-center gap-2 rounded-[10px] border border-ink-700 bg-ink-975 py-1.5 pl-3 pr-1.5 focus-within:border-pulse-400">
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value.replace(/^@+/, '').toLowerCase())}
                placeholder="@usuario"
                aria-label="Nome de usuário do amigo"
                className="h-[34px] flex-1 bg-transparent text-sm text-mist-50 placeholder:text-mist-500 focus:outline-none"
              />
              <button
                onClick={async () => {
                  try {
                    const status = await addFriend(username.trim().toLowerCase());
                    setUsername('');
                    setFeedback({
                      ok: true,
                      text:
                        status === 'ACCEPTED'
                          ? 'Vocês agora são amigos.'
                          : status === 'ALREADY_FRIENDS'
                            ? 'Vocês já são amigos.'
                            : 'Solicitação enviada.',
                    });
                  } catch (err) {
                    setFeedback({
                      ok: false,
                      text: err instanceof Error ? err.message : 'Não foi possível enviar.',
                    });
                  }
                }}
                disabled={username.trim().length < 3}
                className="h-[34px] rounded-md bg-pulse-500 px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-pulse-400 disabled:opacity-40"
              >
                Enviar solicitação
              </button>
            </div>
            {feedback && (
              <p className={`text-[12.5px] ${feedback.ok ? 'text-signal-500' : 'text-alert-500'}`}>
                {feedback.text}
              </p>
            )}
          </div>
        )}

        {tab === 'pending' && (
          <>
            <SectionLabel text={`PENDENTES — ${friends.incoming.length + friends.outgoing.length}`} />
            {friends.incoming.length === 0 && friends.outgoing.length === 0 && (
              <Empty text="Nenhuma solicitação pendente." />
            )}
            {friends.incoming.map((request) => (
              <FriendRow
                key={request.id}
                name={request.user.displayName}
                avatarUrl={request.user.avatarUrl}
                sub="quer ser seu amigo"
                actions={
                  <>
                    <RowButton
                      label="Aceitar"
                      onClick={() => void respond(request.id, true)}
                      tone="ok"
                    >
                      <Icon name="check" size={16} />
                    </RowButton>
                    <RowButton
                      label="Recusar"
                      onClick={() => void respond(request.id, false)}
                      tone="bad"
                    >
                      <Icon name="x" size={16} />
                    </RowButton>
                  </>
                }
              />
            ))}
            {friends.outgoing.map((request) => (
              <FriendRow
                key={request.id}
                name={request.user.displayName}
                avatarUrl={request.user.avatarUrl}
                sub="solicitação enviada"
                dim
              />
            ))}
          </>
        )}

        {tab === 'blocked' && (
          <>
            <SectionLabel text={`BLOQUEADOS — ${friends.blocked.length}`} />
            {friends.blocked.length === 0 && <Empty text="Ninguém bloqueado." />}
            {friends.blocked.map((user) => (
              <FriendRow
                key={user.id}
                name={user.displayName}
                avatarUrl={user.avatarUrl}
                sub={`@${user.username}`}
                dim
              />
            ))}
          </>
        )}

        {(tab === 'online' || tab === 'all') && (
          <>
            <SectionLabel
              text={`${tab === 'online' ? 'ONLINE' : 'TODOS OS AMIGOS'} — ${visible.length}`}
            />
            {visible.length === 0 && (
              <Empty
                text={tab === 'online' ? 'Ninguém online agora.' : 'Sua lista de amigos está vazia.'}
              />
            )}
            {visible.map((friend) => (
              <FriendRow
                key={friend.id}
                name={friend.displayName}
                avatarUrl={friend.avatarUrl}
                sub={`@${friend.username}`}
                status={statusOf(friend.id)}
                actions={
                  <RowButton label="Enviar mensagem" onClick={() => void startDm(friend.id)}>
                    <Icon name="inbox" size={16} />
                  </RowButton>
                }
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ text }: { text: string }): JSX.Element {
  return (
    <p className="px-2 pb-1.5 text-[10.5px] font-bold tracking-[0.07em] text-mist-500">{text}</p>
  );
}

function FriendRow({
  name,
  avatarUrl,
  sub,
  status,
  actions,
  dim,
}: {
  name: string;
  avatarUrl?: string | null;
  sub: string;
  status?: PresenceStatus;
  actions?: JSX.Element;
  dim?: boolean;
}): JSX.Element {
  return (
    <div
      className={`flex h-[46px] items-center gap-3 rounded-lg border-t border-ink-900 px-2 transition-colors hover:bg-ink-850 ${
        dim ? 'opacity-60' : ''
      }`}
    >
      <Avatar name={name} url={avatarUrl} size={32} status={status} ringColor="#0d0e10" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold text-mist-200">{name}</p>
        <p className="truncate text-[11.5px] text-mist-400">{sub}</p>
      </div>
      {actions}
    </div>
  );
}

function RowButton({
  label,
  onClick,
  tone = 'neutral',
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: 'neutral' | 'ok' | 'bad';
  children: JSX.Element;
}): JSX.Element {
  const color =
    tone === 'ok'
      ? 'text-signal-500 hover:bg-signal-500/20'
      : tone === 'bad'
        ? 'text-alert-500 hover:bg-alert-500/20'
        : 'text-mist-200 hover:bg-ink-700';

  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-8 w-8 items-center justify-center rounded-full bg-ink-850 transition-colors ${color}`}
    >
      {children}
    </button>
  );
}

function Empty({ text }: { text: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-mist-500">
      <Icon name="users" size={28} strokeWidth={1.4} />
      <p className="text-[13.5px]">{text}</p>
    </div>
  );
}
