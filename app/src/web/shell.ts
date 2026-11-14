/**
 * Quai Web : page à deux vues. En haut, un choix « Lunettes » | « Réglages » ; « Lunettes » montre l'écran
 * des lunettes (canvas) et la barre de gestes, « Réglages » l'interface du téléphone. Sur un grand écran,
 * les deux vues sont côte à côte.
 */
import { GRID } from './icon-grid';
import { h } from '../phone/dom';

export type Panel = 'lunettes' | 'reglages';
export const WIDE_QUERY = '(min-width: 1024px)';

export interface Shell {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  /** Barre des gestes (boutons data-g="up|down|tap|double"). */
  gestures: HTMLElement;
  /** Sous la barre des gestes (rubrique Position). */
  extra: HTMLElement;
  /** Racine de l'interface du téléphone (#app). */
  reglages: HTMLElement;
  reglagesPanel: HTMLElement;
  panel(): Panel;
  show(p: Panel): void;
  /** Vrai si les deux vues sont côte à côte. */
  wide(): boolean;
  /** Vrai si l'écran des lunettes est à l'écran (vue Lunettes, ou grand écran). */
  glassesVisible(): boolean;
  onChange(cb: () => void): () => void;
}

/** Logo : le tram de l'icône des lunettes (grille 12 × 12). */
function logo(): string {
  const cells = GRID.flatMap((row, y) => [...row].map((c, x) => (c === '#' ? `<rect x="${x}" y="${y}" width="1.02" height="1.02"/>` : ''))).join('');
  return `<svg class="w-logo" viewBox="-2 -2 16 16" width="28" height="28" aria-hidden="true"><rect x="-2" y="-2" width="16" height="16" rx="3.2" fill="#1f7a45"/><g fill="#f4f4f4">${cells}</g></svg>`;
}

export function mountShell(host: HTMLElement, initial: Panel): Shell {
  const listeners = new Set<() => void>();
  const tab = (p: Panel, label: string) =>
    h('button', { type: 'button', role: 'tab', id: `w-tab-${p}`, 'aria-controls': `w-${p}`, 'aria-selected': 'false', tabindex: '-1', class: 'w-tab' }, label);
  const tabs = { lunettes: tab('lunettes', 'Lunettes'), reglages: tab('reglages', 'Réglages') };
  const tablist = h('div', { class: 'w-tabs', role: 'tablist', 'aria-label': 'Vue' }, tabs.lunettes, tabs.reglages);

  const canvas = h('canvas', { class: 'w-canvas', tabindex: '0', role: 'img', 'aria-label': 'Écran des lunettes' });
  const button = (g: string, label: string, aria?: string) =>
    h('button', { type: 'button', class: `w-g w-g-${g}`, 'data-g': g, 'aria-label': aria, onmousedown: (e: MouseEvent) => e.preventDefault() }, label);
  const gestures = h(
    'div',
    { class: 'w-gestures', role: 'group', 'aria-label': 'Gestes des lunettes' },
    button('up', '▲', 'Glisser vers le haut'),
    button('down', '▼', 'Glisser vers le bas'),
    button('tap', 'Toucher'),
    button('double', 'Double toucher'),
  );
  const help = h(
    'p',
    { class: 'w-help' },
    h('span', null, 'Sur l’écran : glisse vers le haut ou le bas, touche une ou deux fois.'),
    h('span', { class: 'w-help-keys' }, ' Clavier : ↑ ↓, Entrée = toucher, Échap = double toucher.'),
  );
  const extra = h('div', { class: 'w-extra' });
  const lunettes = h(
    'section',
    { id: 'w-lunettes', class: 'w-panel w-panel-lunettes', role: 'tabpanel', 'aria-labelledby': 'w-tab-lunettes' },
    h('h2', { class: 'w-panel-title' }, 'Lunettes'),
    h('div', { class: 'w-stage' }, h('div', { class: 'w-screen' }, canvas), gestures),
    help,
    extra,
  );
  const reglages = h('main', { id: 'app' });
  const reglagesPanel = h('section', { id: 'w-reglages', class: 'w-panel w-panel-reglages', role: 'tabpanel', 'aria-labelledby': 'w-tab-reglages' }, h('h2', { class: 'w-panel-title' }, 'Réglages'), reglages);
  const root = h(
    'div',
    { class: 'w-app' },
    h('header', { class: 'w-top' }, h('div', { class: 'w-brand', html: `${logo()}<span>Quai</span>` }), tablist),
    h('div', { class: 'w-main' }, lunettes, reglagesPanel),
  );
  host.replaceChildren(root);
  // hauteur de la barre du haut (vue Lunettes collée sous elle sur grand écran)
  const top = root.querySelector<HTMLElement>('.w-top')!;
  const setTop = () => root.style.setProperty('--w-top', `${top.offsetHeight}px`);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(setTop).observe(top);
  setTop();

  const mq = typeof matchMedia === 'function' ? matchMedia(WIDE_QUERY) : null;
  let current: Panel = initial;
  const wide = () => !!mq?.matches;
  const apply = (): void => {
    root.dataset.panel = current;
    for (const p of ['lunettes', 'reglages'] as const) {
      const on = p === current;
      tabs[p].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[p].tabIndex = on ? 0 : -1;
    }
    for (const l of [...listeners]) l();
  };
  const show = (p: Panel): void => {
    if (p === current) return;
    current = p;
    apply();
    if (!wide()) window.scrollTo(0, 0);
  };
  tabs.lunettes.addEventListener('click', () => show('lunettes'));
  tabs.reglages.addEventListener('click', () => show('reglages'));
  tablist.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    show(current === 'lunettes' ? 'reglages' : 'lunettes');
    tabs[current].focus();
  });
  mq?.addEventListener?.('change', () => apply());
  apply();

  return {
    root,
    canvas,
    gestures,
    extra,
    reglages,
    reglagesPanel,
    panel: () => current,
    show,
    wide,
    glassesVisible: () => wide() || current === 'lunettes',
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
