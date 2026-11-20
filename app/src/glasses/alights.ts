/**
 * 1.3.1 (PRD-1.3.1 § 12, B11) : l'arrêt où l'on descend d'habitude. Quai retient sur le téléphone (clé `quai.descentes`
 * du stockage de l'appli, jamais de réseau), par ligne, les 3 derniers arrêts choisis avec « j'y descends » ; la liste
 * des arrêts d'un départ s'ouvre sur le plus récent qui vient après la montée. Effacé avec « Effacer le journal »
 * (téléphone, GlassesApi.forgetAlights).
 *
 * Seulement des noms et identifiants d'arrêts publics, jamais de coordonnées ni d'adresse. Lecture tolérante : contenu
 * abîmé ou d'une autre version, mémoire vide. Fonctions pures ; le contrôleur lit et écrit.
 */
import type { StopCall } from '../core/api';
import type { Mode, Names, Op } from '../../../shared/types';
import { normalizeForSearch } from '../../../shared/names';

/** Clé du stockage de l'appli (téléphone). */
export const ALIGHTS_KEY = 'quai.descentes';
/** Arrêts retenus par ligne, du plus récent au plus ancien. */
export const ALIGHTS_PER_LINE = 3;
/** Lignes retenues au plus (la moins récemment servie est oubliée d'abord) : la mémoire reste petite. */
export const ALIGHTS_LINES_MAX = 40;

/** Un arrêt retenu : sa zone (si les données la donnent) et son nom, en français et en néerlandais. */
export interface KeptStop {
  id?: string;
  fr: string;
  nl?: string;
}

/** La mémoire : les lignes, de la plus récemment servie à la plus ancienne, chacune ses arrêts du plus récent au plus ancien. */
export interface AlightMemory {
  v: 1;
  lines: { key: string; stops: KeptStop[] }[];
}

export const emptyAlights = (): AlightMemory => ({ v: 1, lines: [] });

/** La ligne d'un départ : réseau, mode et numéro (« stib|bus|71 », « sncb|train|IC »), les deux sens ensemble. */
export function alightLineKey(d: { op: Op; mode: Mode; line: string }): string {
  return `${d.op}|${d.mode}|${d.line.trim()}`;
}

const text = (x: unknown, max = 160): string | undefined => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : undefined);

/** Lecture tolérante de `quai.descentes` : contenu abîmé, d'une autre version ou absent : mémoire vide. */
export function parseAlights(raw: string | null | undefined): AlightMemory {
  if (!raw) return emptyAlights();
  try {
    const v = JSON.parse(raw) as { v?: unknown; lines?: unknown };
    if (!v || v.v !== 1 || !Array.isArray(v.lines)) return emptyAlights();
    const lines: AlightMemory['lines'] = [];
    for (const l of v.lines as { key?: unknown; stops?: unknown }[]) {
      const key = text(l?.key, 80);
      if (!key || !Array.isArray(l.stops) || lines.some((x) => x.key === key)) continue;
      const stops: KeptStop[] = [];
      for (const s of l.stops as { id?: unknown; fr?: unknown; nl?: unknown }[]) {
        const fr = text(s?.fr);
        if (!fr) continue;
        const id = text(s.id, 80);
        const nl = text(s.nl);
        stops.push({ ...(id ? { id } : {}), fr, ...(nl ? { nl } : {}) });
        if (stops.length >= ALIGHTS_PER_LINE) break;
      }
      if (stops.length) lines.push({ key, stops });
      if (lines.length >= ALIGHTS_LINES_MAX) break;
    }
    return { v: 1, lines };
  } catch {
    return emptyAlights();
  }
}

/** Même arrêt : même zone si les deux la donnent, sinon même nom (casse, accents et ponctuation ignorés). */
export function sameKept(k: KeptStop, c: Pick<StopCall, 'areaId' | 'name'>): boolean {
  if (k.id && c.areaId) return k.id === c.areaId;
  const n = (s: string | undefined): string => normalizeForSearch(s ?? '');
  return (!!k.fr && n(k.fr) === n(c.name.fr)) || (!!k.nl && !!c.name.nl && n(k.nl) === n(c.name.nl));
}

/** Retient l'arrêt choisi pour la ligne : en tête de sa ligne (sans doublon), la ligne en tête de la mémoire. */
export function noteAlight(m: AlightMemory, key: string, stop: Pick<StopCall, 'areaId' | 'name'>): AlightMemory {
  const names: Names = stop.name;
  const kept: KeptStop = { ...(stop.areaId ? { id: stop.areaId } : {}), fr: names.fr || names.nl || '', ...(names.nl && names.nl !== names.fr ? { nl: names.nl } : {}) };
  if (!kept.fr) return m;
  const line = m.lines.find((l) => l.key === key);
  const stops = [kept, ...(line?.stops ?? []).filter((s) => !sameKept(s, stop))].slice(0, ALIGHTS_PER_LINE);
  return { v: 1, lines: [{ key, stops }, ...m.lines.filter((l) => l.key !== key)].slice(0, ALIGHTS_LINES_MAX) };
}

/** Arrêts retenus d'une ligne, du plus récent au plus ancien (aucun : liste vide). */
export function keptStops(m: AlightMemory | null | undefined, key: string): KeptStop[] {
  return m?.lines.find((l) => l.key === key)?.stops ?? [];
}

/**
 * Rang, dans `stops`, de l'arrêt retenu le plus récent parmi ceux où l'on peut descendre (`ok`) ; aucun : -1.
 */
export function keptIndex(stops: readonly Pick<StopCall, 'areaId' | 'name'>[], kept: readonly KeptStop[], ok: (i: number) => boolean): number {
  for (const k of kept) {
    const i = stops.findIndex((c, n) => ok(n) && sameKept(k, c));
    if (i >= 0) return i;
  }
  return -1;
}
