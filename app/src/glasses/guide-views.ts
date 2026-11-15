/**
 * 1.2.10 « Y aller » (docs/v1.2.10/PRD-1.2.10.md § 3.2 à § 3.4, § 3.9) : écrans du guidage. Fonctions pures : état du
 * moteur (GuideState) + trajet + réglages + heure → GlassesView. Le moteur décide quoi montrer ; ces vues décident
 * comment : textes, luminosités, image, aides, menu.
 *
 * - Écran vide (par défaut) : rien du tout, ni texte, ni aide, ni image ; le toucher affiche « Où tu en es ».
 * - Un moment : une seule chose à faire, l'action au plus clair, image à gauche (panneau ou flèche), trois lignes au
 *   plus (quatre avec « Si tu le rates »), centrées sur l'image ; aides « toucher : effacer   appui long : arrêter ».
 * - « Où tu en es » : la chaîne du trajet (fait ●, en cours ◎ au plus clair, à venir ○ pâles), puis l'étape en cours.
 * Chaque texte est mesuré au pixel : un texte trop long passe à la ligne entre deux mots, ou se coupe au mot (« … »),
 * jamais l'action.
 */
import type { Journey, Leg, Names } from '../core/api';
import type { GuideState, Moment, Then, VehicleRef, WhereAmI } from '../core/guide-types';
import { displayName, hhmm } from '../core/util';
import { textWidth, truncate } from './font';
import {
  HINTS,
  NB,
  alightWords,
  boardWait,
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
  rideWords,
  towardTitle,
  tripName,
  truncateWords,
  turnText,
  untilTitle,
} from './format';
import { GUIDE } from './layout';
import { MENU_IDS, type GlassesView, type ImageKind, type ImageSpec, type Item, type MenuItem } from './types';
import { metersText, type ViewCtx } from './views';

/** Ce que l'écran du guidage montre : rien, le moment du moteur, ou « Où tu en es ». */
export type GuideShow = 'empty' | 'moment' | 'where';

/** Menu de l'appui long pendant un guidage (PRD § 3.4) : menu système des lunettes, ou écran `menu` de Quai Web. */
export const GUIDE_MENU: MenuItem[] = [
  { id: MENU_IDS.stopGuide, label: 'Arrêter le guidage' },
  { id: MENU_IDS.allSteps, label: 'Voir tout le trajet' },
];

/** Textes fixes du guidage (PRD § 3.2, § 3.3). */
export const GUIDE_TEXT = {
  leave: 'Partir maintenant',
  alight: 'Descends au prochain arrêt',
  platform: 'Voie modifiée',
  platformBoard: 'voie modifiée',
  /** « Où tu en es » à bord, quand le prochain arrêt est la descente */
  alightHere: 'c’est ta descente',
  arrived: 'Tu y es',
  none: 'Pas d’autre trajet trouvé',
  tight: 'très juste',
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

/** « vers l’arrêt du bus 6 », « vers la voie 3 », « vers la gare de Namur », « vers le bureau ». */
function towardWords(ride: Leg | undefined, toward: Names | undefined, final: boolean, title: string, ctx: ViewCtx): string {
  if (final || !ride) return toward && !final ? `vers ${nameOf(toward, ctx)}` : towardTitle(title);
  if (isTrainRef(ride)) {
    const p = ride.newPlatform || ride.platform;
    return p ? `vers la voie ${p}` : `vers la gare de ${nameOf(ride.from.name, ctx)}`;
  }
  return `vers l’arrêt du ${vehicle(ride)}`;
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
 * pas, puis le nom coupé au mot en dernier recours.
 */
export function leaveWalkText(walkMin: number, toward: string, kind: 'stop' | 'station' | 'dest', title: string, maxPx: number): string {
  const walk = `${minText(walkMin)} à pied`;
  if (kind === 'dest') return truncateWords(`${walk} ${untilTitle(title)}`, maxPx);
  const full = `${walk} jusqu’à ${kind === 'station' ? 'la gare de' : 'l’arrêt'} ${toward}`;
  if (textWidth(full) <= maxPx) return full;
  return fitName(`${walk} jusqu’à `, toward, '', maxPx);
}

/** « Si tu le rates : arrivée 09:34, 30 min plus tard » sur une rangée, sinon sans l'écart : « Si tu le rates : arrivée 09:34 ». */
export function missFit(miss: string, maxPx: number): string {
  if (textWidth(miss) <= maxPx) return miss;
  const cut = miss.lastIndexOf(', ');
  return truncateWords(cut > 0 ? miss.slice(0, cut) : miss, maxPx);
}

function leaveMoment(m: Extract<Moment, { kind: 'leave' }>, title: string, ctx: ViewCtx): MomentView {
  const toward = nameOf(m.toward, ctx);
  const kind = !m.vehicle ? 'dest' : isTrainRef(m.vehicle) ? 'station' : 'stop';
  // la marge peut être négative (moteur) : très juste aussi
  const tight = m.tight ?? (m.marginMin !== undefined && m.marginMin <= 1);
  const lines: GLine[] = [MAIN(GUIDE_TEXT.leave), F('norm', (w) => leaveWalkText(m.walkMin, toward, kind, title, w))];
  if (m.vehicle && m.depAt !== undefined) lines.push(L('norm', `${vehicle(m.vehicle)} à ${timeOf(m.depAt, m.rt ?? false, ctx)}${tight ? `, ${GUIDE_TEXT.tight}` : ''}`));
  if (tight && m.missed) {
    const miss = missText(m.missed.arr, m.missed.laterMin, ctx.now);
    lines.push(F('pale', (w) => missFit(miss, w)));
  }
  return { lines, image: { kind: 'sign', label: 'à pied', value: String(m.walkMin), foot: 'min' }, hints: HINTS.guide };
}

function turnMoment(m: Extract<Moment, { kind: 'turn' }>, j: Journey, title: string, ctx: ViewCtx): MomentView {
  const lines: GLine[] = [MAIN(turnText(m.turn, m.distM))];
  const street = m.street?.trim();
  lines.push(L('pale', street || towardWords(m.final ? undefined : nextRide(j, m.leg), m.toward, m.final, title, ctx)));
  return { lines, image: { kind: 'turn', turn: m.turn }, hints: HINTS.guide };
}

function boardMoment(m: Extract<Moment, { kind: 'board' }>, ctx: ViewCtx): MomentView {
  const train = isTrainRef(m.vehicle);
  const when = train ? `${vehicle(m.vehicle)} à ${timeOf(m.depAt, m.rt, ctx)}` : boardWait(m.depAt, m.rt, ctx.now, mp(ctx));
  // la voie ne concerne que les trains ; elle est aussi écrite (contrôle usager du 15/11 : le texte suffit sans
  // l'image, § 3.9) : « IC à 07:30, voie 3 », modifiée « voie 6 ! » comme à l'écran du trajet
  const plat = !train ? '' : m.platform ? `, voie ${m.platform}${m.platformChanged ? `${NB}!` : ''}` : m.platformChanged ? `, ${GUIDE_TEXT.platformBoard}` : '';
  const lines: GLine[] = [MAIN(`${when}${plat}`)];
  const head = headText(m.head, ctx.settings.lang, m.vehicle.op);
  if (head) lines.push(F('pale', (w) => fitName('vers ', head, '', w)));
  // correspondance en gare : la marche jusqu'au quai et la marge passent avant le nombre d'arrêts (trois lignes au plus)
  // (la marge peut être négative : « très juste », jamais « marge -2 min »)
  if (m.walkMin !== undefined) lines.push(L('pale', `${minText(m.walkMin)} à pied jusqu’au quai${m.marginMin !== undefined ? `, ${marginText(m.marginMin)}` : ''}`));
  else {
    const d = alightPhrase(m.stopsToAlight, m.alight, ctx);
    if (d) lines.push(m.stopsToAlight > 0 ? L('pale', d) : F('pale', (w) => fitName('descente à ', nameOf(m.alight, ctx), '', w)));
  }
  return { lines, image: vehicleSign(m.vehicle, train ? m.platform : undefined), hints: HINTS.guide };
}

function platformMoment(m: Extract<Moment, { kind: 'platform' }>, ctx: ViewCtx): MomentView {
  const was = m.was && m.was !== m.platform ? ` au lieu de ${m.was}` : '';
  return {
    lines: [MAIN(GUIDE_TEXT.platform), L('norm', `${vehicle(m.vehicle)} à ${hhmm(m.depAt)}, voie ${m.platform}${was}`)],
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

/** « ensuite : voie 3, IC à 07:30 », « ensuite : bus 71 à 08:34 », « ensuite : 5 min à pied ». */
export function thenText(t: Then, ctx: ViewCtx): string {
  if (t.kind === 'walk') return `ensuite${NB}: ${minText(t.min)} à pied`;
  if (t.kind === 'ride') return `ensuite${NB}: ${t.platform && isTrainRef(t.vehicle) ? `voie ${t.platform}, ` : ''}${vehicle(t.vehicle)} à ${timeOf(t.depAt, t.rt, ctx)}`;
  return '';
}

function alightMoment(m: Extract<Moment, { kind: 'alight' }>, ctx: ViewCtx): MomentView {
  const lines: GLine[] = [MAIN(GUIDE_TEXT.alight), F('norm', (w) => fitName('', nameOf(m.stop, ctx), `, ${timeOf(m.at, m.rt, ctx)}`, w))];
  const then = thenText(m.then, ctx);
  if (then) lines.push(L('pale', then));
  return { lines, hints: HINTS.guide };
}

function replanMoment(m: Extract<Moment, { kind: 'replan' }>, ride: boolean, ctx: ViewCtx): MomentView {
  const lost = `${vehicle(m.lost.vehicle)} de ${hhmm(m.lost.depAt)}`;
  const head = m.reason === 'late' ? `Correspondance ratée${NB}: ${lost}` : `Ton ${lost} est ${m.reason === 'cancelled' ? 'supprimé' : 'parti'}`;
  const lines: GLine[] = [MAIN(head)];
  if (m.none) lines.push(L('norm', GUIDE_TEXT.none));
  else if (!m.next) {
    // nouveau trajet à pied seul (son arrivée connue, contrôle technique du 15/11) ; pas encore connu : la perte seule
    if (!ride && m.arr !== undefined) {
      lines.push(L('norm', `Nouveau trajet${NB}: à pied`));
      lines.push(L('pale', `arrivée ${hhmm(m.arr)}${m.laterMin ? `, ${laterText(m.laterMin)} plus tard` : ''}`));
    }
  } else if (ride) {
    // « J'y descends » : le prochain passage du même véhicule, si le tableau de l'arrêt le donne (§ 3.6)
    lines.push(L('norm', `Prochain${NB}: ${vehicle(m.next.vehicle)} à ${hhmm(m.next.depAt)}`));
  } else {
    lines.push(L('norm', `Nouveau trajet${NB}: ${vehicle(m.next.vehicle)} ${hhmm(m.next.depAt)}${m.next.platform ? `, voie ${m.next.platform}` : ''}`));
    if (m.arr !== undefined) lines.push(L('pale', `arrivée ${hhmm(m.arr)}${m.laterMin ? `, ${laterText(m.laterMin)} plus tard` : ''}`));
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
  return { lines: [MAIN(GUIDE_TEXT.arrived), F('pale', (w) => fitName('', tripName(m.title), `, ${hhmm(m.at)}, ${diffText(m.diffMin)}`, w))], hints: HINTS.guideEnd };
}

function momentView(m: Moment, s: GuideState, j: Journey, ctx: ViewCtx): MomentView {
  const title = s.where.title;
  const ride = s.kind === 'ride';
  switch (m.kind) {
    case 'leave':
      return leaveMoment(m, title, ctx);
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

function whereLines(w: WhereAmI, s: GuideState, j: Journey, ctx: ViewCtx, maxPx: number): { head?: Item; lines: GLine[] } {
  const arr = L('pale', `arrivée ${timeOf(w.arr, w.rt, ctx)}`);
  const trip = s.kind === 'trip';
  const phase = s.phase.kind;
  const ride = phase === 'ride' || (!w.walk && !w.wait) ? w.ride : undefined;
  if (ride) {
    // « ●─◎─○─○   descente dans 3 arrêts » : la progression (1.2.5, progressLine) normale, la phrase pâle
    // nombre d'arrêts inconnu (0) : pas de progression ni de « descente dans 0 arrêts » (la ligne « descente : … » dit où)
    const prog = progressLine(Math.max(2, ride.total), Math.min(Math.max(0, ride.next), Math.max(2, ride.total) - 1));
    const head = ride.stopsToAlight > 0 && ride.total >= 2 ? composeRow([{ t: prog, lv: 'norm' }, { t: alightWords(ride.stopsToAlight), lv: 'pale', gap: 15 }]) : undefined;
    const out: GLine[] = [];
    out.push(L('hi', fitName(`Prochain arrêt${NB}: `, nameOf(ride.nextStop, ctx), `, ${timeOf(ride.nextAt, ride.rt, ctx)}`, maxPx)));
    // le prochain arrêt est la descente : pas deux fois le même nom (contrôle usager du 15/11)
    const lastStop = nameOf(ride.nextStop, ctx) === nameOf(ride.alight, ctx) && ride.nextAt === ride.alightAt;
    out.push(L('pale', lastStop ? GUIDE_TEXT.alightHere : fitName(`descente${NB}: `, nameOf(ride.alight, ctx), `, ${timeOf(ride.alightAt, ride.rt, ctx)}`, maxPx)));
    if (trip) out.push(arr);
    return { head, lines: out };
  }
  const wait = phase === 'wait' || !w.walk ? w.wait : undefined;
  if (wait) {
    const train = isTrainRef(wait.vehicle);
    const out: GLine[] = [L('hi', fitName(train ? 'À la gare de ' : 'À l’arrêt ', nameOf(wait.stop, ctx), '', maxPx))];
    const when = train ? `${vehicle(wait.vehicle)} à ${timeOf(wait.depAt, wait.rt, ctx)}` : `${vehicle(wait.vehicle)} ${boardWait(wait.depAt, wait.rt, ctx.now, mp(ctx))}`;
    const head = headText(wait.head, ctx.settings.lang, wait.vehicle.op);
    out.push(L('norm', head ? fitName(`${when}, vers `, head, '', maxPx) : when));
    // la voie ne concerne que les trains
    if (train && wait.platform) out.push(L('norm', `voie ${wait.platform}${wait.platformChanged ? `${NB}!` : ''}`));
    out.push(arr);
    return { lines: out };
  }
  const walk = w.walk;
  if (walk) {
    const out: GLine[] = [];
    let to: string;
    if (walk.toKind === 'dest') to = towardTitle(w.title);
    else if (walk.toKind === 'platform') {
      const r = nextRide(j, s.phase.kind === 'walk' || s.phase.kind === 'before' ? s.phase.leg : 0);
      const p = r && (r.newPlatform || r.platform);
      to = p ? `vers la voie ${p}` : `vers la gare de ${nameOf(walk.toward, ctx)}`;
    } else if (walk.toKind === 'station') to = `vers la gare de ${nameOf(walk.toward, ctx)}`;
    else to = walk.vehicle ? `vers l’arrêt du ${vehicle(walk.vehicle)}` : `vers l’arrêt ${nameOf(walk.toward, ctx)}`;
    out.push(L('hi', truncateWords(`À pied ${to}`, maxPx)));
    out.push(L('norm', walk.remainingM !== undefined ? `${metersText(walk.remainingM)}, ${minText(Math.max(1, walk.remainingMin))}` : minText(Math.max(1, walk.remainingMin))));
    if (walk.vehicle && walk.depAt !== undefined) {
      out.push(L('norm', `${vehicle(walk.vehicle)} à ${timeOf(walk.depAt, w.rt, ctx)}${walk.marginMin !== undefined ? `, ${marginText(walk.marginMin)}` : ''}`));
    }
    out.push(arr);
    return { lines: out };
  }
  return { lines: [arr] };
}

/* ------------------------------ Vues ------------------------------ */

/**
 * Écran du guidage (PRD § 3.2 à § 3.4). `show` : ce que le contrôleur affiche (écran vide, le moment du moteur, « Où tu
 * en es ») ; un moment absent vaut l'écran vide. Toujours : toucher = guideTap, menu de l'appui long = GUIDE_MENU.
 * Titre (pâle) : le titre du trajet suivi (`where.title`, « Bureau », « Vers Bruxelles-Central »), l'heure à droite.
 */
export function guideView(state: GuideState, show: GuideShow, journey: Journey, ctx: ViewCtx): GlassesView {
  const v: GlassesView = { screen: 'guide', layout: 'guide', title: '', clock: '', items: [], hints: '', tap: { kind: 'guideTap' }, menu: GUIDE_MENU.map((m) => ({ ...m })) };
  const moment = show === 'moment' ? state.moment : null;
  const gestureHints = ctx.settings.display.gestureHints;
  if (show === 'empty' || (show === 'moment' && !moment)) {
    v.log = guideLog(v, 'empty', null, state);
    return v;
  }
  v.title = state.where.title;
  v.clock = hhmm(ctx.now);
  if (moment) {
    const mv = momentView(moment, state, journey, ctx);
    const maxPx = mv.image ? GUIDE.TEXT_W : GUIDE.FULL_W;
    v.items = layoutLines(mv.lines, maxPx, GUIDE.MAX_LINES).map((r) => rowItem(r.t, r.lv));
    if (mv.image) v.images = [guideImage(mv.image)];
    v.hints = gestureHints ? mv.hints : '';
    v.log = guideLog(v, 'moment', moment, state);
    return v;
  }
  const maxPx = GUIDE.FULL_W;
  const rows: Item[] = [];
  if (state.where.chain.length) rows.push(chainRow(state.where.chain, maxPx));
  const { head, lines } = whereLines(state.where, state, journey, ctx, maxPx);
  if (head) rows.push(head);
  for (const r of layoutLines(lines, maxPx, 8 - rows.length)) rows.push(rowItem(r.t, r.lv));
  v.items = rows;
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
