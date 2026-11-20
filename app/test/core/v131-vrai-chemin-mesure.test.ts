/**
 * Quai 1.3.1, contrôle du « vrai chemin partout » : la mesure que le balayage des chemins à pied de la nuit écrit dans
 * son journal (walk-scan.test.ts, lignes « Première marche »), essayée ici sur des marches choisies et sur l'extrait de
 * test du dépôt (walk-data/fixtures : Namur et Bruxelles, lieux publics). Une mesure, pas une exigence.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LatLon } from '../../src/core/api';
import { FIRST_WALK, realWalkMin } from '../../src/core/firstwalk';
import { walkMinutes } from '../../src/core/util';
import { WalkRouter } from '../../src/core/walk/router';
import { diskSource, firstWalkReport, metres, type WalkSample } from './walk-helpers';

const RULE = { est: walkMinutes, real: realWalkMin, capMin: FIRST_WALK.capMin };

describe('mesure de la première marche (journal du balayage de la nuit)', () => {
  it('répartition : rien, +1, +2, +3 à +5, plus de 5 min plafonnées ; marches de 600 m au plus à part ; pire cas avec ses deux arrêts', () => {
    // vol d'oiseau 180 m : 3 min estimées ; 400 m : 7 min ; 1 000 m : 17 min
    const s = (from: string, crowM: number, lengthM: number): WalkSample => ({ from, to: 'Esplanade', crowM, lengthM });
    const samples = [
      s('A', 180, 150), // 2 min : plus court, rien ne change
      s('B', 180, 240), // 3 min : rien
      s('C', 180, 300), // 4 min : +1
      s('D', 180, 400), // 5 min : +2
      s('E', 180, 446), // 6 min : +3
      s('F', 180, 640), // 8 min : +5
      s('G', 180, 1000), // 13 min : +10, plafonné à 5
      s('H', 1000, 1300), // 17 min pour 17 : rien
      s('I', 1000, 1500), // 19 min : +2
      s('J', 400, 500), // 7 min pour 7 : rien
    ];
    const [all, near, worst, ...rest] = firstWalkReport(samples, RULE);
    expect(rest).toEqual([]);
    expect(all).toBe(
      "Première marche (1.3.1, heure de partir d'après le vrai chemin), toutes les marches rejouées : 10 vrais chemins, 6 (60,0 %) dépassent l'estimation d'au moins 1 min : " +
        "+1 min 1 (10,0 %), +2 min 2 (20,0 %), +3 à +5 min 2 (20,0 %), plus de 5 min, plafonnées 1 (10,0 %) ; avance moyenne quand l'heure change : 3,0 min ; rien ne change pour 4 (40,0 %)",
    );
    expect(near).toBe(
      "Première marche, marches de 600 m au plus à vol d'oiseau : 8 vrais chemins, 5 (62,5 %) dépassent l'estimation d'au moins 1 min : " +
        "+1 min 1 (12,5 %), +2 min 1 (12,5 %), +3 à +5 min 2 (25,0 %), plus de 5 min, plafonnées 1 (12,5 %) ; avance moyenne quand l'heure change : 3,2 min ; rien ne change pour 3 (37,5 %)",
    );
    expect(worst).toBe("Première marche, pire cas : G → Esplanade, vrai chemin de 1000 m (13 min) pour 3 min estimées (180 m à vol d'oiseau) : l'heure de partir avancerait de 5 min (plafond, 10 min sans lui)");
    // aucune marche, ou aucune plus longue : des lignes quand même, jamais d'erreur
    expect(firstWalkReport([], RULE)).toHaveLength(2);
    expect(firstWalkReport([s('A', 180, 150)], RULE)[2]).toMatch(/pire cas : A → Esplanade.* : rien ne changerait$/);
  });

  it('sur l’extrait de test du dépôt (Namur, Bruxelles) : les marches des scénarios, avec leurs vrais chemins', async () => {
    const P: Record<string, LatLon> = {
      'Namur, départ du scénario 1': { lat: 50.4655, lon: 4.859 },
      'Namur Gare': { lat: 50.4685, lon: 4.8625 },
      "Namur, place de l'Ange": { lat: 50.4645, lon: 4.8652 },
      'Namur Place Léopold': { lat: 50.466, lon: 4.861 },
      'Bruxelles-Nord': { lat: 50.8605, lon: 4.3612 },
      'Gare du Nord (tram)': { lat: 50.86, lon: 4.36014 },
      Bourse: { lat: 50.8483, lon: 4.3497 },
      'Place Fontainas': { lat: 50.8441, lon: 4.3474 },
      'Bruxelles-Central': { lat: 50.8454, lon: 4.3571 },
    };
    const walks: [string, string][] = [
      ['Namur, départ du scénario 1', 'Namur Gare'],
      ["Namur, place de l'Ange", 'Namur Gare'],
      ['Namur Place Léopold', 'Namur Gare'],
      ['Bruxelles-Nord', 'Gare du Nord (tram)'],
      ['Place Fontainas', 'Bourse'],
      ['Place Fontainas', 'Bruxelles-Central'],
    ];
    const router = new WalkRouter(diskSource(join(__dirname, 'walk-data', 'fixtures')));
    const samples: WalkSample[] = [];
    for (const [a, b] of walks) {
      const r = await router.route(P[a], P[b]);
      expect(r?.source, `${a} → ${b}`).toBe('osm');
      samples.push({ from: a, to: b, crowM: metres(P[a], P[b]), lengthM: r!.lengthM });
    }
    const lines = firstWalkReport(samples, RULE);
    console.log(lines.join('\n'));
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.startsWith('Première marche'))).toBe(true);
    // la somme des cases est le nombre de marches où l'heure change, et le pire cas est l'une des marches rejouées
    const n = (re: RegExp) => Number(re.exec(lines[0])?.[1]);
    expect(n(/: (\d+) vrais chemins/)).toBe(walks.length);
    expect(n(/\+1 min (\d+)/) + n(/\+2 min (\d+)/) + n(/\+3 à \+5 min (\d+)/) + n(/plafonnées (\d+)/)).toBe(n(/chemins, (\d+) \(/));
    expect(walks.some(([a, b]) => lines[2].includes(`${a} → ${b}`))).toBe(true);
    // aucun tiret long ni moyen, aucune coordonnée dans ces lignes
    expect(lines.join(' ')).not.toMatch(/[—–]|\d{2}\.\d{4}/);
  });
});
