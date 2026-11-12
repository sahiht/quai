/**
 * Quai 1.2.3, côté lunettes (docs/v1.2.3/PRD-1.2.3.md § 1, § 2 ; CA-123.1, CA-123.2) : tableau complet d'une gare ou
 * d'un arrêt (tous les départs des 2 prochaines heures, ligne ★ en tête, curseur sur le premier départ, pages ▲▼) et
 * les arrêts d'un départ (l'arrêt du tableau en tête, au plus clair, puis les suivants jusqu'au terminus ; toucher un
 * arrêt : son tableau ; double toucher : retour). Départs et arrêts construits sur des gares et arrêts publics, le
 * 10/11 à 07:31 (un mardi) ; le faux cœur pour la forme de bout en bout.
 */
import { describe, expect, it } from 'vitest';
import type { Board, Departure, DepartureStops } from '../../src/core/api';
import { textWidth } from '../../src/glasses/font';
import { BOARD, HINTS } from '../../src/glasses/format';
import { WIDTHS, layoutPage } from '../../src/glasses/layout';
import { boardView, lineView, stopsView, type ViewCtx } from '../../src/glasses/views';
import { LINES, MIN, STATIONS, at, boardOf, dep, lineBoardOf, lines, nb, page, settingsWith, setup, stopsOf, stubCore, trainAt, vanishedStops, type Screen } from './helpers';

const NOW = at('2026-11-10', 7, 31);
const N = (fr: string) => ({ fr, nl: fr });
const ctx = (patch = {}): ViewCtx => ({ now: NOW, settings: settingsWith([], { stations: [STATIONS.namur], ...patch }) });

/**
 * Namur un jour de semaine : 12 trains dans les 2 heures (bien plus que les 8 de l'ancien réglage), dans l'ordre des
 * heures ; l'IC de 07:42 a 2 min de retard et change de voie, l'IC de 07:57 est supprimé (à sa place).
 */
const NAMUR_DEPS: [number, string, string, string, Partial<Departure>?][] = [
  [3, 'S6', 'Charleroi-Central', '5'],
  [11, 'IC', 'Herstal', '4', { delayMin: 2, newPlatform: '6' }],
  [16, 'IC', 'Bruxelles-Midi', '3'],
  [26, 'IC', 'Liège-Guillemins', '2', { cancelled: true }],
  [33, 'L', 'Dinant', '7'],
  [41, 'IC', 'Bruxelles-Midi', '3'],
  [48, 'IC', 'Luxembourg', '1'],
  [56, 'S6', 'Charleroi-Central', '5'],
  [71, 'IC', 'Herstal', '4'],
  [86, 'IC', 'Bruxelles-Midi', '3'],
  [101, 'L', 'Dinant', '7'],
  [116, 'IC', 'Liège-Guillemins', '2'],
];
const namurBoard = (now: number): Board =>
  boardOf(
    STATIONS.namur.areaId,
    'Namur',
    NAMUR_DEPS.map(([m, line, head, platform, p]) => trainAt(now, m, { line, head: N(head), platform, tripId: `t-${m}`, ...p, ...(p?.delayMin ? { est: now + (m + p.delayMin) * MIN } : {}) })),
  );

/** L'IC de 07:42 vers Herstal, gare par gare : retard, voie modifiée à Namur, Huy supprimé, terminus Herstal. */
const icHerstal = (d: Pick<Departure, 'op' | 'mode' | 'line' | 'head'>, now: number): DepartureStops =>
  stopsOf(d, now, [
    ['Namur', 11, { platform: '4', newPlatform: '6', delayMin: 2 }],
    ['Andenne', 27, { platform: '1', delayMin: 2 }],
    ['Huy', 38, { platform: '2', cancelled: true }],
    ['Liège-Guillemins', 60, { platform: '5', delayMin: 3 }],
    ['Liège-Carré', 66, { platform: '1', delayMin: 3 }],
    ['Herstal', 72, { platform: '1', delayMin: 3 }],
  ]);

/** Huy : un tableau à elle (toucher un arrêt ouvre son tableau, et ainsi de suite). */
const huyBoard = (now: number): Board => boardOf('sncb:Huy', 'Huy', [trainAt(now, 9, { line: 'IC', head: N('Namur'), platform: '1', tripId: 't-huy' })]);

const boardReady = (s: Screen) => s.screen === 'board' && s.lines.length > 2 && !s.lines.some((l) => l.startsWith('Chargement'));
const stopsReady = (s: Screen) => s.screen === 'stops' && s.lines.length > 2 && !s.lines.some((l) => l.startsWith('Chargement'));

function core(now: () => number, extra: { stops?: (areaId: string, d: Departure, n: number) => DepartureStops | undefined } = {}) {
  const boardOpts: { areaId: string; horizonMin?: number; limit?: number }[] = [];
  const c = stubCore(now, {
    boardOpts,
    board: (id, n) => (id === STATIONS.namur.areaId ? namurBoard(n) : id === 'sncb:Huy' ? huyBoard(n) : undefined),
    departureStops: extra.stops ?? ((_id, d, n) => (d.tripId === 't-11' ? icHerstal(d, n) : d.tripId === 't-huy' ? stopsOf(d, n, [['Huy', 9, { platform: '1' }], ['Andenne', 20, { platform: '2' }], ['Namur', 33, { platform: '3' }]]) : undefined)),
  });
  return { core: c, boardOpts };
}

describe('CA-123.1 : tableau complet d’une gare ou d’un arrêt', () => {
  it('vue : ligne ★ en tête, tous les départs dans l’ordre des heures, le supprimé à sa place ; toucher un départ : ses arrêts', () => {
    const b = namurBoard(NOW);
    const v = boardView(b, ctx(), { kept: false });
    expect(v.items).toHaveLength(1 + NAMUR_DEPS.length);
    expect(v.items[0]).toEqual({ a: '★ garder la gare', action: { kind: 'toggleStation' } });
    expect(boardView(b, ctx(), { kept: true }).items[0].a).toBe('★ retirer la gare');
    expect(v.initialSel).toBe(1);
    expect(v.paged).toBe(true);
    expect(v.hints).toBe(HINTS.board);
    expect(nb(HINTS.board)).toBe('▲▼ départs   toucher : arrêts   double : retour');
    expect(v.items.slice(1).map((i) => nb(i.c ?? ''))).toEqual([
      '07:34  voie 5',
      '07:42 +2  voie 6 !',
      '07:47  voie 3',
      '07:57  SUPPRIMÉ',
      '08:04  voie 7',
      '08:12  voie 3',
      '08:19  voie 1',
      '08:27  voie 5',
      '08:42  voie 4',
      '08:57  voie 3',
      '09:12  voie 7',
      '09:27  voie 2',
    ]);
    // chaque départ ouvre ses arrêts, depuis la zone du tableau
    expect(v.items[2].action).toEqual({ kind: 'open', route: { screen: 'stops', areaId: STATIONS.namur.areaId, dep: b.departures[1] } });
    // tout tient au pixel, rien n'est coupé
    const all = layoutPage(v, { sel: 1, top: 0 });
    expect(all.lines.some((l) => l.includes('…'))).toBe(false);
  });

  it('arrêt de bus, tram ou métro : « ★ garder une ligne » (comme le toucher de la 1.2.2) ; rien : « aucun départ »', () => {
    const area = { id: 'stib:6357F', op: 'stib' as const, n: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86, lon: 4.36, modes: ['tram' as const], lines: ['3', '4'] };
    const tram = dep(NOW, 2, { op: 'stib', mode: 'tram', line: '3', head: N('Churchill') });
    const v = boardView({ area, departures: [tram], anyPlanned: false, rtErrors: [], updatedAt: NOW }, ctx(), { kept: false });
    expect(lines(v)).toEqual(['★ garder une ligne', 'T3   Churchill   2 min', '▲▼ départs   toucher : arrêts   double : retour']);
    expect(v.items[0].action).toEqual({ kind: 'open', route: { screen: 'keepLine', areaId: 'stib:6357F', op: 'stib', name: area.n, lat: 50.86, lon: 4.36 } });
    expect(lines(boardView({ area, departures: [], anyPlanned: false, rtErrors: [], updatedAt: NOW }, ctx(), { kept: false })).slice(0, 2)).toEqual(['★ garder une ligne', 'aucun départ']);
    expect(lines(boardView(boardOf(STATIONS.namur.areaId, 'Namur', []), ctx(), { kept: true })).slice(0, 2)).toEqual(['★ retirer la gare', 'aucun départ']);
    for (const t of [BOARD.keepStation, BOARD.dropStation, BOARD.keepLine, BOARD.none, HINTS.board]) expect(textWidth(t)).toBeLessThanOrEqual(WIDTHS.full);
  });

  it('le contrôleur demande les 2 prochaines heures (40 au plus) ; curseur sur le premier départ ; ▲▼ de départ en départ, par page', async () => {
    const { core: c, boardOpts } = core(() => NOW);
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.3', stations: [STATIONS.namur] }), core: () => c });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'board', areaId: STATIONS.namur.areaId, name: STATIONS.namur.name });
    const b = await h.until(boardReady);
    expect(boardOpts).toContainEqual({ areaId: STATIONS.namur.areaId, horizonMin: 120, limit: 40 });
    expect(b.title).toBe('Namur, train (SNCB) ★');
    expect(b.lines[0]).toBe('★ retirer la gare');
    expect(b.lines[1]).toBe('S6   Charleroi-Central   07:34  voie 5');
    expect(b.sel).toBe(1);
    expect(b.lines.at(-1)).toBe('▲▼ départs   toucher : arrêts   double : retour');
    // éléments visibles (la ligne ★ et les départs de la 1re page), sans l'aide ni la note
    const rows = b.lines.filter((l) => !l.startsWith('▲▼') && !l.startsWith('~')).length;
    // ▼ jusqu'au bas de la page : la page ne bouge pas ; un ▼ de plus : la page suivante commence au curseur
    for (let i = 1; i < rows - 1; i++) await h.gesture('down');
    expect(h.last()).toMatchObject({ sel: rows - 1 });
    expect(h.last().lines[0]).toBe('★ retirer la gare');
    await h.gesture('down');
    const p2 = h.last();
    expect(p2.sel).toBe(rows);
    expect(p2.lines[0]).toMatch(/^IC {3}/);
    expect(p2.lines).not.toContain('★ retirer la gare');
    // ▲ : la page précédente, qui finit au curseur
    await h.gesture('up');
    expect(h.last().lines[0]).toBe('★ retirer la gare');
    // le dernier départ, puis ▼ : rien ne bouge
    for (let i = 0; i < 20; i++) await h.gesture('down');
    expect(h.last().sel).toBe(NAMUR_DEPS.length);
    expect(h.last().lines.filter((l) => !l.startsWith('▲▼') && l).at(-1)).toBe('IC   Liège-Guillemins   09:27  voie 2');
    h.c.stop();
  });

  it('rien dans les 2 heures : le prochain départ, même plus tard ; sinon « aucun départ »', async () => {
    const later = (now: number) => boardOf('tec:Bbrlmer1', 'Braine-l’Alleud Merbraine', [dep(now, 185, { rt: false })]);
    const empty = (now: number) => boardOf('tec:Bbrlmer1', 'Braine-l’Alleud Merbraine', [], { updatedAt: now });
    for (const [next, want] of [
      [later, ['★ garder une ligne', 'W   Bruxelles Midi   ~10:36']],
      [empty, ['★ garder une ligne', 'aucun départ']],
    ] as const) {
      const c = stubCore(() => NOW, { board: (id, n, o) => (id === 'tec:Bbrlmer1' ? (o?.horizonMin ? empty(n) : next(n)) : undefined) });
      const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.3' }), core: () => c });
      await h.until((x) => x.screen === 'home');
      await h.c.show({ screen: 'board', areaId: 'tec:Bbrlmer1', name: N('Braine-l’Alleud Merbraine') });
      const b = await h.until((x) => x.screen === 'board' && x.lines.length > 1);
      expect(b.lines.slice(0, 2)).toEqual(want);
      h.c.stop();
    }
  });

  it('le faux cœur : un tableau complet de Gare du Nord (40 au plus) ; tous les départs sont touchables', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.3' }), core: (now) => stubCore(now) });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'board', areaId: 'stib:6357F', name: { fr: 'Gare du Nord', nl: 'Noordstation' } });
    const b = await h.until(boardReady);
    expect(b.lines[0]).toBe('★ garder une ligne');
    expect((b as Screen & { departures?: number }).departures).toBeGreaterThan(8);
    expect((b as Screen & { departures?: number }).departures).toBeLessThanOrEqual(BOARD.limit);
    h.c.stop();
  });
});

describe('CA-123.2 : les arrêts d’un départ', () => {
  it('train : l’arrêt du tableau en tête (au plus clair), voies, retard par gare, voie modifiée, arrêt supprimé, terminus en dernier', () => {
    const d = namurBoard(NOW).departures[1];
    const v = stopsView({ screen: 'stops', areaId: STATIONS.namur.areaId, dep: d }, icHerstal(d, NOW), ctx());
    expect(v.title).toBe('IC vers Herstal');
    const ls = lines(v);
    expect(ls).toEqual([
      '07:42 +2   Namur   voie 6 !',
      '07:58 +2   Andenne   voie 1',
      '08:09   Huy   SUPPRIMÉ',
      '08:31 +3   Liège-Guillemins   voie 5',
      '08:37 +3   Liège-Carré   voie 1',
      '08:43 +3   Herstal   voie 1',
      '▲▼ arrêts   toucher : départs   double : retour',
    ]);
    // l'arrêt du tableau sur la ligne du haut, au plus clair ; les suivants un ton plus pâles
    const p = page(v);
    const top = p.containers.find((c) => c.name === 'top')!;
    expect(top.level).toBe(4);
    expect(p.containers.filter((c) => ['colA', 'colB', 'colC'].includes(c.name)).every((c) => c.level < 4)).toBe(true);
    // la ligne du haut est alignée sur les colonnes de la liste (au pixel près, ± une espace)
    const nameX = textWidth(top.content.slice(0, top.content.indexOf('Namur')));
    const colB = p.containers.find((c) => c.name === 'colB')!;
    expect(Math.abs(top.x + nameX - colB.x)).toBeLessThanOrEqual(3);
    // curseur sur le premier arrêt suivant ; toucher un arrêt : son tableau
    expect(p.sel).toBe(0);
    expect(v.paged).toBe(true);
    expect(v.items[0].action).toEqual({ kind: 'open', route: { screen: 'board', areaId: 'sncb:Andenne', name: N('Andenne') } });
    // tout tient (heure et retard, voie modifiée, « SUPPRIMÉ »)
    for (const t of ['23:59 +45', '~08:44']) expect(textWidth(t)).toBeLessThanOrEqual(WIDTHS.stopTime);
    for (const t of ['voie 12a !', 'SUPPRIMÉ']) expect(textWidth(t)).toBeLessThanOrEqual(WIDTHS.stopRight);
  });

  it('bus : heures prévues décalées du retard connu au départ ; tram sans temps réel : « ~ » et la note ; un autre jour : « , demain »', () => {
    const w = dep(NOW, 17, { line: 'W', head: N('Bruxelles Midi'), delayMin: 3, est: NOW + 20 * MIN });
    const bus = stopsView(
      { screen: 'stops', areaId: 'tec:Bbrlmer1', dep: w },
      stopsOf(w, NOW, [
        ['Braine-l’Alleud Merbraine', 17, { delayMin: 3 }],
        ['Waterloo Eglise', 25, { delayMin: 3 }],
        ['Bruxelles Midi', 70, { delayMin: 3 }],
      ]),
      ctx(),
    );
    expect(bus.title).toBe('Bus W vers Bruxelles Midi');
    expect(lines(bus)).toEqual(['07:48 +3   Braine-l’Alleud Merbraine', '07:56 +3   Waterloo Eglise', '08:41 +3   Bruxelles Midi', '▲▼ arrêts   toucher : départs   double : retour']);
    const t3 = dep(NOW, 40, { op: 'stib', mode: 'tram', line: '3', head: N('Churchill'), rt: false });
    const tram = stopsView(
      { screen: 'stops', areaId: 'stib:6357F', dep: t3 },
      stopsOf(t3, NOW, [
        ['Gare du Nord', 40, { rt: false }],
        ['Rogier', 42, { rt: false }],
        ['Churchill', 65, { rt: false }],
      ]),
      ctx(),
    );
    expect(tram.title).toBe('Tram 3 vers Churchill');
    expect(lines(tram)).toEqual(['~08:11   Gare du Nord', '~08:13   Rogier', '~08:36   Churchill', '~ horaire prévu, sans temps réel', '▲▼ arrêts   toucher : départs   double : retour']);
    // départ du lendemain (le prochain, même plus tard) : le titre le dit
    const late = at('2026-11-10', 23, 40);
    const ic = trainAt(late, 400, { line: 'IC', head: N('Herstal'), platform: '4' });
    expect(stopsView({ screen: 'stops', areaId: STATIONS.namur.areaId, dep: ic }, stopsOf(ic, late, [['Namur', 400, { platform: '4' }], ['Herstal', 461, { platform: '1' }]]), { now: late, settings: settingsWith([]) }).title).toBe('IC vers Herstal, demain');
  });

  it('voyage disparu des données : « Ce départ n’est plus dans les horaires. »', () => {
    const d = namurBoard(NOW).departures[1];
    const v = stopsView({ screen: 'stops', areaId: STATIONS.namur.areaId, dep: d }, vanishedStops(d), ctx());
    expect(v.title).toBe('IC vers Herstal');
    expect(lines(v)).toEqual(['Ce départ n’est plus dans les horaires.', 'double toucher : retour']);
    expect(textWidth(BOARD.vanished)).toBeLessThanOrEqual(WIDTHS.full);
  });

  it('données réelles (forme) : un IC au départ de Namur et le bus 36 à Braine-l’Alleud Côté du Collège, de bout en bout', () => {
    const ic = trainAt(NOW, 14, { line: 'IC', head: N('Herstal'), platform: '2' });
    const icStops = stopsOf(ic, NOW, [
      ['Namur', 14, { platform: '2' }],
      ['Namêche', 24, { platform: '1' }],
      ['Andenne', 29, { platform: '1' }],
      ['Huy', 40, { platform: '2' }],
      ['Amay', 48, { platform: '1' }],
      ['Engis', 53, { platform: '2' }],
      ['Flémalle-Haute', 58, { platform: '3' }],
      ['Liège-Guillemins', 68, { platform: '5' }],
      ['Liège-Carré', 74, { platform: '1' }],
      ['Bressoux', 79, { platform: '2' }],
      ['Herstal', 84, { platform: '1' }],
    ]);
    const v = stopsView({ screen: 'stops', areaId: STATIONS.namur.areaId, dep: ic }, icStops, ctx());
    const first = page(v);
    expect(nb(first.lines[0])).toBe('07:45   Namur   voie 2');
    expect(first.lines.some((l) => l.includes('…'))).toBe(false);
    // la dernière page finit au terminus
    const end = layoutPage(v, { sel: v.items.length - 1, top: v.items.length - 1 });
    expect(nb(end.lines.filter((l) => /^\d/.test(nb(l))).at(-1)!)).toBe('08:55   Herstal   voie 1');
    const b36 = dep(NOW, 6, { line: '36', head: N('Wavre'), rt: false });
    const bus = stopsView(
      { screen: 'stops', areaId: 'tec:Bbrlcco1', dep: b36 },
      stopsOf(b36, NOW, [
        ['Braine-l’Alleud Côté du Collège', 6, { rt: false }],
        ['Braine-l’Alleud Gare', 11, { rt: false }],
        ['Waterloo Gare', 22, { rt: false }],
        ['Wavre Gare', 58, { rt: false }],
      ]),
      ctx(),
    );
    expect(bus.title).toBe('Bus 36 vers Wavre');
    expect(lines(bus)).toEqual(['~07:37   Braine-l’Alleud Côté du Collège', '~07:42   Braine-l’Alleud Gare', '~07:53   Waterloo Gare', '~08:29   Wavre Gare', '~ horaire prévu, sans temps réel', '▲▼ arrêts   toucher : départs   double : retour']);
  });

  it('du tableau aux arrêts, d’un arrêt à son tableau, et retour : chaque double toucher revient d’un écran, curseur gardé', async () => {
    const { core: c } = core(() => NOW);
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.3', stations: [STATIONS.namur] }), core: () => c });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'board', areaId: STATIONS.namur.areaId, name: STATIONS.namur.name });
    await h.until(boardReady);
    // le 2e départ : l'IC de 07:42 vers Herstal
    await h.gesture('down', 'tap');
    const s = await h.until(stopsReady);
    expect(s.title).toBe('IC vers Herstal');
    expect(s.lines.slice(0, 3)).toEqual(['07:42 +2   Namur   voie 6 !', '07:58 +2   Andenne   voie 1', '08:09   Huy   SUPPRIMÉ']);
    expect(s.sel).toBe(0);
    // Huy : son tableau, puis l'un de ses départs, ses arrêts
    await h.gesture('down', 'tap');
    const huy = await h.until((x) => boardReady(x) && x.title.startsWith('Huy'));
    expect(huy.lines.slice(0, 2)).toEqual(['★ garder la gare', 'IC   Namur   07:40  voie 1']);
    await h.gesture('tap');
    const s2 = await h.until((x) => stopsReady(x) && x.title === 'IC vers Namur');
    expect(s2.lines[0]).toBe('07:40   Huy   voie 1');
    // retour, retour, retour : le tableau de Huy, les arrêts de l'IC (sur Huy), le tableau de Namur (sur l'IC)
    await h.gesture('double');
    expect(h.last()).toMatchObject({ screen: 'board', sel: 1 });
    expect(h.last().title).toMatch(/^Huy/);
    await h.gesture('double');
    expect(h.last()).toMatchObject({ screen: 'stops', title: 'IC vers Herstal', sel: 1 });
    await h.gesture('double');
    expect(h.last()).toMatchObject({ screen: 'board', title: 'Namur, train (SNCB) ★', sel: 2 });
    await h.gesture('double');
    expect(h.last().screen).toBe('home');
    h.c.stop();
  });

  it('voyage disparu, et départ sans arrêts connus : le message, double toucher revient au tableau', async () => {
    const { core: c } = core(() => NOW, { stops: (_id, d) => vanishedStops(d) });
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.3', stations: [STATIONS.namur] }), core: () => c });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'board', areaId: STATIONS.namur.areaId, name: STATIONS.namur.name });
    await h.until(boardReady);
    await h.gesture('tap');
    const m = await h.until((x) => x.screen === 'stops' && x.lines.length > 0 && !x.lines[0].startsWith('Chargement'));
    expect(m).toMatchObject({ title: 'S6 vers Charleroi-Central', lines: ['Ce départ n’est plus dans les horaires.', 'double toucher : retour'] });
    await h.gesture('double');
    expect(h.last()).toMatchObject({ screen: 'board', sel: 1 });
    h.c.stop();
  });

  it('détail d’une ligne (Bus, tram, métro) : toucher un passage ouvre ses arrêts ; « Tous les départs de l’arrêt » : le tableau complet', async () => {
    const w = (now: number) =>
      lineBoardOf(LINES.w.areaId, 'Braine-l’Alleud Merbraine', 'W', [
        { head: 'Bruxelles Midi', departures: [dep(now, 17, { tripId: 'w-1', delayMin: 3, est: now + 20 * MIN }), dep(now, 37, { tripId: 'w-2' })] },
        { head: 'Braine-l’Alleud Gare', departures: [dep(now, 11, { tripId: 'w-3', head: N('Braine-l’Alleud Gare') })] },
      ]);
    const c = stubCore(() => NOW, {
      lineBoard: (id, _l, n) => (id === LINES.w.areaId ? w(n) : undefined),
      departureStops: (_id, d, n) => (d.tripId === 'w-1' ? stopsOf(d, n, [['Braine-l’Alleud Merbraine', 17, { delayMin: 3 }], ['Waterloo Eglise', 25, { delayMin: 3 }], ['Bruxelles Midi', 70, { delayMin: 3 }]]) : undefined),
    });
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.3', lines: [LINES.w] }), core: () => c });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'line', pick: LINES.w.id, areaId: LINES.w.areaId, op: 'tec', line: 'W', name: LINES.w.name, mode: 'bus' });
    const d = await h.until((x) => x.screen === 'line' && x.lines.length > 3);
    expect(d.lines.slice(0, 5)).toEqual(['vers Bruxelles Midi', '07:48 +3   dans 20 min', '08:08   dans 37 min', 'vers Braine-l’Alleud Gare', '07:42   dans 11 min']);
    expect(d.sel).toBe(0);
    expect(d.lines.at(-1)).toBe('▲▼ passages   toucher : arrêts   double : retour');
    await h.gesture('tap');
    const s = await h.until(stopsReady);
    expect(s).toMatchObject({ title: 'Bus W vers Bruxelles Midi' });
    expect(s.lines.slice(0, 3)).toEqual(['07:48 +3   Braine-l’Alleud Merbraine', '07:56 +3   Waterloo Eglise', '08:41 +3   Bruxelles Midi']);
    await h.gesture('double');
    expect(h.last()).toMatchObject({ screen: 'line', sel: 0 });
    // ▼ jusqu'à « Tous les départs de l'arrêt » (« vers … » ne se sélectionne jamais) : le tableau complet
    await h.gesture('down', 'down', 'down', 'tap');
    const b = await h.until((x) => x.screen === 'board' && x.lines.length > 1);
    expect(b.lines[0]).toBe('★ garder une ligne');
    h.c.stop();
  });
});

describe('revue 1.2.3 : un départ reste le même (clé des arrêts, curseur, rafraîchissement)', () => {
  /** Ligne sous le curseur d'un écran journalisé (liste sans ligne du haut). */
  const selected = (s: Screen & { top?: number }) => s.lines[s.sel - (s.top ?? 0)];
  /** Arts-Loi à 23:20 : le métro 1 dans les deux sens, à la même minute, sans identifiant de voyage (STIB). */
  const LATE = at('2026-11-10', 23, 14);
  const m1 = (head: string, stopId: string): Departure => dep(LATE, 6, { op: 'stib', mode: 'metro', line: '1', head: N(head), stopId, tripId: undefined });
  const artsLoi = () => boardOf('stib:ARTSLOI', 'Arts-Loi', [m1('Stockel', '8032'), m1('Gare de l’Ouest', '8031')], { area: { id: 'stib:ARTSLOI', op: 'stib', n: N('Arts-Loi'), lat: 50.845, lon: 4.369, modes: ['metro'], lines: ['1', '5'] } });

  it('deux sens d’une ligne à la même minute (STIB, sans voyage) : chacun ses arrêts, jamais ceux de l’autre', async () => {
    const c = stubCore(() => LATE, {
      board: (id) => (id === 'stib:ARTSLOI' ? artsLoi() : undefined),
      departureStops: (_id, d, n) => stopsOf(d, n, d.head.fr === 'Stockel' ? [['Arts-Loi', 6], ['Mérode', 9], ['Stockel', 22]] : [['Arts-Loi', 6], ['De Brouckère', 9], ['Gare de l’Ouest', 16]]),
    });
    const h = await setup({ now: LATE, settings: settingsWith([], { seenVersion: '1.2.3' }), core: () => c });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'board', areaId: 'stib:ARTSLOI', name: N('Arts-Loi') });
    const b = await h.until((x) => x.screen === 'board' && x.lines.length > 2);
    expect(b.lines.slice(1, 3)).toEqual(['M1   Stockel   6 min', 'M1   Gare de l’Ouest   6 min']);
    await h.gesture('tap');
    expect((await h.until((x) => x.screen === 'stops' && x.lines.length > 2)).title).toBe('Métro 1 vers Stockel');
    expect(h.last().lines.at(-2)).toBe('23:36   Stockel');
    await h.gesture('double', 'down', 'tap');
    const s = await h.until((x) => x.screen === 'stops' && x.title === 'Métro 1 vers Gare de l’Ouest' && x.lines.length > 2);
    expect(s.lines.slice(1, 3)).toEqual(['23:23   De Brouckère', '23:30   Gare de l’Ouest']);
    h.c.stop();
  });

  it('le curseur suit son départ : un départ parti, un retard qui réordonne, au retour des arrêts ; la ligne ★ ne bouge pas', async () => {
    let deps = NAMUR_DEPS.slice(0, 6);
    const board = (now: number) => boardOf(STATIONS.namur.areaId, 'Namur', deps.map(([m, line, head, platform, p]) => trainAt(now, m, { line, head: N(head), platform, tripId: `t-${m}`, ...p, ...(p?.delayMin ? { est: now + (m + p.delayMin) * MIN } : {}) })));
    const c = stubCore(() => NOW, { board: (id, n) => (id === STATIONS.namur.areaId ? board(n) : undefined), departureStops: (_id, d, n) => stopsOf(d, n, [['Namur', 0], ['Andenne', 16]]) });
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.3', stations: [STATIONS.namur] }), core: () => c });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'board', areaId: STATIONS.namur.areaId, name: STATIONS.namur.name });
    await h.until((x) => x.screen === 'board' && x.lines.length > 3);
    // le 3e départ : l'IC de 07:47 vers Bruxelles-Midi
    await h.gesture('down', 'down');
    expect(selected(h.last())).toBe('IC   Bruxelles-Midi   07:47  voie 3');
    // le premier part : la liste remonte d'une ligne, le curseur reste sur l'IC de 07:47
    deps = NAMUR_DEPS.slice(1, 6);
    await h.c.refreshCurrent();
    expect(h.last().sel).toBe(2);
    expect(selected(h.last())).toBe('IC   Bruxelles-Midi   07:47  voie 3');
    // un retard le fait passer après le suivant : le curseur le suit
    deps = [NAMUR_DEPS[1], NAMUR_DEPS[3], [16, 'IC', 'Bruxelles-Midi', '3', { delayMin: 15 }], NAMUR_DEPS[4], NAMUR_DEPS[5]];
    await h.c.refreshCurrent();
    expect(h.last().sel).toBe(3);
    expect(selected(h.last())).toBe('IC   Bruxelles-Midi   07:47 +15  voie 3');
    // ses arrêts, puis le tableau change pendant ce temps : au retour, toujours lui
    await h.gesture('tap');
    await h.until((x) => x.screen === 'stops' && x.lines.length > 1);
    deps = [NAMUR_DEPS[3], [16, 'IC', 'Bruxelles-Midi', '3', { delayMin: 15 }], NAMUR_DEPS[4], NAMUR_DEPS[5]];
    h.advance(30_000);
    await h.gesture('double');
    const back = await h.until((x) => x.screen === 'board' && x.lines.length > 3 && x.lines.length < 7);
    expect(back.sel).toBe(2);
    expect(selected(back)).toBe('IC   Bruxelles-Midi   07:47 +15  voie 3');
    // parti à son tour (ni lui, ni un IC de la même ligne et du même sens) : le rang, borné
    deps = [NAMUR_DEPS[4]];
    await h.c.refreshCurrent();
    expect(h.last().sel).toBe(1);
    // la ligne ★ : le curseur posé sur elle y reste, quoi qu'il arrive aux départs
    await h.gesture('up');
    deps = NAMUR_DEPS.slice(0, 6);
    await h.c.refreshCurrent();
    expect(h.last().sel).toBe(0);
    expect(selected(h.last())).toBe('★ retirer la gare');
    h.c.stop();
  });

  it('détail d’une ligne : le curseur suit son passage quand un passage part', async () => {
    let first = 4;
    const w = (now: number) =>
      lineBoardOf(LINES.w.areaId, 'Braine-l’Alleud Merbraine', 'W', [
        { head: 'Bruxelles Midi', departures: [first, 18, 38].filter((m) => m > 0).map((m) => dep(now, m, { tripId: `w-${m}` })) },
        { head: 'Braine-l’Alleud Gare', departures: [dep(now, 9, { tripId: 'w-r9', head: N('Braine-l’Alleud Gare') })] },
      ]);
    const c = stubCore(() => NOW, { lineBoard: (id, _l, n) => (id === LINES.w.areaId ? w(n) : undefined) });
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.3', lines: [LINES.w] }), core: () => c });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'line', pick: LINES.w.id, areaId: LINES.w.areaId, op: 'tec', line: 'W', name: LINES.w.name, mode: 'bus' });
    await h.until((x) => x.screen === 'line' && x.lines.length > 3);
    await h.gesture('down');
    expect(h.last().sel).toBe(1);
    first = 0;
    await h.c.refreshCurrent();
    // le passage de 07:49 (18 min) est maintenant le premier de son sens : le curseur l'a suivi
    expect(h.last().sel).toBe(0);
    expect(h.last().lines[1]).toBe('07:49   dans 18 min');
    h.c.stop();
  });

  it('bus, tram, métro : le départ est relu au tableau à chaque rafraîchissement (son retard) ; un train : jamais', async () => {
    let delay = 3;
    const boardOpts: { areaId: string; horizonMin?: number; limit?: number }[] = [];
    const wBoard = (now: number) => boardOf('tec:Bbrlmer1', 'Braine-l’Alleud Merbraine', [dep(now, 17, { tripId: 'w-0748', delayMin: delay, est: now + (17 + delay) * MIN, stopId: 'Bbrlmer1' })]);
    const c = stubCore(() => NOW, {
      boardOpts,
      board: (id, n) => (id === 'tec:Bbrlmer1' ? wBoard(n) : id === STATIONS.namur.areaId ? namurBoard(n) : undefined),
      // le cœur décale les arrêts suivants du retard du départ qu'on lui passe
      departureStops: (_id, d, n) => stopsOf(d, n, [['Braine-l’Alleud Merbraine', 17, { delayMin: d.delayMin }], ['Waterloo Eglise', 25, { delayMin: d.delayMin }]]),
    });
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.3', stations: [STATIONS.namur] }), core: () => c });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'board', areaId: 'tec:Bbrlmer1', name: N('Braine-l’Alleud Merbraine') });
    await h.until((x) => x.screen === 'board' && x.lines.length > 2);
    await h.gesture('tap');
    expect((await h.until((x) => x.screen === 'stops' && x.lines.length > 2)).lines.slice(0, 2)).toEqual(['07:48 +3   Braine-l’Alleud Merbraine', '07:56 +3   Waterloo Eglise']);
    delay = 6;
    h.advance(30_000);
    await h.c.refreshCurrent();
    expect((await h.until((x) => x.screen === 'stops' && x.lines[0]?.includes('+6'))).lines.slice(0, 2)).toEqual(['07:48 +6   Braine-l’Alleud Merbraine', '07:56 +6   Waterloo Eglise']);
    // un train : la SNCB donne l'heure et la voie gare par gare, le tableau n'est pas relu
    await h.c.show({ screen: 'board', areaId: STATIONS.namur.areaId, name: STATIONS.namur.name });
    await h.until((x) => x.screen === 'board' && x.title.startsWith('Namur') && x.lines.length > 2);
    const before = boardOpts.filter((o) => o.areaId === STATIONS.namur.areaId).length;
    await h.gesture('tap');
    await h.until((x) => x.screen === 'stops' && x.lines.length > 1);
    await h.c.refreshCurrent();
    expect(boardOpts.filter((o) => o.areaId === STATIONS.namur.areaId).length).toBe(before);
    h.c.stop();
  });

  it('un retard à 3 chiffres tient dans la colonne des heures (« 23:59 +120 »)', () => {
    const late = at('2026-11-10', 21, 59);
    const ic = trainAt(late, 120, { line: 'IC', head: N('Herstal'), platform: '4', delayMin: 120 });
    const v = stopsView({ screen: 'stops', areaId: STATIONS.namur.areaId, dep: ic }, stopsOf(ic, late, [['Namur', 120, { platform: '4', delayMin: 120 }], ['Herstal', 181, { platform: '1', delayMin: 120 }]]), { now: late, settings: settingsWith([]) });
    expect(lines(v).slice(0, 2)).toEqual(['23:59 +120   Namur   voie 4', '01:00 +120   Herstal   voie 1']);
    for (const t of ['23:59 +120', '00:00 +444']) expect(textWidth(t)).toBeLessThanOrEqual(WIDTHS.stopTime);
  });
});
