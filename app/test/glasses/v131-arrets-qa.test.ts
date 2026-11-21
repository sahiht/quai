/**
 * Quai 1.3.1, contrôle qualité du sujet « liste des arrêts » (PRD-1.3.1 § 6, § 12 B11). Arrêts d'un bus : la ligne
 * d'action est portée par le conteneur du curseur, 1 px après la marge du texte : elle garde la marge de sécurité de
 * tout texte des lunettes à droite (GEO.SAFETY) et Quai Web la lit aux lecteurs d'écran entre la note et les aides,
 * comme « ▶ Y aller » (1.3.0). Lecture du stockage ratée puis réussie : l'arrêt choisi entre-temps passe devant ceux
 * du téléphone et tout est enregistré. Lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { Departure, KV } from '../../src/core/api';
import { ALIGHTS_KEY, ALIGHTS_LINES_MAX, ALIGHTS_PER_LINE, emptyAlights, keptIndex, keptStops, noteAlight, parseAlights, sameKept } from '../../src/glasses/alights';
import { textWidth } from '../../src/glasses/font';
import { GEO, layoutPage, WIDTHS } from '../../src/glasses/layout';
import { stopsView, type ViewCtx } from '../../src/glasses/views';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { describeContainers } from '../../src/web/display';
import { newTally, pageCuts, tally } from '../scan/cuts';
import { MIN, at, boardOf, container, dep, nb, overflowing, page, settingsWith, setup, stopsOf, stubCore, trainRunOf } from './helpers';

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

describe('contrôle qualité : balayage des vrais noms (test/scan/cuts.ts) et ligne d’action', () => {
  // vrais arrêts publics que le balayage des données du 13/11 met dans « tout le trajet d'un train »
  const GENVAL = "Genval Route d'Ohain (Rue des Volontaires)";
  const LLN = "Louvain-la-Neuve Parc d'Affaires (Rue Rodeuhaie)";
  const SINT_JOB = "Sint-Job-in-'t-Goor Kristus Koning Ringven";
  const ic = { ...b71, op: 'sncb' as const, mode: 'train' as const, line: 'IC', head: N('Namur') };
  const cutsOf = (calls: [string, number, Partial<import('../../src/core/api').StopCall>?][]) => {
    const v = stopsView({ screen: 'stops', areaId: 'sncb:Namur', dep: ic as Departure }, trainRunOf(ic, NOW, calls, 0), ctx());
    const p = page(v);
    const t = newTally();
    tally(t, pageCuts(v, p));
    return { t, lines: p.lines.map(nb) };
  };

  it('un nom à apostrophe coupé dans la ligne d’action : une coupe au mot, retrouvée (« ’ » à l’écran, « \' » dans les données)', () => {
    const { t, lines } = cutsOf([['Namur', 2], [SINT_JOB, 30, { platform: '12a', newPlatform: '12b' }], [SINT_JOB, 60, { cancelled: true }]]);
    expect(lines.at(-2)).toMatch(/^▶ Me guider jusqu’à Sint-Job-in-’t-Goor .*…$/);
    expect(t).toMatchObject({ mid: 0, first: 0, unknown: 0 });
    expect(t.cut).toBe(2);
  });

  it('des gares différentes : chaque rangée comparée à sa gare, la ligne d’action à celle du curseur', () => {
    const { t, lines } = cutsOf([['Namur', 2], [GENVAL, 30, { platform: '12a', newPlatform: '12b' }], [LLN, 45, { platform: '12a', newPlatform: '12b' }], [SINT_JOB, 60, { cancelled: true }]]);
    expect(lines.filter((l) => /\S…/.test(l))).toHaveLength(3);
    expect(t).toMatchObject({ cut: 3, mid: 0, first: 0, unknown: 0 });
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
    // les deux premières lectures strictes (démarrage, ouverture de la liste) restent sans réponse, la suivante répond
    let fails = 2;
    const kv: KV = {
      get: (k) => mem.get(k),
      set: (k, v) => mem.set(k, v),
      getStrict: async (k) => {
        if (k === ALIGHTS_KEY && fails-- > 0) throw new Error('pas de réponse');
        return mem.get(k);
      },
    };
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.3.1' }), core, kv: kv as ReturnType<typeof createKV> });
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

describe('contrôle qualité, remarque 3 : la liste des arrêts n’attend jamais le stockage (B11)', () => {
  const STOPS: [string, number][] = [
    ['Flagey', 6],
    ['Germoir', 8],
    ['Fernand Cocq', 10],
    ['Gare Centrale', 17],
    ['De Brouckère', 20],
  ];
  const HINT = '△▽ arrêts   double : retour';
  const core = (now: () => number) =>
    stubCore(now, {
      board: (id) => (id === 'stib:Flagey' ? boardOf('stib:Flagey', 'Flagey', [b71]) : undefined),
      departureStops: (_id, d, n) => stopsOf(d, n, STOPS.map(([s, m]) => [s, m - Math.round((n - NOW) / MIN)])),
    });
  const stored = JSON.stringify(noteAlight(emptyAlights(), 'stib|bus|71', { areaId: 'stib:FernandCocq', name: N('Fernand Cocq') }));
  const stopsReady = (x: { screen: string; lines: string[] }) => x.screen === 'stops' && x.lines.length > 3;
  type H = Awaited<ReturnType<typeof setup>>;
  const openBoard = async (h: H) => {
    await h.c.show({ screen: 'board', areaId: 'stib:Flagey', name: N('Flagey') });
    await h.until((x) => x.screen === 'board' && x.lines.length > 2);
    await h.gesture('down');
  };
  const reopen = async (h: H) => {
    await h.gesture('double');
    await h.until((x) => x.screen === 'board');
    await h.gesture('tap');
    return h.until(stopsReady);
  };

  it('lecture stricte de 5 s : la liste est là tout de suite sur le premier arrêt, immobile ; l’ouverture suivante sur l’arrêt retenu', async () => {
    const mem = createKV(memoryBackend());
    await mem.set(ALIGHTS_KEY, stored);
    // le pont Even : la lecture stricte ne répond qu'au bout de 5 s (ici : quand le test la libère)
    let reads = 0;
    let release!: () => void;
    const gate = new Promise<void>((ok) => (release = ok));
    const kv: KV = {
      get: (k) => mem.get(k),
      set: (k, v) => mem.set(k, v),
      getStrict: async (k) => {
        if (k !== ALIGHTS_KEY) return mem.get(k);
        reads++;
        await gate;
        return mem.get(k);
      },
    };
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.3.1' }), core, kv: kv as ReturnType<typeof createKV> });
    await h.until((x) => x.screen === 'home');
    // lue tôt, en arrière-plan : dès le démarrage, sans rien retarder
    expect(reads).toBe(1);
    await openBoard(h);
    await h.gesture('tap');
    // la lecture n'a toujours pas répondu : la liste est déjà là, comme en 1.3.0, sur le premier arrêt
    let s = await h.until(stopsReady);
    expect(s.sel).toBe(0);
    expect(s.lines.slice(-2)).toEqual(['▶ Me guider jusqu’à Germoir', HINT]);
    // trois rafraîchissements pendant l'attente : aucune lecture de plus
    for (let i = 0; i < 3; i++) await h.c.refreshCurrent(true);
    expect(reads).toBe(1);
    // la lecture répond enfin : le curseur, que personne n'a bougé, ne saute pas sur l'arrêt retenu
    release();
    await h.settle(50);
    await h.c.refreshCurrent(true);
    s = h.last();
    expect(s.screen).toBe('stops');
    expect(s.sel).toBe(0);
    expect(s.lines.slice(-2)).toEqual(['▶ Me guider jusqu’à Germoir', HINT]);
    // la liste rouverte : sur l'arrêt retenu, sans nouvelle lecture
    s = await reopen(h);
    expect(s.sel).toBe(1);
    expect(s.lines.slice(-2)).toEqual(['▶ Me guider jusqu’à Fernand Cocq', HINT]);
    expect(reads).toBe(1);
    expect(await mem.get(ALIGHTS_KEY)).toBe(stored);
    h.c.stop();
  });

  it('stockage sans réponse : un essai au démarrage, un par ouverture de la liste, un à « j’y descends » ; jamais aux rafraîchissements', async () => {
    const mem = createKV(memoryBackend());
    await mem.set(ALIGHTS_KEY, stored);
    let reads = 0;
    const kv: KV = {
      get: (k) => mem.get(k),
      set: (k, v) => mem.set(k, v),
      getStrict: async (k) => {
        if (k !== ALIGHTS_KEY) return mem.get(k);
        reads++;
        throw new Error('pas de réponse');
      },
    };
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.3.1' }), core, kv: kv as ReturnType<typeof createKV> });
    await h.until((x) => x.screen === 'home');
    expect(reads).toBe(1);
    await openBoard(h);
    await h.gesture('tap');
    let s = await h.until(stopsReady);
    expect(s.sel).toBe(0);
    expect(reads).toBe(2);
    for (let i = 0; i < 3; i++) await h.c.refreshCurrent(true);
    await h.settle(50);
    expect(reads).toBe(2);
    expect(h.last().sel).toBe(0);
    // l'ouverture suivante réessaie, une fois
    s = await reopen(h);
    expect(s.sel).toBe(0);
    expect(reads).toBe(3);
    // « j'y descends » réessaie aussi ; rien n'est écrit par-dessus la mémoire du téléphone
    await h.gesture('down', 'tap');
    await h.until((x) => x.screen === 'guide');
    await h.settle(50);
    expect(reads).toBe(4);
    expect(await mem.get(ALIGHTS_KEY)).toBe(stored);
    h.c.stop();
  });
});

describe('contrôle qualité, remarque 7 : plafond de la mémoire et comparaison par zone (B11)', () => {
  it('40 lignes au plus : la moins récemment servie est oubliée d’abord, à l’écriture comme à la lecture', () => {
    let m = emptyAlights();
    for (let i = 1; i <= ALIGHTS_LINES_MAX + 2; i++) m = noteAlight(m, `stib|bus|${i}`, { areaId: `stib:A${i}`, name: N(`Arrêt ${i}`) });
    expect(m.lines).toHaveLength(ALIGHTS_LINES_MAX);
    expect(m.lines[0].key).toBe(`stib|bus|${ALIGHTS_LINES_MAX + 2}`);
    expect(m.lines.at(-1)!.key).toBe('stib|bus|3');
    expect(keptStops(m, 'stib|bus|1')).toEqual([]);
    // un contenu plus long (autre version, abîmé) : les 40 premières lignes, 3 arrêts par ligne, sans doublon de ligne
    const stops = [1, 2, 3, 4, 5].map((k) => ({ id: `stib:S${k}`, fr: `Arrêt ${k}` }));
    const big = { v: 1, lines: [{ key: 'stib|bus|0', stops }, { key: 'stib|bus|0', stops }, ...Array.from({ length: ALIGHTS_LINES_MAX + 5 }, (_, i) => ({ key: `stib|tram|${i}`, stops })) ] };
    const read = parseAlights(JSON.stringify(big));
    expect(read.lines).toHaveLength(ALIGHTS_LINES_MAX);
    expect(read.lines.map((l) => l.key).slice(0, 3)).toEqual(['stib|bus|0', 'stib|tram|0', 'stib|tram|1']);
    expect(read.lines.every((l) => l.stops.length === ALIGHTS_PER_LINE)).toBe(true);
    expect(read.lines[0].stops.map((x) => x.fr)).toEqual(['Arrêt 1', 'Arrêt 2', 'Arrêt 3']);
  });

  it('même arrêt : la zone quand les deux la donnent (deux arrêts du même nom restent deux arrêts), sinon le nom', () => {
    const flagey = { id: 'stib:Flagey', fr: 'Flagey' };
    // même nom, autre zone : ce n'est pas le même arrêt
    expect(sameKept(flagey, { areaId: 'stib:Flagey', name: N('Flagey (quai 2)') })).toBe(true);
    expect(sameKept(flagey, { areaId: 'delijn:Flagey', name: N('Flagey') })).toBe(false);
    // une zone manque d'un côté : le nom, sans la casse, les accents ni la ponctuation ; le néerlandais compte aussi
    expect(sameKept({ fr: 'Gare Centrale' }, { areaId: 'stib:GareCentrale', name: N('gare centrale') })).toBe(true);
    expect(sameKept(flagey, { name: N('Germoir') })).toBe(false);
    expect(sameKept({ fr: 'Gare Centrale', nl: 'Centraal Station' }, { name: { fr: 'Bruxelles-Central', nl: 'Centraal station' } })).toBe(true);
    // la liste s'ouvre sur l'arrêt de la bonne zone, pas sur son homonyme d'avant
    const calls = [{ areaId: 'delijn:Flagey', name: N('Flagey') }, { areaId: 'stib:Germoir', name: N('Germoir') }, { areaId: 'stib:Flagey', name: N('Flagey') }];
    expect(keptIndex(calls, [flagey], () => true)).toBe(2);
    // deux fois le même arrêt (zone) : une seule entrée, la plus récente en tête
    const m = noteAlight(noteAlight(noteAlight(emptyAlights(), 'stib|bus|71', calls[2]), 'stib|bus|71', calls[1]), 'stib|bus|71', calls[2]);
    expect(keptStops(m, 'stib|bus|71').map((x) => x.id)).toEqual(['stib:Flagey', 'stib:Germoir']);
  });
});
