import { useState } from 'react';
import type { JSX } from 'react';
import { useApp } from '../store/app';

interface Props {
  serverId: string;
  serverName: string;
  onClose: () => void;
}

const DURATIONS: { label: string; seconds: number }[] = [
  { label: '30 minutos', seconds: 30 * 60 },
  { label: '1 hora', seconds: 60 * 60 },
  { label: '6 horas', seconds: 6 * 60 * 60 },
  { label: '1 dia', seconds: 24 * 60 * 60 },
  { label: '7 dias', seconds: 7 * 24 * 60 * 60 },
  { label: 'Nunca expira', seconds: 0 },
];

const USES: { label: string; value: number }[] = [
  { label: '1 pessoa', value: 1 },
  { label: '5 pessoas', value: 5 },
  { label: '10 pessoas', value: 10 },
  { label: '25 pessoas', value: 25 },
  { label: 'Sem limite', value: 0 },
];

/**
 * Gera o convite do servidor.
 *
 * O código sozinho não basta: quem recebe também precisa estar na rede privada
 * e ter o aplicativo. O diálogo diz isso, senão a pessoa manda só o código e o
 * amigo trava sem entender por quê.
 */
export function InviteDialog({ serverId, serverName, onClose }: Props): JSX.Element {
  const createInvite = useApp((s) => s.createInvite);
  const [duration, setDuration] = useState(DURATIONS[3]!.seconds);
  const [uses, setUses] = useState(USES[0]!.value);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const invite = await createInvite(serverId, duration, uses);
      setCode(invite.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar o convite.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(): Promise<void> {
    if (!code) return;
    await navigator.clipboard.writeText(code).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-975/80 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-ink-800 bg-ink-900 p-7 shadow-[0_24px_60px_rgba(0,0,0,.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Convidar para {serverName}</h2>

        {code ? (
          <>
            <p className="mt-1 text-sm text-mist-400">
              Convite criado. Mande este código para a pessoa.
            </p>

            <div className="mt-4 flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg border border-ink-600 bg-ink-950 px-3 py-2.5 font-mono text-sm text-pulse-300">
                {code}
              </code>
              <button
                onClick={() => void copy()}
                className="rounded-lg bg-pulse-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-pulse-400"
              >
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-mist-400">
                O código sozinho não basta
              </p>
              <p className="mt-1.5 text-xs text-mist-200">
                A pessoa também precisa estar na rede Tailscale e ter o Nexus instalado.
                Se ela ainda não tem, mande primeiro o convite do Tailscale e o instalador.
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setCode(null)}
                className="rounded-lg bg-ink-700 px-4 py-2 text-sm text-mist-200 transition-colors hover:bg-ink-600"
              >
                Criar outro
              </button>
              <button
                onClick={onClose}
                className="rounded-lg bg-pulse-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pulse-400"
              >
                Pronto
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-mist-400">
              Um código que a pessoa digita ao criar a conta.
            </p>

            <Field label="Expira em">
              <select
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
                className="h-field w-full rounded-lg border border-ink-600 bg-ink-950 px-3 text-sm"
              >
                {DURATIONS.map((option) => (
                  <option key={option.seconds} value={option.seconds}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Número máximo de usos">
              <select
                value={uses}
                onChange={(event) => setUses(Number(event.target.value))}
                className="h-field w-full rounded-lg border border-ink-600 bg-ink-950 px-3 text-sm"
              >
                {USES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            {error && <p className="mt-3 text-xs text-alert-500">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-lg bg-ink-700 px-4 py-2 text-sm text-mist-200 transition-colors hover:bg-ink-600"
              >
                Cancelar
              </button>
              <button
                disabled={busy}
                onClick={() => void generate()}
                className="rounded-lg bg-pulse-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pulse-400 disabled:opacity-40"
              >
                {busy ? 'Criando…' : 'Criar convite'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="mt-4 block text-[11px] font-medium uppercase tracking-wide text-mist-400">
      {label}
      <span className="mt-1.5 block normal-case tracking-normal">{children}</span>
    </label>
  );
}
