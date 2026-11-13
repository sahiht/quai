/**
 * 1.2.3 (PRD-1.2.3 § 2) : les arrêts d'un départ d'un tableau, de son arrêt jusqu'au terminus (Core.departureStops).
 *
 * - Le départ est retrouvé dans le fichier de la zone du tableau : par son trip_id et son heure prévue (SNCB, De Lijn,
 *   TEC) ; STIB, sans trip_id : même ligne, même destination, l'heure prévue la plus proche. Son motif donne la suite
 *   des zones (`next`, minutes après le départ).
 * - Trains : le voyage du fichier trains/{date}.json du jour du départ (gares, heures, voies) ; temps réel gare par gare
 *   (rtAtStop : retard, voie modifiée, arrêt sauté, voyage supprimé) ; pendant une panne, les suppressions et voies
 *   déjà connues, à l'horaire prévu (comme les tableaux, M8.5). 1.2.8 (PRD-1.2.8 § 1) : tout le trajet, de la gare de
 *   départ du train à son terminus ; `at` : la gare du tableau ; `leave` : le départ estimé de chaque gare
 *   (trainProgress : les gares quittées, celle où le train arrive).
 * - Bus, tram, métro : le fichier de la ligne (un seul fichier, pas une requête par arrêt) donne les noms des zones et,
 *   quand le voyage y est retrouvé, ses heures exactes ; sinon les minutes du motif. Heures décalées comme le départ
 *   (son heure estimée) quand il a du temps réel, sinon horaire prévu (« ~ ») ; départ supprimé : arrêts supprimés.
 * - Voyage introuvable (autre publication) : state 'missing', jamais d'exception ; serveur injoignable : QuaiError.
 */
import { normalizeId } from '../../../shared/types';
import type { LineFile, Meta, Names, TrainsDay } from '../../../shared/types';
import type { Departure, DepartureStops, StopCall } from './api';
import type { PreparedArea } from './areas';
import { flagsOf, isLineFile, linePath, soft } from './linepicks';
import type { RealtimeClient, RtTrip } from './realtime';
import { delayMinutes, headKey, headScore, rtAtStop, rtAtStopShown, rtOccurrence, type TripContext } from './rtmerge';
import { indexDay, type DayIndex } from './trains';

const MIN = 60_000;
/** STIB : écart maximal entre un passage annoncé et le départ prévu qui lui prête sa suite d'arrêts. */
const STIB_MATCH_MS = 60 * MIN;
/** Zones dont le nom manque au fichier de ligne (repli rare) : fichiers de zone lus au plus. */
const NAME_FILES_MAX = 60;

export interface StopCallsEnv {
  meta: Meta;
  /** Zone du tableau (celle du départ). */
  prep: PreparedArea;
  /** Fichier de la publication (DataClient.json) : 404 → null, serveur injoignable → QuaiError. */
  json<T>(path: string, valid: (x: unknown) => x is T): Promise<T | null>;
  /** Trains d'un jour (DataClient.trains) : 404 → null, serveur injoignable → QuaiError. */
  trains(date: string): Promise<TrainsDay | null>;
  /** Relais temps réel ; null : horaires périmés ou hors ligne, horaire prévu. */
  rt: RealtimeClient | null;
  now: number;
  /** Zone d'un identifiant (noms en repli), null si introuvable. */
  area(id: string): Promise<PreparedArea | null>;
}

/** Réponse « ce départ n'est plus dans les horaires ». */
export function missingStops(dep: Partial<Departure> | null | undefined, op: Departure['op'] = 'stib'): DepartureStops {
  return { op: dep?.op ?? op, mode: dep?.mode ?? 'bus', line: dep?.line ?? '', head: dep?.head ?? { fr: '', nl: '' }, stops: [], anyPlanned: false, state: 'missing' };
}

/** Départ retrouvé dans le fichier de zone : rang dans deps (-1 : motif seul, passage STIB sans départ prévu proche). */
interface Found {
  di: number;
  pi: number;
  day: number;
  minutes: number;
  /** STIB : destination absente des motifs (véhicule limité) : motif de la ligne à cet arrêt, coupé à la destination. */
  cut?: boolean;
}

/** Le départ dans le fichier de sa zone, null s'il n'y est plus. */
export function locateDeparture(prep: PreparedArea, dep: Departure): Found | null {
  const deps = prep.file.deps;
  const stopOk = (si: number): boolean => !dep.stopId || prep.file.stops[si]?.id === dep.stopId;
  if (dep.tripId) {
    const want = normalizeId(dep.tripId);
    let best: Found | null = null;
    let gap = Infinity;
    deps.forEach((d, di) => {
      if (!d[4] || normalizeId(d[4]) !== want) return;
      if (dep.stopSeq !== undefined && d[5] !== dep.stopSeq) return;
      const g = Math.abs(prep.times[di] - dep.sched);
      if (g < gap) [best, gap] = [{ di, pi: d[2], day: d[0], minutes: d[1] }, g];
    });
    // même trip_id un autre jour : pas ce départ
    return gap <= 12 * 3_600_000 ? best : null;
  }
  if (prep.file.op !== 'stib') return null;
  // STIB (passages annoncés ou horaire prévu, sans trip_id) : même ligne, destination proche ; le départ prévu le plus
  // proche à cet arrêt (1 h au plus) prête sa suite exacte, sinon le motif seul. Revue 1.2.3 : destination inconnue
  // des motifs (véhicule limité, destination donnée par la STIB) : les motifs de la ligne à cet arrêt (même sens),
  // coupés ensuite à la destination ; aucun : disparu.
  const fr = headKey(dep.head?.fr ?? '');
  const nl = headKey(dep.head?.nl ?? '');
  const si = prep.file.stops.findIndex((st) => st.id === dep.stopId);
  let pats: number[] = [];
  prep.file.patterns.forEach((p, pi) => {
    if (p.line !== dep.line) return;
    if (Math.max(headScore(fr, prep.headKeys[pi]), headScore(nl, prep.headKeysNl[pi]), headScore(fr, prep.headKeysNl[pi]), headScore(nl, prep.headKeys[pi])) > 0) pats.push(pi);
  });
  const cut = !pats.length;
  if (cut) pats = si >= 0 ? (prep.patternsAtStop[si] ?? []).filter((pi) => prep.file.patterns[pi]?.line === dep.line) : [];
  if (!pats.length) return null;
  let best: Found | null = null;
  let gap = Infinity;
  deps.forEach((d, di) => {
    if (!pats.includes(d[2]) || !stopOk(d[3])) return;
    const g = Math.abs(prep.times[di] - dep.sched);
    if (g < gap) [best, gap] = [{ di, pi: d[2], day: d[0], minutes: d[1] }, g];
  });
  const extra = cut ? { cut: true } : {};
  if (best && gap <= STIB_MATCH_MS) return { ...(best as Found), ...extra };
  const atStop = si >= 0 ? pats.find((pi) => prep.patternsAtStop[si]?.includes(pi)) : undefined;
  return { di: -1, pi: atStop ?? pats[0], day: 0, minutes: -1, ...extra };
}

/** Les arrêts d'un départ du tableau de `env.prep`. */
export async function departureStopsAt(env: StopCallsEnv, dep: Departure): Promise<DepartureStops> {
  const found = dep ? locateDeparture(env.prep, dep) : null;
  if (!found) return missingStops(dep, env.prep.file.op);
  const base = { op: dep.op, mode: dep.mode, line: dep.line, head: dep.head };
  if (env.prep.file.op === 'sncb') {
    const run = await trainCalls(env, dep, found);
    if (!run) return missingStops(dep, env.prep.file.op);
    return { ...base, stops: run.stops, anyPlanned: run.stops.some((s) => !s.rt), state: 'ok', at: run.at };
  }
  const stops = await urbanCalls(env, dep, found);
  return { ...base, stops, anyPlanned: stops.some((s) => !s.rt), state: 'ok' };
}

/**
 * 1.2.8 (PRD-1.2.8 § 2) : où en est un train sur tout son trajet. Gares quittées (`passed`) : jusqu'à la dernière gare
 * desservie dont le départ estimé (`leave`, sinon l'heure montrée) est passé, les arrêts supprimés d'avant compris ; le
 * train ne repart jamais en arrière (une gare d'avant n'est jamais « à venir »). L'heure d'un arrêt supprimé ne compte
 * pas : elle est prévue, le train peut être en retard. Gare où il arrive (`vehicle`, ● ; -1 : aucune) : la première
 * gare desservie après la dernière quittée, seulement s'il en a quitté une et si les deux viennent du temps réel (juste
 * ou rien, comme le ● de la 1.2.7) : sans temps réel, avant son départ ou après son terminus, aucun ●.
 */
export function trainProgress(stops: readonly Pick<StopCall, 'leave' | 'est' | 'rt' | 'cancelled'>[], now: number): { passed: boolean[]; vehicle: number } {
  let last = -1;
  stops.forEach((c, i) => {
    if (!c.cancelled && (c.leave ?? c.est) < now) last = i;
  });
  const passed = stops.map((_, i) => i <= last);
  let next = last + 1;
  while (next < stops.length && stops[next].cancelled) next++;
  const vehicle = last >= 0 && next < stops.length && stops[last].rt && stops[next].rt ? next : -1;
  return { passed, vehicle };
}

/* ------------------------------ Trains ------------------------------ */

const uicOf = (areaId: string): string => areaId.slice(areaId.indexOf(':') + 1);
const timesOf = (x: [number, number, number, string, number]) => ({ arr: x[1] >= 0 ? x[1] : x[2], dep: x[2] >= 0 ? x[2] : x[1] });

async function trainCalls(env: StopCallsEnv, dep: Departure, found: Found): Promise<{ stops: StopCall[]; at: number } | null> {
  const date = env.meta.serviceDates[found.day];
  const file = date ? await env.trains(date) : null;
  if (!file) return { stops: await urbanCalls(env, dep, found), at: 0 };
  const day = indexDay(file);
  const ti = dep.tripId ? (day.tripById.get(dep.tripId) ?? day.tripById.get(normalizeId(dep.tripId))) : undefined;
  if (ti === undefined) return null;
  const s = file.trips[ti].s;
  const here = env.prep.file.id;
  let i = s.findIndex((x) => x[4] === dep.stopSeq && file.stations[x[0]]?.id === here);
  if (i < 0) i = s.findIndex((x) => file.stations[x[0]]?.id === here && x[2] >= 0 && day.base + x[2] * MIN === dep.sched);
  if (i < 0) return null;

  // temps réel du voyage (occurrence proche de maintenant) ; pendant une panne, ce qui est déjà connu
  let trip: RtTrip | null = null;
  let memory: RtTrip | undefined;
  if (env.rt && rtOccurrence(dep.sched, env.now)) {
    const id = normalizeId(file.trips[ti].id);
    const res = await env.rt.trips('sncb', [file.trips[ti].id]);
    trip = res.map.get(id) ?? null;
    if (!trip) memory = res.remembered?.get(id);
  }
  return trainStopCalls(file, day, ti, i, trip, memory);
}

/**
 * 1.2.8 : tout le trajet du voyage `ti` du fichier des trains, monté à sa gare de rang `i` : ses gares de la première à
 * la dernière (après `i`, seulement celles où l'on peut descendre), `at` : la gare de montée. Temps réel du voyage
 * (`trip`), ou pendant une panne ce qui en était connu (`memory`) ; sans lui, horaire prévu. Fonction pure (balayage
 * des vrais trains : test/scan/real-trains.test.ts).
 */
export function trainStopCalls(file: TrainsDay, day: DayIndex, ti: number, i: number, trip: RtTrip | null = null, memory?: RtTrip): { stops: StopCall[]; at: number } {
  const s = file.trips[ti].s;
  const ctx: TripContext = {
    seqOfStop: (stopId) => {
      const uic = normalizeId(stopId).replace(/_[^_]+$/, '');
      const p = s.findIndex((x) => file.stations[x[0]]?.id === `sncb:${uic}`);
      return p >= 0 ? s[p][4] : undefined;
    },
    schedOfSeq: (seq) => {
      const p = s.findIndex((x) => x[4] === seq);
      return p >= 0 ? day.base + timesOf(s[p]).dep * MIN : undefined;
    },
  };

  const out: StopCall[] = [];
  let at = 0;
  for (let p = 0; p < s.length; p++) {
    const x = s[p];
    // après la gare du tableau, une gare sans descente possible n'est pas un arrêt pour qui est à bord ; avant elle
    // (1.2.8), toutes les gares où le train s'est arrêté, jamais un point de passage sans heure (« Sterpenich-Frontière »)
    if (p > i && x[1] < 0) continue;
    if (x[1] < 0 && x[2] < 0) continue;
    if (p === i) at = out.length;
    const st = file.stations[x[0]];
    const t = timesOf(x);
    // l'heure montrée : le départ jusqu'à la gare du tableau, l'arrivée ensuite
    const sched = day.base + (p <= i ? t.dep : t.arr) * MIN;
    const leaveSched = day.base + t.dep * MIN;
    const platform = x[3] || undefined;
    // revue 1.2.3 : le flux donne l'heure du départ quand il existe (l'arrivée au terminus) : c'est la référence ; l'heure
    // montrée (l'arrivée) en est décalée d'autant, l'arrêt en gare n'est pas du retard
    const refMin = p === s.length - 1 || x[2] < 0 ? t.arr : t.dep;
    const ref = { seq: x[4], stopId: st ? `${uicOf(st.id)}${platform ? `_${platform}` : ''}` : undefined, sched: day.base + refMin * MIN, platform };
    const c: StopCall = { name: st?.n ?? { fr: '', nl: '' }, sched, est: sched, rt: false, delayMin: 0 };
    if (st) c.areaId = st.id;
    if (platform) c.platform = platform;
    if (trip) {
      const r = rtAtStopShown(trip, ref, sched, ctx);
      c.rt = r.rt;
      if (r.cancelled) c.cancelled = true;
      else {
        c.est = r.est;
        c.delayMin = delayMinutes(r.est, sched);
        if (r.newPlatform) c.newPlatform = r.newPlatform;
      }
    } else if (memory) {
      // panne : suppression ou voie modifiée déjà connues, horaire prévu (« ~ »)
      const r = rtAtStop(memory, ref, ctx);
      if (r.cancelled) c.cancelled = true;
      else if (r.newPlatform) c.newPlatform = r.newPlatform;
    }
    // 1.2.8 : le départ estimé de la gare, décalé comme l'heure montrée
    c.leave = leaveSched + (c.est - sched);
    out.push(c);
  }
  return { stops: out, at };
}

/* ------------------------------ Bus, tram, métro ------------------------------ */

/**
 * Suite exacte d'un voyage dans le fichier de sa ligne : la position de montée dans la zone `zone` dont l'heure est
 * `minutes` le jour `day` (et le même trip_id, De Lijn et TEC), puis chaque zone où l'on peut descendre (une zone
 * déjà passée n'est pas répétée, sauf le terminus), avec ses minutes après le départ. null si introuvable.
 */
function exactNext(L: LineFile, zone: string, found: Found, tripId: string | undefined): [string, number][] | null {
  if (found.minutes < 0) return null;
  const want = tripId ? normalizeId(tripId) : undefined;
  for (const pat of L.pats) {
    const n = pat.a.length;
    const flags = flagsOf(pat.f, n);
    for (let pos = 0; pos < n - 1; pos++) {
      if (L.areas[pat.a[pos]]?.[0] !== zone || (flags[pos] !== 'b' && flags[pos] !== 'x')) continue;
      for (const t of pat.t) {
        const prof = pat.prof[t[2]];
        if (t[0] !== found.day || !prof || t[1] + prof[pos] !== found.minutes) continue;
        if (want && L.trips && t[3] !== undefined && normalizeId(L.trips[t[3]] ?? '') !== want) continue;
        const out: [string, number][] = [];
        const seen = new Set([zone]);
        for (let q = pos + 1; q < n; q++) {
          const id = L.areas[pat.a[q]]?.[0];
          if (!id || (flags[q] !== 'a' && flags[q] !== 'x')) continue;
          if (seen.has(id) && q !== n - 1) continue;
          seen.add(id);
          out.push([id, prof[q] - prof[pos]]);
        }
        return out;
      }
    }
  }
  return null;
}

async function urbanCalls(env: StopCallsEnv, dep: Departure, found: Found): Promise<StopCall[]> {
  const prep = env.prep;
  const pat = prep.file.patterns[found.pi];
  const op = prep.file.op;
  // fichier de la ligne (noms des zones, heures exactes du voyage) ; trains : pas de fichier de ligne
  const path = op !== 'sncb' && pat ? linePath(`${op}:${pat.route}`) : null;
  const L = path ? await soft(env.json(path, isLineFile)) : null;
  const next = (L && exactNext(L, prep.file.id, found, dep.tripId)) || (pat?.next ?? []);
  const names = new Map<string, Names>((L?.areas ?? []).map((a) => [a[0], a[3]]));
  const lacking = [...new Set(next.map(([id]) => id).filter((id) => !names.has(id)))].slice(0, NAME_FILES_MAX);
  if (lacking.length) {
    const files = await Promise.all(lacking.map((id) => env.area(id)));
    files.forEach((f, k) => {
      if (f) names.set(lacking[k], f.file.n);
    });
  }
  // véhicule limité (STIB, Found.cut) : jusqu'à sa destination si elle est sur le parcours
  let calls = next;
  if (found.cut) {
    const fr = headKey(dep.head?.fr ?? '');
    const nl = headKey(dep.head?.nl ?? '');
    const score = (n: Names | undefined) => Math.max(headScore(fr, headKey(n?.fr ?? '')), headScore(nl, headKey(n?.nl ?? '')));
    const at = (min: number) => calls.findIndex(([id]) => score(names.get(id)) >= min);
    const j = at(3) >= 0 ? at(3) : at(2);
    if (j >= 0) calls = calls.slice(0, j + 1);
  }
  const shift = dep.cancelled ? 0 : dep.est - dep.sched;
  const call = (areaId: string, name: Names, offsetMin: number): StopCall => {
    const sched = dep.sched + offsetMin * MIN;
    const c: StopCall = { areaId, name, sched, est: sched + shift, rt: dep.rt, delayMin: dep.cancelled ? 0 : dep.delayMin };
    if (dep.cancelled) c.cancelled = true;
    return c;
  };
  const first = call(prep.file.id, prep.file.n, 0);
  if (dep.platform) first.platform = dep.platform;
  if (dep.newPlatform && !dep.cancelled) first.newPlatform = dep.newPlatform;
  return [first, ...calls.map(([id, m]) => call(id, names.get(id) ?? { fr: id, nl: id }, m))];
}
