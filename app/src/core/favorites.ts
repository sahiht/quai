/**
 * Favoris « réponse directe » (PRD M1), communs au vrai cœur et au faux cœur de développement :
 *  - orderFavorites : ordre intelligent (M1.4), immédiat, sans calcul de trajet ;
 *  - answerFavorite : réponse d'un favori (M1.5) : trajet (route() depuis la position, ou depuis la gare de départ
 *    avec la marche jusqu'à elle si elle tient dans la marche maximale, sinon heures du train) ; arrêt (départs
 *    filtrés, zone retrouvée par `aka`, puis par opérateur, nom et position à moins de 150 m, sinon « introuvable »).
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
import { vers } from './text';
import { distanceM, walkMinutes } from './util';

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

/** Position d'une extrémité fixe (zone, lieu, adresse) ; null pour « Ma position » ou un lieu disparu. */
export function endpointPoint(e: Endpoint, settings: Settings): LatLon | null {
  if (e.type === 'area' || e.type === 'address') return { lat: e.lat, lon: e.lon };
  if (e.type === 'place') {
    const p = settings.places.find((x) => x.id === e.placeId);
    return p ? { lat: p.lat, lon: p.lon } : null;
  }
  return null;
}

/** Titre d'un trajet favori : « Vers le bureau », « Vers Gand-Saint-Pierre », « Vers Veldstraat 1 ». */
export function favoriteTitle(f: FavoriteTrip, settings: Settings): string {
  return vers(tripLabel(f, settings));
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
    const fixed = f.kind === 'stop' ? { lat: f.lat, lon: f.lon } : endpointPoint(f.from, settings);
    const d = here && fixed ? distanceM(here, fixed) : undefined;
    const dest = f.kind === 'trip' ? (f.to.type === 'here' ? null : endpointPoint(f.to, settings)) : null;
    const atDest = !!here && !!dest && distanceM(here, dest) <= NEAR_M;
    let rule: FavoriteRank['rule'] = 4;
    let sub = 0;
    if (atDest || isLastAnswer(last?.get(f.id), now)) rule = 5;
    else if (mine) rule = 4;
    else if (d !== undefined && d <= NEAR_M) rule = 1;
    else if (slot && f.propose === slot) rule = 2;
    else if (here && f.kind === 'trip' && f.from.type === 'here') rule = 3;
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

/** Proposition de référence d'une raison : « Le plus simple » pour « Le plus rapide », la précédente de même
 *  structure pour « Le suivant ». */
function refFor(label: JourneyLabel | undefined, list: readonly Journey[], i: number): Journey | undefined {
  if (label === 'fast') return list[0];
  if (label !== 'next') return undefined;
  for (let k = i - 1; k >= 0; k--) if (list[k].label === 'next' || list[k].label === 'simple') return list[k];
  return list[0];
}

/** Ajoute la marche depuis la position jusqu'à la gare de départ (marge comprise) et recalcule les raisons. */
export function withAccessWalk(plan: PlanResult, here: LatLon, station: { lat: number; lon: number; name: AreaSummary['n']; areaId?: string }, walkMin: number, settings: Settings, now: number): PlanResult {
  const w = walkMin * 60_000;
  const margin = Math.max(0, settings.alerts.leaveBeforeMin) * 60_000;
  const journeys: Journey[] = [];
  for (const j of plan.journeys) {
    const first = j.legs.find(isRide);
    if (!first || first.dep - w < now - 30_000) continue;
    const leave = first.dep - w - margin;
    const walk: Leg = {
      kind: 'walk',
      from: { name: HERE_NAMES, lat: here.lat, lon: here.lon },
      to: { name: station.name, lat: station.lat, lon: station.lon, ...(station.areaId ? { areaId: station.areaId } : {}) },
      dep: leave,
      arr: leave + w,
      schedDep: first.schedDep - w - margin,
      schedArr: first.schedDep - margin,
      walkMin,
    };
    journeys.push({ ...j, id: `${j.id}~a`, legs: [walk, ...j.legs], dep: leave, leaveAt: leave });
  }
  journeys.forEach((j, i) => {
    if (j.label) j.reason = reasonText(j.label, j, refFor(j.label, journeys, i));
  });
  const out: PlanResult = { ...plan, journeys };
  if (!journeys.length && !out.empty) out.empty = 'noTrip';
  if (journeys.length) delete out.empty;
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
  let plan: PlanResult;
  let fromStation = false;
  if (fav.from.type === 'area') {
    // De gare à gare : marche jusqu'à la gare comprise si elle tient dans la marche maximale, sinon heures du train.
    const d = here ? distanceM(here, fav.from) : Infinity;
    const walk = d < AT_STATION_M ? 0 : walkMinutes(d);
    if (here && walk <= settings.maxWalkMin) {
      plan = await env.route(fav.from, fav.to, t + walk * 60_000, settings, here);
      if (walk > 0) plan = withAccessWalk(plan, here, { lat: fav.from.lat, lon: fav.from.lon, name: fav.from.name, areaId: fav.from.areaId }, walk, settings, t);
    } else {
      plan = await env.route(fav.from, fav.to, t, settings, here);
      fromStation = true;
    }
  } else {
    plan = await env.route(fav.from, fav.to, t, settings, here);
  }
  const state: FavoriteAnswer['state'] = plan.journeys.length ? 'ok' : plan.empty === 'here' ? 'here' : plan.empty === 'noPosition' ? 'noPosition' : 'none';
  const out: FavoriteAnswer = { ...base, state, plan };
  if (fromStation && state === 'ok') out.fromStation = true;
  return out;
}

/** Réponse d'un favori (PRD M1.5). */
export function answerFavorite(fav: Favorite, here: LatLon | null, settings: Settings, env: AnswerEnv): Promise<FavoriteAnswer> {
  return fav.kind === 'stop' ? stopAnswer(fav, settings, env) : tripAnswer(fav, here, settings, env);
}
