/**
 * 1.3.0 (PRD-1.3.0 § 6.1) : test de l'écran des lunettes (#/reglages/test-ecran), ouvert par « Tester l’écran des
 * lunettes » dans Réglages, groupe « Pendant un trajet » (pas dans Quai Web : pas de vraies lunettes). Le téléphone mène
 * le test (GlassesApi.displayTest) et suit son état (onDisplayTest) :
 * - wait : « Mets tes lunettes, regarde devant toi, la tête droite, et ne touche à rien pendant 45 secondes », compte à
 *   rebours ;
 * - sent : « Touche une fois les lunettes », compte à rebours ;
 * - ask : « Lève la tête. Que vois-tu dans les lunettes ? », trois réponses (« Le test de Quai », « Le Dashboard »,
 *   « Rien ») ;
 * - done : le conseil du PRD selon le résultat (aucun résultat : vérifier « Head-Up » dans l'appli Even) ;
 * - Quai fermé sur les lunettes : « Ouvre Quai sur les lunettes, puis recommence. »
 * « Arrêter le test » pendant le test. Le test ne commence que par le bouton de Réglages (openDisplayTest) ou par
 * « Commencer le test » : revenir sur l'écran par l'historique, ou le recharger, ne le relance pas. Quitter l'écran
 * arrête le test en cours et le suivi de son état. Retour à Réglages.
 */
import type { DisplayTestCmd, DisplayTestState, GlassesApi } from '../../core/api';
import { header, parseHash, type PhoneCtx } from '../app';
import { h } from '../dom';
import { secondsLeft, T, TEST_ADVICE, TEST_ANSWERS, typo } from '../text';

/** Ancre de l'écran du test. */
export const DISPLAY_TEST_HASH = '#/reglages/test-ecran';
/** Délai dans lequel l'écran du test doit s'ouvrir après le bouton de Réglages pour commencer tout seul. */
export const START_WINDOW_MS = 10_000;
/** Contrôle que l'écran est encore affiché (repli quand il est remplacé sans changement d'ancre). */
export const TEST_WATCH_MS = 1000;
/**
 * Compte à rebours sur le téléphone entre deux états : une seconde de moins toutes les secondes, la première un peu
 * plus tard (TICK_MS + 100) pour qu'un état envoyé chaque seconde par les lunettes passe toujours avant.
 */
export const TICK_MS = 1000;

/** Écran qui a lancé le test en cours : lui seul l'arrête en partant (un écran plus récent l'a peut-être relancé). */
let testOwner = 0;
let screens = 0;
/** Heure de la demande du bouton de Réglages (0 : aucune) ; l'écran du test qui s'ouvre ensuite la prend. */
let startAsked = 0;

const isRoute = (hash: string): boolean => {
  const { name, sub } = parseHash(hash);
  return name === 'reglages' && sub[0] === 'test-ecran';
};

/**
 * Réglages, « Tester l’écran des lunettes » : ouvre l'écran du test, qui commence aussitôt. La demande n'est pas dans
 * l'ancre : l'historique ou un rechargement rouvrent l'écran sans relancer le test.
 */
export function openDisplayTest(ctx: PhoneCtx): void {
  startAsked = Date.now();
  ctx.go(DISPLAY_TEST_HASH);
}

/** La demande du bouton, une seule fois, si elle est récente. */
function takeStart(): boolean {
  const asked = startAsked;
  startAsked = 0;
  return asked > 0 && Date.now() - asked < START_WINDOW_MS;
}

export function displayTestScreen(ctx: PhoneCtx): HTMLElement {
  const me = ++screens;
  let g: GlassesApi | null = null;
  try {
    g = ctx.glasses();
  } catch {
    g = null;
  }
  const can = typeof g?.displayTest === 'function';
  const startNow = takeStart();

  const step = h('p', { class: 'test-step', role: 'status', tabindex: '-1' });
  const left = h('p', { class: 'test-left', role: 'timer', hidden: true });
  const actions = h('div', { class: 'test-actions' });
  const el = h(
    'div',
    { class: 'screen display-test' },
    header(ctx, T.testScreen, T.testLead, { label: T.settings, hash: '#/reglages' }),
    h('section', { class: 'box test-box', 'aria-label': T.testScreen }, step, left, actions),
  );

  /** Vue montrée (« wait », « done-visible »…) : elle n'est redessinée que si elle change. */
  let shown = '';
  /** Un test lancé par cet écran est en cours (ses états sont suivis). */
  let active = false;
  /** États reçus des lunettes : un état rendu par une commande plus ancienne n'efface pas un état plus récent. */
  let received = 0;
  /** Tour du test : chaque début ou arrêt en ouvre un ; la réponse d'un ordre d'un tour passé est oubliée. */
  let round = 0;
  let gone = false;
  let tick: ReturnType<typeof setTimeout> | undefined;

  const show = (key: string, text: string, buttons: HTMLElement[]): void => {
    if (key === shown) return;
    shown = key;
    const lost = actions.contains(document.activeElement);
    step.textContent = typo(text);
    actions.replaceChildren(...buttons);
    // le bouton touché a disparu : le curseur passe au premier bouton de l'étape, sinon à la consigne
    if (lost) (actions.querySelector<HTMLElement>('button:not([disabled])') ?? step).focus();
  };

  const countdown = (n: number | undefined): void => {
    clearTimeout(tick);
    if (n === undefined || !Number.isFinite(n)) {
      left.hidden = true;
      left.textContent = '';
      return;
    }
    let v = Math.max(0, Math.round(n));
    left.hidden = false;
    left.textContent = secondsLeft(v);
    const next = (ms: number): void => {
      tick = setTimeout(() => {
        if (gone || v <= 0) return;
        v -= 1;
        left.textContent = secondsLeft(v);
        next(TICK_MS);
      }, ms);
    };
    next(TICK_MS + 100);
  };

  const button = (label: string, cls: string, onClick: (b: HTMLButtonElement) => void): HTMLButtonElement => {
    const b = h('button', { type: 'button', class: `btn ${cls} btn-block` }, label);
    b.addEventListener('click', () => onClick(b));
    return b;
  };

  const showOff = (): void => {
    active = false;
    countdown(undefined);
    show('off', T.glassesOff, can ? [button(T.testRestart, 'btn-secondary', () => begin())] : []);
  };

  /** Envoie un ordre ; l'état rendu est montré (sauf pour « cancel » : « Test arrêté. » est déjà là). */
  const send = async (cmd: DisplayTestCmd): Promise<void> => {
    if (!can || !g?.displayTest) return showOff();
    const at = received;
    const mine = round;
    const current = (): boolean => !gone && cmd.kind !== 'cancel' && round === mine;
    try {
      const s = await g.displayTest(cmd);
      if (current() && received === at && s) paint(s);
    } catch {
      if (current()) showOff();
    }
  };

  const begin = (): void => {
    if (!can) return showOff();
    round += 1;
    active = true;
    testOwner = me;
    countdown(undefined);
    show('starting', T.testIntro, []);
    void send({ kind: 'start' });
  };

  const stop = (b: HTMLButtonElement): void => {
    b.disabled = true;
    round += 1;
    active = false;
    countdown(undefined);
    show('stopped', T.testStopped, [button(T.testRestart, 'btn-secondary', () => begin())]);
    void send({ kind: 'cancel' });
  };

  const answers = (): HTMLElement => {
    const group = h('div', { class: 'test-answers', role: 'group', 'aria-label': T.testAnswersLabel });
    const all = TEST_ANSWERS.map(({ answer, label }) =>
      button(label, 'btn-secondary', () => {
        for (const x of all) x.disabled = true;
        void send({ kind: 'answer', answer });
      }),
    );
    group.append(...all);
    return group;
  };

  const paint = (s: DisplayTestState): void => {
    if (gone || !active) return;
    if (s.error === 'closed') {
      active = false;
      countdown(undefined);
      return show('closed', T.testClosed, [button(T.testRestart, 'btn-secondary', () => begin())]);
    }
    switch (s.step) {
      case 'wait':
        countdown(s.left);
        return show('wait', T.testWait, [button(T.testStop, 'btn-secondary test-stop', stop)]);
      case 'sent':
        countdown(s.left);
        return show('sent', T.testSent, [button(T.testStop, 'btn-secondary test-stop', stop)]);
      case 'ask':
        countdown(undefined);
        return show('ask', T.testAsk, [answers(), button(T.testStop, 'btn-secondary test-stop', stop)]);
      case 'done': {
        active = false;
        countdown(undefined);
        const r = s.result ?? 'none';
        return show(`done-${r}`, TEST_ADVICE[r], [
          button(T.done, 'btn-primary', () => {
            leave();
            ctx.go('#/reglages');
          }),
          button(T.testRestart, 'btn-secondary', () => begin()),
        ]);
      }
      default:
        // plus de test en cours (arrêté ailleurs, lunettes) : on le dit
        active = false;
        countdown(undefined);
        return show('stopped', T.testStopped, [button(T.testRestart, 'btn-secondary', () => begin())]);
    }
  };

  /* Cycle de vie : quitter l'écran arrête le suivi et le test en cours. */
  let seen = false;
  const onHash = (): void => {
    if (!isRoute(location.hash)) leave();
  };
  const leave = (): void => {
    if (gone) return;
    gone = true;
    clearTimeout(tick);
    clearInterval(watch);
    window.removeEventListener('hashchange', onHash);
    try {
      off?.();
    } catch {
      /* au mieux */
    }
    if (active && testOwner === me && g?.displayTest) {
      active = false;
      g.displayTest({ kind: 'cancel' }).catch(() => undefined);
    }
  };
  const alive = (): boolean => {
    if (el.isConnected) seen = true;
    else if (seen) leave();
    return !gone;
  };
  const watch = setInterval(alive, TEST_WATCH_MS);
  // jamais posé dans la page (le routeur est passé à un autre écran) : rien à suivre
  setTimeout(() => {
    if (el.isConnected) seen = true;
    else if (!seen) leave();
  }, 0);
  window.addEventListener('hashchange', onHash);
  el.querySelector('.back')?.addEventListener('click', leave);

  let off: (() => void) | undefined;
  try {
    off = can
      ? g?.onDisplayTest?.((s) => {
          if (!alive()) return;
          received += 1;
          paint(s);
        })
      : undefined;
  } catch {
    off = undefined;
  }

  if (!can) showOff();
  else if (startNow) begin();
  else show('intro', T.testIntro, [button(T.testStart, 'btn-primary', () => begin())]);
  return el;
}
