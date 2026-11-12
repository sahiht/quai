/**
 * Quai 1.2.2, « Bus, tram, métro » (docs/v1.2.2/PRD-1.2.2.md § 3 ; CA-122.4) et « garder une ligne » (REVUE-USAGE
 * n° 3) : les deux sens toujours (un seul au terminus), deux passages par sens comme les tableaux, passage partiel
 * marqué « * » et son terminus dit dans le détail (4 passages par sens, puis « Tous les départs de l'arrêt »), arrêt
 * « toutes les lignes », ligne introuvable. Données du faux cœur (core/linepicks.ts) au 10/11 à 07:31, et passages
 * construits pour les cas précis. L'ordre des sens est celui des données, stable : les tests ne le supposent pas, sauf
 * pour le W de l'exemple du faux cœur.
 */
import { describe, expect, it } from 'vitest';
import type { Core, LineBoard } from '../../src/core/api';
import { passagesText } from '../../src/glasses/format';
import { WIDTHS } from '../../src/glasses/layout';
import { textWidth } from '../../src/glasses/font';
import { lineView, linesView, type ViewCtx } from '../../src/glasses/views';
import { LINES, PLACES, at, dep, lineBoardOf, lines, nb, settingsWith, setup, stubCore, type Screen } from './helpers';
import { LIMITS } from '../../src/settings';

const NOW = at('2026-11-10', 7, 31);
const ctx = (patch = {}): ViewCtx => ({ now: NOW, settings: settingsWith([], { lines: [LINES.w], ...patch }) });
const linesReady = (s: Screen) => s.screen === 'lines' && !s.lines.some((l) => / …$/.test(l) || l === '…');
const N = (fr: string) => ({ fr, nl: fr });

/** W à Merbraine : un W partiel (s'arrête à Waterloo Eglise) en tête vers Bruxelles Midi. */
const partialW = (now: number): LineBoard =>
  lineBoardOf('tec:Bbrlmer1', 'Braine-l’Alleud Merbraine', 'W', [
    { head: 'Bruxelles Midi', departures: [dep(now, 4, { partial: true, head: N('Waterloo Eglise') }), dep(now, 18), dep(now, 38), dep(now, 58, { rt: false }), dep(now, 78, { rt: false })] },
    { head: 'Braine-l’Alleud Gare', departures: [dep(now, 9, { head: N('Braine-l’Alleud Gare') }), dep(now, 29, { head: N('Braine-l’Alleud Gare'), cancelled: true })] },
  ]);

describe('CA-122.4 : « Bus, tram, métro »', () => {
  it('chaque ligne à son arrêt, ses deux sens, deux passages par sens (faux cœur) ; terminus : un seul sens', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([PLACES.bureau], { seenVersion: '1.2.4', lines: [LINES.w, LINES.t3, LINES.t4] }), core: (now) => stubCore(now) });
    await h.until((x) => x.screen === 'home');
    await h.c.replaceRoute({ screen: 'lines' });
    const s = await h.until(linesReady);
    expect(s.title).toBe('Bus, tram, métro');
    // W : 07:48 avec 3 min de retard (temps réel) puis 08:08 prévu ; vers Braine-l'Alleud Gare 07:42 puis 08:02 prévu
    // 1.2.4 (PRD-1.2.4 § 2) : sous l'intitulé pâle « LIGNES »
    expect(s.lines.slice(0, 4)).toEqual(['LIGNES', 'Bus W · Braine-l’Alleud Merbraine', 'vers Bruxelles Midi   20 · ~37 min', 'vers Braine-l’Alleud Gare   11 · ~31 min']);
    expect(s.lines[4]).toBe('Tram 3 · Gare du Nord');
    expect(s.lines.slice(5, 7).sort()).toEqual(['vers Churchill   1 · 9 min', 'vers Esplanade   5 · 13 min']);
    expect(s.lines.slice(-2)).toEqual(['~ horaire prévu, sans temps réel', '△▽ choisir   toucher : ouvrir   double : retour']);
    // un élément par ligne : le curseur passe d'un titre à l'autre ; la liste défile pour montrer le tram 4 entier
    expect(s.sel).toBe(0);
    await h.gesture('down', 'down');
    const t4 = h.last();
    expect(t4.sel).toBe(2);
    // le tram 4 (mode inconnu du réglage, appris du cœur) : un seul sens, sans le « (P) » de la STIB
    expect(t4.lines.slice(-4, -2)).toEqual(['Tram 4 · Gare du Nord', 'vers Stalle   4 · 12 min']);
    h.c.stop();
  });

  it('passage partiel marqué « * » et expliqué en bas ; le détail dit « jusqu’à Waterloo Eglise » ; 4 passages par sens', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.4', lines: [LINES.w] }), core: (now) => stubCore(now, { lineBoard: (id, _l, n) => (id === LINES.w.areaId ? partialW(n) : undefined) }) });
    await h.until((x) => x.screen === 'home');
    await h.c.replaceRoute({ screen: 'lines' });
    const s = await h.until(linesReady);
    expect(s.lines).toEqual([
      'LIGNES',
      'Bus W · Braine-l’Alleud Merbraine',
      'vers Bruxelles Midi   4* · 18 min',
      'vers Braine-l’Alleud Gare   9 min · SUPPRIMÉ',
      '* s’arrête avant le terminus',
      '△▽ choisir   toucher : ouvrir   double : retour',
    ]);
    await h.gesture('tap');
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
    // toucher : le tableau de l'arrêt ; double toucher : le détail, puis la liste
    await h.gesture('tap');
    expect((await h.until((x) => x.screen === 'board')).title).toMatch(/^Braine-l’Alleud Merbraine/);
    await h.gesture('double');
    expect(h.last()).toMatchObject({ screen: 'line', sel: 6 });
    await h.gesture('double');
    expect(h.last().screen).toBe('lines');
    h.c.stop();
  });

  it('arrêt « toutes les lignes » : sous « ARRÊTS », « Gare du Nord » et ses 2 prochains départs ; toucher : le tableau', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.4', lines: [LINES.gdnAll] }), core: (now) => stubCore(now) });
    await h.until((x) => x.screen === 'home');
    await h.c.replaceRoute({ screen: 'lines' });
    const s = await h.until(linesReady);
    expect(s.lines.slice(0, 3)).toEqual(['ARRÊTS', 'Gare du Nord', 'T3 Churchill 1 min · T4 Stalle 4 min']);
    await h.gesture('tap');
    // CA-123.3 (lunettes) : le tableau complet de l'arrêt, la ligne ★ en tête, le curseur sur le premier départ
    const b = await h.until((x) => x.screen === 'board' && x.lines.length > 2);
    expect(b.title).toBe('Gare du Nord, tram (STIB) ★');
    expect(b.lines.slice(0, 3)).toEqual(['★ garder une ligne', 'T3   Churchill   1 min', 'T4   Stalle   4 min']);
    expect(b.sel).toBe(1);
    expect((b as Screen & { departures?: number }).departures).toBeGreaterThan(8);
    h.c.stop();
  });

  it('revue : ligne sans aucun départ à son arrêt les jours publiés (none) : « aucun passage », jamais « introuvable »', async () => {
    // le W ne passe pas à Gare du Nord (faux cœur : state none, sans sens)
    const quiet = { ...LINES.t3, id: 'ln-quiet', line: 'W', mode: undefined };
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.4', lines: [quiet] }), core: (now) => stubCore(now) });
    const home = await h.until((x) => x.screen === 'home' && x.lines.some((l) => /^Bus, tram, métro {3}[^…]+$/.test(l)));
    // 1.2.4 (PRD-1.2.4 § 3) : l'accueil dit le contenu de la rubrique, plus de départ
    expect(home.lines.find((l) => l.startsWith('Bus, tram, métro'))).toBe('Bus, tram, métro   1 ligne');
    await h.c.replaceRoute({ screen: 'lines' });
    const s = await h.until(linesReady);
    // aucun sens trouvé : le mode du cœur n'est que celui de l'arrêt (tram), « Ligne W » sans mode au réglage
    expect(s.lines.slice(0, 3)).toEqual(['LIGNES', 'Ligne W · Gare du Nord', 'aucun passage dans les prochaines heures']);
    await h.gesture('tap');
    const d = await h.until((x) => x.screen === 'line' && x.lines.length > 2);
    expect(d.title).toBe('Ligne W · Gare du Nord');
    expect(d.lines.slice(0, 2)).toEqual(['aucun passage dans les prochaines heures', 'Tous les départs de l’arrêt']);
    h.c.stop();
  });

  it('revue : sans passage (none), le mode du cœur n’est qu’une supposition : celui du réglage d’abord', () => {
    // aucun motif du W à cet arrêt : le cœur suppose le mode de l'arrêt (tram)
    const guess = lineBoardOf('stib:6357F', 'Gare du Nord', 'W', [], { mode: 'tram' });
    expect(guess.state).toBe('none');
    const picked = { ...LINES.t3, id: 'ln-wb', line: 'W', mode: 'bus' as const };
    const unknown = { ...picked, mode: undefined };
    const v = linesView([{ pick: picked, board: guess }, { pick: unknown, board: guess }], { now: NOW, settings: settingsWith([], { lines: [picked, unknown] }) });
    expect(lines(v).slice(0, 5)).toEqual(['LIGNES', 'Bus W · Gare du Nord', 'aucun passage dans les prochaines heures', 'Ligne W · Gare du Nord', 'aucun passage dans les prochaines heures']);
    const route = { screen: 'line' as const, pick: picked.id, areaId: picked.areaId, op: 'stib' as const, line: 'W', name: picked.name };
    expect(lineView({ ...route, mode: 'bus' }, guess, { now: NOW, settings: settingsWith([]) }).title).toBe('Bus W · Gare du Nord');
    expect(lineView(route, guess, { now: NOW, settings: settingsWith([]) }).title).toBe('Ligne W · Gare du Nord');
    // sens connus (motifs à cet arrêt) mais aucun passage dans l'horizon : le mode du cœur vaut
    const known = lineBoardOf('stib:6357F', 'Gare du Nord', '3', [{ head: 'Churchill', departures: [] }], { mode: 'tram' });
    expect(known.state).toBe('none');
    expect(lines(linesView([{ pick: { ...LINES.t3, mode: undefined }, board: known }], { now: NOW, settings: settingsWith([]) }))[1]).toBe('Tram 3 · Gare du Nord');
  });

  it('revue : arrêt introuvable (ligne, « toutes les lignes ») : « introuvable : modifie-la (ligne) / modifie-le (arrêt) sur le téléphone » ; Quai Web : #/lignes', async () => {
    // identifiant inconnu, et aucune zone de ce nom autour de l'endroit du choix (faux cœur : missing, sans exception)
    const lost = { ...LINES.t3, id: 'ln-lost', areaId: 'stib:0001', name: N('Arrêt supprimé'), line: 'W', mode: undefined };
    const lostAll = { ...LINES.gdnAll, id: 'ln-lost-all', areaId: 'stib:0002', name: N('Arrêt supprimé') };
    const settings = () => settingsWith([], { seenVersion: '1.2.4', lines: [lost, lostAll] });
    const h = await setup({ now: NOW, settings: settings(), core: (now) => stubCore(now) });
    const home = await h.until((x) => x.screen === 'home' && x.lines.some((l) => /^Bus, tram, métro {3}[^…]+$/.test(l)));
    // 1.2.4 : l'accueil dit le contenu ; « introuvable » se dit dans la rubrique
    expect(home.lines.find((l) => l.startsWith('Bus, tram, métro'))).toBe('Bus, tram, métro   1 arrêt · 1 ligne');
    await h.c.replaceRoute({ screen: 'lines' });
    const s = await h.until(linesReady);
    expect(s.lines.slice(0, 6)).toEqual(['ARRÊTS', 'Arrêt supprimé', 'introuvable : modifie-le sur le téléphone', 'LIGNES', 'Ligne W · Arrêt supprimé', 'introuvable : modifie-la sur le téléphone']);
    await h.gesture('tap');
    expect(h.last().screen).toBe('lines');
    // rien n'a bougé dans les réglages
    expect(h.settings.get().lines.map((p) => p.areaId)).toEqual(['stib:0001', 'stib:0002']);
    h.c.stop();
    const opened: string[] = [];
    const w = await setup({ now: NOW, web: true, opened, settings: settings(), core: (now) => stubCore(now) });
    await w.until((x) => x.screen === 'home');
    await w.c.replaceRoute({ screen: 'lines' });
    const ws = await w.until(linesReady);
    expect([ws.lines[2], ws.lines[5]]).toEqual(['introuvable : modifie-le dans Réglages', 'introuvable : modifie-la dans Réglages']);
    await w.gesture('tap', 'down', 'tap');
    expect(opened).toEqual(['#/lignes', '#/lignes']);
    w.c.stop();
  });

  it('revue : zone retrouvée sous un autre identifiant (movedTo : `aka`, ou même nom à 150 m) : la ligne choisie suit', async () => {
    // tram 3 sur l'ancien identifiant de Gare du Nord (`aka`) ; « toutes les lignes » sur un identifiant inconnu, même nom
    const old = { ...LINES.t3, areaId: 'stib:6358' };
    const renamed = { ...LINES.gdnAll, areaId: 'stib:0003' };
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.4', lines: [old, renamed] }), core: (now) => stubCore(now) });
    await h.until((x) => x.screen === 'home');
    await h.c.replaceRoute({ screen: 'lines' });
    const s = await h.until(linesReady);
    expect(s.lines.slice(0, 4)).toEqual(['ARRÊTS', 'Gare du Nord', 'T3 Churchill 1 min · T4 Stalle 4 min', 'LIGNES']);
    expect(s.lines).toContain('Tram 3 · Gare du Nord');
    await h.until(() => h.settings.get().lines.every((p) => p.areaId === 'stib:6357F'));
    expect(h.settings.get().lines.map((p) => [p.id, p.areaId, p.line])).toEqual([
      ['ln-t3', 'stib:6357F', '3'],
      ['ln-gdn', 'stib:6357F', undefined],
    ]);
    h.c.stop();
  });

  it('données réelles du 12/11 (forme) : le 36 à Braine-l’Alleud Côté du Collège, deux sens, le passage vers Vallée Bailly marqué', () => {
    const now = at('2026-11-12', 7, 31);
    const b = lineBoardOf('tec:Bbrlcco1', 'Braine-l’Alleud Côté du Collège', '36', [
      { head: 'Wavre', departures: [dep(now, 6, { line: '36', head: N('Vallée Bailly'), partial: true }), dep(now, 36, { line: '36', head: N('Wavre') })] },
      { head: 'Braine-l’Alleud Gare', departures: [dep(now, 12, { line: '36', head: N('Braine-l’Alleud Gare') })] },
    ]);
    const pick = { ...LINES.w, id: 'ln-36', areaId: 'tec:Bbrlcco1', name: N('Braine-l’Alleud Côté du Collège'), line: '36' };
    const list = linesView([{ pick, board: b }], { now, settings: settingsWith([], { lines: [pick] }) });
    expect(lines(list).slice(0, 4)).toEqual(['LIGNES', 'Bus 36 · Braine-l’Alleud Côté du Collège', 'vers Wavre   6* · 36 min', 'vers Braine-l’Alleud Gare   12 min']);
    expect(list.note).toBe('* s’arrête avant le terminus');
    const detail = lineView({ screen: 'line', areaId: pick.areaId, op: 'tec', line: '36', name: pick.name }, b, { now, settings: settingsWith([]) });
    expect(lines(detail).slice(0, 3)).toEqual(['vers Wavre', '07:37  jusqu’à Vallée Bailly   dans 6 min', '08:07   dans 36 min']);
  });
});

describe('§ 3 : textes et largeurs', () => {
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

  it('un sens sans passage, une ligne sans aucun passage, le mode pas encore connu ; tout tient au pixel', () => {
    const long = { ...LINES.w, name: N('Louvain-la-Neuve Place des Sciences, quai central'), mode: undefined };
    const b = lineBoardOf(long.areaId, 'x', 'W', [{ head: 'Rixensart Gare par le chemin le plus long', departures: [] }, { head: 'Bruxelles Midi', departures: [dep(NOW, 3)] }], { state: 'ok' });
    const v = linesView([{ pick: long, board: b }, { pick: { ...LINES.t3 } }, { pick: LINES.w, board: lineBoardOf(LINES.w.areaId, 'x', 'W', []) }], ctx({ lines: [long, LINES.t3, LINES.w] }));
    const l = lines(v);
    expect(l[0]).toBe('LIGNES');
    expect(l[1]).toMatch(/^Bus W · Louvain-la-Neuve Place des Sciences/);
    expect(l[2]).toMatch(/^vers Rixensart Gare par le chemin.*aucun passage$/);
    expect(l.slice(4, 6)).toEqual(['Tram 3 · Gare du Nord', '…']);
    for (const r of l) expect(textWidth(r)).toBeLessThanOrEqual(WIDTHS.full);
    // la 3e ligne, sous la page (1.2.4 : l'intitulé prend une ligne) : ▼
    const l2 = lines(v, 2);
    expect(l2.slice(l2.indexOf('Bus W · Braine-l’Alleud Merbraine'), l2.indexOf('Bus W · Braine-l’Alleud Merbraine') + 2)).toEqual(['Bus W · Braine-l’Alleud Merbraine', 'aucun passage dans les prochaines heures']);
    for (const r of l2) expect(textWidth(r)).toBeLessThanOrEqual(WIDTHS.full);
  });

  it('détail : alerte travaux en haut ; ligne introuvable : un message', () => {
    const d = lineView({ screen: 'line', areaId: LINES.w.areaId, op: 'tec', line: 'W', name: LINES.w.name }, partialW(NOW), ctx(), 'Déviation : arrêt Merbraine déplacé');
    expect(lines(d)[0]).toBe('! Déviation : arrêt Merbraine déplacé');
    const missing = lineView({ screen: 'line', areaId: 'stib:6357F', op: 'stib', line: 'W', name: N('Gare du Nord') }, { ...lineBoardOf('stib:6357F', 'Gare du Nord', 'W', []), state: 'missing' }, ctx());
    expect(lines(missing)).toEqual(['Introuvable : modifie-la sur le téléphone.', 'double toucher : retour']);
  });
});

describe('REVUE-USAGE n° 3 : « garder une ligne » depuis les départs d’un arrêt', () => {
  it('★ ouvre « Gare du Nord : garder une ligne » ; toucher garde la ligne (ses deux sens), la retire, annule dans les 5 s', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.4', lines: [LINES.t3] }), core: (now) => stubCore(now) });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'board', areaId: 'stib:6357F', name: N('Gare du Nord') });
    const b = await h.until((x) => x.screen === 'board' && x.lines.length > 1);
    // une ligne de l'arrêt est gardée : « ★ » en fin de titre
    expect(b.title).toBe('Gare du Nord, tram (STIB) ★');
    // 1.2.3 : la ligne ★ en tête du tableau, le curseur sur le premier départ
    expect(b.lines[0]).toBe('★ garder une ligne');
    expect(b.sel).toBe(1);
    expect(b.lines.at(-1)).toBe('△▽ départs   toucher : arrêts   double : retour');
    await h.gesture('up', 'tap');
    const k = await h.until((x) => x.screen === 'keepLine' && x.lines.length > 1);
    expect(k.title).toBe('Gare du Nord : garder une ligne');
    expect(k.lines).toEqual(['tram 3   ★', 'tram 4', '△▽ choisir   toucher : ★ garder ou retirer   double : retour']);
    // garder le tram 4 : ses deux sens dans « Bus, tram, métro »
    await h.gesture('down', 'tap');
    expect(h.last().lines.slice(0, 2)).toEqual(['tram 3   ★', 'tram 4   ★']);
    expect(h.last().lines.at(-1)).toBe('★ Ajoutée à Bus, tram, métro');
    expect(h.settings.get().lines.at(-1)).toMatchObject({ areaId: 'stib:6357F', op: 'stib', line: '4', mode: 'tram' });
    // retirer le tram 3, puis l'annuler dans les 5 s : à l'identique, à sa place
    const before = structuredClone(h.settings.get().lines);
    await h.gesture('up', 'tap');
    expect(h.last().lines.at(-1)).toBe('★ Retirée. Toucher encore : annuler');
    expect(h.settings.get().lines.map((p) => p.line)).toEqual(['4']);
    h.advance(3_000);
    await h.gesture('tap');
    expect(h.last().lines.at(-1)).toBe('★ Ligne rétablie');
    expect(h.settings.get().lines).toEqual(before);
    expect(h.settings.get().favorites.some((f) => f.kind === 'stop')).toBe(false);
    // double toucher : les départs, toujours « ★ », le curseur sur la ligne ★
    await h.gesture('double');
    expect(h.last()).toMatchObject({ screen: 'board', title: 'Gare du Nord, tram (STIB) ★', sel: 0 });
    // la rubrique montre les deux sens du tram 3 et le sens du tram 4
    await h.c.replaceRoute({ screen: 'lines' });
    const s = await h.until(linesReady);
    expect(s.lines.filter((l) => !l.startsWith('vers')).slice(0, 3)).toEqual(['LIGNES', 'Tram 3 · Gare du Nord', 'Tram 4 · Gare du Nord']);
    expect(s.lines.filter((l) => l.startsWith('vers'))).toHaveLength(3);
    h.c.stop();
  });

  it('la limite des lignes (32, arrêts compris) : « Déjà 32 lignes et arrêts : retires-en un sur le téléphone »', async () => {
    const twelve = Array.from({ length: LIMITS.lines }, (_, i) => ({ ...LINES.w, id: `ln-${i}`, line: String(100 + i) }));
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.4', lines: twelve }), core: (now) => stubCore(now) });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'keepLine', areaId: 'stib:6357F', op: 'stib', name: N('Gare du Nord'), lat: 50.86, lon: 4.36 });
    await h.until((x) => x.screen === 'keepLine' && x.lines.length > 1);
    await h.gesture('tap');
    expect(nb(h.last().lines.at(-1)!)).toBe(`Déjà ${LIMITS.lines} lignes et arrêts : retires-en un sur le téléphone`);
    expect(h.settings.get().lines).toHaveLength(LIMITS.lines);
    h.c.stop();
  });
});

describe('REVUE-USAGE n° 4 : ligne `near` ouverte d’office, alerte travaux', () => {
  it('à moins de 300 m d’une ligne `near` : « Bus, tram, métro » s’ouvre d’office, le curseur sur elle ; toucher : son détail', async () => {
    const pos = { lat: LINES.w.lat, lon: LINES.w.lon + 0.001 };
    const h = await setup({ now: NOW, pos, settings: settingsWith([PLACES.bureau], { seenVersion: '1.2.4', lines: [LINES.t3, { ...LINES.w, near: true }] }), core: (now) => stubCore(now) });
    const s = await h.until(linesReady);
    expect(s.sel).toBe(1);
    expect(s.lines.slice(4, 7)).toEqual(['Bus W · Braine-l’Alleud Merbraine', 'vers Bruxelles Midi   20 · ~37 min', 'vers Braine-l’Alleud Gare   11 · ~31 min']);
    await h.gesture('tap');
    expect((await h.until((x) => x.screen === 'line' && x.lines.length > 3)).title).toBe('Bus W · Braine-l’Alleud Merbraine');
    await h.gesture('double', 'double');
    expect((await h.until((x) => x.screen === 'home')).screen).toBe('home');
    h.c.stop();
  });

  it('arrêt favori de la 1.2.1 migré (tram 3 et tram 4 à Gare du Nord, « près ») : les deux à l’ouverture', async () => {
    const pos = { lat: LINES.t3.lat + 0.0005, lon: LINES.t3.lon };
    const h = await setup({ now: NOW, pos, settings: settingsWith([PLACES.bureau], { seenVersion: '1.2.4', lines: [{ ...LINES.t3, near: true }, { ...LINES.t4, near: true }] }), core: (now) => stubCore(now) });
    const s = await h.until(linesReady);
    expect(s.sel).toBe(0);
    expect(s.lines.filter((l) => !l.startsWith('vers') && !l.startsWith('△▽') && !l.startsWith('~'))).toEqual(['LIGNES', 'Tram 3 · Gare du Nord', 'Tram 4 · Gare du Nord']);
    h.c.stop();
  });

  it('« Travaux et déviations » : sur le détail d’une ligne gardée et sur les départs de son arrêt', async () => {
    const works = (core: Core): Core => Object.assign(Object.create(core) as Core, { works: async () => ['Déviation : arrêt Merbraine déplacé'] });
    const settings = settingsWith([], { seenVersion: '1.2.4', lines: [LINES.w] });
    settings.alerts.works = true;
    const h = await setup({ now: NOW, settings, core: (now) => works(stubCore(now)) });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'line', pick: LINES.w.id, areaId: LINES.w.areaId, op: 'tec', line: 'W', name: LINES.w.name });
    expect((await h.until((x) => x.screen === 'line' && x.lines.length > 3)).lines[0]).toBe('! Déviation : arrêt Merbraine déplacé');
    // 1.2.3 : « Tous les départs de l'arrêt » (en bas du détail) : le tableau complet, avec l'alerte
    for (let i = 0; i < 10; i++) await h.gesture('down');
    await h.gesture('tap');
    expect((await h.until((x) => x.screen === 'board' && x.lines.length > 1)).lines[0]).toBe('! Déviation : arrêt Merbraine déplacé');
    h.c.stop();
  });
});
