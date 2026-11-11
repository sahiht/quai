/**
 * Suggestion à l'ouverture (SPEC § 5.1) :
 *  - opening 'home' → rien ; 'firstFavorite' → le premier favori, ouvert directement ;
 *  - 'suggest' : (1) un favori « à moins de 300 m » proche (arrêt, ou départ du trajet) → ouverture directe ;
 *    (2) sinon le premier favori « matin » (5h-11h) ou « soir » (15h-21h) selon l'heure belge, s'il donne un
 *    résultat → ligne de suggestion ; (3) sinon rien.
 */
import type { Board, Endpoint, Favorite, Journey, LineFilter, Settings, Suggestion } from './api';
import { forLabel, departureSummary, NB, rideSummary, shortAddress } from './text';
import { brusselsParts, displayName, distanceM, fit, hhmm } from './util';

export interface SuggestEnv {
  now: number;
  board(areaId: string, opts: { limit?: number; filter?: LineFilter[] }): Promise<Board>;
  plan(from: Endpoint, to: Endpoint, after: number, settings: Settings, here?: { lat: number; lon: number }): Promise<Journey[]>;
}

export const NEAR_M = 300;
/** Une suggestion « matin » ou « soir » ne propose qu'un départ dans les 3 heures. */
export const SUGGEST_HORIZON_MS = 3 * 3_600_000;

export function slotOf(now: number): 'morning' | 'evening' | null {
  const h = brusselsParts(now).h;
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 15 && h < 21) return 'evening';
  return null;
}

function originOf(f: Favorite, settings: Settings): { lat: number; lon: number } | null {
  if (f.kind === 'stop') return { lat: f.lat, lon: f.lon };
  const e = f.from;
  if (e.type === 'area') return { lat: e.lat, lon: e.lon };
  if (e.type === 'place') {
    const p = settings.places.find((x) => x.id === e.placeId);
    return p ? { lat: p.lat, lon: p.lon } : null;
  }
  return null;
}

/** « bureau » (label du favori) ou libellé du lieu en minuscules ; nom de la zone sinon. */
export function tripLabel(f: Extract<Favorite, { kind: 'trip' }>, settings: Settings): string {
  const own = f.label?.trim();
  if (own) {
    // « Bureau » saisi comme un lieu enregistré : nom commun → « Pour le bureau »
    const isPlace = settings.places.some((p) => p.label.trim().toLowerCase() === own.toLowerCase());
    return isPlace ? own.toLowerCase() : own;
  }
  const to = f.to;
  if (to.type === 'place') {
    const p = settings.places.find((x) => x.id === to.placeId);
    if (p) return p.label.toLowerCase();
  }
  if (to.type === 'area') return displayName(to.name, settings.lang);
  if (to.type === 'address') return shortAddress(to.label);
  return 'ma position';
}

async function forFavorite(
  f: Favorite,
  autoOpen: boolean,
  requireResult: boolean,
  here: { lat: number; lon: number } | null,
  settings: Settings,
  env: SuggestEnv,
): Promise<Suggestion | null> {
  if (f.kind === 'stop') {
    const name = displayName(f.name, settings.lang);
    let board: Board | undefined;
    try {
      board = await env.board(f.areaId, { limit: settings.display.depsPerStop, filter: f.filter });
    } catch {
      board = undefined;
    }
    const deps = (board?.departures ?? []).filter((d) => !d.cancelled && d.est >= env.now - 60_000);
    if (requireResult && !(deps[0] && deps[0].est <= env.now + SUGGEST_HORIZON_MS)) return null;
    if (!deps.length) {
      if (requireResult) return null;
      return { kind: 'favoriteStop', favoriteId: f.id, autoOpen, title: fit(name), ...(board ? { board } : {}) };
    }
    const mark = settings.display.markPlanned;
    const s: Suggestion = {
      kind: 'favoriteStop',
      favoriteId: f.id,
      autoOpen,
      title: fit(`${name}${NB}: ${departureSummary(deps[0], env.now, settings.lang, mark)}`),
    };
    if (deps[1]) s.subtitle = fit(`puis ${departureSummary(deps[1], env.now, settings.lang, mark)}`);
    if (board) s.board = board;
    return s;
  }
  const label = forLabel(tripLabel(f, settings));
  let journeys: Journey[] = [];
  try {
    journeys = await env.plan(f.from, f.to, env.now, settings, here ?? undefined);
  } catch {
    journeys = [];
  }
  const j = journeys.find((x) => !x.legs.some((l) => l.kind === 'ride' && l.cancelled)) ?? journeys[0];
  if (requireResult && !(j && j.leaveAt <= env.now + SUGGEST_HORIZON_MS)) return null;
  if (!j) return { kind: 'favoriteTrip', favoriteId: f.id, autoOpen, title: fit(label) };
  const ride = j.legs.find((l) => l.kind === 'ride');
  const walk = j.legs[0]?.kind === 'walk' ? j.legs[0] : undefined;
  if (!ride) {
    // trajet entièrement à pied
    return { kind: 'favoriteTrip', favoriteId: f.id, autoOpen, title: fit(`${label}${NB}: à pied, ${walk?.walkMin ?? 0}${NB}min`), subtitle: fit(`arrivée à ${hhmm(j.arr)}`), journey: j };
  }
  const s: Suggestion = {
    kind: 'favoriteTrip',
    favoriteId: f.id,
    autoOpen,
    title: fit(`${label}${NB}: ${rideSummary(ride, env.now)}`),
    journey: j,
  };
  s.subtitle = fit(walk ? `partir à ${hhmm(j.leaveAt)}, ${walk.walkMin ?? 0}${NB}min à pied` : `arrivée à ${hhmm(j.arr)}`);
  return s;
}

export async function suggestOpening(here: { lat: number; lon: number } | null, settings: Settings, env: SuggestEnv): Promise<Suggestion | null> {
  const favs = settings.favorites ?? [];
  const opening = settings.display.opening;
  if (opening === 'home' || !favs.length) return null;
  if (opening === 'firstFavorite') return forFavorite(favs[0], true, false, here, settings, env);

  if (here) {
    const near = favs
      .filter((f) => f.propose === 'near')
      .map((f) => ({ f, o: originOf(f, settings) }))
      .filter((x): x is { f: Favorite; o: { lat: number; lon: number } } => x.o !== null)
      .map((x) => ({ f: x.f, d: distanceM(here, x.o) }))
      .filter((x) => x.d <= NEAR_M)
      .sort((a, b) => a.d - b.d);
    for (const { f } of near) {
      const s = await forFavorite(f, true, false, here, settings, env);
      if (s) return s;
    }
  }

  const slot = slotOf(env.now);
  if (!slot) return null;
  for (const f of favs) {
    if (f.propose !== slot) continue;
    if (f.kind === 'trip' && f.from.type === 'here' && !here) continue;
    const s = await forFavorite(f, false, true, here, settings, env);
    if (s) return s;
  }
  return null;
}
