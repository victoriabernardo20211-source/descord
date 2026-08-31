/**
 * Formata o tempo restante de uma mensagem privada.
 *
 * Regras de UX (item 88): minutos bastam durante quase todo o período; só no
 * último minuto a contagem passa a mostrar segundos.
 */
export function formatRemaining(msRemaining: number): string {
  if (msRemaining <= 0) return 'expirando…';

  const totalSeconds = Math.floor(msRemaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `expira em ${hours}h ${minutes}min`;
  if (minutes > 0) return `expira em ${minutes}min`;
  return `expira em ${seconds}s`;
}

/** Menos de 15 minutos: o contador ganha destaque visual. */
export function isUrgent(msRemaining: number): boolean {
  return msRemaining <= 15 * 60 * 1000;
}

/** Com menos de 1 minuto o contador precisa atualizar a cada segundo. */
export function tickInterval(msRemaining: number): number {
  return msRemaining <= 60_000 ? 1000 : 30_000;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDay(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  if (isToday) return 'Hoje';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}
