import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { formatRemaining, isUrgent, tickInterval } from '../lib/time';
import { useApp } from '../store/app';

/**
 * Contador de expiração de uma mensagem privada.
 *
 * Usa o relógio do SERVIDOR (via serverTimeOffset) — o relógio local do PC pode
 * estar errado, e ele nunca decide se a mensagem existe. Quem apaga é o backend;
 * este contador é apenas a leitura visível desse prazo.
 */
export function ExpiryBadge({ expiresAt }: { expiresAt: string }): JSX.Element | null {
  const api = useApp((s) => s.api);
  const target = new Date(expiresAt).getTime();
  const [remaining, setRemaining] = useState(() => target - (api?.now() ?? Date.now()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const tick = (): void => {
      const next = target - (api?.now() ?? Date.now());
      setRemaining(next);
      if (next <= 0) return;
      // Minuto a minuto durante quase todo o prazo; segundo a segundo no fim.
      timer = setTimeout(tick, tickInterval(next));
    };

    tick();
    return () => clearTimeout(timer);
  }, [target, api]);

  if (remaining <= 0) return null;
  const urgent = isUrgent(remaining);

  return (
    <span
      title={`Removida permanentemente em ${new Date(expiresAt).toLocaleString('pt-BR')}`}
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums transition-colors ${
        urgent ? 'bg-warn-500/15 font-medium text-warn-500' : 'text-mist-400/70'
      }`}
    >
      <ClockIcon />
      {formatRemaining(remaining)}
    </span>
  );
}

function ClockIcon(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" />
    </svg>
  );
}
