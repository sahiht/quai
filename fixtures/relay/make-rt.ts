/**
 * npm run make-rt (depuis relay/) : génère les fixtures temps réel du relais à partir de fixtures/network.json.
 *
 *   bmc/{nmbssncb,delijn,tec}/trip-update.pb  flux GTFS-RT au format du portail BMC (identifiants préfixés
 *                                             gt:<slug>:, gs:<slug>:, gr:<slug>:), horodatage 1794309000
 *   bmc/{nmbssncb,delijn,tec}/alert.pb        alertes GTFS-RT
 *   bmc/stibmivb/waiting-times.json           réponse STIB WaitingTimes (enveloppe Opendatasoft, passingtimes en chaîne JSON)
 *   sncb-direct/trip-update.pb                variante « flux SNCB direct » (SNCB_RT_URL), sans préfixes
 *   *.pb.json                                 vue lisible de chaque .pb (non servie, pour relire les fixtures)
 *
 * Particularités voulues (réalisme et robustesse) :
 *  - changement de voie de l'IC de Namur : le flux BMC garde stop_id = quai prévu (8863008_4) et donne le quai réel
 *    dans stop_time_properties.assigned_stop_id (8863008_6) ; le flux SNCB direct met directement stop_id = 8863008_6 ;
 *  - flux De Lijn : une entité sans trip_id (repérée par ligne et heure) et un doublon d'entité, à ignorer ou fusionner.
 * Les heures estimées sont calculées depuis l'horaire de network.json (date de service 2026-11-10, heure belge).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TR, decodeFeed, encodeFeed } from '../../relay/lib/gtfsrt.js';
import { brusselsLocalToMs, toBrusselsIso } from '../../relay/lib/time.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const NETWORK_PATH = join(HERE, '..', 'network.json');
export const FIXTURES_DIR = HERE;
export const FEED_TIMESTAMP = 1794309000; // 2026-11-10T12:10:00+01:00

type RtOpName = 'sncb' | 'delijn' | 'tec';
const SLUG: Record<RtOpName, string> = { sncb: 'nmbssncb', delijn: 'delijn', tec: 'tec' };

type StopTime = [string, string] | [string, string, string];
interface StaticTrip { id: string; route: string; st: StopTime[] }
interface Template { idTpl: string; route: string; stops: [string, number][] }
interface OpStatic { trips?: StaticTrip[]; templates?: Template[] }
interface RtUpdate { seq: number; stop: string; arrDelay?: number; depDelay?: number }
interface RtTrip { trip: string; cancelled?: boolean; updates?: RtUpdate[] }
interface RtAlert { id: string; stops: string[]; routes: string[]; fr: string; nl: string; from: string; to: string }
interface StibGroupIn { line: string; dest: { fr: string; nl: string }; times: string[]; message?: { fr: string; nl: string } }
export interface Network {
  serviceDates: string[];
  ops: Record<RtOpName | 'stib', OpStatic>;
  realtime: Record<RtOpName, { tripUpdates: RtTrip[]; alerts: RtAlert[] }> & { stib: { points: Record<string, StibGroupIn[]> } };
}

export function readNetwork(path = NETWORK_PATH): Network {
  return JSON.parse(readFileSync(path, 'utf8')) as Network;
}

const hm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};
const hms = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`;

interface Schedule { route: string; start: number; stops: { stop: string; arr: number; dep: number }[] }

/** Horaire statique d'un voyage : voyage explicite ou gabarit (idTpl avec {HHMM}). Minutes depuis minuit. */
function scheduleOf(op: OpStatic, tripId: string): Schedule {
  const t = op.trips?.find((x) => x.id === tripId);
  if (t) {
    const stops = t.st.map((e) => ({ stop: e[0], arr: hm(e[1]), dep: hm(e.length === 3 ? e[2] : e[1]) }));
    return { route: t.route, start: stops[0].dep, stops };
  }
  for (const tpl of op.templates ?? []) {
    const [pre, post] = tpl.idTpl.split('{HHMM}');
    if (!tripId.startsWith(pre) || !tripId.endsWith(post)) continue;
    const hhmm = tripId.slice(pre.length, tripId.length - post.length);
    if (!/^\d{4}$/.test(hhmm)) continue;
    const start = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2));
    return { route: tpl.route, start, stops: tpl.stops.map(([stop, off]) => ({ stop, arr: start + off, dep: start + off })) };
  }
  throw new Error(`Voyage absent de l'horaire de network.json : ${tripId}`);
}

function serviceDay(net: Network) {
  const [y, mo, d] = net.serviceDates[0].split('-').map(Number);
  return { y, mo, d, compact: net.serviceDates[0].replace(/-/g, '') };
}

const header = () => ({ gtfsRealtimeVersion: '2.0', incrementality: 'FULL_DATASET', timestamp: FEED_TIMESTAMP });

function tripUpdateFeed(net: Network, op: RtOpName, prefixed: boolean): Record<string, unknown> {
  const slug = SLUG[op];
  const day = serviceDay(net);
  const epoch = (min: number) => Math.round(brusselsLocalToMs(day.y, day.mo, day.d, 0, min) / 1000);
  const id = (kind: 'gt' | 'gs' | 'gr', v: string) => (prefixed ? `${kind}:${slug}:${v}` : v);
  const entity: Record<string, unknown>[] = [];
  for (const rt of net.realtime[op].tripUpdates) {
    const sched = scheduleOf(net.ops[op], rt.trip);
    const stopTimeUpdate = (rt.updates ?? []).map((u) => {
      const planned = sched.stops[u.seq - 1];
      if (!planned) throw new Error(`stop_sequence ${u.seq} hors horaire pour ${rt.trip}`);
      const platformChange = planned.stop !== u.stop;
      const stu: Record<string, unknown> = {
        stopSequence: u.seq,
        // Flux BMC : quai prévu dans stop_id et quai réel dans assigned_stop_id ; flux direct : quai réel dans stop_id.
        stopId: id('gs', platformChange && prefixed ? planned.stop : u.stop),
        scheduleRelationship: 'SCHEDULED',
      };
      if (u.arrDelay != null) stu.arrival = { delay: u.arrDelay, time: epoch(planned.arr) + u.arrDelay };
      if (u.depDelay != null) stu.departure = { delay: u.depDelay, time: epoch(planned.dep) + u.depDelay };
      if (platformChange && prefixed) stu.stopTimeProperties = { assignedStopId: id('gs', u.stop) };
      return stu;
    });
    entity.push({
      id: String(entity.length + 1),
      tripUpdate: {
        trip: {
          tripId: id('gt', rt.trip),
          routeId: id('gr', sched.route),
          startTime: hms(sched.start),
          startDate: day.compact,
          scheduleRelationship: rt.cancelled ? 'CANCELED' : 'SCHEDULED',
        },
        stopTimeUpdate,
        timestamp: FEED_TIMESTAMP,
      },
    });
  }
  if (op === 'delijn' && prefixed) {
    // Entité sans trip_id (ligne + heure de départ seulement) : le relais doit l'ignorer.
    entity.push({
      id: String(entity.length + 1),
      tripUpdate: {
        trip: { routeId: id('gr', '232'), directionId: 0, startTime: '12:45:00', startDate: day.compact },
        stopTimeUpdate: [{ stopSequence: 1, stopId: id('gs', '308611'), departure: { delay: 600 } }],
        timestamp: FEED_TIMESTAMP,
      },
    });
    // Doublon exact d'une entité : le relais ne doit garder qu'un voyage.
    const dup = entity.find((e) => (e.tripUpdate as { trip: { tripId?: string } }).trip.tripId === id('gt', '702321245'));
    if (dup) entity.push({ ...dup, id: String(entity.length + 1) });
  }
  return { header: header(), entity };
}

function alertFeed(net: Network, op: RtOpName): Record<string, unknown> {
  const slug = SLUG[op];
  const sec = (iso: string) => Math.round(Date.parse(iso) / 1000);
  const text = (a: RtAlert) => ({
    translation: [
      { text: a.fr, language: 'fr' },
      ...(a.nl ? [{ text: a.nl, language: 'nl' }] : []),
    ].filter((t) => t.text),
  });
  const entity = net.realtime[op].alerts.map((a) => ({
    id: a.id,
    alert: {
      activePeriod: [{ start: sec(a.from), end: sec(a.to) }],
      informedEntity: [
        ...a.stops.map((s) => ({ stopId: `gs:${slug}:${s}` })),
        ...a.routes.map((r) => ({ routeId: `gr:${slug}:${r}` })),
      ],
      cause: a.routes.length ? 'CONSTRUCTION' : 'MAINTENANCE',
      effect: a.routes.length ? 'DETOUR' : 'SIGNIFICANT_DELAYS',
      headerText: text(a),
      descriptionText: text(a),
    },
  }));
  return { header: header(), entity };
}

function stibWaitingTimes(net: Network): { total_count: number; results: Record<string, string>[] } {
  const day = serviceDay(net);
  const results: Record<string, string>[] = [];
  for (const [pointid, groups] of Object.entries(net.realtime.stib.points)) {
    const byLine = new Map<string, { t: number; v: Record<string, unknown> }[]>();
    for (const g of groups) {
      for (const time of g.times) {
        const ms = brusselsLocalToMs(day.y, day.mo, day.d, 0, hm(time));
        const pass: Record<string, unknown> = { destination: g.dest, expectedArrivalTime: toBrusselsIso(ms), lineId: g.line };
        if (g.message) pass.message = g.message;
        const list = byLine.get(g.line) ?? [];
        list.push({ t: ms, v: pass });
        byLine.set(g.line, list);
      }
    }
    for (const [lineid, list] of byLine) {
      list.sort((a, b) => a.t - b.t);
      // Comme la vraie réponse STIB : passingtimes est une chaîne JSON.
      results.push({ pointid, lineid, passingtimes: JSON.stringify(list.map((x) => x.v)) });
    }
  }
  return { total_count: results.length, results };
}

const readable = (pb: Uint8Array) =>
  `${JSON.stringify(TR.FeedMessage.toObject(decodeFeed(pb), { longs: Number, enums: String, defaults: false }), null, 2)}\n`;

/** Tous les fichiers générés : chemin relatif à fixtures/relay → contenu. */
export function buildFixtures(net: Network = readNetwork()): Map<string, Uint8Array | string> {
  const files = new Map<string, Uint8Array | string>();
  const put = (path: string, pb: Uint8Array) => {
    files.set(path, pb);
    files.set(`${path}.json`, readable(pb));
  };
  for (const op of ['sncb', 'delijn', 'tec'] as const) {
    put(`bmc/${SLUG[op]}/trip-update.pb`, encodeFeed(tripUpdateFeed(net, op, true)));
    put(`bmc/${SLUG[op]}/alert.pb`, encodeFeed(alertFeed(net, op)));
  }
  put('sncb-direct/trip-update.pb', encodeFeed(tripUpdateFeed(net, 'sncb', false)));
  files.set('bmc/stibmivb/waiting-times.json', `${JSON.stringify(stibWaitingTimes(net), null, 2)}\n`);
  return files;
}

function main(): void {
  const files = buildFixtures();
  for (const [path, content] of files) {
    const full = join(FIXTURES_DIR, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    const size = typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength;
    console.log(`${path.padEnd(36)} ${String(size).padStart(6)} octets`);
  }
  console.log(`${files.size} fichiers écrits dans fixtures/relay/`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
