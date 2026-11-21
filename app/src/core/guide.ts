/**
 * 1.2.10 « Y aller » : moteur du guidage (docs/v1.2.10/PRD-1.2.10.md § 3). Contrat : core/guide-types.ts.
 *
 * Le moteur décide QUOI montrer (GuideState : étape, moment, « Où tu en es », recalcul, chemin à pied à calculer,
 * précision de position, prochain réveil, fin) ; les écrans décident COMMENT (glasses/guide-views.ts). Seul texte
 * rédigé ici : guideNowText, la ligne « Maintenant : … » du téléphone.
 *
 * Fonctions pures et déterministes : même entrée, même sortie ; la mémoire d'entrée n'est jamais modifiée. Sans
 * position utilisable (refusée, sous terre, précision au-delà de 75 m, plus vieille que 60 s), tout se fait à l'heure
 * et au temps réel : pas de virage, pas d'arrêt dépassé, pas de véhicule raté.
 *
 * Mémoire (GuideMemory, gardée avec le trajet suivi) : le contrat, plus quelques champs internes (trajet de la mémoire,
 * moment affiché au dernier pas, recalcul demandé, arrivée constatée, vérification). Le contrôleur la garde telle
 * quelle (JSON).
 *
 * 1.3.0 (PRD-1.3.0 § 4, § 6.3) : marche hors de Belgique (chemin droit de raison `outside` : moment `offMap`, « Où tu en
 * es » à vol d'oiseau, aucun virage) ; vérification au départ et en route (moment `check`, `GuideState.issues`).
 */
import type { Departure, DepartureStops, Journey, LatLon, Leg, NameLang, Names, Settings, Stopover } from './api';
import type {
  CheckIssue,
  GuideFix,
  GuideKind,
  GuideMemory,
  GuidePhase,
  GuideState,
  GuideStatus,
  LocationNeed,
  Moment,
  Then,
  VehicleRef,
  WalkRoute,
  WhereAmI,
} from './guide-types';
import { firstWalkMoved } from './firstwalk';
import { journeyId } from './journeys';
import { isSncbBus, rideName } from './means';
import { headName, placeNoun, vers } from './text';
import { apos } from './typo';
import { displayName, distanceM, hhmm } from './util';
import { bearingDeg, cumulative, knownPoint, LAST_TURN_FREE_M, pointAlong, projectAlong, projectOn, relativeDeg, routePoints, turnsOf, walkProgress } from './guide-walk';

const SEC = 1_000;
const MIN = 60_000;

/** Seuils du guidage (PRD § 3.2, § 3.3, § 3.7, § 3.8). Distances en mètres, durées en ms, vitesses en m/s. */
export const GUIDE = {
  /** virage annoncé à 40 m, ou 15 s à la vitesse de marche si elle est plus grande ; fini 10 m après */
  turnM: 40,
  turnS: 15,
  turnAfterM: 10,
  /** chemin quitté : plus de 30 m pendant 10 s (nouveau chemin demandé, sans message) */
  offRouteM: 30,
  offRouteMs: 10 * SEC,
  /** « Partir maintenant » : fini quand la marche a commencé (40 m) ou 3 min après */
  leaveM: 40,
  leaveMs: 3 * MIN,
  /** « Monter » : à 60 m de l'arrêt et départ dans 15 min ou moins ; fini à la montée ou au départ + 1 min */
  stopM: 60,
  boardAheadMs: 15 * MIN,
  boardAfterMs: 1 * MIN,
  /** « Voie modifiée » : 2 min */
  platformMs: 2 * MIN,
  /** « Prochain arrêt » : trains, trajet de 10 min ou plus, 1 min avant, au plus un toutes les 10 min, jamais dans les
   *  5 min avant « Descends », fini au départ de la gare + 1 min (arrêt d'environ 1 min compté) */
  nextStopRideMs: 10 * MIN,
  nextStopBeforeMs: 1 * MIN,
  nextStopGapMs: 10 * MIN,
  nextStopQuietMs: 5 * MIN,
  nextStopAfterMs: 2 * MIN,
  /** « Descends au prochain arrêt » : à la sortie de l'arrêt d'avant (sinon son heure + 30 s), pas avant 4 min de
   *  l'arrivée ; fini à la descente ou à l'arrivée + 2 min */
  alightEstMs: 30 * SEC,
  alightNotBeforeMs: 4 * MIN,
  alightAfterMs: 2 * MIN,
  /** recalcul : 60 s ; véhicule raté : encore à l'arrêt 2 min après son départ (10 min sans temps réel) */
  replanMs: 60 * SEC,
  missedMs: 2 * MIN,
  missedPlannedMs: 10 * MIN,
  /** arrêt dépassé : plus de 300 m au-delà, en s'éloignant, après son heure ; 3 min */
  passedM: 300,
  passedMs: 3 * MIN,
  /** arrêt dépassé, nouveau trajet qui garde le véhicule : la dernière minute avant sa descente est à « Descends » */
  passedKeptMs: 1 * MIN,
  /**
   * 1.3.1 (contrôle du moteur, remarque 10) : après une descente constatée, « resté à bord » seulement dans les 10 min
   * qui la suivent, et si une position était encore à 150 m de l'arrêt (alightNearM) dans les 3 dernières minutes
   */
  passedAfterMs: 10 * MIN,
  passedSeenMs: 3 * MIN,
  /** « Tu y es » : à 50 m de la destination ; 2 min, puis fin */
  arrivedM: 50,
  arrivedMs: 2 * MIN,
  /** fin d'un trajet (règle 1.2.x) : arrivée + 5 min ; pas parti : encore à 300 m du départ 3 min après le 1er départ */
  endAfterMs: 5 * MIN,
  notLeftM: 300,
  notLeftAfterMs: 3 * MIN,
  /** positions : précision au-delà de 75 m ou plus vieille que 60 s ignorée ; liste des 5 dernières minutes */
  accuracyM: 75,
  freshMs: 60 * SEC,
  fixesMs: 5 * MIN,
  /** « Où tu en es » : 30 s (15 s au lancement) ; affiché par le contrôleur */
  whereMs: 30 * SEC,
  whereLaunchMs: 15 * SEC,
  /**
   * précision demandée : high en marchant (approche de l'arrêt comprise), à l'arrêt dans les 15 min avant le départ
   * (boardAheadMs), à bord avant la descente ; medium 10 min avant de partir et à bord autrement
   */
  mediumBeforeMs: 10 * MIN,
  /** recalcul sans position : au plus toutes les 60 s */
  wakeMaxMs: 60 * SEC,
  wakeMinMs: 1 * SEC,
  /** vitesses : véhicule à partir de 4 m/s, marche jusqu'à 2,5 m/s ; marche comptée à 80 m/min */
  vehicleMs: 4,
  walkMaxMs: 2.5,
  walkMPerMin: 80,
  /** encore à l'arrêt (véhicule raté, pas monté) : 100 m d'un arrêt, 200 m d'une gare */
  atStopM: 100,
  atStationM: 200,
  /** montée constatée : à 100 m au moins de l'arrêt, 50 m sur le trajet, 500 m au plus du trajet */
  boardLeftM: 100,
  boardAlongM: 50,
  onLineM: 500,
  /** véhicule sorti de l'arrêt d'avant la descente : 100 m au-delà */
  leftStopM: 100,
  /** descente constatée : à 150 m de l'arrêt, au pas, au plus tôt 2 min avant l'heure d'arrivée */
  alightNearM: 150,
  alightFromMs: 2 * MIN,
  /** « très juste » : marge de 1 min ou moins */
  tightMin: 1,
  /** 1.3.0 (PRD-1.3.0 § 4) : « Hors de Belgique » (marche sans chemin à pied) : 30 s */
  offMapMs: 30 * SEC,
  /**
   * 1.3.0 (PRD-1.3.0 § 6.3) : vérification 30 s après le lancement (batterie des lunettes sous 20 %, aucune position
   * alors que le guidage en demande) ; en route, plus aucune position depuis 3 min ; moment de 20 s. Plus de 2 min
   * entre deux pas du moteur (téléphone en veille, appli suspendue) : l'attente de la position repart de zéro.
   */
  checkAfterMs: 30 * SEC,
  checkMs: 20 * SEC,
  checkBattery: 20,
  lostMs: 3 * MIN,
  sleepMs: 2 * MIN,
  /**
   * 1.3.1 (A3, I1) : sans temps réel, un véhicule est gardé (pas « raté ») jusqu'à 15 min avant le départ suivant depuis
   * le même arrêt (GuideInput.nextByLeg), jamais moins de missedPlannedMs (10 min) après son heure
   */
  keepBeforeNextMs: 15 * MIN,
  /**
   * 1.3.1 (A2, P1) : encore en marche vers l'arrêt après l'heure du véhicule : sur le chemin de la marche, ou, sans lui,
   * entre son départ et l'arrêt (somme des distances aux deux bouts au plus 1,5 fois leur écart, plus 100 m), du côté
   * du départ
   */
  wayFactor: 1.5,
  wayExtraM: 100,
  /**
   * 1.3.1 (A2, contrôle du moteur) : « est parti » en marchant seulement avec 45 s de positions (la plus ancienne des
   * 90 dernières secondes) : assez pour voir qu'on ne s'éloigne pas de l'arrêt
   */
  walkSeenMs: 45 * SEC,
  /** 1.3.1 (A5, P2) : « Partir maintenant » reste devant le premier virage jusqu'à 15 m de marche sur le chemin (deux positions) */
  leaveHoldM: 15,
  /**
   * 1.3.1 (A6, P3) : « Fais demi-tour » après 15 m à contresens du chemin (plus de 135°), à 0,5 m/s au moins ; fini
   * après 10 m dans le bon sens
   */
  uturnM: 15,
  uturnDeg: 135,
  uturnSpeedMs: 0.5,
  uturnBackM: 10,
  /**
   * positions comptées pour le demi-tour : précision de 20 m ou mieux, lissées sur trois, trois de suite ; « sans
   * avancer » : 5 m près (raccord de la porte)
   */
  uturnAccM: 20,
  uturnFixes: 3,
  uturnAheadM: 5,
  /**
   * 1.3.1 (A6, contrôle du moteur) : chemin en épingle : pas de demi-tour si une partie du chemin, à 30 m au plus
   * (offRouteM), va dans le sens de la marche à 60° près
   */
  uturnWithDeg: 60,
  /** 1.3.1 (B18, P6) : virage suivant à 30 m au plus : annoncé avec celui-ci (« puis à gauche ») */
  turnThenM: 30,
  /** 1.3.1 (B18, P8) : distance d'un virage : médiane des 3 dernières positions (10 s au plus), jamais en hausse */
  turnMedianN: 3,
  turnMedianMs: 10 * SEC,
} as const;

/** Entrée du moteur, recalculé à chaque position, à `wakeAt` et à chaque rafraîchissement du temps réel. */
export interface GuideInput {
  kind: GuideKind;
  journey: Journey;
  title: string;
  now: number;
  /** positions récentes (5 min au plus), la plus récente en dernier */
  fixes: GuideFix[];
  /** chemin de la marche en cours ou prochaine (calculé par le contrôleur à la demande `needRoute`) */
  walk?: { leg: number; route: WalkRoute };
  settings: Settings;
  /** lancement du guidage (epoch ms) */
  startedAt: number;
  /** position au lancement (fin anticipée : pas parti) */
  origin?: LatLon;
  /** « Si tu le rates » (règle 1.2.5), si connu */
  missed?: { arr: number; laterMin: number };
  /**
   * Facultatif : arrêts du véhicule en cours après la descente (DepartureStops du départ), pour « Descends à … »
   * quand l'arrêt est dépassé, et (genre trip) pour chercher le nouveau trajet depuis cet arrêt, à son heure. Sans eux :
   * l'arrêt où commence le nouveau trajet.
   */
  beyond?: Stopover[];
  /**
   * Genre trip : arrêts suivants du véhicule, par rang d'étape en véhicule (lus au début de chaque étape à bord) ; donnés,
   * ils remplacent `beyond` (genre ride : la seule étape).
   */
  beyondByLeg?: Record<number, Stopover[]>;
  /** 1.3.0 (PRD-1.3.0 § 6.3) : batterie des lunettes (0 à 100), si connue (signal `device` de la plateforme) */
  battery?: number;
  /**
   * 1.3.1 (A3, B16) : par rang d'étape en véhicule, le départ suivant depuis le même arrêt, s'il est connu : pour le
   * premier véhicule, celui d'un autre trajet proposé (comme « Si tu le rates ») ; pour une correspondance très juste
   * (tightLegs), le suivant de la même ligne, même destination, lu au tableau de l'arrêt par le contrôleur.
   */
  nextByLeg?: Record<number, { vehicle: VehicleRef; depAt: number; rt: boolean }>;
  /**
   * 1.3.1 (PRD-1.3.1 § 14, R1) : sortie du métro ou du prémétro par rang de la marche qui suit une descente à un arrêt
   * STIB sous terre (contrôleur : exits.json, core/exits.ts) ; le moment walk (B17) la dit en 3e ligne pâle.
   */
  exitByLeg?: Record<number, string>;
}

/* ------------------------------ Mémoire ------------------------------ */

type ReplanReason = 'missed' | 'cancelled' | 'late' | 'passed';

/** Recalcul demandé (correspondance ratée, supprimé, raté, arrêt dépassé), gardé jusqu'au nouveau trajet. */
interface Pending {
  reason: ReplanReason;
  /** trajet et étape en cause */
  jid: string;
  leg: number;
  /** constaté à (epoch ms) */
  t: number;
  /** nouveau trajet à chercher depuis `from` à partir de `at` */
  from: LatLon & { areaId?: string; name?: Names };
  at: number;
  lost: { vehicle: VehicleRef; depAt: number };
  /** arrivée du trajet perdu (« 33 min plus tard ») */
  oldArr: number;
  /** arrêt dépassé, et le voyage du véhicule (« Descends à » : il continue dans le nouveau trajet) */
  passed?: Names;
  /** arrêt dépassé : l'arrêt suivant du véhicule, où descendre, et son heure (arrêts suivants connus) */
  getOff?: Names;
  getOffAt?: number;
  tripId?: string;
  /** genre ride, arrêt dépassé : aucun recalcul demandé */
  local?: boolean;
  /** 1.3.1 (A3, I1) : véhicule sans temps réel, resté à l'arrêt : on ne sait pas s'il est passé (Moment replan.planned) */
  planned?: boolean;
  /** véhicule où l'on est (montée constatée), retrouvé dans le nouveau trajet s'il le garde (replanJourney) */
  onBoard?: { tripId?: string; schedDep: number; at: number };
  /** aucun autre trajet trouvé (replanNone), epoch ms */
  none?: number;
  /** nouveau trajet adopté par le contrôleur */
  swap?: { jid: string; at: number };
}

/**
 * 1.3.0 (PRD-1.3.0 § 6.3) : mémoire de la vérification, pour tout le guidage (un nouveau trajet adopté la garde).
 * Epoch ms.
 */
interface Chk {
  /** premier pas du moteur pour ce guidage ; la vérification du lancement suppose qu'il a vu le lancement (30 s) */
  t0: number;
  /** pas précédent */
  at: number;
  /** position demandée sans interruption depuis (besoin de position, pas de veille) ; absent : pas demandée */
  need?: number;
  /** dernière position reçue pendant ce guidage (même imprécise : la position marche) */
  fix?: number;
  /** vérification du lancement : batterie sous 20 % ; aucune position alors que le guidage en demande (absent : à faire) */
  bat?: boolean;
  noPos?: boolean;
  /** problèmes déjà dits par un moment `check` (chacun une fois par guidage) */
  told: CheckIssue['kind'][];
}

/** La mémoire du moteur : le contrat et ses champs internes. */
interface Mem extends GuideMemory {
  /** trajet auquel se rapportent boarded, alighted, cur */
  jid?: string;
  /** moment affiché au dernier pas (sa fin le range dans `dismissed`) */
  cur?: string;
  re?: Pending;
  /** arrivée constatée (epoch ms) et par la position ? */
  arrivedAt?: number;
  arrivedByFix?: boolean;
  chk?: Chk;
  /** 1.3.1 (B9) : prochain arrêt le plus loin vu par la position, à bord de l'étape `leg` (la progression ne recule pas) */
  rideNext?: { leg: number; s: number };
  /** 1.3.1 (B18, P8) : distance du virage montré au dernier pas (elle ne remonte pas) */
  turnDist?: { id: string; d: number };
  /**
   * 1.3.1 (vrai chemin partout, core/firstwalk.ts) : trajet `jid` dont la première marche porte `min` minutes d'après
   * son vrai chemin ; `at` : l'instant (epoch ms) où ces minutes sont arrivées pendant le guidage de ce même trajet
   * (l'heure de partir a alors sauté en arrière : « Partir maintenant » compte ses 3 min depuis cet instant). Absent au
   * lancement et après un nouveau trajet : la règle de la 1.3.0 (l'heure de partir, au plus tôt le lancement).
   */
  walk0?: { jid: string; min: number; at?: number };
  /**
   * 1.3.1 (A2, contrôle du moteur) : vu à l'arrêt de montée (60 m) du véhicule de l'étape `leg`, à `at` : ce qui s'en
   * éloigne ensuite au pas le long de la ligne est le véhicule (bouchon, zone piétonne) : montée constatée (observe)
   */
  atStop?: { leg: number; at: number };
  /**
   * 1.3.1 (remarque 10) : rang de l'étape en véhicule dont on a quitté l'arrêt de descente à pied (une position au pas à
   * plus de 150 m de lui après la descente constatée) : ce véhicule ne nous emporte plus (justLeft)
   */
  walkedOff?: number;
}

const ISSUE_KINDS: readonly CheckIssue['kind'][] = ['battery', 'noPosition', 'positionLost'];

/** Copie défensive de la mémoire de la vérification. */
function readChk(x: unknown): Chk | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const k = x as Partial<Chk>;
  if (!Number.isFinite(k.t0) || !Number.isFinite(k.at)) return undefined;
  const out: Chk = { t0: k.t0 as number, at: k.at as number, told: Array.isArray(k.told) ? k.told.filter((s) => ISSUE_KINDS.includes(s)) : [] };
  if (Number.isFinite(k.need)) out.need = k.need;
  if (Number.isFinite(k.fix)) out.fix = k.fix;
  if (typeof k.bat === 'boolean') out.bat = k.bat;
  if (typeof k.noPos === 'boolean') out.noPos = k.noPos;
  return out;
}

const MEM_MAX = 400;

/** Minutes entières, sans « -0 ». */
const roundMin = (ms: number): number => Math.round(ms / MIN) || 0;

/** Mémoire neuve, à chaque nouveau guidage (jamais reprise d'un autre trajet guidé). */
export function newGuideMemory(): GuideMemory {
  return { v: 1, dismissed: [], shown: {} };
}

/** Copie défensive d'une mémoire gardée (champs absents ou abîmés tolérés). */
function readMem(mem: GuideMemory | null | undefined): Mem {
  const x = (mem && typeof mem === 'object' ? mem : {}) as Partial<Mem>;
  const out: Mem = {
    v: 1,
    dismissed: Array.isArray(x.dismissed) ? x.dismissed.filter((s): s is string => typeof s === 'string') : [],
    shown: {},
  };
  if (x.shown && typeof x.shown === 'object') for (const [k, v] of Object.entries(x.shown)) if (Number.isFinite(v)) out.shown[k] = v;
  if (Number.isFinite(x.lastNextStopAt)) out.lastNextStopAt = x.lastNextStopAt;
  if (x.boarded && Number.isInteger(x.boarded.leg) && Number.isFinite(x.boarded.at)) out.boarded = { ...x.boarded };
  if (x.alighted && Number.isInteger(x.alighted.leg) && Number.isFinite(x.alighted.at)) out.alighted = { ...x.alighted };
  if (typeof x.jid === 'string') out.jid = x.jid;
  if (typeof x.cur === 'string') out.cur = x.cur;
  if (x.re && typeof x.re === 'object' && typeof x.re.jid === 'string') {
    out.re = { ...x.re, from: { ...x.re.from }, lost: { ...x.re.lost, vehicle: { ...x.re.lost?.vehicle } } };
    if (x.re.swap) out.re.swap = { ...x.re.swap };
  }
  if (Number.isFinite(x.arrivedAt)) out.arrivedAt = x.arrivedAt;
  if (x.arrivedByFix) out.arrivedByFix = true;
  const chk = readChk(x.chk);
  if (chk) out.chk = chk;
  if (x.rideNext && Number.isInteger(x.rideNext.leg) && Number.isInteger(x.rideNext.s)) out.rideNext = { leg: x.rideNext.leg, s: x.rideNext.s };
  if (x.turnDist && typeof x.turnDist.id === 'string' && Number.isFinite(x.turnDist.d)) out.turnDist = { id: x.turnDist.id, d: x.turnDist.d };
  if (x.walk0 && typeof x.walk0.jid === 'string' && Number.isFinite(x.walk0.min)) {
    out.walk0 = { jid: x.walk0.jid, min: x.walk0.min };
    if (Number.isFinite(x.walk0.at)) out.walk0.at = x.walk0.at;
  }
  if (x.atStop && Number.isInteger(x.atStop.leg) && Number.isFinite(x.atStop.at)) out.atStop = { leg: x.atStop.leg, at: x.atStop.at };
  if (Number.isInteger(x.walkedOff)) out.walkedOff = x.walkedOff;
  return out;
}

/** Garde la mémoire bornée : au-delà de MEM_MAX entrées, les plus anciennes partent (moments d'autres trajets d'abord). */
function prune(m: Mem, jid: string): void {
  const ids = Object.keys(m.shown);
  if (ids.length + m.dismissed.length <= MEM_MAX) return;
  const mine = (id: string) => id.includes(jid);
  for (const id of ids) if (!mine(id)) delete m.shown[id];
  m.dismissed = m.dismissed.filter(mine).slice(-MEM_MAX / 2);
  const rest = Object.entries(m.shown).sort((a, b) => a[1] - b[1]);
  while (rest.length > MEM_MAX / 2) delete m.shown[rest.shift()![0]];
}

/**
 * Effacer un moment d'un toucher : il ne revient pas (un contenu qui oblige à agir, nouvelle voie ou nouveau trajet,
 * vient avec un nouvel id).
 */
export function dismissMoment(mem: GuideMemory, id: string, now: number): GuideMemory {
  const m = readMem(mem);
  if (!m.dismissed.includes(id)) m.dismissed.push(id);
  if (m.shown[id] === undefined) m.shown[id] = now;
  if (m.cur === id) delete m.cur;
  return m;
}

/**
 * Le contrôleur n'a trouvé aucun autre trajet après une demande `state.replan` : moment « Pas d'autre trajet trouvé »
 * (60 s), le guidage continue sur l'ancien trajet, sans nouvelle demande pour la même cause.
 */
export function replanNone(mem: GuideMemory, now: number): GuideMemory {
  const m = readMem(mem);
  if (m.re && !m.re.swap && m.re.none === undefined) m.re.none = now;
  return m;
}

/* ------------------------------ Étapes ------------------------------ */

const isRide = (l: Leg): boolean => l.kind === 'ride';
/** Un vrai train (pas un bus de remplacement de la SNCB) : voies, « Prochain arrêt ». */
const isTrain = (l: Leg): boolean => l.mode === 'train' && !isSncbBus(l);
/** Voie en vigueur et voie modifiée. */
const platformOf = (l: Leg): string | undefined => l.newPlatform || l.platform || undefined;
const platformChanged = (l: Leg): boolean => !!l.newPlatform && l.newPlatform !== l.platform;

/**
 * 1.3.1 (B13, U6) : heure prévue d'un train en retard d'au moins 1 min (temps réel), pour l'écrire comme en gare
 * (« IC 07:42 +2 ») ; absente sinon (à l'heure, en avance, sans temps réel, bus, tram, métro).
 */
function trainSched(l: Leg): number | undefined {
  return isTrain(l) && l.rt && !l.cancelled && Number.isFinite(l.schedDep) && l.dep - l.schedDep >= MIN ? l.schedDep : undefined;
}

/**
 * 1.3.1 (B16, U4) : marge d'une correspondance, en minutes exactes (avec les secondes) : départ de l'étape `k` moins
 * l'arrivée du véhicule d'avant et les marches entre eux ; undefined sans véhicule d'avant.
 */
export function connectionMargin(legs: readonly Leg[], k: number): number | undefined {
  const b = legs[k];
  if (!b || b.kind !== 'ride') return undefined;
  let p = -1;
  for (let i = k - 1; i >= 0; i--) if (legs[i].kind === 'ride') { p = i; break; }
  if (p < 0) return undefined;
  let walk = 0;
  for (let i = p + 1; i < k; i++) if (legs[i].kind === 'walk') walk += walkMinOf(legs[i]);
  return (b.dep - legs[p].arr) / MIN - walk;
}

/** 1.3.1 (B16, U4) : rangs des correspondances très juste (marge de 1 min ou moins), non supprimées. */
export function tightLegs(j: Pick<Journey, 'legs'>): number[] {
  const out: number[] = [];
  j.legs.forEach((l, k) => {
    const mg = connectionMargin(j.legs, k);
    if (mg !== undefined && !l.cancelled && mg <= GUIDE.tightMin) out.push(k);
  });
  return out;
}

export function vehicleRef(l: Pick<Leg, 'op' | 'mode' | 'line' | 'cat'>): VehicleRef {
  const v: VehicleRef = {};
  if (l.op) v.op = l.op;
  if (l.mode) v.mode = l.mode;
  if (l.line) v.line = l.line;
  if (l.cat) v.cat = l.cat;
  return v;
}

/** Minutes d'une marche (au moins 1). */
function walkMinOf(l: Leg): number {
  return Math.max(1, Math.round(l.walkMin ?? (l.arr - l.dep) / MIN));
}

/** Arrêts d'une étape en véhicule (montée et descente au moins). */
function stopsOf(l: Leg): Stopover[] {
  if (l.stops && l.stops.length >= 2) return l.stops;
  return [
    { name: l.from.name, ...(l.from.areaId ? { areaId: l.from.areaId } : {}), sched: l.schedDep, est: l.dep, lat: l.from.lat, lon: l.from.lon },
    { name: l.to.name, ...(l.to.areaId ? { areaId: l.to.areaId } : {}), sched: l.schedArr, est: l.arr, lat: l.to.lat, lon: l.to.lon },
  ];
}

/** Position de chaque arrêt d'une étape (la montée et la descente : celles de l'étape si l'arrêt n'en a pas). */
function stopPoints(l: Leg, stops: Stopover[]): (LatLon | undefined)[] {
  return stops.map((s, i) => {
    if (knownPoint(s)) return { lat: s.lat, lon: s.lon };
    if (i === 0 && knownPoint(l.from)) return { lat: l.from.lat, lon: l.from.lon };
    if (i === stops.length - 1 && knownPoint(l.to)) return { lat: l.to.lat, lon: l.to.lon };
    return undefined;
  });
}

const place = (p: Leg['from']): LatLon & { areaId?: string; name?: Names } => ({
  lat: p.lat,
  lon: p.lon,
  ...(p.areaId ? { areaId: p.areaId } : {}),
  name: p.name,
});

/* ------------------------------ Contexte ------------------------------ */

interface Ctx {
  in: GuideInput;
  j: Journey;
  legs: Leg[];
  now: number;
  m: Mem;
  guided: boolean;
  /** dernière position utilisable, la précédente (5 s à 2 min avant), vitesse (m/s) */
  fix: GuideFix | null;
  prev: GuideFix | null;
  speed?: number;
  /** marche de départ commencée (40 m du point de départ) */
  started: boolean;
  /** progression sur le chemin à pied fourni, si la position et le chemin sont là */
  walkPr?: { leg: number; alongM: number; offM: number; remainingM: number; route: WalkRoute };
  /** 1.3.0 : problèmes vrais maintenant (vérification, guidage avec messages seulement) */
  issues: CheckIssue[];
  /** 1.3.1 (vrai chemin partout) : le trajet porte une heure de partir avancée d'après le vrai chemin (firstWalkMoved) */
  leaveMoved?: boolean;
  /** 1.3.1 : instant où cette heure avancée est arrivée pendant le guidage (Mem.walk0.at) ; absent : jamais */
  leaveKnownAt?: number;
}

function fixesOf(input: GuideInput): GuideFix[] {
  return (input.fixes ?? [])
    .filter((f) => !!f && Number.isFinite(f.lat) && Number.isFinite(f.lon) && Number.isFinite(f.at) && input.now - f.at <= GUIDE.fixesMs && f.at <= input.now + 5 * SEC)
    .filter((f) => (f.accuracy ?? 0) <= GUIDE.accuracyM)
    .sort((a, b) => a.at - b.at);
}

function context(input: GuideInput, m: Mem): Ctx {
  const j = input.journey;
  const now = input.now;
  const good = fixesOf(input);
  const last = good[good.length - 1];
  const fix = last && now - last.at <= GUIDE.freshMs ? last : null;
  let prev: GuideFix | null = null;
  if (fix) for (let i = good.length - 2; i >= 0; i--) if (fix.at - good[i].at >= 5 * SEC) { prev = fix.at - good[i].at <= 2 * MIN ? good[i] : null; break; }
  let speed: number | undefined;
  if (fix && Number.isFinite(fix.speed) && (fix.speed as number) >= 0) speed = fix.speed;
  else if (fix && prev) speed = distanceM(prev, fix) / ((fix.at - prev.at) / SEC);
  const legs = j.legs;
  const start = knownPoint(input.origin) ? input.origin : legs[0] && knownPoint(legs[0].from) ? legs[0].from : undefined;
  const started = !!(fix && start && distanceM(fix, start) >= GUIDE.leaveM);
  const c: Ctx = { in: input, j, legs, now, m, guided: input.settings?.display?.guide !== false, fix, prev, speed, started, issues: [] };
  const w = input.walk;
  if (fix && w && w.route && legs[w.leg]?.kind === 'walk') {
    const pr = walkProgress(w.route, fix);
    c.walkPr = { leg: w.leg, alongM: pr.alongM, offM: pr.offRouteM, remainingM: pr.remainingM, route: w.route };
  }
  return c;
}

const slow = (c: Ctx): boolean => (c.speed ?? 0) < GUIDE.walkMaxMs;
const fast = (c: Ctx): boolean => (c.speed ?? 0) >= GUIDE.vehicleMs;
const atStopM = (l: Leg): number => (isTrain(l) ? GUIDE.atStationM : GUIDE.atStopM);

/** Distance de la position à un point connu (Infinity sinon). */
function distTo(c: Ctx, p: { lat: number; lon: number } | undefined): number {
  return c.fix && knownPoint(p) ? distanceM(c.fix, p) : Infinity;
}

/** Projection de la position sur les arrêts d'une étape en véhicule ; `all` : tous les arrêts ont une position. */
function rideProj(c: Ctx, l: Leg): { alongM: number; offM: number; totalM: number; stopAlong: number[]; all: boolean } | null {
  if (!c.fix) return null;
  const stops = stopsOf(l);
  const pts = stopPoints(l, stops);
  const keep = pts.map((p, i) => ({ p, i })).filter((x): x is { p: LatLon; i: number } => !!x.p);
  if (keep.length < 2) return null;
  const line = keep.map((x) => x.p);
  const cum = cumulative(line);
  const pr = projectOn(line, c.fix, cum);
  const stopAlong = stops.map(() => NaN);
  keep.forEach((x, k) => (stopAlong[x.i] = cum[k]));
  return { alongM: pr.alongM, offM: pr.offM, totalM: pr.totalM, stopAlong, all: keep.length === stops.length };
}

/** Position sur la ligne du véhicule, avant l'arrêt de descente : encore à bord. */
function riding(c: Ctx, k: number): boolean {
  const l = c.legs[k];
  const p = rideProj(c, l);
  if (!p || p.offM > GUIDE.onLineM / 2) return false;
  return p.alongM < p.totalM - GUIDE.alightNearM && distTo(c, l.to) > GUIDE.alightNearM;
}

/** Encore à l'arrêt de montée, au pas (pas dans le véhicule). */
function stillAtStop(c: Ctx, k: number): boolean {
  const l = c.legs[k];
  return !!c.fix && slow(c) && distTo(c, l.from) <= atStopM(l);
}

/** 1.3.1 : positions utilisables des `ms` dernières millisecondes, jusqu'à la dernière (c.fix) comprise, la plus ancienne d'abord. */
function recentFixes(c: Ctx, ms: number): GuideFix[] {
  const f0 = c.fix;
  if (!f0) return [];
  return fixesOf(c.in).filter((f) => f.at <= f0.at && f0.at - f.at <= ms);
}

/**
 * 1.3.1 (A2, P1) : la position dit qu'on marche encore vers l'arrêt où finit la marche `w` : au pas, plus loin que
 * l'arrêt (walkingStill, à vol d'oiseau comme la phase), et sur le chemin : celui de cette marche (30 m), sinon (pas
 * encore calculé, quitté un moment) entre le départ de la marche et l'arrêt (ellipse GUIDE.wayFactor, wayExtraM), du
 * côté du départ (un véhicule parti de l'arrêt dans l'autre sens n'y est pas). Première marche : partie du lancement
 * (40 m, c.started), sinon on est encore chez soi (règle « pas parti »). Risque connu (note P1) : un bus pris dans un
 * bouchon, à l'allure d'un piéton, qui repart le long du chemin de la marche.
 */
function walkingTo(c: Ctx, w: number): boolean {
  const wl = c.legs[w];
  if (!c.fix || wl?.kind !== 'walk' || !slow(c) || !walkingStill(c, w) || (w === 0 && !c.started)) return false;
  // contrôle du moteur : vers l'arrêt, pas en s'en éloignant. Un bus ou un tram lent (bouchon, zone piétonne) qui repart
  // de l'arrêt du côté d'où l'on vient passait pour une marche vers l'arrêt : « Fais demi-tour », puis « Ton bus est
  // parti » et un nouveau trajet alors qu'on est dedans. Vu à l'arrêt avant : la montée est constatée au pas (observe,
  // mémoire atStop). Sinon (téléphone verrouillé à l'arrêt, réveillé dans le véhicule) : comparé à la plus ancienne
  // position de la dernière minute
  const old = recentFixes(c, GUIDE.freshMs)[0];
  const before = old && old !== c.fix ? old : undefined;
  const pr = c.walkPr?.leg === w ? c.walkPr : undefined;
  if (pr && pr.route.source === 'osm' && pr.offM <= GUIDE.offRouteM) {
    const was = before ? projectOn(routePoints(pr.route), before) : undefined;
    return !was || was.offM > GUIDE.offRouteM || pr.alongM >= was.alongM - GUIDE.uturnM;
  }
  const a = w === 0 && knownPoint(c.in.origin) ? c.in.origin : wl.from;
  const b = wl.to;
  if (!knownPoint(a) || !knownPoint(b)) return false;
  const ab = distanceM(a, b);
  const pa = distanceM(c.fix, a);
  const pb = distanceM(c.fix, b);
  if (before && pb > distanceM(before, b) + GUIDE.offRouteM) return false;
  if (pa + pb > ab * GUIDE.wayFactor + GUIDE.wayExtraM) return false;
  // angle aigu en B entre le départ et la position : pas au-delà de l'arrêt
  return pa * pa < ab * ab + pb * pb;
}

/** 1.3.1 (A2, P1) : marche restante de la marche `w` depuis la position, en ms (80 m/min ; ligne droite × 1,3). */
function walkLeftMs(c: Ctx, w: number): number {
  const wl = c.legs[w];
  const pr = c.walkPr?.leg === w ? c.walkPr : undefined;
  if (c.fix && pr && pr.offM <= GUIDE.offRouteM) return ((pr.route.source === 'straight' ? pr.remainingM * 1.3 : pr.remainingM) / GUIDE.walkMPerMin) * MIN;
  if (c.fix && knownPoint(wl.to)) return ((distanceM(c.fix, wl.to) * 1.3) / GUIDE.walkMPerMin) * MIN;
  return Math.max(0, wl.arr - c.now);
}

/**
 * 1.3.1 (A3, I1) : sans temps réel, jusqu'à quand le véhicule de l'étape `k` est gardé (pas « raté ») : 15 min avant le
 * départ suivant depuis le même arrêt s'il est connu (GuideInput.nextByLeg), jamais moins de 10 min après son heure.
 */
function keptUntil(c: Ctx, k: number): number {
  const l = c.legs[k];
  const floor = l.dep + GUIDE.missedPlannedMs;
  const nx = c.in.nextByLeg?.[k];
  if (!nx || !Number.isFinite(nx.depAt) || nx.depAt <= l.dep) return floor;
  return Math.max(floor, nx.depAt - GUIDE.keepBeforeNextMs);
}

/* ------------------------------ Constatations (position) ------------------------------ */

const boardedOn = (m: Mem, k: number): boolean => m.boarded?.leg === k && !(m.alighted && m.alighted.leg >= k);
const alightedFrom = (m: Mem, k: number): boolean => !!m.alighted && m.alighted.leg >= k;

/** Rang de l'étape en véhicule précédente (-1 sinon). */
function prevRide(legs: Leg[], k: number): number {
  for (let i = k - 1; i >= 0; i--) if (legs[i].kind === 'ride') return i;
  return -1;
}
function nextRide(legs: Leg[], from: number): number {
  for (let i = Math.max(0, from); i < legs.length; i++) if (legs[i].kind === 'ride') return i;
  return -1;
}

/** Arrêts du véhicule de l'étape `k` après sa descente (GuideInput.beyondByLeg, sinon beyond), s'ils sont connus. */
function beyondOf(c: Ctx, k: number): Stopover[] {
  if (c.in.beyondByLeg) return c.in.beyondByLeg[k] ?? [];
  return c.in.beyond ?? [];
}

/** Une position récente (depuis `since`) à l'arrêt de montée de l'étape (60 m), ou rien si l'arrêt n'a pas de position. */
function seenAtStop(c: Ctx, l: Leg, since: number): boolean {
  if (!knownPoint(l.from)) return false;
  return fixesOf(c.in).some((f) => f.at >= since && distanceM(f, l.from) <= GUIDE.stopM);
}

/** Montée et descente constatées par la position (vitesse le long du trajet), gardées dans la mémoire. */
function observe(c: Ctx): void {
  const { legs, now, m } = c;
  if (!c.fix) return;
  // montée : la première étape en véhicule pas encore faite, l'étape d'avant finie
  const after = Math.max(m.alighted?.leg ?? -1, m.boarded?.leg ?? -1);
  // contrôle du moteur (A2) : vu à l'arrêt de montée du prochain véhicule (60 m), dans les 15 min avant son départ ou après
  const kb = nextRide(legs, after + 1);
  if (kb >= 0 && !legs[kb].cancelled && now >= legs[kb].dep - GUIDE.boardAheadMs && distTo(c, legs[kb].from) <= GUIDE.stopM) m.atStop = { leg: kb, at: now };
  for (let k = nextRide(legs, after + 1); k >= 0; k = nextRide(legs, k + 1)) {
    const l = legs[k];
    // 1.3.1 (A3, I1) : un véhicule sans temps réel gardé plus longtemps (keptUntil) : sa montée se constate jusque-là
    if (l.cancelled || now > Math.max(l.arr + 10 * MIN, l.rt ? 0 : keptUntil(c, k) + GUIDE.boardAfterMs)) continue;
    if (now < l.dep - 3 * MIN) break;
    const p = prevRide(legs, k);
    if (p >= 0 && !alightedFrom(m, p) && now < legs[p].arr) break;
    // correspondance : monté seulement après être passé à l'arrêt de montée depuis l'arrivée du véhicule d'avant ; sinon
    // une position encore prise dans ce véhicule (en retard, traitée en retard, ou qui continue au-delà de l'arrêt), qui
    // roule près de la ligne suivante, passait pour la montée (descente jamais constatée, arrêt dépassé jamais vu)
    if (p >= 0 && !seenAtStop(c, l, legs[p].arr - GUIDE.alightFromMs)) break;
    // contrôle du moteur (A2, A3) : vu à l'arrêt, puis à 100 m le long de la ligne après l'heure du véhicule : monté, même
    // au pas (bus, tram, métro dans un bouchon ou une zone piétonne ; pas un train : on fait 100 m sur un quai)
    const crept = m.atStop?.leg === k && !isTrain(l) && now >= l.dep;
    if ((fast(c) || crept) && distTo(c, l.from) >= GUIDE.boardLeftM) {
      const pr = rideProj(c, l);
      const ok = pr ? pr.offM <= GUIDE.onLineM && pr.alongM >= GUIDE.boardAlongM : knownPoint(l.from);
      if (ok) {
        m.boarded = { leg: k, at: now };
        if (m.alighted && m.alighted.leg >= k) delete m.alighted;
      }
    }
    break;
  }
  // descente : l'étape où l'on est monté, sinon celle en cours d'après l'heure
  let b = m.boarded && !alightedFrom(m, m.boarded.leg) ? m.boarded.leg : -1;
  if (b < 0) b = legs.findIndex((l, i) => l.kind === 'ride' && !alightedFrom(m, i) && !l.cancelled && now >= l.dep && now < l.arr + 10 * MIN);
  if (b >= 0) {
    const l = legs[b];
    if (now >= l.arr - GUIDE.alightFromMs && slow(c) && distTo(c, l.to) <= GUIDE.alightNearM) m.alighted = { leg: b, at: now };
  }
  // 1.3.1 (remarque 10) : descendu, puis au pas à plus de 150 m de l'arrêt : reparti à pied (vitesse connue seulement :
  // une position seule au réveil du téléphone ne dit pas l'allure)
  const al = m.alighted;
  if (al && c.speed !== undefined && slow(c) && knownPoint(legs[al.leg]?.to) && distTo(c, legs[al.leg].to) > GUIDE.alightNearM) m.walkedOff = al.leg;
}

/* ------------------------------ Où l'on est ------------------------------ */

interface Loc {
  phase: GuidePhase;
  /** étape en cours (rang dans legs), -1 une fois arrivé */
  leg: number;
}

/** Arrivée : à 50 m de la destination (sans position : heure d'arrivée) ; dernière étape en véhicule : descente faite. */
function arrivedNow(c: Ctx): { yes: boolean; byFix: boolean } {
  const { legs, now, m, j } = c;
  const L = legs.length;
  if (!L) return { yes: true, byFix: false };
  const last = legs[L - 1];
  if (last.kind === 'ride') {
    // descente constatée (immobile à quai), puis emporté par le véhicule : resté à bord (arrêt dépassé), pas arrivé
    if (alightedFrom(m, L - 1)) return carriedOn(c) ? { yes: false, byFix: false } : { yes: true, byFix: true };
    // encore à bord d'après la position (véhicule en retard, ou emporté au-delà de l'arrêt) : pas arrivé
    const aboard = boardedOn(m, L - 1) && (riding(c, L - 1) || (fast(c) && distTo(c, last.to) > GUIDE.alightNearM));
    // 1.3.1 (A2, A3 ; contrôle du moteur) : trajet qui finit par un véhicule, jamais monté, et la position dit qu'on
    // l'attend encore à son arrêt (en retard sans temps réel : gardé) ou qu'on marche encore vers lui : pas arrivé, jamais
    // « Tu y es » à l'arrêt de départ ou en pleine rue à l'heure où il arrive ; detect dit ensuite s'il est raté
    const notLeft = c.in.kind === 'trip' && !boardedOn(m, L - 1) && !last.cancelled && (stillAtStop(c, L - 1) || (L >= 2 && c.legs[L - 2].kind === 'walk' && walkingTo(c, L - 2)));
    if (now >= last.arr && !aboard && !notLeft) return { yes: true, byFix: false };
    return { yes: false, byFix: false };
  }
  if (c.fix && knownPoint(last.to) && distanceM(c.fix, last.to) <= GUIDE.arrivedM) {
    // pas avant d'avoir quitté le départ (trajet à pied d'une rue) ni avant la dernière marche
    const before = nextRide(legs, 0) >= 0 && !(alightedFrom(m, prevRide(legs, L - 1)) || now >= legs[prevRide(legs, L - 1)].arr);
    if (!before) return { yes: true, byFix: true };
  }
  if (now >= j.arr && !(c.fix && c.walkPr?.leg === L - 1 && c.walkPr.remainingM > GUIDE.arrivedM)) {
    if (!c.fix || !knownPoint(last.to) || distanceM(c.fix, last.to) <= GUIDE.arrivedM) return { yes: true, byFix: false };
    // position connue, loin de la destination : on marche encore (fin au plus tard par la règle 1.2.x)
    return { yes: false, byFix: false };
  }
  return { yes: false, byFix: false };
}

/**
 * Dernière étape en véhicule, descente constatée (au pas près de l'arrêt, le temps de l'arrêt en gare), puis vitesse de
 * véhicule à plus de 150 m de l'arrêt : la personne est restée à bord.
 */
function carriedOn(c: Ctx): boolean {
  const L = c.legs.length;
  const last = c.legs[L - 1];
  return !!last && last.kind === 'ride' && alightedFrom(c.m, L - 1) && fast(c) && distTo(c, last.to) > GUIDE.alightNearM;
}

/**
 * La marche `w` n'est pas finie d'après la position : encore loin de son arrivée (à vol d'oiseau). Jamais d'après le
 * chemin gardé : le contrôleur n'en garde qu'un ; si la phase en dépendait, deux marches se le disputaient (avec le
 * chemin de l'une, on se croit arrivé et on demande celui de la suivante ; sans lui, on se croit encore en marche).
 */
function walkingStill(c: Ctx, w: number): boolean {
  const l = c.legs[w];
  if (!c.fix || !knownPoint(l.to)) return false;
  const next = c.legs[w + 1];
  return distanceM(c.fix, l.to) > (next ? atStopM(next) : GUIDE.arrivedM);
}

/**
 * Prochain arrêt à bord (le premier non passé) : par la position si les arrêts ont tous une position, sinon l'heure.
 * 1.3.1 (B9, conseil du manager du pôle) : jamais avant le plus loin vu par la position pendant cette étape (mémoire
 * `rideNext`), à l'heure non plus (position perdue) : le bruit de la position autour d'un arrêt ne fait plus reculer la
 * ligne de progression.
 */
function nextStopOf(c: Ctx, k: number): number {
  const l = c.legs[k];
  const stops = stopsOf(l);
  const n = stops.length;
  const p = rideProj(c, l);
  const seen = c.m.rideNext?.leg === k ? c.m.rideNext.s : 0;
  if (p && p.all && p.offM <= GUIDE.onLineM / 2) {
    let s = n - 1;
    for (let x = 1; x < n - 1; x++) {
      if (p.stopAlong[x] > p.alongM + 30) {
        s = x;
        break;
      }
    }
    s = Math.max(s, seen);
    c.m.rideNext = { leg: k, s };
    return s;
  }
  for (let s = 1; s < n - 1; s++) if (stops[s].est > c.now) return Math.max(s, seen);
  return n - 1;
}

function locate(c: Ctx): Loc {
  const { legs, now, m, j } = c;
  const L = legs.length;
  const kind = c.in.kind;
  // 1. l'heure : la première étape pas finie
  let i = legs.findIndex((l) => l.arr > now);
  if (i < 0) i = L - 1;
  // 2. constatations
  if (m.alighted && m.alighted.leg + 1 > i) i = Math.min(L - 1, m.alighted.leg + 1);
  if (m.boarded && !alightedFrom(m, m.boarded.leg)) {
    const b = m.boarded.leg;
    if (b > i) i = b;
    else if (b < i && (riding(c, b) || (fast(c) && distTo(c, legs[b].to) > GUIDE.alightNearM))) i = b;
  }
  // jamais monté, encore à l'arrêt de montée d'un véhicule déjà passé d'après l'heure : on y attend (raté ou en retard)
  const k0 = nextRide(legs, Math.max(m.alighted?.leg ?? -1, m.boarded?.leg ?? -1) + 1);
  if (k0 >= 0 && k0 < i && !boardedOn(m, k0) && now >= legs[k0].dep && stillAtStop(c, k0)) i = k0;
  // 1.3.1 (A2, P1) : jamais monté, l'heure du véhicule passée, et la position dit qu'on marche encore vers son arrêt : à
  // pied (virages compris), jamais « à bord » en pleine rue ; detect dit ensuite s'il est parti
  if (k0 >= 1 && k0 <= i && legs[k0 - 1].kind === 'walk' && !boardedOn(m, k0) && now >= legs[k0].dep && walkingTo(c, k0 - 1)) {
    return { phase: { kind: 'walk', leg: k0 - 1 }, leg: k0 - 1 };
  }
  const l = legs[i];
  if (l.kind === 'walk') {
    const k = legs[i + 1]?.kind === 'ride' ? i + 1 : -1;
    if (i === 0 && kind === 'trip' && now < j.leaveAt && !c.started) return { phase: { kind: 'before', leg: 0 }, leg: 0 };
    // déjà à l'arrêt d'après la position (à vol d'oiseau, jamais d'après le chemin gardé : voir walkingStill) : on attend
    if (k >= 0 && c.fix && !walkingStill(c, i) && (distTo(c, l.to) <= GUIDE.stopM || now >= l.arr)) {
      return { phase: { kind: 'wait', leg: k }, leg: k };
    }
    return { phase: { kind: 'walk', leg: i }, leg: i };
  }
  // étape en véhicule
  const started = boardedOn(m, i) || (now >= l.dep && !l.cancelled && !stillAtStop(c, i));
  if (started) return { phase: { kind: 'ride', leg: i, next: nextStopOf(c, i) }, leg: i };
  // pas encore monté : la marche d'avant continue-t-elle (position) ?
  if (i > 0 && legs[i - 1].kind === 'walk' && now < l.dep && walkingStill(c, i - 1) && !boardedOn(m, i)) {
    if (i - 1 === 0 && kind === 'trip' && now < j.leaveAt && !c.started) return { phase: { kind: 'before', leg: 0 }, leg: 0 };
    return { phase: { kind: 'walk', leg: i - 1 }, leg: i - 1 };
  }
  // trajet qui commence par un véhicule : avant, tant que le départ est loin et qu'on n'est pas à l'arrêt
  if (i === 0 && kind === 'trip' && now < l.dep - GUIDE.boardAheadMs && !(c.fix && distTo(c, l.from) <= atStopM(l))) {
    return { phase: { kind: 'before', leg: 0 }, leg: 0 };
  }
  return { phase: { kind: 'wait', leg: i }, leg: i };
}

/* ------------------------------ Recalcul ------------------------------ */

/** Correspondance devenue impossible (même règle que brokenConnection : un retard gardé n'y compte pas). */
function brokenAt(legs: Leg[], k: number): boolean {
  const p = prevRide(legs, k);
  if (p < 0) return false;
  const a = legs[p];
  const b = legs[k];
  let walk = 0;
  for (let i = p + 1; i < k; i++) if (legs[i].kind === 'walk') walk += (legs[i].walkMin ?? 0) * MIN;
  return (b.rtKept ? b.schedDep : b.dep) < (a.rtKept ? a.schedArr : a.arr) + walk;
}

/** D'où chercher un nouveau trajet : là où l'on est (à bord : là où le véhicule nous dépose). */
function replanFrom(c: Ctx, loc: Loc, k: number): { from: Pending['from']; at: number } {
  const { legs, now } = c;
  const ph = loc.phase;
  if (ph.kind === 'ride' && ph.leg < k) return { from: place(legs[ph.leg].to), at: Math.max(now, legs[ph.leg].arr) };
  const l = legs[k];
  if (c.fix) {
    if (distTo(c, l.from) <= atStopM(l)) return { from: place(l.from), at: now };
    return { from: { lat: c.fix.lat, lon: c.fix.lon }, at: now };
  }
  if (ph.kind === 'before') {
    const o = c.in.origin;
    if (knownPoint(o)) return { from: { lat: o.lat, lon: o.lon }, at: now };
    return { from: place(legs[0].from), at: now };
  }
  if (ph.kind === 'walk') return { from: place(legs[ph.leg].to), at: now };
  if (ph.kind === 'wait') return { from: place(legs[ph.leg].from), at: now };
  return { from: place(l.from), at: now };
}

function pending(c: Ctx, loc: Loc, reason: ReplanReason, k: number): Pending {
  const l = c.legs[k];
  const { from, at } = replanFrom(c, loc, k);
  const p: Pending = { reason, jid: c.j.id, leg: k, t: c.now, from, at, lost: { vehicle: vehicleRef(l), depAt: l.schedDep }, oldArr: c.j.arr };
  const b = c.m.boarded;
  if (b && boardedOn(c.m, b.leg) && loc.phase.kind === 'ride' && loc.phase.leg === b.leg) {
    const r = c.legs[b.leg];
    p.onBoard = { ...(r.tripId ? { tripId: r.tripId } : {}), schedDep: r.schedDep, at: b.at };
  }
  return p;
}

/** Arrêt de descente dépassé (à bord, plus de 300 m au-delà, en s'éloignant, après son heure). */
function passedAt(c: Ctx, loc: Loc): number {
  const { m } = c;
  if (!c.fix) return -1;
  const cands: number[] = [];
  if (loc.phase.kind === 'ride') cands.push(loc.phase.leg);
  // descente constatée (immobile à quai), puis on roule : peut-être resté dans ce véhicule, même quand l'heure dit déjà
  // le véhicule suivant (pas encore monté dedans). 1.3.1 (contrôle du moteur, remarque 10) : seulement si l'on vient de
  // quitter cet arrêt avec lui (justLeft) : sinon, montée non constatée dans le véhicule suivant, « Tu as passé … »
  // venait à tort pour l'arrêt d'avant, devant « Descends », avec un nouveau trajet demandé
  if (m.alighted && fast(c) && !cands.includes(m.alighted.leg) && !(loc.phase.kind === 'ride' && boardedOn(m, loc.phase.leg)) && justLeft(c, m.alighted.leg)) cands.push(m.alighted.leg);
  for (const k of cands) if (passedLeg(c, k)) return k;
  return -1;
}

/**
 * 1.3.1 (contrôle du moteur, remarque 10) : après la descente constatée de l'étape `k`, peut-on encore être resté à bord
 * de ce véhicule ? Seulement si l'on vient de quitter son arrêt avec lui : descente constatée il y a 10 min au plus (le
 * temps d'un arrêt en gare), jamais reparti à pied de l'arrêt depuis (mémoire `walkedOff`, tenue par observe), et une
 * position encore à 150 m de l'arrêt dans les 3 dernières minutes (rester à bord se voit dans la minute qui suit le
 * départ). Sans cela, toute montée non constatée dans le véhicule suivant (téléphone verrouillé, pas de position sous
 * terre, quai loin du point de la gare) donnait plus tard « Tu as passé … » pour l'arrêt d'avant.
 */
function justLeft(c: Ctx, k: number): boolean {
  const to = c.legs[k]?.to;
  const f0 = c.fix;
  const al = c.m.alighted;
  if (!f0 || !al || !knownPoint(to)) return false;
  if (c.now - al.at > GUIDE.passedAfterMs || c.m.walkedOff === k) return false;
  return fixesOf(c.in).some((f) => f.at <= f0.at && f0.at - f.at <= GUIDE.passedSeenMs && distanceM(f, to) <= GUIDE.alightNearM);
}

/** L'arrêt de descente de l'étape `k` est-il dépassé (voir passedAt) ? */
function passedLeg(c: Ctx, k: number): boolean {
  const { legs, now, m } = c;
  const fix = c.fix as GuideFix;
  const l = legs[k];
  if (!knownPoint(l.to) || now < l.arr) return false;
  const d = distanceM(fix, l.to);
  if (d <= GUIDE.passedM) return false;
  // au-delà : de l'autre côté de l'arrêt, dans le sens de la marche du véhicule
  const stops = stopsOf(l);
  const pts = stopPoints(l, stops);
  let before: LatLon | undefined;
  for (let s = pts.length - 2; s >= 0 && !before; s--) before = pts[s];
  if (before) {
    const kx = Math.cos(l.to.lat * (Math.PI / 180));
    const vx = (l.to.lon - before.lon) * kx;
    const vy = l.to.lat - before.lat;
    const wx = (fix.lon - l.to.lon) * kx;
    const wy = fix.lat - l.to.lat;
    if (vx * wx + vy * wy <= 0) {
      // pas dans le sens d'arrivée : encore le long de la ligne avant l'arrêt (véhicule en retard), ou bien le véhicule
      // a tourné après l'arrêt (Schuman → Bruxelles-Nord, puis Bruxelles-Central) : au-delà s'il est loin de la ligne
      const pr = rideProj(c, l);
      if (!pr || pr.offM <= GUIDE.passedM) return false;
    }
  }
  // en s'éloignant
  const away = c.prev ? distanceM(c.prev, l.to) < d - 5 : fast(c);
  if (!away) return false;
  // pas monté dans le véhicule suivant (il s'éloigne aussi)
  const nk = nextRide(legs, k + 1);
  if (nk >= 0 && boardedOn(m, nk)) return false;
  return true;
}

/** Causes d'un nouveau trajet, dans l'ordre : supprimé, correspondance ratée, raté, arrêt dépassé. */
function detect(c: Ctx, loc: Loc): void {
  const { legs, now, m, j } = c;
  if (!c.guided) return;
  if (loc.phase.kind === 'arrived' || loc.phase.kind === 'ended') return;
  const kind = c.in.kind;
  const done = (k: number) => alightedFrom(m, k) || (now >= legs[k].arr && !boardedOn(m, k));
  const firstOpen = (() => {
    const cur = loc.phase.kind === 'ride' ? loc.phase.leg + 1 : loc.leg;
    return nextRide(legs, Math.max(0, cur));
  })();
  let found: Pending | null = null;
  // supprimé : un véhicule à venir (pas encore monté)
  for (let k = firstOpen; k >= 0 && !found; k = nextRide(legs, k + 1)) {
    if (legs[k].cancelled && !boardedOn(m, k) && now < legs[k].schedArr) found = pending(c, loc, 'cancelled', k);
  }
  // correspondance devenue impossible (retard)
  if (!found && kind === 'trip') {
    for (let k = firstOpen; k >= 0 && !found; k = nextRide(legs, k + 1)) {
      // déjà à l'arrêt d'après la position (attente) : la correspondance est faite
      const there = loc.phase.kind === 'wait' && loc.phase.leg === k;
      if (!there && !boardedOn(m, k) && !done(k) && now < legs[k].dep + GUIDE.boardAfterMs && brokenAt(legs, k)) found = pending(c, loc, 'late', k);
    }
  }
  // véhicule raté : encore à l'arrêt 2 min après son départ ; 1.3.1 (A3, I1) : sans temps réel, gardé jusqu'à 15 min
  // avant le suivant (au moins 10 min après son heure), et « Nouveau trajet » sans « est parti » (planned)
  if (!found && c.fix && loc.phase.kind === 'wait') {
    const k = loc.phase.leg;
    const l = legs[k];
    const limit = l.rt ? l.dep + GUIDE.missedMs : keptUntil(c, k);
    if (!l.cancelled && !boardedOn(m, k) && now >= limit && stillAtStop(c, k)) {
      found = pending(c, loc, 'missed', k);
      if (!l.rt) found.planned = true;
    }
  }
  // 1.3.1 (A2, P1) : en marche vers l'arrêt, le véhicule parti : 2 min après son départ (temps réel) ; sans temps réel,
  // quand l'arrivée à pied dépasse la limite où il est gardé (keptUntil). Nouveau trajet depuis la position (replanFrom)
  if (!found && c.fix && loc.phase.kind === 'walk') {
    const k = loc.phase.leg + 1;
    const l = legs[k];
    // contrôle du moteur : seulement avec 45 s de positions (au réveil du téléphone, une position ou deux ne disent pas si
    // l'on marche vers l'arrêt ou si l'on en repart dans un véhicule lent : walkingTo compare à la plus ancienne)
    if (l?.kind === 'ride' && !l.cancelled && !boardedOn(m, k) && now >= l.dep && c.fix.at - recentFixes(c, 2 * GUIDE.walkSeenMs)[0].at >= GUIDE.walkSeenMs) {
      const gone = l.rt ? now >= l.dep + GUIDE.missedMs : now + walkLeftMs(c, loc.phase.leg) > keptUntil(c, k);
      if (gone) found = pending(c, loc, 'missed', k);
    }
  }
  // arrêt dépassé
  if (!found) {
    const k = passedAt(c, loc);
    if (k >= 0) {
      found = pending(c, loc, 'passed', k);
      // l'arrêt suivant du véhicule (arrêts suivants connus) : où descendre, et d'où chercher le nouveau trajet, à son
      // heure ; sans lui, depuis la position (jamais mieux que l'arrêt : elle est dans le véhicule)
      const nx = beyondOf(c, k).find((s) => s.est >= now - 30 * SEC);
      if (nx) {
        found.getOff = nx.name;
        found.getOffAt = nx.est;
      }
      if (nx && knownPoint(nx)) {
        found.from = { lat: nx.lat, lon: nx.lon, ...(nx.areaId ? { areaId: nx.areaId } : {}), name: nx.name };
        found.at = Math.max(now, nx.est);
      } else {
        found.from = { lat: c.fix!.lat, lon: c.fix!.lon };
        found.at = now;
      }
      found.passed = legs[k].to.name;
      if (legs[k].tripId) found.tripId = legs[k].tripId;
      // genre ride : rien à chercher ; l'arrêt suivant connu, avec sa position : le même véhicule jusqu'à lui
      // (rideOnJourney, par le contrôleur) ; sinon seulement « Descends à … »
      if (kind === 'ride' && !(nx && knownPoint(nx))) found.local = true;
      if (m.alighted && m.alighted.leg >= k) delete m.alighted;
      if (m.walkedOff === k) delete m.walkedOff;
      m.boarded = { leg: k, at: m.boarded?.leg === k ? m.boarded.at : now };
      // le véhicule où l'on est : le nouveau trajet qui le garde jusqu'à l'arrêt suivant le retrouve (adopt)
      found.onBoard = { ...(legs[k].tripId ? { tripId: legs[k].tripId } : {}), schedDep: legs[k].schedDep, at: m.boarded.at };
    }
  }
  const same = (a: Pending, b: Pending) => a.jid === b.jid && a.reason === b.reason && a.leg === b.leg;
  if (found) {
    if (!(m.re && same(m.re, found))) m.re = found;
    return;
  }
  // cause disparue avant le nouveau trajet (temps réel revenu) : oubliée
  if (m.re && m.re.jid === j.id && !m.re.swap && m.re.none === undefined && (m.re.reason === 'cancelled' || m.re.reason === 'late')) delete m.re;
}

/* ------------------------------ Moments ------------------------------ */

// 1.3.0 (PRD-1.3.0 § 4, § 6.3) : offMap après leave (la marche commence), check après eux (jamais devant une action)
// 1.3.1 (B17) : walk, la marche après une descente, au rang de leave (jamais ensemble : leave est la première marche)
const PRIO: Record<Moment['kind'], number> = { replan: 0, passed: 1, alight: 2, platform: 3, board: 4, turn: 5, leave: 6, walk: 6, offMap: 7, check: 8, nextStop: 9, arrived: 10 };

interface Cand {
  id: string;
  kind: Moment['kind'];
  /** le déclencheur tient maintenant (un moment déjà montré reste jusqu'à sa fin) */
  trig: boolean;
  /** fin automatique atteinte */
  end: boolean;
  make: (since: number) => Moment;
}

/** 1.3.1 (A5, P2) : les deux dernières positions à `d` m au moins le long du chemin de la marche `w`, chacune sur lui (30 m). */
function walkedAlong(c: Ctx, w: number, d: number): boolean {
  const pr = c.walkPr;
  if (!c.fix || !pr || pr.leg !== w) return false;
  const pts = routePoints(pr.route);
  const cum = cumulative(pts);
  const last2 = recentFixes(c, GUIDE.freshMs).slice(-2);
  return (
    last2.length === 2 &&
    last2.every((f) => {
      const p = projectOn(pts, f, cum);
      return p.offM <= GUIDE.offRouteM && p.alongM >= d;
    })
  );
}

/**
 * 1.3.1 (A6, P3) : sens de la marche par rapport au chemin, à la position `fx[i]` : le déplacement depuis la position la
 * plus récente à `minM` mètres au moins (60 s au plus), comparé à la direction du chemin devant le point le plus proche
 * (sur 15 m). `angle` : 0 dans le sens du chemin, 180 à contresens ; `back` : la progression le long du chemin (prolongé
 * avant son début : départ du mauvais côté) n'avance pas. Rien à mesurer (undefined) : pas assez de marche, une des deux
 * positions à plus de 30 m du chemin, ou, pour lancer le demi-tour (`start`), moins de 20 m de chemin devant, une
 * allure qui n'est pas celle d'une marche (0,5 à 2,5 m/s sur ce déplacement : le bruit d'une position immobile saute
 * plus vite), un éloignement qui revient en arrière en route, ou, sur un chemin qui commence par un raccord (`join` :
 * rang de son premier point sur une rue), une position à plus de 30 m des rues du chemin ou une marche qui s'éloigne
 * de la rue le long du raccord.
 */
function motionOn(pts: LatLon[], cum: number[], fx: TimedPoint[], i: number, minM: number, start: boolean, join = 0): { angle: number; back: boolean } | undefined {
  const f = fx[i];
  let ka = -1;
  for (let k = i - 1; k >= 0 && ka < 0; k--) if (distanceM(fx[k], f) >= minM) ka = k;
  if (ka < 0) return undefined;
  const a = fx[ka];
  if (start) {
    const v = distanceM(a, f) / Math.max(1, (f.at - a.at) / SEC);
    if (v < GUIDE.uturnSpeedMs || v > GUIDE.walkMaxMs) return undefined;
    // une marche s'éloigne de son point de départ sans revenir (2 m près) ; un bruit va et vient
    for (let k = ka + 2; k <= i; k++) if (distanceM(a, fx[k]) < distanceM(a, fx[k - 1]) - 2) return undefined;
  }
  const pf = projectAlong(pts, f, cum);
  const pa = projectAlong(pts, a, cum);
  if (pf.offM > GUIDE.offRouteM || pa.offM > GUIDE.offRouteM) return undefined;
  // correctif du 21/11 : le raccord de départ (pts[0] → pts[join] : du point de départ, ou de la position au recalcul,
  // à la rue la plus proche) n'est pas une rue, il n'a pas de sens de marche. Sur une place ou un parking non dessinés,
  // à 45 m de toute rue, le chemin recalculé repartait vers la rue de derrière, et avancer vers l'arrêt passait pour
  // 15 m à contresens. Pour lancer le demi-tour : les deux positions à 30 m au plus des rues du chemin (pas encore
  // rejoint : rien) ; et tant que la position se projette sur le raccord, s'éloigner de la rue le long de lui (à 60°
  // près) n'est pas marcher à contresens. Le vrai départ du mauvais côté longe la rue : il reste dit
  if (start && join > 0) {
    const streets = pts.slice(join);
    if (projectOn(streets, f).offM > GUIDE.offRouteM || projectOn(streets, a).offM > GUIDE.offRouteM) return undefined;
    const awayDeg = bearingDeg(pts[join], pts[0]);
    if (projectOn(pts, f, cum).seg < join && Math.abs(relativeDeg(bearingDeg(a, f), awayDeg)) <= GUIDE.uturnWithDeg) return undefined;
  }
  // chemin en épingle (rampe, aller et retour jusqu'au passage piéton quand les trottoirs sont séparés) : la position,
  // bruitée, se projette sur l'autre branche, qui va dans l'autre sens. Si une partie du chemin à 30 m au plus va dans
  // le sens de la marche, on ne sait pas sur quelle branche on est : jamais « Fais demi-tour » dans le doute
  if (start && routeGoesWith(pts, cum, f, bearingDeg(a, f))) return undefined;
  const total = cum[cum.length - 1];
  let from = Math.max(0, pf.alongM);
  if (total - from < LAST_TURN_FREE_M) {
    if (start) return undefined;
    from = Math.max(0, total - GUIDE.uturnM);
  }
  const dir = bearingDeg(pointAlong(pts, cum, from), pointAlong(pts, cum, Math.min(total, from + GUIDE.uturnM)));
  return { angle: Math.abs(relativeDeg(bearingDeg(a, f), dir)), back: pf.alongM <= pa.alongM + GUIDE.uturnAheadM };
}

/**
 * 1.3.1 (A6, contrôle du moteur) : une partie du chemin, à 30 m au plus de `p`, va-t-elle dans le sens `moveDeg` (à 60°
 * près : direction de chaque segment proche, ou du chemin sur les 15 m qui suivent son point le plus proche) ?
 */
function routeGoesWith(pts: LatLon[], cum: number[], p: LatLon, moveDeg: number): boolean {
  const total = cum[cum.length - 1];
  for (let s = 0; s + 1 < pts.length; s++) {
    const pr = projectOn([pts[s], pts[s + 1]], p);
    if (pr.offM > GUIDE.offRouteM) continue;
    const from = cum[s] + pr.alongM;
    if (total - from < GUIDE.uturnAheadM) continue;
    // la direction du segment lui-même, ou celle des 15 m qui suivent (avant un coin, elles diffèrent)
    const ahead = bearingDeg(pointAlong(pts, cum, from), pointAlong(pts, cum, Math.min(total, from + GUIDE.uturnM)));
    const own = cum[s + 1] - cum[s] >= 1 ? bearingDeg(pts[s], pts[s + 1]) : ahead;
    if ([own, ahead].some((dir) => Math.abs(relativeDeg(dir, moveDeg)) <= GUIDE.uturnWithDeg)) return true;
  }
  return false;
}

/**
 * 1.3.1 (A6, correctif du 21/11) : rang du premier point du chemin sur une voie du graphe (`WalkRoute.joinAt`, posé par
 * le routeur quand le chemin commence par un raccord droit) ; 0 : pas de raccord connu.
 */
function joinOf(route: WalkRoute, pts: LatLon[]): number {
  const k = route.joinAt;
  return pts === route.coords && typeof k === 'number' && Number.isInteger(k) && k > 0 && k < pts.length ? k : 0;
}

/** Une position (ou une moyenne de positions) datée. */
type TimedPoint = LatLon & { at: number };

/** 1.3.1 (A6) : chaque position remplacée par la moyenne d'elle et des deux d'avant (le bruit d'une position immobile s'y fond). */
function smoothed(fx: readonly GuideFix[]): TimedPoint[] {
  return fx.map((f, i) => {
    const w = fx.slice(Math.max(0, i - 2), i + 1);
    return { lat: w.reduce((s, x) => s + x.lat, 0) / w.length, lon: w.reduce((s, x) => s + x.lon, 0) / w.length, at: f.at };
  });
}

/**
 * 1.3.1 (A6, P3) : « Fais demi-tour » sur le chemin de la marche `w` (vrai chemin ; le chemin ne crée de virage qu'aux
 * carrefours) : 15 m à contresens du chemin (plus de 135°, sans avancer le long de lui ; deux fois la précision annoncée
 * si elle est moins bonne que 7,5 m), positions lissées sur trois, pour les trois dernières, à 0,5 m/s au moins (jamais
 * à l'arrêt). Couvre le départ du mauvais côté (le long de la rue) et le virage raté (le nouveau chemin, calculé depuis
 * la position, repart en arrière). Correctif du 21/11 : jamais contre le raccord de départ d'un chemin (du point de
 * départ ou de la position à la première rue : `joinAt`), ni à plus de 30 m des rues du chemin (pas encore rejoint) :
 * voir motionOn. Une fois par chemin (id avec builtAt) ; fini après 10 m dans
 * le bon sens (moins de 90°, deux positions) ou d'un toucher ; un nouveau chemin le remplace. Moment `turn` (flèche
 * demi-tour), sans rue : « vers l'arrêt X » sous « Fais demi-tour ».
 */
function uturnCand(c: Ctx, w: number, route: WalkRoute, pts: LatLon[], cum: number[]): Cand | null {
  const { m } = c;
  const id = `turn:${c.j.id}:${w}:u:${route.builtAt}`;
  const f0 = c.fix;
  if (!f0 || m.dismissed.includes(id)) return null;
  // positions précises seulement (20 m) ; pour lancer, lissées sur trois : une position qui saute ne fait pas faire
  // demi-tour ; pour finir, telles quelles (la flèche s'efface dès qu'on va dans le bon sens)
  // contrôle du moteur : après une descente, seulement les positions d'après elle (constatée, sinon l'heure d'arrivée) et
  // jamais une position à la vitesse d'un véhicule : le train ou le bus qui freine en arrivant du côté où part la marche
  // passait pour 15 m de marche à contresens (« Fais demi-tour » au premier pas dans le bon sens)
  const pk = w > 0 && c.legs[w - 1].kind === 'ride' ? w - 1 : -1;
  const since = pk < 0 ? -Infinity : m.alighted && m.alighted.leg >= pk ? m.alighted.at : c.legs[pk].arr;
  const raw = recentFixes(c, GUIDE.freshMs).filter((f) => (f.accuracy ?? 0) <= GUIDE.uturnAccM && f.at >= since && !(Number.isFinite(f.speed) && (f.speed as number) >= GUIDE.walkMaxMs));
  const n = raw.length;
  const wl = c.legs[w];
  const make = (since: number): Moment => ({ kind: 'turn', id, since, until: f0.at + GUIDE.freshMs, leg: w, turn: 'uturn', distM: 0, toward: wl.to.name, final: w === c.legs.length - 1 });
  const join = joinOf(route, pts);
  const lastK = (k: number, fx: TimedPoint[], minM: number, start: boolean) => (n >= k && raw[n - 1] === f0 ? Array.from({ length: k }, (_, j) => motionOn(pts, cum, fx, n - k + j, minM, start, join)) : []);
  if (m.shown[id] === undefined) {
    if ((c.speed ?? 0) < GUIDE.uturnSpeedMs) return null;
    // au moins 15 m, et deux fois la précision annoncée (une position qui saute de 10 m n'est pas une marche) ; trois
    // positions de suite
    const minM = Math.max(GUIDE.uturnM, 2 * Math.max(0, ...raw.slice(-3).map((f) => f.accuracy ?? 0)));
    const all = lastK(GUIDE.uturnFixes, smoothed(raw), minM, true);
    const wrong = all.length === GUIDE.uturnFixes && all.every((x) => !!x && x.angle > GUIDE.uturnDeg && x.back);
    return wrong ? { id, kind: 'turn', trig: true, end: false, make } : null;
  }
  const both = lastK(2, raw, GUIDE.uturnBackM, false);
  const end = both.length === 2 && both.every((x) => !!x && x.angle < 90);
  // une fois par chemin, même fini caché derrière un autre moment
  if (end) m.dismissed.push(id);
  return { id, kind: 'turn', trig: false, end, make };
}

/**
 * 1.3.1 (B17, P7) : distance (m) parcourue depuis l'apparition d'un moment (`since`) : de la position d'alors (la
 * dernière avant, 60 s au plus, sinon la première après) à la dernière ; 0 sans position.
 */
function movedSince(c: Ctx, since: number): number {
  if (!c.fix) return 0;
  const good = fixesOf(c.in);
  let a: GuideFix | undefined;
  for (const f of good) if (f.at <= since && since - f.at <= GUIDE.freshMs) a = f;
  a ??= good.find((f) => f.at > since);
  return a ? distanceM(a, c.fix) : 0;
}

/** Prochaine étape en véhicule à prendre (pas encore montée). */
function rideToBoard(c: Ctx, loc: Loc): number {
  const ph = loc.phase;
  if (ph.kind === 'wait') return ph.leg;
  if (ph.kind === 'walk' || ph.kind === 'before') return nextRide(c.legs, ph.leg);
  if (ph.kind === 'ride') return nextRide(c.legs, ph.leg + 1);
  return -1;
}

/** Étape en véhicule arrivée il y a moins de 2 min (d'après l'heure), descente pas encore constatée ; -1 sinon. */
function justArrived(c: Ctx): number {
  const { legs, now, m } = c;
  for (let k = legs.length - 1; k >= 0; k--) {
    const l = legs[k];
    if (l.kind !== 'ride') continue;
    if (l.arr > now) continue;
    if (now >= l.arr + GUIDE.alightAfterMs || alightedFrom(m, k) || l.cancelled) return -1;
    const nk = nextRide(legs, k + 1);
    return nk >= 0 && boardedOn(m, nk) ? -1 : k;
  }
  return -1;
}

/** Arrêt dépassé, nouveau trajet adopté qui garde le véhicule où l'on est : rang de son étape (-1 sinon). */
function keptLeg(c: Ctx, re: Pending): number {
  const ob = re.onBoard;
  if (re.reason !== 'passed' || !ob || re.swap?.jid !== c.j.id) return -1;
  return c.legs.findIndex((l) => l.kind === 'ride' && !l.cancelled && l.schedDep === ob.schedDep && (l.tripId ?? '') === (ob.tripId ?? ''));
}

/** Heure où « Descends au prochain arrêt » apparaît (Infinity : pas encore, d'après la position). */
function alightTrigAt(c: Ctx, k: number): number {
  const l = c.legs[k];
  const stops = stopsOf(l);
  const n = stops.length;
  const floor = l.arr - GUIDE.alightNotBeforeMs;
  if (n <= 2) return Math.max(l.dep + GUIDE.alightEstMs, floor);
  const p = rideProj(c, l);
  if (p && p.all && p.offM <= GUIDE.onLineM / 2) {
    const left = p.alongM > p.stopAlong[n - 2] + GUIDE.leftStopM && !slowAt(c, p);
    return left ? Math.max(c.now, floor) : Infinity;
  }
  return Math.max(stops[n - 2].est + GUIDE.alightEstMs, floor);
}
/** Arrêté à un arrêt intermédiaire (position au pas, tout près d'un arrêt) : le véhicule n'est pas encore reparti. */
function slowAt(c: Ctx, p: { alongM: number; stopAlong: number[] }): boolean {
  if (c.speed === undefined || c.speed >= GUIDE.walkMaxMs) return false;
  return p.stopAlong.some((a, s) => s > 0 && Math.abs(a - p.alongM) <= GUIDE.leftStopM && s < p.stopAlong.length - 1);
}

function thenOf(legs: Leg[], k: number): Then {
  const a = legs[k + 1];
  if (!a) return { kind: 'none' };
  const rideThen = (r: Leg, walkMin: number, i: number): Then => {
    const t: Then = { kind: 'ride', vehicle: vehicleRef(r), depAt: r.dep, rt: !!r.rt, walkMin };
    const p = platformOf(r);
    if (p && isTrain(r)) t.platform = p;
    // 1.3.1 (§ 4, B16, B13) : l'arrêt où monter, correspondance très juste, heure prévue d'un train en retard
    t.from = r.from.name;
    const mg = connectionMargin(legs, i);
    if (mg !== undefined && mg <= GUIDE.tightMin) t.tight = true;
    const sc = trainSched(r);
    if (sc !== undefined) t.sched = sc;
    return t;
  };
  if (a.kind === 'ride') return rideThen(a, 0, k + 1);
  const b = legs[k + 2];
  if (b && b.kind === 'ride') return rideThen(b, walkMinOf(a), k + 2);
  return { kind: 'walk', min: walkMinOf(a), toward: a.to.name, last: !b };
}

/** Marche restante en minutes (80 m/min sur le chemin, détours comptés sur une ligne droite). */
function minutesFor(m: number, straight: boolean): number {
  if (m <= 0) return 0;
  return Math.ceil((straight ? m * 1.3 : m) / GUIDE.walkMPerMin);
}

/* ------------------------------ 1.3.0 : hors de Belgique (PRD-1.3.0 § 4) ------------------------------ */

/**
 * Chemin de la marche `w` sans chemin à pied parce qu'un de ses bouts est hors de l'extrait de Belgique (chemin droit,
 * raison `outside`) ; null sinon. Seulement le chemin de cette marche (même arrivée, à 30 m près).
 */
function outsideRoute(c: Ctx, w: number): WalkRoute | null {
  const x = c.in.walk;
  const wl = c.legs[w];
  if (!x || x.leg !== w || !x.route || wl?.kind !== 'walk') return null;
  const r = x.route;
  if (r.source !== 'straight' || r.reason !== 'outside') return null;
  if (knownPoint(wl.to) && knownPoint(r.to) && distanceM(r.to, wl.to) > 30) return null;
  return r;
}

/**
 * Contenu du moment `offMap` de la marche `w` : minutes restantes et distance à vol d'oiseau depuis la position (sans
 * position : les minutes à l'heure), direction de la cible par rapport au cap de la marche si le cap est connu.
 */
function offMapOf(c: Ctx, w: number): { walkMin: number; distM?: number; bearingDeg?: number; toward: Names } {
  const wl = c.legs[w];
  if (c.fix && knownPoint(wl.to)) {
    const d = distanceM(c.fix, wl.to);
    const out: { walkMin: number; distM?: number; bearingDeg?: number; toward: Names } = { walkMin: Math.max(1, minutesFor(d, true)), distM: Math.round(d), toward: wl.to.name };
    if (Number.isFinite(c.fix.heading)) out.bearingDeg = Math.round(relativeDeg(bearingDeg(c.fix, wl.to), c.fix.heading as number));
    return out;
  }
  return { walkMin: Math.max(1, Math.ceil((wl.arr - c.now) / MIN)), toward: wl.to.name };
}

/* ------------------------------ 1.3.0 : vérification (PRD-1.3.0 § 6.3) ------------------------------ */

const lowBattery = (b: unknown): b is number => typeof b === 'number' && Number.isFinite(b) && b >= 0 && b < GUIDE.checkBattery;

/**
 * Vérification au départ et en route : tient la mémoire `chk` et rend les problèmes vrais maintenant, dans l'ordre
 * batterie, position :
 * - batterie des lunettes sous 20 % (GuideInput.battery), à tout moment ;
 * - pas de position : au départ, aucune position dans les 30 s où le guidage en demande (dès le lancement, ou dès que
 *   la phase en demande si l'on a lancé tôt) ; vrai tant qu'aucune n'est venue et que la phase en demande ;
 * - position perdue : plus aucune position depuis 3 min alors que la phase en demande et qu'il y en avait (l'attente
 *   compte depuis la dernière position, ou depuis que la position est demandée de nouveau, ou depuis le réveil).
 * Ce qui est vérifié au départ (batterie 30 s après le lancement, pas de position) l'est une fois, si le moteur a vu le
 * lancement (premier pas dans ses 30 s ; un guidage repris plus tard ne le refait pas).
 */
function checkOf(c: Ctx, need: LocationNeed): CheckIssue[] {
  const { m, now } = c;
  const start = Number.isFinite(c.in.startedAt) ? c.in.startedAt : now;
  const k: Chk = m.chk ?? { t0: now, at: now, told: [] };
  m.chk = k;
  const slept = now - k.at > GUIDE.sleepMs;
  k.at = now;
  for (const f of c.in.fixes ?? []) {
    if (!f || !Number.isFinite(f.lat) || !Number.isFinite(f.lon) || !Number.isFinite(f.at)) continue;
    if (f.at > now + 5 * SEC || f.at < start - GUIDE.freshMs) continue;
    if (k.fix === undefined || f.at > k.fix) k.fix = f.at;
  }
  if (need === 'off') delete k.need;
  else if (k.need === undefined || slept) k.need = now;
  const launch = k.t0 - start <= GUIDE.checkAfterMs;
  const due = start + GUIDE.checkAfterMs;
  if (k.bat === undefined && (!launch || now >= due)) k.bat = launch && lowBattery(c.in.battery);
  if (k.noPos === undefined) {
    if (!launch || k.fix !== undefined) k.noPos = false;
    // position demandée sans interruption depuis 30 s, aucune reçue depuis le lancement
    else if (k.need !== undefined && now >= k.need + GUIDE.checkAfterMs) k.noPos = true;
  }
  const out: CheckIssue[] = [];
  if (lowBattery(c.in.battery)) out.push({ kind: 'battery', level: c.in.battery });
  if (need !== 'off' && k.need !== undefined) {
    if (k.noPos && k.fix === undefined) out.push({ kind: 'noPosition' });
    if (k.fix !== undefined) {
      const from = Math.max(k.fix, k.need);
      if (now - from >= GUIDE.lostMs) out.push({ kind: 'positionLost', minutes: Math.floor((now - from) / MIN) });
    }
  }
  return out;
}

/** Sortes de problèmes d'un moment `check` (id « check:battery+noPosition »). */
const checkKinds = (id: string): CheckIssue['kind'][] => id.slice('check:'.length).split('+').filter((s): s is CheckIssue['kind'] => ISSUE_KINDS.includes(s as CheckIssue['kind']));

/**
 * Moments `check` : celui qui est montré (jusqu'à 20 s, plus tôt si ses problèmes sont réglés) ; sinon les problèmes
 * vrais pas encore dits (deux au plus) : la batterie et l'absence de position seulement s'ils viennent de la
 * vérification du lancement, la position perdue en route. Chaque problème est dit une fois par guidage ; jamais à
 * l'arrivée.
 */
function checkCands(c: Ctx, loc: Loc): Cand[] {
  const { m, now } = c;
  const k = m.chk;
  if (!k) return [];
  const leg = Math.max(0, loc.leg);
  const out: Cand[] = [];
  const has = (kind: CheckIssue['kind']) => c.issues.some((i) => i.kind === kind);
  // arrivé : « Tu y es » n'attend pas derrière une vérification
  const arrived = loc.phase.kind === 'arrived' || loc.phase.kind === 'ended';
  let live = false;
  for (const [id, since0] of Object.entries(m.shown)) {
    if (!id.startsWith('check:') || m.dismissed.includes(id)) continue;
    const kinds = checkKinds(id);
    const end = now >= since0 + GUIDE.checkMs || !kinds.some(has) || arrived;
    live ||= !end;
    out.push({
      id, kind: 'check', trig: false, end,
      make: (since) => ({ kind: 'check', id, since, until: since + GUIDE.checkMs, leg, issues: c.issues.filter((i) => kinds.includes(i.kind)) }),
    });
  }
  if (live || arrived) return out;
  const said = (i: CheckIssue) => k.told.includes(i.kind) || (i.kind === 'battery' && k.bat !== true) || (i.kind === 'noPosition' && k.noPos !== true);
  const due = c.issues.filter((i) => !said(i)).slice(0, 2);
  if (!due.length) return out;
  const id = `check:${due.map((i) => i.kind).join('+')}`;
  if (m.shown[id] !== undefined || m.dismissed.includes(id)) return out;
  out.push({ id, kind: 'check', trig: true, end: false, make: (since) => ({ kind: 'check', id, since, until: since + GUIDE.checkMs, leg, issues: due }) });
  return out;
}

function candidates(c: Ctx, loc: Loc): Cand[] {
  const { legs, now, m, j } = c;
  const jid = j.id;
  const out: Cand[] = [];
  const shown = (id: string) => m.shown[id] !== undefined;
  const ph = loc.phase;

  // recalcul : supprimé, correspondance ratée, raté ; puis arrêt dépassé
  const re = m.re;
  if (re && re.reason !== 'passed') {
    const base = `replan:${re.jid}:${re.reason}:${re.leg}`;
    const lost = re.lost;
    const reason = re.reason as 'missed' | 'cancelled' | 'late';
    // 1.3.1 (A3, I1) : véhicule sans temps réel, resté à l'arrêt : « Nouveau trajet : … » sans « est parti ». `planned`
    // seulement avec le nouveau trajet : avant qu'il soit connu, aucun moment (l'écran n'aurait que « est parti » à écrire,
    // et rien ne dit que le véhicule est passé) ; aucun trajet trouvé : le moment de la 1.3.0, sans `planned`
    const planned = re.planned ? { planned: true } : {};
    if (re.swap && re.swap.jid === jid) {
      // premier véhicule du nouveau trajet (pas celui où l'on est encore, gardé devant par replanJourney)
      let k = nextRide(legs, 0);
      while (k >= 0 && (boardedOn(m, k) || legs[k].dep < re.at - GUIDE.boardAfterMs)) k = nextRide(legs, k + 1);
      const r = k >= 0 ? legs[k] : undefined;
      const swapAt = re.swap.at;
      out.push({
        id: `${base}:${jid}`, kind: 'replan', trig: now < swapAt + GUIDE.replanMs, end: now >= swapAt + GUIDE.replanMs,
        make: (since) => ({
          kind: 'replan', id: `${base}:${jid}`, since, until: swapAt + GUIDE.replanMs, leg: Math.max(0, k), reason, lost,
          ...(r ? { next: { vehicle: vehicleRef(r), depAt: r.dep, ...(isTrain(r) && platformOf(r) ? { platform: platformOf(r) } : {}), ...(trainSched(r) !== undefined ? { sched: trainSched(r) } : {}) } } : {}),
          arr: j.arr, laterMin: roundMin(j.arr - re.oldArr), ...planned,
        }),
      });
    } else if (re.jid === jid && re.none !== undefined) {
      const none = re.none;
      out.push({
        id: `${base}:none`, kind: 'replan', trig: now < none + GUIDE.replanMs, end: now >= none + GUIDE.replanMs,
        make: (since) => ({ kind: 'replan', id: `${base}:none`, since, until: none + GUIDE.replanMs, leg: re.leg, reason, lost, none: true }),
      });
    } else if (re.jid === jid && !re.planned) {
      const until = re.t + GUIDE.replanMs;
      out.push({
        id: base, kind: 'replan', trig: now < until, end: now >= until,
        make: (since) => ({ kind: 'replan', id: base, since, until, leg: re.leg, reason, lost }),
      });
    }
  }
  if (re && re.reason === 'passed' && (re.jid === jid || re.swap?.jid === jid) && re.passed) {
    const id = `passed:${re.jid}:${re.leg}`;
    const since0 = m.shown[id] ?? now;
    // nouveau trajet qui garde le véhicule jusqu'à l'arrêt suivant (replanJourney, rideOnJourney) : la suite est celle
    // d'un trajet normal, « Descends au prochain arrêt » au plus tard la dernière minute avant d'y arriver
    const kl = keptLeg(c, re);
    const until = kl >= 0 ? Math.max(since0, Math.min(since0 + GUIDE.passedMs, legs[kl].arr - GUIDE.passedKeptMs)) : since0 + GUIDE.passedMs;
    let getOff: Names = { fr: '', nl: '' };
    let at = 0;
    const next = re.swap ? undefined : beyondOf(c, re.leg).find((s) => s.est >= now - 30 * SEC);
    if (kl >= 0) {
      getOff = legs[kl].to.name;
      at = legs[kl].arr;
    } else if (re.getOff) {
      // l'arrêt suivant noté à la détection (arrêts suivants du véhicule) : le même, avant et après le nouveau trajet
      getOff = re.getOff;
      at = re.getOffAt ?? 0;
    } else if (next) {
      getOff = next.name;
      at = next.est;
    } else if (re.swap?.jid === jid && legs[0]) {
      // nouveau trajet : il commence là où descendre (ou par le même véhicule, jusqu'à là où descendre) ; cherché depuis
      // la position (« Ma position », sans zone), sa marche de départ ne dit pas où descendre : rien plutôt qu'un faux nom
      const l0 = legs[0];
      const same = l0.kind === 'ride' && !!re.tripId && l0.tripId === re.tripId;
      if (same || l0.kind === 'ride' || l0.from.areaId) {
        getOff = same ? l0.to.name : l0.from.name;
        at = same ? l0.arr : l0.dep;
      }
    }
    const passedName = re.passed;
    // genre ride : « Descends à … » seulement (PRD § 3.6), pas d'arrivée d'un « nouveau trajet » (le même véhicule)
    const arr = re.swap?.jid === jid && c.in.kind === 'trip' ? { arr: j.arr } : {};
    out.push({
      id, kind: 'passed', trig: now < re.t + GUIDE.passedMs, end: now >= until,
      make: (since) => ({ kind: 'passed', id, since, until, leg: re.leg, passed: passedName, getOff, at, ...arr }),
    });
  }

  // à bord : « Descends au prochain arrêt » (jusqu'à l'arrivée + 2 min, l'heure passée comprise), « Prochain arrêt »
  let ak = ph.kind === 'ride' ? ph.leg : justArrived(c);
  // 1.3.1 (A2, P1) : jamais pour un véhicule vers lequel on marche encore, ou qu'on attend encore à son arrêt
  if (ph.kind !== 'ride' && ak >= 0 && ((ph.kind === 'walk' || ph.kind === 'before') ? ph.leg < ak : ph.kind === 'wait' && ph.leg <= ak)) ak = -1;
  if (ak >= 0) {
    const k = ak;
    const l = legs[k];
    const id = `alight:${jid}:${k}`;
    const trigAt = alightTrigAt(c, k);
    const holdOn = boardedOn(m, k) && riding(c, k);
    const end = alightedFrom(m, k) || (now >= l.arr + GUIDE.alightAfterMs && !holdOn);
    out.push({
      id, kind: 'alight', trig: now >= trigAt, end,
      make: (since) => ({ kind: 'alight', id, since, until: Math.max(l.arr + GUIDE.alightAfterMs, since), leg: k, stop: l.to.name, at: l.arr, rt: !!l.rt, then: thenOf(legs, k) }),
    });
  }
  if (ph.kind === 'ride') {
    const k = ph.leg;
    const l = legs[k];
    const trigAt = alightTrigAt(c, k);
    if (isTrain(l) && l.arr - l.dep >= GUIDE.nextStopRideMs) {
      const stops = stopsOf(l);
      const n = stops.length;
      const quietFrom = (Number.isFinite(trigAt) ? Math.min(trigAt, l.arr - GUIDE.alightNotBeforeMs) : l.arr - GUIDE.alightNotBeforeMs) - GUIDE.nextStopQuietMs;
      for (let s = Math.max(1, ph.next - 1); s < n - 1; s++) {
        const st = stops[s];
        const from = st.est - GUIDE.nextStopBeforeMs;
        const until = st.est + GUIDE.nextStopAfterMs;
        const sid = `nextStop:${jid}:${k}:${s}`;
        if (now < from - 1 && !shown(sid)) break;
        const gapOk = m.lastNextStopAt === undefined || now - m.lastNextStopAt >= GUIDE.nextStopGapMs;
        out.push({
          id: sid, kind: 'nextStop', trig: now >= from && now < until && gapOk && now < quietFrom, end: now >= until,
          // arrêts jusqu'à la descente, le prochain compris (comme « Où tu en es » et l'exemple du PRD : « Prochain
          // arrêt : Louvain », « descente dans 3 arrêts, à Bruxelles-Central »)
          make: (since) => ({ kind: 'nextStop', id: sid, since, until, leg: k, stop: st.name, at: st.est, rt: !!l.rt, stopsToAlight: n - s, alight: l.to.name }),
        });
      }
    }
  }

  // monter (jusqu'au départ + 1 min, même parti d'après l'heure tant que la montée n'est pas constatée), voie modifiée
  const toBoard = rideToBoard(c, loc);
  const boardLegs = toBoard >= 0 ? [toBoard] : [];
  if (ph.kind === 'ride' && !boardedOn(m, ph.leg) && now < legs[ph.leg].dep + GUIDE.boardAfterMs) boardLegs.unshift(ph.leg);
  for (const k of boardLegs) {
    if (legs[k].cancelled) continue;
    const l = legs[k];
    const plat = platformOf(l);
    const id = `board:${jid}:${k}:${plat ?? ''}`;
    const trig = ph.kind === 'wait' && ph.leg === k && l.dep - now <= GUIDE.boardAheadMs && now < l.dep + GUIDE.boardAfterMs;
    const end = boardedOn(m, k) || now >= l.dep + GUIDE.boardAfterMs;
    const p = prevRide(legs, k);
    const stops = l.stops && l.stops.length >= 2 ? l.stops.length - 1 : 0;
    const board: Cand = {
      id, kind: 'board', trig, end,
      make: (since) => {
        const mo: Moment = { kind: 'board', id, since, until: l.dep + GUIDE.boardAfterMs, leg: k, vehicle: vehicleRef(l), head: l.head ?? l.to.name, depAt: l.dep, rt: !!l.rt, alight: l.to.name, stopsToAlight: stops };
        // voie : trains seulement (panneau « voie » ; un quai de bus n'en est pas une)
        if (plat && isTrain(l)) mo.platform = plat;
        if (platformChanged(l) && isTrain(l)) mo.platformChanged = true;
        // 1.3.1 (§ 4, B13) : l'arrêt où monter ; heure prévue d'un train en retard
        mo.stop = l.from.name;
        const sc = trainSched(l);
        if (sc !== undefined) mo.sched = sc;
        if (p >= 0) {
          const w = legs[k - 1].kind === 'walk' && k - 1 > p ? legs[k - 1] : undefined;
          const walkMin = w && now < w.arr ? walkMinOf(w) : undefined;
          if (walkMin !== undefined) mo.walkMin = walkMin;
          mo.marginMin = Math.floor((l.dep - Math.max(now, legs[p].arr)) / MIN) - (walkMin ?? 0);
          // 1.3.1 (B16, U4) : correspondance très juste : le suivant de la même ligne (GuideInput.nextByLeg, lu au
          // tableau par le contrôleur), « Si tu le rates : tram 3 à 08:51 » ; jamais sinon
          const mg = connectionMargin(legs, k);
          const nx = c.in.nextByLeg?.[k];
          // très juste dit comme à « Descends » (Then.tight) : la même correspondance, le même mot (A4 : le moteur le dit)
          if (mg !== undefined && mg <= GUIDE.tightMin) mo.tight = true;
          if (mg !== undefined && mg <= GUIDE.tightMin && nx && Number.isFinite(nx.depAt) && nx.depAt > l.dep) {
            mo.ifMissed = { vehicle: { ...nx.vehicle }, depAt: nx.depAt, rt: !!nx.rt };
          }
        }
        return mo;
      },
    };
    out.push(board);
    const boardLive = !board.end && (board.trig || shown(id));
    if (k === toBoard && isTrain(l) && platformChanged(l) && !boardLive && !m.dismissed.includes(id) && !boardedOn(m, k) && now < l.dep) {
      const pid = `platform:${jid}:${k}:${l.newPlatform}`;
      const since0 = m.shown[pid] ?? now;
      out.push({
        id: pid, kind: 'platform', trig: true, end: now >= since0 + GUIDE.platformMs,
        make: (since) => ({ kind: 'platform', id: pid, since, until: since + GUIDE.platformMs, leg: k, vehicle: vehicleRef(l), depAt: l.dep, platform: l.newPlatform as string, ...(l.platform ? { was: l.platform } : {}), ...(trainSched(l) !== undefined ? { sched: trainSched(l) } : {}) }),
      });
    }
  }

  // partir (avant les virages : 1.3.1, A5, P2) : « Partir maintenant » reste devant le premier virage jusqu'à 15 m de
  // marche sur le chemin (deux positions), puis la flèche ; fini dès qu'une flèche de la première marche a été montrée
  // (demi-tour compris : il ne revient pas après elle)
  let leaveHold = false;
  if (c.in.kind === 'trip' && legs[0]?.kind === 'walk' && (ph.kind === 'before' || (ph.kind === 'walk' && ph.leg === 0))) {
    const w = legs[0];
    // 1.3.1 (vrai chemin partout) : heure de partir avancée pendant le guidage : pas avant l'instant où elle est connue
    const at = Math.max(j.leaveAt, c.in.startedAt, c.leaveKnownAt ?? 0);
    const id = `leave:${jid}`;
    const r = legs[1]?.kind === 'ride' ? legs[1] : undefined;
    const arrowSeen = Object.keys(m.shown).some((x) => x.startsWith(`turn:${jid}:0:`));
    const trig = now >= at;
    const end = c.started || now >= at + GUIDE.leaveMs || arrowSeen;
    leaveHold = !end && (trig || shown(id)) && !m.dismissed.includes(id) && !walkedAlong(c, 0, GUIDE.leaveHoldM);
    out.push({
      id, kind: 'leave', trig, end,
      make: (since) => {
        const walkMin = walkMinOf(w);
        const mo: Moment = { kind: 'leave', id, since, until: at + GUIDE.leaveMs, leg: 0, walkMin, toward: w.to.name };
        if (r) {
          // marge exacte (en minutes, avec les secondes) : 2 min de marge ne deviennent pas « très juste » une seconde
          // après l'apparition (1,98 arrondi à 1) ; très juste : 60 s au plus
          const exact = (r.dep - now) / MIN - walkMin;
          const margin = Math.floor(exact);
          mo.vehicle = vehicleRef(r);
          mo.depAt = r.dep;
          mo.rt = !!r.rt;
          mo.marginMin = margin;
          const sc = trainSched(r);
          if (sc !== undefined) mo.sched = sc;
          if (exact <= GUIDE.tightMin) {
            mo.tight = true;
            if (c.in.missed) mo.missed = { ...c.in.missed };
          }
        }
        return mo;
      },
    });
  }

  // virages de la marche en cours ; en attente (à 60 m de l'arrêt à vol d'oiseau), ceux qui restent sur le chemin de la
  // marche d'avant, derrière « monter » (priorité inchangée)
  const tw = ph.kind === 'walk' ? ph.leg : ph.kind === 'wait' && ph.leg > 0 && legs[ph.leg - 1].kind === 'walk' ? ph.leg - 1 : -1;
  if (tw >= 0 && c.fix && c.walkPr && c.walkPr.leg === tw) {
    const w = tw;
    const wl = legs[w];
    const route = c.walkPr.route;
    const pts = routePoints(route);
    const cum = cumulative(pts);
    const until = c.fix.at + GUIDE.freshMs;
    const final = w === legs.length - 1;
    // 1.3.1 (A6, P3) : « Fais demi-tour », devant les autres virages (même priorité, ajouté avant eux)
    if (ph.kind === 'walk' && route.source === 'osm') {
      const u = uturnCand(c, w, route, pts, cum);
      if (u) out.push(u);
    }
    if (c.walkPr.offM <= GUIDE.offRouteM) {
      const along = c.walkPr.alongM;
      const reach = Math.max(GUIDE.turnM, (c.speed ?? 0) * GUIDE.turnS);
      // 1.3.1 (B18, P8) : progression des dernières positions sur le chemin : jusqu'à 3 dans les 10 s pour la distance
      // (médiane), la position d'avant (60 s au plus) pour la fin du virage (les deux 10 m après lui ; une seule
      // position récente : elle suffit)
      const near = recentFixes(c, GUIDE.turnMedianMs).slice(-GUIDE.turnMedianN).map((f) => projectOn(pts, f, cum).alongM);
      const recent = recentFixes(c, GUIDE.freshMs);
      const prevAlong = recent.length >= 2 ? projectOn(pts, recent[recent.length - 2], cum).alongM : Infinity;
      const turns = turnsOf(route, cum);
      for (let n = 0; n < turns.length; n++) {
        const t = turns[n];
        // 1.3.1 (B18, P6) : le virage suivant à 30 m au plus (traversée aux trottoirs séparés) est annoncé avec celui-ci
        // (« puis à gauche ») ; le moment dure jusqu'après lui, rien ne change pendant la traversée
        const nx = n + 1 < turns.length && turns[n + 1].alongM - t.alongM <= GUIDE.turnThenM ? turns[n + 1] : undefined;
        if (nx) n++;
        const id = `turn:${jid}:${w}:${t.i}:${route.builtAt}`;
        const past = (nx ?? t).alongM + GUIDE.turnAfterM;
        const end = along >= past && prevAlong >= past;
        // jamais lancé déjà au-delà (positions espacées) ; « Partir maintenant » d'abord (A5)
        const trig = !end && along < past && t.alongM - along <= reach && !(w === 0 && leaveHold);
        if (!trig && !shown(id)) continue;
        const ds = near.map((a) => t.alongM - a).sort((x, y) => x - y);
        let d = Math.max(0, Math.round(ds[Math.floor((ds.length - 1) / 2)] ?? t.alongM - along));
        if (m.turnDist?.id === id) d = Math.min(d, m.turnDist.d);
        const street = nx ? (nx.m.street ?? t.m.street) : t.m.street;
        out.push({
          id, kind: 'turn', trig, end,
          make: (since) => ({ kind: 'turn', id, since, until, leg: w, turn: t.m.turn, distM: d, ...(street ? { street } : {}), toward: wl.to.name, final, ...(nx ? { then: nx.m.turn } : {}) }),
        });
      }
    }
  }

  // 1.3.1 (B17, P7) : après une descente, la marche suivante, comme « Partir maintenant » (« 3 min à pied jusqu'à
  // l'arrêt Gare Centrale / bus 71 à 08:34 » ; dernière marche : l'arrivée). Paraît près de l'arrêt de descente (sans
  // position : jusqu'à 5 min après l'arrivée du véhicule) ; finie après 40 m, au premier virage, à « monter » (la phase
  // passe à l'attente) ou au bout de 3 min. Marche hors de Belgique : le moment offMap (1.3.0) le dit déjà
  if (c.in.kind === 'trip' && ph.kind === 'walk' && ph.leg >= 1 && legs[ph.leg].kind === 'walk' && legs[ph.leg - 1].kind === 'ride' && !outsideRoute(c, ph.leg)) {
    const w = ph.leg;
    const wl = legs[w];
    const p = legs[w - 1];
    const id = `walk:${jid}:${w}`;
    const since0 = m.shown[id];
    const r = legs[w + 1]?.kind === 'ride' ? legs[w + 1] : undefined;
    const final = w === legs.length - 1;
    const near = c.fix ? knownPoint(wl.from) && distTo(c, wl.from) <= atStopM(p) : now < p.arr + GUIDE.alightAfterMs + GUIDE.leaveMs;
    const turnSeen = out.some((x) => x.kind === 'turn' && x.trig) || Object.keys(m.shown).some((x) => x.startsWith(`turn:${jid}:${w}:`));
    const boardSeen = Object.keys(m.shown).some((x) => x.startsWith(`board:${jid}:${w + 1}:`));
    const end = turnSeen || boardSeen || (since0 !== undefined && (now >= since0 + GUIDE.leaveMs || movedSince(c, since0) >= GUIDE.leaveM));
    out.push({
      id, kind: 'walk', trig: since0 === undefined && near, end,
      make: (since) => {
        const mo: Moment = { kind: 'walk', id, since, until: since + GUIDE.leaveMs, leg: w, walkMin: walkMinOf(wl), toward: wl.to.name, final };
        if (r) {
          mo.vehicle = vehicleRef(r);
          mo.depAt = r.dep;
          mo.rt = !!r.rt;
          const sc = trainSched(r);
          if (sc !== undefined) mo.sched = sc;
          const pl = platformOf(r);
          if (pl && isTrain(r)) mo.platform = pl;
        } else if (final) mo.arr = j.arr;
        // 1.3.1 (PRD-1.3.1 § 14, R1) : la sortie du métro à prendre, si le contrôleur la connaît (core/exits.ts)
        const exit = c.in.exitByLeg?.[w];
        if (exit) mo.exit = exit;
        return mo;
      },
    });
  }

  // 1.3.0 (PRD-1.3.0 § 4) : marche sans chemin à pied (hors de Belgique) : une fois, au début de la marche (ou dès que
  // son chemin est connu, au lancement si l'on marche déjà), la direction et le temps ; aucun virage (chemin droit).
  // Fini au bout de 30 s, d'un toucher, ou à la fin de la marche
  if (ph.kind === 'walk' && legs[ph.leg]?.kind === 'walk' && outsideRoute(c, ph.leg)) {
    const w = ph.leg;
    const id = `offMap:${jid}:${w}`;
    const since0 = m.shown[id] ?? now;
    out.push({
      id, kind: 'offMap', trig: true, end: now >= since0 + GUIDE.offMapMs,
      make: (since) => ({ kind: 'offMap', id, since, until: since + GUIDE.offMapMs, leg: w, ...offMapOf(c, w) }),
    });
  }

  // 1.3.0 (PRD-1.3.0 § 6.3) : vérification, derrière toute action (priorité)
  out.push(...checkCands(c, loc));

  // arrivée
  if (ph.kind === 'arrived') {
    const id = `arrived:${jid}`;
    const since0 = m.shown[id] ?? now;
    const lastArr = legs[legs.length - 1]?.schedArr ?? j.arr;
    out.push({
      id, kind: 'arrived', trig: true, end: now >= since0 + GUIDE.arrivedMs,
      make: (since) => {
        const at = m.arrivedByFix ? (m.arrivedAt ?? since) : j.arr;
        return { kind: 'arrived', id, since, until: since + GUIDE.arrivedMs, leg: legs.length - 1, title: c.in.title, at, diffMin: roundMin(at - lastArr) };
      },
    });
  }
  return out;
}

/** Choisit le moment : le plus prioritaire de ceux qui tiennent, ni effacés ni finis ; range ceux qui sont finis. */
function pick(c: Ctx, cands: Cand[]): Moment | null {
  const m = c.m;
  const live = cands.filter((x) => !x.end && (x.trig || m.shown[x.id] !== undefined));
  const liveIds = new Set(live.map((x) => x.id));
  if (m.cur && !liveIds.has(m.cur) && !m.dismissed.includes(m.cur)) m.dismissed.push(m.cur);
  const vis = live.filter((x) => !m.dismissed.includes(x.id));
  vis.sort((a, b) => PRIO[a.kind] - PRIO[b.kind]);
  const top = vis[0];
  if (!top) {
    delete m.cur;
    return null;
  }
  const fresh = m.shown[top.id] === undefined;
  if (fresh) m.shown[top.id] = c.now;
  if (fresh && top.kind === 'nextStop') m.lastNextStopAt = c.now;
  m.cur = top.id;
  return top.make(m.shown[top.id]);
}

/* ------------------------------ Où tu en es ------------------------------ */

function chainOf(c: Ctx, loc: Loc): WhereAmI['chain'] {
  const { legs } = c;
  const ph = loc.phase;
  const out: WhereAmI['chain'] = [];
  const doneAll = ph.kind === 'arrived' || ph.kind === 'ended';
  const rides = legs.map((l, i) => (l.kind === 'ride' ? i : -1)).filter((i) => i >= 0);
  if (legs[0]?.kind === 'walk') {
    const state = doneAll || loc.leg > 0 ? 'done' : ph.kind === 'walk' ? 'now' : 'next';
    out.push({ label: 'à pied', state });
  }
  // véhicule en cours : celui où l'on est, qu'on attend, ou vers lequel on marche (correspondance)
  let now = -1;
  if (ph.kind === 'ride' || ph.kind === 'wait') now = ph.leg;
  else if (ph.kind === 'walk' && ph.leg > 0) now = nextRide(legs, ph.leg);
  for (const k of rides) {
    const state = doneAll || (now >= 0 ? k < now : false) || (now < 0 && ph.kind === 'walk' && ph.leg > k) ? 'done' : k === now ? 'now' : 'next';
    out.push({ label: rideName(legs[k]), state });
  }
  return out;
}

function whereOf(c: Ctx, loc: Loc): WhereAmI {
  const { legs, now, j } = c;
  const w: WhereAmI = { title: c.in.title, arr: j.arr, rt: !!j.rt, chain: chainOf(c, loc) };
  const ph = loc.phase;
  const waitOf = (k: number): NonNullable<WhereAmI['wait']> => {
    const l = legs[k];
    const out: NonNullable<WhereAmI['wait']> = { stop: l.from.name, vehicle: vehicleRef(l), head: l.head ?? l.to.name, depAt: l.dep, rt: !!l.rt };
    const p = platformOf(l);
    if (p && isTrain(l)) out.platform = p;
    if (platformChanged(l) && isTrain(l)) out.platformChanged = true;
    const sc = trainSched(l);
    if (sc !== undefined) out.sched = sc;
    // 1.3.1 (A3, I1) : sans temps réel, l'heure passée, le premier véhicule gardé : « Si tu le rates : arrivée … »
    if (!l.rt && now >= l.dep && k === nextRide(legs, 0) && c.in.missed) out.missed = { ...c.in.missed };
    return out;
  };
  if ((ph.kind === 'before' || ph.kind === 'walk') && legs[ph.leg]?.kind === 'walk') {
    const i = ph.leg;
    const wl = legs[i];
    const r = legs[i + 1]?.kind === 'ride' ? legs[i + 1] : undefined;
    const toKind: NonNullable<WhereAmI['walk']>['toKind'] = !r ? 'dest' : isTrain(r) ? (i > 0 && legs[i - 1].kind === 'ride' && platformOf(r) ? 'platform' : 'station') : 'stop';
    let remainingM: number | undefined;
    let remainingMin: number;
    const pr = c.walkPr?.leg === i ? c.walkPr : undefined;
    // 1.3.0 (PRD-1.3.0 § 4) : hors de Belgique, pas de chemin à pied : la distance à vol d'oiseau et ses minutes
    const outside = outsideRoute(c, i);
    const crowM = outside ? (c.fix && knownPoint(wl.to) ? distanceM(c.fix, wl.to) : ph.kind === 'before' ? outside.lengthM : undefined) : undefined;
    if (c.fix && ph.kind === 'walk' && pr) {
      remainingM = outside && crowM !== undefined ? crowM : pr.remainingM;
      remainingMin = minutesFor(remainingM, pr.route.source === 'straight');
    } else if (c.fix && ph.kind === 'walk' && knownPoint(wl.to)) {
      remainingM = distanceM(c.fix, wl.to);
      remainingMin = minutesFor(remainingM, true);
    } else if (ph.kind === 'before') {
      remainingMin = walkMinOf(wl);
    } else {
      remainingMin = Math.max(0, Math.ceil((wl.arr - now) / MIN));
    }
    const walk: NonNullable<WhereAmI['walk']> = { toward: wl.to.name, toKind, remainingMin };
    if (remainingM !== undefined) walk.remainingM = Math.round(remainingM);
    if (r) {
      walk.vehicle = vehicleRef(r);
      walk.depAt = r.dep;
      walk.rt = !!r.rt;
      walk.marginMin = Math.floor((r.dep - now) / MIN) - remainingMin;
      const sc = trainSched(r);
      if (sc !== undefined) walk.sched = sc;
    }
    if (pr && pr.route.source === 'osm' && c.fix) {
      const nx = walkProgress(pr.route, c.fix).next;
      if (nx) walk.next = { turn: nx.m.turn, distM: Math.round(nx.distM) };
    }
    if (c.fix && ph.kind === 'walk' && (!pr || pr.route.source === 'straight') && Number.isFinite(c.fix.heading) && knownPoint(wl.to)) {
      walk.bearingDeg = Math.round(relativeDeg(bearingDeg(c.fix, wl.to), c.fix.heading as number));
    }
    if (outside) {
      walk.offMap = true;
      if (crowM !== undefined) walk.crowM = Math.round(crowM);
    }
    // 1.3.1 (vrai chemin partout) : avant de partir, l'heure de partir avancée du trajet (« Ensuite : partir à 07:12 »)
    if (ph.kind === 'before' && c.leaveMoved) walk.leaveAt = j.leaveAt;
    w.walk = walk;
  } else if (ph.kind === 'before' && legs[ph.leg]?.kind === 'ride') {
    w.wait = waitOf(ph.leg);
  } else if (ph.kind === 'wait') {
    w.wait = waitOf(ph.leg);
  } else if (ph.kind === 'ride') {
    const l = legs[ph.leg];
    const stops = stopsOf(l);
    const n = stops.length;
    const next = Math.min(n - 1, Math.max(1, ph.next));
    w.ride = {
      vehicle: vehicleRef(l),
      ...(l.head ? { head: l.head } : {}),
      total: n,
      next,
      nextStop: stops[next].name,
      nextAt: stops[next].est,
      alight: l.to.name,
      alightAt: l.arr,
      stopsToAlight: n - next,
      rt: !!l.rt,
    };
  }
  return w;
}

/* ------------------------------ Position, réveil, chemin ------------------------------ */

function locationOf(c: Ctx, loc: Loc): LocationNeed {
  const { legs, now, j } = c;
  const ph = loc.phase;
  let need: LocationNeed = 'off';
  if (ph.kind === 'before') {
    const at = legs[0]?.kind === 'walk' ? j.leaveAt : legs[0] ? legs[0].dep - GUIDE.boardAheadMs : j.leaveAt;
    need = now >= at - GUIDE.mediumBeforeMs ? 'medium' : 'off';
  } else if (ph.kind === 'walk') need = 'high';
  else if (ph.kind === 'wait') {
    const l = legs[ph.leg];
    need = l.dep - now <= GUIDE.boardAheadMs || now >= l.dep ? 'high' : 'medium';
  } else if (ph.kind === 'ride') {
    const n = stopsOf(legs[ph.leg]).length;
    need = ph.next >= n - 1 ? 'high' : 'medium';
  }
  // suivi sans messages (réglage éteint) : jamais la plus haute précision
  if (!c.guided && need === 'high') need = 'medium';
  return need;
}

function needRouteOf(c: Ctx, loc: Loc): GuideState['needRoute'] {
  if (!c.guided) return undefined;
  const { legs } = c;
  const ph = loc.phase;
  if (ph.kind === 'arrived' || ph.kind === 'ended') return undefined;
  // en attente, encore sur le chemin de la marche d'avant avec un virage devant : ce chemin reste (ses virages derrière
  // « monter ») ; celui de la marche suivante attendra
  if (ph.kind === 'wait' && ph.leg > 0 && legs[ph.leg - 1].kind === 'walk' && turnAhead(c, ph.leg - 1)) return undefined;
  const from = ph.kind === 'ride' ? ph.leg + 1 : loc.leg;
  let w = -1;
  for (let i = Math.max(0, from); i < legs.length; i++) {
    if (legs[i].kind === 'walk') {
      w = i;
      break;
    }
    if (i > from && legs[i].kind === 'ride') break;
  }
  if (w < 0) return undefined;
  const wl = legs[w];
  if (!knownPoint(wl.to)) return undefined;
  const walking = ph.kind === 'walk' && ph.leg === w;
  const start = walking && c.fix ? { lat: c.fix.lat, lon: c.fix.lon } : w === 0 && knownPoint(c.in.origin) ? { lat: c.in.origin.lat, lon: c.in.origin.lon } : knownPoint(wl.from) ? { lat: wl.from.lat, lon: wl.from.lon } : undefined;
  if (!start) return undefined;
  const have = c.in.walk;
  const haveIt = !!have && have.leg === w && !!have.route && distanceM(have.route.to, wl.to) <= 30;
  if (haveIt && walking && offRouteLong(c, have!.route)) return { leg: w, from: start, to: { lat: wl.to.lat, lon: wl.to.lon } };
  if (haveIt) return undefined;
  return { leg: w, from: start, to: { lat: wl.to.lat, lon: wl.to.lon } };
}

/** Sur le chemin gardé de la marche `w` (30 m au plus), avec un virage encore devant (pas fini). */
function turnAhead(c: Ctx, w: number): boolean {
  const pr = c.walkPr;
  if (!c.fix || !pr || pr.leg !== w || pr.offM > GUIDE.offRouteM) return false;
  return turnsOf(pr.route, cumulative(routePoints(pr.route))).some((t) => t.alongM + GUIDE.turnAfterM > pr.alongM);
}

/** Hors du chemin de plus de 30 m pendant 10 s (toutes les positions de ces 10 s, la plus ancienne il y a 10 s ou plus). */
function offRouteLong(c: Ctx, route: WalkRoute): boolean {
  if (!c.fix) return false;
  const good = fixesOf(c.in).filter((f) => f.at <= c.fix!.at);
  const pts = routePoints(route);
  const cum = cumulative(pts);
  let oldest = Infinity;
  for (let i = good.length - 1; i >= 0; i--) {
    const f = good[i];
    if (projectOn(pts, f, cum).offM <= GUIDE.offRouteM) return false;
    oldest = f.at;
    if (c.fix.at - f.at >= GUIDE.offRouteMs) return true;
  }
  return c.fix.at - oldest >= GUIDE.offRouteMs;
}

function wakeOf(c: Ctx, moment: Moment | null): number {
  const { legs, now, j, m } = c;
  let best = now + GUIDE.wakeMaxMs;
  const add = (t: number | undefined) => {
    if (t !== undefined && Number.isFinite(t) && t > now && t < best) best = t;
  };
  add(j.leaveAt - GUIDE.mediumBeforeMs);
  add(j.leaveAt);
  add(Math.max(j.leaveAt, c.in.startedAt, c.leaveKnownAt ?? 0) + GUIDE.leaveMs);
  for (let k = 0; k < legs.length; k++) {
    const l = legs[k];
    add(l.dep);
    add(l.arr);
    if (l.kind !== 'ride') continue;
    for (const t of [l.dep - GUIDE.boardAheadMs, l.dep + GUIDE.boardAfterMs, l.dep + GUIDE.missedMs, l.dep + GUIDE.missedPlannedMs, l.dep + GUIDE.alightEstMs, l.arr - GUIDE.alightNotBeforeMs, l.arr + GUIDE.alightAfterMs]) add(t);
    // 1.3.1 (A3, I1) : fin de la garde d'un véhicule sans temps réel
    if (!l.rt) add(keptUntil(c, k));
    for (const s of l.stops ?? []) {
      add(s.est - GUIDE.nextStopBeforeMs);
      add(s.est + GUIDE.alightEstMs);
      add(s.est + GUIDE.nextStopAfterMs);
    }
  }
  add(j.arr + GUIDE.endAfterMs);
  if (moment) {
    add(moment.until);
    const dep = moment.kind === 'leave' || moment.kind === 'board' ? moment.depAt : undefined;
    if (dep !== undefined && dep > now) add(now + ((dep - now) % MIN || MIN));
  }
  if (m.re) {
    add(m.re.t + GUIDE.replanMs);
    add(m.re.t + GUIDE.passedMs);
    if (m.re.swap) add(m.re.swap.at + GUIDE.replanMs);
    if (m.re.none !== undefined) add(m.re.none + GUIDE.replanMs);
  }
  if (m.arrivedAt !== undefined) add(m.arrivedAt + GUIDE.arrivedMs);
  for (const t of Object.values(m.shown)) {
    add(t + GUIDE.platformMs);
    add(t + GUIDE.arrivedMs);
  }
  // 1.3.0 (PRD-1.3.0 § 6.3) : vérification du lancement, position perdue (au plus tard 60 s après, sinon)
  const k = c.guided ? m.chk : undefined;
  if (k) {
    if (k.bat === undefined) add(c.in.startedAt + GUIDE.checkAfterMs);
    if (k.noPos === undefined && k.need !== undefined) add(k.need + GUIDE.checkAfterMs);
    if (k.fix !== undefined && k.need !== undefined && !k.told.includes('positionLost')) add(Math.max(k.fix, k.need) + GUIDE.lostMs);
  }
  return Math.max(now + GUIDE.wakeMinMs, best);
}

/* ------------------------------ Pas du moteur ------------------------------ */

/** Prend en compte un changement de trajet : nouveau trajet adopté après une demande de recalcul, ou autre trajet. */
function adopt(m: Mem, j: Journey, now: number): void {
  prune(m, j.id);
  if (m.jid === j.id) return;
  if (m.jid !== undefined) {
    let keep: Mem['boarded'];
    if (m.re && m.re.jid === m.jid && m.re.jid !== j.id && !m.re.swap && m.re.none === undefined) {
      m.re.swap = { jid: j.id, at: now };
      const ob = m.re.onBoard;
      const k = ob ? j.legs.findIndex((l) => l.kind === 'ride' && l.schedDep === ob.schedDep && (l.tripId ?? '') === (ob.tripId ?? '')) : -1;
      if (ob && k >= 0) keep = { leg: k, at: ob.at };
    }
    delete m.boarded;
    if (keep) m.boarded = keep;
    delete m.alighted;
    delete m.arrivedAt;
    delete m.arrivedByFix;
    delete m.cur;
    delete m.lastNextStopAt;
    // 1.3.1 : progression à bord et distance du virage, propres aux étapes de l'ancien trajet
    delete m.rideNext;
    delete m.turnDist;
    delete m.atStop;
    delete m.walkedOff;
  }
  m.jid = j.id;
}

/** Fin du guidage : « Tu y es » + 2 min, arrivée + 5 min (règle 1.2.x), pas parti (règle 1.2.x). */
function endedNow(c: Ctx, loc: Loc): boolean {
  const { legs, now, m, j } = c;
  if (!legs.length) return true;
  if (m.arrivedAt !== undefined) {
    const since = m.shown[`arrived:${j.id}`] ?? (c.guided ? undefined : m.arrivedAt);
    if (since !== undefined && now >= since + GUIDE.arrivedMs) return true;
  }
  if (now >= j.arr + GUIDE.endAfterMs) {
    // encore en route d'après la position (véhicule en retard sans temps réel, marche plus lente) : 30 min au plus
    const ph = loc.phase;
    const last = legs[legs.length - 1];
    const nearing = !!c.fix && !!c.prev && knownPoint(last.to) && distanceM(c.fix, last.to) <= 2_000 && distanceM(c.fix, last.to) < distanceM(c.prev, last.to) - 5;
    const going = now < j.arr + 30 * MIN && ((ph.kind === 'ride' && boardedOn(m, ph.leg) && riding(c, ph.leg)) || (ph.kind === 'walk' && ph.leg === legs.length - 1 && walkingStill(c, ph.leg) && nearing));
    // 1.3.1 (A3, I1) : encore à l'arrêt d'un véhicule sans temps réel, gardé (keptUntil, plus 60 s : le recalcul se
    // demande après ce test), puis le temps du nouveau trajet demandé : pas fini (bus d'heure en heure, trajet court)
    const kept = ph.kind === 'wait' && !legs[ph.leg].rt && stillAtStop(c, ph.leg) && (now < keptUntil(c, ph.leg) + GUIDE.replanMs || (!!m.re && m.re.jid === j.id && !m.re.swap && m.re.none === undefined));
    if (!going && !kept) return true;
  }
  const r0 = nextRide(legs, 0);
  if (c.in.kind === 'trip' && r0 >= 0 && c.fix && knownPoint(c.in.origin)) {
    const late = legs[r0].dep + GUIDE.notLeftAfterMs;
    const waiting = m.re && m.re.jid === j.id && !m.re.swap && m.re.none === undefined;
    // parti du lancement (40 m) et à l'arrêt de montée : on attend un véhicule en retard (sans temps réel, il n'est
    // « raté » qu'après 10 min, detect), ce n'est pas « pas parti »
    const atStop = c.started && stillAtStop(c, r0);
    // 1.3.1 (A2, P1) : parti du lancement et en marche vers l'arrêt : ce n'est pas « pas parti » (detect dira s'il est raté)
    const walking = c.started && r0 > 0 && legs[r0 - 1].kind === 'walk' && walkingTo(c, r0 - 1);
    if (now >= late && c.fix.at >= late && distanceM(c.fix, c.in.origin) < GUIDE.notLeftM && !waiting && !atStop && !walking && !m.boarded && !m.alighted) return true;
  }
  return false;
}

/**
 * Un pas du moteur : l'état du guidage maintenant, et la mémoire à garder. Pur, déterministe ; à rappeler à chaque
 * position, à `wakeAt` et à chaque rafraîchissement du temps réel du trajet suivi.
 */
/**
 * 1.3.1 (décision du propriétaire du 20/11 à 21:59 : « 7h12 partout ») : l'heure de partir d'après le vrai chemin de la
 * première marche n'est plus calculée ici. Le trajet reçu la porte déjà (le cœur l'y pose pour tous les écrans :
 * core/firstwalk.ts, Leg.walkEst et Leg.walkMin de la première marche, Journey.leaveAt) : le moteur lit ce trajet, comme
 * l'accueil, l'écran du trajet et le téléphone, et ne corrige rien lui-même (jamais deux corrections l'une sur l'autre ;
 * GuideInput.walk ne sert qu'aux virages et à la marche restante). Marche prévue 3 min, chemin de 446 m (6 min), bus à
 * 07:20, marge 2 min : partir à 07:12 au lieu de 07:15, partout.
 *
 * Une seule chose reste au moteur : quand ces minutes arrivent pendant le guidage du même trajet, l'heure de partir
 * saute en arrière, parfois avant maintenant. C'est alors un trajet dont l'heure de partir est passée, comme en 1.3.0
 * (« Partir maintenant » tout de suite, « très juste », « Si tu le rates », puis le véhicule parti) ; « Partir
 * maintenant » compte ses 3 min depuis l'instant où l'heure a sauté (mémoire `walk0.at`), pas depuis une heure passée
 * où personne ne l'aurait vu, et jamais plus tard que l'heure de partir estimée. Décidé une fois par trajet (contrôle du
 * moteur, c7eec05) : les minutes sont dans le trajet, un chemin recalculé en route ou une position perdue n'y changent
 * rien. Rend cet instant ; undefined : rien de tel (lancement, nouveau trajet, pas de correction).
 */
function leaveKnownAt(input: GuideInput, m: Mem, seen: boolean): number | undefined {
  const j = input.journey;
  if (input.kind !== 'trip' || !firstWalkMoved(j)) {
    if (m.walk0 && m.walk0.jid !== j.id) delete m.walk0;
    return undefined;
  }
  const w = j.legs[0];
  const min = w.walkMin as number;
  if (m.walk0?.jid !== j.id || m.walk0.min !== min) m.walk0 = seen ? { jid: j.id, min, at: input.now } : { jid: j.id, min };
  if (m.walk0.at === undefined) return undefined;
  // jamais plus tard que l'heure de partir estimée (contrôle du moteur) : un « Partir maintenant » déjà montré à cette
  // heure garde son début et sa fin
  return Math.min(m.walk0.at, j.leaveAt + (min - (w.walkEst as number)) * MIN);
}

export function guideStep(input: GuideInput, mem: GuideMemory): { state: GuideState; mem: GuideMemory } {
  const m = readMem(mem);
  const seen = m.jid === input.journey.id;
  adopt(m, input.journey, input.now);
  // 1.3.1 (vrai chemin partout) : le trajet porte déjà l'heure de partir du vrai chemin (le cœur) ; rien n'est corrigé ici
  const j = input.journey;
  const known = leaveKnownAt(input, m, seen);
  const c = context(input, m);
  c.leaveMoved = input.kind === 'trip' && firstWalkMoved(j);
  if (known !== undefined) c.leaveKnownAt = known;
  const now = c.now;
  observe(c);
  let loc: Loc;
  const arr = arrivedNow(c);
  if (arr.yes) {
    if (m.arrivedAt === undefined) {
      m.arrivedAt = now;
      if (arr.byFix) m.arrivedByFix = true;
    }
    loc = { phase: { kind: 'arrived' }, leg: -1 };
  } else {
    if (m.arrivedAt !== undefined && carriedOn(c)) {
      // « Tu y es » donné trop tôt (arrêt en gare, resté à bord) : oublié, le guidage continue (arrêt dépassé)
      const id = `arrived:${j.id}`;
      delete m.arrivedAt;
      delete m.arrivedByFix;
      delete m.shown[id];
      if (m.cur === id) delete m.cur;
    }
    loc = locate(c);
  }
  if (endedNow(c, loc)) loc = { phase: { kind: 'ended' }, leg: -1 };
  detect(c, loc);
  const ended = loc.phase.kind === 'ended';
  const location = ended ? 'off' : locationOf(c, loc);
  // 1.3.0 (PRD-1.3.0 § 6.3) : vérification (guidage avec messages seulement ; suivi sans messages : comme en 1.2.10)
  if (c.guided && !ended) {
    // 1.3.1 (A8, I4) : à l'arrêt et à bord (sous terre, dans le métro), rien sur la position, ni moment ni problème de la
    // carte « En cours » : seulement avant de partir et à pied (le journal note le trou des positions). La vérification y
    // compte la position comme non demandée : à la sortie, l'attente repart de zéro (pas de « Position perdue depuis
    // 12 min » au premier pas dehors ; « Pas de position » 30 s après, si aucune n'est jamais venue)
    c.issues = checkOf(c, loc.phase.kind === 'wait' || loc.phase.kind === 'ride' ? 'off' : location);
  }
  let moment: Moment | null = null;
  if (c.guided && !ended) moment = pick(c, candidates(c, loc));
  else if (c.guided && m.cur && !m.dismissed.includes(m.cur)) {
    m.dismissed.push(m.cur);
    delete m.cur;
  }
  // 1.3.1 (B18, P8) : la distance montrée d'un virage ne remonte pas (après un demi-tour, elle repart de la position)
  if (moment?.kind === 'turn' && moment.turn !== 'uturn') m.turnDist = { id: moment.id, d: moment.distM };
  else if (moment?.kind === 'turn') delete m.turnDist;
  if (moment?.kind === 'check' && m.chk) for (const kind of checkKinds(moment.id)) if (!m.chk.told.includes(kind)) m.chk.told.push(kind);
  const state: GuideState = {
    kind: input.kind,
    journeyId: j.id,
    phase: loc.phase,
    moment,
    where: whereOf(c, loc),
    location,
    wakeAt: wakeOf(c, moment),
    ended,
  };
  if (c.issues.length) state.issues = c.issues.map((i) => ({ ...i }));
  const re = m.re;
  if (c.guided && !ended && re && re.jid === j.id && !re.swap && re.none === undefined && !re.local && (input.kind === 'trip' || re.reason !== 'late')) {
    state.replan = { from: { ...re.from }, reason: re.reason === 'late' ? 'missed' : re.reason, at: re.at };
  }
  const need = ended ? undefined : needRouteOf(c, loc);
  if (need) state.needRoute = need;
  return { state, mem: m };
}

/* ------------------------------ Nouveau trajet ------------------------------ */

/**
 * Nouveau trajet après une demande `state.replan` : encore dans un véhicule de l'ancien trajet (recalcul depuis sa
 * descente, correspondance ratée), les étapes jusqu'à ce véhicule compris restent devant le nouveau trajet (« Descends »
 * de ce véhicule, chaîne de « Où tu en es ») ; arrêt dépassé, arrêts suivants connus (`beyond`) : le véhicule où l'on
 * est resté, prolongé jusqu'à l'arrêt suivant où commence le nouveau trajet ; sinon le nouveau trajet tel quel.
 */
export function replanJourney(old: Journey, fresh: Journey, now: number, beyond?: BeyondByLeg): Journey {
  const start = fresh.legs[0]?.from;
  if (!start) return fresh;
  for (let k = 0; k < old.legs.length; k++) {
    const l = old.legs[k];
    if (l.kind !== 'ride' || l.cancelled || now >= l.arr || now < l.dep - GUIDE.boardAfterMs) continue;
    const same = (!!l.to.areaId && l.to.areaId === start.areaId) || (knownPoint(l.to) && knownPoint(start) && distanceM(l.to, start) <= 50);
    if (!same) continue;
    return joined(old, fresh, [...old.legs.slice(0, k + 1), ...fresh.legs], fresh.arr);
  }
  // arrêt dépassé, arrêts suivants du véhicule connus (`beyond`, GuideInput.beyondByLeg) : le véhicule où l'on est resté,
  // jusqu'à l'arrêt suivant où commence le nouveau trajet (jamais « Partir maintenant » encore à bord)
  const kept = beyond ? keepAboard(old, beyond, start, now) : null;
  if (!kept) return fresh;
  let rest = fresh.legs;
  const ext = kept.legs[kept.legs.length - 1];
  const f0 = rest[0];
  if (f0.kind === 'ride' && !!f0.tripId && f0.tripId === ext.tripId) {
    // le nouveau trajet continue dans ce véhicule : une seule étape, jusqu'à sa descente
    kept.legs[kept.legs.length - 1] = { ...ext, to: f0.to, arr: f0.arr, schedArr: f0.schedArr, stops: [...stopsOf(ext), ...stopsOf(f0).slice(1)], ...(f0.toSeq !== undefined ? { toSeq: f0.toSeq } : {}), ...(f0.toStop ? { toStop: f0.toStop } : {}) };
    rest = rest.slice(1);
  }
  return joined(old, fresh, [...kept.legs, ...rest], fresh.arr);
}

/** Arrêts suivants de chaque étape en véhicule, par rang dans les étapes (GuideInput.beyondByLeg). */
export type BeyondByLeg = Readonly<Record<number, readonly Stopover[]>>;

/** Trajet fait des étapes `legs` : début et heure de partir de l'ancien, le reste de `base`. */
function joined(old: Journey, base: Journey, legs: Leg[], arr: number): Journey {
  const rides = legs.filter(isRide);
  return { ...base, id: journeyId(legs), legs, dep: old.dep, arr, leaveAt: old.leaveAt, transfers: Math.max(0, rides.length - 1), rt: rides.every((x) => x.rt === true) };
}

/**
 * Arrêt dépassé : les étapes de l'ancien trajet jusqu'au véhicule où l'on est resté, lui prolongé jusqu'à `to`, un de
 * ses arrêts suivants (`beyond`, par rang d'étape) : arrêts, arrivée et descente de cet arrêt. Rien si aucun véhicule
 * parti ne s'y arrête. `i` : rang de `to` dans les arrêts suivants.
 */
function keepAboard(old: Journey, beyond: BeyondByLeg, to: LatLon & { areaId?: string }, now: number): { legs: Leg[]; i: number } | null {
  for (let k = old.legs.length - 1; k >= 0; k--) {
    const l = old.legs[k];
    const after = beyond[k];
    if (l.kind !== 'ride' || l.cancelled || !after?.length || now < l.dep - GUIDE.boardAfterMs) continue;
    const i = after.findIndex((s) => (!!s.areaId && s.areaId === to.areaId) || (knownPoint(s) && knownPoint(to) && distanceM(s, to) <= 50));
    if (i < 0) continue;
    const s = after[i];
    const p = knownPoint(s) ? s : knownPoint(to) ? to : { lat: 0, lon: 0 };
    const ext: Leg = {
      ...l,
      to: { name: s.name, lat: p.lat, lon: p.lon, ...(s.areaId ? { areaId: s.areaId } : {}) },
      arr: Math.max(s.est, l.dep),
      schedArr: s.sched,
      stops: [...stopsOf(l), ...after.slice(0, i + 1)].map((x) => ({ ...x })),
    };
    // la descente d'avant n'en est plus une (temps réel : l'arrivée suit alors le retard du départ)
    delete ext.toSeq;
    delete ext.toStop;
    return { legs: [...old.legs.slice(0, k), ext], i };
  }
  return null;
}

/**
 * Genre ride (« j'y descends »), arrêt dépassé, l'arrêt suivant connu (`state.replan`, raison passed, depuis `to`) :
 * le même véhicule jusqu'à cet arrêt, suivi comme un trajet normal (« Descends au prochain arrêt », « Tu y es »), et
 * les arrêts d'après lui (GuideInput.beyond). Rien si les arrêts suivants (`beyond`) ne le donnent pas.
 */
export function rideOnJourney(old: Journey, beyond: readonly Stopover[], to: LatLon & { areaId?: string }, now: number): { journey: Journey; beyond: Stopover[] } | null {
  const k = old.legs.findIndex(isRide);
  const kept = k >= 0 ? keepAboard(old, { [k]: beyond }, to, now) : null;
  if (!kept) return null;
  const legs = kept.legs;
  return { journey: joined(old, old, legs, legs[legs.length - 1].arr), beyond: beyond.slice(kept.i + 1).map((x) => ({ ...x })) };
}

/* ------------------------------ Genre ride (« J'y descends ») ------------------------------ */

/**
 * Trajet d'un seul véhicule, du départ choisi (`board`, rang dans `stops.stops`, en général `stops.at ?? 0`) jusqu'à
 * l'arrêt touché (`alight`). Facultatif : `coords`, la position de chaque arrêt de `stops.stops` (même rang), pour la
 * descente constatée et l'arrêt dépassé ; sans elle, le guidage se fait à l'heure.
 */
export function rideJourney(dep: Departure, stops: DepartureStops, board: number, alight: number, coords?: ReadonlyArray<LatLon | null | undefined>): Journey {
  const list = stops.stops.length ? stops.stops : [{ name: dep.head, sched: dep.sched, est: dep.est, rt: dep.rt, delayMin: dep.delayMin }];
  const n = list.length;
  const b = Math.max(0, Math.min(Number.isInteger(board) ? board : 0, Math.max(0, n - 2)));
  const a = Math.max(Math.min(n - 1, b + 1), Math.min(n - 1, Number.isInteger(alight) ? alight : n - 1));
  const at = stops.at ?? 0;
  const s0 = list[b];
  const s1 = list[a];
  const pt = (i: number): LatLon | undefined => {
    const p = coords?.[i];
    return knownPoint(p) ? { lat: p.lat, lon: p.lon } : undefined;
  };
  const so: Stopover[] = [];
  for (let i = b; i <= a; i++) {
    const s = list[i];
    if (i !== b && i !== a && s.cancelled) continue;
    const x: Stopover = { name: s.name, sched: s.sched, est: s.est };
    if (s.areaId) x.areaId = s.areaId;
    const p = s.newPlatform || s.platform;
    if (p) x.platform = p;
    const q = pt(i);
    if (q) {
      x.lat = q.lat;
      x.lon = q.lon;
    }
    so.push(x);
  }
  const end = (s: (typeof list)[number], i: number): Leg['from'] => {
    const q = pt(i);
    return { name: s.name, lat: q?.lat ?? 0, lon: q?.lon ?? 0, ...(s.areaId ? { areaId: s.areaId } : {}) };
  };
  const op = stops.op ?? dep.op;
  const line = stops.line ?? dep.line;
  const depAt = b === at ? s0.est : (s0.leave ?? s0.est);
  const leg: Leg = {
    kind: 'ride',
    from: end(s0, b),
    to: end(s1, a),
    dep: depAt,
    arr: s1.est,
    schedDep: s0.sched,
    schedArr: s1.sched,
    op,
    mode: stops.mode ?? dep.mode,
    line,
    head: stops.head ?? dep.head,
    rt: !!(s0.rt || (b === at && dep.rt)),
    delayMin: s0.delayMin ?? 0,
    cancelled: !!(s0.cancelled || (b === at && dep.cancelled)),
    stops: so,
  };
  if (op === 'sncb' && leg.mode === 'train') leg.cat = line;
  if (dep.tripId) leg.tripId = dep.tripId;
  if (b === at) {
    if (dep.stopId) leg.fromStop = dep.stopId;
    if (dep.stopSeq !== undefined) leg.fromSeq = dep.stopSeq;
    if (dep.last) leg.last = true;
  }
  const plat = s0.platform || (b === at ? dep.platform : undefined);
  const np = s0.newPlatform || (b === at ? dep.newPlatform : undefined);
  if (plat) leg.platform = plat;
  if (np && np !== plat) leg.newPlatform = np;
  const legs = [leg];
  return { id: journeyId(legs), legs, dep: leg.dep, arr: leg.arr, leaveAt: leg.dep, transfers: 0, rt: leg.rt === true, alerts: [] };
}

/* ------------------------------ Téléphone ------------------------------ */

/**
 * « Maintenant : … » de la carte « En cours » du téléphone : « bus 6 vers Gare des Guillemins », « à pied vers l’arrêt
 * Flagey » (1.3.1, PRD-1.3.1 § 4, U3 : le nom de l'arrêt, plus « l’arrêt du bus 6 »), « IC vers Courtrai, voie 3 »,
 * « partir à 07:05 » (1.3.1, L5 : la carte écrit alors « Ensuite : … », GuideStatus.then), « à pied, arrivée 08:54 »,
 * « tu y es ». 1.3.1 (§ 7) : les noms venus des données avec l'apostrophe typographique (apos).
 */
export function guideNowText(state: GuideState, journey: Journey, lang: NameLang, title?: string): string {
  const legs = journey.legs;
  const ph = state.phase;
  const toward = (l: Leg): string => `${rideName(l)} vers ${apos(headName({ op: l.op, head: l.head ?? l.to.name }, lang))}`;
  switch (ph.kind) {
    case 'before': {
      const l = legs[ph.leg];
      if (!l) return '';
      // 1.3.1 (vrai chemin partout) : l'heure du trajet (WhereAmI.walk.leaveAt la répète quand elle est avancée)
      if (l.kind === 'walk') return `partir à ${hhmm(state.where.walk?.leaveAt ?? journey.leaveAt)}`;
      return `${rideName(l)} à ${hhmm(l.dep)}`;
    }
    case 'walk': {
      const r = legs[ph.leg + 1];
      // dernière marche : vers où (la ligne du dessus de la carte dit déjà l'arrivée) ; sans titre, l'arrivée
      if (!r || r.kind !== 'ride') return title?.trim() ? `à pied ${towardText(title)}` : `à pied, arrivée ${hhmm(journey.arr)}`;
      if (isTrain(r)) {
        const p = platformOf(r);
        if (ph.leg > 0 && legs[ph.leg - 1].kind === 'ride' && p) return `à pied vers la voie ${p}`;
        return `à pied vers ${apos(displayName(r.from.name, lang))}`;
      }
      // 1.3.1 (§ 4, U3) : le nom de l'arrêt ; sans nom (données incomplètes), le véhicule comme avant
      const stop = apos(displayName(r.from.name, lang)).trim();
      return stop ? `à pied vers l’arrêt ${stop}` : `à pied vers l’arrêt du ${rideName(r)}`;
    }
    case 'wait': {
      const l = legs[ph.leg];
      if (!l) return '';
      const p = isTrain(l) ? platformOf(l) : undefined;
      return `${toward(l)}${p ? `, voie ${p}` : ''}`;
    }
    case 'ride': {
      const l = legs[ph.leg];
      return l ? toward(l) : '';
    }
    case 'arrived':
      return 'tu y es';
    default:
      return 'trajet terminé';
  }
}

/**
 * Carte « En cours » du téléphone (PRD § 4.3). `guided` : réglage « Me guider pendant un trajet ». 1.3.1 (L5) : avant le
 * départ, la ligne dit ce qui vient (« Ensuite : partir à 07:05 », `then`), pas ce qui se passe.
 */
export function guideStatusOf(state: GuideState, journey: Journey, title: string, guided: boolean, lang: NameLang): GuideStatus {
  const out: GuideStatus = { kind: state.kind, title, arr: journey.arr, now: guideNowText(state, journey, lang, title), guided };
  if (state.phase.kind === 'before' && out.now) out.then = true;
  return out;
}

/** « vers le bureau », « vers Gand-Saint-Pierre », « vers chez Karim » (titre du trajet, « Vers … » gardé). */
function towardText(title: string): string {
  const t = title.trim();
  const v = /^Vers\s/.test(t) ? t : vers(placeNoun(t));
  return v.charAt(0).toLowerCase() + v.slice(1);
}
