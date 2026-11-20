/**
 * Quai 1.3.1, écrans du guidage (docs/v1.3.1/PRD-1.3.1.md § 15, décision du propriétaire du 20/11 à 21:15) : le nom de
 * l'arrêt ou de la gare où l'on marche, quand il ne tient pas sur sa rangée : le nom entier s'il tient ; sinon son
 * diminutif (« Bruxelles-Central » → « Bxl-Central ») ; sinon la coupe au mot d'avant. Jamais de diminutif quand le nom
 * entier tient. Une seule règle (wholeWalkName), pour « 3 min à pied → … », « ensuite : 7 min à pied → … », « vers
 * l’arrêt … », « jusqu’à … » et « Où tu en es ». Par les vraies vues et la vraie mise en page, au pixel.
 * Lieux publics seulement (gares, arrêts, places).
 */
import { describe, expect, it } from 'vitest';
import type { Journey } from '../../src/core/api';
import type { GuideState, Moment, Then, VehicleRef, WhereAmI } from '../../src/core/guide-types';
import { textWidth } from '../../src/glasses/font';
import { fitName } from '../../src/glasses/format';
import { fitWalkName, guideView, leaveWalkText, thenText, walkToStopText, wholeWalkName, type GuideShow } from '../../src/glasses/guide-views';
import { GUIDE } from '../../src/glasses/layout';
import type { ViewCtx } from '../../src/glasses/views';
import { MIN, PLACES, at, journey, nb, overflowing, page, settingsWith } from './helpers';

const DAY = '2026-11-20';
const T = (hh: number, mm: number) => at(DAY, hh, mm);
const NOW = T(7, 0);
const N = (fr: string) => ({ fr, nl: fr });
const ctx: ViewCtx = { now: NOW, settings: settingsWith([PLACES.bureau]) };

const BUS71: VehicleRef = { op: 'stib', mode: 'bus', line: '71' };
const TRAM3: VehicleRef = { op: 'stib', mode: 'tram', line: '3' };
const IC: VehicleRef = { op: 'sncb', mode: 'train', line: 'IC', cat: 'IC' };

/** À pied jusqu'à un arrêt, bus 71, à pied jusqu'à la gare de Bruxelles-Central, IC, à pied. */
const J: Journey = journey('jdim', [
  { walk: 7, to: 'Flagey' },
  { ride: '71', mode: 'bus', dep: T(7, 12), arr: T(7, 26), from: 'Flagey', to: 'Gare Centrale', head: 'De Brouckère' },
  { walk: 3, to: 'Bruxelles-Central' },
  { ride: 'IC', mode: 'train', dep: T(7, 35), arr: T(7, 40), from: 'Bruxelles-Central', to: 'Bruxelles-Nord' },
  { walk: 4 },
]);

const WHERE: WhereAmI = { title: 'Bureau', arr: T(7, 56), rt: true, chain: [{ label: 'à pied', state: 'now' }, { label: 'bus 71', state: 'next' }, { label: 'IC', state: 'next' }] };
const state = (p: Partial<GuideState> = {}): GuideState => ({ kind: 'trip', journeyId: 'jdim', phase: { kind: 'walk', leg: 0 }, moment: null, where: WHERE, location: 'high', wakeAt: NOW + MIN, ended: false, ...p });

/** Les rangées d'un écran, après contrôle au pixel : rien ne dépasse, jamais de tiret long ni moyen. */
function lines(s: GuideState, show: GuideShow): string[] {
  const p = page(guideView(s, show, J, ctx));
  const bad = overflowing(p);
  if (bad.length) throw new Error(bad.join('\n'));
  for (const l of [p.title, ...p.lines]) expect(l).not.toMatch(/[–—]/);
  return p.lines.map(nb);
}
const moment = (m: Moment): string[] => lines(state({ moment: m }), 'moment');

const base = { since: NOW, until: NOW + 2 * MIN, leg: 0 };
const board = (stop: string, vehicle: VehicleRef, walkMin: number, marginMin: number): Moment => ({
  ...base, leg: 3, id: 'board:jdim:3', kind: 'board', vehicle, head: N('Ostende'), depAt: T(7, 35), rt: true, alight: N('Bruxelles-Nord'), stopsToAlight: 1, stop: N(stop), walkMin, marginMin,
});
const leave = (toward: string, walkMin: number, vehicle: VehicleRef = IC): Moment => ({ ...base, id: 'leave:jdim', kind: 'leave', walkMin, toward: N(toward), vehicle, depAt: T(7, 35), rt: true, marginMin: 4 });
const turn = (toward: string, leg = 0): Moment => ({ ...base, leg, id: `turn:jdim:${leg}:1`, kind: 'turn', turn: 'left', distM: 30, toward: N(toward), final: false });

describe('1.3.1, § 15 : la règle, au pixel près (wholeWalkName, fitWalkName)', () => {
  const head = `ensuite${' '}: 7${' '}min à pied → `;
  const full = `${head}Bruxelles-Luxembourg`;
  const brief = `${head}Bxl-Luxembourg`;

  it('le nom entier s’il tient, au pixel près ; un pixel de moins : son diminutif ; un pixel de moins encore : la coupe au mot d’avant', () => {
    expect(fitWalkName(head, 'Bruxelles-Luxembourg', '', textWidth(full))).toBe(full);
    expect(fitWalkName(head, 'Bruxelles-Luxembourg', '', textWidth(full) - 1)).toBe(brief);
    expect(fitWalkName(head, 'Bruxelles-Luxembourg', '', textWidth(brief))).toBe(brief);
    // ni l'un ni l'autre : la coupe du nom entier, telle que fitName la faisait (« Bruxelles-… »), pas celle du diminutif
    const cut = fitWalkName(head, 'Bruxelles-Luxembourg', '', textWidth(brief) - 1);
    expect(cut).toBe(`${head}Bruxelles-…`);
    expect(cut).toBe(fitName(head, 'Bruxelles-Luxembourg', '', textWidth(brief) - 1));
    expect(wholeWalkName(head, 'Bruxelles-Luxembourg', '', textWidth(brief) - 1)).toBeUndefined();
  });

  it('jamais de diminutif quand le nom entier tient, à toutes les largeurs ; le résultat tient toujours', () => {
    for (const name of ['Bruxelles-Central', 'Bruxelles-Luxembourg', 'Place Sainte-Catherine', 'Boulevard du Jardin Botanique', 'Sint-Katelijne-Waver']) {
      for (const tail of ['', ', très juste', ', marge 4 min']) {
        const whole = textWidth(`${head}${name}${tail}`);
        for (let w = 150; w <= GUIDE.FULL_W; w++) {
          const t = fitWalkName(head, name, tail, w);
          if (w >= whole) expect(t, `${name} ${w}`).toBe(`${head}${name}${tail}`);
          else expect(t, `${name} ${w}`).not.toContain(name);
          if (!t.endsWith('…')) expect(textWidth(t), `${t} ${w}`).toBeLessThanOrEqual(w);
        }
      }
    }
  });

  it('un nom sans diminutif : la coupe au mot, comme avant, à toutes les largeurs', () => {
    for (const name of ['Liège-Guillemins', 'Monument Gramme', 'Ottignies-Louvain-la-Neuve']) {
      for (let w = 150; w <= GUIDE.FULL_W; w += 3) expect(fitWalkName(head, name, ', 07:20', w), `${name} ${w}`).toBe(fitName(head, name, ', 07:20', w));
      expect(wholeWalkName(head, name, '', textWidth(`${head}${name}`) - 1)).toBeUndefined();
    }
  });
});

describe('1.3.1, § 15 : « monter » d’une correspondance, « 3 min à pied → … »', () => {
  it('l’exemple du propriétaire : « 3 min à pied → Bxl-Central, marge 4 min » au lieu de « Bruxelles-… »', () => {
    // à côté de l'image : 374 px ; le nom entier demande 402 px
    expect(textWidth(`3${' '}min à pied → Bruxelles-Central, marge 4${' '}min`)).toBeGreaterThan(GUIDE.TEXT_W);
    expect(moment(board('Bruxelles-Central', IC, 3, 4))).toEqual(['IC à 07:35', 'vers Ostende', '3 min à pied → Bxl-Central, marge 4 min', 'toucher : masquer   appui long : arrêter']);
    expect(moment(board('Bruxelles-Central', IC, 3, 0))[2]).toBe('3 min à pied → Bxl-Central, très juste');
  });

  it('nom entier qui tient : inchangé ; nom sans diminutif trop long : coupé au mot ; diminutif encore trop long : la coupe du nom entier', () => {
    expect(moment(board('Gare du Nord', TRAM3, 2, 0))[2]).toBe('2 min à pied → Gare du Nord, très juste');
    expect(moment(board('Namur', IC, 3, 4))[2]).toBe('3 min à pied → Namur, marge 4 min');
    expect(moment(board('Liège-Guillemins', IC, 3, 8))[2]).toBe('3 min à pied → Liège-…, marge 8 min');
    expect(moment(board('Bruxelles-Luxembourg', IC, 4, 4))[2]).toBe('4 min à pied → Bruxelles-…, marge 4 min');
    // sans place pour un mot du nom : « jusqu’au quai », « jusqu’à l’arrêt », comme avant
    expect(nb(walkToStopText(3, 'Bruxelles-Central', true, ', marge 4 min', 200))).toBe('3 min à pied jusqu’au quai, marge 4 min');
  });
});

describe('1.3.1, § 15 : « Partir maintenant », la marche après la descente, « ensuite », le virage, « Où tu en es »', () => {
  it('« jusqu’à … » : « 12 min à pied jusqu’à Bxl-Luxembourg » ; le nom entier sans « la gare de » passe avant le diminutif', () => {
    expect(moment(leave('Bruxelles-Luxembourg', 12))[1]).toBe('12 min à pied jusqu’à Bxl-Luxembourg');
    // « 9 min à pied jusqu’à la gare de Bruxelles-Central » ne tient pas (423 px), le nom entier seul oui : pas de diminutif
    expect(moment(leave('Bruxelles-Central', 9))[1]).toBe('9 min à pied jusqu’à Bruxelles-Central');
    expect(moment(leave('Flagey', 7, BUS71))[1]).toBe('7 min à pied jusqu’à l’arrêt Flagey');
    expect(moment(leave('Place Sainte-Catherine', 5, BUS71))[1]).toBe('5 min à pied jusqu’à Pl. Ste-Catherine');
    // la marche après une descente (B17) : la même règle
    const walk: Moment = { ...base, leg: 2, id: 'walk:jdim:2', kind: 'walk', walkMin: 12, toward: N('Bruxelles-Luxembourg'), final: false, vehicle: IC, depAt: T(7, 35), rt: true };
    expect(moment(walk).slice(0, 2)).toEqual(['12 min à pied jusqu’à Bxl-Luxembourg', 'IC à 07:35']);
    expect(nb(leaveWalkText(12, 'Liège-Guillemins', 'station', 'Bureau', 300))).toBe('12 min à pied jusqu’à Liège-…');
  });

  it('« ensuite : 7 min à pied → … » : entier, diminutif, coupe au mot', () => {
    const then: Then = { kind: 'ride', vehicle: IC, depAt: T(7, 35), rt: true, walkMin: 7, from: N('Bruxelles-Luxembourg') };
    const t = (w: number) => nb(thenText(then, ctx, w));
    expect(t(GUIDE.FULL_W)).toBe('ensuite : 7 min à pied → Bruxelles-Luxembourg');
    expect(t(GUIDE.TEXT_W)).toBe('ensuite : 7 min à pied → Bxl-Luxembourg');
    expect(t(352)).toBe('ensuite : 7 min à pied → Bruxelles-…');
    // sur l'écran « Descends » (toute la largeur) : le nom entier
    const alight: Moment = { ...base, leg: 1, id: 'alight:jdim:1', kind: 'alight', stop: N('Gare Centrale'), at: T(7, 26), rt: true, then };
    expect(moment(alight)[2]).toBe('ensuite : 7 min à pied → Bruxelles-Luxembourg');
  });

  it('virage sans rue : « vers l’arrêt Pl. de la Vieille Halle aux Blés » ; un nom qui tient reste entier', () => {
    expect(textWidth('vers l’arrêt Place de la Vieille Halle aux Blés')).toBeGreaterThan(GUIDE.TEXT_W);
    expect(moment(turn('Place de la Vieille Halle aux Blés'))).toEqual(['À gauche dans 30 m', 'vers l’arrêt Pl. de la Vieille Halle aux Blés', 'toucher : masquer   appui long : arrêter']);
    expect(moment(turn('Flagey'))[1]).toBe('vers l’arrêt Flagey');
    expect(moment(turn('Boulevard du Jardin Botanique'))[1]).toBe('vers l’arrêt Boulevard du Jardin Botanique');
    // vers une gare sans voie connue (marche de correspondance, rang 2) : son nom entier tient
    expect(moment(turn('Bruxelles-Central', 2))[1]).toBe('vers la gare de Bruxelles-Central');
    // une rue connue passe toujours avant
    expect(moment({ ...turn('Place de la Vieille Halle aux Blés'), street: 'Rue du Chêne' } as Moment)[1]).toBe('Rue du Chêne');
  });

  it('« Où tu en es » à pied : le nom entier tient sur toute la largeur, jamais de diminutif ; avant de partir : la même règle', () => {
    const walking = (toward: string, toKind: 'stop' | 'station', vehicle: VehicleRef): GuideState =>
      state({ where: { ...WHERE, walk: { toward: N(toward), toKind, remainingM: 520, remainingMin: 7, vehicle, depAt: T(7, 35), rt: true, marginMin: 3 } } });
    expect(lines(walking('Bruxelles-Luxembourg', 'station', IC), 'where')).toContain('À pied vers la gare de Bruxelles-Luxembourg');
    expect(lines(walking('Place de la Vieille Halle aux Blés', 'stop', BUS71), 'where')).toContain('À pied vers l’arrêt Place de la Vieille Halle aux Blés');
    expect(lines(walking('Flagey', 'stop', BUS71), 'where')).toContain('À pied vers l’arrêt Flagey');
    const before = lines(state({ phase: { kind: 'before', leg: 0 }, where: { ...WHERE, walk: { toward: N('Bruxelles-Luxembourg'), toKind: 'station', remainingMin: 12, vehicle: IC, depAt: T(7, 35), rt: true } } }), 'where');
    expect(before).toContain('12 min à pied jusqu’à la gare de Bruxelles-Luxembourg');
    expect(before.join(' ')).not.toContain('Bxl');
  });
});
