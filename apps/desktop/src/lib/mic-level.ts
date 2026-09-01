/**
 * Medidor de nível do microfone.
 *
 * Serve para a pessoa ver que o microfone está captando **antes** de entrar numa
 * chamada — sem isso, descobrir que o dispositivo errado estava selecionado só
 * acontece quando ninguém te ouve.
 */
export class MicLevelMeter {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private frame = 0;

  /** Chama `onLevel` com um valor de 0 a 1 enquanto estiver ativo. */
  async start(deviceId: string | null, onLevel: (level: number) => void): Promise<boolean> {
    await this.stop();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
    } catch {
      return false;
    }

    this.context = new AudioContext();
    const source = this.context.createMediaStreamSource(this.stream);
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = (): void => {
      analyser.getByteTimeDomainData(data);
      // RMS em torno de 128 (silêncio), normalizado para 0–1.
      let sum = 0;
      for (const sample of data) {
        const centred = (sample - 128) / 128;
        sum += centred * centred;
      }
      onLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
      this.frame = requestAnimationFrame(tick);
    };
    tick();
    return true;
  }

  async stop(): Promise<void> {
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    await this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
