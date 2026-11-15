/**
 * 1.2.10 (PRD-1.2.10 § 3.8) : voies gardées pour la marche et leurs attributs.
 *
 * Gardées : highway = footway, pedestrian, path, steps, living_street, residential, service, unclassified,
 * tertiary(_link), secondary(_link), primary(_link), track, cycleway, corridor ; trunk(_link) seulement avec un trottoir
 * (sidewalk) ou un accès piéton explicite ; quais (railway=platform, public_transport=platform, highway=platform).
 * Exclues : motorway(_link), foot=no (ou use_sidepath : le trottoir séparé sert), access=private|no sans accès piéton
 * explicite, escalier mécanique réversible (sens inconnu).
 * Attributs : nom (name:fr, sinon name ; « Rue X - Straat Y » bilingue de Bruxelles : la partie française), marches,
 * sens unique à pied (oneway:foot, foot:forward/backward=no, escalier mécanique), anneau de rond-point.
 */
import { F_BWD, F_FWD, F_RING, F_STEPS } from '../../../app/src/core/walk/format.ts';
import type { Tags } from './pbf.ts';

const HIGHWAYS = new Set([
  'footway', 'pedestrian', 'path', 'steps', 'living_street', 'residential', 'service', 'unclassified',
  'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link', 'track', 'cycleway', 'corridor',
  'platform',
]);
const TRUNKS = new Set(['trunk', 'trunk_link']);
const FOOT_OK = new Set(['yes', 'designated', 'permissive', 'destination']);
const FOOT_NO = new Set(['no', 'use_sidepath']);
const ACCESS_NO = new Set(['private', 'no']);
const SIDEWALK_YES = new Set(['both', 'left', 'right', 'yes']);
const YES = new Set(['yes', '1', 'true']);

/** Filtre rapide (avant le décodage des nœuds) : la voie peut-elle être gardée ? */
export function maybeWalkable(t: Tags): boolean {
  return t.has('highway') || t.get('railway') === 'platform' || t.get('public_transport') === 'platform';
}

function hasSidewalk(t: Tags): boolean {
  const s = t.get('sidewalk');
  if (s && SIDEWALK_YES.has(s)) return true;
  for (const k of ['sidewalk:both', 'sidewalk:left', 'sidewalk:right']) if (t.get(k) === 'yes') return true;
  return false;
}

/** Vrai si la voie se parcourt à pied (règles du PRD § 3.8). */
export function walkable(t: Tags): boolean {
  const hw = t.get('highway');
  const foot = t.get('foot');
  if (foot && FOOT_NO.has(foot)) return false;
  const footOk = !!foot && FOOT_OK.has(foot);
  const platform = t.get('railway') === 'platform' || t.get('public_transport') === 'platform';
  let kept = false;
  if (hw && HIGHWAYS.has(hw)) kept = true;
  else if (hw && TRUNKS.has(hw)) kept = footOk || hasSidewalk(t);
  else if (!hw) kept = platform;
  if (!kept) return false;
  const access = t.get('access');
  if (access && ACCESS_NO.has(access) && !footOk) return false;
  if (t.get('conveying') === 'reversible') return false;
  return true;
}

/** Sens unique pour un piéton : F_FWD (sens de la voie), F_BWD (à rebours) ou 0. */
export function footOneway(t: Tags): number {
  const conv = t.get('conveying');
  if (conv === 'forward' || conv === 'yes') return F_FWD;
  if (conv === 'backward') return F_BWD;
  const ow = t.get('oneway:foot');
  if (ow && YES.has(ow)) return F_FWD;
  if (ow === '-1') return F_BWD;
  const fwdNo = t.get('foot:forward') === 'no';
  const bwdNo = t.get('foot:backward') === 'no';
  if (fwdNo && !bwdNo) return F_BWD;
  if (bwdNo && !fwdNo) return F_FWD;
  return 0;
}

/** Attributs de chaîne (marches, sens unique, anneau). */
export function wayFlags(t: Tags): number {
  let f = footOneway(t);
  if (t.get('highway') === 'steps') f |= F_STEPS;
  const j = t.get('junction');
  if (j === 'roundabout' || j === 'circular') f |= F_RING;
  return f;
}

/** Nom de rue montré (français de préférence), ou chaîne vide. */
export function wayName(t: Tags): string {
  const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const fr = clean(t.get('name:fr'));
  if (fr) return fr;
  const name = clean(t.get('name'));
  if (!name) return '';
  // Bruxelles : « Rue de la Loi - Wetstraat » ; name:nl connu : l'autre moitié est le français
  const nl = clean(t.get('name:nl'));
  const parts = name.split(' - ');
  if (parts.length === 2 && nl) {
    if (parts[1] === nl) return parts[0];
    if (parts[0] === nl) return parts[1];
  }
  return name;
}

/** Étiquettes simples (tests, extraits XML). */
export function tagsOf(rec: Record<string, string>): Tags {
  return { get: (k) => (Object.prototype.hasOwnProperty.call(rec, k) ? rec[k] : undefined), has: (k) => Object.prototype.hasOwnProperty.call(rec, k) };
}
