/**
 * 1.2.10 (PRD-1.2.10 § 3.8) : chemin à pied du téléphone. Charge les tuiles piétonnes autour de la marche (cadre des
 * deux bouts + 300 m ; sans chemin trouvé, une fois + 1 km), les garde décodées en mémoire (16 tuiles au plus), puis
 * calcule (route.ts). Les tuiles sont demandées par zone, comme les tuiles d'arrêts : aucune position ne part.
 *
 * Résultat : le vrai chemin (`source: 'osm'`) ; le chemin droit (`straight`, aucun virage) quand un bout n'a aucune
 * voie à 100 m, qu'aucun chemin ne relie les deux bouts, ou que la marche dépasse 5 km ; null quand les données
 * manquent (pas de chemins publiés) ; exception quand le réseau ou une tuile fait défaut (l'appelant réessaie plus
 * tard).
 *
 * 1.3.0 (PRD-1.3.0 § 4) : un chemin droit dit pourquoi (`reason`) : `outside` quand la tuile d'un des deux bouts est
 * absente de la publication (hors de l'extrait de Belgique) ; sinon `nosnap` (aucune voie à 100 m d'un bout, ou aucune
 * tuile utilisable), `nopath` (pas de chemin dans les tuiles, même au second essai) ou `far` (plus de 5 km, rien de
 * chargé). Les vrais chemins sont exactement ceux de la 1.2.10 : la raison s'ajoute aux chemins droits, rien d'autre.
 */
import type { LatLon } from '../api';
import type { WalkRoute } from '../guide-types';
import { leafKeyOf, leafKeysForBox, WALK_UNIT, type UnitBox, type WalkIndex, type WalkTileFile } from './format';
import { M_PER_U, mergeTiles, prepareTile, unitsM, type RoutingGraph, type TileGraph } from './graph';
import { routeOn, straightRoute } from './route';

/** Marge autour du cadre des deux bouts. */
export const MARGIN_M = 300;
/** Marge du second essai, quand aucun chemin n'a été trouvé. */
export const WIDE_MARGIN_M = 1000;
/** Au-delà, pas de calcul (une marche du guidage fait au plus 2 km) : chemin droit. */
export const MAX_WALK_M = 5000;
export const MAX_TILES = 16;
/**
 * Après l'échec d'une tuile (réseau), pas de nouvelle demande avant 30 s : le guidage peut redemander un chemin à
 * chaque position (toutes les 2 s) ; sans réseau, la réponse (null) est alors immédiate.
 */
export const RETRY_MS = 30_000;

export interface WalkSource {
  /** Index des tuiles ; null : pas de chemins à pied publiés. */
  index(): Promise<WalkIndex | null>;
  /** Une tuile ; null : tuile vide (absente de la publication). */
  tile(key: string, version: string): Promise<WalkTileFile | null>;
}

export interface WalkRouterOptions {
  now?: () => number;
  maxTiles?: number;
}

const valid = (p: LatLon | null | undefined): p is LatLon =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

/** Cadre en unités de deux points, élargi de `marginM`. */
export function boxAround(a: LatLon, b: LatLon, marginM: number): UnitBox {
  const la0 = Math.min(a.lat, b.lat) / WALK_UNIT;
  const la1 = Math.max(a.lat, b.lat) / WALK_UNIT;
  const lo0 = Math.min(a.lon, b.lon) / WALK_UNIT;
  const lo1 = Math.max(a.lon, b.lon) / WALK_UNIT;
  const dLat = marginM / M_PER_U;
  const dLon = marginM / (M_PER_U * Math.max(0.1, Math.cos(((la0 + la1) / 2) * WALK_UNIT * (Math.PI / 180))));
  return { lat0: Math.floor(la0 - dLat), lat1: Math.ceil(la1 + dLat), lon0: Math.floor(lo0 - dLon), lon1: Math.ceil(lo1 + dLon) };
}

export class WalkRouter {
  private readonly src: WalkSource;
  private readonly now: () => number;
  private readonly maxTiles: number;
  /** tuiles décodées (ou en cours), clé « version|tuile », la plus récemment servie en dernier */
  private readonly tiles = new Map<string, Promise<TileGraph | null>>();
  private version = '';
  private graph: { key: string; g: RoutingGraph } | null = null;
  /** dernière erreur de chaque tuile (clé « version|tuile ») */
  private readonly failedAt = new Map<string, number>();

  constructor(src: WalkSource, opts: WalkRouterOptions = {}) {
    this.src = src;
    this.now = opts.now ?? (() => Date.now());
    this.maxTiles = opts.maxTiles ?? MAX_TILES;
  }

  /** Chemin à pied de `from` à `to` (voir l'en-tête du fichier pour les cas). */
  async route(from: LatLon, to: LatLon): Promise<WalkRoute | null> {
    if (!valid(from) || !valid(to)) return null;
    const crow = unitsM(from.lat / WALK_UNIT, from.lon / WALK_UNIT, to.lat / WALK_UNIT, to.lon / WALK_UNIT);
    if (crow > MAX_WALK_M) return this.straight(from, to, 'far');
    const index = await this.src.index();
    if (!index) return null;
    if (index.version !== this.version) {
      this.version = index.version;
      this.tiles.clear();
      this.failedAt.clear();
      this.graph = null;
    }
    const split = new Set(index.split);
    // 1.3.0 : tuiles (feuilles) où tombent les deux bouts ; absente de la publication : hors de l'extrait de Belgique
    const ends = [leafKeyOf(from.lat / WALK_UNIT, from.lon / WALK_UNIT, split), leafKeyOf(to.lat / WALK_UNIT, to.lon / WALK_UNIT, split)];
    let outside = false;
    const why = (r: 'nosnap' | 'nopath') => (outside ? 'outside' : r);
    for (const margin of [MARGIN_M, WIDE_MARGIN_M]) {
      const keys = leafKeysForBox(boxAround(from, to, margin), split);
      const got = await Promise.all(keys.map((k) => this.tile(k, index.version)));
      // les bouts sont dans le cadre : leurs tuiles sont parmi celles demandées (null : tuile absente)
      if (margin === MARGIN_M) outside = ends.some((e) => got[keys.indexOf(e)] === null);
      // contrôle technique du 15/11 : une tuile d'une autre semaine (index encore en cache quand la publication change)
      // n'est jamais mélangée aux autres (ses points de coupe ne se raccordent pas) ; elle sert dès que l'index suit
      const loaded = got.filter((t): t is TileGraph => t !== null && t !== undefined && t.ver === index.version);
      if (!loaded.length) return this.straight(from, to, why('nosnap'));
      const r = routeOn(this.graphOf(loaded), from, to, this.now());
      if (typeof r !== 'string') return r;
      if (r === 'nosnap') return this.straight(from, to, why('nosnap'));
    }
    return this.straight(from, to, why('nopath'));
  }

  /** Chemin droit (aucun virage) et sa raison (1.3.0). */
  private straight(from: LatLon, to: LatLon, reason: NonNullable<WalkRoute['reason']>): WalkRoute {
    return { ...straightRoute(from, to, this.now()), reason };
  }

  /** Graphe des tuiles données (le dernier est gardé : un nouveau calcul sur la même marche le reprend). */
  private graphOf(tiles: TileGraph[]): RoutingGraph {
    const key = tiles.map((t) => `${t.ver}|${t.key}`).join(',');
    if (this.graph?.key === key) return this.graph.g;
    const g = mergeTiles(tiles);
    this.graph = { key, g };
    return g;
  }

  private tile(key: string, version: string): Promise<TileGraph | null> {
    const k = `${version}|${key}`;
    const hit = this.tiles.get(k);
    if (hit) {
      this.tiles.delete(k);
      this.tiles.set(k, hit);
      return hit;
    }
    const failed = this.failedAt.get(k);
    const t = this.now();
    if (failed !== undefined && t - failed < RETRY_MS && t >= failed) return Promise.reject(new Error('tuile piétonne indisponible (nouvel essai dans 30 s)'));
    const p = this.src.tile(key, version).then((f) => (f ? prepareTile(f) : null));
    this.tiles.set(k, p);
    p.then(
      () => this.failedAt.delete(k),
      () => {
        if (this.tiles.get(k) === p) this.tiles.delete(k);
        this.failedAt.set(k, this.now());
      },
    );
    while (this.tiles.size > this.maxTiles) {
      const oldest = this.tiles.keys().next().value as string;
      this.tiles.delete(oldest);
    }
    return p;
  }
}
