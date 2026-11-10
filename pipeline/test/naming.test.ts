import { describe, expect, it } from 'vitest';
import { Translations, langOf, platformOf, resolveNames, rtIdOf, splitPlatform } from '../src/naming.ts';
import { runFeed, miniFeed, cleanupTempDirs } from './helpers.ts';
import { afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AreaFile } from '../../shared/types.ts';
import { prettyName } from '../../shared/names.ts';

afterAll(cleanupTempDirs);

describe('translations', () => {
  it('codes de langue', () => {
    expect(langOf('fr')).toBe('fr');
    expect(langOf('NL')).toBe('nl');
    expect(langOf('nl-BE')).toBe('nl');
    expect(langOf('fr_BE')).toBe('fr');
    expect(langOf('de')).toBeNull();
    expect(langOf('')).toBeNull();
  });

  it('format récent : record_id prioritaire sur field_value, puis ancien format, fusion par langue', () => {
    const t = new Translations();
    t.addValue('stops', 'stop_name', 'GARE DU NORD', 'fr', 'GARE DU NORD');
    t.addValue('stops', 'stop_name', 'GARE DU NORD', 'nl', 'NOORDSTATION (VALEUR)');
    t.addRecord('stops', 'stop_name', '6357F', 'nl', 'NOORDSTATION');
    t.addText('Brugge', 'fr', 'Bruges');
    expect(t.get('stops', 'stop_name', '6357F', 'GARE DU NORD')).toEqual({ fr: 'GARE DU NORD', nl: 'NOORDSTATION' });
    expect(t.get('stops', 'stop_name', '6358', 'GARE DU NORD')).toEqual({ fr: 'GARE DU NORD', nl: 'NOORDSTATION (VALEUR)' });
    expect(t.get('trips', 'trip_headsign', undefined, 'Brugge')).toEqual({ fr: 'Bruges', nl: undefined });
    expect(t.get('stops', 'stop_name', 'x', 'Inconnu')).toBeUndefined();
    expect(t.record('stops', 'stop_name', '6357F')).toEqual({ nl: 'NOORDSTATION' });
  });
});

describe('noms', () => {
  it('SNCB : traductions fr/nl, l = nl quand le nom d’origine est la traduction nl', () => {
    expect(resolveNames('sncb', 'Brussel-Noord/Bruxelles-Nord', { fr: 'Bruxelles-Nord', nl: 'Brussel-Noord' }, true))
      .toEqual({ fr: 'Bruxelles-Nord', nl: 'Brussel-Noord' });
    expect(resolveNames('sncb', 'Gent-Sint-Pieters', { fr: 'Gand-Saint-Pierre', nl: 'Gent-Sint-Pieters' }, true))
      .toEqual({ fr: 'Gand-Saint-Pierre', nl: 'Gent-Sint-Pieters', l: 'nl' });
    expect(resolveNames('sncb', 'Namur', { fr: 'Namur', nl: 'Namen' }, true)).toEqual({ fr: 'Namur', nl: 'Namen' });
  });

  it('STIB : noms en majuscules remis en forme (prettyName), traductions comprises', () => {
    expect(resolveNames('stib', 'GARE DU NORD', { fr: 'GARE DU NORD', nl: 'NOORDSTATION' }, true)).toEqual({ fr: 'Gare du Nord', nl: 'Noordstation' });
    expect(resolveNames('stib', 'STALLE (P)', { fr: 'STALLE (P)', nl: 'STALLE (P)' }, false)).toEqual({ fr: 'Stalle (P)', nl: 'Stalle (P)' });
    expect(resolveNames('stib', 'DE BROUCKERE', undefined, true)).toEqual({ fr: 'De Brouckere', nl: 'De Brouckere' });
  });

  it('STIB : les sigles restent en majuscules (mots sans voyelle, liste courte), pas les abréviations', () => {
    expect(resolveNames('stib', 'WTC', undefined, true)).toEqual({ fr: 'WTC', nl: 'WTC' });
    expect(resolveNames('stib', 'UZ-VUB', { fr: 'UZ-VUB', nl: 'UZ-VUB' }, true)).toEqual({ fr: 'UZ-VUB', nl: 'UZ-VUB' });
    expect(prettyName('CPAS DE SCHAERBEEK')).toBe('CPAS de Schaerbeek');
    expect(prettyName('OCMW SCHAARBEEK')).toBe('OCMW Schaarbeek');
    expect(prettyName('CHU BRUGMANN')).toBe('CHU Brugmann');
    expect(prettyName('RTBF-VRT')).toBe('RTBF-VRT');
    expect(prettyName('PLACE DE L’ULB')).toBe('Place de l’ULB');
    expect(prettyName('OTAN')).toBe('OTAN');
    // abréviations et mots ordinaires : casse normale
    expect(prettyName('ST-GUIDON')).toBe('St-Guidon');
    expect(prettyName('BD DU MIDI')).toBe('Bd du Midi');
    expect(prettyName('MGR. LADEUZE')).toBe('Mgr. Ladeuze');
    expect(prettyName('LÉOPOLD II')).toBe('Léopold II');
    expect(prettyName('STALLE (P)')).toBe('Stalle (P)');
    expect(prettyName('TRONE')).toBe('Trone');
    // casse mixte : inchangé
    expect(prettyName('Wtc')).toBe('Wtc');
  });

  it('De Lijn : nl = nom d’origine sans « perron N », fr = frName(nl), l = nl', () => {
    expect(resolveNames('delijn', 'Brussel Noordstation perron 4', undefined, true)).toEqual({ fr: 'Bruxelles-Nord', nl: 'Brussel Noordstation', l: 'nl' });
    expect(resolveNames('delijn', 'Gent Korenmarkt perron 1', undefined, true)).toEqual({ fr: 'Korenmarkt, Gand', nl: 'Gent Korenmarkt', l: 'nl' });
    expect(resolveNames('delijn', 'Gent Sint-Pietersstation perron 3', undefined, true)).toEqual({ fr: 'Gand-Saint-Pierre', nl: 'Gent Sint-Pietersstation', l: 'nl' });
    expect(resolveNames('delijn', 'Vilvoorde', undefined, false)).toEqual({ fr: 'Vilvorde', nl: 'Vilvoorde', l: 'nl' });
  });

  it('TEC : fr = nl = nom d’origine sans « quai X »', () => {
    expect(resolveNames('tec', 'Namur Gare quai A', undefined, true)).toEqual({ fr: 'Namur Gare', nl: 'Namur Gare' });
    expect(resolveNames('tec', 'Bouge Église', undefined, true)).toEqual({ fr: 'Bouge Église', nl: 'Bouge Église' });
  });

  it('une traduction partielle complète l’autre langue avec le nom d’origine', () => {
    expect(resolveNames('stib', 'ROGIER', { nl: 'ROGIER' }, true)).toEqual({ fr: 'Rogier', nl: 'Rogier' });
    expect(resolveNames('delijn', 'Brussel Noordstation', { nl: 'Brussel Noordstation' }, true)).toEqual({ fr: 'Bruxelles-Nord', nl: 'Brussel Noordstation', l: 'nl' });
  });
});

describe('quais', () => {
  it('suffixes perron / quai / Quai', () => {
    expect(splitPlatform('Namur Gare quai A')).toEqual({ base: 'Namur Gare', platform: 'A' });
    expect(splitPlatform('Charleroi-Sud Quai 12')).toEqual({ base: 'Charleroi-Sud', platform: '12' });
    expect(splitPlatform('Brussel Noordstation perron 4')).toEqual({ base: 'Brussel Noordstation', platform: '4' });
    expect(splitPlatform('Antwerpen Groenplaats - perron 2A')).toEqual({ base: 'Antwerpen Groenplaats', platform: '2A' });
  });

  it('ne touche pas aux noms de rue', () => {
    expect(splitPlatform('Quai de la Gare')).toEqual({ base: 'Quai de la Gare' });
    expect(splitPlatform('Liège Quai Godefroid')).toEqual({ base: 'Liège Quai Godefroid' });
    expect(splitPlatform('Quai 3')).toEqual({ base: 'Quai 3' });
    expect(splitPlatform('Gent Korenmarkt')).toEqual({ base: 'Gent Korenmarkt' });
  });

  it('platform_code, puis nom, puis (SNCB) suffixe numérique de l’identifiant', () => {
    expect(platformOf('sncb', '8863008_4', 'Namur', '4')).toBe('4');
    expect(platformOf('sncb', '8863008_5', 'Namur', '')).toBe('5');
    expect(platformOf('sncb', '8863008', 'Namur', '')).toBeUndefined();
    expect(platformOf('sncb', '8863008_A', 'Namur', '')).toBeUndefined();
    expect(platformOf('delijn', '308611', 'Brussel Noordstation perron 4', '')).toBe('4');
    expect(platformOf('tec', 'N508aga', 'Namur Gare quai A', '')).toBe('A');
    expect(platformOf('delijn', '123_4', 'Dorp', '')).toBeUndefined();
  });

  it('identifiant temps réel : pointid STIB numérique, stop_id sinon', () => {
    expect(rtIdOf('stib', '6357F')).toBe('6357');
    expect(rtIdOf('stib', '8042')).toBe('8042');
    expect(rtIdOf('stib', 'ABC')).toBe('ABC');
    expect(rtIdOf('sncb', '8863008_4')).toBe('8863008_4');
    expect(rtIdOf('tec', 'N508aga')).toBe('N508aga');
  });
});

describe('noms dans un flux', () => {
  it('translations record_id (arrêts STIB), field_value (destinations), ancien format', async () => {
    const files = miniFeed({
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\n6357F,GARE DU NORD,50.86,4.36\n6364,GARE DU MIDI,50.8358,4.336\n',
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign\nR1,ALL,T1,GARE DU MIDI\nR1,ALL,T2,\n',
      'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,10:00:00,10:00:00,6357F,1\nT1,10:10:00,10:10:00,6364,2\nT2,11:00:00,11:00:00,6364,1\nT2,11:10:00,11:10:00,6357F,2\n',
      'translations.txt': 'table_name,field_name,language,translation,record_id,record_sub_id,field_value\n'
        + 'stops,stop_name,fr,GARE DU NORD,6357F,,\nstops,stop_name,nl,NOORDSTATION,6357F,,\n'
        + 'stops,stop_name,nl,ZUIDSTATION,,,GARE DU MIDI\ntrips,trip_headsign,nl,ZUIDSTATION,,,GARE DU MIDI\n',
    });
    const { out } = await runFeed('stib', files);
    const nord = JSON.parse(readFileSync(join(out, 'areas/stib/6357F.json'), 'utf8')) as AreaFile;
    const midi = JSON.parse(readFileSync(join(out, 'areas/stib/6364.json'), 'utf8')) as AreaFile;
    expect(nord.n).toEqual({ fr: 'Gare du Nord', nl: 'Noordstation' });
    expect(midi.n).toEqual({ fr: 'Gare du Midi', nl: 'Zuidstation' });
    expect(nord.patterns[0].head).toEqual({ fr: 'Gare du Midi', nl: 'Zuidstation' });
    // destination vide : nom du dernier arrêt
    expect(midi.patterns[0].head).toEqual({ fr: 'Gare du Nord', nl: 'Noordstation' });
  });

  it('ancien format trans_id, et destination SNCB égale au nom d’une gare', async () => {
    const files = miniFeed({
      'routes.txt': 'route_id,route_short_name,route_type\nIC,IC,2\n',
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\nS8891009,Brugge,51.1972,3.2167,1,\n8891009,Brugge,51.1972,3.2167,0,S8891009\nS8821006,Antwerpen-Centraal,51.2172,4.4211,1,\n8821006,Antwerpen-Centraal,51.2172,4.4211,0,S8821006\n',
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign,trip_short_name\nIC,ALL,T1,Brugge,1501\n',
      'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,10:00:00,10:00:00,8821006,1\nT1,11:10:00,11:10:00,8891009,2\n',
      'translations.txt': 'trans_id,lang,translation\nBrugge,FR,Bruges\nBrugge,NL,Brugge\nAntwerpen-Centraal,fr,Anvers-Central\n',
    });
    const { out, result } = await runFeed('sncb', files);
    const anvers = JSON.parse(readFileSync(join(out, 'areas/sncb/8821006.json'), 'utf8')) as AreaFile;
    expect(anvers.n).toEqual({ fr: 'Anvers-Central', nl: 'Antwerpen-Centraal' });
    expect(anvers.patterns[0].head).toEqual({ fr: 'Bruges', nl: 'Brugge', l: 'nl' });
    expect(result.trains?.[0].trips[0]).toMatchObject({ id: 'T1', cat: 'IC', num: '1501', head: { fr: 'Bruges', nl: 'Brugge', l: 'nl' } });
  });
});
