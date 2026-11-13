/**
 * 1.1 : fichiers de ligne pour le calcul de trajets (docs/v1.1/design-routing.md § 3, contrats LineFile, LineIndex,
 * LineTile de shared/types.ts).
 *
 * - LineCollector (un par réseau urbain, dans feed.ts) : chaque voyage valide donne une suite de positions (zones,
 *   heure, autorisations, arrêt temps réel) ; motif = ligne, direction, destination, suite des zones, autorisations
 *   et arrêts ; les profils horaires identiques sont partagés ; voyages des deux jours.
 * - buildLineOutputs (build.ts, après tous les réseaux) : numérotation globale des lignes, lignes par zone,
 *   correspondances (`conn`, 400 m, réduites aux bornes des tronçons communs), lignes autour des gares SNCB,
 *   tuiles de lignes.
 */
import type { LineFile, LineIndex, LineTile, Mode, Names, Op } from '../../shared/types.ts';
import { tileKey } from '../../shared/types.ts';
import { distanceM } from './areas.ts';

export type UrbanOp = Exclude<Op, 'sncb'>;
export const URBAN_OPS: UrbanOp[] = ['stib', 'delijn', 'tec'];

/** Rayon des correspondances (LineIndex.conn), en mètres. */
export const CONN_M = 400;

/** Position d'un voyage dans une ligne : zone (indice propre au réseau), heure (minutes), autorisation, arrêt rt. */
export interface TripPosition {
  area: number;
  time: number;
  /** b montée seule, a descente seule, x les deux, n aucune. */
  flag: 'b' | 'a' | 'x' | 'n';
  rt: string;
}

interface PatAcc {
  head: Names;
  areas: number[];
  s: string[];
  f: string;
  profKey: Map<string, number>;
  prof: number[][];
  t: number[][];
}

interface RouteAcc {
  route: string;
  line: string;
  mode: Mode;
  color?: string;
  text?: string;
  byKey: Map<string, PatAcc>;
  pats: PatAcc[];
  tripRank: Map<string, number>;
  trips: string[];
}

/** Ligne prête à écrire, sans les correspondances (calculées après tous les réseaux). */
export interface LineData {
  id: string;
  op: UrbanOp;
  route: string;
  line: string;
  mode: Mode;
  /** 1.2.6 : couleur officielle (« RRGGBB ») et couleur de son texte, si l'opérateur les publie. */
  color?: string;
  text?: string;
  areas: LineFile['areas'];
  pats: LineFile['pats'];
  trips?: string[];
}

/** Autorisations par défaut : montée seule au premier arrêt, les deux ensuite, descente seule au dernier. */
export function defaultFlags(n: number): string {
  return n < 2 ? 'b'.repeat(n) : `b${'x'.repeat(n - 2)}a`;
}

/** Vrai si la suite d'autorisations permet au moins un trajet (une montée avant une descente). */
export function usableFlags(flags: string): boolean {
  const board = flags.search(/[bx]/);
  if (board < 0) return false;
  for (let i = board + 1; i < flags.length; i++) if (flags[i] === 'a' || flags[i] === 'x') return true;
  return false;
}

export class LineCollector {
  readonly op: UrbanOp;
  private readonly routes = new Map<number, RouteAcc>();
  trips = 0;

  constructor(op: UrbanOp) {
    this.op = op;
  }

  /**
   * Ajoute un voyage : `routeIndex` (indice de la ligne dans le flux), `positions` (au moins 2, heures croissantes),
   * `days` (jours de service 0 et/ou 1), `tripId` (De Lijn, TEC : pour le temps réel ; absent pour la STIB).
   * Renvoie faux si le voyage ne permet aucun trajet (aucune montée suivie d'une descente).
   */
  addTrip(routeIndex: number, route: { id: string; line: string; mode: Mode; color?: string; text?: string }, direction: number, head: Names,
    positions: TripPosition[], days: number[], tripId?: string): boolean {
    if (positions.length < 2 || !days.length) return false;
    const flags = positions.map((p) => p.flag).join('');
    if (!usableFlags(flags)) return false;
    let r = this.routes.get(routeIndex);
    if (!r) {
      r = { route: route.id, line: route.line, mode: route.mode, byKey: new Map(), pats: [], tripRank: new Map(), trips: [] };
      if (route.color) r.color = route.color;
      if (route.color && route.text) r.text = route.text;
      this.routes.set(routeIndex, r);
    }
    const areas = positions.map((p) => p.area);
    const s = positions.map((p) => p.rt);
    const key = `${direction}\u0001${head.fr}\u0001${head.nl}\u0001${head.l ?? ''}\u0001${areas.join(',')}\u0001${flags}\u0001${s.join('\u0002')}`;
    let pat = r.byKey.get(key);
    if (!pat) {
      pat = { head, areas, s, f: flags, profKey: new Map(), prof: [], t: [] };
      r.byKey.set(key, pat);
      r.pats.push(pat);
    }
    const t0 = positions[0].time;
    const prof: number[] = [];
    let prev = 0;
    for (const p of positions) {
      prev = Math.max(prev, p.time - t0); // heures jamais décroissantes, même sur un flux douteux
      prof.push(prev);
    }
    const pk = prof.join(',');
    let pi = pat.profKey.get(pk);
    if (pi === undefined) {
      pi = pat.prof.length;
      pat.prof.push(prof);
      pat.profKey.set(pk, pi);
    }
    let rank: number | undefined;
    if (tripId !== undefined) {
      rank = r.tripRank.get(tripId);
      if (rank === undefined) {
        rank = r.trips.length;
        r.trips.push(tripId);
        r.tripRank.set(tripId, rank);
      }
    }
    for (const d of days) pat.t.push(rank === undefined ? [d, t0, pi] : [d, t0, pi, rank]);
    this.trips++;
    return true;
  }

  /**
   * Lignes du réseau. `areaInfo(a)` : [identifiant de zone, lat, lon, noms] de la zone a.
   * Motifs dans l'ordre de création ; voyages triés par (jour, départ, profil, rang) ; zones locales par première
   * apparition. feed.ts ajoute les voyages par premier départ puis trip_id : rangs et ordre stables d'une nuit à l'autre.
   */
  finish(areaInfo: (a: number) => LineFile['areas'][number]): LineData[] {
    const out: LineData[] = [];
    for (const r of this.routes.values()) {
      const local = new Map<number, number>();
      const areas: LineFile['areas'] = [];
      const loc = (a: number) => {
        let i = local.get(a);
        if (i === undefined) {
          i = areas.length;
          local.set(a, i);
          areas.push(areaInfo(a));
        }
        return i;
      };
      const pats: LineFile['pats'] = r.pats.map((p) => {
        p.t.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || (x[3] ?? 0) - (y[3] ?? 0));
        const pat: LineFile['pats'][number] = { head: p.head, a: p.areas.map(loc), s: p.s, prof: p.prof, t: p.t };
        if (p.f !== defaultFlags(p.f.length)) pat.f = p.f;
        return pat;
      });
      const line: LineData = { id: `${this.op}:${r.route}`, op: this.op, route: r.route, line: r.line, mode: r.mode, areas, pats };
      if (r.color) line.color = r.color;
      if (r.text) line.text = r.text;
      if (this.op !== 'stib') line.trips = r.trips;
      out.push(line);
    }
    out.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    return out;
  }
}

/** Nom de fichier d'une ligne : route_id avec tout caractère hors [A-Za-z0-9_-] remplacé par '_'. */
export function routeFileKey(route: string): string {
  return route.replace(/[^A-Za-z0-9_-]/g, '_');
}

/* ------------------------------ étape globale (build.ts) ------------------------------ */

export interface LineOutputs {
  /** Fichiers de ligne à écrire : chemin relatif → contenu. */
  files: { path: string; file: LineFile }[];
  index: LineIndex;
  tiles: Map<string, LineTile>;
  /** Réseaux qui ont au moins une ligne, dans l'ordre stib, delijn, tec. */
  ops: UrbanOp[];
  warnings: string[];
}

/** Grille spatiale simple (cellules de 0,005° × 0,0075°, plus de 400 m de côté en Belgique). */
class Grid {
  private readonly cells = new Map<string, number[]>();
  private readonly lat: number[];
  private readonly lon: number[];
  constructor(lat: number[], lon: number[]) {
    this.lat = lat;
    this.lon = lon;
    for (let i = 0; i < lat.length; i++) {
      const k = Grid.key(lat[i], lon[i]);
      const c = this.cells.get(k);
      if (c) c.push(i);
      else this.cells.set(k, [i]);
    }
  }
  private static cy = (lat: number) => Math.floor(lat / 0.005);
  private static cx = (lon: number) => Math.floor(lon / 0.0075);
  private static key(lat: number, lon: number) {
    return `${Grid.cy(lat)}:${Grid.cx(lon)}`;
  }
  /** Points à moins de r mètres (r ≤ 400). */
  around(lat: number, lon: number, r: number, cb: (i: number) => void): void {
    const y = Grid.cy(lat);
    const x = Grid.cx(lon);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const i of this.cells.get(`${y + dy}:${x + dx}`) ?? []) {
          if (distanceM(lat, lon, this.lat[i], this.lon[i]) <= r) cb(i);
        }
      }
    }
  }
}

/** Positions desservies d'un motif (montée ou descente permise). */
function servedPositions(p: LineFile['pats'][number]): number[] {
  const f = p.f ?? defaultFlags(p.a.length);
  const out: number[] = [];
  for (let i = 0; i < p.a.length; i++) if (f[i] !== 'n') out.push(i);
  return out;
}

/**
 * Numérotation et fichiers finaux. `lines` : lignes de tous les réseaux urbains réussis ;
 * `stations` : gares SNCB (identifiant de zone et position) ; `generatedAt` : celui de meta.json.
 */
export function buildLineOutputs(lines: LineData[], stations: { id: string; lat: number; lon: number }[], generatedAt: string): LineOutputs {
  const warnings: string[] = [];
  // fichiers : un nom de fichier déjà pris (route_id différents, même routeKey) écarte la seconde ligne
  const taken = new Set<string>();
  const kept: LineData[] = [];
  for (const l of [...lines].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
    const path = `lines/${l.op}/${routeFileKey(l.route)}.json`;
    if (taken.has(path)) {
      warnings.push(`ligne ${l.id} ignorée : fichier ${path} déjà utilisé`);
      continue;
    }
    taken.add(path);
    kept.push(l);
  }

  // zones desservies par des lignes : identifiant → indice, position, lignes
  const zoneIdx = new Map<string, number>();
  const zLat: number[] = [];
  const zLon: number[] = [];
  const zLines: Set<number>[] = [];
  const zoneOf = (a: LineFile['areas'][number]): number => {
    let i = zoneIdx.get(a[0]);
    if (i === undefined) {
      i = zLat.length;
      zoneIdx.set(a[0], i);
      zLat.push(a[1]);
      zLon.push(a[2]);
      zLines.push(new Set());
    }
    return i;
  };
  kept.forEach((l, li) => {
    for (const p of l.pats) for (const pos of servedPositions(p)) zLines[zoneOf(l.areas[p.a[pos]])].add(li);
  });
  const grid = new Grid(zLat, zLon);

  // lignes à moins de CONN_M d'une zone (elle comprise), en cache
  const near = new Map<number, number[]>();
  const nearLines = (z: number): number[] => {
    let c = near.get(z);
    if (c) return c;
    const s = new Set<number>();
    grid.around(zLat[z], zLon[z], CONN_M, (b) => {
      for (const m of zLines[b]) s.add(m);
    });
    c = [...s].sort((x, y) => x - y);
    near.set(z, c);
    return c;
  };

  const files: LineOutputs['files'] = [];
  kept.forEach((l, li) => {
    const zones = l.areas.map((a) => zoneIdx.get(a[0]) ?? -1);
    const full = zones.map((z) => (z < 0 ? [] : nearLines(z).filter((m) => m !== li)));
    // une ligne voisine n'est gardée qu'aux bornes de chaque tronçon commun (positions desservies consécutives)
    const keep: Set<number>[] = l.areas.map(() => new Set());
    for (const p of l.pats) {
      const seq = servedPositions(p).map((pos) => p.a[pos]);
      const present = new Map<number, number[]>();
      seq.forEach((la, k) => {
        for (const m of full[la]) {
          const list = present.get(m);
          if (list) list.push(k);
          else present.set(m, [k]);
        }
      });
      for (const [m, ks] of present) {
        let runStart = ks[0];
        for (let i = 1; i <= ks.length; i++) {
          if (i === ks.length || ks[i] !== ks[i - 1] + 1) {
            keep[seq[runStart]].add(m);
            keep[seq[ks[i - 1]]].add(m);
            if (i < ks.length) runStart = ks[i];
          }
        }
      }
    }
    const conn = keep.map((s) => [...s].sort((x, y) => x - y));
    const file: LineFile = { v: 1, id: l.id, op: l.op, route: l.route, line: l.line, mode: l.mode, areas: l.areas, pats: l.pats, conn };
    if (l.color) file.color = l.color;
    if (l.text) file.text = l.text;
    if (l.trips) file.trips = l.trips;
    files.push({ path: `lines/${l.op}/${routeFileKey(l.route)}.json`, file });
  });

  const stationLines: Record<string, number[]> = {};
  for (const s of [...stations].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
    const set = new Set<number>();
    grid.around(s.lat, s.lon, CONN_M, (b) => {
      for (const m of zLines[b]) set.add(m);
    });
    if (set.size) stationLines[s.id] = [...set].sort((x, y) => x - y);
  }

  const index: LineIndex = {
    v: 1,
    generatedAt,
    conn: CONN_M,
    // 1.2.6 : la couleur officielle de la ligne, quand l'opérateur la publie
    lines: kept.map((l): LineIndex['lines'][number] => (l.color ? [l.id, l.line, l.mode, l.pats.length, l.color, l.text ?? ''] : [l.id, l.line, l.mode, l.pats.length])),
    stations: stationLines,
  };

  const tiles = new Map<string, LineTile>();
  const ids = [...zoneIdx.keys()].sort();
  for (const id of ids) {
    const z = zoneIdx.get(id) as number;
    if (!zLines[z].size) continue;
    const k = tileKey(zLat[z], zLon[z]);
    let t = tiles.get(k);
    if (!t) tiles.set(k, (t = { v: 1, a: {} }));
    t.a[id] = [...zLines[z]].sort((x, y) => x - y);
  }

  const ops = URBAN_OPS.filter((op) => kept.some((l) => l.op === op));
  return { files, index, tiles, ops, warnings };
}
