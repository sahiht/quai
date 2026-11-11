/**
 * Traitement d'un flux GTFS d'un opérateur, en flux et en mémoire bornée :
 * calendrier -> lignes -> voyages actifs sur les dates couvertes -> arrêts -> traductions -> stop_times (en flux,
 * seuls les passages des voyages actifs sont gardés, en colonnes compactes) -> zones (zones de même nom
 * fusionnées, M8.3) -> fichiers de zone (motifs, un départ par voyage, M8.2) écrits au fil de l'eau -> résumés
 * (tuiles, recherche), pour la SNCB les trains du jour (-1 là où la montée ou la descente est interdite) et, pour
 * les réseaux urbains, les données des fichiers de ligne (lines.ts).
 */
import type { AreaFile, AreaSummary, Mode, Names, Op, TrainsDay } from '../../shared/types.ts';
import { normalizeId } from '../../shared/types.ts';
import { lineName, normalizeForSearch } from '../../shared/names.ts';
import { readTable } from './csv.ts';
import type { TableOptions } from './csv.ts';
import { DAY_COLUMNS, ServiceCalendar } from './calendar.ts';
import { parseGtfsTime } from './dates.ts';
import { Translations, delijnFrFromRefs, langOf, platformOf, resolveNames, rtIdOf, splitPlatform } from './naming.ts';
import type { RefNames } from './naming.ts';
import { areaFileKey, groupAreas, nameKey } from './areas.ts';
import type { StopRec } from './areas.ts';
import { LineCollector } from './lines.ts';
import type { LineData, TripPosition } from './lines.ts';
import { MODE_BIT, MODE_RANK, compareLines, modeOf, modesFromMask } from './modes.ts';
import { OP_LABEL } from './config.ts';
import { StopTimeStore } from './store.ts';
import type { JsonWriter } from './writer.ts';
import { openGtfsZip } from './zip.ts';
import type { GtfsZip } from './zip.ts';

export class FeedError extends Error {}

/** Nombre maximal de zones dans patterns[].next. */
export const MAX_NEXT = 60;
/** Nombre maximal de lignes dans AreaSummary.lines. */
export const MAX_LINES = 12;

export interface FeedStats {
  tripsInFeed: number;
  stopTimesRows: number;
  keptRows: number;
  deps: number;
  patterns: number;
  storeMB: number;
  ms: number;
}

export interface FeedResult {
  op: Op;
  feedVersion?: string;
  /** Voyages retenus (actifs sur au moins une des dates, avec au moins deux arrêts). */
  trips: number;
  /** Zones écrites dans areas/{op}/. */
  areas: AreaSummary[];
  /** Identifiants des zones sans aucun départ : écrites dans areas/, mais absentes des tuiles et de la recherche (S5). */
  idle: string[];
  /** SNCB uniquement : un fichier de trains par date couverte. */
  trains?: TrainsDay[];
  /** Réseaux urbains : lignes des fichiers de ligne, sans les correspondances (ajoutées par build.ts). */
  lines?: LineData[];
  stats: FeedStats;
  warnings: string[];
}

export interface FeedOptions {
  op: Op;
  zipPath: string;
  /** Dates de service couvertes (jour 0, jour 1). */
  dates: string[];
  writer: JsonWriter;
  log?: (msg: string) => void;
  /** De Lijn : noms traduits des zones SNCB et STIB déjà préparées (nom français d'une zone voisine de même nom). */
  refNames?: RefNames;
  /** Réseaux urbains : préparer les fichiers de ligne (défaut : oui). */
  lines?: boolean;
}

/** normalizeId() sans regex quand l'identifiant ne peut pas être préfixé (chemin chaud de stop_times). */
function normId(s: string): string {
  return s.length > 3 && s.charCodeAt(2) === 58 ? normalizeId(s) : s;
}

export const round5 = (x: number): number => Math.round(x * 1e5) / 1e5;

const MINUTE_MAX = 32000; // tient dans un Int16Array (plus de 500 h)
/** Facteur du jour dans la clé de tri des départs (doit dépasser MINUTE_MAX). */
const DAY_FACTOR = 40000;

function clampTime(m: number): number {
  return m > MINUTE_MAX ? -1 : m;
}

async function readFile(zip: GtfsZip, file: string, columns: readonly string[], onRow: (v: string[]) => void, opts?: TableOptions) {
  const stream = await zip.open(file);
  try {
    return await readTable(stream, file, columns, onRow, opts);
  } finally {
    stream.destroy();
  }
}

/** Complète les heures manquantes d'un voyage (arrivée = départ, interpolation linéaire par rang). Faux si inutilisable. */
export function fillTimes(arr: Int16Array, dep: Int16Array, a: number, b: number): boolean {
  for (let i = a; i < b; i++) {
    if (arr[i] < 0 && dep[i] >= 0) arr[i] = dep[i];
    else if (dep[i] < 0 && arr[i] >= 0) dep[i] = arr[i];
  }
  if (dep[a] < 0 || arr[b - 1] < 0) return false;
  let prev = a;
  for (let i = a + 1; i < b; i++) {
    if (dep[i] < 0) continue;
    const gap = i - prev;
    if (gap > 1) {
      const t0 = dep[prev];
      const t1 = arr[i];
      for (let k = prev + 1; k < i; k++) {
        const m = Math.round(t0 + ((t1 - t0) * (k - prev)) / gap);
        arr[k] = m;
        dep[k] = m;
      }
    }
    prev = i;
  }
  return true;
}

function popcount2(m: number): number {
  return (m & 1) + ((m >> 1) & 1);
}

export async function processFeed(o: FeedOptions): Promise<FeedResult> {
  const t0 = Date.now();
  const { op, dates, writer } = o;
  const log = o.log ?? (() => undefined);
  const warnings: string[] = [];
  const zip = await openGtfsZip(o.zipPath);
  try {
    for (const f of ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt']) {
      if (!zip.has(f)) throw new FeedError(`fichier GTFS obligatoire absent : ${f}`);
    }
    if (!zip.has('calendar.txt') && !zip.has('calendar_dates.txt')) {
      throw new FeedError('ni calendar.txt ni calendar_dates.txt dans le flux');
    }

    /* 1. version du flux */
    let feedVersion: string | undefined;
    if (zip.has('feed_info.txt')) {
      await readFile(zip, 'feed_info.txt', ['feed_version'], (v) => {
        if (feedVersion === undefined && v[0]) feedVersion = v[0];
      });
    }

    /* 2. calendrier : services actifs sur les dates couvertes */
    const cal = new ServiceCalendar(dates);
    if (zip.has('calendar.txt')) {
      await readFile(zip, 'calendar.txt', ['service_id', ...DAY_COLUMNS, 'start_date', 'end_date'], (v) => {
        cal.addCalendar(v[0], [v[1] === '1', v[2] === '1', v[3] === '1', v[4] === '1', v[5] === '1', v[6] === '1', v[7] === '1'], v[8], v[9]);
      }, { required: ['service_id'] });
    }
    if (zip.has('calendar_dates.txt')) {
      await readFile(zip, 'calendar_dates.txt', ['service_id', 'date', 'exception_type'], (v) => {
        cal.addException(v[0], v[1], Number(v[2]));
      }, { required: ['service_id', 'date', 'exception_type'] });
    }

    /* 3. lignes */
    const routeIndex = new Map<string, number>();
    const routeId: string[] = [];
    const routeShort: string[] = [];
    const routeMode: Mode[] = [];
    await readFile(zip, 'routes.txt', ['route_id', 'route_short_name', 'route_long_name', 'route_type'], (v) => {
      const id = normId(v[0]);
      if (routeIndex.has(id)) return;
      routeIndex.set(id, routeId.length);
      routeId.push(id);
      const mode = modeOf(v[3] === '' ? 3 : Number(v[3]));
      routeShort.push(lineName(v[1] || v[2] || id, mode) || id);
      routeMode.push(mode);
    }, { required: ['route_id'] });

    /* 4. voyages actifs sur au moins une des dates */
    const tripIndex = new Map<string, number>();
    const tripId: string[] = [];
    const tripRoute: number[] = [];
    const tripMask: number[] = [];
    const tripHead: string[] = [];
    const tripDir: number[] = [];
    const tripShort: string[] = [];
    let tripsInFeed = 0;
    let tripsNoRoute = 0;
    await readFile(zip, 'trips.txt', ['trip_id', 'route_id', 'service_id', 'trip_headsign', 'direction_id', 'trip_short_name'], (v) => {
      tripsInFeed++;
      const mask = cal.mask(v[2]);
      if (!mask) return;
      const r = routeIndex.get(normId(v[1]));
      if (r === undefined) {
        tripsNoRoute++;
        return;
      }
      const id = normId(v[0]);
      if (!id || tripIndex.has(id)) return;
      tripIndex.set(id, tripId.length);
      tripId.push(id);
      tripRoute.push(r);
      tripMask.push(mask);
      tripHead.push(v[3]);
      tripDir.push(v[4] === '' ? -1 : Number(v[4]) || 0);
      tripShort.push(v[5]);
    }, { required: ['trip_id', 'route_id', 'service_id'] });
    const nTrips = tripId.length;
    if (tripsNoRoute) warnings.push(`${tripsNoRoute} voyage(s) avec une ligne inconnue ignoré(s)`);

    /* 5. arrêts */
    const stops: StopRec[] = [];
    const stopIndex = new Map<string, number>();
    await readFile(zip, 'stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'location_type', 'parent_station', 'platform_code'], (v) => {
      const id = normId(v[0]);
      if (!id || stopIndex.has(id)) return;
      stopIndex.set(id, stops.length);
      stops.push({
        id, name: v[1], lat: parseFloat(v[2]), lon: parseFloat(v[3]),
        loc: v[4] === '' ? 0 : Number(v[4]) || 0, parent: v[5] ? normId(v[5]) : '', pcode: v[6],
      });
    }, { required: ['stop_id'] });

    /* 6. traductions (arrêts et destinations, fr et nl) */
    const tr = new Translations();
    if (zip.has('translations.txt')) {
      let format: 'new' | 'old' | null = null;
      await readFile(zip, 'translations.txt', ['table_name', 'field_name', 'language', 'translation', 'record_id', 'field_value', 'trans_id', 'lang'], (v) => {
        if (format === 'new') {
          const lang = langOf(v[2]);
          if (!lang || !v[3]) return;
          const isStop = v[0] === 'stops' && v[1] === 'stop_name';
          const isHead = v[0] === 'trips' && v[1] === 'trip_headsign';
          if (!isStop && !isHead) return;
          if (v[4]) {
            const rid = normId(v[4]);
            if (isHead && !tripIndex.has(rid)) return; // voyage inactif : inutile de garder
            tr.addRecord(v[0], v[1], rid, lang, v[3]);
          } else if (v[5]) {
            tr.addValue(v[0], v[1], v[5], lang, v[3]);
          }
        } else if (format === 'old') {
          const lang = langOf(v[7]);
          if (lang && v[6] && v[3]) tr.addText(v[6], lang, v[3]);
        }
      }, {
        onHeader: (h) => {
          format = h.includes('table_name') ? 'new' : h.includes('trans_id') ? 'old' : null;
          if (!format) warnings.push('translations.txt : format inconnu, ignoré');
        },
      });
    }

    /* 7. horaires, en flux : seuls les voyages actifs sont gardés */
    const st = new StopTimeStore();
    let rows = 0;
    let missingStop = 0;
    let badSeq = 0;
    await readFile(zip, 'stop_times.txt', ['trip_id', 'stop_id', 'stop_sequence', 'arrival_time', 'departure_time', 'pickup_type', 'drop_off_type'], (v) => {
      rows++;
      const t = tripIndex.get(normId(v[0]));
      if (t === undefined) return;
      const s = stopIndex.get(normId(v[1]));
      if (s === undefined) {
        missingStop++;
        return;
      }
      const seq = parseInt(v[2], 10);
      if (!(seq >= 0)) {
        badSeq++;
        return;
      }
      st.push(t, s, seq, clampTime(parseGtfsTime(v[3])), clampTime(parseGtfsTime(v[4])), (v[5] === '1' ? 1 : 0) | (v[6] === '1' ? 2 : 0));
    }, {
      required: ['trip_id', 'stop_id', 'stop_sequence'],
      onHeader: (h) => {
        if (!h.includes('arrival_time') && !h.includes('departure_time')) {
          throw new FeedError('stop_times.txt : ni arrival_time ni departure_time');
        }
      },
    });
    if (missingStop) warnings.push(`${missingStop} passage(s) vers un arrêt inconnu ignoré(s)`);
    if (badSeq) warnings.push(`${badSeq} passage(s) sans stop_sequence valide ignoré(s)`);
    if (zip.has('frequencies.txt')) warnings.push('frequencies.txt présent mais non pris en charge (voyages à fréquence comptés une seule fois)');
    zip.close();

    const start = st.sortByTrip(nTrips);
    const n = st.length;
    const valid = new Uint8Array(nTrips);
    let validTrips = 0;
    let droppedTrips = 0;
    for (let t = 0; t < nTrips; t++) {
      const a = start[t];
      const b = start[t + 1];
      if (b - a < 2 || !fillTimes(st.arr, st.dep, a, b)) {
        if (b > a) droppedTrips++;
        continue;
      }
      valid[t] = 1;
      validTrips++;
    }
    if (droppedTrips) warnings.push(`${droppedTrips} voyage(s) inutilisable(s) (moins de deux arrêts ou horaires absents)`);

    /* 8. zones (départs par arrêt : choix de la clé stable d'une zone fusionnée) */
    const used = new Uint8Array(stops.length);
    for (let i = 0; i < n; i++) if (valid[st.trip[i]]) used[st.stop[i]] = 1;
    const depCount = new Float64Array(stops.length);
    for (let t = 0; t < nTrips; t++) {
      if (!valid[t]) continue;
      const days = popcount2(tripMask[t]);
      for (let r = start[t]; r < start[t + 1] - 1; r++) if ((st.flags[r] & 1) === 0) depCount[st.stop[r]] += days;
    }
    const { areas, stopArea } = groupAreas(op, stops, used, depCount);
    const nA = areas.length;

    // passages par zone (tri par comptage ; dans chaque zone, ordre voyage puis stop_sequence)
    const areaStart = new Int32Array(nA + 1);
    let noArea = 0;
    for (let i = 0; i < n; i++) {
      if (!valid[st.trip[i]]) continue;
      const a = stopArea[st.stop[i]];
      if (a < 0) noArea++;
      else areaStart[a + 1]++;
    }
    for (let a = 0; a < nA; a++) areaStart[a + 1] += areaStart[a];
    const fillPos = areaStart.slice(0, nA);
    const areaRows = new Int32Array(areaStart[nA]);
    for (let i = 0; i < n; i++) {
      if (!valid[st.trip[i]]) continue;
      const a = stopArea[st.stop[i]];
      if (a >= 0) areaRows[fillPos[a]++] = i;
    }
    if (noArea) warnings.push(`${noArea} passage(s) à un arrêt sans position ignoré(s)`);

    // zones desservies, dans l'ordre des clés
    const candidates: number[] = [];
    for (let a = 0; a < nA; a++) if (areaStart[a + 1] > areaStart[a]) candidates.push(a);
    candidates.sort((x, y) => (areas[x].key < areas[y].key ? -1 : areas[x].key > areas[y].key ? 1 : 0));
    // nom de fichier déjà pris (identifiants hors [A-Za-z0-9_-]) : zone écartée avant toute référence
    const fileKeyOf: string[] = new Array<string>(nA);
    const takenKeys = new Set<string>();
    const served: number[] = [];
    for (const a of candidates) {
      const fk = areaFileKey(areas[a].key);
      if (takenKeys.has(fk)) {
        warnings.push(`zone ${op}:${areas[a].key} ignorée : nom de fichier ${fk}.json déjà utilisé`);
        for (const s of areas[a].members) stopArea[s] = -1;
        continue;
      }
      takenKeys.add(fk);
      fileKeyOf[a] = fk;
      served.push(a);
    }
    const areaIdStr: string[] = new Array<string>(nA);
    const areaNames: Names[] = new Array<Names>(nA);
    // noms des zones (nom d'origine, fr, nl) : une destination égale au nom d'une zone reprend ses noms (S5)
    const zoneByName = new Map<string, Names>();
    let refFr = 0;
    for (const a of served) {
      const area = areas[a];
      areaIdStr[a] = `${op}:${area.key}`;
      const s = stops[area.nameStop];
      const trans = tr.get('stops', 'stop_name', s.id, s.name);
      let names = resolveNames(op, s.name, trans, true);
      if (!names.fr || !names.nl) names = { ...names, fr: names.fr || names.nl || area.key, nl: names.nl || names.fr || area.key };
      if (op === 'delijn' && !trans?.fr) {
        // nom français d'une zone SNCB ou STIB voisine de même nom néerlandais (« Porte de Hal, Saint-Gilles »)
        const fr = delijnFrFromRefs(names.nl, area.lat, area.lon, o.refNames);
        if (fr && fr !== names.fr) {
          names = { ...names, fr };
          refFr++;
        }
      }
      areaNames[a] = names;
      for (const k of [nameKey(s.name), normalizeForSearch(names.fr), normalizeForSearch(names.nl)]) {
        if (k && !zoneByName.has(k)) zoneByName.set(k, names);
      }
    }
    if (refFr) log(`${OP_LABEL[op]} : ${refFr} nom(s) français repris d'une zone SNCB ou STIB voisine`);

    /* 9. destinations : nom d'une zone du même réseau, sinon traductions, sinon règles de shared/names.ts */
    const headCache = new Map<string, Names>();
    const zoneHead = new Map<string, Names | null>();
    const headOf = (t: number): Names => {
      const raw = tripHead[t].trim();
      if (!raw) {
        const last = stopArea[st.stop[start[t + 1] - 1]];
        return last >= 0 && areaNames[last] ? areaNames[last] : { fr: '', nl: '' };
      }
      let zone = zoneHead.get(raw);
      if (zone === undefined) {
        zone = zoneByName.get(normalizeForSearch(splitPlatform(raw).base)) ?? null;
        zoneHead.set(raw, zone);
      }
      if (zone) return zone;
      if (tr.record('trips', 'trip_headsign', tripId[t])) {
        return resolveNames(op, raw, tr.get('trips', 'trip_headsign', tripId[t], raw), false);
      }
      let h = headCache.get(raw);
      if (h) return h;
      h = resolveNames(op, raw, tr.get('trips', 'trip_headsign', undefined, raw), false);
      headCache.set(raw, h);
      return h;
    };

    /* 9 bis. SNCB : un même train publié deux fois (même numéro, mêmes arrêts, mêmes heures) n'est gardé qu'une fois
       par jour, de préférence celui dont la destination est le terminus (M8.2) */
    if (op === 'sncb') {
      const groups = new Map<string, number[]>();
      for (let t = 0; t < nTrips; t++) {
        if (!valid[t]) continue;
        let key = `${tripRoute[t]}\u0001${tripShort[t]}`;
        for (let r = start[t]; r < start[t + 1]; r++) key += `\u0001${st.stop[r]}:${st.arr[r]}:${st.dep[r]}`;
        const g = groups.get(key);
        if (g) g.push(t);
        else groups.set(key, [t]);
      }
      let dropped = 0;
      for (const g of groups.values()) {
        if (g.length < 2) continue;
        const lastArea = stopArea[st.stop[start[g[0] + 1] - 1]];
        const term = lastArea >= 0 ? areaNames[lastArea] : undefined;
        const toTerminus = (t: number) => {
          if (!term) return false;
          const h = headOf(t);
          return normalizeForSearch(h.fr) === normalizeForSearch(term.fr) || normalizeForSearch(h.nl) === normalizeForSearch(term.nl);
        };
        for (let d = 0; d < dates.length && d < 2; d++) {
          const same = g.filter((t) => tripMask[t] & (1 << d));
          if (same.length < 2) continue;
          const keep = same.reduce((best, t) => {
            const a = toTerminus(t);
            const b = toTerminus(best);
            if (a !== b) return a ? t : best;
            return tripId[t] < tripId[best] ? t : best;
          });
          for (const t of same) if (t !== keep) tripMask[t] &= ~(1 << d);
        }
        for (const t of g) {
          if (!tripMask[t]) {
            valid[t] = 0;
            validTrips--;
            dropped++;
          }
        }
      }
      if (dropped) warnings.push(`${dropped} train(s) en double écarté(s) (même numéro, mêmes arrêts et mêmes heures)`);
    }

    /* 10. formes de voyage : ligne + direction + destination + suite des zones */
    const shapeOf = new Int32Array(nTrips).fill(-1);
    {
      const shapeIds = new Map<string, number>();
      for (let t = 0; t < nTrips; t++) {
        if (!valid[t]) continue;
        let key = `${tripRoute[t]}\u0001${tripDir[t]}\u0001${tripHead[t]}\u0001`;
        for (let r = start[t]; r < start[t + 1]; r++) key += stopArea[st.stop[r]] + ',';
        let id = shapeIds.get(key);
        if (id === undefined) {
          id = shapeIds.size;
          shapeIds.set(key, id);
        }
        shapeOf[t] = id;
      }
    }

    const nextOf = (r: number, t: number, a: number): [string, number][] => {
      const out: [string, number][] = [];
      const seen = new Set<number>([a]);
      const d0 = st.dep[r];
      const end = start[t + 1];
      for (let k = r + 1; k < end && out.length < MAX_NEXT; k++) {
        if (st.flags[k] & 2) continue; // pas de descente possible
        const b = stopArea[st.stop[k]];
        if (b < 0 || seen.has(b)) continue;
        seen.add(b);
        out.push([areaIdStr[b], Math.max(0, (st.arr[k] >= 0 ? st.arr[k] : st.dep[k]) - d0)]);
      }
      return out;
    };

    /* 11. fichiers de zone. Départs (M8.2) : un par voyage et par zone, pris dans la première suite de passages
       consécutifs dans la zone qui permet de monter vers une autre zone (dernier arrêt de la suite où la montée
       est permise) ; aucun départ vers un terminus situé dans la zone même (next vide) ; doublons (même jour,
       même minute, même arrêt, même ligne, même destination) écartés. */
    const summaries: AreaSummary[] = [];
    const idle: string[] = [];
    let depsTotal = 0;
    let patternsTotal = 0;
    let dupDeps = 0;
    const nDays = dates.length;
    type Pat = AreaFile['patterns'][number];
    for (const a of served) {
      const area = areas[a];
      const fileKey = fileKeyOf[a];
      const rs = areaRows.subarray(areaStart[a], areaStart[a + 1]);
      // motif = forme du voyage + rang ici, calculé une fois par forme
      const patCache = new Map<string, Pat>();
      const patOf = (r: number, t: number): Pat => {
        const pk = `${shapeOf[t]}:${r - start[t]}`;
        let p = patCache.get(pk);
        if (!p) {
          const ri = tripRoute[t];
          p = { line: routeShort[ri], mode: routeMode[ri], route: routeId[ri], head: headOf(t), next: nextOf(r, t, a) };
          patCache.set(pk, p);
        }
        return p;
      };
      let modeMask = 0;
      const depRows: number[] = [];
      for (let i = 0; i < rs.length;) {
        const t = st.trip[rs[i]];
        let j = i + 1;
        while (j < rs.length && st.trip[rs[j]] === t) j++;
        if (valid[t]) {
          modeMask |= MODE_BIT[routeMode[tripRoute[t]]];
          const end = start[t + 1];
          for (let k = i; k < j;) {
            let e = k;
            while (e + 1 < j && rs[e + 1] === rs[e] + 1) e++;
            let cand = -1;
            for (let q = e; q >= k && cand < 0; q--) if ((st.flags[rs[q]] & 1) === 0 && rs[q] + 1 < end) cand = rs[q];
            k = e + 1;
            if (cand >= 0 && patOf(cand, t).next.length) {
              depRows.push(cand);
              break;
            }
          }
        }
        i = j;
      }
      let nKeys = 0;
      for (const r of depRows) nKeys += popcount2(tripMask[st.trip[r]]);
      const keys = new Float64Array(nKeys);
      let k = 0;
      for (const r of depRows) {
        const t = st.trip[r];
        for (let d = 0; d < nDays && d < 2; d++) if (tripMask[t] & (1 << d)) keys[k++] = (d * DAY_FACTOR + st.dep[r]) * n + r;
      }
      keys.sort();

      const localStop = new Map<number, number>();
      area.members.forEach((s, i) => localStop.set(s, i));
      const stopsOut: AreaFile['stops'] = area.members.map((s) => {
        const sr = stops[s];
        const platform = platformOf(op, sr.id, sr.name, sr.pcode);
        return platform ? { id: sr.id, platform, rt: rtIdOf(op, sr.id) } : { id: sr.id, rt: rtIdOf(op, sr.id) };
      });

      // deux formes qui ne diffèrent qu'en amont donnent le même contenu (ligne, destination, suite) :
      // elles partagent alors une seule entrée de patterns.
      const patIndex = new Map<Pat, number>();
      const patByContent = new Map<string, number>();
      const patterns: AreaFile['patterns'] = [];
      const deps: AreaFile['deps'] = [];
      const seen = new Set<string>();
      const lineCount = new Map<string, number>();
      const lineMode = new Map<string, Mode>();
      for (let i = 0; i < nKeys; i++) {
        const key = keys[i];
        const r = key % n;
        const rest = (key - r) / n;
        const m = rest % DAY_FACTOR;
        const d = (rest - m) / DAY_FACTOR;
        const t = st.trip[r];
        const ri = tripRoute[t];
        const p = patOf(r, t);
        const stopIdx = localStop.get(st.stop[r]) ?? 0;
        const dk = `${d}|${m}|${stopIdx}|${p.line}|${p.head.fr}`;
        if (seen.has(dk)) {
          dupDeps++;
          continue;
        }
        seen.add(dk);
        let pi = patIndex.get(p);
        if (pi === undefined) {
          const content = JSON.stringify(p);
          pi = patByContent.get(content);
          if (pi === undefined) {
            pi = patterns.length;
            patterns.push(p);
            patByContent.set(content, pi);
          }
          patIndex.set(p, pi);
        }
        deps.push([d, m, pi, stopIdx, op === 'stib' ? '' : tripId[t], st.seq[r]]);
        lineCount.set(routeShort[ri], (lineCount.get(routeShort[ri]) ?? 0) + 1);
        if (!lineMode.has(routeShort[ri])) lineMode.set(routeShort[ri], routeMode[ri]);
      }
      const id = areaIdStr[a];
      if (!deps.length) {
        // zone sans départ (terminus, arrivée seule) : lignes qui y arrivent ; absente des tuiles et de la recherche
        idle.push(id);
        for (let i = 0; i < rs.length; i++) {
          const t = st.trip[rs[i]];
          if (!valid[t]) continue;
          const ri = tripRoute[t];
          lineCount.set(routeShort[ri], (lineCount.get(routeShort[ri]) ?? 0) + 1);
          if (!lineMode.has(routeShort[ri])) lineMode.set(routeShort[ri], routeMode[ri]);
        }
      }
      const lines = [...lineCount.entries()]
        .sort((x, y) => y[1] - x[1] || compareLines(x[0], y[0]))
        .slice(0, MAX_LINES)
        .map(([l]) => l)
        .sort((x, y) => MODE_RANK.indexOf(lineMode.get(x) ?? 'bus') - MODE_RANK.indexOf(lineMode.get(y) ?? 'bus') || compareLines(x, y));

      const n2 = areaNames[a];
      const lat = round5(area.lat);
      const lon = round5(area.lon);
      const file: AreaFile = { v: 1, id, op, n: n2, lat, lon, stops: stopsOut, patterns, deps };
      await writer.write(`areas/${op}/${fileKey}.json`, file);
      const summary: AreaSummary = { id, op, n: n2, lat, lon, modes: modesFromMask(modeMask), lines };
      if (area.aka?.length) summary.aka = area.aka.map((key) => `${op}:${key}`);
      summaries.push(summary);
      depsTotal += deps.length;
      patternsTotal += patterns.length;
    }
    if (dupDeps) warnings.push(`${dupDeps} départ(s) en double écarté(s) (même ligne, destination, minute et arrêt)`);
    const merged = summaries.filter((s) => s.aka).length;
    if (merged) log(`${OP_LABEL[op]} : ${merged} zone(s) fusionnée(s) avec des zones de même nom à moins de 300 m`);

    /* 12. SNCB : trains de chaque jour */
    let trains: TrainsDay[] | undefined;
    if (op === 'sncb') {
      const platformCache = new Map<number, string>();
      const platformAt = (s: number): string => {
        let p = platformCache.get(s);
        if (p === undefined) {
          const sr = stops[s];
          p = platformOf(op, sr.id, sr.name, sr.pcode) ?? '';
          platformCache.set(s, p);
        }
        return p;
      };
      trains = dates.map((date, d): TrainsDay => {
        const stationIdx = new Map<number, number>();
        const stations: TrainsDay['stations'] = [];
        const list: number[] = [];
        for (let t = 0; t < nTrips; t++) if (valid[t] && tripMask[t] & (1 << d)) list.push(t);
        list.sort((x, y) => st.dep[start[x]] - st.dep[start[y]] || (tripId[x] < tripId[y] ? -1 : tripId[x] > tripId[y] ? 1 : 0));
        const trips: TrainsDay['trips'] = list.map((t) => {
          const s: TrainsDay['trips'][number]['s'] = [];
          for (let r = start[t]; r < start[t + 1]; r++) {
            const a = stopArea[st.stop[r]];
            if (a < 0 || areaIdStr[a] === undefined) continue;
            let si = stationIdx.get(a);
            if (si === undefined) {
              si = stations.length;
              stationIdx.set(a, si);
              stations.push({ id: areaIdStr[a], n: areaNames[a], lat: round5(areas[a].lat), lon: round5(areas[a].lon) });
            }
            // 1.1 : -1 = descente interdite (drop_off_type 1) ou montée interdite (pickup_type 1)
            const f = st.flags[r];
            s.push([si, f & 2 ? -1 : st.arr[r], f & 1 ? -1 : st.dep[r], platformAt(st.stop[r]), st.seq[r]]);
          }
          const num = tripShort[t];
          return num
            ? { id: tripId[t], cat: routeShort[tripRoute[t]], num, head: headOf(t), s }
            : { id: tripId[t], cat: routeShort[tripRoute[t]], head: headOf(t), s };
        });
        return { v: 1, date, stations, trips };
      });
    }

    /* 13. réseaux urbains : données des fichiers de ligne (design-routing.md § 3.1). Deux arrêts consécutifs dans la
       même zone donnent une seule position (première descente permise, dernière montée permise). */
    let lines: LineData[] | undefined;
    if (op !== 'sncb' && o.lines !== false) {
      const col = new LineCollector(op);
      const runs: { a: number; first: number; pick: number; drop: number }[] = [];
      // voyages par premier départ puis trip_id (rangs de `trips` et ordre des motifs stables, comme gen-fixtures du cœur)
      const order: number[] = [];
      for (let t = 0; t < nTrips; t++) if (valid[t]) order.push(t);
      order.sort((x, y) => st.dep[start[x]] - st.dep[start[y]] || (tripId[x] < tripId[y] ? -1 : tripId[x] > tripId[y] ? 1 : 0));
      for (const t of order) {
        const days: number[] = [];
        for (let d = 0; d < nDays && d < 2; d++) if (tripMask[t] & (1 << d)) days.push(d);
        if (!days.length) continue;
        runs.length = 0;
        for (let r = start[t]; r < start[t + 1]; r++) {
          const a = stopArea[st.stop[r]];
          if (a < 0 || areaIdStr[a] === undefined) continue;
          const f = st.flags[r];
          const last = runs[runs.length - 1];
          if (last && last.a === a) {
            if ((f & 1) === 0) last.pick = r;
            if ((f & 2) === 0 && last.drop < 0) last.drop = r;
          } else {
            runs.push({ a, first: r, pick: f & 1 ? -1 : r, drop: f & 2 ? -1 : r });
          }
        }
        if (runs.length < 2) continue;
        const positions: TripPosition[] = runs.map((u, i) => {
          const board = i < runs.length - 1 && u.pick >= 0;
          const alight = i > 0 && u.drop >= 0;
          const row = board ? u.pick : alight ? u.drop : u.first;
          return {
            area: u.a,
            time: board ? st.dep[row] : st.arr[row],
            flag: board ? (alight ? 'x' : 'b') : alight ? 'a' : 'n',
            rt: rtIdOf(op, stops[st.stop[row]].id),
          };
        });
        const ri = tripRoute[t];
        col.addTrip(ri, { id: routeId[ri], line: routeShort[ri], mode: routeMode[ri] }, tripDir[t], headOf(t), positions, days,
          op === 'stib' ? undefined : tripId[t]);
      }
      lines = col.finish((a) => [areaIdStr[a], round5(areas[a].lat), round5(areas[a].lon), areaNames[a]]);
    }

    const stats: FeedStats = {
      tripsInFeed, stopTimesRows: rows, keptRows: n, deps: depsTotal, patterns: patternsTotal,
      storeMB: Math.round(st.bytes() / 1048576), ms: Date.now() - t0,
    };
    const linesText = lines ? `, ${lines.length} lignes` : '';
    log(`${OP_LABEL[op]} : ${validTrips} voyages retenus sur ${tripsInFeed}, ${n} passages gardés sur ${rows} lus, ${summaries.length} zones, ${depsTotal} départs${linesText} (${(stats.ms / 1000).toFixed(1).replace('.', ',')} s)`);
    for (const w of warnings) log(`${OP_LABEL[op]} : attention, ${w}`);
    return { op, feedVersion, trips: validTrips, areas: summaries, idle, trains, lines, stats, warnings };
  } finally {
    zip.close();
  }
}
