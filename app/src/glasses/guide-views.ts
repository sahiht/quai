/**
 * 1.2.10 « Y aller » (docs/v1.2.10/PRD-1.2.10.md § 3.2 à § 3.4, § 3.9) : écrans du guidage. Fonctions pures : état du
 * moteur (GuideState) + trajet + réglages + heure → GlassesView. Le moteur décide quoi montrer ; ces vues décident
 * comment : textes, luminosités, image, aides, menu.
 *
 * - Écran calme (par défaut) : ni titre, ni heure, ni texte, ni image ; 1.3.1 (PRD-1.3.1 § 1, B9) : au pied, au plus
 *   pâle et centrés, trois petits points « · · · » (Quai te suit, rien à faire), à bord la ligne de progression à leur
 *   place ; le toucher affiche « Où tu en es ».
 * - Un moment : une seule chose à faire, l'action au plus clair, image à gauche (panneau ou flèche), trois lignes au
 *   plus (quatre avec « Si tu le rates »), centrées sur l'image ; aides « toucher : masquer   appui long : arrêter ».
 * - « Où tu en es » (1.3.1, § 3 et § 12) : « Guidage en cours », la destination (« Jusqu’au bureau »), le prochain geste
 *   et son heure au plus clair (« Ensuite : bus W à 17:49 »), l'étape en cours, la chaîne du trajet (fait ●, en cours ◎
 *   au plus clair, à venir ○ pâles), l'arrivée.
 * Chaque texte est mesuré au pixel : un texte trop long passe à la ligne entre deux mots, ou se coupe au mot (« … »),
 * jamais l'action.
 */
import type { Journey, Leg, Names } from '../core/api';
import type { CheckIssue, GuideKind, GuideState, Moment, Then, VehicleRef, WhereAmI } from '../core/guide-types';
import { shortName } from '../core/typo';
import { displayName, hhmm } from '../core/util';
import { exitLineText } from './exit-line';
import { SCREEN_W, textWidth } from './font';
import {
  HINTS,
  NB,
  TURN_WORDS,
  alightWords,
  boardWait,
  delaySuffix,
  diffText,
  fitName,
  headText,
  isTrainRef,
  laterText,
  marginText,
  minText,
  missText,
  plannedMark,
  progressLine,
  rainyWalk,
  rideWords,
  towardTitle,
  tripName,
  truncateWords,
  turnText,
  untilTitle,
  upperFirst,
} from './format';
import { GEO, GUIDE } from './layout';
import { MENU_IDS, type GlassesView, type ImageKind, type ImageSpec, type Item, type MenuItem } from './types';
import { metersText, type ViewCtx } from './views';

/** Ce que l'écran du guidage montre : rien, le moment du moteur, ou « Où tu en es ». */
export type GuideShow = 'empty' | 'moment' | 'where';

/**
 * Menu de l'appui long pendant un guidage (PRD § 3.4) : menu système des lunettes, ou écran `menu` de Quai Web. 1.3.1
 * (B10, E4) : « Voir tout le trajet », « Voir les arrêts » (« Dans le train » du véhicule en cours ; le contrôleur le
 * retire d'un trajet sans véhicule), « Arrêter le guidage » en dernier (le curseur ne s'ouvre plus sur lui).
 */
export const GUIDE_MENU: MenuItem[] = [
  { id: MENU_IDS.allSteps, label: 'Voir tout le trajet' },
  { id: MENU_IDS.stops, label: 'Voir les arrêts' },
  { id: MENU_IDS.stopGuide, label: 'Arrêter le guidage' },
];

/**
 * 1.3.1 (B10, contrôle du sujet, remarque 6) : les choix du menu pour ce trajet : « Voir les arrêts » seulement s'il a un
 * véhicule (comme le menu envoyé par le contrôleur ; le journal QUAI_SCREEN dit les mêmes choix).
 */
export function guideMenuOf(journey: Pick<Journey, 'legs'>): MenuItem[] {
  const rides = journey.legs.some((l) => l.kind === 'ride');
  return GUIDE_MENU.filter((m) => rides || m.id !== MENU_IDS.stops).map((m) => ({ ...m }));
}

/** Textes fixes du guidage (PRD § 3.2, § 3.3). */
export const GUIDE_TEXT = {
  leave: 'Partir maintenant',
  alight: 'Descends au prochain arrêt',
  platform: 'Voie modifiée',
  platformBoard: 'voie modifiée',
  /**
   * 1.2.10 : « Où tu en es » à bord, quand le prochain arrêt est la descente. 1.3.1 (§ 12) : plus affiché (« Ensuite :
   * descente à … » et la progression le disent) ; gardé pour qui le lit encore.
   */
  alightHere: 'c’est ta descente',
  /** 1.3.0 (PRD-1.3.0 § 4) : marche hors de l'extrait de Belgique */
  offMap: 'Hors de Belgique',
  /** 1.3.0 (§ 4) : moment `offMap`, le cap connu (la flèche le montre) */
  offMapArrow: `pas de chemin à pied${NB}: suis la flèche`,
  /** 1.3.0 (§ 4) : moment `offMap` sans cap */
  offMapNoPath: 'pas de chemin à pied',
  /** 1.3.0 (§ 4) : « Où tu en es » à pied hors de Belgique, pâle */
  offMapWhere: 'hors de Belgique, pas de chemin à pied',
  /** 1.3.0 (§ 4) : distance d'une marche sans chemin (« 450 m à vol d’oiseau, 6 min ») */
  crow: 'à vol d’oiseau',
  /** 1.3.0 (PRD-1.3.0 § 6.3) : vérification au départ, titre du moment quand aucun problème n'est donné */
  check: 'À vérifier',
  /** 1.3.0 (§ 6.3) : pâle sous « Pas de position : Quai suit l’horaire » (1.3.1, L3) */
  checkNoPosition: `Position «${NB}Toujours${NB}» pour l’appli Even, sur le téléphone`,
  /** 1.3.0 (§ 6.3) : pâle sous « Position perdue depuis 3 min » ; 1.3.1 (L3) : « guidage à l’heure » se lisait « ponctuel » */
  checkLost: 'Quai suit l’horaire en attendant',
  arrived: 'Tu y es',
  none: 'Pas d’autre trajet trouvé',
  tight: 'très juste',
  /** 1.3.1 (PRD-1.3.1 § 1) : l'écran calme pendant un guidage, en bas au centre : Quai te suit, rien à faire */
  dots: '· · ·',
  /** 1.3.1 (§ 3, § 12) : titre de « Où tu en es » */
  where: 'Guidage en cours',
  /** 1.3.1 (§ 12, L1) : « Où tu en es » d'un « j'y descends » (Quai ne dit jamais « je ») */
  tellAlight: 'Quai te dit quand descendre',
  /** 1.3.1 (B19, I5) : 4e ligne pâle de « Partir maintenant » quand la première marche se fait sous la pluie */
  rain: 'pluie prévue',
} as const;

/** Luminosité d'une ligne : au plus clair (l'action, conteneur a), normale (b), pâle (c). */
type Lv = 'hi' | 'norm' | 'pale';

/**
 * Une ligne de texte du guidage : une idée par rangée, jamais de passage à la ligne. `alts` : le texte, puis ses formes
 * plus courtes, essayées dans l'ordre (« jusqu’à l’arrêt Monument Gramme », puis « jusqu’à Monument Gramme ») ; `fit` :
 * la forme qui tient dans la largeur donnée (un nom coupé au mot en dernier recours) ; `main` : l'action, jamais coupée.
 */
interface GLine {
  alts: string[];
  lv: Lv;
  main?: boolean;
  fit?: (maxPx: number) => string;
}

const L = (lv: Lv, ...alts: string[]): GLine => ({ alts: alts.filter(Boolean), lv });
const F = (lv: Lv, fit: (maxPx: number) => string): GLine => ({ alts: [], lv, fit });
const MAIN = (text: string): GLine => ({ alts: [text], lv: 'hi', main: true });

const mp = (ctx: ViewCtx): boolean => ctx.settings.display.markPlanned;
const nameOf = (n: Names | undefined, ctx: ViewCtx): string => (n ? displayName(n, ctx.settings.lang) : '');
const timeOf = (ms: number, rt: boolean, ctx: ViewCtx): string => `${plannedMark(rt, mp(ctx))}${hhmm(ms)}`;
const vehicle = (v: VehicleRef): string => rideWords(v);

/**
 * 1.3.1 (B13, U6) : l'heure d'un véhicule à prendre, « bus 6 à ~07:12 », « IC à 07:44 » ; un train en retard d'au moins
 * 1 min s'écrit comme en gare, l'heure prévue et le retard (« IC 07:42 +2 ») : `sched`, donné par le moteur.
 */
export function vehicleAtText(v: VehicleRef, depAt: number, rt: boolean, ctx: ViewCtx, sched?: number): string {
  if (sched !== undefined && isTrainRef(v) && depAt - sched >= 60_000) return `${vehicle(v)} ${hhmm(sched)}${delaySuffix(Math.round((depAt - sched) / 60_000))}`;
  return `${vehicle(v)} à ${timeOf(depAt, rt, ctx)}`;
}

/**
 * 1.3.1 (PRD-1.3.1 § 12, L1) : la destination d'un guidage, « Jusqu’au bureau », « Jusqu’à la place Fontainas »,
 * « Jusqu’à Bruxelles-Central » (« j'y descends ») : d'après le titre, nu (« Bureau »), « Vers … » ou déjà « Jusqu’à … ».
 */
export function untilLine(title: string): string {
  const t = title.trim();
  return upperFirst(/^jusqu(?:e\s|[’'])/i.test(t) ? t : untilTitle(t));
}

/**
 * 1.3.1 (§ 12) : titre des écrans du guidage (moments) : le nom du trajet (« Bureau ») ; « j'y descends » : « Jusqu’à
 * Bruxelles-Central » (au lieu de « Vers … »). Pour le contrôleur (guideTitle : carte « En cours », journal), qui peut
 * aussi le donner tout fait : le résultat ne change plus s'il est redonné.
 */
export function guideTitleText(title: string, kind: GuideKind): string {
  return kind === 'ride' ? untilLine(title) : title;
}

/** Le nom d'un trajet d'après son titre, « Vers … », « Jusqu’à … » ou nu : « Bureau », « Bruxelles-Central ». */
function titlePlace(title: string): string {
  const t = title
    .trim()
    .replace(/^Jusqu[’']aux\s+/i, 'Vers les ')
    .replace(/^Jusqu[’']au\s+/i, 'Vers le ')
    .replace(/^Jusqu[’']à\s+/i, 'Vers ')
    .replace(/^Jusque\s+/i, 'Vers ');
  return tripName(t);
}

/** Un nom coupé (truncateWords) l'a été au mot : un mot entier, ou un morceau entier d'un nom composé, jamais au caractère. */
function cutAtWord(cut: string, name: string): boolean {
  if (!cut.endsWith('…')) return cut === name;
  const h = cut.slice(0, -1);
  return !!h && name.startsWith(h) && (/[-/’']$/.test(h) || name[h.length] === ' ');
}

/**
 * 1.3.1 (PRD-1.3.1 § 15, décision du propriétaire du 20/11 à 21:15) : le nom de l'arrêt ou de la gare où l'on marche,
 * entre `head` et `tail`, sur une rangée de `maxPx` : le nom entier s'il tient ; sinon son diminutif (shortName :
 * « Bruxelles-Central » → « Bxl-Central »), entier lui aussi ; rien (undefined) si aucun des deux ne tient. Jamais de
 * diminutif quand le nom entier tient. La seule place de cette règle dans les écrans du guidage : « 3 min à pied → … »,
 * « ensuite : 7 min à pied → … », « vers l’arrêt … », « jusqu’à … », « Où tu en es » ; et, au moment de monter, l'arrêt
 * de la descente (« descente dans 5 arrêts, à Bxl-Central », sinon la ligne sans le nom).
 */
export function wholeWalkName(head: string, name: string, tail: string, maxPx: number): string | undefined {
  const full = `${head}${name}${tail}`;
  if (textWidth(full) <= maxPx) return full;
  const short = shortName(name);
  if (short === name) return undefined;
  const brief = `${head}${short}${tail}`;
  return textWidth(brief) <= maxPx ? brief : undefined;
}

/** 1.3.1 (§ 15) : la même rangée, toujours rendue : le nom entier, sinon son diminutif, sinon la coupe au mot (fitName). */
export function fitWalkName(head: string, name: string, tail: string, maxPx: number): string {
  return wholeWalkName(head, name, tail, maxPx) ?? fitName(head, name, tail, maxPx);
}

/**
 * 1.3.1 (PRD-1.3.1 § 12, « conflit réglé » ; § 4, U3) : la marche d'une correspondance dans « monter » : « 2 min à pied →
 * Gare du Nord, très juste » si le nom tient (§ 15 : entier, sinon son diminutif, sinon coupé au mot ; la fin jamais),
 * sinon « 2 min à pied jusqu’à l’arrêt, très juste » (train : « jusqu’au quai »). `tail` : « , très juste », « , marge
 * 6 min » ou rien.
 */
export function walkToStopText(walkMin: number, stop: string, train: boolean, tail: string, maxPx: number): string {
  const head = `${minText(walkMin)} à pied → `;
  if (stop) {
    const whole = wholeWalkName(head, stop, tail, maxPx);
    if (whole !== undefined) return whole;
    const room = maxPx - textWidth(head) - textWidth(tail);
    const cut = room > 0 ? truncateWords(stop, room) : '';
    if (cut && cutAtWord(cut, stop) && textWidth(`${head}${cut}${tail}`) <= maxPx) return `${head}${cut}${tail}`;
  }
  return `${minText(walkMin)} à pied jusqu’${train ? 'au quai' : 'à l’arrêt'}${tail}`;
}

/**
 * « descente dans 4 arrêts », « descente au prochain arrêt » ; nombre inconnu (0, moteur) : « descente à Liège-Guillemins »
 * (jamais « descente dans 0 arrêts »).
 */
function alightPhrase(stopsToAlight: number, alight: Names | undefined, ctx: ViewCtx): string {
  if (stopsToAlight > 0) return alightWords(stopsToAlight);
  const name = nameOf(alight, ctx);
  return name ? `descente à ${name}` : '';
}

/** Le véhicule qui suit une marche (pour « vers l’arrêt du bus 6 », « vers la voie 3 »), d'après le trajet. */
function nextRide(j: Journey, leg: number): Leg | undefined {
  return j.legs.slice(Math.max(0, leg)).find((l) => l.kind === 'ride');
}

/**
 * « vers la voie 3 », « vers la gare de Namur », « vers le bureau » ; 1.3.1 (PRD-1.3.1 § 4, L2, U3) : « vers l’arrêt
 * Flagey », le nom de l'arrêt où l'on marche (sans nom connu : « vers l’arrêt du bus 6 »).
 */
function towardWords(ride: Leg | undefined, toward: Names | undefined, final: boolean, title: string, ctx: ViewCtx, maxPx = Number.POSITIVE_INFINITY): string {
  if (final || !ride) return toward && !final ? `vers ${nameOf(toward, ctx)}` : towardTitle(title);
  if (isTrainRef(ride)) {
    const p = ride.newPlatform || ride.platform;
    return p ? `vers la voie ${p}` : fitWalkName('vers la gare de ', nameOf(ride.from.name, ctx), '', maxPx);
  }
  const stop = nameOf(toward, ctx) || nameOf(ride.from.name, ctx);
  return stop ? fitWalkName('vers l’arrêt ', stop, '', maxPx) : `vers l’arrêt du ${vehicle(ride)}`;
}

/* ------------------------------ Moments (§ 3.2) ------------------------------ */

interface MomentView {
  lines: GLine[];
  image?: ImageKind;
  hints: string;
}

/** Panneau d'un véhicule à prendre (PRD § 3.9) : « bus » / « 6 », « voie » / « 3 », « train » / « IC ». */
export function vehicleSign(v: VehicleRef, platform?: string): ImageKind {
  if (isTrainRef(v)) return platform ? { kind: 'sign', label: 'voie', value: platform } : { kind: 'sign', label: 'train', value: v.cat || v.line || 'IC' };
  if (v.op === 'sncb' && v.mode === 'bus') return { kind: 'sign', label: 'bus', value: 'SNCB' };
  const label = v.mode === 'tram' ? 'tram' : v.mode === 'metro' ? 'métro' : 'bus';
  return { kind: 'sign', label, value: v.line || label };
}

/**
 * « 5 min à pied jusqu’à l’arrêt Monument Gramme » sur une rangée : sans « l’arrêt » (« la gare de ») si elle ne tient
 * pas, puis le nom coupé au mot en dernier recours. 1.3.0 (PRD-1.3.0 § 4, `foot` faux) : sans « à pied » (« 6 min
 * jusqu’à l’arrêt X », moment `offMap`).
 */
export function leaveWalkText(walkMin: number, toward: string, kind: 'stop' | 'station' | 'dest', title: string, maxPx: number, foot = true): string {
  const walk = foot ? `${minText(walkMin)} à pied` : minText(walkMin);
  if (kind === 'dest') return truncateWords(`${walk} ${untilTitle(title)}`, maxPx);
  const full = `${walk} jusqu’à ${kind === 'station' ? 'la gare de' : 'l’arrêt'} ${toward}`;
  if (textWidth(full) <= maxPx) return full;
  // sans « l’arrêt » (« la gare de ») : le nom entier, sinon son diminutif (§ 15), sinon coupé au mot
  return fitWalkName(`${walk} jusqu’à `, toward, '', maxPx);
}

/** « Si tu le rates : arrivée 09:34, 30 min plus tard » sur une rangée, sinon sans l'écart : « Si tu le rates : arrivée 09:34 ». */
export function missFit(miss: string, maxPx: number): string {
  if (textWidth(miss) <= maxPx) return miss;
  const cut = miss.lastIndexOf(', ');
  return truncateWords(cut > 0 ? miss.slice(0, cut) : miss, maxPx);
}

/**
 * « Partir maintenant » ; la marche (« 5 min à pied jusqu’à l’arrêt Monument Gramme ») ; le véhicule (1.3.1, B13 : « IC
 * 07:42 +2 » pour un train en retard) ; « , très juste » et « Si tu le rates » seulement quand le moteur le dit (1.3.1,
 * A4, P4 : `tight`, jamais recalculé ici depuis la marge arrondie) ; sinon, 1.3.1 (B19, I5) : « pluie prévue », pâle, si
 * la première marche se fait sous la pluie.
 */
function leaveMoment(m: Extract<Moment, { kind: 'leave' }>, j: Journey, title: string, ctx: ViewCtx): MomentView {
  const toward = nameOf(m.toward, ctx);
  const kind = !m.vehicle ? 'dest' : isTrainRef(m.vehicle) ? 'station' : 'stop';
  const tight = m.tight === true;
  const lines: GLine[] = [MAIN(GUIDE_TEXT.leave), F('norm', (w) => leaveWalkText(m.walkMin, toward, kind, title, w))];
  if (m.vehicle && m.depAt !== undefined) lines.push(L('norm', `${vehicleAtText(m.vehicle, m.depAt, m.rt ?? false, ctx, m.sched)}${tight ? `, ${GUIDE_TEXT.tight}` : ''}`));
  if (tight && m.missed) {
    const miss = missText(m.missed.arr, m.missed.laterMin, ctx.now);
    lines.push(F('pale', (w) => missFit(miss, w)));
  } else if (j.legs[0] && rainyWalk(j.legs[0])) lines.push(L('pale', GUIDE_TEXT.rain));
  return { lines, image: { kind: 'sign', label: 'à pied', value: String(m.walkMin), foot: 'min' }, hints: HINTS.guide };
}

/**
 * Le virage, au plus clair, avec sa majuscule (1.3.1, B12, L4 : « À gauche dans 30 m ») ; 1.3.1 (B18, P6) : le virage
 * suivant tout proche, annoncé avec lui (« puis à gauche ») ; pâle : la rue prise, sinon vers où l'on marche (« vers
 * l’arrêt Flagey »).
 */
function turnMoment(m: Extract<Moment, { kind: 'turn' }>, j: Journey, title: string, ctx: ViewCtx): MomentView {
  const lines: GLine[] = [MAIN(upperFirst(turnText(m.turn, m.distM)))];
  if (m.then) lines.push(L('norm', `puis ${TURN_WORDS[m.then].toLowerCase()}`));
  const street = m.street?.trim();
  // § 15 : le nom de l'arrêt où l'on marche, entier, sinon son diminutif, sinon coupé au mot
  lines.push(street ? L('pale', street) : F('pale', (w) => truncateWords(towardWords(m.final ? undefined : nextRide(j, m.leg), m.toward, m.final, title, ctx, w), w)));
  return { lines, image: { kind: 'turn', turn: m.turn }, hints: HINTS.guide };
}

/**
 * « Monter ». Bus, tram, métro : le véhicule et son attente (1.3.1, B12, L4 : « Tram 3 dans ~1 min », « Tram 3 à
 * ~07:12 », « Tram 3 imminent » : deux lignes peuvent partager le quai) ; train : « IC à 07:30, voie 3 » (B13 : « IC 07:42
 * +2, voie 3 »). Pâles : la direction ; la marche d'une correspondance (« 2 min à pied → Gare du Nord, très juste ») ou
 * la descente (1.3.1, B12, E5 : « descente dans 5 arrêts, à Bruxelles-Nord », le nom s'il tient) ; 1.3.1 (B16, U4) :
 * correspondance très juste, le suivant (« Si tu le rates : tram 3 à 08:51 »).
 */
function boardMoment(m: Extract<Moment, { kind: 'board' }>, ctx: ViewCtx): MomentView {
  const train = isTrainRef(m.vehicle);
  const when = train ? vehicleAtText(m.vehicle, m.depAt, m.rt, ctx, m.sched) : upperFirst(`${vehicle(m.vehicle)} ${boardWait(m.depAt, m.rt, ctx.now, mp(ctx))}`);
  // la voie ne concerne que les trains ; elle est aussi écrite (contrôle usager du 15/11 : le texte suffit sans
  // l'image, § 3.9) : « IC à 07:30, voie 3 », modifiée « voie 6 ! » comme à l'écran du trajet
  const plat = !train ? '' : m.platform ? `, voie ${m.platform}${m.platformChanged ? `${NB}!` : ''}` : m.platformChanged ? `, ${GUIDE_TEXT.platformBoard}` : '';
  const lines: GLine[] = [MAIN(`${when}${plat}`)];
  const head = headText(m.head, ctx.settings.lang, m.vehicle.op);
  if (head) lines.push(F('pale', (w) => fitName('vers ', head, '', w)));
  // correspondance : la marche jusqu'à l'arrêt (son nom, 1.3.1) et la marge passent avant le nombre d'arrêts (la marge
  // peut être négative : « très juste », jamais « marge -2 min ») ; sans place pour le nom : « jusqu'au quai » pour un
  // train, « jusqu'à l'arrêt » pour un bus, un tram, un métro (contrôle technique du 15/11)
  if (m.walkMin !== undefined) {
    const walkMin = m.walkMin;
    // 1.3.1 (B16, A4 ; contrôle du moteur) : très juste quand le moteur le dit (marge de 1 min ou moins, comme la ligne
    // « ensuite » de « Descends » juste avant), jamais « marge 1 min » pour la même correspondance
    const tail = m.tight === true ? `, ${GUIDE_TEXT.tight}` : m.marginMin !== undefined ? `, ${marginText(m.marginMin)}` : '';
    lines.push(F('pale', (w) => walkToStopText(walkMin, nameOf(m.stop, ctx), train, tail, w)));
  } else {
    // 1.3.1 (B12, E5 ; contrôle du sujet, remarque 2) : « descente dans 5 arrêts, à Bruxelles-Nord » : le nom entier s'il
    // tient, sinon son diminutif (§ 15 : « à Bxl-Central »), sinon la ligne sans le nom
    const d = alightPhrase(m.stopsToAlight, m.alight, ctx);
    const at = nameOf(m.alight, ctx);
    if (d) lines.push(m.stopsToAlight > 0 ? F('pale', (w) => (at ? (wholeWalkName(`${d}, à `, at, '', w) ?? d) : d)) : F('pale', (w) => fitName('descente à ', at, '', w)));
  }
  if (m.ifMissed) {
    const miss = `Si tu le rates${NB}: ${vehicleAtText(m.ifMissed.vehicle, m.ifMissed.depAt, m.ifMissed.rt, ctx)}`;
    lines.push(F('pale', (w) => truncateWords(miss, w)));
  }
  return { lines, image: vehicleSign(m.vehicle, train ? m.platform : undefined), hints: HINTS.guide };
}

function platformMoment(m: Extract<Moment, { kind: 'platform' }>, ctx: ViewCtx): MomentView {
  const was = m.was && m.was !== m.platform ? ` au lieu de ${m.was}` : '';
  // une voie modifiée vient du temps réel : l'heure sans « ~ » ; 1.3.1 (B13) : « IC 07:42 +2, voie 6 au lieu de 4 »
  return {
    lines: [MAIN(GUIDE_TEXT.platform), L('norm', `${vehicleAtText(m.vehicle, m.depAt, true, ctx, m.sched)}, voie ${m.platform}${was}`)],
    image: { kind: 'sign', label: 'voie', value: m.platform },
    hints: HINTS.guide,
  };
}

function nextStopMoment(m: Extract<Moment, { kind: 'nextStop' }>, ctx: ViewCtx): MomentView {
  // un nom trop long passe à la ligne après « Prochain arrêt : » (jamais coupé)
  // une rangée chacune ; un nom trop long coupé au mot en dernier recours
  const alight = nameOf(m.alight, ctx);
  const first = F('hi', (w) => fitName(`Prochain arrêt${NB}: `, nameOf(m.stop, ctx), '', w));
  const second = F('pale', (w) => fitName(m.stopsToAlight > 0 ? `${alightWords(m.stopsToAlight)}, à ` : 'descente à ', alight, '', w));
  return { lines: alight ? [first, second] : [first], hints: HINTS.guide };
}

/**
 * « ensuite : voie 3, IC à 07:30 », « ensuite : bus 71 à 08:34 », « ensuite : 5 min à pied ». 1.3.1 : une marche
 * jusqu'à l'arrêt où monter le nomme (PRD-1.3.1 § 4 : « ensuite : 7 min à pied → Flagey », nom coupé au mot dans
 * `maxPx`) ; correspondance très juste (B16, U4) : le véhicule et son heure (« ensuite : tram 3 à ~08:44, très juste ») ;
 * un train en retard (B13) : « ensuite : voie 3, IC 07:30 +2 ».
 */
export function thenText(t: Then, ctx: ViewCtx, maxPx = Number.POSITIVE_INFINITY): string {
  if (t.kind === 'walk') return `ensuite${NB}: ${minText(t.min)} à pied`;
  if (t.kind === 'ride') {
    const ride = `${t.platform && isTrainRef(t.vehicle) ? `voie ${t.platform}, ` : ''}${vehicleAtText(t.vehicle, t.depAt, t.rt, ctx, t.sched)}`;
    if (t.tight === true) return `ensuite${NB}: ${ride}, ${GUIDE_TEXT.tight}`;
    const from = nameOf(t.from, ctx);
    if (t.walkMin > 0 && from) return fitWalkName(`ensuite${NB}: ${minText(t.walkMin)} à pied → `, from, '', maxPx);
    return `ensuite${NB}: ${ride}`;
  }
  return '';
}

function alightMoment(m: Extract<Moment, { kind: 'alight' }>, ctx: ViewCtx): MomentView {
  const lines: GLine[] = [MAIN(GUIDE_TEXT.alight), F('norm', (w) => fitName('', nameOf(m.stop, ctx), `, ${timeOf(m.at, m.rt, ctx)}`, w))];
  if (thenText(m.then, ctx)) lines.push(F('pale', (w) => thenText(m.then, ctx, w)));
  return { lines, hints: HINTS.guide };
}

/**
 * Imprévu : ce qui est perdu, puis le nouveau trajet (1.3.1, B12, L4 : « Nouveau trajet : IC à 08:42, voie 5 » ; B13 : « IC
 * 08:42 +3 » pour un train en retard) et son arrivée. Correctif du 21/11 : l'heure du nouveau véhicule s'écrit comme
 * dans les autres messages (vehicleAtText, une seule règle) : « ~08:42 » quand elle est prévue sans temps réel
 * (`next.rt` absent ou faux), « 08:42 » quand elle vient du temps réel. 1.3.1 (A3, I1, `planned`) : véhicule raté sans temps réel, resté à
 * l'arrêt : rien ne dit qu'il est passé, pas de « est parti » : le nouveau trajet d'abord.
 */
function replanMoment(m: Extract<Moment, { kind: 'replan' }>, ride: boolean, ctx: ViewCtx): MomentView {
  const lost = `${vehicle(m.lost.vehicle)} de ${hhmm(m.lost.depAt)}`;
  const head = m.reason === 'late' ? `Correspondance ratée${NB}: ${lost}` : `Ton ${lost} est ${m.reason === 'cancelled' ? 'supprimé' : 'parti'}`;
  const quiet = m.planned === true && m.reason === 'missed' && !m.none && (!!m.next || (!ride && m.arr !== undefined));
  const lines: GLine[] = quiet ? [] : [MAIN(head)];
  const news = (text: string): GLine => (quiet ? MAIN(text) : L('norm', text));
  const arr = (): GLine => L('pale', `arrivée ${hhmm(m.arr!)}${m.laterMin ? `, ${laterText(m.laterMin)} plus tard` : ''}`);
  if (m.none) lines.push(L('norm', GUIDE_TEXT.none));
  else if (!m.next) {
    // nouveau trajet à pied seul (son arrivée connue, contrôle technique du 15/11) ; pas encore connu : la perte seule
    if (!ride && m.arr !== undefined) {
      lines.push(news(`Nouveau trajet${NB}: à pied`));
      lines.push(arr());
    }
  } else if (ride) {
    // « J'y descends » : le prochain passage du même véhicule, si le tableau de l'arrêt le donne (§ 3.6)
    lines.push(news(`Prochain${NB}: ${vehicleAtText(m.next.vehicle, m.next.depAt, m.next.rt ?? false, ctx, m.next.sched)}`));
  } else {
    lines.push(news(`Nouveau trajet${NB}: ${vehicleAtText(m.next.vehicle, m.next.depAt, m.next.rt ?? false, ctx, m.next.sched)}${m.next.platform ? `, voie ${m.next.platform}` : ''}`));
    if (m.arr !== undefined) lines.push(arr());
  }
  return { lines, hints: HINTS.guide };
}

function passedMoment(m: Extract<Moment, { kind: 'passed' }>, ride: boolean, ctx: ViewCtx): MomentView {
  // arrêt où descendre inconnu (moteur : `getOff` vide) : pas de « Descends à … »
  const getOff = nameOf(m.getOff, ctx);
  const lines: GLine[] = [F('hi', (w) => fitName('Tu as passé ', nameOf(m.passed, ctx), '', w))];
  if (getOff) lines.push(F('norm', (w) => fitName('Descends à ', getOff, `, ${hhmm(m.at)}`, w)));
  if (!ride && m.arr !== undefined) lines.push(L('pale', `nouveau trajet${NB}: arrivée ${hhmm(m.arr)}`));
  return { lines, hints: HINTS.guide };
}

function arrivedMoment(m: Extract<Moment, { kind: 'arrived' }>): MomentView {
  // le nom du trajet, que son titre soit « Bureau », « Vers … » ou « Jusqu’à … » (1.3.1 : titre de « j'y descends »)
  return { lines: [MAIN(GUIDE_TEXT.arrived), F('pale', (w) => fitName('', titlePlace(m.title), `, ${hhmm(m.at)}, ${diffText(m.diffMin)}`, w))], hints: HINTS.guideEnd };
}

/**
 * 1.3.0 (PRD-1.3.0 § 4) : marche sans chemin à pied (hors de l'extrait de Belgique), sans aucun virage : « Hors de
 * Belgique » au plus clair ; « pas de chemin à pied : suis la flèche » (sans cap : « pas de chemin à pied ») ; pâle
 * « 6 min jusqu’à l’arrêt X » (un train : « jusqu’à la gare de X » ; dernière marche : « 6 min jusqu’au bureau »). Image :
 * la flèche de la direction de la cible si le cap est connu (`bearingDeg`), sinon le panneau « à pied / 6 / min ».
 */
function offMapMoment(m: Extract<Moment, { kind: 'offMap' }>, j: Journey, title: string, ctx: ViewCtx): MomentView {
  const arrow = typeof m.bearingDeg === 'number' && Number.isFinite(m.bearingDeg);
  const ride = nextRide(j, m.leg);
  const toward = nameOf(m.toward, ctx) || (ride ? nameOf(ride.from.name, ctx) : '');
  const kind = !ride ? 'dest' : isTrainRef(ride) ? 'station' : 'stop';
  const walkMin = Math.max(1, Math.round(m.walkMin));
  // un arrêt sans nom (données incomplètes) : les minutes seules, jamais « jusqu’à l’arrêt » sans nom
  const until = kind !== 'dest' && !toward ? () => minText(walkMin) : (w: number) => leaveWalkText(walkMin, toward, kind, title, w, false);
  return {
    lines: [MAIN(GUIDE_TEXT.offMap), L('norm', arrow ? GUIDE_TEXT.offMapArrow : GUIDE_TEXT.offMapNoPath), F('pale', until)],
    image: arrow ? { kind: 'bearing', deg: m.bearingDeg! } : { kind: 'sign', label: 'à pied', value: String(walkMin), foot: 'min' },
    hints: HINTS.guide,
  };
}

/**
 * 1.3.0 (PRD-1.3.0 § 6.3) : vérification au départ et en route : une ligne par problème au plus clair (checkLines, deux
 * au plus), chacune suivie de son explication pâle s'il y en a une : « Position « Toujours » pour l’appli Even, sur le
 * téléphone » sous « Pas de position : Quai suit l’horaire », « Quai suit l’horaire en attendant » sous « Position
 * perdue depuis 3 min » (1.3.1, L3). Quatre rangées au plus, sans image (toute la largeur). Quai Web (`web`) : pas
 * d'appli Even, et la position y est souvent choisie à la main (le guidage ne la suit pas) : « Pas de position : Quai
 * suit l’horaire » seul, sans le conseil de l'appli Even, qui n'y a pas de sens (contrôle usager 1.3.0).
 */
function checkMoment(m: Extract<Moment, { kind: 'check' }>, web = false): MomentView {
  const issues = m.issues.slice(0, 2);
  const texts = checkLines(issues);
  const lines: GLine[] = [];
  issues.forEach((i, k) => {
    if (!texts[k]) return;
    lines.push(MAIN(texts[k]));
    if (i.kind === 'noPosition' && !web) lines.push(L('pale', GUIDE_TEXT.checkNoPosition));
    else if (i.kind === 'positionLost') lines.push(L('pale', GUIDE_TEXT.checkLost));
  });
  return { lines: lines.length ? lines : [MAIN(GUIDE_TEXT.check)], hints: HINTS.guide };
}

/**
 * 1.3.1 (B17, P7) : la marche après une descente, comme « Partir maintenant » : « 3 min à pied jusqu’à l’arrêt Gare
 * Centrale » au plus clair (nom coupé au mot), puis « bus 71 à 08:34 » ; un train : « 3 min à pied jusqu’à la voie 5 »
 * puis « IC à 08:42 » (« IC 08:42 +3 » en retard, B13), sans voie connue « jusqu’à la gare de … » puis « IC à 08:42 » ;
 * dernière marche : « 13 min à pied jusqu’au bureau », puis « arrivée 09:01 ». Panneau « à pied / 3 / min ».
 */
function walkMoment(m: Extract<Moment, { kind: 'walk' }>, title: string, ctx: ViewCtx): MomentView {
  const toward = nameOf(m.toward, ctx);
  const train = !!m.vehicle && isTrainRef(m.vehicle);
  const kind = m.final || !m.vehicle ? 'dest' : train ? 'station' : 'stop';
  const platform = kind === 'station' && m.platform ? m.platform : '';
  const walk = (w: number): string => (platform ? truncateWords(`${minText(m.walkMin)} à pied jusqu’à la voie ${platform}`, w) : leaveWalkText(m.walkMin, toward, kind, title, w));
  const lines: GLine[] = [F('hi', walk)];
  if (m.vehicle && m.depAt !== undefined && kind !== 'dest') lines.push(L('norm', vehicleAtText(m.vehicle, m.depAt, m.rt ?? false, ctx, m.sched)));
  else if (m.arr !== undefined) lines.push(L('norm', `arrivée ${hhmm(m.arr)}`));
  // 1.3.1 (PRD-1.3.1 § 14, R1) : la sortie du métro vers la suite du chemin, pâle (glasses/exit-line.ts)
  if (m.exit) lines.push(F('pale', (w) => exitLineText(m.exit, w)));
  return { lines, image: { kind: 'sign', label: 'à pied', value: String(m.walkMin), foot: 'min' }, hints: HINTS.guide };
}

function momentView(m: Moment, s: GuideState, j: Journey, ctx: ViewCtx): MomentView {
  const title = s.where.title;
  const ride = s.kind === 'ride';
  switch (m.kind) {
    case 'leave':
      return leaveMoment(m, j, title, ctx);
    case 'turn':
      return turnMoment(m, j, title, ctx);
    case 'board':
      return boardMoment(m, ctx);
    case 'platform':
      return platformMoment(m, ctx);
    case 'nextStop':
      return nextStopMoment(m, ctx);
    case 'alight':
      return alightMoment(m, ctx);
    case 'replan':
      return replanMoment(m, ride, ctx);
    case 'passed':
      return passedMoment(m, ride, ctx);
    case 'arrived':
      return arrivedMoment(m);
    case 'offMap':
      return offMapMoment(m, j, title, ctx);
    case 'check':
      return checkMoment(m, !!ctx.web);
    case 'walk':
      return walkMoment(m, title, ctx);
  }
}

/* ------------------------------ Mise en lignes ------------------------------ */

/** Le texte d'une ligne dans `maxPx` : sa forme qui tient, sinon coupé au mot (jamais l'action). */
function fitLine(l: GLine, maxPx: number): string {
  if (l.fit) return l.fit(maxPx);
  const ok = l.alts.find((t) => textWidth(t) <= maxPx);
  if (ok !== undefined) return ok;
  const last = l.alts[l.alts.length - 1] ?? '';
  return l.main ? last : truncateWords(last, maxPx);
}

/**
 * Rangées d'un écran du guidage : une idée par rangée (jamais de passage à la ligne), `maxLines` au plus. Les moments
 * en ont quatre au plus : 108 px, dans la hauteur de l'image (144 px).
 */
function layoutLines(lines: GLine[], maxPx: number, maxLines: number): { t: string; lv: Lv }[] {
  return lines
    .slice(0, Math.max(0, maxLines))
    .map((l) => ({ t: fitLine(l, maxPx), lv: l.lv }))
    .filter((r) => r.t);
}

/** Une rangée d'un seul texte, dans le conteneur de sa luminosité. */
function rowItem(t: string, lv: Lv): Item {
  return lv === 'hi' ? { a: t } : lv === 'norm' ? { a: '', b: t } : { a: '', c: t };
}

/**
 * Une rangée mêlant les luminosités (chaîne de « Où tu en es ») : chaque morceau dans le conteneur de la sienne, à sa
 * place au pixel (les trois conteneurs commencent au même x) ; une espace entre deux morceaux, deux entre deux
 * conteneurs (un glyphe large peut déborder de sa chasse).
 */
export function composeRow(segs: { t: string; lv: Lv; gap?: number }[]): Item {
  const out: Record<Lv, string> = { hi: '', norm: '', pale: '' };
  let x = 0;
  let prev: Lv | null = null;
  for (const s of segs) {
    if (!s.t) continue;
    const gap = prev === null ? 0 : Math.max(s.gap ?? 0, prev === s.lv ? 5 : 10);
    const target = x + gap;
    const have = textWidth(out[s.lv]);
    const n = Math.max(prev === null ? 0 : 1, Math.round((target - have) / 5));
    out[s.lv] += (out[s.lv] || prev !== null ? ' '.repeat(n) : '') + s.t;
    x = textWidth(out[s.lv]);
    prev = s.lv;
  }
  return { a: out.hi, b: out.norm, c: out.pale };
}

const width = (it: Item): number => Math.max(textWidth(it.a), textWidth(it.b ?? ''), textWidth(it.c ?? ''));

/* ------------------------------ Où tu en es (§ 3.3) ------------------------------ */

const CHAIN_GLYPH = { done: '●', now: '◎', next: '○' } as const;
const CHAIN_LV: Record<'done' | 'now' | 'next', Lv> = { done: 'norm', now: 'hi', next: 'pale' };

/**
 * Ligne 1 de « Où tu en es » : « ● à pied ─ ◎ bus 6 ─ ○ IC ─ ○ bus 71 ». Trop longue : « … » au milieu, à la place des
 * étapes les plus loin de celle en cours (la première, la dernière et celle en cours restent).
 */
export function chainRow(chain: WhereAmI['chain'], maxPx: number): Item {
  const now = Math.max(0, chain.findIndex((c) => c.state === 'now'));
  let keep = chain.map((_, i) => i);
  const build = (idx: number[]): Item => {
    const segs: { t: string; lv: Lv }[] = [];
    idx.forEach((i, k) => {
      if (k > 0) {
        segs.push({ t: '─', lv: 'pale' });
        if (i - idx[k - 1] > 1) segs.push({ t: '…', lv: 'pale' }, { t: '─', lv: 'pale' });
      }
      const c = chain[i];
      segs.push({ t: `${CHAIN_GLYPH[c.state]}${NB}${c.label}`, lv: CHAIN_LV[c.state] });
    });
    return composeRow(segs);
  };
  let row = build(keep);
  while (width(row) > maxPx) {
    const cands = keep.filter((i) => i !== 0 && i !== chain.length - 1 && i !== now);
    if (!cands.length) break;
    // l'étape la plus loin de celle en cours ; à égalité, la plus tardive
    const far = cands.reduce((a, b) => (Math.abs(b - now) >= Math.abs(a - now) ? b : a));
    keep = keep.filter((i) => i !== far);
    row = build(keep);
  }
  return row;
}

/**
 * Une rangée de « Où tu en es » : un texte (une idée) ou une rangée composée (chaîne, progression) ; `drop` : son rang
 * d'effacement quand tout ne tient pas (§ 12 : l'arrivée d'abord, puis la chaîne, puis l'arrêt suivant ; la progression
 * jamais).
 */
type WhereRow = ({ line: GLine } | { item: Item }) & { drop?: number };
const DROP = { arr: 1, chain: 2, next: 3 } as const;
/** Rangées au plus de « Où tu en es » (8 tiennent entre le titre et l'aide). */
const WHERE_MAX = 8;

/** « ●─●─◎─○─○   descente dans 4 arrêts » : la progression (1.2.5, progressLine), la phrase après trois espaces. */
function progressText(r: NonNullable<WhereAmI['ride']>): { prog: string; words: string } {
  const n = Math.max(2, r.total);
  return { prog: progressLine(n, Math.min(Math.max(0, r.next), n - 1)), words: alightWords(r.stopsToAlight) };
}

/** « 480 m, 6 min » ; hors de Belgique (1.3.0, PRD-1.3.0 § 4) : « 450 m à vol d’oiseau, 6 min » ; sans distance : « 6 min ». */
function walkLeft(walk: NonNullable<WhereAmI['walk']>): string {
  const min = minText(Math.max(1, walk.remainingMin));
  const m = walk.offMap ? (walk.crowM ?? walk.remainingM) : walk.remainingM;
  if (m === undefined || !Number.isFinite(m)) return min;
  return `${metersText(m)}${walk.offMap ? ` ${GUIDE_TEXT.crow}` : ''}, ${min}`;
}

/**
 * « Où tu en es » (1.3.1, PRD-1.3.1 § 3 et § 12, L1, E1), sous le titre « Guidage en cours » : la destination
 * (« Jusqu’au bureau ») ; « Ensuite : … », le prochain geste et son heure, au plus clair ; l'étape en cours ; la chaîne
 * du trajet ; l'arrivée. Chaque chose une seule fois, plus de marge.
 * - Avant de partir : « Ensuite : partir à 07:33 », « 9 min à pied jusqu’à la gare de Namur », « IC à 07:45, voie 3 ».
 * - En marchant : « Ensuite : bus W à 17:49 » (« IC à 07:30, voie 3 » ; dernière marche « Ensuite : arrivée ~19:05 »),
 *   « À pied vers l’arrêt Flagey » (train : « vers la voie 3 », sinon « vers la gare de Namur » ; dernière marche :
 *   « À pied, 480 m, 6 min »), « 260 m, 4 min ».
 * - À l'arrêt : « Ensuite : bus 36 à 17:04 » (jamais « dans ~1 min » : l'heure), « À l’arrêt Flagey » (« À la gare de
 *   Namur »), pâle « vers … », pâle « Si tu le rates : … » (véhicule gardé sans temps réel, A3).
 * - À bord : « Ensuite : descente à Bruxelles-Nord, 08:42 », la progression (jamais effacée), « Prochain arrêt :
 *   Ottignies, 08:11 » (sauf si c'est la descente), la chaîne, l'arrivée.
 * - « J'y descends » : pâle « Quai te dit quand descendre », pas de chaîne ; à bord, pas d'arrivée, et la descente,
 *   qui est la destination, n'est pas renommée (« Ensuite : descente à 08:31 »).
 */
function whereRows(s: GuideState, j: Journey, ctx: ViewCtx, maxPx: number): WhereRow[] {
  const w = s.where;
  const trip = s.kind === 'trip';
  const phase = s.phase.kind;
  const rows: WhereRow[] = [];
  const push = (line: GLine, drop?: number): void => {
    rows.push({ line, drop });
  };
  const then = (text: string): GLine => L('hi', `Ensuite${NB}: ${text}`);
  const arrival = `arrivée ${timeOf(w.arr, w.rt, ctx)}`;
  let arrSaid = false;
  push(F('norm', (px) => truncateWords(untilLine(w.title), px)));
  const ride = phase === 'ride' || (!w.walk && !w.wait) ? w.ride : undefined;
  const wait = !ride && (phase === 'wait' || !w.walk) ? w.wait : undefined;
  const walk = !ride && !wait ? w.walk : undefined;
  if (ride) {
    const alight = nameOf(ride.alight, ctx);
    const at = timeOf(ride.alightAt, ride.rt, ctx);
    push(F('hi', (px) => (trip && alight ? fitName(`Ensuite${NB}: descente à `, alight, `, ${at}`, px) : `Ensuite${NB}: descente à ${at}`)));
    // nombre d'arrêts inconnu (0) : pas de progression ni de « descente dans 0 arrêts » (« Ensuite » dit où)
    if (ride.stopsToAlight > 0 && ride.total >= 2) {
      const { prog, words } = progressText(ride);
      rows.push({ item: composeRow([{ t: prog, lv: 'norm' }, { t: words, lv: 'pale', gap: 15 }]) });
    }
    // le prochain arrêt est la descente : « Ensuite » et la progression le disent déjà (contrôle usager du 15/11)
    const next = nameOf(ride.nextStop, ctx);
    const lastStop = next === alight && ride.nextAt === ride.alightAt;
    if (next && !lastStop) push(F('norm', (px) => fitName(`Prochain arrêt${NB}: `, next, `, ${timeOf(ride.nextAt, ride.rt, ctx)}`, px)), DROP.next);
    // « j'y descends » : l'arrivée est la descente, déjà dite
    if (!trip) arrSaid = true;
  } else if (wait) {
    const train = isTrainRef(wait.vehicle);
    // la voie ne concerne que les trains
    const plat = train && wait.platform ? `, voie ${wait.platform}${wait.platformChanged ? `${NB}!` : ''}` : '';
    push(then(`${vehicleAtText(wait.vehicle, wait.depAt, wait.rt, ctx, wait.sched)}${plat}`));
    push(F('norm', (px) => fitName(train ? 'À la gare de ' : 'À l’arrêt ', nameOf(wait.stop, ctx), '', px)));
    const head = headText(wait.head, ctx.settings.lang, wait.vehicle.op);
    if (head) push(F('pale', (px) => fitName('vers ', head, '', px)));
    if (wait.missed) {
      const miss = missText(wait.missed.arr, wait.missed.laterMin, ctx.now);
      push(F('pale', (px) => missFit(miss, px)));
    }
  } else if (walk) {
    const before = phase === 'before';
    const dest = walk.toKind === 'dest';
    const train = !!walk.vehicle && isTrainRef(walk.vehicle);
    const r = nextRide(j, phase === 'walk' || phase === 'before' ? s.phase.leg : 0);
    const p = train && r ? r.newPlatform || r.platform : undefined;
    const plat = p ? `, voie ${p}${r?.newPlatform ? `${NB}!` : ''}` : '';
    // l'heure du véhicule visé, avec son temps réel (pas celui du trajet entier) : comme « Partir maintenant »
    const veh = !dest && walk.vehicle && walk.depAt !== undefined ? vehicleAtText(walk.vehicle, walk.depAt, walk.rt ?? w.rt, ctx, walk.sched) : '';
    const toward = nameOf(walk.toward, ctx);
    if (before) {
      // « 9 min à pied jusqu’à la gare de Namur » (dernière marche : la destination est dite au-dessus)
      // 1.3.1 (R4) : l'heure de partir avancée par le moteur quand le vrai chemin de la marche est plus long
      push(then(`partir à ${hhmm(walk.leaveAt ?? j.leaveAt)}`));
      const min = Math.max(1, walk.remainingMin);
      push(F('norm', (px) => (dest || !toward ? `${minText(min)} à pied` : leaveWalkText(min, toward, train ? 'station' : 'stop', w.title, px))));
      if (veh) push(L('norm', `${veh}${plat}`));
      if (walk.offMap) push(L('pale', GUIDE_TEXT.offMapWhere));
    } else {
      if (veh) push(then(`${veh}${walk.toKind === 'platform' ? '' : plat}`));
      else {
        push(then(arrival));
        arrSaid = true;
      }
      if (dest) push(L('norm', `À pied, ${walkLeft(walk)}`));
      else {
        // § 15 : le nom de l'arrêt ou de la gare où l'on marche, entier, sinon son diminutif, sinon coupé au mot
        const station = walk.toKind === 'station' || (walk.toKind === 'platform' && !p);
        if (walk.toKind === 'platform' && p) push(L('norm', `À pied vers la voie ${p}`));
        else if (station) push(F('norm', (px) => fitWalkName('À pied vers la gare de ', toward, '', px)));
        else if (toward) push(F('norm', (px) => fitWalkName('À pied vers l’arrêt ', toward, '', px)));
        else push(L('norm', walk.vehicle ? `À pied vers l’arrêt du ${vehicle(walk.vehicle)}` : 'À pied vers l’arrêt'));
        push(L('norm', walkLeft(walk)));
      }
      if (walk.offMap) push(L('pale', GUIDE_TEXT.offMapWhere));
    }
  }
  if (!trip) push(L('pale', GUIDE_TEXT.tellAlight));
  // la chaîne : « j'y descends » n'en a pas (un seul véhicule)
  if (trip && w.chain.length) rows.push({ item: chainRow(w.chain, maxPx), drop: DROP.chain });
  if (!arrSaid) push(L('pale', arrival), DROP.arr);
  return rows;
}

/**
 * 1.3.1 (PRD-1.3.1 § 12) : les rangées de « Où tu en es » qui tiennent dans `max` : l'arrivée s'efface d'abord, puis la
 * chaîne, puis l'arrêt suivant (`drop` : 1, 2, 3) ; les autres, dont la progression, jamais.
 */
export function fitWhere<T extends { drop?: number }>(rows: T[], max: number): T[] {
  let out = rows;
  for (const rank of [DROP.arr, DROP.chain, DROP.next]) {
    if (out.length <= max) break;
    out = out.filter((r) => r.drop !== rank);
  }
  return out.slice(0, max);
}

/**
 * 1.3.1 (PRD-1.3.1 § 1, B9, E1) : le texte du pied de l'écran calme. « · · · » : Quai te suit, rien à faire. À bord,
 * arrêts connus : la ligne de progression à leur place (« ●─●─◎─○─○   descente dans 4 arrêts » ; « descente au prochain
 * arrêt » aussi quand « Descends au prochain arrêt » a été masqué) ; elle ne change qu'au passage d'un arrêt. En
 * marchant, à l'arrêt, arrêts inconnus : les points. Rien qui change d'une minute à l'autre (aucun envoi pour eux).
 */
export function calmText(state: GuideState, journey: Journey): string {
  const ph = state.phase;
  const r = ph.kind === 'ride' ? state.where.ride : undefined;
  const leg = ph.kind === 'ride' ? journey.legs[ph.leg] : undefined;
  const known = !!leg?.stops && leg.stops.length >= 2;
  if (r && known && r.total >= 2 && r.stopsToAlight > 0) {
    const { prog, words } = progressText(r);
    return `${prog}   ${words}`;
  }
  return GUIDE_TEXT.dots;
}

/**
 * Le pied de l'écran calme, centré sur l'écran (milieu à 288 px, à une espace près) par des espaces de tête mesurées
 * (le pied commence à la marge du texte) ; coupé au mot s'il ne tenait pas.
 */
export function calmFoot(state: GuideState, journey: Journey): string {
  const maxPx = GUIDE.FULL_W;
  const t = truncateWords(calmText(state, journey), maxPx);
  const w = textWidth(t);
  let pad = ' '.repeat(Math.max(0, Math.round((SCREEN_W / 2 - GEO.X_TEXT - w / 2) / 5)));
  while (pad && textWidth(pad + t) > maxPx) pad = pad.slice(1);
  return pad + t;
}

/* ------------------------------ Vues ------------------------------ */

/**
 * Écran du guidage (PRD § 3.2 à § 3.4). `show` : ce que le contrôleur affiche (écran calme, le moment du moteur, « Où
 * tu en es ») ; un moment absent vaut l'écran calme. Toujours : toucher = guideTap, menu de l'appui long = GUIDE_MENU.
 * Écran calme (1.3.1, § 1, B9) : ni titre ni heure, le pied seul (calmFoot), au plus pâle. Moment : titre (pâle) du
 * trajet suivi (« Bureau » ; « j'y descends » : « Jusqu’à Bruxelles-Central », 1.3.1), l'heure à droite. « Où tu en es »
 * : titre « Guidage en cours » (1.3.1, § 3), l'heure à droite.
 */
export function guideView(state: GuideState, show: GuideShow, journey: Journey, ctx: ViewCtx): GlassesView {
  const v: GlassesView = { screen: 'guide', layout: 'guide', title: '', clock: '', items: [], hints: '', tap: { kind: 'guideTap' }, menu: guideMenuOf(journey) };
  const moment = show === 'moment' ? state.moment : null;
  const gestureHints = ctx.settings.display.gestureHints;
  if (show === 'empty' || (show === 'moment' && !moment)) {
    // le pied de la page calme : les points ou la progression, aides des gestes ou non (ce n'est pas une aide)
    v.hints = calmFoot(state, journey);
    v.log = guideLog(v, 'empty', null, state);
    return v;
  }
  v.clock = hhmm(ctx.now);
  if (moment) {
    v.title = guideTitleText(state.where.title, state.kind);
    const mv = momentView(moment, state, journey, ctx);
    const maxPx = mv.image ? GUIDE.TEXT_W : GUIDE.FULL_W;
    v.items = layoutLines(mv.lines, maxPx, GUIDE.MAX_LINES).map((r) => rowItem(r.t, r.lv));
    if (mv.image) v.images = [guideImage(mv.image)];
    v.hints = gestureHints ? mv.hints : '';
    v.log = guideLog(v, 'moment', moment, state);
    return v;
  }
  v.title = GUIDE_TEXT.where;
  const maxPx = GUIDE.FULL_W;
  v.items = fitWhere(whereRows(state, journey, ctx, maxPx), WHERE_MAX)
    .map((r) => {
      if ('item' in r) return r.item;
      const t = fitLine(r.line, maxPx);
      return t ? rowItem(t, r.line.lv) : null;
    })
    .filter((x): x is Item => x !== null);
  v.hints = gestureHints ? HINTS.guide : '';
  v.log = guideLog(v, 'where', null, state);
  return v;
}

/**
 * Journal QUAI_SCREEN de l'écran du guidage (scénarios de bout en bout) : ce qui est montré (`show`), le moment (sorte
 * et identifiant, ou null), chaque image (place, taille, sorte) et les choix du menu de l'appui long.
 */
function guideLog(v: GlassesView, show: GuideShow, m: Moment | null, s: GuideState): Record<string, unknown> {
  return {
    show,
    moment: m ? { kind: m.kind, id: m.id } : null,
    images: (v.images ?? []).map((i) => ({ x: i.x, y: i.y, w: i.w, h: i.h, kind: i.image.kind })),
    menu: (v.menu ?? []).map((x) => ({ id: x.id, label: x.label })),
    journey: s.journeyId,
  };
}

/** L'image du moment, à son emplacement (identifiant et nom stables : la page la remplace sans en créer d'autre). */
export function guideImage(image: ImageKind): ImageSpec {
  return { id: GUIDE.IMAGE_ID, name: GUIDE.IMAGE_NAME, x: GUIDE.IMG_X, y: GUIDE.IMG_Y, w: GUIDE.IMG_W, h: GUIDE.IMG_H, image };
}

/**
 * Menu de l'appui long rendu par Quai (Quai Web, PRD § 3.4) : un choix par rangée, toucher = le choisir (intention
 * `menu`), double toucher = retour.
 */
export function menuView(items: MenuItem[], ctx: ViewCtx): GlassesView {
  return {
    screen: 'menu',
    layout: 'menu',
    title: 'Menu',
    clock: hhmm(ctx.now),
    items: items.map((m) => ({ a: truncateWords(m.label, GUIDE.FULL_W), action: { kind: 'menu', id: m.id } })),
    hints: ctx.settings.display.gestureHints ? HINTS.menu : '',
    log: { menu: items.map((m) => m.id) },
  };
}

/**
 * 1.3.0 (PRD-1.3.0 § 6.3) : une ligne par problème de la vérification, deux au plus, pour l'écran du moment `check` et
 * la carte « En cours » du téléphone (GuideStatus.check) : « Lunettes : 12 % de batterie », « Pas de position : Quai
 * suit l’horaire » (1.3.1, L3), « Position perdue depuis 3 min ». Les lignes pâles d'explication restent propres à l'écran (checkMoment).
 */
export function checkLines(issues: readonly CheckIssue[]): string[] {
  const out: string[] = [];
  for (const i of issues) {
    if (i.kind === 'battery') out.push(`Lunettes${NB}: ${Math.min(100, Math.max(0, Math.round(i.level)))}${NB}% de batterie`);
    // 1.3.1 (L3) : « guidage à l’heure » se lisait « ponctuel »
    else if (i.kind === 'noPosition') out.push(`Pas de position${NB}: Quai suit l’horaire`);
    else out.push(`Position perdue depuis ${minText(Math.max(1, Math.round(i.minutes)))}`);
  }
  return out.slice(0, 2);
}
