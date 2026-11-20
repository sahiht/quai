/**
 * Quai 1.3.1 (PRD-1.3.1 § 14, R2 ; docs/v1.3.1/experts/06-rd.md) : « Essayer en accéléré », dans Quai Web seulement.
 * Ce module n'est importé que par web/main.ts : il n'est jamais dans l'appli des lunettes ni dans le paquet .ehpk
 * (test/web/v131-accelere.test.ts le vérifie sur le graphe des imports de main.ts).
 *
 * Sous « Y aller » d'un favori (téléphone de Quai Web, PhoneCtx.tryButton), « Essayer en accéléré » lance le guidage de
 * son trajet dans un bac à sable : un second contrôleur des lunettes (le même code, le même moteur, les mêmes écrans que
 * le vrai guidage), dessiné dans le même écran des lunettes, avec :
 * - sa propre horloge, 10 fois plus rapide, partie 1 min avant l'heure de partir ;
 * - des positions simulées sur le vrai chemin : la marche le long du chemin à pied calculé pour ce guidage (celui que suit
 *   le moteur), le véhicule d'arrêt en arrêt selon les heures prévues ;
 * - les heures prévues seulement : le trajet ramené à l'horaire (temps réel retiré), aucun rafraîchissement du temps réel
 *   pendant l'essai, les arrêts d'un véhicule lus dans le trajet lui-même ;
 * - rien d'enregistré : son stockage reste en mémoire (trajet suivi quai.trip, réglages, date du premier lancement) et il
 *   n'a pas de journal des trajets.
 * Les vraies lunettes passent en arrière-plan pendant l'essai (comme Quai quitté sur les G2 : rien n'est perdu) et leurs
 * envois à l'écran sont retenus (gatedPort) ; « Arrêter l'essai » les rend telles quelles, à l'heure vraie et à la
 * position d'avant : ni l'horloge ni la position de la page ne sont jamais touchées. Un vrai guidage en cours empêche
 * l'essai ; « Lunettes » ou « Y aller » du téléphone arrêtent d'abord l'essai. Aucun crochet global (ni __quaiClock ni
 * __quaiPushFix) ; rien sur le réseau de plus que le guidage lui-même (le chemin à pied, comme « Y aller »).
 */
import type { Core, Departure, DepartureStops, FavoriteAnswer, FavoritePlace, FavoriteTrip, GlassesApi, Journey, KV, LatLon, Leg, Settings } from '../core/api';
import { MESSAGES } from '../core/errors';
import { asTrip, favoriteTitle } from '../core/favorites';
import { FIRST_WALK, firstWalkLeg, firstWalkMin, realWalkMin, setFirstWalk } from '../core/firstwalk';
import { GUIDE } from '../core/guide';
import type { WalkRoute } from '../core/guide-types';
import { knownPoint } from '../core/guide-walk';
import { JOURNAL_KEY } from '../core/journal';
import { distanceM } from '../core/util';
import { GlassesController, GUIDE_TEXT, TRIP_KEY, type ControllerDeps } from '../glasses/controller';
import { atTitle, catchable, NB } from '../glasses/format';
import type { HubSignal } from '../glasses/gestures';
import { current, type Gesture } from '../glasses/nav';
import { h } from '../phone/dom';
import { typo } from '../phone/text';
import type { MessageHub } from '../phone/ui';
import { createClock, type Clock } from '../platform/clock';
import { deadline } from '../platform/queue';
import type { Fix, GlassesPort, LocationPort } from '../platform/types';
import { SettingsStore } from '../settings';
import type { WebGlassesPort } from './port';

/** L'essai passe 10 fois plus vite que l'heure vraie. */
export const ESSAI_SPEED = 10;
/** Il commence 1 min avant l'heure de partir (« Où tu en es », puis « Partir maintenant » à l'heure). */
export const ESSAI_LEAD_MS = 60_000;

/**
 * Lecteur d'écran (contrôle qualité) : une zone « status » n'est lue que si son texte change alors qu'elle est déjà à
 * l'écran. Le texte du bandeau se voit tout de suite (sans être lu), et il entre dans la zone ce délai après son affichage.
 */
export const ESSAI_SAY_MS = 200;

/** Textes de l'essai (téléphone et bandeau de Quai Web). */
export const ESSAI_TEXT = {
  button: 'Essayer en accéléré',
  banner: `Essai en accéléré${NB}: positions simulées, rien n’est enregistré.`,
  stop: 'Arrêter l’essai',
  busy: `Un guidage est en cours${NB}: pas d’essai en même temps.`,
  started: 'Essai lancé sur les lunettes.',
  ended: 'Essai terminé.',
} as const;

/** Vitesse de marche donnée au moteur, au plus (il prend une marche de 2,5 m/s ou plus pour autre chose). */
const WALK_SPEED_MAX = 2.2;
/**
 * Vitesse d'un véhicule simulé, au moins (contrôle qualité) : le moteur constate la montée à partir de 4 m/s
 * (GUIDE.vehicleMs) et prend pour une marche ce qui va moins vite que 2,5 m/s. Un horaire à la minute donne souvent une
 * moyenne plus lente entre deux arrêts (566 m en 4 min : 2,4 m/s) : le véhicule simulé roule alors à cette vitesse et
 * attend le reste du temps, à l'arrêt, comme un vrai.
 */
export const RIDE_SPEED_MIN = 5;
/**
 * Sur le dernier tronçon, l'attente se fait en route, à 200 m au moins de l'arrêt de descente : le moteur constate la
 * descente dès qu'on est au pas près de cet arrêt (150 m), et « Descends au prochain arrêt » n'aurait pas le temps d'être lu.
 */
export const RIDE_WAIT_FROM_END_M = 200;
/** Une position au moins toutes les 20 s simulées, même immobile (comme le flux des vraies positions). */
const FIX_EVERY_MAX_MS = 20_000;
const CORE_TIMEOUT_MS = 20_000;

const errText = (e: unknown): string => (e instanceof Error && e.message ? e.message : MESSAGES.dataUnreachable);

/* ------------------------------ Trajet aux heures prévues ------------------------------ */

/**
 * Le trajet aux heures prévues (temps réel retiré) : chaque véhicule à son horaire, sans retard, suppression ni voie
 * modifiée ; les marches recalculées autour d'eux comme le fait le cœur (recompute de core/journeys.ts) : la première
 * part `leaveBeforeMin` avant ce qu'il faut pour le premier véhicule, les suivantes à l'arrivée de l'étape d'avant.
 * Identifiant, étiquette et raison gardés ; plus d'alerte (elles venaient du temps réel).
 */
export function plannedJourney(j: Journey, leaveBeforeMin: number): Journey {
  const legs: Leg[] = j.legs.map((l) => ({ ...l, from: { ...l.from }, to: { ...l.to }, ...(l.stops ? { stops: l.stops.map((s) => ({ ...s })) } : {}) }));
  for (const l of legs) {
    if (l.kind !== 'ride') continue;
    l.dep = l.schedDep;
    l.arr = l.schedArr;
    l.rt = false;
    l.delayMin = 0;
    l.cancelled = false;
    delete l.newPlatform;
    delete l.last;
    delete l.rtKept;
    for (const s of l.stops ?? []) s.est = s.sched;
  }
  const margin = Math.max(0, Number.isFinite(leaveBeforeMin) ? leaveBeforeMin : 0) * 60_000;
  const first = legs.find((l) => l.kind === 'ride');
  legs.forEach((l, i) => {
    if (l.kind !== 'walk') return;
    const w = Number.isFinite(l.walkMin) ? (l.walkMin as number) * 60_000 : Math.max(0, l.arr - l.dep);
    if (i === 0) {
      if (!first) return;
      l.dep = first.dep - w - margin;
    } else l.dep = legs[i - 1].arr;
    l.arr = l.dep + w;
    l.schedDep = l.dep;
    l.schedArr = l.arr;
  });
  const rides = legs.filter((l) => l.kind === 'ride');
  const leaveAt = first ? (legs[0].kind === 'walk' ? legs[0].dep : first.dep - margin) : (legs[0]?.dep ?? j.leaveAt);
  return {
    ...j,
    legs,
    dep: legs[0]?.dep ?? j.dep,
    arr: legs[legs.length - 1]?.arr ?? j.arr,
    leaveAt,
    rt: rides.every((l) => l.rt === true),
    alerts: [],
  };
}

/**
 * Contrôle qualité : la première marche compte les minutes de son vrai chemin quand il est plus long que la marche
 * prévue, et le départ avance d'autant, pour que l'essai commence bien 1 min avant l'heure de partir et que la marche
 * simulée garde une allure de marche. 1.3.1 (« 7h12 partout ») : ce n'est plus une copie de la règle. Le trajet d'un
 * favori arrive déjà corrigé par le cœur quand le chemin est connu ; ici, la même règle par les mêmes fonctions
 * (core/firstwalk.ts : 80 m par minute, au plus 5 min d'avance, jamais deux corrections l'une sur l'autre grâce à
 * Leg.walkEst), pour le cas où le chemin n'est connu qu'à l'instant de lancer l'essai. Mêmes conditions : un vrai chemin
 * (pas une ligne droite), qui part du départ (40 m) et mène à l'arrêt (30 m), vers un véhicule. Sinon : le trajet donné.
 */
export function realFirstWalk(j: Journey, route: WalkRoute | null | undefined, leaveBeforeMin: number): Journey {
  const w = firstWalkLeg(j.legs);
  if (!route || route.source !== 'osm' || !Number.isFinite(route.lengthM) || !w) return j;
  if (!knownPoint(w.from) || !knownPoint(w.to) || !knownPoint(route.from) || !knownPoint(route.to)) return j;
  if (distanceM(route.from, w.from) > FIRST_WALK.startM || distanceM(route.to, w.to) > FIRST_WALK.endM) return j;
  // déjà décidé par le cœur pour ce trajet : rien de plus
  if (w.walkEst !== undefined) return j;
  const legs = j.legs.map((l) => ({ ...l }));
  if (!(setFirstWalk(legs, firstWalkMin(w, realWalkMin(route.lengthM))) > 0)) return j;
  return plannedJourney({ ...j, legs }, leaveBeforeMin);
}

/* ------------------------------ Positions simulées ------------------------------ */

/** Chemin à pied de l'étape `leg` du trajet (celui du guidage : FollowedGuide.walk). */
export interface SimWalk {
  leg: number;
  route: WalkRoute;
}

const rad = (d: number): number => (d * Math.PI) / 180;

/** Cap de a vers b, en degrés depuis le nord (sens horaire). */
function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

const lerp = (a: LatLon, b: LatLon, f: number): LatLon => ({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });

/** Point à `m` mètres du début d'une polyligne, et le cap du segment où il est. */
function along(path: readonly LatLon[], m: number): { p: LatLon; heading: number } {
  let left = Math.max(0, m);
  for (let i = 1; i < path.length; i++) {
    const d = distanceM(path[i - 1], path[i]);
    if (left <= d || i === path.length - 1) return { p: lerp(path[i - 1], path[i], d > 0 ? Math.min(1, left / d) : 1), heading: bearingDeg(path[i - 1], path[i]) };
    left -= d;
  }
  return { p: path[path.length - 1], heading: 0 };
}

const pathLength = (path: readonly LatLon[]): number => path.slice(1).reduce((s, p, i) => s + distanceM(path[i], p), 0);
const tenth = (v: number): number => Math.round(v * 10) / 10;

/** Marche de l'étape `i` à l'instant `t` : le long de son chemin à pied (sinon tout droit), au rythme prévu. */
function walkFix(l: Leg, i: number, t: number, walk: SimWalk | null | undefined, at: number): Fix {
  const path = walk && walk.leg === i && walk.route.coords.length >= 2 ? walk.route.coords : [l.from, l.to];
  const len = pathLength(path);
  const dur = Math.max(1_000, l.arr - l.dep);
  const f = Math.min(1, Math.max(0, (t - l.dep) / dur));
  const { p, heading } = along(path, f * len);
  const moving = f < 1 && len > 1;
  const out: Fix = { lat: p.lat, lon: p.lon, accuracy: 5, speed: moving ? tenth(Math.min(WALK_SPEED_MAX, len / (dur / 1000))) : 0, at, source: 'mock' };
  if (moving) out.heading = heading;
  return out;
}

/**
 * À bord de l'étape `l` à l'instant `t` : d'arrêt en arrêt (ceux dont la position est connue), parti de chacun et arrivé
 * au dernier à l'heure prévue. Jamais à l'allure d'une marche : le véhicule roule (RIDE_SPEED_MIN au moins) ou attend.
 * Il attend à l'arrêt suivant, où il arrive en avance ; sur le dernier tronçon, en route (au milieu, et à
 * RIDE_WAIT_FROM_END_M au moins de l'arrêt de descente), pour arriver à l'heure.
 */
function rideFix(l: Leg, t: number, at: number): Fix {
  const pts: { p: LatLon; t: number }[] = [{ p: { lat: l.from.lat, lon: l.from.lon }, t: l.dep }];
  for (const s of l.stops ?? []) if (knownPoint(s) && s.sched > pts[pts.length - 1].t && s.sched < l.arr) pts.push({ p: { lat: s.lat, lon: s.lon }, t: s.sched });
  pts.push({ p: { lat: l.to.lat, lon: l.to.lon }, t: Math.max(l.arr, pts[pts.length - 1].t) });
  let k = 0;
  while (k < pts.length - 2 && t > pts[k + 1].t) k++;
  const a = pts[k];
  const b = pts[k + 1];
  const dist = distanceM(a.p, b.p);
  // durée du roulage : celle de l'horaire si sa moyenne est déjà celle d'un véhicule, sinon plus courte, le reste en attente
  const roll = Math.min(b.t - a.t, (dist / RIDE_SPEED_MIN) * 1000);
  const wait = b.t - a.t - roll;
  // part du tronçon roulée avant l'attente
  const first = k < pts.length - 2 || dist <= 0 ? 1 : Math.max(0, Math.min(dist / 2, dist - RIDE_WAIT_FROM_END_M)) / dist;
  const e = t - a.t;
  let f = 1;
  if (roll > 0 && e < roll * first) f = e / roll;
  else if (roll > 0 && e < roll * first + wait) f = first;
  else if (roll > 0) f = Math.min(1, (e - wait) / roll);
  f = Math.max(0, f);
  const moving = roll > 0 && f < 1 && !(e >= roll * first && e < roll * first + wait);
  const p = lerp(a.p, b.p, f);
  const speed = moving ? dist / (roll / 1000) : 0;
  const out: Fix = { lat: p.lat, lon: p.lon, accuracy: 10, speed: tenth(speed), at, source: 'mock' };
  if (speed > 0) out.heading = bearingDeg(a.p, b.p);
  return out;
}

/**
 * Position simulée à l'instant `t` sur le trajet `j` : au départ avant de partir ; pendant une marche, le long de son
 * chemin à pied (`walk`, celui du guidage) ou tout droit, du début à la fin prévus de l'étape ; à l'arrêt entre deux
 * étapes ; à bord, d'arrêt en arrêt aux heures prévues ; à l'arrivée ensuite. Vitesse et cap comme un téléphone.
 */
export function simulatedFix(j: Journey, t: number, walk?: SimWalk | null): Fix | null {
  const legs = j.legs;
  if (!legs.length) return null;
  const at = Math.round(t);
  const still = (p: Leg['from'], accuracy: number): Fix => ({ lat: p.lat, lon: p.lon, accuracy, speed: 0, at, source: 'mock' });
  if (t < legs[0].dep) return still(legs[0].from, 5);
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    if (t < l.dep) return still(i > 0 && knownPoint(legs[i - 1].to) ? legs[i - 1].to : l.from, 8);
    if (t <= l.arr) return l.kind === 'walk' ? walkFix(l, i, t, walk, at) : rideFix(l, t, at);
  }
  return still(legs[legs.length - 1].to, 5);
}

/** Port de position de l'essai : la position simulée de l'heure de l'essai ; flux au rythme demandé (temps simulé). */
interface SimLocation extends LocationPort {
  stop(): void;
}

function simLocation(clock: Clock, source: () => { journey: Journey; walk: SimWalk | null }): SimLocation {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gen = 0;
  let stopped = false;
  const fix = (): Fix | null => {
    const s = source();
    return simulatedFix(s.journey, clock.now(), s.walk);
  };
  const halt = (): void => {
    gen++;
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    current: async () => (stopped ? null : fix()),
    last: () => (stopped ? null : fix()),
    watch(opts, cb) {
      halt();
      const my = gen;
      // une position par intervalle demandé (2 s en marchant, 30 s sinon), au moins toutes les 20 s, en temps simulé
      const every = Math.min(Math.max(opts.intervalMs, 500), FIX_EVERY_MAX_MS);
      const send = (): void => {
        if (my !== gen || stopped) return;
        const f = fix();
        if (f) {
          try {
            cb(f);
          } catch (e) {
            console.error('[Quai] essai : position', e);
          }
        }
        if (my === gen && !stopped) timer = setTimeout(send, Math.max(50, clock.real(every)));
      };
      // la première tout de suite, comme un vrai flux
      timer = setTimeout(send, 0);
      return () => {
        if (my === gen) halt();
      };
    },
    stop() {
      stopped = true;
      halt();
    },
  };
}

/* ------------------------------ Bac à sable : stockage, cœur, écran ------------------------------ */

/**
 * Stockage de l'essai : il lit celui de la page (réglages, date du premier lancement) mais n'y écrit jamais ; le trajet
 * suivi et le journal des trajets y sont vides (un trajet suivi de la page n'entre pas dans l'essai).
 */
function sandboxKV(real: KV): KV {
  const mem = new Map<string, string>([
    [TRIP_KEY, ''],
    [JOURNAL_KEY, ''],
  ]);
  const read = (k: string, get: (k: string) => Promise<string | null>): Promise<string | null> => (mem.has(k) ? Promise.resolve(mem.get(k) || null) : get(k));
  return {
    get: (k) => read(k, (x) => real.get(x)),
    getStrict: (k) => read(k, (x) => (real.getStrict ? real.getStrict(x) : real.get(x))),
    async set(k, v) {
      mem.set(k, v);
    },
  };
}

/** Arrêts d'un véhicule du trajet de l'essai, aux heures prévues (sans le réseau) ; absent : « missing ». */
function plannedStops(j: Journey, areaId: string, dep: Departure): DepartureStops {
  const l = j.legs.find((x) => x.kind === 'ride' && x.from.areaId === areaId && x.schedDep === dep.sched);
  const base = { op: dep.op, mode: dep.mode, line: dep.line, head: dep.head, anyPlanned: true };
  if (!l?.stops?.length) return { ...base, stops: [], state: 'missing' };
  return {
    ...base,
    state: 'ok',
    at: 0,
    stops: l.stops.map((s) => ({ ...(s.areaId ? { areaId: s.areaId } : {}), name: s.name, sched: s.sched, est: s.sched, rt: false, delayMin: 0, ...(s.platform ? { platform: s.platform } : {}) })),
  };
}

/**
 * Cœur de l'essai : le vrai cœur (chemin à pied, données de la nuit), sauf le temps réel et ce qui ne doit pas sortir de
 * l'essai : publication déjà lue, aucun abonnement aux nouvelles publications, trajets jamais rafraîchis (heures prévues),
 * arrêts d'un véhicule lus dans le trajet, réponse du favori essayé donnée (son trajet aux heures prévues), nouveaux
 * trajets ramenés aux heures prévues.
 */
function trialCore(real: Core, o: { favoriteId: string; answer: () => FavoriteAnswer; journey: () => Journey; now: () => number }): Core {
  const over: Partial<Record<keyof Core, unknown>> = {
    init: async () => real.meta ?? real.init(),
    onGeneration: () => undefined,
    refresh: async (j: Journey) => j,
    departureStops: async (areaId: string, dep: Departure) => plannedStops(o.journey(), areaId, dep),
    answer: async (fav: { id: string; kind: string }): Promise<FavoriteAnswer> =>
      fav.id === o.favoriteId ? o.answer() : { favoriteId: fav.id, kind: fav.kind === 'stop' ? 'stop' : 'trip', state: 'none', updatedAt: o.now() },
    route: async (...args: Parameters<Core['route']>) => {
      const r = await real.route(...args);
      return { ...r, journeys: r.journeys.map((x) => plannedJourney(x, args[3].alerts.leaveBeforeMin)) };
    },
  };
  return new Proxy(real, {
    get(target, key) {
      if (typeof key === 'string' && key in over) return over[key as keyof Core];
      const v: unknown = Reflect.get(target, key);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

/** Port dont les envois à l'écran sont retenus quand `open()` est faux (signaux et gestes inchangés). */
export function gatedPort<P extends GlassesPort>(port: P, open: () => boolean): P {
  const out: P = {
    ...port,
    start: (cs, extra) => (open() ? port.start(cs, extra) : Promise.resolve(true)),
    rebuild: (cs, extra) => (open() ? port.rebuild(cs, extra) : Promise.resolve(true)),
    upgrade: (c, o) => (open() ? port.upgrade(c, o) : Promise.resolve(true)),
  };
  if (port.paint) {
    const paint = port.paint.bind(port);
    out.paint = (img) => (open() ? paint(img) : Promise.resolve(true));
  }
  return out;
}

/**
 * Place du bandeau dans la page de Quai Web (contrôle qualité). Grand écran (`wide`, les deux vues côte à côte) :
 * au-dessus de l'écran des lunettes (`stage`), dans la vue Lunettes, toujours en vue. Écran étroit (une vue à la fois) :
 * juste avant les vues (`main`), sous la barre du haut, où le style le garde collé : le bandeau et « Arrêter l'essai »
 * se voient aussi dans la vue Réglages. Déjà en place : rien n'est déplacé (le curseur reste où il est).
 */
export function placeBanner(banner: HTMLElement, o: { wide: boolean; stage: Element | null; main: Element | null }): void {
  const next = o.wide ? o.stage : o.main;
  if (next && banner.nextElementSibling !== next) next.before(banner);
}

/* ------------------------------ L'essai ------------------------------ */

export interface EssaiDeps {
  /** Les vraies lunettes : jamais touchées par l'essai (lues : vrai guidage en cours, erreur du cœur). */
  controller: Pick<GlassesController, 'followed' | 'error'>;
  /** Signal aux vraies lunettes (gestes, page cachée ou visible, arrière-plan pendant l'essai). */
  realSignal(s: HubSignal): void;
  /** Port de l'écran des lunettes pour un essai (le même écran). */
  port(): WebGlassesPort;
  /** Le vrai cœur, prêt. */
  core(): Promise<Core>;
  freshness: ControllerDeps['freshness'];
  settings: SettingsStore;
  kv: KV;
  location: LocationPort;
  clock: Clock;
  /** Montre l'onglet Lunettes (écran étroit). */
  showGlasses?(): void;
  /** Page visible ; cachée, les vraies lunettes reprennent à son retour (signal de la page). */
  visible?(): boolean;
  /** Après l'arrêt, quand le curseur était sur « Arrêter l'essai ». */
  focusAfter?(): void;
  /** Mode test : journal QUAI_SCREEN de l'essai (comme les vraies lunettes). */
  e2e?: boolean;
  log?: (line: string) => void;
}

export interface Essai {
  /** Un essai est en cours. */
  active(): boolean;
  /** Heure de l'essai en cours (accélérée), null sans essai. */
  now(): number | null;
  /** Bandeau de l'essai (caché hors essai), au-dessus de l'écran des lunettes. */
  readonly banner: HTMLElement;
  /** PhoneCtx.tryButton : « Essayer en accéléré » du favori `favoriteId`, son message dans `slot` (par `hub`). */
  button(favoriteId: string, title: string, hub: MessageHub, slot: HTMLElement): HTMLButtonElement;
  /** Lance l'essai du favori (un essai en cours est remplacé) ; le message à montrer. */
  tryFavorite(favoriteId: string, said?: { hub: MessageHub; slot: HTMLElement }): Promise<{ text: string; ok: boolean }>;
  /** « Arrêter l'essai » : les vraies lunettes reviennent telles qu'elles étaient. */
  stop(): void;
  /** Geste de la page (boutons, écran, clavier) : à l'essai pendant l'essai, aux vraies lunettes sinon. */
  gesture(g: Gesture): void;
  /** Page cachée ou visible : de même. */
  signal(s: HubSignal): void;
  /** Lunettes données au téléphone : « Lunettes » et « Y aller » arrêtent d'abord l'essai. */
  glasses(api: GlassesApi): GlassesApi;
  /** Contrôleur de l'essai en cours (tests). */
  sandbox(): GlassesController | null;
}

interface Run {
  sandbox: GlassesController;
  port: WebGlassesPort & { close(): void };
  loc: SimLocation;
  clock: Clock;
  off: (() => void) | null;
  /** minuterie de l'annonce du bandeau (ESSAI_SAY_MS) */
  say?: ReturnType<typeof setTimeout>;
  said?: { hub: MessageHub; slot: HTMLElement };
}

/** Demandes du téléphone aux vraies lunettes qui changent leur écran : l'essai s'arrête d'abord. */
const REAL_CALLS: ReadonlySet<PropertyKey> = new Set(['showTrip', 'showBoard', 'goFavorite']);

export function createEssai(deps: EssaiDeps): Essai {
  let run: Run | null = null;
  let seq = 0;
  let wrapped: { api: GlassesApi; proxy: GlassesApi } | null = null;

  const text = h('p', { class: 'w-essai-text', role: 'status' });
  const stopButton = h('button', { type: 'button', class: 'btn btn-secondary w-essai-stop' }, ESSAI_TEXT.stop);
  const banner = h('div', { class: 'w-essai', hidden: true }, text, stopButton);
  stopButton.addEventListener('click', () => stop());

  /** Fin de l'essai ; `resume` faux : un autre essai prend sa place (les vraies lunettes restent en arrière-plan). */
  function end(resume: boolean): void {
    const r = run;
    if (!r) return;
    run = null;
    const hadFocus = typeof document !== 'undefined' && banner.contains(document.activeElement);
    r.off?.();
    r.port.close();
    r.loc.stop();
    r.sandbox.stop();
    clearTimeout(r.say);
    banner.hidden = true;
    text.textContent = '';
    if (r.said?.slot.isConnected) r.said.hub.say(r.said.slot, ESSAI_TEXT.ended);
    if (!resume) return;
    // les vraies lunettes reprennent telles qu'elles étaient (page cachée : à son retour, par le signal de la page)
    if (deps.visible?.() !== false) deps.realSignal({ kind: 'foreground' });
    if (hadFocus) deps.focusAfter?.();
  }

  function stop(): void {
    end(true);
  }

  async function tryFavorite(id: string, said?: { hub: MessageHub; slot: HTMLElement }): Promise<{ text: string; ok: boolean }> {
    const my = ++seq;
    const busy = (): boolean => !!deps.controller.followed?.guide;
    if (busy()) return { text: ESSAI_TEXT.busy, ok: false };
    const s = deps.settings.get();
    const f = s.favorites.find((x) => x.id === id);
    if (!f) return { text: GUIDE_TEXT.noFavorite, ok: false };
    if (f.kind === 'stop') return { text: GUIDE_TEXT.noRoute, ok: false };
    let core: Core;
    try {
      core = await deps.core();
    } catch {
      return { text: deps.controller.error ?? MESSAGES.dataUnreachable, ok: false };
    }
    // le trajet du favori, calculé comme pour « Y aller » (sa première proposition encore attrapable)
    const title = favoriteTitle(f, s);
    const { from, to } = asTrip(f);
    const needsHere = from.type === 'here' || to.type === 'here';
    const fx = deps.location.last() ?? (needsHere ? await deps.location.current(6000) : null);
    if (needsHere && !fx) return { text: MESSAGES.hereMissing, ok: false };
    let a: FavoriteAnswer;
    try {
      a = await deadline(core.answer(f, fx ? { lat: fx.lat, lon: fx.lon } : null, s), CORE_TIMEOUT_MS, `Pas de réseau${NB}: réessaie dans un instant.`);
    } catch (e) {
      return { text: errText(e), ok: false };
    }
    if (a.state === 'here') return { text: `Tu es déjà ${atTitle(title)}.`, ok: false };
    if (a.state === 'noPosition') return { text: MESSAGES.hereMissing, ok: false };
    const j0 = (a.plan?.journeys ?? []).find((x) => catchable(x, deps.clock.now()));
    if (!j0) return { text: GUIDE_TEXT.noTrip, ok: false };
    let j = plannedJourney(j0, s.alerts.leaveBeforeMin);
    // le vrai chemin de la première marche (celui que le guidage demande aussi, mêmes tuiles) : ses minutes, l'heure de partir
    const w = j.legs[0];
    if (w?.kind === 'walk' && core.walkRoute && knownPoint(w.from) && knownPoint(w.to)) {
      // 1.3.1 : le chemin du réglage « Éviter les escaliers », comme le cœur et le guidage
      const route = await deadline(core.walkRoute({ lat: w.from.lat, lon: w.from.lon }, { lat: w.to.lat, lon: w.to.lon }, { avoidSteps: s.avoidSteps === true }), CORE_TIMEOUT_MS, 'chemin à pied trop lent').catch(() => null);
      j = realFirstWalk(j, route, s.alerts.leaveBeforeMin);
    }
    // une autre demande est arrivée pendant le calcul, ou un vrai guidage a commencé
    if (my !== seq) return { text: '', ok: true };
    if (busy()) return { text: ESSAI_TEXT.busy, ok: false };
    return launch(core, f, j, s, said);
  }

  async function launch(real: Core, f: FavoritePlace | FavoriteTrip, j: Journey, s: Settings, said?: Run['said']): Promise<{ text: string; ok: boolean }> {
    end(false);
    const clock = createClock({ mockNow: j.leaveAt - ESSAI_LEAD_MS, speed: ESSAI_SPEED, e2e: false });
    const kv = sandboxKV(deps.kv);
    // « Me guider pendant un trajet » allumé dans l'essai : il montre les messages du guidage
    const settings = new SettingsStore(kv, { ...s, display: { ...s.display, guide: true } });
    let sandbox: GlassesController | null = null;
    const journey = (): Journey => sandbox?.followed?.journey ?? j;
    const loc = simLocation(clock, () => {
      const t = sandbox?.followed;
      const jj = t?.journey ?? j;
      const w = t?.guide?.walk;
      return { journey: jj, walk: w && w.journeyId === jj.id ? { leg: w.leg, route: w.route } : null };
    });
    const core = trialCore(real, {
      favoriteId: f.id,
      answer: () => ({ favoriteId: f.id, kind: 'trip', state: 'ok', plan: { journeys: [j] }, updatedAt: clock.now() }),
      journey,
      now: clock.now,
    });
    let open = true;
    const port = Object.assign(gatedPort(deps.port(), () => open), {
      close: () => {
        open = false;
      },
    });
    sandbox = new GlassesController({
      platform: { kind: 'web', glasses: port, kv, location: loc, closeWebView: () => undefined },
      core,
      settings,
      clock,
      configured: true,
      freshness: deps.freshness,
      e2e: !!deps.e2e,
      ...(deps.log ? { log: deps.log } : {}),
      pageStarted: true,
      web: true,
      openPhone: () => undefined,
    });
    const r: Run = { sandbox, port, loc, clock, off: null, ...(said ? { said } : {}) };
    run = r;
    // les vraies lunettes en arrière-plan : plus rien d'elles à l'écran pendant l'essai
    deps.realSignal({ kind: 'background' });
    let msg: string;
    try {
      // « Y aller » dans l'essai, avant son démarrage : il s'ouvre sur l'écran du guidage
      msg = await sandbox.goFavorite(f.id);
    } catch (e) {
      msg = errText(e);
    }
    // remplacé par un autre essai, ou arrêté, pendant le lancement
    if (run !== r) return { text: '', ok: true };
    if (!sandbox.followed?.guide) {
      end(true);
      return { text: msg || GUIDE_TEXT.noTrip, ok: false };
    }
    // fin du guidage de l'essai (« Tu y es », « Arrêter le guidage », fin donnée par le moteur) : fin de l'essai
    r.off = sandbox.onGuide((st) => {
      if (!st && run === r) end(true);
    });
    await sandbox.start();
    if (run !== r) return { text: '', ok: true };
    // le texte se voit tout de suite (même place, rien ne bouge ensuite) mais sans être dans la zone « status » ; il y
    // entre juste après l'affichage du bandeau, pour qu'un lecteur d'écran l'annonce
    text.replaceChildren(h('span', { 'aria-hidden': 'true' }, ESSAI_TEXT.banner));
    banner.hidden = false;
    deps.showGlasses?.();
    r.say = setTimeout(() => {
      if (run === r) text.textContent = ESSAI_TEXT.banner;
    }, ESSAI_SAY_MS);
    return { text: ESSAI_TEXT.started, ok: true };
  }

  return {
    active: () => run !== null,
    now: () => (run ? run.clock.now() : null),
    banner,
    button(favoriteId, title, hub, slot) {
      const b = h('button', { type: 'button', class: 'btn btn-link w-try', 'aria-label': typo(`${ESSAI_TEXT.button} : ${title}`) }, ESSAI_TEXT.button);
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const r = await tryFavorite(favoriteId, { hub, slot });
          hub.say(slot, typo(r.text), !r.ok);
        } finally {
          b.disabled = false;
        }
      });
      return b;
    },
    tryFavorite,
    stop,
    gesture(g) {
      const r = run;
      if (!r) return deps.realSignal({ kind: 'gesture', gesture: g });
      // double toucher sur l'écran du guidage de l'essai (« retour ») : on sort de l'essai
      if (g === 'double' && current(r.sandbox.state.nav).route.screen === 'guide') return stop();
      r.port.emit({ kind: 'gesture', gesture: g });
    },
    signal(s) {
      if (run) run.port.emit(s);
      else deps.realSignal(s);
    },
    glasses(api) {
      if (wrapped?.api === api) return wrapped.proxy;
      const proxy = new Proxy(api, {
        get(target, key) {
          const v: unknown = Reflect.get(target, key);
          if (typeof v !== 'function') return v;
          const fn = v as (...a: unknown[]) => unknown;
          if (!REAL_CALLS.has(key)) return fn.bind(target);
          return (...a: unknown[]) => {
            // « Lunettes », « Y aller » : les vraies lunettes reprennent d'abord l'écran
            stop();
            return fn.apply(target, a);
          };
        },
      });
      wrapped = { api, proxy };
      return proxy;
    },
    sandbox: () => run?.sandbox ?? null,
  };
}
