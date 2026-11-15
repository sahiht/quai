/**
 * 1.2.10 : graphe piéton à partir des voies lues (load.ts) : nœuds aux carrefours (nœud partagé par deux voies ou
 * plus, bout de voie, voisin d'un nœud absent de l'extrait), tronçons entre carrefours, longueur, composantes
 * connexes. Les petites composantes isolées (moins de MIN_COMPONENT_M de voies en tout : bout de quai dessiné seul,
 * allée privée coupée du reste) sont retirées : un départ accroché à elles ne mènerait nulle part. Les autres
 * composantes que la plus grande gardent un numéro (F_COMP) : le téléphone ne relie que deux points du même réseau.
 */
import type { WalkData } from './load.ts';

export const MIN_COMPONENT_M = 200;
const R = 6371000;
const RAD = Math.PI / 180;

/** Distance en mètres entre deux points en degrés (projection locale, segments courts). */
export function segmentM(lat0: number, lon0: number, lat1: number, lon1: number): number {
  const dy = (lat1 - lat0) * RAD;
  const dx = (lon1 - lon0) * RAD * Math.cos(((lat0 + lat1) / 2) * RAD);
  return R * Math.sqrt(dx * dx + dy * dy);
}

export interface WalkGraph {
  data: WalkData;
  /** nœud de carrefour (rang dans data.nodeId) */
  junction: Uint8Array;
  edgeCount: number;
  edgeWay: Int32Array;
  /** positions (dans data.refs) du premier et du dernier nœud du tronçon */
  edgeA: Int32Array;
  edgeB: Int32Array;
  edgeLen: Float64Array;
  /** composante : 0 grand réseau, k > 0 autre réseau gardé, -1 retiré */
  edgeComp: Int32Array;
  stats: { edges: number; junctions: number; components: number; droppedEdges: number; droppedM: number; keptM: number; giantM: number };
}

class Grow {
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

export function buildGraph(data: WalkData, o: { minComponentM?: number; log?: (m: string) => void } = {}): WalkGraph {
  const log = o.log ?? (() => undefined);
  const minComp = o.minComponentM ?? MIN_COMPONENT_M;
  const U = data.nodeId.length;
  const ok = (j: number) => j >= 0 && !Number.isNaN(data.nodeLat[j]);
  // carrefours : nœud vu deux fois ou plus (deux voies, ou une voie qui repasse), bouts de voie, voisins d'un manque
  const seen = new Uint8Array(U);
  const junction = new Uint8Array(U);
  for (let w = 0; w < data.wayCount; w++) {
    const s = data.wayStart[w];
    const e = data.wayStart[w + 1];
    for (let i = s; i < e; i++) {
      const j = data.refs[i];
      if (!ok(j)) continue;
      if (seen[j] < 2) seen[j]++;
      if (seen[j] >= 2 || i === s || i === e - 1 || !ok(data.refs[i - 1]) || !ok(data.refs[i + 1])) junction[j] = 1;
    }
  }
  const way = new Grow();
  const ea = new Grow();
  const eb = new Grow();
  for (let w = 0; w < data.wayCount; w++) {
    const s = data.wayStart[w];
    const e = data.wayStart[w + 1];
    let start = -1;
    for (let i = s; i < e; i++) {
      const j = data.refs[i];
      if (!ok(j)) {
        start = -1;
        continue;
      }
      if (start < 0) {
        start = i;
        continue;
      }
      // nœud répété aussitôt (voie mal dessinée) : ignoré
      if (j === data.refs[i - 1]) continue;
      if (junction[j]) {
        if (!(data.refs[start] === j && i - start <= 1)) {
          way.push(w);
          ea.push(start);
          eb.push(i);
        }
        start = i;
      }
    }
  }
  const edgeCount = way.n;
  const edgeWay = way.a.slice(0, edgeCount);
  const edgeA = ea.a.slice(0, edgeCount);
  const edgeB = eb.a.slice(0, edgeCount);
  const edgeLen = new Float64Array(edgeCount);
  for (let k = 0; k < edgeCount; k++) {
    let len = 0;
    let prev = data.refs[edgeA[k]];
    for (let i = edgeA[k] + 1; i <= edgeB[k]; i++) {
      const j = data.refs[i];
      if (j === prev) continue;
      len += segmentM(data.nodeLat[prev], data.nodeLon[prev], data.nodeLat[j], data.nodeLon[j]);
      prev = j;
    }
    edgeLen[k] = len;
  }
  // composantes connexes (union-find sur les carrefours)
  const parent = new Int32Array(U);
  for (let i = 0; i < U; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let k = 0; k < edgeCount; k++) {
    const a = find(data.refs[edgeA[k]]);
    const b = find(data.refs[edgeB[k]]);
    if (a !== b) parent[a < b ? b : a] = a < b ? a : b;
  }
  const compLen = new Map<number, number>();
  for (let k = 0; k < edgeCount; k++) {
    const r = find(data.refs[edgeA[k]]);
    compLen.set(r, (compLen.get(r) ?? 0) + edgeLen[k]);
  }
  const ranked = [...compLen.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]);
  const compId = new Map<number, number>();
  let kept = 0;
  ranked.forEach(([root, len], i) => {
    if (i === 0) compId.set(root, 0);
    else if (len >= minComp) compId.set(root, ++kept);
    else compId.set(root, -1);
  });
  const edgeComp = new Int32Array(edgeCount);
  let droppedEdges = 0;
  let droppedM = 0;
  let keptM = 0;
  for (let k = 0; k < edgeCount; k++) {
    const c = compId.get(find(data.refs[edgeA[k]])) as number;
    edgeComp[k] = c;
    if (c < 0) {
      droppedEdges++;
      droppedM += edgeLen[k];
    } else keptM += edgeLen[k];
  }
  let junctions = 0;
  for (let i = 0; i < U; i++) junctions += junction[i];
  const giantM = ranked.length ? ranked[0][1] : 0;
  const stats = { edges: edgeCount, junctions, components: kept + (ranked.length ? 1 : 0), droppedEdges, droppedM, keptM, giantM };
  log(
    `Chemins à pied : ${edgeCount} tronçons, ${junctions} carrefours, ${Math.round(keptM / 1000)} km gardés ` +
      `(grand réseau ${Math.round(giantM / 1000)} km, ${kept} autres réseaux) ; ${droppedEdges} tronçons isolés retirés (${Math.round(droppedM / 1000)} km)`,
  );
  return { data, junction, edgeCount, edgeWay, edgeA, edgeB, edgeLen, edgeComp, stats };
}
