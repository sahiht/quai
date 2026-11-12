/**
 * Quai 1.2.4, côté lunettes (docs/v1.2.4/PRD-1.2.4.md § 1 et § 4) : l'arrêt ou la gare où aller, en entier ; pages
 * des étapes comptées en lignes ; heures alignées à droite dans leur case (le « ~ » d'un horaire prévu dépasse à
 * gauche) ; aides en triangles vides. Des gares, des arrêts et des lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import { textWidth } from '../../src/glasses/font';
import { HINTS } from '../../src/glasses/format';
import { GEO, LAYOUTS, geometry, layoutPage, leadCell, visibleRange, prevPageTop } from '../../src/glasses/layout';
import { handleGesture, initNav } from '../../src/glasses/nav';
import type { ContainerSpec, GlassesView } from '../../src/glasses/types';
import { boardView, lineView, stepsPage, stopsView, type ViewCtx } from '../../src/glasses/views';
import { at, boardOf, dep, journey, lineBoardOf, lines, nb, settingsWith, stopsOf, trainAt } from './helpers';

const DAY = '2026-11-12';
const NOW = at(DAY, 13, 24);
const T = (hh: number, mm: number) => at(DAY, hh, mm);
const ctx = (patch: Partial<ViewCtx> = {}): ViewCtx => ({ now: NOW, settings: settingsWith([]), ...patch });
const steps = (j: ReturnType<typeof journey>, top?: number) => stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [j], index: 0, fresh: top === undefined, top }, ctx());

/** Bord droit (px) de chaque ligne non vide d'un conteneur, et le début de son texte. */
function edges(c: ContainerSpec): { right: number; start: number; text: string }[] {
  return c.content
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => ({ right: c.x + textWidth(l), start: c.x + textWidth(l) - textWidth(l.trimStart()), text: l.trim() }));
}
const container = (v: GlassesView, name: string, sel = 0, top = 0) => layoutPage(v, { sel, top }).containers.find((c) => c.name === name)!;

describe('PRD-1.2.4 § 1 : l’arrêt ou la gare où aller, en entier', () => {
  // Un trajet de Quai : à pied jusqu'à l'arrêt, bus W jusqu'à la gare, à pied, IC jusqu'à Bruxelles-Midi, métro.
  const j = journey('w', [
    { walk: 7, to: 'Braine-l’Alleud Route de Mont-Saint-Jean' },
    { ride: 'W', mode: 'bus', dep: T(13, 32), arr: T(13, 41), from: 'Braine-l’Alleud Route de Mont-Saint-Jean', to: 'Braine-l’Alleud, Gare' },
    { walk: 1, to: 'Braine-l’Alleud' },
    { ride: 'IC', mode: 'train', dep: T(14, 1), arr: T(14, 16), from: 'Braine-l’Alleud', to: 'Bruxelles-Midi', platform: '2', head: 'Anvers-Central' },
    { walk: 3, to: 'Gare du Midi' },
    { ride: '2', mode: 'metro', dep: T(14, 22), arr: T(14, 27), from: 'Gare du Midi', to: 'Madou', head: 'Simonis' },
    { walk: 2 },
  ]);

  it('départ à pied : « Partir à pied vers l’arrêt (7 min) », puis le nom de l’arrêt en entier sur la ligne suivante', () => {
    const v = steps(j);
    const l = lines(v);
    expect(l[0]).toMatch(/^13:\d\d {3}Partir à pied vers l’arrêt \(7 min\)/);
    expect(l[1]).toBe('Braine-l’Alleud Route de Mont-Saint-Jean');
    expect(l[2]).toBe('13:32   Bus W vers Braine-l’Alleud, Gare');
    // le nom dans la colonne du texte des étapes, jamais coupé
    expect(v.items[0]).toMatchObject({ b: 'Partir à pied vers l’arrêt', b2: 'Braine-l’Alleud Route de Mont-Saint-Jean' });
    expect(nb(v.items[0].bTail ?? '')).toBe(' (7 min)');
    expect(l.join('\n')).not.toContain('…');
    // une marche courte qui tient garde sa ligne
    expect(l).toContain('13:41   À pied vers Braine-l’Alleud (1 min)');
  });

  it('vers une gare : « vers la gare », puis son nom ; une marche trop longue pour sa ligne : le nom dessous, en entier', () => {
    const train = journey('t', [{ walk: 12, to: 'Bruxelles-Central' }, { ride: 'IC', mode: 'train', dep: T(14, 10), arr: T(14, 39), from: 'Bruxelles-Central', to: 'Gand-Saint-Pierre', platform: '4' }]);
    expect(lines(steps(train)).slice(0, 2)).toEqual([expect.stringMatching(/Partir à pied vers la gare \(12 min\)/), 'Bruxelles-Central']);
    const long = journey('l', [
      { walk: 4, to: 'Bruxelles-Central' },
      { ride: 'IC', mode: 'train', dep: T(14, 0), arr: T(14, 20), from: 'Bruxelles-Central', to: 'Louvain-la-Neuve' },
      { walk: 6, to: 'Louvain-la-Neuve Place des Sciences, quai central' },
      { ride: 'E3', mode: 'bus', dep: T(14, 30), arr: T(14, 50), from: 'Louvain-la-Neuve Place des Sciences, quai central', to: 'Braine-l’Alleud Côté du Collège' },
      { walk: 2 },
    ]);
    const v = steps(long);
    const at2 = v.items.findIndex((x) => x.b2 === 'Louvain-la-Neuve Place des Sciences, quai central');
    expect(v.items[at2]).toMatchObject({ b: 'À pied vers l’arrêt du bus' });
    expect(nb(v.items[at2].bTail ?? '')).toBe(' (6 min)');
    const shown = lines({ ...v, items: v.items.slice(at2) });
    expect(shown.slice(0, 2)).toEqual(['14:20   À pied vers l’arrêt du bus (6 min)', 'Louvain-la-Neuve Place des Sciences, quai central']);
  });

  it('à bord dès le départ (trajet fixe depuis une gare) : « depuis Bruxelles-Central »', () => {
    const fixed = journey('f', [{ ride: 'IC', mode: 'train', dep: T(14, 10), arr: T(14, 39), from: 'Bruxelles-Central', to: 'Gand-Saint-Pierre', platform: '4', head: 'Bruges' }]);
    expect(lines(steps(fixed)).slice(0, 3)).toEqual([expect.stringMatching(/^14:10 {3}IC vers Bruges, voie 4/), 'depuis Bruxelles-Central', '14:39   Arrivée à Gand-Saint-Pierre']);
  });

  it('pages comptées en lignes : ▼ montre la première étape cachée, jamais une étape sautée ; ▲ revient au début', () => {
    const v = steps(j);
    const cap = geometry(v).capacity;
    // 1re page : la marche (2 lignes), puis une étape par ligne ; ▼ : à partir de la 1re cachée
    const first = visibleRange(v.items, 0, cap).to;
    expect(first).toBe(cap - 1);
    expect(nb(v.note ?? '')).toBe(`▽ suite du trajet : ${v.items.length - first} étapes`);
    const nav = initNav({ screen: 'steps', key: 'k', title: 'Vers le bureau', from: { type: 'here' }, to: { type: 'place', placeId: 'b' } } as never);
    const down = handleGesture(nav, 'down', v, cap);
    const top = down.state.stack.at(-1)!.top;
    expect(top).toBeLessThanOrEqual(first);
    expect(top).toBeGreaterThan(0);
    // ▲ : la page d'avant finit juste avant `top` (la 1re étape incluse)
    expect(prevPageTop(v.items, top, cap)).toBe(0);
    const up = handleGesture(down.state, 'up', v, cap);
    expect(up.state.stack.at(-1)!.top).toBe(0);
  });
});

describe('PRD-1.2.4 § 4 : heures alignées à droite, « ~ » à gauche ; aides plus discrètes', () => {
  it('étapes : les heures finissent au même bord, avec ou sans « ~ »', () => {
    const planned = journey('p', [
      { walk: 4, to: 'Braine-l’Alleud' },
      { ride: 'IC', mode: 'train', dep: T(14, 1), arr: T(14, 16), from: 'Braine-l’Alleud', to: 'Bruxelles-Midi', platform: '2' },
      { walk: 2 },
    ]);
    planned.legs[1].rt = false;
    const e = edges(container(steps(planned), 'colA', -1));
    expect(e.map((x) => x.text)).toEqual(['13:57', '~14:01', '14:16', '14:18']);
    for (const x of e) expect(Math.abs(x.right - e[0].right)).toBeLessThanOrEqual(2);
    expect(LAYOUTS.steps.a.align).toBe('right');
  });

  it('tableau d’une gare : heures alignées dans leur case, les voies alignées ; retard, voie modifiée et « SUPPRIMÉ » entiers, l’heure à sa place', () => {
    const b = boardOf('sncb:8863008', 'Namur', [
      trainAt(NOW, 10, { platform: '5' }),
      trainAt(NOW, 18, { rt: false, platform: '12' }),
      trainAt(NOW, 26, { delayMin: 4, newPlatform: '12' }),
      trainAt(NOW, 34, { delayMin: 12, newPlatform: '12' }),
      trainAt(NOW, 42, { cancelled: true }),
    ]);
    const v = boardView(b, ctx(), { kept: false });
    const c = container(v, 'colC', 1);
    const rows = c.content.split('\n').filter((l) => l.trim());
    // « 13:34  voie 5 » et « ~13:42  voie 12 » : la voie commence au même endroit (± 2 px)
    const voie = (l: string) => c.x + textWidth(l.slice(0, l.indexOf('voie')));
    expect(Math.abs(voie(rows[0]) - voie(rows[1]))).toBeLessThanOrEqual(2);
    // revue 1.2.4 : « 13:50 +4  voie 12 ! », « 13:58 +12  voie 12 ! » et « 14:06  SUPPRIMÉ » tiennent avec la case :
    // les chiffres de toutes les heures finissent au même endroit, rien n'est coupé
    const timeEnd = (l: string) => c.x + textWidth(l.slice(0, (/\d\d:\d\d/.exec(l)?.index ?? 0) + 5));
    for (const r of rows) expect(Math.abs(timeEnd(r) - timeEnd(rows[0]))).toBeLessThanOrEqual(2);
    expect(rows.map((r) => nb(r.trim()))).toEqual(['13:34  voie 5', '~13:42  voie 12', '13:50 +4  voie 12 !', '13:58 +12  voie 12 !', '14:06  SUPPRIMÉ']);
    expect(rows.join('\n')).not.toContain('…');
    // le journal reste sans les espaces d'alignement
    expect(layoutPage(v, { sel: 1, top: 0 }).lines.slice(1, 3).map(nb)).toEqual(['IC   Bruxelles-Midi   13:34  voie 5', 'IC   Bruxelles-Midi   ~13:42  voie 12']);
  });

  it('« Dans le train » : l’heure d’un arrêt sans état reste sous les autres (colonne alignée à droite dans sa largeur)', () => {
    const v: GlassesView = {
      screen: 'train',
      layout: 'train',
      title: 'IC vers Bruxelles-Midi',
      clock: '13:24',
      items: [
        { a: 'Gembloux', b: '13:27', c: 'passé' },
        { a: 'Ottignies', b: '13:41', c: 'prochain' },
        { a: 'Bruxelles-Luxembourg', b: '14:03' },
        { a: 'Bruxelles-Nord', b: '14:12', c: 'descente' },
      ],
      hints: HINTS.message,
    };
    const e = edges(container(v, 'colB'));
    expect(e.map((x) => x.text)).toEqual(['13:27', '13:41', '14:03', '14:12']);
    for (const x of e) expect(Math.abs(x.right - e[0].right)).toBeLessThanOrEqual(2);
    expect(e[0].right).toBeLessThanOrEqual(LAYOUTS.train.b.x + (LAYOUTS.train.b.w ?? 0));
  });

  it('détail d’une ligne : « 23:38, dernier » (jamais « 23:38dernier ») ; un long terminus coupé garde l’heure à sa place', () => {
    expect(nb(leadCell('23:38', '', ', dernier', 68, 300).log)).toBe('23:38, dernier');
    expect(nb(leadCell('~23:29', '', ', dernier', 68, 300).log)).toBe('~23:29, dernier');
    expect(nb(leadCell('23:38', ' +2', ', dernier', 68, 300).log)).toBe('23:38 +2, dernier');
    // trop long de toute façon : coupé, la case gardée (les chiffres sous ceux des autres passages)
    const long = leadCell('13:33', ' +3  vers Sint-Pieters-Leeuw Zuunbeek Kerk Station Ouest', undefined, 68, 300);
    expect(long.text.startsWith(' ')).toBe(true);
    expect(long.log).toContain('…');
    expect(textWidth(long.text)).toBeLessThanOrEqual(300);
  });

  it('détail d’une ligne : les chiffres au même endroit, le « ~ » dans le retrait sous « vers … »', () => {
    const churchill = { fr: 'Churchill', nl: 'Churchill' };
    const lb = lineBoardOf('stib:6357F', 'Gare du Nord', '3', [{ head: 'Churchill', departures: [dep(NOW, 2, { op: 'stib', mode: 'tram', line: '3', head: churchill }), dep(NOW, 18, { op: 'stib', mode: 'tram', line: '3', rt: false, head: churchill })] }]);
    const v = lineView({ screen: 'line', areaId: 'stib:6357F', op: 'stib', line: '3', name: { fr: 'Gare du Nord', nl: 'Noordstation' } }, lb, ctx());
    const b = container(v, 'colB');
    const e = edges(b);
    expect(e.map((x) => x.text)).toEqual(['13:26', '~13:42']);
    expect(Math.abs(e[0].right - e[1].right)).toBeLessThanOrEqual(2);
    // les chiffres commencent là où ils commençaient (retrait de 20 px), le « ~ » dans le retrait
    expect(Math.abs(e[0].start - (GEO.X_TEXT + 20))).toBeLessThanOrEqual(3);
    expect(e[1].start).toBeLessThan(e[0].start);
    expect(e[1].start).toBeGreaterThanOrEqual(GEO.X_TEXT);
  });

  it('détail d’une ligne : « aucun passage » d’un sens commence avec les chiffres (journal sans retrait)', () => {
    const stalle = { fr: 'Stalle', nl: 'Stalle' };
    const lb = lineBoardOf('stib:6357F', 'Gare du Nord', '4', [
      { head: 'Stalle', departures: [dep(NOW, 2, { op: 'stib', mode: 'tram', line: '4', head: stalle })] },
      { head: 'Gare du Nord', departures: [] },
    ]);
    const v = lineView({ screen: 'line', areaId: 'stib:6357F', op: 'stib', line: '4', name: { fr: 'Gare du Nord', nl: 'Noordstation' } }, lb, ctx());
    const e = edges(container(v, 'colB'));
    expect(e.map((x) => x.text)).toEqual(['13:26', 'aucun passage']);
    // au retrait des chiffres d'une heure pleine (20 px, comme en 1.2.3), pas au bord du « ~ »
    expect(Math.abs(e[1].start - (GEO.X_TEXT + 20))).toBeLessThanOrEqual(2);
    expect(lines(v, 0)).toContain('aucun passage');
  });

  it('arrêts d’un départ : l’heure de l’arrêt du tableau alignée comme celles dessous', () => {
    const d = trainAt(NOW, 10, { tripId: 't-1', head: { fr: 'Liège-Guillemins', nl: 'Luik-Guillemins' } });
    const ds = stopsOf(d, NOW, [['Namur', 10, { platform: '3' }], ['Andenne', 22, { rt: false }], ['Huy', 31, {}]]);
    const v = stopsView({ screen: 'stops', areaId: 'sncb:8863008', dep: d }, ds, ctx());
    const p = layoutPage(v, { sel: 0, top: 0 });
    const top = p.containers.find((c) => c.name === 'top')!;
    const a = p.containers.find((c) => c.name === 'colA')!;
    const ends = [...edges(a), { right: top.x + textWidth(top.content.slice(0, top.content.indexOf(':') + 3)), start: 0, text: 'top' }];
    for (const x of ends) expect(Math.abs(x.right - ends[0].right)).toBeLessThanOrEqual(2);
  });

  it('leadCell : la case si tout tient ; abandonnée seulement si elle seule ferait couper ; sans heure, la suite seule', () => {
    expect(leadCell('12:30', '  voie 9', undefined, 68, 158).text).toMatch(/^ +12:30 {2}voie 9$/);
    expect(leadCell('12:30', '  voie 9', undefined, 68, 158).log).toBe('12:30  voie 9');
    expect(leadCell('', 'aucun passage', undefined, 68, 200)).toEqual({ text: 'aucun passage', log: 'aucun passage' });
    // tient sans la case, pas avec : l'heure n'est pas décalée, rien n'est coupé
    const tight = leadCell('18:04', ' +12  voie 11 !', undefined, 68, 165);
    expect(tight.text).toBe(tight.log);
    expect(nb(tight.log)).toBe('18:04 +12  voie 11 !');
    // ne tient pas même sans la case : coupé de toute façon, l'heure garde sa place
    const cut = leadCell('18:04', ' +12  voie 11 !', undefined, 68, 120);
    expect(cut.text.startsWith(' ')).toBe(true);
    expect(cut.log).toContain('…');
  });

  it('aides et bas d’écran : « △▽ » (le curseur « ▶ » reste plein)', () => {
    for (const h of Object.values(HINTS)) expect(h).not.toMatch(/[▲▼]/);
    expect(nb(HINTS.board)).toBe('△▽ départs   toucher : arrêts   double : retour');
    const v = steps(journey('x', [{ walk: 3, to: 'Gare du Nord' }, { ride: '3', mode: 'tram', dep: T(13, 40), arr: T(13, 50), from: 'Gare du Nord', to: 'Bourse' }, { walk: 1 }]));
    expect(v.note ?? '').not.toMatch(/[▲▼]/);
    const b = boardView(boardOf('sncb:8863008', 'Namur', [trainAt(NOW, 10)]), ctx(), { kept: false });
    expect(layoutPage(b, { sel: 1, top: 0 }).containers.find((c) => c.name === 'cursor')!.content.split('\n')).toEqual(['', '▶']);
  });
});
