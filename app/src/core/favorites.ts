/**
 * Favoris « réponse directe » (PRD M1), communs au vrai cœur et au faux cœur de développement :
 *  - orderFavorites : ordre intelligent (M1.4), immédiat, sans calcul de trajet ;
 *  - answerFavorite : réponse d'un favori (M1.5) : trajet (route() depuis la position, ou depuis la gare de départ
 *    avec la marche jusqu'à elle si elle tient dans la marche maximale, sinon heures du train) ; arrêt (départs
 *    filtrés, zone retrouvée par `aka`, puis par opérateur, nom et position à moins de 150 m, sinon « introuvable »).
 *  - plan d'un trajet favori mémorisé (AnswerEnv.plans) : même favori, mêmes réglages utiles, position à moins de
 *    100 m, même génération de données, première proposition encore attrapable → temps réel seul (refresh) ; calcul
 *    complet au plus toutes les 5 min, ou dès que la première proposition ne tient plus.
 *
 * État d'une réponse : ok (réponse prête, même lointaine : « partir demain 06:20 ») ; here (« tu y es ») ; none
 * (aucun trajet ni départ trouvé) ; noPosition ; missing. « Rien dans les 3 heures » (règle 5 de l'ordre) se lit
 * sur l'heure de la réponse (answerTime), pas sur l'état.
 */
import { normalizeForSearch } from '../../../shared/names';
import type {
  AreaSummary,
  Board,
  Endpoint,
  Favorite,
  FavoriteAnswer,
  FavoritePlace,
  FavoriteRank,
  FavoriteStop,
  FavoriteTrip,
  Journey,
  JourneyLabel,
  LatLon,
  Leg,
  LineFilter,
  PlanResult,
  Settings,
} from './api';
import { QuaiError } from './errors';
import { reasonText } from './routing/reason';
import { slotOf, tripLabel } from './suggest';
import { placeTitle, shortAddress, vers } from './text';
import { displayName, distanceM, placeOf, placesOf, walkMinutes } from './util';

/** Règle 1 (tout près) et « tu y es ». */
export const NEAR_M = 300;
/** Règle 3 : arrêts et départs fixes utilisables d'ici. */
export const USABLE_M = 1000;
/** Règle 5 : rien dans les 3 heures. */
export const HORIZON_MS = 3 * 3_600_000;
/** Zone retrouvée par opérateur, nom et position (M8.3). */
export const MOVED_M = 150;
/** En deçà, on est déjà à la gare de départ : pas d'étape de marche. */
export const AT_STATION_M = 100;

const HERE_NAMES = { fr: 'Ma position', nl: 'Mijn positie' };

/** 1.2 : placesOf (lieux dans l'ordre) et placeOf (lieu d'un Endpoint « place ») viennent de util.ts. */
export { placeOf, placesOf };

/** 1.2 : un lieu se comporte comme le trajet « Ma position → lieu » de la 1.1 (même identifiant, même créneau). */
export function asTrip(f: FavoriteTrip | FavoritePlace): FavoriteTrip {
  return f.kind === 'trip' ? f : { kind: 'trip', id: f.id, from: { type: 'here' }, to: { type: 'place', placeId: f.id }, propose: f.propose };
}

/** Position d'une extrémité fixe (zone, lieu, adresse) ; null pour « Ma position » ou un lieu disparu. */
export function endpointPoint(e: Endpoint, settings: Settings): LatLon | null {
  if (e.type === 'area' || e.type === 'address') return { lat: e.lat, lon: e.lon };
  if (e.type === 'place') {
    const p = placeOf(settings, e.placeId);
    return p ? { lat: p.lat, lon: p.lon } : null;
  }
  return null;
}

/**
 * Titre d'un trajet favori, d'un lieu ou d'une destination : « Vers le bureau », « Vers la maison »,
 * « Vers l’école », « Vers Gand-Saint-Pierre », « Vers Veldstraat 1 » (PRD-1.2 § 2.1).
 */
export function favoriteTitle(x: FavoriteTrip | FavoritePlace | Endpoint, settings: Settings): string {
  if ('kind' in x) return x.kind === 'place' ? placeTitle(x.label) : vers(tripLabel(x, settings));
  if (x.type === 'place') {
    const p = placeOf(settings, x.placeId);
    return p ? placeTitle(p.label) : vers('');
  }
  if (x.type === 'area') return vers(displayName(x.name, settings.lang));
  if (x.type === 'address') return vers(shortAddress(x.label));
  return vers('ma position');
}

/** Heure qui compte dans une réponse : départ conseillé du trajet 1, ou premier départ de l'arrêt (non supprimé). */
export function answerTime(a: FavoriteAnswer): number | undefined {
  if (a.kind === 'trip') {
    const j = a.plan?.journeys[0];
    if (!j) return undefined;
    if (a.fromStation) return j.legs.find((l) => l.kind === 'ride')?.dep ?? j.dep;
    return j.leaveAt;
  }
  return a.board?.departures.find((d) => !d.cancelled)?.est;
}

/** Vrai si la réponse met le favori en fin de liste (règle 5) : « tu y es », rien, ou rien dans les 3 heures. */
export function isLastAnswer(a: FavoriteAnswer | undefined, now: number): boolean {
  if (!a) return false;
  if (a.state === 'here' || a.state === 'none') return true;
  if (a.state !== 'ok') return false;
  const t = answerTime(a);
  return t === undefined || t > now + HORIZON_MS;
}

/**
 * Ordre intelligent (PRD M1.4) :
 *  1. tout près : arrêt, ou trajet à départ fixe, à 300 m au plus (du plus proche au plus loin) ;
 *  2. créneau du moment (« Le matin » 5 h-11 h, « Le soir » 15 h-21 h) ;
 *  3. utilisable d'ici : trajets depuis « Ma position », puis arrêts et départs fixes à 1 km au plus ;
 *  4. le reste ;
 *  5. en fin de liste : « tu y es » (destination à 300 m au plus) ou rien dans les 3 heures (`last`).
 * À égalité : l'ordre du téléphone. « Dans mon ordre » : l'ordre du téléphone, sauf la règle 5. Sans position,
 * seules les règles 2, 4 et 5 s'appliquent.
 */
export function orderFavorites(here: LatLon | null, settings: Settings, now: number, last?: ReadonlyMap<string, FavoriteAnswer>): FavoriteRank[] {
  const slot = slotOf(now);
  const mine = settings.display.favOrder === 'mine';
  const items = settings.favorites.map((f, i) => {
    // un lieu : le trajet « Ma position → lieu » (aucun départ fixe)
    const fixed = f.kind === 'stop' ? { lat: f.lat, lon: f.lon } : f.kind === 'trip' ? endpointPoint(f.from, settings) : null;
    const d = here && fixed ? distanceM(here, fixed) : undefined;
    const dest = f.kind === 'place' ? { lat: f.lat, lon: f.lon } : f.kind === 'trip' && f.to.type !== 'here' ? endpointPoint(f.to, settings) : null;
    const atDest = !!here && !!dest && distanceM(here, dest) <= NEAR_M;
    let rule: FavoriteRank['rule'] = 4;
    let sub = 0;
    if (atDest || isLastAnswer(last?.get(f.id), now)) rule = 5;
    else if (mine) rule = 4;
    else if (d !== undefined && d <= NEAR_M) rule = 1;
    else if (slot && f.propose === slot) rule = 2;
    else if (here && (f.kind === 'place' || (f.kind === 'trip' && f.from.type === 'here'))) rule = 3;
    else if (d !== undefined && d <= USABLE_M) {
      rule = 3;
      sub = 1;
    }
    return { f, i, rule, sub, d };
  });
  items.sort((a, b) => a.rule - b.rule || a.sub - b.sub || (a.rule === 1 ? (a.d ?? 0) - (b.d ?? 0) : 0) || a.i - b.i);
  return items.map((x) => {
    const r: FavoriteRank = { favoriteId: x.f.id, rule: x.rule };
    if (x.d !== undefined) r.distanceM = Math.round(x.d);
    return r;
  });
}

/** Ce dont la réponse d'un favori a besoin (vrai cœur ou faux cœur). */
export interface AnswerEnv {
  now(): number;
  board(areaId: string, opts: { limit?: number; filter?: LineFilter[] }): Promise<Board>;
  route(from: Endpoint, to: Endpoint, after: number, settings: Settings, here?: LatLon | null): Promise<PlanResult>;
  /** Zone qui remplace une zone disparue (par `aka`, puis opérateur + nom + 150 m) ; null si aucune. */
  relocate(fav: FavoriteStop): Promise<AreaSummary | null>;
  /** Temps réel seul sur des propositions déjà calculées (sans nouveau calcul) ; sans lui, pas de plan mémorisé. */
  refresh?(journeys: Journey[], settings: Settings): Promise<Journey[]>;
  /** Génération des données (meta.generatedAt, relue au besoin) : un plan d'une autre génération est recalculé. */
  generation?(): Promise<string | undefined>;
  /** Plans mémorisés des trajets favoris (un jeu par cœur). */
  plans?: Map<string, PlanMemo>;
}

/** Plan mémorisé d'un trajet favori. */
export interface PlanMemo {
  key: string;
  gen: string | undefined;
  /** Heure du dernier calcul complet. */
  at: number;
  here: LatLon | null;
  answer: FavoriteAnswer;
}

const unknownArea = (e: unknown) => e instanceof QuaiError && e.code === 'areaUnknown';

/** Zone retrouvée parmi des candidates : `aka` d'abord, puis même opérateur, même nom, à moins de 150 m. */
export function relocateAmong(fav: Pick<FavoriteStop, 'areaId' | 'op' | 'name' | 'lat' | 'lon'>, areas: readonly AreaSummary[]): AreaSummary | null {
  const byAka = areas.find((a) => a.aka?.includes(fav.areaId));
  if (byAka) return byAka;
  const keys = new Set([normalizeForSearch(fav.name.fr), normalizeForSearch(fav.name.nl)].filter(Boolean));
  let best: AreaSummary | null = null;
  let bestD = Infinity;
  for (const a of areas) {
    if (a.op !== fav.op || a.id === fav.areaId) continue;
    if (!keys.has(normalizeForSearch(a.n.fr)) && !keys.has(normalizeForSearch(a.n.nl))) continue;
    const d = distanceM(fav, a);
    if (d < MOVED_M && d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

async function stopAnswer(fav: FavoriteStop, settings: Settings, env: AnswerEnv): Promise<FavoriteAnswer> {
  const t = env.now();
  const opts = { limit: settings.display.depsPerStop, filter: fav.filter };
  let board: Board;
  let movedTo: AreaSummary | undefined;
  try {
    board = await env.board(fav.areaId, opts);
    if (board.area.id !== fav.areaId) movedTo = board.area;
  } catch (e) {
    if (!unknownArea(e)) throw e;
    const found = await env.relocate(fav).catch(() => null);
    if (!found) return { favoriteId: fav.id, kind: 'stop', state: 'missing', updatedAt: t };
    movedTo = found;
    board = await env.board(found.id, opts);
  }
  const out: FavoriteAnswer = { favoriteId: fav.id, kind: 'stop', state: board.departures.length ? 'ok' : 'none', board, updatedAt: t };
  if (movedTo) out.movedTo = movedTo;
  return out;
}

const isRide = (l: Leg) => l.kind === 'ride';
/** Une proposition reste attrapable jusqu'à 30 s après l'heure où il fallait partir. */
const CATCH_SLACK_MS = 30_000;
/** Calcul complet d'un trajet favori au plus toutes les 5 min (temps réel seul entre deux). */
export const REPLAN_MS = 5 * 60_000;
/** Position déplacée de 100 m ou plus : nouveau calcul. */
export const REPLAN_MOVE_M = 100;
const PLANS_MAX = 50;

/** Proposition de référence d'une raison : pour « Le suivant », la précédente de même structure. */
function refFor(label: JourneyLabel | undefined, list: readonly Journey[], i: number): Journey | undefined {
  if (label !== 'next') return undefined;
  for (let k = i - 1; k >= 0; k--) if (list[k].label === 'next' || list[k].label === 'short') return list[k];
  return list[0];
}

const herePoint = (here: LatLon): Leg['from'] => ({ name: HERE_NAMES, lat: here.lat, lon: here.lon });

/**
 * Propositions calculées depuis la gare de départ, vues de la position : toutes les marches avant le premier
 * véhicule deviennent une seule marche position → arrêt de montée (marge comprise ; aucune à moins de 100 m) ; une
 * proposition entièrement à pied devient la marche position → destination, à partir de maintenant. Les propositions
 * qu'on ne peut plus attraper sont écartées. Identifiants gardés (mémoire du réseau pour le recalcul d'une
 * correspondance), raisons recalculées.
 */
export function withAccessWalk(plan: PlanResult, here: LatLon, settings: Settings, now: number): PlanResult {
  const margin = Math.max(0, settings.alerts.leaveBeforeMin) * 60_000;
  const journeys: Journey[] = [];
  for (const j of plan.journeys) {
    const i = j.legs.findIndex(isRide);
    if (i < 0) {
      const end = j.legs[j.legs.length - 1]?.to;
      if (!end) continue;
      const walkMin = walkMinutes(distanceM(here, end));
      const arr = now + walkMin * 60_000;
      const walk: Leg = { kind: 'walk', from: herePoint(here), to: { ...end }, dep: now, arr, schedDep: now, schedArr: arr, walkMin };
      journeys.push({ ...j, legs: [walk], dep: now, arr, leaveAt: now, transfers: 0 });
      continue;
    }
    const ride = j.legs[i];
    const d = distanceM(here, ride.from);
    const walkMin = d < AT_STATION_M ? 0 : walkMinutes(d);
    const w = walkMin * 60_000;
    if (ride.dep - w < now - CATCH_SLACK_MS) continue;
    const leave = ride.dep - w - margin;
    const legs = j.legs.slice(i);
    if (walkMin > 0) {
      const schedLeave = ride.schedDep - w - margin;
      legs.unshift({ kind: 'walk', from: herePoint(here), to: { ...ride.from }, dep: leave, arr: leave + w, schedDep: schedLeave, schedArr: schedLeave + w, walkMin });
    }
    journeys.push({ ...j, legs, dep: legs[0].dep, leaveAt: leave });
  }
  journeys.forEach((j, i) => {
    if (j.label) j.reason = reasonText(j.label, j, refFor(j.label, journeys, i));
  });
  const out: PlanResult = { ...plan, journeys };
  if (!journeys.length && !out.empty) out.empty = 'noTrip';
  if (journeys.length) delete out.empty;
  return out;
}

/** Ce qui change le calcul d'un trajet favori : extrémités (position des lieux comprise), marche maximale, marge. */
function planKey(fav: FavoriteTrip, settings: Settings): string {
  return JSON.stringify([fav.from, fav.to, endpointPoint(fav.from, settings), endpointPoint(fav.to, settings), settings.maxWalkMin, settings.alerts.leaveBeforeMin]);
}

/** Proposition encore bonne : rien de supprimé, correspondances tenables, premier véhicule pas encore
 *  parti (marche jusqu'à lui comprise, 30 s de grâce). */
function stillGood(j: Journey, now: number): boolean {
  let prev: Leg | undefined;
  let walk = 0;
  for (const l of j.legs) {
    if (l.kind === 'walk') {
      walk += (l.walkMin ?? 0) * 60_000;
      continue;
    }
    if (l.cancelled) return false;
    if (prev ? l.dep < prev.arr + walk : l.dep - walk < now - CATCH_SLACK_MS) return false;
    prev = l;
    walk = 0;
  }
  return true;
}

/** Proposition entièrement à pied : elle part maintenant. */
function startNow(j: Journey, now: number): Journey {
  if (j.legs.some(isRide) || j.dep === now) return j;
  const s = now - j.dep;
  const legs = j.legs.map((l) => ({ ...l, dep: l.dep + s, arr: l.arr + s, schedDep: l.schedDep + s, schedArr: l.schedArr + s }));
  return { ...j, legs, dep: now, arr: j.arr + s, leaveAt: now };
}

const generationOf = (env: AnswerEnv): Promise<string | undefined> => (env.generation ? env.generation().catch(() => undefined) : Promise.resolve(undefined));

const samePlace = (a: LatLon | null, b: LatLon | null) => (a && b ? distanceM(a, b) < REPLAN_MOVE_M : a === b);

/** Plan mémorisé encore bon : temps réel seul, aucun calcul de trajet ; null s'il faut recalculer. */
async function reuse(m: PlanMemo, settings: Settings, env: AnswerEnv, now: number): Promise<FavoriteAnswer | null> {
  const a = m.answer;
  if (a.state === 'none') return { ...a, updatedAt: now };
  if (a.state !== 'ok' || !a.plan?.journeys.length || !env.refresh) return null;
  const journeys = await env.refresh(a.plan.journeys.map((j) => startNow(j, now)), settings);
  // Toutes les propositions affichées doivent rester bonnes : une 2e ou 3e proposition supprimée, partie ou dont la
  // correspondance ne tient plus impose un calcul complet (sinon elle resterait affichée).
  if (!journeys.length || !journeys.every((j) => stillGood(j, now))) return null;
  return { ...a, plan: { ...a.plan, journeys }, updatedAt: now };
}

/** Calcul complet d'un trajet favori. */
async function computeTrip(fav: FavoriteTrip, here: LatLon | null, settings: Settings, env: AnswerEnv, t: number): Promise<FavoriteAnswer> {
  let plan: PlanResult;
  let fromStation = false;
  if (fav.from.type === 'area') {
    // De gare à gare : marche jusqu'à la gare comprise si elle tient dans la marche maximale, sinon heures du train.
    const d = here ? distanceM(here, fav.from) : Infinity;
    const walk = d < AT_STATION_M ? 0 : walkMinutes(d);
    if (here && walk <= settings.maxWalkMin) {
      plan = await env.route(fav.from, fav.to, t + walk * 60_000, settings, here);
      if (walk > 0) {
        plan = withAccessWalk(plan, here, settings, t);
        // heure de départ conseillée et alertes d'après la nouvelle marche
        if (env.refresh && plan.journeys.length) plan = { ...plan, journeys: await env.refresh(plan.journeys, settings) };
      }
    } else {
      plan = await env.route(fav.from, fav.to, t, settings, here);
      fromStation = true;
    }
  } else {
    plan = await env.route(fav.from, fav.to, t, settings, here);
  }
  const state: FavoriteAnswer['state'] = plan.journeys.length ? 'ok' : plan.empty === 'here' ? 'here' : plan.empty === 'noPosition' ? 'noPosition' : 'none';
  const out: FavoriteAnswer = { favoriteId: fav.id, kind: 'trip', state, plan, updatedAt: t };
  if (fromStation && state === 'ok') out.fromStation = true;
  return out;
}

async function tripAnswer(fav: FavoriteTrip, here: LatLon | null, settings: Settings, env: AnswerEnv): Promise<FavoriteAnswer> {
  const t = env.now();
  const base = { favoriteId: fav.id, kind: 'trip' as const, updatedAt: t };
  if ((fav.from.type === 'here' || fav.to.type === 'here') && !here) return { ...base, state: 'noPosition' };
  const dest = fav.to.type === 'here' ? here : endpointPoint(fav.to, settings);
  if (here && dest && fav.to.type !== 'here' && distanceM(here, dest) <= NEAR_M) {
    return { ...base, state: 'here', plan: { journeys: [], empty: 'here' } };
  }
  const key = planKey(fav, settings);
  const m = env.plans?.get(fav.id);
  if (m && m.key === key && t >= m.at && t - m.at < REPLAN_MS && samePlace(m.here, here) && m.gen === (await generationOf(env))) {
    const out = await reuse(m, settings, env, t).catch(() => null);
    // le temps réel a pu relire une nouvelle publication : alors, nouveau calcul
    if (out && m.gen === (await generationOf(env))) {
      m.answer = out;
      return out;
    }
  }
  const out = await computeTrip(fav, here, settings, env, t);
  if (env.plans) {
    env.plans.delete(fav.id);
    env.plans.set(fav.id, { key, gen: await generationOf(env), at: t, here, answer: out });
    if (env.plans.size > PLANS_MAX) env.plans.delete(env.plans.keys().next().value as string);
  }
  return out;
}

/** Réponse d'un favori (PRD M1.5) ; un lieu répond comme le trajet « Ma position → lieu » (kind 'trip'). */
export function answerFavorite(fav: Favorite, here: LatLon | null, settings: Settings, env: AnswerEnv): Promise<FavoriteAnswer> {
  return fav.kind === 'stop' ? stopAnswer(fav, settings, env) : tripAnswer(asTrip(fav), here, settings, env);
}
