/** Dates de service (fuseau Europe/Brussels) et petits utilitaires de dates GTFS. */

export const TZ = 'Europe/Brussels';

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Date locale belge « YYYY-MM-DD » d'un instant. */
export function brusselsDate(at: Date = new Date()): string {
  const p: Record<string, string> = {};
  for (const x of dayFmt.formatToParts(at)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Ajoute n jours à une date « YYYY-MM-DD » (calcul calendaire, sans effet des changements d'heure). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** « 2026-11-10 » -> « 20261110 ». */
export function gtfsDate(iso: string): string {
  return iso.replace(/-/g, '');
}

/** Jour de la semaine, 0 = lundi ... 6 = dimanche (ordre des colonnes de calendar.txt). */
export function weekdayIndex(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * Heure GTFS « H:MM:SS », « HH:MM:SS » (heures pouvant dépasser 24) ou « HH:MM » -> minutes depuis minuit
 * du jour de service (secondes ignorées, arrondi vers le bas). -1 si vide ou illisible.
 */
export function parseGtfsTime(s: string): number {
  const n = s.length;
  let i = 0;
  while (i < n && s.charCodeAt(i) === 32) i++;
  let h = 0;
  let digits = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) break;
    h = h * 10 + (c - 48);
    i++;
    digits++;
  }
  if (!digits || digits > 3 || i >= n || s.charCodeAt(i) !== 58) return -1;
  i++;
  let m = 0;
  digits = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) break;
    m = m * 10 + (c - 48);
    i++;
    digits++;
  }
  if (digits !== 2 || m > 59) return -1;
  return h * 60 + m;
}
