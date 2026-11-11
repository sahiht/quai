/** 1.1 : noms lisibles (S5) : shared/names.ts (tecName, lineName, communeFr, knownFrName) et noms français De Lijn. */
import { describe, expect, it } from 'vitest';
import { communeFr, frName, knownFrName, lineName, prettyName, tecName } from '../../shared/names.ts';
import { RefNames, delijnFrFromRefs } from '../src/naming.ts';

describe('tecName', () => {
  it('commune en capitales remise en casse, sans accent inventé', () => {
    expect(tecName('WATERLOO Eglise')).toBe('Waterloo Eglise');
    expect(tecName('BRUXELLES Midi')).toBe('Bruxelles Midi');
    expect(tecName("BRAINE-L'ALLEUD Gare")).toBe('Braine-l’Alleud Gare');
    expect(tecName('LIEGE Place St-Lambert')).toBe('Liege Place St-Lambert');
    expect(tecName('LA HULPE Gare')).toBe('La Hulpe Gare');
    expect(tecName('MONT-SAINT-GUIBERT Centre')).toBe('Mont-Saint-Guibert Centre');
    expect(tecName('MARCHE-EN-FAMENNE Gare')).toBe('Marche-en-Famenne Gare');
    expect(tecName("ECAUSSINNES-D'ENGHIEN Place Cousin")).toBe('Ecaussinnes-d’Enghien Place Cousin');
    expect(tecName('HAM-SUR-HEURE Gare S.N.C.B.')).toBe('Ham-sur-Heure Gare S.N.C.B.');
    expect(tecName("'S GRAVENVOEREN Dreesch")).toBe("'s Gravenvoeren Dreesch");
  });

  it('commune répétée retirée ; sigles gardés ; noms sans préfixe inchangés ; tout en capitales remis en casse', () => {
    expect(tecName('LIEGE Liège Expo (Tram)')).toBe('Liège Expo (Tram)');
    expect(tecName('PROVEDROUX Provedroux 35')).toBe('Provedroux 35');
    expect(tecName('LA LOUVIERE SNCB Sud')).toBe('La Louviere SNCB Sud');
    expect(tecName('LIEGE CHU Sart-Tilman')).toBe('Liege CHU Sart-Tilman');
    expect(tecName('L-L-N, Gare d’Autobus')).toBe('L-L-N, Gare d’Autobus');
    expect(tecName('Namur (Gare des bus)')).toBe('Namur (Gare des bus)');
    expect(tecName('Namur Place Léopold')).toBe('Namur Place Léopold');
    expect(tecName('NAMUR GARE')).toBe('Namur Gare');
    expect(tecName("BRAINE-L'ALLEUD GARE")).toBe('Braine-l’Alleud Gare');
    expect(tecName('  WATERLOO   Eglise ')).toBe('Waterloo Eglise');
    expect(tecName('')).toBe('');
  });

  it('prettyName (STIB) inchangé par la 1.1', () => {
    expect(prettyName('GARE DU NORD')).toBe('Gare du Nord');
    expect(prettyName('STALLE (P)')).toBe('Stalle (P)');
    expect(prettyName('UZ-VUB')).toBe('UZ-VUB');
  });
});

describe('lineName', () => {
  it('préfixe du mode retiré pour un tram ou un métro, jamais pour un bus', () => {
    expect(lineName('T2', 'tram')).toBe('2');
    expect(lineName('t 7', 'tram')).toBe('7');
    expect(lineName('M3', 'metro')).toBe('3');
    expect(lineName('T1', 'metro')).toBe('T1');
    expect(lineName('B2', 'bus')).toBe('B2');
    expect(lineName('BRUY', 'bus')).toBe('BRUY');
    expect(lineName('T', 'tram')).toBe('T');
    expect(lineName('TB', 'tram')).toBe('TB');
    expect(lineName(' 92 ', 'tram')).toBe('92');
    expect(lineName('IC', 'train')).toBe('IC');
  });
});

describe('noms français De Lijn', () => {
  it('exonymes des communes wallonnes ; noms connus', () => {
    expect(frName('Terhulpen Station')).toBe('Gare de La Hulpe');
    expect(frName('Eigenbrakel Centrum')).toBe('Centrum, Braine-l’Alleud');
    expect(frName('Tubeke')).toBe('Tubize');
    expect(communeFr('Ukkel')).toBe('Uccle');
    expect(communeFr('Anderlecht')).toBe('Anderlecht');
    expect(knownFrName('Brussel Noordstation')).toBe('Bruxelles-Nord');
    expect(knownFrName('Gent Korenmarkt')).toBeUndefined();
  });

  it('zone SNCB ou STIB voisine de même nom : nom complet, ou nom sans la commune en tête ; à plus de 500 m, rien', () => {
    const refs = new RefNames();
    refs.add({ fr: 'Porte de Hal', nl: 'Hallepoort' }, 50.833, 4.345);
    refs.add({ fr: 'Anvers-Sud', nl: 'Antwerpen-Zuid' }, 51.198, 4.39);
    refs.add({ fr: 'Gare du Nord', nl: 'Noordstation' }, 50.86, 4.36);
    refs.add({ fr: 'Rogier', nl: 'Rogier' }, 50.857, 4.359); // pas de traduction : ignorée
    expect(refs.size).toBe(3);
    expect(delijnFrFromRefs('Sint-Gillis Hallepoort', 50.8332, 4.3452, refs)).toBe('Porte de Hal, Saint-Gilles');
    expect(delijnFrFromRefs('Antwerpen Zuid', 51.1985, 4.3905, refs)).toBe('Anvers-Sud');
    expect(delijnFrFromRefs('Sint-Gillis Hallepoort', 50.84, 4.345, refs)).toBeUndefined(); // 780 m
    expect(delijnFrFromRefs('Brussel Noordstation', 50.8618, 4.359, refs)).toBeUndefined(); // NAME_FR prioritaire
    expect(delijnFrFromRefs('Brussel Rogier', 50.857, 4.359, refs)).toBeUndefined();
    expect(delijnFrFromRefs('Hallepoort', 50.833, 4.345, undefined)).toBeUndefined();
  });
});
