/**
 * Zones d'arrêt : regroupement des arrêts physiques d'un même lieu, par opérateur.
 * - parent_station si présent (SNCB : clé = parent sans le « S » initial ; l'arrêt « gare » sans quai en fait partie) ;
 * - sinon même nom (sans casse ni accents, après retrait du suffixe « perron N » / « quai X ») à moins de 300 m ;
 * - clé = parent_station, sinon le plus petit stop_id du groupe (comparaison de chaînes) ;
 * - position = parent si présent, sinon moyenne des arrêts ;
 * - 1.1 (M8.3) : les zones de même nom à moins de 300 m les unes des autres sont ensuite fusionnées (tram et bus
 *   « Gare du Nord » de la STIB, quais TEC « LA HULPE Gare » ayant chacun leur parent). La zone fusionnée garde la
 *   clé, le nom et la position du membre qui a le plus de départs (à égalité, la plus petite clé) ; `aka` donne
 *   les clés des autres membres.
 */
import { normalizeForSearch } from '../../shared/names.ts';
import type { Op } from '../../shared/types.ts';
import { splitPlatform } from './naming.ts';

export interface StopRec {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** location_type : 0 arrêt/quai, 1 gare, 2 entrée, 3 nœud, 4 zone d'embarquement. */
  loc: number;
  parent: string;
  pcode: string;
}

export interface Area {
  key: string;
  /** Arrêts physiques (indices dans stops), triés par stop_id. */
  members: number[];
  /** Arrêt qui donne le nom (parent, sinon plus petit stop_id). */
  nameStop: number;
  /** Indice du parent dans stops, -1 si absent. */
  parent: number;
  lat: number;
  lon: number;
  /** Clés des zones fusionnées dans celle-ci (M8.3), triées ; absent si aucune fusion. */
  aka?: string[];
}

export const GROUP_RADIUS_M = 300;

export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function validCoord(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

/** Clé de regroupement par nom. */
export function nameKey(name: string): string {
  return normalizeForSearch(splitPlatform(name).base);
}

function areaKeyOfParent(op: Op, parent: string): string {
  return op === 'sncb' && /^S./.test(parent) ? parent.slice(1) : parent;
}

class UnionFind {
  private readonly p: Int32Array;
  constructor(n: number) {
    this.p = new Int32Array(n);
    for (let i = 0; i < n; i++) this.p[i] = i;
  }
  find(x: number): number {
    while (this.p[x] !== x) {
      this.p[x] = this.p[this.p[x]];
      x = this.p[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

/** Regroupe en grappes (lien simple) des points à moins de 300 m les uns des autres ; renvoie des listes d'indices de idx. */
function clusterPoints(pos: (i: number) => { lat: number; lon: number }, idx: number[]): number[][] {
  const n = idx.length;
  if (n === 1) return [idx];
  const uf = new UnionFind(n);
  if (n <= 200) {
    for (let a = 0; a < n; a++) {
      const sa = pos(idx[a]);
      for (let b = a + 1; b < n; b++) {
        const sb = pos(idx[b]);
        if (distanceM(sa.lat, sa.lon, sb.lat, sb.lon) <= GROUP_RADIUS_M) uf.union(a, b);
      }
    }
  } else {
    // grille de cellules d'au moins 300 m : on ne compare qu'avec les 9 cellules voisines
    const cLat = 0.003;
    const cLon = 0.005;
    const grid = new Map<string, number[]>();
    idx.forEach((si, k) => {
      const p = pos(si);
      const key = `${Math.floor(p.lat / cLat)}:${Math.floor(p.lon / cLon)}`;
      const cell = grid.get(key);
      if (cell) cell.push(k);
      else grid.set(key, [k]);
    });
    idx.forEach((si, a) => {
      const sa = pos(si);
      const y = Math.floor(sa.lat / cLat);
      const x = Math.floor(sa.lon / cLon);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const b of grid.get(`${y + dy}:${x + dx}`) ?? []) {
            if (b <= a) continue;
            const sb = pos(idx[b]);
            if (distanceM(sa.lat, sa.lon, sb.lat, sb.lon) <= GROUP_RADIUS_M) uf.union(a, b);
          }
        }
      }
    });
  }
  const groups = new Map<number, number[]>();
  for (let k = 0; k < n; k++) {
    const r = uf.find(k);
    const g = groups.get(r);
    if (g) g.push(idx[k]);
    else groups.set(r, [idx[k]]);
  }
  return [...groups.values()];
}

/** Regroupe en grappes (lien simple) les arrêts d'un même nom à moins de 300 m les uns des autres. */
function clusterByDistance(stops: StopRec[], idx: number[]): number[][] {
  return clusterPoints((i) => stops[i], idx);
}

/**
 * M8.3 : fusion des zones de même nom (nameKey) à moins de 300 m (lien simple sur les positions des zones).
 * `depCount[i]` : départs de l'arrêt i (sert à choisir le membre principal, dont la clé reste stable).
 */
function mergeSameName(areas: Area[], stops: StopRec[], depCount?: ArrayLike<number>): Area[] {
  const byName = new Map<string, number[]>();
  areas.forEach((a, i) => {
    const k = nameKey(stops[a.nameStop].name);
    if (!k) return;
    const list = byName.get(k);
    if (list) list.push(i);
    else byName.set(k, [i]);
  });
  const deps = (a: Area) => (depCount ? a.members.reduce((s, m) => s + (depCount[m] ?? 0), 0) : 0);
  const drop = new Set<number>();
  const out = areas.slice();
  for (const idx of byName.values()) {
    if (idx.length < 2) continue;
    for (const cluster of clusterPoints((i) => areas[i], idx)) {
      if (cluster.length < 2) continue;
      const count = new Map(cluster.map((i) => [i, deps(areas[i])]));
      const main = cluster.reduce((best, i) => {
        const d = (count.get(i) ?? 0) - (count.get(best) ?? 0);
        return d > 0 || (d === 0 && areas[i].key < areas[best].key) ? i : best;
      });
      const members = [...new Set(cluster.flatMap((i) => areas[i].members))]
        .sort((x, y) => (stops[x].id < stops[y].id ? -1 : stops[x].id > stops[y].id ? 1 : 0));
      const aka = cluster.filter((i) => i !== main).flatMap((i) => [areas[i].key, ...(areas[i].aka ?? [])]).sort();
      out[main] = { ...areas[main], members, aka };
      for (const i of cluster) if (i !== main) drop.add(i);
    }
  }
  return drop.size ? out.filter((_, i) => !drop.has(i)) : out;
}

/**
 * Calcule les zones d'un opérateur.
 * `used[i]` = 1 si l'arrêt i est desservi : les gares (location_type 1) ou nœuds desservis directement sont
 * alors traités comme des arrêts physiques. `depCount[i]` : nombre de départs de l'arrêt i (choix de la clé d'une
 * zone fusionnée, M8.3 ; sans lui, la plus petite clé). Renvoie aussi la zone de chaque arrêt (-1 si aucune).
 */
export function groupAreas(op: Op, stops: StopRec[], used?: Uint8Array, depCount?: ArrayLike<number>): { areas: Area[]; stopArea: Int32Array } {
  const byId = new Map<string, number>();
  stops.forEach((s, i) => byId.set(s.id, i));

  const groups = new Map<string, { members: number[]; parent: number }>();
  const addTo = (key: string, i: number, parent: number) => {
    const g = groups.get(key);
    if (g) {
      g.members.push(i);
      if (g.parent < 0) g.parent = parent;
    } else groups.set(key, { members: [i], parent });
  };

  const orphansByName = new Map<string, number[]>();
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const physical = s.loc === 0 || (used !== undefined && used[i] === 1);
    if (!physical) continue;
    // remonter jusqu'à la gare (une zone d'embarquement a pour parent un quai, qui a pour parent la gare)
    let parentId = s.loc === 1 ? s.id : s.parent;
    for (let guard = 0; parentId && guard < 4; guard++) {
      const pi = byId.get(parentId);
      if (pi === undefined || stops[pi].loc === 1 || !stops[pi].parent) break;
      parentId = stops[pi].parent;
    }
    if (parentId) {
      const pi = byId.get(parentId) ?? -1;
      addTo(areaKeyOfParent(op, parentId), i, pi);
      continue;
    }
    if (!validCoord(s.lat, s.lon)) continue; // sans parent ni position : inutilisable
    const k = nameKey(s.name) || `#${s.id}`;
    const list = orphansByName.get(k);
    if (list) list.push(i);
    else orphansByName.set(k, [i]);
  }

  for (const idx of orphansByName.values()) {
    for (const cluster of clusterByDistance(stops, idx)) {
      let min = cluster[0];
      for (const i of cluster) if (stops[i].id < stops[min].id) min = i;
      for (const i of cluster) addTo(stops[min].id, i, -1);
    }
  }

  const grouped: Area[] = [];
  for (const [key, g] of groups) {
    const members = [...new Set(g.members)].sort((a, b) => (stops[a].id < stops[b].id ? -1 : stops[a].id > stops[b].id ? 1 : 0));
    let lat = NaN;
    let lon = NaN;
    if (g.parent >= 0 && validCoord(stops[g.parent].lat, stops[g.parent].lon)) {
      lat = stops[g.parent].lat;
      lon = stops[g.parent].lon;
    } else {
      let sl = 0;
      let so = 0;
      let n = 0;
      for (const i of members) {
        if (!validCoord(stops[i].lat, stops[i].lon)) continue;
        sl += stops[i].lat;
        so += stops[i].lon;
        n++;
      }
      if (n) {
        lat = sl / n;
        lon = so / n;
      }
    }
    if (!validCoord(lat, lon)) continue; // zone sans position : ignorée
    const nameStop = g.parent >= 0 && stops[g.parent].name ? g.parent : members[0];
    grouped.push({ key, members, nameStop, parent: g.parent, lat, lon });
  }
  const areas = mergeSameName(grouped, stops, depCount);
  const stopArea = new Int32Array(stops.length).fill(-1);
  areas.forEach((a, ai) => {
    for (const i of a.members) stopArea[i] = ai;
  });
  return { areas, stopArea };
}

/** Nom de fichier d'une zone : areaKey avec tout caractère hors [A-Za-z0-9_-] remplacé par '_'. */
export function areaFileKey(areaKey: string): string {
  return areaKey.replace(/[^A-Za-z0-9_-]/g, '_');
}
