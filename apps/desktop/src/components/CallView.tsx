import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { MembersPanel } from './MembersPanel';
import { ParticipantMenu } from './ParticipantMenu';
import { voice, type VoicePeer } from '../lib/voice';
import { useApp } from '../store/app';

/**
 * A chamada em si: uma grade com todo mundo que está no canal.
 *
 * Quem transmite aparece como vídeo (inclusive você — sem a prévia local não dá
 * para saber o que está sendo enviado); quem não transmite aparece como avatar,
 * com anel verde enquanto fala.
 */
export function CallView({ channelId }: { channelId: string }): JSX.Element {
  const peers = useApp((s) => s.voicePeers);
  const watching = useApp((s) => s.watchingUserId);
  const watchStream = useApp((s) => s.watchStream);
  const detail = useApp((s) => s.serverDetail);
  const me = useApp((s) => s.me);

  const channel = detail?.channels.find((c) => c.id === channelId);
  const highlighted = watching ? peers.find((p) => p.userId === watching) : null;
  const [menu, setMenu] = useState<{ peer: VoicePeer; x: number; y: number } | null>(null);
  const [membersOpen, setMembersOpen] = useState(true);

  // O menu aponta para uma pessoa; se ela sai da chamada, ele não pode ficar
  // aberto operando sobre alguém que não está mais lá.
  const openMenu = (peer: VoicePeer, event: { clientX: number; clientY: number }): void =>
    setMenu({ peer, x: event.clientX, y: event.clientY });
  const live = menu && peers.find((p) => p.userId === menu.peer.userId);

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-ink-925">
      <header className="flex h-header shrink-0 items-center gap-2.5 border-b border-ink-900 px-3">
        <Icon name="speaker" size={18} className="shrink-0 text-mist-500" />
        <h2 className="truncate text-[15px] font-semibold text-mist-50">
          {channel?.name ?? 'Canal de voz'}
        </h2>
        <span className="h-[18px] w-px bg-ink-700" />
        <span className="text-[12.5px] text-mist-400">
          {peers.length} {peers.length === 1 ? 'pessoa' : 'pessoas'}
        </span>

        <div className="flex-1" />

        {detail && (
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

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-3 bg-ink-975 p-3.5">
        {highlighted ? (
          <>
            <button
              onClick={() => watchStream(null)}
              className="flex h-7 w-fit items-center gap-1.5 rounded-md bg-ink-850 px-2.5 text-xs text-mist-200 transition-colors hover:bg-ink-800"
            >
              <Icon name="chev-l" size={13} />
              Voltar para a grade
            </button>
            <Tile
              peer={highlighted}
              isSelf={highlighted.userId === me?.id}
              large
              onMenu={(event) => openMenu(highlighted, event)}
            />
          </>
        ) : (
          <div
            className="grid min-h-0 flex-1 gap-2.5"
            style={{
              gridTemplateColumns: `repeat(${peers.length <= 1 ? 1 : peers.length <= 4 ? 2 : 3}, minmax(0, 1fr))`,
              gridAutoRows: '1fr',
            }}
          >
            {peers.map((peer) => (
              <button
                key={peer.userId}
                onClick={() => peer.streaming && watchStream(peer.userId)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openMenu(peer, event);
                }}
                className={`min-h-0 text-left ${peer.streaming ? 'cursor-zoom-in' : 'cursor-default'}`}
              >
                <Tile
                  peer={peer}
                  isSelf={peer.userId === me?.id}
                  onMenu={(event) => openMenu(peer, event)}
                />
              </button>
            ))}
          </div>
        )}

          <CallControls />
        </div>

        {detail && membersOpen && <MembersPanel />}
      </div>

      {menu && live && (
        <ParticipantMenu
          peer={live}
          position={{ x: menu.x, y: menu.y }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function Tile({
  peer,
  isSelf,
  large,
  onMenu,
}: {
  peer: VoicePeer;
  isSelf: boolean;
  large?: boolean;
  onMenu: (event: { clientX: number; clientY: number }) => void;
}): JSX.Element {
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    setStream(isSelf ? voice.localScreenStream : (voice.remoteStreams.get(peer.userId) ?? null));
  }, [peer.userId, peer.streaming, isSelf]);

  /**
   * Ref de callback, e não `useRef` + efeito: o elemento `<video>` só existe
   * depois que `stream` deixa de ser nulo, então um efeito que rodasse junto
   * com a mudança de estado encontraria a ref ainda vazia e nunca atribuiria
   * `srcObject` — resultado: um quadro preto com a transmissão funcionando.
   */
  const attach = useCallback(
    (element: HTMLVideoElement | null) => {
      if (element && stream) element.srcObject = stream;
    },
    [stream],
  );

  return (
    <div
      className={`group/tile relative flex h-full items-center justify-center overflow-hidden rounded-xl border-[1.5px] bg-ink-900 transition-colors ${
        peer.speaking ? 'border-signal-500' : 'border-ink-800'
      }`}
    >
      {stream ? (
        <video
          ref={attach}
          autoPlay
          playsInline
          // A prévia da própria tela vai muda: ouvir o próprio áudio realimenta.
          muted={isSelf}
          className="h-full w-full bg-black object-contain"
          onDoubleClick={(event) =>
            void event.currentTarget.requestFullscreen().catch(() => undefined)
          }
        />
      ) : (
        <Avatar name={peer.displayName} size={large ? 120 : 80} />
      )}

      <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-[7px] bg-ink-975/70 px-2.5 py-1 text-[12.5px] font-semibold text-mist-200">
        {peer.displayName}
        {isSelf && <span className="font-normal text-mist-500">(você)</span>}
        {peer.micAbsent ? (
          <span
            title={
              isSelf
                ? 'Seu microfone não está publicado — ninguém te ouve.'
                : `${peer.displayName} não está publicando microfone nenhum. Não é mudo: o programa dele não abriu o microfone.`
            }
            className="text-[10px] font-bold tracking-[0.06em] text-warn-500"
          >
            SEM MICROFONE
          </span>
        ) : (
          peer.micMuted && (
            <span title="Microfone mudo">
              <Icon name="mic-off" size={13} className="text-alert-500" />
            </span>
          )
        )}
      </span>

      {/* Botão explícito além do clique direito: nem todo mundo tenta o direito,
          e num quadradinho sem nada escrito ninguém adivinha que há menu. */}
      <button
        onClick={(event) => {
          event.stopPropagation();
          onMenu(event);
        }}
        title={`Opções de ${peer.displayName}`}
        aria-label={`Opções de ${peer.displayName}`}
        className="absolute bottom-3 right-3 flex h-7 w-7 items-center justify-center rounded-md bg-ink-975/70 text-mist-200 opacity-0 transition-opacity hover:text-mist-50 focus:opacity-100 group-hover/tile:opacity-100"
      >
        <Icon name="more" size={16} />
      </button>

      {peer.streaming && (
        <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded-md border border-live-500/50 bg-live-500/15 px-1.5 py-[3px] text-[10px] font-extrabold tracking-[0.08em] text-live-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live-500" />
          LIVE
        </span>
      )}
    </div>
  );
}

/** Barra de controles flutuante, centrada no rodapé da chamada. */
function CallControls(): JSX.Element {
  const selfMuted = useApp((s) => s.selfMuted);
  const selfDeafened = useApp((s) => s.selfDeafened);
  const streaming = useApp((s) => s.streaming);
  const toggleMute = useApp((s) => s.toggleMute);
  const toggleDeafen = useApp((s) => s.toggleDeafen);
  const stopScreenShare = useApp((s) => s.stopScreenShare);
  const leaveVoice = useApp((s) => s.leaveVoice);
  const setSharing = useApp((s) => s.setSharePickerOpen);
  const micWarning = useApp((s) => s.micWarning);

  const button = (
    label: string,
    active: boolean,
    onClick: () => void,
    icon: JSX.Element,
    danger?: boolean,
  ): JSX.Element => (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-10 w-11 items-center justify-center rounded-[10px] transition-colors ${
        danger
          ? 'bg-alert-500 text-white hover:brightness-110'
          : active
            ? 'bg-mist-50 text-ink-950 hover:bg-mist-200'
            : 'bg-ink-850 text-mist-200 hover:bg-ink-800'
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex shrink-0 flex-col items-center gap-2.5">
      {micWarning && (
        <p className="max-w-lg rounded-md border border-alert-500/40 bg-alert-500/10 px-3 py-2 text-center text-xs text-alert-500">
          {micWarning}
        </p>
      )}

      <div className="flex gap-2 rounded-[14px] border border-ink-800 bg-ink-900/90 p-2">
        {button(
          selfMuted ? 'Ativar microfone' : 'Silenciar',
          selfMuted,
          () => void toggleMute(),
          <Icon name={selfMuted ? 'mic-off' : 'mic'} size={19} />,
        )}
        {button(
          selfDeafened ? 'Voltar a ouvir' : 'Ensurdecer',
          selfDeafened,
          () => void toggleDeafen(),
          <Icon name={selfDeafened ? 'head-off' : 'head'} size={19} />,
        )}
        {button(
          streaming ? 'Parar transmissão' : 'Compartilhar tela',
          streaming,
          () => (streaming ? void stopScreenShare() : setSharing(true)),
          <Icon name="share" size={19} />,
        )}
        <span className="mx-0.5 w-px bg-ink-700" />
        {button(
          'Desconectar',
          false,
          () => void leaveVoice(),
          <Icon name="phone-off" size={19} />,
          true,
        )}
      </div>
    </div>
  );
}
