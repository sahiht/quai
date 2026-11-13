/**
 * Quai 1.2.6, « Arrêts de bus, tram, métro » et « Lignes de bus, tram, métro » (docs/v1.2.6/PRD-1.2.6.md § 2 à § 4 ;
 * CA-126.2 à CA-126.4), avec ce qui reste de la 1.2.2 (docs/v1.2.2/PRD-1.2.2.md § 3 ; CA-122.4 ; REVUE-USAGE n° 3 et
 * n° 4) : un arrêt et ses deux prochains départs ; une ligne suivie, un sens par rangée, toute la ligne dans un sens
 * (lineRun), le détail d'une ligne à un arrêt (4 passages par sens, passage partiel « jusqu'à … »), « garder une ligne »
 * (la ligne entière, l'arrêt en repère), l'ouverture d'office des départs de l'arrêt repère. Données du faux cœur
 * (dev/fake-core.ts : les gabarits lus par le calcul du vrai cœur, core/linerun.ts) au 10/11 à 07:31, et passages
 * construits pour les cas précis.
 */
import { describe, expect, it } from 'vitest';
import type { Core, LineBoard } from '../../src/core/api';
import type { LineFollow, LineRun } from '../../src/core/linerun';
import { passagesText } from '../../src/glasses/format';
import { layoutPage } from '../../src/glasses/layout';
import { textWidth } from '../../src/glasses/font';
import type { GlassesView } from '../../src/glasses/types';
import { followsView, lineRunView, lineView, linesView, type ViewCtx } from '../../src/glasses/views';
import { LINES, MIN, PLACES, at, container, dep, lineBoardOf, lines, nb, page, rowsOf, settingsWith, setup, stubCore, type Screen } from './helpers';
import { LIMITS } from '../../src/settings';

const NOW = at('2026-11-10', 7, 31);
const ctx = (patch = {}): ViewCtx => ({ now: NOW, settings: settingsWith([], { lines: [LINES.gdnAll], ...patch }) });
const linesReady = (s: Screen) => s.screen === 'lines' && !s.lines.some((l) => / …$/.test(l) || l === '…');
const followsReady = (s: Screen) => s.screen === 'follows' && s.lines.length > 1 && !s.lines.some((l) => / …$/.test(l));
const runReady = (s: Screen) => s.screen === 'lineRun' && s.lines.length > 3;
const N = (fr: string) => ({ fr, nl: fr });
const via = (p: (typeof LINES)[keyof typeof LINES]) => ({ areaId: p.areaId, name: p.name, lat: p.lat, lon: p.lon });
/** Lignes suivies : le W (repère Merbraine) et le tram 3 (sans repère). */
const FW: LineFollow = { id: 'f-w', op: 'tec', mode: 'bus', line: 'W', routes: [], via: via(LINES.w) };
const F3: LineFollow = { id: 'f-3', op: 'stib', mode: 'tram', line: '3', routes: [] };

/** Au pixel : les mots (clairs et pâles) finissent avant le texte de droite, et dans l'écran sans lui. */
function fitsRows(v: GlassesView, sel = 0): void {
  const p = sel ? layoutPage(v, { sel, top: sel }) : page(v);
  const [a, b, c] = ['colA', 'colB', 'colC'].map((n) => container(p, n));
  const right = rowsOf(c);
  for (const k of [a, b])
    rowsOf(k).forEach((row, i) => {
      const r = right[i] ?? '';
      const start = r.trim() ? c.x + textWidth(r) - textWidth(r.trimStart()) : k.x + k.w;
      expect(k.x + textWidth(row.trimEnd()), row).toBeLessThan(start);
    });
}

/** W à Merbraine : un W partiel (s'arrête à Waterloo Eglise) en tête vers Bruxelles Midi. */
const partialW = (now: number): LineBoard =>
  lineBoardOf('tec:Bbrlmer1', 'Braine-l’Alleud Merbraine', 'W', [
    { head: 'Bruxelles Midi', departures: [dep(now, 4, { partial: true, head: N('Waterloo Eglise') }), dep(now, 18), dep(now, 38), dep(now, 58, { rt: false }), dep(now, 78, { rt: false })] },
    { head: 'Braine-l’Alleud Gare', departures: [dep(now, 9, { head: N('Braine-l’Alleud Gare') }), dep(now, 29, { head: N('Braine-l’Alleud Gare'), cancelled: true })] },
  ]);

describe('CA-126.2 : « Arrêts de bus, tram, métro »', () => {
  it('un arrêt « toutes les lignes » : son nom, ses 2 prochains départs, un par ligne ; toucher : le tableau', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.6', lines: [LINES.gdnAll] }), core: (now) => stubCore(now) });
    const home = await h.until((x) => x.screen === 'home' && x.lines.some((l) => l.startsWith('Arrêts de bus, tram, métro   1')));
    expect(home.lines.slice(-2)).toEqual(['Arrêts de bus, tram, métro   1 arrêt', 'Lignes de bus, tram, métro   à choisir']);
    await h.c.replaceRoute({ screen: 'lines' });
    const s = await h.until(linesReady);
    // 1.2.5 (PRD-1.2.5 § 4) : un départ par ligne, « Tram 3 vers Churchill », l'attente à droite ; 1.2.6 : l'écran
    // porte le nom de la rubrique, plus d'intitulé « ARRÊTS »
    expect(s.title).toBe('Arrêts de bus, tram, métro');
    expect(s.lines.slice(0, 3)).toEqual(['Gare du Nord', 'Tram 3 vers Churchill   1 min', 'Tram 4 vers Stalle   4 min']);
    await h.gesture('tap');
    // CA-123.3 (lunettes) : le tableau complet de l'arrêt, la ligne ★ en tête, le curseur sur le premier départ
    const b = await h.until((x) => x.screen === 'board' && x.lines.length > 2);
    expect(b.title).toBe('Gare du Nord, tram (STIB) ★');
    expect(b.lines.slice(0, 3)).toEqual(['★ garder une ligne', 'T3   Churchill   1 min', 'T4   Stalle   4 min']);
    expect(b.sel).toBe(1);
    expect((b as Screen & { departures?: number }).departures).toBeGreaterThan(8);
    h.c.stop();
  });

  it('revue : arrêt introuvable : « introuvable : modifie-le sur le téléphone » ; Quai Web : #/arrets', async () => {
    // identifiant inconnu, et aucune zone de ce nom autour de l'endroit du choix (faux cœur : missing, sans exception)
    const lostAll = { ...LINES.gdnAll, id: 'ln-lost-all', areaId: 'stib:0002', name: N('Arrêt supprimé') };
    const settings = () => settingsWith([], { seenVersion: '1.2.6', lines: [lostAll] });
    const h = await setup({ now: NOW, settings: settings(), core: (now) => stubCore(now) });
    await h.until((x) => x.screen === 'home');
    await h.c.replaceRoute({ screen: 'lines' });
    const s = await h.until(linesReady);
    expect(s.lines.slice(0, 2)).toEqual(['Arrêt supprimé', 'introuvable : modifie-le sur le téléphone']);
    await h.gesture('tap');
    expect(h.last().screen).toBe('lines');
    // rien n'a bougé dans les réglages
    expect(h.settings.get().lines.map((p) => p.areaId)).toEqual(['stib:0002']);
    h.c.stop();
    const opened: string[] = [];
    const w = await setup({ now: NOW, web: true, opened, settings: settings(), core: (now) => stubCore(now) });
    await w.until((x) => x.screen === 'home');
    await w.c.replaceRoute({ screen: 'lines' });
    const ws = await w.until(linesReady);
    expect(ws.lines[1]).toBe('introuvable : modifie-le dans Réglages');
    await w.gesture('tap');
    expect(opened).toEqual(['#/arrets']);
    w.c.stop();
  });

  it('revue : zone retrouvée sous un autre identifiant (même nom à 150 m) : l’arrêt choisi suit', async () => {
    const renamed = { ...LINES.gdnAll, areaId: 'stib:0003' };
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.6', lines: [renamed] }), core: (now) => stubCore(now) });
    await h.until((x) => x.screen === 'home');
    await h.c.replaceRoute({ screen: 'lines' });
    const s = await h.until(linesReady);
    expect(s.lines.slice(0, 3)).toEqual(['Gare du Nord', 'Tram 3 vers Churchill   1 min', 'Tram 4 vers Stalle   4 min']);
    await h.until(() => h.settings.get().lines.every((p) => p.areaId === 'stib:6357F'));
    expect(h.settings.get().lines.map((p) => [p.id, p.areaId, p.line])).toEqual([['ln-gdn', 'stib:6357F', undefined]]);
    h.c.stop();
  });

  it('une ligne gardée à un arrêt (réglages d’avant la 1.2.6) n’est plus un arrêt : la rubrique dit où en choisir', () => {
    const v = linesView([{ pick: LINES.t3 }], ctx({ lines: [LINES.t3] }));
    expect(v.title).toBe('Arrêts de bus, tram, métro');
    expect(lines(v)).toEqual(['Choisis tes arrêts dans Quai, sur le téléphone.', 'double toucher : retour']);
    // ses départs pas encore là : « … » sous le nom, jamais une ligne vide
    expect(lines(linesView([{ pick: LINES.gdnAll }], ctx())).slice(0, 2)).toEqual(['Gare du Nord', '…']);
  });
});

describe('CA-126.3 : « Lignes de bus, tram, métro », toute la ligne dans un sens', () => {
  it('un sens par rangée, sans attente ; toucher : toute la ligne, le curseur sur l’arrêt le plus proche ; « ↔ Autre sens »', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.6', follows: [FW, F3] }), core: (now) => stubCore(now) });
    const home = await h.until((x) => x.screen === 'home' && x.lines.some((l) => l.startsWith('Lignes de bus, tram, métro   2')));
    expect(home.lines.at(-1)).toBe('Lignes de bus, tram, métro   2 lignes');
    await h.c.replaceRoute({ screen: 'follows' });
    const f = await h.until(followsReady);
    expect(f.title).toBe('Lignes de bus, tram, métro');
    // les sens rangés par terminus ; la liste ne demande aucun passage
    expect(f.lines).toEqual(['Bus W vers Braine-l’Alleud Gare', 'Bus W vers Bruxelles Midi', 'Tram 3 vers Churchill', 'Tram 3 vers Esplanade', '△▽ choisir   toucher : la ligne   double : retour']);
    // variantes et terminus retrouvés à la première ouverture, puis gardés
    await h.until(() => (h.settings.get().follows ?? []).every((x) => x.routes.length > 0));
    expect(h.settings.get().follows?.map((x) => [x.id, x.routes.length, x.ends?.length])).toEqual([
      ['f-w', 3, 2],
      ['f-3', 2, 2],
    ]);
    // vers Bruxelles Midi : de Braine-l'Alleud Gare à Bruxelles Midi ; Merbraine (à 500 m de la maison) sous le curseur
    await h.gesture('down', 'tap');
    const r = await h.until(runReady);
    expect(r.title).toBe('Bus W vers Bruxelles Midi');
    expect(r.sel).toBe(1);
    expect(r.lines.find((l) => / à \d+ m {3}/.test(l))).toMatch(/^[○●] Braine-l’Alleud Merbraine à 500 m {3}\S/);
    expect(r.lines.filter((l) => /^[○●] [^:]/.test(l)).map((l) => l.slice(2).split('   ')[0].replace(/ à \d+ m$/, ''))).toEqual(['Braine-l’Alleud Gare', 'Braine-l’Alleud Merbraine', 'Waterloo Eglise', 'Bruxelles Midi']);
    expect(r.lines).toContain('↔ Autre sens vers Braine-l’Alleud Gare');
    expect(r.lines.at(-1)).toBe('△▽ arrêts   toucher : passages   double : retour');
    // « ↔ Autre sens » : l'autre sens ; double toucher : la liste
    for (let i = 0; i < 4; i++) await h.gesture('down');
    await h.gesture('tap');
    expect((await h.until((x) => runReady(x) && x.title !== r.title)).title).toBe('Bus W vers Braine-l’Alleud Gare');
    await h.gesture('double');
    expect(h.last().screen).toBe('lineRun');
    await h.gesture('double');
    expect(h.last().screen).toBe('follows');
    h.c.stop();
  });

  it('toucher un arrêt : les passages de la ligne à cet arrêt (deux sens), puis tous les départs de l’arrêt', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.6', follows: [F3] }), core: (now) => stubCore(now) });
    await h.until((x) => x.screen === 'home');
    await h.c.replaceRoute({ screen: 'follows' });
    await h.until(followsReady);
    await h.gesture('tap');
    const r = await h.until(runReady);
    expect(r.title).toBe('Tram 3 vers Churchill');
    // à plus de 2 km de tout arrêt : le curseur sur le premier
    expect(r.sel).toBe(0);
    await h.gesture('down', 'tap');
    const d = await h.until((x) => x.screen === 'line' && x.lines.length > 3);
    expect(d.title).toBe('Tram 3 · Gare du Nord');
    expect(d.lines.filter((l) => l.startsWith('vers ')).sort()).toEqual(['vers Churchill', 'vers Esplanade']);
    await h.gesture('double');
    expect(h.last()).toMatchObject({ screen: 'lineRun', sel: 1 });
    h.c.stop();
  });

  it('ligne introuvable dans les données du jour : « introuvable : modifie-la sur le téléphone » ; Quai Web : #/lignes', async () => {
    const lost: LineFollow = { id: 'f-lost', op: 'tec', mode: 'bus', line: 'ZZ9', routes: [] };
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.6', follows: [lost, F3] }), core: (now) => stubCore(now) });
    await h.until((x) => x.screen === 'home');
    await h.c.replaceRoute({ screen: 'follows' });
    const f = await h.until(followsReady);
    expect(f.lines.slice(0, 4)).toEqual(['Bus ZZ9', 'introuvable : modifie-la sur le téléphone', 'Tram 3 vers Churchill', 'Tram 3 vers Esplanade']);
    // rien à ouvrir ; la ligne reste dans les réglages
    expect(f.sel).toBe(0);
    await h.gesture('tap');
    expect(h.last().screen).toBe('follows');
    expect(h.settings.get().follows?.map((x) => x.id)).toEqual(['f-lost', 'f-3']);
    h.c.stop();
    const opened: string[] = [];
    const w = await setup({ now: NOW, web: true, opened, settings: settingsWith([], { seenVersion: '1.2.6', follows: [lost] }), core: (now) => stubCore(now) });
    await w.until((x) => x.screen === 'home');
    await w.c.replaceRoute({ screen: 'follows' });
    const ws = await w.until(followsReady);
    expect(ws.lines.slice(0, 2)).toEqual(['Bus ZZ9', 'introuvable : modifie-la dans Réglages']);
    await w.gesture('tap');
    expect(opened).toEqual(['#/lignes']);
    w.c.stop();
  });

  it('vue : ○ et ●, « à 80 m », les passages comme les tableaux, « ~ » expliqué, la ligne du haut ; tout tient au pixel', () => {
    const t = (m: number, rt = true) => ({ t: NOW + m * MIN, rt });
    const run: LineRun = {
      op: 'stib',
      mode: 'tram',
      line: '3',
      heads: [N('Churchill'), N('Esplanade')],
      dir: 0,
      stops: [
        { areaId: 'stib:6380', name: N('Esplanade'), lat: 0, lon: 0, next: [t(6), t(14)] },
        { areaId: 'stib:6357F', name: N('Gare du Nord'), lat: 0, lon: 0, next: [t(2), t(10)], vehicle: true },
        { areaId: 'stib:6359', name: N('Rogier'), lat: 0, lon: 0, next: [t(4, false), t(12, false)] },
        { areaId: 'stib:6361', name: N('Louvain-la-Neuve Place des Sciences, quai central'), lat: 0, lon: 0, next: [t(75), t(95)] },
        { areaId: 'stib:6366', name: N('Churchill'), lat: 0, lon: 0, next: [], last: true },
      ],
      nearest: { index: 1, distanceM: 80 },
      rtError: false,
      state: 'ok',
    };
    const route = { screen: 'lineRun' as const, follow: F3.id, dir: 0 };
    const v = lineRunView(route, F3, run, ctx({ follows: [F3] }));
    expect(v.title).toBe('Tram 3 vers Churchill');
    expect(v.initialSel).toBe(1);
    const l = lines(v);
    expect(l[0]).toBe('● : un tram arrive');
    expect(l.slice(1, 4)).toEqual(['○ Esplanade   6 · 14 min', '● Gare du Nord à 80 m   2 · 10 min', '○ Rogier   ~4 · ~12 min']);
    // un nom trop long est coupé, jamais les passages ; au-delà de 60 min, l'heure
    expect(l[4]).toMatch(/^○ Louvain-la-Neuve Place des Sciences.*…   08:46 · 09:06$/);
    expect(l[5]).toBe('○ Churchill   aucun passage');
    expect(l[6]).toBe('↔ Autre sens vers Esplanade');
    expect(l.at(-2)).toBe('~ horaire prévu, sans temps réel');
    fitsRows(v);
    fitsRows(v, 4);
    // une boucle (un seul sens) : pas d'autre sens ; aucun véhicule : pas de ligne du haut
    const loop = lineRunView(route, F3, { ...run, heads: [N('Churchill')], stops: run.stops.map((s) => ({ ...s, vehicle: false })) }, ctx());
    expect(lines(loop).some((x) => x.startsWith('↔'))).toBe(false);
    expect(lines(loop)[0]).toBe('○ Esplanade   6 · 14 min');
    // ligne introuvable : un message
    expect(lines(lineRunView(route, F3, { ...run, state: 'missing', stops: [] }, ctx()))).toEqual(['Introuvable : modifie-la sur le téléphone.', 'double toucher : retour']);
  });

  it('liste : un sens par rangée, la ligne et sa destination au plus clair ; en calcul « … » ; destination longue coupée', () => {
    const v = followsView(
      [
        { follow: FW, mode: 'bus', heads: [N('Braine-l’Alleud Gare'), N('Rixensart Gare par le chemin le plus long qui soit, quai de la ligne W, direction Bruxelles')] },
        { follow: F3 },
      ],
      ctx({ follows: [FW, F3] }),
    );
    const l = lines(v);
    expect(l[0]).toBe('Bus W vers Braine-l’Alleud Gare');
    expect(l[1]).toMatch(/^Bus W vers Rixensart Gare par le .*…$/);
    expect(l[2]).toBe('Tram 3   …');
    fitsRows(v);
    expect(v.items[0].action).toEqual({ kind: 'open', route: { screen: 'lineRun', follow: 'f-w', dir: 0 } });
    expect(v.items[1].action).toEqual({ kind: 'open', route: { screen: 'lineRun', follow: 'f-w', dir: 1 } });
    // sans ligne : où en choisir
    expect(lines(followsView([], ctx()))).toEqual(['Choisis tes lignes dans Quai, sur le téléphone.', 'double toucher : retour']);
  });
});

describe('§ 3 : le détail d’une ligne à un arrêt (ouvert depuis toute la ligne), textes et largeurs', () => {
  it('passage partiel : « jusqu’à Waterloo Eglise » ; 4 passages par sens ; « Tous les départs de l’arrêt »', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.6', follows: [FW] }), core: (now) => stubCore(now, { lineBoard: (id, _l, n) => (id === LINES.w.areaId ? partialW(n) : undefined) }) });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'line', areaId: LINES.w.areaId, op: 'tec', line: 'W', name: LINES.w.name, mode: 'bus' });
    const d = await h.until((x) => x.screen === 'line' && x.lines.length > 3);
    expect(d.title).toBe('Bus W · Braine-l’Alleud Merbraine');
    expect(d.lines.slice(0, 6)).toEqual(['vers Bruxelles Midi', '07:35  jusqu’à Waterloo Eglise   dans 4 min', '07:49   dans 18 min', '08:09   dans 38 min', '~08:29   dans 58 min', 'vers Braine-l’Alleud Gare']);
    // 1.2.3 : curseur sur le premier passage (« vers … » ne se sélectionne jamais), la liste défile par page
    expect(d.sel).toBe(0);
    expect(d.lines.at(-1)).toBe('△▽ passages   toucher : arrêts   double : retour');
    // ▼ jusqu'au bout : « Tous les départs de l'arrêt » ; le 5e passage n'est jamais montré
    for (let i = 0; i < 8; i++) await h.gesture('down');
    const end = h.last();
    expect(end.sel).toBe(6);
    // la page suivante commence au curseur : rien de la page d'avant n'est répété
    expect(end.lines).toEqual(['08:00   SUPPRIMÉ', 'Tous les départs de l’arrêt', '~ horaire prévu, sans temps réel', '△▽ passages   toucher : arrêts   double : retour']);
    expect(end.lines.join('\n')).not.toContain('08:49');
    // toucher : le tableau de l'arrêt ; double toucher : le détail
    await h.gesture('tap');
    expect((await h.until((x) => x.screen === 'board')).title).toMatch(/^Braine-l’Alleud Merbraine/);
    await h.gesture('double');
    expect(h.last()).toMatchObject({ screen: 'line', sel: 6 });
    h.c.stop();
  });

  it('revue : sans passage (none), « aucun passage », jamais « introuvable » ; le mode du réglage d’abord', () => {
    // aucun motif du W à cet arrêt : le cœur suppose le mode de l'arrêt (tram)
    const guess = lineBoardOf('stib:6357F', 'Gare du Nord', 'W', [], { mode: 'tram' });
    expect(guess.state).toBe('none');
    const route = { screen: 'line' as const, areaId: 'stib:6357F', op: 'stib' as const, line: 'W', name: N('Gare du Nord') };
    expect(lineView({ ...route, mode: 'bus' }, guess, { now: NOW, settings: settingsWith([]) }).title).toBe('Bus W · Gare du Nord');
    const unknown = lineView(route, guess, { now: NOW, settings: settingsWith([]) });
    expect(unknown.title).toBe('Ligne W · Gare du Nord');
    expect(lines(unknown).slice(0, 2)).toEqual(['aucun passage dans les prochaines heures', 'Tous les départs de l’arrêt']);
  });

  it('données réelles du 12/11 (forme) : le 36 à Braine-l’Alleud Côté du Collège, le passage vers Vallée Bailly dit', () => {
    const now = at('2026-11-12', 7, 31);
    const b = lineBoardOf('tec:Bbrlcco1', 'Braine-l’Alleud Côté du Collège', '36', [
      { head: 'Wavre', departures: [dep(now, 6, { line: '36', head: N('Vallée Bailly'), partial: true }), dep(now, 36, { line: '36', head: N('Wavre') })] },
      { head: 'Braine-l’Alleud Gare', departures: [dep(now, 12, { line: '36', head: N('Braine-l’Alleud Gare') })] },
    ]);
    const detail = lineView({ screen: 'line', areaId: 'tec:Bbrlcco1', op: 'tec', line: '36', name: N('Braine-l’Alleud Côté du Collège') }, b, { now, settings: settingsWith([]) });
    expect(lines(detail).slice(0, 3)).toEqual(['vers Wavre', '07:37  jusqu’à Vallée Bailly   dans 6 min', '08:07   dans 36 min']);
  });

  it('« 3 · 18 min », « imminent », « ~4 min », « SUPPRIMÉ », l’heure au-delà de 60 min, comme les tableaux', () => {
    const t = (...deps: Parameters<typeof dep>[]) => nb(passagesText(deps.map((x) => dep(...x)), NOW, true));
    expect(t([NOW, 3], [NOW, 18])).toBe('3 · 18 min');
    expect(t([NOW, 0], [NOW, 9])).toBe('imminent · 9 min');
    expect(t([NOW, 4, { rt: false }], [NOW, 19, { rt: false }])).toBe('~4 · ~19 min');
    expect(t([NOW, 45], [NOW, 75])).toBe('45 min · 08:46');
    expect(t([NOW, 3, { cancelled: true }], [NOW, 18])).toBe('SUPPRIMÉ · 18 min');
    expect(t([NOW, 3], [NOW, 18, { partial: true }])).toBe('3 · 18 min*');
    expect(t([NOW, 3])).toBe('3 min');
    expect(passagesText([], NOW, true)).toBe('aucun passage');
    // à 23:30, les passages du lendemain matin, comme les tableaux (S6) : « demain 06:02 · 06:22 »
    const late = at('2026-11-10', 23, 30);
    const morning = (m: number, p = {}) => dep(late, m, p);
    expect(nb(passagesText([morning(392), morning(412)], late, true))).toBe('demain 06:02 · 06:22');
    expect(nb(passagesText([morning(392, { rt: false })], late, true))).toBe('demain ~06:02');
    // deux heures et leurs « ~ » ne tiennent pas dans la colonne de 210 px : la première seulement, jamais « … »
    expect(nb(passagesText([morning(392, { rt: false }), morning(400, { rt: false })], late, true))).toBe('demain ~06:02');
    // le dernier passage du soir, puis le premier du lendemain : l'attente d'abord, sans « demain »
    expect(nb(passagesText([morning(10), morning(392)], late, true))).toBe('10 min · 06:02');
  });

  it('détail : alerte travaux en haut ; ligne introuvable : un message', () => {
    const d = lineView({ screen: 'line', areaId: LINES.w.areaId, op: 'tec', line: 'W', name: LINES.w.name }, partialW(NOW), ctx(), 'Déviation : arrêt Merbraine déplacé');
    expect(lines(d)[0]).toBe('! Déviation : arrêt Merbraine déplacé');
    const missing = lineView({ screen: 'line', areaId: 'stib:6357F', op: 'stib', line: 'W', name: N('Gare du Nord') }, { ...lineBoardOf('stib:6357F', 'Gare du Nord', 'W', []), state: 'missing' }, ctx());
    expect(lines(missing)).toEqual(['Introuvable : modifie-la sur le téléphone.', 'double toucher : retour']);
  });
});

describe('REVUE-USAGE n° 3 et CA-126.4 : « garder une ligne » depuis les départs d’un arrêt : la ligne entière', () => {
  it('★ ouvre « Gare du Nord : garder une ligne » ; toucher garde la ligne (ses deux sens), la retire, annule dans les 5 s', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.6', lines: [LINES.t3] }), core: (now) => stubCore(now) });
    await h.until((x) => x.screen === 'home');
    // la ligne gardée à cet arrêt (1.2.5) est suivie, l'arrêt en repère
    expect(h.settings.get().follows).toEqual([{ id: 'f-ln-t3', op: 'stib', mode: 'tram', line: '3', routes: [], via: via(LINES.t3) }]);
    expect(h.settings.get().lines).toEqual([]);
    await h.c.show({ screen: 'board', areaId: 'stib:6357F', name: N('Gare du Nord') });
    const b = await h.until((x) => x.screen === 'board' && x.lines.length > 1);
    // l'arrêt repère d'une ligne suivie : « ★ » en fin de titre
    expect(b.title).toBe('Gare du Nord, tram (STIB) ★');
    // 1.2.3 : la ligne ★ en tête du tableau, le curseur sur le premier départ
    expect(b.lines[0]).toBe('★ garder une ligne');
    expect(b.sel).toBe(1);
    expect(b.lines.at(-1)).toBe('△▽ départs   toucher : arrêts   double : retour');
    await h.gesture('up', 'tap');
    const k = await h.until((x) => x.screen === 'keepLine' && x.lines.length > 1);
    expect(k.title).toBe('Gare du Nord : garder une ligne');
    expect(k.lines).toEqual(['tram 3   ★', 'tram 4', '△▽ choisir   toucher : ★ garder ou retirer   double : retour']);
    // garder le tram 4 : la ligne entière, dans « Lignes de bus, tram, métro », cet arrêt en repère
    await h.gesture('down', 'tap');
    expect(h.last().lines.slice(0, 2)).toEqual(['tram 3   ★', 'tram 4   ★']);
    expect(h.last().lines.at(-1)).toBe('★ Ajoutée aux lignes');
    expect(h.settings.get().follows?.at(-1)).toMatchObject({ op: 'stib', line: '4', mode: 'tram', via: { areaId: 'stib:6357F' } });
    expect(h.settings.get().lines).toEqual([]);
    // retirer le tram 3, puis l'annuler dans les 5 s : à l'identique, à sa place
    const ids = () => h.settings.get().follows?.map((x) => `${x.id} ${x.line}`);
    const before = ids();
    await h.gesture('up', 'tap');
    expect(h.last().lines.at(-1)).toBe('★ Retirée. Toucher encore : annuler');
    expect(h.settings.get().follows?.map((p) => p.line)).toEqual(['4']);
    h.advance(3_000);
    await h.gesture('tap');
    expect(h.last().lines.at(-1)).toBe('★ Ligne rétablie');
    expect(ids()).toEqual(before);
    expect(h.settings.get().favorites.some((f) => f.kind === 'stop')).toBe(false);
    // double toucher : les départs, toujours « ★ », le curseur sur la ligne ★
    await h.gesture('double');
    expect(h.last()).toMatchObject({ screen: 'board', title: 'Gare du Nord, tram (STIB) ★', sel: 0 });
    // « Lignes de bus, tram, métro » : les deux sens du tram 3 et le sens du tram 4
    await h.c.replaceRoute({ screen: 'follows' });
    const s = await h.until(followsReady);
    expect(s.lines.filter((l) => l.startsWith('Tram 3 vers '))).toHaveLength(2);
    expect(s.lines.filter((l) => l.startsWith('Tram 4 vers '))).toHaveLength(1);
    h.c.stop();
  });

  it('la limite des lignes (32) : « Déjà 32 lignes : retires-en une sur le téléphone »', async () => {
    const many: LineFollow[] = Array.from({ length: LIMITS.lines }, (_, i) => ({ id: `f-${i}`, op: 'tec', line: String(100 + i), routes: [] }));
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.6', follows: many }), core: (now) => stubCore(now) });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'keepLine', areaId: 'stib:6357F', op: 'stib', name: N('Gare du Nord'), lat: 50.86, lon: 4.36 });
    await h.until((x) => x.screen === 'keepLine' && x.lines.length > 1);
    await h.gesture('tap');
    expect(nb(h.last().lines.at(-1)!)).toBe(`Déjà ${LIMITS.lines} lignes : retires-en une sur le téléphone`);
    expect(h.settings.get().follows).toHaveLength(LIMITS.lines);
    h.c.stop();
  });
});

describe('REVUE-USAGE n° 4 et CA-126.4 : ouverture d’office, alerte travaux', () => {
  it('à moins de 300 m de l’arrêt repère d’une ligne `near` : ses départs s’ouvrent d’office ; double toucher : l’accueil', async () => {
    const pos = { lat: LINES.w.lat, lon: LINES.w.lon + 0.001 };
    const h = await setup({ now: NOW, pos, settings: settingsWith([PLACES.bureau], { seenVersion: '1.2.6', lines: [LINES.t3, { ...LINES.w, near: true }] }), core: (now) => stubCore(now) });
    const b = await h.until((x) => x.screen === 'board' && x.lines.length > 2);
    expect(b.title).toBe('Braine-l’Alleud Merbraine, bus (TEC) ★');
    expect(b.lines[0]).toBe('★ garder une ligne');
    await h.gesture('double');
    expect((await h.until((x) => x.screen === 'home')).screen).toBe('home');
    h.c.stop();
    // plus loin : l'accueil
    const far = await setup({ now: NOW, pos: { lat: LINES.w.lat + 0.01, lon: LINES.w.lon }, settings: settingsWith([PLACES.bureau], { seenVersion: '1.2.6', lines: [{ ...LINES.w, near: true }] }), core: (now) => stubCore(now) });
    expect((await far.until((x) => x.screen === 'home')).screen).toBe('home');
    far.c.stop();
  });

  it('arrêt favori de la 1.2.1 migré (tram 3 et tram 4 à Gare du Nord, « près ») : les départs de Gare du Nord', async () => {
    const pos = { lat: LINES.t3.lat + 0.0005, lon: LINES.t3.lon };
    const h = await setup({ now: NOW, pos, settings: settingsWith([PLACES.bureau], { seenVersion: '1.2.6', lines: [{ ...LINES.t3, near: true }, { ...LINES.t4, near: true }] }), core: (now) => stubCore(now) });
    const b = await h.until((x) => x.screen === 'board' && x.lines.length > 2);
    expect(b.title).toBe('Gare du Nord, tram (STIB) ★');
    expect(b.lines.slice(1, 3)).toEqual(['T3   Churchill   1 min', 'T4   Stalle   4 min']);
    h.c.stop();
  });

  it('« Travaux et déviations » : sur le détail d’une ligne et sur les départs de son arrêt', async () => {
    const works = (core: Core): Core => Object.assign(Object.create(core) as Core, { works: async () => ['Déviation : arrêt Merbraine déplacé'] });
    const settings = settingsWith([], { seenVersion: '1.2.6', follows: [FW] });
    settings.alerts.works = true;
    const h = await setup({ now: NOW, settings, core: (now) => works(stubCore(now)) });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'line', areaId: LINES.w.areaId, op: 'tec', line: 'W', name: LINES.w.name });
    expect((await h.until((x) => x.screen === 'line' && x.lines.length > 3)).lines[0]).toBe('! Déviation : arrêt Merbraine déplacé');
    // 1.2.3 : « Tous les départs de l'arrêt » (en bas du détail) : le tableau complet, avec l'alerte
    for (let i = 0; i < 10; i++) await h.gesture('down');
    await h.gesture('tap');
    expect((await h.until((x) => x.screen === 'board' && x.lines.length > 1)).lines[0]).toBe('! Déviation : arrêt Merbraine déplacé');
    h.c.stop();
  });
});
