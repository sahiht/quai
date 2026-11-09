/**
 * Heures de Bruxelles (Europe/Brussels), sans dépendance : Intl suffit sous Node 22.
 */

const TZ = 'Europe/Brussels';

const dtf = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface Parts { y: number; mo: number; d: number; h: number; mi: number; s: number }

function partsAt(ms: number): Parts {
  const p: Record<string, number> = {};
  for (const { type, value } of dtf.formatToParts(new Date(ms))) {
    if (type !== 'literal') p[type] = Number(value);
  }
  return { y: p.year, mo: p.month, d: p.day, h: p.hour === 24 ? 0 : p.hour, mi: p.minute, s: p.second };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Décalage de l'heure de Bruxelles par rapport à UTC, en minutes (60 en hiver, 120 en été). */
export function brusselsOffsetMin(ms: number): number {
  const t = Math.floor(ms / 1000) * 1000;
  const p = partsAt(t);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - t) / 60_000);
}

/** ISO 8601 en heure de Bruxelles avec décalage, ex. '2026-11-10T12:12:00+01:00'. */
export function toBrusselsIso(ms: number): string {
  const t = Math.floor(ms / 1000) * 1000;
  const p = partsAt(t);
  const off = brusselsOffsetMin(t);
  const a = Math.abs(off);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${off < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Date locale de Bruxelles 'YYYY-MM-DD'. */
export function brusselsDate(ms: number): string {
  const p = partsAt(ms);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

/** Instant (epoch ms) d'une heure locale de Bruxelles. Les heures ≥ 24 passent au lendemain (GTFS). */
export function brusselsLocalToMs(y: number, mo: number, d: number, h: number, mi: number, s = 0): number {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = naive - brusselsOffsetMin(naive) * 60_000;
  return naive - brusselsOffsetMin(first) * 60_000;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * Lit une heure absolue. Sans fuseau (« 2026-11-10T12:12:00 »), l'heure est comprise comme heure de Bruxelles.
 * Renvoie null si illisible.
 */
export function parseTime(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const m = ISO_RE.exec(s);
  if (!m) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  const [, y, mo, d, h, mi, sec = '0', zone] = m;
  if (!zone) return brusselsLocalToMs(+y, +mo, +d, +h, +mi, +sec);
  let offMin = 0;
  if (zone.toUpperCase() !== 'Z') {
    const z = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone);
    if (!z) return null;
    offMin = (z[1] === '-' ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3] ?? 0));
  }
  const t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec) - offMin * 60_000;
  return Number.isFinite(t) ? t : null;
}
