/**
 * Quai Web : gestes des lunettes sans lunettes. Sur l'écran : glisser vers le haut ou le bas, toucher,
 * double toucher (et la molette sur un ordinateur) ; au clavier : ↑ ↓, Entrée = toucher,
 * Échap ou Retour arrière = double toucher ; boutons sous l'écran.
 */
import type { Gesture } from '../glasses/nav';

export const SWIPE_MIN_PX = 28;
export const TAP_MAX_MOVE_PX = 12;
export const TAP_MAX_MS = 650;
/** Délai pendant lequel un second toucher fait un double toucher. */
export const DOUBLE_TAP_MS = 300;
/** Molette ou pavé tactile : distance cumulée pour un pas, et intervalle minimal entre deux pas. */
export const WHEEL_STEP = 40;
export const WHEEL_GAP_MS = 140;

/** Appui sur l'écran → geste : glisser vertical, toucher, ou rien (glisser horizontal, appui long). */
export function classifyPress(dx: number, dy: number, ms: number): 'up' | 'down' | 'tap' | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay >= SWIPE_MIN_PX && ay > ax * 1.2) return dy < 0 ? 'up' : 'down';
  if (ax <= TAP_MAX_MOVE_PX && ay <= TAP_MAX_MOVE_PX && ms <= TAP_MAX_MS) return 'tap';
  return null;
}

interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };

/** Toucher simple ou double sur l'écran : le toucher attend DOUBLE_TAP_MS ; un second toucher dans ce délai fait un double toucher. */
export class TapSequencer {
  private pending: unknown = undefined;

  constructor(
    private readonly emit: (g: 'tap' | 'double') => void,
    private readonly delayMs = DOUBLE_TAP_MS,
    private readonly timers: Timers = realTimers,
  ) {}

  press(): void {
    if (this.pending !== undefined) {
      this.timers.clear(this.pending);
      this.pending = undefined;
      this.emit('double');
      return;
    }
    this.pending = this.timers.set(() => {
      this.pending = undefined;
      this.emit('tap');
    }, this.delayMs);
  }

  cancel(): void {
    if (this.pending !== undefined) this.timers.clear(this.pending);
    this.pending = undefined;
  }
}

/** Touche du clavier → geste. */
export function keyToGesture(key: string): Gesture | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'Enter':
      return 'tap';
    case 'Escape':
    case 'Backspace':
      return 'double';
    default:
      return null;
  }
}

interface ElementLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?(name: string): string | null;
  closest?(sel: string): unknown;
}

const NATIVE_TAGS = /^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY|OPTION|LABEL)$/;
const NATIVE_ROLES = /^(button|option|combobox|switch|tab|link|menuitem|radio|checkbox|textbox|listbox|searchbox|slider|spinbutton)$/;

/**
 * Vrai si la touche revient à l'élément qui a le focus (champ, bouton, lien des réglages…), faux si c'est un geste.
 * Les boutons de gestes gardent Entrée et Espace (ils s'activent), mais pas les flèches ni Échap.
 */
export function keyBelongsToFocus(el: ElementLike | null | undefined, key: string): boolean {
  if (!el || !el.tagName) return false;
  if (el.closest?.('[data-g]')) return key === 'Enter' || key === ' ';
  if (el.isContentEditable) return true;
  if (NATIVE_TAGS.test(el.tagName.toUpperCase())) return true;
  const role = el.getAttribute?.('role');
  return !!role && NATIVE_ROLES.test(role);
}

/** Gestes sur l'écran : glisser, toucher, double toucher, molette. Renvoie la fonction qui les retire. */
export function attachScreenGestures(el: HTMLElement, emit: (g: Gesture) => void): () => void {
  const taps = new TapSequencer((g) => emit(g));
  let start: { x: number; y: number; t: number; id: number } | null = null;
  let wheel = 0;
  let lastWheel = -Infinity;
  const down = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* pointeur déjà relâché */
    }
  };
  const up = (e: PointerEvent): void => {
    if (!start || e.pointerId !== start.id) return;
    const g = classifyPress(e.clientX - start.x, e.clientY - start.y, e.timeStamp - start.t);
    start = null;
    if (g === 'tap') taps.press();
    else if (g) {
      taps.cancel();
      emit(g);
    }
  };
  const cancel = (): void => {
    start = null;
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    wheel += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (Math.abs(wheel) < WHEEL_STEP || e.timeStamp - lastWheel < WHEEL_GAP_MS) return;
    lastWheel = e.timeStamp;
    emit(wheel > 0 ? 'down' : 'up');
    wheel = 0;
  };
  const noMenu = (e: Event): void => e.preventDefault();
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('contextmenu', noMenu);
  return () => {
    taps.cancel();
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('contextmenu', noMenu);
  };
}

/** Clavier : gestes quand `active()` est vrai et que la touche n'appartient pas à l'élément qui a le focus. */
export function attachKeyboard(target: Window, emit: (g: Gesture) => void, active: () => boolean): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    const g = keyToGesture(e.key);
    if (!g || !active()) return;
    if (keyBelongsToFocus(e.target as ElementLike | null, e.key)) return;
    e.preventDefault();
    emit(g);
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
