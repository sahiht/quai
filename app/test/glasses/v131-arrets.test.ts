/**
 * Quai 1.3.1 (docs/v1.3.1/PRD-1.3.1.md § 6, § 12 B11) : dans la liste des arrêts d'un départ (bus, tram, métro, trajet
 * d'un train), sur un arrêt où le toucher lance « j'y descends », la ligne d'action « ▶ Me guider jusqu'à
 * Bruxelles-Central » (le nom de l'arrêt du curseur), au plus clair au-dessus des aides « △▽ arrêts   double : retour » ;
 * rien sur un arrêt où le toucher ne lance rien ; la ligne prend une rangée à la liste. Quai retient par ligne les 3
 * derniers arrêts choisis (clé quai.descentes, sur le téléphone) : la liste s'ouvre sur le plus récent après la montée ;
 * « Effacer le journal » les oublie. Lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { Departure, DepartureStops, KV } from '../../src/core/api';
import { ALIGHTS_KEY, ALIGHTS_LINES_MAX, alightLineKey, emptyAlights, keptIndex, keptStops, noteAlight, parseAlights } from '../../src/glasses/alights';
import { textWidth } from '../../src/glasses/font';
import { GUIDE_TO, HINTS, guideToText } from '../../src/glasses/format';
import { GEO, geometry, layoutPage, WIDTHS } from '../../src/glasses/layout';
import { stopsView, type ViewCtx } from '../../src/glasses/views';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { MIN, at, boardOf, container, dep, lines, nb, overflowing, settingsWith, setup, stopsOf, stubCore, trainRunOf } from './helpers';

const DAY = '2026-11-20';
const NOW = at(DAY, 8, 0);
const N = (fr: string) => ({ fr, nl: fr });
const ctx = (patch: Partial<ViewCtx> = {}): ViewCtx => ({ now: NOW, settings: settingsWith([]), ...patch });
const off = (): ViewCtx => ctx({ settings: settingsWith([], { display: { ...settingsWith([]).display, guide: false } }) });
const HINT = '△▽ arrêts   double : retour';
const HINT_130 = '△▽ arrêts   toucher : j’y descends   double : retour';

/** Bus 71 à Flagey : Flagey (la montée), puis quatre arrêts. */
const b71 = dep(NOW, 6, { op: 'stib', mode: 'bus', line: '71', head: N('De Brouckère') });
const route = { screen: 'stops' as const, areaId: 'stib:Flagey', dep: b71 };
const STOPS_71: [string, number][] = [
  ['Flagey', 6],
  ['Germoir', 8],
  ['Fernand Cocq', 10],
  ['Gare Centrale', 17],
  ['De Brouckère', 20],
];
const bus = (calls: [string, number, Partial<import('../../src/core/api').StopCall>?][] = STOPS_71): DepartureStops => stopsOf(b71, NOW, calls);
/** Page de la vue, le curseur sur la rangée `sel`. */
const at_ = (v: ReturnType<typeof stopsView>, sel: number) => layoutPage(v, { sel, top: 0 });

describe('PRD-1.3.1 § 6 : « ▶ Me guider jusqu’à … » dans la liste des arrêts d’un départ', () => {
  it('la ligne d’action dit l’arrêt du curseur et le suit ; l’aide perd le toucher ; la ligne prend une rangée', () => {
    const v = stopsView(route, bus(), ctx());
    expect(v.cursorAction).toBe(true);
    expect(nb(v.hints)).toBe(HINT);
    expect(lines(v).slice(-2)).toEqual(['▶ Me guider jusqu’à Germoir', HINT]);
    expect(nb(at_(v, 2).lines.at(-2)!)).toBe('▶ Me guider jusqu’à Gare Centrale');
    // une rangée de moins qu'en 1.3.0 (même vue, réglage éteint : ni ligne d'action ni rangée prise)
    const o = stopsView(route, bus(), off());
    expect(geometry(v).capacity).toBe(geometry(o).capacity - 1);
    // même forme de page quelle que soit la rangée du curseur : rien n'est reconstruit en bougeant
    const shape = (sel: number) => at_(v, sel).containers.map((c) => [c.id, c.x, c.y, c.w, c.h, c.level]);
    expect(shape(3)).toEqual(shape(0));
  });

  it('au plus clair, juste au-dessus des aides, à la marge du texte ; rien ne dépasse', () => {
    const v = stopsView(route, bus(), ctx());
    const p = at_(v, 2);
    expect(overflowing(p)).toEqual([]);
    const g = geometry(v);
    // l'heure (colonne a) des arrêts n'est pas au plus clair : la ligne d'action est dans le conteneur du curseur, élargi
    const cur = container(p, 'cursor');
    expect(cur.level).toBe(4);
    expect(container(p, 'colA').level).toBe(3);
    const rows = cur.content.split('\n');
    const line = rows.at(-1)!;
    expect(nb(line.trim())).toBe('▶ Me guider jusqu’à Gare Centrale');
    // sur la rangée de la ligne d'action : sous la note réservée, juste au-dessus de l'aide (pied)
    expect(cur.y + (rows.length - 1) * 27).toBe(g.footY + (g.noteLine ? 27 : 0));
    expect(container(p, 'foot').content.split('\n').at(-1)).toBe(v.hints);
    // le texte commence à la marge du texte (± 1 px), jamais avant
    const x = cur.x + textWidth(line) - textWidth(line.trimStart());
    expect(x).toBeGreaterThanOrEqual(GEO.X_TEXT);
    expect(x - GEO.X_TEXT).toBeLessThanOrEqual(1);
    // le curseur reste sur sa rangée
    expect(rows[2]).toBe('▶');
  });

  it('un arrêt supprimé : le toucher ne lance rien, pas de ligne d’action (sa rangée reste, vide)', () => {
    const v = stopsView(route, bus([['Flagey', 6], ['Germoir', 8, { cancelled: true }], ['Gare Centrale', 17]]), ctx());
    expect(v.items[0].action).toBeUndefined();
    expect(v.items[0].actionText).toBeUndefined();
    const p = at_(v, 0);
    expect(p.lines.map(nb).filter((l) => l.startsWith('▶ '))).toEqual([]);
    expect(container(p, 'cursor').content).not.toMatch(/Me guider/);
    expect(nb(at_(v, 1).lines.at(-2)!)).toBe('▶ Me guider jusqu’à Gare Centrale');
  });

  it('tout le trajet d’un train : rien sur les gares d’avant la montée ni sur la montée ; « ▶ Me guider jusqu’à Bruxelles-Central » après', () => {
    const ic = { ...b71, op: 'sncb' as const, mode: 'train' as const, line: 'IC', head: N('Bruxelles-Midi') };
    const ds = trainRunOf(ic, NOW, [['Namur', -30, { platform: '3' }], ['Gembloux', -12, { platform: '1' }], ['Ottignies', 6, { platform: '4' }], ['Bruxelles-Luxembourg', 30], ['Bruxelles-Central', 40], ['Bruxelles-Midi', 45]], 2);
    const v = stopsView({ screen: 'stops', areaId: 'sncb:Ottignies', dep: ic as Departure }, ds, ctx());
    expect(v.screen).toBe('trainRun');
    expect(v.cursorAction).toBe(true);
    // la colonne a (les gares) est au plus clair : la ligne d'action y est, comme « ▶ Y aller »
    expect(container(layoutPage(v, { sel: 4, top: 0 }), 'colA').content.split('\n').at(-1)).toBe('▶ Me guider jusqu’à Bruxelles-Central');
    for (const i of [0, 1, 2]) {
      expect(v.items[i].actionText).toBeUndefined();
      expect(layoutPage(v, { sel: i, top: 0 }).lines.map(nb).filter((l) => l.startsWith('▶ '))).toEqual([]);
    }
    expect(nb(lines(v).at(-2)!)).toBe('▶ Me guider jusqu’à Bruxelles-Luxembourg');
    expect(nb(v.hints)).toBe(HINT);
  });

  it('réglage « Me guider » éteint : comme en 1.3.0 (pas de ligne d’action, « toucher : j’y descends » dans l’aide)', () => {
    const v = stopsView(route, bus(), off());
    expect(v.cursorAction).toBeUndefined();
    expect(v.items.every((it) => it.actionText === undefined)).toBe(true);
    expect(lines(v).at(-1)).toBe(HINT_130);
    expect(lines(v).some((l) => l.startsWith('▶ '))).toBe(false);
  });

  it('un nom trop long est coupé au mot ; l’apostrophe des données devient « ’ »', () => {
    const long = 'Braine-l’Alleud Place Communale Rue de la Station Avenue du Japon Quartier Sud';
    const v = stopsView(route, bus([['Flagey', 6], [long, 30], ["Braine-l'Alleud", 35]]), ctx());
    const t = nb(at_(v, 0).lines.at(-2)!);
    expect(t).toMatch(/^▶ Me guider jusqu’à Braine-l’Alleud .*…$/);
    const shown = t.replace(/^▶ Me guider jusqu’à /, '').replace(/…$/, '');
    expect(long.startsWith(shown)).toBe(true);
    expect([' ', '-'].includes(long.charAt(shown.length)) || long.charAt(shown.length - 1) === '-').toBe(true);
    expect(textWidth(t)).toBeLessThanOrEqual(WIDTHS.full);
    expect(nb(at_(v, 1).lines.at(-2)!)).toBe('▶ Me guider jusqu’à Braine-l’Alleud');
    // les textes fixes : sans nom, « cet arrêt » ; au pixel
    expect(guideToText('', WIDTHS.full)).toBe(GUIDE_TO.stop);
    expect(textWidth(GUIDE_TO.stop)).toBeLessThanOrEqual(WIDTHS.full);
    expect(nb(HINTS.stopsGuide)).toBe(HINT);
  });
});

/* ------------------------------ B11 : l'arrêt retenu ------------------------------ */

describe('PRD-1.3.1 § 12 B11 : les arrêts retenus par ligne', () => {
  const key = alightLineKey(b71);
  const call = (name: string) => ({ areaId: `stib:${name.replace(/\W+/g, '')}`, name: N(name) });

  it('les 3 derniers, du plus récent au plus ancien, sans doublon ; 40 lignes au plus ; lecture tolérante', () => {
    let m = emptyAlights();
    for (const n of ['Germoir', 'Gare Centrale', 'Fernand Cocq', 'De Brouckère', 'Gare Centrale']) m = noteAlight(m, key, call(n));
    expect(keptStops(m, key).map((s) => s.fr)).toEqual(['Gare Centrale', 'De Brouckère', 'Fernand Cocq']);
    expect(key).toBe('stib|bus|71');
    expect(alightLineKey({ op: 'sncb', mode: 'train', line: 'IC' })).toBe('sncb|train|IC');
    for (let i = 0; i < ALIGHTS_LINES_MAX + 5; i++) m = noteAlight(m, `stib|bus|${i}`, call('Flagey'));
    expect(m.lines).toHaveLength(ALIGHTS_LINES_MAX);
    expect(m.lines[0].key).toBe(`stib|bus|${ALIGHTS_LINES_MAX + 4}`);
    // relu tel quel ; abîmé, d'une autre version ou vide : mémoire vide
    expect(parseAlights(JSON.stringify(m))).toEqual(m);
    for (const raw of [null, '', '{', '[]', '{"v":2,"lines":[]}', '{"v":1,"lines":[{"key":"x","stops":[{"fr":""}]}]}']) expect(parseAlights(raw)).toEqual(emptyAlights());
    // jamais de coordonnées : seulement une zone et des noms
    expect(JSON.stringify(noteAlight(emptyAlights(), key, { ...call('Germoir'), lat: 50.8, lon: 4.3 } as never))).not.toMatch(/lat|lon/);
  });

  it('la liste s’ouvre sur l’arrêt retenu le plus récent après la montée ; un arrêt supprimé ou avant la montée ne compte pas', () => {
    const kept = [call('Gare Centrale'), call('Fernand Cocq')].map((c) => ({ id: c.areaId, fr: c.name.fr }));
    const v = stopsView(route, bus(), ctx(), kept);
    expect(v.initialSel).toBe(2);
    expect(nb(lines(v).at(-2)!)).toBe('▶ Me guider jusqu’à Gare Centrale');
    // la plus récente supprimée aujourd'hui : la suivante
    const cancelled = stopsView(route, bus([['Flagey', 6], ['Germoir', 8], ['Fernand Cocq', 10], ['Gare Centrale', 17, { cancelled: true }]]), ctx(), kept);
    expect(cancelled.initialSel).toBe(1);
    // l'arrêt de la montée retenu (l'autre sens) : jamais le curseur sur lui
    const back = stopsView(route, bus(), ctx(), [{ id: 'stib:Flagey', fr: 'Flagey' }]);
    expect(back.initialSel).toBeUndefined();
    // par le nom quand la zone manque
    expect(keptIndex(bus().stops, [{ fr: 'gare centrale' }], () => true)).toBe(3);
    // sans mémoire : comme avant, le premier arrêt après la montée
    expect(stopsView(route, bus(), ctx()).initialSel).toBeUndefined();
    expect(nb(lines(stopsView(route, bus(), ctx())).at(-2)!)).toBe('▶ Me guider jusqu’à Germoir');
  });

  it('un train : le curseur sur la gare retenue, jamais sur une gare d’avant la montée', () => {
    const ic = { ...b71, op: 'sncb' as const, mode: 'train' as const, line: 'IC', head: N('Bruxelles-Midi') };
    const ds = trainRunOf(ic, NOW, [['Namur', -30], ['Gembloux', -12], ['Ottignies', 6], ['Bruxelles-Luxembourg', 30], ['Bruxelles-Central', 40], ['Bruxelles-Midi', 45]], 2);
    const kept = [{ id: 'sncb:Gembloux', fr: 'Gembloux' }, { id: 'sncb:BruxellesCentral', fr: 'Bruxelles-Central' }];
    const v = stopsView({ screen: 'stops', areaId: 'sncb:Ottignies', dep: ic as Departure }, ds, ctx(), kept);
    expect(v.initialSel).toBe(4);
    expect(nb(layoutPage(v, { sel: v.initialSel!, top: v.initialTop ?? 0 }).lines.at(-2)!)).toBe('▶ Me guider jusqu’à Bruxelles-Central');
  });
});

/* ------------------------------ Contrôleur : du tableau à « j'y descends », et retour ------------------------------ */

describe('PRD-1.3.1 § 6 et B11 : contrôleur', () => {
  const board = () => boardOf('stib:Flagey', 'Flagey', [b71]);
  const core = (now: () => number) => stubCore(now, { board: (id) => (id === 'stib:Flagey' ? board() : undefined), departureStops: (_id, d, n) => stopsOf(d, n, STOPS_71.map(([s, m]) => [s, m - Math.round((n - NOW) / MIN)])) });
  const stopsReady = (x: { screen: string; lines: string[] }) => x.screen === 'stops' && x.lines.length > 3;

  async function open(h: Awaited<ReturnType<typeof setup>>) {
    await h.c.show({ screen: 'board', areaId: 'stib:Flagey', name: N('Flagey') });
    await h.until((x) => x.screen === 'board' && x.lines.length > 2);
    await h.gesture('down', 'tap');
    return h.until(stopsReady);
  }

  it('toucher sur « ▶ Me guider jusqu’à Gare Centrale » le guide ; la ligne est retenue ; la liste se rouvre sur lui', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.3.0' }), core });
    await h.until((x) => x.screen === 'home');
    let s = await open(h);
    expect(s.title).toBe('Bus 71 vers De Brouckère');
    expect(s.lines.slice(-2)).toEqual(['▶ Me guider jusqu’à Germoir', HINT]);
    await h.gesture('down', 'down');
    expect(h.last().lines.slice(-2)).toEqual(['▶ Me guider jusqu’à Gare Centrale', HINT]);
    await h.gesture('tap');
    await h.until((x) => x.screen === 'guide');
    await h.settle(50);
    expect(parseAlights(await h.kv.get(ALIGHTS_KEY)).lines).toEqual([{ key: 'stib|bus|71', stops: [{ id: 'stib:GareCentrale', fr: 'Gare Centrale' }] }]);
    // la même ligne, plus tard : la liste s'ouvre sur Gare Centrale
    await h.c.stopGuide();
    s = await open(h);
    expect(s.sel).toBe(2);
    expect(s.lines.slice(-2)).toEqual(['▶ Me guider jusqu’à Gare Centrale', HINT]);
    // « Effacer le journal » (téléphone) : oubliés ; la liste se rouvre sur le premier arrêt
    h.c.forgetAlights();
    await h.settle(50);
    expect((await h.kv.get(ALIGHTS_KEY)) ?? '').toBe('');
    await h.gesture('double');
    await h.until((x) => x.screen === 'board');
    await h.gesture('tap');
    s = await h.until(stopsReady);
    expect(s.sel).toBe(0);
    expect(s.lines.slice(-2)).toEqual(['▶ Me guider jusqu’à Germoir', HINT]);
    h.c.stop();
  });

  it('une nouvelle session relit la mémoire ; une lecture sans réponse n’écrit rien (la mémoire du téléphone reste)', async () => {
    const stored = JSON.stringify(noteAlight(emptyAlights(), 'stib|bus|71', { areaId: 'stib:FernandCocq', name: N('Fernand Cocq') }));
    const kv = createKV(memoryBackend());
    await kv.set(ALIGHTS_KEY, stored);
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.3.0' }), core, kv });
    await h.until((x) => x.screen === 'home');
    const s = await open(h);
    expect(s.sel).toBe(1);
    expect(s.lines.slice(-2)).toEqual(['▶ Me guider jusqu’à Fernand Cocq', HINT]);
    h.c.stop();

    // stockage sans réponse (lecture stricte en erreur) : « j'y descends » ne remplace jamais la mémoire enregistrée
    const slow = createKV(memoryBackend());
    await slow.set(ALIGHTS_KEY, stored);
    const failing: KV = { get: (k) => slow.get(k), set: (k, v) => slow.set(k, v), getStrict: async (k) => (k === ALIGHTS_KEY ? Promise.reject(new Error('pas de réponse')) : slow.get(k)) };
    const b = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.3.0' }), core, kv: failing as ReturnType<typeof createKV> });
    await b.until((x) => x.screen === 'home');
    await open(b);
    await b.gesture('down', 'down', 'tap');
    await b.until((x) => x.screen === 'guide');
    await b.settle(50);
    expect(await slow.get(ALIGHTS_KEY)).toBe(stored);
    b.c.stop();
  });
});
