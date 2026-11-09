/**
 * Machine d'états de la navigation des lunettes (pure).
 * Gestes : glisser haut/bas = se déplacer ; toucher = ouvrir/agir ; double toucher = retour,
 * et depuis l'écran racine = quitter (boîte de confirmation système, shutDownPageContainer(1)).
 */
import { ensureVisible } from './layout';
import type { GlassesView, Intent, Item, Route } from './types';
import { selectable, tapIntent } from './views';

export type Gesture = 'up' | 'down' | 'tap' | 'double';

export interface NavFrame {
  route: Route;
  sel: number;
  top: number;
  /** Vrai tant que la sélection n'a pas été touchée (la vue peut proposer sa sélection initiale). */
  fresh?: boolean;
}

export interface NavState {
  stack: NavFrame[];
}

export type NavEffect =
  | { kind: 'none' }
  | { kind: 'render' }
  | { kind: 'exit' }
  | { kind: 'back' }
  | { kind: 'intent'; intent: Intent };

export function initNav(route: Route): NavState {
  return { stack: [{ route, sel: 0, top: 0, fresh: true }] };
}

export function current(s: NavState): NavFrame {
  return s.stack[s.stack.length - 1];
}

export function push(s: NavState, route: Route): NavState {
  return { stack: [...s.stack, { route, sel: 0, top: 0, fresh: true }] };
}

/** Remplace l'écran courant (même profondeur). */
export function replace(s: NavState, route: Route): NavState {
  return { stack: [...s.stack.slice(0, -1), { route, sel: 0, top: 0, fresh: true }] };
}

/** Repart d'une pile donnée (ex. accueil puis écran ouvert depuis le téléphone). */
export function reset(routes: Route[]): NavState {
  return { stack: routes.map((route) => ({ route, sel: 0, top: 0, fresh: true })) };
}

export function pop(s: NavState): NavState {
  return s.stack.length > 1 ? { stack: s.stack.slice(0, -1) } : s;
}

/** Met à jour la sélection de l'écran courant. */
export function setSelection(s: NavState, sel: number, top: number): NavState {
  const f = current(s);
  if (f.sel === sel && f.top === top && !f.fresh) return s;
  return { stack: [...s.stack.slice(0, -1), { ...f, sel, top, fresh: false }] };
}

/** Remplace la route courante sans toucher à la sélection (ex. trajet rafraîchi). */
export function updateRoute(s: NavState, route: Route): NavState {
  const f = current(s);
  return { stack: [...s.stack.slice(0, -1), { ...f, route }] };
}

/**
 * Sélection effective d'une vue : la sélection initiale proposée par la vue tant que
 * l'utilisateur n'a pas bougé, sinon celle de la pile, bornée au nombre d'éléments.
 */
export function effectiveFrame(f: NavFrame, v: Pick<GlassesView, 'items' | 'initialSel' | 'initialTop'>, capacity: number): { sel: number; top: number } {
  const n = v.items.length;
  let sel = f.fresh && v.initialSel !== undefined ? v.initialSel : f.sel;
  let top = f.fresh && v.initialTop !== undefined ? v.initialTop : f.top;
  sel = n ? Math.min(Math.max(0, sel), n - 1) : 0;
  top = ensureVisible(v.items as Item[], sel, top, capacity);
  return { sel, top };
}

/**
 * Applique un geste. `view` = vue affichée, `capacity` = lignes visibles.
 * Renvoie le nouvel état et l'effet à exécuter par le contrôleur.
 */
export function handleGesture(
  s: NavState,
  g: Gesture,
  view: Pick<GlassesView, 'items' | 'layout' | 'tap' | 'initialSel' | 'initialTop'>,
  capacity: number,
): { state: NavState; effect: NavEffect } {
  const f = current(s);
  const { sel, top } = effectiveFrame(f, view, capacity);
  switch (g) {
    case 'double':
      if (s.stack.length > 1) return { state: pop(s), effect: { kind: 'back' } };
      return { state: s, effect: { kind: 'exit' } };
    case 'tap': {
      const intent = tapIntent(view as GlassesView, sel);
      const state = setSelection(s, sel, top);
      return intent ? { state, effect: { kind: 'intent', intent } } : { state, effect: { kind: 'none' } };
    }
    case 'up':
    case 'down': {
      if (!selectable(view as GlassesView) || !view.items.length) return { state: s, effect: { kind: 'none' } };
      const next = Math.min(Math.max(0, sel + (g === 'down' ? 1 : -1)), view.items.length - 1);
      const nextTop = ensureVisible(view.items as Item[], next, top, capacity);
      if (next === sel && nextTop === top && !f.fresh) return { state: s, effect: { kind: 'none' } };
      return { state: setSelection(s, next, nextTop), effect: next === sel && nextTop === top ? { kind: 'none' } : { kind: 'render' } };
    }
  }
}

/** Instantané sérialisable de la navigation (état d'arrière-plan). */
export function serializeNav(s: NavState): string {
  return JSON.stringify(s);
}

/** Lecture défensive d'un instantané ; null s'il est invalide. */
export function parseNav(x: unknown): NavState | null {
  try {
    const v = typeof x === 'string' ? JSON.parse(x) : x;
    if (!v || typeof v !== 'object' || !Array.isArray((v as NavState).stack) || !(v as NavState).stack.length) return null;
    const stack: NavFrame[] = [];
    for (const f of (v as NavState).stack) {
      if (!f || typeof f !== 'object' || !f.route || typeof f.route !== 'object' || typeof (f.route as Route).screen !== 'string') return null;
      stack.push({ route: f.route, sel: Number.isFinite(f.sel) ? f.sel : 0, top: Number.isFinite(f.top) ? f.top : 0, fresh: !!f.fresh });
    }
    return { stack };
  } catch {
    return null;
  }
}
