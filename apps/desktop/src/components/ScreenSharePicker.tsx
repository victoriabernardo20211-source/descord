import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { ScreenSource } from '../../electron/preload';
import { bridge } from '../lib/bridge';
import type { StreamQuality } from '../lib/voice';

interface Props {
  onCancel: () => void;
  onShare: (sourceId: string, quality: StreamQuality, withAudio: boolean) => void;
}

const HEIGHTS: StreamQuality['height'][] = [720, 1080, 1440];
const RATES: StreamQuality['fps'][] = [15, 30, 60];

/**
 * Escolha explícita da fonte, com prévia. A captura só começa depois que a
 * pessoa clica em transmitir — nunca automaticamente.
 */
export function ScreenSharePicker({ onCancel, onShare }: Props): JSX.Element {
  const [sources, setSources] = useState<ScreenSource[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [quality, setQuality] = useState<StreamQuality>({ height: 1080, fps: 30 });
  const [withAudio, setWithAudio] = useState(true);

  useEffect(() => {
    void bridge.screenSources().then(setSources).catch(() => setSources([]));
  }, []);

  const screens = sources?.filter((s) => s.kind === 'screen') ?? [];
  const windows = sources?.filter((s) => s.kind === 'window') ?? [];

  const grid = (title: string, list: ScreenSource[]): JSX.Element | null =>
    list.length === 0 ? null : (
      <div className="mb-5">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mist-400">
          {title}
        </p>
        <div className="grid grid-cols-3 gap-3">
          {list.map((source) => (
            <button
              key={source.id}
              onClick={() => setSelected(source.id)}
              className={`overflow-hidden rounded-lg border-2 text-left transition-colors ${
                selected === source.id
                  ? 'border-pulse-500'
                  : 'border-ink-700 hover:border-ink-500'
              }`}
            >
              <img src={source.thumbnail} alt="" className="aspect-video w-full object-cover" />
              <span className="flex items-center gap-1.5 px-2 py-1.5">
                {source.appIcon && <img src={source.appIcon} alt="" className="h-4 w-4" />}
                <span className="truncate text-xs text-mist-200">{source.name}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-975/80 p-6">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-ink-800 bg-ink-900 shadow-[0_24px_60px_rgba(0,0,0,.55)]">
        <header className="border-b border-ink-700 px-6 py-4">
          <h2 className="text-lg font-semibold">Compartilhar tela</h2>
          <p className="mt-0.5 text-sm text-mist-400">
            Escolha o que transmitir. Nada é capturado antes de você confirmar.
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {sources === null && <p className="py-8 text-center text-mist-400">Procurando telas…</p>}
          {sources?.length === 0 && (
            <p className="py-8 text-center text-mist-400">
              Nenhuma fonte disponível. No Windows, verifique as permissões de gravação de tela.
            </p>
          )}
          {grid('Monitores', screens)}
          {grid('Janelas', windows)}
        </div>

        <footer className="border-t border-ink-700 px-6 py-4">
          <div className="mb-4 flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-mist-400">Resolução</span>
              <select
                value={quality.height}
                onChange={(e) =>
                  setQuality({ ...quality, height: Number(e.target.value) as StreamQuality['height'] })
                }
                className="rounded-md border border-ink-700 bg-ink-975 px-2 py-1 text-sm"
              >
                {HEIGHTS.map((h) => (
                  <option key={h} value={h}>
                    {h}p
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <span className="text-mist-400">FPS</span>
              <select
                value={quality.fps}
                onChange={(e) =>
                  setQuality({ ...quality, fps: Number(e.target.value) as StreamQuality['fps'] })
                }
                className="rounded-md border border-ink-700 bg-ink-975 px-2 py-1 text-sm"
              >
                {RATES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm text-mist-200">
              <input
                type="checkbox"
                checked={withAudio}
                onChange={(e) => setWithAudio(e.target.checked)}
              />
              Incluir áudio
            </label>
          </div>

          {quality.height === 1440 && quality.fps === 60 && (
            <p className="mb-3 text-xs text-warn-500">
              1440p60 consome bastante banda de saída do servidor. Veja docs/BANDWIDTH.md.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={onCancel}
              className="rounded-lg bg-ink-700 px-4 py-2 text-sm text-mist-200 hover:bg-ink-600"
            >
              Cancelar
            </button>
            <button
              disabled={!selected}
              onClick={() => selected && onShare(selected, quality, withAudio)}
              className="rounded-lg bg-pulse-500 px-4 py-2 text-sm font-medium text-white hover:bg-pulse-400 disabled:opacity-40"
            >
              Transmitir
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
