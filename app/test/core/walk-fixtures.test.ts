/**
 * 1.2.10 : chemins à pied des scénarios de bout en bout, sur les tuiles construites depuis l'extrait écrit à la main
 * fixtures/pipeline/osm/namur-bruxelles.osm (lieux publics, tracé simplifié). Ce sont les marches que l'équipe des
 * scénarios peut vérifier sur les données des fixtures : moments « virage » compris.
 *   Construction : cd pipeline && QUAI_WALK_OSM=../fixtures/pipeline/osm/namur-bruxelles.osm \
 *     node --experimental-strip-types src/walk/cli.ts local --data <dossier des données des fixtures>
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LatLon } from '../../src/core/api';
import type { TurnKind, WalkRoute } from '../../src/core/guide-types';
import { WalkRouter } from '../../src/core/walk/router';
import { checkRoute, diskSource } from './walk-helpers';

/** Positions des fixtures (fixtures/network.json) : arrêts, gares et lieux du préréglage. */
const P = {
  'Maison (rue Rogier, Namur)': { lat: 50.4655, lon: 4.859 },
  'gare de Namur': { lat: 50.4685, lon: 4.8625 },
  "place de l'Ange (Namur)": { lat: 50.4645, lon: 4.8652 },
  'Namur Place Léopold (TEC)': { lat: 50.466, lon: 4.861 },
  'gare de Bruxelles-Nord': { lat: 50.8605, lon: 4.3612 },
  'Gare du Nord (tram)': { lat: 50.86, lon: 4.36014 },
  'Rogier (métro)': { lat: 50.857, lon: 4.359 },
  'rue du Progrès 20': { lat: 50.8582, lon: 4.36 },
  'Bourse (tram)': { lat: 50.8483, lon: 4.3497 },
  'Bureau (place Fontainas)': { lat: 50.8441, lon: 4.3474 },
  'gare de Bruxelles-Central': { lat: 50.8454, lon: 4.3571 },
} satisfies Record<string, LatLon>;
type Place = keyof typeof P;

const WALKS: { from: Place; to: Place; lengthM: number; turns: [number, TurnKind, string][] }[] = [
  { from: 'Maison (rue Rogier, Namur)', to: 'gare de Namur', lengthM: 495, turns: [[155, 'right', 'Avenue de la Gare'], [435, 'left', 'Place de la Station']] },
  { from: 'gare de Namur', to: 'Maison (rue Rogier, Namur)', lengthM: 495, turns: [[60, 'right', 'Avenue de la Gare'], [339, 'left', 'Rue Rogier']] },
  { from: "place de l'Ange (Namur)", to: 'gare de Namur', lengthM: 598, turns: [[388, 'left', 'Rue Godefroid'], [538, 'right', 'Place de la Station']] },
  { from: 'Namur Place Léopold (TEC)', to: 'gare de Namur', lengthM: 393, turns: [[223, 'right', 'Rue Godefroid'], [333, 'left', 'Place de la Station']] },
  { from: 'gare de Bruxelles-Nord', to: 'Gare du Nord (tram)', lengthM: 130, turns: [[74, 'left', 'Rue du Progrès']] },
  { from: 'Gare du Nord (tram)', to: 'gare de Bruxelles-Nord', lengthM: 130, turns: [[56, 'right', 'Passage de la gare du Nord']] },
  { from: 'Bourse (tram)', to: 'Bureau (place Fontainas)', lengthM: 526, turns: [[483, 'right', "Rue d'Anderlecht"]] },
  { from: 'Bureau (place Fontainas)', to: 'Bourse (tram)', lengthM: 526, turns: [[42, 'left', 'Boulevard Anspach']] },
  { from: 'gare de Bruxelles-Central', to: 'Bureau (place Fontainas)', lengthM: 796, turns: [[602, 'left', 'Boulevard Anspach'], [753, 'right', "Rue d'Anderlecht"]] },
  { from: 'Bureau (place Fontainas)', to: 'gare de Bruxelles-Central', lengthM: 796, turns: [[42, 'left', 'Boulevard Anspach'], [194, 'right', 'Rue du Lombard']] },
  { from: 'Rogier (métro)', to: 'rue du Progrès 20', lengthM: 151, turns: [] },
];

describe('marches des scénarios sur l’extrait des fixtures', () => {
  const router = new WalkRouter(diskSource(join(__dirname, 'walk-data', 'fixtures')));
  for (const w of WALKS) {
    it(`${w.from} → ${w.to} : ${w.turns.length ? w.turns.map((t) => `${t[1]} ${t[2]}`).join(', ') : 'tout droit'}`, async () => {
      const r = (await router.route(P[w.from], P[w.to])) as WalkRoute;
      expect(r.source).toBe('osm');
      checkRoute(r, P[w.from], P[w.to]);
      expect(Math.abs(r.lengthM - w.lengthM)).toBeLessThan(3);
      expect(r.maneuvers.map((m) => [m.turn, m.street])).toEqual(w.turns.map(([, turn, street]) => [turn, street]));
      r.maneuvers.forEach((m, i) => expect(Math.abs(m.distM - w.turns[i][0])).toBeLessThan(3));
    });
  }
});
