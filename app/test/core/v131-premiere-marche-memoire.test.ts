/**
 * Quai 1.3.1, contrôle technique final : la mémoire des vrais chemins des premières marches (core/firstwalk.ts) quand
 * beaucoup de favoris sont en jeu. Avant la correction, elle gardait 32 chemins et oubliait le plus ancien d'abord : avec
 * plus de 32 premières marches différentes (une douzaine de trajets favoris à trois propositions), chaque
 * rafraîchissement recalculait un chemin oublié, qui « venait d'être connu » : tous les favoris étaient refaits, ce qui
 * oubliait le chemin suivant, sans fin (processeur et batterie du téléphone, heure de partir qui saute).
 */
import { describe, expect, it } from 'vitest';
import type { Leg } from '../../src/core/api';
import { FIRST_WALK, FirstWalks } from '../../src/core/firstwalk';
import { LIMITS } from '../../src/settings';

const T0 = Date.UTC(2026, 10, 16, 6, 10);
/** Lieux publics : autour de la Bourse de Bruxelles, un arrêt tous les 110 m environ vers l'est. */
const FROM = { lat: 50.8484, lon: 4.3497 };
const stopAt = (k: number) => ({ lat: 50.8484 + 0.001 * (k % 7), lon: 4.36 + 0.0016 * k });

/** Un trajet : 3 min de marche estimées jusqu'à l'arrêt `k`, puis un véhicule. */
function journey(k: number): { legs: Leg[] } {
  const to = stopAt(k);
  const name = { fr: `Arrêt ${k}`, nl: `Halte ${k}` };
  const walk: Leg = { kind: 'walk', from: { name: { fr: 'Bourse', nl: 'Beurs' }, ...FROM }, to: { name, ...to }, dep: T0, arr: T0 + 180_000, schedDep: T0, schedArr: T0 + 180_000, walkMin: 3 };
  const ride: Leg = { ...walk, kind: 'ride', from: walk.to, dep: T0 + 300_000, arr: T0 + 900_000, schedDep: T0 + 300_000, schedArr: T0 + 900_000 };
  return { legs: [walk, ride] };
}

/** Vrai chemin de 446 m (6 min pour 3 estimées) pour toute demande. */
const longPath = async (from: { lat: number; lon: number }, to: { lat: number; lon: number }) =>
  ({ source: 'osm', lengthM: 446, from, to, coords: [from, to], maneuvers: [], at: 0 }) as never;

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Rafraîchit comme les écrans : à chaque « chemin tout juste connu », tous les trajets sont redemandés. */
async function settleScreens(fw: FirstWalks, js: { legs: Leg[] }[], maxRounds: number): Promise<number> {
  let news = 0;
  fw.on(() => {
    news++;
    if (news < maxRounds) fw.ask(js, {});
  });
  fw.ask(js, {});
  // jusqu'au calme : plus de calcul en cours ni de rappel en attente
  for (let quiet = 0, last = -1; quiet < 5; ) {
    await fw.settle(1_000);
    await tick();
    if (fw.asked === last) quiet++;
    else quiet = 0;
    last = fw.asked;
    if (news >= maxRounds) break;
  }
  return news;
}

describe('1.3.1, contrôle technique final : mémoire des vrais chemins des premières marches', () => {
  // tous les favoris permis, trois propositions chacun, chacune vers un autre arrêt, plus les adresses récentes
  const MANY = (LIMITS.favorites + LIMITS.recent) * 3;

  it('la mémoire tient les premières marches de tous les favoris permis (trois propositions chacun) et des adresses récentes', () => {
    expect(FIRST_WALK.keep).toBeGreaterThanOrEqual(MANY);
  });

  it(`${MANY} premières marches différentes : chaque chemin est calculé une seule fois, les écrans se calment (pas de recalcul sans fin)`, async () => {
    const fw = new FirstWalks(longPath, { now: () => T0 });
    const js = Array.from({ length: MANY }, (_, k) => journey(k));
    const news = await settleScreens(fw, js, 500);
    expect(fw.asked).toBe(MANY);
    // un seul lot de calculs : les écrans sont prévenus une fois, puis plus rien
    expect(news).toBe(1);
    // tous les chemins sont encore connus : la même heure de partir au rafraîchissement suivant
    expect(js.every((j) => fw.extra(j.legs, {}) === 3)).toBe(true);
  });

  it('un chemin encore demandé à chaque rafraîchissement n’est jamais oublié au profit d’un chemin qui ne sert plus (déplacement)', async () => {
    const fw = new FirstWalks(longPath, { now: () => T0 });
    const kept = journey(0);
    fw.ask([kept], {});
    await fw.settle(1_000);
    // d'autres chemins arrivent (positions d'avant, autres arrêts), plus que la mémoire n'en garde ; celui du favori est
    // redemandé entre-temps, comme à chaque rafraîchissement de 30 s
    for (let k = 1; k <= FIRST_WALK.keep + 20; k++) {
      fw.ask([journey(k), kept], {});
      await fw.settle(1_000);
    }
    // calculé une seule fois : lui, puis chacun des autres
    expect(fw.asked).toBe(1 + FIRST_WALK.keep + 20);
    expect(fw.extra(kept.legs, {})).toBe(3);
  });
});
