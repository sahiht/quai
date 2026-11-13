/**
 * Modèles de vue des écrans des lunettes (PRD 1.1 § 6.1, maquettes Visite1-3 pour la 1.0). Fonctions pures :
 * données du cœur + réglages + heure → GlassesView. Testables sans SDK.
 *
 * 1.2.2 (docs/v1.2.2/PRD-1.2.2.md, REVUE-USAGE.md) : accueil avec « Gares » et « Bus, tram, métro » ; « Favoris » au
 * format de l'accueil, puis les adresses récentes et « Autre adresse » (« Aller à… » n'existe plus) ; écrans « Gares »,
 * « Bus, tram, métro », détail d'une ligne, « garder une ligne » ; trajet suivi seulement sur demande (« Suivi »,
 * « Suivre ce trajet », « Ne plus suivre ») ; véhicules en toutes lettres dans les étapes.
 *
 * 1.2.3 (docs/v1.2.3/PRD-1.2.3.md) : tableau complet d'une gare ou d'un arrêt (2 heures, curseur, ligne ★ en tête),
 * les arrêts d'un départ jusqu'au terminus, un passage du détail d'une ligne ouvre aussi ses arrêts.
 */
import type { Board, CoreStatus, Departure, DepartureStops, Favorite, FavoriteAnswer, Journey, Leg, LineBoard, LineDeparture, LinePick, NameLang, NearbyItem, Settings, StationPick } from '../core/api';
import { labelOf } from '../core/api';
import { favoriteTitle, placesOf } from '../core/favorites';
import { displayLabel, HOLIDAY_TEXT, holidayName, longestWalk, walksMore } from '../core/means';
import { shortAddress } from '../core/text';
import { areaLabel, displayName, distanceM, hhmm, lineLabel, minutesUntil } from '../core/util';
import type { Mode, Names } from '../../../shared/types';
import { normalizeForSearch } from '../../../shared/names';
import { compareVersions } from '../version';
import { textWidth, truncate } from './font';
import { COL_SEP, ensureVisible, geometry, maxTop, visibleRange, WIDTHS } from './layout';
import type { AreaRef, GlassesView, Intent, Item, KeepLineRoute, LineRoute, LineRunRoute, OthersRoute, Route, Seg, StepsRoute, StopsRoute, SubRow, TopLine } from './types';
import { isFollowed, type LineFollow, type LineRun } from '../core/linerun';
import { lineKey } from '../core/linepicks';
import { trainProgress } from '../core/stopcalls';
import {
  departureWait,
  MARGIN_SHOWN_MAX,
  NOTE_RT_KEPT,
  RAIN_TAIL,
  RAIN_WORDS,
  alightWords,
  marginText,
  missText,
  progressLine,
  rainyJourney,
  rainyWalk,
} from './format';
import {
  BOARD,
  HINTS,
  HOME_OFFLINE,
  HOME_RT_DOWN,
  LAST_MARK,
  NB,
  NOTE_OFFLINE,
  NOTE_PARTIAL,
  NOTE_PLANNED,
  NOTE_RT_DOWN,
  SECTION,
  allLinesTitle,
  atTitle,
  boardTitle,
  dayWord,
  departureRightText,
  distanceText,
  favoriteDetail,
  headText,
  journeyStart,
  lineTitle,
  lowerFirst,
  meansLine,
  minText,
  minutesText,
  nextText,
  passageParts,
  nextPassageText,
  plannedMark,
  platformText,
  rideWords,
  spanText,
  stopAnswerLine,
  stopHomeText,
  stopRightText,
  stopTimeParts,
  stopTimeText,
  stopsCount,
  towards,
  trainCellParts,
  tripHomeText,
  untilText,
  upcoming,
  upperFirst,
  vehicleLong,
  vehicleWords,
  waitText,
  walksPhrase,
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

/** Bienvenue (1.2.2, REVUE-USAGE n° 5 : « tes favoris », plus « tes lieux »). */
export function firstRunView(ctx: ViewCtx): GlassesView {
  if (ctx.web) {
    return messageView(
      'Quai',
      [`Bienvenue dans Quai${NB}!`, `Termine les réglages dans l’onglet Réglages${NB}:`, 'position, langue et tes favoris, en une minute.'],
      ctx,
      { hints: HINTS.firstRunWeb, tap: { kind: 'continue' } },
    );
  }
  return messageView(
    'Quai',
    [`Bienvenue dans Quai${NB}!`, `Termine les réglages sur le téléphone${NB}:`, 'appli Even Realities, onglet Even Hub, Quai.', 'Position, langue et tes favoris, en une minute.'],
    ctx,
    { hints: HINTS.firstRun, tap: { kind: 'continue' } },
  );
}

/** Titre du message de nouveautés (une fois, après la mise à jour depuis une version antérieure). */
export const NEWS_TITLE = 'Quai 1.2.8';

/** 1.2.8 : lignes du message « Quai 1.2.8 » (PRD-1.2.8 § 4) ; chacune tient sur une ligne des lunettes. */
export const NEWS_LINES_128: readonly string[] = [
  `Un train${NB}: tout son trajet, gares d’avant comprises.`,
  `Chaque gare${NB}: sa voie et dans combien de temps.`,
  `●${NB}: là où le train arrive, d’après le temps réel.`,
];

/** Lignes du message au plus : celles qui tiennent à l'écran (les plus récentes d'abord). */
export const NEWS_MAX = 8;

/** 1.2.6 : lignes du message « Quai 1.2.6 » ; chacune tient sur une ligne des lunettes. */
export const NEWS_LINES: readonly string[] = [
  `Arrêts et lignes de bus, tram, métro, séparés.`,
  `Une ligne${NB}: tout son parcours, l’attente à chaque arrêt.`,
  `Dans les deux sens, sans choisir d’arrêt.`,
  `Tes lignes gardées y sont déjà.`,
];

/** Les nouveautés de la 1.2.5 encore vraies (PRD-1.2.5 § 8), pour qui vient d'avant la 1.2.5. */
export const NEWS_LINES_125: readonly string[] = [
  `Étapes${NB}: l’heure d’arrivée si tu rates ton départ.`,
  `Pluie prévue${NB}: dite sur la marche concernée.`,
  `Dans le véhicule${NB}: ta progression jusqu’à la descente.`,
];

/**
 * Lignes du message « Quai 1.2.8 », une seule fois : celles de la 1.2.8 ; à qui vient d'avant la 1.2.6, aussi celles de
 * la 1.2.6, puis d'avant la 1.2.5, celles de la 1.2.5 : les plus récentes d'abord, une version entière ou rien, NEWS_MAX
 * lignes au plus (un écran).
 */
export function newsLines(seen = ''): string[] {
  const blocks: (readonly string[])[] = [NEWS_LINES_128];
  if (seen && compareVersions(seen, '1.2.6') < 0) blocks.push(NEWS_LINES);
  if (seen && compareVersions(seen, '1.2.5') < 0) blocks.push(NEWS_LINES_125);
  const out: string[] = [];
  for (const b of blocks) if (out.length + b.length <= NEWS_MAX) out.push(...b);
  return out;
}

/** Message « Quai 1.2.8 » : toucher mène à l'accueil. `lines` : celles calculées à l'ouverture (route du message). */
export function newsView(ctx: ViewCtx, lines: string[] = newsLines()): GlassesView {
  return messageView(NEWS_TITLE, lines.length ? lines : newsLines(), ctx, { hints: HINTS.news, tap: { kind: 'continue' } });
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

/** Libellé d'un arrêt favori (réglages d'avant la 1.2.2, aperçus) : celui de « Autour de moi » (« Gare du Nord, tram »). */
export function stopFavoriteLabel(f: Extract<Favorite, { kind: 'stop' }>, answer: FavoriteAnswer | undefined, l: NameLang): string {
  if (answer?.board) return areaLabel(answer.board.area, l);
  if (f.op === 'sncb') return `${displayName(f.name, l)}, train`;
  return displayName(f.name, l);
}

/**
 * Élément d'un favori dans « Favoris » (1.2.2, REVUE-USAGE n° 7) : ligne 1 identique à sa ligne de l'accueil (nom,
 * puis « maintenant → 08:46 »), ligne 2 plus pâle : le détail (favoriteDetail : « bus W 07:36, 1 changement ») ;
 * « tu y es », « aucun trajet » : une seule ligne ; en calcul, deux lignes réservées. `planned` : un « ~ » est montré
 * (en ligne 2 seulement).
 */
export function favoriteItem(e: FavoriteEntry, ctx: ViewCtx): { item: Item; planned: boolean } {
  const f = e.fav;
  const action: Intent = { kind: 'openFavorite', id: f.id };
  if (f.kind === 'stop') {
    // Arrêt favori : n'existe plus dans les réglages v4 (rangé dans « Gares » ou « Bus, tram, métro ») ; lu au mieux.
    const right = stopHomeText(e.answer, ctx.now);
    const line = stopAnswerLine(e.answer, ctx.now, ctx.settings);
    const item: Item = { a: homeFavoriteName(e, ctx), c: right.text, action };
    if (right.tail) item.cTail = right.tail;
    if (line.second) item.b2 = line.second;
    else if (line.two) item.two = true;
    return { item, planned: !!line.second?.includes('~') };
  }
  const right = tripHomeText(e.answer, ctx.now);
  const item: Item = { a: homeFavoriteName(e, ctx), c: right, action };
  const detail = favoriteDetail(e.answer, ctx.now, ctx.settings);
  if (detail) item.b2 = detail.text;
  else if (right === '…') item.two = true;
  return { item, planned: !!detail?.planned };
}

/* ------------------------------ Accueil ------------------------------ */

/** Favoris montrés sur l'accueil, au plus (PRD-1.2.1 § 4.2). */
export const HOME_FAVORITES = 3;

export interface HomeData {
  /**
   * Favoris montrés sous « Favoris » (1.2.1 : 3 au plus, jamais un favori de la règle 5), dans l'ordre réglé. L'accueil
   * en montre moins si l'écran manque de place (ligne du haut, « En cours », jour férié, aide des gestes).
   */
  favorites?: FavoriteEntry[];
  /** Ordre complet des favoris, figé pendant l'affichage (journal `order`). */
  order?: string[];
  /** 1.2.0 : nombre de favoris hors de l'accueil (« Autres favoris ») ; ignoré depuis 1.2.1 (« Favoris » donne le total). */
  others?: number;
  /** « Accueil sans favoris » (réglage) : « Favoris   {n} » sans favori dessous. */
  noFavorites?: boolean;
  nearbyCount?: number;
  /** Position inconnue : « Autour de moi   sans position ». */
  noPosition?: boolean;
  /** Lieu proche pour la ligne de contexte (« Près de Bruxelles-Nord »), seulement sans favori sous « Favoris ». */
  near?: string;
  /** Message de données périmées (dataFreshness, ok = false) : ligne forte. */
  stale?: string;
  /** Avertissement non bloquant (dataFreshness, ok = true avec message) : ligne discrète. */
  notice?: string;
  /**
   * Trajet en cours (M6) : « En cours : vers le bureau » et l'étape suivante. 1.2.2 (REVUE-USAGE n° 1) : son favori
   * (`favoriteId`) n'est pas répété sous « Favoris ».
   */
  running?: { title: string; next: string; favoriteId?: string };
  /**
   * 1.2.1 (§ 4.6) : aide des gestes de l'accueil, seulement les 7 premiers jours d'utilisation (contrôleur). Absent :
   * selon le réglage « Aides de gestes » seul (aperçus du téléphone).
   */
  gestureHelp?: boolean;
}

/** Nom d'un favori sur l'accueil (1.2.1, § 4.3) : nom du lieu (« Bureau »), titre d'un trajet fixe, nom de l'arrêt. */
export function homeFavoriteName(e: FavoriteEntry, ctx: ViewCtx): string {
  const f = e.fav;
  if (f.kind === 'place') return f.label;
  if (f.kind === 'stop') return stopFavoriteLabel(f, e.answer, lang(ctx));
  return favoriteTitle(f, ctx.settings);
}

/**
 * Un favori sur une ligne, en retrait sous « Favoris » (1.2.1, § 4.3) : son nom, puis « maintenant → 21:34 » (lieu,
 * trajet) ou le prochain départ (arrêt). Toucher : ses étapes ou ses départs, comme en 1.2.
 */
export function homeFavoriteItem(e: FavoriteEntry, ctx: ViewCtx): Item {
  const f = e.fav;
  const right = f.kind === 'stop' ? stopHomeText(e.answer, ctx.now) : { text: tripHomeText(e.answer, ctx.now) };
  const item: Item = { a: '', b: homeFavoriteName(e, ctx), bRight: right.text, action: { kind: 'openFavorite', id: f.id } };
  if (right.tail) item.bRightTail = right.tail;
  return item;
}

/**
 * 1.2.2 : où choisir ses gares ou ses lignes (« à choisir ») : l'appli Even le dit (« Choisis tes gares dans Quai, sur
 * le téléphone ») ; Quai Web ouvre directement l'ajout de l'onglet Réglages (#/gares/ajouter, #/lignes/ajouter : son
 * bouton retour ramène à #/).
 */
function chooseIntent(kind: 'stations' | 'lines' | 'follows', ctx: ViewCtx): Extract<Intent, { kind: 'phone' }> {
  // 1.2.6 : « lines » = les arrêts de bus, tram et métro ; « follows » = les lignes suivies
  const text =
    kind === 'stations'
      ? ctx.web
        ? SECTION.chooseStationsWeb
        : SECTION.chooseStations
      : kind === 'lines'
        ? ctx.web
          ? SECTION.chooseStopsWeb
          : SECTION.chooseStops
        : ctx.web
          ? SECTION.chooseLinesWeb
          : SECTION.chooseLines;
  return { kind: 'phone', hash: kind === 'stations' ? '#/gares/ajouter' : kind === 'lines' ? '#/arrets/ajouter' : '#/lignes/ajouter', text };
}

/** « 1 gare », « 2 arrêts » : un nombre et son nom, au pluriel au-delà de 1. */
const counted = (n: number, word: string): string => `${n}${NB}${word}${n > 1 ? 's' : ''}`;

/**
 * 1.2.4 (PRD-1.2.4 § 3) : à droite de « Gares » et de « Bus, tram, métro », ce que contient la rubrique : « 2 gares »,
 * « 2 arrêts · 1 ligne » (un bloc vide n'est pas dit), comme « 9 arrêts » pour « Autour de moi ». Plus de prochain
 * départ (1.2.2, REVUE-USAGE n° 6) : celui de l'élément le plus proche, sans son nom ni son sens, pouvait tromper.
 */
export function sectionCount(kind: 'stations' | 'lines', s: Pick<Settings, 'stations' | 'lines'>): string {
  if (kind === 'stations') return s.stations.length ? counted(s.stations.length, 'gare') : '';
  const stops = s.lines.filter((p) => !p.line).length;
  const lines = s.lines.length - stops;
  return [stops ? counted(stops, 'arrêt') : '', lines ? counted(lines, 'ligne') : ''].filter(Boolean).join(' · ');
}

/**
 * 1.2.2 : ligne « Gares » ou « Bus, tram, métro » de l'accueil ; vide : « à choisir », et le toucher dit où les choisir
 * (PRD-1.2.2 § 1.3 ; Quai Web : l'ajout de l'onglet Réglages, chooseIntent). 1.2.4 : à droite, son contenu (sectionCount).
 */
export function sectionItem(kind: 'stations' | 'lines', ctx: ViewCtx): Item {
  const a = SECTION[kind];
  const c = sectionCount(kind, ctx.settings);
  if (!c) return { a, c: SECTION.empty, action: chooseIntent(kind, ctx) };
  return { a, c, action: { kind: 'open', route: { screen: kind } } };
}

/**
 * 1.2.6 : lignes suivies, sans arrêt. Celles choisies sur le téléphone (`follows`), puis celles de la 1.2.5
 * suivies à un arrêt (LinePick avec `line`) : la ligne reste, l'arrêt devient son repère (`via`) quand la position
 * manque. Une ligne n'apparaît qu'une fois (réseau et numéro ; contrôle qualité : deux lignes du même numéro sans
 * variante commune, le W de Waterloo et celui de Tournai, sont deux lignes, isFollowed).
 */
export function followsOf(s: Pick<Settings, 'lines'> & { follows?: LineFollow[] }): LineFollow[] {
  const out: LineFollow[] = [];
  const add = (f: LineFollow): void => {
    if (out.some((x) => isFollowed(x, f))) return;
    out.push(f);
  };
  for (const f of s.follows ?? []) add(f);
  for (const p of s.lines) if (p.line) add({ id: `via:${p.id}`, op: p.op, line: p.line, routes: [], ...(p.mode ? { mode: p.mode } : {}), via: { areaId: p.areaId, name: p.name, lat: p.lat, lon: p.lon } });
  return out;
}

/** 1.2.6 : rubrique de l'accueil, son mot clé au plus clair et sa précision pâle (« Gares de train »). */
function titled(item: Item, qual: string): Item {
  return { a: '', segs: [{ t: item.a, hi: true }, { t: qual }], bRight: item.c, ...(item.action ? { action: item.action } : {}) };
}

/** 1.2.6 : « Arrêts   2 arrêts » (les arrêts toutes lignes de « Bus, tram, métro »). */
function stopsHomeItem(ctx: ViewCtx): Item {
  const n = ctx.settings.lines.filter((p) => !p.line).length;
  if (!n) return { a: SECTION.stops, c: SECTION.empty, action: chooseIntent('lines', ctx) };
  return { a: SECTION.stops, c: counted(n, 'arrêt'), action: { kind: 'open', route: { screen: 'lines' } } };
}

/** 1.2.6 : « Lignes   3 lignes ». */
function followsHomeItem(ctx: ViewCtx): Item {
  const n = followsOf(ctx.settings).length;
  if (!n) return { a: SECTION.follows, c: SECTION.empty, action: chooseIntent('follows', ctx) };
  return { a: SECTION.follows, c: counted(n, 'ligne'), action: { kind: 'open', route: { screen: 'follows' } } };
}

/**
 * Accueil (PRD-1.2.2 § 1.1) : « En cours » s'il y a un trajet suivi (son favori n'est pas répété dessous) ; « Favoris »
 * et leur nombre (toucher : la liste de tous les favoris), dessous en retrait jusqu'à 3 favoris, une ligne chacun ;
 * une ligne vide ; « Autour de moi » ; « Gares » et « Bus, tram, métro », toujours là, leur contenu (1.2.4 : « 2 gares »,
 * « 2 arrêts · 1 ligne ») ou « à choisir » à droite. Aucune ligne de pied, sauf l'aide des gestes les 7 premiers jours et, un jour férié, « Jour férié :
 * horaires du dimanche » en dernière ligne, pâle. Les favoris prennent la place qui reste ; s'il manque une ligne, la
 * ligne vide saute d'abord (REVUE-USAGE n° 1) : la liste ne défile jamais. Curseur à l'ouverture, comme en 1.2 : sur
 * « En cours » s'il y est, sinon sur le premier favori montré (▲ : « Favoris ») ; sans favori montré, sur la 1re ligne.
 */
export function homeView(d: HomeData, ctx: ViewCtx): GlassesView {
  const v = base('home', 'home', 'Quai', ctx);
  const s = ctx.settings;
  const total = s.favorites.length;
  const runId = d.running?.favoriteId;
  const candidates = !d.noFavorites && total > 0 ? (d.favorites ?? []).filter((e) => !runId || e.fav.id !== runId).slice(0, HOME_FAVORITES) : [];
  if (d.stale) v.top = { text: d.stale, strong: true };
  else if (d.notice) v.top = { text: d.notice };
  else if (ctx.rt === 'down' || ctx.rt === 'offline') v.top = { text: ctx.rt === 'offline' ? HOME_OFFLINE : HOME_RT_DOWN };
  else if (!candidates.length && d.near) v.top = { text: `Près de ${d.near}` };
  if (holidayName(ctx.now)) v.note = HOLIDAY_TEXT;
  v.compactFoot = true;
  v.hints = d.gestureHelp === false ? '' : hints(ctx, ctx.web ? HINTS.homeWeb : HINTS.home);
  // « En cours », « Favoris », « Autour de moi », « Gares » et « Bus, tram, métro » d'abord ; les favoris dans le reste,
  // puis la ligne vide s'il reste une ligne.
  const capacity = geometry(v).capacity;
  // 1.2.6 : « Bus, tram, métro » devient « Arrêts » et « Lignes »
  const fixed = (d.running ? 1 : 0) + 5;
  const shown = candidates.slice(0, Math.max(0, capacity - fixed));
  const blank = fixed + shown.length < capacity;
  const all: Intent = { kind: 'open', route: { screen: 'favorites' } };
  if (d.running) v.items.push({ a: `En cours${NB}: ${lowerFirst(d.running.title)}`, c: d.running.next, action: { kind: 'resume' } });
  v.items.push(total ? { a: 'Favoris', c: String(total), action: all } : { a: 'Ajouter un favori', action: all });
  for (const e of shown) v.items.push(homeFavoriteItem(e, ctx));
  const nearby: Item = { a: 'Autour de moi', c: d.noPosition ? 'sans position' : stopsCount(d.nearbyCount), action: { kind: 'open', route: { screen: 'nearby' } } };
  if (blank) nearby.gap = true;
  v.items.push(nearby);
  // 1.2.6 : chaque rubrique dit son mode (« de train », « de bus, tram, métro »)
  v.items.push(titled(sectionItem('stations', ctx), SECTION.trainQual));
  v.items.push(titled(stopsHomeItem(ctx), SECTION.transitQual));
  v.items.push(titled(followsHomeItem(ctx), SECTION.transitQual));
  if (!d.running && shown.length) v.initialSel = v.items.findIndex((i) => i.action?.kind === 'openFavorite');
  v.log = { order: d.order ?? shown.map((e) => e.fav.id), shown: shown.map((e) => e.fav.id) };
  return v;
}

/* ------------------------------ Favoris ------------------------------ */

export interface FavoritesData {
  /** Favoris de la liste, dans l'ordre figé à l'ouverture. Absent : tous les favoris, dans l'ordre du téléphone. */
  entries?: FavoriteEntry[];
  /** 1.2.2 : réponses des adresses récentes (clé recentKey), au format de l'accueil (planHomeText) ; absente : « … ». */
  recents?: Record<string, string | undefined>;
}

/**
 * 1.2.2 : séparateur des adresses récentes dans « Favoris » (PRD-1.2.2 § 1.2), ligne pâle non sélectionnable. 1.2.4
 * (PRD-1.2.4 § 4) : en capitales, comme « ARRÊTS » et « LIGNES » : un intitulé, jamais une ligne à toucher.
 */
export const RECENT_HEAD = 'ADRESSES RÉCENTES';

/** Favoris vides (1.2.2, REVUE-USAGE n° 2), message ouvert par « Ajouter un favori » dans l'appli Even. */
export function emptyFavoritesLines(web = false): string[] {
  return ['Aucun favori pour l’instant.', web ? 'Ajoute Maison ou Bureau dans l’onglet Réglages.' : 'Ajoute Maison ou Bureau sur le téléphone.'];
}

/** « Ajouter un favori » en tête de « Favoris » sans favori (§ 1.2) ; Quai Web : « Nouveau favori » dans Réglages. */
function addFavoriteItem(ctx: ViewCtx): Item {
  if (ctx.web) return { a: 'Ajouter un favori', c: 'dans Réglages', action: { kind: 'phone', hash: '#/favoris/nouveau', text: emptyFavoritesLines(true)[1] } };
  return { a: 'Ajouter un favori', c: 'sur le téléphone', action: { kind: 'open', route: { screen: 'message', kind: 'info', title: 'Favoris', lines: emptyFavoritesLines() } } };
}

/** « Autre adresse » en bas de « Favoris » (1.2.1 : de « Aller à… », inchangée). */
function otherAddressItem(ctx: ViewCtx): Item {
  if (ctx.web) return { a: 'Autre adresse', c: 'dans Réglages', action: { kind: 'phone', hash: '#/recherche', text: 'Tape l’adresse dans l’onglet Réglages' } };
  return { a: 'Autre adresse', c: 'sur le téléphone', action: { kind: 'toast', text: 'Tape l’adresse dans Quai, sur le téléphone' } };
}

/**
 * « Favoris » (PRD-1.2.2 § 1.2, REVUE-USAGE n° 2 et n° 7) : tous les favoris (lieux et trajets) dans l'ordre réglé, au
 * format de l'accueil, deux lignes chacun ; sans favori, « Ajouter un favori » ; puis la ligne pâle « Adresses
 * récentes » et ces adresses (3 au plus, jamais celle d'un favori, une ligne chacune, réponse au format de l'accueil) ;
 * enfin « Autre adresse   sur le téléphone ». Toucher une adresse récente : ses étapes, comme dans l'ancien « Aller à… ».
 */
export function favoritesView(d: FavoritesData, ctx: ViewCtx): GlassesView {
  const s = ctx.settings;
  const entries = d.entries ?? s.favorites.map((fav) => ({ fav }));
  const v = base('favorites', 'favorites', 'Favoris', ctx);
  let planned = false;
  for (const e of entries) {
    const { item, planned: p } = favoriteItem(e, ctx);
    if (p) planned = true;
    v.items.push(item);
  }
  if (!entries.length) v.items.push(addFavoriteItem(ctx));
  recentShown(s).forEach((r, k) => {
    const key = recentKey(r.label);
    const short = shortAddress(r.label);
    const to = r.approx ? { type: 'address' as const, label: r.label, lat: r.lat, lon: r.lon, approx: true } : { type: 'address' as const, label: r.label, lat: r.lat, lon: r.lon };
    const item: Item = { a: short, c: d.recents?.[key] ?? '…', action: { kind: 'go', key, to, label: short } };
    if (k === 0) item.head = RECENT_HEAD;
    v.items.push(item);
  });
  v.items.push(otherAddressItem(ctx));
  v.note = ctx.stale ?? (planned && mp(ctx) ? NOTE_PLANNED : undefined);
  v.reserveNote = true;
  v.hints = hints(ctx, HINTS.favorites);
  v.log = { order: entries.map((e) => e.fav.id) };
  return v;
}

/** Clé d'une adresse récente de « Favoris » (réponses, cache). */
export const recentKey = (label: string): string => `recent:${label}`;

/** Les 3 adresses récentes montrées dans « Favoris » (S4) : pas celles d'un lieu déjà enregistré. */
export function recentShown(settings: Settings): Settings['recent'] {
  const places = placesOf(settings);
  const placeAddr = new Set(places.map((p) => (p.address ? normalizeForSearch(p.address) : '')).filter(Boolean));
  return settings.recent
    .filter((r) => !placeAddr.has(normalizeForSearch(r.label)) && !places.some((p) => Math.abs(p.lat - r.lat) < 0.0004 && Math.abs(p.lon - r.lon) < 0.0006))
    .slice(0, 3);
}

/* ------------------------------ Gares (1.2.2) ------------------------------ */

/** Une gare de « Gares » et son prochain train (absent : en calcul). */
export interface StationRow {
  pick: StationPick;
  next?: Departure;
  /** none : aucun train dans l'horizon des tableaux ; missing : gare introuvable dans les données du jour. */
  state?: 'ok' | 'none' | 'missing';
}

/** Rubrique vide (gares ou lignes retirées pendant qu'on la regarde) : où les choisir (Quai Web : toucher, l'ajout). */
function chooseView(kind: 'stations' | 'lines' | 'follows', ctx: ViewCtx): GlassesView {
  const tap = chooseIntent(kind, ctx);
  const title = kind === 'stations' ? SECTION.stationsTitle : kind === 'lines' ? SECTION.stopsTitle : SECTION.followsTitle;
  return messageView(title, [`${tap.text}.`], ctx, { hints: HINTS.message, screen: kind, ...(ctx.web ? { tap } : {}) });
}

/**
 * « Gares » (PRD-1.2.2 § 2) : les gares choisies sur le téléphone, dans leur ordre ; une ligne par gare : son nom, et à
 * droite son prochain train, comme sur l'accueil (« S1 07:55 voie 1 », « v.1 » si la place manque, retard « +2 », voie
 * modifiée « ! »), avec « ~ » sans temps réel comme « Autour de moi » ; « aucun train » ; « … » pendant le calcul.
 * Toucher : le tableau des départs de la gare.
 */
export function stationsView(rows: StationRow[], ctx: ViewCtx): GlassesView {
  if (!rows.length) return chooseView('stations', ctx);
  const v = base('stations', 'stations', SECTION.stationsTitle, ctx);
  let planned = false;
  for (const r of rows) {
    const item: Item = { a: displayName(r.pick.name, lang(ctx)), c: '…', action: { kind: 'open', route: { screen: 'board', areaId: r.pick.areaId, name: r.pick.name } } };
    const next = r.next && r.next.est >= ctx.now - 30_000 ? r.next : undefined;
    if (r.state === 'missing') item.c = SECTION.missingStation;
    else if (r.state === 'none') item.c = SECTION.noTrain;
    else if (next) {
      const t = departureRightText(next, ctx.now, mp(ctx));
      item.c = t.text;
      if (t.tail) item.cTail = t.tail;
      if (!next.rt && !next.cancelled) planned = true;
    }
    v.items.push(item);
  }
  v.note = ctx.stale ?? (planned && mp(ctx) ? NOTE_PLANNED : undefined);
  v.reserveNote = true;
  v.hints = hints(ctx, HINTS.stations);
  return v;
}

/* ------------------------------ Bus, tram, métro (1.2.2) ------------------------------ */

/** Un arrêt de « Arrêts de bus, tram, métro » et ses départs (absents : en calcul). */
export interface LineRow {
  pick: LinePick;
  /** Ligne à son arrêt (`pick.line`, réglages d'avant la 1.2.6) : ses sens ; plus montrée ici. */
  board?: LineBoard;
  /** Arrêt « toutes les lignes » (`pick.line` absent) : ses départs (`missing` : arrêt introuvable). */
  stop?: Board;
  /** Arrêt introuvable dans les données (cœur sans `near` : erreur areaUnknown) : « introuvable », jamais « … ». */
  missing?: true;
}

/** Ce que les passages montrés demandent dans la ligne du bas : « ~ », passage partiel « * », temps réel absent. */
interface PassageFlags {
  planned: boolean;
  partial: boolean;
  rtDown: boolean;
}

const sameHead = (a: { fr: string; nl?: string }, b: { fr: string; nl?: string }): boolean => normalizeForSearch(a.fr) === normalizeForSearch(b.fr);

/** Passages encore à venir (une réponse peut avoir 30 s). */
const ahead = (deps: readonly LineDeparture[], now: number): LineDeparture[] => deps.filter((d) => d.est >= now - 30_000);

/** Ligne du bas des écrans de lignes : « * s'arrête avant le terminus », « ~ horaire prévu », temps réel en panne. */
function passagesNote(f: PassageFlags, ctx: ViewCtx): string | undefined {
  if (ctx.stale) return ctx.stale;
  const tilde = f.rtDown || (f.planned && mp(ctx));
  if (f.partial) return tilde ? `${NOTE_PARTIAL}   ~ horaire prévu` : NOTE_PARTIAL;
  if (f.rtDown) return noRtNote(ctx);
  return tilde ? NOTE_PLANNED : undefined;
}

/** Titre d'une ligne choisie : « Bus W · Merbraine », « Gare du Nord · toutes les lignes ». */
export function linePickTitle(pick: LinePick, l: NameLang, mode?: Mode): string {
  const stop = displayName(pick.name, l);
  return pick.line ? lineTitle(mode ?? pick.mode, pick.line, stop) : allLinesTitle(stop);
}

/**
 * Mode d'une ligne choisie pour son titre (« Bus W », « Tram 3 ») : celui du cœur quand elle passe ; sinon (`none`,
 * `missing`) celui du cœur n'est qu'une supposition (le mode de l'arrêt) : celui du réglage d'abord, puis celui du cœur
 * s'il connaît ses sens, sinon aucun (« Ligne W »).
 */
function lineMode(b: LineBoard | undefined, picked: Mode | undefined): Mode | undefined {
  if (b?.state === 'ok') return b.mode;
  return picked ?? (b?.directions.length ? b.mode : undefined);
}

/**
 * Arrêt ou ligne introuvable : « introuvable : modifie-le (l'arrêt) / modifie-la (la ligne) sur le téléphone » ; Quai
 * Web : toucher ouvre sa rubrique dans l'onglet Réglages (1.2.6 : #/arrets, #/lignes).
 */
function missingLine(item: Item, ctx: ViewCtx, stop = false): Item {
  item.sub = [{ b: stop ? (ctx.web ? SECTION.missingStopWeb : SECTION.missingStop) : ctx.web ? SECTION.missingWeb : SECTION.missing }];
  if (ctx.web) item.action = stop ? { kind: 'phone', hash: '#/arrets', text: SECTION.chooseStopsWeb } : { kind: 'phone', hash: '#/lignes', text: SECTION.chooseLinesWeb };
  else delete item.action;
  return item;
}

/** 1.2.5 (PRD-1.2.5 § 4) : « Bus W vers Bruxelles Midi » : le véhicule et la destination au plus clair, « vers » pâle. */
function lineWords(vehicle: string, dest: string): Seg[] {
  return [{ t: vehicle, hi: true }, { t: 'vers' }, { t: dest, hi: true }];
}

/**
 * Un arrêt de « Arrêts de bus, tram, métro » (1.2.5, PRD-1.2.5 § 4, gardé en 1.2.6) : son nom pâle, puis ses 2 prochains
 * départs en retrait, un par ligne, « Tram 3 vers Churchill   1 min » (la ligne et sa destination au plus clair) ;
 * toucher : le tableau complet de l'arrêt. Sans départ : « aucun passage dans les prochaines heures » ; arrêt
 * introuvable : « introuvable : modifie-le sur le téléphone ».
 */
function stopItem(r: LineRow, ctx: ViewCtx, f: PassageFlags): Item {
  const p = r.pick;
  const l = lang(ctx);
  const stop = displayName(p.name, l);
  if (r.missing || r.stop?.missing) return missingLine({ a: stop, segs: [{ t: stop }] }, ctx, true);
  const deps = r.stop ? upcoming(r.stop.departures, ctx.now).slice(0, 2) : undefined;
  if (r.stop?.rtErrors.length) f.rtDown = true;
  for (const d of deps ?? []) if (!d.rt && !d.cancelled) f.planned = true;
  const sub: SubRow[] = !deps
    ? [{ b: '…' }]
    : deps.length
      ? deps.map((d) => ({ b: '', segs: lineWords(vehicleLong(d.mode, d.line), headText(d.head, l, d.op)), bRight: departureWait(d, ctx.now, mp(ctx)) }))
      : [{ b: SECTION.noPassageAll }];
  return { a: stop, segs: [{ t: stop }], sub, action: { kind: 'open', route: { screen: 'board', areaId: p.areaId, name: p.name } } };
}

/**
 * 1.2.4 (PRD-1.2.4 § 2) : ordre de « Bus, tram, métro » : les arrêts (toutes les lignes) d'abord, puis les lignes,
 * chaque bloc dans l'ordre du téléphone.
 */
export function linesInOrder<T extends { pick: Pick<LinePick, 'line'> } | Pick<LinePick, 'line'>>(rows: readonly T[]): T[] {
  const isStop = (r: T): boolean => !('pick' in r ? r.pick.line : r.line);
  return [...rows.filter(isStop), ...rows.filter((r) => !isStop(r))];
}

/**
 * « Arrêts de bus, tram, métro » (1.2.6, PRD-1.2.6 § 2 ; avant : « Bus, tram, métro », PRD-1.2.2 § 3) : les arrêts
 * choisis sur le téléphone, dans leur ordre, chacun avec ses 2 prochains départs (« ~4 min » sans temps réel). Les
 * lignes suivies ont leur écran, « Lignes de bus, tram, métro » (followsView). `focus` : le curseur sur cet arrêt.
 */
export function linesView(rows: LineRow[], ctx: ViewCtx, focus?: string): GlassesView {
  // une ligne gardée à un arrêt (réglages d'avant la 1.2.6 pas encore relus) est une ligne suivie : pas ici
  rows = rows.filter((r) => !r.pick.line);
  if (!rows.length) return chooseView('lines', ctx);
  const v = base('lines', 'lines', SECTION.stopsTitle, ctx);
  const f: PassageFlags = { planned: false, partial: false, rtDown: false };
  const ordered = linesInOrder(rows);
  ordered.forEach((r) => v.items.push(stopItem(r, ctx, f)));
  // ouverte d'office pour une ligne `near` : le curseur sur elle (la liste défile jusqu'à elle)
  const at = focus ? ordered.findIndex((r) => r.pick.id === focus) : -1;
  if (at > 0) v.initialSel = at;
  v.note = passagesNote(f, ctx);
  v.reserveNote = true;
  v.hints = hints(ctx, HINTS.lines);
  return v;
}

/** 1.2.6 : une ligne suivie de « Lignes » : ses sens (`heads`, absents : en calcul), `missing` : introuvable. */
export interface FollowRow {
  follow: LineFollow;
  mode?: Mode;
  heads?: Names[];
  missing?: true;
}

/**
 * 1.2.6 : « Lignes » : un sens par rangée, « Tram 3 vers Churchill » (la ligne et sa destination au plus
 * clair, « vers » pâle), sans arrêt ni attente : toucher ouvre toute la ligne dans ce sens.
 */
export function followsView(rows: FollowRow[], ctx: ViewCtx): GlassesView {
  if (!rows.length) return chooseView('follows', ctx);
  const v = base('follows', 'lines', SECTION.followsTitle, ctx);
  const l = lang(ctx);
  for (const r of rows) {
    const vehicle = vehicleLong(r.mode ?? r.follow.mode ?? 'bus', r.follow.line);
    if (r.missing) {
      v.items.push(missingLine({ a: vehicle }, ctx));
      continue;
    }
    if (!r.heads) {
      v.items.push({ a: vehicle, c: '…' });
      continue;
    }
    r.heads.forEach((h, dir) => v.items.push({ a: '', segs: lineWords(vehicle, headText(h, l, r.follow.op)), action: { kind: 'open', route: { screen: 'lineRun', follow: r.follow.id, dir } } }));
  }
  v.hints = hints(ctx, HINTS.follows);
  return v;
}

/** 1.2.6 : « 120 m », « 1,2 km » (relecture : 995 m disait « 1000 m »). */
export function metersText(m: number): string {
  const r = Math.round(m / 10) * 10;
  return r < 1000 ? `${r}${NB}m` : `${(Math.round(m / 100) / 10).toString().replace('.', ',')}${NB}km`;
}

/**
 * 1.2.6 : ligne suivie introuvable (données du jour, ou retirée sur le téléphone pendant qu'on la regarde) : « Introuvable :
 * modifie-la sur le téléphone. » ; Quai Web : dans Réglages, et toucher ouvre « Lignes de bus, tram, métro » de l'onglet.
 */
export function lineRunMissingView(title: string, ctx: ViewCtx): GlassesView {
  const tap: Intent | undefined = ctx.web ? { kind: 'phone', hash: '#/lignes', text: SECTION.chooseLinesWeb } : undefined;
  return messageView(title, [`${upperFirst(ctx.web ? SECTION.missingWeb : SECTION.missing)}.`], ctx, { hints: HINTS.message, screen: 'lineRun', ...(tap ? { tap } : {}) });
}

/**
 * 1.2.6 : toute la ligne dans un sens, « Tram 3 vers Churchill » : chaque arrêt dans l'ordre, ○ devant son nom, ● quand
 * un véhicule arrive (il est entre l'arrêt d'avant et celui-ci) ; un arrêt d'une variante, que seuls certains voyages
 * desservent : ◇ (◆ quand un véhicule y arrive). À droite les 2 prochains passages (« imminent · 8 min », « ~4 · ~12
 * min », « demain ~05:32 ») ; l'arrêt le plus proche dit sa distance (« à 80 m ») et porte le curseur à l'ouverture ;
 * enfin « ↔ Autre sens vers Esplanade » quand la ligne a un sens inverse (`run.other` ; une ligne en morceaux a un sens
 * par morceau). Ligne du haut : la légende de ce qui est à l'écran, « ● : un tram arrive », « ◇ : pas tous les trams »,
 * ou les deux. Toucher un arrêt : les passages de la ligne à cet arrêt (détail de la 1.2.2).
 */
export function lineRunView(r: LineRunRoute, follow: LineFollow, run: LineRun, ctx: ViewCtx): GlassesView {
  const l = lang(ctx);
  const vehicle = vehicleLong(run.mode, run.line);
  const head = run.heads[run.dir];
  const title = head ? `${vehicle} vers ${headText(head, l, run.op)}` : vehicle;
  if (run.state === 'missing') return lineRunMissingView(title, ctx);
  const v = base('lineRun', 'lines', title, ctx);
  const f: PassageFlags = { planned: false, partial: false, rtDown: run.rtError };
  run.stops.forEach((st, i) => {
    // 1.2.7 : le prochain passage seul, en clair (« dans 5 min ») ; « ~ » expliqué seulement s'il est montré
    const next = st.next[0];
    if (next && !next.rt) f.planned = true;
    // le repère et le nom dans le même conteneur (au plus clair) : les noms restent alignés (○ ● ◇ ◆ : 20 px chacun)
    const mark = st.vehicle ? (st.branch ? '◆' : '●') : st.branch ? '◇' : '○';
    const segs: Seg[] = [{ t: mark, hi: true }, { t: displayName(st.name, l), hi: true }];
    if (run.nearest?.index === i) segs.push({ t: `à ${metersText(run.nearest.distanceM)}` });
    const right = nextPassageText(next && { est: next.t, rt: next.rt }, ctx.now, mp(ctx));
    v.items.push({
      a: '',
      segs,
      bRight: right,
      // 1.2.8 : la note « ~ » seulement sous une page qui en montre un
      ...(right.includes('~') ? { planned: true } : {}),
      action: { kind: 'open', route: { screen: 'line', areaId: st.areaId, op: run.op, line: run.line, name: st.name, mode: run.mode } },
      key: `${st.areaId}#${i}`,
    });
  });
  // le sens inverse (le même morceau, dans l'autre sens) ; une boucle ou un morceau sans retour n'en a pas
  const back = run.other;
  const otherHead = back !== undefined && back !== run.dir ? run.heads[back] : undefined;
  if (back !== undefined && otherHead) {
    v.items.push({ a: '', segs: [{ t: '↔', hi: true }, { t: SECTION.otherWay, hi: true }, { t: 'vers' }, { t: headText(otherHead, l, run.op), hi: true }], action: { kind: 'open', route: { screen: 'lineRun', follow: follow.id, dir: back } } });
  }
  if (run.nearest) v.initialSel = run.nearest.index;
  // ligne du haut : la légende de ce qui est à l'écran ; un ◆ compte comme un véhicule qui arrive
  const word = run.mode === 'tram' ? 'tram' : run.mode === 'metro' ? 'métro' : 'bus';
  const legend = [
    run.stops.some((st) => st.vehicle) ? `●${NB}: un ${word} arrive` : '',
    run.stops.some((st) => st.branch) ? `◇${NB}: pas tous les ${word === 'bus' ? 'bus' : `${word}s`}` : '',
  ].filter(Boolean);
  if (legend.length) v.top = { text: legend.join(' · ') };
  // 1.2.8 : « ~ horaire prévu » seul : dit sous une page qui montre un « ~ » (notePlanned)
  const note = passagesNote(f, ctx);
  if (note === NOTE_PLANNED) v.notePlanned = note;
  else v.note = note;
  v.reserveNote = true;
  v.paged = true;
  v.hints = hints(ctx, HINTS.lineRun);
  v.log = { line: run.line, dir: run.dir, stops: run.stops.length, vehicles: run.stops.filter((st) => st.vehicle).length, nearest: run.nearest?.index ?? -1, branches: run.stops.filter((st) => st.branch).length };
  return v;
}

/**
 * Détail d'une ligne à son arrêt (§ 3) : pour chaque sens, « vers {terminus} » puis ses 4 prochains passages, en
 * retrait : heure prévue (« ~ » sans temps réel, retard « +3 »), terminus s'il diffère (« jusqu'à Waterloo Eglise »
 * pour un passage partiel), attente (« dans 3 min », « imminent », « SUPPRIMÉ ») ; enfin « Tous les départs de
 * l'arrêt ». 1.2.3 (PRD-1.2.3 § 2) : curseur de passage en passage, la liste défile par page ; toucher un passage :
 * ses arrêts ; « Tous les départs de l'arrêt » : le tableau complet. `works` : alerte travaux (ligne du haut).
 */
export function lineView(r: LineRoute, b: LineBoard, ctx: ViewCtx, works?: string): GlassesView {
  const l = lang(ctx);
  const title = lineTitle(lineMode(b, r.mode), r.line, displayName(r.name, l));
  if (b.state === 'missing') return messageView(title, [`${upperFirst(ctx.web ? SECTION.missingWeb : SECTION.missing)}.`], ctx, { hints: HINTS.message, screen: 'line' });
  const v = base('line', 'line', title, ctx);
  const f: PassageFlags = { planned: false, partial: false, rtDown: b.rtErrors.length > 0 };
  for (const dir of b.directions) {
    // 1.2.3 : « vers … » au-dessus du premier passage du sens (il défile avec lui, jamais sous le curseur)
    const group = `vers ${headText(dir.head, l, b.op)}`;
    const deps = ahead(dir.departures, ctx.now).slice(0, 4);
    if (!deps.length) v.items.push({ group, a: '', b: SECTION.noPassage });
    deps.forEach((d, k) => {
      if (!d.rt && !d.cancelled) f.planned = true;
      const other = d.partial ? untilText(headText(d.head, l, b.op)) : sameHead(d.head, dir.head) ? '' : `vers ${headText(d.head, l, b.op)}`;
      // 1.2.3 (§ 2) : toucher un passage ouvre ses arrêts
      // 1.2.4 (PRD-1.2.4 § 4) : l'heure alignée dans sa case (bLead), le « ~ » dans le retrait
      const t = passageParts(d, mp(ctx));
      const item: Item = { a: '', bLead: t.lead, b: other ? `${t.rest}  ${other}` : t.rest, c: waitText(d, ctx.now), action: { kind: 'open', route: stopsRoute(b.area.id, d) }, key: departureKey(d) };
      if (k === 0) item.group = group;
      const last = lastMark(d);
      if (last) item.bTail = last;
      v.items.push(item);
    });
  }
  if (!b.directions.length) v.items.push({ a: ctx.stale ?? SECTION.noPassageAll });
  v.items.push({ a: SECTION.allDepartures, action: { kind: 'open', route: { screen: 'board', areaId: r.areaId, name: r.name } } });
  if (works) v.top = { text: `! ${works}`, strong: true };
  // Le détail dit le terminus d'un passage partiel en toutes lettres : la ligne du bas n'a pas besoin de « * ».
  v.note = passagesNote({ ...f, partial: false }, ctx);
  v.reserveNote = true;
  // 1.2.3 : curseur de passage en passage (sur le premier à l'ouverture), la liste défile par page
  v.paged = true;
  v.hints = hints(ctx, HINTS.line);
  v.log = { line: r.line, directions: b.directions.length, items: v.items.length };
  return v;
}

/* ------------------------------ Garder une ligne (1.2.2) ------------------------------ */

/** Une ligne d'un arrêt (core.linesAt, une entrée par ligne). */
export interface StopLine {
  line: string;
  mode: Mode;
  /**
   * 1.2.6 (contrôle qualité) : variantes de la ligne qui passe à cet arrêt (findLines autour de lui), lues quand une
   * ligne suivie porte le même numéro : le W de Tournai n'est pas celui de Waterloo.
   */
  routes?: string[];
}

/** Titre : « Gare du Nord : garder une ligne », le nom de l'arrêt coupé si trop long. */
export function keepLineTitle(stop: string): string {
  const tail = `${NB}: garder une ligne`;
  if (textWidth(stop + tail) <= WIDTHS.title) return stop + tail;
  return `${truncate(stop, WIDTHS.title - textWidth(tail))}${tail}`;
}

/**
 * « {arrêt} : garder une ligne » (REVUE-USAGE n° 3), ouvert par ★ des départs d'un arrêt de bus, tram ou métro : les
 * lignes de l'arrêt (« tram 3 », « bus 58 »), « ★ » à droite de celles gardées dans « Bus, tram, métro » ; toucher :
 * garder la ligne à cet arrêt (les deux sens) ou la retirer ; double toucher : retour aux départs.
 */
export function keepLineView(r: KeepLineRoute, lines: StopLine[], ctx: ViewCtx): GlassesView {
  const title = keepLineTitle(displayName(r.name, lang(ctx)));
  if (!lines.length) return messageView(title, ['Aucune ligne à cet arrêt aujourd’hui.'], ctx, { hints: HINTS.message, screen: 'keepLine' });
  const v = base('keepLine', 'menu', title, ctx);
  for (const x of lines) {
    // 1.2.6 : ★ = la ligne entière est dans « Lignes » (où qu'elle ait été ajoutée)
    const kept = r.op !== 'sncb' && (ctx.settings.follows ?? []).some((f) => isFollowed(f, { op: r.op, line: x.line, routes: x.routes }));
    v.items.push({ a: rideWords({ op: r.op, mode: x.mode, line: x.line }), c: kept ? '★' : '', action: { kind: 'toggleLine', line: x.line, mode: x.mode } });
  }
  v.hints = hints(ctx, HINTS.keepLine);
  return v;
}

/* ------------------------------ Autour de moi ------------------------------ */

/**
 * « Autour de moi » ; vide (1.2.2, REVUE-USAGE n° 10) : l'arrêt le plus proche dans 3 km (`nearest`, recherche
 * légère du contrôleur), toucher : ses départs ; rien à 3 km : où régler le rayon.
 */
export function nearbyView(list: NearbyItem[], ctx: ViewCtx, nearest?: NearbyItem | null): GlassesView {
  const radius = ctx.settings.display.radiusM;
  if (!list.length) {
    const none = `Aucun arrêt à moins de ${radius}${NB}m.`;
    if (nearest) {
      const route: Route = { screen: 'board', areaId: nearest.area.id, name: nearest.area.n };
      const text = `Le plus proche${NB}: ${displayName(nearest.area.n, lang(ctx))}, à ${distanceText(nearest.distanceM)}.`;
      return messageView('Autour de moi', [none, text], ctx, { hints: HINTS.nearest, tap: { kind: 'open', route } });
    }
    const where = ctx.web ? `Rayon réglable dans l’onglet Réglages${NB}: Affichage.` : `Rayon réglable sur le téléphone${NB}: Affichage.`;
    return messageView('Autour de moi', [none, where], ctx, { hints: HINTS.message });
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

/**
 * Titre des départs : « Gare du Nord, tram et bus (STIB) » ; « ★ » à la fin si la gare est dans « Gares », ou si une
 * ligne de l'arrêt est dans « Bus, tram, métro » (1.2.2) ; nom long coupé.
 */
export function boardViewTitle(b: Pick<Board, 'area'>, l: NameLang, kept: boolean): string {
  const full = `${boardTitle(b.area, l)}${kept ? ' ★' : ''}`;
  if (textWidth(full) <= WIDTHS.title) return full;
  const name = displayName(b.area.n, l);
  const tail = full.slice(name.length);
  return `${truncate(name, WIDTHS.title - textWidth(tail))}${tail}`;
}

/** Départs d'une gare SNCB (★ : « Gares ») plutôt que d'un arrêt de bus, tram ou métro (★ : « garder une ligne »). */
export const isStationBoard = (b: Pick<Board, 'area'>): boolean => b.area.modes.includes('train') && b.area.op === 'sncb';

/** 1.2.3 : les arrêts d'un départ d'un tableau (§ 2), ouverts en le touchant. */
export function stopsRoute(areaId: string, d: Departure): StopsRoute {
  return { screen: 'stops', areaId, dep: d };
}

/**
 * 1.2.3 : identité d'un départ, « identité@minutes » : réseau, mode, ligne, destination (normalisée), quai et voyage
 * (s'il est connu : jamais pour la STIB), puis l'heure prévue en minutes. Deux sens d'une même ligne à la même minute
 * restent distincts (« M1 Stockel » et « M1 Gare de l'Ouest » à 23:20). Sert de clé au cache des arrêts d'un départ
 * et d'ancre au curseur d'un tableau (Item.key, NavFrame.key) ; un départ dont l'heure a glissé se retrouve par son
 * identité et l'heure la plus proche (anchorIndex).
 */
export function departureKey(d: Pick<Departure, 'op' | 'mode' | 'line' | 'head' | 'stopId' | 'tripId' | 'sched'>): string {
  return `${d.op}|${d.mode}|${d.line}|${normalizeForSearch(d.head?.fr ?? '')}|${d.stopId ?? ''}|${d.tripId ?? ''}@${Math.round(d.sched / 60_000)}`;
}

/**
 * 1.2.3 (PRD-1.2.3 § 1) : tableau complet d'une gare ou d'un arrêt : tous les départs des 2 prochaines heures (le
 * contrôleur demande `horizonMin` ; rien dans les 2 heures : le prochain, même plus tard, sinon « aucun départ »), un
 * par ligne, les supprimés à leur place. Curseur de départ en départ, sur le premier à l'ouverture ; la liste défile
 * par page ; toucher un départ : ses arrêts (§ 2). En tête, la ligne ★, comme le toucher de la 1.2.2 : « ★ garder la
 * gare » ou « ★ retirer la gare » (gare SNCB : « Gares », annulable 5 s), « ★ garder une ligne » (arrêt de bus, tram ou
 * métro). `kept` : la gare, ou une ligne de l'arrêt, est déjà gardée (« ★ » en fin de titre).
 */
export function boardView(b: Board, ctx: ViewCtx, opts: { kept: boolean }): GlassesView {
  const train = isStationBoard(b);
  const v = base('board', train ? 'boardTrain' : 'board', boardViewTitle(b, lang(ctx), opts.kept), ctx);
  v.items.push(
    train
      ? { a: opts.kept ? BOARD.dropStation : BOARD.keepStation, action: { kind: 'toggleStation' } }
      : { a: BOARD.keepLine, action: { kind: 'open', route: { screen: 'keepLine', areaId: b.area.id, op: b.area.op, name: b.area.n, lat: b.area.lat, lon: b.area.lon } } },
  );
  const deps = b.departures;
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
    const action: Intent = { kind: 'open', route: stopsRoute(b.area.id, d) };
    // l'identité du départ : le curseur le suit au rafraîchissement et au retour de ses arrêts (la ligne ★ n'en a pas)
    const key = departureKey(d);
    const item: Item = train
      ? { a: d.line, b: head, cLead: trainCellParts(d, mp(ctx)).lead, c: trainCellParts(d, mp(ctx)).rest, action, key }
      : { a: lineLabel(d.mode, d.line), b: head, bTail: lastMark(d), c: minutesText(d, ctx.now, mp(ctx)), action, key };
    // 1.2.8 : la note « ~ » seulement sous une page qui en montre un
    if (`${item.cLead ?? ''}${item.c ?? ''}`.includes('~')) item.planned = true;
    v.items.push(item);
  }
  if (!deps.length) v.items.push({ a: ctx.stale ?? BOARD.none });
  if (msg) v.top = { text: `! ${msg}`, strong: true };
  else if (allTomorrow) v.top = { text: 'Départs de demain' };
  if (b.rtErrors.length) v.note = noRtNote(ctx);
  else if (planned && mp(ctx)) v.notePlanned = NOTE_PLANNED;
  v.reserveNote = true;
  v.initialSel = 1;
  v.paged = true;
  v.hints = hints(ctx, HINTS.board);
  v.log = { departures: deps.length };
  return v;
}

/* ------------------------------ Arrêts d'un départ (1.2.3) ------------------------------ */

/** Titre des arrêts d'un départ (§ 2) : « IC vers Herstal », « Bus W vers Bruxelles Midi », « Tram 3 vers Churchill ». */
export function stopsTitle(d: Pick<Departure, 'op' | 'mode' | 'line' | 'head'>, l: NameLang): string {
  return `${vehicleWords(d)} vers ${headText(d.head, l, d.op)}`;
}

/**
 * 1.2.3 (PRD-1.2.3 § 2) : les arrêts d'un départ. En haut, au plus clair, l'arrêt du tableau (son heure, son nom, sa
 * voie) ; dessous, un ton plus pâle, les arrêts suivants jusqu'au terminus : l'heure prévue (« ~ » sans temps réel,
 * retard « +3 »), le nom, la voie d'un train (modifiée : « voie 6 ! ») ou « SUPPRIMÉ ». Curseur sur le premier arrêt
 * suivant, la liste défile par page ; toucher un arrêt : son tableau (§ 1) ; double toucher : retour. Départ d'un
 * autre jour : « , demain » au titre. Voyage disparu des données : « Ce départ n'est plus dans les horaires. »
 */
export function stopsView(r: StopsRoute, ds: DepartureStops, ctx: ViewCtx): GlassesView {
  const l = lang(ctx);
  const title = stopsTitle(ds.state === 'ok' ? ds : r.dep, l);
  if (ds.state !== 'ok' || !ds.stops.length) return messageView(title, [BOARD.vanished], ctx, { hints: HINTS.message, screen: 'stops' });
  // 1.2.8 : un train, tout son trajet
  if (ds.op === 'sncb') return trainRunView(ds, ctx);
  const [first, ...rest] = ds.stops;
  const day = dayWord(first.sched, ctx.now);
  const v = base('stops', 'stops', day ? `${title}, ${day}` : title, ctx);
  const m = mp(ctx);
  // 1.2.4 (PRD-1.2.4 § 4) : heures alignées dans leur case (aLead), retard à la suite
  const t0 = stopTimeParts(first, m);
  const cols: [string, string, string] = [t0.rest, displayName(first.name, l), stopRightText(first)];
  v.top = { text: [stopTimeText(first, m), cols[1], cols[2]].filter(Boolean).join(COL_SEP), cols, lead: t0.lead, strong: true };
  for (const c of rest) {
    const t = stopTimeParts(c, m);
    const item: Item = { a: t.rest, aLead: t.lead, b: displayName(c.name, l), c: stopRightText(c) };
    if (c.areaId) item.action = { kind: 'open', route: { screen: 'board', areaId: c.areaId, name: c.name } };
    v.items.push(item);
  }
  v.note = ctx.stale ?? (ds.anyPlanned && m ? NOTE_PLANNED : undefined);
  v.reserveNote = true;
  v.paged = true;
  v.hints = hints(ctx, HINTS.stops);
  v.log = { stops: ds.stops.length };
  return v;
}

/**
 * 1.2.8 (PRD-1.2.8 § 1, § 2) : tout le trajet d'un train touché dans un tableau, comme toute la ligne : ses gares, de sa
 * gare de départ à son terminus ; ○ devant chacune, ● sur celle où il arrive (d'après le temps réel seul,
 * trainProgress), dit par la ligne du haut ; le nom au plus clair, la voie en pâle (modifiée : au plus clair,
 * « voie 6 ! ») ; à droite le passage en clair (« dans 6 min », « imminent », « à 23:40 », « ~ » sans temps réel) ou
 * « SUPPRIMÉ ». Les gares que le train a quittées, tout en pâle, avec leur heure. Curseur sur la gare du tableau, la
 * gare d'avant au-dessus d'elle ; toucher une gare : ses départs. Départ d'un autre jour : « , demain » au titre.
 */
export function trainRunView(ds: DepartureStops, ctx: ViewCtx): GlassesView {
  const l = lang(ctx);
  const m = mp(ctx);
  const at = Math.min(Math.max(0, ds.at ?? 0), ds.stops.length - 1);
  const title = stopsTitle(ds, l);
  const day = dayWord(ds.stops[at].sched, ctx.now);
  const v = base('trainRun', 'lines', day ? `${title}, ${day}` : title, ctx);
  const { passed, vehicle } = trainProgress(ds.stops, ctx.now);
  ds.stops.forEach((c, i) => {
    const gone = passed[i];
    const plat = c.cancelled ? '' : platformText(c.platform, c.newPlatform);
    const segs: Seg[] = [
      { t: i === vehicle ? '●' : '○', hi: !gone },
      { t: displayName(c.name, l), hi: !gone },
    ];
    if (plat) segs.push({ t: plat, hi: !gone && !!c.newPlatform });
    const right = c.cancelled ? 'SUPPRIMÉ' : gone ? `${plannedMark(c.rt, m)}${hhmm(c.est)}` : nextPassageText({ est: c.est, rt: c.rt }, ctx.now, m);
    const item: Item = { a: '', segs, bRight: right, key: `${c.areaId ?? ''}#${i}` };
    if (gone) item.rightPale = true;
    if (right.includes('~')) item.planned = true;
    if (c.areaId) item.action = { kind: 'open', route: { screen: 'board', areaId: c.areaId, name: c.name } };
    v.items.push(item);
  });
  if (vehicle >= 0) v.top = { text: `●${NB}: le train arrive` };
  if (ctx.stale) v.note = ctx.stale;
  else if (m) v.notePlanned = NOTE_PLANNED;
  v.reserveNote = true;
  // la gare d'avant au-dessus du curseur ; un train qui arrive (●) avant la gare du tableau : son ● et la gare qu'il
  // vient de quitter sur la même page que le curseur, si tout tient (sinon son ● seul, sinon la gare d'avant)
  v.initialSel = at;
  const rows = geometry(v).capacity;
  let top = Math.max(0, at - 1);
  if (vehicle >= 0 && vehicle < at) {
    if (at - Math.max(0, vehicle - 1) < rows) top = Math.max(0, vehicle - 1);
    else if (at - vehicle < rows) top = vehicle;
  }
  v.initialTop = top;
  v.paged = true;
  v.hints = hints(ctx, HINTS.trainRun);
  v.log = { stops: ds.stops.length, gare: at, vehicle, passed: passed.filter(Boolean).length };
  return v;
}

/** « , dernier » pour le dernier passage annoncé d'une ligne (jamais pour un départ supprimé). */
export function lastMark(d: Pick<Departure, 'last' | 'cancelled'> | Pick<Leg, 'last' | 'cancelled'> | undefined): string | undefined {
  return d?.last && !d.cancelled ? LAST_MARK : undefined;
}

/* ------------------------------ Trajet proposé (étapes) ------------------------------ */

/** Ce que l'écran des étapes affiche, en plus de la route. */
export interface StepsData {
  /** Propositions (rafraîchies), dans l'ordre du cœur. */
  journeys: Journey[];
  /** Proposition affichée. */
  index: number;
  /** Identifiant du trajet suivi (« ▶ », « Suivi » sur la ligne du titre, toucher : « Ne plus suivre »). */
  followedId?: string;
  /** Départ à pied figé du trajet suivi (1.0 : l'heure affichée ne recule plus une fois partie). */
  leaveAt0?: number;
  /** Défilement du cadre et premier affichage. */
  top?: number;
  fresh?: boolean;
  /** 1.2.1 : proposition ouverte depuis « Autres trajets » (▼ au bout : retour à la liste). */
  fromList?: boolean;
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
  /** 1.2.5 : correspondance : minutes entre l'arrivée à pied (ou la descente) et le départ de ce véhicule. */
  margin?: number;
}

/** « la gare » devant un train, sinon « l’arrêt » ; `precise` : « l’arrêt du tram » (bus, métro). */
function placeWord(next: Leg | undefined, precise: boolean): string {
  if (next?.mode === 'train') return 'la gare';
  return precise ? ARRET[next?.mode ?? 'bus'] ?? 'l’arrêt' : 'l’arrêt';
}

/**
 * 1.2.4 (PRD-1.2.4 § 1) : une marche nomme toujours où aller, en entier. Sur la ligne quand tout tient (« À pied vers
 * Bruxelles-Central (3 min) ») ; sinon « À pied vers l’arrêt du tram (3 min) » et le nom en entier sur la ligne
 * suivante (`always` : toujours sur deux lignes, le départ à pied d'un trajet). La place se mesure avec la colonne
 * d'état (« dans 4 min ») : la forme ne change pas quand l'état apparaît.
 */
function walkItem(time: string, verb: string, generic: string, name: string, w: number, always = false, rain = false): Item {
  // 1.2.5 : pluie prévue pendant une marche de 5 min ou plus : « (7 min, pluie) »
  const bTail = ` (${minText(w)}${rain ? RAIN_TAIL : ''})`;
  const one = `${verb} vers ${name}`;
  if (!always && textWidth(one + bTail) <= WIDTHS.stepsText) return { a: time, b: one, bTail };
  return { a: time, b: `${verb} vers ${generic}`, bTail, b2: name };
}

/**
 * Étapes d'un trajet (PRD § 6.1 L3, S6) : durées de marche dans le texte, colonne d'état à droite.
 * « À pied vers l’arrêt du tram » (bus, métro) ou « À pied vers la gare » quand la zone porte le nom de l'arrêt de
 * descente ; trajet entièrement à pied : « Partir à pied » puis « Arrivée … ». 1.2.4 (PRD-1.2.4 § 1) : le départ à
 * pied nomme l'arrêt ou la gare en entier sur sa 2e ligne (« Partir à pied vers l’arrêt (7 min) », puis « Braine-
 * l'Alleud Route de Mont-Saint-Jean ») ; une marche trop longue pour sa ligne aussi ; un trajet qui commence à bord
 * (trajet fixe depuis une gare) dit d'où il part (« depuis Bruxelles-Central »).
 */
function stepRows(j: Journey, at: string, leave: number, ctx: ViewCtx): StepRow[] {
  const l = lang(ctx);
  const rows: StepRow[] = [];
  const rides = j.legs.filter((x) => x.kind === 'ride');
  if (!rides.length) {
    const min = Math.max(1, Math.round((j.arr - j.dep) / 60_000));
    const rain = rainyJourney(j) && min >= 5;
    rows.push({ item: { a: hhmm(j.dep), b: 'Partir à pied', bTail: ` (${minText(min)}${rain ? RAIN_TAIL : ''})` }, start: j.dep, end: j.arr, markable: true });
    rows.push({ item: { a: hhmm(j.arr), b: `Arrivée ${at}` }, start: j.arr, end: j.arr, markable: false });
    return rows;
  }
  let prevRide: Leg | undefined;
  j.legs.forEach((leg, i) => {
    const last = i === j.legs.length - 1;
    if (leg.kind === 'walk') {
      const w = walkMinOf(leg);
      const rain = rainyWalk(leg);
      if (i === 0) {
        const next = j.legs.slice(1).find((x) => x.kind === 'ride');
        const item = walkItem(hhmm(leave), 'Partir à pied', placeWord(next, false), displayName(leg.to.name, l), w, true, rain);
        rows.push({ item, start: leave, end: Math.max(leg.arr, leave + 60_000), markable: true });
      } else if (last) {
        rows.push({ item: { a: hhmm(leg.arr), b: `Arrivée ${at}`, bTail: ` (${minText(w)} à pied${rain ? RAIN_TAIL : ''})` }, start: leg.dep, end: leg.arr, markable: true });
      } else {
        const next = j.legs.slice(i + 1).find((x) => x.kind === 'ride');
        const same = prevRide && sameName(leg.to.name, prevRide.to.name);
        const item = same
          ? { a: hhmm(leg.dep), b: `À pied vers ${placeWord(next, true)}`, bTail: ` (${minText(w)}${rain ? RAIN_TAIL : ''})` }
          : walkItem(hhmm(leg.dep), 'À pied', placeWord(next, true), displayName(leg.to.name, l), w, false, rain);
        rows.push({ item, start: leg.dep, end: leg.arr, markable: true });
      }
      return;
    }
    const head = leg.head ? ` vers ${headText(leg.head, l, leg.op)}` : '';
    const p = leg.newPlatform || leg.platform;
    const plat = leg.mode === 'train' && p ? `, voie ${p}` : '';
    const tail = `${plat}${lastMark(leg) ?? ''}`;
    rows.push({
      // 1.2.2 (REVUE-USAGE n° 8) : le véhicule en toutes lettres, « Bus W vers Bruxelles Midi », « Métro 2 vers Simonis ».
      // 1.2.4 : à bord dès le départ (pas de marche avant) : d'où il part, sur la 2e ligne.
      item: {
        a: `${plannedMark(leg.rt ?? false, mp(ctx))}${hhmm(leg.schedDep)}`,
        b: `${vehicleWords(leg)}${head}`,
        ...(tail ? { bTail: tail } : {}),
        ...(i === 0 ? { b2: `depuis ${displayName(leg.from.name, l)}` } : {}),
      },
      start: leg.dep,
      end: leg.arr,
      markable: true,
      ride: leg,
      // 1.2.5 : correspondance : de l'arrivée de l'étape précédente (marche ou descente) au départ de ce véhicule
      ...(prevRide && i > 0 ? { margin: Math.floor((leg.dep - j.legs[i - 1].arr) / 60_000) } : {}),
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
  // 1.2.5 (PRD-1.2.5 § 2) : correspondance serrée, avant son départ : « très juste » d'abord (aucune marge, même avec
  // un retard de ce véhicule) ; puis son retard, l'heure de la ligne étant la prévue ; puis « marge 2 min » (5 min ou moins)
  const tight = r.margin !== undefined && r.margin <= MARGIN_SHOWN_MAX && now < r.start;
  if (tight && r.margin! <= 0) return marginText(r.margin!);
  const delay = r.ride?.delayMin ?? 0;
  if (r.ride && delay > 0 && now < r.end) return `+${minText(delay)}`;
  if (tight) return marginText(r.margin!);
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

/** Message quand une session n'a qu'une proposition (inchangé, PRD-1.2.1 § 3.6). */
export const NO_OTHER_TRIP = 'Pas d’autre trajet pour l’instant';

/**
 * Ligne du bas : ce que fera ▼ (PRD-1.2.1 § 3.2). Étapes cachées : « ▽ suite du trajet : 3 étapes » ; au bout (la
 * dernière étape visible) : « Fin du trajet. ▽ 2 autres trajets », « … ▽ 1 autre trajet », « Fin du trajet. Pas
 * d’autre trajet pour l’instant » ; proposition ouverte depuis la liste : « Fin du trajet. ▽ autres trajets ».
 * 1.2.4 (PRD-1.2.4 § 4) : triangle vide, comme les aides.
 */
function stepsBottom(hiddenBelow: number, d: StepsData): string {
  if (hiddenBelow > 0) return `▽ suite du trajet${NB}: ${hiddenBelow} étape${hiddenBelow > 1 ? 's' : ''}`;
  if (d.fromList) return 'Fin du trajet. ▽ autres trajets';
  const n = d.journeys.length - 1;
  if (n <= 0) return `Fin du trajet. ${NO_OTHER_TRIP}`;
  return `Fin du trajet. ▽ ${n === 1 ? '1 autre trajet' : `${n} autres trajets`}`;
}

/**
 * 1.2.2 (PRD-1.2.2 § 6) : à droite du titre d'un trajet, son état : suivi, ou à suivre d'un toucher (« Suivre » quand
 * « Suivre ce trajet » couperait la destination).
 */
export const FOLLOWED_TEXT = 'Suivi';
export const FOLLOW_TEXT = 'Suivre ce trajet';
export const FOLLOW_SHORT = 'Suivre';

/**
 * « Trajet proposé » (L3) : une proposition, sans curseur. 1.2.1 : ▲▼ font défiler ses étapes seulement ; au bout, ▼
 * ouvre « Autres trajets » (contrôleur). « ▶ » marque l'étape en cours ou la prochaine du trajet suivi seulement.
 * 1.2.2 (PRD-1.2.2 § 6) : la ligne du titre dit l'état, quelle que soit l'aide des gestes : « Suivi », ou « Suivre ce
 * trajet » (toucher le fait suivre, la 1re proposition comprise) ; sur le trajet suivi, toucher propose « Ne plus
 * suivre » (écran `followed`, avec le détail du véhicule). Trajet à pied : rien à suivre.
 */
export function stepsPage(route: Pick<StepsRoute, 'title' | 'label'>, d: StepsData, ctx: ViewCtx): GlassesView {
  const j = d.journeys[d.index];
  const title = stepsTitleOf(route);
  const followed = !!d.followedId && j.id === d.followedId;
  const walkOnly = !j.legs.some((x) => x.kind === 'ride');
  const leave = shownLeave(j, ctx.now, followed ? d.leaveAt0 : undefined);
  const start = journeyStart(j, leave);
  const span = `${NB}: ${spanText(start, j.arr, ctx.now)}`;
  // le titre est coupé avant l'état, jamais l'inverse (écart des colonnes, 10 px, et marge)
  const roomFor = (st: string): number => WIDTHS.title - (st ? textWidth(st) + 12 : 0);
  const follow = textWidth(title + span) <= roomFor(FOLLOW_TEXT) ? FOLLOW_TEXT : FOLLOW_SHORT;
  const state = walkOnly ? '' : followed ? FOLLOWED_TEXT : follow;
  const room = roomFor(state);
  const head = textWidth(title + span) <= room ? title : truncate(title, room - textWidth(span));
  const v = base('steps', 'steps', `${head}${span}`, ctx);
  if (state) v.titleRight = state;
  const rows = stepRows(j, atTitle(title), leave, ctx);
  const nextIdx = rows.findIndex((r) => r.markable && r.start > ctx.now);
  rows.forEach((r, k) => {
    const c = stateOf(r, k === nextIdx, ctx.now);
    v.items.push(c ? { ...r.item, c } : r.item);
  });
  const alert = j.alerts[0];
  // 1.2.5 : ligne du haut : l'alerte d'abord, puis « Si tu le rates » quand le départ approche, sinon le pourquoi
  const miss = missLine(j, d.journeys, leave, ctx.now);
  let top: TopLine | undefined;
  if (alert) top = { text: alert.text, strong: true };
  else if (miss) top = { text: miss };
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
  // Défilement : au premier affichage, le repère reste visible. 1.2.4 : une étape peut tenir sur deux lignes (le
  // nom de l'arrêt où aller) : les pages se comptent en lignes, les étapes cachées en étapes.
  const capacity = geometry(v).capacity;
  const max = maxTop(v.items, capacity);
  v.initialTop = mark > 0 ? Math.min(max, ensureVisible(v.items, mark, 0, capacity)) : 0;
  const wanted = d.fresh && v.initialTop !== undefined ? v.initialTop : d.top ?? 0;
  const shownTop = Math.min(Math.max(0, wanted), max);
  v.note = stepsBottom(Math.max(0, v.items.length - visibleRange(v.items, shownTop, capacity).to), d);
  if (walkOnly) v.hints = hints(ctx, HINTS.stepsWalk);
  else if (followed) {
    v.hints = hints(ctx, HINTS.steps);
    v.tap = { kind: 'open', route: { screen: 'followed' } };
  } else {
    v.hints = hints(ctx, HINTS.stepsOther);
    v.tap = { kind: 'follow' };
  }
  v.log = { page: d.index + 1, pages: d.journeys.length, label: labelOf(j.label) ?? '', followed };
  return v;
}

/** 1.2.5 : « Si tu le rates » paraît 5 min au plus avant de partir, et jusqu'au départ du premier véhicule. */
export const MISS_WINDOW_MIN = 5;

/** 1.2.5 : même arrêt ou même gare : même zone, ou même nom à 400 m au plus (quais et voies d'une même gare). */
export const SAME_STOP_M = 400;
function sameStop(a: Leg['from'], b: Leg['from']): boolean {
  if (a.areaId && b.areaId && a.areaId === b.areaId) return true;
  return sameName(a.name, b.name) && distanceM(a, b) <= SAME_STOP_M;
}

/**
 * 1.2.5 : fenêtre de « Si tu le rates » : 5 min au plus avant de partir (à pied, ou à bord dès le départ), jusqu'au
 * départ du premier véhicule (pas supprimé). Le contrôleur rafraîchit alors aussi les trajets de repli.
 */
export function inMissWindow(j: Journey, now: number, leave = j.leaveAt): boolean {
  const first = j.legs.find((l) => l.kind === 'ride');
  if (!first || first.cancelled || now >= first.dep) return false;
  const go = j.legs[0]?.kind === 'walk' ? leave : first.dep;
  return go - now <= MISS_WINDOW_MIN * 60_000;
}

/**
 * 1.2.5 (PRD-1.2.5 § 1) : « Si tu le rates : arrivée 09:57, 59 min plus tard ». Qui rate son départ est à l'arrêt ou à
 * la gare : parmi les trajets déjà calculés, ceux qui en repartent plus tard (un autre trajet peut y passer, le suivant
 * aussi), et le premier arrivé. Rien quand aucun n'en repart (le « , dernier » de la ligne du véhicule le dit déjà), ni
 * quand le premier véhicule est supprimé (l'alerte le dit). Un fait, jamais un conseil.
 */
export function missLine(j: Journey, journeys: readonly Journey[], leave: number, now: number): string | null {
  const first = j.legs.find((l) => l.kind === 'ride');
  if (!first || !inMissWindow(j, now, leave)) return null;
  let best: number | undefined;
  for (const x of journeys) {
    if (x.id === j.id) continue;
    const k = x.legs.findIndex((r) => r.kind === 'ride' && !r.cancelled && r.dep > first.dep && sameStop(r.from, first.from));
    // la suite de ce trajet doit rouler : une suppression plus loin, et son heure d'arrivée ne vaut plus
    if (k < 0 || x.legs.slice(k).some((r) => r.kind === 'ride' && r.cancelled)) continue;
    if (best === undefined || x.arr < best) best = x.arr;
  }
  return best === undefined ? null : missText(best, shownGap(j.arr, best), now);
}

/** Titre de l'écran du trajet suivi : « Vers le bureau : trajet suivi », le titre du trajet coupé si trop long. */
export function followedTitle(title: string): string {
  const tail = `${NB}: trajet suivi`;
  if (textWidth(title + tail) <= WIDTHS.title) return title + tail;
  return `${truncate(title, WIDTHS.title - textWidth(tail))}${tail}`;
}

/** Ce que l'écran du trajet suivi montre : le trajet (rafraîchi) et son titre. */
export interface FollowedData {
  title: string;
  journey: Journey;
}

/**
 * 1.2.2 (PRD-1.2.2 § 6) : toucher sur le trajet suivi : « Ne plus suivre » (curseur dessus : un second toucher arrête
 * le suivi, double toucher revient aux étapes), puis le détail du véhicule en cours ou du prochain (« Arrêts : IC vers
 * Bruxelles-Midi », l'écran « Dans le train » de la 1.2.1). Trajet qui n'est plus suivi : un message.
 */
export function followedView(t: FollowedData | null, ctx: ViewCtx): GlassesView {
  if (!t) return messageView('Trajet suivi', ['Ce trajet n’est plus suivi.'], ctx, { hints: HINTS.message, screen: 'followed' });
  const v = base('followed', 'menu', followedTitle(t.title), ctx);
  v.items.push({ a: 'Ne plus suivre', action: { kind: 'unfollow' } });
  const leg = detailLeg(t.journey, ctx.now);
  const ride = t.journey.legs[leg];
  if (ride?.kind === 'ride') {
    v.items.push({ a: `Arrêts${NB}: ${trainTitle(ride, lang(ctx))}`, action: { kind: 'open', route: { screen: 'train', journey: t.journey, leg, label: t.title } } });
  }
  v.hints = hints(ctx, HINTS.followed);
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

/* ------------------------------ Autres trajets (1.2.1) ------------------------------ */

/** Titre de « Autres trajets » : « Vers le bureau : autres trajets », le titre du trajet coupé si trop long (§ 3.3). */
export function othersTitle(title: string): string {
  const tail = `${NB}: autres trajets`;
  const full = `${title}${tail}`;
  if (textWidth(full) <= WIDTHS.title) return full;
  return `${truncate(title, WIDTHS.title - textWidth(tail))}${tail}`;
}

/** Écart entre deux heures en mots : « 13 min », « 1 h » pour une heure pleine (comme les raisons du cœur). */
function gapWords(min: number): string {
  const n = Math.max(1, Math.round(min));
  return n % 60 === 0 ? `${n / 60}${NB}h` : minText(n);
}

/** Minutes entre deux heures affichées (HH:MM), de `a` à `b`. */
const shownGap = (a: number, b: number): number => Math.floor(b / 60_000) - Math.floor(a / 60_000);

/**
 * Le pourquoi d'une proposition par rapport à la proposition 1 (PRD-1.2.1 § 2.2), sans le nom déjà écrit en ligne 1 :
 * « Plus tôt » : « 13 min plus tôt, mais 19 min à pied » s'il marche plus (walksMore du cœur), sinon « 13 min plus
 * tôt » (l'heure de départ est déjà en ligne 1) ; « Moins de marche » : « 25 min plus tard, moins de marche ». Autres
 * étiquettes, proposition 1 elle-même, ou plus d'avance : null.
 */
export function otherWhy(j: Journey, first: Journey | undefined): string | null {
  if (!first || first.id === j.id) return null;
  const label = labelOf(j.label);
  if (label === 'earlier') {
    const gain = shownGap(j.arr, first.arr);
    if (gain < 1) return null;
    // 1.2.5 : « mais 19 min à pied sous la pluie » : la pluie pèse dans le choix, sans changer l'ordre
    return `${gapWords(gain)} plus tôt${walksMore(j, first) ? `, mais ${minText(longestWalk(j))} à pied${rainyJourney(j) ? ` ${RAIN_WORDS}` : ''}` : ''}`;
  }
  if (label === 'lesswalk') {
    const d = shownGap(first.arr, j.arr);
    // 1.2.5 : le premier trajet marche sous la pluie : « moins de marche sous la pluie »
    return `${d > 0 ? `${gapWords(d)} plus tard` : d < 0 ? `${gapWords(-d)} plus tôt` : 'même heure d’arrivée'}, moins de marche${rainyJourney(first) ? ` ${RAIN_WORDS}` : ''}`;
  }
  return null;
}

/**
 * 2e ligne d'une entrée de « Autres trajets » (§ 3.3) : les moyens d'abord, puis le pourquoi (otherWhy) ou, à défaut,
 * les marches : « IC + IC, 13 min plus tôt, mais 19 min à pied », « bus W + métro 2, 25 min plus tard, moins de
 * marche », « bus 36 + IC + métro 2, à pied 5 + 4 + 2 min » ; à pied : « à pied, 25 min » (1.2.5 : « à pied, 25 min sous
 * la pluie »). Une ligne mesurée au
 * pixel : trop longue, les moyens se raccourcissent (« bus 36 + IC + … »), jamais le pourquoi.
 */
export function otherDetail(j: Journey, journeys: readonly Journey[]): string {
  const rides = j.legs.filter((l) => l.kind === 'ride').map(rideWords);
  // 1.2.5 : à pied tout du long, sous la pluie : « à pied, 25 min sous la pluie »
  if (!rides.length) return truncate(`${meansLine(j)}${rainyJourney(j) ? ` ${RAIN_WORDS}` : ''}`, WIDTHS.full);
  const walks = walksPhrase(j);
  const why = otherWhy(j, journeys[0]) ?? (walks && rainyJourney(j) ? `${walks} ${RAIN_WORDS}` : walks);
  for (let k = Math.min(rides.length, 3); k >= 1; k--) {
    const means = `${rides.slice(0, k).join(' + ')}${k < rides.length ? ' + …' : ''}`;
    const text = why ? `${means}, ${why}` : means;
    if (textWidth(text) <= WIDTHS.full) return text;
  }
  // même le premier véhicule ne tient pas : son nom est coupé, le pourquoi reste entier
  const tail = why ? `, ${why}` : '';
  const head = truncate(rides.length > 1 ? `${rides[0]} + …` : rides[0], WIDTHS.full - textWidth(tail));
  return head ? `${head}${tail}` : truncate(why, WIDTHS.full);
}

/**
 * « Autres trajets » (PRD-1.2.1 § 3.3) : une entrée par autre proposition, dans l'ordre ; ligne 1 = nom affiché
 * (displayLabel) et « 19:47 → 20:58 », ligne 2 plus pâle (otherDetail : moyens, puis le pourquoi). Curseur ; toucher : les étapes de l'entrée
 * (empilées au-dessus de la liste) ; double toucher : retour aux étapes d'où la liste a été ouverte. `journeys` :
 * propositions de la route, rafraîchies (temps réel).
 */
export function othersView(r: OthersRoute, journeys: Journey[], ctx: ViewCtx): GlassesView {
  const title = othersTitle(r.title);
  const v = base('others', 'others', title, ctx);
  journeys.forEach((j, k) => {
    if (k === r.index) return;
    const route: StepsRoute = { screen: 'steps', label: '', title: r.title, journeys: r.journeys, index: k, fromList: true };
    if (r.key) route.key = r.key;
    if (r.from) route.from = r.from;
    if (r.to) route.to = r.to;
    if (r.favoriteId) route.favoriteId = r.favoriteId;
    v.items.push({ a: displayLabel(j, journeys), c: spanText(journeyStart(j), j.arr, ctx.now), b2: otherDetail(j, journeys), action: { kind: 'open', route } });
  });
  if (!v.items.length) return messageView(title, [NO_OTHER_TRIP], ctx, { hints: HINTS.message, screen: 'others' });
  v.hints = hints(ctx, HINTS.others);
  v.log = { page: r.index + 1, pages: journeys.length };
  return v;
}

/* ------------------------------ Dans le train ------------------------------ */

/** Titre de « Dans le train » : « IC vers Bruxelles-Midi, +2 min » ; 1.2.2 (n° 8) : « Tram 4 vers Stalle », « Bus W vers … ». */
export function trainTitle(leg: Leg, l: NameLang, now?: number): string {
  const head = leg.head ? ` vers ${headText(leg.head, l, leg.op)}` : '';
  const delay = leg.cancelled ? ', SUPPRIMÉ' : leg.delayMin && leg.delayMin > 0 ? `, +${minText(leg.delayMin)}` : '';
  const day = now === undefined ? '' : dayWord(leg.schedDep, now);
  return `${vehicleWords(leg)}${head}${delay}${day ? `, ${day}` : ''}`;
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
  // 1.2.5 (PRD-1.2.5 § 7) : ligne de progression, train compris, même calcul que « prochain » (heures estimées) :
  // « ●─●─◎─○─○─○   descente dans 4 arrêts » ; rien quand les arrêts ne sont pas connus, ni une fois arrivé, ni pour
  // un véhicule supprimé
  if (known && ctx.now < leg.arr && !leg.cancelled) {
    const left = stops.length - 1 - Math.max(1, next) + 1;
    v.top = { text: `${progressLine(stops.length, Math.max(0, next))}${COL_SEP}${alightWords(left)}` };
  }
  // 1.2.5 : « ~ » expliqué ici aussi, pour ce véhicule : temps réel coupé (retards gardés) ou absent ; un véhicule en
  // direct n'a pas de note, même quand le flux d'un autre opérateur est en panne
  if (leg.rtKept) v.note = NOTE_RT_KEPT;
  else if (!leg.rt && (ctx.rt === 'down' || ctx.rt === 'offline')) v.note = noRtNote(ctx);
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
