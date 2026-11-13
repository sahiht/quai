/**
 * Quai 1.2.6, relecture indépendante des lunettes (docs/v1.2.6/PRD-1.2.6.md § 3 et § 9) : défauts corrigés avant la
 * publication, chacun avec son test.
 *  - Reprise après verrouillage : « Lignes de bus, tram, métro » et toute la ligne étaient retirés de l'instantané de
 *    navigation (écrans inconnus de parseNav) : Quai rouvrait l'accueil.
 *  - Ligne suivie introuvable à l'ouverture de toute la ligne : « introuvable : modifie-la sur le téléphone. » en
 *    minuscule, sans aide ni texte de Quai Web, au lieu du message de lineRunView.
 *  - « Lignes » : une ligne dont les sens ne se lisent pas (fichiers de ligne injoignables) disparaissait de la liste,
 *    alors que l'accueil la comptait.
 *  - Distance de l'arrêt le plus proche : 995 m disait « 1000 m ».
 */
import { describe, expect, it } from 'vitest';
import type { LineFollow } from '../../src/core/linerun';
import { NB } from '../../src/glasses/format';
import { initNav, parseNav, push, serializeNav } from '../../src/glasses/nav';
import { metersText } from '../../src/glasses/views';
import { at, settingsWith, setup, stubCore, type Screen } from './helpers';

const NOW = at('2026-11-10', 7, 31);
const N = (fr: string) => ({ fr, nl: fr });

describe('relecture 1.2.6 : lunettes', () => {
  it('reprise après verrouillage : « Lignes » et toute la ligne restent dans l’instantané de navigation', () => {
    const s = push(push(initNav({ screen: 'home' }), { screen: 'follows' }), { screen: 'lineRun', follow: 'f-3', dir: 1 });
    expect(parseNav(serializeNav(s))?.stack.map((f) => f.route)).toEqual([{ screen: 'home' }, { screen: 'follows' }, { screen: 'lineRun', follow: 'f-3', dir: 1 }]);
  });

  it('reprise après verrouillage : le contrôleur rouvre toute la ligne, pas l’accueil', async () => {
    const F3: LineFollow = { id: 'f-3', op: 'stib', mode: 'tram', line: '3', routes: [] };
    const settings = settingsWith([], { seenVersion: '1.2.8', follows: [F3] });
    const a = await setup({ now: NOW, settings, core: (now) => stubCore(now) });
    await a.until((x) => x.screen === 'home');
    await a.c.show({ screen: 'follows' });
    await a.c.show({ screen: 'lineRun', follow: 'f-3', dir: 0 });
    await a.until((x) => x.screen === 'lineRun' && x.title === 'Tram 3 vers Churchill');
    const before = a.c.state.nav.stack.map((f) => f.route);
    expect(before.at(-1)).toEqual({ screen: 'lineRun', follow: 'f-3', dir: 0 });
    const snap = a.c.snapshot();
    a.c.stop();
    const b = await setup({ now: NOW, settings, core: (now) => stubCore(now) });
    await b.until((x) => x.screen === 'home');
    b.c.restore(JSON.parse(JSON.stringify(snap)));
    const s = await b.until((x) => x.screen === 'lineRun' && x.title === 'Tram 3 vers Churchill' && x.lines.length > 3);
    expect(s.screen).toBe('lineRun');
    expect(s.lines.some((l) => /^[○●◇◆] Gare du Nord/.test(l))).toBe(true);
    expect(b.c.state.nav.stack.map((f) => f.route)).toEqual(before);
    b.c.stop();
  });

  it('ligne suivie introuvable à l’ouverture de toute la ligne : le message de lineRunView, sous le nom de la ligne ; Quai Web : Réglages', async () => {
    const lost: LineFollow = { id: 'f-99', op: 'stib', mode: 'tram', line: '99', routes: [] };
    const settings = settingsWith([], { seenVersion: '1.2.8', follows: [lost] });
    const h = await setup({ now: NOW, settings, core: (now) => stubCore(now) });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'lineRun', follow: 'f-99', dir: 0 });
    const s = await h.until((x) => x.screen === 'lineRun' && !/Chargement/.test(x.lines.join(' ')));
    expect([s.title, ...s.lines]).toEqual(['Tram 99', 'Introuvable : modifie-la sur le téléphone.', 'double toucher : retour']);
    // une ligne retirée sur le téléphone pendant qu'on la regarde : le titre de la rubrique
    await h.c.show({ screen: 'lineRun', follow: 'f-gone', dir: 0 });
    const g = await h.until((x) => x.screen === 'lineRun' && x.title === 'Lignes de bus, tram, métro' && !/Chargement/.test(x.lines.join(' ')));
    expect(g.lines[0]).toBe('Introuvable : modifie-la sur le téléphone.');
    h.c.stop();
    const opened: string[] = [];
    const w = await setup({ now: NOW, web: true, opened, settings, core: (now) => stubCore(now) });
    await w.until((x) => x.screen === 'home');
    await w.c.show({ screen: 'lineRun', follow: 'f-99', dir: 0 });
    const ws = await w.until((x: Screen) => x.screen === 'lineRun' && !/Chargement/.test(x.lines.join(' ')));
    expect(ws.lines[0]).toBe('Introuvable : modifie-la dans Réglages.');
    await w.gesture('tap');
    expect(opened).toEqual(['#/lignes']);
    w.c.stop();
  });

  it('« Lignes » : une ligne sans aucun sens (plus dans les horaires) : « introuvable », même avec ses terminus gardés ; jamais une ligne absente', async () => {
    const withEnds: LineFollow = { id: 'f-3', op: 'stib', mode: 'tram', line: '3', routes: ['stib:3'], ends: [N('Churchill'), N('Esplanade')] };
    const bare: LineFollow = { id: 'f-4', op: 'stib', mode: 'tram', line: '4', routes: ['stib:4'] };
    const h = await setup({
      now: NOW,
      settings: settingsWith([], { seenVersion: '1.2.8', follows: [withEnds, bare] }),
      core: (now) => Object.assign(stubCore(now), { lineHeads: async () => [] }),
    });
    const home = await h.until((x) => x.screen === 'home' && x.lines.some((l) => l.startsWith('Lignes de bus, tram, métro   2')));
    expect(home.lines.at(-1)).toBe('Lignes de bus, tram, métro   2 lignes');
    await h.c.replaceRoute({ screen: 'follows' });
    const s = await h.until((x) => x.screen === 'follows' && !x.lines.some((l) => / {3}…$/.test(l)) && x.lines.length > 4);
    expect(s.lines.slice(0, 4)).toEqual(['Tram 3', 'introuvable : modifie-la sur le téléphone', 'Tram 4', 'introuvable : modifie-la sur le téléphone']);
    h.c.stop();
  });

  it('distance de l’arrêt le plus proche : « 990 m », puis « 1 km » dès 995 m, « 1,2 km »', () => {
    expect([metersText(80), metersText(994), metersText(995), metersText(1234)]).toEqual([`80${NB}m`, `990${NB}m`, `1${NB}km`, `1,2${NB}km`]);
  });
});
