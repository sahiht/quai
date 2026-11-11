/**
 * Recherche 1.1 (PRD M4.2, S5 ; review-tech M7, m7) : noms usuels, « St / Sint / Saint », « gare » facultatif,
 * mot exact avant début de mot, métro avant tram avant bus, opérateur local, homonymes.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SearchFile } from '../../../shared/types';
import { communeOf, queryVariants, rankSearch, searchFileKeys } from '../../src/core/search';
import { makeEnv } from './support/env';
import { CORE_DATA_DIR, exists, readJson } from './support/network';

type It = SearchFile['items'][number];
const I = (id: string, fr: string, nl: string, modes: It['modes'], lat: number, lon: number): It => ({ id, op: id.split(':')[0] as It['op'], n: { fr, nl }, modes, lat, lon });

describe('variantes de requête', () => {
  it('noms usuels, St / Sint / Saint, « gare » facultatif', () => {
    expect(queryVariants('gare du Midi')).toEqual(['gare du midi', 'bruxelles midi', 'midi']);
    expect(queryVariants('Gare du Nord')).toContain('bruxelles nord');
    expect(queryVariants('gare centrale')).toContain('bruxelles central');
    for (const q of ['aéroport', 'aeroport', 'Luchthaven']) expect(queryVariants(q)).toContain('brussels airport');
    expect(queryVariants('LLN')).toEqual(['lln', 'louvain la neuve']);
    expect(queryVariants('st gilles')).toEqual(['st gilles', 'saint gilles', 'sint gilles']);
    expect(queryVariants('station Namur')).toEqual(['station namur', 'namur']);
    expect(queryVariants('')).toEqual([]);
    expect(searchFileKeys('gare du midi')).toEqual(['ga', 'br', 'mi']);
  });

  it('commune d’un arrêt d’après son nom (homonymes, S5)', () => {
    expect(communeOf({ op: 'delijn', n: { fr: 'Korenmarkt, Gand', nl: 'Gent Korenmarkt' } })).toBe('Gand');
    expect(communeOf({ op: 'tec', n: { fr: 'Charleroi Waterloo (M)', nl: 'Charleroi Waterloo (M)' } })).toBe('Charleroi');
    expect(communeOf({ op: 'stib', n: { fr: 'Rogier', nl: 'Rogier' } })).toBe('Bruxelles');
    expect(communeOf({ op: 'tec', n: { fr: 'Eglise', nl: 'Eglise' } })).toBeUndefined();
  });
});

describe('classement (fixtures)', () => {
  it('CA-M4.2 « namur » : la gare SNCB d’abord, puis les arrêts', async () => {
    const { core } = makeEnv({ now: '2026-11-10T07:31' });
    const r = await core.search('namur', { lat: 50.4655, lon: 4.859 });
    expect(r[0]).toMatchObject({ id: 'sncb:8863008', kindLabel: 'gare SNCB' });
    expect(r.slice(1).every((x) => x.op !== 'sncb')).toBe(true);
  });

  it('CA-M4.3 « gand » : Gand-Saint-Pierre et Gand-Dampoort (gares SNCB) d’abord', async () => {
    const { core } = makeEnv({ now: '2026-11-10T13:55' });
    const r = await core.search('gand', { lat: 50.8454, lon: 4.3571 });
    expect(r.slice(0, 2).map((x) => x.id)).toEqual(['sncb:8892007', 'sncb:8893120']);
    expect(r.slice(2).every((x) => x.op !== 'sncb')).toBe(true);
  });

  it('« gare du Midi », « gare du Nord », « gare Centrale » : la gare SNCB en tête', async () => {
    const { core } = makeEnv({ now: '2026-11-10T12:10' });
    expect((await core.search('gare du midi'))[0].id).toBe('sncb:8814001');
    expect((await core.search('gare du midi')).map((x) => x.id)).toContain('stib:6364');
    expect((await core.search('gare du nord'))[0].id).toBe('sncb:8812005');
    expect((await core.search('gare centrale'))[0].id).toBe('sncb:8813003');
    expect((await core.search('station gand saint pierre'))[0].id).toBe('sncb:8892007');
    expect((await core.search('gent sint pieters'))[0].id).toBe('sncb:8892007');
    expect((await core.search('gand st pierre'))[0].id).toBe('sncb:8892007');
  });

  it('aéroport, LLN, mot exact, mode, opérateur local, homonymes (fichiers de recherche ajoutés)', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    const add = (key: string, items: It[]) => {
      const path = join(CORE_DATA_DIR, 'search', `${key}.json`);
      const f = exists(path) ? readJson<SearchFile>(path) : null;
      env.server.memFiles.set(`search/${key}.json`, JSON.stringify({ v: 1, items: [...(f?.items ?? []), ...items] }));
    };
    add('br', [I('sncb:8819406', 'Brussels Airport', 'Brussels Airport - Zaventem', ['train'], 50.8988, 4.4826)]);
    add('lo', [I('sncb:8811676', 'Louvain-la-Neuve', 'Louvain-la-Neuve', ['train'], 50.6694, 4.6155), I('tec:Blngare', 'Louvain-la-Neuve Gare', 'Louvain-la-Neuve Gare', ['bus'], 50.6697, 4.6150)]);
    add('ro', [I('delijn:307000', 'Rogier, Bruxelles', 'Brussel Rogier', ['bus'], 50.8566, 4.3588)]);
    add('wa', [I('tec:Cwater1', 'Charleroi Waterloo (M)', 'Charleroi Waterloo (M)', ['metro'], 50.405, 4.4475), I('tec:Cwater2', 'Waterloo (M)', 'Waterloo (M)', ['metro'], 50.41, 4.45), I('tec:Hwater2', 'Waterloo (M)', 'Waterloo (M)', ['metro'], 50.5, 4.0)]);
    expect((await env.core.search('aéroport'))[0]).toMatchObject({ id: 'sncb:8819406', kindLabel: 'gare SNCB' });
    expect((await env.core.search('luchthaven'))[0].id).toBe('sncb:8819406');
    expect((await env.core.search('lln')).map((x) => x.id)).toEqual(['sncb:8811676', 'tec:Blngare']);
    // CA-M4.11 « rogier » : le métro STIB avant le bus De Lijn
    const rogier = await env.core.search('rogier');
    expect(rogier.map((x) => x.id)).toEqual(['stib:6359', 'delijn:307000']);
    // mot exact avant début de mot : « waterloo » (gare) avant… et homonymes « métro TEC, … »
    const w = await env.core.search('waterloo');
    expect(w[0]).toMatchObject({ id: 'sncb:8814266', kindLabel: 'gare SNCB' });
    const homonyms = w.filter((x) => x.n.fr === 'Waterloo (M)');
    expect(homonyms).toHaveLength(2);
    expect(homonyms.map((x) => x.kindLabel)).toEqual(['métro TEC', 'métro TEC']); // commune absente du nom : rien à ajouter
    expect(w.find((x) => x.id === 'tec:Cwater1')?.kindLabel).toBe('métro TEC');
  });

  it('homonymes : la commune est ajoutée au type quand le nom la donne', () => {
    const f: SearchFile = {
      v: 1,
      items: [I('delijn:1', 'Kerk, Gand', 'Gent Kerk', ['bus'], 51.05, 3.72), I('delijn:2', 'Kerk, Gand', 'Gent Kerk', ['bus'], 51.06, 3.73), I('delijn:3', 'Kerk, Malines', 'Mechelen Kerk', ['bus'], 51.02, 4.48)],
    };
    const r = rankSearch(f, 'kerk gand');
    expect(r.map((x) => x.kindLabel)).toEqual(['bus De Lijn, Gand', 'bus De Lijn, Gand']);
    expect(rankSearch(f, 'kerk').find((x) => x.id === 'delijn:3')?.kindLabel).toBe('bus De Lijn');
  });
});
