import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { voice } from '../lib/voice';
import { useApp } from '../store/app';

/**
 * Visualização das transmissões do canal. Uma pessoa transmitindo ocupa a tela;
 * várias viram grade, e clicar destaca uma.
 */
export function StreamView(): JSX.Element | null {
  const peers = useApp((s) => s.voicePeers);
  const watching = useApp((s) => s.watchingUserId);
  const watchStream = useApp((s) => s.watchStream);
  const me = useApp((s) => s.me);

  const streamers = peers.filter((p) => p.streaming && p.userId !== me?.id);
  if (streamers.length === 0) return null;

  const highlighted = watching ? streamers.find((p) => p.userId === watching) : null;

  if (highlighted) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-ink-950">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="flex items-center gap-2 text-sm">
            <LiveBadge />
            {highlighted.displayName}
          </span>
          <button
            onClick={() => watchStream(null)}
            className="rounded-md bg-ink-800 px-3 py-1 text-xs text-mist-200 hover:bg-ink-700"
          >
            Voltar
          </button>
        </div>
        <StreamTile userId={highlighted.userId} className="flex-1" fullscreenable />
      </div>
    );
  }

  return (
    <div className="grid gap-2 bg-ink-950 p-3" style={{
      gridTemplateColumns: `repeat(${Math.min(streamers.length, 2)}, minmax(0, 1fr))`,
    }}>
      {streamers.map((peer) => (
        <button
          key={peer.userId}
          onClick={() => watchStream(peer.userId)}
          className="group relative overflow-hidden rounded-lg border border-ink-700 hover:border-pulse-500"
        >
          <StreamTile userId={peer.userId} className="aspect-video w-full" />
          <span className="absolute left-2 top-2">
            <LiveBadge />
          </span>
          <span className="absolute bottom-2 left-2 rounded bg-ink-950/80 px-2 py-0.5 text-xs">
            {peer.displayName}
          </span>
        </button>
      ))}
    </div>
  );
}

function StreamTile({
  userId,
  className,
  fullscreenable,
}: {
  userId: string;
  className?: string;
  fullscreenable?: boolean;
}): JSX.Element {
  const video = useRef<HTMLVideoElement>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const stream = voice.remoteStreams.get(userId);
    if (!stream) {
      setMissing(true);
      return;
    }
    setMissing(false);
    if (video.current) video.current.srcObject = stream;
  }, [userId]);

  if (missing) {
    return (
      <div className={`flex items-center justify-center bg-ink-900 text-xs text-mist-400 ${className ?? ''}`}>
        Recebendo transmissão…
      </div>
    );
  }

  return (
    <video
      ref={video}
      autoPlay
      playsInline
      // Sem `muted` o áudio da transmissão toca junto; o vídeo nunca inicia
      // com som alto porque o volume é o da chamada.
      className={`bg-black object-contain ${className ?? ''}`}
      onDoubleClick={() => {
        if (!fullscreenable) return;
        void video.current?.requestFullscreen().catch(() => undefined);
      }}
    />
  );
}

function LiveBadge(): JSX.Element {
  return (
    <span className="rounded bg-alert-500 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white">
      AO VIVO
    </span>
  );
}
