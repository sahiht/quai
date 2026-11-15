/**
 * Quai 1.3.0, mise en page et navigation des lunettes (docs/v1.3.0/PRD-1.3.0.md § 1, § 2, § 5, § 7) : la ligne d'action
 * de l'écran du trajet (au plus clair, juste au-dessus des aides, une rangée de moins pour les étapes, au pixel), ▲ sur
 * la première rangée de « Autres trajets » (edgeUp), les noms coupés entre deux mots dans toute rangée (tableaux,
 * arrêts d'un départ, toute la ligne, « Autres trajets ») et les favoris en accordéon (la rangée du curseur ouverte,
 * entière à l'écran). Les vues sont fabriquées ici (leur contenu est fait par l'équipe des écrans) ; noms réels de lieux
 * publics seulement.
 */
import { describe, expect, it } from 'vitest';
import { validateEvenHubPageContainer } from '@evenrealities/even_hub_sdk';
import type { Journey } from '../../src/core/api';
import type { LineFollow, LineRun } from '../../src/core/linerun';
import { LINE_H, glyphSafe, hasGlyph, missingGlyphs, textWidth, truncate } from '../../src/glasses/font';
import {
  GEO,
  HOME_INDENT,
  LAYOUTS,
  WIDTHS,
  ensureVisible,
  expandLines,
  geometry,
  layoutPage,
  maxTop,
  openRow,
  pageTop,
  segRow,
  shapeKey,
  spread,
  truncateWords,
  visibleRange,
  withTail,
  type BorderedContainer,
  type DetailItem,
} from '../../src/glasses/layout';
import { current, effectiveFrame, handleGesture, initNav, setSelection, type NavState } from '../../src/glasses/nav';
import type { GlassesView, Item, PageSpec } from '../../src/glasses/types';
import { boardView, followsView, lineRunView, lineView, othersView, stepsPage, stopsView, trainRunView, type ViewCtx } from '../../src/glasses/views';
import { toTextProperty } from '../../src/platform/even';
import { cutKind, pageCuts } from '../scan/cuts';
import { MIN, at, boardOf, container, dep, journey, lineBoardOf, nb, overflowing, page, rowsOf, settingsWith, stopsOf, trainAt, trainRunOf } from './helpers';

const NOW = at('2026-11-10', 7, 31);
const T = (hh: number, mm: number) => at('2026-11-10', hh, mm);
const N = (fr: string) => ({ fr, nl: fr });
const ctx = (patch: Partial<ViewCtx> = {}): ViewCtx => ({ now: NOW, settings: settingsWith([]), ...patch });
const NB = ' ';

/** Les noms les plus longs des vraies données (arrêts TEC et De Lijn, gares) et des noms composés connus. */
const LONG = ['Comines/komen Chaussée de Wervicq/Werviksesteenweg', 'Genk Ziekenhuis Oost-Limburg huisartsenwachtpost', 'Marchienne-au-Pont Puits St-Charles', 'Tourinnes-la-Grosse Le Moulin', 'Louvain-la-Neuve Gare d’Autobus'];
const COMPOUND = ['Bruxelles-Central', 'Wervicq-Sud', 'Mont-Saint-Guibert', 'Bruxelles-Aéroport-Zaventem', 'Brussels Airport-Zaventem', 'Braine-l’Alleud'];

/** Page valide pour le matériel : 8 conteneurs de texte acceptés par le SDK, rien ne dépasse, jamais de tiret long. */
function hardware(p: PageSpec): void {
  expect(p.containers).toHaveLength(8);
  expect(overflowing(p)).toEqual([]);
  const sdkPage = { containerTotalNum: p.containers.length, textObject: p.containers.map(toTextProperty) };
  expect(validateEvenHubPageContainer(sdkPage)).toEqual({ valid: true });
  for (const l of [p.title, ...p.lines]) expect(l).not.toMatch(/[—–]/);
}

/** Coupes d'une page au milieu d'un mot (ou introuvables) : aucune attendue. */
const badCuts = (v: GlassesView, p: PageSpec) => pageCuts(v, p).filter((c) => c.kind === 'mid' || c.kind === 'unknown');

/* ------------------------------ § 1 : ligne d'action de l'écran du trajet ------------------------------ */

const STEPS_HINT = `△▽ étapes   double${NB}: retour`;
const ACTIONS = ['▶ Y aller', '▶ Retour au guidage', '▶ Suivre ce trajet', '▶ Trajet suivi'];

/** Écran du trajet de la 1.2.10 (proposition ouverte depuis « Autres trajets » : « Fin du trajet. ▽ autres trajets »). */
function stepsOf(j: Journey, patch: Partial<GlassesView> = {}): GlassesView {
  const v = stepsPage({ title: 'Vers Namur', label: '' }, { journeys: [j], index: 0, fresh: true, fromList: true }, ctx());
  return { ...v, hints: STEPS_HINT, ...patch };
}
const ic = journey('j-ic', [{ walk: 7, to: 'Braine-l’Alleud' }, { ride: 'IC', mode: 'train', dep: T(7, 42), arr: T(8, 31), from: 'Braine-l’Alleud', to: 'Namur', platform: '4' }, { walk: 3 }]);
/** Sept étapes : six rangées tiennent sans ligne d'action (1.2.10), cinq avec. */
const long = journey('j-long', [
  { walk: 5, to: 'Merbraine' },
  { ride: 'W', mode: 'bus', dep: T(7, 40), arr: T(7, 52), from: 'Merbraine', to: 'Braine-l’Alleud' },
  { walk: 2, to: 'Braine-l’Alleud' },
  { ride: 'IC', mode: 'train', dep: T(8, 2), arr: T(8, 20), from: 'Braine-l’Alleud', to: 'Bruxelles-Midi', platform: '3' },
  { ride: '2', mode: 'metro', dep: T(8, 30), arr: T(8, 38), from: 'Gare du Midi', to: 'Simonis' },
  { walk: 4 },
]);

describe('PRD-1.3.0 § 1 : ligne d’action, au plus clair, juste au-dessus des aides', () => {
  it('geometry : la ligne d’action prend une rangée à la liste ; la liste finit où commence le pied (même grille)', () => {
    const configs: Partial<GlassesView>[] = [
      { top: { text: 'Départ 07:35, dans 4 min' }, reserveNote: true, hints: STEPS_HINT },
      { top: { text: 'Départ 07:35, dans 4 min' }, reserveNote: false, hints: STEPS_HINT },
      { reserveNote: true, hints: STEPS_HINT },
      { reserveNote: true, hints: '', compactFoot: true },
    ];
    for (const c of configs) {
      const v = { top: undefined, note: undefined, reserveNote: false, ...c };
      const g0 = geometry(v);
      const g1 = geometry({ ...v, action: '▶ Y aller' });
      expect(g0.actionLine).toBe(false);
      expect(g1.actionLine).toBe(true);
      expect(g1.capacity).toBe(g0.capacity - 1);
      expect(g1.footLines).toBe(g0.footLines + 1);
      // la liste descend du reste (9 px) : sa dernière rangée touche la note, la ligne d'action tombe sur la grille du pied
      expect(g1.rowsY + g1.capacity * LINE_H).toBe(g1.footY);
      expect(g1.rowsY - g0.rowsY).toBe(9);
      // l'aide reste au bas de l'écran
      expect(g1.footY + g1.footLines * LINE_H).toBe(288 - GEO.BOTTOM_MARGIN);
    }
    // sans ligne d'action : la 1.2.10 telle quelle (étapes : ligne du haut, note, aides ; six rangées à y = 60)
    expect(geometry({ top: { text: 'x' }, note: undefined, reserveNote: true, hints: STEPS_HINT })).toMatchObject({ rowsY: 60, capacity: 6, footY: 231 });
    expect(geometry({ top: { text: 'x' }, note: undefined, reserveNote: true, hints: STEPS_HINT, action: ' ' }).actionLine).toBe(false);
  });

  it('écran du trajet : « ▶ Y aller » au plus clair entre « Fin du trajet. ▽ … » et les aides, au pixel, 8 conteneurs', () => {
    const v = stepsOf(ic, { action: '▶ Y aller' });
    const p = page(v);
    hardware(p);
    const g = geometry(v);
    const colA = container(p, 'colA');
    const foot = container(p, 'foot');
    // la colonne a (niveau 4) porte la ligne d'action : sa dernière ligne, sur la grille du pied, sous la note
    expect(colA.level).toBe(4);
    const aRows = rowsOf(colA);
    expect(aRows.at(-1)).toBe('▶ Y aller');
    expect(aRows).toHaveLength(g.capacity + 2);
    expect(colA.y + (aRows.length - 1) * LINE_H).toBe(foot.y + LINE_H);
    expect(colA.y + colA.h).toBe(foot.y + 2 * LINE_H);
    // le pied, pâle : la note (qui reste), la place de l'action vide, les aides en bas
    expect(foot.level).toBe(2);
    expect(rowsOf(foot)).toEqual(['Fin du trajet. ▽ autres trajets', '', STEPS_HINT.replace(NB, ' ')]);
    expect(foot.y + 2 * LINE_H).toBe(258);
    // la liste : une rangée de moins, sur la même grille (curseur et colonnes)
    for (const name of ['cursor', 'colB', 'colC']) expect(container(p, name).y).toBe(colA.y);
    expect(container(p, 'colB').h).toBe(g.capacity * LINE_H);
    expect(g.capacity).toBe(5);
    // journal : la note, la ligne d'action, les aides, dans l'ordre de l'écran
    expect(p.lines.slice(-3).map(nb)).toEqual(['Fin du trajet. ▽ autres trajets', '▶ Y aller', nb(STEPS_HINT)]);
  });

  it('les quatre lignes d’action : glyphes de la police (« ▶ » : 20 px), au pixel dans la largeur de l’écran', () => {
    expect(hasGlyph(0x25b6)).toBe(true);
    expect(textWidth('▶')).toBe(20);
    for (const a of ACTIONS) {
      expect(missingGlyphs(a)).toEqual([]);
      expect(glyphSafe(a)).toBe(a);
      expect(textWidth(a)).toBeLessThanOrEqual(WIDTHS.full);
      const p = page(stepsOf(ic, { action: a }));
      hardware(p);
      expect(rowsOf(container(p, 'colA')).at(-1)).toBe(a);
    }
  });

  it('toucher sans effet : pas de ligne d’action, l’écran de la 1.2.10 ; la ligne qui paraît reconstruit la page', () => {
    const without = page(stepsOf(ic));
    const withAction = page(stepsOf(ic, { action: '▶ Y aller' }));
    hardware(without);
    expect(container(without, 'colA').y).toBe(60);
    expect(rowsOf(container(without, 'foot'))).toEqual(['Fin du trajet. ▽ autres trajets', STEPS_HINT.replace(NB, ' ')]);
    expect(without.lines.map(nb)).not.toContain('▶ Y aller');
    expect(shapeKey(withAction)).not.toBe(shapeKey(without));
    // le texte change sans changer la forme (« ▶ Y aller » puis « ▶ Retour au guidage ») : mise à jour sans reconstruire
    expect(shapeKey(page(stepsOf(ic, { action: '▶ Retour au guidage' })))).toBe(shapeKey(withAction));
  });

  it('▲▼ : une rangée de moins pour les étapes (la capacité de la navigation vient de geometry, ligne d’action comprise)', () => {
    const go = (v: GlassesView, g: 'up' | 'down', s: NavState = initNav({ screen: 'steps', label: '' })) => handleGesture(s, g, v, geometry(v).capacity);
    const plain = stepsOf(long);
    const acted = stepsOf(long, { action: '▶ Y aller' });
    expect(plain.items).toHaveLength(6);
    // sans ligne d'action, les six étapes tiennent : ▼ est au bout (Autres trajets)
    expect(go(plain, 'down').effect).toEqual({ kind: 'edge', dir: 'down' });
    // avec elle, cinq rangées : ▼ montre la sixième, puis le bout
    const first = go(acted, 'down');
    expect(first.effect).toEqual({ kind: 'render' });
    const f = effectiveFrame(current(first.state), acted, geometry(acted).capacity);
    expect(f.top).toBe(1);
    const p = layoutPage(acted, f);
    hardware(p);
    expect(p.visible).toBe(5);
    expect(go(acted, 'down', first.state).effect).toEqual({ kind: 'edge', dir: 'down' });
  });

  it('message temporaire : il prend la ligne d’aide, la ligne d’action reste ; pied sans aide : l’action en dernière ligne', () => {
    const v = stepsOf(ic, { action: '▶ Suivre ce trajet' });
    const p = layoutPage(v, effectiveFrame(initNav({ screen: 'home' }).stack[0], v, geometry(v, true).capacity), { toast: '★ Ajouté aux favoris' });
    hardware(p);
    expect(rowsOf(container(p, 'foot')).at(-1)).toBe('★ Ajouté aux favoris');
    expect(rowsOf(container(p, 'colA')).at(-1)).toBe('▶ Suivre ce trajet');
    const compact = { ...v, hints: '', compactFoot: true, reserveNote: false, note: undefined };
    const q = page(compact);
    hardware(q);
    const a = container(q, 'colA');
    expect(a.y + a.h).toBe(288 - GEO.BOTTOM_MARGIN);
    expect(rowsOf(a).at(-1)).toBe('▶ Suivre ce trajet');
  });
});

/* ------------------------------ § 2 : ▲ pour revenir des autres trajets ------------------------------ */

const OTHERS_HINT = `△▽ choisir   toucher${NB}: ouvrir   double${NB}: retour`;
function othersLike(n: number, patch: Partial<GlassesView> = {}): GlassesView {
  const items: Item[] = Array.from({ length: n }, (_, i) => ({ a: i ? 'Autre trajet' : 'Plus tôt', c: `07:4${i} → 08:3${i}`, b2: 'bus W + IC, à pied 5 + 4 min', action: { kind: 'open', route: { screen: 'home' } } }));
  return { screen: 'others', layout: 'others', title: 'Vers Namur : autres trajets', clock: '07:31', items, hints: OTHERS_HINT, edgeUp: true, ...patch };
}

describe('PRD-1.3.0 § 2 : ▲ sur la première rangée de « Autres trajets » rend edge (vers le haut)', () => {
  it('edgeUp : ▲ sur la première rangée → { edge, up }, état inchangé (au premier affichage comme après un geste)', () => {
    const v = othersLike(3);
    const cap = geometry(v).capacity;
    const s0 = initNav({ screen: 'others', title: 't', journeys: [], index: 0 });
    const r0 = handleGesture(s0, 'up', v, cap);
    expect(r0.effect).toEqual({ kind: 'edge', dir: 'up' });
    expect(r0.state).toBe(s0);
    // ▼ puis ▲ : retour sur la première rangée (rendu), puis ▲ : edge
    const d = handleGesture(s0, 'down', v, cap);
    expect(current(d.state).sel).toBe(1);
    const u = handleGesture(d.state, 'up', v, cap);
    expect(u.effect).toEqual({ kind: 'render' });
    expect(current(u.state).sel).toBe(0);
    const e = handleGesture(u.state, 'up', v, cap);
    expect(e.effect).toEqual({ kind: 'edge', dir: 'up' });
    expect(e.state).toBe(u.state);
  });

  it('sans edgeUp : ▲ sur la première rangée reste sans effet (1.2.10) ; ▼ au bout : sans effet, jamais edge', () => {
    const v = othersLike(3, { edgeUp: undefined });
    const s0 = setSelection(initNav({ screen: 'others', title: 't', journeys: [], index: 0 }), 0, 0);
    expect(handleGesture(s0, 'up', v, geometry(v).capacity).effect).toEqual({ kind: 'none' });
    const withEdge = othersLike(3);
    const last = setSelection(s0, 2, 0);
    expect(handleGesture(last, 'down', withEdge, geometry(withEdge).capacity).effect).toEqual({ kind: 'none' });
  });

  it('la vraie vue « Autres trajets » : edgeUp posé par l’équipe des écrans, la navigation le respecte', () => {
    const js = [ic, long, journey('j-3', [{ walk: 9 }, { ride: 'L', mode: 'train', dep: T(7, 55), arr: T(8, 49), from: 'Braine-l’Alleud', to: 'Namur', platform: '1' }])];
    const v = { ...othersView({ screen: 'others', title: 'Vers Namur', journeys: js, index: 0 }, js, ctx()), edgeUp: true };
    const s0 = initNav({ screen: 'others', title: 'Vers Namur', journeys: js, index: 0 });
    expect(handleGesture(s0, 'up', v, geometry(v).capacity).effect).toEqual({ kind: 'edge', dir: 'up' });
  });
});

/* ------------------------------ § 5 : noms coupés entre deux mots, partout ------------------------------ */

describe('PRD-1.3.0 § 5 : toute rangée coupe un nom trop long au mot ; heures, état et voies jamais coupés', () => {
  it('tableau d’un arrêt : la destination coupée au mot, « , dernier » et l’attente entières', () => {
    for (const name of [...LONG, ...COMPOUND]) {
      const v = boardView(boardOf('tec:X', 'Merbraine', [dep(NOW, 5, { head: N(name), line: '163b' }), dep(NOW, 9, { head: N(name), last: true })]), ctx(), { kept: false });
      const p = page(v);
      hardware(p);
      expect(badCuts(v, p)).toEqual([]);
      const rows = p.lines.slice(1, 3).map(nb);
      expect(rows[0]).toMatch(/   5 min$/);
      expect(rows[1]).toMatch(/, dernier   9 min$/);
    }
    // le nom le plus long, coupé après un morceau entier du nom composé (« Wervicq/… »), jamais au milieu d'un mot
    const v = boardView(boardOf('tec:X', 'Merbraine', [dep(NOW, 5, { head: N(LONG[0]), line: '163b' })]), ctx(), { kept: false });
    expect(nb(page(v).lines[1])).toBe('163b   Comines/komen Chaussée de Wervicq/…   5 min');
  });

  it('tableau d’une gare : « demain, » et la destination coupés au mot, l’heure, la voie et « SUPPRIMÉ » entiers', () => {
    for (const name of [...LONG, ...COMPOUND]) {
      const v = boardView(boardOf('sncb:X', 'Namur', [trainAt(NOW, 11, { head: N(name), platform: '12', newPlatform: '12', delayMin: 12, est: NOW + 23 * MIN }), trainAt(NOW, 24 * 60, { head: N(name), cancelled: true })]), ctx(), { kept: false });
      const p = page(v);
      hardware(p);
      expect(badCuts(v, p)).toEqual([]);
      const rows = p.lines.slice(1, 3).map(nb);
      expect(rows[0]).toMatch(/07:42 \+12  voie 12 !$/);
      expect(rows[1]).toMatch(/07:31  SUPPRIMÉ$/);
    }
  });

  it('arrêts d’un départ : le nom coupé au mot, l’heure et « SUPPRIMÉ » entiers ; l’arrêt du haut aussi', () => {
    for (const name of [...LONG, ...COMPOUND]) {
      const ds = stopsOf({ op: 'tec', mode: 'bus', line: 'W', head: N('Wavre') }, NOW, [[name, 1], [name, 5, { cancelled: true }], [name, 9, { delayMin: 3 }]]);
      const v = stopsView({ screen: 'stops', areaId: 'tec:X', dep: dep(NOW, 1) }, ds, ctx());
      const p = page(v);
      hardware(p);
      expect(badCuts(v, p)).toEqual([]);
      expect(nb(p.lines[1])).toMatch(/^07:36   .*   SUPPRIMÉ$/);
      expect(nb(p.lines[2])).toMatch(/^07:40 \+3   /);
    }
  });

  it('tout le trajet d’un train : le nom coupé au mot pour laisser la voie entière (Seg.keep) et le passage à droite', () => {
    for (const name of [...LONG, ...COMPOUND]) {
      const ds = trainRunOf({ op: 'sncb', mode: 'train', line: 'IC', head: N('Namur') }, NOW, [['Braine-l’Alleud', 2, { platform: '4' }], [name, 30, { platform: '12a', newPlatform: '12b' }], [name, 60, { cancelled: true }]], 0);
      const v = trainRunView(ds, ctx());
      const p = page(v);
      hardware(p);
      expect(badCuts(v, p)).toEqual([]);
      const ls = p.lines.map(nb);
      expect(ls.find((l) => l.includes('dans 30 min'))).toMatch(/ voie 12b !   dans 30 min$/);
      expect(ls.find((l) => l.includes('SUPPRIMÉ'))).toMatch(/   SUPPRIMÉ$/);
    }
    // le nom très long est bien coupé (au mot), et la voie reste ; sans « keep », la voie serait coupée
    const ds = trainRunOf({ op: 'sncb', mode: 'train', line: 'IC', head: N('Namur') }, NOW, [['Namur', 2], [LONG[2], 30, { platform: '12a', newPlatform: '12b' }]], 0);
    expect(page(trainRunView(ds, ctx())).lines.map(nb).find((l) => l.includes('dans 30 min'))).toBe('○ Marchienne-au-Pont Puits St-… voie 12b !   dans 30 min');
    const segs = [{ t: '○', hi: true }, { t: LONG[2], hi: true }];
    expect(nb(segRow([...segs, { t: `voie 12b${NB}!` }], 0, 'dans 30 min', LAYOUTS.lines).log)).toMatch(/St-Charles voie…   dans 30 min$/);
    expect(nb(segRow([...segs, { t: `voie 12b${NB}!`, keep: true }], 0, 'dans 30 min', LAYOUTS.lines).log)).toMatch(/St-… voie 12b !   dans 30 min$/);
  });

  it('passages d’une ligne et « Lignes » : « vers … », « jusqu’à … » et la destination coupés au mot, l’attente entière', () => {
    for (const name of [...LONG, ...COMPOUND]) {
      const b = lineBoardOf('tec:Bbrlmer1', 'Merbraine', 'W', [{ head: 'Wavre', departures: [dep(NOW, 4, { head: N(name), delayMin: 3, est: NOW + 7 * MIN }), dep(NOW, 9, { head: N(name), partial: true })] }]);
      const v = lineView({ screen: 'line', areaId: 'tec:Bbrlmer1', op: 'tec', line: 'W', name: N('Merbraine') }, b, ctx());
      const p = page(v);
      hardware(p);
      expect(badCuts(v, p)).toEqual([]);
      expect(p.lines.map(nb).filter((l) => /dans 7 min$|dans 9 min$/.test(l))).toHaveLength(2);
      const f: LineFollow = { id: 'f', op: 'tec', mode: 'bus', line: '163b', routes: [] };
      const fv = followsView([{ follow: f, mode: 'bus', heads: [N(name), N('Wavre')] }], ctx());
      const q = page(fv);
      hardware(q);
      expect(badCuts(fv, q)).toEqual([]);
    }
  });

  it('toute la ligne : le nom de chaque arrêt coupé au mot, le prochain passage entier', () => {
    const names = [...LONG, ...COMPOUND];
    const run: LineRun = {
      op: 'tec', mode: 'bus', line: '163b', heads: [N(LONG[1]), N('Wavre')], dir: 0, other: 1, rtError: false, state: 'ok',
      stops: names.map((n, i) => ({ areaId: `tec:s${i}`, name: N(n), lat: 50.8, lon: 4.3, next: [{ t: NOW + (i + 1) * 4 * MIN, rt: i % 2 === 0 }], vehicle: i === 2, branch: i === 3 })),
      nearest: { index: 1, distanceM: 80 },
    };
    const v = lineRunView({ screen: 'lineRun', follow: 'f', dir: 0 }, { id: 'f', op: 'tec', mode: 'bus', line: '163b', routes: [] }, run, ctx());
    for (let top = 0; top < v.items.length; top += 3) {
      const p = layoutPage(v, { sel: top, top });
      hardware(p);
      expect(badCuts(v, p)).toEqual([]);
      const rows = p.lines.slice(v.top ? 1 : 0, (v.top ? 1 : 0) + p.visible).map(nb);
      expect(rows.length).toBeGreaterThan(0);
      for (const l of rows) if (/^[○●◆◇] /.test(l)) expect(l).toMatch(/   dans ~?\d+ min$/);
    }
  });

  it('« Autres trajets » : le nom de la proposition et sa 2e ligne coupés au mot, les heures entières', () => {
    const v = othersLike(2);
    v.items[0] = { ...v.items[0], a: `Plus tôt par ${LONG[0]}`, c: 'demain 06:20 → 06:46', b2: `bus 163b + IC, à pied 5 + 4 min, par ${LONG[1]} et ${COMPOUND[3]}` };
    const p = page(v);
    hardware(p);
    expect(badCuts(v, p)).toEqual([]);
    expect(nb(p.lines[0])).toMatch(/…   demain 06:20 → 06:46$/);
    expect(p.lines[1]).toContain('…');
  });

  it('un séparateur isolé (« - », « / ») ne finit jamais un nom coupé (noms réels du TEC et de De Lijn)', () => {
    for (const name of ['Arlon TEC - Rue Sainte-Croix', '’s Gravenvoeren Kerk / Eglise', 'Andenne Ville - 4 coins', 'Bredene Café De Zeemeeuw / Breeweg']) {
      for (let w = 60; w < textWidth(name); w += 2) {
        const t = truncateWords(name, w);
        expect(t, `${name} à ${w} px`).not.toMatch(/\s[-/]…$/);
        expect(textWidth(t)).toBeLessThanOrEqual(w);
      }
    }
    expect(truncateWords('Arlon TEC - Rue Sainte-Croix', textWidth('Arlon TEC - Rue…') - 1)).toBe('Arlon TEC…');
  });

  it('un premier mot seul trop long reste coupé au caractère (aucune autre issue), jamais vide', () => {
    const word = 'Werviksesteenweg';
    expect(truncateWords(word, 90)).toMatch(/^Wervik.*…$/);
    expect(cutKind(truncateWords(word, 90).slice(0, -1), word)).toBe('first');
    expect(withTail(word, ', dernier', 150)).toMatch(/^Wervi.*…, dernier$/);
    expect(spread(word, '12 min', 150, 10).left).toMatch(/…$/);
  });

  it('chemin commun (withTail, spread, segRow) : à toute largeur, jamais au milieu d’un mot (sauf un premier mot seul)', () => {
    const names = [...LONG, ...COMPOUND];
    let cut = 0;
    for (const name of names) {
      const full = truncate(name, Number.MAX_SAFE_INTEGER);
      for (let w = 40; w <= 420; w += 3) {
        for (const shown of [withTail(name, undefined, w), withTail(name, ', dernier', w + 60).replace(/, dernier$/, ''), spread(name, '12 min', w + 70, 10).left]) {
          if (!shown.endsWith('…')) continue;
          cut++;
          const kind = cutKind(shown.slice(0, -1), full);
          expect(kind === 'word' || (kind === 'first' && !/[ \-/’']/.test(shown.slice(0, -1))), `${name} à ${w} px : ${shown}`).toBe(true);
        }
        // segRow : le nom d'un arrêt après son repère, la largeur réduite par le retrait
        const row = segRow([{ t: '○', hi: true }, { t: name, hi: true }], Math.max(0, 420 - w), 'dans 5 min', LAYOUTS.lines);
        const m = /^○ (.*)…   dans 5 min$/.exec(nb(row.log));
        if (m) {
          cut++;
          const kind = cutKind(m[1], full);
          expect(kind === 'word' || kind === 'first', `${name}, segRow à ${w} px : ${row.log}`).toBe(true);
        }
      }
    }
    expect(cut).toBeGreaterThan(500);
  });
});

describe('PRD-1.3.0 § 5 : le compteur des balayages (rangées coupées au milieu d’un mot)', () => {
  it('cutKind sur des noms réels : au mot, après un morceau d’un nom composé, au milieu d’un mot, premier mot seul', () => {
    expect(cutKind('Bruxelles-', 'Bruxelles-Central')).toBe('word');
    expect(cutKind('Bruxelles-Cen', 'Bruxelles-Central')).toBe('mid');
    expect(cutKind('Wervicq-', 'Wervicq-Sud')).toBe('word');
    expect(cutKind('Wervicq-S', 'Wervicq-Sud')).toBe('mid');
    expect(cutKind('Mont-Saint-', 'Mont-Saint-Guibert')).toBe('word');
    expect(cutKind('Mont-Sai', 'Mont-Saint-Guibert')).toBe('mid');
    expect(cutKind('Comines/komen Chaussée de', LONG[0])).toBe('word');
    expect(cutKind('Comines/komen Chaussée de Wervicq/', LONG[0])).toBe('word');
    expect(cutKind('Comines/komen Chaussée de Wervicq/Wervik', LONG[0])).toBe('mid');
    expect(cutKind('Braine-l’', 'Braine-l’Alleud')).toBe('word');
    expect(cutKind('Werviksestee', 'Werviksesteenweg')).toBe('first');
  });

  it('pageCuts compte la coupe au caractère de la 1.2.10 et pas la coupe au mot de la 1.3.0', () => {
    const v = boardView(boardOf('tec:X', 'Merbraine', [dep(NOW, 5, { head: N(LONG[0]), line: '163b' }), dep(NOW, 7, { head: N('Bruxelles-Central'), line: '163b' })]), ctx(), { kept: false });
    const p = page(v);
    expect(pageCuts(v, p).map((c) => c.kind)).toEqual(['word']);
    // la même rangée coupée comme en 1.2.10 (au caractère, à la même largeur) : comptée au milieu d'un mot
    // la place de la destination dans un tableau d'arrêt (colonne b, jusqu'à l'attente)
    const room = LAYOUTS.board.c.x - GEO.GAP - LAYOUTS.board.b.x - GEO.SAFETY;
    const old = { ...p, lines: [p.lines[0], `163b   ${truncate(LONG[0], room)}   5 min`, `163b   ${truncate('Bruxelles-Central', 120)}   7 min`] };
    expect(truncate(LONG[0], room)).not.toBe(truncateWords(LONG[0], room));
    expect(pageCuts(v, old).map((c) => c.kind)).toEqual(['mid', 'mid']);
    // deux noms voisins au même début (balayage des vraies données, De Lijn 589) : chaque rangée jugée sur son propre nom
    const near = ['Meensel-Kiezegem Meensel Gemeentehuis', 'Meensel-Kiezegem Meenselbaan'];
    const run: LineRun = {
      op: 'delijn', mode: 'bus', line: '589', heads: [N('Gare de Tirlemont')], dir: 0, rtError: false, state: 'ok',
      stops: near.map((n, i) => ({ areaId: `delijn:m${i}`, name: N(n), lat: 50.9, lon: 4.9, next: [] })),
    };
    const lv = lineRunView({ screen: 'lineRun', follow: 'f', dir: 0 }, { id: 'f', op: 'delijn', mode: 'bus', line: '589', routes: [] }, run, ctx());
    const lp = layoutPage(lv, { sel: 1, top: 0 });
    hardware(lp);
    expect(lp.lines.map(nb)[0]).toMatch(/^○ Meensel-Kiezegem Meensel…   /);
    expect(pageCuts(lv, lp).map((c) => [c.kind, c.full])).toEqual([['word', `○ ${near[0]}`]]);
    // un « … » qui fait partie du texte (calcul en cours, « + … ») n'est pas une coupe
    const busy: GlassesView = { ...othersLike(1), items: [{ a: 'Bureau', c: '…', b2: 'bus 36 + IC + …, 13 min plus tôt' }] };
    expect(pageCuts(busy, page(busy))).toEqual([]);
  });
});

/* ------------------------------ § 7 : favoris en accordéon ------------------------------ */

const FAV_HINT = `△▽ choisir   toucher${NB}: ouvrir   double${NB}: retour`;
const fav = (name: string, c: string, expand?: (string | { text: string; planned?: boolean })[], extra: Partial<DetailItem> = {}): DetailItem => ({
  a: name,
  c,
  action: { kind: 'toast', text: name },
  ...(expand ? { expand: expand.map((e) => (typeof e === 'string' ? { text: e } : e)) } : {}),
  ...extra,
});
/** Favoris d'essai : lieux publics ; « tu y es » et « Autre adresse » ne s'ouvrent pas. */
function favorites(): DetailItem[] {
  return [
    fav('Bureau', 'dans 3 min → 08:58', ['à pied 7 min, puis bus W ~11:49', '1 changement : métro 2']),
    fav('Gare de Namur', 'dans 9 min → 09:41', ['à pied 4 min, puis IC 07:42 voie 6 !', 'voie 6 au lieu de 4']),
    fav('Grand-Place', 'tu y es'),
    fav('Atomium', 'dans 12 min → 08:51', ['à pied 2 min, puis tram 7 ~07:45', 'direct']),
    fav('Gare de Liège-Guillemins', 'dans 21 min → 10:02', ['IC voie 4 à 11:42, à Bruxelles-Central']),
    fav('Bois de la Cambre', 'à pied 23 min', ['à pied 23 min']),
    fav('Place Flagey', 'dans 6 min → 08:12', ['à pied 3 min, puis bus 38 ~07:40', '2 changements : métro 2, tram 3']),
    fav('Cinquantenaire', 'dans 8 min → 08:20', ['à pied 6 min, puis métro 1 07:45', 'direct']),
    fav('Place Saint-Lambert', 'dans 31 min → 10:05', [`${LONG[0]} 1, 7780 Comines-Warneton`], { head: 'Adresses récentes' }),
    fav('Autre adresse', 'sur le téléphone'),
  ];
}
function accordion(items: DetailItem[] = favorites(), patch: Partial<GlassesView> = {}): GlassesView {
  return { screen: 'favorites', layout: 'favorites', title: 'Favoris', clock: '07:31', items, hints: FAV_HINT, reserveNote: true, accordion: true, log: {}, ...patch };
}
const pad = ' '.repeat(Math.round(HOME_INDENT / 5));

describe('PRD-1.3.0 § 7 : favoris en accordéon, la rangée du curseur ouverte', () => {
  it('sous la rangée du curseur, ses lignes pâles en retrait ; les autres fermées ; pas de ligne du détail ni de filet', () => {
    const v = accordion();
    const p = layoutPage(v, { sel: 0, top: 0 });
    hardware(p);
    expect(p.lines.slice(0, 4).map(nb)).toEqual(['Bureau   dans 3 min → 08:58', 'à pied 7 min, puis bus W ~11:49', '1 changement : métro 2', 'Gare de Namur   dans 9 min → 09:41']);
    const b = rowsOf(container(p, 'colB'));
    expect(b[1]).toBe(`${pad}à pied 7 min, puis bus W ~11:49`);
    expect(b[2]).toBe(`${pad}1 changement : métro 2`);
    expect(container(p, 'colB').level).toBe(2);
    expect(rowsOf(container(p, 'cursor')).filter((r) => r.trim())).toEqual(['▶']);
    expect(rowsOf(container(p, 'cursor'))[0]).toBe('▶');
    // les autres favoris restent sur une ligne : « Gare de Namur » ne montre pas son détail
    expect(p.lines.map(nb)).not.toContain('voie 6 au lieu de 4');
    // ni ligne du détail en bas, ni filet : le pied ne dit que les aides
    expect((container(p, 'top') as BorderedContainer).border).toBeUndefined();
    expect(rowsOf(container(p, 'foot'))).toEqual([FAV_HINT.replace(/ /g, ' ')]);
    expect(v.log?.detail).toBeUndefined();
    expect(geometry(v).noteLine).toBe(false);
  });

  it('la hauteur d’une rangée dépend du curseur : 2 lignes de plus sous Bureau, rien sous « tu y es » ni « Autre adresse »', () => {
    const v = accordion();
    const cap = geometry(v).capacity;
    expect(cap).toBe(8);
    expect(openRow(v, 0)).toEqual({ at: 0, lines: 2 });
    expect(openRow(v, 4)).toEqual({ at: 4, lines: 1 });
    expect(openRow(v, 2)).toBeUndefined();
    expect(openRow(v, 9)).toBeUndefined();
    expect(openRow({ ...v, accordion: false }, 0)).toBeUndefined();
    expect(visibleRange(v.items, 0, cap, openRow(v, 0))).toEqual({ from: 0, to: 6 });
    expect(visibleRange(v.items, 0, cap, openRow(v, 2))).toEqual({ from: 0, to: 8 });
    expect(layoutPage(v, { sel: 2, top: 0 }).visible).toBe(8);
    // deux lignes au plus, celles qui ont un texte
    expect(expandLines(fav('x', 'y', ['un', ' ', 'deux', 'trois']))).toEqual([{ text: 'un' }, { text: 'deux' }]);
  });

  it('▲▼ : la rangée ouverte toujours entière à l’écran, d’un bout à l’autre de la liste et retour', () => {
    const v = accordion();
    const cap = geometry(v).capacity;
    let s = initNav({ screen: 'favorites' });
    const check = (): void => {
      const f = effectiveFrame(current(s), v, cap);
      const p = layoutPage(v, f);
      hardware(p);
      // la navigation garde le défilement que montre la page (hauteurs réelles des deux côtés) : ▲ après ▼ ne saute pas
      expect(current(s).top).toBe(p.top);
      expect(f.top).toBe(p.top);
      const cursor = rowsOf(container(p, 'cursor'));
      const r = cursor.indexOf('▶');
      expect(r).toBeGreaterThanOrEqual(0);
      const ex = expandLines(v.items[f.sel]);
      // les lignes de l'accordéon juste sous la rangée du curseur, dans la liste (jamais coupées par le bas de l'écran)
      expect(r + ex.length).toBeLessThan(cap);
      const b = rowsOf(container(p, 'colB'));
      ex.forEach((e, k) => expect(b[r + 1 + k].trim()).toBe(nb(truncateWords(e.text, 572 - 28 - HOME_INDENT - 2)).trim()));
      expect(badCuts(v, p)).toEqual([]);
    };
    check();
    for (let k = 0; k < 12; k++) {
      s = handleGesture(s, 'down', v, cap).state;
      check();
    }
    expect(current(s).sel).toBe(9);
    for (let k = 0; k < 12; k++) {
      s = handleGesture(s, 'up', v, cap).state;
      check();
    }
    expect(current(s).sel).toBe(0);
  });

  it('ensureVisible, pageTop et maxTop comptent la rangée ouverte entière', () => {
    const items: Item[] = Array.from({ length: 10 }, (_, i) => ({ a: `Lieu ${i + 1}` }));
    // curseur sur la 5e rangée (rang 4), ouverte sur 2 lignes, 5 lignes à l'écran : la liste commence au rang 2
    expect(ensureVisible(items, 4, 0, 5)).toBe(0);
    expect(ensureVisible(items, 4, 0, 5, { at: 4, lines: 2 })).toBe(2);
    // page suivante : la rangée ouverte qui ne tient plus en entier ouvre la page suivante
    expect(pageTop(items, 4, 0, 5)).toBe(0);
    expect(pageTop(items, 4, 0, 5, { at: 4, lines: 1 })).toBe(4);
    expect(pageTop(items, 3, 4, 5, { at: 3, lines: 2 })).toBe(1);
    expect(maxTop(items, 5, { at: 9, lines: 2 })).toBe(7);
  });

  it('reserveNote ne garde plus de ligne vide en accordéon ; une note la garde ; une ligne prévue (« ~ ») dit la note', () => {
    const items = favorites();
    expect(geometry(accordion(items)).capacity).toBe(geometry(accordion(items, { accordion: false })).capacity + 1);
    expect(geometry(accordion(items, { note: '~ horaire prévu, sans temps réel' })).noteLine).toBe(true);
    items[0] = fav('Bureau', 'dans 3 min → 08:58', [{ text: 'à pied 7 min, puis bus W ~11:49', planned: true }, '1 changement : métro 2']);
    const v = accordion(items, { notePlanned: '~ horaire prévu, sans temps réel' });
    const on = layoutPage(v, effectiveFrame(setSelection(initNav({ screen: 'favorites' }), 0, 0).stack[0], v, geometry(v).capacity));
    hardware(on);
    expect(rowsOf(container(on, 'foot'))[0]).toBe('~ horaire prévu, sans temps réel');
    const off = layoutPage(v, { sel: 1, top: 0 });
    expect(rowsOf(container(off, 'foot'))[0]).toBe('');
  });

  it('une ligne de l’accordéon trop longue : coupée au mot, en retrait, dans la largeur ; l’adresse récente sous son intitulé', () => {
    const v = accordion();
    const f = effectiveFrame(setSelection(initNav({ screen: 'favorites' }), 8, 0).stack[0], v, geometry(v).capacity);
    const p = layoutPage(v, f);
    hardware(p);
    const ls = p.lines.map(nb);
    const at8 = ls.indexOf('Place Saint-Lambert   dans 31 min → 10:05');
    expect(ls[at8 - 1]).toBe('Adresses récentes');
    expect(ls[at8 + 1]).toMatch(/^Comines\/komen Chaussée de Wervicq\/.*…$|^Comines\/komen Chaussée de.*…$/);
    expect(badCuts(v, p)).toEqual([]);
  });

  it('sans accordéon (1.2.10) : la ligne du détail en bas et son filet, comme avant', () => {
    const items = favorites().map((it) => ({ ...it, detail: it.expand?.[0]?.text }));
    const v = accordion(items, { accordion: undefined });
    const p = layoutPage(v, { sel: 0, top: 0 });
    hardware(p);
    expect(rowsOf(container(p, 'foot'))[0]).toBe('à pied 7 min, puis bus W ~11:49');
    expect((container(p, 'top') as BorderedContainer).border).toEqual({ width: 1, level: 2 });
    expect(p.lines.map(nb)).not.toContain('1 changement : métro 2');
  });
});
