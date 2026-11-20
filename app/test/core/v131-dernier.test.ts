/**
 * Quai 1.3.1 (docs/v1.3.1/PRD-1.3.1.md § 14, R3) : « , dernier » d'après l'horaire, pour tous les réseaux, quand aucun
 * départ de la même ligne dans le même sens ne suit avant demain (04:00, comme « demain » des lunettes) : tableaux des
 * gares et des arrêts (comme le « Dernier passage » de la STIB), écran du trajet (« 23:12  IC voie 4 → Namur, dernier
 * 00:05 »). Pièges prouvés ici : variantes d'une ligne, voyages après minuit (jour de service), les deux jours publiés,
 * ligne sans départ le lendemain (fin de semaine), « Dernier passage » de la STIB (une seule marque), train en retard
 * qui passe après le dernier. « Si tu le rates » se tait quand rien ne repart. Écran du trajet : pas de marque quand un
 * autre trajet déjà calculé part plus tard avant demain. Rien de nouveau sur le réseau. Lieux
 * publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { AreaFile, Meta, Mode, Names, Op, TrainsDay } from '../../../shared/types';
import { DEFAULT_SETTINGS, type Departure, type Journey, type Leg } from '../../src/core/api';
import { prepareArea } from '../../src/core/areas';
import { lastCover, lastLineKey, legLast, scheduleLast, tomorrowAt, trainLegLast } from '../../src/core/boards';
import { markLast, type RefreshEnv } from '../../src/core/journeys';
import { indexDay } from '../../src/core/trains';
import { brusselsParts, gtfsTime, hhmm } from '../../src/core/util';
import { boardView, laterJourney, missLine, stepsPage, type ViewCtx } from '../../src/glasses/views';
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

  it('04:00 n’est pas une coupure pour une ligne qui roule toute la nuit (N62 : 03:48 puis 04:18) : aucune marque', () => {
    const f = areaFile(
      'delijn:R3h',
      [
        ['N62', 'Brussels Airport', ['delijn:h1', 'delijn:h2']],
        // une ligne de nuit qui s'arrête vraiment : 03:13 puis 05:27 (plus de 2 h, et le précédent 1 h avant)
        ['30', 'Westkerke Marktplein', ['delijn:w1', 'delijn:w2']],
      ],
      [
        [0, '23:18', 0],
        [0, '24:18', 0],
        [0, '25:18', 0],
        [0, '26:18', 0],
        // la suite de la nuit écrite sur le samedi, comme dans les vraies données
        [1, '03:18', 0],
        [1, '03:48', 0],
        [1, '04:18', 0],
        [1, '04:48', 0],
        [0, '25:13', 1],
        [0, '26:13', 1],
        [0, '27:13', 1],
        [1, '05:27', 1],
      ],
    );
    expect(marked(f)).toEqual(['30 Westkerke Marktplein 0 27:13']);
  });

  it('le premier départ du matin, avant 04:00, n’est jamais « dernier » ; ni un départ suivi moins de 2 h après, même après 04:00', () => {
    const f = areaFile(
      'tec:R3m',
      [
        // 109a : rien de la soirée, premier bus à 03:48, le suivant à 06:40 (près de 3 h après, mais bien plus près que le précédent)
        ['109a', 'Charleroi Gare Centrale', ['tec:c1', 'tec:c2']],
        // 82 : toutes les 30 min jusqu'à 03:30, reprise à 05:00 (1 h 30 après) : la ligne roule encore
        ['82', 'Mons Gare', ['tec:m1', 'tec:m2']],
        // 83 : toutes les 30 min jusqu'à 01:30, reprise à 05:45 : un vrai dernier
        ['83', 'Mons Gare', ['tec:n1', 'tec:n2']],
        // 84 : un seul départ de nuit à 00:15, écrit sur le samedi (aucun avant depuis 04:00), le suivant à 08:20 : pas la
        // fin d'un service
        ['84', 'Jurbise Gare', ['tec:j1', 'tec:j2']],
        // 85 : le même, écrit « 24:15 » sur le vendredi : l'exploitant le compte dans le service du vendredi, c'est son dernier
        ['85', 'Jurbise Gare', ['tec:k1', 'tec:k2']],
        // 86 : dernier à 00:20 (« 24:20 »), le précédent à 18:20, le suivant à 05:50 (plus proche) : un vrai dernier quand même
        ['86', 'Jurbise Gare', ['tec:l1', 'tec:l2']],
      ],
      [
        [0, '12:10', 0],
        [1, '03:48', 0],
        [1, '06:40', 0],
        [0, '26:30', 1],
        [0, '27:00', 1],
        [0, '27:30', 1],
        [1, '05:00', 1],
        [0, '24:30', 2],
        [0, '25:00', 2],
        [0, '25:30', 2],
        [1, '05:45', 2],
        [1, '00:15', 3],
        [1, '08:20', 3],
        [0, '24:15', 4],
        [1, '08:20', 4],
        [0, '18:20', 5],
        [0, '24:20', 5],
        [1, '05:50', 5],
      ],
    );
    expect(marked(f)).toEqual(['83 Mons Gare 0 25:30', '85 Jurbise Gare 0 24:15', '86 Jurbise Gare 0 24:20']);
    // sans départ le lendemain (rien ne suit du tout) : le 109a de 03:48 et le 84 de 00:15 sont bien les derniers
    const g = areaFile('tec:R3m', f.patterns.map((p): Pat => [p.line, p.head.fr, p.next.map(([z]) => z)]), [
      [0, '12:10', 0],
      [1, '03:48', 0],
      [1, '00:15', 3],
    ]);
    expect(marked(g)).toEqual(['109a Charleroi Gare Centrale 1 03:48', '84 Jurbise Gare 1 00:15']);
  });

  it('famille d’un numéro (lettre devant ou derrière : 20a et 20b, 27 et 27/, X70, N10, T39, E109) : une seule ligne dans le même sens', () => {
    expect(lastLineKey('delijn', 'bus', '20a')).toBe(lastLineKey('delijn', 'bus', '20b'));
    expect(lastLineKey('delijn', 'bus', '20a')).toBe(lastLineKey('delijn', 'bus', '20'));
    expect(lastLineKey('tec', 'bus', '27/')).toBe(lastLineKey('tec', 'bus', '027'));
    expect(lastLineKey('tec', 'bus', '86C')).toBe(lastLineKey('tec', 'bus', '86A'));
    // décision du propriétaire (20/11 à 21:58) : la personne peut prendre le X70 qui suit le dernier 70
    expect(lastLineKey('stib', 'bus', 'N10')).toBe(lastLineKey('stib', 'bus', '10'));
    expect(lastLineKey('delijn', 'bus', 'X70')).toBe(lastLineKey('delijn', 'bus', '70'));
    expect(lastLineKey('stib', 'bus', 'T39')).toBe(lastLineKey('stib', 'tram', '39'));
    expect(lastLineKey('tec', 'bus', 'E109')).toBe(lastLineKey('tec', 'bus', '109a'));
    expect(lastLineKey('tec', 'metro', 'M1ab')).toBe(lastLineKey('tec', 'bus', '1'));
    // d'autres chiffres, une ligne sans chiffre, un autre réseau : d'autres lignes
    expect(lastLineKey('delijn', 'bus', '70')).not.toBe(lastLineKey('delijn', 'bus', '7'));
    expect(lastLineKey('delijn', 'tram', 'KT')).not.toBe(lastLineKey('delijn', 'bus', 'K'));
    expect(lastLineKey('tec', 'bus', 'W')).toBe('tec:w');
    expect(lastLineKey('tec', 'bus', '20a')).not.toBe(lastLineKey('delijn', 'bus', '20a'));
    const f = areaFile(
      'delijn:R3s',
      [
        ['20a', 'F. Rooseveltplaats', ['delijn:r1', 'delijn:r2']],
        ['20b', 'F. Rooseveltplaats', ['delijn:r1', 'delijn:r3']],
        // l'autre sens : le 20b n'y passe plus, le 20a y est bien le dernier
        ['20a', 'Veemarkt', ['delijn:v1', 'delijn:v2']],
        // une lettre devant, même chemin : la même famille (le 20a qui suit se prend aussi)
        ['X20', 'F. Rooseveltplaats', ['delijn:r1', 'delijn:r2']],
        // d'autres chiffres, même chemin : une autre ligne
        ['21', 'F. Rooseveltplaats', ['delijn:r1', 'delijn:r2']],
      ],
      [
        [0, '23:13', 0],
        [0, '23:43', 0],
        [0, '24:13', 1],
        [0, '23:23', 2],
        [0, '22:50', 3],
        [0, '22:55', 4],
      ],
    );
    expect(marked(f)).toEqual(['20b F. Rooseveltplaats 0 24:13', '20a Veemarkt 0 23:23', '21 F. Rooseveltplaats 0 22:55']);
  });

  it('les deux jours publiés : rien avant 04:00 du premier (la veille manque), rien après 04:00 du second (le surlendemain manque)', () => {
    const f = areaFile(
      'tec:R3d',
      [['E', 'Charleroi Sud', ['tec:c1', 'tec:c2']]],
      [
        // la nuit de jeudi à vendredi, écrite sur le vendredi : des voyages du jeudi après minuit peuvent manquer
        [0, '01:00', 0],
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

  it('train après minuit : écrit « 24:01 » (service de la veille), c’est le dernier ; premier du matin écrit « 03:40 », jamais', () => {
    const leg = (id: string, t: number) => ({ op: 'sncb' as Op, from: { name: N('Bruxelles-Central'), lat: 50.8455, lon: 4.3571, areaId: BXC }, tripId: id, schedDep: t });
    // le précédent à 14:00, le suivant à 05:40 (plus proche que le précédent) : le train de 00:01 reste le dernier du vendredi
    const late = [day(FRI, [north('IC-1400', '14:00'), north('IC-2401', '24:01')]), day(SAT, [north('IC-0540', '05:40')])];
    expect(trainLegLast(late.map(indexDay), leg('IC-2401', T(FRI, '24:01')))).toBe(true);
    expect(marked(stationArea(late))).toEqual(['IC Anvers-Central 0 24:01']);
    // le premier train du samedi part à 03:40, le suivant à 06:40 : ni lui ni celui de 14:00 la veille (03:40 suit avant 04:00)
    const first = [day(FRI, [north('IC-1400', '14:00')]), day(SAT, [north('IC-0340', '03:40'), north('IC-0640', '06:40')])];
    expect(trainLegLast(first.map(indexDay), leg('IC-0340', T(SAT, '03:40')))).toBe(false);
    expect(trainLegLast(first.map(indexDay), leg('IC-1400', T(FRI, '14:00')))).toBe(false);
    expect(marked(stationArea(first))).toEqual([]);
  });

  it('train : « dernier » d’après la gare de descente ; un L après minuit vers Ottignies ne l’enlève que pour qui descend à Ottignies', async () => {
    const OTT = 'sncb:8811601';
    const l = trip('L-0020', 'L', 'Ottignies', [
      [0, null, '24:20', '4'],
      [1, '24:52', null],
    ]);
    const env = makeEnv({ now: at(FRI, '22:50'), server: server([...FRI_TRAINS, l]) });
    // vers Namur : le L n'y va pas, l'IC de 23:12 reste le dernier train que la personne peut prendre
    const [j] = await env.core.trains(BXC, 'sncb:8863008', T(FRI, '22:50'));
    expect(hhmm(rideOf(j)!.schedDep)).toBe('23:12');
    expect(rideOf(j)?.last).toBe(true);
    // vers Ottignies : le L de 00:20 s'y arrête, l'IC de 23:12 n'est pas le dernier
    const [o] = await env.core.trains(BXC, OTT, T(FRI, '22:50'));
    expect(hhmm(rideOf(o)!.schedDep)).toBe('23:12');
    expect(rideOf(o)?.last).toBeUndefined();
    // le tableau de la gare ne connaît pas la descente : même sens, l'IC n'y est pas le dernier, le L l'est
    const b = await env.core.board(BXC);
    expect(said(b.departures).filter((x) => /Namur|Ottignies/.test(x)).slice(0, 2)).toEqual(['23:12 IC Namur', '00:20 L Ottignies, dernier']);
    // la règle seule, sur les mêmes jours
    const days = [indexDay(day(FRI, [...FRI_TRAINS, l])), indexDay(day(SAT, SAT_TRAINS))];
    const leg = (tripId: string, time: string, to?: string) => ({ op: 'sncb' as Op, from: { name: N('Bruxelles-Central'), lat: 0, lon: 0, areaId: BXC }, tripId, schedDep: T(FRI, time), ...(to ? { to: { name: N(to), lat: 0, lon: 0, areaId: to } } : {}) });
    expect(trainLegLast(days, leg('L-0020', '24:20'))).toBe(true);
    expect(trainLegLast(days, leg('IC-2312', '23:12'))).toBe(false);
    expect(trainLegLast(days, leg('L-0020', '24:20', OTT))).toBe(true);
    expect(trainLegLast(days, leg('IC-2312', '23:12', OTT))).toBe(false);
    expect(trainLegLast(days, leg('IC-2312', '23:12', 'sncb:8861200'))).toBe(true);
    expect(trainLegLast(days, leg('IC-2225', '22:25', 'sncb:8863008'))).toBe(false);
  });

  it('train : un train plus tard qui passe à la gare de descente sans qu’on puisse y descendre ne compte pas', () => {
    // train de nuit de 23:50 : montée seulement à Namur (descente interdite), descente permise à Gembloux
    const nj = trip('NJ-2350', 'EUR', 'Gembloux', [
      [0, null, '23:50', '4'],
      [3, null, '24:45'],
      [2, '25:00', null],
    ]);
    const days = [indexDay(day(FRI, [...FRI_TRAINS, nj])), indexDay(day(SAT, SAT_TRAINS))];
    const leg = (to: string) => ({ op: 'sncb' as Op, from: { name: N('Bruxelles-Central'), lat: 0, lon: 0, areaId: BXC }, to: { name: N(to), lat: 0, lon: 0, areaId: to }, tripId: 'IC-2312', schedDep: T(FRI, '23:12') });
    expect(trainLegLast(days, leg('sncb:8863008'))).toBe(true);
    expect(trainLegLast(days, leg('sncb:8861200'))).toBe(false);
  });

  it('bus, tram, métro : « dernier » si aucun départ plus tard ne dessert l’arrêt de descente, quelle que soit la ligne', () => {
    const f = areaFile(
      'tec:R3x',
      [
        ['36', 'Waterloo Gare', ['tec:a1', 'tec:a2', 'tec:a3']],
        // une autre ligne qui passe aussi par a2
        ['40', 'Braine Centre', ['tec:a2', 'tec:b9']],
        // un 36 express qui ne s'arrête qu'à a3 : même famille, même sens
        ['36', 'Waterloo Gare', ['tec:a3']],
      ],
      [
        [0, '22:10', 0, 'T-2210'],
        [0, '23:10', 0, 'T-2310'],
        [0, '23:30', 1, 'T-2330'],
        [0, '23:40', 2, 'T-2340'],
        [1, '06:10', 0, 'T-0610'],
      ],
    );
    const prep = prepareArea(f, META([FRI, SAT]));
    const leg = (line: string, time: string, tripId: string, to: string) => ({ op: 'tec' as Op, mode: 'bus' as Mode, line, schedDep: T(FRI, time), tripId, to: { name: N(to), lat: 0, lon: 0, areaId: to } });
    // le tableau (descente inconnue) : le 36 de 23:10 est suivi d'un 36 du même sens
    expect(marked(f)).toEqual(['40 Braine Centre 0 23:30', '36 Waterloo Gare 0 23:40']);
    // pour a1 : l'express ne s'y arrête pas, la personne ne peut pas le prendre : le 36 de 23:10 est son dernier
    expect(legLast(prep, leg('36', '23:10', 'T-2310', 'tec:a1'))).toBe(true);
    expect(legLast(prep, leg('36', '22:10', 'T-2210', 'tec:a1'))).toBe(false);
    // pour a2 : le 40 de 23:30 y passe ; pour a3 : l'express de 23:40 y passe
    expect(legLast(prep, leg('36', '23:10', 'T-2310', 'tec:a2'))).toBe(false);
    expect(legLast(prep, leg('40', '23:30', 'T-2330', 'tec:a2'))).toBe(true);
    expect(legLast(prep, leg('36', '23:10', 'T-2310', 'tec:a3'))).toBe(false);
    expect(legLast(prep, leg('36', '23:40', 'T-2340', 'tec:a3'))).toBe(true);
    // zone de descente inconnue du motif (ancien identifiant) : la règle des tableaux, même famille et même sens
    expect(legLast(prep, leg('36', '23:10', 'T-2310', 'tec:ancien'))).toBe(false);
    expect(legLast(prep, leg('36', '23:40', 'T-2340', 'tec:ancien'))).toBe(true);
    // un départ introuvable : jamais de marque
    expect(legLast(prep, leg('36', '23:11', 'T-xxxx', 'tec:a1'))).toBe(false);
  });

  it('bus : un motif à la liste pleine (60 zones) du même sens peut encore passer par la descente : pas de marque', () => {
    const far = Array.from({ length: 60 }, (_, i) => `tec:z${i}`);
    const pats: Pat[] = [
      ['36', 'Waterloo Gare', ['tec:a1', 'tec:a2']],
      ['36', 'Waterloo Gare', far],
    ];
    const deps: Dep[] = [
      [0, '23:10', 0, 'T-2310'],
      [0, '23:50', 1, 'T-2350'],
    ];
    const leg = { op: 'tec' as Op, mode: 'bus' as Mode, line: '36', schedDep: T(FRI, '23:10'), tripId: 'T-2310', to: { name: N('a1'), lat: 0, lon: 0, areaId: 'tec:a1' } };
    expect(legLast(prepareArea(areaFile('tec:R3f', pats, deps), META([FRI, SAT])), leg)).toBe(false);
    // la même liste, plus courte : toute la suite est connue, a1 n'y est pas
    const short: Pat[] = [pats[0], ['36', 'Waterloo Gare', far.slice(0, 59)]];
    expect(legLast(prepareArea(areaFile('tec:R3g', short, deps), META([FRI, SAT])), leg)).toBe(true);
    // une autre ligne à la liste pleine, d'un autre sens : ne compte pas
    const other: Pat[] = [pats[0], ['52', 'Nivelles Gare', far]];
    expect(legLast(prepareArea(areaFile('tec:R3h', other, deps), META([FRI, SAT])), leg)).toBe(true);
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
    // seul calculé : la marque du cœur reste ; avec cet autre trajet qui part plus tard, la personne peut encore partir
    expect(rows(j)).toContain('23:12 IC voie 4 → Namur, dernier   00:05');
    expect(rows(j, [j, other])).toContain('23:12 IC voie 4 → Namur   00:05');
    // un bus de nuit repart de la même gare plus tard : « Si tu le rates » donne son arrivée, et l'IC n'est plus « dernier »
    const bus = journey('jb', [
      { walk: 6, to: 'Bruxelles-Central' },
      { ride: 'N', mode: 'bus', dep: T(FRI, '23:50'), arr: T(FRI, '25:20'), from: 'Bruxelles-Central', to: 'Namur' },
      { walk: 9 },
    ]);
    expect(missLine(j, [j, bus], j.leaveAt, NOW)?.replace(/\u00a0/g, ' ')).toBe('Si tu le rates : arrivée 01:29, 1 h 15 plus tard');
    expect(rows(j, [j, bus])).toContain('23:12 IC voie 4 → Namur   00:05');
  });

  it('autres trajets déjà calculés : pas de « , dernier » quand un autre part plus tard avant demain (autre ligne, autre réseau, changement)', () => {
    type Steps = Parameters<typeof journey>[1];
    // tram de la STIB marqué « dernier » par le cœur
    const tram = (id = 'jt'): Journey => {
      const j = journey(id, [
        { walk: 4, to: 'Bourse' },
        { ride: '3', mode: 'tram', dep: T(FRI, '23:10'), arr: T(FRI, '23:31'), from: 'Bourse', to: 'Churchill', head: 'Churchill' },
        { walk: 5 },
      ]);
      j.legs[1].last = true;
      return j;
    };
    const other = (id: string, steps: Steps): Journey => journey(id, steps);
    const j = tram();
    const WITH = '23:10 Tram 3 → Churchill, dernier   23:31';
    const WITHOUT = '23:10 Tram 3 → Churchill   23:31';
    const shown = (journeys: Journey[]) => rows(j, journeys).find((l) => l.startsWith('23:10'));
    // aucun autre trajet calculé : la règle du cœur, la marque
    expect(shown([j])).toBe(WITH);
    expect(laterJourney(j.legs[1], j, [j])).toBe(false);
    // un bus d'un autre réseau, d'un autre arrêt, plus tard dans les autres trajets : pas de marque
    const bus = other('jb', [{ walk: 7, to: 'De Brouckère' }, { ride: '48', mode: 'bus', dep: T(FRI, '23:40'), arr: T(FRI, '24:02'), from: 'De Brouckère', to: 'Churchill' }, { walk: 5 }]);
    expect(bus.legs[1].op).not.toBe(j.legs[1].op);
    expect(shown([j, bus])).toBe(WITHOUT);
    expect(shown([bus, j])).toBe(WITHOUT);
    // avec un changement, après minuit (même nuit) : pas de marque
    const change = other('jc', [
      { walk: 4, to: 'Bourse' },
      { ride: 'N10', mode: 'bus', dep: T(FRI, '24:20'), arr: T(FRI, '24:35'), from: 'Bourse', to: 'Albert' },
      { ride: 'N11', mode: 'bus', dep: T(FRI, '24:45'), arr: T(FRI, '24:55'), from: 'Albert', to: 'Churchill' },
      { walk: 5 },
    ]);
    expect(shown([j, change])).toBe(WITHOUT);
    // autre trajet seulement demain (04:00 passé) : la marque reste
    const tomorrow = other('jd', [{ walk: 4, to: 'Bourse' }, { ride: '3', mode: 'tram', dep: T(SAT, '05:12'), arr: T(SAT, '05:33'), from: 'Bourse', to: 'Churchill' }, { walk: 5 }]);
    expect(shown([j, tomorrow])).toBe(WITH);
    // un trajet plus tôt, le même trajet rafraîchi (même identifiant), un trajet à pied, un trajet dont un véhicule est
    // supprimé : la marque reste
    const earlier = other('je', [{ walk: 4, to: 'Bourse' }, { ride: '4', mode: 'tram', dep: T(FRI, '22:50'), arr: T(FRI, '23:12'), from: 'Bourse', to: 'Churchill' }, { walk: 5 }]);
    const sameTime = other('js', [{ walk: 7, to: 'De Brouckère' }, { ride: '48', mode: 'bus', dep: T(FRI, '23:10'), arr: T(FRI, '23:35'), from: 'De Brouckère', to: 'Churchill' }, { walk: 5 }]);
    const onFoot = other('jw', [{ walk: 48 }]);
    const cancelled = other('jx', [{ walk: 7, to: 'De Brouckère' }, { ride: '48', mode: 'bus', dep: T(FRI, '23:40'), arr: T(FRI, '24:02'), from: 'De Brouckère', to: 'Churchill' }, { walk: 5 }]);
    cancelled.legs[1].cancelled = true;
    // le même trajet relu avec 2 min de retard (même identifiant) n'est pas « un autre trajet »
    const again = tram('jt');
    again.legs[1].dep += 120_000;
    expect(shown([j, earlier, sameTime, again, onFoot, cancelled])).toBe(WITH);
    // une correspondance marquée « dernier » : seul un trajet qui part après elle retire la marque
    const two = journey('j2', [
      { walk: 4, to: 'Bourse' },
      { ride: '4', mode: 'tram', dep: T(FRI, '23:20'), arr: T(FRI, '23:30'), from: 'Bourse', to: 'Albert' },
      { ride: '51', mode: 'tram', dep: T(FRI, '23:50'), arr: T(FRI, '23:58'), from: 'Albert', to: 'Churchill' },
      { walk: 5 },
    ]);
    two.legs[2].last = true;
    const second = (journeys: Journey[]) => lines(stepsPage(route, { journeys, index: journeys.indexOf(two), fresh: true }, ctx)).find((l) => l.includes('Tram 51'));
    expect(second([two])).toMatch(/Tram 51 → Churchill, dernier/);
    expect(second([two, bus])).toMatch(/Tram 51 → Churchill, dernier/);
    expect(second([two, change])).not.toMatch(/dernier/);
    // le trajet qui part plus tard garde sa propre marque
    const last = other('jl', [{ walk: 7, to: 'De Brouckère' }, { ride: '48', mode: 'bus', dep: T(FRI, '23:40'), arr: T(FRI, '24:02'), from: 'De Brouckère', to: 'Churchill' }, { walk: 5 }]);
    last.legs[1].last = true;
    expect(lines(stepsPage(route, { journeys: [j, last], index: 1, fresh: true }, ctx)).find((l) => l.startsWith('23:40'))).toBe('23:40 Bus 48 → Churchill, dernier   00:02');
  });
});
