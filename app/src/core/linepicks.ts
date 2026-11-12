/**
 * 1.2.2 (docs/v1.2.2/PRD-1.2.2.md § 3, § 4) : lignes de bus, tram et métro par leur numéro (findLines), arrêts
 * d'une ligne (lineStops), passages d'une ligne à un arrêt rangés par sens (lineBoard).
 *
 * Règles communes au vrai cœur et au faux cœur (app/src/dev/fake-core.ts) :
 *  - numéro : casse, espaces et zéros de tête ignorés (lineKey : « 036 » = « 36 », « w » = « W ») ;
 *  - terminus d'une ligne (mainEnds) : la destination la plus servie, et la plus servie dans l'autre sens ;
 *  - sens à un arrêt (groupDirections) : deux motifs vont dans le même sens si leurs premières zones suivantes se
 *    recoupent, ou s'ils ont le même terminus ; les services partiels et les antennes restent dans le sens
 *    principal ; 3 sens au plus, ordre stable (rang des motifs dans le fichier de zone, qui ne change pas d'un
 *    rafraîchissement à l'autre ni le soir) ;
 *  - terminus du sens : la destination la plus servie sur toute la journée de service, pour un nom stable du matin au
 *    soir (le 36 reste « vers Wavre, Gare » quand le soir il ne va plus qu'à Lasne Village) ;
 *  - passage partiel (`partial`) : son terminus est sur le parcours du sens, avant le terminus du sens ; sa
 *    destination reste dans `head` (« jusqu'à Vallée Bailly » sur les lunettes). Une antenne (destination hors de ce
 *    parcours) garde sa destination et n'est pas partielle.
 */
import type { AreaSummary, LineFile, LineIndex, LineTile, Meta, Mode, Names, Op } from '../../../shared/types';
import type { Departure, LatLon, LineBoard, LineDeparture, LineDirection, LineMatch, LineStop } from './api';
import { lowerBound, naturalCompare, tileKeysAround, type PreparedArea } from './areas';
import { BOARD_HORIZON_MS, buildBoards, patternOfDeparture, type BoardRequest } from './boards';
import { QuaiError } from './errors';
import { holidayName } from './means';
import { mapPool } from './net';
import type { RealtimeClient } from './realtime';
import { headKey, headScore } from './rtmerge';
import { distanceM, localDate } from './util';

/** findLines : 8 lignes au plus. */
export const LINES_MAX = 8;
/** lineBoard : 3 sens au plus (une ligne qui se sépare juste après l'arrêt). */
export const DIRECTIONS_MAX = 3;
/** Heure de début de la journée de service (comme les trains et les textes : 04:00). */
const DAY_START_MS = 4 * 3_600_000;
/** Premières zones suivantes comparées pour ranger deux motifs dans le même sens. */
const FIRST_NEXT = 3;
/** AreaFile.patterns[].next : 60 zones au plus (pipeline) ; un motif aussi long est tronqué. */
const NEXT_CAP = 60;
/** Ordre des réseaux sans position (« par réseau puis par numéro »). */
const OP_ORDER: readonly Op[] = ['sncb', 'stib', 'delijn', 'tec'];

/** Numéro de ligne comparable : casse, espaces et zéros de tête ignorés (« 036 » → « 36 », « W » → « w »). */
export function lineKey(s: string): string {
  return String(s ?? '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/^0+(?=.)/, '');
}

/* ------------------------------ Terminus d'une ligne (findLines) ------------------------------ */

/** Variante d'une ligne vue de ses extrémités : destination, premier et dernier arrêt, nombre de voyages. */
export interface EndPattern {
  head: Names;
  from: LatLon;
  to: LatLon;
  trips: number;
}

/** Vecteur (m) du premier au dernier arrêt. */
function vec(p: EndPattern): [number, number] {
  const k = Math.cos((p.from.lat * Math.PI) / 180);
  return [(p.to.lat - p.from.lat) * 111_320, (p.to.lon - p.from.lon) * 111_320 * k];
}

/** Deux variantes vont en sens contraires (plus de 105° entre elles) ; une boucle (moins de 300 m) n'a pas de contraire. */
function opposite(a: EndPattern, b: EndPattern): boolean {
  const [ay, ax] = vec(a);
  const [by, bx] = vec(b);
  const na = Math.hypot(ay, ax);
  const nb = Math.hypot(by, bx);
  if (na < 300 || nb < 300) return false;
  return (ay * by + ax * bx) / (na * nb) < -0.25;
}

/**
 * Terminus principaux d'une ligne (« Braine-l'Alleud ↔ Bruxelles Midi ») : la destination la plus servie (voyages
 * des deux jours), puis la plus servie de celles qui vont dans l'autre sens ; une boucle n'en a qu'un. Rangés par
 * ordre alphabétique, pour un affichage stable d'un jour à l'autre.
 */
export function mainEnds(pats: readonly EndPattern[]): Names[] {
  const byHead = new Map<string, { head: Names; trips: number; ref: EndPattern }>();
  for (const p of pats) {
    const k = headKey(p.head?.fr ?? '');
    if (!k) continue;
    const e = byHead.get(k);
    if (!e) byHead.set(k, { head: p.head, trips: p.trips, ref: p });
    else {
      e.trips += p.trips;
      if (p.trips > e.ref.trips) e.ref = p;
    }
  }
  const list = [...byHead.values()].sort((a, b) => b.trips - a.trips || a.head.fr.localeCompare(b.head.fr, 'fr'));
  const top = list[0];
  if (!top) return [];
  const back = list.find((e) => e !== top && opposite(e.ref, top.ref));
  return (back ? [top.head, back.head] : [top.head]).sort((a, b) => a.fr.localeCompare(b.fr, 'fr'));
}

/** Tri des lignes trouvées : la plus proche d'abord ; sans position, par réseau puis par numéro. */
export function sortMatches(ms: readonly LineMatch[]): LineMatch[] {
  const dist = (m: LineMatch) => m.nearest?.distanceM ?? Number.MAX_SAFE_INTEGER;
  return [...ms].sort(
    (a, b) =>
      dist(a) - dist(b) ||
      OP_ORDER.indexOf(a.op) - OP_ORDER.indexOf(b.op) ||
      naturalCompare(a.line, b.line) ||
      a.mode.localeCompare(b.mode) ||
      (a.routes[0] ?? '').localeCompare(b.routes[0] ?? ''),
  );
}

/* ------------------------------ Arrêts d'une ligne (lineStops) ------------------------------ */

/** Arrêts d'une ligne : les plus proches de `near` d'abord (distance arrondie au mètre), sinon dans l'ordre donné. */
export function orderStops(stops: readonly LineStop[], near?: LatLon | null): LineStop[] {
  if (!near) return stops.map((s) => ({ ...s }));
  return stops
    .map((s) => ({ ...s, distanceM: Math.round(distanceM(near, s)) }))
    .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
}

/* ------------------------------ Sens à un arrêt (lineBoard) ------------------------------ */

/** Motif d'une ligne au départ d'une zone. */
export interface DirPattern {
  /** Rang du motif dans le fichier de zone (faux cœur : rang du gabarit) : ordre stable des sens. */
  pi: number;
  head: Names;
  /** Zones desservies ensuite, dans l'ordre (identifiants de zone). */
  next: readonly string[];
  /** Départs de toute la journée de service (terminus du sens), puis dans l'horizon des tableaux (sens montrés). */
  day: number;
  total: number;
}

/** Un sens : ses motifs, son terminus (destination la plus servie) et la clé de ce terminus. */
export interface DirGroup {
  pats: DirPattern[];
  head: Names;
  key: string;
}

/** Deux motifs vont dans le même sens si leurs premières zones suivantes se recoupent. */
export function sameWay(a: readonly string[], b: readonly string[]): boolean {
  const x = a.slice(0, FIRST_NEXT);
  return b.slice(0, FIRST_NEXT).some((z) => x.includes(z));
}

const minPi = (g: DirGroup) => Math.min(...g.pats.map((p) => p.pi));
const sum = (g: DirGroup, f: (p: DirPattern) => number) => g.pats.reduce((s, p) => s + f(p), 0);

/** Sens formé de ces motifs : terminus = destination la plus servie (journée de service, horizon, la plus lointaine). */
function directionOf(ps: DirPattern[]): DirGroup {
  const score = new Map<string, { head: Names; day: number; total: number; len: number; pi: number }>();
  for (const p of ps) {
    const k = headKey(p.head?.fr ?? '');
    const s = score.get(k) ?? { head: p.head, day: 0, total: 0, len: 0, pi: p.pi };
    s.day += p.day;
    s.total += p.total;
    s.len = Math.max(s.len, p.next.length);
    if (p.pi < s.pi) {
      s.pi = p.pi;
      s.head = p.head;
    }
    score.set(k, s);
  }
  const [key, best] = [...score.entries()].sort(([, a], [, b]) => b.day - a.day || b.total - a.total || b.len - a.len || a.pi - b.pi)[0];
  return { pats: ps, head: best.head, key };
}

/**
 * Sens d'une ligne à un arrêt : motifs `pats` (ceux qui partent dans l'horizon) regroupés de proche en proche
 * (sameWay) ; un motif de `all` sans départ dans l'horizon (service principal fini pour la soirée) rejoint le sens qu'il
 * prolonge s'il n'y en a qu'un : il compte pour le terminus et pour les passages partiels. Puis les sens de même
 * terminus sont réunis (variantes qui se séparent juste après l'arrêt, boucle parcourue dans les deux sens : rien ne
 * les distingue pour l'usager). Terminus de chaque sens = la destination la plus servie sur la journée de service,
 * puis dans l'horizon, puis la plus lointaine. 3 sens au plus (les plus servis dans l'horizon), rangés par rang de
 * motif : le plus petit rang des motifs du sens ou de ceux de `all` qui vont dans ce sens, pour un ordre qui ne change
 * pas de la journée.
 */
export function groupDirections(pats: readonly DirPattern[], all: readonly DirPattern[] = pats): DirGroup[] {
  const n = pats.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (sameWay(pats[i].next, pats[j].next)) parent[find(j)] = find(i);
  const byRoot = new Map<number, DirPattern[]>();
  pats.forEach((p, i) => {
    const r = find(i);
    const list = byRoot.get(r);
    if (list) list.push(p);
    else byRoot.set(r, [p]);
  });
  const roots = [...byRoot.values()];
  for (const q of all) {
    if (pats.includes(q)) continue;
    const ways = roots.filter((ps) => ps.some((p) => sameWay(p.next, q.next)));
    if (ways.length === 1) ways[0].push(q);
  }
  const byKey = new Map<string, DirPattern[]>();
  for (const ps of roots) {
    const k = directionOf(ps).key;
    byKey.set(k, [...(byKey.get(k) ?? []), ...ps]);
  }
  let groups: DirGroup[] = [...byKey.values()].map(directionOf);
  if (groups.length > DIRECTIONS_MAX) {
    groups = [...groups]
      .sort((a, b) => sum(b, (p) => p.total) - sum(a, (p) => p.total) || sum(b, (p) => p.day) - sum(a, (p) => p.day) || minPi(a) - minPi(b))
      .slice(0, DIRECTIONS_MAX);
  }
  const rank = (g: DirGroup): number =>
    Math.min(minPi(g), ...all.filter((q) => headKey(q.head?.fr ?? '') === g.key || g.pats.some((p) => sameWay(p.next, q.next))).map((q) => q.pi));
  return groups.map((g) => ({ g, r: rank(g) })).sort((a, b) => a.r - b.r || minPi(a.g) - minPi(b.g)).map(({ g }) => g);
}

/**
 * Un passage du motif `p` s'arrête avant le terminus de son sens : sa destination n'est pas celle du sens et son
 * terminus est sur le parcours d'un motif qui va au terminus du sens, avant celui-ci (ses zones suivantes en sont
 * le début, ou son terminus y figure). Une antenne (terminus hors de ce parcours) n'est pas partielle.
 */
export function partialIn(p: DirPattern, g: DirGroup): boolean {
  if (headKey(p.head?.fr ?? '') === g.key) return false;
  if (!p.next.length || p.next.length >= NEXT_CAP) return false;
  const end = p.next[p.next.length - 1];
  return g.pats.some((q) => {
    if (q === p || headKey(q.head?.fr ?? '') !== g.key) return false;
    const i = q.next.indexOf(end);
    return i >= 0 && (i < q.next.length - 1 || q.next.length >= NEXT_CAP);
  });
}

/** Passage avec son motif (rang dans le fichier de zone ; -1 : passage STIB sans motif connu). */
export interface PatDeparture {
  d: Departure;
  pi: number;
}

/**
 * Passages rangés par sens, `per` au plus par sens, dans l'ordre reçu (trié par heure estimée). Un passage sans motif
 * connu rejoint le sens dont une destination lui ressemble (ou le seul sens), sinon il est ignoré.
 */
export function directionsOf(groups: readonly DirGroup[], deps: readonly PatDeparture[], per: number): LineDirection[] {
  const out: LineDirection[] = groups.map((g) => ({ head: g.head, departures: [] as LineDeparture[] }));
  const where = new Map<number, { gi: number; p: DirPattern }>();
  groups.forEach((g, gi) => g.pats.forEach((p) => where.set(p.pi, { gi, p })));
  for (const { d, pi } of deps) {
    // motif connu ; sinon (passage STIB) le motif dont la destination lui ressemble, ou le seul sens (jamais partiel)
    let hit: { gi: number; p?: DirPattern } | undefined = where.get(pi);
    if (!hit) {
      const k = headKey(d.head?.fr ?? '');
      for (let gi = 0; gi < groups.length && !hit; gi++) {
        const p = groups[gi].pats.find((q) => headScore(k, headKey(q.head?.fr ?? '')) > 0);
        if (p) hit = { gi, p };
      }
      if (!hit && groups.length === 1) hit = { gi: 0 };
    }
    if (!hit) continue;
    const list = out[hit.gi].departures;
    if (list.length >= per) continue;
    const x: LineDeparture = { ...d };
    if (hit.p && partialIn(hit.p, groups[hit.gi])) x.partial = true;
    list.push(x);
  }
  return out;
}

/** Résumé de zone minimal (zone absente des données) : identifiant pour nom, sans position. */
export function missingArea(id: string): AreaSummary {
  const op = id.slice(0, Math.max(0, id.indexOf(':')));
  return { id, op: (OP_ORDER as readonly string[]).includes(op) ? (op as Op) : 'tec', n: { fr: id, nl: id }, lat: 0, lon: 0, modes: [], lines: [] };
}

/**
 * Tableau d'une ligne à une zone introuvable (ni elle, ni une zone qui l'a absorbée) : missing, « introuvable » ; none
 * quand l'absence ne prouve rien (noWeekdayIn).
 */
export function missingLineBoard(areaId: string, line: string, now: number, state: 'missing' | 'none' = 'missing'): LineBoard {
  const area = missingArea(areaId);
  return { area, op: area.op, mode: 'bus', line, directions: [], state, anyPlanned: false, rtErrors: [], updatedAt: now };
}

/**
 * Revue 1.2.2 : jours publiés (meta.serviceDates) sans jour ouvrable, samedi, dimanche ou jour férié. Le pipeline ne
 * garde que les voyages des deux jours publiés : une zone desservie seulement en semaine manque alors aux données
 * (le samedi 14/11, 40 % des zones TEC et 32 % des zones De Lijn n'ont aucun départ) ; son absence ne la dit pas
 * disparue, elle revient avec le prochain jour ouvrable publié.
 */
export function noWeekdayIn(dates: readonly string[]): boolean {
  const two = dates.slice(0, 2);
  return (
    two.length > 0 &&
    two.every((d) => {
      const noon = Date.parse(`${d}T12:00:00Z`);
      if (!Number.isFinite(noon)) return false;
      const wd = new Date(noon).getUTCDay();
      return wd === 0 || wd === 6 || holidayName(noon) !== null;
    })
  );
}

/** Sens d'une ligne : ceux des motifs qui partent dans l'horizon ; s'il n'y en a aucun, ceux de tous les motifs. */
export function directionGroups(pats: readonly DirPattern[]): DirGroup[] {
  const active = pats.filter((p) => p.total > 0);
  return groupDirections(active.length ? active : pats, pats);
}

export interface LineBoardInput {
  area: AreaSummary;
  op: Op;
  mode: Mode;
  line: string;
  /** Motifs de la ligne au départ de la zone (vide : aucun départ de la ligne les jours publiés). */
  pats: readonly DirPattern[];
  /** Sens déjà calculés (directionGroups(pats)), sinon calculés ici. */
  groups?: readonly DirGroup[];
  /** Passages de la ligne à la zone, triés par heure estimée (par sens au moins), temps réel fusionné. */
  deps: readonly PatDeparture[];
  per: number;
  rtErrors: Op[];
  now: number;
}

/**
 * Tableau d'une ligne à une zone qui existe : none sans aucun passage, y compris sans motif de la ligne (les motifs ne
 * viennent que des deux jours publiés : une ligne sans service le week-end ou un jour férié n'a pas « disparu »).
 */
export function lineBoardOf(x: LineBoardInput): LineBoard {
  const base = { area: x.area, op: x.op, mode: x.mode, line: x.line, rtErrors: x.rtErrors, updatedAt: x.now };
  if (!x.pats.length) return { ...base, directions: [], state: 'none', anyPlanned: false };
  const directions = directionsOf(x.groups ?? directionGroups(x.pats), x.deps, Math.max(1, x.per));
  const shown = directions.flatMap((d) => d.departures);
  return { ...base, directions, state: shown.length ? 'ok' : 'none', anyPlanned: shown.some((d) => !d.rt) };
}

/* ------------------------------ Vrai cœur : fichiers de ligne et de zone ------------------------------ */

/** Fichiers de la publication (DataClient.json, même cache que le calcul de trajets). */
export interface LineData {
  meta: Meta;
  json<T>(path: string, valid: (x: unknown) => x is T): Promise<T | null>;
}

/** findLines : fichiers de ligne lus au plus (un fichier fait 10 ko en moyenne). */
export const FIND_FILES_MAX = 16;
/** Lignes « de l'endroit » (linetiles autour de `near`) : rayon demandé (3 × 3 tuiles au plus). */
const NEAR_LINES_M = 2_000;
/** Deux fichiers d'un même numéro sont la même ligne s'ils ont une zone commune ou deux zones à 300 m au plus. */
const SAME_LINE_M = 300;
/** Fichiers chargés en parallèle. */
const POOL = 6;

/* Mêmes formats et mêmes règles que les fichiers du calcul de trajets (routing/select.ts), gardés ici pour que les
   rubriques ne dépendent pas du calcul. */
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isLineIndex = (x: unknown): x is LineIndex => isObj(x) && x.v === 1 && Array.isArray(x.lines) && isObj(x.stations) && typeof x.conn === 'number';
const isLineTile = (x: unknown): x is LineTile => isObj(x) && isObj(x.a);
const isLineFile = (x: unknown): x is LineFile =>
  isObj(x) && typeof x.id === 'string' && typeof x.op === 'string' && Array.isArray(x.areas) && Array.isArray(x.pats) && Array.isArray(x.conn);

/** Fichier facultatif : absent ou illisible → null ; serveur injoignable → l'erreur remonte (comme les tableaux). */
function soft<T>(p: Promise<T | null>): Promise<T | null> {
  return p.catch((e: unknown) => {
    if (e instanceof QuaiError && e.code === 'dataUnreachable') throw e;
    return null;
  });
}

/** Chemin du fichier d'une ligne (LineFile.id) : lines/{op}/{routeKey}.json. */
function linePath(key: string): string | null {
  const i = key.indexOf(':');
  if (i <= 0) return null;
  const op = key.slice(0, i);
  const route = key.slice(i + 1);
  if (!route || !['stib', 'delijn', 'tec'].includes(op)) return null;
  return `lines/${op}/${route.replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
}

const opOf = (key: string): string => key.slice(0, Math.max(0, key.indexOf(':')));
const opRank = (key: string): number => {
  const i = (OP_ORDER as readonly string[]).indexOf(opOf(key));
  return i < 0 ? OP_ORDER.length : i;
};

/** Autorisations par position d'un motif de ligne (LineFile.pats[].f ; absent : montée au début, descente à la fin). */
function flagsOf(f: string | undefined, n: number): string {
  return f && f.length === n ? f : `b${'x'.repeat(Math.max(0, n - 2))}a`.slice(0, Math.max(n, 2));
}

/** Fichiers de ligne (identifiants LineFile.id), dans l'ordre demandé ; absents ou d'une autre génération ignorés. */
async function loadLineFiles(src: LineData, keys: readonly string[]): Promise<LineFile[]> {
  const files = await mapPool(keys, POOL, async (key) => {
    const path = linePath(key);
    if (!path) return null;
    const f = await soft(src.json(path, isLineFile));
    return f && f.id === key ? f : null;
  });
  return files.filter((f): f is LineFile => f !== null);
}

/** Index des lignes de la génération de meta.json (null : pas de fichiers de ligne, ou index d'une autre nuit). */
async function lineIndex(src: LineData): Promise<LineIndex | null> {
  if (!src.meta.lines) return null;
  const index = await soft(src.json('lines/index.json', isLineIndex));
  if (!index || (index.generatedAt && index.generatedAt !== src.meta.generatedAt)) return null;
  return index;
}

/** Variantes d'une ligne : zones où l'on peut monter dans au moins un motif. */
function boardingAreas(files: readonly LineFile[]): Set<string> {
  const out = new Set<string>();
  for (const f of files)
    for (const p of f.pats ?? []) {
      const n = p.a?.length ?? 0;
      const fl = flagsOf(p.f, n);
      for (let k = 0; k < n - 1; k++) if (fl[k] === 'b' || fl[k] === 'x') out.add(f.areas[p.a[k]]?.[0] ?? '');
    }
  out.delete('');
  return out;
}

/** Arrêts où l'on monte, dans l'ordre de la ligne : le motif le plus servi d'abord, puis les arrêts des autres. */
export function stopsOfFiles(files: readonly LineFile[]): LineStop[] {
  const boarding = boardingAreas(files);
  const pats = files.flatMap((f, fi) => (f.pats ?? []).map((p, pi) => ({ f, p, rank: fi * 1_000 + pi })));
  pats.sort((x, y) => (y.p.t?.length ?? 0) - (x.p.t?.length ?? 0) || x.rank - y.rank);
  const out: LineStop[] = [];
  const seen = new Set<string>();
  for (const { f, p } of pats)
    for (const ai of p.a ?? []) {
      const a = f.areas[ai];
      if (!a || seen.has(a[0]) || !boarding.has(a[0])) continue;
      seen.add(a[0]);
      out.push({ areaId: a[0], name: a[3], lat: a[1], lon: a[2] });
    }
  return out;
}

/** Deux fichiers d'un même numéro décrivent la même ligne (deux sens, variantes) : zone commune ou voisine. */
function sameLine(a: LineFile, b: LineFile): boolean {
  if (a.op !== b.op || a.mode !== b.mode || lineKey(a.line) !== lineKey(b.line)) return false;
  const ids = new Set(a.areas.map((x) => x[0]));
  if (b.areas.some((x) => ids.has(x[0]))) return true;
  return a.areas.some((x) => b.areas.some((y) => distanceM({ lat: x[1], lon: x[2] }, { lat: y[1], lon: y[2] }) <= SAME_LINE_M));
}

/** Une ligne trouvée : ses fichiers (variantes), ses terminus, son arrêt le plus proche de `near`. */
function matchOf(files: readonly LineFile[], near: LatLon | null | undefined): LineMatch {
  const f0 = files[0];
  const ends = mainEnds(
    files.flatMap((f) =>
      (f.pats ?? [])
        .filter((p) => (p.a?.length ?? 0) >= 2 && f.areas[p.a[0]] && f.areas[p.a[p.a.length - 1]])
        .map((p) => {
          const a = f.areas[p.a[0]];
          const b = f.areas[p.a[p.a.length - 1]];
          return { head: p.head, from: { lat: a[1], lon: a[2] }, to: { lat: b[1], lon: b[2] }, trips: p.t?.length ?? 0 };
        }),
    ),
  );
  const m: LineMatch = { op: f0.op, mode: f0.mode, line: f0.line, ends, routes: files.map((f) => f.id) };
  const st = near ? orderStops(stopsOfFiles(files), near)[0] : undefined;
  if (st) m.nearest = { areaId: st.areaId, name: st.name, distanceM: st.distanceM ?? 0 };
  return m;
}

/**
 * findLines (PRD-1.2.2 § 4) : lignes de bus, tram et métro de ce numéro (lines/index.json), regroupées par réseau,
 * numéro et mode puis par voisinage (le W du Brabant wallon n'est pas celui de Tournai ; les deux sens d'une ligne
 * De Lijn, deux fichiers, n'en font qu'une). FIND_FILES_MAX fichiers lus au plus : ceux des lignes de l'endroit
 * d'abord (linetiles autour de `near`), puis par réseau dans l'ordre de l'index.
 */
export async function findLinesIn(src: LineData, query: string, near?: LatLon | null): Promise<LineMatch[]> {
  const q = lineKey(query);
  if (!q) return [];
  const index = await lineIndex(src);
  if (!index) return [];
  const ops = new Set<string>(src.meta.lines?.ops ?? []);
  let cand: number[] = [];
  index.lines.forEach(([key, line, mode], li) => {
    if (mode !== 'train' && ops.has(opOf(key)) && lineKey(line) === q) cand.push(li);
  });
  cand.sort((a, b) => opRank(index.lines[a][0]) - opRank(index.lines[b][0]) || a - b);
  if (near && cand.length > FIND_FILES_MAX) {
    const keys = tileKeysAround(near.lat, near.lon, NEAR_LINES_M, src.meta.tile);
    const tiles = await Promise.all(keys.map((k) => soft(src.json(`linetiles/${k}.json`, isLineTile))));
    const here = new Set<number>();
    for (const t of tiles) for (const l of Object.values(t?.a ?? {})) if (Array.isArray(l)) for (const li of l) here.add(li);
    cand = [...cand.filter((li) => here.has(li)), ...cand.filter((li) => !here.has(li))];
  }
  const files = await loadLineFiles(
    src,
    cand.slice(0, FIND_FILES_MAX).map((li) => index.lines[li][0]),
  );
  // regroupement de proche en proche (variantes, sens)
  const parent = files.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) if (find(i) !== find(j) && sameLine(files[i], files[j])) parent[find(j)] = find(i);
  const groups = new Map<number, LineFile[]>();
  files.forEach((f, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), f]);
  });
  return sortMatches([...groups.values()].map((g) => matchOf(g, near))).slice(0, LINES_MAX);
}

/**
 * lineStops (PRD-1.2.2 § 4) : arrêts des variantes de la ligne (`routes`) où l'on peut monter ; sans variante
 * lisible, les lignes de ce réseau et de ce numéro (FIND_FILES_MAX fichiers au plus).
 */
export async function lineStopsIn(src: LineData, m: Pick<LineMatch, 'op' | 'line' | 'routes'>, near?: LatLon | null): Promise<LineStop[]> {
  let files = await loadLineFiles(src, [...new Set(m.routes ?? [])]);
  if (!files.length) {
    const index = await lineIndex(src);
    const q = lineKey(m.line);
    const keys = (index?.lines ?? []).filter(([key, line, mode]) => mode !== 'train' && opOf(key) === m.op && lineKey(line) === q).map(([key]) => key);
    files = await loadLineFiles(src, keys.slice(0, FIND_FILES_MAX));
  }
  return orderStops(stopsOfFiles(files), near);
}

/** Jour de service de `now` dans `dates` (meta.serviceDates) : avant 04:00, celui de la veille ; -1 s'il n'y est pas. */
export function serviceDayIndex(dates: readonly string[], now: number): number {
  return dates.indexOf(localDate(now - DAY_START_MS));
}

/**
 * lineBoard (PRD-1.2.2 § 3) : motifs de la ligne au départ de la zone (fichier de zone), comptés sur les horaires
 * prévus (journée de service de `now` dans `dates`, horizon des tableaux), rangés en sens ; passages de chaque sens par
 * buildBoards (temps réel fusionné comme les tableaux, un appel au relais par réseau). `rt` null : horaires non
 * couverts (none).
 */
export async function lineBoardAt(prep: PreparedArea, area: AreaSummary, line: string, per: number, now: number, rt: RealtimeClient | null, dates: readonly string[] = []): Promise<LineBoard> {
  const want = lineKey(line);
  const pats: DirPattern[] = [];
  const names = new Set<string>();
  let mode: Mode | undefined;
  prep.file.patterns.forEach((p, pi) => {
    if (!p || p.mode === 'train' || lineKey(p.line) !== want) return;
    pats.push({ pi, head: p.head, next: (p.next ?? []).map((x) => x[0]), day: 0, total: 0 });
    names.add(p.line);
    mode ??= p.mode;
  });
  const base = { area, op: prep.file.op, mode: mode ?? area.modes[0] ?? 'bus', line: [...names][0] ?? line, per, now, rtErrors: [] as Op[] };
  if (!pats.length || !rt) return lineBoardOf({ ...base, pats, deps: [] });
  const byPi = new Map(pats.map((p) => [p.pi, p]));
  // journée de service (toute la journée, nom du sens) ; jour absent des horaires : les deux jours du fichier
  const day = serviceDayIndex(dates, now);
  for (const dep of prep.file.deps) {
    const p = byPi.get(dep[2]);
    if (p && (day < 0 || dep[0] === day)) p.day++;
  }
  for (let k = lowerBound(prep, now - 60_000); k < prep.order.length; k++) {
    const di = prep.order[k];
    const t = prep.times[di];
    if (t > now + BOARD_HORIZON_MS) break;
    const p = byPi.get(prep.file.deps[di][2]);
    if (p) p.total++;
  }
  const groups = directionGroups(pats);
  if (!pats.some((p) => p.total > 0)) return lineBoardOf({ ...base, pats, groups, deps: [] });
  // passage STIB sans motif connu : au premier sens dont une destination lui ressemble (ou au seul sens)
  const owner = (h: Names): number => {
    const k = headKey(h?.fr ?? '');
    const i = groups.findIndex((g) => g.pats.some((q) => headScore(k, headKey(q.head?.fr ?? '')) > 0));
    return i < 0 && groups.length === 1 ? 0 : i;
  };
  const reqs: BoardRequest[] = groups.map((g, gi) => ({
    prep,
    limit: Math.max(1, per),
    pick: { patterns: new Set(g.pats.map((p) => p.pi)), lines: names, unknown: (h) => owner(h) === gi },
  }));
  const boards = await buildBoards(reqs, rt, now);
  const deps = boards.flatMap((b) => b.departures.map((d) => ({ d, pi: patternOfDeparture(d) ?? -1 })));
  return lineBoardOf({ ...base, pats, groups, deps, rtErrors: [...new Set(boards.flatMap((b) => b.rtErrors))] });
}
