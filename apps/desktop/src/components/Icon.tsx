import type { JSX } from 'react';

/**
 * Conjunto de ícones do design, em traço único de 24×24.
 *
 * Todos são desenhados aqui em vez de virem de uma biblioteca: são poucos, o
 * traço precisa ser consistente entre eles, e nenhum asset de terceiro entra
 * no produto.
 */
const PATHS = {
  hash: <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />,
  speaker: (
    <>
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
    </>
  ),
  'mic-off': (
    <>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M3 3l18 18" />
    </>
  ),
  head: (
    <>
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </>
  ),
  'head-off': (
    <>
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3zM3 3l18 18" />
    </>
  ),
  gear: (
    <>
      <path d="M20 7h-9M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </>
  ),
  x: <path d="M18 6 6 18M6 6l12 12" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  square: <rect x="5" y="5" width="14" height="14" rx="2" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5M17 5a4 4 0 0 1 0 7M19.5 21c0-3-1-4.5-2.2-5.4" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </>
  ),
  share: <path d="M13 3H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3M8 21h8M12 17v4M17 8V2M14 5l3-3 3 3" />,
  'phone-off': (
    <>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.6 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.8.6a2 2 0 0 1 1.7 2z" />
      <path d="M2 2l20 20" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.4 2" />
    </>
  ),
  /** Relógio aberto: o prazo que não fecha o ciclo — mensagem que expira. */
  eph: (
    <>
      <path d="M12 3a9 9 0 1 1-8.5 6" />
      <path d="M12 7v5.2l3.4 2" />
      <path d="M3 12v.01M4.2 8.2v.01M6.6 5.2v.01" />
    </>
  ),
  'chev-d': <path d="M6 9.5 12 15l6-5.5" />,
  'chev-r': <path d="M9.5 6 15 12l-5.5 6" />,
  'chev-l': <path d="M14.5 6 9 12l5.5 6" />,
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  video: (
    <>
      <path d="M22 7.5 16 12l6 4.5z" />
      <rect x="2" y="5" width="14" height="14" rx="3" />
    </>
  ),
  at: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9" />
    </>
  ),
  'user-plus': (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-4 3-6.5 7-6.5 1.6 0 3 .4 4.2 1M19 8v6M22 11h-6" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v5h5" />
    </>
  ),
  download: <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4 20h16" />,
  signal: <path d="M4 19v-3M9.3 19v-7M14.7 19v-11M20 19V6" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5z" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  reply: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 6 6v5" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 16,
  strokeWidth = 2,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}

/** A marca do Nexus: o traço em N dentro do quadrado arredondado. */
export function Mark({ size = 22 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 20V4l12 16V4"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
