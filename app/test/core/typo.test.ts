import { describe, expect, it } from 'vitest';
import { apos, shortName } from '../../src/core/typo';

describe('apos (1.3.1, PRD-1.3.1 § 7)', () => {
  it('apostrophe droite des données → apostrophe typographique', () => {
    expect(apos("Braine-l'Alleud, Gare")).toBe('Braine-l’Alleud, Gare');
    expect(apos("Porte d'Anderlecht")).toBe('Porte d’Anderlecht');
  });
  it('rien à changer : le même texte', () => {
    expect(apos('Bruxelles-Central')).toBe('Bruxelles-Central');
    expect(apos('Braine-l’Alleud')).toBe('Braine-l’Alleud');
  });
});

describe('1.3.1 : diminutif d’un nom trop long (shortName)', () => {
  it('l’exemple du propriétaire : Bruxelles-Central devient Bxl-Central', () => {
    expect(shortName('Bruxelles-Central')).toBe('Bxl-Central');
    expect(shortName('Bruxelles Midi')).toBe('Bxl Midi');
    expect(shortName('Brussel-Zuid')).toBe('Bru.-Zuid');
  });
  it('saints, voies et places, mots entiers seulement', () => {
    expect(shortName('Sainte-Catherine')).toBe('Ste-Catherine');
    expect(shortName('Parvis de Saint-Gilles')).toBe('Parvis de St-Gilles');
    expect(shortName('Sint-Job-in-’t-Goor Kristus Koning')).toBe('St-Job-in-’t-Goor Kristus Koning');
    expect(shortName('Boulevard Anspach')).toBe('Bd Anspach');
    expect(shortName('Avenue de la Toison d’Or')).toBe('Av. de la Toison d’Or');
    expect(shortName('Chaussée de Waterloo')).toBe('Ch. de Waterloo');
    expect(shortName('Place Louise')).toBe('Pl. Louise');
  });
  it('jamais au milieu d’un mot, et un nom sans mot de la liste revient tel quel', () => {
    expect(shortName('Saintes')).toBe('Saintes');
    expect(shortName('Placette')).toBe('Placette');
    expect(shortName('Bruxellesstraat')).toBe('Bruxellesstraat');
    expect(shortName('Flagey')).toBe('Flagey');
    expect(shortName('Gare du Nord')).toBe('Gare du Nord');
  });
  it('jamais plus long que le nom entier', () => {
    for (const n of ['Bruxelles-Luxembourg', 'Brussel-Noord', 'Saint-Guidon', 'Place', 'Avenue']) {
      expect(shortName(n).length).toBeLessThanOrEqual(n.length);
    }
  });
});
