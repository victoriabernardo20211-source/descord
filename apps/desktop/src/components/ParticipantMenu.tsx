import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import { Icon } from './Icon';
import { useApp } from '../store/app';
import type { VoicePeer } from '../lib/voice';

/**
 * Menu de um participante da chamada.
 *
 * O volume é local — vale só neste computador e não afeta ninguém. Silenciar e
 * desconectar são moderação: valem para todo mundo e por isso só aparecem para
 * quem tem a permissão, resolvida pelo servidor e refletida aqui.
 */
export function ParticipantMenu({
  peer,
  position,
  onClose,
}: {
  peer: VoicePeer;
  position: { x: number; y: number };
  onClose: () => void;
}): JSX.Element {
  const me = useApp((s) => s.me);
  const volume = useApp((s) => s.voicePeers.find((p) => p.userId === peer.userId)?.volume ?? 100);
  const setUserVolume = useApp((s) => s.setUserVolume);
  const moderate = useApp((s) => s.moderateVoice);
  const permissions = useApp((s) => s.serverDetail?.permissionNames ?? []);
  const channelId = useApp((s) => s.voiceChannelId);
  const serverState = useApp((s) =>
    channelId ? s.voiceState[channelId]?.find((p) => p.userId === peer.userId) : undefined,
  );
  const ref = useRef<HTMLDivElement>(null);

  const isSelf = peer.userId === me?.id;
  const can = (name: string): boolean =>
    permissions.includes(name) || permissions.includes('ADMINISTRATOR');

  // Fecha ao clicar fora ou apertar Esc — um menu que só fecha no próprio botão
  // vira estorvo assim que a pessoa muda de ideia.
  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const item = (
    label: string,
    icon: JSX.Element,
    onClick: () => void,
    tone: 'normal' | 'danger' = 'normal',
  ): JSX.Element => (
    <button
      onClick={() => {
        onClick();
        onClose();
      }}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
        tone === 'danger'
          ? 'text-alert-500 hover:bg-alert-500/15'
          : 'text-mist-200 hover:bg-ink-800 hover:text-mist-50'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        // Mantém o menu dentro da janela mesmo clicando perto da borda.
        left: Math.min(position.x, window.innerWidth - 250),
        top: Math.min(position.y, window.innerHeight - 260),
      }}
      className="fixed z-50 w-[230px] rounded-xl border border-ink-800 bg-ink-900 p-1.5 shadow-[0_20px_50px_rgba(0,0,0,.6)]"
    >
      <p className="truncate px-2.5 pb-1.5 pt-1 text-[13px] font-semibold text-mist-50">
        {peer.displayName}
      </p>

      {!isSelf && (
        <div className="px-2.5 pb-2 pt-1">
          <div className="flex items-center justify-between pb-1.5 text-[11px] text-mist-400">
            <span>Volume</span>
            <span className="tabular-nums">{volume}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={200}
            value={volume}
            aria-label={`Volume de ${peer.displayName}`}
            onChange={(event) => setUserVolume(peer.userId, Number(event.target.value))}
            className="w-full accent-pulse-500"
          />
          <p className="pt-1 text-[10.5px] text-mist-500">Só neste computador.</p>
        </div>
      )}

      {!isSelf && (
        <>
          <div className="my-1 h-px bg-ink-800" />
          {item(
            volume === 0 ? 'Voltar a ouvir' : 'Silenciar para mim',
            <Icon name={volume === 0 ? 'head' : 'head-off'} size={15} />,
            () => setUserVolume(peer.userId, volume === 0 ? 100 : 0),
          )}
        </>
      )}

      {!isSelf && can('MUTE_MEMBERS') && (
        <>
          <div className="my-1 h-px bg-ink-800" />
          <p className="px-2.5 py-1 text-[10px] font-bold tracking-[0.07em] text-mist-500">
            MODERAÇÃO
          </p>
          {item(
            serverState?.serverMuted ? 'Devolver a voz' : 'Silenciar no servidor',
            <Icon name={serverState?.serverMuted ? 'mic' : 'mic-off'} size={15} />,
            () => void moderate(peer.userId, serverState?.serverMuted ? 'unmute' : 'mute'),
          )}
        </>
      )}

      {!isSelf && can('MOVE_MEMBERS') && (
        <>
          {!can('MUTE_MEMBERS') && <div className="my-1 h-px bg-ink-800" />}
          {item(
            'Desconectar da chamada',
            <Icon name="phone-off" size={15} />,
            () => void moderate(peer.userId, 'disconnect'),
            'danger',
          )}
        </>
      )}
    </div>
  );
}
