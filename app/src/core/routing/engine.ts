/**
 * route() : trajets porte à porte, « Le plus court » d'abord (PRD-1.2 § 1 ; PRD 1.1 § 4, M3, M5, M8 ;
 * design-routing.md § 4).
 *
 * 1. Extrémités : « Ma position » (sinon empty 'noPosition'), lieu, zone (0 min de marche), adresse (M5a).
 *    Arrivée à 300 m au plus : empty 'here' ; à maxWalkMin à pied ou moins : la marche seule.
 * 2. Vagues de fichiers (select.ts) : index, tuiles et tuiles de lignes ; lignes L_O et L_D et trains/ des jours
 *    utiles ; lignes du milieu. Recherche toujours élargie (PRD-1.2 § 1.2) : arrêts jusqu'à 15 min à pied, gares
 *    jusqu'à 25 min (ou la marche maximale plus 5 min) ; aucun arrêt : empty 'noStopFrom' / 'noStopTo', accessMin 15.
 * 3. Réseau (network.ts) et RAPTOR par rondes sur la plage de départs de l'heure demandée (raptor.ts), passes
 *    d'accès et de sortie : large (15 et 25 min), préférence tolérée (sans marche longue : la marche maximale plus
 *    4 min), préférence (la marche maximale), courte (5 min). Attente en
 *    correspondance de 60 min au plus ; jamais un véhicule plus lent que d'y aller à pied (jusqu'à 60 min de marche).
 *    Nuit : plage de 12 h, puis trains du lendemain, puis à partir de 04:00 du jour suivant.
 *    Premier véhicule en retard mais attrapable (PRD § 4.2, § 4.5) : la plage commence 30 min avant l'heure demandée,
 *    sur le même réseau ; un trajet parti à l'heure prévue n'est gardé que si le temps réel le rend attrapable.
 * 4. « Le suivant » : départs suivants de la même structure (mêmes lignes et sens, mêmes montées et descentes ;
 *    train : mêmes gares et même catégorie), jusqu'à 2 h après « Le plus court ».
 * 5. Classement sur les horaires prévus (rank.ts), temps réel sur les propositions, 3 réserves et les trajets au
 *    premier véhicule déjà parti à l'heure prévue (un appel par opérateur pour tous) ; véhicule supprimé : trajet
 *    retiré ; correspondance devenue impossible : reste du trajet recalculé (repair.ts) ; seuls les trajets encore
 *    attrapables sur l'heure estimée restent (départ du premier véhicule moins la marche, au plus tôt l'heure
 *    demandée) ; nouveau classement sur les heures estimées ; étiquettes et raisons (reason.ts). 3 propositions au
 *    plus, dans l'ordre d'affichage. Réseau et trajets proposés retenus pour refresh() (repair.ts).
 * 6. Rien : empty 'noTrip' et la gare SNCB la plus proche de l'arrivée (« Chercher vers {gare} »).
 * Sans fichiers de ligne (meta.lines absent, index d'une autre génération) : candidats du calcul 1.0 (plan.ts), même
 * classement.
 */
import type { LineFile, TrainsDay } from '../../../../shared/types';
import type { Endpoint, Journey, LatLon, Leg, PlanResult, Settings } from '../api';
import { headKey } from '../rtmerge';
import { brokenConnection, recompute, skeleton } from '../journeys';
import { resolveEndpoint, type PlanPoint } from '../plan';
import { distanceM, serviceDayBase, walkMinutes } from '../util';
import { candLegs, walkOnlyLegs, type EndPoint } from './legs';
import { accessMap, linePart, Net, trainPart, trainTripOf, type RRoute } from './network';
import { maxWalkOf, P, walkRadii, walkReachM } from './params';
import { earliestTrip, raptor, type Cand, type RideRef } from './raptor';
import { itemOf, rank, type RankItem } from './rank';
import { reasonText } from './reason';
import { recalcAlert, rememberNet, repairLegs, type NetRecipe } from './repair';
import { loadLines, middleLines, pickLines, soft, wave1, type RoutingSource } from './select';

const MIN = 60_000;
const HOUR = 60 * MIN;

export interface EngineEnv {
  source: RoutingSource;
  now: () => number;
  /** Temps réel (un appel par opérateur pour tous les trajets), heure de départ conseillée et alertes. */
  refresh(js: Journey[], fresh: boolean): Promise<Journey[]>;
  /** Repli 1.0 : étapes des trajets candidats (plan.ts). */
  legacy?(O: PlanPoint, D: PlanPoint, after: number, maxWalk: number): Promise<Leg[][]>;
  /** Réglages de calcul (tests, contrôle « réseau complet »). */
  tune?: Partial<Tune>;
}

export interface Tune {
  middleK: number;
  urbanUrbanMax: number;
  /** Toutes les lignes de l'index (contrôle « réseau complet » sur les vraies données). */
  allLines: boolean;
}

/** Résultat détaillé (tests et outils) : candidats bruts du calcul et réseau. */
export interface RouteDebug {
  cands: Journey[];
  raw: { k: number; arr: number; pass: number; dep: number; wait: number }[];
  net?: { stops: number; routes: number; lines: number; lo: number; ld: number; middle: number };
  files: number;
  computeMs: number;
  mode: 'lines' | 'legacy' | 'walk' | 'empty';
  tomorrow?: boolean;
}

type Item = RankItem & { j: Journey };

/** Réseau complet (contrôle « réseau complet », tune.allLines) gardé d'une recherche à l'autre. */
const fullNets = new Map<string, Net>();

/** Jours de service dont les voyages peuvent servir à une recherche à `after` (veille après minuit, soir : lendemain). */
export function usefulDates(dates: readonly string[], after: number): string[] {
  return dates.filter((d) => {
    const base = serviceDayBase(d);
    return base - 4 * HOUR <= after && after <= base + 30 * HOUR;
  });
}

function endName(p: PlanPoint): EndPoint {
  return { name: p.name, lat: p.lat, lon: p.lon, ...(p.areaId ? { areaId: p.areaId } : {}) };
}

/** Catégorie d'un voyage de train (« Le suivant » d'un train : même catégorie). */
function tripCat(r: RRoute, trip: number): string {
  const t = trainTripOf(r, trip);
  return t ? t.day.file.trips[t.ti].cat : r.line;
}

/**
 * Départs suivants de la même structure qu'un trajet trouvé (au plus `count`, départ jusqu'à `until`) : pour chaque
 * véhicule, tout motif qui dessert la même montée puis la même descente, de la même ligne et du même sens (urbain)
 * ou de la même catégorie (train).
 */
export function nextOfStructure(net: Net, c: Cand, count: number, until: number): Cand[] {
  const specs = c.rides.map((ride) => {
    const r = net.routes[ride.route];
    const X = r.stops[ride.bpos];
    const Y = r.stops[ride.apos];
    const cat = r.urban ? '' : tripCat(r, ride.trip);
    const hk = headKey(r.head.fr);
    const opts: { ri: number; bpos: number; apos: number }[] = [];
    const ras = net.routesAt[X];
    for (let j = 0; j < ras.length; j++) {
      const ri = ras[j];
      const bpos = net.posAt[X][j];
      const r2 = net.routes[ri];
      if (!r2.board[bpos] || r2.urban !== r.urban) continue;
      if (r.urban && (r2.op !== r.op || r2.line !== r.line || headKey(r2.head.fr) !== hk)) continue;
      let apos = -1;
      for (let p = bpos + 1; p < r2.n; p++)
        if (r2.stops[p] === Y && r2.alight[p]) {
          apos = p;
          break;
        }
      if (apos > 0) opts.push({ ri, bpos, apos });
    }
    return { opts, cat, station: net.station[X] === 1 };
  });
  const pick = (k: number, t: number): RideRef | null => {
    let best: RideRef | null = null;
    let bestDep = Infinity;
    for (const o of specs[k].opts) {
      const r = net.routes[o.ri];
      let trip = earliestTrip(r, o.bpos, t);
      while (trip >= 0 && trip < r.nTrips) {
        const d = r.dep[trip * r.n + o.bpos];
        if (d >= bestDep) break;
        if (d >= t && (r.urban || tripCat(r, trip) === specs[k].cat)) {
          best = { route: o.ri, trip, bpos: o.bpos, apos: o.apos };
          bestDep = d;
          break;
        }
        trip = r.fifo ? trip + 1 : -1;
      }
    }
    return best;
  };
  const out: Cand[] = [];
  let cur = c;
  for (let n = 0; n < count; n++) {
    const r0 = net.routes[cur.rides[0].route];
    const firstDep = r0.dep[cur.rides[0].trip * r0.n + cur.rides[0].bpos];
    const rides: RideRef[] = [];
    const waits: number[] = [];
    let ok = true;
    for (let k = 0; k < c.rides.length && ok; k++) {
      let t = firstDep + 1;
      if (k > 0) {
        const prev = rides[k - 1];
        const rp = net.routes[prev.route];
        const arr = rp.arr[prev.trip * rp.n + prev.apos];
        const hop = c.hops[k - 1];
        const station = specs[k].station;
        t = arr + (hop.walk > 0 ? hop.walk + (station ? P.footBufStation : P.footBufUrban) : station ? P.mctStation : P.mctUrban);
      }
      const r = pick(k, t);
      if (!r) {
        ok = false;
        break;
      }
      if (k > 0) {
        const prev = rides[k - 1];
        const rp = net.routes[prev.route];
        const rr = net.routes[r.route];
        const w = rr.dep[r.trip * rr.n + r.bpos] - rp.arr[prev.trip * rp.n + prev.apos] - c.hops[k - 1].walk;
        if (w > P.maxWaitMin) ok = false;
        waits.push(w);
      }
      rides.push(r);
    }
    if (!ok) break;
    const f = net.routes[rides[0].route];
    const l = net.routes[rides[rides.length - 1].route];
    const last = rides[rides.length - 1];
    const next: Cand = {
      ...c,
      rides,
      waits,
      maxWait: waits.length ? Math.max(...waits) : 0,
      dep: f.dep[rides[0].trip * f.n + rides[0].bpos] - c.accessWalk,
      arr: l.arr[last.trip * l.n + last.apos] + c.egressWalk,
    };
    if (next.dep > until) break;
    out.push(next);
    cur = next;
  }
  return out;
}

/** Trajets étiquetés, dans l'ordre d'affichage, avec leur raison. */
function labeled(ranked: { item: Item; label: Journey['label']; ref?: Item }[]): Journey[] {
  return ranked.map(({ item, label, ref }) => ({ ...item.j, label, reason: reasonText(label ?? 'short', item.j, ref?.j) }));
}

/**
 * Calcul complet (voir l'en-tête). `debug` reçoit les candidats et des mesures (tests, données réelles).
 */
export async function computeRoute(
  from: Endpoint,
  to: Endpoint,
  after: number,
  settings: Settings,
  here: LatLon | null | undefined,
  env: EngineEnv,
  debug?: RouteDebug,
): Promise<PlanResult> {
  const t0 = performance.now();
  if ((from.type === 'here' || to.type === 'here') && (!here || !Number.isFinite(here.lat) || !Number.isFinite(here.lon))) {
    return { journeys: [], empty: 'noPosition' };
  }
  const O = resolveEndpoint(from, settings, here);
  const D = resolveEndpoint(to, settings, here);
  const maxWalk = maxWalkOf(settings);
  const dist = distanceM(O, D);
  if (dist <= P.hereM || (O.areaId && O.areaId === D.areaId)) {
    if (debug) debug.mode = 'empty';
    return { journeys: [], empty: 'here' };
  }
  const directWalk = walkMinutes(dist);
  const now = env.now();
  const recomputed = (legs: Leg[]) => recompute(skeleton(legs), legs, settings, now, true);
  const walkJourney = () => recomputed(walkOnlyLegs(endName(O), endName(D), directWalk, after));

  if (directWalk <= maxWalk) {
    if (debug) debug.mode = 'walk';
    const [j] = await env.refresh([walkJourney()], true);
    return { journeys: labeled([{ item: itemOf(j), label: 'short' }]) };
  }

  const src = env.source;
  const meta = src.meta;
  const tune: Tune = { middleK: P.middleK, urbanUrbanMax: P.urbanUrbanMax, allLines: false, ...env.tune };
  const R = walkRadii(maxWalk);
  const w1 = await wave1(src, O, D, R, !!meta.lines);
  // aucun arrêt connu autour (tuiles ; tuiles de lignes, qui comptent aussi les arrêts d'arrivée seule)
  const accessMin = R.urban;
  if (!O.areaId && !w1.nearO.length && !w1.ltO.size) return { journeys: [], empty: 'noStopFrom', accessMin };
  if (!D.areaId && !w1.nearD.length && !w1.ltD.size) return { journeys: [], empty: 'noStopTo', accessMin };

  const dates = meta.serviceDates;
  const base0 = serviceDayBase(dates[0]);
  const dayOff = dates.map((d) => Math.round((serviceDayBase(d) - base0) / MIN));
  const trainsCache = new Map<string, Promise<TrainsDay | null>>();
  const trainsOf = (list: readonly string[]) =>
    Promise.all(
      list.map((d) => {
        let p = trainsCache.get(d);
        if (!p) trainsCache.set(d, (p = soft(src.trains(d))));
        return p;
      }),
    ).then((files) => files.filter((f): f is TrainsDay => f !== null));

  let journeys: Journey[] = [];
  /** Trajets dont le premier véhicule est parti à l'heure prévue (au plus 30 min avant) : temps réel, puis tri. */
  const late: Journey[] = [];
  let net: Net | null = null;
  let recipe: NetRecipe | null = null;
  let fileCount = 0;
  const index = w1.index && (!w1.index.generatedAt || w1.index.generatedAt === meta.generatedAt) ? w1.index : null;

  if (index) {
    // ---------- calcul 1.1 sur les fichiers de ligne ----------
    const rUrban = walkReachM(R.urban);
    const LO = tune.allLines ? [] : pickLines(w1.nearO, w1.ltO, rUrban);
    const LD = tune.allLines ? [] : pickLines(w1.nearD, w1.ltD, rUrban);
    let wanted = usefulDates(dates, after);
    if (!wanted.length) wanted = dates.slice(0, 1);
    const first = tune.allLines ? index.lines.map((_, i) => i) : [...new Set([...LO, ...LD])];
    const [files, trains] = await Promise.all([loadLines(src, index, first), trainsOf(wanted)]);
    const requestDay = trains.find((f) => serviceDayBase(f.date) <= after && after < serviceDayBase(f.date) + 24 * HOUR) ?? trains[0] ?? null;
    const middle = tune.allLines
      ? []
      : middleLines({ index, O, D, radii: R, nearO: w1.nearO, nearD: w1.nearD, LO, LD, files, day: requestDay, K: tune.middleK, urbanUrbanMax: tune.urbanUrbanMax });
    const mfiles = middle.length ? await loadLines(src, index, middle) : new Map<number, LineFile>();
    const lineFiles = [...files.values(), ...mfiles.values()];
    fileCount = lineFiles.length;

    const build = (tr: TrainsDay[]): Net => {
      const key = `${meta.generatedAt}|${tr.map((f) => f.date).join(',')}`;
      const full = tune.allLines ? fullNets.get(key) : undefined;
      if (full) return full;
      const n = new Net(base0, tr.length ? trainPart(tr, base0) : null);
      for (const f of lineFiles) n.addLine(linePart(f, base0, dayOff));
      n.finish();
      if (tune.allLines) {
        fullNets.clear();
        fullNets.set(key, n);
      }
      return n;
    };
    let trainFiles = trains;
    net = build(trainFiles);
    // aucun arrêt dans la recherche élargie, ni dans les tuiles ni dans le réseau chargé
    if (!O.areaId && !w1.nearO.length && !accessMap(net, O, R.urban, R.station).size) return { journeys: [], empty: 'noStopFrom', accessMin };
    if (!D.areaId && !w1.nearD.length && !accessMap(net, D, R.urban, R.station).size) return { journeys: [], empty: 'noStopTo', accessMin };
    const afterMin = (after - base0) / MIN;
    // passes d'accès et de sortie (PRD-1.2 § 1.2) : large, préférence, courte ; plus la préférence tolérée (toute
    // marche qui n'est pas longue) : un trajet sans marche longue que la passe large cache derrière un trajet avec
    // marche longue (parti plus tard, arrivé plus tôt) reste candidat
    const passes: [number, number][] = [[R.urban, R.station]];
    for (const m of [R.long - 1, R.pref, R.short]) if (m < Math.min(R.urban, passes[passes.length - 1][0])) passes.push([m, m]);
    const run = (n: Net, from: number, windowMin: number): Cand[] => {
      const out: Cand[] = [];
      passes.forEach(([lu, ls], pass) => {
        const acc = accessMap(n, O, lu, ls);
        const egr = accessMap(n, D, lu, ls);
        if (!acc.size || !egr.size) return;
        for (const c of raptor(n, { access: acc, egress: egr, after: from, windowMin, urbanUrbanMax: tune.urbanUrbanMax })) {
          out.push(c);
          // départs d'avant l'heure demandée : hors des mesures (comparaison au réseau complet)
          if (c.dep >= afterMin) debug?.raw.push({ k: c.rides.length, arr: c.arr, dep: c.dep, pass, wait: c.maxWait });
        }
      });
      return out;
    };
    // garde-fous : attente de 60 min au plus ; jamais plus lent que d'y aller à pied maintenant (marche ≤ 60 min)
    const usable = (list: Cand[]) =>
      list.filter((c) => c.maxWait <= P.maxWaitMin && (directWalk > P.walkRefMaxMin || c.arr <= afterMin + directWalk));
    // plage élargie vers le passé pour le premier véhicule (même réseau, aucun fichier de plus) : un départ prévu
    // avant l'heure demandée ne reste que s'il est en retard et encore attrapable (temps réel, plus bas)
    const range = usable(run(net, afterMin - P.lateLookbackMin, P.windowMin + P.lateLookbackMin));
    let cands = range.filter((c) => c.dep >= afterMin);
    const n1 = net;
    const lateById = new Map<string, Journey>();
    for (const c of range.filter((x) => x.dep < afterMin).sort((a, b) => b.dep - a.dep)) {
      if (lateById.size >= P.lateMax) break;
      const legs = candLegs(n1, c, endName(O), endName(D));
      if (!legs) continue;
      const j = recomputed(legs);
      if (!lateById.has(j.id)) lateById.set(j.id, j);
    }
    late.push(...lateById.values());
    if (!cands.length) cands = usable(run(net, afterMin, P.nightWindowMin));
    if (!cands.length && trainFiles.length < dates.length) {
      // rien ce soir : trains de tous les jours couverts
      trainFiles = await trainsOf(dates);
      net = build(trainFiles);
      cands = usable(run(net, afterMin, P.nightWindowMin));
    }
    if (!cands.length) {
      // à partir de 04:00 du jour de service suivant couvert
      const next = dayOff.map((o) => o + P.nextDayFromMin).find((t) => t > afterMin + 60);
      if (next !== undefined) {
        cands = usable(run(net, next, P.windowMin));
        if (debug && cands.length) debug.tomorrow = true;
      }
    }
    if (debug) debug.net = { stops: net.size, routes: net.routes.length, lines: lineFiles.length, lo: LO.length, ld: LD.length, middle: mfiles.size };

    const n0 = net;
    const byKey = new Map<string, { c: Cand; j: Journey }>();
    const addCand = (c: Cand) => {
      const legs = candLegs(n0, c, endName(O), endName(D));
      if (!legs) return;
      const j = recomputed(legs);
      const cur = byKey.get(j.id);
      if (!cur || c.dep > cur.c.dep) byKey.set(j.id, { c, j });
    };
    for (const c of cands) addCand(c);
    if (directWalk <= P.walkOnlyMaxMin) journeys.push(walkJourney());
    // « Le suivant » : départs suivants de la structure du plus court
    const first0 = rank(
      [...byKey.values()].map((x) => itemOf(x.j)),
      after / MIN,
      maxWalk,
    )[0];
    const shortCand = first0 ? [...byKey.values()].find((x) => x.j === first0.item.j)?.c : undefined;
    if (shortCand) {
      const until = Math.max(afterMin, shortCand.dep) + P.laterMaxMin;
      // départs suivants dans les 2 h (au plus 8) : le classement retire ceux qu'un départ plus tardif domine
      for (const c of nextOfStructure(net, shortCand, 8, until)) addCand(c);
    }
    journeys.push(...[...byKey.values()].map((x) => x.j));
    if (!tune.allLines) recipe = { gen: meta.generatedAt, lines: lineFiles.map((f) => f.id), days: trainFiles.map((f) => f.date) };
  } else if (env.legacy) {
    // ---------- repli 1.0 ----------
    const legs = await env.legacy(O, D, after, maxWalk);
    for (const l of legs) {
      const j = recomputed(l.map((x) => ({ ...x, from: { ...x.from }, to: { ...x.to } })));
      const it = itemOf(j);
      if (it.maxWait > P.maxWaitMin) continue;
      if (directWalk <= P.walkRefMaxMin && it.arr > after / MIN + directWalk) continue;
      journeys.push(j);
    }
    if (directWalk <= P.walkOnlyMaxMin) journeys.push(walkJourney());
    if (debug) debug.mode = 'legacy';
  }
  // aucun véhicule utile : la marche seule, jusqu'à 60 min (règle 1.0)
  if (!journeys.length && directWalk <= P.walkRefMaxMin) journeys.push(walkJourney());
  if (debug) {
    debug.cands = journeys;
    debug.files = fileCount;
    if (debug.mode !== 'legacy') debug.mode = index ? 'lines' : 'legacy';
  }

  // classement sur les horaires prévus, temps réel sur les propositions, les réserves et les trajets au premier
  // véhicule déjà parti à l'heure prévue (un appel par opérateur pour tous), nouveau classement sur les heures estimées
  const first = rank(journeys.map(itemOf), after / MIN, maxWalk, P.proposals + P.reserves);
  if (!first.length && !late.length) {
    if (debug) debug.computeMs = performance.now() - t0;
    return noTrip(O, D, net, w1.nearD);
  }
  const live = await env.refresh([...first.map((r) => r.item.j), ...late], true);
  const lateIds = new Set(late.map((j) => j.id));
  const cancelled = (j: Journey) => j.legs.some((l) => l.kind === 'ride' && l.cancelled);
  // encore attrapable sur l'heure estimée : départ du premier véhicule moins la marche, au plus tôt l'heure demandée ;
  // départ prévu avant l'heure demandée : jamais plus lent que d'y aller à pied, sur l'heure estimée
  const catchable = (j: Journey, wasLate: boolean) =>
    itemOf(j).dep >= after / MIN && !(wasLate && directWalk <= P.walkRefMaxMin && j.arr > after + directWalk * MIN);
  const kept = live.filter((j) => !cancelled(j) && brokenConnection(j) < 0 && catchable(j, lateIds.has(j.id)));
  // correspondance rendue impossible par un retard : reste du trajet recalculé sur le réseau en mémoire
  if (net) {
    const repaired: { j: Journey; wasLate: boolean }[] = [];
    for (const j of live) {
      if (cancelled(j) || brokenConnection(j) < 0) continue;
      const legs = repairLegs(j, net, endName(D), maxWalk);
      if (legs) repaired.push({ j: recomputed(legs), wasLate: lateIds.has(j.id) });
    }
    if (repaired.length) {
      const fixed = await env.refresh(
        repaired.map((x) => x.j),
        true,
      );
      fixed.forEach((j, i) => {
        if (cancelled(j) || brokenConnection(j) >= 0 || !catchable(j, repaired[i].wasLate) || kept.some((k) => k.id === j.id)) return;
        kept.push({ ...j, alerts: [recalcAlert(env.now()), ...j.alerts] });
      });
    }
  }
  const final = rank(kept.map(itemOf), after / MIN, maxWalk, P.proposals);
  if (debug) debug.computeMs = performance.now() - t0;
  if (!final.length) return noTrip(O, D, net, w1.nearD);
  const out = labeled(final);
  if (net && recipe) rememberNet(recipe, net, out.map((j) => j.id));
  return { journeys: out };
}

/** Aucun trajet : la gare SNCB la plus proche de l'arrivée (15 km au plus), sauf si l'arrivée est une gare. */
function noTrip(O: PlanPoint, D: PlanPoint, net: Net | null, nearD: { a: { id: string; op: string; n: { fr: string; nl: string }; lat: number; lon: number }; d: number }[]): PlanResult {
  if (D.op === 'sncb') return { journeys: [], empty: 'noTrip' };
  let best: { areaId: string; name: { fr: string; nl: string }; lat: number; lon: number; d: number } | null = null;
  const consider = (areaId: string, name: { fr: string; nl: string }, lat: number, lon: number) => {
    if (areaId === O.areaId) return;
    const d = distanceM(D, { lat, lon });
    if (d <= 15_000 && (!best || d < best.d)) best = { areaId, name, lat, lon, d };
  };
  if (net) for (let i = 0; i < net.size; i++) if (net.station[i]) consider(net.ids[i], net.names[i], net.lat[i], net.lon[i]);
  for (const z of nearD) if (z.a.op === 'sncb') consider(z.a.id, z.a.n, z.a.lat, z.a.lon);
  if (!best) return { journeys: [], empty: 'noTrip' };
  const b = best as { areaId: string; name: { fr: string; nl: string }; lat: number; lon: number };
  return { journeys: [], empty: 'noTrip', station: { areaId: b.areaId, name: b.name, lat: b.lat, lon: b.lon } };
}
