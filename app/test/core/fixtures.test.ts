/**
 * Les fixtures du cœur (app/test/fixtures/core/) sont générées depuis fixtures/network.json.
 * Régénérer : QUAI_WRITE_FIXTURES=1 npx vitest run test/core/fixtures.test.ts
 * Sinon ce test vérifie qu'elles sont à jour et conformes aux contrats.
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AreaFile, Meta, TileFile } from '../../../shared/types';
import { buildDataFiles, buildRelayFixtures, relayFiles } from './support/gen-fixtures';
import { CORE_DATA_DIR, CORE_RELAY_DIR, loadNetwork, readJson } from './support/network';

const write = process.env.QUAI_WRITE_FIXTURES === '1';

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
}

function writeAll(dir: string, files: Record<string, unknown>, pretty: boolean): void {
  rmSync(dir, { recursive: true, force: true });
  for (const [path, body] of Object.entries(files)) {
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(body, null, pretty ? 2 : undefined) + (pretty ? '\n' : ''));
  }
}

describe('fixtures du cœur', () => {
  const net = loadNetwork();
  const data = buildDataFiles(net);
  const relay = relayFiles(buildRelayFixtures(net));

  if (write) {
    it('régénère les fichiers', () => {
      writeAll(CORE_DATA_DIR, data, false);
      writeAll(CORE_RELAY_DIR, relay, true);
      expect(listFiles(CORE_DATA_DIR).length).toBe(Object.keys(data).length);
    });
    return;
  }

  it('sont à jour par rapport à fixtures/network.json', () => {
    expect(listFiles(CORE_DATA_DIR)).toEqual(Object.keys(data).sort());
    for (const [path, body] of Object.entries(data)) expect(readJson(join(CORE_DATA_DIR, path)), path).toEqual(body);
    for (const [path, body] of Object.entries(relay)) expect(readJson(join(CORE_RELAY_DIR, path)), path).toEqual(body);
  });

  it('respectent les identifiants de zone attendus (fixtures/README.md)', () => {
    for (const id of ['sncb:8812005', 'stib:6357F', 'stib:6359', 'delijn:308611', 'delijn:200553', 'delijn:200101', 'tec:N508aga']) {
      const [op, key] = id.split(':');
      const f = readJson<AreaFile>(join(CORE_DATA_DIR, 'areas', op, `${key}.json`));
      expect(f.id).toBe(id);
    }
    const meta = readJson<Meta>(join(CORE_DATA_DIR, 'meta.json'));
    expect(meta.serviceDates).toEqual(['2026-11-10', '2026-11-11']);
    const tiles = listFiles(join(CORE_DATA_DIR, 'tiles')).map((f) => readJson<TileFile>(join(CORE_DATA_DIR, 'tiles', f)));
    const all = tiles.flatMap((t) => t.areas);
    expect(all.find((a) => a.id === 'stib:6357F')?.n).toEqual({ fr: 'Gare du Nord', nl: 'Noordstation' });
    expect(all.find((a) => a.id === 'delijn:200101')?.n.fr).toBe('Korenmarkt, Gand');
    expect(all.find((a) => a.id === 'delijn:308611')?.n.fr).toBe('Bruxelles-Nord');
  });
});
