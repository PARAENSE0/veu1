/**
 * Ranking semanal: cada semana começa na segunda-feira, 00:00 no horário de
 * Brasília (UTC−3, sem horário de verão) e dura 7 dias. A semana é calculada
 * só pela data — funciona mesmo que o servidor esteja desligado ou sem
 * jogadores na virada: quem jogar depois cai automaticamente na semana nova.
 */
const DAY = 86_400_000;
const OFFSET = 3 * 3_600_000; // UTC−3

export interface WeekInfo {
  /** data (AAAA-MM-DD, horário de Brasília) da segunda-feira que abre a semana */
  id: string;
  start: number;
  end: number;
}

export function weekOf(ms: number): WeekInfo {
  const local = ms - OFFSET;
  const dayStart = Math.floor(local / DAY) * DAY;
  const dow = (new Date(dayStart).getUTCDay() + 6) % 7; // segunda = 0
  const startLocal = dayStart - dow * DAY;
  const start = startLocal + OFFSET;
  return { id: new Date(startLocal).toISOString().slice(0, 10), start, end: start + 7 * DAY };
}

export function weekById(id: string): WeekInfo {
  const startLocal = Date.parse(id + 'T00:00:00Z');
  const start = startLocal + OFFSET;
  return { id, start, end: start + 7 * DAY };
}
