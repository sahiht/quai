/**
 * Quai 1.2.9 (docs/v1.2.9/PRD-1.2.9.md § 3) : défauts prouvés des lunettes, chacun avec son test. Gares et arrêts
 * publics, le 12/11.
 */
import { describe, expect, it } from 'vitest';
import type { LineFollow } from '../../src/core/linerun';
import { stopsView, trainView } from '../../src/glasses/views';
import { LINES, STATIONS, at, boardOf, dep, journey, lines, nb, page, settingsWith, setup, stopsOf, stubCore, trainAt, type Screen } from './helpers';

const NOW = at('2026-11-12', 7, 31);
const N = (fr: string) => ({ fr, nl: fr });

describe('1.2.9 : une rangée dont le rafraîchissement échoue garde sa dernière valeur', () => {
  it('« Gares » : la gare en erreur garde son prochain train, jamais « … » qui revient', async () => {
    let fail = false;
    const h = await setup({
      now: NOW,
      settings: settingsWith([], { seenVersion: '1.2.9', stations: [STATIONS.braine, STATIONS.nord] }),
      core: (now) =>
        stubCore(now, {
          board: (id) => {
            if (id === STATIONS.braine.areaId) return boardOf(id, 'Braine-l’Alleud', [trainAt(NOW, 11)]);
            if (id !== STATIONS.nord.areaId) return undefined;
            if (fail) throw new Error('Horaires injoignables');
            return boardOf(id, 'Bruxelles-Nord', [trainAt(NOW, 24, { line: 'S1' })]);
          },
        }),
    });
    await h.until((x) => x.screen === 'home');
    await h.c.replaceRoute({ screen: 'stations' });
    const s = await h.until((x) => x.screen === 'stations' && !x.lines.some((l) => / …$/.test(l)));
    expect(s.lines.slice(0, 2)).toEqual(['Braine-l’Alleud   IC 07:42 voie 1', 'Bruxelles-Nord   S1 07:55 voie 1']);
    await h.settle(50);
    // 30 s plus tard, la demande de Bruxelles-Nord échoue (réseau) : son dernier train connu reste à l'écran
    fail = true;
    h.advance(30_000);
    await h.c.refreshCurrent();
    await h.settle(50);
    expect(h.last().lines.slice(0, 2)).toEqual(['Braine-l’Alleud   IC 07:42 voie 1', 'Bruxelles-Nord   S1 07:55 voie 1']);
    h.c.stop();
  });

  it('« Arrêts de bus, tram, métro » : l’arrêt en erreur garde ses départs', async () => {
    let fail = false;
    const rogier = { ...LINES.gdnAll, id: 'ln-rogier', areaId: 'stib:5001', name: N('Rogier') };
    const h = await setup({
      now: NOW,
      settings: settingsWith([], { seenVersion: '1.2.9', lines: [LINES.gdnAll, rogier] }),
      core: (now) =>
        stubCore(now, {
          board: (id) => {
            if (id === LINES.gdnAll.areaId) return boardOf(id, 'Gare du Nord', [dep(NOW, 3, { op: 'stib', mode: 'tram', line: '3', head: N('Churchill') })]);
            if (id !== rogier.areaId) return undefined;
            if (fail) throw new Error('Horaires injoignables');
            return boardOf(id, 'Rogier', [dep(NOW, 5, { op: 'stib', mode: 'metro', line: '2', head: N('Simonis') })]);
          },
        }),
    });
    await h.until((x) => x.screen === 'home');
    await h.c.replaceRoute({ screen: 'lines' });
    const s = await h.until((x: Screen) => x.screen === 'lines' && !x.lines.some((l) => l.trim() === '…'));
    expect(s.lines.slice(2, 4)).toEqual(['Rogier', 'Métro 2 vers Simonis   5 min']);
    await h.settle(50);
    fail = true;
    h.advance(30_000);
    await h.c.refreshCurrent();
    await h.settle(50);
    // son métro, 30 s plus près ; Gare du Nord, rafraîchie, aussi
    expect(h.last().lines.slice(0, 4)).toEqual(['Gare du Nord', 'Tram 3 vers Churchill   2 min', 'Rogier', 'Métro 2 vers Simonis   4 min']);
    h.c.stop();
  });

  it('« Lignes de bus, tram, métro » : la ligne en erreur garde ses sens', async () => {
    let fail = false;
    const FW: LineFollow = { id: 'f-w', op: 'tec', mode: 'bus', line: 'W', routes: [], via: { areaId: LINES.w.areaId, name: LINES.w.name, lat: LINES.w.lat, lon: LINES.w.lon } };
    const F3: LineFollow = { id: 'f-3', op: 'stib', mode: 'tram', line: '3', routes: [] };
    const h = await setup({
      now: NOW,
      settings: settingsWith([], { seenVersion: '1.2.9', follows: [FW, F3] }),
      core: (now) => {
        const c = stubCore(now);
        const heads = c.lineHeads!.bind(c);
        return Object.assign(c, {
          async lineHeads(f: LineFollow) {
            if (fail && f.line === 'W') throw new Error('Horaires injoignables');
            return heads(f);
          },
        });
      },
    });
    await h.until((x) => x.screen === 'home');
    await h.c.replaceRoute({ screen: 'follows' });
    const ready = (x: Screen) => x.screen === 'follows' && x.lines.length > 1 && !x.lines.some((l) => / …$/.test(l));
    const s = await h.until(ready);
    const shown = ['Bus W vers Braine-l’Alleud Gare', 'Bus W vers Bruxelles Midi', 'Tram 3 vers Churchill', 'Tram 3 vers Esplanade'];
    expect(s.lines.slice(0, 4)).toEqual(shown);
    // variantes retrouvées et gardées dans les réglages (rechargement) : attendre que tout soit posé
    await h.until(() => (h.settings.get().follows ?? []).every((x) => x.routes.length > 0));
    await h.settle(100);
    fail = true;
    h.advance(30_000);
    await h.c.refreshCurrent();
    await h.settle(50);
    expect(h.last().lines.slice(0, 4)).toEqual(shown);
    h.c.stop();
  });
});

describe('1.2.9 : les arrêts d’un départ de demain disent « demain » même quand la destination est longue', () => {
  it('« , demain » toujours au titre, la destination coupée avant lui (vraies destinations TEC du 13/11)', () => {
    // 23:40 : le tableau ne montre plus que les départs de demain ; on touche le bus 69 de 06:10
    const late = at('2026-11-12', 23, 40);
    const d = dep(late, 6 * 60 + 30, { op: 'tec', line: '69', head: N('Braine-le-Chateau Quatre Bras (Rue de Nivelles)') });
    const ds = stopsOf(d, d.sched, [['Tubize Gare', 0], ['Clabecq Place', 6], ['Braine-le-Chateau Quatre Bras', 14]]);
    const v = stopsView({ screen: 'stops', areaId: 'tec:X', dep: d }, ds, { now: late, settings: settingsWith([]) });
    const shown = nb(page(v).title);
    expect(shown.endsWith(', demain')).toBe(true);
    expect(shown.startsWith('Bus 69 vers Braine-le-Chateau')).toBe(true);
    // rien ne dépasse ; les heures des arrêts, elles, ne disent pas le jour
    expect(lines(v)[0]).toBe('06:10   Tubize Gare');
    // une destination courte : le titre entier, inchangé
    const short = dep(late, 6 * 60 + 30, { op: 'tec', line: 'W', head: N('Bruxelles Midi') });
    const w = stopsView({ screen: 'stops', areaId: 'tec:X', dep: short }, stopsOf(short, short.sched, [['Waterloo Eglise', 0], ['Bruxelles Midi', 40]]), { now: late, settings: settingsWith([]) });
    expect(nb(page(w).title)).toBe('Bus W vers Bruxelles Midi, demain');
  });
});

describe('1.2.9 : « Dans le train » d’un trajet de demain dit « demain » même quand la destination est longue', () => {
  it('« , demain » toujours au titre, la destination coupée avant lui', () => {
    const late = at('2026-11-12', 23, 40);
    const j = journey('j-69', [{ ride: '69', mode: 'bus', dep: at('2026-11-13', 6, 10), arr: at('2026-11-13', 6, 24), from: 'Tubize Gare', to: 'Braine-le-Chateau Quatre Bras', head: 'Braine-le-Chateau Quatre Bras (Rue de Nivelles)' }]);
    const v = trainView(j, j.legs.findIndex((l) => l.kind === 'ride'), { now: late, settings: settingsWith([]) });
    const shown = nb(page(v).title);
    expect(shown.endsWith(', demain')).toBe(true);
    expect(shown.startsWith('Bus 69 vers Braine-le-Chateau')).toBe(true);
    // une destination courte : inchangé
    const w = journey('j-w', [{ ride: 'W', mode: 'bus', dep: at('2026-11-13', 6, 10), arr: at('2026-11-13', 6, 50), from: 'Waterloo Eglise', to: 'Bruxelles Midi', head: 'Bruxelles Midi' }]);
    expect(nb(page(trainView(w, w.legs.findIndex((l) => l.kind === 'ride'), { now: late, settings: settingsWith([]) })).title)).toBe('Bus W vers Bruxelles Midi, demain');
  });
});
