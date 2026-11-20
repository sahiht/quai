/**
 * Quai 1.3.1, contrôle qualité du sujet « liste des arrêts » (PRD-1.3.1 § 6, § 12 B11). Arrêts d'un bus : la ligne
 * d'action est portée par le conteneur du curseur, 1 px après la marge du texte : elle garde la marge de sécurité de
 * tout texte des lunettes à droite (GEO.SAFETY) et Quai Web la lit aux lecteurs d'écran entre la note et les aides,
 * comme « ▶ Y aller » (1.3.0). Lecture du stockage ratée puis réussie : l'arrêt choisi entre-temps passe devant ceux
 * du téléphone et tout est enregistré. Lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { Departure, KV } from '../../src/core/api';
import { ALIGHTS_KEY, emptyAlights, keptStops, noteAlight, parseAlights } from '../../src/glasses/alights';
import { textWidth } from '../../src/glasses/font';
import { GEO, layoutPage, WIDTHS } from '../../src/glasses/layout';
import { stopsView, type ViewCtx } from '../../src/glasses/views';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { describeContainers } from '../../src/web/display';
import { MIN, at, boardOf, container, dep, nb, overflowing, settingsWith, setup, stopsOf, stubCore, trainRunOf } from './helpers';

const NOW = at('2026-11-20', 8, 0);
const N = (fr: string) => ({ fr, nl: fr });
const ctx = (patch: Partial<ViewCtx> = {}): ViewCtx => ({ now: NOW, settings: settingsWith([]), ...patch });
const b71 = dep(NOW, 6, { op: 'stib', mode: 'bus', line: '71', head: N('De Brouckère') });
const route = { screen: 'stops' as const, areaId: 'stib:Flagey', dep: b71 };
/** « ▶ Me guider jusqu'à » suivi de ce nom fait 542 px tout juste : toute la largeur d'un texte à la marge. */
const LONG = 'Bruxelles-Central Gare Place Sud Station';

describe('contrôle qualité : la ligne d’action des arrêts d’un bus, au pixel', () => {
  it('un nom qui remplit toute la ligne : à 1 px de la marge, la marge de sécurité à droite gardée, coupé au mot', () => {
    expect(textWidth(`▶ Me guider jusqu’à ${LONG}`)).toBe(WIDTHS.full);
    const v = stopsView(route, stopsOf(b71, NOW, [['Flagey', 6], [LONG, 30], ['Germoir', 40]]), ctx());
    const p = layoutPage(v, { sel: 0, top: 0 });
    expect(overflowing(p)).toEqual([]);
    const cur = container(p, 'cursor');
    const line = cur.content.split('\n').at(-1)!;
    // le texte commence 1 px après la marge du texte (5 espaces de 5 px depuis le curseur), jamais avant
    expect(cur.x + textWidth(line) - textWidth(line.trimStart()) - GEO.X_TEXT).toBe(1);
    // et finit, comme tout texte des lunettes, au plus à GEO.SAFETY du bord (LVGL ne passe jamais à la ligne)
    expect(cur.x + textWidth(line)).toBeLessThanOrEqual(GEO.X_END - GEO.SAFETY);
    expect(nb(line.trim())).toMatch(/^▶ Me guider jusqu’à Bruxelles-Central Gare Place .*…$/);
    expect(nb(p.lines.at(-2)!)).toBe(nb(line.trim()));
  });

  it('un train : la colonne a porte la ligne à la marge, le même nom y tient entier (inchangé)', () => {
    const ic = { ...b71, op: 'sncb' as const, mode: 'train' as const, line: 'IC', head: N('Bruxelles-Midi') };
    const ds = trainRunOf(ic, NOW, [['Namur', -30], ['Ottignies', 6], [LONG, 30], ['Bruxelles-Midi', 45]], 1);
    const v = stopsView({ screen: 'stops', areaId: 'sncb:Ottignies', dep: ic as Departure }, ds, ctx());
    const p = layoutPage(v, { sel: 2, top: 0 });
    expect(overflowing(p)).toEqual([]);
    const a = container(p, 'colA');
    expect(a.content.split('\n').at(-1)).toBe(`▶ Me guider jusqu’à ${LONG}`);
    expect(a.x + textWidth(`▶ Me guider jusqu’à ${LONG}`)).toBe(GEO.X_END - GEO.SAFETY);
  });
});

describe('contrôle qualité : Quai Web, lecteur d’écran', () => {
  const planned = (calls: [string, number, { cancelled?: boolean }?][]) => stopsOf(b71, NOW, calls.map(([s, m, p]) => [s, m, { rt: false, ...p }]));

  it('arrêts d’un bus : la ligne d’action se lit après la note et avant les aides, jamais comme une sélection', () => {
    const v = stopsView(route, planned([['Flagey', 6], ['Germoir', 8], ['Fernand Cocq', 10], ['Gare Centrale', 17]]), ctx());
    const said = nb(describeContainers(layoutPage(v, { sel: 1, top: 0 }).containers));
    expect(said.endsWith('. ~08:17, Gare Centrale. ~ horaire prévu, sans temps réel. ▶ Me guider jusqu’à Fernand Cocq. △▽ arrêts double : retour'), said).toBe(true);
    // une seule sélection, la rangée du curseur ; la ligne d'action n'en est pas une
    expect(said.split('. ').filter((t) => t.startsWith('sélection'))).toEqual(['sélection : ~08:10, Fernand Cocq']);
  });

  it('un arrêt supprimé sous le curseur : la rangée réservée, vide, ne se lit pas', () => {
    const v = stopsView(route, planned([['Flagey', 6], ['Germoir', 8, { cancelled: true }], ['Gare Centrale', 17]]), ctx());
    const said = nb(describeContainers(layoutPage(v, { sel: 0, top: 0 }).containers));
    expect(said).not.toContain('Me guider');
    expect(said.endsWith('. ~ horaire prévu, sans temps réel. △▽ arrêts double : retour'), said).toBe(true);
  });

  it('tout le trajet d’un train : la ligne d’action (colonne a) se lit une seule fois, à sa place', () => {
    const ic = { ...b71, op: 'sncb' as const, mode: 'train' as const, line: 'IC', head: N('Bruxelles-Midi') };
    const ds = trainRunOf(ic, NOW, [['Namur', -30], ['Ottignies', 6], ['Bruxelles-Central', 30], ['Bruxelles-Midi', 45]], 1);
    const v = stopsView({ screen: 'stops', areaId: 'sncb:Ottignies', dep: ic as Departure }, ds, ctx());
    const said = nb(describeContainers(layoutPage(v, { sel: 2, top: 0 }).containers));
    expect(said.split('Me guider')).toHaveLength(2);
    expect(said.endsWith('. ▶ Me guider jusqu’à Bruxelles-Central. △▽ arrêts double : retour'), said).toBe(true);
  });
});

describe('contrôle qualité : B11, lecture ratée puis réussie', () => {
  const STOPS: [string, number][] = [
    ['Flagey', 6],
    ['Germoir', 8],
    ['Fernand Cocq', 10],
    ['Gare Centrale', 17],
    ['De Brouckère', 20],
  ];
  const core = (now: () => number) =>
    stubCore(now, {
      board: (id) => (id === 'stib:Flagey' ? boardOf('stib:Flagey', 'Flagey', [b71]) : undefined),
      departureStops: (_id, d, n) => stopsOf(d, n, STOPS.map(([s, m]) => [s, m - Math.round((n - NOW) / MIN)])),
    });

  it('l’arrêt choisi pendant que le stockage ne répondait pas passe devant ceux du téléphone, puis tout est enregistré', async () => {
    const stored = JSON.stringify(noteAlight(emptyAlights(), 'stib|bus|71', { areaId: 'stib:FernandCocq', name: N('Fernand Cocq') }));
    const mem = createKV(memoryBackend());
    await mem.set(ALIGHTS_KEY, stored);
    // la première lecture stricte reste sans réponse, la suivante répond
    let fails = 1;
    const kv: KV = {
      get: (k) => mem.get(k),
      set: (k, v) => mem.set(k, v),
      getStrict: async (k) => {
        if (k === ALIGHTS_KEY && fails-- > 0) throw new Error('pas de réponse');
        return mem.get(k);
      },
    };
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.3.0' }), core, kv: kv as ReturnType<typeof createKV> });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'board', areaId: 'stib:Flagey', name: N('Flagey') });
    await h.until((x) => x.screen === 'board' && x.lines.length > 2);
    await h.gesture('down', 'tap');
    // lecture ratée : la liste s'ouvre comme en 1.3.0, rien n'est écrit
    const s = await h.until((x) => x.screen === 'stops' && x.lines.length > 3);
    expect(s.sel).toBe(0);
    expect(await mem.get(ALIGHTS_KEY)).toBe(stored);
    // « j'y descends » à Gare Centrale ; la lecture suivante répond : fusion, l'arrêt de la session d'abord
    await h.gesture('down', 'down', 'tap');
    await h.until((x) => x.screen === 'guide');
    await h.settle(50);
    expect(keptStops(parseAlights(await mem.get(ALIGHTS_KEY)), 'stib|bus|71').map((x) => x.fr)).toEqual(['Gare Centrale', 'Fernand Cocq']);
    h.c.stop();
  });
});
