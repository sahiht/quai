/**
 * Contrôleur des lunettes : état de navigation, chargement des données du cœur, rendu
 * (createStartUpPageContainer, puis rebuildPageContainer quand la forme change, sinon
 * textContainerUpgrade), gestes, minuteries (temps réel 30 s, position 30 s, horloge), arrière-plan.
 *
 * 1.1 (PRD M1, M2, M6) : favoris « réponse directe » (ordre intelligent calculé à chaque ouverture et figé pendant
 * l'affichage, réponses rafraîchies toutes les 30 s) ; « Trajet proposé » page par page ; trajet suivi et trajet en
 * cours (clé KV quai.trip, reprise à la réouverture) ; retrait de favori annulable ; GlassesApi pour le téléphone.
 */
import type {
  Core,
  Departure,
  Endpoint,
  Favorite,
  FavoriteAnswer,
  FavoriteStop,
  FavoriteTrip,
  GlassesApi,
  Journey,
  LatLon,
  LineFilter,
  Meta,
  NearbyItem,
  PlanResult,
  Settings,
  TripRequest,
} from '../core/api';
import { MESSAGES, QuaiError } from '../core/errors';
import { endpointPoint, favoriteTitle } from '../core/favorites';
import { displayName, distanceM, mainMode } from '../core/util';
import type { Clock } from '../platform/clock';
import { deadline } from '../platform/queue';
import type { Fix, Platform } from '../platform/types';
import { newId, type SettingsStore } from '../settings';
import { APP_VERSION, compareVersions } from '../version';
import { HINTS, NB, atTitle, catchable, lowerFirst, runningNext, shownMessage, towards, tripShort } from './format';
import { DEBOUNCE, GestureFilter, type HubSignal } from './gestures';
import { geometry, layoutPage, shapeKey } from './layout';
import { current, effectiveFrame, handleGesture, initNav, mapRoutes, parseNav, pop, push, replaceAt, reset, type Gesture, type NavFrame, type NavState } from './nav';
import type { AreaRef, GlassesView, Intent, PageSpec, Route, StepsRoute } from './types';
import {
  alreadyThereView,
  arrivalView,
  boardView,
  errorView,
  favoriteStopRoute,
  favoritesView,
  firstRunView,
  homeView,
  loadingView,
  messageView,
  newsLines,
  newsView,
  noLocationView,
  notConfiguredView,
  nearbyView,
  placeSummary,
  placesView,
  recentKey,
  recentShown,
  stepsMessageView,
  stepsPage,
  trainView,
  type FavoriteEntry,
  type HomeData,
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

/** Double toucher sur l'accueil de Quai Web : rien à fermer. */
export const WEB_EXIT_HINT = 'Sur le web, ferme simplement l’onglet';

/** Trajet suivi et en cours (DECISIONS Q7) : clé du stockage de l'appli, écrite par les lunettes. */
export const TRIP_KEY = 'quai.trip';

const REFRESH_MS = 30_000;
const LOCATION_MS = 30_000;
/** Déjà sur place pour un lieu de « Aller à… » (1.0 : « ici », « Tu es déjà à la maison. »). */
const SAME_PLACE_M = 100;
const TOAST_MS = 2_600;
/** Retrait d'un favori : « Toucher encore : annuler » pendant 5 s (M6.1). */
const UNDO_MS = 5_000;
/** Message de reprise d'un trajet en cours (M6.5). */
const RESUME_MS = 3_000;
const CORE_TIMEOUT_MS = 20_000;
const MOVE_M = 30;
/** Fin d'un trajet en cours : arrivée plus 5 min (M6.3). */
const RUN_AFTER_MS = 5 * 60_000;
/** Fin anticipée : encore à moins de 300 m du départ après le départ du premier véhicule (M6.3). */
const NOT_LEFT_M = 300;
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
  if (ride && now >= ride.dep && here && t.origin && here.at >= ride.dep && distanceM(here, t.origin) < NOT_LEFT_M) return 'ended';
  return now >= start ? 'running' : 'before';
}

/** Lecture défensive de quai.trip. */
export function parseTrip(raw: unknown): FollowedTrip | null {
  try {
    const x = typeof raw === 'string' ? (raw ? JSON.parse(raw) : null) : raw;
    if (!x || typeof x !== 'object') return null;
    const t = x as FollowedTrip;
    const okJourney = (j: unknown): j is Journey => !!j && typeof j === 'object' && Array.isArray((j as Journey).legs) && (j as Journey).legs.length > 0 && Number.isFinite((j as Journey).arr) && typeof (j as Journey).id === 'string';
    if (t.v !== 1 || !okJourney(t.journey) || typeof t.title !== 'string' || !Number.isFinite(t.leaveAt0)) return null;
    const journeys = Array.isArray(t.journeys) ? t.journeys.filter(okJourney) : [];
    const index = journeys.findIndex((j) => j.id === t.journey.id);
    return {
      ...t,
      journeys: index >= 0 ? journeys : [t.journey],
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
    case 'favorites':
      return `favorites:${(r.exclude ?? []).join(',')}`;
    case 'steps':
      return `steps:${r.key ?? routeJourneys(r)?.[0]?.id ?? ''}`;
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

const LIVE: ReadonlySet<Route['screen']> = new Set(['home', 'nearby', 'board', 'favorites', 'steps', 'train', 'arrival']);
const USES_POSITION: ReadonlySet<string> = new Set(['nearby', 'places']);

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)) || 'Erreur inconnue';

/** Erreur au lancement (M8.6) : « Horaires injoignables : nouvel essai dans 30 s », sauf message précis du cœur. */
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
  /** Favori retiré depuis les départs, rétablissable pendant 5 s (M6.1). */
  private undo: { fav: Favorite; index: number; until: number; key: string } | null = null;
  /** Route pour laquelle l'entrée dans l'écran a été traitée (ordre figé, annulation). */
  private entered: Route | null = null;

  constructor(private d: ControllerDeps) {
    this.filter = new GestureFilter(d.web ? WEB_DEBOUNCE : DEBOUNCE);
    this.favSig = favSignature(d.settings.get());
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
   * Écran d'ouverture : bienvenue (premier lancement), message « Quai 1.1 » (une fois après la mise à jour),
   * trajet en cours repris (M6.5), sinon l'accueil (et le favori ouvert d'office selon les réglages).
   */
  private async openingNav(): Promise<{ nav: NavState; resumed: boolean }> {
    const s = this.settings();
    const seen = s.seenVersion;
    if (!seen) void this.markSeen();
    if (!s.onboarded) return { nav: initNav({ screen: 'message', kind: 'firstRun', title: 'Quai', lines: [] }), resumed: false };
    if (seen && compareVersions(seen, '1.1.0') < 0) {
      void this.markSeen();
      return { nav: initNav({ screen: 'message', kind: 'news', title: 'Quai 1.1', lines: newsLines(this.d.web) }), resumed: false };
    }
    const run = this.resumeNav(initNav({ screen: 'home' }), true);
    if (run) return { nav: run, resumed: true };
    return { nav: this.homeNav(), resumed: false };
  }

  /** Écrit la version vue (« Quai 1.1 » affiché une seule fois ; nouvelle installation : sans rien afficher). */
  private async markSeen(): Promise<void> {
    if (this.settings().seenVersion === APP_VERSION) return;
    await this.d.settings.update((x) => ({ ...x, seenVersion: APP_VERSION }));
  }

  /** Accueil, avec le favori ouvert d'office : « à moins de 300 m » (M1.7) ou « Toujours ouvrir le favori en tête ». */
  private homeNav(): NavState {
    const s = this.settings();
    const home: Route = { screen: 'home' };
    const order = this.computeOrder();
    const byId = new Map(s.favorites.map((f) => [f.id, f]));
    if (s.display.opening === 'firstFavorite') {
      const f = order.map((id) => byId.get(id)).find(Boolean);
      if (f) return reset([home, this.favoriteRoute(f)]);
    }
    if (s.display.opening === 'suggest') {
      const here = this.hereLL();
      const near = here
        ? order
            .map((id) => byId.get(id))
            .find((f): f is Favorite => {
              if (!f || f.propose !== 'near') return false;
              const p = f.kind === 'stop' ? { lat: f.lat, lon: f.lon } : endpointPoint(f.from, s);
              return !!p && distanceM(here, p) <= 300;
            })
        : undefined;
      if (near) return reset([home, this.favoriteRoute(near)]);
    }
    return initNav(home);
  }

  /** Écran d'un favori ouvert d'office : départs de l'arrêt, ou étapes du trajet (calculées sur place). */
  private favoriteRoute(f: Favorite): Route {
    if (f.kind === 'stop') return favoriteStopRoute(f);
    const s = this.settings();
    return { screen: 'steps', key: this.newKey(), label: '', title: favoriteTitle(f, s), from: f.from, to: f.to, favoriteId: f.id, follow: 'open' };
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
        // Quai Web : il n'y a rien à fermer, la page reste ouverte.
        if (this.d.web) {
          this.showToast(WEB_EXIT_HINT);
          return;
        }
        // Boîte de confirmation système ; le nettoyage se fait sur SYSTEM_EXIT_EVENT.
        void this.d.platform.glasses.exit(1);
        return;
      case 'intent':
        void this.runIntent(effect.intent);
        return;
      case 'edge':
        this.turnPage(effect.dir);
        return;
      default:
        return;
    }
  }

  private async runIntent(i: Intent): Promise<void> {
    switch (i.kind) {
      case 'open':
        this.nav = push(this.nav, i.route);
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
      case 'toast':
        this.showToast(i.text);
        return;
      case 'phone':
        if (this.d.openPhone) this.d.openPhone(i.hash);
        else this.showToast(i.text);
        return;
      case 'toggleFavoriteStop':
        await this.toggleFavoriteStop();
        return;
      case 'saveTrip':
        await this.saveTrip();
        return;
      case 'retry':
        if (this.initError) {
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

  /** Ordre intelligent du cœur (M1.4), complété par l'ordre du téléphone si le cœur en oublie. */
  private computeOrder(): string[] {
    const s = this.settings();
    let ids: string[] = [];
    try {
      ids = this.d.core.orderFavorites(this.hereLL(), s, this.answers).map((r) => r.favoriteId);
    } catch (e) {
      console.warn('[Quai] ordre des favoris', errText(e));
    }
    const known = new Set(s.favorites.map((f) => f.id));
    const out = [...new Set(ids)].filter((id) => known.has(id));
    for (const f of s.favorites) if (!out.includes(f.id)) out.push(f.id);
    return out;
  }

  /** Favoris en tête de l'accueil (2 au plus), sauf « Accueil sans favoris ». */
  private homeShown(): string[] {
    const s = this.settings();
    if (s.display.opening === 'home') return [];
    return this.validOrder(this.homeOrder ?? this.computeOrder()).slice(0, 2);
  }

  private validOrder(order: string[]): string[] {
    const known = new Set(this.settings().favorites.map((f) => f.id));
    const out = order.filter((id) => known.has(id));
    for (const f of this.settings().favorites) if (!out.includes(f.id)) out.push(f.id);
    return out;
  }

  /** Ordre de la liste : recalculé à son ouverture, sans les favoris déjà montrés sur l'accueil. */
  private computeListOrder(r: Extract<Route, { screen: 'favorites' }>): string[] {
    const exclude = new Set(r.exclude ?? []);
    return this.computeOrder().filter((id) => !exclude.has(id));
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
    const p = Promise.all([this.refreshAnswers(shown, force), this.refreshNearby(force)]).then(() => undefined);
    void p.then(() => {
      const others = this.settings().favorites.map((f) => f.id).filter((id) => !shown.includes(id));
      return this.refreshAnswers(others, false, WARM_MS);
    });
    return p;
  }

  private refreshList(force: boolean): Promise<void> {
    return this.refreshAnswers(this.listOrder ?? [], force);
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
      others: order.length - shown.length,
      noFavorites: s.display.opening === 'home',
      ...this.freshLines(),
    };
    const here = this.hereLL();
    if (!here) data.noPosition = true;
    else if (this.nearbyLight) {
      data.nearbyCount = this.nearbyLight.count;
      if (this.nearbyLight.near) data.near = this.nearbyLight.near;
    }
    const t = this.trip;
    if (t && this.tripState() === 'running') data.running = { title: t.title, next: runningNext(this.journeyOf(t.journey), this.d.clock.now()) };
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
   * Fait d'un trajet le trajet suivi. `explicit` (téléphone, « suivre ce trajet ») remplace toujours ; sinon
   * (toucher sur un favori ou un lieu) un autre trajet déjà en cours reste suivi (un ▼ machinal ou une consultation
   * ne change jamais le train suivi, R2).
   */
  private follow(j: Journey, s: { key: string; title: string; journeys: Journey[]; from?: Endpoint; to?: Endpoint; favoriteId?: string }, explicit: boolean): boolean {
    if (!explicit && this.trip && this.trip.journey.id !== j.id && this.tripState() === 'running') return false;
    const here = this.hereLL();
    const start = j.legs[0]?.from;
    const index = Math.max(0, s.journeys.findIndex((x) => x.id === j.id));
    this.trip = {
      v: 1,
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
    return true;
  }

  /** « Trajet suivi : IC 08:42 » : la proposition affichée devient le trajet suivi (M2.4). */
  private followShown(): void {
    const r = current(this.nav).route;
    if (r.screen !== 'steps') return;
    const list = routeJourneys(r);
    if (!list?.length) return;
    const j = this.journeyOf(list[Math.min(r.index ?? 0, list.length - 1)]);
    if (!j.legs.some(isRide)) return;
    this.follow(j, { key: r.key ?? routeKey(r), title: this.stepsTitle(r), journeys: list, from: r.from, to: r.to, favoriteId: r.favoriteId }, true);
    this.showToast(`Trajet suivi${NB}: ${tripShort(j, this.d.clock.now())}`);
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
   * (l'écran revient au trajet suivi si l'on regardait une autre proposition), retour aux étapes à la descente,
   * aide à l'arrivée 3 min avant une arrivée en gare.
   */
  private track(): void {
    const t = this.trip;
    if (!t || !this.ready) return;
    const j = this.journeyOf(t.journey);
    const f = current(this.nav);
    const r = f.route;
    const now = this.d.clock.now();
    if (r.screen === 'steps' && (r.key ?? '') === t.key) {
      const i = rideInProgress(j, now);
      const arrival = arrivalDue(j, now) && !this.autoDone.has(`arrival:${j.id}`);
      const train = i >= 0 && !this.autoDone.has(`train:${j.id}:${i}`);
      if (!train && !arrival) return;
      let nav = this.nav;
      if ((r.index ?? 0) !== t.index || routeJourneys(r)?.[r.index ?? 0]?.id !== j.id) {
        const list = (routeJourneys(r) ?? []).map((x) => (x.id === j.id ? j : x));
        const idx = list.findIndex((x) => x.id === j.id);
        nav = replaceAt(nav, { ...r, journeys: idx >= 0 ? list : [j], index: Math.max(0, idx) }, 0, true);
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

  /** Toucher sur un favori : départs de l'arrêt, ou étapes du trajet proposé (sa réponse, si elle est prête). */
  private async openFavorite(id: string): Promise<void> {
    const s = this.settings();
    const f = s.favorites.find((x) => x.id === id);
    if (!f) return;
    if (f.kind === 'stop') {
      this.nav = push(this.nav, favoriteStopRoute(f));
      await this.onRouteChanged();
      return;
    }
    // Le trajet en cours de ce favori : le reprendre plutôt que d'en proposer un autre depuis le train.
    if (this.trip?.favoriteId === f.id && this.tripState() === 'running') {
      const nav = this.resumeNav(this.nav, false);
      if (nav) {
        this.nav = nav;
        await this.onRouteChanged();
        return;
      }
    }
    const title = favoriteTitle(f, s);
    const a = this.answers.get(id);
    if (a?.state === 'here') {
      this.nav = push(this.nav, { screen: 'message', kind: 'info', title, lines: [alreadyText(title)] });
      await this.onRouteChanged();
      return;
    }
    const j0 = a?.state === 'ok' ? a.plan?.journeys[0] : undefined;
    const ready = !!j0 && this.d.clock.now() - (this.answerAt.get(id) ?? 0) < 2 * REFRESH_MS && catchable(j0, this.d.clock.now());
    await this.openSteps({ title, from: f.from, to: f.to, favoriteId: f.id, journeys: ready && a?.plan ? a.plan.journeys : undefined, follow: 'open' });
  }

  /** Toucher sur un lieu ou une adresse récente de « Aller à… » : étapes directement (CA-M2.4). */
  private async goTo(key: string, to: Endpoint, label: string): Promise<void> {
    const title = towards(label);
    const here = this.hereLL();
    const point = endpointPoint(to, this.settings());
    if (here && point && distanceM(here, point) <= SAME_PLACE_M) {
      this.nav = push(this.nav, { screen: 'message', kind: 'info', title, lines: [alreadyText(title)] });
      await this.onRouteChanged();
      return;
    }
    const hit = this.cache.get('places');
    const res = hit?.ok ? (hit.value as Record<string, PlaceData>)[key]?.result : undefined;
    const fresh = hit?.ok && this.d.clock.now() - hit.at < 2 * REFRESH_MS;
    const journeys = fresh && res?.journeys.length && catchable(res.journeys[0], this.d.clock.now()) ? res.journeys : undefined;
    await this.openSteps({ title, from: { type: 'here' }, to, journeys, follow: 'open' });
  }

  /** Ouvre « Trajet proposé » sur la proposition 1 (calculée sur place si besoin), qui devient le trajet suivi. */
  private async openSteps(o: { title: string; from: Endpoint; to: Endpoint; favoriteId?: string; journeys?: Journey[]; follow: 'open' | 'phone' }): Promise<void> {
    const route: StepsRoute = { screen: 'steps', key: this.newKey(), label: '', title: o.title, from: o.from, to: o.to, follow: o.follow };
    if (o.favoriteId) route.favoriteId = o.favoriteId;
    if (o.journeys?.length) {
      route.journeys = o.journeys;
      route.index = 0;
      delete route.follow;
      this.follow(o.journeys[0], { key: route.key!, title: o.title, journeys: o.journeys, from: o.from, to: o.to, favoriteId: o.favoriteId }, o.follow === 'phone');
    }
    this.nav = push(this.nav, route);
    await this.onRouteChanged();
  }

  /** ▼ au bout des étapes : proposition suivante ; ▲ en haut : la précédente (affichée par sa fin). */
  private turnPage(dir: 'up' | 'down'): void {
    const r = current(this.nav).route;
    if (r.screen !== 'steps') return;
    const list = routeJourneys(r);
    if (!list?.length) return;
    const i = Math.min(r.index ?? 0, list.length - 1) + (dir === 'down' ? 1 : -1);
    // ▼ sur la dernière proposition (DECISIONS § 7) : rien de plus, on le dit (la ligne du bas reste « ▲ trajet précédent »).
    if (i >= list.length && list.length > 1) this.showToast('Pas d’autre trajet pour l’instant');
    if (i < 0 || i >= list.length) return;
    const next: StepsRoute = { ...r, journeys: list, index: i };
    delete next.journey;
    this.nav = replaceAt(this.nav, next, dir === 'down' ? 0 : 999);
    void this.render();
    // La proposition affichée se met à jour en direct (retards, voies).
    if (!this.journeysById.has(list[i].id)) void this.load(next, true);
  }

  /* ------------------------------ Départs : favori annulable ------------------------------ */

  private showToast(text: string, ms = TOAST_MS): void {
    this.toast = { text, until: this.d.clock.now() + ms, route: routeKey(current(this.nav).route) };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      if (this.toast && this.toast.until <= this.d.clock.now()) this.toast = null;
      void this.render();
    }, Math.max(50, this.d.clock.real(ms)));
    void this.render();
  }

  private boardFavorite(r: Extract<Route, { screen: 'board' }>): Favorite | undefined {
    const hit = this.cache.get(routeKey(r));
    const area = hit?.ok ? (hit.value as { board: { area: { id: string; aka?: string[] } } }).board.area : undefined;
    return this.settings().favorites.find((f) => f.kind === 'stop' && (f.areaId === r.areaId || f.areaId === area?.id || !!area?.aka?.includes(f.areaId)));
  }

  /**
   * Toucher sur les départs (M6.1, M6.2) : favori retiré avec « ★ Retiré. Toucher encore : annuler » (5 s) ; un toucher
   * pendant ces 5 s le rétablit à l'identique (même identifiant, filtre, réglage, place) ; sinon ajout (1.0).
   */
  private async toggleFavoriteStop(): Promise<void> {
    const r = current(this.nav).route;
    if (r.screen !== 'board') return;
    const key = routeKey(r);
    const now = this.d.clock.now();
    const u = this.undo;
    if (u && u.key === key && now < u.until) {
      this.undo = null;
      await this.d.settings.update((x) => {
        if (x.favorites.some((f) => f.id === u.fav.id)) return x;
        const favorites = [...x.favorites];
        favorites.splice(Math.min(u.index, favorites.length), 0, u.fav);
        return { ...x, favorites };
      });
      this.showToast('★ Favori rétabli');
      return;
    }
    const existing = this.boardFavorite(r);
    if (existing) {
      const s = this.settings();
      const index = s.favorites.findIndex((f) => f.id === existing.id);
      await this.d.settings.update((x) => ({ ...x, favorites: x.favorites.filter((f) => f.id !== existing.id) }));
      this.undo = { fav: structuredClone(existing), index, until: this.d.clock.now() + UNDO_MS, key };
      this.showToast(`★ Retiré. Toucher encore${NB}: annuler`, UNDO_MS);
      return;
    }
    this.undo = null;
    const hit = this.cache.get(key);
    const board = hit?.ok ? (hit.value as { board: { area: { id: string; op: FavoriteStop['op']; n: FavoriteStop['name']; lat: number; lon: number } } }).board : null;
    if (!board) return;
    const s = this.settings();
    const fav: FavoriteStop = {
      kind: 'stop',
      id: newId('fav', s.favorites.map((f) => f.id)),
      areaId: board.area.id,
      op: board.area.op,
      name: board.area.n,
      lat: board.area.lat,
      lon: board.area.lon,
      propose: 'never',
    };
    if (r.filter?.length) fav.filter = r.filter;
    await this.d.settings.update((x) => ({ ...x, favorites: [...x.favorites, fav] }));
    this.showToast('★ Ajouté aux favoris');
  }

  /** « ★ garder ce trajet » (aide à l'arrivée) : trajet favori de gare à gare, ou départ et arrivée du trajet suivi. */
  private async saveTrip(): Promise<void> {
    const r = current(this.nav).route;
    if (r.screen !== 'arrival') return;
    const s = this.settings();
    let from: Endpoint | undefined;
    let to: Endpoint | undefined;
    if (r.trip) {
      from = { type: 'area', ...r.trip.from };
      to = { type: 'area', ...r.trip.to };
    } else if (this.trip && this.trip.journey.id === r.journey.id && this.trip.from && this.trip.to) {
      if (this.trip.favoriteId && s.favorites.some((f) => f.id === this.trip?.favoriteId)) {
        this.showToast('★ Déjà dans les favoris');
        return;
      }
      from = this.trip.from;
      to = this.trip.to;
    }
    if (!from || !to) return;
    const same = (a: Endpoint, b: Endpoint): boolean => JSON.stringify(a) === JSON.stringify(b);
    if (s.favorites.some((f) => f.kind === 'trip' && same(f.from, from!) && same(f.to, to!))) {
      this.showToast('★ Déjà dans les favoris');
      return;
    }
    const fav: FavoriteTrip = { kind: 'trip', id: newId('fav', s.favorites.map((f) => f.id)), from, to, propose: 'never' };
    await this.d.settings.update((x) => ({ ...x, favorites: [...x.favorites, fav] }));
    this.showToast('★ Trajet ajouté aux favoris');
  }

  /* ------------------------------ Téléphone (GlassesApi) ------------------------------ */

  /**
   * Bouton « Lunettes » d'une carte ou d'un favori (M2.9, S8) : le trajet `index` s'affiche sur l'écran des étapes et
   * devient le trajet suivi, même de gare à gare. Rend le message affiché à côté du bouton.
   */
  async showTrip(req: TripRequest): Promise<string> {
    const journeys = req.result.journeys;
    const index = Math.min(Math.max(0, req.index), Math.max(0, journeys.length - 1));
    const j = journeys[index];
    const route: StepsRoute = { screen: 'steps', key: this.newKey(), label: '', title: req.title, from: req.from, to: req.to };
    if (req.favoriteId) route.favoriteId = req.favoriteId;
    if (j) {
      route.journeys = journeys;
      route.index = index;
      this.follow(j, { key: route.key!, title: req.title, journeys, from: req.from, to: req.to, favoriteId: req.favoriteId }, true);
    } else {
      route.follow = 'phone';
    }
    await this.showNav(reset([{ screen: 'home' }, route]), route);
    return j ? shownMessage(j, this.d.clock.now()) : 'Affiché dans les lunettes.';
  }

  /** Bouton « Lunettes » d'un arrêt favori (S8) : ses départs. */
  async showBoard(areaId: string, filter?: LineFilter[]): Promise<string> {
    const s = this.settings();
    const fav = s.favorites.find((f): f is FavoriteStop => f.kind === 'stop' && f.areaId === areaId);
    const route: Route = { screen: 'board', areaId };
    if (filter?.length) route.filter = filter;
    if (fav) route.name = fav.name;
    await this.showNav(reset([{ screen: 'home' }, route]), route);
    let name = fav ? displayName(fav.name, s.lang) : '';
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
      this.follow(j, { key: steps.key!, title: steps.title!, journeys: [j] }, true);
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
    // Les données dépendent du nombre de départs, du rayon, des favoris : on recharge. L'écran courant
    // garde ses données pendant le rechargement (pas d'écran d'attente), les autres sont oubliés.
    const r = current(this.nav).route;
    const keep = routeKey(r);
    for (const k of [...this.cache.keys()]) if (k !== keep && !k.startsWith('steps:') && !k.startsWith('train:')) this.cache.delete(k);
    this.nearbyLight = null;
    const sig = favSignature(s);
    if (sig !== this.favSig) {
      this.favSig = sig;
      // Favoris ajoutés, retirés ou réordonnés sur le téléphone : l'ordre affiché suit.
      if (r.screen === 'home') this.homeOrder = this.computeOrder();
      if (r.screen === 'favorites') this.listOrder = this.computeListOrder(r);
    }
    if (r.screen === 'message' && r.kind === 'firstRun' && s.onboarded && this.ready) {
      this.nav = this.homeNav();
      void this.render();
      return;
    }
    if (!this.ready) return;
    if (r.screen === 'home') void this.refreshHome(true);
    else if (r.screen === 'favorites') void this.refreshList(true);
    else if (LIVE.has(r.screen) || r.screen === 'places') void this.load(r, true);
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
    if (this.initError) {
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
        return { list: await core.nearby(here.lat, here.lon, s.display.radiusM) };
      }
      case 'board': {
        const board = await core.board(r.areaId, { limit: s.display.depsPerStop, filter: r.filter });
        let works: string[] = [];
        const isFav = s.favorites.some((f) => f.kind === 'stop' && (f.areaId === r.areaId || f.areaId === board.area.id));
        if (s.alerts.works && isFav) {
          try {
            works = await core.works(board.area.op, board.area.lines, [board.area.id]);
          } catch {
            works = [];
          }
        }
        return { board, works };
      }
      case 'places':
        return this.fetchPlaces(r);
      case 'steps':
        return this.fetchSteps(r);
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

  /** « Aller à… » : un trajet par lieu et par adresse récente (S4), affichés au fur et à mesure. */
  private async fetchPlaces(r: Route): Promise<Record<string, PlaceData>> {
    const s = this.settings();
    const now = this.d.clock.now();
    const here = this.hereLL();
    const targets: { key: string; to: Endpoint; lat: number; lon: number }[] = [
      ...s.places.map((p) => ({ key: p.id, to: { type: 'place', placeId: p.id } as Endpoint, lat: p.lat, lon: p.lon })),
      ...recentShown(s).map((a) => ({ key: recentKey(a.label), to: { type: 'address', label: a.label, lat: a.lat, lon: a.lon } as Endpoint, lat: a.lat, lon: a.lon })),
    ];
    const out: Record<string, PlaceData> = {};
    await this.progressive(r, targets, async (t) => {
      if (here && distanceM(here, t) <= SAME_PLACE_M) {
        out[t.key] = { summary: 'ici', result: { journeys: [], empty: 'here' } }; // le cœur ne propose rien sur place
        return { ...out };
      }
      if (!here) {
        out[t.key] = { summary: '' };
        return { ...out };
      }
      const result = await this.d.core.route({ type: 'here' }, t.to, now, s, here).catch(() => null);
      out[t.key] = { summary: result ? (result.empty === 'here' ? 'ici' : placeSummary(result.journeys, now)) : '', ...(result ? { result } : {}) };
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

  /** Propositions calculées : elles s'inscrivent dans la route (même si l'on regarde ailleurs) ; la 1re est suivie. */
  private attachJourneys(r: StepsRoute, journeys: Journey[]): void {
    const key = r.key;
    this.nav = mapRoutes(this.nav, (x) => (x.screen === 'steps' && x.key === key && !x.journeys ? { ...x, journeys, index: 0, follow: undefined } : x));
    if (r.follow) {
      const j = journeys[0];
      this.follow(j, { key: key ?? routeKey(r), title: this.stepsTitle(r), journeys, from: r.from, to: r.to, favoriteId: r.favoriteId }, r.follow === 'phone');
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
      this.homeOrder = this.computeOrder();
      this.checkTrip();
      if (this.ready) void this.refreshHome(false);
    } else if (r.screen === 'favorites') {
      this.listOrder = this.computeListOrder(r);
      if (this.ready) void this.refreshList(false);
    }
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
          return newsView(ctx);
        case 'error':
          return errorView(r.title, r.lines.join(' '), ctx, { root: this.nav.stack.length === 1 });
        case 'loading':
          return messageView(r.title, r.lines, ctx);
        default:
          return messageView(r.title, r.lines, ctx, { hints: HINTS.message });
      }
    }
    if (r.screen === 'home') return homeView(this.homeData(), ctx);
    if (r.screen === 'favorites') {
      const entries = (this.listOrder ?? this.computeListOrder(r)).map((id) => this.entry(id)).filter((e): e is FavoriteEntry => !!e);
      return favoritesView({ entries, title: r.exclude?.length ? 'Autres favoris' : 'Mes favoris' }, ctx);
    }
    if (r.screen === 'steps' && routeJourneys(r)) return this.stepsViewOf(r, f, ctx);
    const key = routeKey(r);
    const hit = this.cache.get(key);
    if (!hit) void this.load(r);
    if (hit && !hit.ok) return errorView(titleFor(r, ctx), hit.error, ctx);
    const value = hit?.ok ? hit.value : undefined;
    switch (r.screen) {
      case 'nearby': {
        if (!value) return loadingView('Autour de moi', 'Recherche des arrêts…', ctx);
        const v = value as { list?: NearbyItem[]; noLocation?: boolean };
        if (v.noLocation) return noLocationView('Autour de moi', ctx);
        return nearbyView(v.list ?? [], ctx);
      }
      case 'board': {
        const waiting = r.name ? displayName(r.name, ctx.settings.lang) : 'Départs';
        if (!value) return loadingView(waiting, 'Chargement des départs…', ctx);
        const { board, works } = value as { board: Parameters<typeof boardView>[0]; works: string[] };
        const s = ctx.settings;
        const isFavorite = s.favorites.some((x) => x.kind === 'stop' && (x.areaId === r.areaId || x.areaId === board.area.id || !!board.area.aka?.includes(x.areaId)));
        const v = boardView(board, ctx, { isFavorite });
        if (!v.top && works?.[0]) v.top = { text: `! ${works[0]}`, strong: true };
        return v;
      }
      case 'places':
        return placesView(Object.fromEntries(Object.entries((value as Record<string, PlaceData>) ?? {}).map(([k, p]) => [k, p.summary])), ctx);
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
    return stepsPage(r, { journeys, index, followedId: followed, leaveAt0: followed ? t?.leaveAt0 : undefined, top: f.top, fresh: f.fresh }, ctx);
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
    const g = geometry(view);
    const frame = effectiveFrame(current(this.nav), view, g.capacity);
    const now = this.d.clock.now();
    const toast = this.toast && this.toast.until > now && this.toast.route === routeKey(current(this.nav).route) ? this.toast.text : undefined;
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

  snapshot(): Record<string, unknown> {
    return { v: 2, nav: this.nav, clock: this.d.clock.snapshot(), here: this.here, trip: this.trip, savedAt: Date.now() };
  }

  restore(snap: unknown): void {
    try {
      const s = (typeof snap === 'string' ? JSON.parse(snap) : snap) as { nav?: unknown; clock?: { now: number }; here?: Fix | null; trip?: unknown };
      if (!s || typeof s !== 'object') return;
      const nav = parseNav(s.nav);
      if (s.clock) this.d.clock.restore(s.clock);
      if (s.here && Number.isFinite(s.here.lat) && Number.isFinite(s.here.lon)) this.here = s.here;
      const trip = s.trip === undefined ? undefined : parseTrip(s.trip);
      if (trip !== undefined) {
        this.trip = trip;
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

/** Résultat d'un lieu de « Aller à… » : son résumé et ses propositions (réutilisées par le toucher). */
interface PlaceData {
  summary: string;
  result?: PlanResult;
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
      return 'Mes favoris';
    case 'places':
      return 'Aller à…';
    case 'board':
      return r.name ? displayName(r.name, ctx.settings.lang) : 'Départs';
    case 'steps':
      return r.title || towards(r.label);
    default:
      return 'Quai';
  }
}

export type { Endpoint };
