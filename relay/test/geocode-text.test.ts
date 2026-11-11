/**
 * Adresses : contrôle du texte, casse des libellés, aiguillage par code postal ou commune, table des communes,
 * lecture des noms ICAR.
 */
import { describe, expect, it } from 'vitest';
import { communeAtEnd, communeCount, regionOfPostcode, regionsOfName, routeQuery, splitMunicipalitySuffix } from '../lib/geocode/communes.js';
import { parseWalName } from '../lib/geocode/sources.js';
import {
  BAD_LANG, BAD_Q, CTRL_Q, LONG_Q, cleanLang, cleanMunicipality, cleanName, cleanNumber, cleanQuery, normalizeText, properCase, tokens,
} from '../lib/geocode/text.js';

describe('contrôle de q et lang', () => {
  it('espaces resserrés, 3 à 100 caractères, caractères de contrôle refusés', () => {
    expect(cleanQuery('  rue   de fer  25 ')).toEqual({ q: 'rue de fer 25' });
    expect(cleanQuery(null)).toEqual({ error: BAD_Q });
    expect(cleanQuery(' ab ')).toEqual({ error: BAD_Q });
    expect(cleanQuery('abc')).toEqual({ q: 'abc' });
    expect(cleanQuery('é'.repeat(100))).toEqual({ q: 'é'.repeat(100) });
    expect(cleanQuery('x'.repeat(101))).toEqual({ error: LONG_Q });
    expect(cleanQuery('rue\tde fer')).toEqual({ error: CTRL_Q });
    expect(cleanQuery('rue\u0000de fer')).toEqual({ error: CTRL_Q });
    expect(BAD_Q).toBe('Paramètre q manquant ou trop court : 3 caractères au moins.');
    expect(BAD_LANG).toBe('Paramètre lang invalide : fr ou nl.');
  });

  it('lang : fr par défaut, fr ou nl seulement', () => {
    expect(cleanLang(null)).toBe('fr');
    expect(cleanLang('NL')).toBe('nl');
    expect(cleanLang('de')).toBeNull();
  });
});

describe('normalisation et casse', () => {
  it('jetons sans accents ni ponctuation, abréviations et Saint/Sint/St unifiés', () => {
    expect(normalizeText('Chaussée d’Ixelles, 1050')).toBe('chaussee d ixelles 1050');
    expect(tokens('Av. Saint-Gilles')).toEqual(['avenue', 'st', 'gilles']);
    expect(tokens('Sint-Gillis bd Anspach')).toEqual(['st', 'gillis', 'boulevard', 'anspach']);
    expect(tokens('Hauptstraße 3')).toEqual(['hauptstrasse', '3']);
  });

  it('casse corrigée seulement pour un nom tout en capitales ou tout en minuscules', () => {
    expect(properCase('RUE DE L’EGLISE')).toBe('Rue de l’Eglise');
    expect(properCase('chapelle-lez-herlaimont')).toBe('Chapelle-lez-Herlaimont');
    expect(properCase('SAINT-JOSSE-TEN-NOODE')).toBe('Saint-Josse-ten-Noode');
    expect(properCase('BOULEVARD LEOPOLD III')).toBe('Boulevard Leopold III');
    expect(properCase('DE PANNE')).toBe('De Panne');
    expect(properCase('Vieux chemin de Namur')).toBe('Vieux chemin de Namur');
    expect(properCase('rue de Fer')).toBe('Rue de Fer');
    expect(cleanName('RUE NEUVE')).toBe('Rue Neuve');
  });

  it('commune sans le préfixe en capitales ni soulignés ; numéro avec lettre en capitale', () => {
    expect(cleanMunicipality('NAMUR Jambes')).toBe('Jambes');
    expect(cleanMunicipality('BRUXELLES')).toBe('Bruxelles');
    expect(cleanMunicipality('Liège_')).toBe('Liège');
    expect(cleanMunicipality('La Louvière')).toBe('La Louvière');
    expect(cleanMunicipality('')).toBeUndefined();
    expect(cleanNumber('25 a')).toBe('25A');
    expect(cleanNumber(12)).toBe('12');
    expect(cleanNumber(null)).toBeUndefined();
  });
});

describe('table des communes (listes officielles)', () => {
  it('communes officielles des trois Régions (19, 261, 285) avec formes usuelles', () => {
    expect(communeCount('bru')).toBeGreaterThanOrEqual(19 * 2);
    expect(communeCount('wal')).toBeGreaterThanOrEqual(261);
    expect(communeCount('vla')).toBeGreaterThanOrEqual(285);
    expect(regionsOfName('Ottignies-Louvain-la-Neuve')).toEqual(['wal']);
    expect(regionsOfName('Beveren-Kruibeke-Zwijndrecht')).toEqual(['vla']);
    expect(regionsOfName('Sint-Joost-ten-Node')).toEqual(['bru']);
    expect(regionsOfName('Sankt Vith')).toEqual(['wal']);
    expect(regionsOfName('Gand')).toEqual(['vla']);
    expect(regionsOfName('Namen')).toEqual(['wal']);
    expect(regionsOfName('Paris')).toBeNull();
  });

  it('noms présents dans deux Régions : les deux', () => {
    expect(regionsOfName('Berchem')?.sort()).toEqual(['bru', 'vla']);
    expect(regionsOfName('Saint-Nicolas')?.sort()).toEqual(['vla', 'wal']);
  });

  it('région d’un code postal', () => {
    expect([1000, 1299, 1300, 1499, 1500, 3999, 4000, 7999, 8000, 9999].map(regionOfPostcode))
      .toEqual(['bru', 'bru', 'wal', 'wal', 'vla', 'vla', 'wal', 'wal', 'vla', 'vla']);
    expect(regionOfPostcode('0999')).toBeNull();
    expect(regionOfPostcode('abc')).toBeNull();
  });
});

describe('aiguillage', () => {
  const route = (q: string) => routeQuery(tokens(q));

  it('code postal suivi d’un mot', () => {
    expect(route('rue de fer 25 5000 namur')).toEqual({ regions: ['wal'], postcode: '5000', by: 'code postal et commune' });
    expect(route('veldstraat 1 9000')).toEqual({ regions: null, by: 'aucun' });
    expect(route('nieuwstraat 1000 brussel').regions).toEqual(['bru']);
    expect(route('1410 waterloo').regions).toEqual(['wal']);
    expect(route('kerkstraat 2 1500 x').regions).toEqual(['vla']);
  });

  it('commune en fin de texte, pas après un petit mot (nom de rue)', () => {
    expect(route('rue de fer 25 namur')).toEqual({ regions: ['wal'], by: 'commune' });
    expect(route('veldstraat 1 gent').regions).toEqual(['vla']);
    expect(route('rue neuve 1 bruxelles').regions).toEqual(['bru']);
    expect(route('chaussée de bruxelles 1 waterloo').regions).toEqual(['wal']);
    expect(route('chaussée de bruxelles 1').regions).toBeNull();
    expect(route('steenweg op brussel').regions).toBeNull();
    expect(route('rue de namur').regions).toBeNull();
    expect(route('avenue louise 54 st gilles').regions).toEqual(['bru']);
    expect(route('kerkstraat 3 sint-gillis-waas').regions).toEqual(['vla']);
    expect(route('place des sciences louvain-la-neuve').regions).toEqual(['wal']);
    expect(route('rue neuve').regions).toBeNull();
  });

  it('code postal et commune de Régions différentes : les deux Régions', () => {
    expect(route('steenweg op brussel 1234 halle')).toEqual({ regions: ['bru', 'vla'], postcode: '1234', by: 'code postal et commune' });
  });

  it('commune au bout d’un nom de rue sans code postal (noms ICAR de niveau 3)', () => {
    expect(splitMunicipalitySuffix('Rue Yolande de Namur Namur')).toEqual({ street: 'Rue Yolande de Namur', municipality: 'Namur' });
    expect(splitMunicipalitySuffix('Rue de La Louvière La Louvière')).toEqual({ street: 'Rue de La Louvière', municipality: 'La Louvière' });
    expect(splitMunicipalitySuffix('Grand-Rue')).toBeNull();
    expect(communeAtEnd(tokens('gare de namur'))).toBeNull();
  });
});

describe('noms ICAR (service wallon)', () => {
  it('lit chaque niveau, y compris les variantes relevées en direct', () => {
    expect(parseWalName(4, 'Rue de Fer 25 5000 Namur')).toEqual({ street: 'Rue de Fer', number: '25', postcode: '5000', municipality: 'Namur' });
    expect(parseWalName(4, '25 Rue du Fer 4020 Liège_')).toEqual({ street: 'Rue du Fer', number: '25', postcode: '4020', municipality: 'Liège' });
    expect(parseWalName(4, 'Rue du Chemin de Fer 25 7160 Chapelle-lez-Herlaimont'))
      .toEqual({ street: 'Rue du Chemin de Fer', number: '25', postcode: '7160', municipality: 'Chapelle-lez-Herlaimont' });
    expect(parseWalName(4, 'Rue X 12 bte 3 5000 Namur')).toEqual({ street: 'Rue X', number: '12', postcode: '5000', municipality: 'Namur' });
    expect(parseWalName(4, 'Rue du 11 Novembre 5 5000 Namur')).toEqual({ street: 'Rue du 11 Novembre', number: '5', postcode: '5000', municipality: 'Namur' });
    expect(parseWalName(3, 'Rue de la Gare 5030 Gembloux')).toEqual({ street: 'Rue de la Gare', postcode: '5030', municipality: 'Gembloux' });
    expect(parseWalName(3, 'Place du Château de Namur Namur')).toEqual({ street: 'Place du Château de Namur', municipality: 'Namur' });
    expect(parseWalName(2, '5000 Namur')).toEqual({ postcode: '5000', municipality: 'Namur' });
    expect(parseWalName(1, 'Namur')).toEqual({ municipality: 'Namur' });
    expect(parseWalName(7, 'Gare de Gembloux')).toEqual({ place: 'Gare de Gembloux' });
  });
});
