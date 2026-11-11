/**
 * Contrôles sur données réelles (PRD annexe A.3, DECISIONS Q13) : à la demande seulement, sur l'instantané publié.
 *   QUAI_REAL_DATA=1 npx vitest run test/core/real-data.test.ts            (instantané /home/claude/real-data/data)
 *   QUAI_REAL_DATA=/chemin/vers/data npx vitest run test/core/real-data.test.ts
 * Relais en échec (horaire prévu partout), comme le banc de la revue technique.
 * CA-M8.3 (une seule zone « Gare du Nord ») demande des données publiées par le pipeline 1.1 (zones fusionnées,
 * `aka`) : sur l'instantané du 10/11/2026 (pipeline 1.0), ce contrôle est sauté.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TileFile } from '../../../shared/types';
import type { FavoriteStop } from '../../src/core/api';
import { departureSummary } from '../../src/core/text';
import { hhmm } from '../../src/core/util';
import { FakeServer, makeEnv } from './support/env';
import { readJson } from './support/network';

const flag = process.env.QUAI_REAL_DATA;
const DIR = flag && flag !== '1' ? flag : '/home/claude/real-data/data';
const enabled = !!flag && existsSync(join(DIR, 'meta.json'));

const real = (now: string) => {
  const server = new FakeServer(DIR);
  return makeEnv({ now, scene: 'noRT', server });
};
/** Données du pipeline 1.1 : au moins une zone fusionnée dans les tuiles de Bruxelles. */
const merged = () =>
  enabled &&
  readdirSync(join(DIR, 'tiles'))
    .filter((f) => /^254[23]_14[45]\.json$/.test(f))
    .some((f) => readJson<TileFile>(join(DIR, 'tiles', f)).areas.some((a) => a.aka?.length));

describe.skipIf(!enabled)('données réelles (annexe A.3)', () => {
  it('CA-M8.2 : départs de Namur le 10/11 à 17:30, l’IC de 17:38 vers Lille Flandres une seule fois', async () => {
    const { core } = real('2026-11-10T17:30');
    const b = await core.board('sncb:8863008', { limit: 12 });
    const ic = b.departures.filter((d) => d.line === 'IC' && hhmm(d.sched) === '17:38' && /lille/i.test(d.head.fr));
    expect(ic).toHaveLength(1);
  });

  it('CA-M4.11 : « gare du midi », « aéroport », « lln », « rogier »', async () => {
    const { core } = real('2026-11-10T12:10');
    expect((await core.search('gare du midi'))[0]).toMatchObject({ id: 'sncb:8814001', kindLabel: 'gare SNCB' });
    expect((await core.search('aéroport'))[0]).toMatchObject({ id: 'sncb:8819406', kindLabel: 'gare SNCB' });
    const lln = await core.search('lln');
    expect(lln.length).toBeGreaterThan(0);
    expect(lln.every((x) => /louvain-la-neuve/i.test(x.n.fr))).toBe(true);
    const rogier = await core.search('rogier');
    const metro = rogier.findIndex((x) => x.op === 'stib' && x.modes.includes('metro'));
    const dl = rogier.findIndex((x) => x.op === 'delijn');
    expect(metro).toBeGreaterThanOrEqual(0);
    if (dl >= 0) expect(metro).toBeLessThan(dl);
  });

  it('CA-S6.2 : stib:7 le 11/11 à 00:20, le métro 5 vers Erasme affiche une heure, jamais « ~298 min »', async () => {
    const { core } = real('2026-11-11T00:20');
    const now = Date.parse('2026-11-11T00:20:00+01:00');
    const b = await core.board('stib:7', { limit: 20 });
    const lines = b.departures.map((d) => departureSummary(d, now, 'fr', true));
    expect(lines.some((l) => /min/.test(l) && Number(/(\d+) min/.exec(l)?.[1] ?? 0) >= 60)).toBe(false);
    const erasme = lines.filter((l) => l.startsWith('M5 Erasme'));
    for (const l of erasme) expect(l).toMatch(/^(M5 Erasme (~?\d{2}:\d{2}|imminent|~?\d{1,2} min))/);
  });

  it('CA-M8.3 (favori) : fav-gdn (stib:6357F, absent des données réelles) retrouvé par nom et position', async () => {
    const { core, preset } = real('2026-11-10T12:10');
    const fav = preset.favorites.find((f) => f.id === 'fav-gdn') as FavoriteStop;
    const a = await core.answer(fav, { lat: 50.86, lon: 4.359 }, preset);
    expect(a.state).not.toBe('missing'); // les départs dépendent du filtre (T3, T4) et des lignes réelles
    expect(a.movedTo).toMatchObject({ op: 'stib', n: { fr: 'Gare du Nord' } });
    // sans filtre : les départs de la zone retrouvée
    const all = await core.answer({ ...fav, filter: undefined }, { lat: 50.86, lon: 4.359 }, preset);
    expect(all.state).toBe('ok');
  });

  it.skipIf(!merged())('CA-M8.3 (zones) : autour de (50.8600, 4.3600), une seule zone « Gare du Nord » STIB', async () => {
    const { core } = real('2026-11-10T12:10');
    const near = await core.nearby(50.86, 4.36, 500, { light: true });
    expect(near.filter((x) => x.area.op === 'stib' && x.area.n.fr === 'Gare du Nord')).toHaveLength(1);
  });
});
