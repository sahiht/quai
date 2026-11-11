/**
 * Correspondance devenue impossible par un retard (design-routing.md § 4.9, point 2) : le reste du trajet est
 * recalculé depuis la zone de correspondance, à l'heure d'arrivée estimée, sur le petit réseau de la recherche
 * (quelques millisecondes), avec l'alerte « ! Correspondance recalculée ».
 *
 * Mémoire par trajet proposé ou suivi (identifiant du trajet, FOLLOWED_MAX au plus, le moins récemment servi oublié
 * d'abord) : la recette du réseau de sa recherche (génération, fichiers de ligne, jours de trains). Les réseaux
 * restent en mémoire dans la limite de NET_BYTES_MAX octets (taille estimée), le moins récemment servi effacé
 * d'abord ; un réseau effacé est refait au besoin avec les mêmes fichiers (caches de DataClient), jamais avec ceux
 * d'une autre génération. L'arrivée est celle du trajet (sa dernière étape), la marche maximale celle des réglages.
 */
import type { TrainsDay } from '../../../../shared/types';
import type { Alert, Journey, Leg, Settings } from '../api';
import { brokenConnection } from '../journeys';
import { serviceDayBase } from '../util';
import { endRef, rideLeg, stopRef, walkLeg, type EndPoint } from './legs';
import { accessMap, linePart, Net, trainPart } from './network';
import { maxWalkOf, P } from './params';
import { raptor } from './raptor';
import { isLineFile, linePath, soft, type RoutingSource } from './select';

const MIN = 60_000;
export const RECALC_TEXT = '! Correspondance recalculée';
/** Trajets retenus (proposés récemment ou suivis). */
export const FOLLOWED_MAX = 300;
/**
 * Réseaux gardés en mémoire : taille estimée totale, en octets (le dernier servi reste, même plus gros). Données
 * réelles : 1 à 9 Mo estimés par recherche, trains non compris.
 */
export const NET_BYTES_MAX = 12 * 1024 * 1024;

/** De quoi refaire le réseau d'une recherche : mêmes fichiers, même génération de données. */
export interface NetRecipe {
  gen: string;
  /** Fichiers de ligne (LineFile.id), dans l'ordre du réseau. */
  lines: readonly string[];
  /** Jours des fichiers trains/ (dates de service). */
  days: readonly string[];
}

const keys = new WeakMap<NetRecipe, string>();
function recipeKey(r: NetRecipe): string {
  let k = keys.get(r);
  if (k === undefined) keys.set(r, (k = `${r.gen}|${r.days.join(',')}|${[...r.lines].sort().join(',')}`));
  return k;
}

/** Identifiant de trajet → recette ; ordre d'insertion = du moins au plus récemment servi. */
const followed = new Map<string, NetRecipe>();
/** Recette → réseau en mémoire (même ordre). */
const nets = new Map<string, { net: Net; bytes: number; gen: string }>();
let netBytesTotal = 0;
/** Réseaux en cours de reconstruction : un seul chargement par recette. */
const building = new Map<string, Promise<Net | null>>();

/**
 * Taille estimée d'un réseau en mémoire (octets) : motifs des lignes, zones et marches, fichiers de ligne qu'il garde.
 * La partie « trains », commune aux réseaux des mêmes jours (cache de network.ts), n'est pas comptée.
 */
export function netBytes(net: Net): number {
  let b = 0;
  for (const r of net.routes) {
    if (r.src.kind === 'line') b += 200 + r.stops.byteLength + r.board.byteLength + r.alight.byteLength + r.dep.byteLength + r.arr.byteLength;
  }
  for (let s = 0; s < net.size; s++) b += 200 + 16 * (net.routesAt[s]?.length ?? 0) + 8 * (net.foot[s]?.length ?? 0);
  for (const f of net.lines) {
    b += 500 + 150 * f.areas.length + 60 * (f.trips?.length ?? 0);
    for (const p of f.pats) b += 64 * p.t.length + 8 * p.prof.reduce((n, x) => n + x.length, 0) + 60 * p.a.length;
  }
  return b;
}

function follow(id: string, recipe: NetRecipe): void {
  followed.delete(id);
  followed.set(id, recipe);
  while (followed.size > FOLLOWED_MAX) followed.delete(followed.keys().next().value as string);
}

function dropNet(key: string): void {
  const e = nets.get(key);
  if (!e) return;
  nets.delete(key);
  netBytesTotal -= e.bytes;
}

/** Garde un réseau (le plus récemment servi) ; les moins récents sont effacés au-delà de NET_BYTES_MAX. */
function keepNet(key: string, gen: string, net: Net): void {
  const cur = nets.get(key);
  if (cur?.net === net) {
    nets.delete(key);
    nets.set(key, cur);
    return;
  }
  dropNet(key);
  const bytes = netBytes(net);
  nets.set(key, { net, bytes, gen });
  netBytesTotal += bytes;
  for (const k of [...nets.keys()]) {
    if (netBytesTotal <= NET_BYTES_MAX) break;
    if (k !== key) dropNet(k);
  }
}

/** Jamais rien d'une autre génération : recettes et réseaux oubliés. */
function prune(gen: string): void {
  for (const [id, r] of followed) if (r.gen !== gen) followed.delete(id);
  for (const [k, e] of nets) if (e.gen !== gen) dropNet(k);
}

/** Retient le réseau d'une recherche et les trajets proposés (identifiants). */
export function rememberNet(recipe: NetRecipe, net: Net, ids: readonly string[]): void {
  prune(recipe.gen);
  keepNet(recipeKey(recipe), recipe.gen, net);
  for (const id of ids) follow(id, recipe);
}

/** Trajet affiché ou suivi (refresh()) : sa recette et son réseau passent en tête de la mémoire. */
export function touchFollowed(id: string): void {
  const r = followed.get(id);
  if (!r) return;
  follow(id, r);
  const key = recipeKey(r);
  const e = nets.get(key);
  if (e) keepNet(key, e.gen, e.net);
}

/** Trajet retenu pour le recalcul d'une correspondance (même génération) : la recette de son réseau, sinon null. */
export function netOf(gen: string | undefined, id: string): NetRecipe | null {
  const r = followed.get(id);
  return r && r.gen === gen ? r : null;
}

/** Réseaux en mémoire : nombre et taille estimée (tests, mesures). */
export function netMemory(): { nets: number; bytes: number; followed: number } {
  return { nets: nets.size, bytes: netBytesTotal, followed: followed.size };
}

/** Efface les réseaux en mémoire, recettes gardées (tests : reconstruction). */
export function dropNets(): void {
  for (const k of [...nets.keys()]) dropNet(k);
}

/** Réseau refait avec les fichiers d'une recette (caches de DataClient) ; null si la génération a changé. */
async function rebuild(r: NetRecipe, src: RoutingSource): Promise<Net | null> {
  const dates = src.meta.serviceDates;
  if (src.meta.generatedAt !== r.gen || !dates.length) return null;
  const base0 = serviceDayBase(dates[0]);
  const dayOff = dates.map((d) => Math.round((serviceDayBase(d) - base0) / MIN));
  const [files, trains] = await Promise.all([
    Promise.all(
      r.lines.map(async (id) => {
        const path = linePath(id);
        const f = path ? await soft(src.json(path, isLineFile)) : null;
        return f && f.id === id ? f : null;
      }),
    ),
    Promise.all(r.days.map((d) => soft(src.trains(d)))),
  ]);
  const tr = trains.filter((f): f is TrainsDay => f !== null);
  const net = new Net(base0, tr.length ? trainPart(tr, base0) : null);
  for (const f of files) if (f) net.addLine(linePart(f, base0, dayOff));
  return net.finish();
}

/**
 * Réseau d'un trajet retenu : en mémoire, sinon refait avec les mêmes fichiers ; null si le trajet est inconnu ou
 * d'une autre génération. Données injoignables : l'erreur remonte.
 */
export async function netFor(id: string, src: RoutingSource): Promise<Net | null> {
  const gen = src.meta.generatedAt;
  prune(gen);
  const recipe = followed.get(id);
  if (!recipe) return null;
  follow(id, recipe);
  const key = recipeKey(recipe);
  const hit = nets.get(key);
  if (hit) {
    keepNet(key, gen, hit.net);
    return hit.net;
  }
  let p = building.get(key);
  if (!p) {
    p = rebuild(recipe, src).finally(() => building.delete(key));
    building.set(key, p);
  }
  const net = await p;
  if (net && followed.get(id) === recipe) keepNet(key, gen, net);
  return net;
}

/**
 * Trajet affiché dont une correspondance est devenue impossible : étapes recalculées sur le réseau de sa recherche
 * (refait au besoin), vers l'arrivée du trajet ; null s'il n'y a rien à recalculer ou si aucune correspondance ne
 * marche.
 */
export async function repairFollowed(j: Journey, settings: Settings, src: RoutingSource): Promise<Leg[] | null> {
  const end = j.legs[j.legs.length - 1]?.to;
  if (!end || brokenConnection(j) < 0) return null;
  const net = await netFor(j.id, src);
  return net ? repairLegs(j, net, { name: end.name, lat: end.lat, lon: end.lon, ...(end.areaId ? { areaId: end.areaId } : {}) }, maxWalkOf(settings)) : null;
}

const isRide = (l: Leg) => l.kind === 'ride';
const urbanPairs = (rides: { urban: boolean }[]) => rides.reduce((n, r, i) => n + (i > 0 && r.urban && rides[i - 1].urban ? 1 : 0), 0);

/**
 * Étapes du trajet recalculé à partir de la correspondance manquée (les étapes d'avant, heures estimées, sont
 * gardées), ou null si aucune correspondance ne marche (3 véhicules au plus, attente de 60 min au plus, une seule
 * correspondance entre lignes urbaines).
 */
export function repairLegs(j: Journey, net: Net, D: EndPoint, maxWalk: number): Leg[] | null {
  const b = brokenConnection(j);
  if (b < 0) return null;
  let p = b - 1;
  while (p >= 0 && j.legs[p].kind !== 'ride') p--;
  if (p < 0) return null;
  const prev = j.legs[p];
  const s = prev.to.areaId ? net.idx.get(prev.to.areaId) : undefined;
  if (s === undefined) return null;
  const before = j.legs.slice(0, p + 1);
  const ridesBefore = before.filter(isRide).map((l) => ({ urban: l.op !== 'sncb' }));
  const rounds = P.rounds - ridesBefore.length;
  if (rounds < 1) return null;
  const t = (prev.arr - net.base0) / MIN;
  // accès : même zone (temps de correspondance) ou zones voisines à pied
  const walkOf = new Map<number, number>([[s, 0]]);
  const access = new Map<number, number>([[s, net.station[s] ? P.mctStation : P.mctUrban]]);
  const f = net.foot[s];
  for (let i = 0; i < f.length; i += 2) {
    const v = f[i + 1] + (net.station[f[i]] ? P.footBufStation : P.footBufUrban);
    if (v < (access.get(f[i]) ?? Infinity)) {
      access.set(f[i], v);
      walkOf.set(f[i], f[i + 1]);
    }
  }
  const egress = accessMap(net, D, Math.floor(P.longWalkFactor * maxWalk), 2 * maxWalk);
  if (!egress.size) return null;
  const uuBefore = urbanPairs(ridesBefore);
  const found = raptor(net, { access, egress, after: t, windowMin: 0, rounds, urbanUrbanMax: Math.max(0, P.urbanUrbanMax - uuBefore) })
    .filter((c) => {
      const r0 = net.routes[c.rides[0].route];
      const firstWait = r0.dep[c.rides[0].trip * r0.n + c.rides[0].bpos] - t - (walkOf.get(c.accessStop) ?? 0);
      const all = [...ridesBefore, ...c.rides.map((r) => ({ urban: net.routes[r.route].urban }))];
      return c.maxWait <= P.maxWaitMin && firstWait <= P.maxWaitMin && urbanPairs(all) <= P.urbanUrbanMax;
    })
    .sort((x, y) => x.arr - y.arr || x.rides.length - y.rides.length);
  const c = found[0];
  if (!c) return null;
  const rides = c.rides.map((r) => rideLeg(net, r));
  if (rides.some((l) => !l)) return null;
  const legs: Leg[] = before.map((l) => ({ ...l, from: { ...l.from }, to: { ...l.to }, ...(l.stops ? { stops: l.stops.map((x) => ({ ...x })) } : {}) }));
  const w = walkOf.get(c.accessStop) ?? 0;
  if (c.accessStop !== s && w > 0) legs.push(walkLeg(stopRef(net, s), stopRef(net, c.accessStop), w, prev.arr));
  (rides as Leg[]).forEach((l, i) => {
    const h = i > 0 ? c.hops[i - 1] : undefined;
    if (h && h.walk > 0) legs.push(walkLeg(stopRef(net, h.from), l.from, h.walk, (rides[i - 1] as Leg).schedArr));
    legs.push(l);
  });
  if (c.egressWalk > 0) legs.push(walkLeg(stopRef(net, c.egressStop), endRef(D), c.egressWalk, (rides[rides.length - 1] as Leg).schedArr));
  return legs;
}

/** Alerte « ! Correspondance recalculée » (en tête des alertes du trajet). */
export function recalcAlert(now: number): Alert {
  return { kind: 'delay', text: RECALC_TEXT, at: now };
}
