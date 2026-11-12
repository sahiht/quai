/** Petits utilitaires DOM pour l'interface du téléphone (sans framework). */

export type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'value' && 'value' in el) (el as unknown as HTMLInputElement).value = String(v);
      else if (k === 'checked' && 'checked' in el) (el as unknown as HTMLInputElement).checked = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Icônes des maquettes (SVG en ligne, décoratives). */
const svg = (body: string, size = 20, stroke = '#1F7A45', width = 2): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  chevron: svg('<path d="M9 6l6 6-6 6"></path>', 20, '#6B756E'),
  back: svg('<path d="M15 18l-6-6 6-6"></path>'),
  home: svg('<path d="M3 11l9-7 9 7"></path><path d="M5 10v10h14V10"></path><path d="M10 20v-6h4v6"></path>'),
  work: svg('<rect x="3" y="7" width="18" height="13" rx="2"></rect><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"></path>'),
  pin: svg('<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"></path><circle cx="12" cy="10" r="2.2"></circle>'),
  pinWhite: svg('<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"></path><circle cx="12" cy="10" r="2.2"></circle>', 18, '#FFFFFF'),
  plus: svg('<path d="M12 5v14M5 12h14"></path>', 16, '#1F7A45', 2.4),
  plusWhite: svg('<path d="M12 5v14M5 12h14"></path>', 16, '#FFFFFF', 2.4),
  trip: svg('<circle cx="6" cy="19" r="2.5"></circle><circle cx="18" cy="5" r="2.5"></circle><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"></path>'),
  tram: svg('<rect x="6" y="6" width="12" height="11" rx="2"></rect><path d="M9 3h6M12 3v3M6 12h12M9 17l-2 4M15 17l2 4"></path>'),
  bus: svg('<rect x="5" y="3" width="14" height="15" rx="2"></rect><path d="M5 10h14M8 18v2M16 18v2"></path><path d="M8.5 14h.01M15.5 14h.01"></path>'),
  train: svg('<rect x="5" y="3" width="14" height="13" rx="3"></rect><path d="M5 10h14M8 20l2-4M16 20l-2-4"></path>'),
  clock: svg('<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>', 18),
  swap: svg('<path d="M8 4v16M8 4L5 7M8 4l3 3M16 20V4M16 20l-3-3M16 20l3-3"></path>'),
  glasses: svg('<circle cx="7" cy="14" r="3.5"></circle><circle cx="17" cy="14" r="3.5"></circle><path d="M10.5 14h3M3.5 14L5 8M20.5 14L19 8"></path>', 22, '#FFFFFF'),
  glassesGreen: svg('<circle cx="7" cy="14" r="3.5"></circle><circle cx="17" cy="14" r="3.5"></circle><path d="M10.5 14h3M3.5 14L5 8M20.5 14L19 8"></path>', 20),
  searchGrey: svg('<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path>', 20, '#6B756E'),
  search: svg('<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path>', 20, '#FFFFFF'),
  walk: svg('<circle cx="13" cy="4" r="2"></circle><path d="M10 21l2-6-2-3 1-5 4 3 3 1"></path><path d="M12 15l3 6M9 9l-3 2"></path>', 14, '#3F4842'),
  /** 1.2.2 : ligne « Trajets » des réglages (marche maximale, marge). */
  walker: svg('<circle cx="13" cy="4" r="2"></circle><path d="M10 21l2-6-2-3 1-5 4 3 3 1"></path><path d="M12 15l3 6M9 9l-3 2"></path>'),
  trainSmall: svg('<rect x="5" y="3" width="14" height="13" rx="3"></rect><path d="M5 10h14M8 20l2-4M16 20l-2-4"></path>', 14, '#161A17'),
  tramSmall: svg('<rect x="6" y="6" width="12" height="11" rx="2"></rect><path d="M9 3h6M12 3v3M6 12h12M9 17l-2 4M15 17l2 4"></path>', 14, '#161A17'),
  busSmall: svg('<rect x="5" y="3" width="14" height="15" rx="2"></rect><path d="M5 10h14M8 18v2M16 18v2"></path>', 14, '#161A17'),
  settings: svg('<circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"></path>'),
  data: svg('<ellipse cx="12" cy="6" rx="7" ry="3"></ellipse><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"></path>'),
  alert: svg('<path d="M12 4l9 16H3z"></path><path d="M12 10v4M12 17h.01"></path>'),
  display: svg('<rect x="3" y="5" width="18" height="12" rx="2"></rect><path d="M8 21h8M12 17v4"></path>'),
  lang: svg('<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"></path>'),
};

export function icon(name: keyof typeof ICON): HTMLSpanElement {
  return h('span', { class: 'ico', html: ICON[name] });
}

/**
 * Icône SVG en élément, tirée d'une constante de ICON (jamais d'une donnée du réseau ni d'une saisie) : les textes
 * voisins restent des nœuds texte (`h(…, svgNode(ICON.walk), h('span', null, texte))`).
 */
export function svgNode(markup: (typeof ICON)[keyof typeof ICON]): Element {
  const t = document.createElement('template');
  t.innerHTML = markup;
  return t.content.firstElementChild!;
}

/** Ajuste l'échelle d'un écran 576 × 288 à la largeur de son conteneur. */
export function fitScreen(wrap: HTMLElement, screen: HTMLElement): void {
  const apply = (): void => {
    const w = wrap.clientWidth || 576;
    screen.style.transform = `scale(${w / 576})`;
  };
  apply();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(apply).observe(wrap);
  else window.addEventListener('resize', apply);
}

let liveSeq = 0;
/** Zone de message annoncée aux lecteurs d'écran. */
export function liveRegion(): { el: HTMLParagraphElement; say: (text: string, error?: boolean) => void } {
  const el = h('p', { class: 'live', role: 'status', 'aria-live': 'polite', id: `live-${++liveSeq}` });
  return {
    el,
    say(text, error = false) {
      el.textContent = text;
      el.classList.toggle('err', error);
    },
  };
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
