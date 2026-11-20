/**
 * Quai 1.3.1, contrôle indépendant du sujet « listes » (PRD-1.3.1 § 12, B21 et L6). Ce que le contrôle a vérifié en plus
 * des tests du sujet, et ce qu'il a corrigé :
 * - la ligne de note de « Gares de train » reste réservée comme en 1.3.0 : un train sans temps réel qui arrive au
 *   rafraîchissement ne reconstruit pas la page ; « ~ horaire prévu » ne se dit que sous un « ~ » à l'écran (rangée
 *   visible, ou train d'après de la gare ouverte), jamais pour une gare fermée ;
 * - quand le curseur bouge : aucune requête, aucune reconstruction, seulement les conteneurs qui changent ;
 * - au pixel : 32 gares aux noms longs, le curseur partout : la rangée du curseur et ses lignes ouvertes à l'écran, une
 *   seule rangée ouverte, rien ne dépasse, « Plein soleil » compris ;
 * - les aides des quatre listes : entières dans le pied, sur les lunettes, dans Quai Web et en « Plein soleil ».
 * Lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { Board, Departure, StationPick } from '../../src/core/api';
import type { LineFollow } from '../../src/core/linerun';
import { textWidth } from '../../src/glasses/font';
import { EXPAND_PX, HINTS } from '../../src/glasses/format';
import { geometry, layoutPage, WIDTHS, type DetailItem } from '../../src/glasses/layout';
import { effectiveFrame, handleGesture, initNav } from '../../src/glasses/nav';
import type { GlassesView } from '../../src/glasses/types';
import { followsView, linesView, nearbyView, stationsView, type StationRow, type ViewCtx } from '../../src/glasses/views';
import { LINES, MIN, STATIONS, at, boardOf, container, dep, nb, overflowing, rowsOf, settingsWith, setup, stubCore, trainAt } from './helpers';

const NOW = at('2026-11-20', 7, 30);
const NOTE = '~ horaire prévu, sans temps réel';
const N = (fr: string, nl = fr) => ({ fr, nl });
const ctx = (patch: Partial<ViewCtx> = {}): ViewCtx => ({ now: NOW, settings: settingsWith([]), ...patch });
const pick = (id: string, name: string): StationPick => ({ id, areaId: `sncb:${id}`, name: N(name), lat: 50.8, lon: 4.3 });
const s1 = trainAt(NOW, 12, { line: 'S1', head: N('Bruxelles-Midi'), platform: '1' });
const ic = trainAt(NOW, 24, { line: 'IC', head: N('Liège-Guillemins'), platform: '4' });
/** Première ligne du pied (la note) quand le curseur est sur `sel`. */
const noteAt = (v: GlassesView, sel: number): string => rowsOf(container(layoutPage(v, { sel, top: 0 }), 'foot'))[0];

describe('contrôle B21 : la note « ~ horaire prévu » de « Gares de train »', () => {
  const rt: StationRow[] = [
    { pick: pick('a', 'Ottignies'), next: s1, after: ic, state: 'ok' },
    { pick: pick('b', 'Namur'), next: s1, after: ic, state: 'ok' },
  ];
  const plannedAfter: StationRow[] = [rt[0], { ...rt[1], after: { ...ic, rt: false } }];

  it('la ligne de note est réservée comme en 1.3.0 : la même page avec ou sans train sans temps réel', () => {
    const a = geometry(stationsView(rt, ctx()));
    const b = geometry(stationsView(plannedAfter, ctx()));
    const c = geometry(stationsView(rt, ctx({ stale: 'Horaires du 19/11' })));
    expect(a.noteLine).toBe(true);
    expect([b.capacity, b.footY, b.footLines]).toEqual([a.capacity, a.footY, a.footLines]);
    expect([c.capacity, c.footY, c.footLines]).toEqual([a.capacity, a.footY, a.footLines]);
    // sans le « ~ » du réglage : la ligne reste réservée (des horaires périmés peuvent s'y dire), jamais de note « ~ »
    const noRt: StationRow[] = [{ ...rt[0], next: { ...s1, rt: false } }, plannedAfter[1]];
    const off = stationsView(noRt, ctx({ settings: settingsWith([], { display: { ...settingsWith([]).display, markPlanned: false } }) }));
    expect(layoutPage(off, { sel: 1, top: 0 }).lines.some((l) => l.includes('~'))).toBe(false);
    expect(geometry(off).capacity).toBe(a.capacity);
    expect([noteAt(off, 0), noteAt(off, 1)]).toEqual(['', '']);
  });

  it('la note ne se dit que sous un « ~ » à l’écran : le train d’après de la gare ouverte, jamais celui d’une gare fermée', () => {
    const v = stationsView(plannedAfter, ctx());
    // curseur sur Ottignies : Namur est fermée, aucun « ~ » à l'écran, pas de note
    const closed = layoutPage(v, { sel: 0, top: 0 });
    expect(closed.lines.some((l) => l.includes('~'))).toBe(false);
    expect(noteAt(v, 0)).toBe('');
    // curseur sur Namur : « puis IC vers Liège-Guillemins, ~07:54 voie 4 » et sa note
    const open = layoutPage(v, { sel: 1, top: 0 });
    expect(open.lines.map(nb)).toContain('puis IC vers Liège-Guillemins, ~07:54 voie 4');
    expect(noteAt(v, 1)).toBe(NOTE);
    expect(overflowing(open)).toEqual([]);
  });

  it('le « ~ » du prochain train d’une rangée visible dit la note, où que soit le curseur ; hors de la page, non', () => {
    const rows: StationRow[] = [{ pick: pick('a', 'Ottignies'), next: { ...s1, rt: false }, state: 'ok' }];
    for (let i = 0; i < 9; i++) rows.push({ pick: pick(`r${i}`, `Gare ${i}`), next: s1, state: 'ok' });
    const v = stationsView(rows, ctx());
    expect(noteAt(v, 0)).toBe(NOTE);
    expect(noteAt(v, 3)).toBe(NOTE);
    // tout en bas : Ottignies n'est plus à l'écran, plus de « ~ », plus de note
    const g = geometry(v);
    const last = layoutPage(v, effectiveFrame({ route: { screen: 'stations' }, sel: 9, top: 0, fresh: false }, v, g.capacity));
    expect(last.lines.some((l) => l.includes('~'))).toBe(false);
    expect(rowsOf(container(last, 'foot'))[0]).toBe('');
    // des horaires périmés passent avant la note « ~ »
    expect(noteAt(stationsView(rows, ctx({ stale: 'Horaires du 19/11' })), 0)).toBe('Horaires du 19/11');
  });

  it('un train d’après déjà parti (le prochain est en retard) n’est plus annoncé par « puis »', () => {
    const late = { ...s1, delayMin: 20, est: s1.est + 20 * MIN };
    const gone: Departure = trainAt(NOW, -2, { line: 'L', head: N('Wavre') });
    const v = stationsView([{ pick: pick('a', 'Ottignies'), next: late, after: gone, state: 'ok' }], ctx());
    expect((v.items[0] as DetailItem).expand?.map((e) => nb(e.text))).toEqual(['vers Bruxelles-Midi']);
  });
});

describe('contrôle B21 : le curseur qui bouge, les envois et les requêtes', () => {
  it('▼ ▲ : aucune requête, aucune reconstruction ; un train sans temps réel au rafraîchissement : pas de reconstruction non plus', async () => {
    const calls: string[] = [];
    let planned = false;
    const names = ['Ottignies', 'Namur', 'Gembloux', 'Wavre', 'Nivelles', 'Tubize', 'Hal', 'Enghien', 'Ath'];
    const stations = [STATIONS.braine, ...names.map((n, i) => ({ ...STATIONS.braine, id: `b${i}`, areaId: `sncb:${i}`, name: N(n) }))];
    // chaque gare a ses trains (heures décalées) : toute rangée qui bouge change vraiment de texte
    const boards = (id: string): Board | undefined => {
      const k = stations.findIndex((s) => s.areaId === id);
      return boardOf(id, 'Gare', [trainAt(NOW, 11 + k, { head: N('Bruxelles-Midi') }), trainAt(NOW, 26 + k, { line: 'S1', head: N('Nivelles'), platform: '3', rt: !(planned && k === 2) }), trainAt(NOW, 41 + k)]);
    };
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.3.0', stations }), core: (now) => stubCore(now, { board: boards, calls }) });
    await h.until((x) => x.screen === 'home');
    await h.c.replaceRoute({ screen: 'stations' });
    await h.until((x) => x.screen === 'stations' && x.lines.length > 2 && !x.lines.some((l) => / …$/.test(l)));
    await h.settle(100);
    calls.length = 0;
    let n = h.calls.length;
    const ops = (): string[] => {
      const o = h.calls.slice(n).map((c) => (c.op === 'upgrade' ? (c.arg as { name: string }).name : c.op));
      n = h.calls.length;
      return o;
    };
    // un pas : le curseur et les trois colonnes (les rangées glissent d'une ou deux lignes), rien d'autre
    await h.gesture('down');
    expect(ops().sort()).toEqual(['colA', 'colB', 'colC', 'cursor']);
    await h.gesture('down', 'up', 'down', 'down', 'down', 'down', 'down', 'down', 'down', 'down');
    const moved = ops();
    expect(moved.filter((o) => o === 'rebuild' || o === 'start')).toEqual([]);
    expect(moved.every((o) => ['cursor', 'colA', 'colB', 'colC', 'foot'].includes(o))).toBe(true);
    expect(moved.length).toBeLessThanOrEqual(10 * 4);
    // en bas de la liste : ▼ n'envoie plus rien
    expect(h.last().sel).toBe(9);
    await h.gesture('down');
    expect(ops()).toEqual([]);
    expect(calls.filter((c) => c.startsWith('board:'))).toEqual([]);
    // 30 s plus tard, le train d'après d'une gare fermée (Namur) n'a plus de temps réel : aucune reconstruction, et pas
    // de note sans « ~ » à l'écran
    planned = true;
    h.advance(30_000);
    await h.c.refreshCurrent();
    await h.settle(150);
    expect(ops().filter((o) => o === 'rebuild' || o === 'start')).toEqual([]);
    expect(h.last().lines.some((l) => l.includes('~'))).toBe(false);
    // une requête par gare au rafraîchissement, pas une de plus pour le train d'après
    expect(calls.filter((c) => c.startsWith('board:')).length).toBe(stations.length);
    h.c.stop();
  });
});

describe('contrôle B21 : au pixel, 32 gares aux noms longs', () => {
  const NAMES = ['Bruxelles-Aéroport-Zaventem', 'Louvain-la-Neuve-Université', 'Braine-l’Alleud', 'Bruxelles-Luxembourg', 'Mont-Saint-Guibert', 'Ottignies', 'Liège-Guillemins', 'Anvers-Central', 'Marche-les-Dames', 'Namur', 'Court-Saint-Étienne', 'Noorderkempen (Brecht)', 'Cambron-Casteau', 'Ham-sur-Heure', 'Jemeppe-sur-Sambre', 'Sint-Katelijne-Waver'];
  const rows: StationRow[] = [];
  for (let i = 0; i < 32; i++) {
    const next = trainAt(NOW, 5 + i, { line: i % 2 ? 'IC' : 'S81', head: N(NAMES[(i + 3) % NAMES.length]), platform: '12', ...(i % 3 ? {} : { newPlatform: '12a' }), delayMin: i % 4 ? 0 : 12, rt: i % 5 !== 0 });
    // sans train d'après (1 ligne ouverte), demain, supprimé, voie modifiée, retard, sans temps réel
    const after = i % 7 === 6 ? undefined : trainAt(NOW, 40 + i + (i % 6 === 5 ? 24 * 60 : 0), { line: 'IC', head: N(NAMES[(i + 5) % NAMES.length]), platform: '12', ...(i % 2 ? { newPlatform: '12a' } : {}), delayMin: i % 3 ? 0 : 12, cancelled: i % 8 === 3, rt: i % 4 !== 1 });
    rows.push({ pick: pick(`s${i}`, `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ' 2' : ''}`), next, ...(after ? { after } : {}), state: 'ok' });
  }

  it('▼ jusqu’en bas puis ▲ jusqu’en haut : la rangée du curseur et ses lignes ouvertes à l’écran, une seule rangée ouverte, rien ne dépasse', () => {
    const v = stationsView(rows, ctx());
    const g = geometry(v);
    let st = initNav({ screen: 'stations' });
    const seen = new Set<number>();
    for (const dir of [...Array<'down'>(33).fill('down'), ...Array<'up'>(33).fill('up')]) {
      const f = effectiveFrame(st.stack[0], v, g.capacity);
      seen.add(f.sel);
      for (const sun of [false, true]) {
        const p = layoutPage(v, f, { sun });
        expect(overflowing(p), `curseur ${f.sel}`).toEqual([]);
        const colA = container(p, 'colA').content.split('\n');
        const colB = container(p, 'colB').content.split('\n');
        const cur = container(p, 'cursor').content.split('\n');
        // la rangée du curseur : son nom entier (aucun de ces noms n'est coupé), puis ses lignes ouvertes juste dessous
        const at0 = cur.findIndex((c) => c.trim());
        const it = v.items[f.sel] as DetailItem;
        expect(nb(colA[at0]), `curseur ${f.sel}`).toBe(nb(it.a));
        const open = it.expand ?? [];
        expect(open.length).toBeGreaterThanOrEqual(1);
        open.forEach((e, k) => {
          expect(nb(colB[at0 + 1 + k].trim()), `curseur ${f.sel}`).toBe(nb(e.text));
          expect(textWidth(e.text)).toBeLessThanOrEqual(EXPAND_PX);
          // l'heure, le retard et la voie ne sont jamais coupés : « … » seulement dans le nom, avant la virgule
          expect(/…(?!,)/.test(e.text), e.text).toBe(false);
        });
        // une seule rangée ouverte : les seules lignes pâles sont celles de la gare du curseur
        expect(colB.filter((l) => l.trim()).length).toBe(open.length);
        // pâles, d'un cran au moins sous le nom, « Plein soleil » compris
        expect(container(p, 'colB').level).toBe(sun ? 3 : 2);
        expect(container(p, 'colA').level).toBe(4);
        // jamais de tiret long ni d'apostrophe droite à l'écran
        expect(/[—–']/.test(p.containers.map((c) => c.content).join('\n'))).toBe(false);
      }
      st = handleGesture(st, dir, v, g.capacity).state;
    }
    expect(seen.size).toBe(32);
  });
});

describe('contrôle L6 : les aides des listes, entières dans le pied', () => {
  const same = '△▽ choisir   toucher : départs   double : retour';
  const follow: LineFollow = { id: 'f3', op: 'stib', mode: 'tram', line: '3', routes: [] };
  const views = (c: ViewCtx): [string, GlassesView, string][] => [
    ['Autour de moi', nearbyView([{ area: boardOf('stib:6357F', 'Gare du Nord', []).area, distanceM: 80, walkMin: 1, next: dep(NOW, 4, { op: 'stib', mode: 'tram', line: '3', head: N('Churchill') }) }], c), same],
    ['Gares', stationsView([{ pick: pick('a', 'Namur'), next: s1, after: { ...ic, rt: false }, state: 'ok' }], c), same],
    ['Arrêts', linesView([{ pick: LINES.gdnAll, stop: boardOf('stib:6357F', 'Gare du Nord', [dep(NOW, 4, { op: 'stib', mode: 'tram', line: '3', head: N('Churchill'), rt: false })]) }], c), same],
    ['Lignes', followsView([{ follow, mode: 'tram', heads: [N('Churchill'), N('Esplanade')] }], c), '△▽ choisir   toucher : parcours   double : retour'],
  ];

  it('lunettes, Quai Web et « Plein soleil » : le texte exact, insécable devant « : », dernière ligne du pied, jamais coupé', () => {
    for (const web of [false, true]) {
      for (const [name, v, want] of views(ctx({ web }))) {
        for (const sun of [false, true]) {
          const p = layoutPage(v, { sel: 0, top: 0 }, { sun });
          const foot = container(p, 'foot');
          const hint = foot.content.split('\n').at(-1)!;
          expect(nb(hint), `${name} web=${web} sun=${sun}`).toBe(want);
          expect(hint).toMatch(/toucher : \S+ {3}double : retour$/);
          expect(textWidth(hint)).toBeLessThanOrEqual(Math.min(foot.w, WIDTHS.full));
          expect(overflowing(p), name).toEqual([]);
          // avec la note au-dessus (« ~ » à l'écran sur Gares et Arrêts), l'aide garde sa ligne
          if (name === 'Gares' || name === 'Arrêts') expect(rowsOf(foot)).toEqual([NOTE, want]);
        }
      }
    }
  });

  it('le geste fait ce que l’aide annonce : toucher ouvre les départs (trois listes) ou le parcours (« Lignes »)', () => {
    const [nearby, stations, stops, follows] = views(ctx()).map(([, v]) => v.items[0].action);
    for (const a of [nearby, stations, stops]) expect(a).toMatchObject({ kind: 'open', route: { screen: 'board' } });
    expect(follows).toMatchObject({ kind: 'open', route: { screen: 'lineRun' } });
  });
});
