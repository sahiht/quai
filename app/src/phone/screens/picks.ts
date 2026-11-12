/**
 * Gares et lignes choisies (PRD-1.2.2 § 4) : sections « Gares » et « Bus, tram, métro » de l'accueil du téléphone, et
 * donc de l'onglet Réglages de Quai Web. Chaque section : ses éléments dans l'ordre choisi (une gare : son nom ; une
 * ligne : « Bus W · Merbraine », ou « Gare du Nord · toutes les lignes »), « Ouvrir d’office à moins de 300 m »
 * (`near`, revue d'usage n° 4), « Retirer » confirmé dans la page, « Changer l’ordre » (« Monter », « Descendre »,
 * comme pour les favoris), « Ajouter une gare » ou « Ajouter une ligne » ; LIMITS.stations gares et LIMITS.lines lignes au
 * plus (settings.ts : assez pour que la migration ne perde aucun arrêt favori).
 * Règles d'ajout (withStation, withLine) partagées avec les écrans d'ajout (pick-add.ts) et « Un endroit ».
 */
import type { LinePick, Mode, NameLang, Settings, StationPick } from '../../core/api';
import { lineKey } from '../../core/linepicks';
import { displayName, kindLabel } from '../../core/util';
import { LIMITS, newId } from '../../settings';
import type { PhoneCtx } from '../app';
import { h, icon, ICON, liveRegion, svgNode } from '../dom';
import { linePickTitle, lineGoneText, lineLimitText, rankText, removeLineText, removeStationText, stationGoneText, stationLimitText, T, typo } from '../text';
import { nextId } from '../ui';

export type PickKind = 'stations' | 'lines';

/* ------------------------------ Règles (sans DOM) ------------------------------ */

/** Identifiants déjà pris, gares et lignes ensemble (comme la migration, moveStops). */
const takenIds = (s: Settings): string[] => [...s.stations.map((x) => x.id), ...s.lines.map((x) => x.id)];

export type Added<P> = { settings: Settings; pick: P } | 'exists' | 'full';

/** Ajoute une gare en fin de liste ; 'exists' si elle y est déjà, 'full' à la limite (LIMITS.stations). */
export function withStation(s: Settings, st: Pick<StationPick, 'areaId' | 'name' | 'lat' | 'lon'>, now = Date.now()): Added<StationPick> {
  if (s.stations.some((x) => x.areaId === st.areaId)) return 'exists';
  if (s.stations.length >= LIMITS.stations) return 'full';
  const pick: StationPick = { id: newId('gare', takenIds(s), now), areaId: st.areaId, name: st.name, lat: st.lat, lon: st.lon };
  return { pick, settings: { ...s, stations: [...s.stations, pick] } };
}

/** Même ligne : même numéro (casse, espaces et zéros de tête ignorés), ou toutes les lignes des deux côtés. */
const sameLine = (a?: string, b?: string): boolean => (a === undefined || b === undefined ? a === b : lineKey(a) === lineKey(b));

/** Ajoute une ligne à un arrêt en fin de liste ; 'exists' si elle y est déjà (même arrêt, même ligne), 'full' à la limite (LIMITS.lines). */
export function withLine(s: Settings, l: Omit<LinePick, 'id' | 'near'>, now = Date.now()): Added<LinePick> {
  if (s.lines.some((x) => x.areaId === l.areaId && x.op === l.op && sameLine(x.line, l.line))) return 'exists';
  if (s.lines.length >= LIMITS.lines) return 'full';
  const pick: LinePick = { id: newId('ligne', takenIds(s), now), areaId: l.areaId, op: l.op, name: l.name, lat: l.lat, lon: l.lon };
  if (l.line) pick.line = l.line;
  if (l.mode) pick.mode = l.mode;
  return { pick, settings: { ...s, lines: [...s.lines, pick] } };
}

/** Déplace l'élément `id` d'un rang vers le haut (-1) ou le bas (+1) ; la liste telle quelle aux bornes. */
export function moveById<P extends { id: string }>(list: P[], id: string, dir: -1 | 1): P[] {
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Ouverture d'office à moins de 300 m : `near: true`, ou rien (jamais `near: false` dans les réglages). */
export function withNear<P extends StationPick | LinePick>(list: P[], id: string, on: boolean): P[] {
  return list.map((x) => {
    if (x.id !== id) return x;
    const { near: _near, ...rest } = x;
    return (on ? { ...rest, near: true } : rest) as P;
  });
}

/* ------------------------------ Noms ------------------------------ */

/** Lignes connues d'un arrêt (core.linesAt), gardées le temps de la visite : mode d'une ligne migrée sans mode. */
const known = new Map<string, Promise<{ line: string; mode: Mode }[]>>();
function linesAtStop(ctx: Pick<PhoneCtx, 'core'>, areaId: string): Promise<{ line: string; mode: Mode }[]> {
  let p = known.get(areaId);
  if (!p) {
    p = ctx
      .core()
      .then((c) => c.linesAt(areaId))
      .catch(() => {
        known.delete(areaId);
        return [];
      });
    known.set(areaId, p);
  }
  return p;
}

/** Pour les tests : oublie les lignes gardées. */
export function resetKnownLines(): void {
  known.clear();
}

/** Titre d'une gare : son nom dans la langue des noms. */
export const stationTitle = (p: StationPick, lang: NameLang): string => displayName(p.name, lang);

/**
 * Titre complété quand les lignes de l'arrêt sont connues : mode d'une ligne migrée sans mode (« Tram 3 · Gare du
 * Nord ») ; sans ligne, le type de l'arrêt en sous-titre (« bus De Lijn »), comme « Bruxelles-Nord, bus De Lijn ».
 */
function completeLine(ctx: Pick<PhoneCtx, 'core' | 'settings'>, p: LinePick, apply: (title: string, sub?: string) => void): void {
  if (p.line && p.mode) return;
  void linesAtStop(ctx, p.areaId).then((lines) => {
    const lang = ctx.settings.get().lang;
    const modes = [...new Set(lines.map((l) => l.mode).filter((m) => m !== 'train'))];
    if (p.line) {
      const mode = lines.find((l) => lineKey(l.line) === lineKey(p.line!))?.mode;
      if (mode && mode !== 'train') apply(linePickTitle(p, lang, mode));
    } else if (modes.length) apply(linePickTitle(p, lang), kindLabel(p.op, modes));
  });
}

/** Icône d'une ligne : bus ou tram (métro compris), selon son mode, sinon son réseau. */
function lineIcon(p: LinePick): HTMLSpanElement {
  if (p.mode) return icon(p.mode === 'bus' ? 'bus' : 'tram');
  return icon(p.op === 'stib' ? 'tram' : 'bus');
}

/* ------------------------------ Sections de l'accueil ------------------------------ */

interface SectionSpec<P extends StationPick | LinePick> {
  kind: PickKind;
  title: string;
  empty: string;
  add: string;
  addHash: string;
  max: number;
  limit: (max: number) => string;
  question: (name: string) => string;
  gone: (name: string) => string;
  list: (s: Settings) => P[];
  set: (s: Settings, list: P[]) => Settings;
  name: (p: P, lang: NameLang) => string;
  icon: (p: P) => HTMLSpanElement;
  complete?: (ctx: PhoneCtx, p: P, apply: (title: string, sub?: string) => void) => void;
}

const STATIONS: SectionSpec<StationPick> = {
  kind: 'stations',
  title: T.stations,
  empty: T.noStation,
  add: T.addStation,
  addHash: '#/gares/ajouter',
  max: LIMITS.stations,
  limit: stationLimitText,
  question: removeStationText,
  gone: stationGoneText,
  list: (s) => s.stations,
  set: (s, stations) => ({ ...s, stations }),
  name: stationTitle,
  icon: () => icon('train'),
};

const LINES: SectionSpec<LinePick> = {
  kind: 'lines',
  title: T.lines,
  empty: T.noLine,
  add: T.addLine,
  addHash: '#/lignes/ajouter',
  max: LIMITS.lines,
  limit: lineLimitText,
  question: removeLineText,
  gone: lineGoneText,
  list: (s) => s.lines,
  set: (s, lines) => ({ ...s, lines }),
  name: (p, lang) => linePickTitle(p, lang),
  icon: lineIcon,
  complete: completeLine,
};

/** Ce qui se voit d'une liste (ordre et noms) : un changement venu d'ailleurs (lunettes de Quai Web) la redessine. */
const shape = (list: readonly (StationPick | LinePick)[]): string => JSON.stringify(list.map((p) => [p.id, p.areaId, 'line' in p ? p.line ?? '' : '']));

function pickSection<P extends StationPick | LinePick>(ctx: PhoneCtx, spec: SectionSpec<P>, focus: boolean): HTMLElement {
  const headingId = `h-${spec.kind}`;
  const list = h('ul', { class: 'list box pick-list' });
  const live = liveRegion();
  let ordering = false;
  let drawn = '';
  const reorder = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, T.reorder);
  const add = h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => ctx.go(spec.addHash) }, svgNode(ICON.plus), h('span', null, spec.add));
  const limit = h('p', { class: 'small muted', role: 'status' });
  /** Confirmation de retrait ouverte (une seule à la fois). */
  let openBox: (() => void) | null = null;

  /** Retrait confirmé dans la page (S6) : la question et « Retirer », « Annuler » sous la ligne. */
  const confirmRemove = (li: HTMLElement, p: P, title: () => string, trigger: HTMLButtonElement): void => {
    openBox?.();
    const qid = nextId('confirm');
    const yes = h('button', { type: 'button', class: 'btn btn-danger-solid' }, T.removePick);
    const no = h('button', { type: 'button', class: 'btn btn-secondary' }, T.cancel);
    const box = h('div', { class: 'confirm', role: 'group', 'aria-labelledby': qid }, h('p', { id: qid, class: 'confirm-q' }, typo(spec.question(title()))), h('div', { class: 'confirm-actions' }, yes, no));
    const close = (): void => {
      box.remove();
      trigger.hidden = false;
      openBox = null;
    };
    openBox = close;
    trigger.hidden = true;
    li.appendChild(box);
    no.focus();
    no.addEventListener('click', () => {
      close();
      trigger.focus();
    });
    yes.addEventListener('click', async () => {
      yes.disabled = true;
      const name = title();
      const at = spec.list(ctx.settings.get()).findIndex((x) => x.id === p.id);
      openBox = null;
      await ctx.settings.update((x) => spec.set(x, spec.list(x).filter((y) => y.id !== p.id)));
      paint();
      live.say(typo(spec.gone(name)));
      // Le curseur passe à la ligne suivante (ou à la précédente), sinon au bouton d'ajout.
      const rows = [...list.querySelectorAll<HTMLElement>('.pick-row')];
      (rows[Math.min(at, rows.length - 1)]?.querySelector<HTMLButtonElement>('.pick-main .btn') ?? add).focus();
    });
  };

  const row = (p: P, i: number, all: P[]): HTMLLIElement => {
    const s = ctx.settings.get();
    let title = spec.name(p, s.lang);
    const nameId = nextId('pick');
    const t1 = h('span', { class: 't1', id: nameId }, title);
    const t2 = h('span', { class: 't2', hidden: true });
    const txt = h('span', { class: 'txt' }, t1, t2);
    const labelled: [HTMLElement, string][] = [];
    const rename = (better: string, sub?: string): void => {
      title = better;
      t1.textContent = better;
      for (const [el, verb] of labelled) el.setAttribute('aria-label', `${verb} ${better}`);
      if (sub) {
        t2.textContent = sub;
        t2.hidden = false;
      }
    };
    if (ordering) {
      const move = (dir: -1 | 1) => async () => {
        await ctx.settings.update((x) => spec.set(x, moveById(spec.list(x), p.id, dir)));
        live.say(typo(rankText(title, i + dir + 1, all.length)));
        paint({ id: p.id, dir });
      };
      const up = h('button', { type: 'button', class: 'btn btn-secondary btn-small', disabled: i === 0, onclick: move(-1) }, T.up);
      const down = h('button', { type: 'button', class: 'btn btn-secondary btn-small', disabled: i === all.length - 1, onclick: move(1) }, T.down);
      labelled.push([up, T.up], [down, T.down]);
      rename(title);
      spec.complete?.(ctx, p, rename);
      return h('li', { class: 'order-row', 'data-id': p.id }, spec.icon(p), txt, h('span', { class: 'order-btns' }, up, down));
    }
    const remove = h('button', { type: 'button', class: 'btn btn-danger btn-small' }, T.removePick);
    labelled.push([remove, T.removePick]);
    const near = h('input', { type: 'checkbox', checked: !!p.near, 'aria-describedby': nameId });
    near.addEventListener('change', () => void ctx.settings.update((x) => spec.set(x, withNear(spec.list(x), p.id, near.checked))));
    const li = h('li', { class: 'pick-row', 'data-id': p.id }, h('div', { class: 'pick-main' }, spec.icon(p), txt, remove), h('label', { class: 'pick-near' }, near, h('span', null, T.pickNear)));
    remove.addEventListener('click', () => confirmRemove(li, p, () => title, remove));
    rename(title);
    spec.complete?.(ctx, p, rename);
    return li;
  };

  const paint = (moved?: { id: string; dir: -1 | 1 }): void => {
    const items = spec.list(ctx.settings.get());
    drawn = shape(items);
    openBox = null;
    if (items.length < 2) ordering = false;
    list.classList.toggle('ordering', ordering);
    list.replaceChildren(...items.map((p, i) => row(p, i, items)));
    if (!items.length) list.appendChild(h('li', { class: 'small empty-row' }, spec.empty));
    reorder.hidden = items.length < 2;
    reorder.textContent = ordering ? T.done : T.reorder;
    reorder.classList.toggle('btn-primary', ordering);
    reorder.classList.toggle('btn-secondary', !ordering);
    const full = items.length >= spec.max;
    add.hidden = ordering;
    add.disabled = full;
    limit.textContent = full && !ordering ? typo(spec.limit(spec.max)) : '';
    limit.hidden = !limit.textContent;
    if (moved) {
      // Le curseur suit l'élément déplacé (même bouton, ou l'autre s'il est désormais grisé).
      const li = list.querySelector<HTMLElement>(`[data-id="${CSS.escape(moved.id)}"]`);
      const btns = li ? [...li.querySelectorAll<HTMLButtonElement>('button')] : [];
      const same = btns[moved.dir < 0 ? 0 : 1];
      (same && !same.disabled ? same : btns.find((b) => !b.disabled))?.focus();
    }
  };
  reorder.addEventListener('click', () => {
    ordering = !ordering;
    live.say('');
    paint();
    if (!ordering) reorder.focus();
  });
  paint();

  const section = h('section', { class: 'home-picks', 'aria-labelledby': headingId }, h('h2', { id: headingId, 'data-focus': focus }, spec.title), list, reorder, add, limit, live.el);
  // Gare gardée ou retirée ailleurs (★ des départs dans les lunettes de Quai Web, à côté) : la liste suit.
  const stop = ctx.settings.subscribe((s) => {
    if (!section.isConnected) {
      stop();
      return;
    }
    if (shape(spec.list(s)) !== drawn) paint();
  });
  return section;
}

/** Section « Gares » de l'accueil ; `focus` : son titre reçoit le curseur (#/gares). */
export const stationsSection = (ctx: PhoneCtx, focus = false): HTMLElement => pickSection(ctx, STATIONS, focus);

/** Section « Bus, tram, métro » de l'accueil ; `focus` : son titre reçoit le curseur (#/lignes). */
export const linesSection = (ctx: PhoneCtx, focus = false): HTMLElement => pickSection(ctx, LINES, focus);
