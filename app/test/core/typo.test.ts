import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('1.3.1, contrôle technique final : aucun regard arrière dans les motifs (Safari et WebView d’iOS avant 16.4)', () => {
  /** La règle d'avant la correction, écrite avec le regard arrière (Node le connaît) : la référence. */
  const WORDS: [string, string][] = [['Bruxelles', 'Bxl'], ['Brussel', 'Bru.'], ['Sainte', 'Ste'], ['Saint', 'St'], ['Sint', 'St'], ['Boulevard', 'Bd'], ['Avenue', 'Av.'], ['Chaussée', 'Ch.'], ['Place', 'Pl.']];
  const before = (name: string): string => WORDS.reduce((out, [w, short]) => out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, 'gu'), short), name);

  it('même résultat que la règle écrite avec le regard arrière, mots répétés et collés compris', () => {
    const names = [
      'Bruxelles-Central', 'Bruxelles Bruxelles', 'Place Place Place', 'Saint-Saint', 'Sainte Saint Sint', 'Place,Avenue;Boulevard/Chaussée',
      'Avenue de la Place Saint-Lambert', 'Chaussée de Bruxelles', '(Place)', '« Place »', 'Place', 'Placette Place', 'LaPlace Place', 'éPlace', 'Place2', '2Place',
      'Sint-Pieters-Leeuw Brussel', 'Brusselsesteenweg', 'Saintes', 'Bruxelles-Luxembourg / Brussel-Luxemburg', 'Boulevard du Boulevard', 'place Bruxelles', 'Avenue’Avenue', 'Porte d’Avenue',
    ];
    for (const n of names) expect(shortName(n), n).toBe(before(n));
    expect(shortName('Place Place Place')).toBe('Pl. Pl. Pl.');
    expect(shortName('Saint-Saint')).toBe('St-St');
  });

  it('aucun fichier de l’appli (app/src, shared) ne construit un motif avec « (?<! » ou « (?<= »', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(ts|js|mjs|html)$/.test(e.name) ? [join(dir, e.name)] : []));
    const root = join(__dirname, '..', '..');
    const bad = [...files(join(root, 'src')), ...files(join(root, '..', 'shared'))].filter((f) => /\(\?<[!=]/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
