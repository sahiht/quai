// @vitest-environment happy-dom
/**
 * Quai 1.3.1, téléphone et Quai Web (docs/v1.3.1/PRD-1.3.1.md) : § 5 conseil précis du test de l'écran pour « Head-Up » ;
 * § 4 la marche nomme l'arrêt où monter sur les cartes (« à pied 7 min → Flagey ») ; § 7 apostrophe typographique des
 * noms des données, à l'affichage seulement ; § 8 accueil dans l'ordre des lunettes ; § 12 : L2 (aide de « Me guider
 * pendant un trajet »), L7 (le nom du favori de l'accueil des lunettes), L8 (« dans l’onglet Réglages »), B15 (le « ! »
 * d'un favori) ; § 14 : R6 (« Copier mon heure d’arrivée »), R7 (« Wear Detection », mode silencieux). Lieux publics
 * seulement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DisplayTestCmd, DisplayTestState, FavoriteAnswer, GlassesApi, Journey, Leg, LinePick, StationPick } from '../../src/core/api';
import type { GuideStatus } from '../../src/core/guide-types';
import type { LineFollow } from '../../src/core/linerun';
import { textWidth } from '../../src/glasses/font';
import { SECTION } from '../../src/glasses/format';
import { WIDTHS } from '../../src/glasses/layout';
import { favoritesView, favoriteTrouble, homeFavoriteName, TROUBLE_MARK } from '../../src/glasses/views';
import { placeField, type FieldChoice } from '../../src/phone/field';
import { displayTestScreen, openDisplayTest } from '../../src/phone/screens/display-test';
import { favoritesScreen } from '../../src/phone/screens/favorites';
import { homeFavoriteText, homeScreen, resetAnswers, rubrics } from '../../src/phone/screens/home';
import { picksScreen, resetKnownLines } from '../../src/phone/screens/picks';
import { searchScreen, shownLabel } from '../../src/phone/screens/search';
import { settingsScreen } from '../../src/phone/screens/settings';
import { arrivalCopyText, copiedText, guideNowLine, guideTitleLine, meansLine, NEWS_1210, NEWS_1210_WEB, NEWS_130, NEWS_130_WEB, newsLines, T, TEST_ADVICE, TEST_CHECK, TEST_CHECKED, TEST_LAST, typo } from '../../src/phone/text';
import { at, button, defaults, harness, mount, plain, preset11, SCENARIO, settle, textOf, type, until, withGuide, type Harness } from './helpers';
import { rideLeg, trip, walkLeg } from './trips';

beforeEach(() => {
  resetAnswers();
  resetKnownLines();
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
});

const NB = ' ';
const N = (fr: string, nl = fr) => ({ fr, nl });

/** Typographie d'un texte affiché : ni tiret long ni moyen, insécable devant « : ; ! ? », apostrophe typographique. */
function typoOk(s: string, what = s): void {
  expect(s, what).not.toMatch(/[–—]/);
  expect(s, what).not.toMatch(/ [:;!?]/);
  expect(s, what).not.toMatch(/« | »/);
  expect(s, what).not.toMatch(/\d (s|min|h|m|km|secondes)\b/);
  expect(s, what).not.toMatch(/'/);
}

/* ------------------------------ § 5 et R7 : test de l'écran ------------------------------ */

/** Le conseil « Head-Up » du PRD-1.3.1 § 5, mot pour mot (apostrophe typographique de l'appli). */
const PRD_HEADUP =
  'Pour voir les messages sans bouger la tête : dans l’appli Even, règle l’angle de l’affichage Head-Up à 0, en regardant un peu vers le bas pendant le réglage. L’écran restera allumé quand tu regardes devant toi ; la batterie des lunettes s’use un peu plus vite.';
/** R7 (docs/v1.3.1/experts/06-rd.md, message du directeur) : ce qu'il faut vérifier si l'affichage Head-Up ne réagit pas. */
const R7 = 'Si l’affichage Head-Up ne réagit pas, vérifie « Wear Detection » dans l’appli Even, et que le mode silencieux est coupé (appui d’une seconde sur les deux branches).';

/** Test de l'écran factice (GlassesApi.displayTest, onDisplayTest), comme le contrôleur. */
function withDisplayTest(g: GlassesApi): { cmds: DisplayTestCmd[]; emit(s: DisplayTestState): void } {
  const subs = new Set<(s: DisplayTestState) => void>();
  const f = { cmds: [] as DisplayTestCmd[], emit: (s: DisplayTestState) => subs.forEach((cb) => cb(s)) };
  g.displayTest = async (cmd) => {
    f.cmds.push(cmd);
    if (cmd.kind === 'start') return { step: 'wait', left: 45 };
    if (cmd.kind === 'cancel') return { step: 'idle' };
    return cmd.answer === 'quai' ? { step: 'done', result: 'headUp' } : cmd.answer === 'dashboard' ? { step: 'done', result: 'dashboard' } : { step: 'done' };
  };
  g.onDisplayTest = (cb) => {
    subs.add(cb);
    return () => void subs.delete(cb);
  };
  return f;
}

function testScreen(): { hz: Harness; t: ReturnType<typeof withDisplayTest>; el: HTMLElement } {
  const hz = harness({ settings: defaults() });
  const t = withDisplayTest(hz.glasses);
  withGuide(hz.glasses, null);
  openDisplayTest(hz.ctx);
  const el = mount(displayTestScreen(hz.ctx));
  return { hz, t, el };
}
const stepText = (el: HTMLElement): string => textOf(el.querySelector('.test-step'));
const noteText = (el: HTMLElement): string | null => {
  const n = el.querySelector<HTMLElement>('.test-note')!;
  return n.hidden ? null : textOf(n);
};

describe('§ 5 : test de l’écran, le conseil précis pour « Head-Up » ; R7 : « Wear Detection » et le mode silencieux', () => {
  it('« Head-Up » : le texte exact du PRD, insécables compris (« à 0 » jamais coupé) ; aucun chemin de menu ; les autres résultats ne changent pas', () => {
    expect(plain(TEST_ADVICE.headUp)).toBe(PRD_HEADUP);
    expect(TEST_ADVICE.headUp).toContain(`tête${NB}: dans`);
    expect(TEST_ADVICE.headUp).toContain(`Head-Up à${NB}0,`);
    expect(TEST_ADVICE.headUp).toContain(`devant toi${NB}; la batterie`);
    // aucun chemin de menu inventé (ni « > », ni « Réglages », ni « Paramètres »)
    expect(TEST_ADVICE.headUp).not.toMatch(/[>›»→]|Réglages|Paramètres|menu/);
    typoOk(TEST_ADVICE.headUp, 'headUp');
    // inchangés (PRD-1.3.0 § 6.1)
    expect(plain(TEST_ADVICE.visible)).toBe('Les messages de Quai se voient sans rien faire. S’il le faut, Quai les rappelle.');
    expect(plain(TEST_ADVICE.dashboard)).toBe('En levant la tête, tu vois le Dashboard. Pendant un trajet, touche une fois les lunettes pour voir Quai.');
    expect(plain(TEST_ADVICE.none)).toBe('Les lunettes n’ont rien montré : dans l’appli Even, vérifie le réglage « Head-Up », puis recommence le test.');
    expect(plain(TEST_LAST.headUp)).toBe('Dernier test : les messages se voient en levant la tête.');
  });

  it('R7 : le texte, ses insécables, pour « Head-Up » et « Rien » seulement', () => {
    expect(plain(TEST_CHECK)).toBe(R7);
    expect(TEST_CHECK).toContain(`«${NB}Wear Detection${NB}»`);
    typoOk(TEST_CHECK, 'R7');
    expect([...TEST_CHECKED].sort()).toEqual(['headUp', 'none']);
  });

  it('écran du test, fin : « Le test de Quai » (Head-Up) : le conseil du PRD, puis R7 dessous ; « Rien » : R7 aussi ; « Le Dashboard » et « visible » : rien de plus', async () => {
    const cases: [string, string, string | null][] = [
      ['Le test de Quai', PRD_HEADUP, R7],
      ['Rien', plain(TEST_ADVICE.none), R7],
      ['Le Dashboard', plain(TEST_ADVICE.dashboard), null],
    ];
    for (const [label, advice, note] of cases) {
      const { t, el } = testScreen();
      await until(() => stepText(el).startsWith('Mets tes lunettes'));
      // pendant le test : pas de ligne en plus
      expect(noteText(el), label).toBeNull();
      t.emit({ step: 'ask' });
      button(el, label).click();
      await until(() => stepText(el) !== 'Lève la tête. Que vois-tu dans les lunettes ?');
      expect(stepText(el), label).toBe(advice);
      expect(noteText(el), label).toBe(note);
      if (note) {
        typoOk(el.querySelector('.test-note')!.textContent!, label);
        // sous le conseil, avant les boutons ; annoncée avec lui
        const box = el.querySelector('.test-box')!;
        const order = [...box.children].map((c) => c.className);
        expect(order.indexOf('test-note')).toBe(order.indexOf('test-step') + 1);
        expect(el.querySelector('.test-note')!.getAttribute('aria-live')).toBe('polite');
      }
      // « Recommencer le test » : la ligne disparaît avec le conseil
      button(el, 'Recommencer le test').click();
      await until(() => noteText(el) === null);
      expect(stepText(el)).not.toBe(advice);
    }
    // visible : le contrôleur rend « done » tout seul ; rien de plus
    const { t, el } = testScreen();
    await until(() => stepText(el).startsWith('Mets tes lunettes'));
    t.emit({ step: 'done', result: 'visible', learned: false });
    expect(stepText(el)).toBe(plain(TEST_ADVICE.visible));
    expect(noteText(el)).toBeNull();
  });
});

/* ------------------------------ L2 : aide de « Me guider pendant un trajet » ------------------------------ */

describe('§ 12, L2 : aide du réglage « Me guider pendant un trajet » ; aucun « effacer » pour le geste du guidage', () => {
  it('le texte exact, dans Réglages', () => {
    const help = 'Les lunettes ne montrent que trois petits points et t’écrivent seulement quand tu dois agir : partir, tourner, monter, descendre. Éteint : ton trajet est suivi sans rien afficher tout seul.';
    expect(plain(T.guideHelp)).toBe(help);
    const el = mount(settingsScreen(harness({ settings: defaults() }).ctx));
    expect([...el.querySelectorAll('.switch-row .c2')].map((x) => textOf(x))).toContain(help);
    expect(el.textContent).not.toMatch(/restent vides/);
  });

  it('les textes du téléphone : « effacer » seulement pour le journal et les adresses récentes, jamais pour le geste du guidage', () => {
    const erasing = Object.entries(T).filter(([, v]) => /effac/i.test(v)).map(([k]) => k);
    expect(erasing.sort()).toEqual(['clearRecent', 'journalClear', 'journalClearAsk', 'journalClearYes', 'journalCleared']);
    for (const l of [...NEWS_130, ...NEWS_130_WEB, ...Object.values(TEST_ADVICE), TEST_CHECK]) expect(l).not.toMatch(/effac/i);
  });
});

describe('§ 9 : les nouveautés de la 1.2.10 encore montrées restent vraies (B10, trois petits points)', () => {
  /** Toutes les lignes que la bannière peut montrer, téléphone et Quai Web, quelle que soit la version d'avant. */
  const all = (): string[] => {
    const out = new Set<string>();
    for (const seen of ['1.1.0', '1.2.0', '1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.2.6', '1.2.7', '1.2.8', '1.2.9', '1.2.10']) for (const web of [false, true]) for (const l of newsLines(seen, web)) out.add(l);
    return [...out];
  };

  it('Quai Web, appui long : le menu dans l’ordre de B10, « Arrêter le guidage » en dernier, « Voir les arrêts » sauf à pied', () => {
    const line = NEWS_1210_WEB[4];
    expect(plain(typo(line))).toBe('Dans l’onglet Lunettes, le bouton « Appui long » ouvre le menu du guidage : « Voir tout le trajet », « Voir les arrêts » (sauf pour un trajet tout à pied), « Arrêter le guidage ».');
    const at3 = ['« Voir tout le trajet »', '« Voir les arrêts »', '« Arrêter le guidage »'].map((x) => line.indexOf(x));
    expect(at3.every((i) => i > 0)).toBe(true);
    expect([...at3].sort((a, b) => a - b)).toEqual(at3);
    // montrée à qui vient d'avant la 1.2.10, sur Quai Web
    expect(newsLines('1.2.9', true)).toContain(line);
    typoOk(typo(line));
  });

  it('aucune ligne ne cite l’ancien ordre du menu ni un écran « vide » ; la 1re ligne de la 1.2.10 reprend les mots de l’aide (L2)', () => {
    const lines = all();
    expect(lines.length).toBeGreaterThan(20);
    for (const l of lines) {
      const stop = l.indexOf('« Arrêter le guidage »');
      const whole = l.indexOf('« Voir tout le trajet »');
      if (stop >= 0 && whole >= 0) expect(stop, l).toBeGreaterThan(whole);
      expect(l).not.toMatch(/reste vide|restent vides/);
      expect(l).not.toMatch(/effac/i);
    }
    expect(plain(typo(NEWS_1210[0]))).toBe('« Y aller » : Quai te guide de porte à porte. Les lunettes ne montrent que trois petits points et t’écrivent seulement quand tu dois agir : partir, tourner, monter, descendre.');
    expect(NEWS_1210_WEB[0]).toBe(NEWS_1210[0]);
    expect(NEWS_1210[0]).toContain(T.guideHelp.split(' et t’écrivent')[0].replace(/^Les lunettes/, 'Les lunettes'));
  });
});

/* ------------------------------ § 4 : la marche nomme l'arrêt où monter ------------------------------ */

/** Un trajet de legs donnés (heures du premier et du dernier). */
const journey = (legs: Leg[], extra: Partial<Journey> = {}): Journey => ({
  id: 'j',
  legs,
  dep: legs[0].dep,
  arr: legs[legs.length - 1].arr,
  leaveAt: legs[0].dep,
  transfers: Math.max(0, legs.filter((l) => l.kind === 'ride').length - 1),
  rt: false,
  alerts: [],
  label: 'short',
  ...extra,
});
const min = (n: number): number => n * 60_000;
const T0 = at(16, 40);

describe('§ 4, téléphone : la ligne « moyens » d’une carte nomme l’arrêt où monter', () => {
  it('« bus 71, à pied 7 min → Flagey, puis 4 min » : la flèche et le nom insécables avec la durée', () => {
    const j = journey([walkLeg(T0, 7), rideLeg(T0 + min(7), T0 + min(20), 'bus 71', 'Flagey', 'De Brouckère'), walkLeg(T0 + min(20), 4)]);
    expect(plain(meansLine(j))).toBe('bus 71, à pied 7 min → Flagey, puis 4 min');
    expect(meansLine(j)).toBe(`bus 71, à${NB}pied 7${NB}min${NB}→${NB}Flagey, puis 4${NB}min`);
    typoOk(meansLine(j));
  });

  it('correspondances : la première marche nomme son arrêt, les autres suivent (« puis 2 + 9 min ») ; plus de deux : leur total', () => {
    const two = journey([
      walkLeg(T0, 7),
      rideLeg(T0 + min(7), T0 + min(25), 'bus 71', 'Flagey', 'Gare du Midi'),
      walkLeg(T0 + min(25), 2),
      rideLeg(T0 + min(30), T0 + min(60), 'IC', 'Bruxelles-Midi', 'Namur'),
      walkLeg(T0 + min(60), 9),
    ]);
    expect(plain(meansLine(two))).toBe('bus 71 + IC, à pied 7 min → Flagey, puis 2 + 9 min');
    const many = journey([
      walkLeg(T0, 5),
      rideLeg(T0 + min(5), T0 + min(15), 'bus 36', 'Flagey', 'Bruxelles-Central'),
      walkLeg(T0 + min(15), 3),
      rideLeg(T0 + min(20), T0 + min(40), 'IC', 'Bruxelles-Central', 'Bruxelles-Nord'),
      walkLeg(T0 + min(40), 2),
      rideLeg(T0 + min(45), T0 + min(50), 'métro 2', 'Rogier', 'Botanique'),
      walkLeg(T0 + min(50), 3),
    ]);
    expect(plain(meansLine(many))).toBe('bus 36 + IC + métro 2, à pied 5 min → Flagey, puis 8 min');
    // le trajet commence à bord : la marche de correspondance nomme l'arrêt du véhicule suivant
    const aboard = journey([rideLeg(T0, T0 + min(40), 'IC', 'Namur', 'Bruxelles-Midi'), walkLeg(T0 + min(40), 2), rideLeg(T0 + min(45), T0 + min(55), 'métro 2', 'Gare du Midi', 'Rogier'), walkLeg(T0 + min(55), 3)]);
    expect(plain(meansLine(aboard))).toBe('IC + métro 2, à pied 2 min → Gare du Midi, puis 3 min');
  });

  it('seule la marche vers la destination (trajet qui part d’un arrêt) : inchangée ; sans marche ; à pied seulement ; la pluie à la fin', () => {
    expect(plain(meansLine(journey([rideLeg(T0, T0 + min(10), 'tram 3', 'Gare du Nord', 'Churchill'), walkLeg(T0 + min(10), 4)])))).toBe('tram 3, à pied 4 min');
    expect(meansLine(journey([rideLeg(T0, T0 + min(30), 'IC', 'Namur', 'Bruxelles-Central')]))).toBe('IC');
    expect(meansLine(journey([walkLeg(T0, 22)]))).toBe('');
    const wet = journey([{ ...walkLeg(T0, 7), rain: true }, rideLeg(T0 + min(7), T0 + min(20), 'bus 71', 'Flagey', 'De Brouckère'), walkLeg(T0 + min(20), 4)]);
    expect(plain(meansLine(wet))).toBe('bus 71, à pied 7 min → Flagey, puis 4 min, pluie prévue');
  });

  it('le nom dans la langue des noms, avec l’apostrophe typographique', () => {
    const ride = rideLeg(T0 + min(6), T0 + min(20), 'métro 2', 'Gare du Midi', 'Rogier');
    const j = journey([walkLeg(T0, 6), { ...ride, from: { name: N('Gare du Midi', 'Zuidstation'), lat: 0, lon: 0 } }, walkLeg(T0 + min(20), 3)]);
    expect(plain(meansLine(j, 'nl'))).toBe('métro 2, à pied 6 min → Zuidstation, puis 3 min');
    expect(plain(meansLine(j, 'fr'))).toBe('métro 2, à pied 6 min → Gare du Midi, puis 3 min');
    const pda = journey([walkLeg(T0, 4), rideLeg(T0 + min(4), T0 + min(12), 'tram 81', "Porte d'Anderlecht", 'Montgomery')]);
    expect(plain(meansLine(pda))).toBe('tram 81, à pied 4 min → Porte d’Anderlecht');
  });

  it('carte de la recherche : la ligne « moyens » et le départ du premier véhicule avec le nom ; titre avec l’apostrophe typographique, le favori gardé avec le nom des données', async () => {
    const legs = [walkLeg(T0, 7), rideLeg(T0 + min(7), T0 + min(40), 'IC', "Braine-l'Alleud", 'Bruxelles-Midi'), walkLeg(T0 + min(40), 4)];
    const r = { journeys: [journey(legs)] };
    const area = (id: string, fr: string) => ({ id, op: 'sncb' as const, n: N(fr), lat: 50.68, lon: 4.37, modes: ['train' as const], lines: ['IC'] });
    const hz = harness({
      now: T0 - min(5),
      settings: defaults(),
      params: 'de=sncb:8814001&vers=sncb:8814118',
      core: (c) => ({ ...c, route: async () => r, board: async (id: string) => ({ ...(await c.board('sncb:8863008', { limit: 1 })), area: id === 'sncb:8814001' ? area(id, "Braine-l'Alleud") : area(id, "Braine-l'Alleud-Ouest") }) }),
    });
    const el = mount(searchScreen(hz.ctx));
    await until(() => el.querySelectorAll('.result').length === 1);
    const card = el.querySelector('.result')!;
    expect(textOf(card.querySelector('.means'))).toBe('IC, à pied 7 min → Braine-l’Alleud, puis 4 min');
    expect(textOf(card.querySelector('.det'))).toMatch(/^IC à Braine-l’Alleud, /);
    expect(textOf(el.querySelector('.res-title h2'))).toBe('Braine-l’Alleud → Braine-l’Alleud-Ouest');
    expect((el.querySelector<HTMLInputElement>('#r-arrivee')!).value).toBe('Braine-l’Alleud-Ouest');
    for (const x of [card.querySelector('.means'), card.querySelector('.det'), el.querySelector('.res-title h2')]) expect(x!.textContent).not.toContain("'");
    // « Garder en favori » : les extrémités gardent le nom des données (apostrophe droite), à l'affichage seulement
    button(el, 'Garder en favori').click();
    await until(() => hz.settings.get().favorites.length === 1);
    const kept = hz.settings.get().favorites[0];
    expect(kept.kind === 'trip' && kept.to.type === 'area' ? kept.to.name.fr : '').toBe("Braine-l'Alleud-Ouest");
    expect(shownLabel({ kind: 'area', area: { areaId: 'x', op: 'sncb', name: N("Braine-l'Alleud"), lat: 0, lon: 0, modes: ['train'] }, label: "Braine-l'Alleud" })).toBe('Braine-l’Alleud');
    // décision du 20/11 (« ’ » partout à l'affichage) : une adresse aussi ; le libellé gardé ne change pas
    const address = { kind: 'address' as const, label: "Rue de l'Église 5", lat: 0, lon: 0 };
    expect(shownLabel(address)).toBe('Rue de l’Église 5');
    expect(address.label).toBe("Rue de l'Église 5");
  });
});

/* ------------------------------ § 8, L7, B15 : accueil du téléphone ------------------------------ */

const BRAINE: StationPick = { id: 'g-braine', areaId: 'sncb:8814001', name: N("Braine-l'Alleud", 'Eigenbrakel'), lat: 50.6834, lon: 4.3711 };
const NAMUR: StationPick = { id: 'g-namur', areaId: 'sncb:8863008', name: N('Namur', 'Namen'), lat: 50.468, lon: 4.862 };
const PDA: LinePick = { id: 's-pda', areaId: 'stib:8032', op: 'stib', name: N("Porte d'Anderlecht", 'Anderlechtsepoort'), lat: 50.8436, lon: 4.3417 };
const W: LineFollow = { id: 'f-w', op: 'tec', mode: 'bus', line: 'W', routes: ['tec:W-MIDI'], ends: [N("Braine-l'Alleud Gare"), N('Bruxelles Midi', 'Brussel Zuid')] };

/** Les lignes de « Dans tes lunettes », dans l'ordre de la page : rubriques et favoris. */
const homeRows = (el: HTMLElement): string[] => [...el.querySelectorAll<HTMLElement>('.mirror .nav-row, .mirror .fav-row')].map((r) => textOf(r.querySelector('.t1')));
const SPEC_ORDER = ['Autour de moi', 'Favoris', 'Gares de train', 'Lignes de bus, tram, métro', 'Arrêts de bus, tram, métro'];

describe('§ 8 : l’accueil du téléphone dans l’ordre des lunettes, « Où vas-tu ? » en haut', () => {
  for (const web of [false, true]) {
    it(`${web ? 'Quai Web (onglet Réglages)' : 'téléphone'} : Autour de moi ; Favoris et ses favoris ; Gares de train ; Lignes ; Arrêts`, () => {
      const s = { ...preset11(), stations: [NAMUR], lines: [PDA], follows: [W] };
      const hz = harness({ settings: s, now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true }, web });
      const el = mount(homeScreen(hz.ctx));
      expect(homeRows(el)).toEqual([SPEC_ORDER[0], SPEC_ORDER[1], 'Bureau', 'Vers Gand-Saint-Pierre', 'Maison', ...SPEC_ORDER.slice(2)]);
      // « Où vas-tu ? » avant « Dans tes lunettes »
      const order = [...el.querySelectorAll('.where, .mirror-sec')].map((x) => x.className.split(' ')[0]);
      expect(order).toEqual(['where', 'mirror-sec']);
      expect(rubrics(s).map((r) => r.kind)).toEqual(['stations', 'follows', 'lines']);
    });
  }

  it('vide : le même ordre, rubriques « à choisir »', () => {
    const el = mount(homeScreen(harness({ settings: defaults() }).ctx));
    expect(homeRows(el)).toEqual(SPEC_ORDER);
  });
});

describe('§ 12, L7 : chaque favori porte le nom de l’accueil des lunettes', () => {
  it('« Bureau » et « Maison » (lieux), « Vers Gand-Saint-Pierre » (trajet fixe) : homeFavoriteName des lunettes ; les boutons sont nommés avec lui', async () => {
    const s = preset11();
    const hz = harness({ settings: s, now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    withGuide(hz.glasses);
    const el = mount(homeScreen(hz.ctx));
    const rows = [...el.querySelectorAll<HTMLElement>('.fav-card .fav-row')];
    const glasses = s.favorites.filter((f) => f.kind !== 'stop').map((f) => homeFavoriteName({ fav: f }, { now: SCENARIO.s1.now, settings: s }));
    const names = rows.map((r) => textOf(r.querySelector('.t1')));
    expect(names).toEqual(['Bureau', 'Vers Gand-Saint-Pierre', 'Maison']);
    for (const n of names) expect(glasses).toContain(n);
    expect(textOf(el)).not.toContain('Vers le bureau');
    const btns = [...rows[0].querySelectorAll('button')].map((b) => plain(b.getAttribute('aria-label')));
    expect(btns).toEqual(['Afficher Bureau dans les lunettes', 'Y aller : Bureau']);
    // « Lunettes » envoie toujours le trajet (titre du trajet des lunettes inchangé)
    await until(() => rows.every((r) => textOf(r.querySelector('.answer')) !== '…'));
    rows[0].querySelector<HTMLButtonElement>('.btn-glasses')!.click();
    await until(() => hz.glasses.trips.length === 1);
    expect(hz.glasses.trips[0].title).toBe('Vers le bureau');
  });
});

describe('§ 12, B15 : le « ! » d’un favori sur l’accueil du téléphone, comme dans les lunettes', () => {
  const now = at(7, 31);
  const base = (): Journey => trip('short', at(7, 35), [5, [at(7, 42), at(8, 20), 'IC'], 8]);
  const answer = (j: Journey): FavoriteAnswer => ({ favoriteId: 'fav-bureau', kind: 'trip', state: 'ok', plan: { journeys: [j] }, updatedAt: now });
  const withRide = (patch: Partial<Leg>): Journey => {
    const j = base();
    j.legs[1] = { ...j.legs[1], ...patch };
    return j;
  };
  const cases: [string, FavoriteAnswer | undefined, boolean][] = [
    ['premier véhicule supprimé', answer(withRide({ cancelled: true })), true],
    ['voie modifiée', answer(withRide({ platform: '4', newPlatform: '6' })), true],
    ['travaux sur le trajet', answer({ ...base(), alerts: [{ kind: 'works', text: '! Travaux : arrêt déplacé', at: now }] }), true],
    ['un retard seul', answer(withRide({ delayMin: 7, rt: true })), false],
    ['à l’heure', answer(base()), false],
    ['en calcul', undefined, false],
  ];

  it('mêmes cas que les lunettes (favoriteTrouble) ; « ! » collé au nom par une espace insécable (TROUBLE_MARK)', () => {
    const s = preset11();
    const fav = s.favorites.find((f) => f.id === 'fav-bureau')!;
    expect(TROUBLE_MARK).toBe(`${NB}!`);
    for (const [what, a, trouble] of cases) {
      expect(favoriteTrouble(a, now), what).toBe(trouble);
      expect(homeFavoriteText(fav as Parameters<typeof homeFavoriteText>[0], a, now, s), what).toBe(trouble ? `Bureau${NB}!` : 'Bureau');
    }
  });

  it('à l’écran : la réponse arrivée met le « ! », qui part avec le souci ; jamais dans le nom des boutons', async () => {
    let current = answer(withRide({ cancelled: true }));
    const hz = harness({ settings: preset11(), now, here: SCENARIO.s1, flags: { noRt: true }, core: (c) => ({ ...c, answer: async (f, here, st) => (f.id === 'fav-bureau' ? { ...current, updatedAt: now } : c.answer(f, here, st)) }) });
    withGuide(hz.glasses);
    mount(homeScreen(hz.ctx));
    const row = () => [...document.querySelectorAll<HTMLElement>('.fav-card .fav-row')].find((r) => textOf(r.querySelector('.t1')).startsWith('Bureau'))!;
    await until(() => row().querySelector('.t1')!.textContent === `Bureau${NB}!`);
    for (const b of row().querySelectorAll('button')) expect(b.getAttribute('aria-label')).not.toContain('!');
    // plus de souci au calcul suivant (ici, l'accueil rouvert) : le « ! » part
    current = answer(base());
    mount(homeScreen(hz.ctx));
    await until(() => row().querySelector('.t1')!.textContent === 'Bureau');
  });
});

/* ------------------------------ § 7 : apostrophe typographique, à l'affichage seulement ------------------------------ */

describe('§ 7, téléphone : les noms des données avec « ’ », les réglages gardent le nom des données', () => {
  it('accueil : « Gares », « Arrêts » ; écrans « Gares », « Arrêts », « Lignes » (titre, terminus) ; la confirmation du retrait', async () => {
    const s = defaults({ stations: [BRAINE], lines: [PDA], follows: [W] });
    const hz = harness({ settings: s });
    const home = mount(homeScreen(hz.ctx));
    const names = [...home.querySelectorAll('.mirror .nav-row .names')].map((x) => textOf(x));
    expect(names).toEqual(['Braine-l’Alleud', 'Porte d’Anderlecht']);
    const gares = mount(picksScreen(hz.ctx, 'stations'));
    expect(textOf(gares.querySelector('.pick-item .t1'))).toBe('Braine-l’Alleud');
    gares.querySelector<HTMLButtonElement>('.pick-head')!.click();
    gares.querySelector<HTMLButtonElement>('[data-act="remove"]')!.click();
    expect(textOf(gares.querySelector('.confirm-q'))).toBe('Retirer Braine-l’Alleud de tes gares ?');
    const arrets = mount(picksScreen(hz.ctx, 'lines'));
    expect(textOf(arrets.querySelector('.pick-item .t1'))).toBe('Porte d’Anderlecht');
    const lignes = mount(picksScreen(hz.ctx, 'follows'));
    expect(textOf(lignes.querySelector('.pick-item .t2'))).toBe('TEC · Braine-l’Alleud Gare ↔ Bruxelles Midi');
    // les réglages n'ont pas changé
    const st = hz.settings.get();
    expect([st.stations[0].name.fr, st.lines[0].name.fr, st.follows![0].ends![0].fr]).toEqual(["Braine-l'Alleud", "Porte d'Anderlecht", "Braine-l'Alleud Gare"]);
  });

  it('champ unique : la proposition et le texte choisi avec « ’ » ; le choix rendu garde le nom des données', async () => {
    const item = { id: 'stib:8032', op: 'stib' as const, n: N("Porte d'Anderlecht", 'Anderlechtsepoort'), modes: ['tram' as const], lat: 50.8436, lon: 4.3417, kindLabel: 'tram STIB' };
    const hz = harness({ settings: defaults(), core: (c) => ({ ...c, search: async () => [item], geocode: async () => ({ results: [] }) }) });
    const picks: FieldChoice[] = [];
    const f = placeField(hz.ctx, { id: 'f', label: 'Arrivée', onPick: (c) => picks.push(c) });
    mount(f.el);
    type(f.input, 'porte');
    await until(() => f.list.querySelectorAll('[role="option"]').length === 1);
    expect(textOf(f.list.querySelector('.s1'))).toBe('Porte d’Anderlecht');
    f.list.querySelector<HTMLButtonElement>('[role="option"]')!.click();
    expect(f.input.value).toBe('Porte d’Anderlecht');
    expect(picks[0]).toMatchObject({ kind: 'stop', label: "Porte d'Anderlecht" });
    await settle();
  });

  it('« Mes favoris » : un trajet fixe vers une gare ; la carte « En cours »', () => {
    const s = defaults({
      favorites: [{ kind: 'trip', id: 'fav-b', from: { type: 'area', areaId: NAMUR.areaId, op: 'sncb', name: NAMUR.name, lat: NAMUR.lat, lon: NAMUR.lon }, to: { type: 'area', areaId: BRAINE.areaId, op: 'sncb', name: BRAINE.name, lat: BRAINE.lat, lon: BRAINE.lon }, propose: 'never' }],
    });
    const el = mount(favoritesScreen(harness({ settings: s }).ctx));
    expect(textOf(el.querySelector('.list .t1'))).toBe('Namur → Braine-l’Alleud');
    const st: GuideStatus = { kind: 'trip', title: "Braine-l'Alleud", arr: at(8, 54), now: "IC vers Braine-l'Alleud", guided: true };
    expect(plain(guideTitleLine(st))).toBe('Braine-l’Alleud, arrivée 08:54');
    expect(plain(guideNowLine(st))).toBe('Maintenant : IC vers Braine-l’Alleud');
    const hz = harness({ settings: defaults() });
    withGuide(hz.glasses, st);
    const home = mount(homeScreen(hz.ctx));
    expect([textOf(home.querySelector('.now-trip')), textOf(home.querySelector('.now-now'))]).toEqual(['Braine-l’Alleud, arrivée 08:54', 'Maintenant : IC vers Braine-l’Alleud']);
  });
});

/* ------------------------------ L8 : « dans l’onglet Réglages » ------------------------------ */

describe('§ 12, L8 : Quai Web dit toujours « dans l’onglet Réglages »', () => {
  it('arrêt ou ligne introuvable (SECTION) ; « Ajouter un favori » et « Autre adresse » de « Favoris », dans leur colonne', () => {
    expect(SECTION.missingWeb).toBe(`introuvable${NB}: modifie-la dans l’onglet Réglages`);
    expect(SECTION.missingStopWeb).toBe(`introuvable${NB}: modifie-le dans l’onglet Réglages`);
    // l'appli Even ne change pas
    expect(SECTION.missing).toBe(`introuvable${NB}: modifie-la sur le téléphone`);
    const ctx = { now: SCENARIO.s1.now, settings: defaults(), web: true };
    const items = favoritesView({}, ctx).items;
    expect([items[0].a, items[0].c]).toEqual(['Ajouter un favori', 'dans l’onglet Réglages']);
    expect([items.at(-1)!.a, items.at(-1)!.c]).toEqual(['Autre adresse', 'dans l’onglet Réglages']);
    expect(textWidth('dans l’onglet Réglages')).toBeLessThanOrEqual(WIDTHS.wideRight);
    for (const t of Object.values(SECTION)) expect(t).not.toMatch(/dans Réglages/);
    for (const i of items) expect(`${i.a ?? ''} ${i.c ?? ''}`).not.toMatch(/dans Réglages/);
  });
});

/* ------------------------------ R6 : « Copier mon heure d'arrivée » ------------------------------ */

describe('§ 14, R6 : « Copier mon heure d’arrivée » sur la carte « En cours »', () => {
  const STATUS: GuideStatus = { kind: 'trip', title: 'Gare de Namur', arr: at(8, 54), now: 'bus 4 vers Namur Omalius', guided: true };
  const card = (el: HTMLElement) => el.querySelector<HTMLElement>('.now-card')!;
  const copyBtn = (el: HTMLElement) => card(el).querySelector<HTMLButtonElement>('.now-copy')!;
  const said = (el: HTMLElement) => card(el).querySelector<HTMLElement>('.now-copied')!;

  it('textes : le bouton, « J’arrive vers 08:54. » (l’heure seule, aucun nom de lieu), « Copié : … »', () => {
    expect(T.copyArrival).toBe('Copier mon heure d’arrivée');
    expect(arrivalCopyText(STATUS)).toBe('J’arrive vers 08:54.');
    expect(arrivalCopyText({ arr: 0 })).toBe('');
    expect(arrivalCopyText({ arr: Number.NaN })).toBe('');
    expect(copiedText('J’arrive vers 08:54.')).toBe(`Copié${NB}: J’arrive vers 08:54.`);
    for (const t of [T.copyArrival, arrivalCopyText(STATUS), copiedText(arrivalCopyText(STATUS))]) typoOk(t);
  });

  it('après « Arrêter le guidage » ; toucher : le presse-papiers reçoit l’heure seule, « Copié : J’arrive vers 08:54. » ; le curseur reste ; rien ne part sur le réseau', async () => {
    const net = vi.fn(async () => new Response(''));
    vi.stubGlobal('fetch', net);
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (s: string) => void copied.push(s) } });
    const hz = harness({ settings: defaults() });
    const guide = withGuide(hz.glasses, STATUS);
    const el = mount(homeScreen(hz.ctx));
    expect([...card(el).querySelectorAll('button')].map((b) => textOf(b))).toEqual(['Arrêter le guidage', 'Copier mon heure d’arrivée']);
    expect(copyBtn(el).type).toBe('button');
    expect(said(el).hidden).toBe(true);
    copyBtn(el).focus();
    copyBtn(el).click();
    await until(() => textOf(said(el)).startsWith('Copié'));
    expect(copied).toEqual(['J’arrive vers 08:54.']);
    expect(said(el).textContent).toBe(`Copié${NB}: J’arrive vers 08:54.`);
    expect([said(el).getAttribute('role'), said(el).getAttribute('aria-atomic'), said(el).classList.contains('err')]).toEqual(['status', 'true', false]);
    expect(copied[0]).not.toMatch(/Namur|Omalius|bus/);
    expect(document.activeElement).toBe(copyBtn(el));
    expect(copyBtn(el).disabled).toBe(false);
    // l'heure suit le guidage
    guide.emit({ ...STATUS, arr: at(9, 2) });
    copyBtn(el).click();
    await until(() => copied.length === 2);
    expect(copied[1]).toBe('J’arrive vers 09:02.');
    await until(() => textOf(said(el)) === 'Copié : J’arrive vers 09:02.');
    expect(net).not.toHaveBeenCalled();
    // plus d'heure connue : plus de bouton
    guide.emit({ ...STATUS, arr: 0 });
    expect(copyBtn(el).hidden).toBe(true);
    // un autre trajet : le message du précédent est parti
    guide.emit(null);
    guide.emit(STATUS);
    expect(said(el).hidden).toBe(true);
    expect(copyBtn(el).hidden).toBe(false);
  });

  it('repli comme le journal : sans l’API, la copie d’un champ caché ; copie impossible : le texte est sélectionné, à copier avec le menu', async () => {
    const hz = harness({ settings: defaults() });
    withGuide(hz.glasses, STATUS);
    const el = mount(homeScreen(hz.ctx));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    copyBtn(el).click();
    await until(() => textOf(said(el)).startsWith('Copié'));
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => Promise.reject(new Error('refusé')) } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
    copyBtn(el).click();
    await until(() => textOf(said(el)).startsWith('Copie impossible'));
    expect(textOf(said(el))).toBe('Copie impossible : le texte est sélectionné, copie-le avec le menu du téléphone. J’arrive vers 08:54.');
    expect(said(el).classList.contains('err')).toBe(true);
    expect(window.getSelection()?.toString()).toBe('J’arrive vers 08:54.');
  });
});
