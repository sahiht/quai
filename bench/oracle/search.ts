/**
 * Oracle : recherche multicritère exhaustive (McRAPTOR par plage de départs, « rMcRAPTOR ») sur le réseau complet de
 * net.ts. Indépendante du moteur de Quai : ni select.ts (choix des lignes), ni raptor.ts (une meilleure arrivée par
 * ronde et par passe de marche), ni rank.ts.
 *
 * Critères : départ (le plus tard), arrivée, plus longue marche, marche totale, changements ; ensemble de Pareto
 * exact (un représentant par classe d'égalité). Départs dans [T, T + 60 min] (départ du premier véhicule moins la
 * marche jusqu'à lui, comme Quai), arrivées jusqu'à T + 3 h.
 *
 * Contraintes du produit, reprises telles quelles (params.ts) : 3 véhicules au plus, une correspondance au plus entre
 * deux lignes urbaines, attente de 60 min au plus à chaque correspondance, montées et descentes seulement là où elles
 * sont permises. Extrémités jusqu'à 25 min de marche vers tout arrêt ; marche seule en plus.
 *
 * Plage de départs : les heures de départ possibles sont parcourues de la plus tardive à la plus précoce, en gardant
 * les étiquettes d'une heure à l'autre (même principe que rRAPTOR) ; une étiquette n'est gardée à un arrêt que si
 * aucune autre (de la même heure ou d'une heure plus tardive) ne fait au moins aussi bien sur l'heure, les deux
 * marches, le nombre de véhicules et l'état « correspondances urbaines ».
 */
import { accessOf, type ONet, type Pt } from './net';
import { P, util, type Names } from './quai';

export interface OLeg {
  kind: 'walk' | 'ride';
  from: string;
  to: string;
  dep: number;
  arr: number;
  walk?: number;
  op?: string;
  mode?: string;
  /** Urbain : nom court ; train : catégorie (IC, S1…). */
  line?: string;
  head?: string;
  tripId?: string;
  urban?: boolean;
}

export interface OTrip {
  src: 'oracle' | 'engine';
  dep: number;
  arr: number;
  walks: number[];
  lw: number;
  tw: number;
  rides: number;
  transfers: number;
  waits: number[];
  maxWait: number;
  waitSum: number;
  /** Correspondances entre deux lignes urbaines. */
  uu: number;
  legs: OLeg[];
  /** Signature des véhicules (montée, descente, heures) : rapprochement oracle / moteur. */
  key: string;
  walkOnly: boolean;
  /** Marche d'extrémité au-delà des rayons du moteur (arrêt urbain à plus de 15 min, gare à plus de 25 min). */
  outsideEngineRadius: boolean;
}

export interface SearchOpts {
  windowMin: number;
  horizonMin: number;
  maxRides: number;
  uuMax: number;
  maxWait: number;
  accessMax: number;
  /** Rayon du moteur vers les arrêts urbains (marquage outsideEngineRadius seulement). */
  engineUrban: number;
  engineStation: number;
}

export const DEFAULT_OPTS: SearchOpts = {
  windowMin: 60,
  horizonMin: 180,
  maxRides: P.rounds,
  uuMax: P.urbanUrbanMax,
  maxWait: P.maxWaitMin,
  accessMax: 25,
  engineUrban: P.wideUrbanMin,
  engineStation: P.wideStationMin,
};

class Lab {
  t = 0;
  base = 0;
  lw = 0;
  tw = 0;
  rides = 0;
  uu = 0;
  urb = 0;
  dep = 0;
  accW = 0;
  stop = 0;
  parent: Lab | null = null;
  /** 0 accès, 1 descente (après un véhicule), 2 prêt après correspondance. */
  kind = 0;
  route = -1;
  trip = -1;
  bpos = -1;
  apos = -1;
  walk = 0;
  wait = 0;
  iter = 0;
  dead = false;
}

interface Entry {
  L: Lab;
  trip: number;
  bpos: number;
  uu: number;
  dep: number;
  wait: number;
}

interface Tgt {
  arr: number;
  lw: number;
  tw: number;
  tr: number;
}

const dom = (a: Lab, b: Lab) => a.t <= b.t && a.lw <= b.lw && a.tw <= b.tw && a.rides <= b.rides && a.uu <= b.uu && a.urb <= b.urb;

function insert(bag: Lab[], L: Lab): boolean {
  for (let i = 0; i < bag.length; i++) if (dom(bag[i], L)) return false;
  let w = 0;
  for (let i = 0; i < bag.length; i++) {
    const x = bag[i];
    if (dom(L, x)) x.dead = true;
    else bag[w++] = x;
  }
  bag.length = w;
  bag.push(L);
  return true;
}

function earliest(dep: Int32Array, n: number, nTrips: number, pos: number, t: number): number {
  let lo = 0;
  let hi = nTrips;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (dep[m * n + pos] < t) lo = m + 1;
    else hi = m;
  }
  return lo < nTrips ? lo : -1;
}

export interface SearchStats {
  iterations: number;
  labels: number;
  found: number;
  pareto: number;
  ms: number;
  access: number;
  egress: number;
}

/** Ensemble de Pareto des trajets de O à D partis dans [T, T + windowMin] (minutes depuis base0). */
export function search(net: ONet, O: Pt, D: Pt, T: number, opts: Partial<SearchOpts> = {}): { trips: OTrip[]; stats: SearchStats } {
  const o: SearchOpts = { ...DEFAULT_OPTS, ...opts };
  const t0ms = performance.now();
  const N = net.ids.length;
  const acc = accessOf(net, O, o.accessMax);
  const egr = accessOf(net, D, o.accessMax);
  const egrW = new Int32Array(N).fill(-1);
  for (const [s, w] of egr) egrW[s] = w;
  const Tmax = T + o.horizonMin;
  const Tlast = T + o.windowMin;

  // heures de départ possibles (départ du premier véhicule moins la marche), de la plus tardive à la plus précoce
  const times = new Set<number>();
  for (const [s, w] of acc) {
    const ras = net.routesAt[s];
    const pas = net.posAt[s];
    for (let j = 0; j < ras.length; j++) {
      const r = net.routes[ras[j]];
      const pos = pas[j];
      if (!r.board[pos]) continue;
      let tr = earliest(r.dep, r.n, r.nTrips, pos, T + w);
      if (tr < 0) continue;
      for (; tr < r.nTrips; tr++) {
        const d = r.dep[tr * r.n + pos];
        if (d > Tlast + w) break;
        times.add(d - w);
      }
    }
  }
  const deps = [...times].sort((a, b) => b - a);

  const AB: (Lab[] | undefined)[] = new Array(N);
  const RB: (Lab[] | undefined)[] = new Array(N);
  const target: Tgt[] = [];
  const found: { L: Lab; e: number }[] = [];
  const routeFirst = new Int32Array(net.routes.length).fill(-1);
  const touched: number[] = [];
  const inMarked = new Uint8Array(N);
  const inImproved = new Uint8Array(N);
  let labels = 0;

  const prunedByTarget = (t: number, lw: number, tw: number, tr: number) => {
    for (let i = 0; i < target.length; i++) {
      const J = target[i];
      if (J.arr <= t && J.lw <= lw && J.tw <= tw && J.tr <= tr) return true;
    }
    return false;
  };
  const addTarget = (J: Tgt): boolean => {
    for (let i = 0; i < target.length; i++) {
      const x = target[i];
      if (x.arr <= J.arr && x.lw <= J.lw && x.tw <= J.tw && x.tr <= J.tr) return false;
    }
    let w = 0;
    for (let i = 0; i < target.length; i++) {
      const x = target[i];
      if (!(J.arr <= x.arr && J.lw <= x.lw && J.tw <= x.tw && J.tr <= x.tr)) target[w++] = x;
    }
    target.length = w;
    target.push(J);
    return true;
  };

  let iter = 0;
  for (const t0 of deps) {
    iter++;
    let marked: number[] = [];
    for (const [s, w] of acc) {
      const L = new Lab();
      L.t = t0 + w;
      L.base = t0 + w;
      L.lw = w;
      L.tw = w;
      L.accW = w;
      L.stop = s;
      L.iter = iter;
      labels++;
      if (insert((RB[s] ??= []), L) && !inMarked[s]) {
        inMarked[s] = 1;
        marked.push(s);
      }
    }
    for (let k = 1; k <= o.maxRides && marked.length; k++) {
      for (const s of marked) {
        inMarked[s] = 0;
        const ras = net.routesAt[s];
        const pas = net.posAt[s];
        for (let j = 0; j < ras.length; j++) {
          const ri = ras[j];
          const pos = pas[j];
          if (!net.routes[ri].board[pos]) continue;
          const cur = routeFirst[ri];
          if (cur < 0) {
            routeFirst[ri] = pos;
            touched.push(ri);
          } else if (pos < cur) routeFirst[ri] = pos;
        }
      }
      const improved: number[] = [];
      for (const ri of touched) {
        const p0 = routeFirst[ri];
        routeFirst[ri] = -1;
        const r = net.routes[ri];
        const n = r.n;
        const urban = r.urban ? 1 : 0;
        const rbag: Entry[] = [];
        for (let pos = p0; pos < n; pos++) {
          const s = r.stops[pos];
          if (rbag.length && r.alight[pos]) {
            for (const e of rbag) {
              const ta = r.arr[e.trip * n + pos];
              if (ta > Tmax) continue;
              if (prunedByTarget(ta, e.L.lw, e.L.tw, k - 1)) continue;
              const L = new Lab();
              L.t = ta;
              L.base = ta;
              L.lw = e.L.lw;
              L.tw = e.L.tw;
              L.rides = k;
              L.uu = e.uu;
              L.urb = urban;
              L.dep = e.dep;
              L.stop = s;
              L.parent = e.L;
              L.kind = 1;
              L.route = ri;
              L.trip = e.trip;
              L.bpos = e.bpos;
              L.apos = pos;
              L.wait = e.wait;
              L.iter = iter;
              labels++;
              if (insert((AB[s] ??= []), L) && !inImproved[s]) {
                inImproved[s] = 1;
                improved.push(s);
              }
            }
          }
          if (r.board[pos]) {
            const bag = RB[s];
            if (!bag) continue;
            for (let bi = 0; bi < bag.length; bi++) {
              const L = bag[bi];
              if (L.iter !== iter || L.rides !== k - 1 || L.dead) continue;
              let uu = 0;
              if (k > 1) {
                uu = L.uu + (L.urb && urban ? 1 : 0);
                if (uu > o.uuMax) continue;
              }
              const trip = earliest(r.dep, n, r.nTrips, pos, L.t);
              if (trip < 0) continue;
              const d = r.dep[trip * n + pos];
              if (d > Tmax) continue;
              let dep: number;
              let wait = 0;
              if (k === 1) {
                dep = d - L.accW;
                if (dep > Tlast) continue;
              } else {
                wait = d - L.base;
                if (wait > o.maxWait) continue;
                dep = L.dep;
              }
              // sac du motif : une entrée en domine une autre si son voyage n'est pas plus tardif (FIFO) et ses
              // marches et correspondances urbaines pas plus nombreuses
              let dominated = false;
              for (const x of rbag)
                if (x.trip <= trip && x.L.lw <= L.lw && x.L.tw <= L.tw && x.uu <= uu) {
                  dominated = true;
                  break;
                }
              if (dominated) continue;
              let w = 0;
              for (const x of rbag) if (!(trip <= x.trip && L.lw <= x.L.lw && L.tw <= x.L.tw && uu <= x.uu)) rbag[w++] = x;
              rbag.length = w;
              rbag.push({ L, trip, bpos: pos, uu, dep, wait });
            }
          }
        }
      }
      touched.length = 0;
      const next: number[] = [];
      const mark = (s: number) => {
        if (!inMarked[s]) {
          inMarked[s] = 1;
          next.push(s);
        }
      };
      for (const s of improved) {
        inImproved[s] = 0;
        const bag = AB[s]!;
        const fresh = bag.filter((L) => L.iter === iter && L.rides === k && !L.dead);
        for (const L of fresh) {
          const e = egrW[s];
          if (e >= 0) {
            const J: Tgt = { arr: L.t + e, lw: Math.max(L.lw, e), tw: L.tw + e, tr: k - 1 };
            if (J.arr <= Tmax && addTarget(J)) found.push({ L, e });
          }
          if (k >= o.maxRides) continue;
          // correspondance dans la même zone
          {
            const R = new Lab();
            R.t = L.t + (net.station[s] ? P.mctStation : P.mctUrban);
            R.base = L.t;
            R.lw = L.lw;
            R.tw = L.tw;
            R.rides = k;
            R.uu = L.uu;
            R.urb = L.urb;
            R.dep = L.dep;
            R.stop = s;
            R.parent = L;
            R.kind = 2;
            R.walk = 0;
            R.iter = iter;
            labels++;
            if (R.t <= Tmax && !prunedByTarget(R.t, R.lw, R.tw, k) && insert((RB[s] ??= []), R)) mark(s);
          }
          // à pied vers une zone voisine (400 m)
          const f = net.foot[s];
          for (let j = 0; j < f.length; j += 2) {
            const s2 = f[j];
            const w = f[j + 1];
            const R = new Lab();
            R.t = L.t + w + (net.station[s2] ? P.footBufStation : P.footBufUrban);
            R.base = L.t + w;
            R.lw = Math.max(L.lw, w);
            R.tw = L.tw + w;
            R.rides = k;
            R.uu = L.uu;
            R.urb = L.urb;
            R.dep = L.dep;
            R.stop = s2;
            R.parent = L;
            R.kind = 2;
            R.walk = w;
            R.iter = iter;
            labels++;
            if (R.t <= Tmax && !prunedByTarget(R.t, R.lw, R.tw, k) && insert((RB[s2] ??= []), R)) mark(s2);
          }
        }
      }
      marked = next;
    }
    for (const s of marked) inMarked[s] = 0;
  }

  // trajets : reconstitution, puis ensemble de Pareto exact (départ, arrivée, plus longue marche, marche totale,
  // changements)
  const trips = found.map(({ L, e }) => build(net, L, e, o));
  const direct = util.walkMinutes(util.distanceM(O, D)) as number;
  if (direct <= o.horizonMin) trips.push(walkOnly(T, direct));
  const pareto = paretoOf(trips);
  return {
    trips: pareto,
    stats: { iterations: deps.length, labels, found: found.length, pareto: pareto.length, ms: Math.round(performance.now() - t0ms), access: acc.size, egress: egr.size },
  };
}

/** a domine b (Pareto, critères du banc : départ plus tard, arrivée, plus longue marche, marche totale, changements). */
export function paretoDominates(a: OTrip, b: OTrip): boolean {
  return a.dep >= b.dep && a.arr <= b.arr && a.lw <= b.lw && a.tw <= b.tw && a.transfers <= b.transfers;
}

export function paretoOf(list: OTrip[]): OTrip[] {
  const out: OTrip[] = [];
  const sorted = [...list].sort((a, b) => b.dep - a.dep || a.arr - b.arr || a.lw - b.lw || a.tw - b.tw || a.transfers - b.transfers);
  for (const x of sorted) if (!out.some((y) => paretoDominates(y, x))) out.push(x);
  return out;
}

export function walkOnly(T: number, w: number): OTrip {
  return {
    src: 'oracle',
    dep: T,
    arr: T + w,
    walks: [w],
    lw: w,
    tw: w,
    rides: 0,
    transfers: 0,
    waits: [],
    maxWait: 0,
    waitSum: 0,
    uu: 0,
    legs: [{ kind: 'walk', from: 'O', to: 'D', dep: T, arr: T + w, walk: w }],
    key: 'walk',
    walkOnly: true,
    outsideEngineRadius: false,
  };
}

const nm = (n: Names | undefined) => n?.fr || n?.nl || '';

function build(net: ONet, last: Lab, egress: number, o: SearchOpts): OTrip {
  const chain: Lab[] = [];
  for (let L: Lab | null = last; L; L = L.parent) chain.unshift(L);
  // chain : accès (0), descente (1), [prêt (2), descente (1)]…
  const legs: OLeg[] = [];
  const access = chain[0];
  const rides: Lab[] = chain.filter((L) => L.kind === 1);
  const first = rides[0];
  const r0 = net.routes[first.route];
  const firstDep = r0.dep[first.trip * r0.n + first.bpos];
  let outside = false;
  const radius = (s: number) => (net.station[s] ? o.engineStation : o.engineUrban);
  if (access.accW > 0) {
    legs.push({ kind: 'walk', from: 'O', to: net.ids[access.stop], dep: firstDep - access.accW, arr: firstDep, walk: access.accW });
    if (access.accW > radius(access.stop)) outside = true;
  }
  const waits: number[] = [];
  let uu = 0;
  let prevUrban = false;
  for (let i = 1; i < chain.length; i++) {
    const L = chain[i];
    if (L.kind === 2) {
      if (L.walk > 0) legs.push({ kind: 'walk', from: net.ids[L.parent!.stop], to: net.ids[L.stop], dep: L.parent!.t, arr: L.parent!.t + L.walk, walk: L.walk });
      continue;
    }
    const r = net.routes[L.route];
    const d = r.dep[L.trip * r.n + L.bpos];
    const a = r.arr[L.trip * r.n + L.apos];
    if (L.rides > 1) {
      waits.push(L.wait);
      if (prevUrban && r.urban) uu++;
    }
    prevUrban = r.urban;
    legs.push({
      kind: 'ride',
      from: net.ids[r.stops[L.bpos]],
      to: net.ids[r.stops[L.apos]],
      dep: d,
      arr: a,
      op: r.op,
      mode: r.mode,
      line: r.urban ? r.line : r.tripCat[L.trip],
      head: nm(r.head[L.trip]),
      tripId: r.tripId[L.trip],
      urban: r.urban,
    });
  }
  if (egress > 0) {
    legs.push({ kind: 'walk', from: net.ids[last.stop], to: 'D', dep: last.t, arr: last.t + egress, walk: egress });
    if (egress > radius(last.stop)) outside = true;
  }
  return finish('oracle', legs, waits, uu, outside);
}

/** Champs dérivés d'un trajet à partir de ses étapes (oracle et moteur : même définition). */
export function finish(src: 'oracle' | 'engine', legs: OLeg[], waits: number[], uu: number, outside: boolean): OTrip {
  const rideLegs = legs.filter((l) => l.kind === 'ride');
  const walks = legs.filter((l) => l.kind === 'walk').map((l) => l.walk ?? 0).filter((w) => w >= 1);
  const firstRide = rideLegs[0];
  const accessWalk = legs[0]?.kind === 'walk' && firstRide ? (legs[0].walk ?? 0) : 0;
  const dep = firstRide ? firstRide.dep - accessWalk : legs[0].dep;
  const lastRide = rideLegs[rideLegs.length - 1];
  const egressWalk = legs[legs.length - 1]?.kind === 'walk' && lastRide ? (legs[legs.length - 1].walk ?? 0) : 0;
  const arr = lastRide ? lastRide.arr + egressWalk : legs[legs.length - 1].arr;
  return {
    src,
    dep,
    arr,
    walks,
    lw: walks.reduce((m, w) => Math.max(m, w), 0),
    tw: walks.reduce((s, w) => s + w, 0),
    rides: rideLegs.length,
    transfers: Math.max(0, rideLegs.length - 1),
    waits,
    maxWait: waits.length ? Math.max(...waits) : 0,
    waitSum: waits.reduce((s, w) => s + w, 0),
    uu,
    legs,
    key: rideLegs.length ? rideLegs.map((l) => `${l.from}>${l.to}@${l.dep}-${l.arr}`).join('|') : 'walk',
    walkOnly: rideLegs.length === 0,
    outsideEngineRadius: outside,
  };
}
