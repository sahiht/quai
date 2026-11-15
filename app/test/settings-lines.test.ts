/**
 * 1.2.10 (PRD-1.2.10 § 6, vérification laissée par la 1.2.9, constat de l'équipe F) : deux lignes du même numéro gardées
 * en 1.2.5 à des arrêts de régions différentes (le W à Waterloo, le W à Tournai) restent deux lignes suivies : à la
 * migration, à chaque relecture des réglages (SettingsStore les relit à chaque changement) et pendant leur complément
 * (variantes trouvées l'une après l'autre). Le même W gardé à deux arrêts de sa région reste une seule ligne (règle
 * 1.2.6). Arrêts publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { LinePick, Settings } from '../src/core/api';
import type { LineFollow } from '../src/core/linerun';
import { createKV, memoryBackend } from '../src/platform/kv';
import { parseSettings, SettingsStore, validateSettings } from '../src/settings';

const pick = (id: string, areaId: string, fr: string, lat: number, lon: number, line: string, extra: Partial<LinePick> = {}): LinePick => ({ id, areaId, op: areaId.slice(0, areaId.indexOf(':')) as LinePick['op'], name: { fr, nl: fr }, lat, lon, line, ...extra });
const WATERLOO = pick('w-wat', 'tec:Bwategl1', 'Waterloo Eglise', 50.7174, 4.3979, 'W');
const BRAINE = pick('w-brl', 'tec:Bbrlgar1', 'Braine-l’Alleud Gare', 50.6833, 4.3745, 'W');
const TOURNAI = pick('w-trn', 'tec:H4ty265a', 'Tournai 7 Fontaines', 50.6056, 3.3889, 'W');
/** Ce que montrent les lignes suivies : numéro et arrêt repère. */
const shown = (s: Settings): string[] => (s.follows ?? []).map((f) => `${f.line} ${f.via?.areaId ?? '-'}`);
/** Réglages de la 1.2.5 : des lignes gardées à un arrêt. */
const v125 = (...lines: LinePick[]): Record<string, unknown> => ({ v: 4, onboarded: true, lines });

describe('lignes gardées en 1.2.5 : deux régions, deux lignes suivies', () => {
  it('le W gardé à Waterloo et à Tournai : deux lignes suivies, chacune avec son arrêt repère', () => {
    const s = validateSettings(v125(WATERLOO, TOURNAI));
    expect(shown(s)).toEqual(['W tec:Bwategl1', 'W tec:H4ty265a']);
    expect(s.follows!.map((f) => f.id)).toEqual(['f-w-wat', 'f-w-trn']);
    expect(s.lines).toEqual([]);
  });

  it('relus encore et encore (le magasin des réglages relit à chaque changement), enregistrés puis rechargés : toujours deux', async () => {
    const once = validateSettings(v125(WATERLOO, TOURNAI));
    expect(shown(validateSettings(once))).toEqual(shown(once));
    expect(validateSettings(validateSettings(once))).toEqual(once);
    expect(shown(parseSettings(JSON.stringify(once)))).toEqual(shown(once));
    const store = new SettingsStore(createKV(memoryBackend()), once);
    await store.update((x) => ({ ...x, display: { ...x.display, radiusM: 800 } }));
    expect(shown(store.get())).toEqual(['W tec:Bwategl1', 'W tec:H4ty265a']);
  });

  it('complétées l’une après l’autre (variantes trouvées près de leur arrêt repère) : jamais fondues', () => {
    const s = validateSettings(v125(WATERLOO, TOURNAI));
    const complete = (x: Settings, id: string, routes: string[]): Settings => validateSettings({ ...x, follows: x.follows!.map((f) => (f.id === id ? { ...f, mode: 'bus', routes } : f)) });
    const one = complete(s, 'f-w-wat', ['tec:B0536-23747']);
    expect(shown(one)).toEqual(['W tec:Bwategl1', 'W tec:H4ty265a']);
    const both = complete(one, 'f-w-trn', ['tec:H4805-22866']);
    expect(shown(both)).toEqual(['W tec:Bwategl1', 'W tec:H4ty265a']);
    expect(both.follows!.map((f) => f.routes)).toEqual([['tec:B0536-23747'], ['tec:H4805-22866']]);
  });

  it('De Lijn : le même numéro dans deux provinces (premier chiffre de l’arrêt) : deux lignes ; dans la même : une', () => {
    const leuven = pick('d-leu', 'delijn:301500', 'Leuven Station', 50.8814, 4.7159, '1');
    const gent = pick('d-gnt', 'delijn:200052', 'Gent Sint-Pieters', 51.0359, 3.7107, '1');
    const leuven2 = pick('d-leu2', 'delijn:304420', 'Leuven Naamsepoort', 50.8723, 4.7046, '1');
    expect(shown(validateSettings(v125(leuven, gent)))).toEqual(['1 delijn:301500', '1 delijn:200052']);
    expect(shown(validateSettings(v125(leuven, leuven2)))).toEqual(['1 delijn:301500']);
  });
});

describe('règles de la 1.2.6 inchangées', () => {
  it('le même W gardé à deux arrêts de sa région : une seule ligne suivie ; « ouvrir d’office » suit son arrêt repère', () => {
    expect(shown(validateSettings(v125(WATERLOO, BRAINE)))).toEqual(['W tec:Bwategl1']);
    expect(validateSettings(v125({ ...WATERLOO, near: true }, BRAINE)).follows![0].near).toBe(true);
    // ouverte d'office à l'autre arrêt seulement : pas à son repère
    expect(validateSettings(v125(WATERLOO, { ...BRAINE, near: true })).follows![0].near).toBeUndefined();
  });

  it('STIB (une seule région) : le tram 3 gardé à deux arrêts reste une ligne', () => {
    const gdn = pick('t-gdn', 'stib:6357F', 'Gare du Nord', 50.86, 4.3602, '3');
    const lemonnier = pick('t-lem', 'stib:6428F', 'Lemonnier', 50.8389, 4.3446, '3');
    expect(shown(validateSettings(v125(gdn, lemonnier)))).toEqual(['3 stib:6357F']);
  });

  it('variantes connues des deux côtés : elles décident, quel que soit l’arrêt repère ; une ligne suivie sans repère rattache la ligne gardée', () => {
    const w = (id: string, routes: string[], via?: LinePick): LineFollow => ({ id, op: 'tec', mode: 'bus', line: 'W', routes, ...(via ? { via: { areaId: via.areaId, name: via.name, lat: via.lat, lon: via.lon } } : {}) });
    // une variante commune : la même ligne, même avec des repères de deux régions
    expect(validateSettings({ v: 4, follows: [w('a', ['tec:B0536-23747'], WATERLOO), w('b', ['tec:B0536-23747', 'tec:H4805-22866'], TOURNAI)] }).follows!.map((f) => f.id)).toEqual(['a']);
    // aucune variante commune : deux lignes
    expect(validateSettings({ v: 4, follows: [w('a', ['tec:B0536-23747'], WATERLOO), w('b', ['tec:H4805-22866'], TOURNAI)] }).follows!.map((f) => f.id)).toEqual(['a', 'b']);
    // une ligne suivie depuis la 1.2.6 (sans repère) et la même gardée à un arrêt en 1.2.5 : une seule
    expect(validateSettings({ v: 4, follows: [w('a', ['tec:B0536-23747'])], lines: [TOURNAI] }).follows!.map((f) => f.id)).toEqual(['a']);
  });
});
