/** Composants accessibles de l'interface du téléphone (maquettes Config1-6). */
import { paintContainers } from '../platform/browser';
import { layoutPage, geometry } from '../glasses/layout';
import { effectiveFrame, initNav } from '../glasses/nav';
import type { ContainerSpec, GlassesView } from '../glasses/types';
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

/** Ligne de liste cliquable : icône, titre, sous-titres, chevron. */
export function listRow(opts: { icon: Child; title: string; sub?: string; sub2?: string; label?: string; onClick: () => void }): HTMLLIElement {
  return h(
    'li',
    null,
    h(
      'button',
      { type: 'button', class: 'row', onclick: opts.onClick, 'aria-label': opts.label },
      opts.icon,
      h('span', { class: 'txt' }, h('span', { class: 't1' }, opts.title), opts.sub ? h('span', { class: 't2' }, opts.sub) : null, opts.sub2 ? h('span', { class: 't3' }, opts.sub2) : null),
      h('span', { class: 'chev', html: ICON.chevron }),
    ),
  );
}

/** Dessin d'un aperçu dans sa boîte (Quai Web : même rendu que l'écran des lunettes de la page). */
export type PreviewPainter = (box: HTMLElement, containers: ContainerSpec[]) => void;
let previewPainter: PreviewPainter | null = null;
export function setPreviewPainter(p: PreviewPainter | null): void {
  previewPainter = p;
}

/** Aperçu fidèle des lunettes : même mise en page que l'appareil, réduite. */
export function glassesPreview(title: string, view: GlassesView): HTMLElement {
  const box = h('div', { class: 'preview', role: 'img', 'aria-label': `${title} : ${[view.title, ...view.items.map((i) => [i.a, i.b, i.c].filter(Boolean).join(' '))].join(', ')}` });
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
