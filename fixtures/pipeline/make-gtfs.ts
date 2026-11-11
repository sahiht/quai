/**
 * Générateur des GTFS de test : fixtures/network.json -> 4 zips GTFS réalistes
 * (fixtures/pipeline/gtfs/sncb.zip, stib.zip, delijn.zip, tec.zip).
 *
 * Usage (depuis pipeline/) : npm run make-fixtures [-- --out <dossier>]
 *
 * Particularités volontaires, comme dans les vrais flux :
 *  - SNCB : gares parentes « S<uic> » (location_type 1), arrêt « gare » <uic> sans quai, quais <uic>_<n>
 *    avec platform_code ; tous les champs entre guillemets ; translations.txt au format field_value
 *    (stops.stop_name et trips.trip_headsign, langues fr, nl, de, en) ; horaires au-delà de 24:00 ; route_type 109.
 *  - STIB : noms EN MAJUSCULES ; fins de ligne CRLF dans tout le flux ; translations.txt au format record_id
 *    pour les arrêts et field_value pour les destinations.
 *  - De Lijn : suffixe « perron N » ; pas de translations.txt ; stop_times.txt avec colonnes dans un ordre
 *    non standard ; colonne supplémentaire inconnue dans trips.txt ; route_type 700 ; pickup_type/drop_off_type 1
 *    aux terminus ; trams avec le préfixe déjà dans route_short_name (« T1 », network.json dit « 1 »).
 *  - TEC : suffixe « quai X » ; stops.txt avec BOM UTF-8, colonne stop_desc entre guillemets contenant une
 *    virgule et des guillemets échappés ; heures sans zéro initial (6:00:00) ; voyage de nuit à 24:10 ;
 *    ligne W avec la commune en capitales dans les noms (« WATERLOO Eglise », « BRAINE-L'ALLEUD Gare »).
 *  - Tous : calendar.txt + calendar_dates.txt (WEEK retiré le 2026-11-11, HOLI ajouté), feed_info.txt avec feed_version.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeZip } from './zip.ts';

export type FixtureOp = 'sncb' | 'stib' | 'delijn' | 'tec';
export const FIXTURE_OPS: FixtureOp[] = ['sncb', 'stib', 'delijn', 'tec'];

interface Agency { id: string; name: string; url: string; lang: string }
interface Route { id: string; short: string; long: string; type: number }
interface Template {
  idTpl: string; route: string; service: string; head: string;
  stops: [string, number][]; from: string; to: string; every: number;
}
interface ExplicitTrip {
  id: string; route: string; service: string; head: string; num?: string;
  st: ([string, string] | [string, string, string])[];
}
interface Calendar { days: string; start: string; end: string; remove?: string[]; add?: string[] }
interface Station { uic: string; name: string; fr: string; nl: string; lat: number; lon: number; platforms: string[] }
interface PlainStop { id: string; name: string; nl?: string; lat: number; lon: number }

export interface Network {
  serviceDates: string[];
  calendars: Record<string, Calendar>;
  ops: {
    sncb: { agency: Agency; stations: Station[]; routes: Route[]; trips: ExplicitTrip[] };
    stib: { agency: Agency; stops: PlainStop[]; headsigns: Record<string, string>; routes: Route[]; templates: Template[] };
    delijn: { agency: Agency; stops: PlainStop[]; routes: Route[]; templates: Template[] };
    tec: { agency: Agency; stops: PlainStop[]; routes: Route[]; templates: Template[]; trips: ExplicitTrip[] };
  };
}

/** Voyage développé (gabarit ou explicite) : heures en minutes depuis minuit du jour de service. */
export interface FixtureTrip {
  id: string; route: string; service: string; head: string; num?: string;
  stops: { stop: string; arr: number; dep: number }[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const NETWORK_PATH = resolve(HERE, '..', 'network.json');
export const DEFAULT_OUT = join(HERE, 'gtfs');

export function loadNetwork(path = NETWORK_PATH): Network {
  return JSON.parse(readFileSync(path, 'utf8')) as Network;
}

function hm(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function hhmm(min: number): string {
  return String(Math.floor(min / 60)).padStart(2, '0') + String(min % 60).padStart(2, '0');
}

/** « HH:MM:SS » (ou « H:MM:SS » si pad = false), heures pouvant dépasser 24. */
function gtfsTime(min: number, pad = true): string {
  const h = String(Math.floor(min / 60));
  return `${pad ? h.padStart(2, '0') : h}:${String(min % 60).padStart(2, '0')}:00`;
}

/** Développe les gabarits et voyages explicites d'un opérateur, dans l'ordre du fichier. */
export function expandTrips(net: Network, op: FixtureOp): FixtureTrip[] {
  const o = net.ops[op] as { templates?: Template[]; trips?: ExplicitTrip[] };
  const out: FixtureTrip[] = [];
  for (const t of o.templates ?? []) {
    for (let s = hm(t.from); s <= hm(t.to); s += t.every) {
      out.push({
        id: t.idTpl.replace('{HHMM}', hhmm(s)), route: t.route, service: t.service, head: t.head,
        stops: t.stops.map(([stop, off]) => ({ stop, arr: s + off, dep: s + off })),
      });
    }
  }
  for (const t of o.trips ?? []) {
    out.push({
      id: t.id, route: t.route, service: t.service, head: t.head, num: t.num,
      stops: t.st.map((e) => ({ stop: e[0], arr: hm(e[1]), dep: hm(e.length === 3 ? e[2] : e[1]) })),
    });
  }
  return out;
}

/* ------------------------------ écriture CSV ------------------------------ */

type Cell = string | number | undefined;

function cell(v: Cell, quoteAll: boolean): string {
  const s = v === undefined ? '' : String(v);
  if (quoteAll || /[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csv(header: string[], rows: Cell[][], opts: { eol?: string; quoteAll?: boolean; bom?: boolean } = {}): string {
  const eol = opts.eol ?? '\n';
  const q = opts.quoteAll ?? false;
  const lines = [header.map((h) => cell(h, q)).join(','), ...rows.map((r) => r.map((v) => cell(v, q)).join(','))];
  return (opts.bom ? '﻿' : '') + lines.join(eol) + eol;
}

function gtfsDate(iso: string): string {
  return iso.replace(/-/g, '');
}

function calendarFiles(net: Network, eol: string, quoteAll = false): Record<string, string> {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const cal: Cell[][] = [];
  const dates: Cell[][] = [];
  for (const [id, c] of Object.entries(net.calendars)) {
    cal.push([id, ...c.days.split('').map(Number), gtfsDate(c.start), gtfsDate(c.end)]);
    for (const d of c.remove ?? []) dates.push([id, gtfsDate(d), 2]);
    for (const d of c.add ?? []) dates.push([id, gtfsDate(d), 1]);
  }
  return {
    'calendar.txt': csv(['service_id', ...days, 'start_date', 'end_date'], cal, { eol, quoteAll }),
    'calendar_dates.txt': csv(['service_id', 'date', 'exception_type'], dates, { eol, quoteAll }),
  };
}

function agencyFile(a: Agency, eol: string, quoteAll = false): string {
  return csv(['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang'],
    [[a.id, a.name, a.url, 'Europe/Brussels', a.lang]], { eol, quoteAll });
}

function feedInfo(publisher: string, url: string, lang: string, version: string, eol: string, quoteAll = false): string {
  return csv(['feed_publisher_name', 'feed_publisher_url', 'feed_lang', 'feed_start_date', 'feed_end_date', 'feed_version'],
    [[publisher, url, lang, '20261101', '20261231', version]], { eol, quoteAll });
}

/* ------------------------------ SNCB ------------------------------ */

/** Noms allemands et anglais (translations.txt SNCB : fr, nl, de, en). */
const SNCB_DE_EN: Record<string, [string, string]> = {
  '8863008': ['Namur', 'Namur'],
  '8874005': ['Gembloux', 'Gembloux'],
  '8811601': ['Ottignies', 'Ottignies'],
  '8811304': ['Brüssel-Luxemburg', 'Brussels-Luxembourg'],
  '8811916': ['Brüssel-Schuman', 'Brussels-Schuman'],
  '8812005': ['Brüssel-Nord', 'Brussels-North'],
  '8813003': ['Brüssel-Zentral', 'Brussels-Central'],
  '8814001': ['Brüssel-Süd', 'Brussels-South'],
  '8892007': ['Gent-Sint-Pieters', 'Ghent-Sint-Pieters'],
  '8893120': ['Gent-Dampoort', 'Ghent-Dampoort'],
  '8891009': ['Brügge', 'Bruges'],
  '8822004': ['Mecheln', 'Mechelen'],
  '8821006': ['Antwerpen-Zentral', 'Antwerp-Central'],
  '8883006': ['Nivelles', 'Nivelles'],
  '8814266': ['Waterloo', 'Waterloo'],
};

function sncbFeed(net: Network): Record<string, string> {
  const o = net.ops.sncb;
  const q = true; // flux SNCB : tous les champs entre guillemets
  const stops: Cell[][] = [];
  for (const s of o.stations) {
    stops.push([`S${s.uic}`, '', s.name, '', s.lat.toFixed(6), s.lon.toFixed(6), '', '', 1, '', '']);
    stops.push([s.uic, '', s.name, '', s.lat.toFixed(6), s.lon.toFixed(6), '', '', 0, `S${s.uic}`, '']);
    s.platforms.forEach((p, i) => {
      stops.push([`${s.uic}_${p}`, '', s.name, '', (s.lat + 0.00004 * (i + 1)).toFixed(6), (s.lon + 0.00003 * (i + 1)).toFixed(6), '', '', 0, `S${s.uic}`, p]);
    });
  }
  const trips = expandTrips(net, 'sncb');
  const tr: Cell[][] = [];
  const byName = new Map(o.stations.map((s) => [s.name, s]));
  const translated = new Set<string>();
  const addTr = (table: string, field: string, value: string) => {
    const key = `${table}|${field}|${value}`;
    if (translated.has(key)) return;
    const st = byName.get(value);
    if (!st) return;
    translated.add(key);
    const [de, en] = SNCB_DE_EN[st.uic] ?? [st.nl, st.fr];
    for (const [lang, t] of [['fr', st.fr], ['nl', st.nl], ['de', de], ['en', en]] as const) {
      tr.push([table, field, lang, t, '', '', value]);
    }
  };
  for (const s of o.stations) addTr('stops', 'stop_name', s.name);
  for (const t of trips) addTr('trips', 'trip_headsign', t.head);

  const stopTimes: Cell[][] = [];
  for (const t of trips) {
    t.stops.forEach((s, i) => stopTimes.push([t.id, gtfsTime(s.arr), gtfsTime(s.dep), s.stop, i + 1, 0, 0]));
  }
  return {
    'agency.txt': agencyFile(o.agency, '\n', q),
    'stops.txt': csv(['stop_id', 'stop_code', 'stop_name', 'stop_desc', 'stop_lat', 'stop_lon', 'zone_id', 'stop_url', 'location_type', 'parent_station', 'platform_code'], stops, { quoteAll: q }),
    'routes.txt': csv(['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'],
      o.routes.map((r) => [r.id, o.agency.id, r.short, r.long, r.type]), { quoteAll: q }),
    'trips.txt': csv(['route_id', 'service_id', 'trip_id', 'trip_headsign', 'trip_short_name', 'direction_id', 'block_id'],
      trips.map((t) => [t.route, t.service, t.id, t.head, t.num ?? '', '', '']), { quoteAll: q }),
    'stop_times.txt': csv(['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'pickup_type', 'drop_off_type'], stopTimes, { quoteAll: q }),
    ...calendarFiles(net, '\n', q),
    'translations.txt': csv(['table_name', 'field_name', 'language', 'translation', 'record_id', 'record_sub_id', 'field_value'], tr, { quoteAll: q }),
    'feed_info.txt': feedInfo('NMBS/SNCB', 'https://www.belgiantrain.be', 'fr', '2026-11-09.sncb', '\n', q),
  };
}

/* ------------------------------ STIB ------------------------------ */

const STIB_DIRECTION: Record<string, number> = { '1103': 0, '1203': 1, '1104': 0, '1302': 0, '1402': 1, '1306': 0 };

function stibFeed(net: Network): Record<string, string> {
  const o = net.ops.stib;
  const eol = '\r\n'; // flux STIB : fins de ligne Windows partout
  const trips = expandTrips(net, 'stib');
  const tr: Cell[][] = [];
  for (const s of o.stops) {
    tr.push(['stops', 'stop_name', 'fr', s.name, s.id, '', '']);
    tr.push(['stops', 'stop_name', 'nl', s.nl ?? s.name, s.id, '', '']);
  }
  for (const [fr, nl] of Object.entries(o.headsigns)) {
    tr.push(['trips', 'trip_headsign', 'fr', fr, '', '', fr]);
    tr.push(['trips', 'trip_headsign', 'nl', nl, '', '', fr]);
  }
  const stopTimes: Cell[][] = [];
  for (const t of trips) {
    t.stops.forEach((s, i) => stopTimes.push([t.id, gtfsTime(s.arr), gtfsTime(s.dep), s.stop, i + 1, '', '']));
  }
  return {
    'agency.txt': agencyFile(o.agency, eol),
    'stops.txt': csv(['stop_id', 'stop_code', 'stop_name', 'stop_desc', 'stop_lat', 'stop_lon', 'zone_id', 'stop_url', 'location_type', 'parent_station'],
      o.stops.map((s) => [s.id, '', s.name, '', s.lat.toFixed(5), s.lon.toFixed(5), '', '', 0, '']), { eol }),
    'routes.txt': csv(['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_desc', 'route_type', 'route_url', 'route_color', 'route_text_color'],
      o.routes.map((r) => [r.id, o.agency.id, r.short, r.long, '', r.type, '', r.type === 1 ? 'C4008F' : 'B5BA05', 'FFFFFF']), { eol }),
    'trips.txt': csv(['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'block_id', 'shape_id'],
      trips.map((t) => [t.route, t.service, t.id, t.head, STIB_DIRECTION[t.id.slice(0, 4)] ?? 0, '', '']), { eol }),
    'stop_times.txt': csv(['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'pickup_type', 'drop_off_type'], stopTimes, { eol }),
    ...calendarFiles(net, eol),
    'translations.txt': csv(['table_name', 'field_name', 'language', 'translation', 'record_id', 'record_sub_id', 'field_value'], tr, { eol }),
    'feed_info.txt': feedInfo('STIB-MIVB', 'https://www.stib-mivb.be', 'fr', '20261109', eol),
  };
}

/* ------------------------------ De Lijn ------------------------------ */

function delijnFeed(net: Network): Record<string, string> {
  const o = net.ops.delijn;
  const trips = expandTrips(net, 'delijn');
  const stopTimes: Cell[][] = [];
  let dist = 0;
  for (const t of trips) {
    const last = t.stops.length - 1;
    t.stops.forEach((s, i) => {
      dist = i === 0 ? 0 : dist + 1234.5;
      // ordre non standard : stop_sequence, stop_id, trip_id, departure_time, arrival_time, ...
      stopTimes.push([i + 1, s.stop, t.id, gtfsTime(s.dep), gtfsTime(s.arr), i === last ? 1 : 0, i === 0 ? 1 : 0, 1, dist.toFixed(1)]);
    });
  }
  return {
    'agency.txt': agencyFile(o.agency, '\n'),
    'stops.txt': csv(['stop_id', 'stop_code', 'stop_name', 'stop_desc', 'stop_lat', 'stop_lon', 'location_type', 'parent_station', 'wheelchair_boarding'],
      o.stops.map((s) => [s.id, s.id.slice(1), s.name, '', s.lat.toFixed(5), s.lon.toFixed(5), 0, '', 1])),
    // comme le vrai flux : les trams portent déjà le préfixe dans route_short_name (« T1 ») ; le pipeline doit rendre « 1 »
    'routes.txt': csv(['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color', 'route_text_color'],
      o.routes.map((r) => [r.id, o.agency.id, r.type === 0 || (r.type >= 900 && r.type <= 906) ? `T${r.short}` : r.short, r.long, r.type, 'FFFF00', '000000'])),
    'trips.txt': csv(['route_id', 'service_id', 'trip_id', 'trip_headsign', 'trip_short_name', 'direction_id', 'block_id', 'shape_id', 'exceptional'],
      trips.map((t) => [t.route, t.service, t.id, t.head, '', t.id.startsWith('70002') ? 1 : 0, '', '', 0])),
    'stop_times.txt': csv(['stop_sequence', 'stop_id', 'trip_id', 'departure_time', 'arrival_time', 'pickup_type', 'drop_off_type', 'timepoint', 'shape_dist_traveled'], stopTimes),
    ...calendarFiles(net, '\n'),
    'feed_info.txt': feedInfo('De Lijn', 'https://www.delijn.be', 'nl', 'DL-2026-11-09', '\n'),
  };
}

/* ------------------------------ TEC ------------------------------ */

const TEC_DESC: Record<string, string> = {
  N508aga: 'Namur, gare des bus',
  N508agb: 'Quai "B", côté gare',
};

function tecFeed(net: Network): Record<string, string> {
  const o = net.ops.tec;
  const trips = expandTrips(net, 'tec');
  const stopTimes: Cell[][] = [];
  for (const t of trips) {
    t.stops.forEach((s, i) => stopTimes.push([t.id, gtfsTime(s.arr, false), gtfsTime(s.dep, false), s.stop, i + 1]));
  }
  return {
    'agency.txt': agencyFile(o.agency, '\n'),
    'stops.txt': csv(['stop_id', 'stop_code', 'stop_desc', 'stop_name', 'stop_lat', 'stop_lon', 'zone_id', 'stop_url', 'location_type', 'parent_station'],
      o.stops.map((s) => [s.id, s.id.toUpperCase(), TEC_DESC[s.id] ?? '', s.name, s.lat.toFixed(5), s.lon.toFixed(5), '', '', '', '']), { bom: true }),
    'routes.txt': csv(['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'],
      o.routes.map((r) => [r.id, o.agency.id, r.short, r.long, r.type])),
    'trips.txt': csv(['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id'],
      trips.map((t) => [t.route, t.service, t.id, t.head, 0])),
    'stop_times.txt': csv(['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'], stopTimes),
    ...calendarFiles(net, '\n'),
    'feed_info.txt': feedInfo('TEC', 'https://www.letec.be', 'fr', 'TEC-20261109', '\n'),
  };
}

/* ------------------------------ assemblage ------------------------------ */

export function buildFeeds(net: Network = loadNetwork()): Record<FixtureOp, Record<string, string>> {
  return { sncb: sncbFeed(net), stib: stibFeed(net), delijn: delijnFeed(net), tec: tecFeed(net) };
}

export function feedZip(files: Record<string, string>): Buffer {
  return makeZip(Object.entries(files).map(([name, data]) => ({ name, data })));
}

/** Écrit les 4 zips ; renvoie leurs chemins. */
export function writeFixtureZips(outDir = DEFAULT_OUT, net: Network = loadNetwork()): Record<FixtureOp, string> {
  mkdirSync(outDir, { recursive: true });
  const feeds = buildFeeds(net);
  const out = {} as Record<FixtureOp, string>;
  for (const op of FIXTURE_OPS) {
    const path = join(outDir, `${op}.zip`);
    writeFileSync(path, feedZip(feeds[op]));
    out[op] = path;
  }
  return out;
}

function main(): void {
  const i = process.argv.indexOf('--out');
  const outDir = i > 0 && process.argv[i + 1] ? resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[i + 1]) : DEFAULT_OUT;
  const paths = writeFixtureZips(outDir);
  for (const op of FIXTURE_OPS) {
    const size = readFileSync(paths[op]).length;
    console.log(`${op.padEnd(6)} ${paths[op]} (${(size / 1024).toFixed(1)} Ko)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
