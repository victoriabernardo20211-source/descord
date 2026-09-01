import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { MicLevelMeter } from '../lib/mic-level';
import { voice } from '../lib/voice';
import { useApp } from '../store/app';

interface Settings {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  inputVolume: number;
  outputVolume: number;
  inputMode: 'VOICE_ACTIVITY' | 'PUSH_TO_TALK';
  pushToTalkKey: string | null;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

const DEFAULTS: Settings = {
  inputDeviceId: null,
  outputDeviceId: null,
  inputVolume: 100,
  outputVolume: 100,
  inputMode: 'VOICE_ACTIVITY',
  pushToTalkKey: null,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};

/**
 * Voz e vídeo.
 *
 * O medidor de nível é a parte que importa: sem ele, descobrir que o microfone
 * errado estava selecionado só acontece quando ninguém te ouve na chamada.
 */
export function VoiceSettings({ onClose }: { onClose: () => void }): JSX.Element {
  const api = useApp((s) => s.api);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [devices, setDevices] = useState<{
    inputs: MediaDeviceInfo[];
    outputs: MediaDeviceInfo[];
  }>({ inputs: [], outputs: [] });
  const [level, setLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [capturingKey, setCapturingKey] = useState(false);
  const meter = useRef(new MicLevelMeter());

  // Carrega o que está salvo no servidor e a lista de dispositivos.
  useEffect(() => {
    void (async () => {
      const [me, list] = await Promise.all([
        api?.get<{ settings: Partial<Settings> | null }>('/users/me'),
        voice.devices(),
      ]);
      setDevices(list);
      if (me?.settings) setSettings({ ...DEFAULTS, ...me.settings });
    })();
  }, [api]);

  // Medidor ativo enquanto a tela estiver aberta.
  useEffect(() => {
    const instance = meter.current;
    void instance.start(settings.inputDeviceId, setLevel).then((ok) => {
      if (!ok) setMicError('Não foi possível acessar o microfone. Verifique as permissões do Windows.');
    });
    return () => void instance.stop();
  }, [settings.inputDeviceId]);

  /** Salva no servidor e aplica na chamada em andamento. */
  async function patch(change: Partial<Settings>): Promise<void> {
    const next = { ...settings, ...change };
    setSettings(next);
    await api?.patch('/users/me/settings', change).catch(() => undefined);

    if (change.inputDeviceId) await voice.setInputDevice(change.inputDeviceId);
    if (change.outputDeviceId) await voice.setOutputDevice(change.outputDeviceId);
    if (change.inputMode) await bridgePushToTalk(next);
    if (change.pushToTalkKey !== undefined) await bridgePushToTalk(next);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-ink-700 bg-ink-850 p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-base font-semibold">Voz e vídeo</h2>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="rounded p-1 text-mist-400 hover:bg-ink-700 hover:text-mist-50"
          >
            ✕
          </button>
        </div>

        <Section title="Dispositivo de entrada">
          <select
            value={settings.inputDeviceId ?? ''}
            onChange={(e) => void patch({ inputDeviceId: e.target.value || null })}
            className="h-field w-full rounded-lg border border-ink-600 bg-ink-950 px-3 text-sm"
          >
            <option value="">Padrão do sistema</option>
            {devices.inputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || 'Microfone'}
              </option>
            ))}
          </select>

          <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-mist-400">
            Nível de entrada
          </p>
          <div className="mt-1.5 flex h-3 gap-[3px]" aria-hidden>
            {Array.from({ length: 28 }, (_, i) => (
              <span
                key={i}
                className={`flex-1 rounded-[1px] transition-colors ${
                  level * 28 > i
                    ? i > 23
                      ? 'bg-alert-500'
                      : i > 18
                        ? 'bg-warn-500'
                        : 'bg-signal-500'
                    : 'bg-ink-700'
                }`}
              />
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-mist-400">
            Fale algo — as barras precisam se mexer. Se ficarem paradas, o microfone
            selecionado está errado.
          </p>
          {micError && <p className="mt-1 text-xs text-alert-500">{micError}</p>}
        </Section>

        <Section title="Dispositivo de saída">
          <select
            value={settings.outputDeviceId ?? ''}
            onChange={(e) => void patch({ outputDeviceId: e.target.value || null })}
            className="h-field w-full rounded-lg border border-ink-600 bg-ink-950 px-3 text-sm"
          >
            <option value="">Padrão do sistema</option>
            {devices.outputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || 'Alto-falantes'}
              </option>
            ))}
          </select>
        </Section>

        <Section title="Modo de entrada">
          <div className="flex gap-2">
            {(
              [
                ['VOICE_ACTIVITY', 'Detecção de voz'],
                ['PUSH_TO_TALK', 'Aperte para falar'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => void patch({ inputMode: mode })}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  settings.inputMode === mode
                    ? 'border-pulse-500 bg-pulse-tint text-pulse-300'
                    : 'border-ink-600 text-mist-400 hover:text-mist-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {settings.inputMode === 'PUSH_TO_TALK' && (
            <button
              onClick={() => setCapturingKey(true)}
              onKeyDown={(event) => {
                if (!capturingKey) return;
                event.preventDefault();
                const accelerator = toAccelerator(event);
                if (accelerator) {
                  setCapturingKey(false);
                  void patch({ pushToTalkKey: accelerator });
                }
              }}
              className="mt-3 w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2 text-sm text-mist-200"
            >
              {capturingKey
                ? 'Aperte a tecla desejada…'
                : `Atalho: ${settings.pushToTalkKey ?? 'nenhum'}`}
            </button>
          )}
          {settings.inputMode === 'PUSH_TO_TALK' && !settings.pushToTalkKey && (
            <p className="mt-2 text-xs text-warn-500">
              Sem uma tecla definida, o modo aperte-para-falar deixaria seu microfone
              fechado o tempo todo. Enquanto não escolher uma, ele segue aberto.
            </p>
          )}
          <p className="mt-2 text-[11px] text-mist-400">
            O atalho funciona com o Nexus minimizado.
          </p>
        </Section>

        <Section title="Processamento">
          {(
            [
              ['noiseSuppression', 'Supressão de ruído', 'Corta ventilador, teclado e chiado.'],
              ['echoCancellation', 'Cancelamento de eco', 'Evita retorno quando usa caixas de som.'],
              ['autoGainControl', 'Ganho automático', 'Equaliza o volume da sua voz.'],
            ] as const
          ).map(([key, label, hint]) => (
            <label key={key} className="mb-2 flex items-start gap-3">
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(e) => void patch({ [key]: e.target.checked } as Partial<Settings>)}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm text-mist-200">{label}</span>
                <span className="block text-[11px] text-mist-400">{hint}</span>
              </span>
            </label>
          ))}
          <p className="mt-1 text-[11px] text-mist-400">
            Alterações valem na próxima vez que você entrar num canal de voz.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="mt-5 border-t border-ink-700 pt-4 first-of-type:border-0">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-mist-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Converte a tecla pressionada no formato de acelerador do Electron. */
function toAccelerator(event: React.KeyboardEvent): string | null {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  const key = event.key;
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join('+');
}

async function bridgePushToTalk(settings: Settings): Promise<void> {
  const { bridge } = await import('../lib/bridge');
  await bridge.setPushToTalk(
    settings.inputMode === 'PUSH_TO_TALK' ? settings.pushToTalkKey : null,
  );
}
