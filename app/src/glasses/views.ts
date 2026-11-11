/**
 * Modèles de vue des écrans des lunettes (PRD 1.1 § 6.1, maquettes Visite1-3 pour la 1.0). Fonctions pures :
 * données du cœur + réglages + heure → GlassesView. Testables sans SDK.
 */
import type { Board, CoreStatus, Departure, Favorite, FavoriteAnswer, Journey, Leg, NameLang, NearbyItem, Settings } from '../core/api';
import { LABEL_TEXT, labelOf } from '../core/api';
import { favoriteTitle, placesOf } from '../core/favorites';
import { shortAddress } from '../core/text';
import { OP_NAME, areaLabel, displayName, hhmm, lineLabel, minutesUntil } from '../core/util';
import { normalizeForSearch } from '../../../shared/names';
import { textWidth, truncate } from './font';
import { geometry, maxTop, WIDTHS } from './layout';
import type { AreaRef, GlassesView, Intent, Item, Route, StepsRoute, TopLine } from './types';
import {
  HINTS,
  LAST_MARK,
  NB,
  NOTE_OFFLINE,
  NOTE_PLANNED,
  NOTE_RT_DOWN,
  atTitle,
  boardTitle,
  dayWord,
  distanceText,
  headText,
  journeyStart,
  lowerFirst,
  minText,
  minutesText,
  nextText,
  plannedMark,
  platformText,
  spanText,
  stopAnswerLine,
  stopsCount,
  towards,
  trainCell,
  tripAnswerLine,
  vehicleLong,
  vehicleOf,
  walkMinOf,
  withDay,
} from './format';

export interface ViewCtx {
  now: number;
  settings: Settings;
  /** Horaires périmés (dataFreshness, ok = false) : message affiché à la place des listes vides. */
  stale?: string;
  /** Quai Web : les réglages sont dans l'onglet Réglages de la page, pas dans l'appli du téléphone. */
  web?: boolean;
  /** État du temps réel (core.status()) : « Temps réel indisponible » ou « Pas de réseau ». */
  rt?: CoreStatus['rt'];
}

const lang = (c: ViewCtx): NameLang => c.settings.lang;
const mp = (c: ViewCtx): boolean => c.settings.display.markPlanned;
const hints = (c: ViewCtx, text: string): string => (c.settings.display.gestureHints ? text : '');

function base(screen: GlassesView['screen'], layout: GlassesView['layout'], title: string, ctx: ViewCtx): GlassesView {
  return { screen, layout, title, clock: hhmm(ctx.now), items: [], hints: '' };
}

/** Note d'une liste quand le temps réel manque : panne des sources ou téléphone hors ligne (M8.5). */
function noRtNote(ctx: ViewCtx): string {
  return ctx.rt === 'offline' ? NOTE_OFFLINE : NOTE_RT_DOWN;
}

/* ------------------------------ Messages ------------------------------ */

export function messageView(
  title: string,
  lines: string[],
  ctx: ViewCtx,
  opts: { hints?: string; tap?: Intent; screen?: GlassesView['screen'] } = {},
): GlassesView {
  const v = base(opts.screen ?? 'message', 'message', title, ctx);
  v.items = lines.map((a) => ({ a }));
  v.hints = opts.hints ? hints(ctx, opts.hints) : '';
  if (opts.tap) v.tap = opts.tap;
  return v;
}

export function loadingView(title: string, text: string, ctx: ViewCtx, screen?: GlassesView['screen']): GlassesView {
  return messageView(title, [text], ctx, { hints: HINTS.message, screen });
}

/** Erreur avec « toucher : réessayer » ; à l'écran racine (lancement), le double toucher quitte (S2). */
export function errorView(title: string, text: string, ctx: ViewCtx, opts: { root?: boolean } = {}): GlassesView {
  const h = opts.root ? (ctx.web ? HINTS.retryWeb : HINTS.retryRoot) : HINTS.retry;
  return messageView(title, [text], ctx, { hints: h, tap: { kind: 'retry' } });
}

export function firstRunView(ctx: ViewCtx): GlassesView {
  if (ctx.web) {
    return messageView(
      'Quai',
      [`Bienvenue dans Quai${NB}!`, `Termine les réglages dans l’onglet Réglages${NB}:`, 'position, langue et tes lieux, en une minute.'],
      ctx,
      { hints: HINTS.firstRunWeb, tap: { kind: 'continue' } },
    );
  }
  return messageView(
    'Quai',
    [`Bienvenue dans Quai${NB}!`, `Termine les réglages sur le téléphone${NB}:`, 'appli Even Realities, onglet Even Hub, Quai.', 'Position, langue et tes lieux, en une minute.'],
    ctx,
    { hints: HINTS.firstRun, tap: { kind: 'continue' } },
  );
}

/** Titre du message de nouveautés (une fois, après la mise à jour depuis la 1.0 ou la 1.1). */
export const NEWS_TITLE = 'Quai 1.2';

/** Lignes du message « Quai 1.2 » (PRD-1.2 § 2.3), les mêmes sur Quai Web. */
export function newsLines(): string[] {
  return [`Nouveau${NB}: le trajet le plus court d’abord.`, 'Tes lieux sont maintenant dans tes favoris.', `Sur un trajet, ▼${NB}: un autre trajet.`];
}

/** Message « Quai 1.2 » : toucher mène à l'accueil. */
export function newsView(ctx: ViewCtx): GlassesView {
  return messageView(NEWS_TITLE, newsLines(), ctx, { hints: HINTS.news, tap: { kind: 'continue' } });
}

export function notConfiguredView(ctx: ViewCtx): GlassesView {
  return messageView(
    'Quai',
    ['Quai n’est pas encore configuré.', `Adresses des horaires et du relais absentes${NB}:`, 'voir le README, « npm run configure ».'],
    ctx,
    { hints: HINTS.quit },
  );
}

/** Position inconnue (inchangé 1.0). */
export function noLocationView(title: string, ctx: ViewCtx): GlassesView {
  const lines = ctx.web
    ? ['Position indisponible.', 'Autorise-la dans le navigateur, ou choisis un arrêt sous l’écran (rubrique Position).']
    : ['Position indisponible.', 'Autorise la position pour Quai dans l’appli Even.'];
  return messageView(title, lines, ctx, { hints: HINTS.retry, tap: { kind: 'retry' } });
}

/** Destination demandée alors qu'on y est déjà : « Tu es déjà au bureau. » (inchangé). */
export function alreadyThereView(title: string, ctx: ViewCtx): GlassesView {
  return messageView(title, [`Tu es déjà ${atTitle(title)}.`], ctx, { hints: HINTS.message });
}

/* ------------------------------ Favoris (accueil et liste) ------------------------------ */

/** Un favori et sa dernière réponse connue (absente : en calcul, « … »). */
export interface FavoriteEntry {
  fav: Favorite;
  answer?: FavoriteAnswer;
}

/** Libellé d'un arrêt favori : celui de « Autour de moi » (« Gare du Nord, tram »). */
export function stopFavoriteLabel(f: Extract<Favorite, { kind: 'stop' }>, answer: FavoriteAnswer | undefined, l: NameLang): string {
  if (answer?.board) return areaLabel(answer.board.area, l);
  if (f.op === 'sncb') return `${displayName(f.name, l)}, train`;
  return displayName(f.name, l);
}

/**
 * Élément d'un favori sur deux lignes (L1) ; `planned` : un « ~ » est montré. Un lieu (1.2) paraît comme le trajet
 * « Ma position → lieu » de la 1.1 : « Vers le bureau », puis la réponse du trajet.
 */
export function favoriteItem(e: FavoriteEntry, ctx: ViewCtx): { item: Item; planned: boolean } {
  const f = e.fav;
  const line = f.kind === 'stop' ? stopAnswerLine(e.answer, ctx.now, ctx.settings) : tripAnswerLine(e.answer, ctx.now, ctx.settings);
  const a = f.kind === 'stop' ? stopFavoriteLabel(f, e.answer, lang(ctx)) : favoriteTitle(f, ctx.settings);
  const item: Item = { a, c: line.right, action: { kind: 'openFavorite', id: f.id } };
  if (line.tail) item.cTail = line.tail;
  if (line.second) item.b2 = line.second;
  else if (line.two) item.two = true;
  return { item, planned: line.planned };
}

/* ------------------------------ Accueil ------------------------------ */

export interface HomeData {
  /** Favoris en tête (2 au plus), dans l'ordre intelligent. */
  favorites?: FavoriteEntry[];
  /** Ordre complet des favoris, figé pendant l'affichage (journal `order`). */
  order?: string[];
  /** Nombre de favoris qui ne sont pas en tête (« Autres favoris   {n} »). */
  others?: number;
  /** « Accueil sans favoris » (réglage) : pas de favoris en tête, « Mes favoris   {n} ». */
  noFavorites?: boolean;
  nearbyCount?: number;
  /** Position inconnue : « Autour de moi   sans position ». */
  noPosition?: boolean;
  /** Lieu proche pour la ligne de contexte (« Près de Bruxelles-Nord »), seulement sans favoris en tête. */
  near?: string;
  /** Message de données périmées (dataFreshness, ok = false) : ligne forte. */
  stale?: string;
  /** Avertissement non bloquant (dataFreshness, ok = true avec message) : ligne discrète. */
  notice?: string;
  /** Trajet en cours (M6) : « En cours : vers le bureau » et l'étape suivante. */
  running?: { title: string; next: string };
}

export function homeView(d: HomeData, ctx: ViewCtx): GlassesView {
  const v = base('home', 'menu', 'Quai', ctx);
  const total = ctx.settings.favorites.length;
  let planned = false;
  if (d.running) {
    v.items.push({ a: `En cours${NB}: ${lowerFirst(d.running.title)}`, c: d.running.next, action: { kind: 'resume' } });
  }
  const shown = !d.noFavorites && total > 0 ? (d.favorites ?? []).slice(0, 2) : [];
  if (!total) {
    v.items.push({ a: 'Ajouter un favori', action: { kind: 'open', route: { screen: 'favorites' } } });
  }
  for (const e of shown) {
    const { item, planned: p } = favoriteItem(e, ctx);
    if (p) planned = true;
    v.items.push(item);
  }
  v.items.push({ a: 'Autour de moi', c: d.noPosition ? 'sans position' : stopsCount(d.nearbyCount), action: { kind: 'open', route: { screen: 'nearby' } } });
  if (total && shown.length) {
    const others = d.others ?? Math.max(0, total - shown.length);
    const exclude = shown.map((e) => e.fav.id);
    if (others > 0) v.items.push({ a: 'Autres favoris', c: String(others), action: { kind: 'open', route: { screen: 'favorites', exclude } } });
  } else if (total) {
    v.items.push({ a: 'Mes favoris', c: String(total), action: { kind: 'open', route: { screen: 'favorites' } } });
  }
  v.items.push({ a: 'Aller à…', action: { kind: 'open', route: { screen: 'places' } } });
  if (d.stale) v.top = { text: d.stale, strong: true };
  else if (d.notice) v.top = { text: d.notice };
  else if (ctx.rt === 'down' || ctx.rt === 'offline') v.top = { text: noRtNote(ctx) };
  else if (!shown.length && d.near) v.top = { text: `Près de ${d.near}` };
  if (planned && mp(ctx)) v.note = NOTE_PLANNED;
  v.hints = hints(ctx, ctx.web ? HINTS.homeWeb : HINTS.home);
  v.log = { order: d.order ?? shown.map((e) => e.fav.id) };
  return v;
}

/* ------------------------------ Autres favoris, Mes favoris ------------------------------ */

export interface FavoritesData {
  /** Favoris de la liste, dans l'ordre figé à l'ouverture. Absent : tous les favoris, dans l'ordre du téléphone. */
  entries?: FavoriteEntry[];
  /** « Autres favoris » (depuis l'accueil avec favoris) ou « Mes favoris ». */
  title?: string;
}

/** Liste de favoris vide (L2) : comment en ajouter un depuis les lunettes ou le téléphone (1.2 : « un favori »). */
export function emptyFavoritesLines(web = false): string[] {
  return ['Aucun favori pour l’instant.', 'Ouvre un arrêt dans Autour de moi et touche-le,', web ? 'ou ajoute un favori dans l’onglet Réglages.' : 'ou ajoute un favori sur le téléphone.'];
}

export function favoritesView(d: FavoritesData, ctx: ViewCtx): GlassesView {
  const favs = ctx.settings.favorites;
  const title = d.title ?? 'Mes favoris';
  if (!favs.length) return messageView('Mes favoris', emptyFavoritesLines(ctx.web), ctx, { hints: HINTS.message });
  const entries = d.entries ?? favs.map((fav) => ({ fav }));
  const v = base('favorites', 'menu', title, ctx);
  let planned = false;
  for (const e of entries) {
    const { item, planned: p } = favoriteItem(e, ctx);
    if (p) planned = true;
    v.items.push(item);
  }
  v.note = ctx.stale ?? (planned && mp(ctx) ? NOTE_PLANNED : undefined);
  v.reserveNote = true;
  v.hints = hints(ctx, HINTS.favorites);
  v.log = { order: entries.map((e) => e.fav.id) };
  return v;
}

/** Libellé d'un favori dans une phrase (1.0, téléphone). */
export function favoriteLabel(f: Favorite, settings: Settings): string {
  if (f.kind === 'stop') return `${displayName(f.name, settings.lang)} (${OP_NAME[f.op]})`;
  return favoriteTitle(f, settings);
}

/* ------------------------------ Autour de moi ------------------------------ */

export function nearbyView(list: NearbyItem[], ctx: ViewCtx): GlassesView {
  const radius = ctx.settings.display.radiusM;
  if (!list.length) {
    return messageView('Autour de moi', [`Aucun arrêt dans un rayon de ${radius}${NB}m`], ctx, { hints: HINTS.message });
  }
  const v = base('nearby', 'nearby', 'Autour de moi', ctx);
  let planned = false;
  for (const it of list) {
    if (it.next && !it.next.rt && !it.next.cancelled) planned = true;
    v.items.push({
      a: areaLabel(it.area, lang(ctx)),
      b: distanceText(it.distanceM),
      c: nextText(it.next, ctx.now, mp(ctx)),
      cTail: lastMark(it.next),
      action: { kind: 'open', route: { screen: 'board', areaId: it.area.id, name: it.area.n } },
    });
  }
  v.note = ctx.stale ?? (planned && mp(ctx) ? NOTE_PLANNED : undefined);
  v.reserveNote = true;
  v.hints = hints(ctx, HINTS.nearby);
  return v;
}

/* ------------------------------ Départs d'un arrêt ------------------------------ */

/** Titre des départs : « Gare du Nord, tram et bus (STIB) » ; « ★ » à la fin pour un favori ; nom long coupé. */
export function boardViewTitle(b: Pick<Board, 'area'>, l: NameLang, isFavorite: boolean): string {
  const full = `${boardTitle(b.area, l)}${isFavorite ? ' ★' : ''}`;
  if (textWidth(full) <= WIDTHS.title) return full;
  const name = displayName(b.area.n, l);
  const tail = full.slice(name.length);
  return `${truncate(name, WIDTHS.title - textWidth(tail))}${tail}`;
}

export function boardView(b: Board, ctx: ViewCtx, opts: { isFavorite: boolean; limit?: number }): GlassesView {
  const train = b.area.modes.includes('train') && b.area.op === 'sncb';
  const v = base('board', train ? 'boardTrain' : 'board', boardViewTitle(b, lang(ctx), opts.isFavorite), ctx);
  const deps = b.departures.slice(0, opts.limit ?? ctx.settings.display.depsPerStop);
  const fav: Intent = { kind: 'toggleFavoriteStop' };
  let planned = false;
  let msg: string | undefined;
  // Tous les départs le lendemain (S6) : une seule ligne « Départs de demain » au lieu de « demain, » partout.
  const whenOf = (d: Departure): number => (train ? d.sched : d.est);
  const allTomorrow = deps.length > 0 && deps.every((d) => dayWord(whenOf(d), ctx.now) === 'demain');
  for (const d of deps) {
    if (!d.rt && !d.cancelled) planned = true;
    if (d.msg && !msg) msg = d.msg;
    // heure d'un autre jour (trains, ou bus au-delà d'une heure) : « demain, » devant la destination
    const later = train || minutesUntil(d.est, ctx.now) >= 60;
    const plain = headText(d.head, lang(ctx), d.op);
    const head = later && !allTomorrow ? withDay(plain, whenOf(d), ctx.now) : plain;
    v.items.push(
      train
        ? { a: d.line, b: head, c: trainCell(d, mp(ctx)) }
        : { a: lineLabel(d.mode, d.line), b: head, bTail: lastMark(d), c: minutesText(d, ctx.now, mp(ctx)) },
    );
  }
  if (!deps.length) v.items.push({ a: ctx.stale ?? 'Aucun départ dans les prochaines heures' });
  if (msg) v.top = { text: `! ${msg}`, strong: true };
  else if (allTomorrow) v.top = { text: 'Départs de demain' };
  if (b.rtErrors.length) v.note = noRtNote(ctx);
  else if (planned && mp(ctx)) v.note = NOTE_PLANNED;
  v.reserveNote = true;
  v.scroll = true;
  v.hints = hints(ctx, opts.isFavorite ? HINTS.boardFav : HINTS.board);
  v.tap = fav;
  return v;
}

/** « , dernier » pour le dernier passage annoncé d'une ligne (jamais pour un départ supprimé). */
export function lastMark(d: Pick<Departure, 'last' | 'cancelled'> | Pick<Leg, 'last' | 'cancelled'> | undefined): string | undefined {
  return d?.last && !d.cancelled ? LAST_MARK : undefined;
}

/* ------------------------------ Aller à… ------------------------------ */

/** Clé d'une adresse récente dans « Aller à… » (résumés, cache). */
export const recentKey = (label: string): string => `recent:${label}`;

/** Les 3 adresses récentes montrées dans « Aller à… » (S4) : pas celles d'un lieu déjà enregistré. */
export function recentShown(settings: Settings): Settings['recent'] {
  const places = placesOf(settings);
  const placeAddr = new Set(places.map((p) => (p.address ? normalizeForSearch(p.address) : '')).filter(Boolean));
  return settings.recent
    .filter((r) => !placeAddr.has(normalizeForSearch(r.label)) && !places.some((p) => Math.abs(p.lat - r.lat) < 0.0004 && Math.abs(p.lon - r.lon) < 0.0006))
    .slice(0, 3);
}

/** « Aller à… » (L8) : les lieux (« Bureau   arrivée 08:58 »), puis les adresses récentes, puis « Autre adresse ». */
export function placesView(summary: Record<string, string | undefined>, ctx: ViewCtx): GlassesView {
  const v = base('places', 'menu', 'Aller à…', ctx);
  // 1.2 : les lieux sont des favoris, dans l'ordre du téléphone.
  const places = placesOf(ctx.settings);
  for (const p of places) {
    v.items.push({
      a: p.label,
      c: summary[p.id] ?? '…',
      action: { kind: 'go', key: p.id, to: { type: 'place', placeId: p.id }, label: p.label },
    });
  }
  for (const r of recentShown(ctx.settings)) {
    const key = recentKey(r.label);
    const short = shortAddress(r.label);
    const to = r.approx ? { type: 'address' as const, label: r.label, lat: r.lat, lon: r.lon, approx: true } : { type: 'address' as const, label: r.label, lat: r.lat, lon: r.lon };
    v.items.push({ a: short, c: summary[key] ?? '…', action: { kind: 'go', key, to, label: short } });
  }
  if (ctx.web) {
    // Quai Web : l'onglet Réglages est sur la même page, le toucher l'ouvre directement (1.2 : « Nouveau favori »).
    if (!places.length) {
      v.items.push({ a: 'Aucun lieu enregistré', c: 'dans Réglages', action: { kind: 'phone', hash: '#/favoris/nouveau', text: 'Ajoute Maison ou Bureau dans l’onglet Réglages' } });
    }
    v.items.push({ a: 'Autre adresse', c: 'dans Réglages', action: { kind: 'phone', hash: '#/recherche', text: 'Tape l’adresse dans l’onglet Réglages' } });
  } else {
    if (!places.length) {
      v.items.push({ a: 'Aucun lieu enregistré', c: 'sur le téléphone', action: { kind: 'toast', text: 'Ajoute Maison ou Bureau dans Quai, sur le téléphone' } });
    }
    v.items.push({ a: 'Autre adresse', c: 'sur le téléphone', action: { kind: 'toast', text: 'Tape l’adresse dans Quai, sur le téléphone' } });
  }
  if (ctx.stale) v.note = ctx.stale;
  v.hints = hints(ctx, HINTS.places);
  return v;
}

/** Résumé d'un lieu dans « Aller à… » : « arrivée 18:43 », « 9 min à pied », « ici », « aucun trajet ». */
export function placeSummary(journeys: Journey[] | null, now: number): string {
  if (!journeys) return '';
  const j = journeys[0];
  if (!j) return 'aucun trajet';
  if (!j.legs.some((l) => l.kind === 'ride')) {
    const m = Math.round((j.arr - j.dep) / 60_000);
    return m <= 2 ? 'ici' : `${minText(m)} à pied`;
  }
  const day = dayWord(j.arr, now);
  return j.arr > now ? `arrivée ${day ? day + ' ' : ''}${hhmm(j.arr)}` : '';
}

/* ------------------------------ Trajet proposé (étapes) ------------------------------ */

/** Ce que l'écran des étapes affiche, en plus de la route. */
export interface StepsData {
  /** Propositions (rafraîchies), dans l'ordre du cœur. */
  journeys: Journey[];
  /** Proposition affichée. */
  index: number;
  /** Identifiant du trajet suivi (« ▶ », aide « toucher : détail »). */
  followedId?: string;
  /** Départ à pied figé du trajet suivi (1.0 : l'heure affichée ne recule plus une fois partie). */
  leaveAt0?: number;
  /** Défilement du cadre et premier affichage. */
  top?: number;
  fresh?: boolean;
}

/** Heure de départ à pied affichée : figée une fois partie (maquette Visite1, étape 3). */
export function shownLeave(j: Journey, now: number, leaveAt0?: number): number {
  return leaveAt0 !== undefined && now >= leaveAt0 ? Math.min(leaveAt0, j.leaveAt) : j.leaveAt;
}

/** 1.0 : même règle, depuis la route. */
export function shownLeaveAt(route: Pick<StepsRoute, 'leaveAt0'>, j: Journey, now: number): number {
  return shownLeave(j, now, route.leaveAt0);
}

/** Titre de l'écran des étapes : « Vers le bureau » (titre donné, sinon d'après le libellé de la 1.0). */
export function stepsTitleOf(route: Pick<StepsRoute, 'title' | 'label'>): string {
  return route.title || towards(route.label);
}

const sameName = (a: Leg['to']['name'], b: Leg['to']['name']): boolean =>
  normalizeForSearch(a.fr) === normalizeForSearch(b.fr) || (!!a.nl && normalizeForSearch(a.nl) === normalizeForSearch(b.nl));

const ARRET: Record<string, string> = { tram: 'l’arrêt du tram', bus: 'l’arrêt du bus', metro: 'l’arrêt du métro' };

/** Ligne d'étape avec ses heures (état et repère). */
interface StepRow {
  item: Item;
  start: number;
  end: number;
  /** Étape qui peut porter le repère « ▶ » (marche, montée) ; pas les descentes. */
  markable: boolean;
  ride?: Leg;
}

/**
 * Étapes d'un trajet (PRD § 6.1 L3, S6) : durées de marche dans le texte, colonne d'état à droite.
 * « À pied vers l’arrêt du tram » (bus, métro) ou « À pied vers la gare » quand la zone porte le nom de l'arrêt de
 * descente ; trajet entièrement à pied : « Partir à pied » puis « Arrivée … ».
 */
function stepRows(j: Journey, at: string, leave: number, ctx: ViewCtx): StepRow[] {
  const l = lang(ctx);
  const rows: StepRow[] = [];
  const rides = j.legs.filter((x) => x.kind === 'ride');
  if (!rides.length) {
    const min = Math.max(1, Math.round((j.arr - j.dep) / 60_000));
    rows.push({ item: { a: hhmm(j.dep), b: 'Partir à pied', bTail: ` (${minText(min)})` }, start: j.dep, end: j.arr, markable: true });
    rows.push({ item: { a: hhmm(j.arr), b: `Arrivée ${at}` }, start: j.arr, end: j.arr, markable: false });
    return rows;
  }
  let prevRide: Leg | undefined;
  j.legs.forEach((leg, i) => {
    const last = i === j.legs.length - 1;
    if (leg.kind === 'walk') {
      const w = walkMinOf(leg);
      if (i === 0) {
        const next = j.legs.slice(1).find((x) => x.kind === 'ride');
        const dest = next?.mode === 'train' ? 'la gare' : 'l’arrêt';
        rows.push({ item: { a: hhmm(leave), b: `Partir à pied vers ${dest}`, bTail: ` (${minText(w)})` }, start: leave, end: Math.max(leg.arr, leave + 60_000), markable: true });
      } else if (last) {
        rows.push({ item: { a: hhmm(leg.arr), b: `Arrivée ${at}`, bTail: ` (${minText(w)} à pied)` }, start: leg.dep, end: leg.arr, markable: true });
      } else {
        const next = j.legs.slice(i + 1).find((x) => x.kind === 'ride');
        const same = prevRide && sameName(leg.to.name, prevRide.to.name);
        const dest = same ? (next?.mode === 'train' ? 'la gare' : ARRET[next?.mode ?? 'bus'] ?? 'l’arrêt') : displayName(leg.to.name, l);
        rows.push({ item: { a: hhmm(leg.dep), b: `À pied vers ${dest}`, bTail: ` (${minText(w)})` }, start: leg.dep, end: leg.arr, markable: true });
      }
      return;
    }
    const head = leg.head ? ` vers ${headText(leg.head, l, leg.op)}` : '';
    const p = leg.newPlatform || leg.platform;
    const plat = leg.mode === 'train' && p ? `, voie ${p}` : '';
    const tail = `${plat}${lastMark(leg) ?? ''}`;
    rows.push({
      item: { a: `${plannedMark(leg.rt ?? false, mp(ctx))}${hhmm(leg.schedDep)}`, b: `${vehicleOf(leg)}${head}`, ...(tail ? { bTail: tail } : {}) },
      start: leg.dep,
      end: leg.arr,
      markable: true,
      ride: leg,
    });
    rows.push({ item: { a: hhmm(leg.arr), b: `${last ? 'Arrivée à' : 'Descendre à'} ${displayName(leg.to.name, l)}` }, start: leg.arr, end: leg.arr, markable: false });
    prevRide = leg;
  });
  return rows;
}

/** État d'une étape (S6, colonne de 108 px) : « dans 4 min », « en cours », « +2 min », « SUPPRIMÉ ». */
function stateOf(r: StepRow, next: boolean, now: number): string {
  if (r.ride?.cancelled) return 'SUPPRIMÉ';
  if (r.markable && now >= r.start && now < r.end) return 'en cours';
  const delay = r.ride?.delayMin ?? 0;
  if (r.ride && delay > 0 && now < r.end) return `+${minText(delay)}`;
  if (next) {
    const m = minutesUntil(r.start, now);
    if (m < 60) return m < 1 ? 'maintenant' : `dans ${minText(m)}`;
  }
  return '';
}

/** Véhicule à détailler (« Dans le train ») : celui en cours, sinon le prochain, sinon le dernier. */
export function detailLeg(j: Journey, now: number): number {
  const rides = j.legs.map((l, i) => ({ l, i })).filter((x) => x.l.kind === 'ride');
  const cur = rides.find((x) => x.l.arr > now);
  return (cur ?? rides[rides.length - 1])?.i ?? -1;
}

/** Ligne du bas : ce que fera ▼ (PRD § 6.1 L3). */
function stepsBottom(hiddenBelow: number, d: StepsData, now: number): string {
  if (hiddenBelow > 0) return `▼ ${hiddenBelow} étape${hiddenBelow > 1 ? 's' : ''} de plus`;
  const next = d.journeys[d.index + 1];
  if (next) {
    // labelOf : une étiquette de la 1.1 (« simple », « fast ») d'un trajet gardé se lit dans les mots de la 1.2.
    const known = labelOf(next.label);
    const label = known ? LABEL_TEXT[known] : 'Autre trajet';
    return `▼ ${label}${NB}: ${spanText(journeyStart(next), next.arr, now)}`;
  }
  if (d.journeys.length > 1) return '▲ trajet précédent';
  return 'Pas d’autre trajet pour l’instant';
}

/**
 * « Trajet proposé » (L3) : une proposition par page, sans curseur. ▼ montre les étapes cachées, puis la proposition
 * suivante ; « ▶ » marque l'étape en cours ou la prochaine du trajet suivi seulement.
 */
export function stepsPage(route: Pick<StepsRoute, 'title' | 'label'>, d: StepsData, ctx: ViewCtx): GlassesView {
  const j = d.journeys[d.index];
  const title = stepsTitleOf(route);
  const followed = !!d.followedId && j.id === d.followedId;
  const leave = shownLeave(j, ctx.now, followed ? d.leaveAt0 : undefined);
  const start = journeyStart(j, leave);
  const span = `${NB}: ${spanText(start, j.arr, ctx.now)}`;
  const head = textWidth(title + span) <= WIDTHS.title ? title : truncate(title, WIDTHS.title - textWidth(span));
  const v = base('steps', 'steps', `${head}${span}`, ctx);
  const rows = stepRows(j, atTitle(title), leave, ctx);
  const nextIdx = rows.findIndex((r) => r.markable && r.start > ctx.now);
  rows.forEach((r, k) => {
    const c = stateOf(r, k === nextIdx, ctx.now);
    v.items.push(c ? { ...r.item, c } : r.item);
  });
  const alert = j.alerts[0];
  let top: TopLine | undefined;
  if (alert) top = { text: alert.text, strong: true };
  else if (j.reason) top = { text: j.reason };
  if (top) v.top = top;
  v.reserveNote = true;
  v.scroll = true;
  let mark = -1;
  if (followed) {
    mark = rows.findIndex((r) => r.markable && r.end > ctx.now);
    if (mark < 0) mark = rows.length - 1;
    v.mark = mark;
  }
  // Défilement : au premier affichage, le repère reste visible.
  const capacity = geometry(v).capacity;
  const max = maxTop(v.items, capacity);
  if (mark >= capacity) v.initialTop = Math.min(max, mark - capacity + 1);
  else v.initialTop = 0;
  const wanted = d.fresh && v.initialTop !== undefined ? v.initialTop : d.top ?? 0;
  const shownTop = Math.min(Math.max(0, wanted), max);
  v.note = stepsBottom(Math.max(0, v.items.length - shownTop - capacity), d, ctx.now);
  const walkOnly = !j.legs.some((x) => x.kind === 'ride');
  if (walkOnly) v.hints = hints(ctx, HINTS.stepsWalk);
  else if (followed) {
    const leg = detailLeg(j, ctx.now);
    v.hints = hints(ctx, HINTS.steps);
    if (leg >= 0) v.tap = { kind: 'open', route: { screen: 'train', journey: j, leg, label: title } };
  } else {
    v.hints = hints(ctx, HINTS.stepsOther);
    v.tap = { kind: 'follow' };
  }
  v.log = { page: d.index + 1, pages: d.journeys.length, label: labelOf(j.label) ?? '', followed };
  return v;
}

/** 1.0 (aperçus du téléphone) : une seule proposition, non suivie. */
export function stepsView(route: Pick<StepsRoute, 'title' | 'label' | 'leaveAt0'>, j: Journey, ctx: ViewCtx): GlassesView {
  return stepsPage(route, { journeys: [j], index: 0, leaveAt0: route.leaveAt0, fresh: true }, ctx);
}

/** Calcul en cours, aucun trajet : écran des étapes sous forme de message. */
export function stepsMessageView(title: string, text: string, ctx: ViewCtx): GlassesView {
  return messageView(title, [text], ctx, { hints: HINTS.message, screen: 'steps' });
}

/* ------------------------------ Dans le train ------------------------------ */

export function trainTitle(leg: Leg, l: NameLang, now?: number): string {
  const head = leg.head ? ` vers ${headText(leg.head, l, leg.op)}` : '';
  const delay = leg.cancelled ? ', SUPPRIMÉ' : leg.delayMin && leg.delayMin > 0 ? `, +${minText(leg.delayMin)}` : '';
  const day = now === undefined ? '' : dayWord(leg.schedDep, now);
  return `${vehicleOf(leg)}${head}${delay}${day ? `, ${day}` : ''}`;
}

/** C1 : « Descente dans 3 arrêts » (bus, tram, métro, quand les arrêts sont connus). */
export function alightText(stopsLeft: number): string {
  return stopsLeft <= 1 ? 'Descente au prochain arrêt' : `Descente dans ${stopsLeft} arrêts`;
}

export function trainView(j: Journey, legIndex: number, ctx: ViewCtx): GlassesView {
  const leg = j.legs[legIndex];
  if (!leg || leg.kind !== 'ride') return messageView('Dans le train', ['Trajet introuvable.'], ctx, { hints: HINTS.message });
  const v = base('train', 'train', trainTitle(leg, lang(ctx), ctx.now), ctx);
  const known = (leg.stops?.length ?? 0) >= 2;
  const stops = known
    ? leg.stops!
    : [
        { name: leg.from.name, sched: leg.schedDep, est: leg.dep, platform: leg.newPlatform || leg.platform },
        { name: leg.to.name, sched: leg.schedArr, est: leg.arr },
      ];
  const mark = plannedMark(leg.rt ?? false, mp(ctx));
  let next = -1;
  stops.forEach((s, k) => {
    const lastStop = k === stops.length - 1;
    const passed = s.est <= ctx.now && !lastStop;
    let c = '';
    if (lastStop) c = 'descente';
    else if (passed) c = 'passé';
    else if (next < 0) {
      next = k;
      c = k === 0 ? platformText(s.platform ?? leg.platform, k === 0 ? leg.newPlatform : undefined) || 'prochain' : 'prochain';
    }
    if (lastStop && next < 0) next = k;
    v.items.push({ a: displayName(s.name, lang(ctx)), b: `${mark}${hhmm(s.est)}`, c });
  });
  if (known && leg.mode !== 'train' && ctx.now < leg.arr) {
    const left = stops.length - 1 - Math.max(1, next) + 1;
    v.top = { text: alightText(left) };
  }
  v.initialSel = Math.max(0, next);
  v.initialTop = Math.max(0, next - 1);
  v.hints = hints(ctx, HINTS.train);
  return v;
}

/* ------------------------------ Arrivée ------------------------------ */

export function arrivalView(stationName: string, arrivalAt: number, deps: Departure[], ctx: ViewCtx): GlassesView {
  const v = base('arrival', 'arrival', `Arrivée à ${stationName}`, ctx);
  const m = minutesUntil(arrivalAt, ctx.now);
  const top: TopLine = { text: m > 0 ? `Dans ${minText(m)}. Ensuite, devant la gare${NB}:` : `Ensuite, devant la gare${NB}:`, strong: true };
  v.top = top;
  const save: Intent = { kind: 'saveTrip' };
  const shown = deps.slice(0, 4);
  for (const d of shown) {
    const head = headText(d.head, lang(ctx), d.op);
    v.items.push({ a: vehicleLong(d.mode, d.line), b: minutesUntil(d.est, ctx.now) >= 60 ? withDay(head, d.est, ctx.now) : head, bTail: lastMark(d), c: minutesText(d, ctx.now, mp(ctx)), action: save });
  }
  if (!shown.length) v.items.push({ a: 'Aucun départ devant la gare', action: save });
  if (mp(ctx) && shown.some((d) => !d.rt && !d.cancelled)) v.note = NOTE_PLANNED;
  v.reserveNote = true;
  v.tap = save;
  v.hints = hints(ctx, HINTS.arrival);
  return v;
}

/* ------------------------------ Routes utiles ------------------------------ */

/** Route ouverte par un arrêt favori (départs filtrés). */
export function favoriteStopRoute(f: Extract<Favorite, { kind: 'stop' }>): Route {
  const r: Route = { screen: 'board', areaId: f.areaId, name: f.name };
  if (f.filter?.length) r.filter = f.filter;
  return r;
}

export function areaRefOf(e: { areaId: string; op: AreaRef['op']; name: AreaRef['name']; lat: number; lon: number }): AreaRef {
  return { areaId: e.areaId, op: e.op, name: e.name, lat: e.lat, lon: e.lon };
}

/** Les items sélectionnables : tous sauf sur les écrans de message. */
export function selectable(v: GlassesView): boolean {
  return v.layout !== 'message';
}

/** Intention d'un toucher sur l'élément `sel`. */
export function tapIntent(v: GlassesView, sel: number): Intent | undefined {
  if (v.scroll) return v.tap;
  const it: Item | undefined = v.items[sel];
  return (selectable(v) ? it?.action : undefined) ?? v.tap;
}
