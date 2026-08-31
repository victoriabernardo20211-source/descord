import type { JSX } from 'react';
import type { PresenceStatus } from '@nexus/shared';

const STATUS_COLOR: Record<PresenceStatus, string> = {
  ONLINE: 'bg-signal-500',
  IDLE: 'bg-warn-500',
  DND: 'bg-alert-500',
  INVISIBLE: 'bg-ink-500',
  OFFLINE: 'bg-ink-500',
};

interface Props {
  name: string;
  url?: string | null;
  size?: number;
  status?: PresenceStatus;
}

/** Sem avatar, mostra a inicial sobre uma cor derivada do próprio nome. */
export function Avatar({ name, url, size = 40, status }: Props): JSX.Element {
  const hue = [...name].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 360, 7);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white"
          style={{ background: `hsl(${hue} 45% 42%)`, fontSize: size * 0.4 }}
        >
          {name.slice(0, 1).toUpperCase()}
        </div>
      )}
      {status && (
        <span
          aria-label={`Status: ${status}`}
          className={`absolute -bottom-0.5 -right-0.5 rounded-full border-[3px] border-ink-850 ${STATUS_COLOR[status]}`}
          style={{ width: size * 0.36, height: size * 0.36 }}
        />
      )}
    </div>
  );
}
