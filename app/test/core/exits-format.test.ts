/**
 * 1.3.1 (PRD-1.3.1 § 14, R1) : fichier des sorties du métro (core/walk/exits-format.ts) : forme lue sans risque, sorties
 * d'un arrêt physique de la STIB seulement, sortie choisie vers la suite du chemin. Lieux publics (Bruxelles).
 */
import { describe, expect, it } from 'vitest';
import { chooseExit, exitsOf, isExitsFile, type ExitsFile } from '../../src/core/walk/exits-format';

const file: ExitsFile = {
  v: 1,
  version: '2026-11-19',
  builtAt: '2026-11-20T01:30:00.000Z',
  source: 'OpenStreetMap, extrait Geofabrik belgium-latest.osm.pbf',
  licence: 'ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/)',
  attribution: '© les contributeurs d’OpenStreetMap',
  stops: {
    // Bourse : deux sorties, au nord (rue Jules Van Praet) et au sud (boulevard Anspach)
    '8362': { s: 'Bourse', x: [['Rue Jules Van Praet', 50.84905, 4.35068, 45], ['Boulevard Anspach', 50.84752, 4.34969, 80]] },
    '6357': { s: 'Gare du Nord', x: [['Place du Nord', 50.85986, 4.36113, 70]] },
  },
};

describe('1.3.1 : sorties du métro (fichier exits.json)', () => {
  it('forme valide ; tout écart rend le fichier ignoré', () => {
    expect(isExitsFile(file)).toBe(true);
    expect(isExitsFile(JSON.parse(JSON.stringify(file)))).toBe(true);
    const bad = (patch: Record<string, unknown>) => isExitsFile({ ...file, ...patch });
    expect(bad({ v: 2 })).toBe(false);
    expect(bad({ version: '19/11/2026' })).toBe(false);
    expect(bad({ stops: [] })).toBe(false);
    expect(bad({ stops: { '1': { s: 'X', x: [] } } })).toBe(false);
    expect(bad({ stops: { '1': { s: 'X', x: [['Rue A', 50, 4, 1], ['Rue B', 50, 4, 2], ['Rue C', 50, 4, 3], ['Rue D', 50, 4, 4]] } } })).toBe(false);
    expect(bad({ stops: { '1': { s: 'X', x: [['', 50, 4, 1]] } } })).toBe(false);
    expect(bad({ stops: { '1': { s: 'X', x: [['Rue A', 95, 4, 1]] } } })).toBe(false);
    expect(bad({ stops: { '1': { s: 'X', x: [['Rue A', 50, 4, -1]] } } })).toBe(false);
    expect(bad({ stops: { '1': { s: 'X', x: [['Rue A', 50, Number.NaN, 1]] } } })).toBe(false);
    expect(bad({ stops: { '1': { x: [['Rue A', 50, 4, 1]] } } })).toBe(false);
    expect(isExitsFile(null)).toBe(false);
    expect(isExitsFile('exits')).toBe(false);
  });

  it('sorties d’un arrêt physique de la STIB : numéro exact, sinon sans sa lettre ; rien ailleurs', () => {
    expect(exitsOf(file, 'stib', '8362').map((e) => e.name)).toEqual(['Rue Jules Van Praet', 'Boulevard Anspach']);
    expect(exitsOf(file, 'stib', '6357F').map((e) => e.name)).toEqual(['Place du Nord']);
    expect(exitsOf(file, 'stib', '6357')[0]).toEqual({ name: 'Place du Nord', lat: 50.85986, lon: 4.36113, m: 70 });
    // hors de la STIB, sans numéro, arrêt sans sortie connue (en surface), sans fichier
    expect(exitsOf(file, 'delijn', '8362')).toEqual([]);
    expect(exitsOf(file, 'tec', '8362')).toEqual([]);
    expect(exitsOf(file, 'stib', undefined)).toEqual([]);
    expect(exitsOf(file, 'stib', '1234')).toEqual([]);
    expect(exitsOf(null, 'stib', '8362')).toEqual([]);
    // jamais une clé héritée d'un objet
    expect(exitsOf(file, 'stib', '__proto__')).toEqual([]);
    expect(exitsOf(file, 'stib', 'constructor')).toEqual([]);
    expect(exitsOf(file, 'stib', 'toString')).toEqual([]);
  });

  it('sortie vers la suite du chemin : couloir plus vol d’oiseau jusqu’au bout de la marche', () => {
    const xs = exitsOf(file, 'stib', '8362');
    // vers le nord (place De Brouckère) : la rue Jules Van Praet ; vers le sud (place Fontainas) : le boulevard Anspach
    expect(chooseExit(xs, { lat: 50.8510, lon: 4.3520 })?.name).toBe('Rue Jules Van Praet');
    expect(chooseExit(xs, { lat: 50.8445, lon: 4.3469 })?.name).toBe('Boulevard Anspach');
    // sans bout connu : la plus proche du quai ; sans sortie : rien
    expect(chooseExit(xs, null)?.name).toBe('Rue Jules Van Praet');
    expect(chooseExit(xs, { lat: Number.NaN, lon: 4.35 })?.name).toBe('Rue Jules Van Praet');
    expect(chooseExit([], { lat: 50.85, lon: 4.35 })).toBeNull();
  });
});
