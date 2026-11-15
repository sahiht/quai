/**
 * PROVISOIRE (équipe C2, contrôleur) : remplaçant minimal du moteur du guidage de l'équipe A (PRD-1.2.10 § 10), pour
 * que le contrôleur compile et que la suite tourne avant la livraison du vrai moteur. À ÉCARTER à l'intégration au
 * profit de core/guide.ts de l'équipe A (mêmes signatures : newGuideMemory, guideStep, dismissMoment, rideJourney,
 * guideNowText). Ici, aucun moment n'est calculé (sauf « Tu y es ») et la position n'est jamais demandée ; les tests
 * du contrôleur remplacent ce module par un double (vi.mock).
 */
import type { Departure, DepartureStops, Journey, LatLon, Leg, NameLang, Settings } from './api';
import type { GuideFix, GuideKind, GuideMemory, GuidePhase, GuideState, WalkRoute } from './guide-types';
import { displayName } from './util';

/** Ce que le contrôleur donne au moteur à chaque calcul (contrat de l'équipe A). */
export interface GuideInput {
  kind: GuideKind;
  journey: Journey;
  title: string;
  now: number;
  /** positions des 5 dernières minutes, de la plus ancienne à la plus récente */
  fixes: GuideFix[];
  /** chemin à pied calculé pour l'étape `leg` */
  walk?: { leg: number; route: WalkRoute };
  settings: Settings;
  startedAt: number;
  origin?: LatLon;
  /** « Si tu le rates » : arrivée du premier trajet de repli et minutes de plus */
  missed?: { arr: number; laterMin: number };
}

const ARRIVED_MS = 2 * 60_000;

export function newGuideMemory(): GuideMemory {
  return { v: 1, dismissed: [], shown: {} };
}

/** Phase d'après l'heure seule. */
function phaseAt(j: Journey, now: number): GuidePhase {
  if (now >= j.arr) return { kind: 'arrived' };
  const i = j.legs.findIndex((l) => now < l.arr);
  if (i < 0) return { kind: 'arrived' };
  const l = j.legs[i];
  if (now < l.dep) return i === 0 ? { kind: 'before', leg: 0 } : { kind: l.kind === 'ride' ? 'wait' : 'walk', leg: i };
  if (l.kind === 'walk') return { kind: 'walk', leg: i };
  const next = Math.max(0, (l.stops ?? []).findIndex((s) => s.est > now));
  return { kind: 'ride', leg: i, next };
}

export function guideStep(input: GuideInput, mem: GuideMemory): { state: GuideState; mem: GuideMemory } {
  const j = input.journey;
  const now = input.now;
  const phase = phaseAt(j, now);
  const id = `arrived:${j.id}`;
  const ended = now >= j.arr + ARRIVED_MS;
  const moment =
    phase.kind === 'arrived' && !ended && !mem.dismissed.includes(id)
      ? { kind: 'arrived' as const, id, since: j.arr, until: j.arr + ARRIVED_MS, leg: Math.max(0, j.legs.length - 1), title: input.title, at: j.arr, diffMin: 0 }
      : null;
  const shown = moment && mem.shown[id] === undefined ? { ...mem.shown, [id]: now } : mem.shown;
  const state: GuideState = {
    kind: input.kind,
    journeyId: j.id,
    phase: ended ? { kind: 'ended' } : phase,
    moment,
    where: { title: input.title, arr: j.arr, rt: j.rt, chain: [] },
    location: 'off',
    wakeAt: Math.min(now + 60_000, moment ? moment.until : Infinity),
    ended,
  };
  return { state, mem: shown === mem.shown ? mem : { ...mem, shown } };
}

export function dismissMoment(mem: GuideMemory, id: string, _now: number): GuideMemory {
  return mem.dismissed.includes(id) ? mem : { ...mem, dismissed: [...mem.dismissed, id] };
}

/** « J'y descends » : le véhicule seul, de l'arrêt `board` à l'arrêt `alight` de ses arrêts. */
export function rideJourney(dep: Departure, stops: DepartureStops, board: number, alight: number): Journey {
  const a = stops.stops[board];
  const b = stops.stops[alight];
  const calls = stops.stops.slice(board, alight + 1);
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
    cancelled: dep.cancelled,
    stops: calls.map((c) => ({ name: c.name, sched: c.sched, est: c.est, ...(c.areaId ? { areaId: c.areaId } : {}) })),
  };
  if (dep.tripId) leg.tripId = dep.tripId;
  return { id: `ride-${dep.tripId ?? dep.line}-${a.sched}-${alight}`, legs: [leg], dep: leg.dep, arr: leg.arr, leaveAt: leg.dep, transfers: 0, rt: dep.rt, alerts: [] };
}

/** Ligne « Maintenant » de la carte « En cours » du téléphone (provisoire : le véhicule ou la marche en cours). */
export function guideNowText(state: GuideState, journey: Journey, lang: NameLang): string {
  const p = state.phase;
  if (p.kind === 'arrived' || p.kind === 'ended') return 'arrivée';
  const leg = journey.legs[p.leg];
  if (!leg) return '';
  if (leg.kind === 'walk') return `à pied vers ${displayName(leg.to.name, lang)}`;
  const v = `${leg.mode === 'train' ? leg.cat ?? leg.line ?? 'train' : `${leg.mode ?? 'bus'} ${leg.line ?? ''}`.trim()}`;
  return leg.head ? `${v} vers ${displayName(leg.head, lang)}` : v;
}
