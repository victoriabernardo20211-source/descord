import {
  ConnectionState,
  LocalParticipant,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type LocalTrackPublication,
  type VideoCodec,
} from 'livekit-client';

export interface VoicePeer {
  userId: string;
  displayName: string;
  speaking: boolean;
  micMuted: boolean;
  streaming: boolean;
  /** Volume local, 0 a 200 — preferência de quem escuta, não do transmissor. */
  volume: number;
}

export interface StreamQuality {
  height: 720 | 1080 | 1440;
  fps: 15 | 30 | 60;
}

type Listener = () => void;

/**
 * Conexão de voz e tela (LiveKit).
 *
 * Nada de autorização acontece aqui: o token que o backend assinou já limita o
 * que este cliente pode publicar. Se faltar SPEAK ou STREAM, o próprio SFU
 * recusa a track — o cliente não tem como contornar.
 */
export class VoiceConnection {
  private room: Room | null = null;
  private listeners = new Set<Listener>();
  private volumes = new Map<string, number>();
  private screenPublications: LocalTrackPublication[] = [];

  channelId: string | null = null;
  connecting = false;
  peers: VoicePeer[] = [];
  selfMuted = false;
  selfDeafened = false;
  streaming = false;
  /** Streams disponíveis para assistir: userId → MediaStream de vídeo. */
  remoteStreams = new Map<string, MediaStream>();
  /** A própria transmissão, para quem compartilha ver o que está enviando. */
  localScreenStream: MediaStream | null = null;
  latencyMs = 0;
  error: string | null = null;

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  get connected(): boolean {
    return this.room?.state === ConnectionState.Connected;
  }

  async connect(input: {
    url: string;
    token: string;
    channelId: string;
    inputDeviceId?: string | null;
    noiseSuppression: boolean;
    echoCancellation: boolean;
    autoGainControl: boolean;
    /** Em push-to-talk o microfone começa fechado e só abre com a tecla. */
    pushToTalk: boolean;
  }): Promise<void> {
    await this.disconnect();
    this.connecting = true;
    this.error = null;
    this.channelId = input.channelId;
    this.emit();

    const room = new Room({
      adaptiveStream: true,
      // Simulcast: quem assiste em miniatura recebe camada baixa, quem abre em
      // tela cheia recebe a alta. É o que segura a banda de saída do servidor.
      dynacast: true,
      audioCaptureDefaults: {
        deviceId: input.inputDeviceId ?? undefined,
        noiseSuppression: input.noiseSuppression,
        echoCancellation: input.echoCancellation,
        autoGainControl: input.autoGainControl,
      },
      publishDefaults: {
        simulcast: true,
        // Ordem de preferência: melhor compressão primeiro, H.264 como rede de
        // segurança para quem não suporta os outros.
        videoCodec: 'vp9' as VideoCodec,
      },
    });

    this.bind(room);

    try {
      await room.connect(input.url, input.token);
      await room.localParticipant.setMicrophoneEnabled(!input.pushToTalk);
      this.selfMuted = input.pushToTalk;
      this.room = room;
    } catch (err) {
      this.error =
        err instanceof Error ? err.message : 'Não foi possível entrar no canal de voz.';
      this.channelId = null;
      await room.disconnect().catch(() => undefined);
    } finally {
      this.connecting = false;
      this.refreshPeers();
    }
  }

  async disconnect(): Promise<void> {
    if (!this.room) return;
    await this.room.disconnect().catch(() => undefined);
    this.room = null;
    this.channelId = null;
    this.peers = [];
    this.remoteStreams.clear();
    this.localScreenStream = null;
    this.streaming = false;
    this.screenPublications = [];
    this.emit();
  }

  async setMuted(muted: boolean): Promise<void> {
    this.selfMuted = muted;
    await this.room?.localParticipant.setMicrophoneEnabled(!muted).catch(() => undefined);
    this.emit();
  }

  /**
   * Ensurdecer é local: paramos de reproduzir todo mundo. E fechamos o próprio
   * microfone junto, porque falar sem ouvir não faz sentido.
   */
  async setDeafened(deafened: boolean): Promise<void> {
    this.selfDeafened = deafened;
    if (deafened) await this.setMuted(true);

    for (const participant of this.room?.remoteParticipants.values() ?? []) {
      participant.setVolume(deafened ? 0 : this.volumeFor(participant.identity) / 100);
    }
    this.emit();
  }

  /** Volume individual, 0–200%. Fica só neste computador. */
  setVolume(userId: string, volume: number): void {
    const clamped = Math.max(0, Math.min(200, Math.round(volume)));
    this.volumes.set(userId, clamped);

    const participant = this.room?.remoteParticipants.get(userId);
    participant?.setVolume(this.selfDeafened ? 0 : clamped / 100);
    this.refreshPeers();
  }

  volumeFor(userId: string): number {
    return this.volumes.get(userId) ?? 100;
  }

  /** Abre o microfone por um instante — usado pelo push-to-talk. */
  async pushToTalkPulse(holdMs = 600): Promise<void> {
    if (!this.room) return;
    await this.setMuted(false);
    window.clearTimeout(this.pttTimer);
    this.pttTimer = window.setTimeout(() => void this.setMuted(true), holdMs);
  }
  private pttTimer = 0;

  /**
   * Publica a tela escolhida no nosso seletor.
   *
   * Usamos `getUserMedia` com as constraints legadas do Chromium
   * (`chromeMediaSource: 'desktop'`), e NÃO `getDisplayMedia`: este último abre
   * o seletor do próprio sistema, ignorando a fonte que a pessoa já escolheu.
   * Os dois formatos de constraint também não podem ser misturados — fazê-lo
   * gera "Malformed constraint" e nada é capturado.
   *
   * Sem permissão STREAM o SFU recusa a publicação, mesmo com a captura local
   * tendo funcionado.
   */
  async startScreenShare(
    sourceId: string,
    quality: StreamQuality,
    withAudio: boolean,
  ): Promise<void> {
    if (!this.room) return;

    const preset =
      quality.height === 1440
        ? VideoPresets.h1440
        : quality.height === 1080
          ? VideoPresets.h1080
          : VideoPresets.h720;

    const constraints = {
      // O áudio da tela não leva sourceId: no Windows ele captura o som do
      // sistema, e funciona de forma mais confiável com o monitor inteiro do
      // que com uma janela específica.
      audio: withAudio ? { mandatory: { chromeMediaSource: 'desktop' } } : false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: preset.resolution.width,
          maxHeight: preset.resolution.height,
          maxFrameRate: quality.fps,
        },
      },
    } as unknown as MediaStreamConstraints;

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) throw new Error('A fonte escolhida não forneceu vídeo.');

      this.localScreenStream = new MediaStream([videoTrack]);
      this.screenPublications = [];

      const publication = await this.room.localParticipant.publishTrack(videoTrack, {
        source: Track.Source.ScreenShare,
        simulcast: true,
        videoEncoding: { maxFramerate: quality.fps, maxBitrate: bitrateFor(quality) },
      });
      if (publication) this.screenPublications.push(publication);

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const audioPublication = await this.room.localParticipant.publishTrack(audioTrack, {
          source: Track.Source.ScreenShareAudio,
        });
        if (audioPublication) this.screenPublications.push(audioPublication);
      }

      // Quem para pelo próprio sistema operacional também precisa parar aqui.
      videoTrack.addEventListener('ended', () => void this.stopScreenShare());

      this.streaming = true;
      this.error = null;
    } catch (err) {
      this.localScreenStream = null;
      this.streaming = false;
      this.error =
        err instanceof Error ? err.message : 'Não foi possível iniciar a transmissão.';
    }
    this.refreshPeers();
  }

  async stopScreenShare(): Promise<void> {
    if (!this.room) return;
    for (const publication of this.screenPublications) {
      if (publication.track) {
        await this.room.localParticipant.unpublishTrack(publication.track);
        publication.track.stop();
      }
    }
    this.screenPublications = [];
    this.localScreenStream = null;
    this.streaming = false;
    this.refreshPeers();
  }

  /** Estatísticas para o painel avançado durante a chamada. */
  async stats(): Promise<{ ping: number; connection: string }> {
    return {
      ping: this.latencyMs,
      connection: this.room?.state ?? 'disconnected',
    };
  }

  private bind(room: Room): void {
    room
      .on(RoomEvent.ParticipantConnected, () => this.refreshPeers())
      .on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        this.remoteStreams.delete(participant.identity);
        this.refreshPeers();
      })
      .on(RoomEvent.ActiveSpeakersChanged, () => this.refreshPeers())
      .on(RoomEvent.TrackMuted, () => this.refreshPeers())
      .on(RoomEvent.TrackUnmuted, () => this.refreshPeers())
      .on(RoomEvent.Disconnected, () => {
        this.room = null;
        this.channelId = null;
        this.peers = [];
        this.remoteStreams.clear();
        this.emit();
      })
      .on(
        RoomEvent.TrackSubscribed,
        (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
          if (track.kind === Track.Kind.Video) {
            const stream = new MediaStream([track.mediaStreamTrack]);
            this.remoteStreams.set(participant.identity, stream);
          }
          if (track.kind === Track.Kind.Audio && this.selfDeafened) {
            participant.setVolume(0);
          }
          this.refreshPeers();
        },
      )
      .on(
        RoomEvent.TrackUnsubscribed,
        (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
          if (track.kind === Track.Kind.Video) this.remoteStreams.delete(participant.identity);
          this.refreshPeers();
        },
      );
  }

  private refreshPeers(): void {
    const room = this.room;
    if (!room) {
      this.peers = [];
      this.emit();
      return;
    }

    const describe = (participant: Participant, isSelf: boolean): VoicePeer => ({
      userId: participant.identity,
      displayName: participant.name || participant.identity,
      speaking: participant.isSpeaking,
      micMuted: isSelf
        ? this.selfMuted
        : !participant.getTrackPublication(Track.Source.Microphone)?.isSubscribed ||
          Boolean(participant.getTrackPublication(Track.Source.Microphone)?.isMuted),
      streaming: Boolean(participant.getTrackPublication(Track.Source.ScreenShare)),
      volume: isSelf ? 100 : this.volumeFor(participant.identity),
    });

    this.peers = [
      describe(room.localParticipant as LocalParticipant, true),
      ...[...room.remoteParticipants.values()].map((p) => describe(p, false)),
    ];
    this.emit();
  }
}

/** Bitrate alvo por qualidade. Ver docs/BANDWIDTH.md para o custo no servidor. */
function bitrateFor(quality: StreamQuality): number {
  const base = quality.height === 1440 ? 8_000_000 : quality.height === 1080 ? 3_000_000 : 1_500_000;
  return quality.fps >= 60 ? Math.round(base * 1.8) : base;
}

export const voice = new VoiceConnection();
