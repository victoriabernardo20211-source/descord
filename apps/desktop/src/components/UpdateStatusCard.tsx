import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { UpdateStatus } from '../../electron/preload';
import { bridge } from '../lib/bridge';
import { Icon } from './Icon';

/**
 * Situação da atualização automática.
 *
 * "Não atualizou" tem três causas diferentes e o mesmo sintoma: o endereço do
 * feed não foi gravado no executável, o servidor não respondeu, ou não existe
 * versão nova. Esta tela separa as três — sem ela, cada caso vira uma rodada
 * de adivinhação com outra pessoa do outro lado.
 */
export function UpdateStatusCard(): JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void bridge.updateStatus().then(setStatus).catch(() => undefined);
  }, []);

  const linha = (rotulo: string, valor: string, tom = 'text-mist-200'): JSX.Element => (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[11.5px] text-mist-400">{rotulo}</span>
      <span className={`truncate text-right text-[11.5px] ${tom}`}>{valor}</span>
    </div>
  );

  if (!status) return <p className="text-[12px] text-mist-500">Carregando…</p>;

  const diagnostico = !status.packaged
    ? {
        texto: 'Rodando pelo código. A atualização automática só vale no app instalado.',
        tom: 'text-mist-400',
      }
    : !status.feedUrl
      ? {
          texto:
            'Este app não sabe onde procurar atualização: o endereço não foi gravado ao gerar o instalador. É preciso gerar de novo com NEXUS_UPDATE_URL definido.',
          tom: 'text-alert-500',
        }
      : status.error
        ? { texto: `Falhou ao procurar: ${status.error}`, tom: 'text-alert-500' }
        : status.downloaded
          ? {
              texto: `Versão ${status.downloaded} baixada — entra ao fechar o app.`,
              tom: 'text-signal-500',
            }
          : status.available
            ? { texto: `Baixando a versão ${status.available}…`, tom: 'text-mist-200' }
            : { texto: 'Você está na versão mais recente.', tom: 'text-signal-500' };

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border border-ink-800 bg-ink-950/50 px-3 py-2">
        {linha('Versão', status.version)}
        {linha('Build', __BUILD_ID__)}
        {linha(
          'Feed',
          status.feedUrl ?? 'não configurado',
          status.feedUrl ? 'text-mist-200' : 'text-alert-500',
        )}
        {linha(
          'Última verificação',
          status.lastCheck ? new Date(status.lastCheck).toLocaleTimeString('pt-BR') : 'nunca',
        )}
      </div>

      <p className={`text-[12px] ${diagnostico.tom}`}>{diagnostico.texto}</p>

      <button
        disabled={busy || !status.packaged}
        onClick={async () => {
          setBusy(true);
          const next = await bridge.checkForUpdate().catch(() => null);
          if (next) setStatus(next);
          setBusy(false);
        }}
        className="flex h-8 w-fit items-center gap-2 rounded-md bg-ink-800 px-3 text-[12.5px] text-mist-200 transition-colors hover:bg-ink-700 disabled:opacity-40"
      >
        <Icon name="download" size={14} />
        {busy ? 'Procurando…' : 'Procurar agora'}
      </button>
    </div>
  );
}
