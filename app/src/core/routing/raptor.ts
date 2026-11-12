/**
 * RAPTOR multicritère par plage de départs (PRD-1.2.2 § 7 ; design-routing.md § 4.6). Ronde k : trajets à k véhicules.
 * Pour chaque ronde et chaque zone, un sac d'étiquettes non dominées sur deux critères, l'heure et la plus longue
 * marche, à égalité la marche totale (PRD-1.2.2 § 7, correctif 1 : à heure égale, le trajet qui marche le moins ; avant
 * la 1.2.2, une seule étiquette par zone, la première trouvée à heure égale, souvent celle qui marchait le plus).
 *
 * Plage : les départs possibles des zones d'accès (départ d'un premier véhicule moins la marche jusqu'à lui) sont
 * parcourus du plus tard au plus tôt, les étiquettes gardées d'un départ à l'autre : un trajet parti plus tôt n'est
 * gardé que s'il fait mieux sur l'arrivée, la plus longue marche, la marche totale ou le nombre de véhicules. Résultat :
 * les compromis entre départ, arrivée, marche et changements.
 *
 * Contraintes du produit (params.ts) : `rounds` véhicules au plus, `urbanUrbanMax` correspondances au plus entre deux
 * lignes urbaines (PRD § 7), attente de `maxWait` min au plus à chaque correspondance (le premier véhicule n'est pas une
 * correspondance : on part de chez soi plus tard). Une étiquette compte aussi l'état « correspondances urbaines » (leur
 * nombre, dernier véhicule urbain ou non) : elle n'en domine une autre que si cet état n'est pas pire.
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
  /** Attente en correspondance au plus (min), P.maxWaitMin par défaut. */
  maxWait?: number;
}

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

/** Étape du calcul à une zone : descente d'un véhicule (kind 3) ou prête à monter (0 accès, 1 même zone, 2 à pied). */
class Lab {
  dead = false;
  constructor(
    /** Heure (min) : arrivée à la zone (descente) ou heure à laquelle on peut monter (correspondance faite). */
    readonly t: number,
    /** Arrivée à la zone sans le temps de correspondance (attente comptée à partir d'ici). */
    readonly base: number,
    /** Plus longue marche et marche totale jusqu'ici (min). */
    readonly lw: number,
    readonly tw: number,
    /** Correspondances entre deux lignes urbaines ; dernier véhicule urbain (1) ou non (0). */
    readonly uu: number,
    readonly urb: number,
    /** Départ de la plage (rang) qui l'a créée. */
    readonly it: number,
    readonly parent: Lab | null,
    readonly kind: number,
    readonly stop: number,
    /** Correspondance ou accès : minutes de marche. */
    readonly walk: number,
    /** Descente : motif, voyage, montée, descente. */
    readonly route: number,
    readonly trip: number,
    readonly bpos: number,
    readonly apos: number,
  ) {}
}

type Bag = Lab[] | undefined;

/** Une étiquette de `bag` vaut au moins (t, lw, uu, urb) et, à égalité sur ces quatre, la marche totale `tw`. */
function covers(bag: Bag, t: number, lw: number, uu: number, urb: number, tw: number): boolean {
  if (!bag) return false;
  for (let i = 0; i < bag.length; i++) {
    const x = bag[i];
    if (x.t <= t && x.lw <= lw && x.uu <= uu && x.urb <= urb && (x.t < t || x.lw < lw || x.uu < uu || x.urb < urb || x.tw <= tw)) return true;
  }
  return false;
}

/** Ajoute L à un sac (déjà vérifiée non dominée) et retire celles qu'elle domine. */
function put(bag: Lab[], L: Lab): void {
  let w = 0;
  for (let i = 0; i < bag.length; i++) {
    const x = bag[i];
    if (L.t <= x.t && L.lw <= x.lw && L.uu <= x.uu && L.urb <= x.urb && (L.t < x.t || L.lw < x.lw || L.uu < x.uu || L.urb < x.urb || L.tw <= x.tw)) x.dead = true;
    else bag[w++] = x;
  }
  bag.length = w;
  bag.push(L);
}

interface Target {
  arr: number;
  lw: number;
  tw: number;
  k: number;
  dead: boolean;
  /** Descente du dernier véhicule et marche jusqu'à l'arrivée. */
  L: Lab;
  e: number;
  it: number;
}

/** Montée sur un motif : étiquette de départ, voyage, position de montée, correspondances urbaines. */
interface Entry {
  L: Lab;
  trip: number;
  dep: number;
  bpos: number;
  uu: number;
}

/** RAPTOR multicritère sur la plage [after, after + windowMin] ; trajets dans l'ordre où ils sont trouvés. */
export function raptor(net: Net, q: RaptorQuery): Cand[] {
  const N = net.size;
  const K = q.rounds ?? P.rounds;
  const uuMax = q.urbanUrbanMax ?? P.urbanUrbanMax;
  const maxWait = q.maxWait ?? P.maxWaitMin;
  /** AB[k][s] : descentes après k véhicules ; RB[k][s] : prêtes à monter après k véhicules (RB[0] : accès). */
  const AB: Bag[][] = [];
  const RB: Bag[][] = [];
  for (let k = 0; k <= K; k++) {
    AB.push(new Array<Bag>(N));
    RB.push(new Array<Bag>(N));
  }
  const egr = new Int32Array(N).fill(-1);
  for (const [s, e] of q.egress) egr[s] = e;
  const targets: Target[] = [];
  /** Trajets trouvés pendant le départ en cours (certains dominés ensuite). */
  const found: Target[] = [];
  const routeFirst = new Int32Array(net.routes.length).fill(-1);
  const touched: number[] = [];
  const inMarked = new Uint8Array(N);
  const inImproved = new Uint8Array(N);
  const rbag: Entry[] = [];

  /** Un trajet déjà trouvé, à `k` véhicules au plus, fait au moins aussi bien que tout ce qui part de (t, lw, tw). */
  const pruned = (t: number, lw: number, tw: number, k: number): boolean => {
    for (let i = 0; i < targets.length; i++) {
      const x = targets[i];
      if (x.arr <= t && x.lw <= lw && x.k <= k && (x.arr < t || x.lw < lw || x.k < k || x.tw <= tw)) return true;
    }
    return false;
  };
  /** Trajet complet (arrivée, plus longue marche, marche totale, véhicules) : gardé s'il n'est pas dominé. */
  const reach = (L: Lab, e: number, k: number, it: number): void => {
    const arr = L.t + e;
    const lw = Math.max(L.lw, e);
    const tw = L.tw + e;
    for (let i = 0; i < targets.length; i++) {
      const x = targets[i];
      if (x.arr <= arr && x.lw <= lw && x.k <= k && (x.arr < arr || x.lw < lw || x.k < k || x.tw <= tw)) return;
    }
    let w = 0;
    for (let i = 0; i < targets.length; i++) {
      const x = targets[i];
      if (arr <= x.arr && lw <= x.lw && k <= x.k && (arr < x.arr || lw < x.lw || k < x.k || tw <= x.tw)) x.dead = true;
      else targets[w++] = x;
    }
    targets.length = w;
    const J: Target = { arr, lw, tw, k, dead: false, L, e, it };
    targets.push(J);
    found.push(J);
  };
  /** Étiquette (t, lw, uu, urb, tw) non dominée à la zone s par une étiquette des rondes kMin à k. */
  const fresh = (bags: Bag[][], kMin: number, k: number, s: number, t: number, lw: number, uu: number, urb: number, tw: number): boolean => {
    for (let kk = kMin; kk <= k; kk++) if (covers(bags[kk][s], t, lw, uu, urb, tw)) return false;
    return true;
  };

  let deps = departureTimes(net, q.access, q.after, q.windowMin);
  if (!deps.length) deps = [q.after];
  const out: Cand[] = [];
  let iter = 0;

  for (const t0 of deps) {
    iter++;
    found.length = 0;
    let marked: number[] = [];
    for (const [s, w] of q.access) {
      const t = t0 + w;
      if (!fresh(RB, 0, 0, s, t, w, 0, 0, w)) continue;
      put((RB[0][s] ??= []), new Lab(t, t, w, w, 0, 0, iter, null, 0, s, w, -1, -1, -1, -1));
      if (!inMarked[s]) {
        inMarked[s] = 1;
        marked.push(s);
      }
    }
    for (let k = 1; k <= K && marked.length; k++) {
      // motifs à parcourir : première position marquée où l'on peut monter
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
      const ABk = AB[k];
      const RBp = RB[k - 1];
      for (const ri of touched) {
        const p0 = routeFirst[ri];
        routeFirst[ri] = -1;
        const r = net.routes[ri];
        const n = r.n;
        const urban = r.urban ? 1 : 0;
        rbag.length = 0;
        for (let pos = p0; pos < n; pos++) {
          const s = r.stops[pos];
          // descente
          if (rbag.length && r.alight[pos]) {
            for (let i = 0; i < rbag.length; i++) {
              const e = rbag[i];
              const ta = r.arr[e.trip * n + pos];
              const lw = e.L.lw;
              const tw = e.L.tw;
              if (pruned(ta, lw, tw, k) || !fresh(AB, 1, k, s, ta, lw, e.uu, urban, tw)) continue;
              const A = new Lab(ta, ta, lw, tw, e.uu, urban, iter, e.L, 3, s, 0, ri, e.trip, e.bpos, pos);
              put((ABk[s] ??= []), A);
              if (!inImproved[s]) {
                inImproved[s] = 1;
                improved.push(s);
              }
              const eg = egr[s];
              if (eg >= 0) reach(A, eg, k, iter);
            }
          }
          // montée
          if (!r.board[pos]) continue;
          const bag = RBp[s];
          if (!bag) continue;
          for (let i = 0; i < bag.length; i++) {
            const L = bag[i];
            if (L.it !== iter || L.dead) continue;
            let uu = 0;
            if (k > 1) {
              uu = L.uu + (L.urb && urban ? 1 : 0);
              if (uu > uuMax) continue;
            }
            const trip = earliestTrip(r, pos, L.t);
            if (trip < 0) continue;
            const d = r.dep[trip * n + pos];
            if (k > 1 && d - L.base > maxWait) continue;
            // une montée en domine une autre si elle prend un voyage pas plus tardif (motif FIFO : rang du voyage ;
            // sinon, heure de départ ici) avec des marches et des correspondances urbaines pas plus nombreuses
            let dominated = false;
            for (let j = 0; j < rbag.length; j++) {
              const x = rbag[j];
              const xe = r.fifo ? x.trip <= trip : x.dep <= d;
              const xs = r.fifo ? x.trip < trip : x.dep < d;
              if (xe && x.L.lw <= L.lw && x.uu <= uu && (xs || x.L.lw < L.lw || x.uu < uu || x.L.tw <= L.tw)) {
                dominated = true;
                break;
              }
            }
            if (dominated) continue;
            let w = 0;
            for (let j = 0; j < rbag.length; j++) {
              const x = rbag[j];
              const ye = r.fifo ? trip <= x.trip : d <= x.dep;
              const ys = r.fifo ? trip < x.trip : d < x.dep;
              if (!(ye && L.lw <= x.L.lw && uu <= x.uu && (ys || L.lw < x.L.lw || uu < x.uu || L.tw <= x.L.tw))) rbag[w++] = x;
            }
            rbag.length = w;
            rbag.push({ L, trip, dep: d, bpos: pos, uu });
          }
        }
      }
      touched.length = 0;
      // correspondances : même zone, puis à pied
      const next: number[] = [];
      const RBk = RB[k];
      const mark = (s: number) => {
        if (!inMarked[s]) {
          inMarked[s] = 1;
          next.push(s);
        }
      };
      for (const s of improved) {
        inImproved[s] = 0;
        if (k >= K) continue;
        const bag = ABk[s];
        if (!bag) continue;
        const f = net.foot[s];
        for (let i = 0; i < bag.length; i++) {
          const L = bag[i];
          if (L.it !== iter || L.dead) continue;
          const v = L.t + (net.station[s] ? P.mctStation : P.mctUrban);
          if (!pruned(v, L.lw, L.tw, k + 1) && fresh(RB, 0, k, s, v, L.lw, L.uu, L.urb, L.tw)) {
            put((RBk[s] ??= []), new Lab(v, L.t, L.lw, L.tw, L.uu, L.urb, iter, L, 1, s, 0, -1, -1, -1, -1));
            mark(s);
          }
          for (let j = 0; j < f.length; j += 2) {
            const s2 = f[j];
            const wk = f[j + 1];
            const v2 = L.t + wk + (net.station[s2] ? P.footBufStation : P.footBufUrban);
            const lw = Math.max(L.lw, wk);
            const tw = L.tw + wk;
            if (pruned(v2, lw, tw, k + 1) || !fresh(RB, 0, k, s2, v2, lw, L.uu, L.urb, tw)) continue;
            put((RBk[s2] ??= []), new Lab(v2, L.t + wk, lw, tw, L.uu, L.urb, iter, L, 2, s2, wk, -1, -1, -1, -1));
            mark(s2);
          }
        }
      }
      marked = next;
    }
    for (const s of marked) inMarked[s] = 0;
    // trajets de ce départ encore non dominés
    for (const J of found) {
      if (J.dead) continue;
      const c = backtrack(net, q, J);
      if (c) out.push(c);
    }
  }
  return out;
}

/** Étapes d'un trajet trouvé, de l'accès à la dernière descente. */
function backtrack(net: Net, q: RaptorQuery, J: Target): Cand | null {
  const chain: Lab[] = [];
  for (let L: Lab | null = J.L; L; L = L.parent) chain.unshift(L);
  const access = chain[0];
  if (!access || access.kind !== 0) return null;
  const rides: RideRef[] = [];
  const hops: { from: number; walk: number }[] = [];
  let pendingHop: { from: number; walk: number } | null = null;
  for (let i = 1; i < chain.length; i++) {
    const L = chain[i];
    if (L.kind === 3) {
      if (rides.length) hops.push(pendingHop ?? { from: chain[i - 1].stop, walk: 0 });
      pendingHop = null;
      rides.push({ route: L.route, trip: L.trip, bpos: L.bpos, apos: L.apos });
    } else pendingHop = { from: L.parent ? L.parent.stop : L.stop, walk: L.kind === 2 ? L.walk : 0 };
  }
  if (!rides.length || rides.length !== J.k) return null;
  let accessStop = access.stop;
  let accessWalk = access.walk;
  // Montée du premier véhicule : RAPTOR monte au premier arrêt du motif où le voyage est attrapable. Quand ce voyage
  // part bien après l'heure demandée (au-delà de la plage des départs), une zone d'accès plus loin sur le même voyage
  // permet souvent de partir plus tard avec moins de marche (Bureau → Maison à midi : IC de 17:06 pris à Bruxelles-Midi
  // après 20 min de marche, alors qu'il passe à 17:12 à Bruxelles-Central, à 12 min). Même voyage, même descente : on
  // ne monte plus loin que pour partir plus tard sans marcher plus, ou marcher moins sans partir plus tôt (jamais une
  // minute de marche de plus pour une minute de départ : le calcul garde déjà les deux).
  {
    const f0 = rides[0];
    const rf = net.routes[f0.route];
    let leave = rf.dep[f0.trip * rf.n + f0.bpos] - accessWalk;
    for (let pos = f0.bpos + 1; pos < f0.apos; pos++) {
      const w = rf.board[pos] ? q.access.get(rf.stops[pos]) : undefined;
      if (w === undefined) continue;
      const d = rf.dep[f0.trip * rf.n + pos] - w;
      if (d >= leave && w <= accessWalk && (d > leave || w < accessWalk)) {
        rides[0] = { ...rides[0], bpos: pos };
        accessStop = rf.stops[pos];
        accessWalk = w;
        leave = d;
      }
    }
  }
  const waits: number[] = [];
  for (let i = 1; i < rides.length; i++) {
    const a = rides[i - 1];
    const ra = net.routes[a.route];
    const b = rides[i];
    const rb = net.routes[b.route];
    waits.push(rb.dep[b.trip * rb.n + b.bpos] - ra.arr[a.trip * ra.n + a.apos] - hops[i - 1].walk);
  }
  const first = rides[0];
  const r0 = net.routes[first.route];
  const last = rides[rides.length - 1];
  const rl = net.routes[last.route];
  return {
    rides,
    hops,
    accessStop,
    accessWalk,
    egressStop: J.L.stop,
    egressWalk: J.e,
    dep: r0.dep[first.trip * r0.n + first.bpos] - accessWalk,
    arr: rl.arr[last.trip * rl.n + last.apos] + J.e,
    waits,
    maxWait: waits.length ? Math.max(...waits) : 0,
  };
}

/** Identité d'un trajet trouvé (motifs, voyages, montées, descentes). */
export function candKey(c: Cand): string {
  return c.rides.map((r) => `${r.route}/${r.trip}/${r.bpos}-${r.apos}`).join('|');
}
