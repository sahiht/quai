// @vitest-environment happy-dom
/**
 * Quai 1.3.0, téléphone (équipe F) : test de l'écran des lunettes mené par le téléphone (PRD-1.3.0 § 6.1 : Réglages,
 * « Pendant un trajet », écran du test et ses étapes, désabonnement en partant), carte « En cours » avec les problèmes
 * de la vérification (§ 6.3), carte « Journal des trajets » de l'écran Données (§ 6.4), bannière « Nouveau dans Quai
 * 1.3.0 » (§ 9), réglages `display.alert` et `display.headUp` (chargement, validation, anciens réglages sans perte),
 * typographie des nouveaux textes. Doubles : lunettes (displayTest, onDisplayTest, guidage) et journal (TripJournal).
 * Lieux publics seulement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DisplayTestCmd, DisplayTestState, GlassesApi, Settings } from '../../src/core/api';
import { DEFAULT_SETTINGS } from '../../src/core/api';
import type { GuideStatus } from '../../src/core/guide-types';
import type { JournalTrip, TripJournal } from '../../src/core/journal-types';
import { gtfsTime } from '../../src/core/util';
import { checkLines } from '../../src/glasses/guide-views';
import { mountPhone, NEWS_SINCE, newsState, parseHash } from '../../src/phone/app';
import { dataScreen, journalCard } from '../../src/phone/screens/data';
import { DISPLAY_TEST_HASH, displayTestScreen, GUIDE_CAUSE_MS, openDisplayTest, START_WINDOW_MS, TEST_WATCH_MS, TICK_MS } from '../../src/phone/screens/display-test';
import { homeScreen, resetAnswers } from '../../src/phone/screens/home';
import { settingsScreen } from '../../src/phone/screens/settings';
import {
  checkLinesOf,
  JOURNAL_END,
  journalTripLine,
  NEWS_1210,
  NEWS_1210_WEB,
  NEWS_129,
  NEWS_129_WEB,
  NEWS_130,
  NEWS_130_WEB,
  newsTitle,
  secondsLeft,
  T,
  TEST_ADVICE,
  TEST_ANSWERS,
  TEST_LAST,
} from '../../src/phone/text';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { loadSettings, migrateSettings, parseSettings, saveSettings, SETTINGS_KEY, SettingsStore, validateSettings } from '../../src/settings';
import { at, button, defaults, harness, mount, plain, preset11, settle, sleep, textOf, until, withGuide, type FakeGuide, type Harness } from './helpers';

beforeEach(() => resetAnswers());
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/* ------------------------------ Doubles ------------------------------ */

/** Test de l'écran factice (GlassesApi.displayTest, onDisplayTest), comme le contrôleur (équipe C2). */
interface FakeTest {
  /** Ordres reçus du téléphone, dans l'ordre. */
  cmds: DisplayTestCmd[];
  /** Abonnés encore inscrits. */
  listeners(): number;
  /** Prévient les abonnés d'un nouvel état (comme le contrôleur, chaque seconde ou à chaque étape). */
  emit(s: DisplayTestState): void;
  /** Réponse à un ordre : un état, ou une erreur. */
  reply(cmd: DisplayTestCmd): DisplayTestState | Error;
}

function withDisplayTest(g: GlassesApi, reply?: FakeTest['reply']): FakeTest {
  const subs = new Set<(s: DisplayTestState) => void>();
  const f: FakeTest = {
    cmds: [],
    listeners: () => subs.size,
    emit(s) {
      for (const cb of [...subs]) cb(s);
    },
    reply:
      reply ??
      ((c) => {
        if (c.kind === 'start') return { step: 'wait', left: 45 };
        if (c.kind === 'cancel') return { step: 'idle' };
        return c.answer === 'quai' ? { step: 'done', result: 'headUp' } : c.answer === 'dashboard' ? { step: 'done', result: 'dashboard' } : { step: 'done' };
      }),
  };
  g.displayTest = async (cmd) => {
    f.cmds.push(cmd);
    const r = f.reply(cmd);
    if (r instanceof Error) throw r;
    return r;
  };
  g.onDisplayTest = (cb) => {
    subs.add(cb);
    return () => void subs.delete(cb);
  };
  return f;
}

/** Instant du 15/11/2026 à Bruxelles. */
const nov15 = (hh: number, mm: number, ss = 0): number => gtfsTime('2026-11-15', hh * 60 + mm) + ss * 1000;

const trip = (id: string, title: string, startedAt: number, min: number | null, end?: JournalTrip['end']): JournalTrip => ({
  id,
  title,
  kind: 'trip',
  startedAt,
  ...(min !== null ? { endedAt: startedAt + min * 60_000 } : {}),
  ...(end ? { end } : {}),
  events: [{ t: startedAt, k: 'start', d: { title, kind: 'trip' } }],
});

/** Journal factice (TripJournal, équipe H) : liste du plus récent au plus ancien, texte, effacement. */
function fakeJournal(trips: JournalTrip[]): TripJournal & { cleared: number; texts: string[] } {
  let all = [...trips];
  const j = {
    cleared: 0,
    texts: [] as string[],
    begin: () => 'nouveau',
    add: () => undefined,
    end: () => undefined,
    list: () => [...all],
    text: (id: string) => {
      j.texts.push(id);
      const t = all.find((x) => x.id === id);
      return t ? `Journal Quai 1.3.0, trajet « ${t.title} », 15/11/2026\n08:02:10 Partir maintenant affiché\n08:09:40 Monter dans le bus 6 affiché` : '';
    },
    clear: () => {
      j.cleared += 1;
      all = [];
    },
  };
  return j;
}

/* ------------------------------ Typographie ------------------------------ */

/** Règles de l'appli pour un texte visible : jamais de tiret long ni moyen, espaces insécables, apostrophe « ’ ». */
function typoOk(s: string, what = s): void {
  expect(s, what).not.toMatch(/[\u2013\u2014]/);
  // jamais une espace ordinaire devant « : ; ! ? », ni dans les guillemets français
  expect(s, what).not.toMatch(/ [:;!?]/);
  expect(s, what).not.toMatch(/« | »/);
  // une espace insécable entre un nombre et son unité
  expect(s, what).not.toMatch(/\d (s|min|h|m|km|secondes)\b/);
  expect(s, what).not.toMatch(/'/);
}

/* ------------------------------ § 6.1 : Réglages ------------------------------ */

const duringTrip = (el: HTMLElement): HTMLElement => [...el.querySelectorAll<HTMLElement>('section.group')].find((g) => textOf(g.querySelector('h2')) === 'Pendant un trajet')!;

describe('1.3.0 : « Tester l’écran des lunettes » dans Réglages (PRD-1.3.0 § 6.1)', () => {
  it('sous « Me guider pendant un trajet », dans la même carte : le bouton ouvre l’écran du test, qui commence aussitôt', () => {
    const hz = harness({ settings: defaults() });
    withDisplayTest(hz.glasses);
    const el = mount(settingsScreen(hz.ctx));
    const box = duringTrip(el).querySelector<HTMLElement>('.box')!;
    // l'interrupteur d'abord, le bouton dessous
    const parts = [...box.children].map((c) => (c.classList.contains('switch-row') ? 'switch' : c.classList.contains('test-row') ? 'test' : c.className));
    expect(parts).toEqual(['switch', 'test']);
    const b = button(box, 'Tester l’écran des lunettes');
    expect(b.type).toBe('button');
    // pas de résultat encore : pas de ligne pâle, le bouton n'est décrit par rien
    expect(box.querySelector('.test-last')).toBeNull();
    expect(b.hasAttribute('aria-describedby')).toBe(false);
    b.click();
    expect(hz.went).toEqual([DISPLAY_TEST_HASH]);
    const { name, sub } = parseHash(DISPLAY_TEST_HASH);
    expect([name, sub]).toEqual(['reglages', ['test-ecran']]);
    // l'écran qui s'ouvre alors commence le test
    const t = withDisplayTest(hz.glasses);
    mount(displayTestScreen(hz.ctx));
    expect(t.cmds).toEqual([{ kind: 'start' }]);
  });

  it('pas dans Quai Web (pas de vraies lunettes) ; ni sans lunettes, ni avec des lunettes qui ne savent pas faire le test', () => {
    const web = harness({ settings: defaults(), web: true });
    withDisplayTest(web.glasses);
    expect(textOf(mount(settingsScreen(web.ctx)))).not.toMatch(/Tester l’écran/);
    expect(mount(settingsScreen(web.ctx)).querySelector('.test-row')).toBeNull();
    // lunettes d'une appli plus ancienne (pas de displayTest), ou pas de lunettes
    expect(mount(settingsScreen(harness({ settings: defaults() }).ctx)).querySelector('.test-row')).toBeNull();
    expect(mount(settingsScreen(harness({ settings: defaults(), glasses: false }).ctx)).querySelector('.test-row')).toBeNull();
    // l'interrupteur, lui, reste seul dans sa carte
    const el = mount(settingsScreen(harness({ settings: defaults() }).ctx));
    expect(duringTrip(el).querySelectorAll('.switch-row')).toHaveLength(1);
  });

  it('dessous, une ligne pâle avec le dernier résultat, s’il existe ; elle décrit le bouton', () => {
    const expected: Record<NonNullable<Settings['display']['alert']>, string> = {
      visible: 'Dernier test : les messages se voient sans rien faire.',
      headUp: 'Dernier test : les messages se voient en levant la tête.',
      dashboard: 'Dernier test : en levant la tête, tu vois le Dashboard.',
    };
    for (const alert of ['visible', 'headUp', 'dashboard'] as const) {
      const hz = harness({ settings: defaults({ display: { ...DEFAULT_SETTINGS.display, alert } }) });
      withDisplayTest(hz.glasses);
      const el = mount(settingsScreen(hz.ctx));
      const last = duringTrip(el).querySelector<HTMLElement>('.test-last')!;
      expect(textOf(last), alert).toBe(expected[alert]);
      expect(last.classList.contains('muted'), alert).toBe(true);
      // sous le bouton
      expect(last.previousElementSibling, alert).toBe(button(el, 'Tester l’écran des lunettes'));
      expect(button(el, 'Tester l’écran des lunettes').getAttribute('aria-describedby'), alert).toBe(last.id);
      typoOk(last.textContent!, alert);
    }
  });
});

/* ------------------------------ § 6.1 : écran du test ------------------------------ */

/** L'écran du test, ouvert par le bouton de Réglages (openDisplayTest) ou non (historique, rechargement). */
function testScreen(opts: { start?: boolean; reply?: FakeTest['reply'] } = {}): { hz: Harness; t: FakeTest; el: HTMLElement; guide: FakeGuide } {
  const hz = harness({ settings: defaults() });
  const t = withDisplayTest(hz.glasses, opts.reply);
  // guidage des lunettes (1.2.10) : aucun trajet suivi au départ
  const guide = withGuide(hz.glasses, null);
  if (opts.start !== false) {
    // le bouton de Réglages : il ouvre l'écran (ancre notée par le faux routeur, oubliée ici)
    openDisplayTest(hz.ctx);
    hz.went.length = 0;
  }
  const el = mount(displayTestScreen(hz.ctx));
  return { hz, t, el, guide };
}
const stepText = (el: HTMLElement): string => textOf(el.querySelector('.test-step'));
const leftText = (el: HTMLElement): string | null => {
  const l = el.querySelector<HTMLElement>('.test-left')!;
  return l.hidden ? null : textOf(l);
};
const buttons = (el: HTMLElement): string[] => [...el.querySelectorAll<HTMLButtonElement>('.test-box button')].map((b) => textOf(b));

describe('1.3.0 : écran du test de l’écran des lunettes (PRD-1.3.0 § 6.1)', () => {
  it('titre, retour à Réglages ; ouvert par le bouton : le test commence (start), étape wait avec le texte exact du PRD et son compte à rebours', async () => {
    const { hz, t, el } = testScreen();
    expect(textOf(el.querySelector('h1'))).toBe('Tester l’écran des lunettes');
    expect(t.cmds).toEqual([{ kind: 'start' }]);
    await until(() => stepText(el).startsWith('Mets tes lunettes'));
    expect(stepText(el)).toBe('Mets tes lunettes, regarde devant toi, la tête droite, et ne touche à rien pendant 45 secondes.');
    expect(leftText(el)).toBe('45 s');
    expect(el.querySelector('.test-left')!.getAttribute('role')).toBe('timer');
    expect(el.querySelector('.test-step')!.getAttribute('role')).toBe('status');
    expect(buttons(el)).toEqual(['Arrêter le test']);
    // un abonné : l'écran suit l'état du test
    expect(t.listeners()).toBe(1);
    // le compte à rebours suit les lunettes
    t.emit({ step: 'wait', left: 44 });
    expect(leftText(el)).toBe('44 s');
    t.emit({ step: 'wait', left: 3 });
    expect(leftText(el)).toBe('3 s');
    // retour à Réglages
    const back = el.querySelector<HTMLButtonElement>('.back')!;
    expect(textOf(back)).toBe('Réglages');
    back.click();
    expect(hz.went).toEqual(['#/reglages']);
  });

  it('sent : la consigne est seulement dans les lunettes (le téléphone ne la souffle pas), compte à rebours ; ask : la question et trois réponses, dans l’ordre du PRD', async () => {
    const { t, el } = testScreen();
    await until(() => leftText(el) === '45 s');
    t.emit({ step: 'sent', left: 15 });
    // contrôle usager 1.3.0 : si le téléphone disait « Touche une fois les lunettes », on toucherait sans avoir rien vu
    // dans les lunettes et le test conclurait à tort « visible »
    expect(stepText(el)).toBe('Regarde toujours devant toi. Si les lunettes te demandent quelque chose, fais-le.');
    expect(el.textContent).not.toMatch(/[Tt]ouche/);
    expect(leftText(el)).toBe('15 s');
    expect(buttons(el)).toEqual(['Arrêter le test']);
    t.emit({ step: 'sent', left: 9 });
    expect(leftText(el)).toBe('9 s');
    t.emit({ step: 'ask' });
    expect(stepText(el)).toBe('Lève la tête. Que vois-tu dans les lunettes ?');
    expect(el.querySelector('.test-step')!.textContent).toMatch(/lunettes\u00a0\?$/);
    expect(leftText(el)).toBeNull();
    expect(buttons(el)).toEqual(['Le test de Quai', 'Le Dashboard', 'Rien', 'Arrêter le test']);
    const group = el.querySelector<HTMLElement>('.test-answers')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Ce que tu vois dans les lunettes');
  });

  it('chaque réponse est envoyée aux lunettes (quai, dashboard, nothing), une seule fois ; done : le conseil exact du PRD', async () => {
    const advice: [string, DisplayTestCmd, string][] = [
      ['Le test de Quai', { kind: 'answer', answer: 'quai' }, 'Lève un peu la tête pour voir les messages. Pour le moindre mouvement : dans l’appli Even, règle l’angle d’affichage au plus bas.'],
      ['Le Dashboard', { kind: 'answer', answer: 'dashboard' }, 'En levant la tête, tu vois le Dashboard. Pendant un trajet, touche une fois les lunettes pour voir Quai.'],
      ['Rien', { kind: 'answer', answer: 'nothing' }, 'Les lunettes n’ont rien montré : dans l’appli Even, vérifie le réglage « Head-Up », puis recommence le test.'],
    ];
    for (const [label, cmd, text] of advice) {
      const { t, el } = testScreen();
      await until(() => leftText(el) === '45 s');
      t.emit({ step: 'ask' });
      const b = button(el, label);
      b.click();
      // les trois réponses sont grisées tout de suite : pas de seconde réponse
      expect([...el.querySelectorAll<HTMLButtonElement>('.test-answers button')].every((x) => x.disabled), label).toBe(true);
      await until(() => stepText(el) !== 'Lève la tête. Que vois-tu dans les lunettes ?');
      expect(t.cmds, label).toEqual([{ kind: 'start' }, cmd]);
      expect(stepText(el), label).toBe(text);
      expect(buttons(el), label).toEqual(['Terminé', 'Recommencer le test']);
      typoOk(el.querySelector('.test-step')!.textContent!, label);
    }
    // visible : le toucher pendant « sent » suffit (le contrôleur rend done tout seul)
    const { t, el } = testScreen();
    await until(() => leftText(el) === '45 s');
    t.emit({ step: 'sent', left: 15 });
    t.emit({ step: 'done', result: 'visible', learned: false });
    expect(stepText(el)).toBe('Les messages de Quai se voient sans rien faire. S’il le faut, Quai les rappelle.');
    expect(leftText(el)).toBeNull();
    expect(TEST_ADVICE.visible).toBe('Les messages de Quai se voient sans rien faire. S’il le faut, Quai les rappelle.');
  });

  it('« Terminé » ramène à Réglages ; « Recommencer le test » relance le test', async () => {
    const { hz, t, el } = testScreen();
    await until(() => leftText(el) === '45 s');
    t.emit({ step: 'done', result: 'dashboard' });
    button(el, 'Recommencer le test').click();
    await until(() => stepText(el).startsWith('Mets tes lunettes'));
    expect(t.cmds).toEqual([{ kind: 'start' }, { kind: 'start' }]);
    t.emit({ step: 'done', result: 'visible' });
    button(el, 'Terminé').click();
    expect(hz.went).toEqual(['#/reglages']);
    // le test était fini : partir ne l'annule pas, et l'écran ne suit plus rien
    expect(t.cmds).toEqual([{ kind: 'start' }, { kind: 'start' }]);
    expect(t.listeners()).toBe(0);
  });

  it('Quai fermé sur les lunettes : « Ouvre Quai sur les lunettes, puis recommence. », et un bouton pour recommencer', async () => {
    let closed = true;
    const { t, el } = testScreen({ reply: (c) => (c.kind === 'start' ? (closed ? { step: 'idle', error: 'closed' } : { step: 'wait', left: 45 }) : { step: 'idle' }) });
    await until(() => stepText(el) === 'Ouvre Quai sur les lunettes, puis recommence.');
    expect(leftText(el)).toBeNull();
    expect(buttons(el)).toEqual(['Recommencer le test']);
    closed = false;
    button(el, 'Recommencer le test').click();
    await until(() => leftText(el) === '45 s');
    expect(t.cmds).toEqual([{ kind: 'start' }, { kind: 'start' }]);
    // fermé en cours de test (les lunettes le disent) : même message
    t.emit({ step: 'idle', error: 'closed' });
    expect(stepText(el)).toBe('Ouvre Quai sur les lunettes, puis recommence.');
  });

  it('« Arrêter le test » pendant le test (wait, sent, ask) : annulé (cancel), « Test arrêté. », les états suivants sont ignorés', async () => {
    for (const step of ['wait', 'sent', 'ask'] as const) {
      const { t, el } = testScreen();
      await until(() => leftText(el) === '45 s');
      if (step !== 'wait') t.emit({ step, left: step === 'sent' ? 15 : undefined });
      const stop = button(el, 'Arrêter le test');
      stop.focus();
      stop.click();
      expect(stepText(el), step).toBe('Test arrêté.');
      expect(buttons(el), step).toEqual(['Recommencer le test']);
      // le curseur ne se perd pas : il passe au bouton qui remplace « Arrêter le test »
      expect(document.activeElement, step).toBe(button(el, 'Recommencer le test'));
      await settle();
      expect(t.cmds, step).toEqual([{ kind: 'start' }, { kind: 'cancel' }]);
      // un état en retard des lunettes ne remet pas le test à l'écran
      t.emit({ step: 'wait', left: 30 });
      expect(stepText(el), step).toBe('Test arrêté.');
    }
  });

  it('un guidage en cours : le test ne démarre pas, « Arrête d’abord le guidage en cours, puis recommence. »', async () => {
    let guidingNow = true;
    const { t, el } = testScreen({ reply: (c) => (c.kind === 'start' ? (guidingNow ? { step: 'idle', error: 'guiding' } : { step: 'wait', left: 45 }) : { step: 'idle' }) });
    await until(() => stepText(el) === 'Arrête d’abord le guidage en cours, puis recommence.');
    expect(leftText(el)).toBeNull();
    expect(buttons(el)).toEqual(['Recommencer le test']);
    // le guidage arrêté : « Recommencer le test » le lance
    guidingNow = false;
    button(el, 'Recommencer le test').click();
    await until(() => leftText(el) === '45 s');
    expect(t.cmds).toEqual([{ kind: 'start' }, { kind: 'start' }]);
  });

  it('un guidage qui démarre pendant le test l’arrête : « Test arrêté : un guidage a commencé. » (état guiding, ou arrêt seul avec un guidage)', async () => {
    const STATUS: GuideStatus = { kind: 'trip', title: 'Bureau', arr: at(8, 54), now: 'à pied vers l’arrêt du bus 6', guided: true };
    // les lunettes le disent (error: 'guiding' pendant le test), à chaque étape
    for (const step of ['wait', 'sent', 'ask'] as const) {
      const { t, el } = testScreen();
      await until(() => leftText(el) === '45 s');
      if (step !== 'wait') t.emit({ step, left: step === 'sent' ? 15 : undefined });
      t.emit({ step: 'idle', error: 'guiding' });
      expect(stepText(el), step).toBe('Test arrêté : un guidage a commencé.');
      expect(el.querySelector('.test-step')!.textContent, step).toBe('Test arrêté\u00a0: un guidage a commencé.');
      expect(leftText(el), step).toBeNull();
      expect(buttons(el), step).toEqual(['Recommencer le test']);
      // le test était arrêté par les lunettes : rien à annuler
      expect(t.cmds, step).toEqual([{ kind: 'start' }]);
    }
    // arrêté seul (idle sans résultat) alors qu'un guidage est en cours
    let s = testScreen();
    let guide = s.guide;
    await until(() => leftText(s.el) === '45 s');
    guide.status = STATUS;
    s.t.emit({ step: 'idle' });
    expect(stepText(s.el)).toBe('Test arrêté : un guidage a commencé.');
    // arrêté seul, le guidage annoncé juste après (onGuide)
    s = testScreen();
    guide = s.guide;
    await until(() => leftText(s.el) === '45 s');
    s.t.emit({ step: 'idle' });
    expect(stepText(s.el)).toBe('Test arrêté.');
    guide.emit(STATUS);
    expect(stepText(s.el)).toBe('Test arrêté : un guidage a commencé.');
    // arrêté seul, sans guidage : « Test arrêté. » seulement
    s = testScreen();
    guide = s.guide;
    await until(() => leftText(s.el) === '45 s');
    s.t.emit({ step: 'idle' });
    expect(stepText(s.el)).toBe('Test arrêté.');
    // un guidage lancé bien plus tard n'en est pas la cause
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + GUIDE_CAUSE_MS + 1);
    guide.emit(STATUS);
    later.mockRestore();
    expect(stepText(s.el)).toBe('Test arrêté.');
    // « Arrêter le test » : arrêté par la personne, jamais attribué à un guidage, même juste après un arrêt seul
    s = testScreen();
    guide = s.guide;
    await until(() => leftText(s.el) === '45 s');
    s.t.emit({ step: 'idle' });
    button(s.el, 'Recommencer le test').click();
    await until(() => leftText(s.el) === '45 s');
    button(s.el, 'Arrêter le test').click();
    guide.emit(STATUS);
    expect(stepText(s.el)).toBe('Test arrêté.');
    // quitter l'écran : plus d'abonnement au guidage non plus
    expect(guide.listeners()).toBe(1);
    s.el.querySelector<HTMLButtonElement>('.back')!.click();
    expect(guide.listeners()).toBe(0);
    expect(s.t.listeners()).toBe(0);
  });

  it('arrêté puis relancé aussitôt : la réponse tardive du « cancel » ne remplace pas le nouveau test', async () => {
    const hz = harness({ settings: defaults() });
    let release: (s: DisplayTestState) => void = () => undefined;
    const cmds: DisplayTestCmd[] = [];
    hz.glasses.displayTest = (cmd) => {
      cmds.push(cmd);
      return cmd.kind === 'cancel' ? new Promise<DisplayTestState>((r) => (release = r)) : Promise.resolve({ step: 'wait', left: 45 });
    };
    hz.glasses.onDisplayTest = () => () => undefined;
    openDisplayTest(hz.ctx);
    const el = mount(displayTestScreen(hz.ctx));
    await until(() => leftText(el) === '45 s');
    button(el, 'Arrêter le test').click();
    button(el, 'Recommencer le test').click();
    await until(() => leftText(el) === '45 s');
    release({ step: 'idle' });
    await settle();
    expect(stepText(el)).toMatch(/^Mets tes lunettes/);
    expect(cmds.map((c) => c.kind)).toEqual(['start', 'cancel', 'start']);
  });

  it('la demande du bouton ne sert qu’une fois, et seulement tout de suite', () => {
    const hz = harness({ settings: defaults() });
    const t = withDisplayTest(hz.glasses);
    openDisplayTest(hz.ctx);
    mount(displayTestScreen(hz.ctx));
    mount(displayTestScreen(hz.ctx));
    expect(t.cmds).toEqual([{ kind: 'start' }]);
    // un écran ouvert bien plus tard (le routeur n'y est pas allé tout de suite) ne commence pas seul
    const t0 = Date.now();
    openDisplayTest(hz.ctx);
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0 + START_WINDOW_MS + 1);
    const el = mount(displayTestScreen(hz.ctx));
    now.mockRestore();
    expect(t.cmds.filter((c) => c.kind === 'start')).toHaveLength(1);
    expect(buttons(el)).toEqual(['Commencer le test']);
  });

  it('ouvert sans le bouton (historique, rechargement) : rien ne commence seul, « Commencer le test » le lance', async () => {
    const { t, el } = testScreen({ start: false });
    expect(t.cmds).toEqual([]);
    expect(stepText(el)).toBe('Quai envoie un message aux lunettes et regarde s’il se voit. Le test dure environ une minute.');
    expect(buttons(el)).toEqual(['Commencer le test']);
    // un état qui arrive sans test lancé par l'écran n'est pas montré
    t.emit({ step: 'wait', left: 20 });
    expect(buttons(el)).toEqual(['Commencer le test']);
    button(el, 'Commencer le test').click();
    await until(() => leftText(el) === '45 s');
    expect(t.cmds).toEqual([{ kind: 'start' }]);
  });

  it('quitter l’écran : désabonnement et annulation du test en cours (retour, ancre changée, écran remplacé)', async () => {
    // retour « Réglages »
    let s = testScreen();
    await until(() => leftText(s.el) === '45 s');
    s.el.querySelector<HTMLButtonElement>('.back')!.click();
    await settle();
    expect(s.t.cmds).toEqual([{ kind: 'start' }, { kind: 'cancel' }]);
    expect(s.t.listeners()).toBe(0);
    // ancre changée (navigation du routeur)
    s = testScreen();
    await until(() => leftText(s.el) === '45 s');
    history.replaceState(null, '', '#/reglages');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await settle();
    expect(s.t.cmds).toEqual([{ kind: 'start' }, { kind: 'cancel' }]);
    expect(s.t.listeners()).toBe(0);
    history.replaceState(null, '', '#/');
    // écran remplacé sans changement d'ancre : au plus tard au contrôle suivant, ou au prochain état reçu
    s = testScreen();
    await until(() => leftText(s.el) === '45 s');
    await settle();
    document.body.replaceChildren();
    s.t.emit({ step: 'wait', left: 40 });
    await settle();
    expect(s.t.cmds).toEqual([{ kind: 'start' }, { kind: 'cancel' }]);
    expect(s.t.listeners()).toBe(0);
    s = testScreen();
    await until(() => leftText(s.el) === '45 s');
    await settle();
    document.body.replaceChildren();
    await sleep(TEST_WATCH_MS + 150);
    expect(s.t.cmds).toEqual([{ kind: 'start' }, { kind: 'cancel' }]);
    expect(s.t.listeners()).toBe(0);
    // sans test en cours (pas commencé) : rien à annuler
    s = testScreen({ start: false });
    s.el.querySelector<HTMLButtonElement>('.back')!.click();
    await settle();
    expect(s.t.cmds).toEqual([]);
    expect(s.t.listeners()).toBe(0);
  });

  it('le compte à rebours avance sur le téléphone même si les lunettes n’envoient qu’un état par étape', async () => {
    const { el } = testScreen();
    await until(() => leftText(el) === '45 s');
    await sleep(TICK_MS + 250);
    expect(leftText(el)).toBe('44 s');
  });

  it('lunettes indisponibles (displayTest absent ou en erreur) : « Lunettes indisponibles pour l’instant. »', async () => {
    const none = harness({ settings: defaults() });
    openDisplayTest(none.ctx);
    const el = mount(displayTestScreen(none.ctx));
    expect(stepText(el)).toBe('Lunettes indisponibles pour l’instant.');
    expect(buttons(el)).toEqual([]);
    const { t, el: el2 } = testScreen({ reply: () => new Error('hors ligne') });
    await until(() => stepText(el2) === 'Lunettes indisponibles pour l’instant.');
    expect(buttons(el2)).toEqual(['Recommencer le test']);
    expect(t.cmds).toEqual([{ kind: 'start' }]);
  });

  it('routeur : le bouton de Réglages ouvre #/reglages/test-ecran et le test commence ; l’ancre seule (historique) : rien ne commence ; Quai Web : Réglages', async () => {
    const mountAt = (hash: string, web = false) => {
      history.replaceState(null, '', hash);
      const hz = harness({ settings: defaults(), web });
      const t = withDisplayTest(hz.glasses);
      const root = document.createElement('div');
      document.body.appendChild(root);
      const { go: _go, params: _params, ...deps } = hz.ctx;
      mountPhone({ ...deps, root, news: { visible: () => false, dismiss: () => {}, lines: [] } });
      return { root, t };
    };
    const h1 = (root: HTMLElement) => textOf(root.querySelector('h1'));
    const { root, t } = mountAt('#/reglages');
    await until(() => h1(root) === 'Réglages');
    button(root, 'Tester l’écran des lunettes').click();
    await until(() => h1(root) === 'Tester l’écran des lunettes');
    expect(location.hash).toBe(DISPLAY_TEST_HASH);
    expect(plain(document.title)).toBe('Tester l’écran des lunettes · Quai');
    await until(() => t.cmds.length === 1);
    await settle();
    expect(t.cmds).toEqual([{ kind: 'start' }]);
    // vers Réglages : le test est annulé
    location.hash = '#/reglages';
    await until(() => h1(root) === 'Réglages');
    await until(() => t.cmds.length === 2);
    expect(t.cmds[1]).toEqual({ kind: 'cancel' });
    // revenir sur l'ancre du test (historique) : l'écran, sans test
    location.hash = DISPLAY_TEST_HASH;
    await until(() => h1(root) === 'Tester l’écran des lunettes');
    await settle();
    expect(t.cmds).toHaveLength(2);
    expect(button(root, 'Commencer le test')).toBeTruthy();
    document.body.replaceChildren();
    const web = mountAt(DISPLAY_TEST_HASH, true);
    await until(() => h1(web.root) !== '');
    expect(h1(web.root)).toBe('Réglages');
    expect(web.t.cmds).toEqual([]);
    history.replaceState(null, '', '#/');
  });

  it('textes du test : ceux du PRD, typographie française, jamais de tiret long ni moyen', () => {
    expect(T.testWait).toBe('Mets tes lunettes, regarde devant toi, la tête droite, et ne touche à rien pendant 45\u00a0secondes.');
    expect(T.testSent).toBe('Regarde toujours devant toi. Si les lunettes te demandent quelque chose, fais-le.');
    expect(T.testAsk).toBe('Lève la tête. Que vois-tu dans les lunettes\u00a0?');
    expect(T.testClosed).toBe('Ouvre Quai sur les lunettes, puis recommence.');
    expect(T.testGuiding).toBe('Arrête d’abord le guidage en cours, puis recommence.');
    expect(T.testStoppedGuide).toBe('Test arrêté\u00a0: un guidage a commencé.');
    expect(T.testStop).toBe('Arrêter le test');
    expect(TEST_ANSWERS.map((a) => [a.answer, a.label])).toEqual([
      ['quai', 'Le test de Quai'],
      ['dashboard', 'Le Dashboard'],
      ['nothing', 'Rien'],
    ]);
    expect(plain(TEST_ADVICE.headUp)).toBe('Lève un peu la tête pour voir les messages. Pour le moindre mouvement : dans l’appli Even, règle l’angle d’affichage au plus bas.');
    expect(TEST_ADVICE.none).toMatch(/Head-Up/);
    expect(secondsLeft(45)).toBe('45\u00a0s');
    for (const [k, v] of Object.entries(T).filter(([k]) => /^test/.test(k))) typoOk(v, k);
    for (const [k, v] of [...Object.entries(TEST_ADVICE), ...Object.entries(TEST_LAST)]) typoOk(v, k);
  });
});

/* ------------------------------ § 6.3 : carte « En cours » ------------------------------ */

describe('1.3.0 : la carte « En cours » montre la vérification (PRD-1.3.0 § 6.3)', () => {
  const STATUS: GuideStatus = { kind: 'trip', title: 'Bureau', arr: at(8, 54), now: 'bus 6 vers Gare des Guillemins', guided: true };
  const checks = (el: HTMLElement): string[] => {
    const box = el.querySelector<HTMLElement>('.now-checks')!;
    return box.hidden ? [] : [...box.querySelectorAll('.now-check')].map((p) => textOf(p));
  };

  it('les lignes de checkLines (GuideStatus.check), sous « Maintenant », deux au plus ; aucune : rien ; mises à jour en direct', () => {
    const hz = harness({ settings: defaults() });
    const lines = checkLines([{ kind: 'battery', level: 12 }, { kind: 'noPosition' }]);
    const guide = withGuide(hz.glasses, { ...STATUS, check: lines });
    const el = mount(homeScreen(hz.ctx));
    expect(checks(el)).toEqual(['Lunettes : 12 % de batterie', 'Pas de position : guidage à l’heure']);
    // juste sous « Maintenant », avant « Arrêter le guidage »
    const card = el.querySelector<HTMLElement>('.now-card')!;
    const order = [...card.children].map((c) => c.className.split(' ')[0] || c.tagName.toLowerCase());
    expect(order.indexOf('now-checks')).toBe(order.indexOf('now-now') + 1);
    expect(order.indexOf('now-checks')).toBeLessThan(order.indexOf('btn'));
    // annoncées quand elles changent ; typographie gardée (insécables de checkLines)
    expect(card.querySelector('.now-checks')!.getAttribute('aria-live')).toBe('polite');
    expect(card.querySelector('.now-check')!.textContent).toBe('Lunettes\u00a0: 12\u00a0% de batterie');
    // plus de problème : la ligne disparaît
    guide.emit({ ...STATUS });
    expect(checks(el)).toEqual([]);
    guide.emit({ ...STATUS, check: [] });
    expect(checks(el)).toEqual([]);
    // en route : « Position perdue depuis 3 min »
    guide.emit({ ...STATUS, check: checkLines([{ kind: 'positionLost', minutes: 3 }]) });
    expect(checks(el)).toEqual(['Position perdue depuis 3 min']);
    // trois lignes (moteur plus récent) : deux au plus
    guide.emit({ ...STATUS, check: ['Lunettes : 12 % de batterie', 'Pas de position : guidage à l’heure', 'Position perdue depuis 3 min'] });
    expect(checks(el)).toEqual(['Lunettes : 12 % de batterie', 'Pas de position : guidage à l’heure']);
    expect(checkLinesOf({ check: ['  ', 'A'] })).toEqual(['A']);
    expect(checkLinesOf({})).toEqual([]);
  });

  it('la même ligne ne se redessine pas (pas d’annonce répétée à chaque état du guidage)', () => {
    const hz = harness({ settings: defaults() });
    const guide = withGuide(hz.glasses, { ...STATUS, check: ['Lunettes : 12 % de batterie'] });
    const el = mount(homeScreen(hz.ctx));
    const first = el.querySelector('.now-check');
    guide.emit({ ...STATUS, now: 'à pied vers l’arrêt du bus 6', check: ['Lunettes : 12 % de batterie'] });
    expect(el.querySelector('.now-check')).toBe(first);
  });
});

/* ------------------------------ § 6.4 : Journal des trajets ------------------------------ */

const journalBox = (el: HTMLElement): HTMLElement | undefined => [...el.querySelectorAll<HTMLElement>('section')].find((s) => textOf(s.querySelector('h2')) === 'Journal des trajets');
const journalRows = (el: HTMLElement): [string, string][] => [...el.querySelectorAll<HTMLElement>('.journal-row')].map((r) => [textOf(r.querySelector('.t1')), textOf(r.querySelector('.t2'))]);

describe('1.3.0 : carte « Journal des trajets » de l’écran Données (PRD-1.3.0 § 6.4)', () => {
  const TRIPS: JournalTrip[] = [
    trip('j12', 'Bureau', nov15(8, 2), 23, 'done'),
    trip('j11', 'Vers Gare des Guillemins', nov15(7, 30), 0.5, 'stopped'),
    trip('j10', 'Vers Namur', nov15(6, 50), 65, 'ended'),
    trip('j9', 'Gand-Saint-Pierre', nov15(6, 10), 12, 'replaced'),
    ...Array.from({ length: 8 }, (_, i) => trip(`j${8 - i}`, `Vers Bruxelles-Central ${8 - i}`, nov15(5, 0) - (i + 1) * 86_400_000, 30, 'done')),
  ];

  it('dans Données, après « Mises à jour » : les 10 derniers trajets (titre ; date, durée, fin en clair)', () => {
    const hz = harness({ settings: defaults() });
    const j = fakeJournal(TRIPS);
    hz.ctx.journal = () => j;
    const el = mount(dataScreen(hz.ctx));
    const box = journalBox(el)!;
    expect(box).toBeTruthy();
    const titles = [...el.querySelectorAll('section h2')].map((x) => textOf(x));
    expect(titles.indexOf('Journal des trajets')).toBe(titles.indexOf('Mises à jour') + 1);
    expect(textOf(box.querySelector('p'))).toBe('Tes 10 derniers trajets guidés, gardés sur ce téléphone seulement : des heures et des arrêts, jamais ta position.');
    const rows = journalRows(box);
    expect(rows).toHaveLength(10);
    expect(rows.slice(0, 4)).toEqual([
      ['Bureau', '15/11 à 08:02, 23 min, arrivé'],
      ['Vers Gare des Guillemins', '15/11 à 07:30, moins d’une minute, arrêté'],
      ['Vers Namur', '15/11 à 06:50, 1 h 05, fini'],
      ['Gand-Saint-Pierre', '15/11 à 06:10, 12 min, remplacé'],
    ]);
    expect(rows[4]).toEqual(['Vers Bruxelles-Central 8', '14/11 à 05:00, 30 min, arrivé']);
    // les deux plus anciens (au-delà de 10) ne sont pas montrés
    expect(rows.map((r) => r[0])).not.toContain('Vers Bruxelles-Central 2');
    // aucune heure ni durée sans insécable
    for (const r of box.querySelectorAll('.t2')) typoOk(r.textContent!);
    // Quai Web : gardé dans le navigateur
    const web = harness({ settings: defaults(), web: true });
    web.ctx.journal = () => j;
    expect(textOf(journalBox(mount(dataScreen(web.ctx)))!.querySelector('p'))).toBe('Tes 10 derniers trajets guidés, gardés dans ce navigateur seulement : des heures et des arrêts, jamais ta position.');
  });

  it('fin en clair : « arrivé », « arrêté », « fini », « remplacé » ; pas encore fini : « en cours »', () => {
    expect(JOURNAL_END).toEqual({ done: 'arrivé', stopped: 'arrêté', ended: 'fini', replaced: 'remplacé' });
    expect(plain(journalTripLine({ startedAt: nov15(8, 2) }))).toBe('15/11 à 08:02, en cours');
    expect(plain(journalTripLine({ startedAt: nov15(8, 2), endedAt: nov15(8, 2) + 23 * 60_000, end: 'done' }))).toBe('15/11 à 08:02, 23 min, arrivé');
    // fin connue sans heure de fin : pas de durée inventée
    expect(plain(journalTripLine({ startedAt: nov15(8, 2), end: 'stopped' }))).toBe('15/11 à 08:02, arrêté');
    // heure de Bruxelles (UTC+1 en novembre) : 23:30 le 15
    expect(plain(journalTripLine({ startedAt: Date.UTC(2026, 10, 15, 22, 30), endedAt: Date.UTC(2026, 10, 15, 22, 45), end: 'done' }))).toBe('15/11 à 23:30, 15 min, arrivé');
  });

  it('toucher un trajet : son texte (journal.text) dans un bloc lisible juste dessous, un seul à la fois ; retoucher le referme', () => {
    const hz = harness({ settings: defaults() });
    const j = fakeJournal(TRIPS);
    hz.ctx.journal = () => j;
    const box = journalBox(mount(dataScreen(hz.ctx)))!;
    const rowBtn = (i: number) => box.querySelectorAll<HTMLButtonElement>('.journal-row')[i];
    expect(rowBtn(0).getAttribute('aria-expanded')).toBe('false');
    expect(box.querySelector('.journal-text')).toBeNull();
    rowBtn(0).click();
    expect(j.texts).toEqual(['j12']);
    const pre = box.querySelector<HTMLElement>('.journal-text')!;
    // une ligne du journal par ligne, la première en tête
    expect([...pre.querySelectorAll('.jl')].map((l) => l.textContent)).toEqual(['Journal Quai 1.3.0, trajet « Bureau », 15/11/2026', '08:02:10 Partir maintenant affiché', '08:09:40 Monter dans le bus 6 affiché']);
    expect(pre.querySelector('.jl')!.classList.contains('jl-head')).toBe(true);
    expect(pre.getAttribute('aria-label')).toBe('Journal du trajet «\u00a0Bureau\u00a0»');
    expect(rowBtn(0).getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(rowBtn(0).getAttribute('aria-controls')!)!.contains(pre)).toBe(true);
    // juste sous sa ligne
    expect(rowBtn(0).closest('li')!.contains(pre)).toBe(true);
    expect(button(box, 'Copier')).toBeTruthy();
    // un autre : le premier se referme
    rowBtn(2).click();
    expect(box.querySelectorAll('.journal-text')).toHaveLength(1);
    expect(rowBtn(0).getAttribute('aria-expanded')).toBe('false');
    expect(rowBtn(0).hasAttribute('aria-controls')).toBe(false);
    expect(rowBtn(2).closest('li')!.querySelector('.journal-text')!.textContent).toMatch(/^Journal Quai 1\.3\.0, trajet « Vers Namur »/);
    // retoucher : refermé
    rowBtn(2).click();
    expect(box.querySelector('.journal-text')).toBeNull();
    expect(rowBtn(2).getAttribute('aria-expanded')).toBe('false');
  });

  it('« Copier » : le presse-papiers, puis « Copié. » ; repli sans l’API ; sinon le texte est sélectionné', async () => {
    const hz = harness({ settings: defaults() });
    const j = fakeJournal(TRIPS);
    hz.ctx.journal = () => j;
    const box = journalBox(mount(dataScreen(hz.ctx)))!;
    box.querySelector<HTMLButtonElement>('.journal-row')!.click();
    const text = j.text('j12');
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (s: string) => void copied.push(s) } });
    button(box, 'Copier').click();
    await until(() => textOf(box.querySelector('.journal-open .msg')) !== '');
    expect(copied).toEqual([text]);
    expect(textOf(box.querySelector('.journal-open .msg'))).toBe('Copié.');
    // sans l'API du presse-papiers : la copie d'un champ caché (execCommand)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    box.querySelector('.journal-open .msg')!.textContent = '';
    button(box, 'Copier').click();
    await until(() => textOf(box.querySelector('.journal-open .msg')) !== '');
    expect(exec).toHaveBeenCalledWith('copy');
    expect(textOf(box.querySelector('.journal-open .msg'))).toBe('Copié.');
    // le champ caché a disparu
    expect(document.querySelector('textarea')).toBeNull();
    // l'API refuse et la copie échoue : le texte est sélectionné, à copier avec le menu du téléphone
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => Promise.reject(new Error('refusé')) } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
    box.querySelector('.journal-open .msg')!.textContent = '';
    button(box, 'Copier').click();
    await until(() => textOf(box.querySelector('.journal-open .msg')) !== '');
    expect(textOf(box.querySelector('.journal-open .msg'))).toBe('Copie impossible : le texte est sélectionné, copie-le avec le menu du téléphone.');
    expect(box.querySelector('.journal-open .msg')!.classList.contains('err')).toBe(true);
    const selected = window.getSelection()?.toString() ?? '';
    for (const line of text.split('\n')) expect(selected).toContain(line);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });

  it('« Effacer le journal » demande confirmation ; « Annuler » ne touche à rien ; effacé : « Aucun trajet guidé pour l’instant. »', async () => {
    const hz = harness({ settings: defaults() });
    const j = fakeJournal(TRIPS);
    hz.ctx.journal = () => j;
    const box = journalBox(mount(dataScreen(hz.ctx)))!;
    button(box, 'Effacer le journal').click();
    expect(textOf(box.querySelector('.confirm-q'))).toBe('Effacer le journal des trajets ?');
    button(box, 'Annuler').click();
    expect(j.cleared).toBe(0);
    expect(journalRows(box)).toHaveLength(10);
    button(box, 'Effacer le journal').click();
    button(box, 'Effacer').click();
    await settle();
    expect(j.cleared).toBe(1);
    expect(journalRows(box)).toEqual([]);
    expect(textOf(box.querySelector('.journal-empty'))).toBe('Aucun trajet guidé pour l’instant.');
    expect(box.querySelector<HTMLElement>('.journal-empty')!.hidden).toBe(false);
    expect(textOf(box.querySelector('p.msg[role="status"]'))).toBe('Journal effacé.');
    // plus rien à effacer
    expect(() => button(box, 'Effacer le journal')).toThrow();
    expect(document.activeElement).toBe(box.querySelector('.journal-empty'));
  });

  it('journal vide : « Aucun trajet guidé pour l’instant. », sans bouton ; sans journal (absent ou pas prêt) : pas de carte', () => {
    const hz = harness({ settings: defaults() });
    hz.ctx.journal = () => fakeJournal([]);
    const box = journalBox(mount(dataScreen(hz.ctx)))!;
    expect(textOf(box.querySelector('.journal-empty'))).toBe('Aucun trajet guidé pour l’instant.');
    expect(box.querySelector<HTMLElement>('.journal-list')!.hidden).toBe(true);
    expect(box.querySelectorAll('button')).toHaveLength(0);
    // ctx.journal absent : la carte ne paraît pas
    const none = harness({ settings: defaults() });
    expect('journal' in none.ctx).toBe(false);
    expect(journalBox(mount(dataScreen(none.ctx)))).toBeUndefined();
    expect(journalCard(none.ctx)).toBeNull();
    // pas encore prêt (null) ou en erreur : pas de carte
    none.ctx.journal = () => null;
    expect(journalCard(none.ctx)).toBeNull();
    none.ctx.journal = () => {
      throw new Error('stockage');
    };
    expect(journalCard(none.ctx)).toBeNull();
  });

  it('textes du journal : typographie française, jamais de tiret long ni moyen', () => {
    for (const [k, v] of Object.entries(T).filter(([k]) => /^journal/.test(k))) typoOk(v, k);
    for (const v of Object.values(JOURNAL_END)) typoOk(v);
  });
});

/* ------------------------------ § 9 : bannière « Nouveau » ------------------------------ */

describe('1.3.0 : bannière « Nouveau dans Quai 1.3.0 » du téléphone (PRD-1.3.0 § 9)', () => {
  it('NEWS_SINCE 1.3.0 : une fois depuis la 1.2.10 ou avant, jamais après une installation neuve ni depuis la 1.3.0', () => {
    expect(NEWS_SINCE).toBe('1.3.0');
    expect(newsTitle(NEWS_SINCE)).toBe('Nouveau dans Quai 1.3.0');
    for (const seen of ['1.1.0', '1.2.0', '1.2.5', '1.2.9', '1.2.10']) expect(newsState(seen, NEWS_SINCE, '1.3.0').visible(), seen).toBe(true);
    for (const seen of ['', '1.3.0', '1.3.1']) expect(newsState(seen, NEWS_SINCE, '1.3.0').visible(), seen || 'installation neuve').toBe(false);
    // une appli encore en 1.2.10 n'annonce pas les nouveautés de la 1.3.0
    expect(newsState('1.2.9', NEWS_SINCE, '1.2.10').visible()).toBe(false);
    const hz = harness({ settings: defaults() });
    hz.ctx.news = newsState('1.2.10', NEWS_SINCE, '1.3.0');
    const el = mount(homeScreen(hz.ctx));
    expect(textOf(el.querySelector('.news-title'))).toBe('Nouveau dans Quai 1.3.0');
    expect([...el.querySelectorAll('.news-lines p')].map((p) => textOf(p))).toEqual(NEWS_130.map(plain));
  });

  it('les idées du message des lunettes (« ▶ Y aller » et ▲, favoris en accordéon, test de l’écran et rappel), puis le journal', () => {
    expect(NEWS_130).toHaveLength(4);
    expect(NEWS_130[0]).toMatch(/« ▶ Y aller »/);
    expect(NEWS_130[0]).toMatch(/« Autres trajets », ▲ sur la première ligne ramène au trajet proposé/);
    expect(NEWS_130[1]).toMatch(/^Favoris des lunettes : le détail du favori choisi s’ouvre juste dessous/);
    expect(NEWS_130[2]).toMatch(/message important que tu n’as pas vu revient/);
    expect(NEWS_130[2]).toMatch(/« Tester l’écran des lunettes »/);
    expect(NEWS_130[3]).toMatch(/^Dans Réglages, puis Données : le journal/);
  });

  it('Quai Web : ni test de l’écran (pas de lunettes) ni rappel des messages (décision), « l’onglet Réglages » là où le téléphone dit « Réglages »', () => {
    const web = newsState('1.2.10', NEWS_SINCE, '1.3.0', true).lines;
    expect(web).toEqual([...NEWS_130_WEB]);
    expect(web).toHaveLength(3);
    expect(web[0]).toBe(NEWS_130[0]);
    expect(web[1]).toBe(NEWS_130[1]);
    expect(web.some((l) => /Tester l’écran|téléphone/.test(l))).toBe(false);
    expect(web.some((l) => /message important|revient, deux fois/.test(l))).toBe(false);
    expect(web[2]).toMatch(/^Dans l’onglet Réglages, bouton « Réglages », puis Données : le journal/);
    expect(newsState('1.2.10', NEWS_SINCE, '1.3.0').lines).toEqual([...NEWS_130]);
  });

  it('depuis la 1.2.9 ou avant : les nouveautés sautées suivent, sans le détail des favoris « en bas de l’écran » (plus vrai)', () => {
    const gone = NEWS_1210[2];
    expect(gone).toMatch(/en bas de l’écran/);
    expect(newsState('1.2.9', NEWS_SINCE, '1.3.0').lines).toEqual([...NEWS_130, ...NEWS_1210.filter((l) => l !== gone)]);
    expect(newsState('1.2.8', NEWS_SINCE, '1.3.0').lines).toEqual([...NEWS_130, ...NEWS_1210.filter((l) => l !== gone), ...NEWS_129]);
    expect(newsState('1.2.9', NEWS_SINCE, '1.3.0', true).lines).toEqual([...NEWS_130_WEB, ...NEWS_1210_WEB.filter((l) => l !== gone)]);
    expect(newsState('1.2.8', NEWS_SINCE, '1.3.0', true).lines).toEqual([...NEWS_130_WEB, ...NEWS_1210_WEB.filter((l) => l !== gone), ...NEWS_129_WEB]);
    for (const seen of ['1.2.9', '1.2.0', '1.1.0']) expect(newsState(seen, NEWS_SINCE, '1.3.0').lines.some((l) => /en bas de l’écran/.test(l)), seen).toBe(false);
  });

  it('typographie des nouveautés : insécables (dans le texte affiché), jamais de tiret long ni moyen, ni « vous »', () => {
    const hz = harness({ settings: defaults() });
    hz.ctx.news = newsState('1.2.10', NEWS_SINCE, '1.3.0');
    const el = mount(homeScreen(hz.ctx));
    for (const p of el.querySelectorAll('.news-lines p')) typoOk(p.textContent!);
    for (const l of [...NEWS_130, ...NEWS_130_WEB]) expect(l).not.toMatch(/[\u2013\u2014]|vous\b/);
  });
});

/* ------------------------------ Réglages : display.alert, display.headUp ------------------------------ */

const withDisplay = (display: Record<string, unknown>): Record<string, unknown> => ({ ...structuredClone(DEFAULT_SETTINGS), onboarded: true, display: { ...DEFAULT_SETTINGS.display, ...display } });

describe('1.3.0 : réglages du test de l’écran (display.alert, display.headUp)', () => {
  it('absents par défaut : les réglages par défaut restent DEFAULT_SETTINGS', () => {
    const s = validateSettings({});
    expect('alert' in s.display).toBe(false);
    expect('headUp' in s.display).toBe(false);
    expect(validateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect('alert' in DEFAULT_SETTINGS.display || 'headUp' in DEFAULT_SETTINGS.display).toBe(false);
  });

  it('valides : gardés tels quels, et une deuxième lecture ne change rien', () => {
    for (const alert of ['visible', 'headUp', 'dashboard'] as const) {
      for (const headUp of [
        { axis: 'x', sign: 1, delta: 0.42 },
        { axis: 'y', sign: -1, delta: 12 },
        { axis: 'z', sign: 1, delta: 1e-3 },
      ] as const) {
        const s = validateSettings(withDisplay({ alert, headUp }));
        expect(s.display.alert).toBe(alert);
        expect(s.display.headUp).toEqual(headUp);
        expect(validateSettings(s)).toEqual(s);
      }
    }
    // l'un sans l'autre (« Rien » : pas de résultat, mais le mouvement appris)
    expect(validateSettings(withDisplay({ headUp: { axis: 'y', sign: 1, delta: 2 } })).display).toEqual({ ...DEFAULT_SETTINGS.display, headUp: { axis: 'y', sign: 1, delta: 2 } });
    expect(validateSettings(withDisplay({ alert: 'dashboard' })).display).toEqual({ ...DEFAULT_SETTINGS.display, alert: 'dashboard' });
  });

  it('invalides : retirés (alert hors de visible, headUp, dashboard ; axe hors de x, y, z ; sens autre que 1 ou -1 ; écart non fini ou pas positif)', () => {
    for (const alert of ['oui', 'Visible', 'headup', '', 1, true, null, {}, []]) {
      const s = validateSettings(withDisplay({ alert }));
      expect('alert' in s.display, JSON.stringify(alert)).toBe(false);
    }
    const bad = [
      null,
      'x',
      [],
      { axis: 'w', sign: 1, delta: 1 },
      { axis: 'X', sign: 1, delta: 1 },
      { sign: 1, delta: 1 },
      { axis: 'x', sign: 2, delta: 1 },
      { axis: 'x', sign: 0, delta: 1 },
      { axis: 'x', sign: '1', delta: 1 },
      { axis: 'x', delta: 1 },
      { axis: 'x', sign: -1, delta: 0 },
      { axis: 'x', sign: -1, delta: -0.5 },
      { axis: 'x', sign: 1, delta: Number.NaN },
      { axis: 'x', sign: 1, delta: Number.POSITIVE_INFINITY },
      { axis: 'x', sign: 1, delta: '3' },
      { axis: 'x', sign: 1 },
    ];
    for (const headUp of bad) {
      const s = validateSettings(withDisplay({ headUp }));
      expect('headUp' in s.display, JSON.stringify(headUp) ?? String(headUp)).toBe(false);
    }
    // une mesure brute en trop n'est pas gardée : seulement l'axe, le sens et l'écart
    const extra = validateSettings(withDisplay({ headUp: { axis: 'z', sign: -1, delta: 3, rest: [0.1, 9.8, 0.2], at: 1 } }));
    expect(extra.display.headUp).toEqual({ axis: 'z', sign: -1, delta: 3 });
    // les autres réglages d'Affichage ne bougent pas
    expect(validateSettings(withDisplay({ alert: 'oui', headUp: null, radiusM: 800 })).display).toEqual({ ...DEFAULT_SETTINGS.display, radiusM: 800 });
  });

  it('enregistrés puis relus (KV) ; SettingsStore les garde (les lunettes les écrivent à la fin du test)', async () => {
    const backend = memoryBackend();
    const kv = createKV(backend);
    const s = validateSettings(withDisplay({ alert: 'headUp', headUp: { axis: 'y', sign: -1, delta: 0.8 } }));
    await saveSettings(kv, s);
    const saved = JSON.parse(backend.data.get(SETTINGS_KEY)!);
    expect([saved.display.alert, saved.display.headUp]).toEqual(['headUp', { axis: 'y', sign: -1, delta: 0.8 }]);
    expect(await loadSettings(kv)).toEqual(s);
    const store = new SettingsStore(kv, validateSettings({}));
    await store.update((x) => ({ ...x, display: { ...x.display, alert: 'visible', headUp: { axis: 'x', sign: 1, delta: 1.5 } } }));
    expect(store.get().display.alert).toBe('visible');
    expect(store.get().display.headUp).toEqual({ axis: 'x', sign: 1, delta: 1.5 });
    expect(JSON.parse(backend.data.get(SETTINGS_KEY)!).display.alert).toBe('visible');
  });

  it('anciens réglages (1.2.10, v4) : chargés sans perte, sans alert ni headUp ; une version antérieure migrée aussi', () => {
    // réglages tels que la 1.2.10 les écrit : favoris, gares, lignes suivies, guidage éteint, version vue 1.2.10
    const v1210: Settings = {
      ...preset11(),
      onboarded: true,
      stations: [{ id: 'g-namur', areaId: 'sncb:8863008', name: { fr: 'Namur', nl: 'Namen' }, lat: 50.4685, lon: 4.8625 }],
      follows: [{ id: 'f-t3', op: 'stib', line: '3', routes: ['stib:3'], mode: 'tram' }],
      seenVersion: '1.2.10',
      display: { ...DEFAULT_SETTINGS.display, radiusM: 800, guide: false },
    };
    const raw = JSON.stringify(v1210);
    const back = parseSettings(raw);
    expect(back).toEqual(JSON.parse(raw));
    expect('alert' in back.display || 'headUp' in back.display).toBe(false);
    // une deuxième écriture et lecture : identiques
    expect(parseSettings(JSON.stringify(back))).toEqual(back);
    // une version antérieure (v3, 1.2.1) : migrée, et toujours sans alert ni headUp
    const v3 = migrateSettings({ ...JSON.parse(raw), v: 3 });
    expect(v3.display.guide).toBe(false);
    expect('alert' in v3.display || 'headUp' in v3.display).toBe(false);
  });
});
