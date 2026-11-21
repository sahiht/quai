// @vitest-environment happy-dom
/**
 * Quai 1.3.1, nouveautés (docs/v1.3.1/PRD-1.3.1.md § 9, décision du 21/11 : la 1.3.1 contient de vraies nouveautés, elle
 * a donc son message). Téléphone : bannière « Nouveau dans Quai 1.3.1 », quatre lignes, une fois pour qui vient de la
 * 1.3.0 ; qui vient d'avant voit ensuite les lignes des versions sautées (mécanique d'avant) ; rien pour qui est déjà en
 * 1.3.1 ni après une installation neuve. Quai Web : l'onglet Réglages à la place du téléphone, et la dernière ligne
 * cite « Essayer en accéléré », dont le nom vient de Quai Web (web/essai.ts) : jamais dans l'appli des lunettes.
 * Chaque mot cité par une ligne de la 1.3.1 (et par la ligne de la 1.2.10 qui citait « j’y descends ») est un mot
 * réellement écrit dans l'appli.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuideStatus } from '../../src/core/guide-types';
import { EXIT_HEAD } from '../../src/glasses/exit-line';
import { textWidth } from '../../src/glasses/font';
import { GUIDE_TO, HINTS, LAST_MARK } from '../../src/glasses/format';
import { GUIDE_TEXT } from '../../src/glasses/guide-views';
import { WIDTHS } from '../../src/glasses/layout';
import { NEWS_LINES_1210_KEPT, NEWS_LINES_131, newsLines as glassesNewsLines } from '../../src/glasses/views';
import { mountPhone, NEWS_SINCE, newsState } from '../../src/phone/app';
import { displayScreen } from '../../src/phone/screens/display';
import { homeScreen, resetAnswers } from '../../src/phone/screens/home';
import { settingsScreen } from '../../src/phone/screens/settings';
import { NEWS_1210, NEWS_130, NEWS_130_WEB, NEWS_131, news131Web, newsLines, newsTitle, T, typo } from '../../src/phone/text';
import { ESSAI_TEXT } from '../../src/web/essai';
import { APP_VERSION } from '../../src/version';
import { at, button, defaults, harness, mount, plain, settle, textOf, withGuide } from './helpers';

const NB = ' ';
const SEEN_BEFORE = ['1.1.0', '1.2.0', '1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.2.6', '1.2.7', '1.2.8', '1.2.9', '1.2.10', '1.3.0'];

const PHONE = [
  'Pendant un guidage, trois petits points : Quai te suit, rien à faire. Un toucher masque un message, le guidage continue.',
  'Après le métro, Quai écrit la sortie à prendre. Le soir, « dernier » marque le dernier départ que tu peux encore prendre.',
  'L’heure de partir compte le vrai chemin à pied : la même sur le téléphone et dans les lunettes.',
  'Dans Réglages : « Éviter les escaliers » et, dans Affichage, « Plein soleil ». Sur la carte « En cours » : « Copier mon heure d’arrivée ».',
];
const WEB = [
  PHONE[0],
  PHONE[1],
  'L’heure de partir compte le vrai chemin à pied : la même dans l’onglet Réglages et dans les lunettes.',
  'Dans l’onglet Réglages : « Éviter les escaliers », « Plein soleil » et, sous « Y aller », « Essayer en accéléré ».',
];

beforeEach(() => resetAnswers());
afterEach(() => {
  document.body.replaceChildren();
  history.replaceState(null, '', '#/');
});

/** Typographie d'un texte affiché : ni tiret long ni moyen, insécable devant « : ; ! ? » et dans les guillemets, apostrophe typographique. */
function typoOk(s: string): void {
  expect(s, s).not.toMatch(/[–—]/);
  expect(s, s).not.toMatch(/ [:;!?]/);
  expect(s, s).not.toMatch(/« | »/);
  expect(s, s).not.toMatch(/'/);
  expect(s, s).not.toMatch(/\bvous\b|\bvotre\b/i);
}

/** L'accueil monté par le vrai routeur du téléphone (mountPhone), réglages vus en `seen`. */
function mounted(seen: string, o: { web?: boolean; newsTrial?: string } = {}): HTMLElement {
  history.replaceState(null, '', '#/');
  const hz = harness({ settings: defaults({ seenVersion: seen }), web: o.web });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const { go: _go, params: _params, ...deps } = hz.ctx;
  mountPhone({ ...deps, root, ...(o.newsTrial ? { newsTrial: o.newsTrial } : {}) });
  return root;
}
const bannerLines = (root: HTMLElement): string[] => [...root.querySelectorAll('.news-lines p')].map((p) => textOf(p));

describe('PRD-1.3.1 § 9 (décision du 21/11) : bannière « Nouveau dans Quai 1.3.1 » du téléphone', () => {
  it('les quatre lignes, mot pour mot ; le seuil est la 1.3.1, la version de l’appli aussi', () => {
    expect(APP_VERSION).toBe('1.3.1');
    expect(NEWS_SINCE).toBe('1.3.1');
    expect(newsTitle(NEWS_SINCE)).toBe('Nouveau dans Quai 1.3.1');
    expect([...NEWS_131]).toEqual(PHONE);
    expect(NEWS_131).toHaveLength(4);
    for (const l of NEWS_131) typoOk(typo(l));
  });

  it('venant de la 1.3.0 : la bannière une fois, ses quatre lignes seules ; « OK » la ferme pour de bon', async () => {
    const root = mounted('1.3.0');
    await settle();
    const news = root.querySelector<HTMLElement>('.news')!;
    expect(news).not.toBeNull();
    expect(textOf(news.querySelector('.news-title'))).toBe('Nouveau dans Quai 1.3.1');
    expect(bannerLines(root)).toEqual(PHONE);
    // insécables dans le texte affiché
    const shown = [...root.querySelectorAll('.news-lines p')].map((p) => p.textContent ?? '');
    expect(shown[0]).toContain(`trois petits points${NB}: Quai te suit`);
    expect(shown[1]).toContain(`«${NB}dernier${NB}»`);
    expect(shown[3]).toContain(`«${NB}Copier mon heure d’arrivée${NB}»`);
    for (const l of shown) typoOk(l);
    // repliée au départ, « Voir ce qui change » la déplie
    const lines = news.querySelector<HTMLElement>('.news-lines')!;
    expect(lines.hidden).toBe(true);
    news.querySelector<HTMLButtonElement>('.news-more')!.click();
    expect(lines.hidden).toBe(false);
    button(news, 'OK').click();
    expect(root.querySelector('.news')).toBeNull();
    // l'accueil redessiné (retour d'un autre écran) : elle ne revient pas
    window.dispatchEvent(new Event('hashchange'));
    await settle();
    expect(root.querySelector('.news')).toBeNull();
  });

  it('venant de la 1.2.10 : les quatre lignes de la 1.3.1, puis celles de la 1.3.0 (sautée) ; d’avant : la suite des versions sautées, comme avant', async () => {
    expect(newsState('1.3.0', NEWS_SINCE, '1.3.1').lines).toEqual(PHONE);
    expect(newsState('1.2.10', NEWS_SINCE, '1.3.1').lines).toEqual([...PHONE, ...NEWS_130]);
    const from1210 = mounted('1.2.10');
    await settle();
    expect(bannerLines(from1210)).toEqual([...PHONE, ...NEWS_130].map((l) => plain(l)));
    const from129 = newsState('1.2.9', NEWS_SINCE, '1.3.1').lines;
    expect(from129.slice(0, 8)).toEqual([...PHONE, ...NEWS_130]);
    // la 1.2.10 sans sa ligne qui n'est plus vraie (le détail des favoris en bas de l'écran)
    expect(from129.slice(8)).toEqual(NEWS_1210.filter((l) => !/en bas de l’écran/.test(l)));
    // plus on vient de loin, plus il y a de lignes ; les quatre de la 1.3.1 toujours en tête
    let n = 0;
    for (const seen of [...SEEN_BEFORE].reverse()) {
      const l = newsState(seen, NEWS_SINCE, '1.3.1').lines;
      expect(l.slice(0, 4), seen).toEqual(PHONE);
      expect(l.length, seen).toBeGreaterThanOrEqual(n);
      n = l.length;
    }
  });

  it('déjà en 1.3.1, version plus récente ou installation neuve : rien ; une appli encore en 1.3.0 ne l’annonce pas', async () => {
    for (const seen of ['1.3.1', '1.3.2', '1.4.0', '']) {
      expect(newsState(seen, NEWS_SINCE, '1.3.1').visible(), seen || 'installation neuve').toBe(false);
      const root = mounted(seen);
      await settle();
      expect(root.querySelector('.mirror-sec, .where'), seen).not.toBeNull();
      expect(root.querySelector('.news'), seen || 'installation neuve').toBeNull();
      document.body.replaceChildren();
    }
    for (const seen of SEEN_BEFORE) expect(newsState(seen, NEWS_SINCE, '1.3.1').visible(), seen).toBe(true);
    expect(newsState('1.2.10', NEWS_SINCE, '1.3.0').visible()).toBe(false);
  });
});

describe('PRD-1.3.1 § 9 : Quai Web, l’onglet Réglages et « Essayer en accéléré »', () => {
  it('les quatre lignes de Quai Web : jamais « le téléphone » ; la dernière cite l’essai par le nom de son bouton', () => {
    expect(ESSAI_TEXT.button).toBe('Essayer en accéléré');
    expect(news131Web(ESSAI_TEXT.button)).toEqual(WEB);
    expect(newsLines('1.3.0', true, ESSAI_TEXT.button)).toEqual(WEB);
    expect(newsLines('1.2.10', true, ESSAI_TEXT.button)).toEqual([...WEB, ...NEWS_130_WEB]);
    for (const seen of SEEN_BEFORE) for (const l of newsLines(seen, true, ESSAI_TEXT.button)) expect(l, l).not.toMatch(/téléphone/);
    for (const l of WEB) typoOk(typo(l));
    // sans le nom de l'essai (jamais le cas dans Quai Web) : les deux réglages seulement, rien d'inventé
    expect(news131Web()[3]).toBe('Dans l’onglet Réglages : « Éviter les escaliers » et « Plein soleil ».');
    expect(news131Web().slice(0, 3)).toEqual(WEB.slice(0, 3));
  });

  it('Quai Web monté comme dans web/main.ts (newsTrial) : la bannière cite « Essayer en accéléré » ; l’appli Even : jamais', async () => {
    const web = mounted('1.3.0', { web: true, newsTrial: ESSAI_TEXT.button });
    await settle();
    expect(textOf(web.querySelector('.news-title'))).toBe('Nouveau dans Quai 1.3.1');
    expect(bannerLines(web)).toEqual(WEB);
    expect(web.querySelector('.news-lines')!.textContent).toContain(`«${NB}Essayer en accéléré${NB}»`);
    document.body.replaceChildren();
    for (const seen of SEEN_BEFORE) {
      const even = mounted(seen);
      await settle();
      expect(even.querySelector('.news'), seen).not.toBeNull();
      expect(even.querySelector('.news')!.textContent, seen).not.toMatch(/accéléré/i);
      document.body.replaceChildren();
    }
    // les lignes du téléphone et celles des lunettes, quelle que soit la version d'avant : jamais l'essai
    for (const seen of ['', ...SEEN_BEFORE]) {
      for (const l of newsLines(seen)) expect(l, l).not.toMatch(/accéléré/i);
      for (const w of [false, true]) for (const l of glassesNewsLines(seen, w)) expect(l, l).not.toMatch(/accéléré/i);
    }
  });

  it('le nom de l’essai n’est écrit dans aucun fichier que l’appli des lunettes embarque pour ses nouveautés (hors commentaires)', () => {
    const code = (rel: string): string =>
      readFileSync(fileURLToPath(new NodeURL(`../../src/${rel}`, import.meta.url)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\s\/\/ .*$/gm, '');
    for (const f of ['phone/text.ts', 'phone/app.ts', 'phone/screens/home.ts', 'glasses/views.ts', 'glasses/controller.ts', 'glasses/format.ts']) expect(code(f), f).not.toMatch(/accéléré/i);
    // il n'est écrit que dans Quai Web
    expect(code('web/essai.ts')).toMatch(/Essayer en accéléré/);
  });
});

describe('PRD-1.3.1 § 9 : chaque ligne des nouveautés de la 1.3.1 dit quelque chose de vrai (les mots cités sont écrits dans l’appli)', () => {
  /** Les mots cités entre guillemets par une ligne. */
  const quoted = (l: string): string[] => [...plain(l).matchAll(/« ([^»]+?) »/g)].map((m) => m[1]);

  it('téléphone et Quai Web : « dernier », « Éviter les escaliers », « Plein soleil », « En cours », « Copier mon heure d’arrivée », « Y aller », « Essayer en accéléré »', async () => {
    const hz = harness({ settings: defaults() });
    const settings = textOf(mount(settingsScreen(hz.ctx)));
    const display = textOf(mount(displayScreen(hz.ctx)));
    const st: GuideStatus = { kind: 'trip', title: 'Gare de Namur', arr: at(8, 54), now: 'bus 4 vers Namur Omalius', guided: true };
    withGuide(hz.glasses, st);
    const home = mount(homeScreen(hz.ctx));
    await settle();
    const card = home.querySelector<HTMLElement>('.now-card')!;
    const where: Record<string, () => boolean> = {
      // le mot des lunettes, sur l'écran du trajet et les tableaux
      dernier: () => LAST_MARK === ', dernier',
      // Réglages (bouton de l'accueil), « Tes trajets »
      'Éviter les escaliers': () => settings.includes('Éviter les escaliers') && T.settings === 'Réglages',
      // Affichage (dans Réglages), « Sur tous les écrans »
      'Plein soleil': () => display.includes('Plein soleil') && T.display === 'Affichage' && settings.includes('Affichage'),
      'En cours': () => textOf(card.querySelector('.now-title')) === 'En cours',
      'Copier mon heure d’arrivée': () => [...card.querySelectorAll('button')].some((b) => textOf(b) === 'Copier mon heure d’arrivée'),
      'Y aller': () => T.goThere === 'Y aller',
      'Essayer en accéléré': () => ESSAI_TEXT.button === 'Essayer en accéléré',
    };
    const lines = [...NEWS_131, ...news131Web(ESSAI_TEXT.button), ...news131Web()];
    const cited = new Set(lines.flatMap(quoted));
    expect([...cited].sort()).toEqual(Object.keys(where).sort());
    for (const q of cited) expect(where[q](), q).toBe(true);
    // les mots non cités : « masque » est le mot de l'aide du guidage, les trois points sont ceux de l'écran calme,
    // la sortie est la ligne « Sortie : … » de la marche après la descente
    expect(HINTS.guide).toContain('masquer');
    expect(NEWS_131[0]).toMatch(/Un toucher masque un message/);
    expect(GUIDE_TEXT.dots).toBe('· · ·');
    expect(plain(EXIT_HEAD)).toBe('Sortie :');
    expect(plain(T.guideHelp)).toContain('trois petits points');
  });

  it('lunettes : les quatre lignes parlent de ce qui est à l’écran ; chacune tient sur une ligne, au pixel', () => {
    expect(NEWS_LINES_131).toHaveLength(4);
    for (const l of NEWS_LINES_131) {
      expect(textWidth(l), l).toBeLessThanOrEqual(WIDTHS.full);
      typoOk(l);
    }
    expect(NEWS_LINES_131.flatMap(quoted)).toEqual(['dernier']);
    expect(LAST_MARK).toContain('dernier');
    expect(GUIDE_TEXT.dots.match(/·/g)).toHaveLength(3);
    expect(plain(NEWS_LINES_131[1])).toMatch(/la sortie/);
    expect(plain(EXIT_HEAD).toLowerCase()).toContain('sortie');
  });

  it('la ligne de la 1.2.10 sur le train ou le bus déjà pris cite ce que la liste des arrêts écrit en 1.3.1 : « ▶ Me guider jusqu’à … », plus « j’y descends »', () => {
    expect(plain(NEWS_1210[1])).toBe('Train ou bus déjà pris : dans la liste de ses arrêts, touche celui où tu descends, « ▶ Me guider jusqu’à … », et Quai te dit quand descendre.');
    expect(NEWS_LINES_1210_KEPT.map(plain)).toEqual(['Y aller : guidé de porte à porte, écran calme.', 'Train ou bus déjà pris : « ▶ Me guider jusqu’à … ».']);
    // le mot cité commence comme la ligne d'action de la liste des arrêts
    for (const l of [NEWS_1210[1], NEWS_LINES_1210_KEPT[1]]) {
      const q = quoted(l)[0];
      expect(q.startsWith(GUIDE_TO.prefix.trim())).toBe(true);
      expect(q.endsWith('…')).toBe(true);
    }
    // l'aide de la liste, réglage « Me guider » allumé (par défaut), n'écrit plus « j’y descends »
    expect(HINTS.stopsGuide).not.toMatch(/j’y descends/);
    // aucune ligne montrée, téléphone, Quai Web ou lunettes, ne cite encore « j’y descends »
    for (const seen of SEEN_BEFORE) {
      for (const web of [false, true]) {
        for (const l of newsLines(seen, web, web ? ESSAI_TEXT.button : '')) expect(l, l).not.toMatch(/j’y descends/);
        for (const l of glassesNewsLines(seen, web)) expect(l, l).not.toMatch(/j’y descends/);
      }
    }
  });
});
