/**
 * 1.3.1 (finitions du 21/11) : outils du contrôle léger de « , dernier » dans la nuit (test/scan/sample.ts) :
 * échantillon stable des étapes, et choix du balayage complet (QUAI_SCAN_DERNIER).
 */
import { describe, expect, it } from 'vitest';
import { inSample, scanComplet } from '../scan/sample';

describe('1.3.1 : échantillon stable des balayages de nuit', () => {
  const ids = Array.from({ length: 20_000 }, (_, i) => `tec/tec:${(i * 7919) % 100_003}`);

  it('la même zone donne toujours la même réponse (ni hasard, ni date)', () => {
    const first = ids.map((id) => inSample(id, 10));
    expect(ids.map((id) => inSample(id, 10))).toEqual(first);
    expect(inSample('stib/stib:1111', 10)).toBe(inSample('stib/stib:1111', 10));
  });

  it('une zone sur 10 environ, réparties, et pas les mêmes qu’une sur 4', () => {
    const kept = ids.filter((id) => inSample(id, 10));
    expect(kept.length).toBeGreaterThan(ids.length / 10 - 300);
    expect(kept.length).toBeLessThan(ids.length / 10 + 300);
    // réparties : il y en a dans chaque tranche de 1 000 identifiants
    for (let k = 0; k < ids.length; k += 1000) expect(ids.slice(k, k + 1000).some((id) => inSample(id, 10))).toBe(true);
    const four = ids.filter((id) => inSample(id, 4));
    expect(four.length).toBeGreaterThan(ids.length / 4 - 400);
    expect(four.length).toBeLessThan(ids.length / 4 + 400);
  });

  it('une sur 1 (ou moins) : tout est gardé', () => {
    expect(ids.every((id) => inSample(id, 1))).toBe(true);
    expect(ids.every((id) => inSample(id, 0))).toBe(true);
    expect(inSample('', 1)).toBe(true);
  });

  it('balayage complet seulement s’il est demandé ; la nuit ordinaire (variable vide ou absente) reste légère', () => {
    for (const v of ['complet', 'COMPLET', ' complet ', '1', 'oui', 'true']) expect(scanComplet(v)).toBe(true);
    for (const v of [undefined, '', ' ', '0', 'non', 'false', 'leger', 'léger']) expect(scanComplet(v)).toBe(false);
  });
});
