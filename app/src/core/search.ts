/**
 * Recherche d'arrêts et de gares par nom (fichiers search/{xx}.json).
 *
 * 1.1 (PRD M4.2, review-tech M7, m7 ; S5) :
 *  - noms usuels : « gare du Midi », « gare du Nord », « gare Centrale » donnent aussi la gare SNCB ; « aéroport »,
 *    « aeroport », « luchthaven » donnent Brussels Airport ; « LLN » donne Louvain-la-Neuve ; « St », « Sint » et
 *    « Saint » sont équivalents ; « gare » ou « station » est facultatif (queryVariants) ;
 *  - classement : gares SNCB d'abord ; puis les arrêts urbains, en reléguant à la fin ceux qui portent exactement le nom
 *    d'une gare trouvée ; à égalité, mot exact avant début de mot, puis proximité de `near` (par paliers de
 *    distance), puis métro, tram, bus, puis l'opérateur local (STIB à Bruxelles), puis nom commençant par la requête,
 *    puis identifiant ;
 *  - homonymes : deux propositions de même nom et de même type → la commune est ajoutée au type
 *    (« métro TEC, Charleroi »).
 */
import type { Mode, SearchFile } from '../../../shared/types';
import { matchesQuery, normalizeForSearch, searchKey, searchWords } from '../../../shared/names';
import type { SearchItem } from './api';
import { distanceM, kindLabel, mainMode } from './util';

export const SEARCH_MAX = 20;

type Item = SearchFile['items'][number];

/** Mot qui choisit le fichier : premier mot indexable (≥ 2 caractères, hors mots vides). */
export function searchFileKey(query: string): string | null {
  const words = searchWords(query);
  const first = words[0] ?? normalizeForSearch(query).split(' ').find((w) => w.length >= 2);
  if (!first) return null;
  const key = searchKey(first);
  return key.length === 2 ? key : null;
}

/** Noms usuels → nom de la gare (requêtes normalisées). */
const ALIASES: [RegExp, string][] = [
  [/^(?:gare|station) (?:du |de )?midi$/, 'bruxelles midi'],
  [/^(?:gare|station) (?:du |de )?nord$/, 'bruxelles nord'],
  [/^(?:gare|station) (?:centrale?|central)$/, 'bruxelles central'],
  [/^(?:aeroport|aeroports|luchthaven|airport|zaventem aeroport|aeroport de zaventem|brussels airport)$/, 'brussels airport'],
  [/^lln$/, 'louvain la neuve'],
];
const SAINT = ['saint', 'sint', 'st'];
const OPTIONAL = new Set(['gare', 'station']);

/**
 * Variantes d'une requête (normalisées), la requête elle-même d'abord : alias, « St / Sint / Saint », sans « gare »
 * ou « station ». Au plus 6.
 */
export function queryVariants(query: string): string[] {
  const q = normalizeForSearch(query);
  if (!q) return [];
  const out = new Set<string>([q]);
  for (const [re, alias] of ALIASES) if (re.test(q)) out.add(alias);
  const words = q.split(' ');
  if (words.some((w) => SAINT.includes(w))) {
    for (const s of SAINT) out.add(words.map((w) => (SAINT.includes(w) ? s : w)).join(' '));
  }
  const rest = words.filter((w) => !OPTIONAL.has(w));
  if (rest.length && rest.length < words.length) {
    // « gare de Namur » → « namur » (sans les mots vides restés en tête)
    const trimmed = rest.join(' ').replace(/^(?:du|de|des|d|van|het) /, '');
    if (trimmed.replace(/ /g, '').length >= 2) out.add(trimmed);
  }
  return [...out].slice(0, 6);
}

/** Clés des fichiers de recherche à charger pour une requête (une par variante, sans doublon). */
export function searchFileKeys(query: string): string[] {
  return [...new Set(queryVariants(query).map(searchFileKey).filter((k): k is string => !!k))];
}

function distanceBucket(d: number): number {
  if (!Number.isFinite(d)) return 99;
  return d < 500 ? 0 : Math.floor(Math.log2(d / 500)) + 1;
}

const MODE_RANK: Record<Mode, number> = { metro: 0, tram: 1, bus: 2, train: 3 };
/** Bruxelles (19 communes, au large) : la STIB y est l'opérateur local. */
const inBrussels = (x: { lat: number; lon: number }) => x.lat > 50.763 && x.lat < 50.914 && x.lon > 4.244 && x.lon < 4.483;

/** Commune d'un arrêt quand le nom la donne : « Korenmarkt, Gand » → Gand ; TEC « Charleroi Waterloo (M) » →
 *  Charleroi ; STIB → Bruxelles. */
export function communeOf(it: Pick<Item, 'op' | 'n'>): string | undefined {
  const fr = it.n.fr.trim();
  if (it.op === 'stib') return 'Bruxelles';
  const comma = fr.lastIndexOf(', ');
  if (comma > 0) return fr.slice(comma + 2).trim() || undefined;
  if (it.op === 'tec') {
    // « Commune Arrêt » (préfixe de commune des noms TEC) : au moins deux mots hors parenthèses
    const words = fr.replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).filter(Boolean);
    return words.length >= 2 && /^\p{Lu}/u.test(words[0]) ? words[0].replace(/,$/, '') : undefined;
  }
  return undefined;
}

/**
 * Classe les zones trouvées. `files` : contenus des fichiers de recherche des variantes (searchFileKeys) ;
 * un SearchFile seul est accepté (1.0).
 */
export function rankSearch(files: SearchFile | null | readonly (SearchFile | null)[], query: string, near?: { lat: number; lon: number }): SearchItem[] {
  const list = Array.isArray(files) ? files : [files];
  const variants = queryVariants(query);
  if (!variants.length) return [];
  const seen = new Set<string>();
  const items: { it: Item; v: string }[] = [];
  for (const f of list) {
    for (const it of (f as SearchFile | null)?.items ?? []) {
      if (!it || !it.n || seen.has(it.id)) continue;
      const v = variants.find((x) => matchesQuery(x, it.n.fr, it.n.nl));
      if (v === undefined) continue;
      seen.add(it.id);
      items.push({ it, v });
    }
  }
  const isStation = (it: Item) => it.op === 'sncb';
  const stationNames = new Set(items.filter((x) => isStation(x.it)).flatMap(({ it }) => [normalizeForSearch(it.n.fr), normalizeForSearch(it.n.nl)]));
  const keyed = items.map(({ it, v }) => {
    const fr = normalizeForSearch(it.n.fr);
    const nl = normalizeForSearch(it.n.nl);
    const station = isStation(it);
    const words = new Set([...fr.split(' '), ...nl.split(' ')]);
    const exact = v.split(' ').every((w) => words.has(w)) ? 0 : 1;
    return {
      it,
      station: station ? 0 : 1,
      dup: !station && (stationNames.has(fr) || stationNames.has(nl)) ? 1 : 0,
      exact,
      mode: MODE_RANK[mainMode(it.modes ?? [])],
      local: it.op === 'stib' ? (inBrussels(it) ? 0 : 1) : inBrussels(it) ? 1 : 0,
      starts: fr.startsWith(v) || nl.startsWith(v) ? 0 : 1,
      dist: near ? distanceBucket(distanceM(near, it)) : 0,
    };
  });
  // Paliers de distance avant le mode : « gare du » près de Gare du Nord ne doit pas donner Gare du Midi d'abord.
  keyed.sort(
    (a, b) =>
      a.station - b.station ||
      a.dup - b.dup ||
      a.exact - b.exact ||
      a.dist - b.dist ||
      a.mode - b.mode ||
      a.local - b.local ||
      a.starts - b.starts ||
      (a.it.id < b.it.id ? -1 : a.it.id > b.it.id ? 1 : 0),
  );
  const out = keyed.slice(0, SEARCH_MAX).map(({ it }): SearchItem => ({
    id: it.id,
    op: it.op,
    n: it.n,
    modes: it.modes,
    lat: it.lat,
    lon: it.lon,
    kindLabel: kindLabel(it.op, it.modes ?? []),
  }));
  // S5 : homonymes (même nom, même type) → commune ajoutée au type
  const groups = new Map<string, SearchItem[]>();
  for (const x of out) {
    const k = `${normalizeForSearch(x.n.fr)}|${x.kindLabel}`;
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    for (const x of g) {
      const c = communeOf(x);
      if (c) x.kindLabel = `${x.kindLabel}, ${c}`;
    }
  }
  return out;
}
