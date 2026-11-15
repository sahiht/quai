/**
 * 1.2.10 « Y aller » : construction de traces de positions réalistes pour les scénarios guidés (PRD-1.2.10 § 3, § 9.5).
 * Une trace est une suite de positions datées, avec la vitesse et le cap qu'un téléphone donnerait
 * (onAppLocationChanged dans l'appli Even, watchPosition dans un navigateur). Lieux publics seulement (PRD § 8).
 *
 * Aucune dépendance au code de l'appli : les tests de bout en bout restent un oracle indépendant.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

/** Une position de la trace, au format de `window.__quaiPushFix` (équipe B) : `at` en epoch ms. */
export interface TracePoint extends LatLon {
  /** epoch ms */
  at: number;
  /** m/s */
  speed: number;
  /** degrés depuis le nord vrai, sens horaire ; absent à l'arrêt (le téléphone ne le donne pas sans mouvement) */
  heading?: number;
  /** mètres */
  accuracy: number;
  /** phase de la trace : marche, attente, à bord (lecture des journaux d'échec) */
  phase: 'walk' | 'wait' | 'ride' | 'stay';
  /** repère lisible (« Gembloux », « voie 6 ») sur les points remarquables */
  mark?: string;
}

export interface Trace {
  id: string;
  /** ce que la trace représente, en une phrase */
  label: string;
  /** lieux publics traversés (contrôle de confidentialité, PRD § 8) */
  places: string[];
  points: TracePoint[];
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Distance en mètres (haversine). */
export function distM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cap de a vers b, en degrés (0 = nord, 90 = est). */
export function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const lerp = (a: LatLon, b: LatLon, f: number): LatLon => ({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
const round = (p: LatLon): LatLon => ({ lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6 });

/** Instant local belge (UTC+1 en novembre) « 2026-11-10T07:31:00 » → epoch ms. */
export const at = (local: string): number => Date.parse(`${local}+01:00`);

/** Point le long d'une polyligne, à `m` mètres du début. */
function along(path: LatLon[], m: number): { p: LatLon; heading: number } {
  let left = m;
  for (let i = 1; i < path.length; i++) {
    const d = distM(path[i - 1], path[i]);
    if (left <= d || i === path.length - 1) return { p: lerp(path[i - 1], path[i], d ? Math.min(1, left / d) : 1), heading: bearing(path[i - 1], path[i]) };
    left -= d;
  }
  return { p: path[path.length - 1], heading: 0 };
}

export const pathLength = (path: LatLon[]): number => path.slice(1).reduce((s, p, i) => s + distM(path[i], p), 0);

/**
 * Marche le long d'une polyligne (rues réelles, à la main), à vitesse de marche (1,3 m/s par défaut), une position
 * toutes les `everyS` secondes (2 s : politique `high` du PRD § 3.7, 5 m ou 2 s), précision de 5 m.
 */
export function walk(path: LatLon[], start: number, opts: { speed?: number; everyS?: number; accuracy?: number; mark?: string } = {}): TracePoint[] {
  const speed = opts.speed ?? 1.3;
  const every = (opts.everyS ?? 2) * 1000;
  const len = pathLength(path);
  const dur = (len / speed) * 1000;
  const out: TracePoint[] = [];
  for (let t = 0; t <= dur; t += every) {
    const { p, heading } = along(path, (t / 1000) * speed);
    out.push({ ...round(p), at: start + Math.round(t), speed, heading: Math.round(heading), accuracy: opts.accuracy ?? 5, phase: 'walk', ...(t === 0 && opts.mark ? { mark: opts.mark } : {}) });
  }
  const end = path[path.length - 1];
  out.push({ ...round(end), at: start + Math.round(dur), speed: 0, accuracy: opts.accuracy ?? 5, phase: 'walk', mark: 'arrivée de la marche' });
  return out;
}

/** Immobile (attente sur un quai, à un arrêt), une position toutes les `everyS` secondes. */
export function stay(p: LatLon, from: number, to: number, opts: { everyS?: number; accuracy?: number; phase?: TracePoint['phase']; mark?: string } = {}): TracePoint[] {
  const every = (opts.everyS ?? 10) * 1000;
  const out: TracePoint[] = [];
  for (let t = from; t <= to; t += every) out.push({ ...round(p), at: t, speed: 0, accuracy: opts.accuracy ?? 8, phase: opts.phase ?? 'wait', ...(t === from && opts.mark ? { mark: opts.mark } : {}) });
  return out;
}

/** Arrêt d'un trajet en véhicule : position, arrivée et départ (epoch ms). */
export interface RideStop extends LatLon {
  name: string;
  arr: number;
  dep: number;
}

/**
 * À bord d'un véhicule : arrêt à chaque arrêt (vitesse nulle entre l'arrivée et le départ), puis déplacement en ligne
 * droite jusqu'au suivant à la vitesse moyenne du tronçon (accélération et freinage lissés : 60 % de la vitesse sur
 * les 15 premières et dernières secondes). Une position toutes les `everyS` secondes (30 s : politique `medium`).
 */
export function ride(stops: RideStop[], opts: { everyS?: number; accuracy?: number } = {}): TracePoint[] {
  const every = (opts.everyS ?? 30) * 1000;
  const acc = opts.accuracy ?? 10;
  const out: TracePoint[] = [];
  stops.forEach((s, i) => {
    out.push({ ...round(s), at: s.arr, speed: 0, accuracy: acc, phase: 'ride', mark: s.name });
    if (s.dep > s.arr) out.push({ ...round(s), at: s.dep, speed: 0, accuracy: acc, phase: 'ride' });
    const n = stops[i + 1];
    if (!n) return;
    const d = distM(s, n);
    const dur = n.arr - s.dep;
    const v = d / (dur / 1000);
    const head = Math.round(bearing(s, n));
    for (let t = every; t < dur; t += every) {
      const edge = t < 15_000 || dur - t < 15_000;
      out.push({ ...round(lerp(s, n, t / dur)), at: s.dep + t, speed: Math.round((edge ? 0.6 : 1) * v * 10) / 10, heading: head, accuracy: acc, phase: 'ride' });
    }
  });
  return out;
}

/** Trace bout à bout, triée, sans doublon d'instant (le dernier gagne). */
export function joinTrace(...parts: TracePoint[][]): TracePoint[] {
  const byAt = new Map<number, TracePoint>();
  for (const p of parts.flat()) byAt.set(p.at, p);
  return [...byAt.values()].sort((a, b) => a.at - b.at);
}

/** Dernière position de la trace à l'instant `t` (ou la première si `t` la précède). */
export function pointAt(points: TracePoint[], t: number): TracePoint {
  let best = points[0];
  for (const p of points) if (p.at <= t) best = p;
  return best;
}

/** Positions de la trace entre deux instants (bornes comprises). */
export const between = (points: TracePoint[], from: number, to: number): TracePoint[] => points.filter((p) => p.at >= from && p.at <= to);
