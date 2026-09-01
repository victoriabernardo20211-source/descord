import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Avatar } from './Avatar';
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

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-ink-950">
      <header className="flex h-header shrink-0 items-center gap-2 border-b border-ink-900 px-4">
        <SpeakerIcon />
        <h2 className="truncate font-semibold">{channel?.name ?? 'Canal de voz'}</h2>
        <span className="text-xs text-mist-400">
          {peers.length} {peers.length === 1 ? 'pessoa' : 'pessoas'}
        </span>
      </header>

      {highlighted ? (
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <button
            onClick={() => watchStream(null)}
            className="mb-2 self-start rounded-md bg-ink-800 px-3 py-1 text-xs text-mist-200 hover:bg-ink-700"
          >
            ← Voltar para a grade
          </button>
          <Tile peer={highlighted} isSelf={highlighted.userId === me?.id} large />
        </div>
      ) : (
        <div
          className="grid min-h-0 flex-1 content-center gap-3 p-4"
          style={{
            gridTemplateColumns: `repeat(${peers.length <= 1 ? 1 : peers.length <= 4 ? 2 : 3}, minmax(0, 1fr))`,
          }}
        >
          {peers.map((peer) => (
            <button
              key={peer.userId}
              onClick={() => peer.streaming && watchStream(peer.userId)}
              className={peer.streaming ? 'cursor-zoom-in text-left' : 'cursor-default text-left'}
            >
              <Tile peer={peer} isSelf={peer.userId === me?.id} />
            </button>
          ))}
        </div>
      )}

      <CallControls />
    </div>
  );
}

function Tile({
  peer,
  isSelf,
  large,
}: {
  peer: VoicePeer;
  isSelf: boolean;
  large?: boolean;
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
      className={`relative flex items-center justify-center overflow-hidden rounded-xl border-2 bg-ink-900 transition-colors ${
        peer.speaking ? 'border-signal-500' : 'border-transparent'
      } ${large ? 'h-full' : 'aspect-video'}`}
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
        <Avatar name={peer.displayName} size={large ? 120 : 64} />
      )}

      <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-ink-950/80 px-2 py-1 text-xs">
        {peer.micMuted && <MutedIcon />}
        {peer.displayName}
        {isSelf && <span className="text-mist-400">(você)</span>}
      </span>

      {peer.streaming && (
        <span className="absolute right-2 top-2 rounded bg-alert-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          AO VIVO
        </span>
      )}
    </div>
  );
}

/** Barra de controles da chamada, no rodapé da área principal. */
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
      className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
        danger
          ? 'bg-alert-500 text-white hover:bg-alert-500/80'
          : active
            ? 'bg-mist-50 text-ink-950 hover:bg-mist-200'
            : 'bg-ink-800 text-mist-200 hover:bg-ink-700'
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex shrink-0 flex-col items-center gap-3 border-t border-ink-900 py-4">
      {micWarning && (
        <p className="mx-4 rounded-md border border-alert-500/40 bg-alert-500/10 px-3 py-2 text-center text-xs text-alert-500">
          {micWarning}
        </p>
      )}
      <div className="flex items-center justify-center gap-3">
      {button(selfMuted ? 'Ativar microfone' : 'Silenciar', selfMuted, () => void toggleMute(), <MicIcon muted={selfMuted} />)}
      {button(selfDeafened ? 'Voltar a ouvir' : 'Ensurdecer', selfDeafened, () => void toggleDeafen(), <HeadphonesIcon muted={selfDeafened} />)}
      {button(
        streaming ? 'Parar transmissão' : 'Compartilhar tela',
        streaming,
        () => (streaming ? void stopScreenShare() : setSharing(true)),
        <ScreenIcon />,
      )}
      {button('Desconectar', false, () => void leaveVoice(), <HangUpIcon />, true)}
      </div>
    </div>
  );
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const };

function MicIcon({ muted }: { muted: boolean }): JSX.Element {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      {muted && <path d="M4 4l16 16" />}
    </svg>
  );
}

function HeadphonesIcon({ muted }: { muted: boolean }): JSX.Element {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="2" y="14" width="5" height="7" rx="2" />
      <rect x="17" y="14" width="5" height="7" rx="2" />
      {muted && <path d="M4 4l16 16" />}
    </svg>
  );
}

function ScreenIcon(): JSX.Element {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function HangUpIcon(): JSX.Element {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M3 11a12 12 0 0 1 18 0l-2.5 2.5-3-1.5v-2a10 10 0 0 0-7 0v2l-3 1.5z" />
    </svg>
  );
}

function SpeakerIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} className="text-mist-400" aria-hidden>
      <path d="M4 9v6h4l5 4V5L8 9H4zM17 9a4 4 0 0 1 0 6" />
    </svg>
  );
}

function MutedIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" {...stroke} className="text-alert-500" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M4 4l16 16" />
    </svg>
  );
}
