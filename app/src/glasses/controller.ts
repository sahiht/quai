/**
 * Contrôleur des lunettes : état de navigation, chargement des données du cœur, rendu
 * (createStartUpPageContainer, puis rebuildPageContainer quand la forme change, sinon
 * textContainerUpgrade), gestes, minuteries (temps réel 30 s, position 30 s, horloge), arrière-plan.
 *
 * 1.1 (PRD M1, M2, M6) : favoris « réponse directe » (ordre intelligent calculé à chaque ouverture et figé pendant
 * l'affichage, réponses rafraîchies toutes les 30 s) ; « Trajet proposé » page par page ; trajet suivi et trajet en
 * cours (clé KV quai.trip, reprise à la réouverture) ; retrait de favori annulable ; GlassesApi pour le téléphone.
 *
 * 1.2.2 (docs/v1.2.2/PRD-1.2.2.md, REVUE-USAGE.md) : rubriques « Gares » et « Bus, tram, métro » (accueil, écrans,
 * détail d'une ligne) ; « Aller à… » rejoint « Favoris » ; ★ des départs : une gare dans « Gares », une ligne de
 * l'arrêt dans « Bus, tram, métro » (plus aucun arrêt favori créé) ; un trajet n'est suivi que sur demande (marque
 * `explicit` dans quai.trip) ; ouverture d'office à moins de 300 m des gares et lignes `near`.
 */
import type {
  Board,
  Core,
  Departure,
  Endpoint,
  Favorite,
  FavoriteAnswer,
  FavoritePlace,
  FavoriteRank,
  FavoriteStop,
  GlassesApi,
  Journey,
  LatLon,
  LineBoard,
  LineFilter,
  LinePick,
  Meta,
  NameLang,
  NearbyItem,
  PlanResult,
  Settings,
  StationPick,
  TripRequest,
} from '../core/api';
import { LABEL_TEXT, labelOf } from '../core/api';
import { MESSAGES, QuaiError } from '../core/errors';
import { asTrip, endpointPoint, favoriteTitle, placeOf } from '../core/favorites';
import { shortAddress } from '../core/text';
import { displayName, distanceM, mainMode } from '../core/util';
import type { Mode } from '../../../shared/types';
import type { Clock } from '../platform/clock';
import { deadline } from '../platform/queue';
import type { Fix, Platform } from '../platform/types';
import { LIMITS, newId, type SettingsStore } from '../settings';
import { APP_VERSION, compareVersions } from '../version';
import { HINTS, NB, SECTION, atTitle, catchable, departureRightText, lowerFirst, planHomeText, runningNext, shownMessage, towards, tripShort, upcoming } from './format';
import { DEBOUNCE, GestureFilter, type HubSignal } from './gestures';
import { geometry, layoutPage, shapeKey } from './layout';
import { current, effectiveFrame, handleGesture, initNav, mapRoutes, parseNav, pop, push, replace, replaceAt, reset, setSelection, type Gesture, type NavFrame, type NavState } from './nav';
import type { AreaRef, GlassesView, Intent, Item, KeepLineRoute, LineRoute, OthersRoute, PageSpec, Route, StepsRoute } from './types';
import {
  alreadyThereView,
  arrivalView,
  boardView,
  errorView,
  favoriteStopRoute,
  favoritesView,
  firstRunView,
  followedView,
  HOME_FAVORITES,
  homeView,
  isStationBoard,
  keepLineTitle,
  keepLineView,
  linePickTitle,
  linesView,
  lineView,
  loadingView,
  messageView,
  NEWS_TITLE,
  newsLines,
  newsView,
  noLocationView,
  notConfiguredView,
  nearbyView,
  othersTitle,
  othersView,
  recentKey,
  recentShown,
  stationsView,
  stepsMessageView,
  stepsPage,
  trainView,
  type FavoriteEntry,
  type HomeData,
  type LineRow,
  type SectionNext,
  type StationRow,
  type StopLine,
  type ViewCtx,
} from './views';

export interface Freshness {
  ok: boolean;
  ageHours: number;
  message?: string;
}

export interface ControllerDeps {
  platform: Platform;
  core: Core;
  settings: SettingsStore;
  clock: Clock;
  configured: boolean;
  freshness: (meta: Meta, now: number) => Freshness;
  /** Journal QUAI_SCREEN (mode test). */
  e2e: boolean;
  log?: (line: string) => void;
  /** Vrai si createStartUpPageContainer a déjà été appelé (page de chargement de main.ts). */
  pageStarted?: boolean;
  /**
   * Quai Web (page publiée, sans lunettes) : textes qui renvoient à l'onglet Réglages, pas de sortie
   * (double toucher sur l'accueil : simple message), gestes sans l'anti-rebond du matériel G2.
   */
  web?: boolean;
  /** Quai Web : ouvre un écran des réglages (ancre #/…), par exemple « Autre adresse » → recherche. */
  openPhone?: (hash: string) => void;
}

/** Quai Web : boutons, clavier et écran tactile n'ont pas les doublons du pavé des G2 ; seul un défilement très rapide est freiné. */
export const WEB_DEBOUNCE: typeof DEBOUNCE = {
  tapDuplicateMs: 0,
  doubleDuplicateMs: 0,
  tapCooldownMs: 0,
  scrollSameDirMs: 60,
  scrollDirChangeMs: 0,
  scrollAfterTapMs: 0,
  scrollAfterRenderMs: 0,
};

/** Trajet suivi et en cours (DECISIONS Q7) : clé du stockage de l'appli, écrite par les lunettes. */
export const TRIP_KEY = 'quai.trip';

/**
 * Message de nouveautés « Quai 1.2.2 » : montré une fois à qui avait vu une version antérieure (PRD-1.2.2 § 9 ; 1.2.1,
 * 1.2.0 ou 1.1), jamais après une installation neuve. Ses lignes : NEWS_LINES (views.ts).
 */
export const NEWS_SINCE = '1.2.2';

/**
 * Date du premier lancement (PRD-1.2.1 § 4.6), en ms : clé du stockage de l'appli sur le téléphone, hors du schéma des
 * réglages (comme quai.trip). Écrite une fois par les lunettes ; 0 pour qui utilisait déjà Quai avant la 1.2.1.
 */
export const FIRST_USE_KEY = 'quai.firstUse';
/** Aide des gestes de l'accueil : les 7 premiers jours d'utilisation (§ 4.6). */
export const HOME_HELP_MS = 7 * 86_400_000;

const REFRESH_MS = 30_000;
const LOCATION_MS = 30_000;
/** Déjà sur place pour une adresse récente (1.0 : « ici », « Tu es déjà à la maison. »). */
const SAME_PLACE_M = 100;
/** 1.2.2 (REVUE-USAGE n° 4) : gare ou ligne `near` ouverte d'office à moins de 300 m, comme un arrêt favori de la 1.2.1. */
const NEAR_OPEN_M = 300;
/** 1.2.2 (REVUE-USAGE n° 10) : « Autour de moi » vide : l'arrêt le plus proche, cherché jusqu'à 3 km. */
const NEAREST_M = 3000;
/** 1.2.2 (PRD-1.2.2 § 4) : la même limite que le téléphone, celle des réglages (LIMITS de settings.ts). */
const PICK_MAX = { stations: LIMITS.stations, lines: LIMITS.lines } as const;
/** 1.2.2 : passages demandés par sens dans « Bus, tram, métro » (2 montrés, un de réserve entre deux rafraîchissements). */
const LINES_PER_DIRECTION = 3;
/** 1.2.2 : passages par sens dans le détail d'une ligne (4 montrés, PRD-1.2.2 § 3). */
const LINE_DETAIL_PER_DIRECTION = 5;
/** « ★ garder ce trajet » : un lieu à 50 m au plus d'un lieu déjà gardé est le même. */
const SAME_SPOT_M = 50;
const TOAST_MS = 2_600;
/** Retrait d'une gare ou d'une ligne (1.2.1 : d'un favori) : « Toucher encore : annuler » pendant 5 s (M6.1). */
const UNDO_MS = 5_000;
/** Message de reprise d'un trajet en cours (M6.5). */
const RESUME_MS = 3_000;
const CORE_TIMEOUT_MS = 20_000;
const MOVE_M = 30;
/** Fin d'un trajet en cours : arrivée plus 5 min (M6.3). */
const RUN_AFTER_MS = 5 * 60_000;
/** Fin anticipée : encore à moins de 300 m du départ après le départ du premier véhicule (M6.3). */
const NOT_LEFT_M = 300;
/**
 * … mais seulement 3 min après ce départ : un train ou un tram met près d'une minute à quitter les 300 m de la gare,
 * et la position du téléphone arrive avec retard (gares couvertes). Sans ce délai, un trajet suivi depuis le quai prenait
 * fin juste après le départ (plus de « Dans le train » ni d'aide à l'arrivée).
 */
const NOT_LEFT_AFTER_MS = 3 * 60_000;
/** Trajet suivi rafraîchi (temps réel) seulement quand son départ approche. */
const TRIP_REFRESH_AHEAD_MS = 2 * 3_600_000;
/** Réponses des favoris calculées 2 par 2, dans l'ordre affiché. */
const ANSWER_POOL = 2;
/** Réponses des favoris qui ne sont pas à l'écran : recalculées au plus toutes les 5 min. */
const WARM_MS = 5 * 60_000;

type Loaded = { ok: true; value: unknown; at: number } | { ok: false; error: string; at: number };

/** Trajet suivi (M2), persistant (clé quai.trip) et inclus dans l'état d'arrière-plan. */
export interface FollowedTrip {
  v: 1;
  /**
   * 1.2.2 (PRD-1.2.2 § 6) : suivi sur demande (toucher « Suivre ce trajet », bouton « Lunettes » du téléphone). Un
   * trajet gardé par la 1.2.1 n'a pas cette marque : il peut venir d'un favori seulement ouvert, il n'est pas repris.
   */
  explicit: true;
  /** Trajet suivi, dernière version rafraîchie. */
  journey: Journey;
  /** « Vers le bureau ». */
  title: string;
  from?: Endpoint;
  to?: Endpoint;
  favoriteId?: string;
  /** Position au moment du choix (fin anticipée : l'utilisateur n'est pas parti). */
  origin?: LatLon;
  /** Choisi à cet instant (epoch ms). */
  startedAt: number;
  /** Heure de départ à pied au moment du choix (figée une fois partie). */
  leaveAt0: number;
  /** Propositions de la session et place du trajet suivi (réouverture des étapes). */
  journeys: Journey[];
  index: number;
  /** Session d'étapes (StepsRoute.key). */
  key: string;
}

/** État d'un trajet suivi : pas encore parti, en cours (M6.3), terminé. */
export type TripPhase = 'before' | 'running' | 'ended';

const isRide = (l: Journey['legs'][number]): boolean => l.kind === 'ride';

/**
 * Trajet en cours (PRD M6.3) : de l'heure de départ à pied jusqu'à l'arrivée plus 5 min ; fini plus tôt si, après le
 * départ du premier véhicule, une position prise depuis ce départ est encore à moins de 300 m du point de départ.
 */
export function tripPhase(t: Pick<FollowedTrip, 'leaveAt0' | 'origin'>, j: Journey, now: number, here: Pick<Fix, 'lat' | 'lon' | 'at'> | null): TripPhase {
  const ride = j.legs.find(isRide);
  const start = ride ? Math.min(t.leaveAt0, j.leaveAt) : j.dep;
  if (now >= j.arr + RUN_AFTER_MS) return 'ended';
  const late = ride ? ride.dep + NOT_LEFT_AFTER_MS : Infinity;
  if (ride && now >= late && here && t.origin && here.at >= late && distanceM(here, t.origin) < NOT_LEFT_M) return 'ended';
  return now >= start ? 'running' : 'before';
}

/** Début de la raison des étiquettes de la 1.1 retirées en 1.2 (« Le plus simple : direct, … »). */
const OLD_LABEL_TEXT: Readonly<Record<string, string>> = { simple: 'Le plus simple', fast: 'Le plus rapide' };

/**
 * Trajet gardé par une version antérieure : étiquette relue par labelOf ('simple' → 'short', 'fast' → 'earlier',
 * inconnue : retirée), et sa raison avec (« Le plus simple : direct… » → « Le plus court : direct… »).
 */
function relabel(j: Journey): Journey {
  const raw: unknown = j.label;
  const label = labelOf(raw);
  if (raw === undefined || label === raw) return j;
  const out: Journey = { ...j };
  if (label) out.label = label;
  else delete out.label;
  const old = typeof raw === 'string' ? OLD_LABEL_TEXT[raw] : undefined;
  if (label && old && out.reason?.startsWith(old)) out.reason = LABEL_TEXT[label] + out.reason.slice(old.length);
  return out;
}

/**
 * Lecture défensive de quai.trip (gardé par la 1.1 : étiquettes relues par labelOf). 1.2.2 : sans la marque `explicit`
 * (trajet gardé par la 1.2.1 ou avant), rien n'est repris.
 */
export function parseTrip(raw: unknown): FollowedTrip | null {
  try {
    const x = typeof raw === 'string' ? (raw ? JSON.parse(raw) : null) : raw;
    if (!x || typeof x !== 'object') return null;
    const t = x as FollowedTrip;
    const okJourney = (j: unknown): j is Journey => !!j && typeof j === 'object' && Array.isArray((j as Journey).legs) && (j as Journey).legs.length > 0 && Number.isFinite((j as Journey).arr) && typeof (j as Journey).id === 'string';
    if (t.v !== 1 || t.explicit !== true || !okJourney(t.journey) || typeof t.title !== 'string' || !Number.isFinite(t.leaveAt0)) return null;
    const journeys = (Array.isArray(t.journeys) ? t.journeys.filter(okJourney) : []).map(relabel);
    const index = journeys.findIndex((j) => j.id === t.journey.id);
    return {
      ...t,
      journey: relabel(t.journey),
      journeys: index >= 0 ? journeys : [relabel(t.journey)],
      index: index >= 0 ? index : 0,
      key: typeof t.key === 'string' && t.key ? t.key : `trip-${t.journey.id}`,
      startedAt: Number.isFinite(t.startedAt) ? t.startedAt : 0,
    };
  } catch {
    return null;
  }
}

/** Étape en véhicule en cours (départ passé, arrivée à venir), non supprimée ; -1 sinon. */
function rideInProgress(j: Journey, now: number): number {
  return j.legs.findIndex((l) => l.kind === 'ride' && !l.cancelled && now >= l.dep && now < l.arr);
}

/** Dernière étape en véhicule. */
function lastRideIndex(j: Journey): number {
  for (let i = j.legs.length - 1; i >= 0; i--) if (j.legs[i].kind === 'ride') return i;
  return -1;
}

/** Aide à l'arrivée (1.0) : 3 min avant l'arrivée en gare d'un trajet qui finit en train. */
function arrivalDue(j: Journey, now: number): boolean {
  const k = lastRideIndex(j);
  const leg = j.legs[k];
  return k === j.legs.length - 1 && leg?.mode === 'train' && now >= leg.arr - 3 * 60_000 && now < leg.arr + 10 * 60_000;
}

/** Gares de départ et d'arrivée d'un trajet en train (« ★ garder ce trajet » de l'aide à l'arrivée). */
function stationTrip(j: Journey): { from: AreaRef; to: AreaRef } | undefined {
  const rides = j.legs.filter(isRide);
  const a = rides[0];
  const b = rides[rides.length - 1];
  if (!a || !b || a.op !== 'sncb' || b.op !== 'sncb' || !a.from.areaId || !b.to.areaId) return undefined;
  return {
    from: { areaId: a.from.areaId, op: 'sncb', name: a.from.name, lat: a.from.lat, lon: a.from.lon },
    to: { areaId: b.to.areaId, op: 'sncb', name: b.to.name, lat: b.to.lat, lon: b.to.lon },
  };
}

/** Propositions d'une route d'étapes (1.1 : `journeys` ; 1.0 : `journey` seul). */
function routeJourneys(r: StepsRoute): Journey[] | undefined {
  if (r.journeys) return r.journeys;
  return r.journey ? [r.journey] : undefined;
}

/** Clé de cache des données d'un écran. */
export function routeKey(r: Route): string {
  switch (r.screen) {
    case 'board':
      return `board:${r.areaId}:${JSON.stringify(r.filter ?? [])}`;
    case 'line':
      return `line:${r.areaId}:${r.line}`;
    case 'keepLine':
      return `keepLine:${r.areaId}`;
    case 'steps': {
      // 1.2.1 : une proposition ouverte depuis « Autres trajets » a sa propre clé (temps réel, messages).
      const i = r.index ?? 0;
      return `steps:${r.key ?? routeJourneys(r)?.[0]?.id ?? ''}${i > 0 ? `:${i}` : ''}`;
    }
    case 'others':
      return `others:${r.key ?? r.journeys[0]?.id ?? ''}`;
    case 'train':
      return `train:${r.journey.id}:${r.leg}`;
    case 'arrival':
      return `arrival:${r.journey.id}:${r.leg}`;
    case 'message':
      return `message:${r.kind}:${r.title}`;
    default:
      return r.screen;
  }
}

const LIVE: ReadonlySet<Route['screen']> = new Set(['home', 'nearby', 'board', 'favorites', 'stations', 'lines', 'line', 'steps', 'others', 'train', 'arrival']);
const USES_POSITION: ReadonlySet<string> = new Set(['nearby']);

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)) || 'Erreur inconnue';

/** Erreur au lancement (M8.6) : « Pas de connexion aux horaires : nouvel essai dans 30 s », sauf message précis du cœur. */
function initErrorText(e: unknown): string {
  return e instanceof QuaiError ? e.message : MESSAGES.dataUnreachable;
}

export class GlassesController implements GlassesApi {
  private nav: NavState = initNav({ screen: 'message', kind: 'loading', title: 'Quai', lines: ['Chargement…'] });
  private cache = new Map<string, Loaded>();
  private loading = new Map<string, Promise<void>>();
  private page: PageSpec | null = null;
  private view: GlassesView | null = null;
  private capacity = 1;
  private filter: GestureFilter;
  /** Message temporaire, lié à l'écran où il a été donné (jamais reporté sur l'écran suivant). */
  private toast: { text: string; until: number; route: string } | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];
  private rendering = false;
  private renderAgain = false;
  private forceNext = false;
  private paused = false;
  private stopped = false;
  private ready = false;
  private meta: Meta | null = null;
  private fresh: Freshness | null = null;
  private initError: string | null = null;
  private here: Fix | null = null;
  private autoDone = new Set<string>();
  private lastLog = '';
  private unsubscribe: (() => void) | null = null;
  private pendingRestore: NavState | null = null;
  private pendingShow: NavState | null = null;
  private seq = 0;

  /** Dernières réponses des favoris (ordre intelligent, règle 5) et heure de leur calcul. */
  private answers = new Map<string, FavoriteAnswer>();
  private answerAt = new Map<string, number>();
  private answering = new Map<string, Promise<void>>();
  /** Ordre de l'accueil et de la liste, figés pendant l'affichage (M1.4). */
  private homeOrder: string[] | null = null;
  /** 1.2.1 : favoris de la règle 5 à l'entrée dans l'accueil (tu y es, rien dans les 3 heures), jamais montrés dessus. */
  private homeLast = new Set<string>();
  /** 1.2.1 : éléments de l'accueil à son dernier affichage (le curseur garde son élément quand la liste change). */
  private homeItems: Item[] | null = null;
  /** 1.2.1 : premier affichage de l'accueil depuis qu'on y est revenu (keepHomeCursor). */
  private homeEntry = false;
  /** 1.2.1 : date du premier lancement (aide des gestes de l'accueil, § 4.6) ; null tant qu'elle n'est pas lue. */
  private firstUse: number | null = null;
  private listOrder: string[] | null = null;
  private favSig = '';
  /** « Autour de moi » léger (M8.7). */
  private nearbyLight: { key: string; at: number; count: number; near?: string } | null = null;
  private nearbyLoading: Promise<void> | null = null;
  /** Trajets rafraîchis (temps réel), par identifiant. */
  private journeysById = new Map<string, Journey>();
  /** Trajet suivi (M2) et en cours (M6). */
  private trip: FollowedTrip | null = null;
  private tripLoaded = false;
  private tripSaved = '';
  /**
   * 1.2.2 : gare ou ligne retirée par ★ (départs, « garder une ligne »), rétablissable à l'identique pendant 5 s (M6.1).
   * `key` : écran où elle a été retirée ; `line` : la ligne touchée (« garder une ligne »).
   */
  private undo: { key: string; until: number; index: number; station?: StationPick; pick?: LinePick; line?: string } | null = null;
  /** Route pour laquelle l'entrée dans l'écran a été traitée (ordre figé, annulation). */
  private entered: Route | null = null;
  /** 1.2.2 : réponses des adresses récentes de « Favoris » (clé recentKey), et heure du calcul. */
  private recents = new Map<string, { result: PlanResult | null; at: number }>();
  private recentsLoading: Promise<void> | null = null;
  /**
   * 1.2.2 (REVUE-USAGE n° 6) : prochain départ de la gare et de la ligne choisies les plus proches (droite de l'accueil) ;
   * `id` : élément choisi ; une requête par rubrique et par rafraîchissement.
   */
  private sections: { stations?: SectionData; lines?: SectionData } = {};
  private sectionsLoading: Promise<void> | null = null;
  private picksSig = '';

  constructor(private d: ControllerDeps) {
    this.filter = new GestureFilter(d.web ? WEB_DEBOUNCE : DEBOUNCE);
    this.favSig = favSignature(d.settings.get());
    this.picksSig = picksSignature(d.settings.get());
    d.settings.subscribe(() => this.onSettingsChanged());
  }

  /* ------------------------------ Cycle de vie ------------------------------ */

  /** Démarre : page de chargement immédiate (jamais d'écran noir), puis écran d'ouverture. */
  async start(): Promise<void> {
    this.unsubscribe = this.d.platform.glasses.onSignal((s) => this.onSignal(s));
    await this.render(true);
    if (!this.d.configured) {
      this.nav = initNav(this.notConfiguredRoute());
      this.ready = true;
      await this.render(true);
      this.log('QUAI_READY');
      return;
    }
    await this.boot();
  }

  private notConfiguredRoute(): Route {
    return { screen: 'message', kind: 'notConfigured', title: 'Quai', lines: [] };
  }

  private initPromise: Promise<Meta> | null = null;

  /** Initialise le cœur une seule fois (partagé avec le téléphone) ; un échec permet de réessayer. */
  ensureInit(): Promise<Meta> {
    if (!this.initPromise) {
      this.initPromise = deadline(this.d.core.init(), CORE_TIMEOUT_MS, MESSAGES.dataUnreachable).then(
        (meta) => {
          this.meta = meta;
          this.initError = null;
          this.fresh = this.d.freshness(meta, this.d.clock.now());
          return meta;
        },
        (e) => {
          this.initPromise = null;
          this.initError = initErrorText(e);
          throw e;
        },
      );
    }
    return this.initPromise;
  }

  get currentMeta(): Meta | null {
    return this.meta;
  }

  get freshness(): Freshness | null {
    return this.freshNow();
  }

  get error(): string | null {
    return this.initError;
  }

  /**
   * Écran d'erreur du lancement encore affiché (« Pas de connexion aux horaires… »). Le téléphone appelle aussi
   * ensureInit() : s'il réussit le premier, initError est effacé mais les lunettes restent sur l'erreur ; le nouvel
   * essai (30 s, toucher) doit alors quand même terminer le démarrage.
   */
  private atLaunchError(): boolean {
    const r = current(this.nav).route;
    return this.nav.stack.length === 1 && r.screen === 'message' && r.kind === 'error';
  }

  private async boot(): Promise<void> {
    try {
      await this.ensureInit();
    } catch (e) {
      this.initError = initErrorText(e);
      this.nav = initNav({ screen: 'message', kind: 'error', title: 'Quai', lines: [this.initError] });
      this.ready = true;
      await this.render(true);
      this.startTimers();
      this.log('QUAI_READY');
      return;
    }
    this.here = await this.d.platform.location.current(5000);
    await this.loadTrip();
    // Avant openingNav : la version vue (vide = nouvelle installation) n'est pas encore écrite.
    await this.loadFirstUse();
    this.checkTrip();
    let resumed = false;
    if (this.pendingRestore) {
      this.nav = this.pendingRestore;
      this.pendingRestore = null;
    } else if (this.pendingShow) {
      this.nav = this.pendingShow;
      this.pendingShow = null;
    } else {
      const o = await this.openingNav();
      this.nav = o.nav;
      resumed = o.resumed;
    }
    this.ready = true;
    if (resumed && this.trip) this.showToast(`Trajet en cours${NB}: ${lowerFirst(this.trip.title)}`, RESUME_MS);
    await this.render(true);
    this.startTimers();
    this.log('QUAI_READY');
  }

  /**
   * Écran d'ouverture : bienvenue (premier lancement), message « Quai 1.2.2 » (une fois après la mise à jour depuis une
   * version antérieure, jamais après une installation neuve), trajet en cours repris (M6.5), sinon l'accueil (et le
   * favori, la gare ou la ligne ouverts d'office selon les réglages).
   */
  private async openingNav(): Promise<{ nav: NavState; resumed: boolean }> {
    const s = this.settings();
    const seen = s.seenVersion;
    if (!seen) void this.markSeen();
    if (!s.onboarded) return { nav: initNav({ screen: 'message', kind: 'firstRun', title: 'Quai', lines: [] }), resumed: false };
    if (seen && compareVersions(seen, NEWS_SINCE) < 0 && compareVersions(APP_VERSION, NEWS_SINCE) >= 0) {
      void this.markSeen();
      return { nav: initNav({ screen: 'message', kind: 'news', title: NEWS_TITLE, lines: newsLines(seen) }), resumed: false };
    }
    const run = this.resumeNav(initNav({ screen: 'home' }), true);
    if (run) return { nav: run, resumed: true };
    return { nav: this.homeNav(), resumed: false };
  }

  /** Écrit la version vue (« Quai 1.2.2 » affiché une seule fois ; nouvelle installation : sans rien afficher). */
  private async markSeen(): Promise<void> {
    if (this.settings().seenVersion === APP_VERSION) return;
    await this.d.settings.update((x) => ({ ...x, seenVersion: APP_VERSION }));
  }

  /**
   * Date du premier lancement (PRD-1.2.1 § 4.6), lue une fois. Absente : nouvelle installation (version vue vide),
   * maintenant ; mise à jour d'une version antérieure, 0 (Quai déjà utilisé : pas d'aide des gestes sur l'accueil).
   */
  private async loadFirstUse(): Promise<void> {
    if (this.firstUse !== null) return;
    const kv = this.d.platform.kv;
    let raw: string | null = null;
    try {
      raw = await kv.get(FIRST_USE_KEY);
    } catch (e) {
      console.warn('[Quai] date du premier lancement illisible', errText(e));
    }
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 0) {
      this.firstUse = n;
      return;
    }
    const first = this.settings().seenVersion ? 0 : this.d.clock.now();
    this.firstUse = first;
    void kv.set(FIRST_USE_KEY, String(first)).catch((e: unknown) => console.warn('[Quai] date du premier lancement non enregistrée', errText(e)));
  }

  /** Aide des gestes sur l'accueil : les 7 premiers jours d'utilisation (§ 4.6) ; date inconnue : oui. */
  private homeHelp(): boolean {
    return this.firstUse === null || this.d.clock.now() - this.firstUse < HOME_HELP_MS;
  }

  /**
   * Accueil, avec un écran ouvert d'office : « Toujours ouvrir le favori en tête », ou ce qui est réglé « à moins de
   * 300 m » (M1.7) : un trajet fixe dont le départ est là, et (1.2.2, REVUE-USAGE n° 4) une gare ou une ligne `near`
   * (créneau « près » d'un arrêt favori de la 1.2.1, migré) : les départs de la gare ; « Bus, tram, métro », le curseur
   * sur la ligne (les autres lignes gardées à cet arrêt juste à côté : le tram 3 et le tram 4 d'un même favori de la
   * 1.2.1) ; les départs d'un arrêt « toutes les lignes ». Le plus proche l'emporte (à égalité : favoris, gares, puis
   * lignes, dans leur ordre). Rien n'est suivi (PRD-1.2.2 § 6).
   */
  private homeNav(): NavState {
    const s = this.settings();
    const home: Route = { screen: 'home' };
    const order = this.computeOrder();
    const byId = new Map(s.favorites.map((f) => [f.id, f]));
    if (s.display.opening === 'firstFavorite') {
      const f = order.map((id) => byId.get(id)).find(Boolean);
      if (f) return reset([home, this.favoriteRoute(f)]);
    }
    const here = s.display.opening === 'suggest' ? this.hereLL() : null;
    if (here) {
      let best: { d: number; route: () => Route } | null = null;
      const offer = (p: LatLon | null | undefined, route: () => Route): void => {
        const d = p ? distanceM(here, p) : Infinity;
        if (d <= NEAR_OPEN_M && (!best || d < best.d)) best = { d, route };
      };
      for (const f of order.map((id) => byId.get(id))) {
        // Un lieu part de « Ma position » : jamais « à moins de 300 m » de son départ.
        if (f?.propose === 'near') offer(f.kind === 'stop' ? f : endpointPoint(asTrip(f).from, s), () => this.favoriteRoute(f));
      }
      for (const p of s.stations) if (p.near) offer(p, () => ({ screen: 'board', areaId: p.areaId, name: p.name }));
      for (const p of s.lines) if (p.near) offer(p, (): Route => (p.line ? { screen: 'lines', focus: p.id } : { screen: 'board', areaId: p.areaId, name: p.name }));
      const chosen = best as { d: number; route: () => Route } | null;
      if (chosen) return reset([home, chosen.route()]);
    }
    return initNav(home);
  }

  /**
   * Écran d'un favori ouvert d'office : étapes du trajet ou du lieu (calculées sur place, pas suivies : PRD-1.2.2 § 6),
   * ou départs d'un arrêt favori (réglages d'avant la 1.2.2).
   */
  private favoriteRoute(f: Favorite): Route {
    if (f.kind === 'stop') return favoriteStopRoute(f);
    const s = this.settings();
    const { from, to } = asTrip(f);
    return { screen: 'steps', key: this.newKey(), label: '', title: favoriteTitle(f, s), from, to, favoriteId: f.id };
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private startTimers(): void {
    this.clearTimers();
    if (this.stopped) return;
    this.intervals.push(setInterval(() => void this.refreshCurrent(), this.d.clock.real(REFRESH_MS) || REFRESH_MS));
    this.intervals.push(setInterval(() => void this.updateLocation(), LOCATION_MS));
    this.scheduleClock();
  }

  private scheduleClock(): void {
    const now = this.d.clock.now();
    const next = 60_000 - (now % 60_000) + 50;
    this.timers.push(
      setTimeout(() => {
        if (this.stopped || this.paused) return;
        this.track();
        void this.render();
        this.scheduleClock();
      }, Math.max(200, this.d.clock.real(next))),
    );
  }

  private clearTimers(): void {
    this.timers.forEach(clearTimeout);
    this.intervals.forEach(clearInterval);
    this.timers = [];
    this.intervals = [];
  }

  private newKey(): string {
    return `s${(++this.seq).toString(36)}-${(this.d.clock.now() % 1e8).toString(36)}`;
  }

  /* ------------------------------ Signaux ------------------------------ */

  onSignal(s: HubSignal): void {
    if (this.stopped) return;
    switch (s.kind) {
      case 'gesture':
        if (!this.filter.accept(s.gesture, performanceNow())) return;
        this.onGesture(s.gesture);
        return;
      case 'background':
        // L'appli n'est plus affichée dans les lunettes : on suspend le rafraîchissement.
        this.paused = true;
        this.clearTimers();
        return;
      case 'foreground':
        this.paused = false;
        this.forceNext = true;
        this.startTimers();
        void this.refreshCurrent(true);
        return;
      case 'exit':
        this.stop();
        if (!s.abnormal) this.d.platform.closeWebView();
        return;
    }
  }

  onGesture(g: Gesture): void {
    const view = this.view;
    if (!view) return;
    const { state, effect } = handleGesture(this.nav, g, view, this.capacity);
    this.nav = state;
    switch (effect.kind) {
      case 'render':
        void this.render();
        return;
      case 'back':
        void this.onRouteChanged();
        return;
      case 'exit':
        // Quai Web : il n'y a rien à fermer, la page reste ouverte ; 1.2.1 : sans message (PRD-1.2.1 § 4.5).
        if (this.d.web) return;
        // Boîte de confirmation système ; le nettoyage se fait sur SYSTEM_EXIT_EVENT.
        void this.d.platform.glasses.exit(1);
        return;
      case 'intent':
        void this.runIntent(effect.intent);
        return;
      case 'edge':
        this.stepsEdge(effect.dir);
        return;
      default:
        return;
    }
  }

  private async runIntent(i: Intent): Promise<void> {
    switch (i.kind) {
      case 'open':
        // 1.2.2 : le détail du véhicule ouvert depuis « Ne plus suivre » prend sa place (double toucher : les étapes).
        this.nav = current(this.nav).route.screen === 'followed' ? replace(this.nav, i.route) : push(this.nav, i.route);
        await this.onRouteChanged();
        return;
      case 'openFavorite':
        await this.openFavorite(i.id);
        return;
      case 'go':
        await this.goTo(i.key, i.to, i.label);
        return;
      case 'resume': {
        const nav = this.resumeNav(this.nav, false);
        if (nav) {
          this.nav = nav;
          await this.onRouteChanged();
        }
        return;
      }
      case 'follow':
        this.followShown();
        return;
      case 'unfollow':
        await this.unfollow();
        return;
      case 'toast':
        this.showToast(i.text);
        return;
      case 'phone':
        if (this.d.openPhone) this.d.openPhone(i.hash);
        else this.showToast(i.text);
        return;
      case 'toggleStation':
        await this.toggleStation();
        return;
      case 'toggleLine':
        await this.toggleLine(i.line, i.mode);
        return;
      case 'saveTrip':
        await this.saveTrip();
        return;
      case 'retry':
        if (this.initError || this.atLaunchError()) {
          this.nav = initNav({ screen: 'message', kind: 'loading', title: 'Quai', lines: ['Chargement…'] });
          await this.render();
          await this.boot();
          return;
        }
        this.cache.delete(routeKey(current(this.nav).route));
        await this.render();
        return;
      case 'continue': {
        this.nav = this.homeNav();
        await this.onRouteChanged();
        return;
      }
    }
  }

  /** Après un changement d'écran : afficher tout de suite, rafraîchir si les données sont anciennes. */
  private async onRouteChanged(): Promise<void> {
    const r = current(this.nav).route;
    const hit = this.cache.get(routeKey(r));
    if (hit && LIVE.has(r.screen) && this.d.clock.now() - hit.at > REFRESH_MS / 2) void this.load(r, true);
    await this.render();
  }

  /* ------------------------------ Favoris : réponses et ordre ------------------------------ */

  /**
   * Ordre intelligent du cœur (M1.4), complété par l'ordre du téléphone si le cœur en oublie, et favoris de la règle 5
   * (tu y es, rien dans les 3 heures : jamais sur l'accueil, PRD-1.2.1 § 4.2).
   */
  private computeRanking(): { order: string[]; last: Set<string> } {
    const s = this.settings();
    let ranks: FavoriteRank[] = [];
    try {
      ranks = this.d.core.orderFavorites(this.hereLL(), s, this.answers);
    } catch (e) {
      console.warn('[Quai] ordre des favoris', errText(e));
    }
    const known = new Set(s.favorites.map((f) => f.id));
    const order = [...new Set(ranks.map((r) => r.favoriteId))].filter((id) => known.has(id));
    for (const f of s.favorites) if (!order.includes(f.id)) order.push(f.id);
    return { order, last: new Set(ranks.filter((r) => r.rule === 5).map((r) => r.favoriteId)) };
  }

  private computeOrder(): string[] {
    return this.computeRanking().order;
  }

  /** Entrée dans l'accueil : ordre et règle 5 figés pendant l'affichage. */
  private freezeHome(): void {
    const r = this.computeRanking();
    this.homeOrder = r.order;
    this.homeLast = r.last;
  }

  /**
   * Favoris montrés sur l'accueil (PRD-1.2.1 § 4.2) : les 3 premiers de l'ordre réglé, jamais un favori de la règle 5
   * (il reste dans la liste ouverte par « Favoris ») ; aucun avec « Accueil sans favoris ».
   */
  private homeShown(): string[] {
    const s = this.settings();
    if (s.display.opening === 'home') return [];
    // Tant que l'accueil n'a pas été touché, la règle 5 suit les réponses qui arrivent (au lancement, un favori « rien
    // dans les 3 heures » n'est connu qu'avec sa réponse) ; l'ordre, lui, reste figé (M1.4).
    const f = current(this.nav);
    if (this.homeOrder && f.route.screen === 'home' && f.fresh) this.homeLast = this.computeRanking().last;
    const { order, last } = this.homeOrder ? { order: this.homeOrder, last: this.homeLast } : this.computeRanking();
    // 1.2.2 (REVUE-USAGE n° 1) : le favori du trajet en cours n'est pas répété sous « En cours ».
    const run = this.runningFavoriteId();
    return this.validOrder(order)
      .filter((id) => !last.has(id) && id !== run)
      .slice(0, HOME_FAVORITES);
  }

  /** Favori du trajet suivi quand il est en cours (« En cours » sur l'accueil). */
  private runningFavoriteId(): string | undefined {
    return this.trip?.favoriteId && this.tripState() === 'running' ? this.trip.favoriteId : undefined;
  }

  private validOrder(order: string[]): string[] {
    const known = new Set(this.settings().favorites.map((f) => f.id));
    const out = order.filter((id) => known.has(id));
    for (const f of this.settings().favorites) if (!out.includes(f.id)) out.push(f.id);
    return out;
  }

  /** Ordre de « Favoris » : recalculé à son ouverture, tous les favoris (1.2.1). */
  private computeListOrder(): string[] {
    return this.computeOrder();
  }

  private entry(id: string): FavoriteEntry | null {
    const fav = this.settings().favorites.find((f) => f.id === id);
    return fav ? { fav, answer: this.answers.get(id) } : null;
  }

  /** Réponses des favoris affichés, 2 à la fois, chacune affichée dès qu'elle arrive (M1.6). */
  private refreshAnswers(ids: string[], force: boolean, maxAge = REFRESH_MS): Promise<void> {
    const now = this.d.clock.now();
    const todo = ids.filter((id) => !this.answering.has(id) && (force || !this.answerAt.has(id) || now - (this.answerAt.get(id) ?? 0) >= maxAge));
    if (!todo.length) return Promise.all(ids.map((id) => this.answering.get(id)).filter(Boolean)).then(() => undefined);
    let i = 0;
    const worker = async (): Promise<void> => {
      while (i < todo.length) {
        const id = todo[i++];
        const job = this.answerOne(id);
        this.answering.set(id, job);
        await job;
      }
    };
    return Promise.all(Array.from({ length: Math.min(ANSWER_POOL, todo.length) }, worker)).then(() => undefined);
  }

  private async answerOne(id: string): Promise<void> {
    try {
      const s = this.settings();
      const fav = s.favorites.find((f) => f.id === id);
      if (!fav) return;
      const a = await deadline(this.d.core.answer(fav, this.hereLL(), s), CORE_TIMEOUT_MS, `Pas de réseau${NB}: réessaie dans un instant.`);
      this.setAnswer(a);
    } catch (e) {
      console.warn('[Quai] réponse du favori', id, errText(e));
    } finally {
      this.answering.delete(id);
    }
    const r = current(this.nav).route;
    if (this.ready && (r.screen === 'home' || r.screen === 'favorites')) void this.render();
  }

  /** Enregistre une réponse ; zone d'un arrêt favori retrouvée ailleurs (M8.3) : le favori est mis à jour. */
  private setAnswer(a: FavoriteAnswer): void {
    this.answers.set(a.favoriteId, a);
    this.answerAt.set(a.favoriteId, this.d.clock.now());
    const m = a.movedTo;
    if (m) {
      void this.d.settings.update((x) => ({
        ...x,
        favorites: x.favorites.map((f) => (f.id === a.favoriteId && f.kind === 'stop' && f.areaId !== m.id ? { ...f, areaId: m.id, name: m.n, lat: m.lat, lon: m.lon } : f)),
      }));
    }
  }

  /**
   * Accueil : réponses des favoris en tête et « Autour de moi » léger ; ensuite, sans presser, celles des autres
   * favoris (« Autres favoris » prêt, et la règle 5 de l'ordre, « rien dans les 3 heures », à la prochaine ouverture).
   */
  private refreshHome(force: boolean): Promise<void> {
    const shown = this.homeShown();
    const p = Promise.all([this.refreshAnswers(shown, force), this.refreshNearby(force), this.refreshSections(force)]).then(() => undefined);
    void p.then(() => {
      const others = this.settings().favorites.map((f) => f.id).filter((id) => !shown.includes(id));
      return this.refreshAnswers(others, false, WARM_MS);
    });
    return p;
  }

  /** « Favoris » : réponses des favoris, puis celles des adresses récentes (1.2.2). */
  private refreshList(force: boolean): Promise<void> {
    return Promise.all([this.refreshAnswers(this.listOrder ?? [], force), this.refreshRecents(force)]).then(() => undefined);
  }

  /**
   * 1.2.2 : adresses récentes de « Favoris » (PRD-1.2.2 § 1.2) : un trajet depuis la position pour chacune (3 au plus),
   * comme l'ancien « Aller à… » ; chaque réponse s'affiche dès qu'elle arrive. Sur place : « tu y es ».
   */
  private refreshRecents(force: boolean): Promise<void> {
    if (this.recentsLoading) return this.recentsLoading;
    const s = this.settings();
    const now = this.d.clock.now();
    const todo = recentShown(s).filter((r) => {
      const hit = this.recents.get(recentKey(r.label));
      return force || !hit || now - hit.at >= REFRESH_MS;
    });
    if (!todo.length) return Promise.resolve();
    this.recentsLoading = (async () => {
      try {
        const here = this.hereLL() ?? (await this.d.platform.location.current(6000));
        for (const r of todo) {
          const key = recentKey(r.label);
          let result: PlanResult | null;
          if (!here) result = { journeys: [], empty: 'noPosition' };
          else if (distanceM(here, r) <= SAME_PLACE_M) result = { journeys: [], empty: 'here' }; // le cœur ne propose rien sur place
          else {
            const to: Endpoint = r.approx ? { type: 'address', label: r.label, lat: r.lat, lon: r.lon, approx: true } : { type: 'address', label: r.label, lat: r.lat, lon: r.lon };
            result = await deadline(this.d.core.route({ type: 'here' }, to, this.d.clock.now(), s, here), CORE_TIMEOUT_MS, 'adresse trop lente').catch(() => this.recents.get(key)?.result ?? null);
          }
          this.recents.set(key, { result, at: this.d.clock.now() });
          if (this.ready && current(this.nav).route.screen === 'favorites') void this.render();
        }
      } finally {
        this.recentsLoading = null;
      }
    })();
    return this.recentsLoading;
  }

  /* ------------------------------ 1.2.2 : rubriques de l'accueil ------------------------------ */

  /**
   * Prochain départ de la gare et de la ligne choisies les plus proches (REVUE-USAGE n° 6) : une requête par rubrique
   * et par rafraîchissement (30 s), seulement pour l'élément montré ; sans position, le premier de la liste.
   */
  private refreshSections(force: boolean): Promise<void> {
    if (this.sectionsLoading) return this.sectionsLoading;
    const s = this.settings();
    const here = this.hereLL();
    const now = this.d.clock.now();
    const stale = (x: SectionData | undefined, id: string | undefined): boolean => !!id && (force || !x || x.id !== id || now - x.at >= REFRESH_MS);
    const station = nearestPick(s.stations, here);
    const line = nearestPick(s.lines, here);
    if (!station) delete this.sections.stations;
    if (!line) delete this.sections.lines;
    const jobs: Promise<void>[] = [];
    if (station && stale(this.sections.stations, station.id)) jobs.push(this.sectionOf(station, true).then((x) => void (this.sections.stations = x)));
    if (line && stale(this.sections.lines, line.id)) jobs.push(this.sectionOf(line, false).then((x) => void (this.sections.lines = x)));
    if (!jobs.length) return Promise.resolve();
    this.sectionsLoading = Promise.all(jobs)
      .catch((e: unknown) => console.warn('[Quai] rubriques de l’accueil', errText(e)))
      .then(() => {
        this.sectionsLoading = null;
        if (this.ready && current(this.nav).route.screen === 'home') void this.render();
      });
    return this.sectionsLoading;
  }

  /** Prochain départ d'une gare (tableau) ou d'une ligne à son arrêt (le plus tôt de ses sens). */
  private async sectionOf(p: StationPick | LinePick, station: boolean): Promise<SectionData> {
    const at = this.d.clock.now();
    const prev = (station ? this.sections.stations : this.sections.lines)?.id === p.id ? (station ? this.sections.stations : this.sections.lines) : undefined;
    try {
      const line = !station ? (p as LinePick).line : undefined;
      if (line) {
        const b = await deadline(this.d.core.lineBoard(p.areaId, line, { perDirection: 1 }), CORE_TIMEOUT_MS, 'ligne trop lente');
        if (b.state === 'missing') return { id: p.id, at, state: 'missing' };
        const next = b.directions.flatMap((d) => d.departures).filter((d) => d.est >= at - 30_000).sort((x, y) => x.est - y.est)[0];
        return next ? { id: p.id, at, state: 'ok', next } : { id: p.id, at, state: 'none' };
      }
      const b = await deadline(this.d.core.board(p.areaId, { limit: 3 }), CORE_TIMEOUT_MS, 'départs trop lents');
      const next = upcoming(b.departures, at)[0];
      return next ? { id: p.id, at, state: 'ok', next } : { id: p.id, at, state: 'none' };
    } catch (e) {
      // la valeur déjà montrée reste (« … » sinon), nouvel essai au prochain rafraîchissement
      console.warn('[Quai] prochain départ', p.areaId, errText(e));
      return prev ? { ...prev, at: 0 } : { id: p.id, at: 0, state: 'unknown' };
    }
  }

  /** Texte de droite d'une rubrique de l'accueil (sans « ~ », comme l'accueil 1.2.1). */
  private sectionNext(kind: 'stations' | 'lines'): SectionNext | undefined {
    const x = this.sections[kind];
    const now = this.d.clock.now();
    if (!x || x.state === 'unknown') return undefined;
    if (x.state === 'missing') return { text: SECTION.missingStation };
    if (x.state === 'none' || !x.next) return { text: SECTION.noDeparture };
    if (x.next.est < now - 30_000) return undefined;
    return departureRightText(x.next, now);
  }

  /** Nombre d'arrêts « Autour de moi » sans charger les départs (M8.7) et lieu proche (« Près de … »). */
  private refreshNearby(force: boolean): Promise<void> {
    const here = this.hereLL();
    if (!here) return Promise.resolve();
    const s = this.settings();
    const key = `${here.lat.toFixed(4)},${here.lon.toFixed(4)},${s.display.radiusM}`;
    const now = this.d.clock.now();
    if (!force && this.nearbyLight?.key === key && now - this.nearbyLight.at < REFRESH_MS) return Promise.resolve();
    if (this.nearbyLoading) return this.nearbyLoading;
    this.nearbyLoading = (async () => {
      try {
        const list = await deadline(this.d.core.nearby(here.lat, here.lon, s.display.radiusM, { light: true }), CORE_TIMEOUT_MS, 'Autour de moi trop lent');
        this.nearbyLight = { key, at: this.d.clock.now(), count: list.length, near: nearLabel(list, s) };
      } catch (e) {
        console.warn('[Quai] autour de moi', errText(e));
      } finally {
        this.nearbyLoading = null;
      }
      if (this.ready && current(this.nav).route.screen === 'home') void this.render();
    })();
    return this.nearbyLoading;
  }

  private homeData(): HomeData {
    const s = this.settings();
    const order = this.validOrder(this.homeOrder ?? this.computeOrder());
    const shown = this.homeShown();
    const data: HomeData = {
      favorites: shown.map((id) => this.entry(id)).filter((e): e is FavoriteEntry => !!e),
      order,
      noFavorites: s.display.opening === 'home',
      gestureHelp: this.homeHelp(),
      ...this.freshLines(),
    };
    const here = this.hereLL();
    if (!here) data.noPosition = true;
    else if (this.nearbyLight) {
      data.nearbyCount = this.nearbyLight.count;
      if (this.nearbyLight.near) data.near = this.nearbyLight.near;
    }
    const t = this.trip;
    if (t && this.tripState() === 'running') {
      data.running = { title: t.title, next: runningNext(this.journeyOf(t.journey), this.d.clock.now()) };
      if (t.favoriteId) data.running.favoriteId = t.favoriteId;
    }
    const st = this.sectionNext('stations');
    const li = this.sectionNext('lines');
    if (st) data.stationsNext = st;
    if (li) data.linesNext = li;
    return data;
  }

  /* ------------------------------ Trajet suivi et en cours ------------------------------ */

  private async loadTrip(): Promise<void> {
    if (this.tripLoaded) return;
    this.tripLoaded = true;
    if (this.trip) return;
    try {
      const raw = await this.d.platform.kv.get(TRIP_KEY);
      this.trip = parseTrip(raw);
      this.tripSaved = raw ?? '';
    } catch (e) {
      console.warn('[Quai] trajet suivi illisible', errText(e));
    }
  }

  /** Enregistre le trajet suivi (seulement s'il a changé). */
  private saveFollowed(): void {
    const raw = this.trip ? JSON.stringify(this.trip) : '';
    if (raw === this.tripSaved) return;
    this.tripSaved = raw;
    void this.d.platform.kv.set(TRIP_KEY, raw).catch((e: unknown) => console.warn('[Quai] trajet suivi non enregistré', errText(e)));
  }

  private tripState(): TripPhase {
    const t = this.trip;
    if (!t) return 'ended';
    return tripPhase(t, this.journeyOf(t.journey), this.d.clock.now(), this.here);
  }

  /** Trajet terminé (arrivée plus 5 min, ou pas parti) : il n'est plus suivi. */
  private checkTrip(): void {
    if (this.trip && this.tripState() === 'ended') {
      this.trip = null;
      this.saveFollowed();
    }
  }

  /**
   * Fait d'un trajet le trajet suivi, toujours sur demande (1.2.2, PRD-1.2.2 § 6 : toucher « Suivre ce trajet »,
   * bouton « Lunettes » du téléphone) : il remplace le trajet suivi d'avant. Ouvrir un trajet ne le fait jamais suivre.
   */
  private follow(j: Journey, s: { key: string; title: string; journeys: Journey[]; from?: Endpoint; to?: Endpoint; favoriteId?: string }): void {
    const here = this.hereLL();
    const start = j.legs[0]?.from;
    const index = Math.max(0, s.journeys.findIndex((x) => x.id === j.id));
    this.trip = {
      v: 1,
      explicit: true,
      journey: j,
      title: s.title,
      ...(s.from ? { from: s.from } : {}),
      ...(s.to ? { to: s.to } : {}),
      ...(s.favoriteId ? { favoriteId: s.favoriteId } : {}),
      origin: here ?? (start ? { lat: start.lat, lon: start.lon } : undefined),
      startedAt: this.d.clock.now(),
      leaveAt0: j.leaveAt,
      journeys: s.journeys,
      index,
      key: s.key,
    };
    this.saveFollowed();
  }

  /** « Suivre ce trajet » : la proposition affichée devient le trajet suivi, « Trajet suivi : IC 08:42 » (M2.4). */
  private followShown(): void {
    const r = current(this.nav).route;
    if (r.screen !== 'steps') return;
    const list = routeJourneys(r);
    if (!list?.length) return;
    const j = this.journeyOf(list[Math.min(r.index ?? 0, list.length - 1)]);
    if (!j.legs.some(isRide)) return;
    this.follow(j, { key: r.key ?? routeKey(r), title: this.stepsTitle(r), journeys: list, from: r.from, to: r.to, favoriteId: r.favoriteId });
    this.showToast(`Trajet suivi${NB}: ${tripShort(j, this.d.clock.now())}`);
  }

  /**
   * « Ne plus suivre » (PRD-1.2.2 § 6) : le trajet n'est plus suivi (plus de « En cours », de « ▶ » ni de suivi
   * automatique) ; retour aux étapes, qui proposent de nouveau « Suivre ce trajet ».
   */
  private async unfollow(): Promise<void> {
    this.trip = null;
    this.saveFollowed();
    if (current(this.nav).route.screen === 'followed' && this.nav.stack.length > 1) this.nav = pop(this.nav);
    await this.onRouteChanged();
    this.showToast('Suivi arrêté');
  }

  /**
   * Le trajet suivi en cours, à l'écran qui correspond à l'heure (M6.4, M6.5) : ses étapes, et « Dans le train »
   * s'il est dans un véhicule. `base` : pile au-dessus de laquelle l'ouvrir ; `onlyRunning` : rien s'il n'est pas en cours.
   */
  private resumeNav(base: NavState, onlyRunning: boolean): NavState | null {
    const t = this.trip;
    if (!t) return null;
    if (onlyRunning && this.tripState() !== 'running') return null;
    const j = this.journeyOf(t.journey);
    const journeys = t.journeys.map((x) => (x.id === j.id ? j : x));
    const steps: StepsRoute = { screen: 'steps', key: t.key, label: '', title: t.title, journeys, index: t.index };
    if (t.from) steps.from = t.from;
    if (t.to) steps.to = t.to;
    if (t.favoriteId) steps.favoriteId = t.favoriteId;
    let nav = push(base, steps);
    const now = this.d.clock.now();
    const i = rideInProgress(j, now);
    if (i >= 0) {
      this.autoDone.add(`train:${j.id}:${i}`);
      const train: Route = { screen: 'train', journey: j, leg: i, label: t.title, auto: true };
      const st = stationTrip(j);
      if (st) train.trip = st;
      nav = push(nav, train);
    }
    return nav;
  }

  /** Rafraîchit le trajet suivi (temps réel) quand son départ approche ; le termine quand il est fini. */
  private async refreshTrip(): Promise<void> {
    this.checkTrip();
    const t = this.trip;
    if (!t) return;
    const now = this.d.clock.now();
    if (journeyStartMs(t) - now > TRIP_REFRESH_AHEAD_MS) return;
    try {
      const j = await deadline(this.d.core.refresh(this.journeyOf(t.journey), this.settings()), CORE_TIMEOUT_MS, 'trajet suivi trop lent');
      this.journeysById.set(j.id, j);
      if (this.trip && this.trip.journey.id === j.id) {
        this.trip = { ...this.trip, journey: j };
        this.saveFollowed();
      }
    } catch (e) {
      console.warn('[Quai] trajet suivi', errText(e));
    }
  }

  /**
   * Suivi automatique de la 1.0, pour le trajet suivi seulement (M2.5) : « Dans le train » au départ du véhicule
   * (l'écran revient au trajet suivi si l'on regardait une autre proposition, 1.2.1 : ou « Autres trajets »), retour
   * aux étapes à la descente, aide à l'arrivée 3 min avant une arrivée en gare.
   */
  private track(): void {
    const t = this.trip;
    if (!t || !this.ready) return;
    const j = this.journeyOf(t.journey);
    const f = current(this.nav);
    const r = f.route;
    const now = this.d.clock.now();
    const inSession = (x: Route): boolean => (x.screen === 'steps' || x.screen === 'others') && (x.key ?? '') === t.key;
    if (inSession(r)) {
      const i = rideInProgress(j, now);
      const arrival = arrivalDue(j, now) && !this.autoDone.has(`arrival:${j.id}`);
      const train = i >= 0 && !this.autoDone.has(`train:${j.id}:${i}`);
      if (!train && !arrival) return;
      let nav = this.nav;
      // « Autres trajets » et une proposition ouverte depuis elle : retour aux étapes d'où la liste a été ouverte.
      for (let x = current(nav).route; nav.stack.length > 1 && inSession(x) && (x.screen === 'others' || (x.screen === 'steps' && !!x.fromList)); x = current(nav).route) nav = pop(nav);
      const base = current(nav).route;
      if (base.screen !== 'steps') return;
      if ((base.index ?? 0) !== t.index || routeJourneys(base)?.[base.index ?? 0]?.id !== j.id) {
        const list = (routeJourneys(base) ?? []).map((x) => (x.id === j.id ? j : x));
        const idx = list.findIndex((x) => x.id === j.id);
        nav = replaceAt(nav, { ...base, journeys: idx >= 0 ? list : [j], index: Math.max(0, idx) }, 0, true);
      }
      if (train) {
        this.autoDone.add(`train:${j.id}:${i}`);
        const route: Route = { screen: 'train', journey: j, leg: i, label: t.title, auto: true };
        const st = stationTrip(j);
        if (st) route.trip = st;
        this.nav = push(nav, route);
        return;
      }
      this.autoDone.add(`arrival:${j.id}`);
      this.nav = push(nav, { screen: 'arrival', journey: j, leg: lastRideIndex(j), ...(stationTrip(j) ? { trip: stationTrip(j) } : {}) });
      return;
    }
    if (r.screen === 'train' && r.journey.id === j.id) {
      const leg = j.legs[r.leg];
      if (!leg) return;
      if (r.leg === lastRideIndex(j) && arrivalDue(j, now) && !this.autoDone.has(`arrival:${j.id}`)) {
        this.autoDone.add(`arrival:${j.id}`);
        this.nav = push(this.nav, { screen: 'arrival', journey: j, leg: r.leg, ...(r.trip ? { trip: r.trip } : stationTrip(j) ? { trip: stationTrip(j) } : {}) });
        return;
      }
      const below = this.nav.stack[this.nav.stack.length - 2]?.route;
      if (now >= leg.arr + 60_000 && below?.screen === 'steps' && !this.autoDone.has(`alight:${j.id}:${r.leg}`)) {
        this.autoDone.add(`alight:${j.id}:${r.leg}`);
        this.nav = pop(this.nav);
      }
    }
  }

  /* ------------------------------ Étapes ------------------------------ */

  private stepsTitle(r: StepsRoute): string {
    return r.title || towards(r.label);
  }

  /**
   * Le trajet en cours de ce favori : le reprendre plutôt que d'en proposer un autre depuis le train. Vrai s'il a été
   * repris.
   */
  private async resumeFavorite(id: string): Promise<boolean> {
    if (this.trip?.favoriteId !== id || this.tripState() !== 'running') return false;
    const nav = this.resumeNav(this.nav, false);
    if (!nav) return false;
    this.nav = nav;
    await this.onRouteChanged();
    return true;
  }

  /**
   * Toucher sur un favori : étapes du trajet ou du lieu (sa réponse, si elle est prête), sans le suivre (1.2.2, PRD-1.2.2
   * § 6) ; son trajet en cours est repris ; un arrêt favori (réglages d'avant la 1.2.2) : ses départs.
   */
  private async openFavorite(id: string): Promise<void> {
    const s = this.settings();
    const f = s.favorites.find((x) => x.id === id);
    if (!f) return;
    if (f.kind === 'stop') {
      this.nav = push(this.nav, favoriteStopRoute(f));
      await this.onRouteChanged();
      return;
    }
    if (await this.resumeFavorite(f.id)) return;
    const title = favoriteTitle(f, s);
    const a = this.answers.get(id);
    if (a?.state === 'here') {
      this.nav = push(this.nav, { screen: 'message', kind: 'info', title, lines: [alreadyText(title)] });
      await this.onRouteChanged();
      return;
    }
    const j0 = a?.state === 'ok' ? a.plan?.journeys[0] : undefined;
    const ready = !!j0 && this.d.clock.now() - (this.answerAt.get(id) ?? 0) < 2 * REFRESH_MS && catchable(j0, this.d.clock.now());
    const { from, to } = asTrip(f);
    await this.openSteps({ title, from, to, favoriteId: f.id, journeys: ready && a?.plan ? a.plan.journeys : undefined });
  }

  /**
   * Toucher sur une adresse récente de « Favoris » (1.2.1 : lieu ou adresse de « Aller à… ») : étapes directement
   * (CA-M2.4), sans les suivre. Un lieu (Endpoint 'place', 1.2) : son titre, son trajet en cours repris.
   */
  private async goTo(key: string, to: Endpoint, label: string): Promise<void> {
    const s = this.settings();
    const fav = to.type === 'place' ? placeOf(s, to.placeId) : undefined;
    if (fav && (await this.resumeFavorite(fav.id))) return;
    const title = fav ? favoriteTitle(fav, s) : towards(label);
    const here = this.hereLL();
    const point = endpointPoint(to, s);
    if ((here && point && distanceM(here, point) <= SAME_PLACE_M) || (fav && this.answers.get(fav.id)?.state === 'here')) {
      this.nav = push(this.nav, { screen: 'message', kind: 'info', title, lines: [alreadyText(title)] });
      await this.onRouteChanged();
      return;
    }
    const hit = this.recents.get(key);
    const res = hit?.result;
    const fresh = !!hit && this.d.clock.now() - hit.at < 2 * REFRESH_MS;
    const journeys = fresh && res?.journeys.length && catchable(res.journeys[0], this.d.clock.now()) ? res.journeys : undefined;
    await this.openSteps({ title, from: { type: 'here' }, to, ...(fav ? { favoriteId: fav.id } : {}), journeys });
  }

  /** Ouvre « Trajet proposé » sur la proposition 1 (calculée sur place si besoin), sans la suivre (PRD-1.2.2 § 6). */
  private async openSteps(o: { title: string; from: Endpoint; to: Endpoint; favoriteId?: string; journeys?: Journey[] }): Promise<void> {
    const route: StepsRoute = { screen: 'steps', key: this.newKey(), label: '', title: o.title, from: o.from, to: o.to };
    if (o.favoriteId) route.favoriteId = o.favoriteId;
    if (o.journeys?.length) {
      route.journeys = o.journeys;
      route.index = 0;
    }
    this.nav = push(this.nav, route);
    await this.onRouteChanged();
  }

  /**
   * ▼ au bout des étapes (PRD-1.2.1 § 3.1 à 3.4) : la page « Autres trajets », jamais un autre trajet directement ;
   * au bout d'une proposition ouverte depuis la liste, retour à la liste. ▲ en haut, ou ▼ sans autre proposition :
   * rien (la ligne du bas dit « Fin du trajet. Pas d'autre trajet pour l'instant »).
   */
  private stepsEdge(dir: 'up' | 'down'): void {
    const r = current(this.nav).route;
    if (r.screen !== 'steps' || dir !== 'down') return;
    const list = routeJourneys(r);
    if (!list?.length) return;
    const below = this.nav.stack[this.nav.stack.length - 2]?.route;
    // Un message de la page (« Trajet suivi : … ») ne suit pas sur la page suivante.
    this.clearToast();
    if (r.fromList && below?.screen === 'others') {
      this.nav = pop(this.nav);
      void this.onRouteChanged();
      return;
    }
    if (list.length < 2) return;
    const others: OthersRoute = { screen: 'others', title: this.stepsTitle(r), journeys: list, index: Math.min(Math.max(0, r.index ?? 0), list.length - 1) };
    if (r.key) others.key = r.key;
    if (r.from) others.from = r.from;
    if (r.to) others.to = r.to;
    if (r.favoriteId) others.favoriteId = r.favoriteId;
    this.nav = push(this.nav, others);
    void this.onRouteChanged();
  }

  /* ------------------------------ Départs : gare ou ligne gardée, annulable ------------------------------ */

  private clearToast(): void {
    this.toast = null;
    clearTimeout(this.toastTimer);
  }

  private showToast(text: string, ms = TOAST_MS): void {
    this.toast = { text, until: this.d.clock.now() + ms, route: routeKey(current(this.nav).route) };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      if (this.toast && this.toast.until <= this.d.clock.now()) this.toast = null;
      void this.render();
    }, Math.max(50, this.d.clock.real(ms)));
    void this.render();
  }

  /** Zone des départs affichés (tableau chargé), pour ★. */
  private boardArea(r: Extract<Route, { screen: 'board' }>): Board['area'] | undefined {
    const hit = this.cache.get(routeKey(r));
    return hit?.ok ? (hit.value as { board: Board }).board.area : undefined;
  }

  /** Message quand une rubrique est pleine (LIMITS) : où en retirer. */
  private full(what: string): void {
    this.showToast(`Déjà ${what}${NB}: retires-en une ${this.d.web ? 'dans l’onglet Réglages' : 'sur le téléphone'}`);
  }

  /**
   * 1.2.2 (REVUE-USAGE n° 3) : ★ des départs d'une gare : elle rejoint « Gares » (« ★ Ajoutée à tes gares », 8 au plus)
   * ou en sort avec « ★ Retirée. Toucher encore : annuler » (5 s) ; un toucher pendant ces 5 s la rétablit à
   * l'identique (même identifiant, même place, `near` compris : « ★ Gare rétablie »). Plus jamais d'arrêt favori.
   */
  private async toggleStation(): Promise<void> {
    const r = current(this.nav).route;
    if (r.screen !== 'board') return;
    const key = routeKey(r);
    const u = this.undo;
    if (u?.station && u.key === key && this.d.clock.now() < u.until) {
      const st = u.station;
      this.undo = null;
      await this.d.settings.update((x) => {
        if (x.stations.some((p) => p.id === st.id || p.areaId === st.areaId)) return x;
        const stations = [...x.stations];
        stations.splice(Math.min(u.index, stations.length), 0, st);
        return { ...x, stations };
      });
      this.showToast('★ Gare rétablie');
      return;
    }
    const area = this.boardArea(r);
    if (!area) return;
    const s = this.settings();
    const kept = stationOfArea(s.stations, r.areaId, area);
    if (kept) {
      const index = s.stations.findIndex((p) => p.id === kept.id);
      await this.d.settings.update((x) => ({ ...x, stations: x.stations.filter((p) => p.id !== kept.id) }));
      this.undo = { key, until: this.d.clock.now() + UNDO_MS, index, station: structuredClone(kept) };
      this.showToast(`★ Retirée. Toucher encore${NB}: annuler`, UNDO_MS);
      return;
    }
    this.undo = null;
    if (s.stations.length >= PICK_MAX.stations) return this.full(`${PICK_MAX.stations} gares`);
    const pick: StationPick = { id: newId('st', pickIds(s)), areaId: area.id, name: area.n, lat: area.lat, lon: area.lon };
    await this.d.settings.update((x) => ({ ...x, stations: [...x.stations, pick] }));
    this.showToast('★ Ajoutée à tes gares');
  }

  /**
   * 1.2.2 (REVUE-USAGE n° 3) : « garder une ligne » : la ligne rejoint « Bus, tram, métro » à cet arrêt, ses deux sens
   * (« ★ Ajoutée à Bus, tram, métro », 12 au plus), ou en sort, annulable 5 s comme une gare (« ★ Ligne rétablie »).
   */
  private async toggleLine(line: string, mode: Mode): Promise<void> {
    const r = current(this.nav).route;
    if (r.screen !== 'keepLine') return;
    const key = routeKey(r);
    const u = this.undo;
    if (u?.pick && u.key === key && u.line === line && this.d.clock.now() < u.until) {
      const pick = u.pick;
      this.undo = null;
      await this.d.settings.update((x) => {
        if (x.lines.some((p) => p.id === pick.id || (p.areaId === pick.areaId && p.line === pick.line))) return x;
        const lines = [...x.lines];
        lines.splice(Math.min(u.index, lines.length), 0, pick);
        return { ...x, lines };
      });
      this.showToast('★ Ligne rétablie');
      return;
    }
    const s = this.settings();
    const kept = s.lines.find((p) => p.areaId === r.areaId && p.line === line);
    if (kept) {
      const index = s.lines.findIndex((p) => p.id === kept.id);
      await this.d.settings.update((x) => ({ ...x, lines: x.lines.filter((p) => p.id !== kept.id) }));
      this.undo = { key, until: this.d.clock.now() + UNDO_MS, index, pick: structuredClone(kept), line };
      this.showToast(`★ Retirée. Toucher encore${NB}: annuler`, UNDO_MS);
      return;
    }
    this.undo = null;
    if (s.lines.length >= PICK_MAX.lines) return this.full(`${PICK_MAX.lines} lignes`);
    const pick: LinePick = { id: newId('ln', pickIds(s)), areaId: r.areaId, op: r.op, name: r.name, lat: r.lat, lon: r.lon, line, mode };
    await this.d.settings.update((x) => ({ ...x, lines: [...x.lines, pick] }));
    this.showToast('★ Ajoutée à Bus, tram, métro');
  }

  /**
   * « ★ garder ce trajet » (aide à l'arrivée, PRD-1.2 § 2.3) : le trajet suivi parti de « Ma position » devient un
   * lieu (sa destination) ; sinon un trajet fixe, du départ à l'arrivée du trajet suivi, ou de gare à gare.
   */
  private async saveTrip(): Promise<void> {
    const r = current(this.nav).route;
    if (r.screen !== 'arrival') return;
    const s = this.settings();
    const t = this.trip && this.trip.journey.id === r.journey.id ? this.trip : null;
    const already = (): void => this.showToast('★ Déjà dans les favoris');
    if (t?.favoriteId && s.favorites.some((f) => f.id === t.favoriteId)) return already();
    const id = newId('fav', s.favorites.map((f) => f.id));
    let fav: Favorite;
    if (t?.from?.type === 'here') {
      // Parti de « Ma position » : sa destination devient un lieu (jamais un trajet fixe depuis « Ma position »).
      const to = t.to;
      if (to?.type === 'place') return s.favorites.some((f) => f.id === to.placeId) ? already() : undefined;
      const place = to ? placeFromEndpoint(to, id, s.lang) : null;
      if (!place) return;
      if (s.favorites.some((f) => f.kind === 'place' && samePlace(f, place))) return already();
      fav = place;
    } else {
      // Sinon un trajet fixe : extrémités du trajet suivi, ou de gare à gare (aide à l'arrivée d'un train).
      const ends: { from: Endpoint; to: Endpoint } | null =
        t?.from && t.to ? { from: t.from, to: t.to } : r.trip ? { from: { type: 'area', ...r.trip.from }, to: { type: 'area', ...r.trip.to } } : null;
      if (!ends) return;
      if (s.favorites.some((f) => f.kind === 'trip' && sameEndpoint(f.from, ends.from) && sameEndpoint(f.to, ends.to))) return already();
      fav = { kind: 'trip', id, ...ends, propose: 'never' };
    }
    await this.d.settings.update((x) => ({ ...x, favorites: [...x.favorites, fav] }));
    this.showToast('★ Trajet ajouté aux favoris');
  }

  /* ------------------------------ Téléphone (GlassesApi) ------------------------------ */

  /**
   * Bouton « Lunettes » d'une carte ou d'un favori (M2.9, S8) : le trajet `index` s'affiche sur l'écran des étapes et
   * devient le trajet suivi, même de gare à gare. Rend le message affiché à côté du bouton.
   */
  async showTrip(req: TripRequest): Promise<string> {
    let journeys = req.result.journeys;
    let index = Math.min(Math.max(0, req.index), Math.max(0, journeys.length - 1));
    let j = journeys[index];
    if (j && !catchable(j, this.d.clock.now())) {
      // Propositions trop anciennes (le premier véhicule est parti) : recalcul depuis les mêmes extrémités ; jamais
      // « Dans le train » sur un trajet qu'on ne peut plus prendre.
      const fresh = await this.freshPlan(req.from, req.to);
      if (!fresh.length) return 'Aucun trajet trouvé pour l’instant.';
      journeys = fresh;
      index = 0;
      j = fresh[0];
    }
    const route: StepsRoute = { screen: 'steps', key: this.newKey(), label: '', title: req.title, from: req.from, to: req.to };
    if (req.favoriteId) route.favoriteId = req.favoriteId;
    if (j) {
      route.journeys = journeys;
      route.index = index;
      this.follow(j, { key: route.key!, title: req.title, journeys, from: req.from, to: req.to, favoriteId: req.favoriteId });
    } else {
      route.follow = 'phone';
    }
    await this.showNav(reset([{ screen: 'home' }, route]), route);
    return j ? shownMessage(j, this.d.clock.now()) : 'Affiché dans les lunettes.';
  }

  /** Propositions recalculées maintenant, encore attrapables (vide si rien ou en cas d'erreur). */
  private async freshPlan(from: Endpoint, to: Endpoint): Promise<Journey[]> {
    const needsHere = from.type === 'here' || to.type === 'here';
    const here = this.hereLL() ?? (needsHere ? await this.d.platform.location.current(6000) : null);
    if (needsHere && !here) return [];
    try {
      const now = this.d.clock.now();
      const res = await deadline(this.d.core.route(from, to, now, this.settings(), here), CORE_TIMEOUT_MS, 'calcul trop lent');
      return res.journeys.filter((x) => catchable(x, this.d.clock.now()));
    } catch (e) {
      console.warn('[Quai] trajet recalculé', errText(e));
      return [];
    }
  }

  /** Bouton « Lunettes » d'un arrêt favori (S8) : ses départs. */
  async showBoard(areaId: string, filter?: LineFilter[]): Promise<string> {
    const s = this.settings();
    // 1.2.2 : le nom d'une gare ou d'une ligne choisie (réglages v4), sinon celui d'un arrêt favori d'avant.
    const known = [...s.stations, ...s.lines, ...s.favorites.filter((f): f is FavoriteStop => f.kind === 'stop')].find((x) => x.areaId === areaId);
    const route: Route = { screen: 'board', areaId };
    if (filter?.length) route.filter = filter;
    if (known) route.name = known.name;
    await this.showNav(reset([{ screen: 'home' }, route]), route);
    let name = known ? displayName(known.name, s.lang) : '';
    if (!name && this.ready) {
      await deadline(this.load(route), 3000, 'départs trop lents').catch(() => undefined);
      const hit = this.cache.get(routeKey(route));
      if (hit?.ok) name = displayName((hit.value as { board: { area: { n: FavoriteStop['name'] } } }).board.area.n, s.lang);
    }
    return name ? `Affiché dans les lunettes${NB}: départs de ${name}.` : 'Affiché dans les lunettes.';
  }

  /** Affiche un écran demandé (tests, aperçus) ; une route d'étapes de la 1.0 (un seul trajet) devient le trajet suivi. */
  async show(route: Route): Promise<void> {
    if (route.screen === 'steps' && !route.journeys && route.journey) {
      const j = route.journey;
      const steps: StepsRoute = { ...route, key: route.key ?? this.newKey(), title: this.stepsTitle(route), journeys: [j], index: 0 };
      delete steps.journey;
      this.follow(j, { key: steps.key!, title: steps.title!, journeys: [j] });
      await this.showNav(reset([{ screen: 'home' }, steps]), steps);
      return;
    }
    await this.showNav(reset([{ screen: 'home' }, route]), route);
  }

  private async showNav(nav: NavState, route: Route): Promise<void> {
    if (!this.ready || this.initError) {
      this.pendingShow = nav;
      if (!this.ready) return;
    }
    this.nav = nav;
    this.cache.delete(routeKey(route));
    this.forceNext = true;
    await this.onRouteChanged();
  }

  /* ------------------------------ Réglages ------------------------------ */

  private onSettingsChanged(): void {
    const s = this.settings();
    // Les réponses dépendent des favoris et des réglages (filtres, marche maximale) : à recalculer.
    this.answerAt.clear();
    for (const id of [...this.answers.keys()]) if (!s.favorites.some((f) => f.id === id)) this.answers.delete(id);
    // Les données dépendent du nombre de départs, du rayon, des favoris : on recharge. Les écrans de la pile gardent
    // leurs données pendant le rechargement (pas d'écran d'attente : 1.2.2, les départs sous « garder une ligne »),
    // les autres sont oubliés.
    const r = current(this.nav).route;
    const keep = new Set(this.nav.stack.map((f) => routeKey(f.route)));
    for (const k of [...this.cache.keys()]) if (!keep.has(k) && !k.startsWith('steps:') && !k.startsWith('train:')) this.cache.delete(k);
    this.nearbyLight = null;
    const picks = picksSignature(s);
    if (picks !== this.picksSig) {
      // 1.2.2 : gares ou lignes ajoutées, retirées ou réordonnées : les rubriques de l'accueil suivent.
      this.picksSig = picks;
      this.sections = {};
    }
    const sig = favSignature(s);
    if (sig !== this.favSig) {
      this.favSig = sig;
      // Favoris ajoutés, retirés ou réordonnés sur le téléphone : l'ordre affiché suit.
      if (r.screen === 'home') this.freezeHome();
      if (r.screen === 'favorites') this.listOrder = this.computeListOrder();
    }
    if (r.screen === 'message' && r.kind === 'firstRun' && s.onboarded && this.ready) {
      this.nav = this.homeNav();
      void this.render();
      return;
    }
    if (!this.ready) return;
    if (r.screen === 'home') void this.refreshHome(true);
    else if (r.screen === 'favorites') void this.refreshList(true);
    else if (LIVE.has(r.screen)) void this.load(r, true);
    void this.render();
  }

  /* ------------------------------ Données ------------------------------ */

  private settings(): Settings {
    return this.d.settings.get();
  }

  /** Fraîcheur des horaires maintenant (l'appli peut rester ouverte au-delà de minuit). */
  private freshNow(): Freshness | null {
    if (this.meta) this.fresh = this.d.freshness(this.meta, this.d.clock.now());
    return this.fresh;
  }

  private freshLines(): Pick<HomeData, 'stale' | 'notice'> {
    const f = this.freshNow();
    if (!f) return {};
    if (!f.ok) return { stale: f.message || `Horaires périmés${NB}: mise à jour de nuit en panne` };
    return f.message ? { notice: f.message } : {};
  }

  private ctx(): ViewCtx {
    const f = this.freshNow();
    const ctx: ViewCtx = { now: this.d.clock.now(), settings: this.settings() };
    if (f && !f.ok) ctx.stale = f.message || `Horaires périmés${NB}: mise à jour de nuit en panne`;
    if (this.d.web) ctx.web = true;
    if (this.meta) {
      try {
        ctx.rt = this.d.core.status().rt;
      } catch {
        /* cœur sans état du temps réel */
      }
    }
    return ctx;
  }

  private hereLL(): LatLon | null {
    return this.here ? { lat: this.here.lat, lon: this.here.lon } : null;
  }

  /**
   * Nouvelle position demandée tout de suite (Quai Web : arrêt choisi, retour au GPS, permission accordée).
   * Contrairement au rafraîchissement de 30 s, une position absente remplace l'ancienne.
   */
  async relocate(): Promise<void> {
    if (this.stopped) return;
    const prev = this.here;
    const fix = await this.d.platform.location.current(8000);
    this.here = fix;
    if (prev && fix && distanceM(prev, fix) <= MOVE_M) return;
    this.positionChanged();
    if (!this.ready) return;
    const r = current(this.nav).route;
    if (r.screen === 'home') void this.refreshHome(true);
    if (r.screen === 'home' || USES_POSITION.has(r.screen)) await this.render();
  }

  /** Une nouvelle position change « Autour de moi », « Aller à… » et les trajets depuis « Ma position ». */
  private positionChanged(): void {
    for (const k of [...this.cache.keys()]) if (USES_POSITION.has(k.split(':')[0])) this.cache.delete(k);
    this.nearbyLight = null;
    this.answerAt.clear();
    // 1.2.2 : adresses récentes (trajets depuis la position) à recalculer ; la réponse montrée reste en attendant.
    for (const [k, v] of this.recents) this.recents.set(k, { ...v, at: 0 });
  }

  private async updateLocation(): Promise<void> {
    if (this.paused || this.stopped) return;
    const prev = this.here;
    const fix = await this.d.platform.location.current(8000);
    if (!fix) return;
    this.here = fix;
    const moved = !prev || distanceM(prev, fix) > MOVE_M;
    if (!moved) return;
    this.positionChanged();
    const r = current(this.nav).route;
    if (r.screen === 'home') void this.refreshHome(false);
    if (r.screen === 'home' || USES_POSITION.has(r.screen)) await this.render();
  }

  /** Rafraîchissement périodique de l'écran courant (temps réel) et du trajet suivi. */
  async refreshCurrent(force = false): Promise<void> {
    if (this.paused || this.stopped || !this.ready) return;
    if (this.initError || this.atLaunchError()) {
      await this.boot();
      return;
    }
    await this.refreshTrip();
    this.track();
    const r = current(this.nav).route;
    if (r.screen === 'home') await this.refreshHome(true);
    else if (r.screen === 'favorites') await this.refreshList(true);
    else if (LIVE.has(r.screen) || force) await this.load(r, true);
    this.track();
    await this.render();
  }

  private load(r: Route, refresh = false): Promise<void> {
    const key = routeKey(r);
    if (!refresh && this.cache.has(key)) return Promise.resolve();
    const running = this.loading.get(key);
    if (running) return running;
    const p = (async () => {
      try {
        const value = await deadline(this.fetch(r), CORE_TIMEOUT_MS, `Pas de réseau${NB}: réessaie dans un instant.`);
        this.cache.set(key, { ok: true, value, at: this.d.clock.now() });
      } catch (e) {
        const prev = this.cache.get(key);
        // Une donnée déjà affichée reste à l'écran si le rafraîchissement échoue.
        if (!prev?.ok) this.cache.set(key, { ok: false, error: errText(e), at: this.d.clock.now() });
      } finally {
        this.loading.delete(key);
      }
      if (routeKey(current(this.nav).route) === key) {
        this.track();
        await this.render();
      }
    })();
    this.loading.set(key, p);
    return p;
  }

  private async fetch(r: Route): Promise<unknown> {
    const core = this.d.core;
    const s = this.settings();
    switch (r.screen) {
      case 'nearby': {
        const here = this.hereLL() ?? (await this.d.platform.location.current(6000));
        if (!here) return { noLocation: true };
        const list = await core.nearby(here.lat, here.lon, s.display.radiusM);
        if (list.length) return { list };
        // 1.2.2 (REVUE-USAGE n° 10) : rien dans le rayon : l'arrêt le plus proche jusqu'à 3 km (recherche légère).
        const far = await core.nearby(here.lat, here.lon, NEAREST_M, { light: true }).catch(() => [] as NearbyItem[]);
        return { list, nearest: far[0] ?? null };
      }
      case 'board': {
        const board = await core.board(r.areaId, { limit: s.display.depsPerStop, filter: r.filter });
        // 1.2.2 (REVUE-USAGE n° 4) : « Travaux et déviations » sur les gares et les lignes gardées (1.2.1 : arrêts favoris).
        const works = s.alerts.works && boardKept(s, r.areaId, board.area) ? await this.worksOf(board.area.op, board.area.lines, board.area.id) : [];
        return { board, works };
      }
      case 'stations':
        return this.fetchStations(r);
      case 'lines':
        return this.fetchLines(r);
      case 'line': {
        const board = await core.lineBoard(r.areaId, r.line, { perDirection: LINE_DETAIL_PER_DIRECTION });
        const works = s.alerts.works && board.state !== 'missing' ? await this.worksOf(board.op, [board.line], board.area.id) : [];
        return { board, works };
      }
      case 'keepLine': {
        // une entrée par ligne (les deux sens), dans l'ordre du cœur ; jamais de train (une gare a sa propre ★)
        const seen = new Set<string>();
        const lines: StopLine[] = [];
        for (const x of await core.linesAt(r.areaId)) {
          if (x.mode === 'train' || seen.has(x.line)) continue;
          seen.add(x.line);
          lines.push({ line: x.line, mode: x.mode });
        }
        return { lines };
      }
      case 'steps':
        return this.fetchSteps(r);
      case 'others':
        return this.fetchOthers(r);
      case 'train':
      case 'arrival': {
        const j = await core.refresh(this.journeyOf(r.journey), s);
        this.journeysById.set(j.id, j);
        if (this.trip?.journey.id === j.id) {
          this.trip = { ...this.trip, journey: j };
          this.saveFollowed();
        }
        return r.screen === 'arrival' ? this.arrivalDepartures(r, j) : { ok: true };
      }
      default:
        return null;
    }
  }

  /** Alertes travaux d'un arrêt (vide si aucune ou source en erreur). */
  private async worksOf(op: Board['area']['op'], lines: string[], areaId: string): Promise<string[]> {
    try {
      return await this.d.core.works(op, lines, [areaId]);
    } catch {
      return [];
    }
  }

  /**
   * 1.2.2 : « Gares » (PRD-1.2.2 § 2) : le prochain train de chaque gare choisie, 3 gares à la fois, affiché au fur et à
   * mesure ; une gare en erreur garde sa dernière valeur (« … » sinon).
   */
  private async fetchStations(r: Route): Promise<Record<string, StationData>> {
    const out: Record<string, StationData> = {};
    await this.progressive(r, this.settings().stations, async (p) => {
      try {
        const b = await this.d.core.board(p.areaId, { limit: 3 });
        const next = upcoming(b.departures, this.d.clock.now())[0];
        out[p.id] = next ? { state: 'ok', next } : { state: 'none' };
      } catch (e) {
        if (e instanceof QuaiError && e.code === 'areaUnknown') out[p.id] = { state: 'missing' };
        else console.warn('[Quai] gare', p.areaId, errText(e));
      }
      return { ...out };
    });
    return out;
  }

  /**
   * 1.2.2 : « Bus, tram, métro » (§ 3) : les sens de chaque ligne choisie (lineBoard), ou les départs d'un arrêt
   * « toutes les lignes » (board), 3 à la fois, affichés au fur et à mesure.
   */
  private async fetchLines(r: Route): Promise<Record<string, LineData>> {
    const out: Record<string, LineData> = {};
    await this.progressive(r, this.settings().lines, async (p) => {
      try {
        out[p.id] = p.line ? { board: await this.d.core.lineBoard(p.areaId, p.line, { perDirection: LINES_PER_DIRECTION }) } : { stop: await this.d.core.board(p.areaId, { limit: 3 }) };
      } catch (e) {
        console.warn('[Quai] ligne', p.areaId, p.line, errText(e));
      }
      return { ...out };
    });
    return out;
  }

  /**
   * Étapes : calcul des propositions si besoin (favori : sa réponse ; lieu ou adresse : route()), puis temps réel de la
   * proposition affichée et du trajet suivi.
   */
  private async fetchSteps(r: StepsRoute): Promise<unknown> {
    const core = this.d.core;
    const s = this.settings();
    const now = this.d.clock.now();
    const list = routeJourneys(r);
    if (!list) {
      const needsHere = r.from?.type === 'here' || r.to?.type === 'here';
      const here = this.hereLL() ?? (needsHere ? await this.d.platform.location.current(6000) : null);
      if (needsHere && !here) return { empty: 'noPosition' };
      const fav = r.favoriteId ? s.favorites.find((f) => f.id === r.favoriteId) : undefined;
      let plan: PlanResult;
      if (fav) {
        const a = await core.answer(fav, here, s);
        this.setAnswer(a);
        plan = a.plan ?? { journeys: [], empty: a.state === 'here' ? 'here' : a.state === 'noPosition' ? 'noPosition' : 'noTrip' };
        if (a.state === 'here') return { empty: 'here' };
      } else if (r.from && r.to) {
        plan = await core.route(r.from, r.to, now, s, here);
      } else return { empty: 'noTrip' };
      if (!plan.journeys.length) return { empty: plan.empty ?? 'noTrip' };
      this.attachJourneys(r, plan.journeys);
      return { ok: true };
    }
    const shown = list[Math.min(r.index ?? 0, list.length - 1)];
    const ids = new Set([shown.id]);
    if (this.trip && this.trip.key === r.key) ids.add(this.trip.journey.id);
    for (const id of ids) {
      const j = id === shown.id ? this.journeyOf(shown) : this.journeyOf(this.trip!.journey);
      const fresh = await core.refresh(j, s);
      this.journeysById.set(fresh.id, fresh);
      if (this.trip?.journey.id === fresh.id) {
        this.trip = { ...this.trip, journey: fresh };
        this.saveFollowed();
      }
    }
    return { ok: true };
  }

  /** « Autres trajets » : les heures des entrées en direct (retards, suppressions), chaque proposition rafraîchie. */
  private async fetchOthers(r: OthersRoute): Promise<unknown> {
    const s = this.settings();
    for (const [k, j] of r.journeys.entries()) {
      if (k === r.index) continue;
      const fresh = await this.d.core.refresh(this.journeyOf(j), s);
      this.journeysById.set(fresh.id, fresh);
      if (this.trip?.journey.id === fresh.id) {
        this.trip = { ...this.trip, journey: fresh };
        this.saveFollowed();
      }
    }
    return { ok: true };
  }

  /**
   * Propositions calculées : elles s'inscrivent dans la route (même si l'on regarde ailleurs). La 1re n'est suivie que
   * sur demande du téléphone (`follow: 'phone'`) ; 1.2.2 : la valeur 'open' d'un état de la 1.2.1 ne fait plus suivre.
   */
  private attachJourneys(r: StepsRoute, journeys: Journey[]): void {
    const key = r.key;
    this.nav = mapRoutes(this.nav, (x) => (x.screen === 'steps' && x.key === key && !x.journeys ? { ...x, journeys, index: 0, follow: undefined } : x));
    if (r.follow === 'phone') {
      const j = journeys[0];
      this.follow(j, { key: key ?? routeKey(r), title: this.stepsTitle(r), journeys, from: r.from, to: r.to, favoriteId: r.favoriteId });
    }
  }

  /**
   * Charge une liste élément par élément (3 à la fois) et affiche les résultats au fur et à mesure,
   * sans attendre le dernier (lieux).
   */
  private async progressive<T>(r: Route, list: T[], one: (x: T) => Promise<unknown>): Promise<void> {
    const key = routeKey(r);
    let i = 0;
    const worker = async (): Promise<void> => {
      while (i < list.length) {
        const x = list[i++];
        const partial = await one(x);
        // Rafraîchissement : on fusionne avec la liste déjà affichée (pas de « … » qui réapparaît).
        const prev = this.cache.get(key);
        const value = prev?.ok ? { ...(prev.value as object), ...(partial as object) } : partial;
        this.cache.set(key, { ok: true, value, at: prev?.at ?? this.d.clock.now() });
        if (routeKey(current(this.nav).route) === key) void this.render();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  private async arrivalDepartures(r: Extract<Route, { screen: 'arrival' }>, j: Journey): Promise<{ deps: Departure[] }> {
    const leg = j.legs[r.leg];
    const to = leg?.to;
    if (!to) return { deps: [] };
    const around = (await this.d.core.nearby(to.lat, to.lon, 300)).filter((n) => n.area.op !== 'sncb').slice(0, 2);
    const deps: Departure[] = [];
    for (const n of around) {
      const b = await this.d.core.board(n.area.id, { limit: 8 });
      deps.push(...b.departures.filter((d) => d.est >= leg.arr && !d.cancelled));
    }
    deps.sort((a, b) => a.est - b.est);
    return { deps: deps.slice(0, 5) };
  }

  /** Dernière version connue (rafraîchie) d'un trajet. */
  private journeyOf(j: Journey): Journey {
    return this.journeysById.get(j.id) ?? j;
  }

  /* ------------------------------ Vues ------------------------------ */

  /** Entrée dans un écran : ordre des favoris recalculé puis figé (M1.4), annulation de retrait oubliée. */
  private syncEntry(): void {
    const r = current(this.nav).route;
    if (r === this.entered) return;
    this.entered = r;
    if (this.undo && this.undo.key !== routeKey(r)) this.undo = null;
    if (r.screen === 'home') {
      this.homeEntry = true;
      this.freezeHome();
      this.checkTrip();
      if (this.ready) void this.refreshHome(false);
    } else if (r.screen === 'favorites') {
      this.listOrder = this.computeListOrder();
      if (this.ready) void this.refreshList(false);
    }
  }

  /**
   * 1.2.1 : curseur de l'accueil quand ses lignes changent. En 1.2.0, les favoris commençaient à la 1re ligne et le
   * rang suffisait ; depuis que « Favoris » occupe la 1re ligne, le rang seul faisait tomber le curseur sur « Favoris »
   * (un toucher ouvrait la liste au lieu du trajet) quand « En cours » paraissait au-dessus.
   *  - Retour à l'accueil (`entering`) avec un trajet commencé entre-temps : le curseur sur « En cours », comme en 1.2.0
   *    (un toucher reprend le trajet) et comme à l'ouverture.
   *  - Sinon (accueil affiché : « En cours » qui paraît au départ ou disparaît à la fin, favoris recalculés), le
   *    curseur garde son élément (même action) ; élément disparu : 1.2.2, la ligne qui l'a remplacé (« En cours »
   *    prend la place de son favori, REVUE-USAGE n° 1, et le lui rend à la fin du trajet), sinon le rang, comme avant.
   * Cadre neuf (ouverture) : la règle d'ouverture (initialSel).
   */
  private keepHomeCursor(items: Item[], entering: boolean): void {
    const prev = this.homeItems;
    this.homeItems = items;
    const f = current(this.nav);
    if (!prev || f.route.screen !== 'home' || f.fresh || !prev.length || !items.length) return;
    const resume = items.findIndex((it) => it.action?.kind === 'resume');
    if (entering && resume >= 0 && !prev.some((it) => it.action?.kind === 'resume')) {
      this.nav = setSelection(this.nav, resume, f.top);
      return;
    }
    const id = (it: Item | undefined): string => (it?.action ? JSON.stringify(it.action) : '');
    const was = id(prev[Math.min(Math.max(0, f.sel), prev.length - 1)]);
    if (!was || id(items[f.sel]) === was) return;
    const at = items.findIndex((it) => id(it) === was);
    if (at >= 0) {
      this.nav = setSelection(this.nav, at, f.top);
      return;
    }
    const added = items.findIndex((it) => !!it.action && !prev.some((p) => id(p) === id(it)));
    if (added >= 0) this.nav = setSelection(this.nav, added, f.top);
  }

  /** Vue de l'écran courant ; lance le chargement si besoin. */
  buildView(): GlassesView {
    this.syncEntry();
    const f = current(this.nav);
    const r = f.route;
    const ctx = this.ctx();
    if (r.screen === 'message') {
      switch (r.kind) {
        case 'firstRun':
          return firstRunView(ctx);
        case 'notConfigured':
          return notConfiguredView(ctx);
        case 'news':
          return newsView(ctx, r.lines);
        case 'error':
          return errorView(r.title, r.lines.join(' '), ctx, { root: this.nav.stack.length === 1 });
        case 'loading':
          return messageView(r.title, r.lines, ctx);
        default:
          return messageView(r.title, r.lines, ctx, { hints: HINTS.message });
      }
    }
    if (r.screen === 'home') {
      const v = homeView(this.homeData(), ctx);
      this.keepHomeCursor(v.items, this.homeEntry);
      this.homeEntry = false;
      return v;
    }
    if (r.screen === 'favorites') {
      const entries = (this.listOrder ?? this.computeListOrder()).map((id) => this.entry(id)).filter((e): e is FavoriteEntry => !!e);
      const recents: Record<string, string> = {};
      for (const [k, v] of this.recents) recents[k] = planHomeText(v.result, ctx.now);
      return favoritesView({ entries, recents }, ctx);
    }
    if (r.screen === 'followed') {
      const t = this.trip;
      return followedView(t ? { title: t.title, journey: this.journeyOf(t.journey) } : null, ctx);
    }
    if (r.screen === 'steps' && routeJourneys(r)) return this.stepsViewOf(r, f, ctx);
    if (r.screen === 'others') {
      if (!this.cache.has(routeKey(r))) void this.load(r, true);
      return othersView(r, r.journeys.map((j) => this.journeyOf(j)), ctx);
    }
    const key = routeKey(r);
    const hit = this.cache.get(key);
    if (!hit) void this.load(r);
    if (hit && !hit.ok) return errorView(titleFor(r, ctx), hit.error, ctx);
    const value = hit?.ok ? hit.value : undefined;
    switch (r.screen) {
      case 'nearby': {
        if (!value) return loadingView('Autour de moi', 'Recherche des arrêts…', ctx);
        const v = value as { list?: NearbyItem[]; noLocation?: boolean; nearest?: NearbyItem | null };
        if (v.noLocation) return noLocationView('Autour de moi', ctx);
        return nearbyView(v.list ?? [], ctx, v.nearest);
      }
      case 'board': {
        const waiting = r.name ? displayName(r.name, ctx.settings.lang) : 'Départs';
        if (!value) return loadingView(waiting, 'Chargement des départs…', ctx);
        const { board, works } = value as { board: Board; works: string[] };
        const v = boardView(board, ctx, { kept: boardKept(ctx.settings, r.areaId, board.area) });
        if (!v.top && works?.[0]) v.top = { text: `! ${works[0]}`, strong: true };
        return v;
      }
      case 'stations': {
        const data = (value as Record<string, StationData> | undefined) ?? {};
        return stationsView(ctx.settings.stations.map((pick): StationRow => ({ pick, ...data[pick.id] })), ctx);
      }
      case 'lines': {
        const data = (value as Record<string, LineData> | undefined) ?? {};
        return linesView(ctx.settings.lines.map((pick): LineRow => ({ pick, ...data[pick.id] })), ctx, r.focus);
      }
      case 'line': {
        const title = linePickTitle({ ...r, id: r.pick ?? '', lat: 0, lon: 0 }, ctx.settings.lang);
        if (!value) return loadingView(title, 'Chargement des passages…', ctx, 'line');
        const { board, works } = value as { board: LineBoard; works: string[] };
        return lineView(r, board, ctx, works?.[0]);
      }
      case 'keepLine': {
        if (!value) return loadingView(keepLineTitle(displayName(r.name, ctx.settings.lang)), 'Chargement des lignes…', ctx, 'keepLine');
        return keepLineView(r, (value as { lines: StopLine[] }).lines ?? [], ctx);
      }
      case 'steps': {
        const title = this.stepsTitle(r);
        const v = value as { empty?: PlanResult['empty'] } | undefined;
        if (!v || !v.empty) return stepsMessageView(title, 'Calcul du trajet…', ctx);
        if (v.empty === 'here') return alreadyThereView(title, ctx);
        if (v.empty === 'noPosition') return noLocationView(title, ctx);
        return stepsMessageView(title, ctx.stale ?? 'Aucun trajet trouvé pour l’instant.', ctx);
      }
      case 'train':
        return trainView(this.journeyOf(r.journey), r.leg, ctx);
      case 'arrival': {
        const j = this.journeyOf(r.journey);
        const leg = j.legs[r.leg];
        const name = leg ? displayName(leg.to.name, ctx.settings.lang) : '';
        if (!value) return loadingView(`Arrivée à ${name}`, 'Recherche des départs devant la gare…', ctx);
        return arrivalView(name, leg?.arr ?? ctx.now, (value as { deps: Departure[] }).deps ?? [], ctx);
      }
      default:
        return messageView('Quai', [''], ctx);
    }
  }

  private stepsViewOf(r: StepsRoute, f: NavFrame, ctx: ViewCtx): GlassesView {
    const list = routeJourneys(r) ?? [];
    const index = Math.min(Math.max(0, r.index ?? 0), list.length - 1);
    const journeys = list.map((j) => this.journeyOf(j));
    if (!this.cache.has(routeKey(r))) void this.load(r, true);
    const t = this.trip;
    const followed = t && t.key === (r.key ?? '') ? t.journey.id : t && journeys.some((j) => j.id === t.journey.id) ? t.journey.id : undefined;
    return stepsPage(r, { journeys, index, followedId: followed, leaveAt0: followed ? t?.leaveAt0 : undefined, top: f.top, fresh: f.fresh, fromList: !!r.fromList }, ctx);
  }

  /* ------------------------------ Rendu ------------------------------ */

  /** Rendu sérialisé ; `force` reconstruit la page (retour au premier plan, écran demandé). */
  async render(force = false): Promise<void> {
    if (this.stopped) return;
    if (force) this.forceNext = true;
    if (this.rendering) {
      this.renderAgain = true;
      return;
    }
    this.rendering = true;
    try {
      do {
        this.renderAgain = false;
        const f = this.forceNext;
        this.forceNext = false;
        await this.renderOnce(f);
      } while (this.renderAgain && !this.stopped);
    } catch (e) {
      console.error('[Quai] rendu', e);
    } finally {
      this.rendering = false;
    }
  }

  private async renderOnce(force: boolean): Promise<void> {
    const view = this.buildView();
    const now = this.d.clock.now();
    const toast = this.toast && this.toast.until > now && this.toast.route === routeKey(current(this.nav).route) ? this.toast.text : undefined;
    const g = geometry(view, !!toast);
    const frame = effectiveFrame(current(this.nav), view, g.capacity);
    const page = layoutPage(view, frame, { toast });
    this.view = view;
    this.capacity = g.capacity;
    const glasses = this.d.platform.glasses;
    this.filter.notifyRender(performanceNow());
    let changed = true;
    if (!this.page) {
      // createStartUpPageContainer une seule fois par WebView ; ensuite rebuildPageContainer.
      if (this.d.pageStarted) await glasses.rebuild(page.containers);
      else if (!(await glasses.start(page.containers))) await glasses.rebuild(page.containers);
    } else if (force || shapeKey(page) !== shapeKey(this.page)) {
      await glasses.rebuild(page.containers);
    } else {
      changed = false;
      for (const c of page.containers) {
        const old = this.page.containers.find((o) => o.id === c.id);
        if (old && old.content === c.content && old.level === c.level) continue;
        changed = true;
        await glasses.upgrade(c, { content: true, level: !old || old.level !== c.level });
      }
    }
    this.page = page;
    this.filter.notifyRender(performanceNow());
    if (this.d.e2e) {
      // Espaces insécables (typographie française) normalisées pour faciliter les comparaisons des tests.
      const nb = (t: string): string => t.replace(/ /g, ' ');
      const line = 'QUAI_SCREEN ' + JSON.stringify({ screen: page.screen, title: nb(page.title), lines: page.lines.map(nb), clock: page.clock, sel: page.sel, ...(view.log ?? {}) });
      if (changed || line !== this.lastLog) {
        this.lastLog = line;
        this.log(line);
      }
    }
  }

  private log(line: string): void {
    if (!this.d.e2e) return;
    (this.d.log ?? console.log)(line);
  }

  /* ------------------------------ État d'arrière-plan ------------------------------ */

  /**
   * État pour la WebView suivante (__getStateSnapshot). Vide tant que le contrôleur n'est pas prêt : un instantané pris
   * pendant « Chargement… » ne doit ni figer la nouvelle WebView sur cet écran, ni effacer le trajet suivi pas encore lu.
   */
  snapshot(): Record<string, unknown> {
    if (!this.ready) return {};
    const snap: Record<string, unknown> = { v: 2, nav: this.nav, clock: this.d.clock.snapshot(), here: this.here, autoDone: [...this.autoDone], savedAt: Date.now() };
    // Le trajet suivi n'accompagne l'instantané que s'il a été lu (quai.trip) : sinon la nouvelle WebView le relit.
    if (this.tripLoaded) {
      snap.trip = this.trip;
      snap.tripRead = true;
    }
    return snap;
  }

  restore(snap: unknown): void {
    try {
      const s = (typeof snap === 'string' ? JSON.parse(snap) : snap) as { nav?: unknown; clock?: { now: number }; here?: Fix | null; trip?: unknown; tripRead?: unknown; autoDone?: unknown };
      if (!s || typeof s !== 'object') return;
      const nav = restorableNav(parseNav(s.nav));
      if (s.clock) this.d.clock.restore(s.clock);
      if (s.here && Number.isFinite(s.here.lat) && Number.isFinite(s.here.lon)) this.here = s.here;
      // Suivi automatique déjà fait (« Dans le train » ne revient pas après un retour volontaire aux étapes).
      if (Array.isArray(s.autoDone)) for (const k of s.autoDone) if (typeof k === 'string') this.autoDone.add(k);
      if (s.tripRead === true) {
        this.trip = parseTrip(s.trip);
        this.tripLoaded = true;
        this.saveFollowed();
      }
      if (!nav) return;
      if (!this.ready) {
        this.pendingRestore = nav;
        return;
      }
      this.nav = nav;
      this.forceNext = true;
      void this.refreshCurrent(true);
    } catch (e) {
      console.warn('[Quai] état non restauré', errText(e));
    }
  }

  /** Pour les tests et l'aperçu du téléphone. */
  get state(): { nav: NavState; page: PageSpec | null; trip: FollowedTrip | null } {
    return { nav: this.nav, page: this.page, trip: this.trip };
  }

  /** Trajet suivi (téléphone, tests). */
  get followed(): FollowedTrip | null {
    return this.trip;
  }

  async replaceRoute(route: Route): Promise<void> {
    this.nav = { stack: [...this.nav.stack.slice(0, -1), { route, sel: 0, top: 0, fresh: true }] };
    await this.onRouteChanged();
  }
}

/** 1.2.2 : la zone d'une gare ou d'une ligne choisie est celle des départs (identifiant de l'écran, de la zone, `aka`). */
const sameArea = (id: string, routeAreaId: string, area?: { id: string; aka?: string[] }): boolean => id === routeAreaId || id === area?.id || !!area?.aka?.includes(id);

/** 1.2.2 : la gare de « Gares » qui correspond à des départs (★ du titre, toucher pour la retirer). */
export function stationOfArea(stations: readonly StationPick[], routeAreaId: string, area?: { id: string; aka?: string[] }): StationPick | undefined {
  return stations.find((p) => sameArea(p.areaId, routeAreaId, area));
}

/**
 * 1.2.2 : départs gardés : la gare est dans « Gares », ou (arrêt de bus, tram, métro) une de ses lignes est dans « Bus,
 * tram, métro » (« ★ » en fin de titre, REVUE-USAGE n° 3 ; alerte travaux, n° 4).
 */
export function boardKept(s: Pick<Settings, 'stations' | 'lines'>, routeAreaId: string, area: Pick<Board['area'], 'id' | 'aka' | 'op' | 'modes'>): boolean {
  if (isStationBoard({ area: area as Board['area'] })) return !!stationOfArea(s.stations, routeAreaId, area);
  return s.lines.some((p) => sameArea(p.areaId, routeAreaId, area));
}

/** Identifiants déjà pris par les gares et les lignes (newId). */
const pickIds = (s: Pick<Settings, 'stations' | 'lines'>): string[] => [...s.stations.map((p) => p.id), ...s.lines.map((p) => p.id)];

/** 1.2.2 : la gare ou la ligne choisie la plus proche (REVUE-USAGE n° 6) ; sans position, la première de la liste. */
export function nearestPick<T extends { lat: number; lon: number }>(picks: readonly T[], here: LatLon | null): T | undefined {
  if (!here) return picks[0];
  let best: T | undefined;
  let d = Infinity;
  for (const p of picks) {
    const x = distanceM(here, p);
    if (x < d) {
      d = x;
      best = p;
    }
  }
  return best;
}

/** 1.2.2 : prochain départ d'une rubrique de l'accueil (gare ou ligne choisie la plus proche). */
interface SectionData {
  /** Gare ou ligne choisie. */
  id: string;
  at: number;
  /** unknown : pas encore obtenu (erreur) ; none : rien dans l'horizon des tableaux ; missing : introuvable. */
  state: 'ok' | 'none' | 'missing' | 'unknown';
  next?: Departure;
}

/** 1.2.2 : « Gares » : prochain train d'une gare. */
type StationData = Pick<StationRow, 'next' | 'state'>;
/** 1.2.2 : « Bus, tram, métro » : sens d'une ligne ou départs d'un arrêt. */
type LineData = Pick<LineRow, 'board' | 'stop'>;

/** 1.2.2 : signature des gares et lignes choisies (les rubriques de l'accueil se recalculent quand elle change). */
function picksSignature(s: Settings): string {
  return JSON.stringify([s.stations.map((p) => p.id + p.areaId), s.lines.map((p) => `${p.id}${p.areaId}${p.line ?? ''}`)]);
}

/**
 * Pile restaurable d'un instantané : jamais l'écran « Chargement… » ni une erreur (l'ouverture normale les remplace,
 * « réessayer » relance le démarrage) ; null s'il ne reste rien.
 */
function restorableNav(nav: NavState | null): NavState | null {
  if (!nav) return null;
  const stack = nav.stack.filter((f) => !(f.route.screen === 'message' && (f.route.kind === 'loading' || f.route.kind === 'error')));
  return stack.length ? { stack } : null;
}

/**
 * Lieu gardé depuis l'arrivée d'un trajet parti de « Ma position » (« ★ garder ce trajet », 1.2) : comme le
 * téléphone, nom = adresse courte (« Veldstraat 1 ») ou nom de l'arrêt (sous-titre « Près de Gand-Saint-Pierre ») ;
 * créneau « Jamais ». null si la destination n'est ni une adresse ni un arrêt.
 */
export function placeFromEndpoint(to: Endpoint, id: string, lang: NameLang): FavoritePlace | null {
  if (to.type === 'address') {
    const p: FavoritePlace = { kind: 'place', id, label: shortAddress(to.label).slice(0, LIMITS.label), lat: to.lat, lon: to.lon, address: to.label, src: 'address', propose: 'never' };
    if (to.approx) p.approx = true;
    return p;
  }
  if (to.type === 'area') {
    const stop = displayName(to.name, lang);
    return { kind: 'place', id, label: stop.slice(0, LIMITS.label), lat: to.lat, lon: to.lon, address: `Près de ${stop}`, src: 'stop', areaId: to.areaId, propose: 'never' };
  }
  return null;
}

/** Un lieu déjà gardé au même endroit : même arrêt, ou à 50 m au plus (même adresse). */
function samePlace(a: FavoritePlace, b: FavoritePlace): boolean {
  return (!!a.areaId && a.areaId === b.areaId) || distanceM(a, b) <= SAME_SPOT_M;
}

/** Même extrémité de trajet (même zone, même lieu, même adresse), quel que soit l'ordre des champs. */
function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  if (a.type === 'here' || b.type === 'here') return a.type === b.type;
  if (a.type === 'area' && b.type === 'area') return a.areaId === b.areaId;
  if (a.type === 'place' && b.type === 'place') return a.placeId === b.placeId;
  if (a.type === 'address' && b.type === 'address') return a.label === b.label || distanceM(a, b) <= SAME_SPOT_M;
  return false;
}

/** Signature des favoris qui change leur ordre : identifiants, créneaux, réglages d'ordre et d'ouverture. */
function favSignature(s: Settings): string {
  return JSON.stringify([s.favorites.map((f) => `${f.id}:${f.propose}`), s.display.favOrder, s.display.opening]);
}

/** « Tu es déjà au bureau. » (inchangé). */
function alreadyText(title: string): string {
  return `Tu es déjà ${atTitle(title)}.`;
}

/** Départ du trajet suivi (pour savoir quand le rafraîchir). */
function journeyStartMs(t: FollowedTrip): number {
  return Math.min(t.leaveAt0, t.journey.leaveAt);
}


function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** « Bruxelles-Nord » : la gare la plus proche dans le rayon, sinon l'arrêt le plus proche. */
export function nearLabel(list: NearbyItem[], s: Settings): string | undefined {
  const station = list.find((n) => mainMode(n.area.modes) === 'train');
  const pick = station ?? list[0];
  return pick ? displayName(pick.area.n, s.lang) : undefined;
}

function titleFor(r: Route, ctx: ViewCtx): string {
  switch (r.screen) {
    case 'nearby':
      return 'Autour de moi';
    case 'favorites':
      return 'Favoris';
    case 'stations':
      return SECTION.stations;
    case 'lines':
      return SECTION.lines;
    case 'line':
      return linePickTitle({ ...r, id: r.pick ?? '', lat: 0, lon: 0 }, ctx.settings.lang);
    case 'keepLine':
      return keepLineTitle(displayName(r.name, ctx.settings.lang));
    case 'board':
      return r.name ? displayName(r.name, ctx.settings.lang) : 'Départs';
    case 'steps':
      return r.title || towards(r.label);
    case 'others':
      return othersTitle(r.title);
    default:
      return 'Quai';
  }
}

export type { Endpoint };
