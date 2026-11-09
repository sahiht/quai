/**
 * Traitement d'un flux GTFS d'un opérateur, en flux et en mémoire bornée :
 * calendrier -> lignes -> voyages actifs sur les dates couvertes -> arrêts -> traductions -> stop_times (en flux,
 * seuls les passages des voyages actifs sont gardés, en colonnes compactes) -> zones -> fichiers de zone
 * (motifs, départs) écrits au fil de l'eau -> résumés (tuiles, recherche) et, pour la SNCB, trains du jour.
 */
import type { AreaFile, AreaSummary, Mode, Names, Op, TrainsDay } from '../../shared/types.ts';
import { normalizeId } from '../../shared/types.ts';
import { readTable } from './csv.ts';
import type { TableOptions } from './csv.ts';
import { DAY_COLUMNS, ServiceCalendar } from './calendar.ts';
import { parseGtfsTime } from './dates.ts';
import { Translations, langOf, platformOf, resolveNames, rtIdOf } from './naming.ts';
import { areaFileKey, groupAreas } from './areas.ts';
import type { StopRec } from './areas.ts';
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
  /** SNCB uniquement : un fichier de trains par date couverte. */
  trains?: TrainsDay[];
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
      routeShort.push(v[1] || v[2] || id);
      routeMode.push(modeOf(v[3] === '' ? 3 : Number(v[3])));
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

    /* 8. zones */
    const used = new Uint8Array(stops.length);
    for (let i = 0; i < n; i++) if (valid[st.trip[i]]) used[st.stop[i]] = 1;
    const { areas, stopArea } = groupAreas(op, stops, used);
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
    const stationNames = new Map<string, Names>();
    for (const a of served) {
      const area = areas[a];
      areaIdStr[a] = `${op}:${area.key}`;
      const s = stops[area.nameStop];
      let names = resolveNames(op, s.name, tr.get('stops', 'stop_name', s.id, s.name), true);
      if (!names.fr || !names.nl) names = { ...names, fr: names.fr || names.nl || area.key, nl: names.nl || names.fr || area.key };
      areaNames[a] = names;
      if (op === 'sncb' && s.name) stationNames.set(s.name.trim(), names);
    }

    /* 9. destinations */
    const headCache = new Map<string, Names>();
    const headOf = (t: number): Names => {
      const raw = tripHead[t].trim();
      if (tr.record('trips', 'trip_headsign', tripId[t])) {
        return resolveNames(op, raw, tr.get('trips', 'trip_headsign', tripId[t], raw), false);
      }
      if (!raw) {
        const last = stopArea[st.stop[start[t + 1] - 1]];
        return last >= 0 ? areaNames[last] : { fr: '', nl: '' };
      }
      let h = headCache.get(raw);
      if (h) return h;
      if (op === 'sncb') h = stationNames.get(raw);
      h ??= resolveNames(op, raw, tr.get('trips', 'trip_headsign', undefined, raw), false);
      headCache.set(raw, h);
      return h;
    };

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

    /* 11. fichiers de zone */
    const summaries: AreaSummary[] = [];
    let depsTotal = 0;
    let patternsTotal = 0;
    const nDays = dates.length;
    for (const a of served) {
      const area = areas[a];
      const fileKey = fileKeyOf[a];
      const rs = areaRows.subarray(areaStart[a], areaStart[a + 1]);
      const isDep = (r: number) => r + 1 < start[st.trip[r] + 1] && (st.flags[r] & 1) === 0;
      let modeMask = 0;
      let nDep = 0;
      for (let i = 0; i < rs.length; i++) {
        const r = rs[i];
        const t = st.trip[r];
        modeMask |= MODE_BIT[routeMode[tripRoute[t]]];
        if (isDep(r)) nDep += popcount2(tripMask[t]);
      }
      const keys = new Float64Array(nDep);
      let k = 0;
      for (let i = 0; i < rs.length; i++) {
        const r = rs[i];
        if (!isDep(r)) continue;
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

      // motif = forme du voyage + rang ici ; deux formes qui ne diffèrent qu'en amont donnent le même contenu
      // (ligne, destination, suite) : elles partagent alors une seule entrée de patterns.
      const patIndex = new Map<string, number>();
      const patByContent = new Map<string, number>();
      const patterns: AreaFile['patterns'] = [];
      const deps: AreaFile['deps'] = new Array(nDep);
      const lineCount = new Map<string, number>();
      const lineMode = new Map<string, Mode>();
      for (let i = 0; i < nDep; i++) {
        const key = keys[i];
        const r = key % n;
        const rest = (key - r) / n;
        const m = rest % DAY_FACTOR;
        const d = (rest - m) / DAY_FACTOR;
        const t = st.trip[r];
        const ri = tripRoute[t];
        const pk = `${shapeOf[t]}:${r - start[t]}`;
        let pi = patIndex.get(pk);
        if (pi === undefined) {
          const p = { line: routeShort[ri], mode: routeMode[ri], route: routeId[ri], head: headOf(t), next: nextOf(r, t, a) };
          const content = JSON.stringify(p);
          pi = patByContent.get(content);
          if (pi === undefined) {
            pi = patterns.length;
            patterns.push(p);
            patByContent.set(content, pi);
          }
          patIndex.set(pk, pi);
        }
        deps[i] = [d, m, pi, localStop.get(st.stop[r]) ?? 0, op === 'stib' ? '' : tripId[t], st.seq[r]];
        lineCount.set(routeShort[ri], (lineCount.get(routeShort[ri]) ?? 0) + 1);
        if (!lineMode.has(routeShort[ri])) lineMode.set(routeShort[ri], routeMode[ri]);
      }
      if (!nDep) {
        // zone sans départ (terminus) : lignes qui y arrivent
        for (let i = 0; i < rs.length; i++) {
          const ri = tripRoute[st.trip[rs[i]]];
          lineCount.set(routeShort[ri], (lineCount.get(routeShort[ri]) ?? 0) + 1);
          if (!lineMode.has(routeShort[ri])) lineMode.set(routeShort[ri], routeMode[ri]);
        }
      }
      const lines = [...lineCount.entries()]
        .sort((x, y) => y[1] - x[1] || compareLines(x[0], y[0]))
        .slice(0, MAX_LINES)
        .map(([l]) => l)
        .sort((x, y) => MODE_RANK.indexOf(lineMode.get(x) ?? 'bus') - MODE_RANK.indexOf(lineMode.get(y) ?? 'bus') || compareLines(x, y));

      const id = areaIdStr[a];
      const n2 = areaNames[a];
      const lat = round5(area.lat);
      const lon = round5(area.lon);
      const file: AreaFile = { v: 1, id, op, n: n2, lat, lon, stops: stopsOut, patterns, deps };
      await writer.write(`areas/${op}/${fileKey}.json`, file);
      summaries.push({ id, op, n: n2, lat, lon, modes: modesFromMask(modeMask), lines });
      depsTotal += nDep;
      patternsTotal += patterns.length;
    }

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
            s.push([si, st.arr[r], st.dep[r], platformAt(st.stop[r]), st.seq[r]]);
          }
          const num = tripShort[t];
          return num
            ? { id: tripId[t], cat: routeShort[tripRoute[t]], num, head: headOf(t), s }
            : { id: tripId[t], cat: routeShort[tripRoute[t]], head: headOf(t), s };
        });
        return { v: 1, date, stations, trips };
      });
    }

    const stats: FeedStats = {
      tripsInFeed, stopTimesRows: rows, keptRows: n, deps: depsTotal, patterns: patternsTotal,
      storeMB: Math.round(st.bytes() / 1048576), ms: Date.now() - t0,
    };
    log(`${OP_LABEL[op]} : ${validTrips} voyages retenus sur ${tripsInFeed}, ${n} passages gardés sur ${rows} lus, ${summaries.length} zones, ${depsTotal} départs (${(stats.ms / 1000).toFixed(1).replace('.', ',')} s)`);
    for (const w of warnings) log(`${OP_LABEL[op]} : attention, ${w}`);
    return { op, feedVersion, trips: validTrips, areas: summaries, trains, stats, warnings };
  } finally {
    zip.close();
  }
}
