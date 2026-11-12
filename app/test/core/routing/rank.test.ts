/**
 * Classement des trajets (PRD-1.2.2 § 7 : le premier arrive le plus tôt, chaque minute de marche au-delà de la marche
 * maximale compte triple ; design-routing.md § 4.8) : coût et proposition 1 (jamais dominée, jamais une marche absurde,
 * dont des trajets tirés au hasard), cas de référence A à H du PRD 1.1 § 4.6 revus, cas réels du PRD-1.2.1 § 1.5, autres
 * propositions et gardes ; noms et raisons (CA-121.3, PRD-1.2.1 § 2 : une ligne des lunettes, 60 caractères et 542 px
 * au plus), inchangés.
 */
import { describe, expect, it } from 'vitest';
import type { Journey, JourneyLabel, Leg } from '../../../src/core/api';
import { P } from '../../../src/core/routing/params';
import { costOf, itemOf, longestOf, rank, walkTier } from '../../../src/core/routing/rank';
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
  // cas réel Braine-l’Alleud → Schaerbeek (§ 1.5), 11/11 19:42, marche maximale 5 min
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

/** Même structure (« Le suivant ») : mêmes lignes et mêmes zones de montée et de descente. */
function sameStructure(js: Journey[], line = 'L'): Journey[] {
  for (const j of js) {
    let i = 0;
    for (const l of j.legs) {
      if (l.kind !== 'ride') continue;
      l.line = `${line}${i}`;
      l.from.areaId = `${line}-z${i}`;
      l.to.areaId = `${line}-a${i}`;
      i++;
    }
  }
  return js;
}

describe('PRD-1.2.2 § 7 : coût et proposition 1', () => {
  it('palier de marche de la 1.2.1, gardé pour le faux cœur : 0 jusqu’à la marche maximale, puis un par tranche de 5 min', () => {
    expect([0, 5, 6, 10, 11, 15, 16].map((L) => walkTier(L, 5))).toEqual([0, 0, 1, 1, 2, 2, 3]);
    expect(longestOf(itemOf(J('X', { walks: [6, 1, 9], rides: 2, board: '08:00', arr: '09:00' })))).toBe(9);
    expect(longestOf(itemOf(walkOnly('W', '08:00', 19)))).toBe(19);
  });

  it('coût = arrivée + 3 × (plus longue marche au-delà de la marche maximale) + 1 × changements ; marche seule : sa durée', () => {
    const x = itemOf(J('X', { walks: [8, 1, 3], rides: 2, board: '20:07', arr: '21:05' }));
    expect(costOf(x, 5) - x.arr).toBe(3 * 3 + 1);
    expect(costOf(x, 8) - x.arr).toBe(1);
    expect(costOf(x, 10) - x.arr).toBe(1);
    const w = itemOf(walkOnly('W', '08:00', 22));
    expect(costOf(w, 5) - w.arr).toBe(3 * 17);
    expect([P.walkPenalty, P.transferPenalty]).toEqual([3, 1]);
    // garantie « jamais de marche absurde » : 6 min au-delà de la marche maximale coûtent plus que 15 min de retard et
    // deux changements
    expect(6 * P.walkPenalty).toBeGreaterThan(15 + 2 * P.transferPenalty);
  });

  it('à coût égal : le moins de changements, puis la plus courte plus longue marche, la marche totale, le départ le plus tard', () => {
    // 1 changement et 09:00, ou direct et 09:01 : même coût, le direct
    const chg = J('CHG', { walks: [2, 0, 2], rides: 2, board: '08:30', arr: '09:00' });
    const dir = J('DIR', { walks: [2, 2], rides: 1, board: '08:30', arr: '09:01' });
    expect(propose([chg, dir], '08:20', 5)[0][0]).toBe('DIR');
    // même arrivée, direct, chaque marche dans la marche maximale : 3 min au plus plutôt que 5
    const long = J('L5', { walks: [5, 0], rides: 1, board: '08:30', arr: '09:00' });
    const short = J('L3', { walks: [2, 3], rides: 1, board: '08:31', arr: '09:00' });
    expect(propose([long, short], '08:20', 5)[0][0]).toBe('L3');
    // même plus longue marche : la marche totale la plus courte
    const two = J('T6', { walks: [3, 3], rides: 1, board: '08:30', arr: '09:00' });
    const one = J('T3', { walks: [3, 0], rides: 1, board: '08:30', arr: '09:00' });
    expect(propose([two, one], '08:20', 5)[0][0]).toBe('T3');
    // tout égal : le départ le plus tard
    const early = J('E', { walks: [3, 3], rides: 1, board: '08:30', arr: '09:00' });
    const late = J('LT', { walks: [3, 3], rides: 1, board: '08:35', arr: '09:00' });
    expect(propose([early, late], '08:20', 5)[0][0]).toBe('LT');
  });

  it('à arrivée, marches et changements égaux, le départ le plus tard, même après l’heure demandée (jamais 52 min d’attente pour le même IC)', () => {
    const early = J('T3-1609', { walks: [9, 1, 7], rides: 2, board: '16:09', arr: '18:16' });
    const late = J('T3-1657', { walks: [9, 1, 7], rides: 2, board: '16:57', arr: '18:16' });
    // demandé à 15:00 : seul le premier part dans l'heure ; le second, parti à 16:48, lui prend sa place
    expect(propose([early, late], '15:00')).toEqual([['T3-1657', 'short', 'Le plus court : 1 changement, à pied 9 + 1 + 7 min']]);
    // un trajet qui marche moins ne cède jamais sa place à un trajet parti plus tard qui marche plus
    const longer = J('T3-1657b', { walks: [10, 1, 7], rides: 2, board: '16:57', arr: '18:16' });
    expect(propose([early, longer], '15:00', 5).map((x) => x[0])).toEqual(['T3-1609']);
  });

  it('le plus tôt d’abord tant que chaque marche tient dans la marche maximale ; au-delà, chaque minute compte triple', () => {
    // 3 min plus tôt avec 9 min à pied (marche maximale 10) : en tête ; avec 5 min réglées, 4 min de trop comptent 12 min
    const X = J('X', { walks: [2, 0, 3], rides: 2, board: '08:05', arr: '09:00' });
    const Y = J('Y', { walks: [9, 0, 6], rides: 2, board: '08:05', arr: '08:57' });
    // X part 7 min plus tard et arrive 3 min plus tard : « Plus tard »
    expect(propose([Y, X], '08:00', 10)).toEqual([
      ['Y', 'short', 'Le plus court : 1 changement, à pied 9 + 6 min'],
      ['X', 'later', 'Plus tard : 1 changement, départ 08:03'],
    ]);
    // 3 min plus tôt ne font pas un « Plus tôt » (5 min au moins)
    expect(propose([Y, X], '08:00', 5)).toEqual([['X', 'short', 'Le plus court : 1 changement, à pied 2 + 3 min']]);
  });

  it('jamais une proposition 1 dominée, jamais une marche absurde (trajets tirés au hasard, marche 5 et 10)', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pickInt = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
    const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    let absurdTested = 0;
    for (const M of [5, 10]) {
      for (let n = 0; n < 300; n++) {
        const js: Journey[] = [];
        for (let k = 0, count = pickInt(2, 8); k < count; k++) {
          const rides = pickInt(1, 3);
          const walks = Array.from({ length: rides + 1 }, (_, i) => (i === 0 || i === rides ? pickInt(0, 25) : pickInt(0, 7)));
          const board = 8 * 60 + pickInt(0, 50);
          js.push(J(`J${n}-${k}`, { walks, rides, board: hm(board), arr: hm(board + pickInt(15, 80) + walks[rides]) }));
        }
        if (rnd() < 0.3) js.push(walkOnly(`W${n}`, '08:00', pickInt(6, 30)));
        const items = js.map(itemOf);
        const first = rank(items, t('08:00') / MIN, M)[0].item;
        const lw = longestOf(first);
        const ctx = `marche ${M}, tirage ${n}`;
        for (const x of items) {
          expect(costOf(first, M), ctx).toBeLessThanOrEqual(costOf(x, M) + 1e-9);
          const better = x.arr <= first.arr && longestOf(x) <= lw && x.transfers <= first.transfers;
          expect(better && (x.arr < first.arr || longestOf(x) < lw || x.transfers < first.transfers), `${ctx} : proposition 1 dominée par ${x.id}`).toBe(false);
          // marche absurde : plus de M + 5 min à pied alors qu'un trajet sans marche de plus de M arrive au plus 15 min après
          if (lw > M + 5 && longestOf(x) <= M) {
            absurdTested++;
            expect(x.arr, `${ctx} : marche absurde`).toBeGreaterThan(first.arr + 15);
          }
        }
      }
    }
    expect(absurdTested).toBeGreaterThan(0);
  });
});

describe('PRD-1.2.2 § 7 : cas de référence (PRD 1.1 § 4.6, revus pour la 1.2.2)', () => {
  it('A : même arrivée, le changement qui garde chaque marche dans les 10 min passe devant le direct et ses 12 min à pied ; le direct n’est pas « Sans changement » (il marche plus au-delà de la marche maximale)', () => {
    const X = J('X', { walks: [7, 12], rides: 1, board: '07:44', arr: '08:58' });
    const Y = J('Y', { walks: [7, 2, 9], rides: 2, board: '07:44', arr: '08:58' });
    expect(propose([Y, X], '07:30')).toEqual([['Y', 'short', 'Le plus court : 1 changement, à pied 7 + 2 + 9 min']]);
    // 15 min réglées : 12 min à pied sont dans la marche maximale, le direct passe devant (1 min par changement)
    expect(propose([Y, X], '07:30', 15)).toEqual([['X', 'short', 'Le plus court : direct, à pied 7 + 12 min']]);
  });

  it('B : 1 changement 12 min plus tôt d’abord, puis le direct « Sans changement » (au plus 15 min après)', () => {
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

  it('E : la marche seule de 22 min, 2 min plus tôt : jamais proposée ; 8 min plus tôt : « Plus tôt »', () => {
    const X = J('X', { walks: [2, 2, 2], rides: 2, board: '08:52', arr: '09:14' });
    const W = walkOnly('W', '08:50', 22);
    expect(propose([W, X], '08:50')).toEqual([['X', 'short', 'Le plus court : 1 changement, à pied 2 + 2 + 2 min']]);
    const slow = J('S', { walks: [2, 2, 2], rides: 2, board: '08:58', arr: '09:20' });
    expect(propose([W, slow], '08:50')).toEqual([
      ['S', 'short', 'Moins de marche : 1 changement, à pied 2 + 2 + 2 min'],
      ['W', 'earlier', 'Plus tôt de 8 min, mais 22 min à pied'],
    ]);
  });

  it('F : le même IC, direct puis 12 min à pied, ou un saut de puce : 2 min de trop (6 min) contre 8 min plus tôt', () => {
    const X = J('X', { walks: [8, 12], rides: 1, board: '07:44', arr: '09:04', firstTrip: 'IC-0744' });
    const Y = J('Y', { walks: [8, 0, 6], rides: 2, board: '07:44', arr: '09:12', firstTrip: 'IC-0744' });
    // marche maximale 10 : l'IC direct d'abord, le saut de puce « Moins de marche »
    expect(propose([Y, X], '07:31')).toEqual([
      ['X', 'short', 'Le plus court : direct, à pied 8 + 12 min'],
      ['Y', 'lesswalk', 'Moins de marche : arrive 8 min plus tard, à pied 8 + 6 min'],
    ]);
    // marche maximale 5 : 7 min de trop comptent 21 min, le saut de puce d'abord, l'IC « Plus tôt »
    expect(propose([Y, X], '07:31', 5)).toEqual([
      ['Y', 'short', 'Moins de marche : 1 changement, à pied 8 + 6 min'],
      ['X', 'earlier', 'Plus tôt de 8 min, mais 12 min à pied'],
    ]);
    // marche maximale 15 : rien de trop, l'IC direct seul
    expect(propose([Y, X], '07:31', 15)).toEqual([['X', 'short', 'Le plus court : direct, à pied 8 + 12 min']]);
  });

  it('G (nuit) : le trajet qui arrive le plus tôt d’abord, même parti plus tôt ; le S1 direct de 06:20 « Plus tard »', () => {
    const X = J('X', { walks: [0, 0], rides: 1, board: '06:20', arr: '06:46', next: true });
    const Y = J('Y', { walks: [3, 0, 0], rides: 2, board: '05:02', arr: '06:30', next: true });
    expect(propose([X, Y], '23:50')).toEqual([
      ['Y', 'short', 'Le plus court : 1 changement, à pied 3 min'],
      ['X', 'later', 'Plus tard : direct, départ 06:20'],
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

describe('PRD-1.2.2 § 7 : cas réels du PRD-1.2.1 § 1.5 (marche maximale 5 min, valeurs de l’instantané du 11/11)', () => {
  it('A, Braine-l’Alleud → Schaerbeek, 11/11 19:42 : bus W puis S1 ; les 22 min à pied et les deux IC seulement en « Plus tôt »', () => {
    const WS1 = J('W+S1', { walks: [8, 1, 3], rides: 2, board: '20:07', arr: '21:05' });
    const ICIC = J('IC+IC', { walks: [22, 0, 3], rides: 2, board: '20:08', arr: '20:52' });
    const S1 = J('S1', { walks: [22, 3], rides: 1, board: '20:16', arr: '21:05' });
    expect(propose([ICIC, S1, WS1], '19:42', 5)).toEqual([
      ['W+S1', 'short', 'Moins de marche : 1 changement, à pied 8 + 1 + 3 min'],
      ['IC+IC', 'earlier', 'Plus tôt de 13 min, mais 22 min à pied'],
    ]);
  });

  it('B, Braine-l’Alleud → Madou, 12/11 07:31 : bus 36, IC 08:01, métro 2 ; l’IC après 22 min à pied jamais « Moins de changements »', () => {
    const P1 = J('36+IC+2', { walks: [0, 4, 3, 0], rides: 3, board: '07:49', arr: '08:31' });
    const F = J('IC+2', { walks: [22, 3, 0], rides: 2, board: '08:01', arr: '08:31' });
    const L22 = J('S1+2', { walks: [22, 3, 0], rides: 2, board: '08:06', arr: '08:48' });
    const L4 = J('36+S1+2', { walks: [0, 1, 3, 0], rides: 3, board: '07:54', arr: '08:48' });
    expect(propose([P1, F, L22, L4], '07:31', 5)).toEqual([
      ['36+IC+2', 'short', 'Le plus court : 2 changements, à pied 4 + 3 min'],
      ['36+S1+2', 'later', 'Plus tard : 2 changements, départ 07:54'],
    ]);
  });

  it('C, Braine-l’Alleud → Madou, 11/11 13:30 : bus W, métro 2 ; « Plus tôt » : 22 min à pied et l’IC ; jamais le bus 36 vers Rixensart', () => {
    const W2 = J('W+2', { walks: [8, 1, 0], rides: 2, board: '13:49', arr: '14:45' });
    const IC2 = J('IC+2', { walks: [22, 3, 0], rides: 2, board: '14:08', arr: '14:37' });
    const R = J('36', { walks: [0, 1, 4, 5], rides: 3, board: '13:40', arr: '15:18' });
    expect(propose([R, W2, IC2], '13:30', 5)).toEqual([
      ['W+2', 'short', 'Moins de marche : 1 changement, à pied 8 + 1 min'],
      ['IC+2', 'earlier', 'Plus tôt de 8 min, mais 22 min à pied'],
    ]);
    // même 9 min plus tôt, le détour garde son coût : jamais proposé
    const R2 = J('36b', { walks: [0, 1, 4, 5], rides: 3, board: '13:40', arr: '15:09' });
    expect(propose([R2, W2, IC2], '13:30', 5).map((x) => x[0])).toEqual(['W+2', 'IC+2']);
  });
});

describe('PRD-1.2.2 § 7 : autres propositions', () => {
  it('« Plus tôt » : l’arrivée la plus tôt, au moins 5 min avant la proposition 1 ; « Moins de marche » au plus 20 min après', () => {
    const T = J('T', { walks: [17, 2], rides: 1, board: '08:20', arr: '08:40' });
    const W = J('W', { walks: [8, 2], rides: 1, board: '08:15', arr: '09:05' });
    const R = J('R', { walks: [3, 0, 4], rides: 2, board: '08:10', arr: '09:15' });
    expect(propose([T, W, R], '08:00', 5)).toEqual([
      ['W', 'short', 'Le plus court : direct, à pied 8 + 2 min'],
      ['T', 'earlier', 'Plus tôt de 25 min, mais 17 min à pied'],
      ['R', 'lesswalk', 'Moins de marche : arrive 10 min plus tard, à pied 3 + 4 min'],
    ]);
    // au-delà de 20 min après : pas de « Moins de marche »
    const R2 = J('R2', { walks: [3, 0, 4], rides: 2, board: '08:10', arr: '09:26' });
    expect(propose([T, W, R2], '08:00', 5).map((x) => x[1])).toEqual(['short', 'earlier']);
  });

  it('« Moins de marche » : seulement si la proposition 1 dépasse la marche maximale, et dans la marche maximale ou 5 min de moins', () => {
    const P1 = J('P', { walks: [12, 0], rides: 1, board: '08:20', arr: '08:45' });
    const Y = J('Y', { walks: [2, 0, 3], rides: 2, board: '08:12', arr: '08:50' });
    // marche maximale 10 : 2 min de trop (6 min) contre 5 min et un changement : égalité, le direct ; Y « Moins de marche »
    expect(propose([P1, Y], '08:00', 10)).toEqual([
      ['P', 'short', 'Le plus court : direct, à pied 12 min'],
      ['Y', 'lesswalk', 'Moins de marche : arrive 5 min plus tard, à pied 2 + 3 min'],
    ]);
    // marche maximale 15 : la proposition 1 n'en dépasse pas, Y part plus tard : « Plus tard »
    expect(propose([P1, Y], '08:00', 15).map((x) => `${x[0]}:${x[1]}`)).toEqual(['P:short', 'Y:later']);
    // marche maximale 5 : Y d'abord, l'IC 5 min plus tôt avec 12 min à pied « Plus tôt »
    expect(propose([P1, Y], '08:00', 5)).toEqual([
      ['Y', 'short', 'Moins de marche : 1 changement, à pied 2 + 3 min'],
      ['P', 'earlier', 'Plus tôt de 5 min, mais 12 min à pied'],
    ]);
    // ni dans la marche maximale ni 5 min de moins : pas de « Moins de marche »
    const Z = J('Z', { walks: [9, 0, 3], rides: 2, board: '08:12', arr: '08:58' });
    const Q = J('Q', { walks: [12, 0], rides: 1, board: '08:20', arr: '08:40' });
    expect(propose([Q, Z], '08:00', 5).map((x) => x[1])).toEqual(['short']);
  });

  it('« Sans changement », « Moins de changements » : au plus 15 min après, jamais plus de marche au-delà de la marche maximale', () => {
    const S = J('S', { walks: [3, 0, 0, 3], rides: 3, board: '07:50', arr: '10:00' });
    expect(propose([S, J('L', { walks: [3, 3], rides: 1, board: '07:50', arr: '10:16' })], '07:45').map((x) => x[0])).toEqual(['S']);
    expect(propose([S, J('K', { walks: [3, 3], rides: 1, board: '07:50', arr: '10:15' })], '07:45')).toEqual([
      ['S', 'short', 'Le plus court : 2 changements, à pied 3 + 3 min'],
      ['K', 'none', 'Sans changement : à pied 3 + 3 min'],
    ]);
    expect(propose([S, J('F', { walks: [3, 0, 3], rides: 2, board: '07:50', arr: '10:10' })], '07:45')[1]).toEqual(['F', 'fewer', 'Moins de changements : 1 changement, à pied 3 + 3 min']);
    // même arrivée, 11 min à pied (1 min de trop) : jamais « Sans changement » d'une proposition 1 qui n'en a pas
    const T = J('T', { walks: [3, 0, 3], rides: 2, board: '07:50', arr: '09:00' });
    expect(propose([T, J('K2', { walks: [11, 3], rides: 1, board: '07:58', arr: '09:00' })], '07:45').map((x) => x[0])).toEqual(['T']);
    // plusieurs : le meilleur coût
    const D1 = J('D1', { walks: [3, 3], rides: 1, board: '07:50', arr: '10:12' });
    const D2 = J('D2', { walks: [3, 0, 3], rides: 2, board: '07:50', arr: '10:05' });
    expect(propose([S, D1, D2], '07:45')[1]).toEqual(['D2', 'fewer', 'Moins de changements : 1 changement, à pied 3 + 3 min']);
  });

  it('une correspondance qui fait gagner 3 min sur le même premier train : proposée (1 min par changement), le direct « Sans changement »', () => {
    const direct = J('D', { walks: [0, 0], rides: 1, board: '08:25', arr: '09:24', firstTrip: 'IC-0825' });
    const via = J('V', { walks: [0, 0, 0], rides: 2, board: '08:25', arr: '09:21', firstTrip: 'IC-0825' });
    expect(propose([direct, via], '08:00')).toEqual([
      ['V', 'short', 'Le plus court : 1 changement'],
      ['D', 'none', 'Sans changement : arrivée 09:24'],
    ]);
    // 1 min seulement : même coût, le direct
    const via1 = J('V1', { walks: [0, 0, 0], rides: 2, board: '08:25', arr: '09:23', firstTrip: 'IC-0825' });
    expect(propose([direct, via1], '08:00').map((x) => x[0])).toEqual(['D']);
  });

  it('deux autres propositions au plus avec un gain, dans l’ordre Plus tôt, Moins de marche, Sans changement', () => {
    const P1 = J('P', { walks: [8, 0, 2], rides: 2, board: '08:15', arr: '09:00' });
    const E = J('E', { walks: [20, 0], rides: 1, board: '08:25', arr: '08:40' });
    const LW = J('LW', { walks: [3, 0, 3], rides: 2, board: '08:20', arr: '09:12' });
    const N = J('N', { walks: [4, 4], rides: 1, board: '08:20', arr: '09:12' });
    // trois candidats avec un gain : Plus tôt, puis Moins de marche ; « Sans changement » ne passe pas
    expect(propose([P1, E, LW, N], '08:00', 5).map((x) => `${x[0]}:${x[1]}`)).toEqual(['P:short', 'E:earlier', 'LW:lesswalk']);
    // sans « Plus tôt » : Moins de marche, puis Sans changement
    expect(propose([P1, LW, N], '08:00', 5).map((x) => `${x[0]}:${x[1]}`)).toEqual(['P:short', 'LW:lesswalk', 'N:none']);
  });

  it('« Le suivant » : même structure, départ suivant, une seule fois ; le départ d’après complète la liste en « Plus tard », dans l’ordre des départs ; jamais deux fois le même trajet', () => {
    const js = sameStructure([0, 1, 2, 3, 4].map((k) => J(`S${k}`, { walks: [3, 4], rides: 1, board: `08:${String(5 + 10 * k).padStart(2, '0')}`, arr: `08:${String(30 + 10 * k).padStart(2, '0')}` })));
    const out = propose([...js, js[0]], '08:00');
    expect(out.map((x) => x[0])).toEqual(['S0', 'S1', 'S2']);
    expect(out.map((x) => x[1])).toEqual(['short', 'next', 'later']);
    expect(out[1][2]).toBe('Le suivant : même trajet, 10 min plus tard');
    expect(out[2][2]).toBe('Plus tard : direct, départ 08:22');
  });

  it('« Plus tard » part et arrive après « Le suivant » (revue d’usage : jamais « Plus tard 08:33 → 09:57 » avant « Le suivant 08:33 → 10:02 »)', () => {
    const [P1, next] = sameStructure([
      J('IC+T3', { walks: [7, 2, 9], rides: 2, board: '07:42', arr: '08:58' }),
      J('IC+T3b', { walks: [7, 2, 9], rides: 2, board: '08:42', arr: '10:02' }),
    ]);
    const X = J('IC+T4', { walks: [7, 1, 10], rides: 2, board: '08:42', arr: '09:57' });
    const Y = J('S+B', { walks: [3, 0, 3], rides: 2, board: '09:05', arr: '10:20' });
    expect(propose([P1, next, X], '07:31')).toEqual([
      ['IC+T3', 'short', 'Le plus court : 1 changement, à pied 7 + 2 + 9 min'],
      ['IC+T3b', 'next', 'Le suivant : même trajet, 1 h plus tard'],
    ]);
    expect(propose([P1, next, X, Y], '07:31')).toEqual([
      ['IC+T3', 'short', 'Le plus court : 1 changement, à pied 7 + 2 + 9 min'],
      ['IC+T3b', 'next', 'Le suivant : même trajet, 1 h plus tard'],
      ['S+B', 'later', 'Plus tard : 1 changement, départ 09:02'],
    ]);
  });

  it('garde : aucune proposition dominée par un candidat, même non affiché ; « Le suivant » cède sa place au trajet qui le domine (scénario 1 : l’IC 08:42 puis le T4)', () => {
    const [P1, next] = sameStructure([
      J('IC+T3', { walks: [7, 2, 9], rides: 2, board: '07:42', arr: '08:58' }),
      J('IC+T3b', { walks: [7, 2, 9], rides: 2, board: '08:42', arr: '10:02' }),
    ]);
    // même départ, mêmes marches, même changement, arrivée 5 min plus tôt : il domine l'IC 08:42 puis le T3
    const X = J('IC+T4', { walks: [7, 2, 9], rides: 2, board: '08:42', arr: '09:57' });
    expect(propose([P1, next, X], '07:31')).toEqual([
      ['IC+T3', 'short', 'Le plus court : 1 changement, à pied 7 + 2 + 9 min'],
      ['IC+T4', 'next', 'Le suivant : 1 h plus tard'],
    ]);
    // il marche 1 min de plus : il ne domine pas, « Le suivant » reste le même trajet
    const X2 = J('IC+T4', { walks: [7, 1, 10], rides: 2, board: '08:42', arr: '09:57' });
    expect(propose([P1, next, X2], '07:31').map((x) => `${x[0]}:${x[1]}`)).toEqual(['IC+T3:short', 'IC+T3b:next']);
  });

  it('garde : un autre rôle aussi (« Sans changement » : à arrivée, plus longue marche et changements égaux, le départ le plus tard, même avec plus de marche totale)', () => {
    const P1 = J('P', { walks: [2, 0, 2], rides: 2, board: '08:05', arr: '08:45' });
    const F = J('F', { walks: [2, 1], rides: 1, board: '08:10', arr: '08:55' });
    const G = J('G', { walks: [2, 2], rides: 1, board: '08:12', arr: '08:55' });
    expect(propose([P1, F, G], '08:00', 5).map((x) => `${x[0]}:${x[1]}`)).toEqual(['P:short', 'G:none']);
  });

  it('« Plus tard » : le meilleur coût parmi les trajets partis et arrivés après ; jamais devancé de plus de 30 min par un trajet parti au plus 30 min avant', () => {
    const a = J('A', { walks: [3, 3], rides: 1, board: '08:05', arr: '08:40' });
    const b = J('B', { walks: [3, 0, 3], rides: 2, board: '08:20', arr: '08:55' });
    expect(propose([a, b], '08:00')).toEqual([
      ['A', 'short', 'Le plus court : direct, à pied 3 + 3 min'],
      ['B', 'later', 'Plus tard : 1 changement, départ 08:17'],
    ]);
    const slow = J('Z', { walks: [3, 0, 3], rides: 2, board: '08:20', arr: '09:15' });
    expect(propose([a, slow], '08:00').map((x) => x[0])).toEqual(['A']);
  });

  it('gardes : aucune proposition dominée par une autre, jamais deux fois la même suite de lignes (sauf « Le suivant »)', () => {
    // « Plus tard » dominé par « Sans changement » (parti plus tard, arrivé plus tôt, direct, moins de marche) : le
    // suivant au coût le remplace
    const P1 = J('P', { walks: [2, 0, 2], rides: 2, board: '08:05', arr: '08:45' });
    const F = J('F', { walks: [2, 2], rides: 1, board: '08:15', arr: '08:55' });
    const L = J('L', { walks: [3, 0, 3], rides: 2, board: '08:12', arr: '09:05' });
    const L2 = J('L2', { walks: [2, 0, 2], rides: 2, board: '08:40', arr: '09:20' });
    expect(propose([P1, F, L, L2], '08:00', 5)).toEqual([
      ['P', 'short', 'Le plus court : 1 changement, à pied 2 + 2 min'],
      ['F', 'none', 'Sans changement : à pied 2 + 2 min'],
      ['L2', 'later', 'Plus tard : 1 changement, départ 08:38'],
    ]);
    // même ligne que la proposition 1, montée plus loin pour arriver plus tôt : pas « Plus tôt » (même suite de lignes) ;
    // une autre ligne 7 min plus tôt l'est
    const A = J('A', { walks: [2, 2], rides: 1, board: '08:10', arr: '08:40', line: 'L' });
    const E = J('E', { walks: [15, 2], rides: 1, board: '08:05', arr: '08:30', line: 'L' });
    const E2 = J('E2', { walks: [12, 0], rides: 1, board: '08:10', arr: '08:33', line: 'K' });
    expect(propose([A, E], '08:00', 5)).toEqual([['A', 'short', 'Le plus court : direct, à pied 2 + 2 min']]);
    expect(propose([A, E, E2], '08:00', 5)).toEqual([
      ['A', 'short', 'Moins de marche : direct, à pied 2 + 2 min'],
      ['E2', 'earlier', 'Plus tôt de 7 min, mais 12 min à pied'],
    ]);
  });

  it('marche seule : proposition 1 si elle coûte le moins, sinon seulement « Plus tôt » (5 min au moins), jamais d’autre étiquette', () => {
    expect(propose([walkOnly('W', '08:00', 9)], '08:00')).toEqual([['W', 'short', 'Le plus court : à pied, 9 min']]);
    // 12 min à pied (2 de trop, marche 10) contre un bus 8 min plus tard : à pied d'abord, le bus « Moins de marche »
    const bus = J('B', { walks: [1, 2], rides: 1, board: '08:05', arr: '08:20' });
    expect(propose([walkOnly('W', '08:00', 12), bus], '08:00')).toEqual([
      ['W', 'short', 'Le plus court : à pied, 12 min'],
      ['B', 'lesswalk', 'Moins de marche : arrive 8 min plus tard, à pied 1 + 2 min'],
    ]);
    // t45, t47 du banc : la marche seule arrive après la proposition 1, ou moins de 5 min avant : jamais proposée
    const tram = J('T', { walks: [5, 3], rides: 1, board: '08:06', arr: '08:14' });
    expect(propose([walkOnly('W', '08:00', 18), tram], '08:00').map((x) => x[0])).toEqual(['T']);
    const late = J('T2', { walks: [3, 3], rides: 1, board: '08:05', arr: '08:22' });
    expect(propose([walkOnly('W', '08:00', 19), late], '08:00', 5).map((x) => x[0])).toEqual(['T2']);
  });

  it('invariants (trajets tirés au hasard, marche 5 et 10) : chaque étiquette tient sa promesse, gardes de l’ensemble affiché', () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pickInt = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
    const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const seen: Record<string, number> = { earlier: 0, lesswalk: 0, none: 0, fewer: 0, next: 0, later: 0, walkFirst: 0, walkEarlier: 0, nextOther: 0 };
    for (const M of [5, 10]) {
      for (let n = 0; n < 400; n++) {
        const js: Journey[] = [];
        const count = pickInt(2, 9);
        for (let k = 0; k < count; k++) {
          const rides = pickInt(1, 3);
          const walks = Array.from({ length: rides + 1 }, (_, i) => (i === 0 || i === rides ? pickInt(0, 25) : pickInt(0, 5)));
          const board = 8 * 60 + pickInt(0, 50);
          js.push(J(`J${n}-${k}`, { walks, rides, board: hm(board), arr: hm(board + pickInt(20, 80) + walks[rides]), line: rnd() < 0.2 ? 'L' : undefined }));
        }
        // départs suivants d'une même structure
        if (rnd() < 0.4) {
          const rides = pickInt(1, 2);
          const walks = Array.from({ length: rides + 1 }, () => pickInt(0, 6));
          const b0 = 8 * 60 + pickInt(0, 20);
          const d = pickInt(30, 60);
          js.push(...sameStructure([0, 1, 2].map((i) => J(`S${n}-${i}`, { walks, rides, board: hm(b0 + 20 * i), arr: hm(b0 + 20 * i + d) })), `S${n}`));
        }
        if (rnd() < 0.3) js.push(walkOnly(`W${n}`, '08:00', pickInt(6, 35)));
        const items = js.map(itemOf);
        const out = rank(items, t('08:00') / MIN, M);
        const first = out[0].item;
        const ctx = `marche ${M}, tirage ${n}`;
        const lw = (x: (typeof items)[number]) => longestOf(x);
        const over = (x: (typeof items)[number]) => Math.max(0, lw(x) - M);
        /** x domine y : départ plus tard ou égal, arrivée, plus longue marche et changements pas pires, l'un meilleur. */
        const dominates = (x: (typeof items)[number], y: (typeof items)[number]) =>
          x.dep >= y.dep && x.arr <= y.arr && lw(x) <= lw(y) && x.transfers <= y.transfers && (x.dep > y.dep || x.arr < y.arr || lw(x) < lw(y) || x.transfers < y.transfers);
        expect(out.length, ctx).toBeLessThanOrEqual(3);
        expect(out[0].label, ctx).toBe('short');
        if (first.rides === 0) seen.walkFirst++;
        const gains = out.filter((r) => ['earlier', 'lesswalk', 'none', 'fewer'].includes(r.label));
        expect(gains.length, ctx).toBeLessThanOrEqual(2);
        const seq: (typeof items)[number][] = [first];
        let cur = first;
        out.slice(1).forEach((r) => {
          const x = r.item;
          seen[r.label]++;
          expect(r.label, ctx).not.toBe('walk');
          if (x.rides === 0) {
            expect(r.label, `${ctx} : marche seule`).toBe('earlier');
            seen.walkEarlier++;
          }
          if (r.label === 'earlier') expect(x.arr, ctx).toBeLessThanOrEqual(first.arr - 5);
          if (r.label === 'lesswalk') {
            expect(lw(first), ctx).toBeGreaterThan(M);
            expect(x.arr, ctx).toBeLessThanOrEqual(first.arr + 20);
            expect(lw(x) <= M || lw(x) <= lw(first) - 5, ctx).toBe(true);
          }
          if (r.label === 'none' || r.label === 'fewer') {
            expect(x.transfers, ctx).toBeLessThan(first.transfers);
            expect(r.label === 'none', ctx).toBe(x.transfers === 0);
            expect(x.arr, ctx).toBeLessThanOrEqual(first.arr + 15);
            expect(over(x), ctx).toBeLessThanOrEqual(over(first));
          }
          if (r.label === 'next') {
            // même structure que la proposition 1, sinon un trajet qui domine un départ suivant de cette structure
            if (x.structure !== first.structure) {
              expect(items.some((y) => y.structure === first.structure && y.dep > cur.dep && dominates(x, y)), `${ctx} : « Le suivant » remplacé`).toBe(true);
              seen.nextOther++;
            }
            expect(x.dep, ctx).toBeGreaterThan(cur.dep);
            cur = x;
          }
          if (r.label === 'next' || r.label === 'later') {
            for (const s of seq) {
              expect(x.dep, `${ctx} : ${r.label} part après`).toBeGreaterThan(s.dep);
              expect(x.arr, `${ctx} : ${r.label} arrive après`).toBeGreaterThan(s.arr);
            }
            seq.push(x);
          }
        });
        // gardes : aucune proposition dominée par un candidat, affiché ou non (PRD-1.2.2 § 7.4) ; pas deux fois la même
        // suite de lignes (sauf Le suivant)
        for (const a of out) {
          const by = items.find((y) => dominates(y, a.item));
          expect(by?.id, `${ctx} : ${a.label} ${a.item.id} dominé`).toBeUndefined();
        }
        // « Le suivant » une seule fois ; les départs suivants de même structure (ou le trajet qui en domine un) qui
        // complètent la liste sont « Plus tard » et, comme lui, peuvent partager ses lignes
        expect(out.filter((r) => r.label === 'next').length, ctx).toBeLessThanOrEqual(1);
        const fromNext = (r: (typeof out)[number]) =>
          r.label === 'next' || (r.label === 'later' && items.some((y) => y.structure === first.structure && (y === r.item || dominates(r.item, y))));
        for (const a of out)
          for (const b of out) {
            if (a === b) continue;
            const x = a.item;
            const y = b.item;
            if (!fromNext(a) && !fromNext(b)) expect(x.lines === y.lines && x.rides > 0, `${ctx} : mêmes lignes`).toBe(false);
          }
      }
    }
    // le tirage passe par chaque règle
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(0);
  });
});
