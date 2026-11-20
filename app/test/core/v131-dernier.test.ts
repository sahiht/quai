/**
 * Quai 1.3.1 (docs/v1.3.1/PRD-1.3.1.md § 14, R3) : « , dernier » d'après l'horaire, pour tous les réseaux, quand aucun
 * départ de la même ligne dans le même sens ne suit avant demain (04:00, comme « demain » des lunettes) : tableaux des
 * gares et des arrêts (comme le « Dernier passage » de la STIB), écran du trajet (« 23:12  IC voie 4 → Namur, dernier
 * 00:05 »). Pièges prouvés ici : variantes d'une ligne, voyages après minuit (jour de service), les deux jours publiés,
 * ligne sans départ le lendemain (fin de semaine), « Dernier passage » de la STIB (une seule marque), train en retard
 * qui passe après le dernier. « Si tu le rates » se tait quand rien ne repart. Rien de nouveau sur le réseau. Lieux
 * publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { AreaFile, Meta, Mode, Names, Op, TrainsDay } from '../../../shared/types';
import { DEFAULT_SETTINGS, type Departure, type Journey, type Leg } from '../../src/core/api';
import { prepareArea } from '../../src/core/areas';
import { lastCover, scheduleLast, tomorrowAt, trainLegLast } from '../../src/core/boards';
import { markLast, type RefreshEnv } from '../../src/core/journeys';
import { indexDay } from '../../src/core/trains';
import { brusselsParts, gtfsTime, hhmm } from '../../src/core/util';
import { boardView, missLine, stepsPage, type ViewCtx } from '../../src/glasses/views';
import { journey, lines, PLACES, settingsWith } from '../glasses/helpers';
import { FakeServer, makeEnv } from './support/env';

const N = (fr: string, nl = fr): Names => ({ fr, nl });
/** Vendredi, samedi, dimanche. */
const FRI = '2026-11-13';
const SAT = '2026-11-14';
const SUN = '2026-11-15';
/** « 23:12 » → minutes ; « 24:05 » : 00:05 du jour de service (après minuit). */
const hm = (s: string): number => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};
const T = (day: string, s: string): number => gtfsTime(day, hm(s));
const META = (dates: string[], gen = '2026-11-12T23:30:00.000Z'): Meta => {
  const feed = { ok: true, areas: 1, trips: 1 };
  return { v: 1, generatedAt: gen, timezone: 'Europe/Brussels', serviceDates: dates, tile: { lat: 0.02, lon: 0.03 }, feeds: { sncb: feed, stib: feed, delijn: feed, tec: feed } };
};

/* ------------------------------ Fichiers de zone ------------------------------ */

type Pat = [line: string, head: string, next: string[], mode?: Mode];
/** [jour (0, 1), heure « HH:MM » du jour de service, motif, voyage, arrêt]. */
type Dep = [day: number, time: string, pat: number, trip?: string, stop?: number];

function areaFile(id: string, pats: Pat[], deps: Dep[], stops: AreaFile['stops'] = [{ id: 'q', rt: 'q' }]): AreaFile {
  const op = id.slice(0, id.indexOf(':')) as Op;
  return {
    v: 1,
    id,
    op,
    n: N(id),
    lat: 50.84,
    lon: 4.35,
    stops,
    patterns: pats.map(([line, head, next, mode]) => ({ line, mode: mode ?? 'bus', route: line, head: N(head), next: next.map((z, i): [string, number] => [z, 2 * (i + 1)]) })),
    deps: deps.map(([d, t, p, trip, stop]): AreaFile['deps'][number] => [d, hm(t), p, stop ?? 0, trip ?? '', 3]),
  };
}

/** Départs marqués « dernier » d'une zone : « 36 Waterloo Gare 0 23:10 » (jour de service, heure du jour de service). */
function marked(f: AreaFile, dates = [FRI, SAT]): string[] {
  const prep = prepareArea(f, META(dates));
  return f.deps
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => scheduleLast(prep, i))
    .map(({ d }) => `${f.patterns[d[2]].line} ${f.patterns[d[2]].head.fr} ${d[0]} ${String(Math.floor(d[1] / 60)).padStart(2, '0')}:${String(d[1] % 60).padStart(2, '0')}`);
}

describe('R3 : la règle, sur un fichier de zone', () => {
  it('le dernier de la ligne dans son sens, lui seul ; l’autre sens a le sien ; une autre ligne ne compte pas', () => {
    const f = areaFile(
      'tec:R3a',
      [
        ['36', 'Waterloo Gare', ['tec:a1', 'tec:a2']],
        ['36', 'Braine-l’Alleud Gare', ['tec:b1', 'tec:b2']],
        ['37', 'Waterloo Gare', ['tec:a1', 'tec:a2']],
      ],
      [
        [0, '21:10', 0],
        [0, '22:10', 0],
        [0, '23:10', 0],
        [0, '20:40', 1],
        [0, '21:40', 1],
        // une autre ligne, même chemin, plus tard : le 36 de 23:10 reste le dernier 36
        [0, '23:30', 2],
        // demain matin : ne compte pas (« demain » commence à 04:00)
        [1, '06:10', 0],
        [1, '06:40', 1],
      ],
    );
    expect(marked(f)).toEqual(['36 Waterloo Gare 0 23:10', '36 Braine-l’Alleud Gare 0 21:40', '37 Waterloo Gare 0 23:30']);
  });

  it('variantes (même numéro, autre destination) : un départ du même sens qui suit enlève la marque, même un express', () => {
    const f = areaFile(
      'stib:R3v',
      [
        ['3', 'Churchill', ['stib:s1', 'stib:s2', 'stib:s3', 'stib:s4', 'stib:ch']],
        // variante courte, même sens
        ['3', 'Gare du Nord', ['stib:s1', 'stib:s2']],
        // express qui saute les trois premiers arrêts : même sens par l'arrêt s4 (toute la liste, pas les premières)
        ['3', 'Vanderkindere', ['stib:s4', 'stib:vdk']],
        // l'autre sens
        ['3', 'Esplanade', ['stib:e1', 'stib:e2']],
      ],
      [
        [0, '23:40', 0],
        [0, '23:55', 1],
        [0, '24:15', 2],
        [0, '23:20', 3],
      ],
    );
    expect(marked(f)).toEqual(['3 Vanderkindere 0 00:15'.replace('00:15', '24:15'), '3 Esplanade 0 23:20']);
  });

  it('après minuit (jour de service) : 23:12 suivi de 00:05 n’est pas le dernier, 00:05 l’est ; les deux écritures de la nuit', () => {
    const f = areaFile(
      'delijn:R3n',
      [
        ['N1', 'Gent Korenmarkt', ['delijn:k1', 'delijn:k2']],
        ['N2', 'Brugge Station', ['delijn:m1', 'delijn:m2']],
      ],
      [
        [0, '23:12', 0],
        // 00:05 écrit sur le vendredi (24:05)
        [0, '24:05', 0],
        // N2 : 00:10 écrit sur le vendredi, puis 00:30 écrit sur le samedi (même nuit) : 00:10 n'est pas le dernier
        [0, '24:10', 1],
        [1, '00:30', 1],
        [1, '07:10', 0],
      ],
    );
    expect(marked(f)).toEqual(['N1 Gent Korenmarkt 0 24:05', 'N2 Brugge Station 1 00:30']);
  });

  it('les deux jours publiés : rien avant 04:00 du premier (la veille manque), rien après 04:00 du second (le surlendemain manque)', () => {
    const f = areaFile(
      'tec:R3d',
      [['E', 'Charleroi Sud', ['tec:c1', 'tec:c2']]],
      [
        // la nuit de jeudi à vendredi, écrite sur le vendredi : des voyages du jeudi après minuit peuvent manquer
        [0, '01:30', 0],
        [0, '18:40', 0],
        [0, '19:40', 0],
        [1, '18:40', 0],
        // dernier du samedi : la nuit de samedi à dimanche, écrite sur le dimanche, n'est pas publiée
        [1, '19:40', 0],
      ],
    );
    expect(marked(f)).toEqual(['E Charleroi Sud 0 19:40']);
    // un seul jour publié : la nuit qui suit n'est pas connue, aucune marque le soir
    expect(marked(f, [FRI])).toEqual([]);
    // jours publiés qui ne se suivent pas : seul le premier compte
    expect(marked(f, [FRI, SUN])).toEqual([]);
  });

  it('fin de semaine : une ligne sans départ le lendemain a bien son dernier ; une ligne du dimanche seulement, aucun', () => {
    const f = areaFile(
      'tec:R3w',
      [
        ['E', 'Wavre Gare', ['tec:w1', 'tec:w2']],
        ['F', 'Ottignies Gare', ['tec:o1', 'tec:o2']],
      ],
      [
        // samedi : la ligne E roule, le dimanche non
        [0, '18:40', 0],
        [0, '19:40', 0],
        // dimanche seulement (jour 1) : jamais marquée, le lundi n'est pas publié
        [1, '09:10', 1],
        [1, '17:10', 1],
      ],
    );
    expect(marked(f, [SAT, SUN])).toEqual(['E Wavre Gare 0 19:40']);
  });

  it('doublons (même ligne, même destination, même minute) : un seul départ, marqué ; deux destinations du même sens à la même minute : aucun', () => {
    const f = areaFile(
      'sncb:R3x',
      [
        ['IC', 'Namur', ['sncb:8811601', 'sncb:8863008'], 'train'],
        ['IC', 'Namur', ['sncb:8811601', 'sncb:8863008'], 'train'],
        ['IC', 'Anvers-Central', ['sncb:8812005', 'sncb:8821006'], 'train'],
        ['L', 'Malines', ['sncb:8812005', 'sncb:8822004'], 'train'],
      ],
      [
        [0, '23:12', 0, 'a'],
        [0, '23:12', 1, 'b'],
        // vers le nord : un IC et un L à la même minute, par Bruxelles-Nord : aucun des deux n'est le dernier
        [0, '23:40', 2, 'c'],
        [0, '23:40', 3, 'd'],
      ],
    );
    expect(marked(f)).toEqual(['IC Namur 0 23:12', 'IC Namur 0 23:12']);
  });

  it('trains : toutes les catégories sont une seule ligne (un L qui suit enlève la marque de l’IC) ; les bus SNCB à part', () => {
    const f = areaFile(
      'sncb:R3t',
      [
        ['IC', 'Namur', ['sncb:8811601', 'sncb:8861200', 'sncb:8863008'], 'train'],
        ['L', 'Ottignies', ['sncb:8811601'], 'train'],
        ['BUS', 'Ottignies', ['sncb:8811601'], 'bus'],
      ],
      [
        [0, '23:12', 0, 'ic'],
        [0, '23:40', 1, 'l'],
        [0, '23:50', 2, 'bus'],
      ],
    );
    expect(marked(f)).toEqual(['L Ottignies 0 23:40', 'BUS Ottignies 0 23:50']);
  });

  it('« demain » commence à 04:00 (heure belge), aussi le jour du changement d’heure ; fenêtre des jours publiés', () => {
    const local = (ms: number) => `${brusselsParts(ms).date} ${hhmm(ms)}`;
    expect(local(tomorrowAt(T(FRI, '23:12')))).toBe(`${SAT} 04:00`);
    expect(local(tomorrowAt(T(FRI, '24:05')))).toBe(`${SAT} 04:00`);
    expect(local(tomorrowAt(T(FRI, '04:00')))).toBe(`${SAT} 04:00`);
    expect(local(tomorrowAt(T(FRI, '03:59')))).toBe(`${FRI} 04:00`);
    // dimanche 25/10/2026 : 03:00 devient 02:00
    expect(local(tomorrowAt(T('2026-10-24', '23:30')))).toBe('2026-10-25 04:00');
    expect(local(tomorrowAt(T('2026-03-28', '23:30')))).toBe('2026-03-29 04:00');
    const c = lastCover([SAT, FRI])!;
    expect([local(c.from), local(c.to)]).toEqual([`${FRI} 04:00`, `${SUN} 00:00`]);
    expect(lastCover([])).toBeNull();
  });
});

/* ------------------------------ Tableaux (vrai cœur, faux serveur) ------------------------------ */

const BXC = 'sncb:8813003';
const STATIONS: TrainsDay['stations'] = [
  { id: BXC, n: N('Bruxelles-Central', 'Brussel-Centraal'), lat: 50.8455, lon: 4.3571 },
  { id: 'sncb:8811601', n: N('Ottignies'), lat: 50.6727, lon: 4.5694 },
  { id: 'sncb:8861200', n: N('Gembloux'), lat: 50.5705, lon: 4.6918 },
  { id: 'sncb:8863008', n: N('Namur', 'Namen'), lat: 50.4688, lon: 4.8622 },
  { id: 'sncb:8812005', n: N('Bruxelles-Nord', 'Brussel-Noord'), lat: 50.8605, lon: 4.3615 },
  { id: 'sncb:8821006', n: N('Anvers-Central', 'Antwerpen-Centraal'), lat: 51.2172, lon: 4.4211 },
];
/** Gare : [rang dans STATIONS, arrivée, départ, voie]. */
type Call = [number, string | null, string | null, string?];
const trip = (id: string, cat: string, head: string, calls: Call[]): TrainsDay['trips'][number] => ({
  id,
  cat,
  head: N(head),
  s: calls.map(([st, a, d, p], k): TrainsDay['trips'][number]['s'][number] => [st, a === null ? -1 : hm(a), d === null ? -1 : hm(d), p ?? '', k + 1]),
});
const ic = (id: string, dep: string, h: number) => {
  const at = (m: number) => {
    const t = hm(dep) + m;
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };
  void h;
  return trip(id, 'IC', 'Namur', [
    [0, null, dep, '4'],
    [1, at(26), at(27)],
    [2, at(38), at(39)],
    [3, at(53), null],
  ]);
};
const north = (id: string, dep: string) => {
  const t = hm(dep);
  const s = (m: number) => `${Math.floor((t + m) / 60)}:${String((t + m) % 60).padStart(2, '0')}`;
  return trip(id, 'IC', 'Anvers-Central', [
    [0, null, dep, '1'],
    [4, s(4), s(5)],
    [5, s(45), null],
  ]);
};
const day = (date: string, trips: TrainsDay['trips']): TrainsDay => ({ v: 1, date, stations: STATIONS, trips });

/** Fichier de zone de Bruxelles-Central tiré des mêmes trains (comme le pipeline : un départ par voyage où l'on monte). */
function stationArea(days: TrainsDay[]): AreaFile {
  const pats: AreaFile['patterns'] = [];
  const deps: AreaFile['deps'] = [];
  days.forEach((d, di) =>
    d.trips.forEach((t) => {
      const p = t.s.findIndex((x) => STATIONS[x[0]].id === BXC);
      if (p < 0 || t.s[p][2] < 0) return;
      const next = t.s.slice(p + 1).map((x): [string, number] => [STATIONS[x[0]].id, x[1] - t.s[p][2]]);
      const pat = { line: t.cat, mode: 'train' as Mode, route: t.cat, head: t.head, next };
      let pi = pats.findIndex((q) => JSON.stringify(q) === JSON.stringify(pat));
      if (pi < 0) pi = pats.push(pat) - 1;
      deps.push([di, t.s[p][2], pi, t.s[p][3] === '1' ? 1 : 0, t.id, t.s[p][4]]);
    }),
  );
  return {
    v: 1,
    id: BXC,
    op: 'sncb',
    n: N('Bruxelles-Central', 'Brussel-Centraal'),
    lat: 50.8455,
    lon: 4.3571,
    stops: [
      { id: '8813003_4', platform: '4', rt: '8813003_4' },
      { id: '8813003_1', platform: '1', rt: '8813003_1' },
    ],
    patterns: pats,
    deps,
  };
}

const FRI_TRAINS = [ic('IC-2112', '21:12', 0), ic('IC-2225', '22:25', 0), ic('IC-2312', '23:12', 0), north('IC-2340', '23:40')];
const SAT_TRAINS = [ic('IC-0612', '06:12', 0), north('IC-0640', '06:40')];

/** Faux serveur : ces jours publiés, ces trains, la zone de Bruxelles-Central qui en découle, et des zones en plus. */
function server(fri: TrainsDay['trips'] = FRI_TRAINS, sat: TrainsDay['trips'] = SAT_TRAINS, areas: AreaFile[] = []): FakeServer {
  const s = new FakeServer();
  const days = [day(FRI, fri), day(SAT, sat)];
  s.memFiles.set('meta.json', JSON.stringify(META([FRI, SAT])));
  for (const d of days) s.memFiles.set(`trains/${d.date}.json`, JSON.stringify(d));
  s.memFiles.set('areas/sncb/8813003.json', JSON.stringify(stationArea(days)));
  for (const a of areas) s.memFiles.set(`areas/${a.op}/${a.id.slice(a.id.indexOf(':') + 1)}.json`, JSON.stringify(a));
  return s;
}
const at = (date: string, time: string) => `${date}T${time}`;
const said = (deps: readonly Departure[]) => deps.map((d) => `${hhmm(d.est)} ${d.line} ${d.head.fr}${d.last ? ', dernier' : ''}`);

describe('R3 : tableaux des gares et des arrêts', () => {
  it('gare : le dernier train de chaque sens avant demain, pas ceux de demain ; dans les lunettes, au pixel', async () => {
    const env = makeEnv({ now: at(FRI, '22:50'), server: server() });
    const b = await env.core.board(BXC);
    expect(said(b.departures)).toEqual(['23:12 IC Namur, dernier', '23:40 IC Anvers-Central, dernier', '06:12 IC Namur', '06:40 IC Anvers-Central']);
    const ctx: ViewCtx = { now: env.clock.now(), settings: settingsWith([]) };
    const rows = lines(boardView(b, ctx, { kept: false }));
    // horaire prévu (« ~ ») : aucun temps réel pour ces trains
    expect(rows.filter((l) => l.includes('dernier'))).toEqual(['IC   Namur, dernier   ~23:12  voie 4', 'IC   Anvers-Central, dernier   ~23:40  voie 1']);
    expect(rows.filter((l) => /06:/.test(l)).every((l) => !l.includes('dernier'))).toBe(true);
  });

  it('un train du même sens en retard qui part après le dernier : plus de marque (jamais « dernier » quand un départ suit)', async () => {
    const s = server();
    // l'IC de 22:25 a 60 min de retard : il part à 23:25, après celui de 23:12
    s.relay.rt.sncb.trips['IC-2225'] = { u: [[1, '8813003_4', 3600, null, 0]] };
    const env = makeEnv({ now: at(FRI, '22:50'), server: s });
    const b = await env.core.board(BXC);
    expect(said(b.departures).slice(0, 3)).toEqual(['23:12 IC Namur', '23:25 IC Namur', '23:40 IC Anvers-Central, dernier']);
  });

  it('STIB : le « Dernier passage » du temps réel garde sa marque, l’horaire n’en ajoute pas une seconde dans ce sens', async () => {
    const stop = areaFile(
      'stib:R3s',
      [
        ['3', 'Churchill', ['stib:s1', 'stib:s2'], 'tram'],
        ['3', 'Esplanade', ['stib:e1', 'stib:e2'], 'tram'],
      ],
      [
        [0, '23:40', 0],
        [0, '23:55', 0],
        [0, '24:10', 0],
        [0, '23:45', 1],
      ],
      [{ id: '9101', rt: '9101' }],
    );
    const s = server(FRI_TRAINS, SAT_TRAINS, [stop]);
    const iso = (t: string) => `${FRI}T${t}:00+01:00`;
    s.relay.stib.points['9101'] = [
      { line: '3', dest: N('CHURCHILL'), times: [iso('23:40')] },
      { line: '3', dest: N('CHURCHILL'), times: [iso('23:55')], msg: 'Dernier passage' },
      { line: '3', dest: N('ESPLANADE'), times: [iso('23:45')] },
    ];
    const env = makeEnv({ now: at(FRI, '23:30'), server: s });
    const live = await env.core.board('stib:R3s');
    // une seule marque vers Churchill (la STIB) ; vers Esplanade, aucun « Dernier passage » : celle de l'horaire n'est pas
    // donnée à un passage suivi en direct
    expect(said(live.departures)).toEqual(['23:40 3 Churchill', '23:45 3 Esplanade', '23:55 3 Churchill, dernier', '00:10 3 Churchill']);
    // temps réel STIB coupé : l'horaire seul, un dernier par sens
    s.failing.add('stib');
    const env2 = makeEnv({ now: at(FRI, '23:30'), server: s });
    const planned = await env2.core.board('stib:R3s');
    expect(said(planned.departures)).toEqual(['23:40 3 Churchill', '23:45 3 Esplanade, dernier', '23:55 3 Churchill', '00:10 3 Churchill, dernier']);
  });
});

/* ------------------------------ Étapes et écran du trajet ------------------------------ */

const rideOf = (j: Journey | undefined): Leg | undefined => j?.legs.find((l) => l.kind === 'ride');

describe('R3 : étapes du trajet (le cœur), sans rien demander au réseau', () => {
  it('train : « dernier » d’après les trains des jours chargés ; pas tant que la nuit qui suit n’est pas chargée', async () => {
    const env = makeEnv({ now: at(FRI, '22:50'), server: server() });
    const [j] = await env.core.trains(BXC, 'sncb:8863008', T(FRI, '22:50'));
    expect(rideOf(j)).toMatchObject({ line: 'IC', platform: '4', last: true });
    expect(hhmm(rideOf(j)!.schedDep)).toBe('23:12');
    // 15:00 : seuls les trains du vendredi sont chargés (les trains du lendemain le sont à partir de 18:00) ; un train
    // écrit sur le samedi à 00:30 pourrait suivre : pas de marque
    const early = makeEnv({ now: at(FRI, '15:00'), server: server() });
    const later = await early.core.trains(BXC, 'sncb:8863008', T(FRI, '23:00'));
    expect(rideOf(later[0])).toMatchObject({ line: 'IC' });
    expect(rideOf(later[0])?.last).toBeUndefined();
  });

  it('train : un L après minuit vers Ottignies (même sens) enlève la marque de l’IC de 23:12', async () => {
    const l = trip('L-0020', 'L', 'Ottignies', [
      [0, null, '24:20', '4'],
      [1, '24:52', null],
    ]);
    const env = makeEnv({ now: at(FRI, '22:50'), server: server([...FRI_TRAINS, l]) });
    const [j] = await env.core.trains(BXC, 'sncb:8863008', T(FRI, '22:50'));
    expect(hhmm(rideOf(j)!.schedDep)).toBe('23:12');
    expect(rideOf(j)?.last).toBeUndefined();
    // la règle seule, sur les mêmes jours : le L est le dernier de son sens
    const days = [indexDay(day(FRI, [...FRI_TRAINS, l])), indexDay(day(SAT, SAT_TRAINS))];
    expect(trainLegLast(days, { op: 'sncb', from: { name: N('Bruxelles-Central'), lat: 0, lon: 0, areaId: BXC }, tripId: 'L-0020', schedDep: T(FRI, '24:20') })).toBe(true);
  });

  it('bus, tram, métro : d’après la zone de montée déjà connue (tableau ouvert) ; inconnue, aucune demande au réseau', async () => {
    const stop = areaFile(
      'tec:R3b',
      [['36', 'Waterloo Gare', ['tec:a1', 'tec:a2']]],
      [
        [0, '22:10', 0, 'T36-2210'],
        [0, '23:10', 0, 'T36-2310'],
      ],
      [{ id: 'R3b', rt: 'R3b' }],
    );
    const env = makeEnv({ now: at(FRI, '22:50'), server: server(FRI_TRAINS, SAT_TRAINS, [stop]) });
    const leg: Leg = {
      kind: 'ride',
      from: { name: N('Braine-l’Alleud Gare'), lat: 50.68, lon: 4.37, areaId: 'tec:R3b' },
      to: { name: N('Waterloo Gare'), lat: 50.71, lon: 4.4, areaId: 'tec:a2' },
      dep: T(FRI, '23:10'),
      arr: T(FRI, '23:25'),
      schedDep: T(FRI, '23:10'),
      schedArr: T(FRI, '23:25'),
      op: 'tec',
      mode: 'bus',
      line: '36',
      head: N('Waterloo Gare'),
      tripId: 'T36-2310',
      fromStop: 'R3b',
      rt: false,
      delayMin: 0,
      cancelled: false,
    };
    const j: Journey = { id: 'j36', legs: [leg], dep: leg.dep, arr: leg.arr, leaveAt: leg.dep, transfers: 0, rt: false, alerts: [] };
    const settings = { ...structuredClone(DEFAULT_SETTINGS), onboarded: true };
    const first = await env.core.refresh(j, settings);
    expect(rideOf(first)?.last).toBeUndefined();
    expect(env.server.calls.filter((u) => u.includes('/areas/'))).toEqual([]);
    await env.core.board('tec:R3b');
    const second = await env.core.refresh(first, settings);
    expect(rideOf(second)?.last).toBe(true);
    // la marque se recalcule à chaque rafraîchissement : la même étape à 22:10 n'est pas la dernière
    const early = await env.core.refresh({ ...j, legs: [{ ...leg, dep: T(FRI, '22:10'), schedDep: T(FRI, '22:10'), tripId: 'T36-2210', last: true }] }, settings);
    expect(rideOf(early)?.last).toBeUndefined();
  });

  it('STIB suivie en direct : seule la STIB parle (« Dernier passage » gardé, jamais une seconde marque) ; sans temps réel, l’horaire', async () => {
    const stop = areaFile('stib:R3m', [['1', 'Stockel', ['stib:m1', 'stib:m2'], 'metro']], [[0, '23:58', 0]], [{ id: '9201', rt: '9201' }]);
    const prep = prepareArea(stop, META([FRI, SAT]));
    const env: RefreshEnv = {
      rt: null as never,
      now: () => T(FRI, '23:50'),
      trainDays: async () => [],
      area: async () => prep,
      cachedArea: async () => prep,
    };
    const leg = (p: Partial<Leg>): Leg => ({
      kind: 'ride',
      from: { name: N('Arts-Loi', 'Kunst-Wet'), lat: 50.8452, lon: 4.3699, areaId: 'stib:R3m' },
      to: { name: N('Stockel', 'Stokkel'), lat: 50.8384, lon: 4.4598, areaId: 'stib:m2' },
      dep: T(FRI, '23:58'),
      arr: T(FRI, '24:15'),
      schedDep: T(FRI, '23:58'),
      schedArr: T(FRI, '24:15'),
      op: 'stib',
      mode: 'metro',
      line: '1',
      head: N('Stockel', 'Stokkel'),
      fromStop: '9201',
      rt: false,
      delayMin: 0,
      cancelled: false,
      ...p,
    });
    const legs = [leg({ rt: true, last: true }), leg({ rt: true }), leg({ rt: false })];
    await markLast(legs, env);
    expect(legs.map((l) => l.last)).toEqual([true, undefined, true]);
  });
});

describe('R3 : écran du trajet et « Si tu le rates »', () => {
  const NOW = T(FRI, '23:02');
  const S = settingsWith([PLACES.bureau]);
  const ctx: ViewCtx = { now: NOW, settings: S };
  const route = { title: 'Vers Namur', label: '' };
  const J = (last: boolean, id = 'jd'): Journey => {
    const j = journey(id, [
      { walk: 6, to: 'Bruxelles-Central' },
      { ride: 'IC', mode: 'train', dep: T(FRI, '23:12'), arr: T(FRI, '24:05'), from: 'Bruxelles-Central', to: 'Namur', head: 'Namur', platform: '4' },
      { walk: 9 },
    ]);
    if (last) j.legs[1].last = true;
    return j;
  };
  const rows = (j: Journey, journeys: Journey[] = [j]) => lines(stepsPage(route, { journeys, index: journeys.indexOf(j), fresh: true }, ctx));

  it('« 23:12  IC voie 4 → Namur, dernier   00:05 », au pixel ; un nom trop long coupé au mot, la marque entière', () => {
    expect(rows(J(true))).toContain('23:12 IC voie 4 → Namur, dernier   00:05');
    expect(rows(J(false))).toContain('23:12 IC voie 4 → Namur   00:05');
    const long = journey('jl', [
      { walk: 4, to: 'Braine-l’Alleud Gare' },
      { ride: '36', mode: 'bus', dep: T(FRI, '23:10'), arr: T(FRI, '23:41'), from: 'Braine-l’Alleud Gare', to: 'Braine-l’Alleud Place Communale Rue de la Station', head: 'Waterloo Gare' },
      { walk: 3 },
    ]);
    long.legs[1].last = true;
    const row = rows(long).find((l) => l.startsWith('23:10'))!;
    expect(row).toMatch(/^23:10 Bus 36 → Braine-l’Alleud .*…, dernier +23:41$/);
  });

  it('« Si tu le rates » se tait quand rien ne repart de la gare ; une autre ligne qui en repart plus tard : il le dit (deux faits)', () => {
    const j = J(true);
    // un autre trajet, d'une autre gare : rien à dire
    const other = journey('jo', [
      { walk: 12, to: 'Bruxelles-Nord' },
      { ride: 'L', mode: 'train', dep: T(FRI, '23:30'), arr: T(FRI, '24:40'), from: 'Bruxelles-Nord', to: 'Namur', platform: '7' },
      { walk: 9 },
    ]);
    expect(missLine(j, [j, other], j.leaveAt, NOW)).toBeNull();
    expect(rows(j, [j, other])[0]).not.toMatch(/Si tu le rates/);
    // un bus de nuit repart de la même gare plus tard : « Si tu le rates » donne son arrivée, l'IC reste le dernier train
    const bus = journey('jb', [
      { walk: 6, to: 'Bruxelles-Central' },
      { ride: 'N', mode: 'bus', dep: T(FRI, '23:50'), arr: T(FRI, '25:20'), from: 'Bruxelles-Central', to: 'Namur' },
      { walk: 9 },
    ]);
    expect(missLine(j, [j, bus], j.leaveAt, NOW)?.replace(/\u00a0/g, ' ')).toBe('Si tu le rates : arrivée 01:29, 1 h 15 plus tard');
  });
});
