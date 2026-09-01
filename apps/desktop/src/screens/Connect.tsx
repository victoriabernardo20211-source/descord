import { useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { Mark } from '../components/Icon';
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
  const [url, setUrl] = useState(apiUrl ?? '');
  const [busy, setBusy] = useState(false);

  const unreachable = status === 'server-unreachable';

  return (
    <AuthShell width={392}>
      <Card>
        <div className="flex flex-col items-center gap-1.5">
          <h1 className="text-[19px] font-semibold text-mist-50">
            {unreachable ? 'Servidor fora de alcance' : 'Conectar ao servidor'}
          </h1>
          <p className="text-center text-[13px] text-mist-400">
            {unreachable
              ? 'O endereço abaixo não respondeu. Confira se o Tailscale está ligado.'
              : 'Informe o endereço do servidor Nexus que vocês usam.'}
          </p>
        </div>

        <Field label="Endereço do servidor">
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="chat.seudominio.com ou 100.x.y.z"
            className={INPUT}
          />
        </Field>

        {error && <p className="text-[12.5px] text-alert-500">{error}</p>}

        <p className="text-[11px] text-mist-500">
          Pode colar só o endereço — descobrimos sozinhos se é http ou https.
        </p>

        <button
          disabled={busy || url.trim().length < 4}
          onClick={async () => {
            setBusy(true);
            await configureServer(url);
            setBusy(false);
          }}
          className={PRIMARY}
        >
          {busy ? 'Conectando…' : unreachable ? 'Tentar novamente' : 'Conectar'}
        </button>
      </Card>
    </AuthShell>
  );
}

/**
 * Moldura das telas de entrada: fundo mais escuro que o app, dois halos de cor
 * fora do enquadramento e a coluna estreita no centro. É o único lugar do
 * produto onde a marca aparece grande.
 */
export function AuthShell({
  children,
  width,
}: {
  children: ReactNode;
  width: number;
}): JSX.Element {
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-ink-975">
      <div className="pointer-events-none absolute -left-44 -top-80 h-[820px] w-[820px] rounded-full bg-[radial-gradient(circle,rgba(123,92,255,.18),transparent_62%)]" />
      <div className="pointer-events-none absolute -bottom-72 -right-40 h-[700px] w-[700px] rounded-full bg-[radial-gradient(circle,rgba(255,79,141,.09),transparent_62%)]" />

      <div className="relative flex flex-col gap-6" style={{ width }}>
        <Logo />
        {children}
        <p className="text-center text-[11px] text-mist-500">Nexus 1.0.0 · servidor privado</p>
      </div>
    </div>
  );
}

export function Card({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-[18px] rounded-2xl border border-ink-800 bg-ink-900 p-7 shadow-[0_24px_60px_rgba(0,0,0,.55)]">
      {children}
    </div>
  );
}

export function Field({
  label,
  children,
  action,
}: {
  label: string;
  children: ReactNode;
  action?: ReactNode;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-[7px]">
      <span className="flex items-center justify-between text-[11px] font-semibold tracking-[0.06em] text-mist-400">
        {label.toUpperCase()}
        {action}
      </span>
      {children}
    </label>
  );
}

export const INPUT =
  'h-field w-full rounded-lg border border-ink-700 bg-ink-975 px-3 text-sm text-mist-50 placeholder:text-mist-500 focus:border-pulse-400 focus:outline-none';

export const PRIMARY =
  'h-10 w-full rounded-lg bg-pulse-500 text-sm font-semibold text-white transition-colors hover:bg-pulse-400 disabled:opacity-40';

/** A marca completa: o quadrado com a inicial e o nome em caixa alta espaçada. */
export function Logo(): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3.5">
      <div className="flex h-[46px] w-[46px] items-center justify-center rounded-[14px] bg-[linear-gradient(150deg,#8e6bff,#5b3be0)] text-white shadow-[0_8px_28px_rgba(123,92,255,.35)]">
        <Mark size={26} />
      </div>
      <div className="pl-[0.32em] text-[26px] font-bold tracking-[0.32em] text-mist-50">NEXUS</div>
    </div>
  );
}
