/**
 * Écran Données (téléphone) : l'aide « horaires périmés » nomme le flux GitHub Actions par son nom affiché
 * (le `name:` de .github/workflows/nightly.yml), pas par le nom du fichier.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { addressStatus, networkText, NIGHTLY_WORKFLOW_NAME, realtimeText, STALE_HELP } from '../../src/phone/screens/data';
import { APP_VERSION } from '../../src/version';

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

describe('écran Données 1.1 : version, adresses, temps réel (M7, M8, T6)', () => {
  const health = (geocode?: Record<string, { ok: boolean }>) => ({ ok: true, time: '', sources: { sncb: { ok: true }, stib: { ok: true }, delijn: { ok: true }, tec: { ok: true } }, ...(geocode ? { geocode } : {}) });
  it('version de Quai : celle de app.json (1.2.1)', () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../app.json', import.meta.url)), 'utf8'));
    expect(APP_VERSION).toBe(manifest.version);
    expect(APP_VERSION).toBe('1.2.1');
  });
  it('services d’adresses : disponibles, indisponibles, ou sauf une Région', () => {
    expect(addressStatus(null, false)).toEqual({ ok: false, text: '…' });
    expect(addressStatus(null, true)).toEqual({ ok: false, text: 'Indisponible' });
    expect(addressStatus(health(), true)).toEqual({ ok: false, text: 'Indisponible' });
    expect(addressStatus(health({ bru: { ok: true }, vla: { ok: true }, wal: { ok: true } }), true)).toEqual({ ok: true, text: 'Disponible' });
    expect(addressStatus(health({ bru: { ok: false }, vla: { ok: false }, wal: { ok: false } }), true)).toEqual({ ok: false, text: 'Indisponible' });
    expect(addressStatus(health({ bru: { ok: true }, vla: { ok: true }, wal: { ok: false } }), true)).toEqual({ ok: true, text: 'Disponible, sauf en Wallonie' });
    expect(addressStatus(health({ bru: { ok: false }, vla: { ok: true }, wal: { ok: false } }), true)).toEqual({ ok: true, text: 'Disponible, sauf à Bruxelles et en Wallonie' });
  });
  it('temps réel : la panne dite juste', () => {
    expect(realtimeText('down')).toBe('indisponible, horaires prévus');
    expect(realtimeText('offline')).toBe('pas de réseau');
    expect(realtimeText('ok')).toBe('toutes les 30 secondes');
    expect(realtimeText(undefined)).toBe('toutes les 30 secondes');
    // rien demandé encore : le test du relais fait foi si toutes les sources sont en panne
    const down = { ok: false, time: '', sources: { sncb: { ok: false }, stib: { ok: false }, delijn: { ok: false }, tec: { ok: false } } };
    expect(realtimeText('unknown', down)).toBe('indisponible, horaires prévus');
    expect(realtimeText('ok', down)).toBe('toutes les 30 secondes');
    expect(realtimeText('unknown', { ...down, sources: { ...down.sources, stib: { ok: true } } })).toBe('toutes les 30 secondes');
  });
});
