/**
 * 1.2.10, tests du contrôleur : doubles du moteur du guidage (core/guide.ts, équipe A) et des écrans du guidage
 * (glasses/guide-views.ts, équipe C1), branchés par vi.mock dans chaque fichier de test. Les tests décrivent ce que le
 * moteur rend (`engine.script`) et vérifient ce que le contrôleur en fait ; ils ne dépendent ni du vrai moteur ni des
 * vrais écrans (signatures du contrat seulement). Aucun import de ces deux modules ici (types seulement).
 */
import type { Departure, DepartureStops, Journey, LatLon, Leg, NameLang } from '../../src/core/api';
import type { GuideMemory, GuideState, GuideStatus, Moment } from '../../src/core/guide-types';
import { hhmm } from '../../src/core/util';
import type { GlassesView, ImageSpec, MenuItem } from '../../src/glasses/types';
import type { ViewCtx } from '../../src/glasses/views';

/** Ce que le contrôleur donne au moteur (signature de guideStep). */
export type GuideInputLike = Parameters<typeof import('../../src/core/guide').guideStep>[0];

/** Ce que le moteur double rend : l'état (complété par défaut) et, au besoin, la mémoire. */
export type Script = (input: GuideInputLike, mem: GuideMemory) => Partial<GuideState> & { mem?: GuideMemory };

export const engine = {
  /** Appels de guideStep, dans l'ordre. */
  calls: [] as { input: GuideInputLike; mem: GuideMemory }[],
  /** Moments effacés par dismissMoment. */
  dismissed: [] as string[],
  /** Trajets « j'y descends » construits par rideJourney (positions des arrêts comprises). */
  rides: [] as { dep: Departure; board: number; alight: number; coords?: ReadonlyArray<LatLon | null | undefined> }[],
  /** Nouveaux trajets adoptés (replanJourney) et recherches sans résultat (replanNone). */
  swaps: [] as { old: string; fresh: string; now: number }[],
  nones: [] as number[],
  script: null as Script | null,
  /** Lève une erreur au prochain calcul (moteur en panne). */
  throwNext: false,
  reset(): void {
    this.calls = [];
    this.dismissed = [];
    this.rides = [];
    this.swaps = [];
    this.nones = [];
    this.script = null;
    this.throwNext = false;
  },
  last(): { input: GuideInputLike; mem: GuideMemory } {
    return this.calls[this.calls.length - 1];
  },
};

/** État par défaut : avant le départ, écran vide, sans position, recalcul dans 60 s. */
export function baseState(input: GuideInputLike): GuideState {
  return {
    kind: input.kind,
    journeyId: input.journey.id,
    phase: { kind: 'before', leg: 0 },
    moment: null,
    where: { title: input.title, arr: input.journey.arr, rt: input.journey.rt, chain: [] },
    location: 'off',
    wakeAt: input.now + 60_000,
    ended: false,
  };
}

/** Un moment construit (champs propres au genre dans `extra`), du début `since` à la fin `until`. */
export function moment(kind: Moment['kind'], id: string, since: number, until: number, extra: Record<string, unknown> = {}): Moment {
  return { kind, id, since, until, leg: 0, ...extra } as Moment;
}

/** Double de core/guide.ts : mêmes noms et signatures que le contrat de l'équipe A. */
export const guideModule = {
  newGuideMemory(): GuideMemory {
    return { v: 1, dismissed: [], shown: {} };
  },
  guideStep(input: GuideInputLike, mem: GuideMemory): { state: GuideState; mem: GuideMemory } {
    engine.calls.push({ input, mem });
    if (engine.throwNext) {
      engine.throwNext = false;
      throw new Error('moteur en panne');
    }
    const out = engine.script?.(input, mem) ?? {};
    const { mem: given, ...partial } = out;
    let state: GuideState = { ...baseState(input), ...partial };
    // comme le vrai moteur : un moment effacé ne revient pas ; un moment montré est noté une fois
    if (state.moment && mem.dismissed.includes(state.moment.id)) state = { ...state, moment: null };
    const id = state.moment?.id;
    const shown = id && mem.shown[id] === undefined ? { ...mem.shown, [id]: input.now } : mem.shown;
    return { state, mem: given ?? (shown === mem.shown ? mem : { ...mem, shown }) };
  },
  dismissMoment(mem: GuideMemory, id: string, _now: number): GuideMemory {
    engine.dismissed.push(id);
    return { ...mem, dismissed: [...mem.dismissed, id] };
  },
  rideJourney(dep: Departure, stops: DepartureStops, board: number, alight: number, coords?: ReadonlyArray<LatLon | null | undefined>): Journey {
    engine.rides.push({ dep, board, alight, ...(coords ? { coords } : {}) });
    const a = stops.stops[board];
    const b = stops.stops[alight];
    const leg: Leg = {
      kind: 'ride',
      from: { name: a.name, lat: 0, lon: 0, ...(a.areaId ? { areaId: a.areaId } : {}) },
      to: { name: b.name, lat: 0, lon: 0, ...(b.areaId ? { areaId: b.areaId } : {}) },
      dep: a.est,
      arr: b.est,
      schedDep: a.sched,
      schedArr: b.sched,
      op: dep.op,
      mode: dep.mode,
      line: dep.line,
      head: dep.head,
      rt: dep.rt,
      delayMin: dep.delayMin,
      cancelled: false,
      ...(dep.tripId ? { tripId: dep.tripId } : {}),
    };
    return { id: `ride:${dep.line}:${a.sched}:${alight}`, legs: [leg], dep: leg.dep, arr: leg.arr, leaveAt: leg.dep, transfers: 0, rt: dep.rt, alerts: [] };
  },
  guideNowText(state: GuideState, journey: Journey, _lang: NameLang): string {
    return `${state.phase.kind} ${journey.id}`;
  },
  guideStatusOf(state: GuideState, journey: Journey, title: string, guided: boolean, lang: NameLang): GuideStatus {
    return { kind: state.kind, title, arr: journey.arr, now: guideModule.guideNowText(state, journey, lang), guided };
  },
  /** Le moteur double note la recherche sans résultat dans sa mémoire (`noneAt`), comme le vrai la garde. */
  replanNone(mem: GuideMemory, now: number): GuideMemory {
    engine.nones.push(now);
    return { ...mem, noneAt: now } as GuideMemory;
  },
  replanJourney(old: Journey, fresh: Journey, now: number): Journey {
    engine.swaps.push({ old: old.id, fresh: fresh.id, now });
    return fresh;
  },
};

/** Image d'un moment dans le double des écrans : panneau à la montée, flèche au virage. */
export const IMG_BASE = { id: 9, name: 'guide-img', x: 24, y: 64, w: 144, h: 144 };
function imagesOf(m: Moment | null): ImageSpec[] | undefined {
  if (m?.kind === 'board') return [{ ...IMG_BASE, image: { kind: 'sign', label: 'bus', value: '6' } }];
  if (m?.kind === 'turn') return [{ ...IMG_BASE, image: { kind: 'turn', turn: m.turn } }];
  return undefined;
}

export const views = {
  /** Appels de guideView : ce qui est montré, et le trajet guidé du contexte (ViewCtx.guidedJourneyId). */
  calls: [] as { show: string; moment: string | null; journeyId: string; guided?: string }[],
  reset(): void {
    this.calls = [];
  },
};

/** Double de glasses/guide-views.ts : ni toucher, ni menu (le contrôleur les ajoute), images des moments. */
export const viewsModule = {
  GUIDE_MENU: [
    { id: 1, label: 'Arrêter le guidage' },
    { id: 2, label: 'Voir tout le trajet' },
  ] as MenuItem[],
  guideView(state: GuideState, show: 'empty' | 'moment' | 'where', journey: Journey, ctx: ViewCtx): GlassesView {
    const m = state.moment;
    views.calls.push({ show, moment: m?.id ?? null, journeyId: journey.id, guided: (ctx as ViewCtx & { guidedJourneyId?: string }).guidedJourneyId });
    const lines = show === 'moment' && m ? [`${m.kind} ${m.id}`, ...(m.kind === 'turn' ? [`dans ${m.distM} m`] : [])] : show === 'where' ? ['Où tu en es'] : [];
    const images = show === 'moment' ? imagesOf(m) : undefined;
    return {
      screen: 'guide',
      layout: 'guide',
      title: state.where.title,
      clock: hhmm(ctx.now),
      items: lines.map((a) => ({ a })),
      hints: show === 'empty' ? '' : 'toucher : effacer   appui long : arrêter',
      scroll: true,
      log: { show, moment: m?.id ?? null },
      ...(images ? { images } : {}),
    };
  },
  menuView(items: MenuItem[], ctx: ViewCtx): GlassesView {
    return { screen: 'menu', layout: 'menu', title: 'Guidage', clock: hhmm(ctx.now), items: items.map((i) => ({ a: i.label })), hints: '△▽ choisir   toucher : choisir   double : retour' };
  },
};
