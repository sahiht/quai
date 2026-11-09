import { describe, expect, it } from 'vitest';
import { compareLines, modeOf, modesFromMask, MODE_BIT } from '../src/modes.ts';
import { searchKey, searchWords } from '../../shared/names.ts';
import { normalizeId, tileKey } from '../../shared/types.ts';
import { staticTargets, parseSourcesEnv, loadConfig, ConfigError } from '../src/config.ts';

describe('route_type -> mode', () => {
  it('types de base et étendus', () => {
    expect(modeOf(0)).toBe('tram');
    expect(modeOf(1)).toBe('metro');
    expect(modeOf(2)).toBe('train');
    expect(modeOf(3)).toBe('bus');
    for (const t of [100, 102, 109, 117]) expect(modeOf(t)).toBe('train');
    for (const t of [400, 401, 405]) expect(modeOf(t)).toBe('metro');
    for (const t of [700, 704, 716]) expect(modeOf(t)).toBe('bus');
    for (const t of [900, 906]) expect(modeOf(t)).toBe('tram');
  });

  it('hors liste : rapprochements, bus par défaut', () => {
    expect(modeOf(5)).toBe('tram');
    expect(modeOf(11)).toBe('bus');
    expect(modeOf(12)).toBe('metro');
    expect(modeOf(200)).toBe('bus');
    expect(modeOf(800)).toBe('bus');
    expect(modeOf(4)).toBe('bus');
    expect(modeOf(NaN)).toBe('bus');
    expect(modeOf(118)).toBe('bus');
  });

  it('masque de modes dans l’ordre train, métro, tram, bus', () => {
    expect(modesFromMask(MODE_BIT.bus | MODE_BIT.metro | MODE_BIT.tram)).toEqual(['metro', 'tram', 'bus']);
  });

  it('tri naturel des lignes', () => {
    expect(['10', 'S1', '2', 'IC', 'S10', '1'].sort(compareLines)).toEqual(['1', '2', '10', 'IC', 'S1', 'S10']);
  });
});

describe('clés de tuile, de recherche, identifiants', () => {
  it('tuiles : floor(lat / 0,02)_floor(lon / 0,03)', () => {
    expect(tileKey(50.86, 4.359)).toBe('2543_145');
    expect(tileKey(50.86004, 4.36017)).toBe('2543_145');
    expect(tileKey(50.8569, 4.35888)).toBe('2542_145'); // Rogier : tuile voisine au sud
    expect(tileKey(50.4655, 4.859)).toBe('2523_161');
  });

  it('recherche : mots normalisés, clé = deux premiers caractères', () => {
    expect(searchWords('Korenmarkt, Gand', 'Gent Korenmarkt')).toEqual(['korenmarkt', 'gand', 'gent']);
    expect(searchWords('Gare du Nord', 'Noordstation')).toEqual(['gare', 'nord', 'noordstation']);
    expect(searchKey('gand')).toBe('ga');
    expect(searchKey('Église')).toBe('eg');
  });

  it('identifiants préfixés du portail', () => {
    expect(normalizeId('gt:tec:123')).toBe('123');
    expect(normalizeId('gs:nmbssncb:8812005')).toBe('8812005');
    expect(normalizeId('88____:007::8863008:8814001:10:852:20261231')).toBe('88____:007::8863008:8814001:10:852:20261231');
  });
});

describe('configuration', () => {
  const env = (e: Record<string, string>) => ({ ...e }) as NodeJS.ProcessEnv;

  it('adresses du portail et replis', () => {
    expect(staticTargets('sncb', 'https://bmc.example/')).toEqual([
      { url: 'https://bmc.example/api/gtfs/feed/nmbssncb/static', withKey: true, label: 'SNCB, portail BMC' },
    ]);
    expect(staticTargets('stib', 'https://bmc.example')[0].url).toBe('https://bmc.example/api/gtfs/feed/stibmivb/static');
    const dl = staticTargets('delijn', 'https://bmc.example');
    expect(dl[1]).toEqual({ url: 'https://opendata-discovery-gtfs-static.api.production.belgianmobility.io/api/gtfs/feed/delijn/static', withKey: true, label: 'De Lijn, repli BMC' });
    const tec = staticTargets('tec', 'https://bmc.example');
    expect(tec[1]).toEqual({ url: 'https://opendata.tec-wl.be/Current%20GTFS/TEC-GTFS.zip', withKey: false, label: 'TEC, repli opendata.tec-wl.be' });
  });

  it('replis remplaçables pour les tests (QUAI_DELIJN_FALLBACK, QUAI_TEC_FALLBACK), libellés inchangés', () => {
    const saved = { d: process.env.QUAI_DELIJN_FALLBACK, t: process.env.QUAI_TEC_FALLBACK };
    try {
      process.env.QUAI_DELIJN_FALLBACK = 'http://localhost:1/__repli/delijn.zip';
      process.env.QUAI_TEC_FALLBACK = ' http://localhost:1/__repli/tec.zip ';
      expect(staticTargets('delijn', 'https://bmc.example')[1]).toEqual({ url: 'http://localhost:1/__repli/delijn.zip', withKey: true, label: 'De Lijn, repli BMC' });
      expect(staticTargets('tec', 'https://bmc.example')[1]).toEqual({ url: 'http://localhost:1/__repli/tec.zip', withKey: false, label: 'TEC, repli opendata.tec-wl.be' });
      process.env.QUAI_TEC_FALLBACK = '';
      expect(staticTargets('tec', 'https://bmc.example')[1].url).toBe('https://opendata.tec-wl.be/Current%20GTFS/TEC-GTFS.zip');
    } finally {
      if (saved.d === undefined) delete process.env.QUAI_DELIJN_FALLBACK; else process.env.QUAI_DELIJN_FALLBACK = saved.d;
      if (saved.t === undefined) delete process.env.QUAI_TEC_FALLBACK; else process.env.QUAI_TEC_FALLBACK = saved.t;
    }
  });

  it('QUAI_SOURCES : chemins relatifs au dossier d’appel, entrée invalide refusée', () => {
    expect(parseSourcesEnv('sncb=a.zip, stib=/x/b.zip', '/base')).toEqual({ sncb: '/base/a.zip', stib: '/x/b.zip' });
    expect(() => parseSourcesEnv('bus=a.zip', '/base')).toThrow(ConfigError);
    expect(() => parseSourcesEnv('sncb=', '/base')).toThrow(ConfigError);
  });

  it('BMC_KEY obligatoire sans QUAI_SOURCES ; opérateur absent de QUAI_SOURCES = ignoré', () => {
    expect(() => loadConfig(['--out', 'x'], env({}))).toThrow(/BMC_KEY/);
    const c = loadConfig(['--out', 'x'], env({ QUAI_SOURCES: 'stib=s.zip', INIT_CWD: '/w', QUAI_DATE: '2026-11-10' }));
    expect(c.dates).toEqual(['2026-11-10', '2026-11-11']);
    expect(c.out).toBe('/w/x');
    expect(c.sources.stib).toEqual({ kind: 'file', path: '/w/s.zip' });
    expect(c.sources.sncb.kind).toBe('missing');
    const d = loadConfig(['--out', 'x', '--site', 's'], env({ BMC_KEY: 'k', INIT_CWD: '/w' }), new Date('2026-11-09T23:30:00Z'));
    expect(d.dates).toEqual(['2026-11-10', '2026-11-11']);
    expect(d.site).toBe('/w/s');
    expect(d.sources.tec.kind).toBe('download');
  });

  it('erreurs de configuration en français', () => {
    expect(() => loadConfig([], env({ BMC_KEY: 'k' }))).toThrow(/--out/);
    expect(() => loadConfig(['--out', 'x'], env({ BMC_KEY: 'k', QUAI_DATE: '10/11/2026' }))).toThrow(/QUAI_DATE invalide/);
    expect(() => loadConfig(['--out', 'x'], env({ BMC_KEY: 'k', BMC_BASE: 'ftp://x' }))).toThrow(/BMC_BASE invalide/);
    expect(() => loadConfig(['--out', 'x', '--bad'], env({ BMC_KEY: 'k' }))).toThrow(/arguments invalides/);
  });
});
