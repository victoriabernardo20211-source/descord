/**
 * Sons da chamada, sintetizados na hora.
 *
 * Nenhum arquivo de áudio entra no projeto: os sons são gerados por osciladores
 * aqui mesmo. Isso mantém a identidade própria (nada de som emprestado de outro
 * produto) e não acrescenta um byte ao instalador.
 *
 * Todos seguem a mesma forma — duas ou três notas curtas, com ataque e queda
 * suaves. Sem envelope, um oscilador ligado e desligado estala.
 */
type Nota = { hz: number; inicio: number; duracao: number };

const ENTRAR: Nota[] = [
  { hz: 587.33, inicio: 0, duracao: 0.09 }, // ré
  { hz: 880.0, inicio: 0.07, duracao: 0.13 }, // lá — sobe: alguém chegou
];

const SAIR: Nota[] = [
  { hz: 880.0, inicio: 0, duracao: 0.09 },
  { hz: 587.33, inicio: 0.07, duracao: 0.15 }, // desce: alguém foi embora
];

/** Três notas e um timbre diferente: transmissão não se confunde com chegada. */
const TRANSMISSAO: Nota[] = [
  { hz: 523.25, inicio: 0, duracao: 0.07 },
  { hz: 659.25, inicio: 0.06, duracao: 0.07 },
  { hz: 987.77, inicio: 0.12, duracao: 0.18 },
];

const RECEITAS = {
  entrar: { notas: ENTRAR, onda: 'sine' as OscillatorType, volume: 0.16 },
  sair: { notas: SAIR, onda: 'sine' as OscillatorType, volume: 0.16 },
  transmissao: { notas: TRANSMISSAO, onda: 'triangle' as OscillatorType, volume: 0.13 },
};

export type SomDaChamada = keyof typeof RECEITAS;

let contexto: AudioContext | null = null;

/** Silencia tudo — usado quando a pessoa está com o áudio desligado. */
let mudo = false;

export function silenciarSons(valor: boolean): void {
  mudo = valor;
}

export function tocar(nome: SomDaChamada): void {
  if (mudo) return;

  try {
    // Um contexto só, criado na primeira vez: abrir um por som esgota o limite
    // do navegador depois de algumas dezenas.
    contexto ??= new AudioContext();
    // Entrar na chamada é o gesto que libera o áudio; se ainda estiver
    // suspenso, retomar é barato e não custa nada quando já está ativo.
    if (contexto.state === 'suspended') void contexto.resume();

    const { notas, onda, volume } = RECEITAS[nome];
    const agora = contexto.currentTime;

    for (const nota of notas) {
      const oscilador = contexto.createOscillator();
      const ganho = contexto.createGain();
      oscilador.type = onda;
      oscilador.frequency.value = nota.hz;

      const inicio = agora + nota.inicio;
      const fim = inicio + nota.duracao;
      // Rampa de 12 ms na subida e queda exponencial: é o que tira o estalo.
      ganho.gain.setValueAtTime(0, inicio);
      ganho.gain.linearRampToValueAtTime(volume, inicio + 0.012);
      ganho.gain.exponentialRampToValueAtTime(0.0001, fim);

      oscilador.connect(ganho).connect(contexto.destination);
      oscilador.start(inicio);
      oscilador.stop(fim + 0.02);
    }
  } catch {
    // Sem saída de áudio disponível, o aviso sonoro simplesmente não toca.
    // Nunca vale interromper a chamada por causa de um efeito sonoro.
  }
}
