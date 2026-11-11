/**
 * Conversions Lambert belge vers WGS84 (et retour, pour le faux service d'adresses), sans dépendance.
 *
 * Mêmes formules que proj4 (MIT) avec les définitions publiées pour :
 *  - EPSG:31370, Belge 1972 / Lambert belge 72 : conique conforme de Lambert à deux parallèles sur l'ellipsoïde
 *    international 1924, puis changement de datum BD72 vers WGS84 par transformation de Helmert à 7 paramètres
 *    (convention « position vector », comme +towgs84 de proj4) :
 *    +towgs84=-106.8686,52.2978,-103.7239,0.3366,-0.457,1.8422,-1.2747 ;
 *  - EPSG:3812, ETRS89 / Lambert belge 2008 : conique conforme sur GRS80, ETRS89 confondu avec WGS84 (moins de 1 m).
 *
 * Contrôle (test/lambert.test.ts) : les couples Lambert 72 / WGS84 rendus par les services officiels eux-mêmes
 * (SPW : gare de Gembloux ; Digitaal Vlaanderen : Veldstraat à Gand) sont retrouvés au centimètre près.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const HALF_PI = Math.PI / 2;
const SEC_TO_RAD = D2R / 3600;

interface Ellipsoid { a: number; es: number; e: number }

function ellipsoid(a: number, rf: number): Ellipsoid {
  const b = a * (1 - 1 / rf);
  const es = 1 - (b * b) / (a * a);
  return { a, es, e: Math.sqrt(es) };
}

const INTL_1924 = ellipsoid(6378388, 297);
const GRS80 = ellipsoid(6378137, 298.257222101);
const WGS84 = ellipsoid(6378137, 298.257223563);

interface Lcc { ell: Ellipsoid; ns: number; f0: number; rh: number; lon0: number; x0: number; y0: number }

const msfnz = (e: number, sinphi: number, cosphi: number) => cosphi / Math.sqrt(1 - (e * sinphi) ** 2);
const tsfnz = (e: number, phi: number, sinphi: number) =>
  Math.tan(0.5 * (HALF_PI - phi)) / Math.pow((1 - e * sinphi) / (1 + e * sinphi), 0.5 * e);

/** Latitude depuis la fonction t (itération de proj4). */
function phi2z(e: number, ts: number): number {
  let phi = HALF_PI - 2 * Math.atan(ts);
  for (let i = 0; i <= 15; i++) {
    const con = e * Math.sin(phi);
    const dphi = HALF_PI - 2 * Math.atan(ts * Math.pow((1 - con) / (1 + con), 0.5 * e)) - phi;
    phi += dphi;
    if (Math.abs(dphi) <= 1e-12) return phi;
  }
  return phi;
}

const adjustLon = (x: number) => (Math.abs(x) <= Math.PI ? x : x - Math.sign(x) * 2 * Math.PI);

function lcc(ell: Ellipsoid, lat1: number, lat2: number, lat0: number, lon0: number, x0: number, y0: number): Lcc {
  const [p1, p2, p0] = [lat1 * D2R, lat2 * D2R, lat0 * D2R];
  const ms1 = msfnz(ell.e, Math.sin(p1), Math.cos(p1));
  const ms2 = msfnz(ell.e, Math.sin(p2), Math.cos(p2));
  const ts1 = tsfnz(ell.e, p1, Math.sin(p1));
  const ts2 = tsfnz(ell.e, p2, Math.sin(p2));
  const ts0 = tsfnz(ell.e, p0, Math.sin(p0));
  const ns = Math.abs(p1 - p2) > 1e-10 ? Math.log(ms1 / ms2) / Math.log(ts1 / ts2) : Math.sin(p1);
  const f0 = ms1 / (ns * Math.pow(ts1, ns));
  return { ell, ns, f0, rh: ell.a * f0 * Math.pow(ts0, ns), lon0: lon0 * D2R, x0, y0 };
}

/** Projection inverse : mètres → [latitude, longitude] en radians sur l'ellipsoïde de la projection. */
function lccInverse(p: Lcc, x: number, y: number): [number, number] {
  const dx = x - p.x0;
  const dy = p.rh - (y - p.y0);
  const sign = p.ns > 0 ? 1 : -1;
  const rh1 = sign * Math.hypot(dx, dy);
  const theta = rh1 !== 0 ? Math.atan2(sign * dx, sign * dy) : 0;
  const ts = Math.pow(rh1 / (p.ell.a * p.f0), 1 / p.ns);
  return [phi2z(p.ell.e, ts), adjustLon(theta / p.ns + p.lon0)];
}

/** Projection directe : [latitude, longitude] en radians → mètres. */
function lccForward(p: Lcc, lat: number, lon: number): [number, number] {
  const rh1 = p.ell.a * p.f0 * Math.pow(tsfnz(p.ell.e, lat, Math.sin(lat)), p.ns);
  const theta = p.ns * adjustLon(lon - p.lon0);
  return [rh1 * Math.sin(theta) + p.x0, p.rh - rh1 * Math.cos(theta) + p.y0];
}

type Xyz = [number, number, number];

function toGeocentric(ell: Ellipsoid, lat: number, lon: number): Xyz {
  const s = Math.sin(lat);
  const n = ell.a / Math.sqrt(1 - ell.es * s * s);
  return [n * Math.cos(lat) * Math.cos(lon), n * Math.cos(lat) * Math.sin(lon), n * (1 - ell.es) * s];
}

function fromGeocentric(ell: Ellipsoid, [x, y, z]: Xyz): [number, number] {
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - ell.es));
  for (let i = 0; i < 12; i++) {
    const s = Math.sin(lat);
    const n = ell.a / Math.sqrt(1 - ell.es * s * s);
    const h = p / Math.cos(lat) - n;
    const next = Math.atan2(z, p * (1 - (ell.es * n) / (n + h)));
    const done = Math.abs(next - lat) < 1e-14;
    lat = next;
    if (done) break;
  }
  return [lat, Math.atan2(y, x)];
}

/** BD72 → WGS84 : dx, dy, dz (m), rx, ry, rz (secondes d'arc), échelle (ppm), convention de proj4. */
const BD72_TO_WGS84 = { dx: -106.8686, dy: 52.2978, dz: -103.7239, rx: 0.3366 * SEC_TO_RAD, ry: -0.457 * SEC_TO_RAD, rz: 1.8422 * SEC_TO_RAD, m: 1 - 1.2747e-6 };

function helmert([x, y, z]: Xyz): Xyz {
  const { dx, dy, dz, rx, ry, rz, m } = BD72_TO_WGS84;
  return [m * (x - rz * y + ry * z) + dx, m * (rz * x + y - rx * z) + dy, m * (-ry * x + rx * y + z) + dz];
}

function helmertInverse([x, y, z]: Xyz): Xyz {
  const { dx, dy, dz, rx, ry, rz, m } = BD72_TO_WGS84;
  const [a, b, c] = [(x - dx) / m, (y - dy) / m, (z - dz) / m];
  return [a + rz * b - ry * c, -rz * a + b + rx * c, ry * a - rx * b + c];
}

const L72 = lcc(INTL_1924, 51.16666723333333, 49.8333339, 90, 4.367486666666666, 150000.013, 5400088.438);
const L08 = lcc(GRS80, 49.8333333333333, 51.1666666666667, 50.797815, 4.35921583333333, 649328, 665262);

export interface LatLon { lat: number; lon: number }

/** EPSG:31370 (Lambert 72, mètres) → WGS84 (degrés). */
export function lambert72ToWgs84(x: number, y: number): LatLon {
  const [lat, lon] = lccInverse(L72, x, y);
  const [la, lo] = fromGeocentric(WGS84, helmert(toGeocentric(INTL_1924, lat, lon)));
  return { lat: la * R2D, lon: lo * R2D };
}

/** WGS84 (degrés) → EPSG:31370 (Lambert 72, mètres). Sert au faux service d'adresses. */
export function wgs84ToLambert72(lat: number, lon: number): { x: number; y: number } {
  const [la, lo] = fromGeocentric(INTL_1924, helmertInverse(toGeocentric(WGS84, lat * D2R, lon * D2R)));
  const [x, y] = lccForward(L72, la, lo);
  return { x, y };
}

/** EPSG:3812 (Lambert 2008, mètres) → WGS84 (degrés), ETRS89 confondu avec WGS84. */
export function lambert2008ToWgs84(x: number, y: number): LatLon {
  const [lat, lon] = lccInverse(L08, x, y);
  return { lat: lat * R2D, lon: lon * R2D };
}

/** WGS84 (degrés) → EPSG:3812. Sert au faux service d'adresses. */
export function wgs84ToLambert2008(lat: number, lon: number): { x: number; y: number } {
  const [x, y] = lccForward(L08, lat * D2R, lon * D2R);
  return { x, y };
}

/** Arrondi à 5 décimales (environ 1 m), comme le contrat GeocodeResult. */
export const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

/** Vrai si le point est dans un cadre large autour de la Belgique (contrôle de vraisemblance). */
export const inBelgium = (p: LatLon) => p.lat > 49.3 && p.lat < 51.7 && p.lon > 2.3 && p.lon < 6.6;

export type Crs = 'EPSG:4326' | 'EPSG:31370' | 'EPSG:3812';

/** Reconnaît un système de coordonnées dans un nom (« EPSG:31370 », « urn:ogc:def:crs:EPSG::31370 », « …/EPSG/0/3812 »). */
export function crsFromName(name: unknown): Crs | null {
  const m = /(4326|31370|3812)\s*$/.exec(String(name ?? '').trim());
  if (!m) return /crs84|wgs ?84/i.test(String(name ?? '')) ? 'EPSG:4326' : null;
  return m[1] === '4326' ? 'EPSG:4326' : m[1] === '31370' ? 'EPSG:31370' : 'EPSG:3812';
}

/**
 * Position WGS84 depuis un couple de nombres dont le système est donné ou deviné par l'ordre de grandeur :
 * Lambert 72 (x 0 à 300 km, y 0 à 300 km), Lambert 2008 (x et y vers 500 à 800 km), sinon degrés ([lon, lat] dans
 * l'ordre GeoJSON, ou [lat, lon] si l'ordre est manifestement inversé). Rend null si hors de Belgique.
 */
export function toWgs84(a: number, b: number, crs: Crs | null): LatLon | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  let p: LatLon;
  const big = Math.abs(a) > 1000 || Math.abs(b) > 1000;
  if (crs === 'EPSG:31370' || (crs !== 'EPSG:3812' && big && a < 400_000 && b < 400_000)) p = lambert72ToWgs84(a, b);
  else if (crs === 'EPSG:3812' || big) p = lambert2008ToWgs84(a, b);
  else if (a > 45 && b < 10) p = { lat: a, lon: b };
  else p = { lat: b, lon: a };
  return inBelgium(p) ? p : null;
}
