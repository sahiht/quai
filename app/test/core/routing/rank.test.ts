/**
 * Classement « le trajet le plus facile » (PRD § 4.1 à § 4.3, design-routing.md § 4.8) : cas de référence A à H du
 * PRD § 4.6 sur des trajets synthétiques, raisons du PRD § 6.1 L3, règles d'égalité et propositions.
 */
import { describe, expect, it } from 'vitest';
import type { Journey, JourneyLabel, Leg } from '../../../src/core/api';
import { itemOf, rank } from '../../../src/core/routing/rank';
import { changesText, laterText, reasonText, walksText } from '../../../src/core/routing/reason';
import { gtfsTime } from '../../../src/core/util';

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

describe('raisons (PRD § 6.1 L3)', () => {
  it('changements, marches, écarts', () => {
    expect([changesText(0), changesText(1), changesText(3)]).toEqual(['direct', '1 changement', '3 changements']);
    expect(walksText([7, 12])).toBe(`à pied 7 + 12${NB}min`);
    expect(walksText([2, 1, 1])).toBe(`à pied 2 + 1 + 1${NB}min`);
    expect(walksText([2, 1, 1, 4])).toBe(`8${NB}min à pied`);
    expect(walksText([])).toBe('');
    expect([laterText(60), laterText(12), laterText(120), laterText(90)]).toEqual([`1${NB}h plus tard`, `12${NB}min plus tard`, `2${NB}h plus tard`, `90${NB}min plus tard`]);
  });

  it('espace insécable devant « : » et entre nombre et unité ; jamais de tiret ; une ligne des lunettes', () => {
    const x = J('X', { walks: [7, 12], rides: 1, board: '07:44', arr: '09:04' });
    const r = reasonText('simple', x);
    expect(r).toBe(`Le plus simple${NB}: direct, à pied 7 + 12${NB}min`);
    const all: string[] = [];
    const y = J('Y', { walks: [12, 14, 13, 0], rides: 3, board: '08:00', arr: '10:00' });
    for (const label of ['simple', 'fast', 'earlier', 'none', 'fewer', 'walk', 'next', 'later'] as JourneyLabel[]) all.push(reasonText(label, y, x));
    for (const s of all) {
      expect(s).not.toMatch(/[–—]/);
      expect(s).not.toMatch(/ :/);
      expect(s.length).toBeLessThanOrEqual(56);
    }
    expect(plain(all[0])).toBe('Le plus simple : 2 changements, à pied 12 + 14 + 13 min');
  });
});

describe('cas de référence du PRD § 4.6', () => {
  it('A : direct avec 12 min de marche avant 1 changement à même arrivée ; pas de « Le plus rapide »', () => {
    const X = J('X', { walks: [7, 12], rides: 1, board: '07:44', arr: '08:58' });
    const Y = J('Y', { walks: [7, 2, 9], rides: 2, board: '07:44', arr: '08:58' });
    expect(propose([Y, X], '07:30')).toEqual([['X', 'simple', 'Le plus simple : direct, à pied 7 + 12 min']]);
  });

  it('B : direct d’abord ; le plus rapide « 12 min plus tôt, 1 changement »', () => {
    const X = J('X', { walks: [5, 4], rides: 1, board: '08:05', arr: '09:10' });
    const Y = J('Y', { walks: [3, 0, 2], rides: 2, board: '08:05', arr: '08:58' });
    expect(propose([X, Y], '08:00')).toEqual([
      ['X', 'simple', 'Le plus simple : direct, à pied 5 + 4 min'],
      ['Y', 'fast', 'Le plus rapide : 12 min plus tôt, 1 changement'],
    ]);
  });

  it('C : garde-fou des 30 min : 1 changement d’abord, « Sans changement : arrivée 10:05 »', () => {
    const X = J('X', { walks: [3, 3], rides: 1, board: '08:05', arr: '10:05' });
    const Y = J('Y', { walks: [3, 0, 3], rides: 2, board: '08:05', arr: '09:20' });
    expect(propose([X, Y], '08:00')).toEqual([
      ['Y', 'simple', 'Le plus simple : 1 changement, à pied 3 + 3 min'],
      ['X', 'none', 'Sans changement : arrivée 10:05'],
    ]);
  });

  it('D : 5 min de marche contre 15 ; 3 min plus tôt ne fait pas un « Le plus rapide »', () => {
    const X = J('X', { walks: [2, 0, 3], rides: 2, board: '08:05', arr: '09:00' });
    const Y = J('Y', { walks: [9, 0, 6], rides: 2, board: '08:05', arr: '08:57' });
    expect(propose([Y, X], '08:00')).toEqual([['X', 'simple', 'Le plus simple : 1 changement, à pied 2 + 3 min']]);
  });

  it('E : la marche longue compte pour un changement ; « À pied : 22 min, arrivée 09:12 »', () => {
    const X = J('X', { walks: [2, 2, 2], rides: 2, board: '08:52', arr: '09:14' });
    const W = walkOnly('W', '08:50', 22);
    expect(propose([W, X], '08:50')).toEqual([
      ['X', 'simple', 'Le plus simple : 1 changement, à pied 2 + 2 + 2 min'],
      ['W', 'walk', 'À pied : 22 min, arrivée 09:12'],
    ]);
  });

  it('F (réel) : IC jusqu’à Bruxelles-Central puis 12 min à pied, jamais Bruxelles-Chapelle', () => {
    const X = J('X', { walks: [8, 12], rides: 1, board: '07:44', arr: '09:04', firstTrip: 'IC-0744' });
    const Y = J('Y', { walks: [8, 0, 6], rides: 2, board: '07:44', arr: '09:12', firstTrip: 'IC-0744' });
    expect(propose([Y, X], '07:31')).toEqual([['X', 'simple', 'Le plus simple : direct, à pied 8 + 12 min']]);
  });

  it('G (réel, nuit) : S1 06:20 direct ; « Plus tôt : 1 changement, départ 04:59 »', () => {
    const X = J('X', { walks: [0, 0], rides: 1, board: '06:20', arr: '06:46', next: true });
    const Y = J('Y', { walks: [3, 0, 0], rides: 2, board: '05:02', arr: '06:30', next: true });
    expect(propose([X, Y], '23:50')).toEqual([
      ['X', 'simple', 'Le plus simple : direct'],
      ['Y', 'earlier', 'Plus tôt : 1 changement, départ 04:59'],
    ]);
  });

  it('H (réel) : bus W puis métro d’abord (19 min de marche = un changement) ; le train « Le plus rapide »', () => {
    const X = J('X', { walks: [19, 5], rides: 1, board: '07:55', arr: '08:46' });
    const Y = J('Y', { walks: [1, 2, 4], rides: 2, board: '07:53', arr: '08:58' });
    expect(propose([X, Y], '07:45')).toEqual([
      ['Y', 'simple', 'Le plus simple : 1 changement, à pied 1 + 2 + 4 min'],
      ['X', 'fast', 'Le plus rapide : 12 min plus tôt, direct'],
    ]);
  });
});

describe('règles des propositions (CA-M3.1, design § 4.8)', () => {
  it('trois au plus, jamais deux fois le même trajet, « Le suivant » sur la même structure', () => {
    const js = [0, 1, 2, 3, 4].map((k) => J(`S${k}`, { walks: [3, 4], rides: 1, board: `08:${String(5 + 10 * k).padStart(2, '0')}`, arr: `08:${String(30 + 10 * k).padStart(2, '0')}`, line: 'L' }));
    // même ligne, mêmes zones : une seule structure
    for (const j of js) {
      j.legs[1].from.areaId = 'z0';
      j.legs[1].to.areaId = 'a0';
    }
    const out = propose([...js, js[0]], '08:00');
    expect(out.map((x) => x[0])).toEqual(['S0', 'S1', 'S2']);
    expect(out.map((x) => x[1])).toEqual(['simple', 'next', 'next']);
    expect(out[1][2]).toBe('Le suivant : même trajet, 10 min plus tard');
    expect(new Set(out.map((x) => x[0])).size).toBe(out.length);
  });

  it('égalité de marche lue de façon séquentielle (§ 4.8, précision 1)', () => {
    // A arrive le plus tôt ; B : même changement, 2 min de marche en moins mais 26 min plus tard : A reste
    const A = J('A', { walks: [4, 0, 2], rides: 2, board: '10:10', arr: '10:40' });
    const B = J('B', { walks: [2, 0, 2], rides: 2, board: '10:20', arr: '11:06' });
    expect(propose([B, A], '10:00')[0][0]).toBe('A');
  });

  it('une correspondance qui gagne moins de 5 min sur le même premier véhicule n’est jamais proposée', () => {
    const direct = J('D', { walks: [0, 0], rides: 1, board: '08:25', arr: '09:24', firstTrip: 'IC-0825' });
    const via = J('V', { walks: [0, 0, 0], rides: 2, board: '08:25', arr: '09:21', firstTrip: 'IC-0825' });
    expect(propose([direct, via], '08:00').map((x) => x[0])).toEqual(['D']);
  });

  it('« Moins de changements » borné à max(45 min, moitié de la durée) après le plus simple (§ 4.8, précision 4)', () => {
    const simple = J('S', { walks: [3, 0, 0, 3], rides: 3, board: '07:50', arr: '10:00' });
    const slow = J('L', { walks: [3, 3], rides: 1, board: '07:50', arr: '12:20' });
    expect(propose([simple, slow], '07:45').map((x) => x[0])).toEqual(['S']);
    const ok = J('K', { walks: [3, 3], rides: 1, board: '07:50', arr: '11:00' });
    expect(propose([simple, ok], '07:45')).toEqual([
      ['S', 'simple', 'Le plus simple : 2 changements, à pied 3 + 3 min'],
      ['K', 'none', 'Sans changement : arrivée 11:00'],
    ]);
  });

  it('« Plus tard » : la suite du classement, départ plus tard que le plus simple', () => {
    const a = J('A', { walks: [3, 3], rides: 1, board: '08:05', arr: '08:40' });
    const b = J('B', { walks: [3, 0, 3], rides: 2, board: '08:20', arr: '08:55' });
    expect(propose([a, b], '08:00')).toEqual([
      ['A', 'simple', 'Le plus simple : direct, à pied 3 + 3 min'],
      ['B', 'later', 'Plus tard : 1 changement, départ 08:17'],
    ]);
  });

  it('marche seule : « Le plus simple : à pied, {n} min »', () => {
    expect(propose([walkOnly('W', '08:00', 9)], '08:00')).toEqual([['W', 'simple', 'Le plus simple : à pied, 9 min']]);
  });
});
