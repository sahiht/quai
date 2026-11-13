/**
 * 1.2.6 (PRD-1.2.6 § 5 et § 6) : pastilles des lignes à leur couleur officielle ; contrôle qualité du 13/11 (vraies
 * données) : le texte de l'opérateur illisible sur son fond (beige sur blanc de 556 lignes De Lijn) est remplacé par le
 * plus lisible du blanc et du presque noir ; le fond reste celui de l'opérateur.
 */
import { describe, expect, it } from 'vitest';
import { BADGE_CONTRAST, badgeColors, contrastRatio } from '../../src/phone/badges';

describe('pastilles des lignes : couleurs et contraste', () => {
  it('contraste WCAG : 21 du noir au blanc, 1 entre deux couleurs égales', () => {
    expect(contrastRatio('000000', 'FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('4C8B33', '4C8B33')).toBe(1);
  });

  it('le texte de l’opérateur gardé s’il se lit (STIB, TEC), remplacé sinon (De Lijn blanc et beige, STIB 8)', () => {
    expect(badgeColors('4C8B33', 'FFFFFF')).toEqual({ b: '4C8B33', t: 'FFFFFF' });
    expect(badgeColors('FFCD00', '000000')).toEqual({ b: 'FFCD00', t: '000000' });
    expect(badgeColors('FFFFFF', 'B59E6A')).toEqual({ b: 'FFFFFF', t: '161A17' });
    expect(badgeColors('169FDB', 'FFFFFF')).toEqual({ b: '169FDB', t: '161A17' });
    for (const [b, t] of [['FFFFFF', 'B59E6A'], ['169FDB', 'FFFFFF'], ['F57000', 'FFFFFF'], ['B5BA05', 'FFFFFF']]) {
      const c = badgeColors(b, t);
      expect(contrastRatio(c.b, c.t)).toBeGreaterThanOrEqual(BADGE_CONTRAST);
    }
  });

  it('sans couleur du texte : blanc sur un fond sombre, presque noir sur un fond clair', () => {
    expect(badgeColors('0078AD').t).toBe('FFFFFF');
    expect(badgeColors('FFD200').t).toBe('161A17');
  });
});
