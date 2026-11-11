/**
 * Conversions Lambert belge → WGS84 : couples relevés dans les réponses des services officiels eux-mêmes
 * (fixtures/relay/geocode/README.md) et valeurs de proj4 2.22.0 avec la même définition EPSG:31370.
 */
import { describe, expect, it } from 'vitest';
import {
  crsFromName, inBelgium, lambert2008ToWgs84, lambert72ToWgs84, round5, toWgs84, wgs84ToLambert2008, wgs84ToLambert72,
} from '../lib/geocode/lambert.js';

/** Écart en mètres entre deux points proches. */
const meters = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((a.lat - b.lat) * 111_320, (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180));

describe('Lambert 72 (EPSG:31370) → WGS84', () => {
  it('gare de Gembloux : coordonnées de la FAQ du SPW, position rendue par le service wallon en EPSG:4326 (au millimètre)', () => {
    const p = lambert72ToWgs84(172835.01647250125, 139989.62418902014);
    expect(meters(p, { lat: 50.57017565302071, lon: 4.691095148997802 })).toBeLessThan(0.002);
    expect([round5(p.lat), round5(p.lon)]).toEqual([50.57018, 4.6911]);
  });

  it('Veldstraat à Gand : Lambert 72 et WGS84 rendus ensemble par Digitaal Vlaanderen (au centimètre)', () => {
    const pairs: [number, number, number, number][] = [
      [104681.54, 193912.33, 51.053595747924049, 3.7224103390774141],
      [104659.2, 193880.89, 51.053311399836815, 3.7220956365084592],
      [104583.55, 193575.7, 51.050562247761739, 3.7210546824554687],
    ];
    for (const [x, y, lat, lon] of pairs) expect(meters(lambert72ToWgs84(x, y), { lat, lon })).toBeLessThan(0.01);
  });

  it('mêmes valeurs que proj4 (+towgs84=-106.8686,52.2978,-103.7239,0.3366,-0.457,1.8422,-1.2747) aux quatre coins du pays', () => {
    const proj4: [number, number, number, number][] = [
      [177053, 135542, 50.530011285, 4.750313471],
      [255000, 40000, 49.6624111258, 5.8231236994],
      [45000, 210000, 51.1904349244, 2.8667418285],
      [149000, 170000, 50.8404105071, 4.3545547055],
    ];
    for (const [x, y, lat, lon] of proj4) expect(meters(lambert72ToWgs84(x, y), { lat, lon })).toBeLessThan(0.001);
  });

  it('aller-retour WGS84 → Lambert 72 → WGS84 sous le millimètre (faux service d’adresses)', () => {
    for (const [lat, lon] of [[50.8505, 4.3545], [50.4662, 4.8648], [51.0537, 3.7225], [50.003, 5.715]]) {
      const { x, y } = wgs84ToLambert72(lat, lon);
      expect(meters(lambert72ToWgs84(x, y), { lat, lon })).toBeLessThan(0.001);
    }
  });
});

describe('Lambert 2008 (EPSG:3812) → WGS84', () => {
  it('Veldstraat 1 à Gand : couple rendu par Digitaal Vlaanderen', () => {
    expect(meters(lambert2008ToWgs84(604678.74, 693907.15), { lat: 51.053595747924049, lon: 3.7224103390774141 })).toBeLessThan(0.01);
    const { x, y } = wgs84ToLambert2008(51.053595747924049, 3.7224103390774141);
    expect(Math.hypot(x - 604678.74, y - 693907.15)).toBeLessThan(0.01);
  });
});

describe('système de coordonnées', () => {
  it('reconnaît les noms usuels', () => {
    expect(crsFromName('EPSG:31370')).toBe('EPSG:31370');
    expect(crsFromName('urn:ogc:def:crs:EPSG::31370')).toBe('EPSG:31370');
    expect(crsFromName('http://www.opengis.net/def/crs/EPSG/0/3812')).toBe('EPSG:3812');
    expect(crsFromName('EPSG:4326')).toBe('EPSG:4326');
    expect(crsFromName('urn:ogc:def:crs:OGC:1.3:CRS84')).toBe('EPSG:4326');
    expect(crsFromName(undefined)).toBeNull();
  });

  it('devine le système à l’ordre de grandeur, respecte l’ordre GeoJSON [lon, lat] et refuse un point hors de Belgique', () => {
    expect(toWgs84(4.865011263015592, 50.46540393341745, 'EPSG:4326')).toEqual({ lat: 50.46540393341745, lon: 4.865011263015592 });
    expect(toWgs84(50.4654, 4.8650, null)).toEqual({ lat: 50.4654, lon: 4.865 });
    expect(round5(toWgs84(172835.01647250125, 139989.62418902014, null)!.lat)).toBe(50.57018);
    expect(round5(toWgs84(604678.74, 693907.15, null)!.lat)).toBe(51.0536);
    expect(toWgs84(2.35, 48.85, 'EPSG:4326')).toBeNull();
    expect(toWgs84(Number.NaN, 1, null)).toBeNull();
    expect(inBelgium({ lat: 50.85, lon: 4.35 })).toBe(true);
  });
});
