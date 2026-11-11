/**
 * Classement « Le plus court » (PRD-1.2 § 1, design-routing.md § 4.8) : cas de référence A à H du PRD 1.1 § 4.6 revus
 * (CA-1.1), invariants (CA-1.2), raisons du PRD-1.2 § 1.3 (une ligne des lunettes, 542 px) et règles des propositions.
 */
import { describe, expect, it } from 'vitest';
import type { Journey, JourneyLabel, Leg } from '../../../src/core/api';
import { itemOf, rank } from '../../../src/core/routing/rank';
import { changesText, laterText, reasonText, walksText } from '../../../src/core/routing/reason';
import { gtfsTime } from '../../../src/core/util';
import { textWidth } from '../../../src/glasses/font';

const NB = ' ';
const MIN = 60_000;
/** Heure du 10/11/2026 (ou du 11/11 avec next) en ms. */
const t = (hhmm: string, next = false) => {
  const [h, m] = hhmm.split(':').map(Number);
  return gtfsTime(next ? '2026-11-11' : '2026-11-10', h * 60 + m);
};
const plain = (s: string | undefined) => (s ?? '').replace(/ /g, ' ');

let seq = 0;
interface Spec {
  /** Marches dans l'ordre : accès, correspondances, sortie (0 = pas de marche). */
  walks: number[];
  rides: number;
  /** Départ du premier véhicule. */
  board: string;
  arr: string;
  /** Même premier véhicule (voyage et zone) que celui-ci. */
  firstTrip?: string;
  next?: boolean;
  line?: string;
}

/** Trajet synthétique : marches et véhicules répartis entre le premier départ et l'arrivée. */
function J(id: string, s: Spec): Journey {
  const legs: Leg[] = [];
  const board = t(s.board, s.next);
  const arr = t(s.arr, s.next);
  const egress = s.walks[s.rides] ?? 0;
  const lastArr = arr - egress * MIN;
  const span = (lastArr - board) / s.rides;
  const walk = (min: number, dep: number, from: string, to: string): Leg => ({
    kind: 'walk',
    from: { name: { fr: from, nl: from }, lat: 50, lon: 4, areaId: from },
    to: { name: { fr: to, nl: to }, lat: 50, lon: 4, areaId: to },
    dep,
    arr: dep + min * MIN,
    schedDep: dep,
    schedArr: dep + min * MIN,
    walkMin: min,
  });
  if (s.walks[0] > 0) legs.push(walk(s.walks[0], board - s.walks[0] * MIN, 'O', `${id}-z0`));
  for (let i = 0; i < s.rides; i++) {
    const dep = board + i * span + (i > 0 ? (s.walks[i] ?? 0) * MIN : 0);
    const a = board + (i + 1) * span;
    if (i > 0 && (s.walks[i] ?? 0) > 0) legs.push(walk(s.walks[i], board + i * span, `${id}-a${i - 1}`, `${id}-z${i}`));
    const trip = i === 0 && s.firstTrip ? s.firstTrip : `${id}-${i}-${seq++}`;
    legs.push({
      kind: 'ride',
      from: { name: { fr: `Z${i}`, nl: `Z${i}` }, lat: 50, lon: 4, areaId: i === 0 && s.firstTrip ? 'shared' : `${id}-z${i}` },
      to: { name: { fr: `A${i}`, nl: `A${i}` }, lat: 50, lon: 4, areaId: `${id}-a${i}` },
      dep,
      arr: a,
      schedDep: dep,
      schedArr: a,
      op: 'stib',
      mode: 'bus',
      line: s.line ? `${s.line}${i}` : `${id}${i}`,
      head: { fr: 'X', nl: 'X' },
      tripId: trip,
      rt: false,
      delayMin: 0,
      cancelled: false,
    });
  }
  if (egress > 0) legs.push(walk(egress, lastArr, `${id}-a${s.rides - 1}`, 'D'));
  const dep = legs[0].dep;
  return { id, legs, dep, arr, leaveAt: dep, transfers: Math.max(0, s.rides - 1), rt: false, alerts: [] };
}

function walkOnly(id: string, start: string, minutes: number): Journey {
  const dep = t(start);
  return {
    id,
    legs: [{ kind: 'walk', from: { name: { fr: 'O', nl: 'O' }, lat: 50, lon: 4 }, to: { name: { fr: 'D', nl: 'D' }, lat: 50, lon: 4 }, dep, arr: dep + minutes * MIN, schedDep: dep, schedArr: dep + minutes * MIN, walkMin: minutes }],
    dep,
    arr: dep + minutes * MIN,
    leaveAt: dep,
    transfers: 0,
    rt: true,
    alerts: [],
  };
}

/** Propositions (identifiant, étiquette, raison) d'un ensemble de trajets demandés à `after`. */
function propose(js: Journey[], after: string, maxWalk = 10, next = false): [string, JourneyLabel, string][] {
  return rank(js.map(itemOf), t(after, next) / MIN, maxWalk).map((r) => [r.item.j.id, r.label, plain(reasonText(r.label, r.item.j, r.ref?.j))]);
}

describe('raisons (PRD-1.2 § 1.3, règles de la 1.1)', () => {
  it('changements, marches, écarts', () => {
    expect([changesText(0), changesText(1), changesText(3)]).toEqual(['direct', '1 changement', '3 changements']);
    expect(walksText([7, 12])).toBe(`à pied 7 + 12${NB}min`);
    expect(walksText([2, 1, 1])).toBe(`à pied 2 + 1 + 1${NB}min`);
    expect(walksText([2, 1, 1, 4])).toBe(`8${NB}min à pied`);
    expect(walksText([])).toBe('');
    expect([laterText(60), laterText(12), laterText(120), laterText(90)]).toEqual([`1${NB}h plus tard`, `12${NB}min plus tard`, `2${NB}h plus tard`, `90${NB}min plus tard`]);
  });

  it('textes exacts de chaque étiquette', () => {
    const x = J('X', { walks: [7, 12], rides: 1, board: '07:44', arr: '09:04' });
    const y = J('Y', { walks: [3, 2, 4], rides: 2, board: '07:40', arr: '08:58' });
    const none = J('N', { walks: [0, 0], rides: 1, board: '08:00', arr: '08:40' });
    expect(reasonText('short', x)).toBe(`Le plus court${NB}: direct, à pied 7 + 12${NB}min`);
    expect(plain(reasonText('short', walkOnly('W', '08:00', 12)))).toBe('Le plus court : à pied, 12 min');
    expect(plain(reasonText('earlier', y))).toBe('Plus tôt : 1 changement, à pied 3 + 2 + 4 min');
    expect(plain(reasonText('lesswalk', y))).toBe('Moins de marche : 1 changement, à pied 3 + 2 + 4 min');
    expect(plain(reasonText('none', x))).toBe('Sans changement : à pied 7 + 12 min');
    expect(plain(reasonText('none', none))).toBe('Sans changement : arrivée 08:40');
    expect(plain(reasonText('fewer', y))).toBe('Moins de changements : 1 changement, à pied 3 + 2 + 4 min');
    expect(plain(reasonText('walk', walkOnly('W', '08:00', 22)))).toBe('À pied : 22 min, arrivée 08:22');
    expect(plain(reasonText('later', y))).toBe('Plus tard : 1 changement, départ 07:37');
  });

  it('espace insécable devant « : » et entre nombre et unité ; jamais de tiret ; une ligne des lunettes (542 px)', () => {
    const x = J('X', { walks: [7, 12], rides: 1, board: '07:44', arr: '09:04' });
    const all: string[] = [];
    // trois marches de deux chiffres, deux changements (le plus long possible) ; « Moins de changements » : un seul
    const y = J('Y', { walks: [12, 13, 14, 0], rides: 3, board: '08:00', arr: '10:00' });
    const f = J('F', { walks: [12, 13, 14], rides: 2, board: '08:00', arr: '10:00' });
    for (const label of ['short', 'earlier', 'lesswalk', 'none', 'walk', 'next', 'later'] as JourneyLabel[]) all.push(reasonText(label, y, x));
    all.push(reasonText('fewer', f), reasonText('none', J('N', { walks: [24, 25], rides: 1, board: '08:00', arr: '10:00' })));
    for (const s of all) {
      expect(s).not.toMatch(/[–—]/);
      expect(s).not.toMatch(/ :/);
      expect(s.length).toBeLessThanOrEqual(60);
      expect(textWidth(s), s).toBeLessThanOrEqual(542);
    }
    expect(plain(all[0])).toBe('Le plus court : 2 changements, à pied 12 + 13 + 14 min');
    expect(plain(all[7])).toBe('Moins de changements : 1 changement, à pied 12 + 13 + 14 min');
    expect(textWidth(all[7])).toBe(538);
  });
});

describe('CA-1.1 : cas de référence du PRD 1.1 § 4.6, revus pour « Le plus court »', () => {
  it('A : à même arrivée, direct avec 12 min de marche avant 1 changement', () => {
    const X = J('X', { walks: [7, 12], rides: 1, board: '07:44', arr: '08:58' });
    const Y = J('Y', { walks: [7, 2, 9], rides: 2, board: '07:44', arr: '08:58' });
    expect(propose([Y, X], '07:30')).toEqual([['X', 'short', 'Le plus court : direct, à pied 7 + 12 min']]);
  });

  it('B : 1 changement 12 min plus tôt d’abord, puis le direct « Sans changement »', () => {
    const X = J('X', { walks: [5, 4], rides: 1, board: '08:05', arr: '09:10' });
    const Y = J('Y', { walks: [3, 0, 2], rides: 2, board: '08:05', arr: '08:58' });
    expect(propose([X, Y], '08:00')).toEqual([
      ['Y', 'short', 'Le plus court : 1 changement, à pied 3 + 2 min'],
      ['X', 'none', 'Sans changement : à pied 5 + 4 min'],
    ]);
  });

  it('C : le direct arrive 45 min après : 1 changement seul', () => {
    const X = J('X', { walks: [3, 3], rides: 1, board: '08:05', arr: '10:05' });
    const Y = J('Y', { walks: [3, 0, 3], rides: 2, board: '08:05', arr: '09:20' });
    expect(propose([X, Y], '08:00')).toEqual([['Y', 'short', 'Le plus court : 1 changement, à pied 3 + 3 min']]);
  });

  it('D : 3 min plus tôt ne compte pas ; à durée égale (5 min près), 5 min de marche contre 15', () => {
    const X = J('X', { walks: [2, 0, 3], rides: 2, board: '08:05', arr: '09:00' });
    const Y = J('Y', { walks: [9, 0, 6], rides: 2, board: '08:05', arr: '08:57' });
    expect(propose([Y, X], '08:00')).toEqual([['X', 'short', 'Le plus court : 1 changement, à pied 2 + 3 min']]);
  });

  it('E : la marche seule de 22 min (marche longue) ne passe pas devant ; « À pied : 22 min, arrivée 09:12 »', () => {
    const X = J('X', { walks: [2, 2, 2], rides: 2, board: '08:52', arr: '09:14' });
    const W = walkOnly('W', '08:50', 22);
    expect(propose([W, X], '08:50')).toEqual([
      ['X', 'short', 'Le plus court : 1 changement, à pied 2 + 2 + 2 min'],
      ['W', 'walk', 'À pied : 22 min, arrivée 09:12'],
    ]);
  });

  it('F (réel) : IC jusqu’à Bruxelles-Central puis 12 min à pied, jamais Bruxelles-Chapelle', () => {
    const X = J('X', { walks: [8, 12], rides: 1, board: '07:44', arr: '09:04', firstTrip: 'IC-0744' });
    const Y = J('Y', { walks: [8, 0, 6], rides: 2, board: '07:44', arr: '09:12', firstTrip: 'IC-0744' });
    expect(propose([Y, X], '07:31')).toEqual([['X', 'short', 'Le plus court : direct, à pied 8 + 12 min']]);
  });

  it('G (réel, nuit) : S1 06:20 direct ; « Plus tôt » pour le trajet parti plus de 30 min avant', () => {
    const X = J('X', { walks: [0, 0], rides: 1, board: '06:20', arr: '06:46', next: true });
    const Y = J('Y', { walks: [3, 0, 0], rides: 2, board: '05:02', arr: '06:30', next: true });
    expect(propose([X, Y], '23:50')).toEqual([
      ['X', 'short', 'Le plus court : direct'],
      ['Y', 'earlier', 'Plus tôt : 1 changement, à pied 3 min'],
    ]);
  });

  it('H (réel) : 19 min de marche puis le train, 12 min plus tôt, d’abord ; bus puis métro « Moins de marche »', () => {
    const X = J('X', { walks: [19, 5], rides: 1, board: '07:55', arr: '08:46' });
    const Y = J('Y', { walks: [1, 2, 4], rides: 2, board: '07:53', arr: '08:58' });
    expect(propose([X, Y], '07:45')).toEqual([
      ['X', 'short', 'Le plus court : direct, à pied 19 + 5 min'],
      ['Y', 'lesswalk', 'Moins de marche : 1 changement, à pied 1 + 2 + 4 min'],
    ]);
  });

  it('H, le train seulement 9 min plus tôt : bus puis métro d’abord, la marche longue en « Plus tôt »', () => {
    const X = J('X', { walks: [19, 5], rides: 1, board: '07:55', arr: '08:49' });
    const Y = J('Y', { walks: [1, 2, 4], rides: 2, board: '07:53', arr: '08:58' });
    expect(propose([X, Y], '07:45')).toEqual([
      ['Y', 'short', 'Le plus court : 1 changement, à pied 1 + 2 + 4 min'],
      ['X', 'earlier', 'Plus tôt : direct, à pied 19 + 5 min'],
    ]);
  });
});

describe('CA-1.2 : invariants (trajets tirés au hasard)', () => {
  it('rien n’arrive 5 min avant « Le plus court », sauf « Plus tôt » ; une marche longue en tête gagne 10 min', () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pickInt = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
    const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    let longFirst = 0;
    for (let n = 0; n < 400; n++) {
      const js: Journey[] = [];
      const count = pickInt(2, 7);
      for (let k = 0; k < count; k++) {
        const rides = pickInt(1, 3);
        const walks = Array.from({ length: rides + 1 }, (_, i) => (i === 0 || i === rides ? pickInt(0, 22) : pickInt(0, 5)));
        const board = 8 * 60 + pickInt(0, 50);
        js.push(J(`J${n}-${k}`, { walks, rides, board: hm(board), arr: hm(board + pickInt(20, 80) + walks[rides]) }));
      }
      if (rnd() < 0.3) js.push(walkOnly(`W${n}`, '08:00', pickInt(11, 35)));
      const out = rank(js.map(itemOf), t('08:00') / MIN, 10);
      const first = out[0].item;
      for (const r of out.slice(1)) {
        if (r.label !== 'earlier' && r.label !== 'walk') expect(r.item.arr, `${n} ${r.label}`).toBeGreaterThan(first.arr - 5);
      }
      if (first.walks.some((w) => w >= 15)) {
        longFirst++;
        const items = js.map(itemOf).filter((x) => x.rides > 0 && x.dep <= t('09:00') / MIN && !x.walks.some((w) => w >= 15));
        for (const x of items) expect(first.arr, `${n}`).toBeLessThanOrEqual(x.arr - 10);
      }
    }
    expect(longFirst).toBeGreaterThan(0);
  });
});

describe('règles des propositions (PRD-1.2 § 1.2 et § 1.3)', () => {
  it('trois au plus, jamais deux fois le même trajet, « Le suivant » sur la même structure', () => {
    const js = [0, 1, 2, 3, 4].map((k) => J(`S${k}`, { walks: [3, 4], rides: 1, board: `08:${String(5 + 10 * k).padStart(2, '0')}`, arr: `08:${String(30 + 10 * k).padStart(2, '0')}`, line: 'L' }));
    // même ligne, mêmes zones : une seule structure
    for (const j of js) {
      j.legs[1].from.areaId = 'z0';
      j.legs[1].to.areaId = 'a0';
    }
    const out = propose([...js, js[0]], '08:00');
    expect(out.map((x) => x[0])).toEqual(['S0', 'S1', 'S2']);
    expect(out.map((x) => x[1])).toEqual(['short', 'next', 'next']);
    expect(out[1][2]).toBe('Le suivant : même trajet, 10 min plus tard');
    expect(new Set(out.map((x) => x[0])).size).toBe(out.length);
  });

  it('à durée égale (5 min près), le moins de changements, puis le moins de marche', () => {
    const A = J('A', { walks: [4, 0, 2], rides: 2, board: '10:10', arr: '10:40' });
    const B = J('B', { walks: [2, 2], rides: 1, board: '10:10', arr: '10:44' });
    expect(propose([A, B], '10:00')[0][0]).toBe('B');
    const C = J('C', { walks: [9, 2], rides: 1, board: '10:10', arr: '10:43' });
    expect(propose([C, B], '10:00')[0][0]).toBe('B');
  });

  it('une correspondance qui gagne moins de 5 min sur le même premier véhicule n’est jamais proposée', () => {
    const direct = J('D', { walks: [0, 0], rides: 1, board: '08:25', arr: '09:24', firstTrip: 'IC-0825' });
    const via = J('V', { walks: [0, 0, 0], rides: 2, board: '08:25', arr: '09:21', firstTrip: 'IC-0825' });
    expect(propose([direct, via], '08:00').map((x) => x[0])).toEqual(['D']);
  });

  it('jamais un trajet sans marche longue écarté au profit d’un trajet avec marche longue (filtres de la 1.1)', () => {
    // même IC : 16 min à pied à la fin, ou le tram (2 min plus tôt, sans marche longue) : le tram reste et passe d'abord
    const longEnd = J('L', { walks: [7, 16], rides: 1, board: '07:42', arr: '09:00', firstTrip: 'IC' });
    const tram = J('T', { walks: [7, 2, 4], rides: 2, board: '07:42', arr: '08:58', firstTrip: 'IC' });
    // (sans changement mais avec une marche longue et 2 min plus tard : pas proposé)
    expect(propose([longEnd, tram], '07:30').map((x) => `${x[0]}:${x[1]}`)).toEqual(['T:short']);
    // dominé sans la règle : part plus tôt, arrive plus tard, sans 5 min de marche en moins ; la marche longue ne fait
    // gagner que 6 min : « Plus tôt »
    const L2 = J('L2', { walks: [15, 0], rides: 1, board: '08:15', arr: '08:40' });
    const N2 = J('N2', { walks: [6, 0, 5], rides: 2, board: '08:04', arr: '08:46' });
    expect(propose([L2, N2], '07:55').map((x) => `${x[0]}:${x[1]}`)).toEqual(['N2:short', 'L2:earlier']);
  });

  it('marche longue : une marche d’au moins la marche maximale plus 5 min (15 min, ou 10 avec 5 réglées)', () => {
    const X = J('X', { walks: [12, 0], rides: 1, board: '08:20', arr: '08:45' });
    const Y = J('Y', { walks: [2, 0, 3], rides: 2, board: '08:12', arr: '08:50' });
    // 12 min : pas une marche longue avec 10 réglées (préférence tolérée à 5 min près)
    expect(propose([X, Y], '08:00')[0][0]).toBe('X');
    // avec 5 min réglées, 12 min est une marche longue : 5 min de gain ne suffisent pas (il en faut 10)
    expect(propose([X, Y], '08:00', 5).map((x) => `${x[0]}:${x[1]}`)).toEqual(['Y:short', 'X:earlier']);
  });

  it('« Sans changement » et « Moins de changements » : arrivée au plus 20 min après', () => {
    const S = J('S', { walks: [3, 0, 0, 3], rides: 3, board: '07:50', arr: '10:00' });
    expect(propose([S, J('L', { walks: [3, 3], rides: 1, board: '07:50', arr: '10:21' })], '07:45').map((x) => x[0])).toEqual(['S']);
    expect(propose([S, J('K', { walks: [3, 3], rides: 1, board: '07:50', arr: '10:20' })], '07:45')).toEqual([
      ['S', 'short', 'Le plus court : 2 changements, à pied 3 + 3 min'],
      ['K', 'none', 'Sans changement : à pied 3 + 3 min'],
    ]);
    expect(propose([S, J('F', { walks: [3, 0, 3], rides: 2, board: '07:50', arr: '10:10' })], '07:45')[1]).toEqual(['F', 'fewer', 'Moins de changements : 1 changement, à pied 3 + 3 min']);
  });

  it('« Plus tard » : la suite, départ plus tard ; jamais un trajet devancé de plus de 30 min par un trajet parti au plus 30 min avant', () => {
    const a = J('A', { walks: [3, 3], rides: 1, board: '08:05', arr: '08:40' });
    const b = J('B', { walks: [3, 0, 3], rides: 2, board: '08:20', arr: '08:55' });
    expect(propose([a, b], '08:00')).toEqual([
      ['A', 'short', 'Le plus court : direct, à pied 3 + 3 min'],
      ['B', 'later', 'Plus tard : 1 changement, départ 08:17'],
    ]);
    const slow = J('Z', { walks: [3, 0, 3], rides: 2, board: '08:20', arr: '09:15' });
    expect(propose([a, slow], '08:00').map((x) => x[0])).toEqual(['A']);
  });

  it('marche seule : « Le plus court : à pied, {n} min »', () => {
    expect(propose([walkOnly('W', '08:00', 9)], '08:00')).toEqual([['W', 'short', 'Le plus court : à pied, 9 min']]);
  });
});
