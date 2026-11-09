/**
 * Écran Données (téléphone) : l'aide « horaires périmés » nomme le flux GitHub Actions par son nom affiché
 * (le `name:` de .github/workflows/nightly.yml), pas par le nom du fichier.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { networkText, NIGHTLY_WORKFLOW_NAME, STALE_HELP } from '../../src/phone/screens/data';

const WORKFLOW = fileURLToPath(new URL('../../../.github/workflows/nightly.yml', import.meta.url));

describe('écran Données : aide en cas d’horaires périmés', () => {
  it('cite le nom affiché du flux de nuit, entre guillemets français', () => {
    const name = /^name:\s*(.+?)\s*$/m.exec(readFileSync(WORKFLOW, 'utf8'))?.[1]?.replace(/^['"]|['"]$/g, '');
    expect(name).toBe(NIGHTLY_WORKFLOW_NAME);
    expect(STALE_HELP).toContain(`workflow « ${name} »`);
    expect(STALE_HELP).not.toMatch(/nightly|\u2014/);
  });
});

describe('écran Données : état de chaque réseau', () => {
  const feed = (patch = {}) => ({ ok: true, areas: 7, trips: 390, ...patch });
  it('horaires gardés d’une nuit précédente (meta.feeds[op].cachedFrom) : date et raison', () => {
    expect(networkText(true, feed({ cachedFrom: '2026-11-12' }), true)).toBe('Horaires du 12/11, le portail n’a pas répondu cette nuit');
  });
  it('sinon : absents, temps réel, horaires prévus, vérification en cours', () => {
    expect(networkText(true, feed({ ok: false, error: 'x' }), true)).toBe('Horaires absents cette nuit');
    expect(networkText(true, feed(), true)).toBe('Temps réel');
    expect(networkText(false, feed(), true)).toBe('Horaires prévus, temps réel indisponible');
    expect(networkText(false, undefined, false)).toBe('…');
  });
});
