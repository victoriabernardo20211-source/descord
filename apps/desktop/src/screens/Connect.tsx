import { useState } from 'react';
import type { JSX } from 'react';
import { useApp } from '../store/app';

/**
 * Primeira execução: o app pergunta onde fica o nosso servidor.
 * Também é a tela mostrada quando o servidor está fora do ar.
 */
export function Connect(): JSX.Element {
  const status = useApp((s) => s.status);
  const apiUrl = useApp((s) => s.apiUrl);
  const error = useApp((s) => s.error);
  const configureServer = useApp((s) => s.configureServer);
  const [url, setUrl] = useState(apiUrl ?? 'https://');
  const [busy, setBusy] = useState(false);

  const unreachable = status === 'server-unreachable';

  return (
    <div className="flex h-full items-center justify-center bg-ink-900">
      <div className="w-[420px] rounded-2xl border border-ink-700 bg-ink-850 p-8 shadow-2xl">
        <Logo />
        <h1 className="mt-5 text-xl font-semibold">
          {unreachable ? 'Não foi possível conectar ao servidor' : 'Conectar ao servidor'}
        </h1>
        <p className="mt-1 text-sm text-mist-400">
          {unreachable
            ? 'O endereço abaixo não respondeu. Verifique se o servidor está no ar e tente de novo.'
            : 'Informe o endereço do servidor Nexus que vocês usam.'}
        </p>

        <label className="mt-6 block text-xs font-medium uppercase tracking-wide text-mist-400">
          Endereço do servidor
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://chat.seudominio.com"
            className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm normal-case tracking-normal text-mist-50 focus:border-pulse-400 focus:outline-none"
          />
        </label>

        {error && <p className="mt-3 text-sm text-alert-500">{error}</p>}

        <button
          disabled={busy || url.trim().length < 8}
          onClick={async () => {
            setBusy(true);
            await configureServer(url);
            setBusy(false);
          }}
          className="mt-5 w-full rounded-lg bg-pulse-500 py-2.5 font-medium text-white transition-colors hover:bg-pulse-400 disabled:opacity-40"
        >
          {busy ? 'Conectando…' : unreachable ? 'Tentar novamente' : 'Conectar'}
        </button>
      </div>
    </div>
  );
}

export function Logo(): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden>
        <defs>
          <linearGradient id="nexus-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8b7bff" />
            <stop offset="100%" stopColor="#6f5cf0" />
          </linearGradient>
        </defs>
        <rect width="36" height="36" rx="11" fill="url(#nexus-mark)" />
        <path
          d="M11 25V11l14 14V11"
          fill="none"
          stroke="#fff"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-lg font-semibold tracking-tight">Nexus</span>
    </div>
  );
}
