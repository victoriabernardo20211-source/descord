import type { JSX } from 'react';
import type { PresenceStatus } from '@nexus/shared';

const STATUS_COLOR: Record<PresenceStatus, string> = {
  ONLINE: '#35d07f',
  IDLE: '#ffb224',
  DND: '#e5484d',
  INVISIBLE: '#3a3e46',
  OFFLINE: '#3a3e46',
};

/**
 * Seis gradientes fixos, escolhidos pelo nome.
 *
 * Gradiente em vez de cor chapada porque no design cada pessoa tem um disco com
 * profundidade; e uma lista fechada em vez de matiz calculada porque assim
 * nenhuma combinação cai num tom lavado ou perto demais do roxo da marca.
 */
const RAMPS = [
  'linear-gradient(135deg,#8e6bff,#5b3be0)',
  'linear-gradient(135deg,#ff6fa5,#c2367a)',
  'linear-gradient(135deg,#42c9a3,#1c7f68)',
  'linear-gradient(135deg,#ffa64d,#d16a1f)',
  'linear-gradient(135deg,#5aa9ff,#2b62c9)',
  'linear-gradient(135deg,#c98bff,#7a3fd1)',
];

interface Props {
  name: string;
  url?: string | null;
  size?: number;
  status?: PresenceStatus;
  /** Cor do fundo por trás do ponto de status, para ele parecer recortado. */
  ringColor?: string;
}

export function Avatar({
  name,
  url,
  size = 40,
  status,
  ringColor = '#101114',
}: Props): JSX.Element {
  const seed = [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const dot = Math.max(9, Math.round(size * 0.36));

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full font-bold text-white"
          style={{
            background: RAMPS[seed % RAMPS.length],
            fontSize: Math.max(9, size * 0.37),
          }}
        >
          {initials(name)}
        </div>
      )}
      {status && (
        <span
          aria-label={`Status: ${status}`}
          className="absolute -bottom-px -right-px rounded-full"
          style={{
            width: dot,
            height: dot,
            background: STATUS_COLOR[status],
            border: `2.5px solid ${ringColor}`,
          }}
        />
      )}
    </div>
  );
}

/** Duas letras: iniciais de nome composto, ou as duas primeiras de um só. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  const last = parts[parts.length - 1];
  if (parts.length === 1 || !last) return first.slice(0, 2).toUpperCase();
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}
