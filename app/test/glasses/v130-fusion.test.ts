/**
 * Quai 1.3.0, fusion des écrans (équipe A : contenu des vues) et de la mise en page (équipe B : rendu, navigation)
 * (docs/v1.3.0/PRD-1.3.0.md § 1, § 7, § 9) : chaque vérification passe par les vraies vues, la vraie mise en page et la
 * vraie navigation, jamais par une vue fabriquée.
 *  - § 1 : l'écran d'un trajet de 9 étapes : la ligne d'action prend une rangée, la navigation et la page comptent la même
 *    capacité, en descendant chaque étape entre une seule fois à l'écran et aucune n'est sautée, ▼ sur la dernière page
 *    rend `edge` (« Autres trajets »), la note du bas et la ligne d'action sont à leur place au pixel ; le lecteur d'écran
 *    de Quai Web lit la note, la ligne d'action, puis les aides, dans l'ordre de l'écran.
 *  - § 7 : l'accordéon des favoris : les lignes de l'équipe des écrans sont coupées à la largeur même que leur donne la
 *    mise en page (une seule mesure), l'exemple du PRD tient entier, ni filet ni ligne du détail.
 * Lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import { validateEvenHubPageContainer } from '@evenrealities/even_hub_sdk';
import type { FavoriteAnswer, Journey } from '../../src/core/api';
import { LINE_H, SCREEN_H, textWidth } from '../../src/glasses/font';
import { EXPAND_PX } from '../../src/glasses/format';
import { GEO, HOME_INDENT, WIDTHS, geometry, layoutPage, visibleRange, type BorderedContainer, type DetailItem } from '../../src/glasses/layout';
import { current, effectiveFrame, handleGesture, initNav, setSelection, type NavState } from '../../src/glasses/nav';
import type { GlassesView, PageSpec } from '../../src/glasses/types';
import { favoritesView, othersView, stepsPage, type FavoriteEntry, type ViewCtx } from '../../src/glasses/views';
import { toTextProperty } from '../../src/platform/even';
import { describeContainers } from '../../src/web/display';
import { MIN, PLACES, at, container, journey, nb, overflowing, rowsOf, settingsWith } from './helpers';

const DAY = '2026-11-12';
const NOW = at(DAY, 7, 31);
const T = (hh: number, mm: number) => at(DAY, hh, mm);
const ctx = (patch: Partial<ViewCtx> = {}): ViewCtx => ({ now: NOW, settings: settingsWith([PLACES.bureau]), ...patch });

/** Page valide pour le matériel : 8 conteneurs de texte acceptés par le SDK, rien ne dépasse, jamais de tiret long. */
function hardware(p: PageSpec): void {
  expect(p.containers).toHaveLength(8);
  expect(overflowing(p)).toEqual([]);
  const sdkPage = { containerTotalNum: p.containers.length, textObject: p.containers.map(toTextProperty) };
  expect(validateEvenHubPageContainer(sdkPage)).toEqual({ valid: true });
  for (const l of [p.title, ...p.lines]) expect(l).not.toMatch(/[—–]/);
}

/* ------------------------------ § 1 : l'écran d'un trajet de 9 étapes ------------------------------ */

/** Neuf étapes entre des arrêts publics : deux pages avec la ligne d'action (cinq rangées), au lieu d'une et demie. */
const nine = journey(
  'j9',
  [
    { walk: 5, to: 'Merbraine' },
    { ride: 'W', mode: 'bus', dep: T(7, 43), arr: T(7, 52), from: 'Merbraine', to: 'Braine-l’Alleud', head: 'Braine-l’Alleud' },
    { walk: 3, to: 'Braine-l’Alleud' },
    { ride: 'IC', mode: 'train', dep: T(8, 1), arr: T(8, 24), from: 'Braine-l’Alleud', to: 'Bruxelles-Central', head: 'Liers', platform: '3' },
    { walk: 2, to: 'Gare Centrale' },
    { ride: '1', mode: 'metro', dep: T(8, 30), arr: T(8, 34), from: 'Gare Centrale', to: 'Schuman', head: 'Stockel' },
    { walk: 2, to: 'Schuman' },
    { ride: '81', mode: 'tram', dep: T(8, 39), arr: T(8, 47), from: 'Schuman', to: 'Flagey', head: 'Marius Renard' },
    { walk: 3 },
  ],
  { label: 'short', reason: 'Le plus court' },
);
const other = journey('j2', [{ walk: 19, to: 'Braine-l’Alleud' }, { ride: 'IC', mode: 'train', dep: T(7, 55), arr: T(8, 17), from: 'Braine-l’Alleud', to: 'Bruxelles-Central', platform: '1' }, { walk: 3 }], { label: 'earlier' });
const ALL = [nine, other];

/** L'écran du trajet tel que le contrôleur le construit pour un cadre de la pile (stepsViewOf) : défilement gardé. */
const viewAt = (s: NavState, c = ctx()): GlassesView => {
  const f = current(s);
  return stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: ALL, index: 0, top: f.top, fresh: f.fresh }, c);
};

/** Une page de l'écran du trajet : la vue, sa géométrie, la page rendue avec la capacité que reçoit aussi la navigation. */
function shown(s: NavState, c = ctx()) {
  const v = viewAt(s, c);
  const g = geometry(v);
  const p = layoutPage(v, effectiveFrame(current(s), v, g.capacity));
  return { v, g, p };
}

describe('PRD-1.3.0 § 1 : l’écran d’un trajet de 9 étapes, vues de l’équipe A, mise en page et navigation de l’équipe B', () => {
  it('en descendant : chaque étape entre une seule fois à l’écran, aucune n’est sautée ; ▼ sur la dernière page rend edge (« Autres trajets »)', () => {
    let s = initNav({ screen: 'steps', label: '' });
    const pages: { from: number; to: number }[] = [];
    const notes: string[] = [];
    for (let k = 0; k < 9; k++) {
      const { v, g, p } = shown(s);
      hardware(p);
      // une rangée de moins pour la ligne d'action : cinq étapes, la capacité que la navigation reçoit (controller)
      expect(v.action).toBe('▶ Y aller');
      expect(g.capacity).toBe(5);
      const range = visibleRange(v.items, p.top, g.capacity);
      expect(p.visible).toBe(range.to - range.from);
      pages.push(range);
      notes.push(nb(v.note ?? ''));
      // la note dit ce qui reste caché sous la page, d'après la page même
      const hidden = v.items.length - range.to;
      expect(nb(v.note ?? '')).toBe(hidden ? `▽ suite du trajet : ${hidden} étape${hidden > 1 ? 's' : ''}` : 'Fin du trajet. ▽ 1 autre trajet');
      const r = handleGesture(s, 'down', v, g.capacity);
      if (r.effect.kind === 'edge') {
        expect(r.effect).toEqual({ kind: 'edge', dir: 'down' });
        break;
      }
      expect(r.effect).toEqual({ kind: 'render' });
      s = r.state;
    }
    // deux pages : 0 à 4, puis la fin de la liste (bornée en bas, comme depuis la 1.1)
    expect(pages).toEqual([{ from: 0, to: 5 }, { from: 4, to: 9 }]);
    expect(notes).toEqual(['▽ suite du trajet : 4 étapes', 'Fin du trajet. ▽ 1 autre trajet']);
    // chaque page commence au plus tard à la première étape cachée (aucune sautée) et plus bas que la précédente : une
    // étape qui a quitté l'écran n'y revient jamais en descendant
    for (let k = 1; k < pages.length; k++) {
      expect(pages[k].from).toBeGreaterThan(pages[k - 1].from);
      expect(pages[k].from).toBeLessThanOrEqual(pages[k - 1].to);
    }
    // chaque étape entre à l'écran une fois et une seule
    const entries = new Array<number>(nine.legs.length).fill(0);
    pages.forEach((pg, k) => {
      for (let i = pg.from; i < pg.to; i++) if (k === 0 || i >= pages[k - 1].to || i < pages[k - 1].from) entries[i]++;
    });
    expect(entries).toEqual(new Array(9).fill(1));
    // ▲ : la première page, puis rien de plus (edge vers le haut, que le contrôleur ignore sur les étapes)
    const up = handleGesture(s, 'up', viewAt(s), 5);
    expect(up.effect).toEqual({ kind: 'render' });
    expect(current(up.state).top).toBe(0);
    expect(handleGesture(up.state, 'up', viewAt(up.state), 5).effect).toEqual({ kind: 'edge', dir: 'up' });
  });

  it('la note du bas et la ligne d’action, toutes deux visibles et au pixel : la note sous la dernière rangée, l’action au plus clair, puis les aides', () => {
    let s = initNav({ screen: 'steps', label: '' });
    for (const note of ['▽ suite du trajet : 4 étapes', 'Fin du trajet. ▽ 1 autre trajet']) {
      const { v, g, p } = shown(s);
      const colA = container(p, 'colA');
      const foot = container(p, 'foot');
      // la liste finit où commence le pied : sa dernière rangée touche la note
      expect(g.rowsY + g.capacity * LINE_H).toBe(g.footY);
      expect(container(p, 'colB').y).toBe(g.rowsY);
      expect(container(p, 'cursor').y).toBe(g.rowsY);
      // le pied, pâle : la note (1re ligne, juste sous la liste), la place de l'action, les aides en bas de l'écran
      expect(foot.y).toBe(g.footY);
      expect(foot.level).toBe(2);
      expect(rowsOf(foot)).toEqual([note, '', '△▽ étapes   double : retour']);
      expect(foot.y + 3 * LINE_H).toBe(SCREEN_H - GEO.BOTTOM_MARGIN);
      // la ligne d'action : au plus clair (colonne a, prolongée sur la grille du pied), une ligne sous la note
      expect(colA.level).toBe(4);
      const a = rowsOf(colA);
      expect(a.at(-1)).toBe('▶ Y aller');
      expect(colA.y + (a.length - 1) * LINE_H).toBe(g.footY + LINE_H);
      // rien de la colonne a sur la ligne de la note : la note reste lisible
      expect(a[(g.footY - colA.y) / LINE_H].trim()).toBe('');
      // journal : la note, la ligne d'action, les aides, dans l'ordre de l'écran
      expect(p.lines.slice(-3).map(nb)).toEqual([note, '▶ Y aller', '△▽ étapes   double : retour']);
      expect(nb(v.note ?? '')).toBe(note);
      s = handleGesture(s, 'down', v, g.capacity).state;
    }
  });

  it('Quai Web, lecteur d’écran : la dernière rangée, la note, la ligne d’action, puis les aides, dans l’ordre de l’écran', () => {
    let s = initNav({ screen: 'steps', label: '' });
    for (let k = 0; k < 2; k++) {
      const { v, g, p } = shown(s);
      // les textes se suivent, séparés par « . » (la note de la fin en contient un : « Fin du trajet. ▽ … »)
      const said = nb(describeContainers(p.containers));
      // 1.3.1 (PRD-1.3.1 § 4, B14) : la marche nomme l'arrêt où monter ; la dernière porte l'heure d'arrivée
      const last = k ? '08:47, à pied 3 min 08:50' : '08:24, à pied 2 min → Gare Centrale';
      expect(said.endsWith(`. ${last}. ${nb(v.note ?? '')}. ▶ Y aller. △▽ étapes double : retour`), said).toBe(true);
      s = handleGesture(s, 'down', v, g.capacity).state;
    }
    // un message temporaire prend la ligne d'aide : la note, l'action, puis le message
    const v = viewAt(s);
    const p = layoutPage(v, effectiveFrame(current(s), v, geometry(v, true).capacity), { toast: 'Trajet en cours : vers le bureau' });
    hardware(p);
    expect(nb(describeContainers(p.containers)).endsWith('. Fin du trajet. ▽ 1 autre trajet. ▶ Y aller. Trajet en cours : vers le bureau')).toBe(true);
    // sans ligne d'action (« Autres trajets ») : la liste, puis les aides, comme en 1.2.10
    const list = othersView({ screen: 'others', title: 'Vers le bureau', journeys: ALL, index: 0 }, ALL, ctx());
    const q = layoutPage(list, { sel: 0, top: 0 });
    expect(nb(describeContainers(q.containers)).endsWith(`. ${nb(list.items[0].b2 ?? '')}. △▽ choisir toucher : voir double : retour`)).toBe(true);
  });

  it('une proposition ouverte depuis « Autres trajets », sans aide des gestes : la note puis la ligne d’action, la ligne d’aide reste réservée', () => {
    const c = ctx({ settings: settingsWith([PLACES.bureau], { display: { ...settingsWith([]).display, gestureHints: false } }) });
    const v = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: ALL, index: 1, fromList: true, fresh: true }, c);
    expect(v.hints).toBe('');
    const g = geometry(v);
    const p = layoutPage(v, effectiveFrame(initNav({ screen: 'steps', label: '' }).stack[0], v, g.capacity));
    hardware(p);
    expect(p.lines.slice(-2).map(nb)).toEqual(['Fin du trajet. ▽ autres trajets', '▶ Y aller']);
    expect(rowsOf(container(p, 'foot'))[0]).toBe('Fin du trajet. ▽ autres trajets');
    expect(nb(describeContainers(p.containers)).endsWith('. Fin du trajet. ▽ autres trajets. ▶ Y aller')).toBe(true);
  });
});

/* ------------------------------ § 7 : l'accordéon des favoris ------------------------------ */

const LATE = at(DAY, 11, 30);
const ok = (j: Journey): FavoriteAnswer => ({ favoriteId: PLACES.bureau.id, kind: 'trip', state: 'ok', plan: { journeys: [j] }, updatedAt: LATE });
/** L'exemple du PRD (§ 7) : à pied 7 min, le bus W de 11:49 sans temps réel, puis le métro 2. */
function prdExample(): Journey {
  const j = journey('prd', [
    { walk: 7, to: 'Merbraine' },
    { ride: 'W', mode: 'bus', dep: at(DAY, 11, 49), arr: at(DAY, 12, 5), from: 'Merbraine', to: 'Gare du Midi' },
    { walk: 2, to: 'Gare du Midi' },
    { ride: '2', mode: 'metro', dep: at(DAY, 12, 10), arr: at(DAY, 12, 18), from: 'Gare du Midi', to: 'Simonis' },
    { walk: 4 },
  ]);
  j.legs[1] = { ...j.legs[1], rt: false };
  return j;
}

describe('PRD-1.3.0 § 7 : l’accordéon des favoris, contenu de l’équipe A, rendu de l’équipe B', () => {
  it('une seule mesure : la largeur où les lignes sont coupées (EXPAND_PX) est celle que leur donne la mise en page', () => {
    expect(EXPAND_PX).toBe(WIDTHS.expand);
    // en retrait de 20 px depuis la marge, jusqu'au bord sûr de l'écran
    expect(GEO.X_TEXT + HOME_INDENT + WIDTHS.expand).toBe(GEO.X_END - GEO.SAFETY);
  });

  it('l’exemple du PRD tient entier : « à pied 7 min, puis bus W ~11:49 », « 1 changement : métro 2 », pâles, en retrait ; ni filet ni ligne du détail', () => {
    const c = ctx({ now: LATE });
    const recent = [{ label: 'Place Saint-Lambert 1, 4000 Liège', lat: 50.6451, lon: 5.5734, at: 1 }];
    const entries: FavoriteEntry[] = [{ fav: PLACES.bureau, answer: ok(prdExample()) }];
    const v = favoritesView({ entries }, { ...c, settings: settingsWith([PLACES.bureau], { recent }) });
    expect(v.accordion).toBe(true);
    const ex = (v.items[0] as DetailItem).expand!.map((l) => nb(l.text));
    // 1.3.1 (PRD-1.3.1 § 4) : l'arrêt où monter, puis le premier véhicule, son heure et les changements
    expect(ex).toEqual(['à pied 7 min → Merbraine', 'bus W ~11:49, 1 changement : métro 2']);
    const g = geometry(v);
    const p = layoutPage(v, effectiveFrame(initNav({ screen: 'favorites' }).stack[0], v, g.capacity));
    hardware(p);
    // sous la rangée du curseur, les deux lignes entières (aucun « … »), puis l'intitulé des adresses récentes
    expect(p.lines.slice(0, 4).map(nb)).toEqual([expect.stringMatching(/^Bureau {3}/), ...ex, 'ADRESSES RÉCENTES']);
    const colB = container(p, 'colB');
    expect(colB.level).toBe(2);
    expect(colB.x).toBe(GEO.X_TEXT);
    const b = colB.content.split('\n');
    for (const [k, text] of ex.entries()) {
      const line = b[1 + k];
      expect(nb(line.trimStart())).toBe(text);
      // le texte commence au retrait (20 px) et finit avant le bord sûr
      const start = colB.x + textWidth(line) - textWidth(line.trimStart());
      expect(Math.abs(start - (GEO.X_TEXT + HOME_INDENT))).toBeLessThanOrEqual(1);
      expect(colB.x + textWidth(line)).toBeLessThanOrEqual(GEO.X_END - GEO.SAFETY);
    }
    // ni filet ni ligne du détail : le pied ne dit que les aides, aucune ligne de note réservée
    expect((container(p, 'top') as BorderedContainer).border).toBeUndefined();
    expect(container(p, 'top').content.trim()).toBe('');
    expect(rowsOf(container(p, 'foot'))).toEqual(['△▽ choisir   toucher : ouvrir   double : retour']);
    expect(g.noteLine).toBe(false);
    expect(v.log?.detail).toBeUndefined();
    // le curseur passe à l'adresse récente : l'accordéon du favori se referme, celui de l'adresse s'ouvre
    const s1 = handleGesture(setSelection(initNav({ screen: 'favorites' }), 0, 0), 'down', v, g.capacity).state;
    const q = layoutPage(v, effectiveFrame(current(s1), v, g.capacity));
    hardware(q);
    expect(q.lines.map(nb)).not.toContain(ex[0]);
    expect(q.lines.map(nb)).toContain('Place Saint-Lambert 1, 4000 Liège');
    expect((container(q, 'top') as BorderedContainer).border).toBeUndefined();
  });

  it('les noms et adresses les plus longs : la ligne de l’équipe A est dessinée telle quelle, jamais recoupée par la mise en page', () => {
    const LONG = ['Comines/komen Chaussée de Wervicq/Werviksesteenweg', 'Genk Ziekenhuis Oost-Limburg huisartsenwachtpost', 'Marchienne-au-Pont Puits St-Charles', 'Bruxelles-Aéroport-Zaventem'];
    for (const name of LONG) {
      const from = journey('st', [{ ride: 'IC', mode: 'train', dep: at(DAY, 11, 42), arr: at(DAY, 12, 30), from: name, to: 'Gand-Saint-Pierre', platform: '12a' }]);
      const works = { ...prdExample(), alerts: [{ kind: 'works' as const, text: `Travaux : ${name}`, at: LATE }] };
      const recent = [{ label: `${name} 1, 7780 Comines-Warneton, Hainaut, Belgique`, lat: 50.77, lon: 3.0, at: 1 }];
      const favs = [PLACES.bureau, { ...PLACES.parc }];
      const entries: FavoriteEntry[] = [
        { fav: PLACES.bureau, answer: { ...ok(from), fromStation: true } },
        { fav: favs[1], answer: { ...ok(works), favoriteId: favs[1].id } },
      ];
      const v = favoritesView({ entries }, ctx({ now: LATE, settings: settingsWith(favs, { recent }) }));
      const g = geometry(v);
      v.items.forEach((it, i) => {
        const ex = (it as DetailItem).expand ?? [];
        if (!ex.length) return;
        const p = layoutPage(v, effectiveFrame(setSelection(initNav({ screen: 'favorites' }), i, 0).stack[0], v, g.capacity));
        hardware(p);
        const at0 = p.lines.findIndex((l) => l === ex[0].text);
        expect(at0, `${name} : ${ex[0].text}`).toBeGreaterThan(0);
        expect(p.lines.slice(at0, at0 + ex.length)).toEqual(ex.map((e) => e.text));
        for (const e of ex) expect(textWidth(e.text)).toBeLessThanOrEqual(WIDTHS.expand);
      });
    }
  });
});

/* ------------------------------ Repère : la pire ligne d'action tient avec les aides ------------------------------ */

it('les heures du trajet de 9 étapes restent sous la ligne du haut, la dernière ligne au-dessus du bas de l’écran', () => {
  const v = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: ALL, index: 0, fresh: true }, ctx({ now: NOW - 30 * MIN }));
  const g = geometry(v);
  const p = layoutPage(v, effectiveFrame(initNav({ screen: 'steps', label: '' }).stack[0], v, g.capacity));
  hardware(p);
  expect(container(p, 'top').y + LINE_H).toBeLessThanOrEqual(g.rowsY);
  for (const c of p.containers) expect(c.y + c.h).toBeLessThanOrEqual(SCREEN_H - GEO.BOTTOM_MARGIN);
});
