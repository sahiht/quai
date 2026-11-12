#!/usr/bin/env node
// Banc d'essai de Quai : itinéraires de référence chez deux calculateurs libres et gratuits, sans Google.
//   - Transitous (https://transitous.org, moteur MOTIS 2) : les 50 trajets × 3 moments de bench/trips.json ;
//   - iRail (https://api.irail.be) : seulement les trajets entre deux gares SNCB.
// Sorties, dans le dossier --out (par défaut bench/out) :
//   raw/<source>/<trajet>_<moment>.json   réponse brute, avec l'URL demandée et le statut HTTP ;
//   raw/transitous/_serveur.json          configuration du serveur Transitous (version de MOTIS) ;
//   references.json                       toutes les réponses dans un format commun (voir bench/REFERENCES.md).
// Node 22, sans dépendance (fetch global). Une requête à la fois par source, débit limité, plafond de requêtes,
// au plus une nouvelle tentative espacée par cas, arrêt d'une source après 5 échecs de suite du serveur.
//
//   node bench/fetch-references.mjs                             interroge les deux sources (accès réseau requis)
//   node bench/fetch-references.mjs --sources irail             une seule source
//   node bench/fetch-references.mjs --from-raw bench/out/raw    renormalise des réponses déjà reçues, sans requête
// Autres options : --trips <fichier> (défaut bench/trips.json), --out <dossier>, --only t01,t21

import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USER_AGENT = 'Quai-bench/1.2.2 (+https://github.com/sahiht/quai)';
const TZ = 'Europe/Brussels';
const SOURCES = ['transitous', 'irail'];

// Paramètres envoyés à Transitous, tous explicites (les valeurs par défaut de MOTIS changent d'une version à l'autre).
// Mêmes réglages que le site transitous.org (fastestDirectFactor 1.5), sans tarifs ni variantes par étape.
const TRANSITOUS = {
  name: 'Transitous',
  site: 'https://transitous.org',
  base: 'https://api.transitous.org',
  plan: '/api/v6/plan',
  serverInfo: '/api/v1/map/initial',
  minIntervalMs: 1100, // au plus 1 requête par seconde
  maxRequests: 240, // plafond par lancement, nouvelles tentatives comprises
  timeoutMs: 45000,
  fixedParams: {
    arriveBy: 'false',
    timetableView: 'true',
    numItineraries: '5',
    searchWindow: '900',
    transitModes: 'TRANSIT',
    directModes: 'WALK',
    preTransitModes: 'WALK',
    postTransitModes: 'WALK',
    pedestrianProfile: 'FOOT',
    maxPreTransitTime: '900',
    maxPostTransitTime: '900',
    maxDirectTime: '1800',
    fastestDirectFactor: '1.5',
    useRoutedTransfers: 'false',
    joinInterlinedLegs: 'true',
    detailedLegs: 'false',
    language: 'fr',
  },
};

// iRail : le chemin /v1/connections évite la redirection 303 de l'ancien chemin /connections/ (une requête de moins).
// Débit volontairement bas : iRail interroge lui-même la SNCB, avec un quota partagé par tous ses utilisateurs.
const IRAIL = {
  name: 'iRail',
  site: 'https://irail.be',
  base: 'https://api.irail.be',
  connections: '/v1/connections',
  legacyConnections: '/connections/',
  minIntervalMs: 6000, // 10 requêtes par minute, bien en dessous de la limite de 2 par seconde
  maxRequests: 120,
  timeoutMs: 45000,
  fixedParams: { timesel: 'departure', format: 'json', lang: 'fr', results: '6' },
};

const RETRYABLE = new Set([429, 502, 503, 504]);
const MAX_SERVER_FAILURES_IN_A_ROW = 5;
const STREET_MODES = new Set(['walk', 'bike', 'car', 'rental']);
const WALK_SEC = Symbol('walkSec'); // durée de marche exacte, en secondes (non écrite dans le JSON)

// Modes MOTIS vers les modes du format commun. METRO est l'ancien nom de SUBURBAN (API antérieures à v5).
const MOTIS_MODES = {
  WALK: 'walk', BIKE: 'bike', CAR: 'car', RENTAL: 'rental', CAR_PARKING: 'car', CAR_DROPOFF: 'car',
  TRAM: 'tram', SUBWAY: 'metro', BUS: 'bus', COACH: 'coach', FERRY: 'ferry', AIRPLANE: 'plane',
  RAIL: 'train', HIGHSPEED_RAIL: 'train', LONG_DISTANCE: 'train', NIGHT_RAIL: 'train',
  REGIONAL_FAST_RAIL: 'train', REGIONAL_RAIL: 'train', SUBURBAN: 'train', METRO: 'train',
  FUNICULAR: 'funicular', AERIAL_LIFT: 'cable', AREAL_LIFT: 'cable', CABLE_CAR: 'cable',
  ODM: 'odm', RIDE_SHARING: 'rideshare', FLEX: 'flex', OTHER: 'other',
};

// ---------- Outils ----------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round1 = (x) => Math.round(x * 10) / 10;
const asArray = (x) => (Array.isArray(x) ? x : x === undefined || x === null ? [] : [x]);
const num = (x) => (x === undefined || x === null || x === '' ? NaN : Number(x));
const flag = (x) => x === true || x === 1 || x === '1' || x === 'true';
const log = (...args) => console.log(...args);

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function localParts(ms) {
  const p = {};
  for (const { type, value } of partsFormat.formatToParts(new Date(ms))) p[type] = value;
  return p;
}

/** Instant (ms) en ISO 8601 avec le décalage de Bruxelles, ex. 2026-11-13T07:42:00+01:00. */
function isoBrussels(ms) {
  if (!Number.isFinite(ms)) return null;
  const t = Math.floor(ms / 1000) * 1000;
  const p = localParts(t);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const off = Math.round((asUtc - t) / 60000);
  const a = Math.abs(off);
  const hh = String(Math.floor(a / 60)).padStart(2, '0');
  const mm = String(a % 60).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off < 0 ? '-' : '+'}${hh}:${mm}`;
}

/** Instant en UTC sans millisecondes, ex. 2026-11-13T06:30:00Z (format lu par MOTIS, sans « + » à encoder). */
const isoUtc = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');

function parseTime(s) {
  const ms = typeof s === 'string' ? Date.parse(s) : NaN;
  return Number.isFinite(ms) ? ms : NaN;
}

function usage() {
  return [
    'Usage : node bench/fetch-references.mjs [options]',
    '  --sources transitous,irail   sources à interroger (défaut : les deux)',
    '  --only t01,t21               limiter à ces trajets',
    '  --trips <fichier>            cas du banc (défaut : bench/trips.json)',
    '  --out <dossier>              sorties (défaut : bench/out)',
    '  --from-raw <dossier>         renormaliser des réponses brutes déjà reçues, sans aucune requête',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { trips: path.join(HERE, 'trips.json'), out: path.join(HERE, 'out'), sources: [...SOURCES], only: null, fromRaw: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`valeur manquante après ${arg}`);
      return v;
    };
    if (arg === '--trips') opts.trips = value();
    else if (arg === '--out') opts.out = value();
    else if (arg === '--sources') opts.sources = value().split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--only') opts.only = new Set(value().split(',').map((s) => s.trim()).filter(Boolean));
    else if (arg === '--from-raw') opts.fromRaw = value();
    else if (arg === '--help' || arg === '-h') {
      log(usage());
      process.exit(0);
    } else throw new Error(`option inconnue : ${arg}\n${usage()}`);
  }
  for (const s of opts.sources) if (!SOURCES.includes(s)) throw new Error(`source inconnue : ${s}`);
  return opts;
}

// ---------- Cas du banc ----------

const isSncb = (end) => typeof end?.area === 'string' && end.area.startsWith('sncb:');
const irailStation = (end) => `BE.NMBS.${end.area.slice('sncb:'.length).padStart(9, '0')}`;
const rawName = (c) => `${c.trip.id}_${c.moment.id}.json`;
const rawRel = (c) => `raw/${c.source}/${rawName(c)}`;

function buildCases(doc, opts) {
  const cases = [];
  for (const trip of doc.trips) {
    if (opts.only && !opts.only.has(trip.id)) continue;
    for (const moment of doc.moments) {
      if (opts.sources.includes('transitous')) cases.push({ source: 'transitous', trip, moment });
      if (opts.sources.includes('irail') && isSncb(trip.from) && isSncb(trip.to)) cases.push({ source: 'irail', trip, moment });
    }
  }
  return cases;
}

function transitousUrl(c) {
  const q = new URLSearchParams({
    fromPlace: `${c.trip.from.lat},${c.trip.from.lon}`,
    toPlace: `${c.trip.to.lat},${c.trip.to.lon}`,
    time: isoUtc(Date.parse(c.moment.at)),
    ...TRANSITOUS.fixedParams,
  });
  return `${TRANSITOUS.base}${TRANSITOUS.plan}?${q}`;
}

function irailUrl(c, pathname = IRAIL.connections) {
  const p = localParts(Date.parse(c.moment.at));
  const q = new URLSearchParams({
    from: irailStation(c.trip.from),
    to: irailStation(c.trip.to),
    date: `${p.day}${p.month}${p.year.slice(2)}`,
    time: `${p.hour}${p.minute}`,
    ...IRAIL.fixedParams,
  });
  return `${IRAIL.base}${pathname}?${q}`;
}

// ---------- Requêtes ----------

const KEPT_HEADERS = ['date', 'content-type', 'retry-after', 'cache-control', 'age', 'etag',
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'ratelimit', 'ratelimit-policy'];

function pickHeaders(headers) {
  const out = {};
  for (const h of KEPT_HEADERS) {
    const v = headers.get(h);
    if (v !== null) out[h] = v;
  }
  return out;
}

function fetchErrorText(err) {
  if (err?.name === 'TimeoutError') return 'délai dépassé';
  const cause = err?.cause;
  return [err?.message, cause?.code ?? cause?.message].filter(Boolean).join(' : ') || String(err);
}

/** Client d'une source : une requête à la fois, espacement minimal, plafond. */
class Client {
  constructor(conf) {
    this.conf = conf;
    this.sent = 0;
    this.nextAt = 0;
    this.serverFailuresInARow = 0;
    this.stopped = null;
  }

  async get(url) {
    if (this.sent >= this.conf.maxRequests) return { skipped: `plafond de ${this.conf.maxRequests} requêtes atteint` };
    const wait = this.nextAt - Date.now();
    if (wait > 0) await sleep(wait);
    this.sent++;
    const started = Date.now();
    this.nextAt = started + this.conf.minIntervalMs;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.conf.timeoutMs),
      });
      const text = await res.text();
      if (res.redirected) {
        // Une redirection suivie est une requête de plus chez eux : on la compte et on attend d'autant.
        this.sent++;
        this.nextAt = Date.now() + this.conf.minIntervalMs;
      }
      return {
        sentAt: started, status: res.status, finalUrl: res.redirected ? res.url : undefined,
        headers: pickHeaders(res.headers), text, elapsedMs: Date.now() - started,
      };
    } catch (err) {
      return { sentAt: started, status: 0, error: fetchErrorText(err), timeout: err?.name === 'TimeoutError', elapsedMs: Date.now() - started };
    }
  }
}

function retryDelayMs(r) {
  const ra = r.headers?.['retry-after'];
  const seconds = ra && /^\d+$/.test(ra.trim()) ? Number(ra.trim()) : 30;
  return Math.min(Math.max(seconds, 5), 120) * 1000;
}

const isServerFailure = (r) => r.status === 0 || r.status === 429 || r.status >= 500;
const attemptOf = (r) => ({ sentAt: isoBrussels(r.sentAt), status: r.status, elapsedMs: r.elapsedMs, ...(r.error ? { error: r.error } : {}) });

/** Une requête, et au plus une nouvelle tentative espacée (429, 502, 503, 504 ou coupure réseau ; jamais après un délai dépassé). */
async function fetchWithOneRetry(client, url, label) {
  let r = await client.get(url);
  if (r.skipped) return { skipped: r.skipped, attempts: [] };
  const attempts = [attemptOf(r)];
  const retryable = RETRYABLE.has(r.status) || (r.status === 0 && !r.timeout);
  if (retryable && client.sent < client.conf.maxRequests) {
    const delay = retryDelayMs(r);
    log(`[${client.conf.name}] ${label} : ${r.status || r.error}, nouvelle tentative dans ${delay / 1000} s`);
    await sleep(delay);
    const r2 = await client.get(url);
    if (!r2.skipped) {
      r = r2;
      attempts.push(attemptOf(r2));
    }
  }
  return { r, attempts };
}

function rawRecord(c, url, res) {
  const rec = { source: c.source, trip: c.trip.id, moment: c.moment.id, request: { url } };
  if (res.skipped) return { ...rec, skipped: res.skipped };
  const { r, attempts } = res;
  rec.request.sentAt = attempts[0]?.sentAt;
  if (attempts.length > 1) rec.attempts = attempts;
  rec.status = r.status;
  if (r.finalUrl) rec.redirectedTo = r.finalUrl;
  if (r.error) rec.error = r.error;
  rec.elapsedMs = r.elapsedMs;
  if (r.headers) rec.headers = r.headers;
  if (typeof r.text === 'string') {
    try {
      rec.body = JSON.parse(r.text);
    } catch {
      rec.bodyText = r.text.slice(0, 20000);
    }
  }
  return rec;
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 1)}\n`);
}

/** Interroge une source, cas par cas, et écrit chaque réponse brute dès qu'elle arrive. */
async function runSource(source, cases, outDir, state) {
  const conf = source === 'transitous' ? TRANSITOUS : IRAIL;
  const client = new Client(conf);
  state.clients[source] = client;
  const records = new Map();

  if (source === 'transitous' && cases.length > 0) {
    // Une seule requête légère (celle que fait le site au chargement) pour noter la version de MOTIS.
    const url = `${conf.base}${conf.serverInfo}`;
    const r = await client.get(url);
    const rec = { source, request: { url, sentAt: isoBrussels(r.sentAt) }, status: r.status, error: r.error, headers: r.headers };
    try {
      rec.body = JSON.parse(r.text);
    } catch {
      rec.bodyText = typeof r.text === 'string' ? r.text.slice(0, 2000) : undefined;
    }
    state.server = rec.body?.serverConfig ?? null;
    await writeJson(path.join(outDir, 'raw', source, '_serveur.json'), rec);
    log(`[${conf.name}] serveur : ${state.server?.motisVersion ? `MOTIS ${state.server.motisVersion}` : `version inconnue (HTTP ${r.status || r.error})`}`);
  }

  let irailPath = IRAIL.connections;
  for (const [i, c] of cases.entries()) {
    const label = `${c.trip.id} ${c.moment.id}`;
    let rec;
    if (client.stopped) {
      rec = { source, trip: c.trip.id, moment: c.moment.id, skipped: client.stopped };
    } else {
      let url = source === 'transitous' ? transitousUrl(c) : irailUrl(c, irailPath);
      let res = await fetchWithOneRetry(client, url, label);
      // Repli unique si le chemin /v1/ n'existait pas : l'ancien chemin documenté /connections/.
      if (source === 'irail' && i === 0 && res.r?.status === 404 && !looksLikeIrailError(res.r.text)) {
        irailPath = IRAIL.legacyConnections;
        log(`[${conf.name}] chemin ${IRAIL.connections} absent, repli sur ${irailPath}`);
        url = irailUrl(c, irailPath);
        res = await fetchWithOneRetry(client, url, label);
      }
      rec = rawRecord(c, url, res);
      if (res.r && isServerFailure(res.r)) client.serverFailuresInARow++;
      else if (res.r) client.serverFailuresInARow = 0;
      if (client.serverFailuresInARow >= MAX_SERVER_FAILURES_IN_A_ROW) {
        client.stopped = `source abandonnée après ${MAX_SERVER_FAILURES_IN_A_ROW} échecs de suite du serveur`;
        log(`[${conf.name}] ${client.stopped}`);
      }
    }
    records.set(rawName(c), rec);
    await writeJson(path.join(outDir, 'raw', source, rawName(c)), rec);
    const n = rec.status === 200 && rec.body ? countFound(source, rec.body) : null;
    const outcome = rec.skipped ? `non envoyé (${rec.skipped})` : rec.status ? `HTTP ${rec.status}` : `réseau : ${rec.error}`;
    log(`[${conf.name}] ${String(i + 1).padStart(3)}/${cases.length} ${label} : ${outcome}${n === null ? '' : `, ${n} itinéraire(s)`}`);
  }
  state.irailPath = irailPath;
  return records;
}

function looksLikeIrailError(text) {
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' && 'error' in body && 'message' in body;
  } catch {
    return false;
  }
}

function countFound(source, body) {
  if (source === 'transitous') return asArray(body.itineraries).length + asArray(body.direct).length;
  return asArray(body.connection).length;
}

// ---------- Normalisation ----------

function finishItinerary(depMs, arrMs, legs, extra = {}) {
  const walkSecs = legs.filter((l) => l.mode === 'walk').map((l) => l[WALK_SEC] ?? 0);
  const transitLegs = legs.filter((l) => !STREET_MODES.has(l.mode)).length;
  return {
    dep: isoBrussels(depMs),
    arr: isoBrussels(arrMs),
    durationMin: round1((arrMs - depMs) / 60000),
    transfers: Math.max(0, transitLegs - 1),
    walkTotalMin: round1(walkSecs.reduce((a, b) => a + b, 0) / 60),
    walkMaxMin: round1(Math.max(0, ...walkSecs) / 60),
    ...extra,
    legs,
  };
}

function motisPlace(p, trip) {
  // MOTIS nomme « START » et « END » un point donné en coordonnées : on reprend le nom du banc.
  const name = p?.name === 'START' ? trip.from.name : p?.name === 'END' ? trip.to.name : p?.name ?? null;
  const out = { name, lat: num(p?.lat), lon: num(p?.lon) };
  if (p?.stopId) out.id = p.stopId;
  return out;
}

function motisLeg(l, trip) {
  const mode = MOTIS_MODES[l.mode] ?? String(l.mode ?? 'other').toLowerCase();
  const start = parseTime(l.startTime);
  const end = parseTime(l.endTime);
  const leg = { mode };
  if (!STREET_MODES.has(mode)) {
    const line = [l.routeShortName, l.displayName, l.tripShortName].find((s) => typeof s === 'string' && s.trim() !== '');
    if (line) leg.line = line.trim();
    if (l.tripShortName && l.tripShortName.trim() !== leg.line) leg.trip = l.tripShortName.trim();
    if (l.headsign) leg.headsign = l.headsign;
    if (l.agencyName) leg.operator = l.agencyName;
  }
  leg.from = motisPlace(l.from, trip);
  leg.to = motisPlace(l.to, trip);
  leg.dep = isoBrussels(start);
  leg.arr = isoBrussels(end);
  if (mode === 'walk') {
    const sec = Number.isFinite(l.duration) ? l.duration : (end - start) / 1000;
    leg.walkMin = round1(sec / 60);
    leg[WALK_SEC] = sec;
  }
  const scheduled = parseTime(l.scheduledStartTime);
  if (l.realTime && Number.isFinite(scheduled) && start !== scheduled) leg.delayMin = round1((start - scheduled) / 60000);
  if (l.cancelled) leg.cancelled = true;
  return leg;
}

function normTransitous(body, trip) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.itineraries)) throw new Error('réponse sans liste d\'itinéraires');
  const one = (it, extra) => finishItinerary(parseTime(it.startTime), parseTime(it.endTime), asArray(it.legs).map((l) => motisLeg(l, trip)), extra);
  return [
    ...body.itineraries.map((it) => one(it)),
    ...asArray(body.direct).map((it) => one(it, { direct: true })),
  ];
}

function irailPlace(st) {
  const info = st?.stationinfo ?? {};
  const out = { name: info.name ?? st?.station ?? null, lat: num(info.locationY), lon: num(info.locationX) };
  if (info.id) out.id = info.id;
  return out;
}

function irailVehicle(part) {
  const info = part?.vehicleinfo ?? {};
  let type = typeof info.type === 'string' && info.type.trim() ? info.type.trim() : null;
  let number = info.number !== undefined && String(info.number).trim() ? String(info.number).trim() : null;
  if (!type || !number) {
    const id = String(info.name ?? part?.vehicle ?? '').replace(/^BE\.NMBS\./, '');
    const m = /^([A-Za-z]+)\s*(\d+)$/.exec(id);
    if (m) {
      type ??= m[1];
      number ??= m[2];
    }
  }
  return { type, number };
}

const isIrailWalk = (part) => flag(part?.walking) || part?.vehicle === 'BE.NMBS.WALK' || part?.vehicleinfo?.shortname === 'WALK';

/** Heure attendue d'un départ ou d'une arrivée iRail : heure prévue (time) plus retard annoncé (delay), en ms. */
const irailMs = (part) => (num(part?.time) + (Number.isFinite(num(part?.delay)) ? num(part.delay) : 0)) * 1000;

function irailLeg(depPart, depStation, arrPart, arrStation) {
  const walking = isIrailWalk(depPart);
  const leg = { mode: walking ? 'walk' : 'train' };
  if (!walking) {
    const { type, number } = irailVehicle(depPart);
    if (type) leg.line = type;
    if (number) leg.trip = number;
    if (depPart?.direction?.name) leg.headsign = depPart.direction.name;
  }
  const depMs = irailMs(depPart);
  const arrMs = irailMs(arrPart);
  leg.from = irailPlace(depStation);
  leg.to = irailPlace(arrStation);
  leg.dep = isoBrussels(depMs);
  leg.arr = isoBrussels(arrMs);
  if (walking) {
    leg.walkMin = round1((arrMs - depMs) / 60000);
    leg[WALK_SEC] = (arrMs - depMs) / 1000;
  }
  const delay = num(depPart?.delay);
  if (Number.isFinite(delay) && delay !== 0) leg.delayMin = round1(delay / 60);
  if (flag(depPart?.canceled) || flag(arrPart?.canceled)) leg.cancelled = true;
  return leg;
}

function irailConnection(c) {
  // Étapes : départ -> 1er via (arrivée), puis chaque via (départ) -> via suivant (arrivée), puis dernier via -> arrivée.
  // Une étape à pied entre deux gares proches porte walking = 1 (jamais en premier ni en dernier).
  const legs = [];
  let fromPart = c.departure;
  let fromStation = c.departure;
  for (const v of asArray(c.vias?.via)) {
    legs.push(irailLeg(fromPart, fromStation, v.arrival, v.arrival?.stationinfo ? v.arrival : v));
    fromPart = v.departure;
    fromStation = v.departure?.stationinfo ? v.departure : v;
  }
  legs.push(irailLeg(fromPart, fromStation, c.arrival, c.arrival));
  return finishItinerary(irailMs(c.departure), irailMs(c.arrival), legs);
}

function normIrail(body) {
  if (!body || typeof body !== 'object') throw new Error('réponse vide');
  if (body.connection === undefined && body.error !== undefined) throw new Error(`erreur ${body.error} : ${body.message ?? ''}`);
  return asArray(body.connection).map(irailConnection);
}

function errorText(rec) {
  if (rec.skipped) return `non envoyé : ${rec.skipped}`;
  if (rec.status === 0 || rec.status === undefined) return `réseau : ${rec.error ?? 'pas de réponse'}`;
  const msg = rec.body?.error && typeof rec.body.error === 'string' ? rec.body.error : rec.body?.message ?? rec.bodyText ?? '';
  return `HTTP ${rec.status}${msg ? ` : ${String(msg).replace(/\s+/g, ' ').trim().slice(0, 300)}` : ''}`;
}

function normalizeCase(c, rec) {
  const base = { trip: c.trip.id, moment: c.moment.id, source: c.source };
  if (!rec) return { ...base, ok: false, error: 'réponse brute absente', itineraries: [] };
  const raw = rawRel(c);
  if (rec.skipped || rec.status !== 200) return { ...base, ok: false, error: errorText(rec), itineraries: [], raw };
  if (rec.body === undefined) return { ...base, ok: false, error: 'réponse illisible (pas du JSON)', itineraries: [], raw };
  try {
    const itineraries = c.source === 'transitous' ? normTransitous(rec.body, c.trip) : normIrail(rec.body);
    return { ...base, ok: true, itineraries, raw };
  } catch (err) {
    return { ...base, ok: false, error: `normalisation impossible : ${err.message}`, itineraries: [], raw };
  }
}

// ---------- Fichier commun et bilan ----------

function sourcesSection(opts, state) {
  const sections = {};
  if (opts.sources.includes('transitous')) {
    sections.transitous = {
      name: TRANSITOUS.name,
      site: TRANSITOUS.site,
      endpoint: `${TRANSITOUS.base}${TRANSITOUS.plan}`,
      engine: state.server?.motisVersion ? `MOTIS ${state.server.motisVersion}` : 'MOTIS 2',
      params: {
        fromPlace: '{from.lat},{from.lon}',
        toPlace: '{to.lat},{to.lon}',
        time: '{moment.at en UTC, ex. 2026-11-13T06:30:00Z}',
        ...TRANSITOUS.fixedParams,
      },
      serverDefaults: {
        pedestrianSpeed: 'non envoyé : défaut du serveur (1,2 m/s dans MOTIS 2.10)',
        maxTransfers: 'non envoyé : défaut du serveur (sans limite pratique)',
        realtime: 'défaut du serveur : temps réel pris en compte quand il existe',
      },
      ...(state.server ? { server: pick(state.server, ['motisVersion', 'hasRoutedTransfers', 'maxPrePostTransitTimeLimit', 'maxDirectTimeLimit']) } : {}),
      userAgent: USER_AGENT,
      minIntervalMs: TRANSITOUS.minIntervalMs,
      requestsSent: state.clients.transitous?.sent ?? null,
      attribution: 'Itinéraires calculés par Transitous (https://transitous.org). Sources des données : https://transitous.org/sources/ (Belgique : SNCB ; STIB-MIVB, De Lijn et TEC sous licence CC BY 4.0). Réseau piéton : © les contributeurs d\'OpenStreetMap, ODbL (https://www.openstreetmap.org/copyright).',
    };
  }
  if (opts.sources.includes('irail')) {
    sections.irail = {
      name: IRAIL.name,
      site: IRAIL.site,
      endpoint: `${IRAIL.base}${state.irailPath ?? IRAIL.connections}`,
      params: {
        from: 'BE.NMBS.{code SNCB du départ sur 9 chiffres}',
        to: 'BE.NMBS.{code SNCB de l\'arrivée sur 9 chiffres}',
        date: '{jjmmaa, heure de Bruxelles}',
        time: '{hhmm, heure de Bruxelles}',
        ...IRAIL.fixedParams,
      },
      serverDefaults: { typeOfTransport: 'non envoyé : automatic (trains nationaux entre deux gares belges)' },
      userAgent: USER_AGENT,
      minIntervalMs: IRAIL.minIntervalMs,
      requestsSent: state.clients.irail?.sent ?? null,
      attribution: 'Trains : API iRail (https://irail.be, https://api.irail.be), d\'après les données de la SNCB.',
    };
  }
  return sections;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k];
  return out;
}

function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function summarize(source, cases, momentsById) {
  const mine = cases.filter((c) => c.source === source);
  const ok = mine.filter((c) => c.ok);
  const found = ok.filter((c) => c.itineraries.length > 0);
  const its = ok.flatMap((c) => c.itineraries);
  // Contrôles de cohérence : premier départ par rapport à l'heure demandée (fuseau horaire), correspondances.
  const firstGaps = [];
  let early = 0;
  for (const c of found) {
    const asked = Date.parse(momentsById.get(c.moment).at);
    const transit = c.itineraries.filter((it) => !it.direct);
    if (transit.length === 0) continue;
    const first = Math.min(...transit.map((it) => Date.parse(it.dep)));
    const gap = Math.round((first - asked) / 60000);
    firstGaps.push(gap);
    if (gap < 0) early++;
  }
  const lines = [
    `${source} : ${mine.length} cas, ${ok.length} réponses valides, ${found.length} avec au moins un itinéraire, ${its.length} itinéraires`
      + ` (médiane ${median(found.map((c) => c.itineraries.length)) ?? 0} par cas)`,
    `  premier départ après l'heure demandée : médiane ${median(firstGaps) ?? '-'} min, max ${firstGaps.length ? Math.max(...firstGaps) : '-'} min ; avant l'heure demandée : ${early} cas`,
  ];
  for (const c of mine.filter((x) => !x.ok)) lines.push(`  erreur ${c.trip} ${c.moment} : ${c.error}`);
  for (const c of ok.filter((x) => x.itineraries.length === 0)) lines.push(`  aucun itinéraire : ${c.trip} ${c.moment}`);
  return { lines, total: mine.length, ok: ok.length, found: found.length, itineraries: its.length };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const doc = JSON.parse(await readFile(opts.trips, 'utf8'));
  const momentsById = new Map(doc.moments.map((m) => [m.id, m]));
  const cases = buildCases(doc, opts);
  const outDir = path.resolve(opts.out);
  const state = { clients: {}, server: null, irailPath: null };
  const records = new Map(); // `${source}/${fichier}` -> réponse brute

  if (opts.fromRaw) {
    const rawDir = path.resolve(opts.fromRaw);
    log(`Renormalisation depuis ${rawDir}, sans aucune requête.`);
    try {
      state.server = JSON.parse(await readFile(path.join(rawDir, 'transitous', '_serveur.json'), 'utf8')).body?.serverConfig ?? null;
    } catch {
      state.server = null;
    }
    for (const c of cases) {
      try {
        records.set(`${c.source}/${rawName(c)}`, JSON.parse(await readFile(path.join(rawDir, c.source, rawName(c)), 'utf8')));
      } catch {
        // Réponse absente : le cas sera marqué en erreur.
      }
      if (c.source === 'irail' && !state.irailPath) {
        const rec = records.get(`${c.source}/${rawName(c)}`);
        if (URL.canParse(rec?.redirectedTo ?? rec?.request?.url ?? '')) state.irailPath = new URL(rec.redirectedTo ?? rec.request.url).pathname;
      }
    }
  } else {
    log(`Interrogation de ${opts.sources.join(' et ')} : ${cases.length} cas. User-Agent : ${USER_AGENT}`);
    const bySource = await Promise.all(opts.sources.map((s) => runSource(s, cases.filter((c) => c.source === s), outDir, state)));
    for (const [i, s] of opts.sources.entries()) for (const [file, rec] of bySource[i]) records.set(`${s}/${file}`, rec);
  }

  const normalized = cases.map((c) => normalizeCase(c, records.get(`${c.source}/${rawName(c)}`)));
  const result = { generatedAt: isoBrussels(Date.now()), sources: sourcesSection(opts, state), cases: normalized };
  await writeJson(path.join(outDir, 'references.json'), result);

  const summaries = opts.sources.map((s) => summarize(s, normalized, momentsById));
  log('');
  for (const s of summaries) for (const line of s.lines) log(line);
  log(`\nFichier commun : ${path.join(outDir, 'references.json')}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = ['## Banc d\'essai : références externes', '', '| Source | Cas | Réponses valides | Avec itinéraires | Itinéraires | Requêtes envoyées |', '|---|---|---|---|---|---|'];
    for (const [i, s] of summaries.entries()) md.push(`| ${opts.sources[i]} | ${s.total} | ${s.ok} | ${s.found} | ${s.itineraries} | ${state.clients[opts.sources[i]]?.sent ?? '-'} |`);
    md.push('', '```', ...summaries.flatMap((s) => s.lines), '```', '');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${md.join('\n')}\n`);
  }
  const silent = opts.sources.filter((s, i) => summaries[i].total > 0 && summaries[i].ok === 0);
  if (silent.length > 0) {
    console.error(`Aucune réponse valide de : ${silent.join(', ')}. Les réponses brutes disent pourquoi.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
