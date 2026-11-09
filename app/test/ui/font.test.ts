import { describe, expect, it } from 'vitest';
import { getAdvW } from '@evenrealities/pretext';
import { glyphSafe, hasGlyph, missingGlyphs, padLeftTo, textWidth, truncate } from '../../src/glasses/font';
import { HINTS, NOTE_NO_RT, NOTE_PLANNED } from '../../src/glasses/format';
import { CURSOR } from '../../src/glasses/layout';

describe('police des lunettes', () => {
  it('contient tous les glyphes utilisés par l’interface', () => {
    const texts = [...Object.values(HINTS), NOTE_PLANNED, NOTE_NO_RT, CURSOR, '★ Ajouté aux favoris', '… ~ ▶ ▲ ▼ ’ « » é è à ç ê ô û œ É SUPPRIMÉ 0123456789 +:,.()!'];
    for (const t of texts) expect(missingGlyphs(t), t).toEqual([]);
  });

  it('reconnaît les glyphes absents (vérifiés dans le simulateur)', () => {
    for (const ch of ['⚠', '✓', '\u2011', '\u2012', '\u202F', '►', '▸']) expect(hasGlyph(ch.codePointAt(0)!), ch).toBe(false);
    for (const ch of ['▶', '▲', '▼', '★', '~', '…', '→', '\u00A0']) expect(getAdvW(ch.codePointAt(0)!)).toBeGreaterThan(0);
  });

  it('remplace les caractères absents et le tiret cadratin', () => {
    expect(glyphSafe('⚠ Travaux — ligne 51')).toBe('! Travaux - ligne 51');
    expect(glyphSafe('Gare\u202F:\u2009ok ✓')).toBe('Gare\u00A0: ok v');
    expect(missingGlyphs(glyphSafe('Łódź Ţară'))).toEqual([]);
    expect(glyphSafe('a\u200Bb')).toBe('ab');
    expect(missingGlyphs(glyphSafe('Ţară ⚠ ✓ ▸'))).toEqual([]);
  });

  it('mesure une police proportionnelle', () => {
    expect(textWidth('1')).toBeLessThan(textWidth('4'));
    expect(textWidth(' ')).toBe(5);
    expect(textWidth('')).toBe(0);
  });

  it('coupe au pixel avec « … »', () => {
    const long = 'Bruxelles-Nord, bus De Lijn vers Vilvoorde Station perron 2';
    const t = truncate(long, 200);
    expect(t.endsWith('…')).toBe(true);
    expect(textWidth(t)).toBeLessThanOrEqual(200);
    expect(truncate('Court', 200)).toBe('Court');
    expect(truncate('x', 0)).toBe('');
  });

  it('aligne à droite à ± 3 px près', () => {
    for (const s of ['5', '3 arrêts', 'aucun arrêt', 'IC 07:42 v.4', '232 ~13 min']) {
      const p = padLeftTo(s, 148);
      expect(textWidth(p)).toBeLessThanOrEqual(148);
      expect(148 - textWidth(p)).toBeLessThanOrEqual(3);
      expect(p.trimStart()).toBe(s);
    }
  });
});
