/**
 * 1.2.10 « Y aller » : géométrie du guidage (PRD-1.2.10 § 3.2, § 3.8). Fonctions pures, sans dépendance au temps.
 *
 * - walkProgress : où l'on en est sur un chemin à pied (projection de la position sur la polyligne, prochain virage) ;
 * - projectOn : projection d'un point sur une polyligne quelconque (chemin à pied, arrêts d'un véhicule) ;
 * - turnsOf : virages annoncés d'un chemin (vrai chemin seulement, jamais « tout droit », aucun dans les 20 derniers m) ;
 * - bearingDeg, relativeDeg : cap d'un point à un autre, et direction par rapport au cap de la marche.
 */
import type { LatLon } from './api';
import type { Maneuver, WalkProgress, WalkRoute } from './guide-types';
import { distanceM } from './util';

const RAD = Math.PI / 180;
const EARTH_M = 6_371_000;
/** Aucun virage annoncé dans les derniers mètres d'un chemin (PRD § 3.8). */
export const LAST_TURN_FREE_M = 20;

/** Une position utilisable (les données écrivent 0, 0 quand elles n'en ont pas). */
export function knownPoint(p: { lat?: number; lon?: number } | null | undefined): p is LatLon {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && !(p.lat === 0 && p.lon === 0);
}

/** Distances cumulées le long d'une polyligne, en mètres (la première vaut 0). */
export function cumulative(pts: readonly LatLon[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + distanceM(pts[i - 1], pts[i]));
  return out;
}

/** Projection d'un point sur une polyligne. */
export interface Projection {
  /** distance parcourue le long de la polyligne jusqu'au point projeté, m */
  alongM: number;
  /** distance du point à la polyligne, m */
  offM: number;
  /** segment le plus proche (rang de son premier point), -1 si la polyligne est vide */
  seg: number;
  /** position sur ce segment, de 0 à 1 */
  t: number;
  /** longueur totale, m */
  totalM: number;
}

/**
 * Projection d'un point sur une polyligne (plan local autour du point : erreur négligeable sur quelques kilomètres).
 * À distance égale, le segment le plus tôt sur le chemin l'emporte.
 */
export function projectOn(pts: readonly LatLon[], p: LatLon, cum: readonly number[] = cumulative(pts)): Projection {
  const totalM = cum.length ? cum[cum.length - 1] : 0;
  if (!pts.length) return { alongM: 0, offM: Infinity, seg: -1, t: 0, totalM };
  if (pts.length === 1) return { alongM: 0, offM: distanceM(pts[0], p), seg: 0, t: 0, totalM };
  const kx = Math.cos(p.lat * RAD) * RAD * EARTH_M;
  const ky = RAD * EARTH_M;
  let best = { d: Infinity, seg: 0, t: 0 };
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = (pts[i].lon - p.lon) * kx;
    const ay = (pts[i].lat - p.lat) * ky;
    const dx = (pts[i + 1].lon - p.lon) * kx - ax;
    const dy = (pts[i + 1].lat - p.lat) * ky - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / l2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.d - 1e-6) best = { d, seg: i, t };
  }
  const alongM = cum[best.seg] + best.t * (cum[best.seg + 1] - cum[best.seg]);
  return { alongM, offM: best.d, seg: best.seg, t: best.t, totalM };
}

/** Points d'un chemin à pied (au moins le départ et l'arrivée). */
export function routePoints(route: WalkRoute): LatLon[] {
  return route.coords.length >= 2 ? route.coords : [route.from, route.to];
}

/** Un virage annoncé : la manœuvre, son rang dans `maneuvers` et sa distance depuis le début du chemin (m). */
export interface TurnAt {
  m: Maneuver;
  i: number;
  alongM: number;
}

/**
 * Virages annoncés d'un chemin, dans l'ordre : vrai chemin seulement (`source: 'osm'`), jamais « tout droit », aucun
 * dans les 20 derniers mètres. La distance d'un virage est mesurée sur la polyligne jusqu'à son point (`at`), comme la
 * progression (`alongM`) ; `distM` du chemin sert si `at` est hors des points.
 */
export function turnsOf(route: WalkRoute, cum: readonly number[] = cumulative(routePoints(route))): TurnAt[] {
  if (route.source !== 'osm' || route.coords.length < 2) return [];
  const total = cum[cum.length - 1];
  const out: TurnAt[] = [];
  route.maneuvers.forEach((m, i) => {
    if (m.turn === 'straight') return;
    const alongM = Number.isInteger(m.at) && m.at >= 0 && m.at < cum.length ? cum[m.at] : m.distM;
    if (!Number.isFinite(alongM) || alongM > total - LAST_TURN_FREE_M + 1e-6) return;
    out.push({ m, i, alongM });
  });
  return out;
}

/** Où l'on en est sur un chemin à pied : progression, écart au chemin, reste, prochain virage (PRD § 3.2, § 3.3). */
export function walkProgress(route: WalkRoute, fix: LatLon): WalkProgress {
  const pts = routePoints(route);
  const cum = cumulative(pts);
  const pr = projectOn(pts, fix, cum);
  const out: WalkProgress = { alongM: pr.alongM, offRouteM: pr.offM, remainingM: Math.max(0, pr.totalM - pr.alongM) };
  const next = turnsOf(route, cum).find((x) => x.alongM >= pr.alongM);
  if (next) out.next = { m: next.m, distM: next.alongM - pr.alongM };
  return out;
}

/** Cap de `a` vers `b`, en degrés depuis le nord vrai, sens horaire (0 à 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const f1 = a.lat * RAD;
  const f2 = b.lat * RAD;
  const dl = (b.lon - a.lon) * RAD;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Direction d'une cible par rapport au cap de la marche : de -180 (exclu) à 180 degrés, 0 = devant, positif à droite. */
export function relativeDeg(target: number, heading: number): number {
  const d = ((((target - heading) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}
