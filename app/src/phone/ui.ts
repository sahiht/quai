/** Composants accessibles de l'interface du téléphone (maquettes Config1-6). */
import { paintContainers } from '../platform/browser';
import { layoutPage, geometry } from '../glasses/layout';
import { effectiveFrame, initNav } from '../glasses/nav';
import type { ContainerSpec, GlassesView, Item } from '../glasses/types';
import { fitScreen, h, ICON, type Child } from './dom';

let uid = 0;
export const nextId = (p: string): string => `${p}-${++uid}`;

/** Pas-à-pas « − 10 min + ». */
export function stepper(opts: {
  label: string;
  sub?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (v: number) => string;
  less: string;
  more: string;
  onChange: (v: number) => void;
}): HTMLElement {
  let v = opts.value;
  const out = h('output', { 'aria-live': 'polite' }, opts.format(v));
  const minus = h('button', { type: 'button', 'aria-label': opts.less }, '−');
  const plus = h('button', { type: 'button', 'aria-label': opts.more }, '+');
  const sync = (): void => {
    out.textContent = opts.format(v);
    minus.disabled = v <= opts.min;
    plus.disabled = v >= opts.max;
  };
  const set = (n: number): void => {
    const next = Math.min(opts.max, Math.max(opts.min, n));
    if (next === v) return;
    v = next;
    sync();
    opts.onChange(v);
  };
  minus.addEventListener('click', () => set(v - (opts.step ?? 1)));
  plus.addEventListener('click', () => set(v + (opts.step ?? 1)));
  sync();
  return h(
    'div',
    { class: 'stepper-row' },
    h('span', { class: 'cc', style: 'display:flex;flex-direction:column' }, h('span', { class: 'c1', style: 'font-size:15px;line-height:20px;font-weight:500' }, opts.label), opts.sub ? h('span', { class: 'c2 small muted' }, opts.sub) : null),
    h('span', { class: 'stepper', role: 'group', 'aria-label': opts.label }, minus, out, plus),
  );
}

/** Interrupteur (case à cocher role=switch) sur toute la ligne. */
export function switchRow(opts: { label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void }): HTMLLabelElement {
  const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch', checked: opts.checked });
  input.addEventListener('change', () => opts.onChange(input.checked));
  return h('label', { class: 'switch-row' }, h('span', { class: 'cc' }, h('span', { class: 'c1' }, opts.label), opts.sub ? h('span', { class: 'c2' }, opts.sub) : null), input);
}

/** Choix segmenté (300 / 500 / 800 m). */
export function segmented<T extends string | number>(opts: { legend: string; hiddenLegend?: boolean; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }): HTMLFieldSetElement {
  const name = nextId('seg');
  const labels: HTMLLabelElement[] = [];
  const box = h('div', { class: 'seg' });
  for (const o of opts.options) {
    const input = h('input', { type: 'radio', name, value: String(o.value), checked: o.value === opts.value });
    const label = h('label', { class: o.value === opts.value ? 'on' : '' }, input, o.label);
    input.addEventListener('change', () => {
      if (!input.checked) return;
      labels.forEach((l) => l.classList.toggle('on', l === label));
      opts.onChange(o.value);
    });
    labels.push(label);
    box.appendChild(label);
  }
  return h('fieldset', null, h('legend', { class: opts.hiddenLegend ? 'sr-only' : 'legend-sm', style: opts.hiddenLegend ? '' : 'font-size:15px;line-height:20px;font-weight:500;color:#161A17;margin:0 0 8px' }, opts.legend), box);
}

/** Un choix d'un contrôle segmenté à panneaux : titre, sous-titre, panneau montré quand il est choisi. */
export interface SegmentTab<T extends string> {
  value: T;
  label: string;
  sub?: string;
  panel: HTMLElement;
}

/**
 * Contrôle segmenté qui montre un panneau à la fois (PRD-1.2.1 § 7.1, « Nouveau favori ») : des onglets de même
 * taille et de même style, comme « Lunettes | Réglages » de Quai Web (rôles tablist, tab et tabpanel, aria-selected,
 * aria-controls). Un seul onglet dans l'ordre de tabulation ; flèches gauche et droite, Début et Fin. Le titre nomme
 * l'onglet, le sous-titre le décrit. Les panneaux restent dans la page, cachés : changer de choix ne perd rien.
 */
export function segmentedTabs<T extends string>(opts: { label: string; options: SegmentTab<T>[]; value: T; onChange?: (v: T) => void }): {
  el: HTMLElement;
  panels: HTMLElement[];
  value(): T;
  select(v: T, focus?: boolean): void;
} {
  const id = nextId('seg');
  let current = opts.value;
  const tabs = opts.options.map((o, i) =>
    h(
      'button',
      { type: 'button', role: 'tab', class: 'kind', id: `${id}-tab-${i}`, 'aria-controls': `${id}-panel-${i}`, 'aria-labelledby': `${id}-t-${i}`, 'aria-describedby': o.sub ? `${id}-s-${i}` : undefined, 'data-value': o.value },
      h('span', { class: 'k1', id: `${id}-t-${i}` }, o.label),
      o.sub ? h('span', { class: 'k2', id: `${id}-s-${i}` }, o.sub) : null,
    ),
  );
  // Panneau nommé par le titre de son onglet (« Un endroit »), sans le sous-titre.
  const panels = opts.options.map((o, i) => h('div', { class: 'kind-panel', role: 'tabpanel', id: `${id}-panel-${i}`, 'aria-labelledby': `${id}-t-${i}` }, o.panel));
  const apply = (): void =>
    opts.options.forEach((o, i) => {
      const on = o.value === current;
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[i].tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
    });
  const select = (v: T, focus = false): void => {
    const i = opts.options.findIndex((o) => o.value === v);
    if (i < 0) return;
    if (focus) tabs[i].focus();
    if (v === current) return;
    current = v;
    apply();
    opts.onChange?.(v);
  };
  tabs.forEach((t, i) => t.addEventListener('click', () => select(opts.options[i].value)));
  const list = h('div', { class: 'kinds', role: 'tablist', 'aria-label': opts.label }, tabs);
  list.addEventListener('keydown', (e) => {
    const at = tabs.indexOf(e.target as HTMLButtonElement);
    const i = at >= 0 ? at : opts.options.findIndex((o) => o.value === current);
    const n = opts.options.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    select(opts.options[to].value, true);
  });
  apply();
  return { el: list, panels, value: () => current, select };
}

/** Groupe de boutons radio. */
export function radios<T extends string>(opts: { legend: string; big?: boolean; options: { value: T; label: string; sub?: string }[]; value: T; onChange: (v: T) => void }): HTMLFieldSetElement {
  const name = nextId('radio');
  return h(
    'fieldset',
    null,
    h('legend', { class: opts.big ? 'legend' : 'legend-sm' }, opts.legend),
    opts.options.map((o) => {
      const input = h('input', { type: 'radio', name, value: o.value, checked: o.value === opts.value });
      input.addEventListener('change', () => input.checked && opts.onChange(o.value));
      return h('label', { class: `choice${opts.big ? '' : ' compact'}` }, input, o.sub ? h('span', { class: 'cc' }, h('span', { class: 'c1' }, o.label), h('span', { class: 'c2' }, o.sub)) : o.label);
    }),
  );
}

/** Ligne de liste cliquable : icône, titre, sous-titres (sub2 en texte courant, sub3 discret), chevron. */
export function listRow(opts: { icon: Child; title: string; sub?: string; sub2?: string; sub3?: string; label?: string; onClick: () => void }): HTMLLIElement {
  return h(
    'li',
    null,
    h(
      'button',
      { type: 'button', class: 'row', onclick: opts.onClick, 'aria-label': opts.label },
      opts.icon,
      h(
        'span',
        { class: 'txt' },
        h('span', { class: 't1' }, opts.title),
        opts.sub ? h('span', { class: 't2' }, opts.sub) : null,
        opts.sub2 ? h('span', { class: 't3' }, opts.sub2) : null,
        opts.sub3 ? h('span', { class: 't2 t4' }, opts.sub3) : null,
      ),
      h('span', { class: 'chev', html: ICON.chevron }),
    ),
  );
}

/**
 * Messages d'état à côté des boutons touchés (PRD M4.5) : un seul message à la fois sur l'écran, les autres
 * emplacements sont vidés. Chaque emplacement est annoncé aux lecteurs d'écran.
 */
export interface MessageHub {
  slot(): HTMLParagraphElement;
  say(slot: HTMLElement, text: string, error?: boolean): void;
  clear(): void;
}

export function messageHub(): MessageHub {
  const slots = new Set<HTMLElement>();
  const reset = (el: HTMLElement): void => {
    el.textContent = '';
    el.classList.remove('err');
  };
  return {
    slot() {
      const p = h('p', { class: 'msg', role: 'status', 'aria-live': 'polite' });
      slots.add(p);
      return p;
    },
    say(slot, text, error = false) {
      for (const el of [...slots]) {
        if (el === slot) continue;
        if (!el.isConnected) slots.delete(el);
        else reset(el);
      }
      slots.add(slot);
      slot.textContent = text;
      slot.classList.toggle('err', error);
    },
    clear() {
      for (const el of slots) reset(el);
    },
  };
}

/**
 * Confirmation dans la page (S6), jamais de boîte du système : le bouton déclencheur laisse place à la question,
 * « Supprimer » et « Annuler ».
 */
export function confirmInPage(opts: { trigger: string; question: string; confirm: string; cancel: string; onConfirm: () => void | Promise<void> }): HTMLElement {
  const wrap = h('div', { class: 'confirm-wrap' });
  const qid = nextId('confirm');
  const trigger = h('button', { type: 'button', class: 'btn btn-danger btn-block' }, opts.trigger);
  const yes = h('button', { type: 'button', class: 'btn btn-danger-solid' }, opts.confirm);
  const no = h('button', { type: 'button', class: 'btn btn-secondary' }, opts.cancel);
  const box = h('div', { class: 'confirm', role: 'group', 'aria-labelledby': qid }, h('p', { id: qid, class: 'confirm-q' }, opts.question), h('div', { class: 'confirm-actions' }, yes, no));
  const showTrigger = (): void => {
    wrap.replaceChildren(trigger);
  };
  trigger.addEventListener('click', () => {
    wrap.replaceChildren(box);
    no.focus();
  });
  no.addEventListener('click', () => {
    showTrigger();
    trigger.focus();
  });
  yes.addEventListener('click', async () => {
    yes.disabled = true;
    try {
      await opts.onConfirm();
    } finally {
      yes.disabled = false;
    }
  });
  showTrigger();
  return wrap;
}

/** Raccourcis de nom touchables (« Maison », « Bureau », « École ») qui remplissent un champ. */
export function nameShortcuts(input: HTMLInputElement, onPick?: (name: string) => void, names: readonly string[] = ['Maison', 'Bureau', 'École']): HTMLElement {
  return h(
    'div',
    { class: 'shortcuts', role: 'group', 'aria-label': 'Noms proposés' },
    names.map((n) =>
      h(
        'button',
        {
          type: 'button',
          class: 'shortcut',
          onclick: () => {
            input.value = n;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            onPick?.(n);
          },
        },
        n,
      ),
    ),
  );
}

/** Dessin d'un aperçu dans sa boîte (Quai Web : même rendu que l'écran des lunettes de la page). */
export type PreviewPainter = (box: HTMLElement, containers: ContainerSpec[]) => void;
let previewPainter: PreviewPainter | null = null;
export function setPreviewPainter(p: PreviewPainter | null): void {
  previewPainter = p;
}

/**
 * Texte d'un élément des lunettes pour les lecteurs d'écran : colonnes a et b, réponse alignée à droite d'un favori de
 * l'accueil (1.2.1 : « Bureau dans 4 min → 09:00 »), colonne c.
 */
export function previewItemText(i: Item): string {
  // 1.2.5 et 1.2.6 : une ligne en mots clairs et pâles (segs) se lit dans l'ordre de l'écran
  const words = i.segs?.map((g) => g.t).filter(Boolean).join(' ');
  return [i.a || words, i.b, i.bRight ? `${i.bRight}${i.bRightTail ?? ''}` : '', i.c].filter(Boolean).join(' ');
}

/** Aperçu fidèle des lunettes : même mise en page que l'appareil, réduite. */
export function glassesPreview(title: string, view: GlassesView): HTMLElement {
  const box = h('div', { class: 'preview', role: 'img', 'aria-label': `${title} : ${[view.title, ...view.items.map(previewItemText)].join(', ')}` });
  const nav = initNav({ screen: 'home' });
  const g = geometry(view);
  const frame = effectiveFrame(nav.stack[0], view, g.capacity);
  const containers = layoutPage(view, frame).containers;
  if (previewPainter) previewPainter(box, containers);
  else {
    const screen = h('div', { class: 'g-screen' });
    box.appendChild(screen);
    paintContainers(screen, containers);
    queueMicrotask(() => fitScreen(box, screen));
  }
  return h('div', { class: 'preview-wrap' }, h('span', { class: 'label' }, title), box);
}
