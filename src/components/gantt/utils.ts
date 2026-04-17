export function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Advance `days` working days from `startDate`, skipping Sundays and (optionally) Saturdays.
 *  When `trabalhaSabado` is true, Saturdays count as half a day. */
export function addWorkDays(startDate: Date, days: number, trabalhaSabado: boolean = false): Date {
  let current = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  let remaining = days;
  let safety = 0;
  while (remaining > 0 && safety < 10000) {
    safety++;
    current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
    const dow = current.getDay();
    if (dow === 0) continue;
    if (dow === 6) {
      if (!trabalhaSabado) continue;
      remaining -= 0.5;
      continue;
    }
    remaining -= 1;
  }
  return current;
}

export function diffDays(a: Date, b: Date) {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / 86400000);
}

/** Parse "YYYY-MM-DD" as a LOCAL date (no timezone shift).
 *  Falls back to native Date for anything else. */
export function parseISODateLocal(iso: string | Date): Date {
  if (iso instanceof Date) return iso;
  if (typeof iso === 'string') {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
  }
  return new Date(iso);
}

/** Format ISO date "YYYY-MM-DD" as "dd/mm/aaaa" without timezone drift. */
export function formatISODateBR(iso: string | Date): string {
  const d = parseISODateLocal(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Format ISO date "YYYY-MM-DD" as "dd/mm" without timezone drift. */
export function formatISODateShortBR(iso: string | Date): string {
  const d = parseISODateLocal(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Convert Date → "YYYY-MM-DD" using LOCAL components (no UTC shift). */
export function toISODateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDateFull(d: string) {
  return formatISODateBR(d);
}

export function formatDateShort(d: string) {
  return formatISODateShortBR(d);
}

export function getEndDate(startDate: string, duration: number): string {
  const d = parseISODateLocal(startDate);
  d.setDate(d.getDate() + duration);
  return toISODateLocal(d);
}

export function dateToISO(d: Date): string {
  return toISODateLocal(d);
}

export const MONTH_NAMES_PT: Record<number, string> = {
  0: 'Janeiro', 1: 'Fevereiro', 2: 'Março', 3: 'Abril',
  4: 'Maio', 5: 'Junho', 6: 'Julho', 7: 'Agosto',
  8: 'Setembro', 9: 'Outubro', 10: 'Novembro', 11: 'Dezembro',
};
