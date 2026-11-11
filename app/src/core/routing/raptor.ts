/**
 * RAPTOR par rondes sur une plage de départs (design-routing.md § 4.6). Ronde k = meilleure arrivée avec k véhicules.
 * On parcourt, du plus tard au plus tôt, les départs possibles des zones d'accès dans la plage demandée, en gardant
 * les étiquettes d'un départ à l'autre : on obtient les compromis (départ plus tard, arrivée plus tôt, moins de
 * véhicules). Un compteur refuse plus de `urbanUrbanMax` correspondances entre deux lignes urbaines (PRD § 7).
 *
 * Correspondances : même zone (2 min, gare 4 min), à pied jusqu'à 400 m (marche + 1 min, + 3 min vers une gare).
 * Montée et descente seulement là où elles sont permises (autorisations des motifs).
 */
import type { Net, RRoute } from './network';
import { P } from './params';

export interface RideRef {
  route: number;
  trip: number;
  bpos: number;
  apos: number;
}

/** Trajet trouvé : véhicules, marches, heures en minutes depuis base0. */
export interface Cand {
  rides: RideRef[];
  /** Pour chaque véhicule après le premier : zone de descente du précédent et minutes de marche (0 : même zone). */
  hops: { from: number; walk: number }[];
  accessStop: number;
  accessWalk: number;
  egressStop: number;
  egressWalk: number;
  dep: number;
  arr: number;
  /** Attentes en correspondance (min), marche et temps de correspondance compris. */
  waits: number[];
  maxWait: number;
}

export interface RaptorQuery {
  access: Map<number, number>;
  egress: Map<number, number>;
  /** Heure demandée (min depuis base0). */
  after: number;
  windowMin: number;
  rounds?: number;
  urbanUrbanMax?: number;
}

const INF = 1e9;

/** Premier voyage d'un motif qui part de `pos` à `t` ou après (-1 s'il n'y en a pas). */
export function earliestTrip(r: RRoute, pos: number, t: number): number {
  const n = r.n;
  if (r.fifo) {
    let lo = 0;
    let hi = r.nTrips;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (r.dep[m * n + pos] < t) lo = m + 1;
      else hi = m;
    }
    return lo < r.nTrips ? lo : -1;
  }
  let best = -1;
  for (let i = 0; i < r.nTrips; i++) {
    const d = r.dep[i * n + pos];
    if (d >= t && (best < 0 || d < r.dep[best * n + pos])) best = i;
  }
  return best;
}

/** Heures de départ candidates : premiers véhicules des zones d'accès dans la plage, moins la marche, du plus tard au plus tôt. */
function departureTimes(net: Net, access: Map<number, number>, after: number, windowMin: number): number[] {
  const times = new Set<number>();
  for (const [s, w] of access) {
    const ras = net.routesAt[s];
    const pas = net.posAt[s];
    for (let j = 0; j < ras.length; j++) {
      const r = net.routes[ras[j]];
      const pos = pas[j];
      if (!r.board[pos]) continue;
      const n = r.n;
      const lo = after + w;
      const hi = after + w + windowMin;
      let t0 = 0;
      if (r.fifo) {
        t0 = earliestTrip(r, pos, lo);
        if (t0 < 0) continue;
      }
      for (let t = t0; t < r.nTrips; t++) {
        const d = r.dep[t * n + pos];
        if (d < lo) continue;
        if (d > hi) {
          if (r.fifo) break;
          continue;
        }
        times.add(d - w);
      }
    }
  }
  return [...times].sort((a, b) => b - a);
}

/** RAPTOR par rondes sur la plage [after, after + windowMin] ; trajets dans l'ordre où ils sont trouvés. */
export function raptor(net: Net, q: RaptorQuery): Cand[] {
  const N = net.size;
  const K = q.rounds ?? P.rounds;
  const uuMax = q.urbanUrbanMax ?? P.urbanUrbanMax;
  const rideArr: Float64Array[] = [];
  const ready: Float64Array[] = [];
  const rRoute: Int32Array[] = [];
  const rTrip: Int32Array[] = [];
  const rBpos: Int32Array[] = [];
  const rApos: Int32Array[] = [];
  const rUU: Int8Array[] = [];
  const rUrb: Int8Array[] = [];
  const dKind: Int8Array[] = []; // 0 accès, 1 même zone, 2 à pied
  const dFrom: Int32Array[] = [];
  const dWalk: Int32Array[] = [];
  const dUU: Int8Array[] = [];
  const dUrb: Int8Array[] = [];
  for (let k = 0; k <= K; k++) {
    rideArr.push(new Float64Array(N).fill(INF));
    ready.push(new Float64Array(N).fill(INF));
    rRoute.push(new Int32Array(N).fill(-1));
    rTrip.push(new Int32Array(N));
    rBpos.push(new Int32Array(N));
    rApos.push(new Int32Array(N));
    rUU.push(new Int8Array(N));
    rUrb.push(new Int8Array(N));
    dKind.push(new Int8Array(N).fill(-1));
    dFrom.push(new Int32Array(N).fill(-1));
    dWalk.push(new Int32Array(N));
    dUU.push(new Int8Array(N));
    dUrb.push(new Int8Array(N));
  }
  const tgt = new Float64Array(K + 1).fill(INF);
  const tgtStop = new Int32Array(K + 1).fill(-1);
  const routeFirst = new Int32Array(net.routes.length).fill(-1);
  const touched: number[] = [];
  const inMarked = new Uint8Array(N);
  const inImproved = new Uint8Array(N);

  let deps = departureTimes(net, q.access, q.after, q.windowMin);
  if (!deps.length) deps = [q.after];
  const out: Cand[] = [];

  for (const t0 of deps) {
    let marked: number[] = [];
    for (const [s, w] of q.access) {
      const v = t0 + w;
      if (v < ready[0][s]) {
        ready[0][s] = v;
        dKind[0][s] = 0;
        dFrom[0][s] = -1;
        dWalk[0][s] = w;
        if (!inMarked[s]) {
          inMarked[s] = 1;
          marked.push(s);
        }
      }
    }
    const before = Float64Array.from(tgt);
    for (let k = 1; k <= K && marked.length; k++) {
      // motifs à parcourir : première position marquée de chaque motif
      for (const s of marked) {
        inMarked[s] = 0;
        const ras = net.routesAt[s];
        const pas = net.posAt[s];
        for (let j = 0; j < ras.length; j++) {
          const ri = ras[j];
          const cur = routeFirst[ri];
          if (cur < 0) {
            routeFirst[ri] = pas[j];
            touched.push(ri);
          } else if (pas[j] < cur) routeFirst[ri] = pas[j];
        }
      }
      const improved: number[] = [];
      const rk = rideArr[k];
      for (const ri of touched) {
        const p0 = routeFirst[ri];
        routeFirst[ri] = -1;
        const r = net.routes[ri];
        const n = r.n;
        const urban = r.urban ? 1 : 0;
        let trip = -1;
        let bpos = -1;
        let uu = 0;
        for (let pos = p0; pos < n; pos++) {
          const s = r.stops[pos];
          if (trip >= 0 && r.alight[pos]) {
            const ta = r.arr[trip * n + pos];
            let bound = tgt[k];
            for (let kk = 1; kk <= k; kk++) if (rideArr[kk][s] < bound) bound = rideArr[kk][s];
            if (ta < bound) {
              rk[s] = ta;
              rRoute[k][s] = ri;
              rTrip[k][s] = trip;
              rBpos[k][s] = bpos;
              rApos[k][s] = pos;
              rUU[k][s] = uu;
              rUrb[k][s] = urban;
              if (!inImproved[s]) {
                inImproved[s] = 1;
                improved.push(s);
              }
            }
          }
          const rd = ready[k - 1][s];
          if (r.board[pos] && rd < INF && (trip < 0 || rd <= r.dep[trip * n + pos])) {
            const uuHere = k > 1 ? dUU[k - 1][s] + (dUrb[k - 1][s] && urban ? 1 : 0) : 0;
            if (uuHere <= uuMax) {
              const nt = earliestTrip(r, pos, rd);
              if (nt >= 0 && (trip < 0 || r.dep[nt * n + pos] < r.dep[trip * n + pos])) {
                trip = nt;
                bpos = pos;
                uu = uuHere;
              }
            }
          }
        }
      }
      touched.length = 0;
      // destination
      for (const s of improved) {
        const e = q.egress.get(s);
        if (e !== undefined && rk[s] + e < tgt[k]) {
          tgt[k] = rk[s] + e;
          tgtStop[k] = s;
        }
      }
      for (let kk = k + 1; kk <= K; kk++)
        if (tgt[k] < tgt[kk]) {
          tgt[kk] = tgt[k];
          tgtStop[kk] = -2;
        }
      // correspondances : même zone, puis à pied
      const next: number[] = [];
      const rdk = ready[k];
      const mark = (s: number) => {
        if (!inMarked[s]) {
          inMarked[s] = 1;
          next.push(s);
        }
      };
      for (const s of improved) {
        inImproved[s] = 0;
        const base = rk[s];
        const v = base + (net.station[s] ? P.mctStation : P.mctUrban);
        if (v < rdk[s]) {
          rdk[s] = v;
          dKind[k][s] = 1;
          dFrom[k][s] = s;
          dWalk[k][s] = 0;
          dUU[k][s] = rUU[k][s];
          dUrb[k][s] = rUrb[k][s];
          mark(s);
        }
        const f = net.foot[s];
        for (let j = 0; j < f.length; j += 2) {
          const s2 = f[j];
          const w = f[j + 1];
          const v2 = base + w + (net.station[s2] ? P.footBufStation : P.footBufUrban);
          if (v2 < rdk[s2]) {
            rdk[s2] = v2;
            dKind[k][s2] = 2;
            dFrom[k][s2] = s;
            dWalk[k][s2] = w;
            dUU[k][s2] = rUU[k][s];
            dUrb[k][s2] = rUrb[k][s];
            mark(s2);
          }
        }
      }
      marked = next;
    }
    for (const s of marked) inMarked[s] = 0;
    for (let k = 1; k <= K; k++) {
      if (tgtStop[k] >= 0 && tgt[k] < before[k]) {
        const c = backtrack(net, q, k, tgtStop[k]);
        if (c) out.push(c);
      }
    }
  }

  function backtrack(netx: Net, qx: RaptorQuery, k: number, s: number): Cand | null {
    const rides: RideRef[] = [];
    const hops: { from: number; walk: number }[] = [];
    let cur = s;
    let round = k;
    let accessWalk = 0;
    let accessStop = -1;
    while (round >= 1) {
      const ri = rRoute[round][cur];
      if (ri < 0) return null;
      const r = netx.routes[ri];
      const ride = { route: ri, trip: rTrip[round][cur], bpos: rBpos[round][cur], apos: rApos[round][cur] };
      if (r.stops[ride.apos] !== cur) return null;
      rides.unshift(ride);
      const b = r.stops[ride.bpos];
      const kind = dKind[round - 1][b];
      if (kind < 0) return null;
      if (round - 1 === 0) {
        accessWalk = dWalk[0][b];
        accessStop = b;
        break;
      }
      hops.unshift({ from: dFrom[round - 1][b], walk: kind === 2 ? dWalk[round - 1][b] : 0 });
      cur = dFrom[round - 1][b];
      round--;
    }
    if (accessStop < 0 || rides.length !== k) return null;
    // Montée du premier véhicule : RAPTOR monte au premier arrêt du motif où le voyage est attrapable. Quand ce voyage
    // part bien après l'heure demandée (au-delà de la plage des départs), une zone d'accès plus loin sur le même
    // voyage permet souvent de partir plus tard avec moins de marche (Bureau → Maison à midi : IC de 17:06 pris à
    // Bruxelles-Midi après 20 min de marche, alors qu'il passe à 17:12 à Bruxelles-Central, à 12 min). Même voyage,
    // même descente : on garde le départ le plus tard, puis la marche la plus courte, comme le parcours de la plage.
    {
      const f0 = rides[0];
      const rf = netx.routes[f0.route];
      let leave = rf.dep[f0.trip * rf.n + f0.bpos] - accessWalk;
      for (let pos = f0.bpos + 1; pos < f0.apos; pos++) {
        const w = rf.board[pos] ? qx.access.get(rf.stops[pos]) : undefined;
        if (w === undefined) continue;
        const d = rf.dep[f0.trip * rf.n + pos] - w;
        if (d > leave || (d === leave && w < accessWalk)) {
          rides[0] = { ...rides[0], bpos: pos };
          accessStop = rf.stops[pos];
          accessWalk = w;
          leave = d;
        }
      }
    }
    const egressWalk = qx.egress.get(s) ?? 0;
    const waits: number[] = [];
    for (let i = 1; i < rides.length; i++) {
      const a = rides[i - 1];
      const ra = netx.routes[a.route];
      const b = rides[i];
      const rb = netx.routes[b.route];
      waits.push(rb.dep[b.trip * rb.n + b.bpos] - ra.arr[a.trip * ra.n + a.apos] - hops[i - 1].walk);
    }
    const first = rides[0];
    const r0 = netx.routes[first.route];
    const last = rides[rides.length - 1];
    const rl = netx.routes[last.route];
    return {
      rides,
      hops,
      accessStop,
      accessWalk,
      egressStop: s,
      egressWalk,
      dep: r0.dep[first.trip * r0.n + first.bpos] - accessWalk,
      arr: rl.arr[last.trip * rl.n + last.apos] + egressWalk,
      waits,
      maxWait: waits.length ? Math.max(...waits) : 0,
    };
  }

  return out;
}

/** Identité d'un trajet trouvé (motifs, voyages, montées, descentes). */
export function candKey(c: Cand): string {
  return c.rides.map((r) => `${r.route}/${r.trip}/${r.bpos}-${r.apos}`).join('|');
}
