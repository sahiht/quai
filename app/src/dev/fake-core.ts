/**
 * Faux cœur de développement (?fake=1) : implémente l'interface Core avec un petit réseau statique
 * tiré de fixtures/network.json, et reproduit les trois scénarios des maquettes (Visite1-3).
 * Sensible à l'heure via now() : horaires générés chaque jour, temps réel selon l'heure
 * (ex. l'IC de 07:42 à Namur passe en voie 6 avec +2 min à partir de 07:35).
 */
import type {
  Alert,
  Board,
  Core,
  CoreOptions,
  CoreStatus,
  Departure,
  Endpoint,
  Favorite,
  FavoriteAnswer,
  FavoriteRank,
  GeocodeAnswer,
  PlanResult,
  Journey,
  Leg,
  LineFilter,
  Meta,
  NearbyItem,
  SearchItem,
  Settings,
  Stopover,
  Suggestion,
} from '../core/api';
import { distanceM, gtfsTime, hhmm, kindLabel, localDate, localMinutes, walkMinutes } from '../core/util';
import type { AreaSummary, HealthResponse, Mode, Names, Op } from '../../../shared/types';
import { matchesQuery, normalizeForSearch, prettyName } from '../../../shared/names';

export interface FakeFlags {
  stale?: boolean;
  noRt?: boolean;
}

const N = (fr: string, nl = fr, l?: 'fr' | 'nl'): Names => (l ? { fr, nl, l } : { fr, nl });
const A = (id: string, op: Op, n: Names, lat: number, lon: number, modes: Mode[], lines: string[]): AreaSummary => ({ id, op, n, lat, lon, modes, lines });

/* ------------------------------ Réseau ------------------------------ */

const AREAS: AreaSummary[] = [
  A('sncb:8863008', 'sncb', N('Namur', 'Namen'), 50.4685, 4.8625, ['train'], ['IC']),
  A('sncb:8874005', 'sncb', N('Gembloux', 'Gembloers'), 50.5707, 4.6913, ['train'], ['IC']),
  A('sncb:8811601', 'sncb', N('Ottignies'), 50.6727, 4.5694, ['train'], ['IC']),
  A('sncb:8811304', 'sncb', N('Bruxelles-Luxembourg', 'Brussel-Luxemburg'), 50.8388, 4.3732, ['train'], ['IC']),
  A('sncb:8811916', 'sncb', N('Bruxelles-Schuman', 'Brussel-Schuman'), 50.8433, 4.3804, ['train'], ['IC']),
  A('sncb:8812005', 'sncb', N('Bruxelles-Nord', 'Brussel-Noord'), 50.8605, 4.3612, ['train'], ['IC', 'S1']),
  A('sncb:8813003', 'sncb', N('Bruxelles-Central', 'Brussel-Centraal'), 50.8454, 4.3571, ['train'], ['IC', 'S1']),
  A('sncb:8814001', 'sncb', N('Bruxelles-Midi', 'Brussel-Zuid'), 50.8357, 4.3363, ['train'], ['IC', 'S1']),
  A('sncb:8892007', 'sncb', N('Gand-Saint-Pierre', 'Gent-Sint-Pieters', 'nl'), 51.0359, 3.7107, ['train'], ['IC']),
  A('sncb:8893120', 'sncb', N('Gand-Dampoort', 'Gent-Dampoort', 'nl'), 51.0563, 3.7406, ['train'], ['IC']),
  A('sncb:8891009', 'sncb', N('Bruges', 'Brugge', 'nl'), 51.1972, 3.2167, ['train'], ['IC']),
  A('sncb:8822004', 'sncb', N('Malines', 'Mechelen', 'nl'), 51.0175, 4.4831, ['train'], ['IC']),
  A('sncb:8821006', 'sncb', N('Anvers-Central', 'Antwerpen-Centraal', 'nl'), 51.2172, 4.4211, ['train'], ['IC']),
  A('sncb:8883006', 'sncb', N('Nivelles', 'Nijvel'), 50.5996, 4.3289, ['train'], ['S1']),
  A('stib:6357F', 'stib', N('Gare du Nord', 'Noordstation'), 50.86004, 4.36017, ['tram'], ['3', '4']),
  A('stib:6359', 'stib', N('Rogier'), 50.8569, 4.3589, ['metro', 'tram'], ['2', '3', '4', '6']),
  A('stib:6362', 'stib', N('Bourse', 'Beurs'), 50.8483, 4.3497, ['tram'], ['3', '4']),
  A('stib:6366', 'stib', N('Churchill'), 50.80752, 4.36605, ['tram'], ['3']),
  A('delijn:308611', 'delijn', N('Bruxelles-Nord', 'Brussel Noordstation', 'nl'), 50.86183, 4.35906, ['bus'], ['232', '460', '270']),
  A('delijn:200553', 'delijn', N('Gand-Saint-Pierre', 'Gent Sint-Pietersstation', 'nl'), 51.03622, 3.71105, ['tram'], ['1']),
  A('delijn:200101', 'delijn', N('Korenmarkt, Gand', 'Gent Korenmarkt', 'nl'), 51.05472, 3.72145, ['tram'], ['1']),
  A('tec:N508aga', 'tec', N('Namur Gare'), 50.46803, 4.86356, ['bus'], ['4', '5', '51']),
  A('tec:N509aaa', 'tec', N('Namur Place Léopold'), 50.466, 4.861, ['bus'], ['5']),
];
const AREA = new Map(AREAS.map((a) => [a.id, a]));
const area = (id: string): AreaSummary => {
  const a = AREA.get(id);
  if (!a) throw new Error('Arrêt introuvable dans les données du jour');
  return a;
};

/** Trains : gabarits avec heures de départ (min depuis minuit) et arrêts [gare, décalage arr, décalage dép, voie]. */
interface TrainTpl { key: string; cat: string; num: string; head: Names; stops: [string, number, number, string][]; starts: number[]; /** Voies d'une autre série (minute de départ → gare → voie). */ alt?: Record<number, Record<string, string>> }
const hours = (from: number, to: number, minute: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => (from + i) * 60 + minute);
const TRAINS: TrainTpl[] = [
  {
    key: 'IC-NAM-MIDI', cat: 'IC', num: '2112', head: N('Bruxelles-Midi', 'Brussel-Zuid'), starts: hours(5, 21, 42),
    stops: [['sncb:8863008', 0, 0, '4'], ['sncb:8874005', 13, 13, '1'], ['sncb:8811601', 27, 27, '2'], ['sncb:8811304', 49, 49, '1'], ['sncb:8811916', 53, 53, '2'], ['sncb:8812005', 58, 59, '11'], ['sncb:8813003', 64, 64, '3'], ['sncb:8814001', 70, 70, '15']],
  },
  {
    key: 'IC-NORD-BRUGES', cat: 'IC', num: '1510', head: N('Bruges', 'Brugge', 'nl'), starts: [...hours(6, 21, 6), ...hours(6, 21, 36), 8 * 60 + 56].sort((a, b) => a - b),
    stops: [['sncb:8812005', 0, 0, '11'], ['sncb:8813003', 4, 4, '4'], ['sncb:8814001', 8, 8, '12'], ['sncb:8892007', 33, 33, '8'], ['sncb:8891009', 56, 56, '5']],
  },
  {
    key: 'IC-MIDI-ANVERS', cat: 'IC', num: '2412', head: N('Anvers-Central', 'Antwerpen-Centraal', 'nl'), starts: [...hours(6, 22, 12), ...hours(6, 22, 20)].sort((a, b) => a - b),
    alt: { 20: { 'sncb:8814001': '6', 'sncb:8813003': '1', 'sncb:8812005': '12' } },
    stops: [['sncb:8814001', 0, 0, '19'], ['sncb:8813003', 5, 5, '5'], ['sncb:8812005', 10, 10, '9'], ['sncb:8822004', 25, 25, '7'], ['sncb:8821006', 46, 46, '22']],
  },
  {
    key: 'S1-NORD-NIVELLES', cat: 'S1', num: '1987', head: N('Nivelles', 'Nijvel'), starts: hours(6, 22, 34),
    stops: [['sncb:8812005', 0, 0, '3'], ['sncb:8813003', 4, 4, '1'], ['sncb:8814001', 8, 8, '6'], ['sncb:8883006', 41, 41, '2']],
  },
  {
    key: 'IC-NORD-GAND-ANVERS', cat: 'IC', num: '1810', head: N('Anvers-Central', 'Antwerpen-Centraal', 'nl'), starts: hours(13, 20, 18),
    stops: [['sncb:8812005', 0, 0, '12'], ['sncb:8813003', 4, 4, '6'], ['sncb:8814001', 8, 8, '12'], ['sncb:8892007', 35, 35, '9'], ['sncb:8893120', 43, 43, '2'], ['sncb:8821006', 94, 94, '22']],
  },
];

interface TrainRt { rt: boolean; delay: number; platformAt?: Record<string, string>; cancelled?: boolean }
/** Temps réel des trains selon l'instance (gabarit + heure de départ) et l'heure actuelle. */
function trainRt(t: TrainTpl, start: number, now: number, flags: FakeFlags): TrainRt {
  if (flags.noRt) return { rt: false, delay: 0 };
  const m = localMinutes(now);
  if (t.key === 'IC-NAM-MIDI' && start === 7 * 60 + 42) return m >= 7 * 60 + 35 ? { rt: true, delay: 2, platformAt: { 'sncb:8863008': '6' } } : { rt: true, delay: 0 };
  if (t.key === 'IC-MIDI-ANVERS' && start === 12 * 60 + 20) return { rt: false, delay: 0 };
  if (t.key === 'S1-NORD-NIVELLES' && start === 12 * 60 + 34) return { rt: true, delay: 0, cancelled: true };
  if (t.key === 'IC-NORD-GAND-ANVERS' && start === 14 * 60 + 18) return { rt: true, delay: 3 };
  return { rt: true, delay: 0 };
}

/** Bus, trams, métros : services par zone (premier départ, fréquence, dernier départ). */
interface Svc { line: string; mode: Mode; head: Names; first: number; every: number; last: number; platform?: string; msg?: string; rt: (sched: number) => { rt: boolean; delay: number } | null }
const hm = (h: number, m: number): number => h * 60 + m;
const stibRt = (now: () => number) => (sched: number) => (sched - localMinutes(now()) <= 30 ? { rt: true, delay: 0 } : null);
const exact = (table: Record<number, number>) => (sched: number) => (sched in table ? { rt: true, delay: table[sched] } : null);

function services(now: () => number): Record<string, Svc[]> {
  const stib = stibRt(now);
  return {
    'stib:6357F': [
      { line: '3', mode: 'tram', head: N('Churchill'), first: hm(6, 4), every: 8, last: hm(23, 0), rt: stib },
      { line: '4', mode: 'tram', head: N('Stalle (P)'), first: hm(6, 7), every: 8, last: hm(22, 55), rt: stib },
      { line: '3', mode: 'tram', head: N('Esplanade'), first: hm(6, 8), every: 8, last: hm(23, 0), rt: stib },
    ],
    'stib:6359': [
      { line: '2', mode: 'metro', head: N('Simonis (Elisabeth)'), first: hm(6, 7), every: 6, last: hm(24, 1), rt: stib },
      { line: '2', mode: 'metro', head: N('Gare du Midi', 'Zuidstation'), first: hm(6, 14), every: 6, last: hm(24, 4), rt: stib, msg: 'Travaux : arrêt Botanique non desservi' },
      { line: '6', mode: 'metro', head: N('Roi Baudouin', 'Koning Boudewijn'), first: hm(6, 5), every: 10, last: hm(23, 55), rt: stib },
      { line: '3', mode: 'tram', head: N('Churchill'), first: hm(6, 6), every: 8, last: hm(23, 0), rt: stib },
    ],
    'stib:6362': [{ line: '3', mode: 'tram', head: N('Churchill'), first: hm(6, 9), every: 8, last: hm(23, 0), rt: stib }],
    'stib:6366': [{ line: '3', mode: 'tram', head: N('Esplanade'), first: hm(5, 45), every: 8, last: hm(22, 37), rt: stib }],
    'delijn:308611': [
      { line: '232', mode: 'bus', head: N('Vilvorde', 'Vilvoorde', 'nl'), first: hm(6, 0), every: 15, last: hm(22, 45), platform: '4', rt: exact({ [hm(12, 30)]: 0, [hm(12, 45)]: 1 }) },
      { line: '460', mode: 'bus', head: N('Meise', 'Meise', 'nl'), first: hm(6, 18), every: 30, last: hm(22, 48), platform: '6', rt: exact({ [hm(12, 18)]: 2 }) },
      { line: '270', mode: 'bus', head: N('Kortenberg', 'Kortenberg', 'nl'), first: hm(6, 22), every: 30, last: hm(22, 52), platform: '4', rt: () => null },
    ],
    'delijn:200553': [{ line: '1', mode: 'tram', head: N('Korenmarkt, Gand', 'Gent Korenmarkt', 'nl'), first: hm(6, 12), every: 8, last: hm(23, 0), platform: '3', rt: exact({ [hm(14, 44)]: 0, [hm(14, 52)]: 1 }) }],
    'delijn:200101': [{ line: '1', mode: 'tram', head: N('Flanders Expo, Gand', 'Gent Flanders Expo', 'nl'), first: hm(6, 0), every: 8, last: hm(22, 48), platform: '2', rt: () => null }],
    'tec:N508aga': [
      { line: '4', mode: 'bus', head: N('Jambes'), first: hm(6, 0), every: 15, last: hm(23, 45), platform: 'A', rt: exact({ [hm(7, 45)]: 0 }) },
      { line: '5', mode: 'bus', head: N('Bouge'), first: hm(6, 14), every: 20, last: hm(22, 54), platform: 'B', rt: () => null },
      { line: '51', mode: 'bus', head: N('Salzinnes'), first: hm(6, 5), every: 30, last: hm(21, 35), platform: 'A', rt: () => null },
    ],
    'tec:N509aaa': [{ line: '5', mode: 'bus', head: N('Bouge'), first: hm(6, 10), every: 20, last: hm(22, 50), rt: exact({ [hm(7, 50)]: 3 }) }],
  };
}

/* ------------------------------ Outils ------------------------------ */

const dayOf = (now: number): string => localDate(now);
const T = (date: string, min: number): number => gtfsTime(date, min);
const headMatch = (head: Names, f: LineFilter): boolean => normalizeForSearch(prettyName(head.fr)) === f.head;
const passes = (filter: LineFilter[] | undefined, line: string, head: Names): boolean => !filter?.length || filter.some((f) => f.line === line && headMatch(head, f));

interface TrainRun { tpl: TrainTpl; start: number; date: string; rt: TrainRt; id: string }
/** Trains du jour de `at` ; le temps réel dépend de l'heure actuelle `now`, pas de l'heure demandée. */
function trainRuns(at: number, now: number, flags: FakeFlags): TrainRun[] {
  const date = dayOf(at);
  return TRAINS.flatMap((tpl) => tpl.starts.map((start) => ({ tpl, start, date, rt: trainRt(tpl, start, now, flags), id: `${tpl.key}-${String(Math.floor(start / 60)).padStart(2, '0')}${String(start % 60).padStart(2, '0')}` })));
}

function stopTimes(r: TrainRun, k: number): { sched: number; est: number; arrSched: number; arrEst: number; platform: string; newPlatform?: string } {
  const [areaId, arrOff, depOff, basePlatform] = r.tpl.stops[k];
  const platform = r.tpl.alt?.[r.start % 60]?.[areaId] ?? basePlatform;
  const delay = r.rt.delay * 60_000;
  const sched = T(r.date, r.start + depOff);
  const arrSched = T(r.date, r.start + arrOff);
  const np = r.rt.platformAt?.[areaId];
  return { sched, est: sched + delay, arrSched, arrEst: arrSched + delay, platform, newPlatform: np && np !== platform ? np : undefined };
}

/* ------------------------------ Cœur factice ------------------------------ */

export function createFakeCore(opts: CoreOptions, flags: FakeFlags = {}): Core {
  const now = (): number => opts.now();
  const svc = services(now);
  let meta: Meta | null = null;

  function departuresAt(areaId: string, from: number, filter?: LineFilter[]): Departure[] {
    const a = area(areaId);
    const date = dayOf(from);
    const out: Departure[] = [];
    if (a.op === 'sncb') {
      for (const r of trainRuns(from, now(), flags)) {
        const k = r.tpl.stops.findIndex((s) => s[0] === areaId);
        if (k < 0 || k === r.tpl.stops.length - 1) continue;
        const t = stopTimes(r, k);
        if (t.est < from - 30_000 || !passes(filter, r.tpl.cat, r.tpl.head)) continue;
        out.push({ op: 'sncb', mode: 'train', line: r.tpl.cat, head: r.tpl.head, sched: t.sched, est: t.est, rt: r.rt.rt, delayMin: r.rt.delay, cancelled: !!r.rt.cancelled, platform: t.platform, newPlatform: t.newPlatform, tripId: r.id, stopSeq: k + 1 });
      }
    } else {
      for (const s of svc[areaId] ?? []) {
        if (!passes(filter, s.line, s.head)) continue;
        for (let m = s.first; m <= s.last; m += s.every) {
          const sched = T(date, m);
          const rt = flags.noRt ? null : s.rt(m);
          const est = sched + (rt?.delay ?? 0) * 60_000;
          if (est < from - 30_000) continue;
          if (est > from + 3 * 3_600_000) break;
          out.push({ op: a.op, mode: s.mode, line: s.line, head: s.head, sched, est, rt: !!rt, delayMin: rt?.delay ?? 0, cancelled: false, platform: s.platform, msg: s.msg && rt ? s.msg : undefined });
        }
      }
    }
    return out.sort((x, y) => x.est - y.est);
  }

  function rideLeg(r: TrainRun, k1: number, k2: number): Leg {
    const a = stopTimes(r, k1);
    const b = stopTimes(r, k2);
    const st = (k: number): Stopover => {
      const t = stopTimes(r, k);
      const ar = area(r.tpl.stops[k][0]);
      return { name: ar.n, areaId: ar.id, sched: k === k1 ? t.sched : t.arrSched, est: k === k1 ? t.est : t.arrEst, platform: t.newPlatform ?? t.platform };
    };
    const fa = area(r.tpl.stops[k1][0]);
    const ta = area(r.tpl.stops[k2][0]);
    return {
      kind: 'ride',
      from: { name: fa.n, lat: fa.lat, lon: fa.lon, areaId: fa.id },
      to: { name: ta.n, lat: ta.lat, lon: ta.lon, areaId: ta.id },
      dep: a.est,
      arr: b.arrEst,
      schedDep: a.sched,
      schedArr: b.arrSched,
      op: 'sncb',
      mode: 'train',
      line: r.tpl.cat,
      cat: r.tpl.cat,
      num: r.tpl.num,
      head: r.tpl.head,
      tripId: r.id,
      fromSeq: k1 + 1,
      toSeq: k2 + 1,
      platform: a.platform,
      newPlatform: a.newPlatform,
      rt: r.rt.rt,
      delayMin: r.rt.delay,
      cancelled: !!r.rt.cancelled,
      stops: Array.from({ length: k2 - k1 + 1 }, (_, i) => st(k1 + i)),
    };
  }

  function journeyOf(legs: Leg[], settings: Settings | null, id: string): Journey {
    const rides = legs.filter((l) => l.kind === 'ride');
    const first = rides[0];
    const walk0 = legs[0]?.kind === 'walk' ? legs[0].walkMin ?? 0 : 0;
    const margin = settings?.alerts.leaveBeforeMin ?? 2;
    const leaveAt = first ? first.dep - (walk0 + margin) * 60_000 : legs[0].dep;
    const j: Journey = { id, legs, dep: legs[0].dep, arr: legs[legs.length - 1].arr, leaveAt, transfers: Math.max(0, rides.length - 1), rt: rides.every((r) => r.rt), alerts: [] };
    j.alerts = alertsFor(j, settings);
    return j;
  }

  function alertsFor(j: Journey, settings: Settings | null): Alert[] {
    const out: Alert[] = [];
    const a = settings?.alerts;
    const t = now();
    for (const l of j.legs) {
      if (l.kind !== 'ride') continue;
      const label = l.cat ?? l.line ?? '';
      if ((a?.cancel ?? true) && l.cancelled) out.push({ kind: 'cancel', text: `! ${label} ${hhmm(l.schedDep)} supprimé`, at: t });
      if ((a?.platform ?? true) && l.newPlatform) out.push({ kind: 'platform', text: `! Voie modifiée : l’${label} part de la voie ${l.newPlatform}`, at: t });
      if ((a?.delay ?? true) && (l.delayMin ?? 0) >= (a?.delayMin ?? 5)) out.push({ kind: 'delay', text: `! ${label} ${hhmm(l.schedDep)} : +${l.delayMin} min`, at: t });
    }
    if ((a?.leave ?? true) && t >= j.leaveAt - 60_000 && t < j.leaveAt + 60_000) out.push({ kind: 'leave', text: `Partir maintenant : ${j.legs[0]?.walkMin ?? 0} min à pied`, at: t });
    return out;
  }

  function trainsBetween(fromId: string, toId: string, after: number, limit: number): Journey[] {
    const runs = trainRuns(after, now(), flags);
    const out: Journey[] = [];
    for (const r of runs) {
      const k1 = r.tpl.stops.findIndex((s) => s[0] === fromId);
      const k2 = r.tpl.stops.findIndex((s) => s[0] === toId);
      if (k1 < 0 || k2 <= k1) continue;
      const leg = rideLeg(r, k1, k2);
      if (leg.dep < after) continue;
      out.push(journeyOf([leg], null, `${r.id}:${fromId}>${toId}`));
    }
    // Une correspondance (4 min minimum dans la même gare) si pas de direct.
    if (!out.length) {
      for (const r1 of runs) {
        const k1 = r1.tpl.stops.findIndex((s) => s[0] === fromId);
        if (k1 < 0) continue;
        for (let kx = k1 + 1; kx < r1.tpl.stops.length; kx++) {
          const via = r1.tpl.stops[kx][0];
          const l1 = rideLeg(r1, k1, kx);
          if (l1.dep < after) break;
          for (const r2 of runs) {
            if (r2 === r1) continue;
            const a = r2.tpl.stops.findIndex((s) => s[0] === via);
            const b = r2.tpl.stops.findIndex((s) => s[0] === toId);
            if (a < 0 || b <= a) continue;
            const l2 = rideLeg(r2, a, b);
            if (l2.dep < l1.arr + 4 * 60_000) continue;
            out.push(journeyOf([l1, l2], null, `${r1.id}+${r2.id}:${fromId}>${toId}`));
          }
        }
      }
    }
    out.sort((x, y) => x.arr - y.arr || x.dep - y.dep);
    const seen = new Set<number>();
    return out.filter((j) => (seen.has(j.dep) ? false : (seen.add(j.dep), true))).sort((x, y) => x.dep - y.dep).slice(0, limit);
  }

  function resolve(e: Endpoint, settings: Settings, here?: { lat: number; lon: number }): { lat: number; lon: number; name: Names; areaId?: string } {
    if (e.type === 'here') {
      if (!here) throw new Error('Position inconnue : active la localisation');
      return { ...here, name: N('Ma position') };
    }
    if (e.type === 'area') return { lat: e.lat, lon: e.lon, name: e.name, areaId: e.areaId };
    if (e.type === 'address') return { lat: e.lat, lon: e.lon, name: N(e.label) };
    const p = settings.places.find((x) => x.id === e.placeId);
    if (!p) throw new Error('Lieu introuvable dans tes réglages');
    return { lat: p.lat, lon: p.lon, name: N(p.label) };
  }

  const walkLeg = (from: { lat: number; lon: number; name: Names }, to: { lat: number; lon: number; name: Names; areaId?: string }, dep: number, arr: number): Leg => ({
    kind: 'walk',
    from: { name: from.name, lat: from.lat, lon: from.lon },
    to: { name: to.name, lat: to.lat, lon: to.lon, areaId: to.areaId },
    dep,
    arr,
    schedDep: dep,
    schedArr: arr,
    walkMin: Math.round((arr - dep) / 60_000),
  });

  const core: Core = {
    async init() {
      const t = now();
      const date = dayOf(flags.stale ? t - 3 * 86_400_000 : t);
      const gen = T(date, 3 * 60 + 12);
      meta = {
        v: 1,
        generatedAt: new Date(gen).toISOString(),
        timezone: 'Europe/Brussels',
        serviceDates: [date, dayOf(T(date, 36 * 60))],
        tile: { lat: 0.02, lon: 0.03 },
        feeds: {
          sncb: { ok: true, areas: 14, trips: 120 },
          stib: { ok: true, areas: 10, trips: 900 },
          delijn: { ok: true, areas: 8, trips: 300 },
          tec: { ok: true, areas: 6, trips: 200 },
        },
      };
      return meta;
    },
    get meta() {
      return meta;
    },
    async nearby(lat, lon, radiusM) {
      const t = now();
      const out: NearbyItem[] = [];
      for (const a of AREAS) {
        const d = distanceM({ lat, lon }, a);
        if (d > radiusM) continue;
        out.push({ area: a, distanceM: Math.round(d / 10) * 10, walkMin: walkMinutes(d), next: departuresAt(a.id, t)[0] });
      }
      return out.sort((x, y) => x.distanceM - y.distanceM);
    },
    async board(areaId, o = {}) {
      const a = area(areaId);
      const deps = departuresAt(areaId, now(), o.filter).slice(0, o.limit ?? 8);
      return { area: a, departures: deps, anyPlanned: deps.some((d) => !d.rt), rtErrors: flags.noRt ? [a.op] : [], updatedAt: now() } satisfies Board;
    },
    async linesAt(areaId) {
      const a = area(areaId);
      const seen = new Map<string, { line: string; mode: Mode; head: Names; filter: LineFilter }>();
      const add = (line: string, mode: Mode, head: Names): void => {
        const f = { line, head: normalizeForSearch(prettyName(head.fr)) };
        seen.set(`${line}|${f.head}`, { line, mode, head, filter: f });
      };
      if (a.op === 'sncb') for (const t of TRAINS) if (t.stops.some((s, i) => s[0] === areaId && i < t.stops.length - 1)) add(t.cat, 'train', t.head);
      for (const s of svc[areaId] ?? []) add(s.line, s.mode, s.head);
      return [...seen.values()].sort((x, y) => x.line.localeCompare(y.line, 'fr', { numeric: true }) || x.head.fr.localeCompare(y.head.fr));
    },
    async search(query, near) {
      if (normalizeForSearch(query).length < 2) return [];
      const hits = AREAS.filter((a) => matchesQuery(query, a.n.fr, a.n.nl));
      // Gares d'abord (ordre d'importance du réseau), puis les arrêts les plus proches ;
      // à distance comparable (5 km), le nom le plus court d'abord (scénario 3 : « Gand »).
      const gares = hits.filter((a) => a.op === 'sncb');
      const others = hits.filter((a) => a.op !== 'sncb');
      if (near) others.sort((x, y) => Math.round(distanceM(near, x) / 5000) - Math.round(distanceM(near, y) / 5000) || x.n.fr.length - y.n.fr.length);
      return [...gares, ...others].slice(0, 20).map((a): SearchItem => ({ id: a.id, op: a.op, n: a.n, modes: a.modes, lat: a.lat, lon: a.lon, kindLabel: kindLabel(a.op, a.modes) }));
    },
    async trains(fromAreaId, toAreaId, after, limit = 3) {
      area(fromAreaId);
      area(toAreaId);
      return trainsBetween(fromAreaId, toAreaId, after, limit);
    },
    async plan(from, to, after, settings, here) {
      const a = resolve(from, settings, here);
      const b = resolve(to, settings, here);
      const maxWalk = settings.maxWalkMin;
      const direct = distanceM(a, b);
      if (walkMinutes(direct) <= maxWalk) {
        const w = walkMinutes(direct);
        return [journeyOf([walkLeg(a, b, after, after + w * 60_000)], settings, `walk:${Math.round(after / 60_000)}`)];
      }
      const stations = AREAS.filter((x) => x.op === 'sncb');
      const near = (p: { lat: number; lon: number }) => stations.map((s) => ({ s, d: distanceM(p, s) })).filter((x) => walkMinutes(x.d) <= Math.max(maxWalk, 12)).sort((x, y) => x.d - y.d)[0];
      const s1 = a.areaId?.startsWith('sncb:') ? { s: area(a.areaId), d: 0 } : near(a);
      const s2 = b.areaId?.startsWith('sncb:') ? { s: area(b.areaId), d: 0 } : near(b);
      if (!s1 || !s2 || s1.s.id === s2.s.id) return [];
      const w1 = s1.d ? walkMinutes(s1.d) : 0;
      const w2 = s2.d ? walkMinutes(s2.d) : 0;
      const trains = trainsBetween(s1.s.id, s2.s.id, after + w1 * 60_000, 3);
      return trains.map((tj) => {
        const legs: Leg[] = [];
        const first = tj.legs[0];
        const last = tj.legs[tj.legs.length - 1];
        if (w1) legs.push(walkLeg(a, { ...s1.s, name: s1.s.n, areaId: s1.s.id }, first.dep - w1 * 60_000, first.dep));
        legs.push(...tj.legs);
        if (w2) legs.push(walkLeg({ ...s2.s, name: s2.s.n }, b, last.arr, last.arr + w2 * 60_000));
        return journeyOf(legs, settings, `plan:${tj.id}`);
      });
    },
    async refresh(j, settings) {
      const t = now();
      const runs = new Map(trainRuns(j.dep, t, flags).map((r) => [r.id, r]));
      let shift = 0;
      const legs = j.legs.map((l): Leg => {
        if (l.kind === 'ride' && l.tripId && runs.has(l.tripId)) {
          const r = runs.get(l.tripId)!;
          const k1 = (l.fromSeq ?? 1) - 1;
          const k2 = (l.toSeq ?? r.tpl.stops.length) - 1;
          const fresh = rideLeg(r, k1, k2);
          shift = fresh.arr - l.arr;
          return fresh;
        }
        if (l.kind === 'walk') {
          const prevShift = shift;
          return prevShift ? { ...l, dep: l.dep + prevShift, arr: l.arr + prevShift } : l;
        }
        return l;
      });
      // La marche du départ se cale sur le premier train (heure conseillée recalculée).
      const firstRide = legs.findIndex((l) => l.kind === 'ride');
      if (firstRide > 0 && legs[0].kind === 'walk') {
        const w = legs[0].walkMin ?? 0;
        legs[0] = { ...legs[0], dep: legs[firstRide].dep - w * 60_000, arr: legs[firstRide].dep };
      }
      return journeyOf(legs, settings, j.id);
    },
    async suggest(here, settings) {
      const t = now();
      if (here) {
        for (const f of settings.favorites) {
          if (f.kind !== 'stop' || f.propose !== 'near') continue;
          if (distanceM(here, f) <= 300) {
            const board = await core.board(f.areaId, { limit: settings.display.depsPerStop, filter: f.filter });
            return { kind: 'favoriteStop', favoriteId: f.id, autoOpen: true, title: `${f.name.fr} : prochain départ`, board } satisfies Suggestion;
          }
        }
      }
      const m = localMinutes(t);
      const slot = m >= 5 * 60 && m < 11 * 60 ? 'morning' : m >= 15 * 60 && m < 21 * 60 ? 'evening' : null;
      if (!slot) return null;
      for (const f of settings.favorites) {
        if (f.propose !== slot) continue;
        if (f.kind === 'trip') {
          const js = await core.plan(f.from, f.to, t, settings, here ?? undefined).catch(() => [] as Journey[]);
          const j = js[0];
          const ride = j?.legs.find((l) => l.kind === 'ride');
          if (!j || !ride) continue;
          const label = f.label ?? 'trajet';
          const p = ride.newPlatform ?? ride.platform;
          const walk = j.legs[0]?.kind === 'walk' ? j.legs[0].walkMin ?? 0 : 0;
          return {
            kind: 'favoriteTrip',
            favoriteId: f.id,
            autoOpen: false,
            title: `Pour le ${label} : ${ride.cat ?? ride.line} ${hhmm(ride.dep)}${p ? `, voie ${p}` : ''}`,
            subtitle: walk ? `partir à ${hhmm(j.leaveAt)}, ${walk} min à pied` : undefined,
            journey: j,
          };
        }
        const board = await core.board(f.areaId, { limit: 1, filter: f.filter });
        const d = board.departures[0];
        if (d) return { kind: 'favoriteStop', favoriteId: f.id, autoOpen: false, title: `${f.name.fr} : ${d.line} ${hhmm(d.est)}`, board };
      }
      return null;
    },
    async works(op, routes) {
      if (op === 'tec' && routes.some((r) => r === '51' || r === 'N51')) return ['Ligne 51 déviée rue de Fer'];
      return [];
    },
    /* --- 1.1 : points d'attache provisoires (remplacés par les équipes cœur et routage) --- */
    async route(from: Endpoint, to: Endpoint, after: number, settings: Settings, here?: { lat: number; lon: number } | null): Promise<PlanResult> {
      try {
        const journeys = await core.plan(from, to, after, settings, here ?? undefined);
        return journeys.length ? { journeys } : { journeys, empty: 'noTrip' };
      } catch (e) {
        if ((from.type === 'here' || to.type === 'here') && !here) return { journeys: [], empty: 'noPosition' };
        throw e;
      }
    },

    orderFavorites(_here: { lat: number; lon: number } | null, settings: Settings): FavoriteRank[] {
      return settings.favorites.map((f) => ({ favoriteId: f.id, rule: 4 as const }));
    },

    async answer(fav: Favorite, here: { lat: number; lon: number } | null, settings: Settings): Promise<FavoriteAnswer> {
      const t = now();
      if (fav.kind === 'stop') {
        const board = await core.board(fav.areaId, { limit: settings.display.depsPerStop, filter: fav.filter });
        return { favoriteId: fav.id, kind: 'stop', state: board.departures.length ? 'ok' : 'none', board, updatedAt: t };
      }
      if ((fav.from.type === 'here' || fav.to.type === 'here') && !here) return { favoriteId: fav.id, kind: 'trip', state: 'noPosition', updatedAt: t };
      const plan = await core.route(fav.from, fav.to, t, settings, here);
      return { favoriteId: fav.id, kind: 'trip', state: plan.empty === 'here' ? 'here' : plan.journeys.length ? 'ok' : 'none', plan, updatedAt: t };
    },

    async geocode(): Promise<GeocodeAnswer> {
      return { results: [], error: 'down' };
    },

    status(): CoreStatus {
      return { rt: 'unknown' };
    },

    async health(): Promise<HealthResponse> {
      const ok = !flags.noRt;
      const src = { ok, ms: 120, error: ok ? undefined : 'Portail injoignable (503)' };
      return {
        ok,
        time: new Date(now()).toISOString(),
        data: meta ? { generatedAt: meta.generatedAt, ok: true, feeds: meta.feeds } : undefined,
        sources: { sncb: src, stib: src, delijn: src, tec: src },
      };
    },
  };
  return core;
}

/** Même signature que le vrai cœur (app/src/core/index.ts). */
export function createCore(opts: CoreOptions): Core {
  return createFakeCore(opts);
}

/** Fraîcheur des données (même contrat que dataFreshness du vrai cœur). */
export function dataFreshness(meta: Meta, now: number): { ok: boolean; ageHours: number; message?: string } {
  const gen = Date.parse(meta.generatedAt);
  const ageHours = Math.round(((now - gen) / 3_600_000) * 10) / 10;
  const today = localDate(now);
  if (!meta.serviceDates.includes(today)) {
    const d = meta.serviceDates[0] ?? '';
    return { ok: false, ageHours, message: `Horaires périmés : mise à jour arrêtée le ${d.slice(8, 10)}/${d.slice(5, 7)}` };
  }
  return { ok: true, ageHours };
}
