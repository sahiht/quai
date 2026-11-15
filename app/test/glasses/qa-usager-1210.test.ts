/**
 * Quai 1.2.10, contrôle qualité usager : défauts trouvés en parcourant les écrans et les parcours avec le vrai
 * contrôleur, le vrai moteur et les vraies vues du guidage. Lieux publics seulement (gares et arrêts de Liège et de
 * Bruxelles).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Endpoint, LatLon } from '../../src/core/api';
import type { Intent } from '../../src/glasses/types';
import { P, at, firstWalkRoute, prdTrip } from '../core/guide-fixtures';
import { cleanupKit, guideSetup, type Kit } from './controller-guide-kit';
import { settingsWith } from './helpers';

const intent = (h: Kit, i: Intent) => (h.c as unknown as { runIntent(i: Intent): Promise<void> }).runIntent(i);
const settings = () => settingsWith([], { seenVersion: '1.2.10' });
const ETANGS: Endpoint = { type: 'address', label: 'Étangs d’Ixelles', lat: P.etangs.lat, lon: P.etangs.lon };

afterEach(() => cleanupKit());

describe('chemins à pied : jamais de boucle de demandes', () => {
  it('un chemin qui ne mène pas où le moteur l’attend : deux marches qui se le disputent ne bloquent pas l’appli', async () => {
    // Le contrôleur ne garde qu'un chemin à la fois. Descendu du train à Bruxelles-Central, le moteur demande la marche
    // vers l'arrêt du bus 71 (étape 4) ; avec ce chemin il se croit à l'arrêt et demande la dernière marche (étape 6) ;
    // sans le chemin de l'étape 4, il se croit encore en marche et le redemande... Une réponse immédiate du cœur
    // relançait aussitôt la demande suivante : boucle sans fin, appli figée. Ici le cœur rend toujours le même chemin
    // (celui de Liège), la boucle se voit au nombre de demandes ; au-delà de 50, le cœur échoue (la boucle s'arrête).
    let asked = 0;
    const walkRoute = async (_from: LatLon, _to: LatLon) => {
      asked++;
      if (asked > 50) throw new Error('trop de demandes');
      return firstWalkRoute();
    };
    const h = await guideSetup({ settings: settings(), pos: P.central, now: at('08:26:30'), walkRoute });
    await h.c.show({ screen: 'steps', key: 'k-prd', label: '', title: 'Bureau', journeys: [prdTrip()], index: 0, from: { type: 'here' } as Endpoint, to: ETANGS });
    await h.settle();
    await intent(h, { kind: 'goGuide' });
    await h.settle();
    const before = asked;
    for (let k = 0; k < 3; k++) {
      await h.settle(10_000);
      h.location.set(P.central);
      await h.push(P.central, { speed: 1 });
    }
    // au plus une demande par étape toutes les 10 s : quelques demandes en 30 s, jamais une rafale
    expect(asked - before).toBeLessThanOrEqual(8);
    expect(h.last().screen).toBe('guide');
  });
});
