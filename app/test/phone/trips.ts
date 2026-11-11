/**
 * Trajets construits pour les tests du téléphone (PRD-1.2.1 : cartes, jour férié), sans le cœur : les phrases des
 * cartes ne lisent que les étiquettes, les heures et les marches. Un trajet est une suite de marches (minutes) et de
 * véhicules [départ, arrivée, nom] : « IC », « S1 » (trains SNCB), « bus W », « bus 36 » (TEC), « métro 2 »,
 * « tram 92 » (STIB).
 */
import type { Journey, JourneyLabel, Leg, Mode, Op } from '../../src/core/api';

const pad = (n: number): string => String(n).padStart(2, '0');
/** Instants d'un jour donné, heure belge de novembre (UTC+1) : `const t = onDay('2026-11-11'); t(19, 42)`. */
export const onDay =
  (date: string) =>
  (hh: number, mm: number): number =>
    Date.parse(`${date}T${pad(hh)}:${pad(mm)}:00+01:00`);

const stop = (fr: string) => ({ name: { fr, nl: fr }, lat: 0, lon: 0 });

export function walkLeg(dep: number, min: number): Leg {
  return { kind: 'walk', from: stop('A'), to: stop('B'), dep, arr: dep + min * 60_000, schedDep: dep, schedArr: dep + min * 60_000, walkMin: min };
}

/** Véhicule par son nom : « bus W » (TEC), « métro 2 », « tram 92 » (STIB), sinon un train SNCB de cette catégorie. */
export function rideLeg(dep: number, arr: number, name: string, from = 'Départ', to = 'Arrivée'): Leg {
  const m = /^(bus|tram|métro) (.+)$/.exec(name);
  const mode: Mode = m ? (m[1] === 'métro' ? 'metro' : (m[1] as Mode)) : 'train';
  const line = m ? m[2] : name;
  const op: Op = mode === 'train' ? 'sncb' : mode === 'bus' ? 'tec' : 'stib';
  return { kind: 'ride', from: stop(from), to: stop(to), dep, arr, schedDep: dep, schedArr: arr, op, mode, line, ...(mode === 'train' ? { cat: line } : {}), rt: false };
}

export type Step = number | [number, number, string];

/**
 * Trajet à partir de `start` : chaque nombre est une marche (minutes), chaque triplet un véhicule. Heure conseillée
 * pour partir comme le cœur : départ du premier véhicule, moins la marche jusqu'à lui, moins 2 min (leaveBeforeMin).
 */
export function trip(label: JourneyLabel | undefined, start: number, steps: Step[], extra: Partial<Journey> = {}): Journey {
  const legs: Leg[] = [];
  let t = start;
  for (const s of steps) {
    if (typeof s === 'number') {
      legs.push(walkLeg(t, s));
      t += s * 60_000;
    } else {
      legs.push(rideLeg(s[0], s[1], s[2]));
      t = s[1];
    }
  }
  const rides = legs.filter((l) => l.kind === 'ride');
  const w0 = legs[0].kind === 'walk' ? (legs[0].walkMin ?? 0) : 0;
  const leaveAt = rides[0] ? rides[0].dep - (w0 + 2) * 60_000 : legs[0].dep;
  return { id: `${label ?? 'x'}-${start}`, legs, dep: legs[0].dep, arr: t, leaveAt, transfers: Math.max(0, rides.length - 1), rt: false, alerts: [], ...(label ? { label } : {}), ...extra };
}
