/**
 * Règles de fusion du temps réel (fonctions pures).
 *
 * GTFS-RT (SNCB, De Lijn, TEC) :
 *  - un voyage présent dans le flux est « temps réel » ;
 *  - la mise à jour de l'arrêt est trouvée par stop_sequence (ou par stop_id si la séquence est nulle) ;
 *  - sinon le retard de la mise à jour précédente la plus proche se propage ; aucune → à l'heure ;
 *  - une heure absolue l'emporte sur un retard ;
 *  - arrêt sauté ou voyage supprimé → supprimé ;
 *  - SNCB : identifiant de quai temps réel « uic_N » différent du statique → voie modifiée.
 *  - Le flux est indexé par trip_id SANS date, alors qu'un même trip_id circule chaque jour : une mise à jour ne
 *    vaut que pour l'occurrence proche de maintenant (rtOccurrence) et un horaire estimé à plus de 6 h de
 *    l'horaire prévu signale une autre occurrence (autre jour) : on garde alors l'horaire prévu.
 *
 * STIB : voir matchStibPattern / sameHead (destinations comparées après normalizeForSearch(prettyName())).
 */
import { normalizeId } from '../../../shared/types';
import { normalizeForSearch, prettyName } from '../../../shared/names';
import type { RtTrip, RtUpdate } from './realtime';

export interface StopRef {
  seq?: number;
  stopId?: string;
  sched: number; // epoch ms
  platform?: string;
}

export interface TripContext {
  /** Séquence d'un arrêt du voyage (quand le flux donne une séquence nulle). */
  seqOfStop?: (stopId: string) => number | undefined;
  /** Horaire prévu (ms) d'un arrêt du voyage, pour transformer une heure absolue en retard. */
  schedOfSeq?: (seq: number) => number | undefined;
}

export interface RtAtStop {
  rt: boolean;
  est: number;
  cancelled: boolean;
  delaySec: number;
  newPlatform?: string;
}

/** Quai d'un identifiant d'arrêt SNCB « 8863008_4 » → « 4 ». */
export function platformOfStopId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const m = /_([^_]+)$/.exec(normalizeId(id));
  return m ? m[1] : undefined;
}

const baseStop = (id: string) => normalizeId(id).replace(/_[^_]+$/, '');

export function sameStop(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const na = normalizeId(a);
  const nb = normalizeId(b);
  return na === nb || baseStop(na) === baseStop(nb);
}

const PLANNED = (sched: number): RtAtStop => ({ rt: false, est: sched, cancelled: false, delaySec: 0 });

/** Écart maximal plausible entre horaire estimé et prévu : au-delà, la mise à jour concerne un autre jour. */
export const RT_MAX_SHIFT_MS = 6 * 3_600_000;
/** Une mise à jour (sans date) ne s'applique qu'aux occurrences prévues à moins de 6 h de maintenant. */
export const RT_OCCURRENCE_MS = 6 * 3_600_000;

/** Vrai si l'occurrence prévue à `sched` peut recevoir le temps réel du flux (indexé par trip_id seul). */
export function rtOccurrence(sched: number, now: number): boolean {
  return Math.abs(sched - now) <= RT_OCCURRENCE_MS;
}

/** Temps réel d'un voyage à un arrêt donné. `trip` absent (undefined/null) = voyage hors flux. */
export function rtAtStop(trip: RtTrip | null | undefined, ref: StopRef, ctx: TripContext = {}): RtAtStop {
  if (!trip) return PLANNED(ref.sched);
  if (trip.cancelled) return { rt: true, est: ref.sched, cancelled: true, delaySec: 0 };

  const seqOf = (u: RtUpdate): number | undefined => {
    if (u[0] !== null) return u[0];
    return ctx.seqOfStop ? ctx.seqOfStop(u[1]) : undefined;
  };

  // 1. Mise à jour de cet arrêt.
  let match: RtUpdate | undefined;
  if (ref.seq !== undefined) match = trip.u.find((u) => u[0] !== null && u[0] === ref.seq);
  if (!match) match = trip.u.find((u) => (u[0] === null || ref.seq === undefined) && sameStop(u[1], ref.stopId));
  if (!match && ref.seq !== undefined && ctx.seqOfStop) match = trip.u.find((u) => u[0] === null && seqOf(u) === ref.seq);

  let newPlatform: string | undefined;
  /** Résultat final : voie modifiée éventuelle ; horaire invraisemblable (autre jour) → horaire prévu. */
  const finish = (r: RtAtStop): RtAtStop => {
    if (Math.abs(r.est - ref.sched) > RT_MAX_SHIFT_MS) return PLANNED(ref.sched);
    if (newPlatform) r.newPlatform = newPlatform;
    return r;
  };
  if (match) {
    const rtPlat = platformOfStopId(match[1]);
    const stPlat = ref.platform || platformOfStopId(ref.stopId);
    if (rtPlat && stPlat && rtPlat !== stPlat) newPlatform = rtPlat;
    if (match[4] === 1) return finish({ rt: true, est: ref.sched, cancelled: true, delaySec: 0 });
    if (match[3] !== null) {
      const est = match[3] * 1000;
      return finish({ rt: true, est, cancelled: false, delaySec: Math.round((est - ref.sched) / 1000) });
    }
    if (match[2] !== null) {
      return finish({ rt: true, est: ref.sched + match[2] * 1000, cancelled: false, delaySec: match[2] });
    }
    // ni retard ni heure : on cherche une mise à jour antérieure
  }

  // 2. Propagation depuis la mise à jour précédente la plus proche (ayant un horaire).
  let best: { seq: number; delay: number } | undefined;
  if (ref.seq !== undefined) {
    for (const u of trip.u) {
      const s = seqOf(u);
      if (s === undefined || s >= ref.seq || u[4] === 1) continue;
      let delay: number | undefined;
      if (u[2] !== null) delay = u[2];
      else if (u[3] !== null && ctx.schedOfSeq) {
        const sch = ctx.schedOfSeq(s);
        if (sch !== undefined) delay = Math.round((u[3] * 1000 - sch) / 1000);
      }
      if (delay === undefined) continue;
      if (!best || s > best.seq) best = { seq: s, delay };
    }
  }
  if (best) return finish({ rt: true, est: ref.sched + best.delay * 1000, cancelled: false, delaySec: best.delay });
  return finish({ rt: true, est: ref.sched, cancelled: false, delaySec: 0 });
}

/**
 * 1.2.3 (revue) : temps réel d'un arrêt dont l'heure montrée (`shown`, l'arrivée) n'est pas celle que donne le flux.
 * Le relais donne l'heure et le retard du départ quand il existe, sinon de l'arrivée (relay/lib/gtfsrt.ts) : `ref.sched`
 * est donc le départ prévu (l'arrivée au terminus), et l'écart trouvé pour lui s'applique à l'heure montrée. Sans cela,
 * l'arrêt en gare (arrivée 08:40, départ 08:41) passait pour du retard (« +1 » d'un train à l'heure).
 */
export function rtAtStopShown(trip: RtTrip | null | undefined, ref: StopRef, shown: number, ctx: TripContext = {}): RtAtStop {
  const r = rtAtStop(trip, ref, ctx);
  const shift = r.est - ref.sched;
  return { ...r, est: shown + shift, delaySec: r.cancelled ? 0 : Math.round(shift / 1000) };
}

/** Retard affiché : arrondi à la minute, jamais négatif. */
export function delayMinutes(est: number, sched: number): number {
  return Math.max(0, Math.round((est - sched) / 60_000));
}

/* ------------------------------ STIB ------------------------------ */

/** Clé de destination : normalizeForSearch(prettyName(nom)), ex. « STALLE (P) » → « stalle p ». */
export function headKey(name: string): string {
  return normalizeForSearch(prettyName(name ?? ''));
}

/**
 * Proximité de deux destinations normalisées : 3 identiques, 2 mots de l'une tous dans l'autre
 * (« stalle » / « stalle p »), 1 l'une commence par l'autre, 0 sinon.
 */
export function headScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 3;
  const wa = a.split(' ');
  const wb = b.split(' ');
  if (wa.every((w) => wb.includes(w)) || wb.every((w) => wa.includes(w))) return 2;
  if (a.startsWith(b) || b.startsWith(a)) return 1;
  return 0;
}

export function sameHead(a: string, b: string): boolean {
  return headScore(a, b) > 0;
}
