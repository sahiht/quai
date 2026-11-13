/**
 * 1.2.6 (projet « Arrêts et Lignes ») : une ligne suivie sans arrêt, et toute la ligne dans un sens, avec
 * l'attente à chaque arrêt (lineRun).
 *
 *  - Sens : le motif le plus servi de la ligne, puis le plus servi de ceux qui vont dans l'autre sens (opposite) ; une
 *    boucle n'a qu'un sens. Chaque motif rejoint le sens dont il ne va pas à l'opposé. Les sens sont rangés par nom de
 *    terminus (le terminus d'un sens : sa destination la plus servie), pour un ordre stable.
 *  - Arrêts d'un sens : ceux de son motif le plus servi, dans l'ordre. Les autres motifs du sens (services partiels,
 *    variantes) comptent à leurs arrêts communs.
 *  - Passages : horaires de LineFile (profils), puis temps réel : STIB par point d'arrêt (WaitingTimes, une demande pour
 *    30 arrêts), De Lijn et TEC par voyage (GTFS-RT, voyages en cours ou partant dans l'heure), positions retrouvées par
 *    l'identifiant d'arrêt.
 *  - Véhicules : un véhicule arrive à un arrêt quand son prochain passage vient avant celui du prochain véhicule de
 *    l'arrêt d'avant augmenté du temps de parcours entre les deux (le véhicule est entre les deux arrêts).
 */
import type { LineFile, Mode, Names, Op } from '../../../shared/types';
import type { LatLon, LineMatch } from './api';
import { lineKey, loadLineFiles, mainEnds, opposite, type EndPattern, type LineData } from './linepicks';
import type { RealtimeClient, RtTrip, RtUpdate, StibEntry } from './realtime';
import { stibPoint } from './realtime';
import { headKey, headScore, rtAtStop, sameStop } from './rtmerge';
import { distanceM, gtfsTime } from './util';

/** Une ligne suivie, sans arrêt (1.2.6). `via` : l'arrêt d'une ligne suivie en 1.2.5, repère sans position. */
export interface LineFollow {
  id: string;
  op: Op;
  mode?: Mode;
  line: string;
  /** LineFile.id de ses variantes (findLines). */
  routes: string[];
  ends?: Names[];
  /** Couleur officielle de la ligne et de son texte (« RRGGBB »), si l'opérateur la publie. */
  color?: string;
  text?: string;
  /**
   * Arrêt d'origine d'une ligne gardée à un arrêt en 1.2.5 (ou ajoutée depuis les départs d'un arrêt) : il sert à
   * reconnaître la bonne ligne (le W du TEC, pas un autre W) tant que `routes` est vide.
   */
  via?: { areaId: string; name: Names; lat: number; lon: number };
  /** Reprise de « Ouvrir d'office à moins de 300 m » d'une ligne gardée à un arrêt : ouvre les départs de `via`. */
  near?: boolean;
}

export interface LineRunStop {
  areaId: string;
  name: Names;
  lat: number;
  lon: number;
  /** Prochains passages (2 au plus), heure estimée ; `rt` faux : horaire prévu (« ~ »). */
  next: { t: number; rt: boolean }[];
  /** Un véhicule arrive : il est entre l'arrêt d'avant et celui-ci. */
  vehicle?: boolean;
  /** Terminus du sens (descente seule). */
  last?: boolean;
}

export interface LineRun {
  op: Op;
  mode: Mode;
  line: string;
  /** Terminus de chaque sens, dans l'ordre des sens (1 pour une boucle, 2 sinon). */
  heads: Names[];
  dir: number;
  stops: LineRunStop[];
  /** Arrêt du sens le plus proche de la position (à NEAR_RUN_M au plus). */
  nearest?: { index: number; distanceM: number };
  /** Temps réel demandé et en échec : horaires prévus. */
  rtError: boolean;
  state: 'ok' | 'missing';
}

/** L'arrêt le plus proche ouvre la ligne s'il est à 2 km au plus ; plus loin : le premier arrêt. */
/** 1.2.6 : même ligne suivie : même réseau, même numéro (« T3 » comme « 3 »). */
export function sameFollow(a: Pick<LineFollow, 'op' | 'line'>, b: Pick<LineFollow, 'op' | 'line'>): boolean {
  return a.op === b.op && lineKey(a.line) === lineKey(b.line);
}

/**
 * 1.2.6 : la ligne d'une ligne suivie parmi celles trouvées par son numéro (findLines) : même réseau et même mode, celle
 * qui passe à son arrêt repère (`via`) d'abord, sinon la première ; null si aucune.
 */
export function matchFollow(f: Pick<LineFollow, 'op' | 'mode' | 'via'>, ms: readonly LineMatch[]): LineMatch | null {
  const same = ms.filter((m) => m.op === f.op && (!f.mode || m.mode === f.mode));
  return same.find((m) => f.via && m.nearest?.areaId === f.via.areaId) ?? same[0] ?? null;
}

/** 1.2.6 : ligne suivie complétée par sa ligne trouvée : mode, variantes, terminus, couleur ; le repère reste. */
export function completeFollow(f: LineFollow, m: LineMatch): LineFollow {
  const out: LineFollow = { ...f, mode: m.mode, routes: m.routes.slice(0, 16), ends: m.ends.slice(0, 2) };
  delete out.color;
  delete out.text;
  if (m.color) {
    out.color = m.color;
    if (m.text) out.text = m.text;
  }
  return out;
}

export const NEAR_RUN_M = 2_000;
/** Passages montrés par arrêt. */
const PER_STOP = 2;
/** Un passage annoncé reste montré 30 s après son heure. */
const PAST_MS = 30_000;
/** Voyages De Lijn et TEC dont on demande le temps réel : en cours, ou partant dans l'heure. */
const RT_AHEAD_MS = 60 * 60_000;

interface Pat {
  file: LineFile;
  p: LineFile['pats'][number];
  head: Names;
  trips: number;
  end: EndPattern;
}

function patsOf(files: readonly LineFile[]): Pat[] {
  const out: Pat[] = [];
  for (const file of files)
    for (const p of file.pats ?? []) {
      const n = p.a?.length ?? 0;
      const a = file.areas[p.a?.[0] ?? -1];
      const b = file.areas[p.a?.[n - 1] ?? -1];
      if (n < 2 || !a || !b) continue;
      out.push({ file, p, head: p.head, trips: p.t?.length ?? 0, end: { head: p.head, from: { lat: a[1], lon: a[2] }, to: { lat: b[1], lon: b[2] }, trips: p.t?.length ?? 0 } });
    }
  return out;
}

/** Sens de la ligne : motifs regroupés, terminus le plus servi de chacun ; rangés par nom de terminus. */
export function directionsOf(pats: readonly Pat[]): { head: Names; pats: Pat[] }[] {
  if (!pats.length) return [];
  const byTrips = [...pats].sort((x, y) => y.trips - x.trips || y.p.a.length - x.p.a.length);
  const m0 = byTrips[0];
  const m1 = byTrips.find((x) => opposite(x.end, m0.end));
  const groups: Pat[][] = m1 ? [[], []] : [[]];
  for (const x of pats) groups[m1 && opposite(x.end, m0.end) ? 1 : 0].push(x);
  const dirs = groups
    .filter((g) => g.length)
    .map((g) => {
      const count = new Map<string, { head: Names; n: number }>();
      for (const x of g) {
        const k = headKey(x.head.fr);
        const c = count.get(k) ?? { head: x.head, n: 0 };
        c.n += x.trips;
        count.set(k, c);
      }
      const head = [...count.values()].sort((x, y) => y.n - x.n)[0].head;
      return { head, pats: g };
    });
  return dirs.sort((x, y) => x.head.fr.localeCompare(y.head.fr, 'fr'));
}

/** Terminus des sens d'une ligne suivie (liste « Lignes ») : sans horaire ni temps réel. */
export async function lineHeadsIn(src: LineData, f: Pick<LineFollow, 'routes'>): Promise<Names[]> {
  const files = await loadLineFiles(src, [...new Set(f.routes)]);
  const dirs = directionsOf(patsOf(files));
  if (dirs.length) return dirs.map((d) => d.head);
  return mainEnds(patsOf(files).map((x) => x.end));
}

/** Mises à jour d'un voyage rangées par position du motif (l'identifiant d'arrêt fait foi, pas le numéro du flux). */
function byPosition(trip: RtTrip, stops: readonly string[]): RtTrip {
  const u: RtUpdate[] = [];
  for (const x of trip.u) {
    const q = stops.findIndex((s) => s && sameStop(x[1], s));
    if (q >= 0) u.push([q + 1, x[1], x[2], x[3], x[4]]);
  }
  return { cancelled: trip.cancelled, u };
}

/** Une entrée WaitingTimes de la STIB pour cette ligne et ce sens (destination proche d'un terminus du sens). */
function stibOfDirection(e: StibEntry, line: string, heads: readonly string[]): boolean {
  if (e.line !== line || e.noBoarding) return false;
  const fr = headKey(e.dest.fr);
  const nl = headKey(e.dest.nl);
  if (!fr && !nl) return true;
  return heads.some((h) => Math.max(headScore(fr, h), headScore(nl, h)) > 0);
}

/**
 * Toute la ligne dans le sens `dir` : chaque arrêt, ses 2 prochains passages (temps réel ou prévus), les véhicules
 * qui arrivent, l'arrêt le plus proche de `near`.
 */
export async function lineRunIn(src: LineData, rt: RealtimeClient | null, f: Pick<LineFollow, 'op' | 'line' | 'routes' | 'mode'>, dir: number, now: number, near: LatLon | null): Promise<LineRun> {
  const files = await loadLineFiles(src, [...new Set(f.routes)]);
  const empty: LineRun = { op: f.op, mode: f.mode ?? 'bus', line: f.line, heads: [], dir: 0, stops: [], rtError: false, state: 'missing' };
  if (!files.length) return empty;
  const dirs = directionsOf(patsOf(files));
  if (!dirs.length) return empty;
  const d = Math.min(Math.max(0, dir), dirs.length - 1);
  const group = dirs[d];
  const main = [...group.pats].sort((x, y) => y.trips - x.trips || y.p.a.length - x.p.a.length)[0];
  const areas = main.p.a.map((i) => main.file.areas[i]);
  const stops: LineRunStop[] = areas.map((a, i) => ({ areaId: a[0], name: a[3], lat: a[1], lon: a[2], next: [], ...(i === areas.length - 1 ? { last: true } : {}) }));
  const index = new Map<string, number>();
  stops.forEach((s, i) => {
    if (!index.has(s.areaId)) index.set(s.areaId, i);
  });
  const dates = src.meta.serviceDates;
  const cands: { t: number; rt: boolean }[][] = stops.map(() => []);
  let rtError = false;

  // De Lijn, TEC : temps réel des voyages en cours ou partant dans l'heure
  const tripRt = new Map<string, RtTrip | null>();
  if (rt && f.op !== 'stib') {
    const ids: string[] = [];
    for (const x of group.pats) {
      const lastPos = x.p.a.length - 1;
      for (const t of x.p.t ?? []) {
        const id = t[3] !== undefined ? x.file.trips?.[t[3]] : undefined;
        const date = dates[t[0]];
        if (!id || !date) continue;
        const start = gtfsTime(date, t[1]);
        const end = start + (x.p.prof[t[2]]?.[lastPos] ?? 0) * 60_000;
        if (start <= now + RT_AHEAD_MS && end >= now - 10 * 60_000) ids.push(id);
      }
    }
    if (ids.length) {
      const res = await rt.trips(f.op, ids).catch(() => null);
      if (!res || res.error) rtError = true;
      else for (const [id, trip] of res.map) tripRt.set(id, trip);
    }
  }

  for (const x of group.pats) {
    const pos = x.p.a.map((ai) => index.get(x.file.areas[ai]?.[0] ?? '') ?? -1);
    const s = x.p.s ?? [];
    for (const t of x.p.t ?? []) {
      const date = dates[t[0]];
      const prof = x.p.prof[t[2]];
      if (!date || !prof) continue;
      const base = gtfsTime(date, t[1]);
      const id = t[3] !== undefined ? x.file.trips?.[t[3]] : undefined;
      const raw = id ? tripRt.get(id) : undefined;
      const trip = raw ? byPosition(raw, s) : undefined;
      if (trip?.cancelled) continue;
      pos.forEach((i, q) => {
        if (i < 0) return;
        const sched = base + (prof[q] ?? 0) * 60_000;
        const r = trip ? rtAtStop(trip, { seq: q + 1, stopId: s[q] || undefined, sched }) : { rt: false, est: sched, cancelled: false };
        if (r.cancelled) return;
        if (r.est >= now - PAST_MS) cands[i].push({ t: r.est, rt: r.rt });
      });
    }
  }

  // STIB : passages annoncés à chaque point d'arrêt du sens (une demande pour 30 arrêts)
  if (rt && f.op === 'stib') {
    const points = main.p.a.map((_, q) => stibPoint(main.p.s?.[q] ?? ''));
    const res = await rt.stib(points.filter(Boolean)).catch(() => null);
    if (!res || res.error) rtError = true;
    else {
      const heads = [...new Set(group.pats.map((x) => headKey(x.head.fr)))];
      points.forEach((pid, i) => {
        const es = (pid ? res.map.get(pid) : null)?.filter((e) => stibOfDirection(e, f.line, heads)) ?? [];
        const told = es.flatMap((e) => e.times.filter((t) => t >= now - PAST_MS).map((t) => ({ t, rt: !e.planned })));
        if (!told.length) return;
        const lastTold = Math.max(...told.map((x) => x.t));
        // les passages annoncés remplacent les prévus jusqu'au dernier annoncé ; au-delà, l'horaire prévu (« ~ »)
        cands[i] = [...told, ...cands[i].filter((c) => c.t > lastTold + 60_000)];
      });
    }
  }

  stops.forEach((st, i) => {
    st.next = cands[i].sort((x, y) => x.t - y.t).slice(0, PER_STOP);
  });
  // un véhicule entre deux arrêts : il arrive au suivant avant que le prochain de l'arrêt d'avant ait pu y venir
  // (son passage là-bas + le temps de parcours entre les deux, profil le plus servi du motif principal)
  const use = new Map<number, number>();
  for (const t of main.p.t ?? []) use.set(t[2], (use.get(t[2]) ?? 0) + 1);
  const top = [...use.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 0;
  const prof = main.p.prof[top] ?? [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1].next[0]?.t;
    const b = stops[i].next[0]?.t;
    const travel = Math.max(0, (prof[i] ?? 0) - (prof[i - 1] ?? 0)) * 60_000;
    if (a !== undefined && b !== undefined && b < a + travel - 30_000 && b - now < 30 * 60_000) stops[i].vehicle = true;
  }
  const out: LineRun = { op: f.op, mode: main.file.mode, line: main.file.line, heads: dirs.map((x) => x.head), dir: d, stops, rtError, state: 'ok' };
  if (near) {
    let best = -1;
    let bestM = Infinity;
    stops.forEach((st, i) => {
      const m = distanceM(near, st);
      if (m < bestM) [best, bestM] = [i, m];
    });
    if (best >= 0 && bestM <= NEAR_RUN_M) out.nearest = { index: best, distanceM: Math.round(bestM) };
  }
  return out;
}
