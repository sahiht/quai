/**
 * 1.2.10 : lecture des voies piétonnes d'une source OSM, en tableaux compacts (l'extrait de la Belgique compte
 * plusieurs millions de voies) : voies gardées et leurs attributs, nœuds utilisés (triés), coordonnées.
 */
import { maybeWalkable, walkable, wayFlags, wayName } from './filter.ts';
import type { OsmSource } from './source.ts';

export interface WalkData {
  /** noms de rue (rang 0 : sans nom) */
  names: string[];
  wayCount: number;
  wayId: Float64Array;
  wayName: Int32Array;
  wayFlags: Uint8Array;
  /** nœuds de la voie w : refs[wayStart[w] .. wayStart[w + 1]) (rangs dans nodeId) */
  wayStart: Int32Array;
  refs: Int32Array;
  /** identifiants OSM des nœuds utilisés, triés, sans doublon */
  nodeId: Float64Array;
  /** degrés ; NaN si le nœud manque dans l'extrait */
  nodeLat: Float64Array;
  nodeLon: Float64Array;
  /** date des données (secondes), si connue */
  timestamp?: number;
  missingNodes: number;
}

class F64 {
  a = new Float64Array(1 << 16);
  n = 0;
  push(v: number): void {
    if (this.n === this.a.length) {
      const b = new Float64Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
}
class I32 {
  a = new Int32Array(1 << 16);
  n = 0;
  push(v: number): void {
    if (this.n === this.a.length) {
      const b = new Int32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
}

/** Rang de `id` dans le tableau trié `a`, ou -1. */
export function findSorted(a: Float64Array, id: number): number {
  let lo = 0;
  let hi = a.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = a[mid];
    if (v < id) lo = mid + 1;
    else if (v > id) hi = mid - 1;
    else return mid;
  }
  return -1;
}

export function loadWalkData(src: OsmSource, log: (m: string) => void = () => undefined): WalkData {
  const names: string[] = [''];
  const nameIdx = new Map<string, number>([['', 0]]);
  const ids = new F64();
  const nm = new I32();
  const fl: number[] = [];
  const start = new I32();
  const refs = new F64();
  let lastId = -Infinity;
  let sortedWays = true;
  src.ways(maybeWalkable, (id, tags, r, n) => {
    if (n < 2 || !walkable(tags)) return;
    if (id <= lastId) sortedWays = false;
    lastId = id;
    const name = wayName(tags);
    let ni = nameIdx.get(name);
    if (ni === undefined) {
      ni = names.length;
      names.push(name);
      nameIdx.set(name, ni);
    }
    ids.push(id);
    nm.push(ni);
    fl.push(wayFlags(tags));
    start.push(refs.n);
    for (let i = 0; i < n; i++) refs.push(r[i]);
  });
  const wayCount = ids.n;
  start.push(refs.n);
  log(`Chemins à pied : ${wayCount} voies gardées, ${refs.n} nœuds de voie`);
  // voies dans l'ordre des identifiants (sorties déterministes, même si le fichier n'est pas trié)
  let order: number[] | null = null;
  if (!sortedWays) {
    order = Array.from({ length: wayCount }, (_, i) => i).sort((a, b) => ids.a[a] - ids.a[b]);
  }
  const sorted = refs.a.slice(0, refs.n).sort();
  let u = 0;
  for (let i = 0; i < sorted.length; i++) if (i === 0 || sorted[i] !== sorted[i - 1]) sorted[u++] = sorted[i];
  const nodeId = sorted.slice(0, u);
  const wayId = new Float64Array(wayCount);
  const wayNameA = new Int32Array(wayCount);
  const wayFlagsA = new Uint8Array(wayCount);
  const wayStart = new Int32Array(wayCount + 1);
  const refIdx = new Int32Array(refs.n);
  let at = 0;
  for (let k = 0; k < wayCount; k++) {
    const w = order ? order[k] : k;
    wayId[k] = ids.a[w];
    wayNameA[k] = nm.a[w];
    wayFlagsA[k] = fl[w];
    wayStart[k] = at;
    for (let i = start.a[w]; i < start.a[w + 1]; i++) refIdx[at++] = findSorted(nodeId, refs.a[i]);
  }
  wayStart[wayCount] = at;
  const nodeLat = new Float64Array(u).fill(NaN);
  const nodeLon = new Float64Array(u).fill(NaN);
  let cursor = 0;
  let prev = -Infinity;
  let ordered = true;
  src.nodes((nids, lat, lon, n) => {
    for (let i = 0; i < n; i++) {
      const id = nids[i];
      let j: number;
      if (ordered && id > prev) {
        while (cursor < u && nodeId[cursor] < id) cursor++;
        j = cursor < u && nodeId[cursor] === id ? cursor : -1;
      } else {
        ordered = false;
        j = findSorted(nodeId, id);
      }
      prev = id;
      if (j >= 0) {
        nodeLat[j] = lat[i];
        nodeLon[j] = lon[i];
      }
    }
  });
  let missing = 0;
  for (let i = 0; i < u; i++) if (Number.isNaN(nodeLat[i])) missing++;
  if (missing) log(`Chemins à pied : ${missing} nœuds absents de l'extrait (voies coupées au bord)`);
  return {
    names,
    wayCount,
    wayId,
    wayName: wayNameA,
    wayFlags: wayFlagsA,
    wayStart,
    refs: refIdx,
    nodeId,
    nodeLat,
    nodeLon,
    timestamp: src.timestamp,
    missingNodes: missing,
  };
}
