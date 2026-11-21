/**
 * Quai 1.3.1, message « Quai 1.3.1 » (docs/v1.3.1/PRD-1.3.1.md § 9, décision du 21/11 : la 1.3.1 contient de vraies
 * nouveautés) : une seule fois après la mise à jour depuis la 1.3.0 ou avant, jamais après une installation neuve ni
 * pour qui est déjà en 1.3.1. Quatre lignes : les trois points du guidage, la sortie du métro, « dernier », l'heure de
 * partir d'après le vrai chemin. Depuis la 1.2.10 ou avant : aussi les trois lignes de la 1.3.0 (Quai Web : pas de test
 * de l'écran, l'onglet Réglages) ; les plus anciennes ne tiennent plus (une version entière ou rien, 8 lignes au plus).
 * La version de l'appli est fixée à 1.3.1 ; le seuil du message (NEWS_SINCE) est celui du contrôleur.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/version', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/version')>()), APP_VERSION: '1.3.1' }));

import { NEWS_SINCE } from '../../src/glasses/controller';
import { textWidth } from '../../src/glasses/font';
import { HINTS } from '../../src/glasses/format';
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
  NEWS_LINES_131,
  NEWS_MAX,
  NEWS_TITLE,
  newsLines,
  newsView,
} from '../../src/glasses/views';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { PLACES, at, lines, nb, overflowing, page, settingsWith, setup, stubCore } from './helpers';

const NOW = at('2026-11-21', 7, 31);
const NEWS_131 = ['Guidage : trois points, Quai te suit, rien à faire.', 'Métro : la sortie à prendre après la descente.', '« dernier » : plus rien à prendre après celui-ci.', 'Heure de partir : calculée sur le vrai chemin à pied.'];
const NEWS_130 = ['Trajet : ligne « ▶ Y aller », ▲ revient des autres trajets.', 'Favoris : le détail s’ouvre sous le favori choisi.', 'Test de l’écran sur le téléphone ; message pas vu rappelé.'];
/** Quai Web : ni test de l'écran ni rappel des messages (décision), le journal des trajets guidés seulement. */
const NEWS_130_WEB = [NEWS_130[0], NEWS_130[1], 'Journal de tes trajets guidés : onglet Réglages, Données.'];
const NEWS_1210 = ['Y aller : guidé de porte à porte, écran calme.', 'Train ou bus déjà pris : « j’y descends ».', 'Favoris : une ligne chacun, le détail en bas.'];
/** 1.3.1 : la liste des arrêts écrit « ▶ Me guider jusqu’à … » (PRD-1.3.1 § 6), plus « j’y descends ». */
const NEWS_1210_KEPT = [NEWS_1210[0], 'Train ou bus déjà pris : « ▶ Me guider jusqu’à … ».'];
const NEWS_129 = ['« imminent » : seulement d’après le temps réel.', 'Téléphone : l’accueil reprend celui des lunettes.', 'Réglages : tout derrière un seul bouton.'];
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

describe('PRD-1.3.1 § 9 (décision du 21/11) : message « Quai 1.3.1 »', () => {
  it('le seuil du contrôleur est la 1.3.1 (NEWS_SINCE)', () => {
    expect(NEWS_SINCE).toBe('1.3.1');
  });

  it('depuis la 1.3.0 : une fois, les quatre lignes de la 1.3.1 ; toucher mène à l’accueil ; jamais à la réouverture', async () => {
    const kv = createKV(memoryBackend());
    const a = await open('1.3.0', kv);
    expect(a.last()).toMatchObject({ screen: 'message', title: 'Quai 1.3.1' });
    expect(a.last().lines).toEqual([...NEWS_131, TAP]);
    expect(a.screens().filter((s) => s.title === 'Quai 1.3.1').length).toBeGreaterThan(0);
    expect(a.screens().some((s) => s.screen === 'home')).toBe(false);
    await a.gesture('tap');
    const home = await a.until((s) => s.screen === 'home');
    expect(home.screen).toBe('home');
    expect(a.settings.get().seenVersion).toBe('1.3.1');
    a.c.stop();
    const b = await setup({ now: NOW + 3_600_000, kv, settings: a.settings.get(), core: (now) => stubCore(now) });
    expect(b.screens().some((s) => s.title === 'Quai 1.3.1')).toBe(false);
    expect((await b.until((s) => s.screen === 'home')).screen).toBe('home');
    b.c.stop();
  });

  it('fermé sans toucher (lunettes retirées) : la version vue est déjà écrite, le message ne revient pas', async () => {
    const kv = createKV(memoryBackend());
    const a = await open('1.3.0', kv);
    expect(a.last()).toMatchObject({ screen: 'message', title: 'Quai 1.3.1' });
    await a.settle(50);
    expect(a.settings.get().seenVersion).toBe('1.3.1');
    a.c.stop();
    const b = await setup({ now: NOW + 60_000, kv, settings: a.settings.get(), core: (now) => stubCore(now) });
    expect((await b.until((s) => s.screen === 'home')).screen).toBe('home');
    expect(b.screens().some((s) => s.title === 'Quai 1.3.1')).toBe(false);
    b.c.stop();
  });

  it('depuis la 1.2.10 : la 1.3.1 puis la 1.3.0 ; depuis la 1.2.9 et avant : les mêmes sept lignes, les plus anciennes n’y tiennent plus (une version entière ou rien)', async () => {
    const h = await open('1.2.10');
    expect(h.last()).toMatchObject({ screen: 'message', title: 'Quai 1.3.1', lines: [...NEWS_131, ...NEWS_130, TAP] });
    await h.gesture('tap');
    expect((await h.until((s) => s.screen === 'home')).screen).toBe('home');
    expect(h.settings.get().seenVersion).toBe('1.3.1');
    h.c.stop();
    for (const seen of ['1.2.9', '1.2.8', '1.2.5', '1.2.1', '1.0.3']) {
      const o = await open(seen);
      expect(o.last(), seen).toMatchObject({ screen: 'message', title: 'Quai 1.3.1', lines: [...NEWS_131, ...NEWS_130, TAP] });
      o.c.stop();
    }
  });

  it('installation neuve ou déjà en 1.3.1 : jamais ; Quai Web : les mêmes lignes de la 1.3.1, celles de la 1.3.0 sans test de l’écran', async () => {
    const fresh = await open('');
    expect(fresh.screens().some((s) => s.title === 'Quai 1.3.1')).toBe(false);
    expect((await fresh.until((s) => s.screen === 'home')).screen).toBe('home');
    expect(fresh.settings.get().seenVersion).toBe('1.3.1');
    fresh.c.stop();
    const seen = await open('1.3.1');
    expect(seen.screens().some((s) => /^Quai 1\./.test(s.title))).toBe(false);
    expect((await seen.until((s) => s.screen === 'home')).screen).toBe('home');
    seen.c.stop();
    const web = await open('1.3.0', undefined, true);
    expect(web.last()).toMatchObject({ screen: 'message', title: 'Quai 1.3.1', lines: [...NEWS_131, TAP] });
    web.c.stop();
    const web1210 = await open('1.2.10', undefined, true);
    expect(web1210.last()).toMatchObject({ screen: 'message', title: 'Quai 1.3.1', lines: [...NEWS_131, ...NEWS_130_WEB, TAP] });
    web1210.c.stop();
    const web128 = await open('1.2.8', undefined, true);
    expect(web128.last()).toMatchObject({ screen: 'message', title: 'Quai 1.3.1', lines: [...NEWS_131, ...NEWS_130_WEB, TAP] });
    web128.c.stop();
  });

  it('textes : constantes, tutoiement, espaces insécables, ni tiret long ni moyen ; chaque ligne et le tout tiennent sur l’écran, au pixel', () => {
    expect(NEWS_TITLE).toBe('Quai 1.3.1');
    expect(newsLines('1.3.0')).toEqual([...NEWS_LINES_131]);
    expect(newsLines('1.2.10')).toEqual([...NEWS_LINES_131, ...NEWS_LINES_130]);
    expect(newsLines('1.2.9')).toEqual([...NEWS_LINES_131, ...NEWS_LINES_130]);
    expect(newsLines('1.0.3')).toEqual([...NEWS_LINES_131, ...NEWS_LINES_130]);
    expect(newsLines('')).toEqual([...NEWS_LINES_131]);
    expect(newsLines('1.3.0', true)).toEqual([...NEWS_LINES_131]);
    expect(newsLines('1.2.10', true)).toEqual([...NEWS_LINES_131, ...NEWS_LINES_130_WEB]);
    expect(NEWS_LINES_131.map(nb)).toEqual(NEWS_131);
    expect(NEWS_LINES_130.map(nb)).toEqual(NEWS_130);
    expect(NEWS_LINES_130_WEB.map(nb)).toEqual(NEWS_130_WEB);
    expect(NEWS_LINES_1210.map(nb)).toEqual(NEWS_1210);
    expect(NEWS_LINES_1210_KEPT.map(nb)).toEqual(NEWS_1210_KEPT);
    expect(NEWS_LINES_129.map(nb)).toEqual(NEWS_129);
    expect(NEWS_LINES_128.map(nb)).toEqual(NEWS_128);
    expect(NEWS_LINES.map(nb)).toEqual(NEWS_126);
    expect(NEWS_LINES_125.map(nb)).toEqual(NEWS_125);
    // « : » précédé d'une espace insécable ; dans les guillemets aussi
    expect(NEWS_LINES_131[0]).toBe('Guidage\u00a0: trois points, Quai te suit, rien à faire.');
    expect(NEWS_LINES_131[2]).toBe('«\u00a0dernier\u00a0»\u00a0: plus rien à prendre après celui-ci.');
    expect(NEWS_LINES_130[0]).toBe('Trajet\u00a0: ligne «\u00a0▶ Y aller\u00a0», ▲ revient des autres trajets.');
    // largeurs mesurées avec la police des lunettes (397, 384, 401, 431 px sur 542)
    expect(NEWS_LINES_131.map((l) => textWidth(l))).toEqual([397, 384, 401, 431]);
    // une version entière ou rien, huit lignes au plus : avec les 4 + 3 lignes, plus aucun bloc d'avant ne tient
    for (const seen of ['1.2.10', '1.2.9', '1.2.8', '1.2.1', '1.0.3']) for (const web of [false, true]) expect(newsLines(seen, web)).toHaveLength(7);
    expect(newsLines('1.0.3').length).toBeLessThanOrEqual(NEWS_MAX);
    // l'essai en accéléré n'existe que dans Quai Web, sur le téléphone : jamais dans un message des lunettes
    for (const seen of ['1.3.0', '1.2.10', '1.0.3']) for (const web of [false, true]) for (const l of newsLines(seen, web)) expect(l).not.toMatch(/accéléré/i);
    // Quai Web : le test de l'écran n'y existe pas (pas de lunettes, PRD-1.3.0 § 6.1), ni le rappel des messages
    // (décision) ; le téléphone n'y est jamais nommé
    for (const l of newsLines('1.0.3', true)) expect(l).not.toMatch(/[Tt]éléphone|[Tt]est de l’écran|[Rr]appel/);
    for (const l of [...NEWS_LINES_131, ...NEWS_LINES_130, ...NEWS_LINES_130_WEB, ...NEWS_LINES_1210, ...NEWS_LINES_1210_KEPT, ...NEWS_LINES_129, ...newsLines('1.2.8', true), ...NEWS_LINES_128, ...NEWS_LINES, ...NEWS_LINES_125]) {
      expect(l).not.toMatch(/ [:;!?]|[–—]|'|vous\b/i);
      // une ligne des lunettes chacune : jamais coupée en deux
      expect(textWidth(l), l).toBeLessThanOrEqual(WIDTHS.full);
    }
    const ctx = { now: NOW, settings: settingsWith([]) };
    for (const web of [false, true]) {
      for (const seen of ['1.3.0', '1.2.10', '1.2.1']) {
        const v = newsView({ ...ctx, web }, newsLines(seen, web));
        expect(v.title).toBe('Quai 1.3.1');
        expect(geometry(v).capacity).toBeGreaterThanOrEqual(NEWS_MAX);
        expect(v.items.length).toBeLessThanOrEqual(geometry(v).capacity);
        // au pixel : rien ne dépasse d'aucun conteneur, la page entière tient sur l'écran, sans défilement
        const p = page(v);
        expect(overflowing(p), `${seen} ${web}`).toEqual([]);
        expect(p.lines.map(nb)).toEqual([...newsLines(seen, web).map(nb), TAP]);
      }
    }
    expect(nb(HINTS.news)).toBe(TAP);
    expect(lines(newsView(ctx, newsLines('1.3.0')))).toEqual([...NEWS_131, TAP]);
    expect(lines(newsView(ctx, newsLines('1.2.1')))).toEqual([...NEWS_131, ...NEWS_130, TAP]);
    expect(lines(newsView({ ...ctx, web: true }, newsLines('1.2.10', true)))).toEqual([...NEWS_131, ...NEWS_130_WEB, TAP]);
  });
});
