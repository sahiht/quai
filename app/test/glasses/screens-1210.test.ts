/**
 * Quai 1.2.10, écrans refaits (docs/v1.2.10/PRD-1.2.10.md § 2 et § 5) : « Favoris » d'une ligne chacun (« ! » ; 1.3.0,
 * PRD-1.3.0 § 7 : le détail en accordéon, plus de ligne du détail en bas) et l'écran du trajet plus facile à lire (le nom du
 * trajet, « Départ … » et « arrivée … », une rangée par étape). Chaque texte mesuré au pixel avec les noms les plus
 * longs des vraies données ; jamais un mot coupé. Lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import { validateEvenHubPageContainer } from '@evenrealities/even_hub_sdk';
import { toTextProperty } from '../../src/platform/even';
import { guideView } from '../../src/glasses/guide-views';
import type { Favorite, FavoriteAnswer, Journey, RecentAddress } from '../../src/core/api';
import { textWidth } from '../../src/glasses/font';
import { GEO, WIDTHS, layoutPage, type BorderedContainer, type DetailItem } from '../../src/glasses/layout';
import { EXPAND_PX } from '../../src/glasses/format';
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

describe('PRD-1.2.10 § 2 et PRD-1.3.0 § 7 : « Favoris », une ligne par favori, le détail en accordéon', () => {
  it('neuf favoris : une ligne chacun, les aides ; 1.3.0 : accordéon, plus de ligne du détail réservée en bas ; rien ne dépasse', () => {
    const favs = Array.from({ length: 9 }, (_, i) => place(`f${i}`, `Lieu ${i + 1}`));
    const v = favoritesView({ entries: favs.map((fav, i) => ({ fav, answer: ok(fav, door(`j${i}`, NOW + (i + 2) * MIN, NOW + 70 * MIN)) })) }, ctx({}, favs));
    expect(v.accordion).toBe(true);
    expect(v.reserveNote).toBeUndefined();
    expect(v.note).toBeUndefined();
    const p = page(v);
    expect(overflowing(p)).toEqual([]);
    expect(p.lines.slice(0, 1).map(nb)).toEqual(['Lieu 1   dans 2 min → 08:41']);
    expect(nb(p.lines.at(-1)!)).toBe(HINT);
    // l'ancienne ligne du détail (1.2.10) n'est plus dite en bas : le texte du bus n'est que dans l'accordéon ouvert, sous
    // la rangée du curseur (1.3.1, PRD-1.3.1 § 4 : la 2e ligne garde le premier véhicule et son heure)
    expect(p.lines.map(nb).slice(1, 3)).toEqual(['à pied 5 min → Merbraine', 'bus W 07:38, direct']);
    expect(p.lines.map(nb).filter((l) => l === 'bus W 07:38, direct')).toHaveLength(1);
    // chaque favori a son accordéon : la marche vers l'arrêt, puis le bus et les changements
    expect((v.items[0] as DetailItem).expand?.map((l) => nb(l.text))).toEqual(['à pied 5 min → Merbraine', 'bus W 07:38, direct']);
    // toujours huit conteneurs de texte
    expect(p.containers).toHaveLength(8);
  });

  it('l’accordéon de chaque rangée : « ~ » au début d’une heure prévue (planned), la voie modifiée et son souci ; rien pour « tu y es » ni « Autre adresse »', () => {
    const favs = [PLACES.bureau, PLACES.ecole, PLACES.maison];
    const answers: Record<string, FavoriteAnswer> = {
      'fav-bureau': ok(PLACES.bureau, ic('j-ic', { delayMin: 2, newPlatform: '6' })),
      'fav-ecole': ok(PLACES.ecole, door('j-e', NOW + 9 * MIN, NOW + 80 * MIN, { rt: false })),
      'fav-maison': { favoriteId: 'fav-maison', kind: 'trip', state: 'here', updatedAt: NOW },
    };
    const v = favoritesView({ entries: favs.map((fav) => ({ fav, answer: answers[fav.id] })) }, ctx({}, favs));
    const expand = v.items.map((i) => (i as DetailItem).expand?.map((l) => ({ ...l, text: nb(l.text) })));
    expect(expand).toEqual([
      // 1.3.1 (PRD-1.3.1 § 4) : la gare ou l'arrêt où monter, puis le véhicule, son heure (« ~ » : planned) et la voie
      [{ text: 'à pied 7 min → Braine-l’Alleud' }, { text: 'IC 07:42 +2 voie 6 au lieu de 4, direct' }],
      [{ text: 'à pied 5 min → Merbraine' }, { text: 'bus W ~07:45, direct', planned: true }],
      undefined,
      undefined,
    ]);
    // pas de note à part
    expect(lines(v).join('\n')).not.toContain('horaire prévu');
    expect(v.log).toMatchObject({ order: ['fav-bureau', 'fav-ecole', 'fav-maison'] });
    // « ! » : la voie change ; le nom au plus clair, « ! » collé par une espace insécable
    expect(v.items[0].a).toBe(`Bureau${TROUBLE_MARK}`);
    expect(TROUBLE_MARK).toBe('\u00a0!');
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

  it('adresses récentes : l’adresse complète dans l’accordéon ; horaires périmés : leur message en haut, sans filet', () => {
    const recent: RecentAddress[] = [{ label: 'Place Saint-Lambert 1, 4000 Liège', lat: 50.6451, lon: 5.5734, at: 1 }];
    const s = settingsWith([PLACES.bureau], { recent });
    const v = favoritesView({}, { now: NOW, settings: s });
    expect((v.items[1] as DetailItem).expand).toEqual([{ text: 'Place Saint-Lambert 1, 4000 Liège' }]);
    const stale = favoritesView({}, { now: NOW, settings: s, stale: 'Horaires du 10/11 : mise à jour en attente' });
    const p = layoutPage(stale, { sel: 1, top: 0 });
    expect(container(p, 'top')).toMatchObject({ y: 30, h: 27, level: 4 });
    expect((container(p, 'top') as BorderedContainer).border).toBeUndefined();
    expect(nb(p.lines[0])).toBe('Horaires du 10/11 : mise à jour en attente');
    // le pied n'a plus que les aides
    expect(rowsOf(container(p, 'foot'))).toEqual([HINT]);
  });

  it('noms les plus longs : le nom coupé au mot avant « ! », la réponse entière, l’accordéon coupé au mot ; rien ne dépasse', () => {
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
        for (const l of (v.items[sel] as DetailItem).expand ?? []) {
          expect(textWidth(l.text)).toBeLessThanOrEqual(EXPAND_PX);
          if (l.text.endsWith('…')) expect(l.text).not.toMatch(/ …$/);
        }
      }
      expect(textWidth(v.items[0].a)).toBeLessThanOrEqual(WIDTHS.wideLeft);
      // le souci (travaux) sur la 2e ligne, juste après le véhicule et son heure (1.3.1)
      expect(nb((v.items[0] as DetailItem).expand![1].text)).toBe('bus 163b4 07:39, travaux, direct');
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
      // 1.3.1 (PRD-1.3.1 § 4, B14) : une marche nomme l'arrêt où monter ; la dernière porte l'heure d'arrivée
      '07:36 à pied 5 min → Monument Gramme',
      '07:41 Bus 6 → Gare des Guillemins   07:49',
      '07:49 à pied 3 min → Liège-Guillemins',
      '07:56 IC voie 3 → Bruxelles-Central   marge 4 min',
      '08:48 à pied 6 min   08:54',
      'Fin du trajet. Pas d’autre trajet pour l’instant',
      // 1.3.0 (PRD-1.3.0 § 1) : la ligne d'action, entre la note et les aides
      '▶ Y aller',
      '△▽ étapes   double : retour',
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
    expect(rowsOf(container(p, 'colB'))[0].trim()).toBe('à pied 5 min → Monument Gramme');
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

describe('pages acceptées par le SDK (validateEvenHubPageContainer)', () => {
  it('« Favoris » (1.3.0 : en accordéon), et les trois pages du guidage', () => {
    const sdk = (p: ReturnType<typeof page>) => {
      const sdkPage = { containerTotalNum: p.containers.length, textObject: p.containers.map(toTextProperty) };
      return validateEvenHubPageContainer(sdkPage);
    };
    expect(sdk(page(favoritesView({}, ctx())))).toEqual({ valid: true });
    const s = {
      kind: 'trip' as const,
      journeyId: 'j1',
      phase: { kind: 'walk' as const, leg: 0 },
      moment: { since: NOW, until: NOW + MIN, leg: 0, id: 't', kind: 'turn' as const, turn: 'left' as const, distM: 40, toward: { fr: 'Monument Gramme', nl: 'Monument Gramme' }, final: false },
      where: { title: 'Bureau', arr: T(8, 54), rt: true, chain: [{ label: 'à pied', state: 'now' as const }] },
      location: 'high' as const,
      wakeAt: NOW + MIN,
      ended: false,
    };
    for (const show of ['empty', 'moment', 'where'] as const) expect(sdk(page(guideView(s, show, J, ctx()))), show).toEqual({ valid: true });
  });
});
