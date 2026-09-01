import { useState } from 'react';
import type { JSX } from 'react';
import { useApp } from '../store/app';

/**
 * Criar servidor ou entrar por convite.
 *
 * Existe porque o Electron não implementa `window.prompt()` — a chamada é
 * ignorada em silêncio. E separar as duas ações em abas é melhor que adivinhar
 * pela forma do texto qual delas o usuário quis.
 */
export function AddServerDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createServer = useApp((s) => s.createServer);
  const joinServer = useApp((s) => s.joinServer);

  const creating = tab === 'create';
  const canSubmit = creating ? value.trim().length >= 2 : value.trim().length >= 4;

  async function submit(): Promise<void> {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (creating) await createServer(value.trim());
      else await joinServer(value.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-975/80 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-ink-800 bg-ink-900 p-7 shadow-[0_24px_60px_rgba(0,0,0,.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Adicionar servidor</h2>

        <div className="mt-4 flex gap-1 rounded-lg bg-ink-900 p-1">
          {(
            [
              ['create', 'Criar'],
              ['join', 'Entrar com convite'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                setValue('');
                setError(null);
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === key
                  ? 'bg-pulse-tint text-pulse-300'
                  : 'text-mist-400 hover:text-mist-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-[11px] font-medium uppercase tracking-wide text-mist-400">
          {creating ? 'Nome do servidor' : 'Código do convite'}
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
              if (event.key === 'Escape') onClose();
            }}
            placeholder={creating ? 'Ex: Casa dos Amigos' : 'Cole o código aqui'}
            className="mt-1.5 h-field w-full rounded-lg border border-ink-600 bg-ink-950 px-3 text-sm normal-case tracking-normal text-mist-50 focus:border-pulse-400"
          />
        </label>

        <p className="mt-2 text-[11px] text-mist-400">
          {creating
            ? 'Ele já vem com um canal de texto e um de voz.'
            : 'Peça o código a quem já está no servidor.'}
        </p>

        {error && <p className="mt-2 text-xs text-alert-500">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg bg-ink-700 px-4 py-2 text-sm text-mist-200 transition-colors hover:bg-ink-600"
          >
            Cancelar
          </button>
          <button
            disabled={!canSubmit || busy}
            onClick={() => void submit()}
            className="rounded-lg bg-pulse-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pulse-400 disabled:opacity-40"
          >
            {busy ? 'Aguarde…' : creating ? 'Criar' : 'Entrar'}
          </button>
        </div>
      </div>
    </div>
  );
}
