/**
 * 1.3.1 (décision du propriétaire du 20/11 à 21:59, I3 de docs/v1.3.1/experts/05-innovation.md) : l'heure de partir
 * d'après le vrai chemin à pied, la même partout.
 *
 * La marche jusqu'au premier arrêt est estimée par le calcul des trajets (vol d'oiseau × 1,3, core/util.ts walkMinutes).
 * Le vrai chemin (tuiles piétonnes OpenStreetMap, calculé sur le téléphone : core/walk/router.ts) est parfois plus long.
 * Quand il est connu et plus long, la première marche du trajet compte ses vraies minutes : l'heure de partir, le début
 * de la marche et la marge suivent, parce que tout le monde lit le trajet (accueil, favoris, écran du trajet, autres
 * trajets, cartes du téléphone, carte « En cours », guidage, rappels). Une seule source : ce fichier, appliqué par le
 * cœur aux trajets qu'il rend (route, answer, refresh). Le guidage ne corrige plus rien lui-même (core/guide.ts).
 *
 * Règles (dans l'ordre de la décision) :
 * 1. jamais plus tard : les minutes ne font que monter (ou ne changent pas) ;
 * 2. plafond : au plus FIRST_WALK.capMin minutes de plus que l'estimation (un chemin faux dans les données n'avance pas
 *    le départ d'un quart d'heure) ; le dépassement est noté au journal technique (console), jamais à l'écran ;
 * 3. rien ne change sans vrai chemin : pas de tuiles (hors de Belgique, réseau coupé, pas encore chargées), chemin droit,
 *    chemin demandé d'ailleurs (plus de 40 m du départ) ou vers ailleurs (plus de 30 m de l'arrêt). Personne n'attend le
 *    chemin plus de FIRST_WALK.graceMs (0,1 s, quand ses tuiles sont déjà en mémoire) : sinon le trajet sort avec
 *    l'estimation, et `on()` prévient une fois quand le chemin est connu. Une fois montées, les minutes ne redescendent
 *    pas (Leg.walkEst garde l'estimation : la correction ne s'empile jamais) ;
 * 6. le chemin est celui du réglage « Éviter les escaliers » ;
 * 7. seulement la première marche d'un trajet qui continue en véhicule ;
 * 8. la position ne quitte pas le téléphone : seules des tuiles publiques sont demandées, par zone, comme pendant un
 *    guidage ; un calcul à la fois, les chemins gardés en mémoire (FIRST_WALK.keep), un chemin impossible redemandé au
 *    plus tôt FIRST_WALK.retryMs après.
 */
import type { Journey, LatLon, Leg, Settings } from './api';
import type { WalkRoute } from './guide-types';
import { distanceM } from './util';

export const FIRST_WALK = {
  /** avance maximale de l'heure de partir, en minutes */
  capMin: 5,
  /** vitesse de marche sur un vrai chemin (celle du guidage, GUIDE.walkMPerMin) */
  mPerMin: 80,
  /** un chemin connu vaut pour un départ à 40 m au plus du sien (GUIDE.leaveM) */
  startM: 40,
  /** … et pour un arrêt à 30 m au plus du sien */
  endM: 30,
  /** chemin impossible à calculer (tuiles absentes, réseau) : pas de nouvelle demande avant */
  retryMs: 120_000,
  /** chemins gardés en mémoire */
  keep: 32,
  /** attente au plus d'un chemin en cours de calcul avant de rendre un trajet (ses tuiles sont déjà là : quelques ms) */
  graceMs: 100,
} as const;

const MIN = 60_000;
const point = (p: { lat: number; lon: number } | undefined): p is LatLon =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && !(p.lat === 0 && p.lon === 0);
const avoidOf = (s: Pick<Settings, 'avoidSteps'>): boolean => s.avoidSteps === true;

/** La première marche d'un trajet qui continue en véhicule (du départ au premier arrêt) ; null sinon. */
export function firstWalkLeg(legs: readonly Leg[]): Leg | null {
  const w = legs[0];
  const r = legs[1];
  return w && r && w.kind === 'walk' && r.kind === 'ride' && point(w.from) && point(w.to) ? w : null;
}

/** Minutes d'un vrai chemin (80 m par minute, minute entamée comptée : comme le guidage). */
export function realWalkMin(lengthM: number): number {
  return Math.ceil(lengthM / FIRST_WALK.mPerMin);
}

/** L'estimation d'une première marche (avant toute correction). */
export function walkEstimate(w: Leg): number {
  return w.walkEst ?? w.walkMin ?? 0;
}

/**
 * Minutes que la première marche doit compter quand son vrai chemin fait `realMin` : le vrai chemin, au plus l'estimation
 * + 5 min, jamais moins que ce qu'elle compte déjà.
 */
export function firstWalkMin(w: Leg, realMin: number): number {
  const est = walkEstimate(w);
  const cur = w.walkMin ?? est;
  return Math.max(cur, Math.min(realMin, est + FIRST_WALK.capMin));
}

/**
 * Pose `walkMin` minutes sur la première marche d'étapes déjà copiées (elle arrive à la même heure, elle part plus
 * tôt) ; `walkEst` garde l'estimation. Rend les minutes ajoutées (0 : rien n'a changé). Les heures du trajet (leaveAt,
 * dep) sont recalculées par l'appelant (core/journeys.ts recompute).
 */
export function setFirstWalk(legs: Leg[], walkMin: number): number {
  const w = firstWalkLeg(legs);
  if (!w) return 0;
  const est = walkEstimate(w);
  const cur = w.walkMin ?? est;
  if (!(walkMin > cur)) return 0;
  const d = (walkMin - cur) * MIN;
  w.walkEst = est;
  w.walkMin = walkMin;
  w.dep -= d;
  w.schedDep -= d;
  return walkMin - cur;
}

/** La première marche de ce trajet a-t-elle été allongée d'après son vrai chemin ? */
export function firstWalkMoved(j: Pick<Journey, 'legs'>): boolean {
  const w = firstWalkLeg(j.legs);
  return !!w && w.walkEst !== undefined && (w.walkMin ?? 0) > w.walkEst;
}

interface Entry {
  from: LatLon;
  to: LatLon;
  avoid: boolean;
  /** minutes du vrai chemin ; null : pas de vrai chemin entre ces deux points (chemin droit) */
  min: number | null;
  /** dépassement du plafond déjà noté */
  logged?: boolean;
}

type RouteFn = (from: LatLon, to: LatLon, opts: { avoidSteps: boolean }) => Promise<WalkRoute | null>;

export interface FirstWalksOptions {
  now: () => number;
  /** journal technique (console par défaut) */
  log?: (text: string) => void;
}

/** Les vrais chemins des premières marches, gardés par le cœur (voir l'en-tête). */
export class FirstWalks {
  private readonly entries: Entry[] = [];
  private readonly failed: { from: LatLon; to: LatLon; avoid: boolean; at: number }[] = [];
  private readonly queue: { from: LatLon; to: LatLon; avoid: boolean; est: number }[] = [];
  private running = false;
  private waiters: (() => void)[] = [];
  private readonly listeners = new Set<() => void>();
  private news = false;
  /** mesures (rapport, tests) : chemins demandés au calcul depuis la création */
  asked = 0;

  constructor(
    private readonly route: RouteFn,
    private readonly o: FirstWalksOptions,
  ) {}

  private same(a: { from: LatLon; to: LatLon; avoid: boolean }, from: LatLon, to: LatLon, avoid: boolean): boolean {
    return a.avoid === avoid && distanceM(a.to, to) <= FIRST_WALK.endM && distanceM(a.from, from) <= FIRST_WALK.startM;
  }

  private entryOf(w: Leg, avoid: boolean): Entry | undefined {
    // le plus proche du départ d'abord : deux chemins connus à moins de 40 m ne se disputent pas la réponse
    let best: Entry | undefined;
    let bestD = Infinity;
    for (const e of this.entries) {
      if (!this.same(e, w.from, w.to, avoid)) continue;
      const d = distanceM(e.from, w.from);
      if (d < bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  /** Minutes à poser sur la première marche de ces étapes d'après un chemin connu ; 0 : rien à changer. */
  private target(legs: readonly Leg[], settings: Pick<Settings, 'avoidSteps'>): { w: Leg; min: number } | null {
    const w = firstWalkLeg(legs);
    if (!w) return null;
    const e = this.entryOf(w, avoidOf(settings));
    if (!e || e.min === null) return null;
    const min = firstWalkMin(w, e.min);
    if (!(min > (w.walkMin ?? walkEstimate(w)))) return null;
    if (e.min > walkEstimate(w) + FIRST_WALK.capMin && !e.logged) {
      e.logged = true;
      // règle 2 : au journal technique seulement ; ni lieu ni position dans la ligne
      (this.o.log ?? ((t: string) => console.warn(t)))(
        `[Quai] première marche : vrai chemin de ${e.min} min pour ${walkEstimate(w)} min prévues, avance limitée à ${FIRST_WALK.capMin} min`,
      );
    }
    return { w, min };
  }

  /** Minutes que le vrai chemin connu ajoute à la première marche de ces étapes (0 : inconnu ou pas plus long). */
  extra(legs: readonly Leg[], settings: Pick<Settings, 'avoidSteps'>): number {
    const t = this.target(legs, settings);
    return t ? t.min - (t.w.walkMin ?? walkEstimate(t.w)) : 0;
  }

  /** Même question pour une marche qui n'est pas encore une étape (favori de gare à gare : position → gare). */
  extraBetween(from: LatLon, to: LatLon, est: number, settings: Pick<Settings, 'avoidSteps'>): number {
    if (!point(from) || !point(to) || !(est > 0)) return 0;
    const probe: Leg = { kind: 'walk', from: { name: { fr: '', nl: '' }, ...from }, to: { name: { fr: '', nl: '' }, ...to }, dep: 0, arr: 0, schedDep: 0, schedArr: 0, walkMin: est };
    const ride: Leg = { ...probe, kind: 'ride' };
    return this.extra([probe, ride], settings);
  }

  /** Pose le vrai chemin connu sur des étapes déjà copiées (setFirstWalk) ; rend les minutes ajoutées. */
  apply(legs: Leg[], settings: Pick<Settings, 'avoidSteps'>): number {
    const t = this.target(legs, settings);
    return t ? setFirstWalk(legs, t.min) : 0;
  }

  /**
   * Demande en arrière-plan le vrai chemin de la première marche de ces trajets (ceux qu'un écran montre), s'il n'est
   * ni connu, ni en cours, ni impossible depuis peu. Un calcul à la fois. Ne rend rien : `settle` ou `on`.
   */
  ask(js: readonly Pick<Journey, 'legs'>[], settings: Pick<Settings, 'avoidSteps'>): void {
    const avoid = avoidOf(settings);
    const now = this.o.now();
    for (const j of js) {
      const w = firstWalkLeg(j.legs);
      if (!w || this.entryOf(w, avoid)) continue;
      if (this.queue.some((q) => this.same(q, w.from, w.to, avoid))) continue;
      const k = this.failed.findIndex((f) => this.same(f, w.from, w.to, avoid));
      if (k >= 0) {
        const at = this.failed[k].at;
        if (now >= at && now - at < FIRST_WALK.retryMs) continue;
        this.failed.splice(k, 1);
      }
      this.queue.push({ from: { lat: w.from.lat, lon: w.from.lon }, to: { lat: w.to.lat, lon: w.to.lon }, avoid, est: walkEstimate(w) });
    }
    if (!this.running && this.queue.length) void this.pump();
  }

  private async pump(): Promise<void> {
    this.running = true;
    try {
      while (this.queue.length) {
        const q = this.queue[0];
        let route: WalkRoute | null = null;
        this.asked++;
        try {
          route = await this.route(q.from, q.to, { avoidSteps: q.avoid });
        } catch {
          route = null;
        }
        this.queue.shift();
        if (!route) {
          this.failed.push({ from: q.from, to: q.to, avoid: q.avoid, at: this.o.now() });
          if (this.failed.length > FIRST_WALK.keep) this.failed.shift();
          continue;
        }
        const real = route.source === 'osm' && Number.isFinite(route.lengthM) && route.lengthM > 0;
        const min = real ? realWalkMin(route.lengthM) : null;
        this.entries.push({ from: q.from, to: q.to, avoid: q.avoid, min });
        if (this.entries.length > FIRST_WALK.keep) this.entries.shift();
        if (min !== null && min > q.est) this.news = true;
      }
    } finally {
      this.running = false;
      const w = this.waiters;
      this.waiters = [];
      for (const f of w) f();
      if (this.news) {
        this.news = false;
        // après le retour des appels en cours : ceux qui attendaient (settle) rendent d'abord leur trajet corrigé
        setTimeout(() => {
          for (const cb of [...this.listeners]) {
            try {
              cb();
            } catch {
              /* un écran en erreur n'empêche pas les autres */
            }
          }
        }, 0);
      }
    }
  }

  /** Attend la fin des calculs en cours, `ms` au plus (rien en cours : tout de suite). */
  async settle(ms: number = FIRST_WALK.graceMs): Promise<void> {
    if (!this.running) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      new Promise<void>((r) => this.waiters.push(r)),
      new Promise<void>((r) => {
        timer = setTimeout(r, ms);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
  }

  /** Prévient quand un chemin tout juste connu allonge une première marche (les écrans se rafraîchissent une fois). */
  on(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}
