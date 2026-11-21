/**
 * Quai 1.3.1 (docs/v1.3.1/PRD-1.3.1.md § 4 et § 12, B14) : l'écran du trajet nomme l'arrêt où l'on marche
 * (« 16:40  à pied 7 min → Flagey », correspondance « à pied 2 min → Gare du Midi »), la dernière marche porte l'heure
 * d'arrivée à droite, pâle ; l'accordéon des favoris nomme l'arrêt où monter (« à pied 7 min → Flagey ») et garde le
 * premier véhicule et son heure sur la 2e ligne, puis les changements s'ils tiennent. Lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { Favorite, FavoriteAnswer, Journey, Leg } from '../../src/core/api';
import { shortName } from '../../src/core/typo';
import { textWidth } from '../../src/glasses/font';
import { EXPAND_PX, favoriteDetail } from '../../src/glasses/format';
import { layoutPage, WIDTHS } from '../../src/glasses/layout';
import type { GlassesView, PageSpec } from '../../src/glasses/types';
import { favoritesView, stepsPage, type FavoriteEntry, type ViewCtx } from '../../src/glasses/views';
import { newTally, pageCuts, tally } from '../scan/cuts';
import { MIN, PLACES, at, container, journey, lines, nb, overflowing, page, settingsWith } from './helpers';

const DAY = '2026-11-20';
const NOW = at(DAY, 16, 33);
const T = (hh: number, mm: number) => at(DAY, hh, mm);
const S = settingsWith([PLACES.bureau]);
const ctx = (patch: Partial<ViewCtx> = {}): ViewCtx => ({ now: NOW, settings: S, ...patch });
const route = { title: 'Vers le bureau', label: '' };
/** Les rangées des étapes (sans la ligne du haut, la ligne du bas, la ligne d'action ni les aides). */
const rows = (j: Journey, c: ViewCtx = ctx()) =>
  lines(stepsPage(route, { journeys: [j], index: 0, fresh: true }, c))
    .slice(1)
    .filter((l) => !/^(Fin du trajet|▽ |▶ |△▽ )/.test(l));
const rain = (j: Journey, k: number): Journey => ({ ...j, legs: j.legs.map((l, i) => (i === k ? { ...l, rain: true } : l)) });

/** 7 min à pied jusqu'à Flagey, bus 71, 2 min à pied jusqu'à la gare, IC voie 3, 9 min à pied jusqu'au bureau. */
const J = journey('j', [
  { walk: 7, to: 'Flagey' },
  { ride: '71', mode: 'bus', dep: T(16, 47), arr: T(17, 0), from: 'Flagey', to: 'Gare Centrale', head: 'Delta' },
  { walk: 2, to: 'Bruxelles-Central' },
  { ride: 'IC', mode: 'train', dep: T(17, 10), arr: T(17, 52), from: 'Bruxelles-Central', to: 'Namur', head: 'Namur', platform: '3' },
  { walk: 9 },
]);

describe('PRD-1.3.1 § 4 : écran du trajet, le nom de l’arrêt où l’on marche', () => {
  it('« 16:40  à pied 7 min → Flagey » ; correspondance : le nom de l’arrêt du véhicule suivant ; dernière marche inchangée', () => {
    expect(rows(J)).toEqual([
      '16:40 à pied 7 min → Flagey',
      '16:47 Bus 71 → Gare Centrale   17:00',
      // le nom de la gare du véhicule suivant, même s'il ressemble à l'arrêt précédent
      '17:00 à pied 2 min → Bruxelles-Central',
      '17:10 IC voie 3 → Namur   17:52',
      // 1.3.1 (B14) : la dernière marche, vers la destination : son texte ne change pas, l'heure d'arrivée à droite
      '17:52 à pied 9 min   18:01',
    ]);
  });

  it('le nom est coupé au mot, jamais « , pluie » ; tout tient au pixel', () => {
    const long = journey('l', [
      { walk: 6, to: 'Braine-l’Alleud Place Communale Rue de la Station' },
      { ride: '36', mode: 'bus', dep: T(16, 46), arr: T(17, 5), from: 'Braine-l’Alleud Place Communale Rue de la Station', to: 'Waterloo Eglise' },
      { walk: 3 },
    ]);
    const r = rows(rain(long, 0));
    expect(r[0]).toMatch(/^16:40 à pied 6 min → Braine-l’Alleud Place.*…, pluie$/);
    // jamais au milieu d'un mot : ce qui précède « … » est un mot entier du nom
    const cut = r[0].replace(/^16:40 à pied 6 min → /, '').replace(/…, pluie$/, '');
    expect('Braine-l’Alleud Place Communale Rue de la Station'.startsWith(cut)).toBe(true);
    expect(['', ' '].includes('Braine-l’Alleud Place Communale Rue de la Station'.charAt(cut.length))).toBe(true);
    // la pluie sur une marche vers l'arrêt : après le nom, comme « , dernier » après la destination d'un véhicule
    expect(rows(rain(J, 0))[0]).toBe('16:40 à pied 7 min → Flagey, pluie');
  });

  it('B14 : la dernière marche porte l’heure d’arrivée à droite, pâle (« , pluie » compris) ; un trajet à pied seul aussi', () => {
    const last = rows(rain(J, 4));
    expect(last.at(-1)).toBe('17:52 à pied 9 min, pluie   18:01');
    const walk: Journey = { ...journey('w', [{ walk: 23 }]), dep: T(16, 35), arr: T(16, 58), leaveAt: T(16, 35) };
    walk.legs = walk.legs.map((l) => ({ ...l, dep: T(16, 35), arr: T(16, 58), schedDep: T(16, 35), schedArr: T(16, 58) }));
    expect(rows(walk)).toEqual(['16:35 à pied 23 min   16:58']);
    // pâle : l'heure est dans la colonne b (niveau 2), pas dans la colonne de droite au plus clair
    const p = page(stepsPage(route, { journeys: [J], index: 0, fresh: true }, ctx()));
    const colB = container(p, 'colB').content.split('\n').map(nb);
    const colC = container(p, 'colC').content.split('\n').map(nb);
    const k = p.lines.findIndex((l) => nb(l).startsWith('17:52 à pied 9 min'));
    expect(k).toBeGreaterThan(0);
    expect(colB[k - 1]).toMatch(/à pied 9 min +18:01$/);
    expect((colC[k - 1] ?? '').trim()).toBe('');
  });

  it('un trajet qui commence à bord ne change pas ; une marche entre deux marches mène au véhicule qui suit', () => {
    const aboard = journey('a', [{ ride: 'IC', mode: 'train', dep: T(16, 50), arr: T(17, 30), from: 'Namur', to: 'Bruxelles-Central', platform: '2' }, { walk: 4 }]);
    expect(rows(aboard)).toEqual(['16:50 IC voie 2 → Bruxelles-Central   17:30', 'depuis Namur', '17:30 à pied 4 min   17:34']);
    const two = journey('t', [{ walk: 3, to: 'Place Flagey' }, { walk: 2, to: 'Flagey' }, { ride: '71', mode: 'bus', dep: T(16, 45), arr: T(17, 0), from: 'Flagey', to: 'Gare Centrale' }]);
    expect(rows(two).slice(0, 2)).toEqual(['16:40 à pied 3 min → Flagey', '16:43 à pied 2 min → Flagey']);
  });
});

/* ------------------------------ Accordéon des favoris ------------------------------ */

const ok = (fav: Favorite, j: Journey, p: Partial<FavoriteAnswer> = {}): FavoriteAnswer => ({ favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [j] }, updatedAt: NOW, ...p });
const texts = (a: FavoriteAnswer, maxPx = EXPAND_PX) => favoriteDetail(a, NOW, S, maxPx).map((l) => nb(l.text));
const firstRide = (j: Journey, p: Partial<Leg>): Journey => {
  const k = j.legs.findIndex((x) => x.kind === 'ride');
  return { ...j, legs: j.legs.map((l, i) => (i === k ? { ...l, ...p } : l)) };
};
/** 7 min à pied jusqu'à Flagey, bus W (horaire prévu), puis métro 2. */
const W = firstRide(
  journey('w', [
    { walk: 7, to: 'Flagey' },
    { ride: 'W', mode: 'bus', dep: T(16, 49), arr: T(17, 5), from: 'Flagey', to: 'Gare du Midi' },
    { walk: 2, to: 'Gare du Midi' },
    { ride: '2', mode: 'metro', dep: T(17, 10), arr: T(17, 20), from: 'Gare du Midi', to: 'Simonis' },
    { walk: 4 },
  ]),
  { rt: false },
);

describe('PRD-1.3.1 § 4 : accordéon des favoris', () => {
  it('1re ligne « à pied 7 min → Flagey » ; 2e ligne « bus W ~16:49, 1 changement : métro 2 », le « ~ » noté', () => {
    expect(texts(ok(PLACES.bureau, W))).toEqual(['à pied 7 min → Flagey', 'bus W ~16:49, 1 changement : métro 2']);
    const [first, second] = favoriteDetail(ok(PLACES.bureau, W), NOW, S);
    expect(first.planned).toBeUndefined();
    expect(second.planned).toBe(true);
  });

  it('les changements tombent s’ils ne tiennent pas : « bus W ~16:49, 1 changement », sinon « bus W ~16:49 »', () => {
    const full = 'bus W ~16:49, 1 changement : métro 2';
    const count = 'bus W ~16:49, 1 changement';
    expect(texts(ok(PLACES.bureau, W), textWidth(full) - 1)[1]).toBe(count);
    expect(texts(ok(PLACES.bureau, W), textWidth(count) - 1)[1]).toBe('bus W ~16:49');
    // direct : « , direct » s'il tient
    const direct = journey('d', [{ walk: 7, to: 'Flagey' }, { ride: 'W', mode: 'bus', dep: T(16, 49), arr: T(17, 5), from: 'Flagey', to: 'Gare du Midi' }, { walk: 3 }]);
    expect(texts(ok(PLACES.bureau, direct))).toEqual(['à pied 7 min → Flagey', 'bus W 16:49, direct']);
  });

  it('un train : sa voie ; supprimé « IC 16:49 supprimé » ; voie modifiée « IC 16:49 +2 voie 6 au lieu de 4 » ; alerte après le véhicule', () => {
    const ic = journey('ic', [{ walk: 5, to: 'Bruxelles-Central' }, { ride: 'IC', mode: 'train', dep: T(16, 49), arr: T(17, 30), from: 'Bruxelles-Central', to: 'Namur', platform: '4' }, { walk: 3 }]);
    expect(texts(ok(PLACES.bureau, ic))).toEqual(['à pied 5 min → Bruxelles-Central', 'IC 16:49 voie 4, direct']);
    expect(texts(ok(PLACES.bureau, firstRide(ic, { cancelled: true })))[1]).toBe('IC 16:49 supprimé, direct');
    expect(texts(ok(PLACES.bureau, firstRide(ic, { newPlatform: '6', delayMin: 2 })))[1]).toBe('IC 16:49 +2 voie 6 au lieu de 4, direct');
    expect(texts(ok(PLACES.bureau, firstRide(ic, { platform: undefined, newPlatform: '6' })))[1]).toBe('IC 16:49 voie 6 !, direct');
    const works = { ...ic, alerts: [{ kind: 'works' as const, text: 'Travaux : ligne 161', at: NOW }] };
    // après le véhicule, un mot de Quai prend la minuscule (contrôle du sujet, remarque 3)
    expect(texts(ok(PLACES.bureau, works))[1]).toBe('IC 16:49 voie 4, travaux : ligne 161, direct');
    // le véhicule et son heure ne sont jamais coupés : l'alerte l'est, au mot, après eux
    const long = { ...ic, alerts: [{ kind: 'works' as const, text: 'Travaux entre Bruxelles-Central et Namur : bus de remplacement entre les gares', at: NOW }] };
    const second = texts(ok(PLACES.bureau, long))[1];
    expect(second.startsWith('IC 16:49 voie 4, travaux entre')).toBe(true);
    expect(second.endsWith('…')).toBe(true);
    expect(textWidth(second)).toBeLessThanOrEqual(EXPAND_PX);
  });

  it('un souci après le véhicule : un mot de Quai en minuscule, un texte qui commence par un nom des données tel quel', () => {
    const ic = journey('ic', [{ walk: 5, to: 'Bruxelles-Central' }, { ride: 'IC', mode: 'train', dep: T(16, 49), arr: T(17, 30), from: 'Bruxelles-Central', to: 'Namur', platform: '4' }, { walk: 3 }]);
    const second = (kind: 'works' | 'platform' | 'cancel', text: string) => texts(ok(PLACES.bureau, { ...ic, alerts: [{ kind, text, at: NOW }] }))[1];
    expect(second('platform', '! Voie modifiée : le métro 2 part de la voie 2')).toBe('IC 16:49 voie 4, voie modifiée : le métro 2 part de la voie 2');
    expect(second('cancel', '! Bus SNCB 17:40 supprimé')).toBe('IC 16:49 voie 4, bus SNCB 17:40 supprimé, direct');
    expect(second('works', 'Grève : service réduit')).toBe('IC 16:49 voie 4, grève : service réduit, direct');
    expect(second('works', 'Événement à Namur')).toBe('IC 16:49 voie 4, événement à Namur, direct');
    // un texte de l'opérateur ou un code de ligne en tête : jamais touché
    expect(second('works', 'Ligne 51 déviée rue de Fer')).toBe('IC 16:49 voie 4, Ligne 51 déviée rue de Fer, direct');
    expect(second('cancel', '! IC 17:40 supprimé')).toBe('IC 16:49 voie 4, IC 17:40 supprimé, direct');
    expect(second('works', 'Travaillons ensemble')).toBe('IC 16:49 voie 4, Travaillons ensemble, direct');
    // en tête de la 2e ligne (gare hors de portée à pied, règle de la 1.3.0) : la majuscule reste
    const station = journey('g', [{ ride: 'IC', mode: 'train', dep: T(17, 42), arr: T(18, 12), from: 'Bruxelles-Central', to: 'Gand-Saint-Pierre', platform: '4' }]);
    expect(texts(ok(PLACES.bureau, { ...station, alerts: [{ kind: 'works', text: 'Travaux : ligne 50', at: NOW }] }, { fromStation: true }))[1]).toBe('Travaux : ligne 50, direct');
  });

  it('un trajet qui part de l’arrêt : « depuis Flagey » ; à pied seulement et gare hors de portée : comme en 1.3.0', () => {
    const fromStop = journey('s', [{ ride: 'W', mode: 'bus', dep: T(16, 49), arr: T(17, 5), from: 'Flagey', to: 'Gare du Midi' }, { walk: 3 }]);
    expect(texts(ok(PLACES.bureau, fromStop))).toEqual(['depuis Flagey', 'bus W 16:49, direct']);
    const walk = { ...journey('a', [{ walk: 23 }]), dep: NOW, arr: NOW + 23 * MIN };
    expect(texts(ok(PLACES.bureau, walk))).toEqual(['à pied 23 min']);
    const station = journey('g', [{ ride: 'IC', mode: 'train', dep: T(17, 42), arr: T(18, 12), from: 'Bruxelles-Central', to: 'Gand-Saint-Pierre', platform: '4' }]);
    expect(texts(ok(PLACES.bureau, station, { fromStation: true }))).toEqual(['IC voie 4 à 17:42, à Bruxelles-Central', 'direct']);
  });

  it('un nom long coupé au mot ; « Favoris » : la rangée ouverte tient au pixel', () => {
    const long = journey('n', [
      { walk: 8, to: 'Bruxelles-Schuman Rond-Point Robert Schuman Quartier Européen' },
      { ride: 'IC', mode: 'train', dep: T(16, 50), arr: T(17, 30), from: 'Bruxelles-Schuman Rond-Point Robert Schuman Quartier Européen', to: 'Namur', platform: '1' },
    ]);
    const [first] = texts(ok(PLACES.bureau, long));
    expect(first).toMatch(/^à pied 8 min → Bruxelles-Schuman .*…$/);
    expect(textWidth(first)).toBeLessThanOrEqual(WIDTHS.expand);
    const entries: FavoriteEntry[] = [{ fav: PLACES.bureau, answer: ok(PLACES.bureau, long) }];
    const v = favoritesView({ entries }, ctx());
    const l = lines(v, 0);
    expect(l[1]).toBe(first);
    expect(layoutPage(v, { sel: 0, top: 0 }).lines.map(nb)[2]).toBe('IC 16:50 voie 1, direct');
  });
});

/* ------------------------------ Contrôle qualité du sujet ------------------------------ */

describe('PRD-1.3.1 § 4 et § 7 : contrôle qualité de l’écran du trajet et de l’accordéon', () => {
  it('une apostrophe droite des données s’affiche « ’ » dans le nom de l’arrêt où l’on marche (écran du trajet, accordéon)', () => {
    const ic = { ride: 'IC', mode: 'train' as const, dep: T(16, 46), arr: T(17, 20), from: "Braine-l'Alleud", to: 'Bruxelles-Central', platform: '3' };
    const walking = journey('q', [{ walk: 6, to: "Braine-l'Alleud" }, ic, { walk: 3 }]);
    expect(rows(walking)[0]).toBe('16:40 à pied 6 min → Braine-l’Alleud');
    expect(texts(ok(PLACES.bureau, walking))[0]).toBe('à pied 6 min → Braine-l’Alleud');
    // un trajet qui part de la gare, et une gare hors de portée à pied (règle de la 1.3.0) : le nom aussi
    const there = journey('d', [ic]);
    expect(texts(ok(PLACES.bureau, there))[0]).toBe('depuis Braine-l’Alleud');
    expect(texts(ok(PLACES.bureau, there, { fromStation: true }))[0]).toBe('IC voie 3 à 16:46, à Braine-l’Alleud');
  });

  it('balayage au pixel : la mise en page ne recoupe jamais une marche (nom coupé au mot par la vue, « , pluie » entier)', () => {
    const words = 'Bruxelles-Schuman Rond-Point Robert Schuman Quartier Européen Berlaymont Loi'.split(' ');
    let cut = 0;
    for (let k = 1; k <= words.length; k++) {
      for (let min = 5; min <= 29; min++) {
        const stop = words.slice(0, k).join(' ');
        const j = rain(journey('b', [{ walk: min, to: stop }, { ride: '71', mode: 'bus', dep: T(17, 5), arr: T(17, 20), from: stop, to: 'Gare Centrale' }, { walk: 2 }]), 0);
        const said = nb(stepsPage(route, { journeys: [j], index: 0, fresh: true }, ctx()).items[0].segs![1].t);
        const row = rows(j)[0];
        // ce que la vue a coupé au mot est exactement ce que l'écran montre (une marge trop large d'un pixel : la mise
        // en page recoupe la rangée et « , pluie » disparaît)
        expect(row, `${min} min, « ${stop} »`).toBe(`${row.slice(0, 5)} ${said}`);
        expect(said.endsWith(', pluie'), said).toBe(true);
        if (said.includes('…')) cut++;
      }
    }
    // le balayage passe bien par des noms coupés
    expect(cut).toBeGreaterThan(20);
  });
});

/* ------------------------------ § 15 : le diminutif d'un nom trop long ------------------------------ */

describe('PRD-1.3.1 § 15 : nom de l’arrêt où l’on marche : entier s’il tient, sinon son diminutif, sinon coupé au mot', () => {
  /** Place du texte d'une marche de l'écran du trajet (WALK_ROW_PX de views.ts : 542 − 70 − 10 − 2). */
  const WALK_PX = 460;
  const bus = (stop: string) => ({ ride: '71', mode: 'bus' as const, dep: T(17, 5), arr: T(17, 20), from: stop, to: 'Gare Centrale' });
  const walkTo = (stop: string, min = 7) => journey('s', [{ walk: min, to: stop }, bus(stop), { walk: 2 }]);
  const CARREFOUR = 'Bruxelles-Central Carrefour de l’Europe';
  const GRAINS = 'Sainte-Catherine Place du Vieux Marché aux Grains';
  const EINSTEIN = 'Louvain-la-Neuve Université Parc Scientifique Einstein';
  const SCHUMAN = 'Bruxelles-Schuman Rond-Point Robert Schuman';
  const MONTGOMERY = 'Boulevard Saint-Michel Avenue de Tervueren Square Montgomery';

  it('écran du trajet : le nom entier qui tient reste entier (jamais « Bxl-Central » quand « Bruxelles-Central » tient)', () => {
    expect(textWidth('à pied 7 min → Bruxelles-Central')).toBeLessThanOrEqual(WALK_PX);
    expect(rows(walkTo('Bruxelles-Central'))[0]).toBe('16:58 à pied 7 min → Bruxelles-Central');
    expect(rows(rain(walkTo('Bruxelles-Central'), 0))[0]).toBe('16:58 à pied 7 min → Bruxelles-Central, pluie');
    expect(rows(J)[2]).toBe('17:00 à pied 2 min → Bruxelles-Central');
  });

  it('écran du trajet : trop long de 13 px, le diminutif tient : « à pied 7 min → Bxl-Central Carrefour de l’Europe », sans « … »', () => {
    expect(textWidth(`à pied 7 min → ${CARREFOUR}`)).toBe(473);
    expect(textWidth('à pied 7 min → Bxl-Central Carrefour de l’Europe')).toBe(419);
    const j = walkTo(CARREFOUR);
    expect(rows(j)[0]).toBe('16:58 à pied 7 min → Bxl-Central Carrefour de l’Europe');
    // au pixel : rien ne dépasse, et la mise en page montre exactement ce que la vue a écrit
    const v = stepsPage(route, { journeys: [j], index: 0, fresh: true }, ctx());
    expect(overflowing(layoutPage(v, { sel: 0, top: 0 }))).toEqual([]);
    expect(nb(v.items[0].segs![1].t)).toBe('à pied 7 min → Bxl-Central Carrefour de l’Europe');
    // le véhicule qui suit garde ses règles (son arrêt de descente n'est pas un arrêt où l'on marche)
    expect(rows(j)[1]).toMatch(/^17:05 Bus 71 → Gare Centrale/);
  });

  it('écran du trajet : le diminutif ne tient pas non plus (« , pluie » compris) : la coupe au mot du nom entier, comme avant', () => {
    // avec « , pluie », même le diminutif dépasse : nom entier coupé au mot, « , pluie » entier
    expect(textWidth('à pied 7 min → Bxl-Central Carrefour de l’Europe, pluie')).toBeGreaterThan(WALK_PX);
    expect(rows(rain(walkTo(CARREFOUR), 0))[0]).toBe('16:58 à pied 7 min → Bruxelles-Central Carrefour…, pluie');
    // un diminutif lui-même trop long : jamais « Ste-… » coupé, le nom entier coupé au mot
    expect(textWidth('à pied 7 min → Ste-Catherine Pl. du Vieux Marché aux Grains')).toBeGreaterThan(WALK_PX);
    expect(rows(walkTo(GRAINS))[0]).toBe('16:58 à pied 7 min → Sainte-Catherine Place du Vieux…');
  });

  it('écran du trajet : un nom sans diminutif : coupé au mot, comme avant', () => {
    const r = rows(walkTo(EINSTEIN))[0];
    expect(r).toBe('16:58 à pied 7 min → Louvain-la-Neuve Université Parc…');
    expect(textWidth(r.slice(6))).toBeLessThanOrEqual(WALK_PX);
  });

  it('accordéon d’un favori, 1re ligne : « à pied 7 min → … » et « depuis … » suivent la même règle', () => {
    // le nom entier tient : inchangé
    expect(texts(ok(PLACES.bureau, walkTo('Bruxelles-Central')))[0]).toBe('à pied 7 min → Bruxelles-Central');
    expect(texts(ok(PLACES.bureau, walkTo(CARREFOUR)))[0]).toBe(`à pied 7 min → ${CARREFOUR}`);
    // trop long, le diminutif tient
    expect(textWidth(`à pied 7 min → ${SCHUMAN}`)).toBeGreaterThan(EXPAND_PX);
    expect(texts(ok(PLACES.bureau, walkTo(SCHUMAN)))[0]).toBe('à pied 7 min → Bxl-Schuman Rond-Point Robert Schuman');
    const there = journey('d', [bus(MONTGOMERY)]);
    expect(textWidth(`depuis ${MONTGOMERY}`)).toBeGreaterThan(EXPAND_PX);
    const from = texts(ok(PLACES.bureau, there))[0];
    expect(from).toBe('depuis Bd St-Michel Av. de Tervueren Square Montgomery');
    expect(textWidth(from)).toBeLessThanOrEqual(EXPAND_PX);
    // sans diminutif, ou diminutif trop long : le nom entier coupé au mot
    expect(texts(ok(PLACES.bureau, walkTo(EINSTEIN)))[0]).toBe('à pied 7 min → Louvain-la-Neuve Université Parc…');
    const longer = `${GRAINS} Quai aux Briques`;
    expect(textWidth(`à pied 7 min → ${shortName(longer)}`)).toBeGreaterThan(EXPAND_PX);
    expect(texts(ok(PLACES.bureau, walkTo(longer)))[0]).toBe('à pied 7 min → Sainte-Catherine Place du Vieux Marché…');
    // une gare hors de portée à pied (règle de la 1.3.0) n'est pas un arrêt où l'on marche : inchangée
    const ic = journey('g', [{ ride: 'IC', mode: 'train', dep: T(17, 42), arr: T(18, 12), from: `${SCHUMAN} Quartier Européen Berlaymont`, to: 'Namur', platform: '4' }]);
    expect(texts(ok(PLACES.bureau, ic, { fromStation: true }))[0]).toMatch(/^IC voie 4 à 17:42, à Bruxelles-Schuman .*…$/);
  });

  it('« Favoris » : la rangée ouverte avec un diminutif tient au pixel, telle que la vue l’a écrite', () => {
    const entries: FavoriteEntry[] = [{ fav: PLACES.bureau, answer: ok(PLACES.bureau, walkTo(SCHUMAN)) }];
    const v = favoritesView({ entries }, ctx());
    const p = layoutPage(v, { sel: 0, top: 0 });
    expect(overflowing(p)).toEqual([]);
    expect(p.lines.map(nb)[1]).toBe('à pied 7 min → Bxl-Schuman Rond-Point Robert Schuman');
  });

  it('balayage au pixel des deux lignes : entier dès qu’il tient, diminutif seulement sinon, coupe au mot en dernier ; jamais recoupé', () => {
    const seen = { full: 0, short: 0, cut: 0 };
    /** Ce qui est attendu pour `head`, `name`, `tail` dans `max` px, sans passer par la fonction de l'appli. */
    const kind = (head: string, name: string, tail: string, max: number): 'full' | 'short' | 'cut' =>
      textWidth(`${head}${name}${tail}`) <= max ? 'full' : shortName(name) !== name && textWidth(`${head}${shortName(name)}${tail}`) <= max ? 'short' : 'cut';
    const check = (said: string, head: string, name: string, tail: string, max: number, what: string): void => {
      const k = kind(head, name, tail, max);
      seen[k]++;
      expect(textWidth(said), what).toBeLessThanOrEqual(max);
      if (k === 'full') expect(said, what).toBe(`${head}${name}${tail}`);
      else if (k === 'short') expect(said, what).toBe(`${head}${shortName(name)}${tail}`);
      else {
        // la coupe au mot du nom entier : ce qui précède « … » est un début du nom entier, fini à la fin d'un mot (ou
        // après le trait d'union ou l'apostrophe d'un nom composé, règle des coupes de la 1.3.0)
        expect(said.startsWith(head) && said.endsWith(`…${tail}`), `${what} : ${said}`).toBe(true);
        const shown = said.slice(head.length, said.length - tail.length - 1);
        expect(name.startsWith(shown), `${what} : ${said}`).toBe(true);
        expect(name.charAt(shown.length) === ' ' || /[-’/]$/.test(shown), `${what} : ${said}`).toBe(true);
      }
    };
    for (const base of [`${CARREFOUR} Gare Centrale Cantersteen`, `${SCHUMAN} Quartier Européen`, `${GRAINS} Quai aux Briques`, MONTGOMERY, `${EINSTEIN} Lauzelle`]) {
      const words = base.split(' ');
      for (let n = 1; n <= words.length; n++) {
        const stop = words.slice(0, n).join(' ');
        for (const min of [5, 7, 12, 29]) {
          for (const wet of [false, true]) {
            const j = wet ? rain(walkTo(stop, min), 0) : walkTo(stop, min);
            const said = nb(stepsPage(route, { journeys: [j], index: 0, fresh: true }, ctx()).items[0].segs![1].t);
            check(said, `à pied ${min} min → `, stop, wet ? ', pluie' : '', WALK_PX, `trajet, ${min} min, « ${stop} »`);
            // la mise en page ne recoupe jamais ce que la vue a écrit
            const row = rows(j)[0];
            expect(row, stop).toBe(`${row.slice(0, 5)} ${said}`);
          }
          check(texts(ok(PLACES.bureau, walkTo(stop, min)))[0], `à pied ${min} min → `, stop, '', EXPAND_PX, `accordéon, ${min} min, « ${stop} »`);
        }
        check(texts(ok(PLACES.bureau, journey('d', [bus(stop)])))[0], 'depuis ', stop, '', EXPAND_PX, `accordéon, depuis « ${stop} »`);
      }
    }
    // le balayage passe bien par les trois cas
    expect(seen.full).toBeGreaterThan(50);
    expect(seen.short).toBeGreaterThan(20);
    expect(seen.cut).toBeGreaterThan(20);
  });
});

describe('PRD-1.3.1 § 15 : l’outil des balayages (test/scan/cuts.ts) reconnaît le diminutif comme le nom', () => {
  const FULL = 'Boulevard Saint-Michel Avenue de Tervueren Square Montgomery';
  /** Une page dont la rangée montre `line`, pour une vue dont le texte entier est le nom des données. */
  const cutsOf = (line: string) => {
    const v = { layout: 'message', items: [{ a: '', b: FULL }] } as unknown as GlassesView;
    const t = newTally();
    tally(t, pageCuts(v, { lines: [line] } as unknown as PageSpec));
    return t;
  };

  it('un diminutif coupé au mot est retrouvé (ni « introuvable », ni « au milieu d’un mot »)', () => {
    expect(cutsOf('à pied 7 min → Bd St-Michel Av. de Tervueren…')).toMatchObject({ cut: 1, mid: 0, first: 0, unknown: 0 });
    expect(cutsOf('à pied 7 min → Boulevard Saint-Michel Avenue…')).toMatchObject({ cut: 1, mid: 0, first: 0, unknown: 0 });
  });

  it('un diminutif coupé au milieu d’un mot est compté, comme le nom entier', () => {
    expect(cutsOf('à pied 7 min → Bd St-Michel Av. de Terv…')).toMatchObject({ cut: 1, mid: 1, unknown: 0 });
    expect(cutsOf('à pied 7 min → Boulevard Saint-Michel Aven…')).toMatchObject({ cut: 1, mid: 1, unknown: 0 });
    // un texte qui n'est ni le nom ni son diminutif reste introuvable
    expect(cutsOf('à pied 7 min → Blvd St-Michel…')).toMatchObject({ cut: 1, unknown: 1 });
  });
});
