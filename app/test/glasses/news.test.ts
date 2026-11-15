/**
 * Quai 1.3.0, message « Quai 1.3.0 » (docs/v1.3.0/PRD-1.3.0.md § 9) : une seule fois après la mise à jour depuis la
 * 1.2.10 ou avant, jamais après une installation neuve. Trois lignes : la ligne « ▶ Y aller » et ▲ pour revenir ; les
 * favoris en accordéon ; le test de l'écran et le rappel des messages (Quai Web : pas de test de l'écran, l'onglet
 * Réglages). Depuis la 1.2.9 ou avant : aussi les lignes de la 1.2.10 encore vraies (« le détail en bas » des favoris ne
 * l'est plus), puis celles de la 1.2.9 ; les plus anciennes ne tiennent plus (une version entière ou rien). La version
 * de l'appli est fixée à 1.3.0 ; le seuil du message (NEWS_SINCE) est celui du contrôleur.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/version', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/version')>()), APP_VERSION: '1.3.0' }));

import { NEWS_SINCE } from '../../src/glasses/controller';
import { textWidth } from '../../src/glasses/font';
import { WIDTHS, geometry } from '../../src/glasses/layout';
import {
  NEWS_LINES,
  NEWS_LINES_125,
  NEWS_LINES_128,
  NEWS_LINES_129,
  NEWS_LINES_1210,
  NEWS_LINES_1210_KEPT,
  NEWS_LINES_130,
  NEWS_LINES_130_WEB,
  NEWS_MAX,
  NEWS_TITLE,
  newsLines,
  newsView,
} from '../../src/glasses/views';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { PLACES, at, lines, nb, settingsWith, setup, stubCore } from './helpers';

const NOW = at('2026-11-15', 7, 31);
const NEWS_130 = ['Trajet : ligne « ▶ Y aller », ▲ revient des autres trajets.', 'Favoris : le détail s’ouvre sous le favori choisi.', 'Test de l’écran sur le téléphone ; message pas vu rappelé.'];
/** Quai Web : ni test de l'écran ni rappel des messages (décision), le journal des trajets guidés seulement. */
const NEWS_130_WEB = [NEWS_130[0], NEWS_130[1], 'Journal de tes trajets guidés : onglet Réglages, Données.'];
const NEWS_1210 = ['Y aller : guidé de porte à porte, écran calme.', 'Train ou bus déjà pris : « j’y descends ».', 'Favoris : une ligne chacun, le détail en bas.'];
const NEWS_1210_KEPT = NEWS_1210.slice(0, 2);
const NEWS_129 = ['« imminent » : seulement d’après le temps réel.', 'Téléphone : l’accueil reprend celui des lunettes.', 'Réglages : tout derrière un seul bouton.'];
const NEWS_129_WEB = ['« imminent » : seulement d’après le temps réel.', 'Onglet Réglages : il reprend l’accueil des lunettes.', 'Réglages : tout derrière un seul bouton.'];
const NEWS_128 = ['Un train : tout son trajet, gares d’avant comprises.', 'Chaque gare : sa voie et dans combien de temps.', '● : là où le train arrive, d’après le temps réel.'];
const NEWS_126 = [
  'Arrêts et lignes de bus, tram, métro, séparés.',
  'Une ligne : tout son parcours, l’attente à chaque arrêt.',
  'Dans les deux sens, sans choisir d’arrêt.',
  'Tes lignes gardées y sont déjà.',
];
const NEWS_125 = ['Étapes : l’heure d’arrivée si tu rates ton départ.', 'Pluie prévue : dite sur la marche concernée.', 'Dans le véhicule : ta progression jusqu’à la descente.'];
const TAP = 'toucher : continuer';

async function open(seenVersion: string, kv = createKV(memoryBackend()), web = false) {
  return setup({ now: NOW, web, kv, settings: settingsWith([PLACES.bureau], { seenVersion }), core: (now) => stubCore(now) });
}

describe('PRD-1.3.0 § 9 : message « Quai 1.3.0 »', () => {
  it('le seuil du contrôleur est la 1.3.0 (NEWS_SINCE)', () => {
    expect(NEWS_SINCE).toBe('1.3.0');
  });

  it('depuis la 1.2.10 : une fois, les trois lignes de la 1.3.0 ; toucher mène à l’accueil ; jamais à la réouverture', async () => {
    const kv = createKV(memoryBackend());
    const a = await open('1.2.10', kv);
    expect(a.last()).toMatchObject({ screen: 'message', title: 'Quai 1.3.0' });
    expect(a.last().lines).toEqual([...NEWS_130, TAP]);
    await a.gesture('tap');
    expect((await a.until((s) => s.screen === 'home')).screen).toBe('home');
    expect(a.settings.get().seenVersion).toBe('1.3.0');
    a.c.stop();
    const b = await setup({ now: NOW + 3_600_000, kv, settings: a.settings.get(), core: (now) => stubCore(now) });
    expect(b.screens().some((s) => s.title === 'Quai 1.3.0')).toBe(false);
    expect((await b.until((s) => s.screen === 'home')).screen).toBe('home');
    b.c.stop();
  });

  it('depuis la 1.2.9 : la 1.3.0 puis la 1.2.10 encore vraie ; depuis la 1.2.8 et avant : aussi la 1.2.9 ; les autres n’y tiennent plus', async () => {
    const h = await open('1.2.9');
    expect(h.last()).toMatchObject({ screen: 'message', title: 'Quai 1.3.0', lines: [...NEWS_130, ...NEWS_1210_KEPT, TAP] });
    h.c.stop();
    for (const seen of ['1.2.8', '1.2.5', '1.2.1', '1.0.3']) {
      const o = await open(seen);
      expect(o.last(), seen).toMatchObject({ screen: 'message', title: 'Quai 1.3.0', lines: [...NEWS_130, ...NEWS_1210_KEPT, ...NEWS_129, TAP] });
      o.c.stop();
    }
  });

  it('installation neuve ou version déjà vue : jamais ; Quai Web : pas de test de l’écran, l’onglet Réglages', async () => {
    const fresh = await open('');
    expect(fresh.screens().some((s) => s.title === 'Quai 1.3.0')).toBe(false);
    expect(fresh.settings.get().seenVersion).toBe('1.3.0');
    fresh.c.stop();
    const seen = await open('1.3.0');
    expect(seen.screens().some((s) => s.title === 'Quai 1.3.0')).toBe(false);
    seen.c.stop();
    const web = await open('1.2.10', undefined, true);
    expect(web.last()).toMatchObject({ screen: 'message', title: 'Quai 1.3.0', lines: [...NEWS_130_WEB, TAP] });
    web.c.stop();
    const web128 = await open('1.2.8', undefined, true);
    expect(web128.last()).toMatchObject({ screen: 'message', title: 'Quai 1.3.0', lines: [...NEWS_130_WEB, ...NEWS_1210_KEPT, ...NEWS_129_WEB, TAP] });
    web128.c.stop();
  });

  it('textes : constantes, tutoiement, espaces insécables, sans tiret long ; chaque ligne et le tout tiennent sur l’écran', () => {
    expect(NEWS_TITLE).toBe('Quai 1.3.0');
    expect(newsLines('1.2.10')).toEqual([...NEWS_LINES_130]);
    expect(newsLines('1.2.9')).toEqual([...NEWS_LINES_130, ...NEWS_LINES_1210_KEPT]);
    expect(newsLines('1.2.8')).toEqual([...NEWS_LINES_130, ...NEWS_LINES_1210_KEPT, ...NEWS_LINES_129]);
    expect(newsLines('1.0.3')).toEqual([...NEWS_LINES_130, ...NEWS_LINES_1210_KEPT, ...NEWS_LINES_129]);
    expect(newsLines('')).toEqual([...NEWS_LINES_130]);
    expect(newsLines('1.2.10', true)).toEqual([...NEWS_LINES_130_WEB]);
    expect(NEWS_LINES_130.map(nb)).toEqual(NEWS_130);
    expect(NEWS_LINES_130_WEB.map(nb)).toEqual(NEWS_130_WEB);
    expect(NEWS_LINES_1210.map(nb)).toEqual(NEWS_1210);
    expect(NEWS_LINES_1210_KEPT.map(nb)).toEqual(NEWS_1210_KEPT);
    expect(NEWS_LINES_129.map(nb)).toEqual(NEWS_129);
    expect(NEWS_LINES_128.map(nb)).toEqual(NEWS_128);
    expect(NEWS_LINES.map(nb)).toEqual(NEWS_126);
    expect(NEWS_LINES_125.map(nb)).toEqual(NEWS_125);
    // « : » précédé d'une espace insécable ; dans les guillemets aussi
    expect(NEWS_LINES_130[0]).toBe('Trajet : ligne « ▶ Y aller », ▲ revient des autres trajets.');
    // la ligne « le détail en bas » de la 1.2.10 n'est plus jamais dite (accordéon, PRD-1.3.0 § 7)
    for (const seen of ['1.2.9', '1.2.8', '1.0.3']) for (const web of [false, true]) expect(newsLines(seen, web)).not.toContain(NEWS_LINES_1210[2]);
    // Quai Web : le test de l'écran n'y existe pas (pas de lunettes, PRD-1.3.0 § 6.1), ni le rappel des messages
    // (décision) ; le téléphone n'y est jamais nommé
    for (const l of newsLines('1.0.3', true)) expect(l).not.toMatch(/[Tt]éléphone|[Tt]est de l’écran|[Rr]appel/);
    for (const l of [...NEWS_LINES_130, ...NEWS_LINES_130_WEB, ...NEWS_LINES_1210, ...NEWS_LINES_129, ...newsLines('1.2.8', true), ...NEWS_LINES_128, ...NEWS_LINES, ...NEWS_LINES_125]) {
      expect(l).not.toMatch(/ :|[–—]|vous\b/i);
      // une ligne des lunettes chacune : jamais coupée en deux
      expect(textWidth(l)).toBeLessThanOrEqual(WIDTHS.full);
    }
    const ctx = { now: NOW, settings: settingsWith([]) };
    const all = newsView(ctx, newsLines('1.2.1'));
    expect(newsLines('1.2.1')).toHaveLength(NEWS_MAX);
    expect(geometry(all).capacity).toBeGreaterThanOrEqual(NEWS_MAX);
    expect(all.items.length).toBeLessThanOrEqual(geometry(all).capacity);
    expect(lines(all)).toEqual([...NEWS_130, ...NEWS_1210_KEPT, ...NEWS_129, TAP]);
    expect(lines(newsView(ctx, newsLines('1.2.10')))).toEqual([...NEWS_130, TAP]);
    expect(lines(newsView({ ...ctx, web: true }, newsLines('1.2.10', true)))).toEqual([...NEWS_130_WEB, TAP]);
  });
});
