/**
 * Classement « le moins de marche d'abord » (PRD-1.2.1 § 1, qui remplace « Le plus court d'abord » de PRD-1.2 § 1 ;
 * design-routing.md § 4.8) : cas de référence A à H du PRD 1.1 § 4.6 revus (CA-1.1), paliers de marche et garde-fou
 * (CA-121.2, dont des invariants sur des trajets tirés au hasard), noms et raisons (CA-121.3, PRD-1.2.1 § 2 : une ligne
 * des lunettes, 60 caractères et 542 px au plus) et règles des propositions.
 */
import { describe, expect, it } from 'vitest';
import type { Journey, JourneyLabel, Leg } from '../../../src/core/api';
import { itemOf, longestOf, rank, walkTier } from '../../../src/core/routing/rank';
import { changesText, gapText, laterText, reasonsOf, reasonText, walksText } from '../../../src/core/routing/reason';
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

/**
 * Propositions (identifiant, étiquette, raison) d'un ensemble de trajets demandés à `after`, raisons calculées comme
 * le cœur (reasonsOf sur la liste) ; elles sont aussi celles que donnent les références du classement.
 */
function propose(js: Journey[], after: string, maxWalk = 10, next = false): [string, JourneyLabel, string][] {
  const ranked = rank(js.map(itemOf), t(after, next) / MIN, maxWalk);
  const list = ranked.map((r) => ({ ...r.item.j, label: r.label }));
  const reasons = reasonsOf(list);
  ranked.forEach((r, i) => {
    if (r.label !== 'short') expect(reasons[i], r.item.j.id).toBe(reasonText(r.label, r.item.j, r.ref?.j));
  });
  return ranked.map((r, i) => [r.item.j.id, r.label, plain(reasons[i])]);
}

/** Toutes les raisons affichées : une ligne des lunettes, typographie française, jamais de tiret long. */
function checkLine(s: string): void {
  expect(s).not.toMatch(/[–—]/);
  expect(s).not.toMatch(/ :/);
  expect(s).not.toMatch(/\d (min|h)\b/);
  expect(s.length, s).toBeLessThanOrEqual(60);
  expect(textWidth(s), s).toBeLessThanOrEqual(542);
}

describe('raisons (PRD-1.2 § 1.3, règles de la 1.1)', () => {
  it('changements, marches, écarts', () => {
    expect([changesText(0), changesText(1), changesText(3)]).toEqual(['direct', '1 changement', '3 changements']);
    expect(walksText([7, 12])).toBe(`à pied 7 + 12${NB}min`);
    expect(walksText([2, 1, 1])).toBe(`à pied 2 + 1 + 1${NB}min`);
    expect(walksText([2, 1, 1, 4])).toBe(`8${NB}min à pied`);
    expect(walksText([])).toBe('');
    expect([laterText(60), laterText(12), laterText(120), laterText(90)]).toEqual([`1${NB}h plus tard`, `12${NB}min plus tard`, `2${NB}h plus tard`, `90${NB}min plus tard`]);
    expect([gapText(13), gapText(60), gapText(75), gapText(0)]).toEqual([`13${NB}min`, `1${NB}h`, `75${NB}min`, `1${NB}min`]);
  });

  it('textes exacts de chaque étiquette (sans la proposition 1 : formes de la 1.2)', () => {
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
    for (const s of all) checkLine(s);
    expect(plain(all[0])).toBe('Le plus court : 2 changements, à pied 12 + 13 + 14 min');
    expect(plain(all[7])).toBe('Moins de changements : 1 changement, à pied 12 + 13 + 14 min');
    expect(textWidth(all[7])).toBe(538);
  });
});

describe('CA-121.3 : noms et raisons de la 1.2.1 (§ 2.1 et § 2.2)', () => {
  // cas réel Maison → Mama (§ 1.5), 11/11 19:42, marche maximale 5 min
  const busS1 = J('W+S1', { walks: [6, 1, 9], rides: 2, board: '20:07', arr: '21:11' });
  const icIc = J('IC+IC', { walks: [19, 0, 9], rides: 2, board: '20:08', arr: '20:58' });

  it('proposition 1 : « Moins de marche » quand « Plus tôt » marche plus qu’elle, sinon « Le plus court »', () => {
    const named = (js: Journey[]) => reasonsOf(js).map(plain);
    expect(named([{ ...busS1, label: 'short' }, { ...icIc, label: 'earlier' }])).toEqual(['Moins de marche : 1 changement, à pied 6 + 1 + 9 min', 'Plus tôt de 13 min, mais 19 min à pied']);
    // « Plus tôt » sans plus de marche : la proposition 1 garde « Le plus court »
    const icShort = J('IC', { walks: [2, 0, 3], rides: 2, board: '19:24', arr: '20:58' });
    expect(named([{ ...busS1, label: 'short' }, { ...icShort, label: 'earlier' }])).toEqual(['Le plus court : 1 changement, à pied 6 + 1 + 9 min', 'Plus tôt de 13 min, en partant à 19:22']);
    // seule : « Le plus court » ; marche seule : « Le plus court : à pied, 9 min »
    expect(named([{ ...busS1, label: 'short' }])).toEqual(['Le plus court : 1 changement, à pied 6 + 1 + 9 min']);
    expect(named([{ ...walkOnly('W', '08:00', 9), label: 'short' }])).toEqual(['Le plus court : à pied, 9 min']);
  });

  it('« Plus tôt » : sa plus longue marche ; une marche de 5 min au plus n’est pas « plus de marche » (la nuit, parti bien avant)', () => {
    const direct = J('S1', { walks: [0, 0], rides: 1, board: '06:20', arr: '06:46', next: true });
    const early = J('S19', { walks: [3, 1, 2], rides: 2, board: '05:05', arr: '06:06', next: true });
    expect(reasonsOf([{ ...direct, label: 'short' }, { ...early, label: 'earlier' }]).map(plain)).toEqual(['Le plus court : direct', 'Plus tôt de 40 min, en partant à 05:02']);
    const longer = J('S19b', { walks: [6, 1, 2], rides: 2, board: '05:08', arr: '06:06', next: true });
    expect(reasonsOf([{ ...direct, label: 'short' }, { ...longer, label: 'earlier' }]).map(plain)).toEqual(['Moins de marche : direct', 'Plus tôt de 40 min, mais 6 min à pied']);
    // une heure pleine : « Plus tôt de 1 h »
    const hour = J('H', { walks: [20, 0], rides: 1, board: '19:38', arr: '20:11' });
    expect(plain(reasonText('earlier', hour, busS1))).toBe('Plus tôt de 1 h, mais 20 min à pied');
  });

  it('« Moins de marche » autre que la proposition 1 : « arrive 25 min plus tard », complété des marches si la place le permet', () => {
    const first = J('P1', { walks: [8, 2], rides: 1, board: '08:15', arr: '09:05' });
    const r = (walks: number[]) => plain(reasonText('lesswalk', J('LW', { walks, rides: walks.length - 1, board: '08:10', arr: '09:30' }), first));
    expect(r([3, 0, 4])).toBe('Moins de marche : arrive 25 min plus tard, à pied 3 + 4 min');
    // trop long en détail (66 caractères) : le total ; plus de trois marches : le total aussi
    expect(r([12, 13, 14])).toBe('Moins de marche : arrive 25 min plus tard, 39 min à pied');
    expect(r([3, 2, 4, 1])).toBe('Moins de marche : arrive 25 min plus tard, 10 min à pied');
    expect(r([0, 0])).toBe('Moins de marche : arrive 25 min plus tard');
    const same = J('LW2', { walks: [2, 2], rides: 1, board: '08:20', arr: '09:05' });
    expect(plain(reasonText('lesswalk', same, first))).toBe('Moins de marche : même heure d’arrivée, à pied 2 + 2 min');
  });

  it('toutes les formes de la 1.2.1, valeurs extrêmes : une ligne des lunettes, 60 caractères au plus', () => {
    const first = J('P1', { walks: [12, 13, 14, 0], rides: 3, board: '06:00', arr: '06:30' });
    const lw = J('LW', { walks: [12, 13, 14, 1], rides: 3, board: '06:00', arr: '08:25' });
    const early = J('E', { walks: [25, 0], rides: 1, board: '04:00', arr: '04:45' });
    const earlyLight = J('E2', { walks: [5, 0], rides: 1, board: '04:00', arr: '04:45' });
    const texts = [
      ...reasonsOf([{ ...first, label: 'short' }, { ...early, label: 'earlier' }]),
      ...reasonsOf([{ ...first, label: 'short' }, { ...earlyLight, label: 'earlier' }, { ...lw, label: 'lesswalk' }]),
    ].map((s) => s ?? '');
    for (const s of texts) checkLine(s);
    expect(texts.map(plain)).toEqual([
      'Moins de marche : 2 changements, à pied 12 + 13 + 14 min',
      'Plus tôt de 105 min, mais 25 min à pied',
      'Le plus court : 2 changements, à pied 12 + 13 + 14 min',
      'Plus tôt de 105 min, en partant à 03:55',
      'Moins de marche : arrive 115 min plus tard, 40 min à pied',
    ]);
  });
});

describe('CA-1.1 : cas de référence du PRD 1.1 § 4.6, revus pour la 1.2.1 (le moins de marche d’abord)', () => {
  it('A : à même arrivée, le changement qui garde chaque marche sous 10 min passe avant le direct et ses 12 min à pied', () => {
    const X = J('X', { walks: [7, 12], rides: 1, board: '07:44', arr: '08:58' });
    const Y = J('Y', { walks: [7, 2, 9], rides: 2, board: '07:44', arr: '08:58' });
    expect(propose([Y, X], '07:30')).toEqual([
      ['Y', 'short', 'Le plus court : 1 changement, à pied 7 + 2 + 9 min'],
      ['X', 'none', 'Sans changement : à pied 7 + 12 min'],
    ]);
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

  it('E : la marche seule de 22 min (palier 3) ne passe pas devant ; « À pied : 22 min, arrivée 09:12 »', () => {
    const X = J('X', { walks: [2, 2, 2], rides: 2, board: '08:52', arr: '09:14' });
    const W = walkOnly('W', '08:50', 22);
    expect(propose([W, X], '08:50')).toEqual([
      ['X', 'short', 'Le plus court : 1 changement, à pied 2 + 2 + 2 min'],
      ['W', 'walk', 'À pied : 22 min, arrivée 09:12'],
    ]);
  });

  it('F : le saut de puce qui garde la marche sous 10 min passe d’abord (8 min plus tard) ; l’IC et ses 12 min à pied « Plus tôt »', () => {
    // 1.2 : le changement était écarté (correspondance inutile au profit d'un trajet sans marche longue) ; 1.2.1 :
    // jamais au profit d'un trajet de palier plus haut (§ 1.3), et le palier 0 passe d'abord (§ 1.2). Sur les vraies
    // données, Bruxelles-Chapelle n'est toujours jamais proposé (real.test.ts, CA-M8.1) : le bus 95 fait mieux.
    const X = J('X', { walks: [8, 12], rides: 1, board: '07:44', arr: '09:04', firstTrip: 'IC-0744' });
    const Y = J('Y', { walks: [8, 0, 6], rides: 2, board: '07:44', arr: '09:12', firstTrip: 'IC-0744' });
    expect(propose([Y, X], '07:31')).toEqual([
      ['Y', 'short', 'Moins de marche : 1 changement, à pied 8 + 6 min'],
      ['X', 'earlier', 'Plus tôt de 8 min, mais 12 min à pied'],
    ]);
    // avec 15 min de marche maximale, les deux sont au palier 0 : l'IC direct, la correspondance inutile écartée
    expect(propose([Y, X], '07:31', 15)).toEqual([['X', 'short', 'Le plus court : direct, à pied 8 + 12 min']]);
  });

  it('G (réel, nuit) : S1 06:20 direct ; « Plus tôt » pour le trajet parti plus de 30 min avant, avec son heure de départ', () => {
    const X = J('X', { walks: [0, 0], rides: 1, board: '06:20', arr: '06:46', next: true });
    const Y = J('Y', { walks: [3, 0, 0], rides: 2, board: '05:02', arr: '06:30', next: true });
    expect(propose([X, Y], '23:50')).toEqual([
      ['X', 'short', 'Le plus court : direct'],
      ['Y', 'earlier', 'Plus tôt de 16 min, en partant à 04:59'],
    ]);
  });

  it('H (réel) : bus puis métro d’abord, qu’ils arrivent 12 ou 9 min après les 19 min à pied et le train, « Plus tôt »', () => {
    const Y = J('Y', { walks: [1, 2, 4], rides: 2, board: '07:53', arr: '08:58' });
    for (const [arr, gain] of [['08:46', 12], ['08:49', 9]] as const) {
      const X = J('X', { walks: [19, 5], rides: 1, board: '07:55', arr });
      expect(propose([X, Y], '07:45'), arr).toEqual([
        ['Y', 'short', 'Moins de marche : 1 changement, à pied 1 + 2 + 4 min'],
        ['X', 'earlier', `Plus tôt de ${gain} min, mais 19 min à pied`],
      ]);
    }
  });
});

describe('CA-121.2 : paliers de marche et garde-fou (PRD-1.2.1 § 1.1 à § 1.3)', () => {
  it('palier : 0 jusqu’à la marche maximale, puis un par tranche de 5 min ; marche seule : sa durée', () => {
    expect([0, 5, 6, 10, 11, 15, 16].map((L) => walkTier(L, 5))).toEqual([0, 0, 1, 1, 2, 2, 3]);
    expect([10, 11, 15, 16, 22, 25].map((L) => walkTier(L, 10))).toEqual([0, 1, 1, 2, 3, 3]);
    expect(longestOf(itemOf(J('X', { walks: [6, 1, 9], rides: 2, board: '08:00', arr: '09:00' })))).toBe(9);
    expect(longestOf(itemOf(walkOnly('W', '08:00', 19)))).toBe(19);
    expect(longestOf(itemOf(J('N', { walks: [0, 0], rides: 1, board: '08:00', arr: '09:00' })))).toBe(0);
  });

  it('palier 0 vide (cas réel Maison → Mama, marche 5) : le plus rapide du palier 1, bus W puis S1 ; « Plus tôt » : 19 min à pied', () => {
    const D = J('W+S1', { walks: [6, 1, 9], rides: 2, board: '20:07', arr: '21:11' });
    const B = J('W+92', { walks: [6, 1, 8], rides: 2, board: '19:49', arr: '21:10' });
    const A = J('IC+IC', { walks: [19, 0, 9], rides: 2, board: '20:08', arr: '20:58' });
    const C = J('S1', { walks: [19, 9], rides: 1, board: '20:16', arr: '21:11' });
    expect(propose([A, B, C, D], '19:42', 5)).toEqual([
      ['W+S1', 'short', 'Moins de marche : 1 changement, à pied 6 + 1 + 9 min'],
      ['IC+IC', 'earlier', 'Plus tôt de 13 min, mais 19 min à pied'],
      ['S1', 'none', 'Sans changement : à pied 19 + 9 min'],
    ]);
  });

  it('garde-fou dépassé : le détour du palier 0 (bus 36 par Rixensart, 39 min après le plus tôt) n’est jamais proposé', () => {
    const R = J('36', { walks: [0, 1, 4, 5], rides: 3, board: '13:40', arr: '15:18' });
    const W = J('W+2', { walks: [8, 1, 2], rides: 2, board: '13:49', arr: '14:47' });
    const T = J('IC+2', { walks: [22, 3, 2], rides: 2, board: '14:08', arr: '14:39' });
    expect(propose([R, W, T], '13:30', 5)).toEqual([
      ['W+2', 'short', 'Moins de marche : 1 changement, à pied 8 + 1 + 2 min'],
      ['IC+2', 'earlier', 'Plus tôt de 8 min, mais 22 min à pied'],
    ]);
    // 30 min après le plus tôt, pas plus : le palier 0 passe encore
    const R30 = J('36b', { walks: [0, 1, 4, 5], rides: 3, board: '13:40', arr: '15:09' });
    expect(propose([R30, W, T], '13:30', 5).map((x) => `${x[0]}:${x[1]}`)).toEqual(['36b:short', 'IC+2:earlier', 'W+2:fewer']);
  });

  it('garde-fou, puis « Moins de marche » : le palier plus bas qui arrive au plus 20 min après la proposition 1', () => {
    const T = J('T', { walks: [17, 2], rides: 1, board: '08:20', arr: '08:40' });
    const W = J('W', { walks: [8, 2], rides: 1, board: '08:15', arr: '09:05' });
    const R = J('R', { walks: [3, 0, 4], rides: 2, board: '08:10', arr: '09:15' });
    // R (palier 0) arrive 35 min après T : garde-fou ; W (palier 1) 25 min après : proposition 1. R n'est pas écarté au
    // profit de W, qui le domine (même départ, plus tôt, sans changement) mais marche plus (§ 1.3).
    expect(propose([T, W, R], '08:00', 5)).toEqual([
      ['W', 'short', 'Le plus court : direct, à pied 8 + 2 min'],
      ['T', 'earlier', 'Plus tôt de 25 min, mais 17 min à pied'],
      ['R', 'lesswalk', 'Moins de marche : arrive 10 min plus tard, à pied 3 + 4 min'],
    ]);
    // au-delà de 20 min après la proposition 1 : pas de « Moins de marche »
    const R2 = J('R2', { walks: [3, 0, 4], rides: 2, board: '08:10', arr: '09:26' });
    expect(propose([T, W, R2], '08:00', 5).map((x) => x[1])).toEqual(['short', 'earlier']);
  });

  it('repli : la nuit, aucun palier ne passe le garde-fou : le plus rapide de tous, pas le palier le plus bas', () => {
    const X = J('X', { walks: [8, 0], rides: 1, board: '06:08', arr: '06:40', next: true });
    const Z = J('Z', { walks: [2, 0, 3], rides: 2, board: '06:12', arr: '07:10', next: true });
    const Y = J('Y', { walks: [18, 0], rides: 1, board: '05:18', arr: '06:00', next: true });
    expect(propose([X, Y, Z], '23:50', 5)).toEqual([
      ['X', 'short', 'Moins de marche : direct, à pied 8 min'],
      ['Y', 'earlier', 'Plus tôt de 40 min, mais 18 min à pied'],
      ['Z', 'later', 'Plus tard : 1 changement, départ 06:10'],
    ]);
  });

  it('« Plus tôt » : à même arrivée, le palier le plus bas (réel, Bruxelles → Bruges, marche 5 : 7 min à pied plutôt que 20)', () => {
    const P1 = J('49+IC+30', { walks: [4, 3, 3, 4], rides: 3, board: '20:49', arr: '22:51' });
    const A7 = J('6+IC+30', { walks: [7, 3, 3, 4], rides: 3, board: '20:50', arr: '22:21' });
    const A20 = J('6+IC', { walks: [7, 3, 20], rides: 2, board: '20:50', arr: '22:21' });
    expect(propose([P1, A20, A7], '20:40', 5)).toEqual([
      ['49+IC+30', 'short', 'Moins de marche : 2 changements, 14 min à pied'],
      ['6+IC+30', 'earlier', 'Plus tôt de 30 min, mais 7 min à pied'],
      ['6+IC', 'fewer', 'Moins de changements : 1 changement, à pied 7 + 3 + 20 min'],
    ]);
  });

  it('filtres de la 1.1 : jamais un trajet écarté au profit d’un trajet de palier plus haut', () => {
    // même IC : 16 min à pied à la fin, ou le tram (2 min plus tôt, palier 0) : le tram reste et passe d'abord ; le
    // direct arrive plus tard avec un palier plus haut : pas « Sans changement »
    const longEnd = J('L', { walks: [7, 16], rides: 1, board: '07:42', arr: '09:00', firstTrip: 'IC' });
    const tram = J('T', { walks: [7, 2, 4], rides: 2, board: '07:42', arr: '08:58', firstTrip: 'IC' });
    expect(propose([longEnd, tram], '07:30').map((x) => `${x[0]}:${x[1]}`)).toEqual(['T:short']);
    // dominé sans la règle : part plus tôt, arrive plus tard, sans 5 min de marche en moins ; 15 min à pied (palier 1)
    // font gagner 6 min : « Plus tôt »
    const L2 = J('L2', { walks: [15, 0], rides: 1, board: '08:15', arr: '08:40' });
    const N2 = J('N2', { walks: [6, 0, 5], rides: 2, board: '08:04', arr: '08:46' });
    expect(propose([L2, N2], '07:55')).toEqual([
      ['N2', 'short', 'Moins de marche : 1 changement, à pied 6 + 5 min'],
      ['L2', 'earlier', 'Plus tôt de 6 min, mais 15 min à pied'],
    ]);
  });

  it('invariants (trajets tirés au hasard, marche 5 et 10) : garde-fou, paliers plus bas trop lents, propositions', () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pickInt = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
    const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const seen = { emptyTier0: 0, pushed: 0, lesswalk: 0, earlier: 0, none: 0 };
    for (const M of [5, 10]) {
      for (let n = 0; n < 400; n++) {
        const js: Journey[] = [];
        const count = pickInt(2, 7);
        for (let k = 0; k < count; k++) {
          const rides = pickInt(1, 3);
          const walks = Array.from({ length: rides + 1 }, (_, i) => (i === 0 || i === rides ? pickInt(0, 25) : pickInt(0, 5)));
          const board = 8 * 60 + pickInt(0, 50);
          js.push(J(`J${n}-${k}`, { walks, rides, board: hm(board), arr: hm(board + pickInt(20, 80) + walks[rides]) }));
        }
        if (rnd() < 0.3) js.push(walkOnly(`W${n}`, '08:00', pickInt(11, 35)));
        const items = js.map(itemOf);
        const out = rank(items, t('08:00') / MIN, M);
        const first = out[0].item;
        const tier = (x: (typeof items)[number]) => walkTier(longestOf(x), M);
        // départs de 08:00 à 08:50 : tous dans l'heure demandée ; la marche seule concourt jusqu'à 30 min
        const pool = items.filter((x) => x.rides > 0 || x.walk <= 30);
        const E = Math.min(...pool.map((x) => x.arr));
        const ctx = `marche ${M}, tirage ${n}`;
        expect(first.arr, ctx).toBeLessThanOrEqual(E + 30);
        for (const x of pool) {
          if (tier(x) < tier(first)) expect(x.arr, `${ctx} : palier plus bas trop rapide`).toBeGreaterThan(E + 25);
          if (tier(x) <= tier(first)) expect(x.arr, `${ctx} : même palier ou plus bas, 5 min plus tôt`).toBeGreaterThan(first.arr - 5);
        }
        if (!pool.some((x) => tier(x) === 0)) seen.emptyTier0++;
        if (Math.min(...pool.map(tier)) < tier(first)) seen.pushed++;
        for (const r of out.slice(1)) {
          const x = r.item;
          if (r.label === 'earlier') {
            seen.earlier++;
            expect(x.arr, ctx).toBe(E);
            expect(x.arr, ctx).toBeLessThanOrEqual(first.arr - 5);
            expect(tier(x), ctx).toBeGreaterThan(tier(first));
          } else if (r.label === 'lesswalk') {
            seen.lesswalk++;
            expect(tier(x), ctx).toBeLessThan(tier(first));
            expect(x.arr, ctx).toBeLessThanOrEqual(first.arr + 20);
          } else if (r.label === 'none' || r.label === 'fewer') {
            seen.none++;
            expect(x.transfers, ctx).toBeLessThan(first.transfers);
            expect(x.arr, ctx).toBeLessThanOrEqual(first.arr + 20);
            expect(tier(x) <= tier(first) || x.arr <= first.arr, ctx).toBe(true);
          } else if (r.label === 'walk') {
            expect(x.rides, ctx).toBe(0);
            expect(x.arr, ctx).toBeLessThanOrEqual(first.arr + 5);
          }
        }
      }
    }
    // le tirage passe bien par chaque règle
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(0);
  });
});

describe('règles des propositions (PRD-1.2 § 1.3, PRD-1.2.1 § 1.4)', () => {
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

  it('marche maximale : 12 min à pied, palier 0 avec 15 réglées (le plus rapide d’abord), palier plus haut avec 10 ou 5', () => {
    const X = J('X', { walks: [12, 0], rides: 1, board: '08:20', arr: '08:45' });
    const Y = J('Y', { walks: [2, 0, 3], rides: 2, board: '08:12', arr: '08:50' });
    // avec 15 min réglées, les 12 min sont au palier 0 : X d'abord ; Y part plus tard : « Plus tard »
    expect(propose([X, Y], '08:00', 15).map((x) => `${x[0]}:${x[1]}`)).toEqual(['X:short', 'Y:later']);
    for (const m of [10, 5]) {
      expect(propose([X, Y], '08:00', m), `marche ${m}`).toEqual([
        ['Y', 'short', 'Moins de marche : 1 changement, à pied 2 + 3 min'],
        ['X', 'earlier', 'Plus tôt de 5 min, mais 12 min à pied'],
      ]);
    }
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

  it('« Sans changement » d’un palier plus haut que la proposition 1 : seulement s’il n’arrive pas plus tard', () => {
    // K part avant S (jamais « Plus tard ») ; 12 min à pied : palier 1
    const S = J('S', { walks: [3, 0, 3], rides: 2, board: '07:50', arr: '09:00' });
    expect(propose([S, J('K', { walks: [12, 3], rides: 1, board: '07:58', arr: '09:00' })], '07:45')).toEqual([
      ['S', 'short', 'Le plus court : 1 changement, à pied 3 + 3 min'],
      ['K', 'none', 'Sans changement : à pied 12 + 3 min'],
    ]);
    expect(propose([S, J('K', { walks: [12, 3], rides: 1, board: '07:58', arr: '09:01' })], '07:45').map((x) => x[0])).toEqual(['S']);
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

  it('« Plus tard » : choisi comme la proposition 1 parmi le reste, le moins de marche d’abord (cas réel Maison → Bureau, marche 5)', () => {
    const P1 = J('36+IC+2', { walks: [4, 4, 3, 2], rides: 3, board: '07:49', arr: '08:33' });
    const F = J('IC+2', { walks: [19, 3, 2], rides: 2, board: '08:01', arr: '08:33' });
    const L19 = J('S1+2', { walks: [19, 3, 2], rides: 2, board: '08:06', arr: '08:50' });
    const L4 = J('36+S1+2', { walks: [4, 1, 3, 2], rides: 3, board: '07:54', arr: '08:50' });
    // même arrivée que S1+2 (19 min à pied, palier 3), avec 4 min de marche au plus (palier 0) : 36+S1+2 « Plus tard »
    expect(propose([P1, F, L19, L4], '07:31', 5)).toEqual([
      ['36+IC+2', 'short', 'Le plus court : 2 changements, 13 min à pied'],
      ['IC+2', 'fewer', 'Moins de changements : 1 changement, à pied 19 + 3 + 2 min'],
      ['36+S1+2', 'later', 'Plus tard : 2 changements, départ 07:50'],
    ]);
    // garde-fou dans le reste : parti à 08:21 (aucun trajet ne le devance de 30 min), le palier 0 arrive 35 min après
    // le plus tôt du reste (S1+2, 08:50) : S1+2 « Plus tard »
    const late = J('36+S1+2b', { walks: [4, 1, 3, 2], rides: 3, board: '08:25', arr: '09:25' });
    expect(propose([P1, F, L19, late], '07:31', 5).map((x) => `${x[0]}:${x[1]}`)).toEqual(['36+IC+2:short', 'IC+2:fewer', 'S1+2:later']);
    // à 30 min près, il passe
    const late30 = J('36+S1+2c', { walks: [4, 1, 3, 2], rides: 3, board: '08:25', arr: '09:20' });
    expect(propose([P1, F, L19, late30], '07:31', 5).map((x) => `${x[0]}:${x[1]}`)).toEqual(['36+IC+2:short', 'IC+2:fewer', '36+S1+2c:later']);
  });

  it('marche seule : « Le plus court : à pied, {n} min »', () => {
    expect(propose([walkOnly('W', '08:00', 9)], '08:00')).toEqual([['W', 'short', 'Le plus court : à pied, 9 min']]);
  });
});
