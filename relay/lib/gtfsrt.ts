/**
 * Décodage GTFS-RT (gtfs-realtime-bindings) : index des mises à jour de voyages et liste des alertes.
 * Robuste aux écarts des flux réels : identifiants préfixés par le portail BMC (gt:, gs:, gr:), entités sans
 * trip_id, doublons, en-têtes FULL_DATASET ou DIFFERENTIAL, horodatages en millisecondes.
 * Le relais ne propage pas les retards : il renvoie les mises à jour telles que le flux les donne.
 */
import gtfsrt from 'gtfs-realtime-bindings';
import type { transit_realtime } from 'gtfs-realtime-bindings';
import { normalizeId } from './shared/types.js';
import { LIMITS } from './config.js';
import { brusselsDate } from './time.js';

export const TR = gtfsrt.transit_realtime;
export type FeedMessage = transit_realtime.FeedMessage;
export type FeedMessageInit = transit_realtime.IFeedMessage;

/** [stop_sequence|null, stop_id normalisé, retard s|null, heure estimée epoch s|null, sauté 1|0] (voir RtResponse). */
export type Tuple = [number | null, string, number | null, number | null, 0 | 1];

export interface TripEntry { cancelled: boolean; u: Tuple[]; seen: number }

export interface IndexStats { entities: number; tripUpdates: number; withoutTripId: number; duplicates: number; deleted: number }

export interface TripIndex {
  feedTimestamp?: number;
  differential: boolean;
  trips: Map<string, TripEntry>;
  stats: IndexStats;
}

const own = (o: unknown, k: string): boolean => o != null && Object.prototype.hasOwnProperty.call(o, k);

/** Nombre depuis number, Long (protobufjs), bigint ou chaîne. */
export function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') {
    const n = Number(v);
    return v.trim() && Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'object' && typeof (v as { toNumber?: unknown }).toNumber === 'function') {
    const n = (v as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Secondes epoch ; une valeur manifestement en millisecondes est convertie. */
export function epochSeconds(v: unknown): number | null {
  const n = toNum(v);
  if (n == null) return null;
  return n > 1e11 ? Math.floor(n / 1000) : n;
}

const str = (v: unknown) => (v == null ? '' : String(v).trim());

export function decodeFeed(buf: Uint8Array): FeedMessage {
  return TR.FeedMessage.decode(buf);
}

export function encodeFeed(init: FeedMessageInit | Record<string, unknown>): Uint8Array {
  return TR.FeedMessage.encode(TR.FeedMessage.fromObject(init as Record<string, unknown>)).finish();
}

/* ------------------------------ Mises à jour de voyages ------------------------------ */

function eventField(ev: transit_realtime.TripUpdate.IStopTimeEvent | null | undefined, k: 'delay' | 'time'): number | null {
  if (!ev || !own(ev, k)) return null;
  return k === 'time' ? epochSeconds(ev.time) : toNum(ev.delay);
}

function toTuple(stu: transit_realtime.TripUpdate.IStopTimeUpdate): Tuple {
  const seq = own(stu, 'stopSequence') ? toNum(stu.stopSequence) : null;
  const props = stu.stopTimeProperties;
  const assigned = props && own(props, 'assignedStopId') ? str(props.assignedStopId) : '';
  const stopId = own(stu, 'stopId') ? str(stu.stopId) : '';
  const dep = stu.departure, arr = stu.arrival;
  const delay = eventField(dep, 'delay') ?? eventField(arr, 'delay');
  const time = eventField(dep, 'time') ?? eventField(arr, 'time');
  const skipped = own(stu, 'scheduleRelationship')
    && stu.scheduleRelationship === TR.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED ? 1 : 0;
  return [seq, normalizeId(assigned || stopId), delay, time, skipped];
}

interface Instance { startDate: string; ts: number | null; order: number; cancelled: boolean; u: Tuple[] }

/** Fusion de deux listes de mises à jour : `b` remplace les arrêts de `a` qu'il redonne. */
function mergeUpdates(a: Tuple[], b: Tuple[]): Tuple[] {
  const key = (t: Tuple) => (t[0] != null ? `#${t[0]}` : `@${t[1]}`);
  const m = new Map<string, Tuple>(a.map((t) => [key(t), t]));
  for (const t of b) m.set(key(t), t);
  const out = [...m.values()];
  if (out.every((t) => t[0] != null)) out.sort((x, y) => (x[0] as number) - (y[0] as number));
  return out;
}

/**
 * Doublons d'un même trip_id. Même date de départ (ou inconnue) : fusion, la mise à jour la plus récente
 * (timestamp, sinon ordre du flux) l'emporte. Dates différentes : celle du jour (Bruxelles), sinon la plus récente.
 */
function resolveDuplicates(list: Instance[], today: string): Instance {
  if (list.length === 1) return list[0];
  let pool = list;
  const dates = new Set(list.map((i) => i.startDate).filter(Boolean));
  if (dates.size > 1) {
    const pick = dates.has(today) ? today : [...dates].sort().at(-1)!;
    pool = list.filter((i) => i.startDate === pick || !i.startDate);
  }
  const sorted = [...pool].sort((a, b) => (a.ts ?? -Infinity) - (b.ts ?? -Infinity) || a.order - b.order);
  return sorted.reduce((acc, cur) => ({ ...cur, u: mergeUpdates(acc.u, cur.u) }));
}

export function indexTripUpdates(msg: FeedMessage, opts: { now: number; prev?: TripIndex }): TripIndex {
  const header = msg.header;
  const differential = own(header, 'incrementality')
    && header.incrementality === TR.FeedHeader.Incrementality.DIFFERENTIAL;
  const feedTimestamp = own(header, 'timestamp') ? epochSeconds(header.timestamp) : null;
  const stats: IndexStats = { entities: 0, tripUpdates: 0, withoutTripId: 0, duplicates: 0, deleted: 0 };
  const groups = new Map<string, Instance[]>();
  const deleted = new Set<string>();
  const CANCELED = TR.TripDescriptor.ScheduleRelationship.CANCELED;
  const DELETED = TR.TripDescriptor.ScheduleRelationship.DELETED;

  msg.entity.forEach((entity, order) => {
    stats.entities++;
    const tu = entity.tripUpdate;
    if (!tu) return;
    const trip = tu.trip;
    const rawId = trip && own(trip, 'tripId') ? str(trip.tripId) : '';
    if (own(entity, 'isDeleted') && entity.isDeleted) {
      stats.deleted++;
      if (rawId) deleted.add(normalizeId(rawId));
      return;
    }
    stats.tripUpdates++;
    if (!rawId) {
      stats.withoutTripId++;
      return;
    }
    const id = normalizeId(rawId);
    const rel = own(trip, 'scheduleRelationship') ? trip.scheduleRelationship : 0;
    const inst: Instance = {
      startDate: own(trip, 'startDate') ? str(trip.startDate) : '',
      ts: own(tu, 'timestamp') ? epochSeconds(tu.timestamp) : null,
      order,
      cancelled: rel === CANCELED || rel === DELETED,
      u: (tu.stopTimeUpdate ?? []).map(toTuple),
    };
    const list = groups.get(id);
    if (list) {
      list.push(inst);
      stats.duplicates++;
    } else {
      groups.set(id, [inst]);
    }
  });

  const trips = new Map<string, TripEntry>();
  if (differential && opts.prev) {
    // Flux incrémental : on part de l'état précédent connu de cette instance.
    for (const [id, e] of opts.prev.trips) if (opts.now - e.seen < LIMITS.differentialMaxAgeMs) trips.set(id, e);
    for (const id of deleted) trips.delete(id);
  }
  const today = brusselsDate(opts.now).replace(/-/g, '');
  for (const [id, list] of groups) {
    const inst = resolveDuplicates(list, today);
    trips.set(id, { cancelled: inst.cancelled, u: inst.u, seen: opts.now });
  }
  const index: TripIndex = { differential, trips, stats };
  if (feedTimestamp != null) index.feedTimestamp = feedTimestamp;
  return index;
}

/* ------------------------------ Alertes ------------------------------ */

export type Lang = 'fr' | 'nl' | 'en' | 'de';
const LANGS: readonly Lang[] = ['fr', 'nl', 'en', 'de'];

export interface AlertItem {
  id: string;
  routes: string[];
  stops: string[];
  header: Partial<Record<Lang, string>>;
  /** [début, fin] en secondes epoch ; 0 = borne absente (période ouverte). */
  active: [number, number][];
  /** Alerte de tout le réseau (agence ou type de transport sans ligne ni arrêt) : concerne tout filtre. */
  global: boolean;
}

function translations(ts: transit_realtime.ITranslatedString | null | undefined, defaultLang: Lang): Partial<Record<Lang, string>> {
  const out: Partial<Record<Lang, string>> = {};
  for (const t of ts?.translation ?? []) {
    const text = str(t.text);
    if (!text) continue;
    const code = own(t, 'language') ? str(t.language).toLowerCase() : '';
    const lang = (code ? code.slice(0, 2) : defaultLang) as Lang;
    if (LANGS.includes(lang) && !(lang in out)) out[lang] = text;
  }
  return out;
}

export function extractAlerts(msg: FeedMessage, defaultLang: Lang): AlertItem[] {
  const out: AlertItem[] = [];
  const seen = new Set<string>();
  msg.entity.forEach((entity, i) => {
    const a = entity.alert;
    if (!a || (own(entity, 'isDeleted') && entity.isDeleted)) return;
    let id = normalizeId(str(entity.id)) || `alerte-${i + 1}`;
    if (seen.has(id)) id = `${id}#${i + 1}`;
    seen.add(id);
    const routes = new Set<string>();
    const stops = new Set<string>();
    let global = false;
    for (const ie of a.informedEntity ?? []) {
      const route = own(ie, 'routeId') ? str(ie.routeId) : ie.trip && own(ie.trip, 'routeId') ? str(ie.trip.routeId) : '';
      const stop = own(ie, 'stopId') ? str(ie.stopId) : '';
      const tripId = ie.trip && own(ie.trip, 'tripId') ? str(ie.trip.tripId) : '';
      if (route) routes.add(normalizeId(route));
      if (stop) stops.add(normalizeId(stop));
      if (!route && !stop && !tripId) global = true;
    }
    let header = translations(a.headerText, defaultLang);
    if (!Object.keys(header).length) header = translations(a.descriptionText, defaultLang);
    const active = (a.activePeriod ?? []).map((p): [number, number] => [
      own(p, 'start') ? epochSeconds(p.start) ?? 0 : 0,
      own(p, 'end') ? epochSeconds(p.end) ?? 0 : 0,
    ]);
    out.push({ id, routes: [...routes], stops: [...stops], header, active, global });
  });
  return out;
}

export function isActive(alert: Pick<AlertItem, 'active'>, nowSec: number): boolean {
  if (!alert.active.length) return true;
  return alert.active.some(([s, e]) => (s === 0 || s <= nowSec) && (e === 0 || nowSec <= e));
}

/** Clé de gare SNCB : '8811601_2', 'S8811601' et '8811601' désignent la même gare. */
export const sncbStation = (id: string) => id.replace(/^S(?=\d)/, '').split('_')[0];
