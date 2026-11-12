/**
 * Machine d'états de la navigation des lunettes (pure).
 * Gestes : glisser haut/bas = se déplacer ; toucher = ouvrir/agir ; double toucher = retour,
 * et depuis l'écran racine = quitter (boîte de confirmation système, shutDownPageContainer(1)).
 */
import { clampTop, ensureVisible, maxTop, pageTop, prevPageTop, visibleRange } from './layout';
import type { GlassesView, Intent, Item, Route } from './types';
import { selectable, tapIntent } from './views';

export type Gesture = 'up' | 'down' | 'tap' | 'double';

export interface NavFrame {
  route: Route;
  sel: number;
  top: number;
  /** Vrai tant que la sélection n'a pas été touchée (la vue peut proposer sa sélection initiale). */
  fresh?: boolean;
  /**
   * 1.2.3 : identité de l'élément sélectionné (Item.key : un départ d'un tableau, un passage d'une ligne) : le curseur
   * le suit quand la liste change (départ parti, retard qui réordonne, retour des arrêts d'un départ).
   */
  key?: string;
}

export interface NavState {
  stack: NavFrame[];
}

export type NavEffect =
  | { kind: 'none' }
  | { kind: 'render' }
  | { kind: 'exit' }
  | { kind: 'back' }
  | { kind: 'intent'; intent: Intent }
  /** Écran sans curseur déjà au bout de sa liste (étapes : proposition suivante ou précédente). */
  | { kind: 'edge'; dir: 'up' | 'down' };

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

/** Met à jour la sélection de l'écran courant ; `key` : l'identité de l'élément sélectionné (Item.key), s'il en a une. */
export function setSelection(s: NavState, sel: number, top: number, key?: string): NavState {
  const f = current(s);
  if (f.sel === sel && f.top === top && !f.fresh && f.key === key) return s;
  const frame: NavFrame = { ...f, sel, top, fresh: false };
  if (key) frame.key = key;
  else delete frame.key;
  return { stack: [...s.stack.slice(0, -1), frame] };
}

/**
 * 1.2.3 : rang de l'élément de clé `key` (« identité@minutes », Item.key) : le même ; sinon, de même identité, celui
 * dont l'heure est la plus proche, à `maxGap` minutes au plus (départ rafraîchi, ou parti : le suivant de la même ligne
 * et du même sens) ; -1 sinon.
 */
export function anchorIndex(keys: readonly (string | undefined)[], key: string, maxGap = 30): number {
  const exact = keys.indexOf(key);
  if (exact >= 0) return exact;
  const at = key.lastIndexOf('@');
  if (at < 0) return -1;
  const id = key.slice(0, at);
  const t = Number(key.slice(at + 1));
  let best = -1;
  let gap = Infinity;
  keys.forEach((k, i) => {
    const j = k ? k.lastIndexOf('@') : -1;
    if (!k || j < 0 || k.slice(0, j) !== id) return;
    const d = Math.abs(Number(k.slice(j + 1)) - t);
    if (d <= maxGap && d < gap) {
      gap = d;
      best = i;
    }
  });
  return best;
}

/** Remplace la route courante sans toucher à la sélection (ex. trajet rafraîchi). */
export function updateRoute(s: NavState, route: Route): NavState {
  const f = current(s);
  return { stack: [...s.stack.slice(0, -1), { ...f, route }] };
}

/** Met à jour la route d'un cadre quelconque de la pile (ex. étapes calculées pendant qu'on regarde ailleurs). */
export function mapRoutes(s: NavState, fn: (r: Route) => Route): NavState {
  let changed = false;
  const stack = s.stack.map((f) => {
    const route = fn(f.route);
    if (route === f.route) return f;
    changed = true;
    return { ...f, route };
  });
  return changed ? { stack } : s;
}

/**
 * Remplace la route courante et repart d'un défilement donné (étapes : autre proposition). `fresh` : la vue
 * choisit elle-même son défilement initial (repère « ▶ » visible).
 */
export function replaceAt(s: NavState, route: Route, top: number, fresh = false): NavState {
  const f = current(s);
  return { stack: [...s.stack.slice(0, -1), { ...f, route, top, fresh }] };
}

/**
 * Sélection effective d'une vue : la sélection initiale proposée par la vue tant que
 * l'utilisateur n'a pas bougé, sinon celle de la pile, bornée au nombre d'éléments.
 * Écran sans curseur : seulement le défilement, borné pour que la fin de la liste reste à l'écran.
 */
export function effectiveFrame(f: NavFrame, v: Pick<GlassesView, 'items' | 'initialSel' | 'initialTop' | 'scroll' | 'mark' | 'paged'>, capacity: number): { sel: number; top: number } {
  const n = v.items.length;
  let top = f.fresh && v.initialTop !== undefined ? v.initialTop : f.top;
  if (v.scroll) return { sel: v.mark ?? -1, top: clampTop(v.items as Item[], top, capacity) };
  let sel = f.fresh && v.initialSel !== undefined ? v.initialSel : f.sel;
  // 1.2.3 : le curseur suit son départ (Item.key) quand la liste a changé ; introuvable : le rang, borné. La ligne ★
  // d'un tableau n'a pas de clé : un curseur posé sur elle y reste.
  if (!f.fresh && f.key) {
    const i = anchorIndex(v.items.map((x) => x.key), f.key);
    if (i >= 0) sel = i;
  }
  sel = n ? Math.min(Math.max(0, sel), n - 1) : 0;
  top = v.paged ? pageTop(v.items as Item[], sel, top, capacity) : ensureVisible(v.items as Item[], sel, top, capacity);
  return { sel, top };
}

/**
 * Applique un geste. `view` = vue affichée, `capacity` = lignes visibles.
 * Renvoie le nouvel état et l'effet à exécuter par le contrôleur.
 */
export function handleGesture(
  s: NavState,
  g: Gesture,
  view: Pick<GlassesView, 'items' | 'layout' | 'tap' | 'initialSel' | 'initialTop' | 'scroll' | 'mark' | 'paged'>,
  capacity: number,
): { state: NavState; effect: NavEffect } {
  const f = current(s);
  const { sel, top } = effectiveFrame(f, view, capacity);
  switch (g) {
    case 'double':
      if (s.stack.length > 1) return { state: pop(s), effect: { kind: 'back' } };
      return { state: s, effect: { kind: 'exit' } };
    case 'tap': {
      if (view.scroll) {
        const state = setSelection(s, f.sel, top);
        return view.tap ? { state, effect: { kind: 'intent', intent: view.tap } } : { state, effect: { kind: 'none' } };
      }
      const intent = tapIntent(view as GlassesView, sel);
      const state = setSelection(s, sel, top, view.items[sel]?.key);
      return intent ? { state, effect: { kind: 'intent', intent } } : { state, effect: { kind: 'none' } };
    }
    case 'up':
    case 'down': {
      if (view.scroll && view.layout !== 'message') {
        // Sans curseur : ▼ montre les lignes cachées en dessous (toutes si elles tiennent), ▲ celles du dessus. 1.2.4 :
        // une page se compte en lignes (une étape peut en prendre deux) : ▼ commence à la première étape cachée.
        const items = view.items as Item[];
        const max = maxTop(items, capacity);
        const next = g === 'down' ? Math.min(max, Math.max(top + 1, visibleRange(items, top, capacity).to)) : prevPageTop(items, top, capacity);
        if (next === top) return { state: setSelection(s, f.sel, top), effect: { kind: 'edge', dir: g } };
        return { state: setSelection(s, f.sel, next), effect: { kind: 'render' } };
      }
      if (!selectable(view as GlassesView) || !view.items.length) return { state: s, effect: { kind: 'none' } };
      const next = Math.min(Math.max(0, sel + (g === 'down' ? 1 : -1)), view.items.length - 1);
      // 1.2.3 : listes longues (tableaux complets, arrêts d'un départ) : la liste défile par page
      const nextTop = view.paged ? pageTop(view.items as Item[], next, top, capacity) : ensureVisible(view.items as Item[], next, top, capacity);
      if (next === sel && nextTop === top && !f.fresh) return { state: s, effect: { kind: 'none' } };
      return { state: setSelection(s, next, nextTop, view.items[next]?.key), effect: next === sel && nextTop === top ? { kind: 'none' } : { kind: 'render' } };
    }
  }
}

/** Instantané sérialisable de la navigation (état d'arrière-plan). */
export function serializeNav(s: NavState): string {
  return JSON.stringify(s);
}

/** Écrans connus (un instantané de la 1.0 peut contenir un écran retiré en 1.1 : « journeys », « trip », Q6). */
const SCREENS: ReadonlySet<string> = new Set(['home', 'nearby', 'board', 'favorites', 'stations', 'lines', 'line', 'keepLine', 'stops', 'steps', 'others', 'followed', 'train', 'arrival', 'message']);

/**
 * Lecture défensive d'un instantané ; null s'il est invalide. Les écrans inconnus sont retirés de la pile. 1.2.2 : un
 * « Aller à… » (`places`) gardé par la 1.2.1 s'ouvre sur « Favoris », où son contenu se trouve désormais (PRD-1.2.2
 * § 1.2) ; « Autres favoris » (`exclude` de la 1.2.0) aussi.
 */
export function parseNav(x: unknown): NavState | null {
  try {
    const v = typeof x === 'string' ? JSON.parse(x) : x;
    if (!v || typeof v !== 'object' || !Array.isArray((v as NavState).stack) || !(v as NavState).stack.length) return null;
    const stack: NavFrame[] = [];
    for (const f of (v as NavState).stack) {
      if (!f || typeof f !== 'object' || !f.route || typeof f.route !== 'object' || typeof (f.route as Route).screen !== 'string') return null;
      const screen = (f.route as { screen: string }).screen;
      const route: Route = screen === 'places' || screen === 'favorites' ? { screen: 'favorites' } : f.route;
      if (!SCREENS.has(route.screen)) continue;
      stack.push({ route, sel: Number.isFinite(f.sel) ? f.sel : 0, top: Number.isFinite(f.top) ? f.top : 0, fresh: !!f.fresh, ...(typeof f.key === 'string' && f.key ? { key: f.key } : {}) });
    }
    return stack.length ? { stack } : null;
  } catch {
    return null;
  }
}
