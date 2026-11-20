import { describe, expect, it } from 'vitest';
import { apos } from '../../src/core/typo';

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
