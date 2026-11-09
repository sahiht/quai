/**
 * Contrôleur des lunettes : état de navigation, chargement des données du cœur, rendu
 * (createStartUpPageContainer, puis rebuildPageContainer quand la forme change, sinon
 * textContainerUpgrade), gestes, minuteries (temps réel 30 s, position 30 s, horloge), arrière-plan.
 */
import type { Core, Departure, Endpoint, FavoriteStop, FavoriteTrip, Journey, Meta, NearbyItem, Settings, Suggestion } from '../core/api';
import { displayName, distanceM, hhmm, mainMode } from '../core/util';
import type { Clock } from '../platform/clock';
import { deadline } from '../platform/queue';
import type { Fix, Platform } from '../platform/types';
import { newId, type SettingsStore } from '../settings';
import { dayWord, platformText, vehicleOf, delaySuffix, nextText } from './format';
import { GestureFilter, type HubSignal } from './gestures';
import { geometry, layoutPage, shapeKey } from './layout';
import { current, effectiveFrame, handleGesture, initNav, parseNav, pop, push, replace, reset, updateRoute, type Gesture, type NavState } from './nav';
import type { GlassesView, Intent, PageSpec, Route } from './types';
import {
  alreadyThereView,
  arrivalView,
  boardView,
  errorView,
  favoriteRoute,
  favoritesView,
  firstRunView,
  homeView,
  journeysView,
  loadingView,
  messageView,
  nearbyView,
  notConfiguredView,
  placeSummary,
  placesView,
  stepsView,
  suggestionRoute,
  trainView,
  tripView,
  type FavoriteNext,
  type HomeData,
  type ViewCtx,
} from './views';
import { HINTS, NB } from './format';

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
}

const REFRESH_MS = 30_000;
const LOCATION_MS = 30_000;
/** Déjà sur place : même seuil que le cœur, qui ne propose aucun trajet à moins de 100 m. */
const SAME_PLACE_M = 100;
const TOAST_MS = 2_600;
const CORE_TIMEOUT_MS = 20_000;
const MOVE_M = 30;

type Loaded = { ok: true; value: unknown; at: number } | { ok: false; error: string; at: number };

/** Clé de cache des données d'un écran. */
export function routeKey(r: Route): string {
  switch (r.screen) {
    case 'board':
      return `board:${r.areaId}:${JSON.stringify(r.filter ?? [])}`;
    case 'trip':
      return `trip:${r.from.areaId}>${r.to.areaId}`;
    case 'journeys':
      return `journeys:${JSON.stringify(r.from)}>${JSON.stringify(r.to)}`;
    case 'steps':
      return `steps:${r.journey.id}`;
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

const LIVE: ReadonlySet<Route['screen']> = new Set(['home', 'nearby', 'board', 'favorites', 'trip', 'journeys', 'steps', 'train', 'arrival']);
const USES_POSITION: ReadonlySet<Route['screen']> = new Set(['home', 'nearby', 'places', 'journeys']);

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)) || 'Erreur inconnue';

export class GlassesController {
  private nav: NavState = initNav({ screen: 'message', kind: 'loading', title: 'Quai', lines: ['Chargement…'] });
  private cache = new Map<string, Loaded>();
  private loading = new Map<string, Promise<void>>();
  private page: PageSpec | null = null;
  private view: GlassesView | null = null;
  private capacity = 1;
  private filter = new GestureFilter();
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
  private suggestion: Suggestion | null | undefined = undefined;
  private autoDone = new Set<string>();
  private lastLog = '';
  private unsubscribe: (() => void) | null = null;
  private pendingRestore: NavState | null = null;

  constructor(private d: ControllerDeps) {
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
      this.initPromise = deadline(this.d.core.init(), CORE_TIMEOUT_MS, `Pas de réseau${NB}: horaires injoignables.`).then(
        (meta) => {
          this.meta = meta;
          this.initError = null;
          this.fresh = this.d.freshness(meta, this.d.clock.now());
          return meta;
        },
        (e) => {
          this.initPromise = null;
          this.initError = errText(e);
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
      this.initError = errText(e);
      this.nav = initNav({ screen: 'message', kind: 'error', title: 'Quai', lines: [this.initError] });
      this.ready = true;
      await this.render(true);
      this.startTimers();
      this.log('QUAI_READY');
      return;
    }
    this.here = await this.d.platform.location.current(5000);
    if (this.pendingRestore) {
      this.nav = this.pendingRestore;
      this.pendingRestore = null;
    } else {
      this.nav = await this.openingNav();
    }
    this.ready = true;
    await this.render(true);
    this.startTimers();
    this.log('QUAI_READY');
  }

  /** Écran d'ouverture selon les réglages (SPEC § 5.1, « Suggestion à l'ouverture »). */
  private async openingNav(): Promise<NavState> {
    const s = this.settings();
    if (!s.onboarded) return initNav({ screen: 'message', kind: 'firstRun', title: 'Quai', lines: [] });
    return this.homeNav();
  }

  private async homeNav(): Promise<NavState> {
    const s = this.settings();
    await this.loadSuggestion();
    const fav0 = s.favorites[0];
    if (s.display.opening === 'firstFavorite' && fav0) {
      return reset([{ screen: 'home' }, favoriteRoute(fav0, s)]);
    }
    if (s.display.opening === 'suggest' && this.suggestion?.autoOpen) {
      const r = suggestionRoute(this.suggestion, s);
      if (r) return reset([{ screen: 'home' }, r]);
    }
    return initNav({ screen: 'home' });
  }

  private async loadSuggestion(): Promise<void> {
    try {
      const here = this.here ? { lat: this.here.lat, lon: this.here.lon } : null;
      this.suggestion = await deadline(this.d.core.suggest(here, this.settings()), 8000, 'suggestion trop lente');
    } catch (e) {
      console.warn('[Quai] suggestion', errText(e));
      this.suggestion = null;
    }
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
        // Boîte de confirmation système ; le nettoyage se fait sur SYSTEM_EXIT_EVENT.
        void this.d.platform.glasses.exit(1);
        return;
      case 'intent':
        void this.runIntent(effect.intent);
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
      case 'toast':
        this.showToast(i.text);
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
      case 'continue':
        this.nav = await this.homeNav();
        await this.onRouteChanged();
        return;
    }
  }

  /** Après un changement d'écran : afficher tout de suite, rafraîchir si les données sont anciennes. */
  private async onRouteChanged(): Promise<void> {
    const r = current(this.nav).route;
    const hit = this.cache.get(routeKey(r));
    if (hit && LIVE.has(r.screen) && this.d.clock.now() - hit.at > REFRESH_MS / 2) void this.load(r, true);
    await this.render();
  }

  /* ------------------------------ Actions ------------------------------ */

  private showToast(text: string): void {
    this.toast = { text, until: Date.now() + TOAST_MS, route: routeKey(current(this.nav).route) };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = null;
      void this.render();
    }, TOAST_MS);
    void this.render();
  }

  private async toggleFavoriteStop(): Promise<void> {
    const r = current(this.nav).route;
    if (r.screen !== 'board') return;
    const hit = this.cache.get(routeKey(r));
    const board = hit?.ok ? (hit.value as { board: { area: { id: string; op: FavoriteStop['op']; n: FavoriteStop['name']; lat: number; lon: number } } }).board : null;
    const s = this.settings();
    const existing = s.favorites.find((f) => f.kind === 'stop' && f.areaId === r.areaId);
    if (existing) {
      await this.d.settings.update((x) => ({ ...x, favorites: x.favorites.filter((f) => f.id !== existing.id) }));
      this.showToast('★ Retiré des favoris');
      return;
    }
    if (!board) return;
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

  private async saveTrip(): Promise<void> {
    const r = current(this.nav).route;
    if (r.screen !== 'arrival' || !r.trip) return;
    const s = this.settings();
    const { from, to } = r.trip;
    const exists = s.favorites.some((f) => f.kind === 'trip' && f.from.type === 'area' && f.to.type === 'area' && f.from.areaId === from.areaId && f.to.areaId === to.areaId);
    if (exists) {
      this.showToast('★ Déjà dans les favoris');
      return;
    }
    const fav: FavoriteTrip = {
      kind: 'trip',
      id: newId('fav', s.favorites.map((f) => f.id)),
      from: { type: 'area', ...from },
      to: { type: 'area', ...to },
      propose: 'never',
    };
    await this.d.settings.update((x) => ({ ...x, favorites: [...x.favorites, fav] }));
    this.showToast('★ Trajet ajouté aux favoris');
  }

  /** Affiche un écran demandé par le téléphone (« Afficher dans les lunettes »). */
  async show(route: Route): Promise<void> {
    this.nav = reset([{ screen: 'home' }, route]);
    this.cache.delete(routeKey(route));
    this.forceNext = true;
    if (this.ready) await this.onRouteChanged();
  }

  private onSettingsChanged(): void {
    // Les données dépendent du nombre de départs, du rayon, des favoris : on recharge. L'écran courant
    // garde ses données pendant le rechargement (pas d'écran d'attente), les autres sont oubliés.
    const r = current(this.nav).route;
    const keep = routeKey(r);
    for (const k of [...this.cache.keys()]) if (k !== keep && !k.startsWith('steps:') && !k.startsWith('train:')) this.cache.delete(k);
    if (this.ready && (LIVE.has(r.screen) || r.screen === 'places')) void this.load(r, true);
    if (r.screen === 'message' && r.kind === 'firstRun' && this.settings().onboarded && this.ready) {
      void this.homeNav().then((n) => {
        this.nav = n;
        void this.render();
      });
      return;
    }
    if (this.ready) void this.render();
  }

  /* ------------------------------ Données ------------------------------ */

  private settings(): Settings {
    return this.d.settings.get();
  }

  /**
   * Suggestion affichée sur l'accueil : pas celle qui s'est ouverte d'elle-même (favori à moins de 300 m,
   * maquette Visite2 : l'accueil montre alors « Près de … »).
   */
  private homeSuggestion(): Suggestion | null | undefined {
    const s = this.suggestion;
    if (s?.autoOpen && this.settings().display.opening === 'suggest') return null;
    return s;
  }

  /** Ligne de fraîcheur des horaires pour l'accueil (dataFreshness). */
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
    return ctx;
  }

  private hereLL(): { lat: number; lon: number } | null {
    return this.here ? { lat: this.here.lat, lon: this.here.lon } : null;
  }

  private async updateLocation(): Promise<void> {
    if (this.paused || this.stopped) return;
    const prev = this.here;
    const fix = await this.d.platform.location.current(8000);
    if (!fix) return;
    this.here = fix;
    const moved = !prev || distanceM(prev, fix) > MOVE_M;
    if (!moved) return;
    for (const k of [...this.cache.keys()]) if (USES_POSITION.has(k.split(':')[0] as Route['screen'])) this.cache.delete(k);
    const r = current(this.nav).route;
    if (USES_POSITION.has(r.screen)) await this.render();
  }

  /** Rafraîchissement périodique de l'écran courant (temps réel). */
  async refreshCurrent(force = false): Promise<void> {
    if (this.paused || this.stopped || !this.ready) return;
    if (this.initError) {
      await this.boot();
      return;
    }
    const r = current(this.nav).route;
    this.autoAdvance();
    if (LIVE.has(r.screen) || force) {
      if (r.screen === 'home') await this.loadSuggestion();
      await this.load(r, true);
    }
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
        this.autoAdvance();
        await this.render();
      }
    })();
    this.loading.set(key, p);
    return p;
  }

  private async fetch(r: Route): Promise<unknown> {
    const core = this.d.core;
    const s = this.settings();
    const now = this.d.clock.now();
    switch (r.screen) {
      case 'home': {
        const data: HomeData = { suggestion: this.homeSuggestion(), ...this.freshLines() };
        const here = this.hereLL();
        if (here) {
          const list = await core.nearby(here.lat, here.lon, s.display.radiusM);
          data.nearbyCount = list.length;
          data.near = nearLabel(list, s);
        }
        return data;
      }
      case 'nearby': {
        const here = this.hereLL() ?? (await this.d.platform.location.current(6000));
        if (!here) return { noLocation: true };
        return { list: await core.nearby(here.lat, here.lon, s.display.radiusM) };
      }
      case 'board': {
        const board = await core.board(r.areaId, { limit: s.display.depsPerStop, filter: r.filter });
        let works: string[] = [];
        const isFav = s.favorites.some((f) => f.kind === 'stop' && f.areaId === r.areaId);
        if (s.alerts.works && isFav) {
          try {
            works = await core.works(board.area.op, board.area.lines, [board.area.id]);
          } catch {
            works = [];
          }
        }
        return { board, works };
      }
      case 'favorites': {
        const out: Record<string, FavoriteNext | null> = {};
        await this.progressive(r, s.favorites, async (f) => {
          out[f.id] = await this.favoriteNext(f, now).catch(() => null);
          return { ...out };
        });
        return out;
      }
      case 'trip':
        return core.trains(r.from.areaId, r.to.areaId, now, 3);
      case 'places': {
        const out: Record<string, string> = {};
        const here = this.hereLL();
        await this.progressive(r, s.places, async (p) => {
          if (here && distanceM(here, p) <= SAME_PLACE_M) {
            out[p.id] = 'ici'; // le cœur ne renvoie aucun trajet : ne pas afficher « aucun trajet »
            return { ...out };
          }
          const js = here ? await core.plan({ type: 'here' }, { type: 'place', placeId: p.id }, now, s, here).catch(() => null) : null;
          out[p.id] = here ? placeSummary(js, now) : '';
          return { ...out };
        });
        return out;
      }
      case 'journeys': {
        const needsHere = r.from.type === 'here' || r.to.type === 'here';
        const here = this.hereLL() ?? (needsHere ? await this.d.platform.location.current(6000) : null);
        if (needsHere && !here) return { noLocation: true };
        const to = r.to;
        const place = to.type === 'place' ? s.places.find((p) => p.id === to.placeId) : undefined;
        if (r.from.type === 'here' && here && place && distanceM(here, place) <= SAME_PLACE_M) return { already: true };
        return { journeys: await core.plan(r.from, r.to, now, s, here ?? undefined) };
      }
      case 'steps':
      case 'train':
        return core.refresh(this.journeyOf(r) ?? r.journey, s);
      case 'arrival':
        return this.arrivalDepartures(r);
      default:
        return null;
    }
  }

  /**
   * Charge une liste élément par élément (3 à la fois) et affiche les résultats au fur et à mesure,
   * sans attendre le dernier (favoris, lieux).
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

  private async favoriteNext(f: Settings['favorites'][number], now: number): Promise<FavoriteNext | null> {
    const core = this.d.core;
    const s = this.settings();
    if (f.kind === 'stop') {
      const b = await core.board(f.areaId, { limit: 1, filter: f.filter });
      const d = b.departures[0];
      return d ? { text: nextText(d, now, s.display.markPlanned), planned: !d.rt && !d.cancelled } : null;
    }
    let js: Journey[];
    if (f.from.type === 'area' && f.to.type === 'area' && f.from.op === 'sncb' && f.to.op === 'sncb') {
      js = await core.trains(f.from.areaId, f.to.areaId, now, 1);
    } else {
      const here = this.hereLL();
      if ((f.from.type === 'here' || f.to.type === 'here') && !here) return null;
      js = await core.plan(f.from, f.to, now, s, here ?? undefined);
    }
    const j = js[0];
    const ride = j?.legs.find((l) => l.kind === 'ride');
    if (!j || !ride) return j ? { text: 'à pied', planned: false } : null;
    const mark = !ride.rt && s.display.markPlanned ? '~' : '';
    const day = dayWord(ride.schedDep, now);
    if (day) return { text: `${vehicleOf(ride)} ${mark}${day} ${hhmm(ride.schedDep)}`, planned: !ride.rt };
    const plat = ride.mode === 'train' ? platformText(ride.platform, ride.newPlatform, true) : '';
    return { text: `${vehicleOf(ride)} ${mark}${hhmm(ride.schedDep)}${delaySuffix(ride.delayMin)}${plat ? ' ' + plat : ''}`, planned: !ride.rt };
  }

  private async arrivalDepartures(r: Extract<Route, { screen: 'arrival' }>): Promise<{ deps: Departure[] }> {
    const j = this.journeyOf(r) ?? r.journey;
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

  /** Dernière version connue (rafraîchie) du trajet d'un écran de suivi. */
  private journeyOf(r: Route): Journey | null {
    if (r.screen !== 'steps' && r.screen !== 'train' && r.screen !== 'arrival') return null;
    for (const key of [`train:${r.journey.id}:${'leg' in r ? r.leg : ''}`, `steps:${r.journey.id}`]) {
      const hit = this.cache.get(key);
      if (hit?.ok) return hit.value as Journey;
    }
    return r.journey;
  }

  /* ------------------------------ Suivi automatique ------------------------------ */

  /**
   * Étapes → « Dans le train » au départ du train ; trains A ▶ B → train sélectionné à son départ ;
   * dans le train → aide à l'arrivée 3 min avant (trajet vers une gare), ou retour aux étapes à la descente.
   */
  private autoAdvance(): void {
    const f = current(this.nav);
    const r = f.route;
    const now = this.d.clock.now();
    if (r.screen === 'steps') {
      const j = this.journeyOf(r) ?? r.journey;
      const i = j.legs.findIndex((l) => l.kind === 'ride');
      const leg = j.legs[i];
      const key = `train:${j.id}:${i}`;
      if (leg && !leg.cancelled && now >= leg.dep && now < leg.arr && !this.autoDone.has(key)) {
        this.autoDone.add(key);
        this.nav = push(this.nav, { screen: 'train', journey: j, leg: i, label: r.label, auto: true });
      }
      return;
    }
    if (r.screen === 'trip') {
      const hit = this.cache.get(routeKey(r));
      const list = hit?.ok ? (hit.value as Journey[]) : [];
      const view = this.view;
      const sel = view && view.screen === 'trip' ? effectiveFrame(f, view, this.capacity).sel : f.sel;
      const j = list[sel];
      const i = j ? j.legs.findIndex((l) => l.kind === 'ride') : -1;
      const leg = j?.legs[i];
      const key = j ? `follow:${j.id}` : '';
      if (j && leg && !leg.cancelled && now >= leg.dep && now < leg.arr && !this.autoDone.has(key)) {
        this.autoDone.add(key);
        this.nav = push(this.nav, { screen: 'train', journey: j, leg: i, trip: { from: r.from, to: r.to }, auto: true });
      }
      return;
    }
    if (r.screen === 'train') {
      const j = this.journeyOf(r) ?? r.journey;
      const leg = j.legs[r.leg];
      if (!leg) return;
      const nextRide = j.legs.findIndex((l, k) => k > r.leg && l.kind === 'ride');
      if (nextRide >= 0 && now >= leg.arr && !this.autoDone.has(`train:${j.id}:${nextRide}`)) {
        this.autoDone.add(`train:${j.id}:${nextRide}`);
        this.nav = updateRoute(this.nav, { ...r, journey: j, leg: nextRide });
        return;
      }
      if (nextRide < 0 && r.trip && now >= leg.arr - 3 * 60_000 && now < leg.arr + 10 * 60_000 && !this.autoDone.has(`arrival:${j.id}`)) {
        this.autoDone.add(`arrival:${j.id}`);
        this.nav = push(this.nav, { screen: 'arrival', journey: j, leg: r.leg, trip: r.trip });
        return;
      }
      if (nextRide < 0 && !r.trip && r.auto && now >= leg.arr + 60_000 && !this.autoDone.has(`alight:${j.id}`)) {
        this.autoDone.add(`alight:${j.id}`);
        this.nav = pop(this.nav);
      }
    }
  }

  /* ------------------------------ Vues ------------------------------ */

  /** Vue de l'écran courant ; lance le chargement si besoin. */
  buildView(): GlassesView {
    const r = current(this.nav).route;
    const ctx = this.ctx();
    if (r.screen === 'message') {
      switch (r.kind) {
        case 'firstRun':
          return firstRunView(ctx);
        case 'notConfigured':
          return notConfiguredView(ctx);
        case 'error':
          return errorView(r.title, r.lines.join(' '), ctx);
        case 'loading':
          return messageView(r.title, r.lines, ctx);
        default:
          return messageView(r.title, r.lines, ctx, { hints: HINTS.message });
      }
    }
    const key = routeKey(r);
    const hit = this.cache.get(key);
    if (!hit) void this.load(r);
    if (hit && !hit.ok) return errorView(titleFor(r, ctx), hit.error, ctx);
    const value = hit?.ok ? hit.value : undefined;
    switch (r.screen) {
      case 'home':
        return homeView({ ...((value as HomeData | undefined) ?? { suggestion: this.homeSuggestion() }), ...this.freshLines() }, ctx);
      case 'nearby': {
        if (!value) return loadingView('Autour de moi', 'Recherche des arrêts…', ctx);
        const v = value as { list?: NearbyItem[]; noLocation?: boolean };
        if (v.noLocation) return noLocationView('Autour de moi', ctx);
        return nearbyView(v.list ?? [], ctx);
      }
      case 'board': {
        if (!value) return loadingView('Départs', 'Chargement des départs…', ctx);
        const { board, works } = value as { board: Parameters<typeof boardView>[0]; works: string[] };
        const isFavorite = this.settings().favorites.some((f) => f.kind === 'stop' && f.areaId === r.areaId);
        const v = boardView(board, ctx, { isFavorite });
        if (!v.top && works?.[0]) v.top = { text: `! ${works[0]}`, strong: true };
        return v;
      }
      case 'favorites':
        return favoritesView((value as Record<string, FavoriteNext | null>) ?? {}, ctx);
      case 'trip':
        if (!value) return loadingView(titleFor(r, ctx), 'Recherche des trains…', ctx);
        return tripView(r, value as Journey[], ctx);
      case 'places':
        return placesView((value as Record<string, string>) ?? {}, ctx);
      case 'journeys': {
        if (!value) return loadingView(titleFor(r, ctx), 'Calcul des trajets…', ctx);
        const v = value as { journeys?: Journey[]; noLocation?: boolean; already?: boolean };
        if (v.noLocation) return noLocationView(titleFor(r, ctx), ctx);
        if (v.already) return alreadyThereView(r.label, ctx);
        return journeysView(r, v.journeys ?? [], ctx);
      }
      case 'steps':
        return stepsView(r, this.journeyOf(r) ?? r.journey, ctx);
      case 'train':
        return trainView(this.journeyOf(r) ?? r.journey, r.leg, ctx);
      case 'arrival': {
        const j = this.journeyOf(r) ?? r.journey;
        const leg = j.legs[r.leg];
        const name = leg ? displayName(leg.to.name, ctx.settings.lang) : '';
        if (!value) return loadingView(`Arrivée à ${name}`, 'Recherche des départs devant la gare…', ctx);
        return arrivalView(name, leg?.arr ?? ctx.now, (value as { deps: Departure[] }).deps, ctx);
      }
    }
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
    const toast = this.toast && this.toast.until > Date.now() && this.toast.route === routeKey(current(this.nav).route) ? this.toast.text : undefined;
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
      const nb = (t: string): string => t.replace(/\u00A0/g, ' ');
      const line = 'QUAI_SCREEN ' + JSON.stringify({ screen: page.screen, title: nb(page.title), lines: page.lines.map(nb), clock: page.clock, sel: page.sel });
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
    return { v: 1, nav: this.nav, clock: this.d.clock.snapshot(), here: this.here, savedAt: Date.now() };
  }

  restore(snap: unknown): void {
    try {
      const s = (typeof snap === 'string' ? JSON.parse(snap) : snap) as { nav?: unknown; clock?: { now: number }; here?: Fix | null };
      if (!s || typeof s !== 'object') return;
      const nav = parseNav(s.nav);
      if (s.clock) this.d.clock.restore(s.clock);
      if (s.here && Number.isFinite(s.here.lat) && Number.isFinite(s.here.lon)) this.here = s.here;
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
  get state(): { nav: NavState; page: PageSpec | null } {
    return { nav: this.nav, page: this.page };
  }

  async replaceRoute(route: Route): Promise<void> {
    this.nav = replace(this.nav, route);
    await this.onRouteChanged();
  }
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
    case 'trip':
      return `${displayName(r.from.name, ctx.settings.lang)} ▶ ${displayName(r.to.name, ctx.settings.lang)}`;
    case 'journeys':
      return `Vers ${r.label}`;
    case 'nearby':
      return 'Autour de moi';
    case 'favorites':
      return 'Mes favoris';
    case 'places':
      return 'Aller à…';
    default:
      return 'Quai';
  }
}

function noLocationView(title: string, ctx: ViewCtx): GlassesView {
  return messageView(title, ['Position indisponible.', 'Autorise la position pour Quai dans l’appli Even.'], ctx, {
    hints: HINTS.retry,
    tap: { kind: 'retry' },
  });
}

export type { Endpoint };
