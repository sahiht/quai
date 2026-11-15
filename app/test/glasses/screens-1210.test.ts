/**
 * Quai 1.2.10, écrans refaits (docs/v1.2.10/PRD-1.2.10.md § 2 et § 5) : « Favoris » d'une ligne chacun (« ! », la
 * ligne du détail en bas sous un filet pâle, sept favoris à l'écran) et l'écran du trajet plus facile à lire (le nom du
 * trajet, « Départ … » et « arrivée … », une rangée par étape). Chaque texte mesuré au pixel avec les noms les plus
 * longs des vraies données ; jamais un mot coupé. Lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { Favorite, FavoriteAnswer, Journey, RecentAddress } from '../../src/core/api';
import { textWidth } from '../../src/glasses/font';
import { GEO, WIDTHS, layoutPage, shapeKey, type BorderedContainer } from '../../src/glasses/layout';
import { favoriteTrouble, favoritesView, stepsPage, stepsTopLine, TROUBLE_MARK, type ViewCtx } from '../../src/glasses/views';
import { MIN, PLACES, at, container, journey, lines, nb, overflowing, page, rowsOf, settingsWith } from './helpers';

const DAY = '2026-11-12';
const NOW = at(DAY, 7, 31);
const T = (hh: number, mm: number) => at(DAY, hh, mm);

/** Les noms les plus longs des vraies données (data/tiles du 12/11). */
const LONG = ['Comines/komen Chaussée de Wervicq/Werviksesteenweg', 'Genk Ziekenhuis Oost-Limburg huisartsenwachtpost', 'Begraafplaats van Molenbeek', 'Bruxelles-Aéroport-Zaventem'];

const place = (id: string, label: string): Favorite => ({ kind: 'place', id, label, lat: 50.85, lon: 4.36, propose: 'never' }) as Favorite;
const ok = (fav: Favorite, j: Journey): FavoriteAnswer => ({ favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [j] }, updatedAt: NOW });
function door(id: string, leave: number, arr: number, p: { rt?: boolean; to?: string; line?: string } = {}): Journey {
  const j = journey(id, [{ walk: 5, to: 'Merbraine' }, { ride: p.line ?? 'W', mode: 'bus', dep: leave + 5 * MIN, arr: arr - 4 * MIN, from: 'Merbraine', to: p.to ?? 'Bruxelles Midi' }, { walk: 4 }]);
  if (p.rt === false) for (const l of j.legs) if (l.kind === 'ride') l.rt = false;
  return j;
}
const ic = (id: string, p: Partial<Journey['legs'][number]> = {}): Journey => {
  const j = journey(id, [{ walk: 7 }, { ride: 'IC', mode: 'train', dep: NOW + 11 * MIN, arr: NOW + 64 * MIN, from: 'Braine-l’Alleud', to: 'Bruxelles-Central', platform: '4' }, { walk: 3 }]);
  j.legs[1] = { ...j.legs[1], ...p };
  return j;
};
const ctx = (patch: Partial<ViewCtx> = {}, favs: Favorite[] = [PLACES.bureau]): ViewCtx => ({ now: NOW, settings: settingsWith(favs), ...patch });
const HINT = '△▽ choisir   toucher : ouvrir   double : retour';

describe('PRD-1.2.10 § 2 : « Favoris », une ligne par favori, le détail en bas', () => {
  it('sept favoris à l’écran avec la ligne du détail et les aides ; un filet pâle (bordure de niveau 2) entre la liste et le détail', () => {
    const favs = Array.from({ length: 9 }, (_, i) => place(`f${i}`, `Lieu ${i + 1}`));
    const v = favoritesView({ entries: favs.map((fav, i) => ({ fav, answer: ok(fav, door(`j${i}`, NOW + (i + 2) * MIN, NOW + 70 * MIN)) })) }, ctx({}, favs));
    const p = page(v);
    expect(p.visible).toBe(7);
    expect(overflowing(p)).toEqual([]);
    expect(p.lines.slice(0, 2).map(nb)).toEqual(['Lieu 1   dans 2 min → 08:41', 'Lieu 2   dans 3 min → 08:41']);
    expect(p.lines.slice(-2).map(nb)).toEqual(['bus W 07:38, direct', HINT]);
    // le filet : le conteneur de la ligne du haut, 1 px, entre la dernière rangée (y = 222) et le pied (y = 231)
    const filet = container(p, 'top') as BorderedContainer;
    expect(filet).toMatchObject({ x: 28, w: 544, h: 1, level: 2, border: { width: 1, level: 2 } });
    expect(filet.y).toBeGreaterThan(222);
    expect(filet.y + filet.h).toBeLessThanOrEqual(231);
    expect(container(p, 'foot')).toMatchObject({ y: 231, h: 54, level: 2 });
    // toujours huit conteneurs de texte ; la bordure compte dans la forme de la page
    expect(p.containers).toHaveLength(8);
    expect(shapeKey(p)).toContain('/b1:2');
  });

  it('la ligne du détail suit le curseur sans reconstruire la page ; « ~ » au début d’une heure prévue ; rien pour « tu y es »', () => {
    const favs = [PLACES.bureau, PLACES.ecole, PLACES.maison];
    const answers: Record<string, FavoriteAnswer> = {
      'fav-bureau': ok(PLACES.bureau, ic('j-ic', { delayMin: 2, newPlatform: '6' })),
      'fav-ecole': ok(PLACES.ecole, door('j-e', NOW + 9 * MIN, NOW + 80 * MIN, { rt: false })),
      'fav-maison': { favoriteId: 'fav-maison', kind: 'trip', state: 'here', updatedAt: NOW },
    };
    const v = favoritesView({ entries: favs.map((fav) => ({ fav, answer: answers[fav.id] })) }, ctx({}, favs));
    const at = (sel: number) => layoutPage(v, { sel, top: 0 });
    expect(rowsOf(container(at(0), 'foot'))[0]).toBe('IC 07:42 +2 voie 6 !, direct');
    expect(rowsOf(container(at(1), 'foot'))[0]).toBe('bus W ~07:45, direct');
    expect(rowsOf(container(at(2), 'foot'))[0].trim()).toBe('');
    // « Autre adresse » : vide
    expect(rowsOf(container(at(3), 'foot'))[0].trim()).toBe('');
    // pas de note à part
    expect(lines(v).join('\n')).not.toContain('horaire prévu');
    // même forme d'un favori à l'autre : seuls les textes changent
    expect(new Set([0, 1, 2, 3].map((s) => shapeKey(at(s)))).size).toBe(1);
    // « ! » : la voie change ; le nom au plus clair, « ! » collé par une espace insécable
    expect(v.items[0].a).toBe(`Bureau${TROUBLE_MARK}`);
    expect(TROUBLE_MARK).toBe(' !');
    expect(v.items[1].a).toBe('École');
  });

  it('« ! » : premier véhicule supprimé, voie modifiée, alerte du trajet (travaux, voie, suppression) ; jamais un retard seul', () => {
    const trouble = (j: Journey) => favoriteTrouble(ok(PLACES.bureau, j), NOW);
    expect(trouble(ic('a'))).toBe(false);
    expect(trouble(ic('b', { delayMin: 12 }))).toBe(false);
    expect(trouble(ic('c', { cancelled: true }))).toBe(true);
    expect(trouble(ic('d', { newPlatform: '6' }))).toBe(true);
    expect(trouble({ ...ic('e'), alerts: [{ kind: 'works', text: 'Travaux : ligne 124', at: NOW }] })).toBe(true);
    expect(trouble({ ...ic('f'), alerts: [{ kind: 'delay', text: '! Retard : +12 min', at: NOW }] })).toBe(false);
    expect(trouble({ ...ic('g'), alerts: [{ kind: 'leave', text: 'Pars dans 5 min', at: NOW }] })).toBe(false);
    expect(favoriteTrouble({ favoriteId: 'x', kind: 'trip', state: 'here', updatedAt: NOW }, NOW)).toBe(false);
    expect(favoriteTrouble(undefined, NOW)).toBe(false);
  });

  it('adresses récentes : l’adresse complète dans la ligne du détail ; horaires périmés : leur message en haut, pas de filet', () => {
    const recent: RecentAddress[] = [{ label: 'Place Saint-Lambert 1, 4000 Liège', lat: 50.6451, lon: 5.5734, at: 1 }];
    const s = settingsWith([PLACES.bureau], { recent });
    const v = favoritesView({}, { now: NOW, settings: s });
    expect(rowsOf(container(layoutPage(v, { sel: 1, top: 0 }), 'foot'))[0]).toBe('Place Saint-Lambert 1, 4000 Liège');
    const stale = favoritesView({}, { now: NOW, settings: s, stale: 'Horaires du 10/11 : mise à jour en attente' });
    const p = layoutPage(stale, { sel: 1, top: 0 });
    expect(container(p, 'top')).toMatchObject({ y: 30, h: 27, level: 4 });
    expect((container(p, 'top') as BorderedContainer).border).toBeUndefined();
    expect(nb(p.lines[0])).toBe('Horaires du 10/11 : mise à jour en attente');
    expect(rowsOf(container(p, 'foot'))[0]).toBe('Place Saint-Lambert 1, 4000 Liège');
  });

  it('noms les plus longs : le nom coupé au mot avant « ! », la réponse entière, le détail coupé au mot ; rien ne dépasse', () => {
    for (const name of LONG) {
      const fav = place('f', name);
      const j = { ...door('j', NOW + 3 * MIN, NOW + 70 * MIN, { line: '163b4', to: name }), alerts: [{ kind: 'works' as const, text: 'Travaux', at: NOW }] };
      const recent: RecentAddress[] = [{ label: `${name} 1, 7780 Comines-Warneton, Hainaut, Belgique`, lat: 50.77, lon: 3.0, at: 1 }];
      const v = favoritesView({ entries: [{ fav, answer: ok(fav, j) }] }, { now: NOW, settings: settingsWith([fav], { recent }) });
      for (const sel of [0, 1]) {
        const p = layoutPage(v, { sel, top: 0 });
        expect(overflowing(p), name).toEqual([]);
        const row = nb(p.lines[0]);
        expect(row).toMatch(/ !   dans 3 min → 08:41$/);
        expect(row).not.toMatch(/ …/);
        const detail = rowsOf(container(p, 'foot'))[0];
        expect(textWidth(detail)).toBeLessThanOrEqual(WIDTHS.full);
        if (detail.endsWith('…')) expect(detail).not.toMatch(/ …$/);
      }
      expect(textWidth(v.items[0].a)).toBeLessThanOrEqual(WIDTHS.wideLeft);
    }
  });
});

/* ------------------------------ Écran du trajet ------------------------------ */

/** Marche, bus 6, marche, IC voie 3, marche (PRD § 5). */
const J = journey('j1', [
  { walk: 5, to: 'Monument Gramme' },
  { ride: '6', mode: 'bus', dep: T(7, 41), arr: T(7, 49), from: 'Monument Gramme', to: 'Gare des Guillemins', head: 'Gare des Guillemins' },
  { walk: 3, to: 'Liège-Guillemins' },
  { ride: 'IC', mode: 'train', dep: T(7, 56), arr: T(8, 48), from: 'Liège-Guillemins', to: 'Bruxelles-Central', platform: '3' },
  { walk: 6 },
]);
const steps = (j: Journey, c: ViewCtx = ctx(), title = 'Vers le bureau') => stepsPage({ title, label: '' }, { journeys: [j], index: 0, fresh: true }, c);

describe('PRD-1.2.10 § 5 : l’écran du trajet, plus facile à lire', () => {
  it('titre « Bureau », l’heure à droite ; « Départ 07:36, dans 5 min » et « arrivée 08:54 » ; une rangée par étape ; « y aller »', () => {
    const v = steps(J);
    expect(v.title).toBe('Bureau');
    expect(v.titleRight).toBeUndefined();
    expect(lines(v)).toEqual([
      'Départ 07:36, dans 5 min   arrivée 08:54',
      '07:36 à pied 5 min',
      '07:41 Bus 6 → Gare des Guillemins   07:49',
      '07:49 à pied 3 min',
      '07:56 IC voie 3 → Bruxelles-Central   marge 4 min',
      '08:48 à pied 6 min',
      'Fin du trajet. Pas d’autre trajet pour l’instant',
      '△▽ étapes   toucher : y aller   double : retour',
    ]);
    expect(v.tap).toEqual({ kind: 'goGuide' });
    const p = page(v);
    // la ligne du haut pâle, l'arrivée au bord droit
    const top = container(p, 'top');
    expect(top.level).toBe(2);
    expect(top.x + textWidth(top.content)).toBeGreaterThanOrEqual(GEO.X_END - GEO.SAFETY - 5);
    // l'heure et le véhicule au plus clair, l'arrêt de descente et la marche pâles, la marge au plus clair
    expect(rowsOf(container(p, 'colA'))[1].replace(/\s+/g, ' ').trim()).toBe('07:41 Bus 6');
    expect(rowsOf(container(p, 'colB'))[1].replace(/\s+/g, ' ').trim()).toBe('→ Gare des Guillemins 07:49');
    expect(rowsOf(container(p, 'colB'))[0].trim()).toBe('à pied 5 min');
    expect(rowsOf(container(p, 'colC'))[3].trim()).toBe('marge 4 min');
    expect(container(p, 'colA').level).toBe(4);
    expect(container(p, 'colB').level).toBe(2);
    expect(container(p, 'colC').level).toBe(4);
  });

  it('« ~ » sans temps réel, l’alerte du trajet au plus clair, « voie 6 ! », « SUPPRIMÉ », « , dernier », un autre jour', () => {
    const planned = { ...J, rt: false, legs: J.legs.map((l) => (l.kind === 'ride' ? { ...l, rt: false } : l)) };
    const pl = lines(steps(planned));
    expect(pl[0]).toBe('Départ 07:36, dans 5 min   arrivée ~08:54');
    expect(pl[2]).toBe('~07:41 Bus 6 → Gare des Guillemins   07:49');
    const alert = { ...J, alerts: [{ kind: 'platform' as const, text: '! Voie modifiée : l’IC part de la voie 6', at: NOW }] };
    const a = steps(alert);
    expect(nb(lines(a)[0])).toBe('! Voie modifiée : l’IC part de la voie 6');
    expect(container(page(a), 'top').level).toBe(4);
    const changed = { ...J, legs: J.legs.map((l, i) => (i === 3 ? { ...l, newPlatform: '6' } : i === 1 ? { ...l, cancelled: true, last: true } : l)) };
    const cl = lines(steps(changed));
    expect(cl[2]).toBe('07:41 Bus 6 → Gare des Guillemins   SUPPRIMÉ');
    expect(cl[4]).toBe('07:56 IC voie 6 ! → Bruxelles-Central   marge 4 min');
    const last = { ...J, legs: J.legs.map((l, i) => (i === 1 ? { ...l, last: true } : l)) };
    expect(lines(steps(last))[2]).toBe('07:41 Bus 6 → Gare des Guillemins, dernier   07:49');
    const late = at(DAY, 23, 30);
    const tomorrow = journey('t', [{ ride: 'IC', mode: 'train', dep: at('2026-11-13', 6, 20), arr: at('2026-11-13', 6, 46), from: 'Namur', to: 'Bruxelles-Central', platform: '2' }]);
    expect(lines(steps(tomorrow, ctx({ now: late })))[0]).toBe('Départ demain 06:20   arrivée 06:46');
    expect(nb(stepsTopLine(J, T(7, 36), at(DAY, 7, 35, 40), true).text)).toBe('Départ 07:36, maintenant   arrivée 08:54');
    expect(nb(stepsTopLine(J, T(7, 36), T(7, 50), true).text)).toBe('Départ 07:36   arrivée 08:54');
  });

  it('noms les plus longs des vraies données : l’arrêt coupé au mot, le véhicule et la colonne de droite entiers ; rien ne dépasse', () => {
    for (const name of LONG) {
      const j = journey('l', [
        { walk: 12, to: name },
        { ride: '163b4', mode: 'bus', dep: T(7, 41), arr: T(7, 49), from: name, to: name, head: name },
        { walk: 3, to: name },
        { ride: 'IC', mode: 'train', dep: T(7, 54), arr: T(8, 48), from: name, to: name, platform: '12a' },
        { walk: 25 },
      ]);
      j.legs[3] = { ...j.legs[3], newPlatform: '11b', last: true, rt: false };
      const fromStation = journey('s', [{ ride: 'IC', mode: 'train', dep: T(7, 54), arr: T(8, 48), from: name, to: name, platform: '12a' }]);
      for (const v of [steps(j, ctx(), `Vers ${name}`), steps(fromStation, ctx(), `Vers ${name}`)]) {
        const p = page(v);
        expect(overflowing(p), name).toEqual([]);
        for (const l of [p.title, ...p.lines].map(nb)) {
          expect(l).not.toMatch(/ …|[–—]/);
          if (l.includes('…')) expect(l).toMatch(/[\p{L}\p{N},)/\-’]…/u);
        }
        expect(textWidth(v.title)).toBeLessThanOrEqual(WIDTHS.title);
      }
      const l = lines(steps(j));
      // l'arrêt coupé au mot : ce qui reste avant « … » est le début du nom, suivi d'une espace dans le nom
      for (const row of l) {
        const m = /→ (.*?)…/.exec(row);
        if (!m) continue;
        expect(name.startsWith(m[1]), row).toBe(true);
        // fin d'un mot, ou d'un morceau d'un nom composé (« Comines/… »)
        expect(name[m[1].length] === ' ' || /[-/’']$/.test(m[1]), row).toBe(true);
      }
      expect(l[2]).toMatch(/^07:41 Bus 163b4 → .*   07:49$/);
      expect(l[4]).toMatch(/^~07:54 IC voie 11b ! → .*[\p{L}\p{N}/-]…, dernier   marge 2 min$/u);
    }
  });
});
