/**
 * Recherche d'arrêts et de gares par nom (fichiers search/{xx}.json).
 *
 * Classement : gares SNCB d'abord ; puis les arrêts urbains, en reléguant à la fin ceux qui portent
 * exactement le nom d'une gare trouvée (l'arrêt de tram « Gand-Saint-Pierre » devant la gare) ;
 * à égalité, nom commençant par la requête, puis proximité de `near` (par paliers de distance, pour
 * ne pas départager deux lieux à 49 et 50 km), puis identifiant.
 */
import type { SearchFile } from '../../../shared/types';
import { matchesQuery, normalizeForSearch, searchKey, searchWords } from '../../../shared/names';
import type { SearchItem } from './api';
import { distanceM, kindLabel } from './util';

export const SEARCH_MAX = 20;

/** Mot qui choisit le fichier : premier mot indexable (≥ 2 caractères, hors mots vides). */
export function searchFileKey(query: string): string | null {
  const words = searchWords(query);
  const first = words[0] ?? normalizeForSearch(query).split(' ').find((w) => w.length >= 2);
  if (!first) return null;
  const key = searchKey(first);
  return key.length === 2 ? key : null;
}

function distanceBucket(d: number): number {
  if (!Number.isFinite(d)) return 99;
  return d < 500 ? 0 : Math.floor(Math.log2(d / 500)) + 1;
}

export function rankSearch(file: SearchFile | null, query: string, near?: { lat: number; lon: number }): SearchItem[] {
  if (!file) return [];
  const q = normalizeForSearch(query);
  const seen = new Set<string>();
  const items = file.items.filter((it) => {
    if (!it || seen.has(it.id) || !it.n) return false;
    seen.add(it.id);
    return matchesQuery(query, it.n.fr, it.n.nl);
  });
  const isStation = (it: SearchFile['items'][number]) => it.op === 'sncb';
  const stationNames = new Set(items.filter(isStation).flatMap((it) => [normalizeForSearch(it.n.fr), normalizeForSearch(it.n.nl)]));
  const keyed = items.map((it) => {
    const fr = normalizeForSearch(it.n.fr);
    const nl = normalizeForSearch(it.n.nl);
    const station = isStation(it);
    return {
      it,
      station: station ? 0 : 1,
      dup: !station && (stationNames.has(fr) || stationNames.has(nl)) ? 1 : 0,
      starts: fr.startsWith(q) || nl.startsWith(q) ? 0 : 1,
      dist: near ? distanceBucket(distanceM(near, it)) : 0,
    };
  });
  keyed.sort((a, b) => a.station - b.station || a.dup - b.dup || a.starts - b.starts || a.dist - b.dist || (a.it.id < b.it.id ? -1 : a.it.id > b.it.id ? 1 : 0));
  return keyed.slice(0, SEARCH_MAX).map(({ it }) => ({
    id: it.id,
    op: it.op,
    n: it.n,
    modes: it.modes,
    lat: it.lat,
    lon: it.lon,
    kindLabel: kindLabel(it.op, it.modes ?? []),
  }));
}
