/**
 * Gares, arrêts et lignes choisis (PRD-1.2.2 § 4 ; 1.2.6, PRD-1.2.6 § 1 et § 5) : « Gares de train », « Arrêts de bus,
 * tram, métro » et « Lignes de bus, tram, métro », sur le téléphone et dans l'onglet Réglages de Quai Web. Chacune : ses
 * éléments dans l'ordre choisi (une gare, un arrêt : son nom, ses lignes à leur couleur ; une ligne : sa pastille,
 * « Bus W », son réseau et ses terminus), l'ouverture d'office à moins de 300 m (`near`, revue d'usage n° 4 ; une
 * ligne : seulement si elle a un arrêt repère), le retrait confirmé dans la page, l'ordre (« Monter », « Descendre »,
 * comme pour les favoris), l'ajout ; LIMITS.stations gares, LIMITS.lines arrêts et LIMITS.lines lignes au plus.
 * 1.2.9 (PRD-1.2.9 § 2.2) : chacune a son écran (#/gares, #/arrets, #/lignes ; picksScreen) : la liste dans l'ordre
 * des lunettes, des rangées compactes qui se déplient, et l'ajout dessous (pick-add.ts). Les sections de l'ancien
 * accueil (stationsSection, linesSection, followsSection) restent jusqu'au nouvel accueil.
 * Règles d'ajout (withStation, withLine) partagées avec l'ajout (pick-add.ts) et « Un endroit ».
 */
import type { LinePick, Mode, NameLang, Settings, StationPick } from '../../core/api';
import { lineKey } from '../../core/linepicks';
import { displayName, kindLabel, OP_NAME } from '../../core/util';
import { LIMITS, newId } from '../../settings';
import { header, type PhoneCtx } from '../app';
import { h, icon, ICON, liveRegion, svgNode } from '../dom';
import { lineName, linePickTitle, lineGoneText, lineLimitText, rankText, removeLineText, removeStationText, removeStopText, stationGoneText, stationLimitText, stopGoneText, stopLimitText, T, typo } from '../text';
import { autoNearVia, L, nearViaSub, orderText } from '../text-lists';
import { nextId, switchRow } from '../ui';
import { badgeRow, lineBadge } from '../badges';
import { completeFollow, matchFollow, type LineFollow } from '../../core/linerun';
import { addPanel } from './pick-add';
import '../lists.css';

/** Les trois sections : gares, arrêts (`lines` des réglages, sans `line`), lignes suivies (`follows`). */
export type PickKind = 'stations' | 'lines' | 'follows';

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

/** 1.2.4 : un bloc d'une section (« Arrêts », « Lignes » dans « Bus, tram, métro ») : son intitulé, ses éléments. */
export interface PickGroup<P> {
  label: string;
  has: (p: P) => boolean;
}

/** Éléments rangés par bloc, dans l'ordre des blocs, chacun dans son ordre (le reste, s'il y en a, à la fin). */
export function inGroups<P>(list: readonly P[], groups: readonly PickGroup<P>[]): P[] {
  const out = groups.flatMap((g) => list.filter((p) => g.has(p)));
  return [...out, ...list.filter((p) => !out.includes(p))];
}

/**
 * 1.2.4 (PRD-1.2.4 § 2) : déplacement dans son bloc seulement ; la liste enregistrée est rangée par bloc (l'ordre que
 * montrent les lunettes). Aux bornes du bloc, la liste rangée telle quelle.
 */
export function moveInGroup<P extends { id: string }>(list: P[], id: string, dir: -1 | 1, groups: readonly PickGroup<P>[]): P[] {
  const ordered = inGroups(list, groups);
  const i = ordered.findIndex((x) => x.id === id);
  const j = i + dir;
  const group = groups.find((g) => i >= 0 && g.has(ordered[i]));
  if (i < 0 || j < 0 || j >= ordered.length || !group || !group.has(ordered[j])) return ordered;
  return moveById(ordered, id, dir);
}

/** Ouverture d'office à moins de 300 m : `near: true`, ou rien (jamais `near: false` dans les réglages). */
export function withNear<P extends { id: string; near?: boolean }>(list: P[], id: string, on: boolean): P[] {
  return list.map((x) => {
    if (x.id !== id) return x;
    const { near: _near, ...rest } = x;
    return (on ? { ...rest, near: true } : rest) as P;
  });
}

/* ------------------------------ Noms ------------------------------ */

/** Lignes connues d'un arrêt (core.linesAt), gardées le temps de la visite : mode d'une ligne migrée sans mode. */
const known = new Map<string, Promise<{ line: string; mode: Mode }[]>>();
export function linesAtStop(ctx: Pick<PhoneCtx, 'core'>, areaId: string): Promise<{ line: string; mode: Mode }[]> {
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

/** Pour les tests : oublie les lignes gardées et les lignes de la 1.2.5 déjà cherchées (completeLater). */
export function resetKnownLines(): void {
  known.clear();
  completing.clear();
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
    } else if (modes.length) apply(linePickName(p, lang), kindLabel(p.op, modes));
  });
}

/** 1.2.4 : nom d'un élément de « Bus, tram, métro » : « Bus W · Merbraine » ; un arrêt (toutes les lignes) : son nom seul. */
export const linePickName = (p: LinePick, lang: NameLang): string => (p.line ? linePickTitle(p, lang) : displayName(p.name, lang));

/** 1.2.6 : icône d'une gare, teintée en bleu (le train), distincte des bus, trams et métros. */
export function trainIcon(): HTMLSpanElement {
  const el = icon('train');
  el.classList.add('train');
  return el;
}

/** Icône d'une ligne : bus ou tram (métro compris), selon son mode, sinon son réseau ; 1.2.4 : un arrêt, l'épingle. */
function lineIcon(p: LinePick): HTMLSpanElement {
  if (!p.line) return icon('pin');
  if (p.mode) return icon(p.mode === 'bus' ? 'bus' : 'tram');
  return icon(p.op === 'stib' ? 'tram' : 'bus');
}

/** 1.2.6 : sous une ligne suivie, son réseau et ses terminus (« STIB · Churchill ↔ Esplanade »), sinon « les deux sens ». */
export function followSub(f: LineFollow, lang: NameLang): string {
  const ends = f.ends?.length ? f.ends.map((e) => displayName(e, lang)).join(' ↔ ') : T.bothWays;
  return `${OP_NAME[f.op]} · ${ends}`;
}

/* ------------------------------ Sections de l'accueil ------------------------------ */

/** Un élément d'une rubrique : une gare, un arrêt (ou une ligne à un arrêt, d'avant la 1.2.6), une ligne suivie. */
export type Pickable = StationPick | LinePick | LineFollow;

interface SectionSpec<P extends Pickable> {
  kind: PickKind;
  title: string;
  empty: string;
  add: string;
  addHash: string;
  max: number;
  limit: (max: number) => string;
  question: (name: string, p: P) => string;
  gone: (name: string, p: P) => string;
  list: (s: Settings) => P[];
  set: (s: Settings, list: P[]) => Settings;
  name: (p: P, lang: NameLang) => string;
  icon: (p: P, ctx: PhoneCtx) => HTMLElement;
  complete?: (ctx: PhoneCtx, p: P, apply: (title: string, sub?: string) => void) => void;
  /** 1.2.4 : blocs de la section, chacun sous son intitulé et dans son ordre (« Arrêts », puis « Lignes »). */
  groups?: readonly PickGroup<P>[];
  /** 1.2.6 : texte de « Ouvrir d’office à moins de 300 m » ; null : pas de case (une ligne sans arrêt repère). */
  nearLabel?: (p: P, lang: NameLang) => string | null;
  /* 1.2.9 : écran de la rubrique (PRD-1.2.9 § 2.2). */
  /** Nom de la liste pour les lecteurs d'écran ; bouton de retrait d'une rangée dépliée (« Retirer cette gare »). */
  listLabel: string;
  removeLabel: string;
  /** Nombre compté pour la limite, comme les règles d'ajout (withStation, withLine, ajout d'une ligne). */
  count: (s: Settings) => number;
  /** Sous-titre de « Ouvrir d’office » ; null : pas d'interrupteur (une ligne sans arrêt repère, comme avant). */
  nearSub: (p: P, lang: NameLang) => string | null;
  /** Rangée repliée ouverte d'office : ce qu'elle en dit ; null : rien. */
  autoNear: (p: P, lang: NameLang) => string | null;
}

const STATIONS: SectionSpec<StationPick> = {
  kind: 'stations',
  title: 'Gares de train', // 1.2.6 : le mode dans le titre
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
  // 1.2.6 : les gares de train en bleu, les lignes de bus, tram et métro à leur couleur
  icon: () => trainIcon(),
  listLabel: L.stationsList,
  removeLabel: L.removeStation,
  count: (s) => s.stations.length,
  nearSub: () => L.nearSub,
  autoNear: () => L.autoNear,
};

const LINES: SectionSpec<LinePick> = {
  kind: 'lines',
  // 1.2.6 : les arrêts (toutes leurs lignes) ; les lignes ont leur section (FOLLOWS)
  title: T.stopsTitle,
  empty: T.noStop,
  add: T.addStop,
  addHash: '#/arrets/ajouter',
  max: LIMITS.lines,
  limit: stopLimitText,
  question: (name, p) => (p.line ? removeLineText(name) : removeStopText(name)),
  gone: (name, p) => (p.line ? lineGoneText(name) : stopGoneText(name)),
  list: (s) => s.lines.filter((p) => !p.line),
  set: (s, stops) => ({ ...s, lines: [...stops, ...s.lines.filter((p) => !!p.line)] }),
  name: linePickName,
  icon: lineIcon,
  complete: completeLine,
  listLabel: L.stopsList,
  removeLabel: L.removeStop,
  // comme withLine : tous les éléments de `lines`
  count: (s) => s.lines.length,
  nearSub: () => L.nearSub,
  autoNear: () => L.autoNear,
};

/**
 * 1.2.6 : les lignes suivies, sans arrêt, dans les deux sens : la pastille à la couleur de la ligne, « Bus W », dessous
 * « TEC · Braine-l’Alleud Gare ↔ Bruxelles Midi ». Une ligne reprise de la 1.2.5 (gardée à un arrêt) garde son arrêt en
 * repère, et son « Ouvrir d’office » (les départs de cet arrêt).
 */
const FOLLOWS: SectionSpec<LineFollow> = {
  kind: 'follows',
  title: T.followsTitle,
  empty: T.noFollows,
  add: T.addFollow,
  addHash: '#/lignes/ajouter',
  max: LIMITS.lines,
  limit: lineLimitText,
  question: (name) => removeLineText(name),
  gone: (name) => lineGoneText(name),
  list: (s) => s.follows ?? [],
  set: (s, follows) => ({ ...s, follows }),
  name: (f) => lineName(f),
  icon: (f, ctx) => lineBadge(ctx, f),
  complete: (ctx, f, apply) => {
    apply(lineName(f), followSub(f, ctx.settings.get().lang));
    if (!f.routes.length) void completeLater(ctx, f);
  },
  nearLabel: (f, lang) => (f.via ? `${T.pickNear} de ${displayName(f.via.name, lang)}` : null),
  listLabel: L.followsList,
  removeLabel: L.removeFollow,
  count: (s) => (s.follows ?? []).length,
  // une ligne ne s'ouvre d'office qu'avec son arrêt repère (les départs de cet arrêt)
  nearSub: (f, lang) => (f.via ? nearViaSub(displayName(f.via.name, lang)) : null),
  autoNear: (f, lang) => (f.via ? autoNearVia(displayName(f.via.name, lang)) : null),
};

/** Ce qui se voit d'une liste (ordre, noms, terminus) : un changement venu d'ailleurs (lunettes de Quai Web) la redessine. */
const shape = (list: readonly Pickable[]): string =>
  JSON.stringify(list.map((p) => [p.id, 'areaId' in p ? p.areaId : '', 'line' in p ? p.line ?? '' : '', 'ends' in p ? (p.ends?.length ?? 0) : 0, 'mode' in p ? p.mode ?? '' : '']));

function pickSection<P extends Pickable>(ctx: PhoneCtx, spec: SectionSpec<P>, focus: boolean): HTMLElement {
  const headingId = `h-${spec.kind}`;
  // 1.2.4 : une liste par bloc (« Arrêts », « Lignes »), chacune sous son intitulé ; une seule sans blocs (« Gares »).
  const list = h('div', { class: 'pick-lists' });
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
    const box = h('div', { class: 'confirm', role: 'group', 'aria-labelledby': qid }, h('p', { id: qid, class: 'confirm-q' }, typo(spec.question(title(), p))), h('div', { class: 'confirm-actions' }, yes, no));
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
      // rang à l'écran (1.2.4 : les blocs « Arrêts » puis « Lignes »), pas dans l'ordre des réglages
      const at = [...list.querySelectorAll<HTMLElement>('.pick-row')].indexOf(li);
      openBox = null;
      await ctx.settings.update((x) => spec.set(x, spec.list(x).filter((y) => y.id !== p.id)));
      paint();
      live.say(typo(spec.gone(name, p)));
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
        await ctx.settings.update((x) => spec.set(x, spec.groups ? moveInGroup(spec.list(x), p.id, dir, spec.groups) : moveById(spec.list(x), p.id, dir)));
        live.say(typo(rankText(title, i + dir + 1, all.length)));
        paint({ id: p.id, dir });
      };
      const up = h('button', { type: 'button', class: 'btn btn-secondary btn-small', disabled: i === 0, onclick: move(-1) }, T.up);
      const down = h('button', { type: 'button', class: 'btn btn-secondary btn-small', disabled: i === all.length - 1, onclick: move(1) }, T.down);
      labelled.push([up, T.up], [down, T.down]);
      rename(title);
      spec.complete?.(ctx, p, rename);
      return h('li', { class: 'order-row', 'data-id': p.id }, spec.icon(p, ctx), txt, h('span', { class: 'order-btns' }, up, down));
    }
    const remove = h('button', { type: 'button', class: 'btn btn-danger btn-small' }, T.removePick);
    labelled.push([remove, T.removePick]);
    const nearText = spec.nearLabel ? spec.nearLabel(p, s.lang) : T.pickNear;
    const near = h('input', { type: 'checkbox', checked: !!p.near, 'aria-describedby': nameId });
    near.addEventListener('change', () => void ctx.settings.update((x) => spec.set(x, withNear(spec.list(x), p.id, near.checked))));
    const li = h('li', { class: 'pick-row', 'data-id': p.id }, h('div', { class: 'pick-main' }, spec.icon(p, ctx), txt, remove), nearText ? h('label', { class: 'pick-near' }, near, h('span', null, nearText)) : null);
    remove.addEventListener('click', () => confirmRemove(li, p, () => title, remove));
    rename(title);
    spec.complete?.(ctx, p, rename);
    // 1.2.6 : un arrêt montre ses lignes, chacune à sa couleur
    if (spec.kind === 'lines' && !(p as LinePick).line) {
      const lp = p as LinePick;
      void linesAtStop(ctx, lp.areaId).then((ls) => {
        if (ls.length) txt.append(badgeRow(ctx, lp.op, ls));
      });
    }
    return li;
  };

  const paint = (moved?: { id: string; dir: -1 | 1 }): void => {
    const items = spec.list(ctx.settings.get());
    drawn = shape(items);
    openBox = null;
    const parts = spec.groups ? spec.groups.map((g) => ({ label: g.label, list: items.filter((p) => g.has(p)) })).filter((x) => x.list.length) : [{ label: '', list: items }];
    // « Changer l'ordre » : dans un bloc d'au moins deux éléments
    const movable = parts.some((x) => x.list.length > 1);
    if (!movable) ordering = false;
    const els: HTMLElement[] = [];
    for (const part of parts) {
      if (part.label) els.push(h('h3', { class: 'pick-group' }, part.label));
      els.push(h('ul', { class: `list box pick-list${ordering ? ' ordering' : ''}` }, ...part.list.map((p, i) => row(p, i, part.list))));
    }
    if (!items.length) els.splice(0, els.length, h('ul', { class: 'list box pick-list' }, h('li', { class: 'small empty-row' }, spec.empty)));
    list.replaceChildren(...els);
    reorder.hidden = !movable;
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

/** Section « Gares de train » de l'accueil ; `focus` : son titre reçoit le curseur (#/gares). */
export const stationsSection = (ctx: PhoneCtx, focus = false): HTMLElement => pickSection(ctx, STATIONS, focus);

/** Section « Arrêts de bus, tram, métro » de l'accueil (1.2.6 ; avant : « Bus, tram, métro ») ; `focus` : #/arrets. */
export const linesSection = (ctx: PhoneCtx, focus = false): HTMLElement => pickSection(ctx, LINES, focus);

/** 1.2.6 : section « Lignes de bus, tram, métro » de l'accueil ; `focus` : son titre reçoit le curseur (#/lignes). */
export const followsSection = (ctx: PhoneCtx, focus = false): HTMLElement => pickSection(ctx, FOLLOWS, focus);

/* ------------------------------ 1.2.9 : écrans Gares, Arrêts, Lignes ------------------------------ */

/** Icônes des rangées (constantes de l'appli, décoratives, à la couleur du texte). */
const glyph = (body: string, size = 20, width = 2): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const GLYPH = {
  chevron: glyph('<path d="M6 9l6 6 6-6"></path>', 16),
  up: glyph('<path d="M12 19V5"></path><path d="M6 11l6-6 6 6"></path>'),
  down: glyph('<path d="M12 5v14"></path><path d="M6 13l6 6 6-6"></path>'),
  trash: glyph('<path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M6 7l1 13h10l1-13"></path><path d="M9 7V4h6v3"></path>', 18),
  auto: glyph('<path d="M3 11l18-8-8 18-2-8z"></path>', 14, 2.4),
};

/** Ce que fait un contrôle d'une rangée (data-act) : le curseur le retrouve quand la liste est redessinée. */
type Act = 'head' | 'near' | 'up' | 'down' | 'remove';

/**
 * 1.2.9 (PRD-1.2.9 § 2.2) : écran d'une rubrique (#/gares, #/arrets, #/lignes) : retour « Accueil », son titre, « Dans
 * tes lunettes, dans cet ordre. » ; la liste dans l'ordre des lunettes, une rangée compacte par élément qui se déplie au
 * toucher (aria-expanded) : « Ouvrir d’office », « Ordre dans les lunettes » avec ↑ et ↓ (règles de « Changer
 * l’ordre »), « Retirer … » confirmé dans la page ; repliée, une rangée ouverte d'office le dit. Dessous, l'ajout
 * (pick-add.ts). `add` (#/…/ajouter), ou une rubrique vide : le titre de l'ajout reçoit le curseur (data-focus).
 */
export function picksScreen(ctx: PhoneCtx, kind: PickKind, opts: { add?: boolean } = {}): HTMLElement {
  if (kind === 'stations') return listScreen(ctx, STATIONS, opts);
  if (kind === 'lines') return listScreen(ctx, LINES, opts);
  return listScreen(ctx, FOLLOWS, opts);
}

function listScreen<P extends Pickable>(ctx: PhoneCtx, spec: SectionSpec<P>, opts: { add?: boolean }): HTMLElement {
  const lists = h('div', { class: 'pick-lists' });
  const live = liveRegion();
  /** Rangées dépliées, gardées quand la liste est redessinée (ordre, changement venu d'ailleurs). */
  const open = new Set<string>();
  let drawn = '';
  /** Confirmation de retrait ouverte (une seule à la fois). */
  let openBox: (() => void) | null = null;
  const addId = nextId('ajout');
  const empty = !spec.list(ctx.settings.get()).length;
  const addHead = h('h2', { id: addId, class: 'pick-add-title', tabindex: '-1', 'data-focus': !!opts.add || empty }, spec.add);
  const limit = h('p', { class: 'msg err', role: 'status' });

  const heads = (): HTMLElement[] => [...lists.querySelectorAll<HTMLElement>('[data-act="head"]')];
  /** Curseur sur un contrôle d'une rangée ; grisé : l'autre flèche, sinon la rangée elle-même. */
  const focusIn = (id: string, act: Act): boolean => {
    const li = lists.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    if (!li) return false;
    const usable = (a: Act | null): HTMLElement | null => {
      const el = a ? li.querySelector<HTMLButtonElement>(`[data-act="${a}"]`) : null;
      return el && !el.disabled && !el.hidden ? el : null;
    };
    const el = usable(act) ?? usable(act === 'up' ? 'down' : act === 'down' ? 'up' : null) ?? usable('head');
    el?.focus();
    return !!el;
  };
  /** Curseur sur l'élément de la liste qui répond à `is` (un ajout), sinon sur le titre de l'ajout. */
  const reveal = (is: (p: Pickable) => boolean): void => {
    const p = spec.list(ctx.settings.get()).find((x) => is(x));
    if (!p || !focusIn(p.id, 'head')) addHead.focus();
  };
  const paintLimit = (s: Settings): void => {
    const full = spec.count(s) >= spec.max;
    limit.textContent = full ? typo(spec.limit(spec.max)) : '';
    limit.hidden = !full;
  };

  /** Retrait confirmé dans la page (S6) : la question, « Retirer » et « Annuler » à la place du bouton. */
  const confirmRemove = (p: P, title: () => string, trigger: HTMLButtonElement, holder: HTMLElement, head: HTMLElement): void => {
    openBox?.();
    const qid = nextId('confirm');
    const yes = h('button', { type: 'button', class: 'btn btn-danger-solid' }, T.removePick);
    const no = h('button', { type: 'button', class: 'btn btn-secondary' }, T.cancel);
    const box = h('div', { class: 'confirm', role: 'group', 'aria-labelledby': qid }, h('p', { id: qid, class: 'confirm-q' }, typo(spec.question(title(), p))), h('div', { class: 'confirm-actions' }, yes, no));
    const close = (): void => {
      box.remove();
      trigger.hidden = false;
      if (openBox === close) openBox = null;
    };
    openBox = close;
    trigger.hidden = true;
    holder.appendChild(box);
    no.focus();
    no.addEventListener('click', () => {
      close();
      trigger.focus();
    });
    yes.addEventListener('click', async () => {
      yes.disabled = true;
      const name = title();
      // rang à l'écran, pas dans l'ordre des réglages (blocs)
      const at = heads().indexOf(head);
      openBox = null;
      open.delete(p.id);
      await ctx.settings.update((x) => spec.set(x, spec.list(x).filter((y) => y.id !== p.id)));
      if (shape(spec.list(ctx.settings.get())) !== drawn) paint();
      live.say(typo(spec.gone(name, p)));
      // Le curseur passe à la rangée suivante (ou à la précédente), sinon au titre de l'ajout.
      const rest = heads();
      (rest[Math.min(at, rest.length - 1)] ?? addHead).focus();
    });
  };

  const row = (p: P, i: number, all: P[]): HTMLLIElement => {
    const s = ctx.settings.get();
    let title = spec.name(p, s.lang);
    const nameId = nextId('pick');
    const detailId = nextId('pick-detail');
    const t1 = h('span', { class: 't1', id: nameId }, title);
    const t2 = h('span', { class: 't2', hidden: true });
    const badges = h('span', { class: 'badges-slot', hidden: true });
    const autoText = h('span', null);
    const auto = h('span', { class: 'pick-auto', hidden: true }, svgNode(GLYPH.auto), autoText);
    const head = h(
      'button',
      { type: 'button', class: 'pick-head', 'aria-expanded': 'false', 'aria-controls': detailId, 'data-act': 'head' },
      spec.icon(p, ctx),
      h('span', { class: 'txt' }, t1, t2, badges, auto),
      h('span', { class: 'pick-chev' }, svgNode(GLYPH.chevron)),
    );
    const detail = h('div', { id: detailId, class: 'pick-detail', hidden: true });
    const li = h('li', { class: 'pick-item', 'data-id': p.id }, head, detail);
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
    /** Repliée et ouverte d'office, elle le dit (d'après les réglages : l'interrupteur a pu changer). */
    const paintAuto = (): void => {
      const st = ctx.settings.get();
      const cur = spec.list(st).find((x) => x.id === p.id) ?? p;
      const text = cur.near ? spec.autoNear(cur, st.lang) : null;
      autoText.textContent = text ? typo(text) : '';
      auto.hidden = !text || open.has(p.id);
    };

    // « Ouvrir d’office » : enregistré tout de suite, la liste n'est pas redessinée (l'interrupteur garde le curseur)
    const sub = spec.nearSub(p, s.lang);
    if (sub !== null) {
      const sw = switchRow({
        label: L.near,
        sub: typo(sub),
        checked: !!p.near,
        onChange: (on) => {
          void ctx.settings.update((x) => spec.set(x, withNear(spec.list(x), p.id, on)));
          paintAuto();
        },
      });
      const input = sw.querySelector('input')!;
      input.setAttribute('aria-describedby', nameId);
      input.dataset.act = 'near';
      detail.append(sw);
    }
    // « Ordre dans les lunettes » : dans un bloc d'au moins deux éléments, comme « Changer l’ordre »
    if (all.length > 1) {
      const move = (dir: -1 | 1) => async (): Promise<void> => {
        await ctx.settings.update((x) => spec.set(x, spec.groups ? moveInGroup(spec.list(x), p.id, dir, spec.groups) : moveById(spec.list(x), p.id, dir)));
        if (shape(spec.list(ctx.settings.get())) !== drawn) paint();
        live.say(typo(rankText(title, i + dir + 1, all.length)));
        // Le curseur suit l'élément déplacé (même flèche, ou l'autre si celle-ci est désormais grisée).
        focusIn(p.id, dir < 0 ? 'up' : 'down');
      };
      const up = h('button', { type: 'button', class: 'pick-move', 'data-act': 'up', disabled: i === 0, onclick: move(-1) }, svgNode(GLYPH.up));
      const down = h('button', { type: 'button', class: 'pick-move', 'data-act': 'down', disabled: i === all.length - 1, onclick: move(1) }, svgNode(GLYPH.down));
      labelled.push([up, T.up], [down, T.down]);
      detail.append(
        h(
          'div',
          { class: 'pick-opt' },
          h('span', { class: 'cc' }, h('span', { class: 'c1' }, L.order), h('span', { class: 'c2' }, orderText(i + 1, all.length))),
          h('span', { class: 'pick-moves' }, up, down),
        ),
      );
    }
    // « Retirer cette gare » : confirmé dans la page ; le nom de l'élément le décrit (lecteurs d'écran)
    const remove = h('button', { type: 'button', class: 'pick-remove', 'data-act': 'remove', 'aria-describedby': nameId }, svgNode(GLYPH.trash), h('span', null, spec.removeLabel));
    const removeBox = h('div', { class: 'pick-remove-row' }, remove);
    detail.append(removeBox);
    remove.addEventListener('click', () => confirmRemove(p, () => title, remove, removeBox, head));

    const setOpen = (on: boolean): void => {
      if (on) open.add(p.id);
      else {
        open.delete(p.id);
        // repliée : sa confirmation de retrait est abandonnée
        if (removeBox.querySelector('.confirm')) openBox?.();
      }
      head.setAttribute('aria-expanded', String(on));
      detail.hidden = !on;
      li.classList.toggle('open', on);
      paintAuto();
    };
    head.addEventListener('click', () => setOpen(!open.has(p.id)));
    setOpen(open.has(p.id));
    rename(title);
    spec.complete?.(ctx, p, rename);
    // un arrêt montre ses lignes, chacune à sa couleur (comme avant)
    if (spec.kind === 'lines' && !(p as LinePick).line) {
      const lp = p as LinePick;
      void linesAtStop(ctx, lp.areaId).then((ls) => {
        if (ls.length) badges.replaceWith(badgeRow(ctx, lp.op, ls));
      });
    }
    return li;
  };

  const paint = (): void => {
    const s = ctx.settings.get();
    const items = spec.list(s);
    // curseur dans la liste : il reste sur le même contrôle de la même rangée
    const active = document.activeElement instanceof HTMLElement && lists.contains(document.activeElement) ? document.activeElement : null;
    const keep = active ? { id: active.closest<HTMLElement>('[data-id]')?.dataset.id, act: (active.dataset.act ?? 'head') as Act } : null;
    drawn = shape(items);
    openBox = null;
    for (const id of [...open]) if (!items.some((p) => p.id === id)) open.delete(id);
    const parts = spec.groups ? spec.groups.map((g) => ({ label: g.label, list: items.filter((p) => g.has(p)) })).filter((x) => x.list.length) : [{ label: '', list: items }];
    const els: HTMLElement[] = [];
    for (const part of parts) {
      if (part.label) els.push(h('h2', { class: 'pick-group' }, part.label));
      els.push(h('ul', { class: 'list box pick-list pick-items', 'aria-label': part.label || spec.listLabel }, ...part.list.map((p, i) => row(p, i, part.list))));
    }
    if (!items.length) els.splice(0, els.length, h('ul', { class: 'list box pick-list' }, h('li', { class: 'small empty-row' }, spec.empty)));
    lists.replaceChildren(...els);
    paintLimit(s);
    if (keep?.id) focusIn(keep.id, keep.act);
  };
  paint();

  const lead = spec.kind === 'follows' ? `${L.lead} ${L.leadFollows}` : L.lead;
  const screen = h(
    'div',
    { class: 'screen lists-screen' },
    header(ctx, spec.title, lead, { label: 'Accueil', hash: '#/' }),
    lists,
    live.el,
    h('section', { class: 'pick-add-section', 'aria-labelledby': addId }, addHead, limit, addPanel(ctx, spec.kind, { reveal })),
  );
  // Un ajout dessous, un élément gardé ou retiré ailleurs (★ des lunettes de Quai Web) : la liste suit. Avant d'être
  // dans la page (le routeur attend l'écran), elle suit aussi ; retirée de la page, ou jamais posée (le routeur est
  // passé à un autre écran), elle ne suit plus.
  let seen = false;
  const stop = ctx.settings.subscribe((s) => {
    if (screen.isConnected) seen = true;
    else if (seen) {
      stop();
      return;
    }
    paintLimit(s);
    if (shape(spec.list(s)) !== drawn) paint();
  });
  setTimeout(() => {
    if (screen.isConnected) seen = true;
    else if (!seen) stop();
  }, 0);
  return screen;
}

/** Lignes reprises de la 1.2.5 en cours de complément (une seule recherche par ligne). */
const completing = new Set<string>();

/**
 * 1.2.6 : une ligne gardée à un arrêt en 1.2.5 n'a pas encore ses variantes ni ses terminus : on la retrouve près de son
 * ancien arrêt (son repère) et on les garde, pour l'afficher « STIB · Churchill ↔ Esplanade ». Au mieux.
 */
export async function completeLater(ctx: PhoneCtx, f: LineFollow): Promise<void> {
  if (completing.has(f.id)) return;
  completing.add(f.id);
  try {
    const core = await ctx.core();
    const near = f.via ? { lat: f.via.lat, lon: f.via.lon } : undefined;
    const m = matchFollow(f, await core.findLines(f.line, near));
    if (!m) return;
    const done = completeFollow(f, m);
    await ctx.settings.update((x) => ({ ...x, follows: (x.follows ?? []).map((q) => (q.id === f.id && !q.routes.length ? done : q)) }));
  } catch {
    completing.delete(f.id);
  }
}
