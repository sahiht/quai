/**
 * Candidats des services d'adresses, libellés normalisés, fusion et classement
 * (design-routing.md § 6.4 points 4 et 5).
 *
 * Classement : couverture des mots tapés (numéro compris), puis précision (part du libellé que le texte explique :
 * « namur » donne la commune avant « Rue de Namur », « gare de gembloux » la gare avant « Rue de la Gare »), puis type
 * (adresse, rue, lieu, commune), puis score de la source, puis Région annoncée par le code postal, puis ordre des
 * services. `score` rendu = 0,7 × couverture + 0,3 × précision, au centième : à score égal, le téléphone trie par
 * proximité (sa position ne quitte jamais le téléphone).
 */
import type { GeocodeResult, GeoSource } from '../shared/types.js';
import { GEO_LIMITS, type GeoId } from '../config.js';
import { regionOfPostcode, type Region } from './communes.js';
import { round5 } from './lambert.js';
import { PARTICLES, isNumberToken, normNumber, normalizeText, tokens, type Lang } from './text.js';

export type Kind = GeocodeResult['kind'];

/** Libellés d'un candidat dans une langue (Bruxelles : français et néerlandais). */
export interface Variant {
  lang?: 'fr' | 'nl' | 'de';
  street?: string;
  municipality?: string;
  /** Lieu (gare, parc…) : nom affiché. */
  place?: string;
}

export interface Candidate {
  source: GeoId;
  kind: Kind;
  approx: boolean;
  lat: number;
  lon: number;
  number?: string;
  postcode?: string;
  /** Au moins une variante ; la langue demandée est choisie à l'affichage. */
  variants: Variant[];
  /** Identifiant chez la source (doublons d'une même source). */
  id?: string;
  /** Score de la source ramené entre 0 et 1 (relatif au meilleur candidat de cette source). */
  srcScore: number;
  /** Rang dans la réponse de la source. */
  order: number;
  /** Région de l'objet (code postal, sinon service, sinon type de donnée). */
  region: Region;
}

const KIND_ORDER: Readonly<Record<Kind, number>> = { adresse: 0, rue: 1, lieu: 2, commune: 3 };

/* ------------------------------ Libellés ------------------------------ */

export function pickVariant(c: Candidate, lang: Lang): Variant {
  return c.variants.find((v) => v.lang === lang) ?? c.variants[0];
}

/** « Rue de Fer 25, 5000 Namur » ; « Rue Neuve, 1000 Bruxelles » ; « 5000 Namur » ; « Gare de Gembloux ». */
export function labelOf(c: Candidate, v: Variant): string {
  const place = [c.postcode, v.municipality].filter(Boolean).join(' ');
  switch (c.kind) {
    case 'adresse':
    case 'rue': {
      const head = [v.street, c.kind === 'adresse' ? c.number : undefined].filter(Boolean).join(' ');
      return [head, place].filter(Boolean).join(', ');
    }
    case 'commune':
      return place || v.municipality || '';
    case 'lieu': {
      const name = v.place ?? v.street ?? '';
      const inName = v.municipality && normalizeText(name).includes(normalizeText(v.municipality));
      return [name, inName ? '' : place].filter(Boolean).join(', ');
    }
  }
}

/* ------------------------------ Correspondance avec le texte tapé ------------------------------ */

interface QToken { t: string; weight: number; num: boolean; last: boolean }

export interface QueryInfo {
  toks: QToken[];
  /** Le texte contient un numéro de maison (nombre autre que le code postal reconnu). */
  hasNumber: boolean;
  postcode?: string;
  /** Région annoncée par le code postal tapé. */
  cpRegion: Region | null;
}

export function queryInfo(q: string, postcode?: string): QueryInfo {
  const raw = tokens(q);
  const toks = raw.map((t, i) => ({ t, weight: PARTICLES.has(t) ? 0.5 : 1, num: isNumberToken(t), last: i === raw.length - 1 }));
  return {
    toks,
    hasNumber: toks.some((x) => x.num && x.t !== postcode),
    postcode,
    cpRegion: postcode ? regionOfPostcode(postcode) : null,
  };
}

function wordsOf(c: Candidate, v: Variant): string[] {
  return [...tokens(v.street ?? ''), ...tokens(v.place ?? ''), ...tokens(v.municipality ?? '')];
}

export interface Match { coverage: number; precision: number }

/** Couverture et précision d'un candidat pour le texte tapé (meilleure des variantes de langue pour la précision). */
export function matchOf(c: Candidate, qi: QueryInfo): Match {
  const allWords = new Set(c.variants.flatMap((v) => wordsOf(c, v)));
  const number = normNumber(c.number);
  let got = 0;
  let total = 0;
  for (const q of qi.toks) {
    total += q.weight;
    let credit = 0;
    if (q.num) {
      if (number && q.t === number) credit = 1;
      else if (c.postcode && q.t === c.postcode) credit = 1;
      else if (number && /^\d+$/.test(q.t) && number.startsWith(q.t) && /^[a-z]+$/.test(number.slice(q.t.length))) credit = 0.5;
      else if (allWords.has(q.t)) credit = 1;
    } else if (allWords.has(q.t)) credit = 1;
    else if (q.last && q.t.length >= 2 && [...allWords].some((w) => w.startsWith(q.t))) credit = 0.75;
    got += credit * q.weight;
  }
  // un numéro de maison que l'on n'a pas tapé compte comme un élément non couvert (« rue neuve » : la rue d'abord)
  if (number && !qi.hasNumber) total += 1;
  const coverage = total > 0 ? got / total : 0;

  const typed = new Set(qi.toks.map((x) => x.t));
  const last = qi.toks.length ? qi.toks[qi.toks.length - 1].t : '';
  // mot tapé : 1 ; début du dernier mot en cours de frappe (« gent » pour « Gentbruggeaard ») : 0,5
  const explained = (w: string) => (typed.has(w) ? 1 : last.length >= 2 && w.startsWith(last) ? 0.5 : 0);
  let precision = 0;
  for (const v of c.variants) {
    const words = wordsOf(c, v).filter((w) => !PARTICLES.has(w));
    if (c.kind === 'adresse' && number) words.push(number);
    if (c.postcode && typed.has(c.postcode)) words.push(c.postcode);
    if (!words.length) continue;
    precision = Math.max(precision, words.reduce((sum, w) => sum + explained(w), 0) / words.length);
  }
  return { coverage, precision };
}

/* ------------------------------ Fusion et classement ------------------------------ */

const toRad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const x = toRad(b.lon - a.lon) * Math.cos(toRad((a.lat + b.lat) / 2));
  const y = toRad(b.lat - a.lat);
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

const labelKey = (c: Candidate) => normalizeText(labelOf(c, c.variants[0]));

/** Même objet : même source et même identifiant, même libellé, ou même type à moins de 25 m (même numéro). */
function same(a: Candidate, b: Candidate): boolean {
  if (a.source === b.source && a.id && a.id === b.id && a.kind === b.kind) return true;
  if (a.kind === b.kind && labelKey(a) === labelKey(b)) return true;
  if (a.source === b.source || a.kind !== b.kind) return false;
  if (a.kind === 'adresse' && normNumber(a.number) !== normNumber(b.number)) return false;
  return distanceM(a, b) < GEO_LIMITS.dedupeMeters;
}

/** Service « chez lui » pour la Région d'un objet : gardé de préférence parmi des doublons. */
const home = (c: Candidate) => c.source === c.region;

interface Scored { c: Candidate; m: Match }

const EPS = 1e-9;

export function rankCandidates(cands: readonly Candidate[], qi: QueryInfo, sourceOrder: readonly GeoId[]): Scored[] {
  const scored = cands.map((c) => ({ c, m: matchOf(c, qi) }));
  const srcRank = (s: GeoId) => {
    const i = sourceOrder.indexOf(s);
    return i < 0 ? sourceOrder.length : i;
  };
  scored.sort((x, y) => {
    const a = x.c;
    const b = y.c;
    if (Math.abs(x.m.coverage - y.m.coverage) > EPS) return y.m.coverage - x.m.coverage;
    if (Math.abs(x.m.precision - y.m.precision) > EPS) return y.m.precision - x.m.precision;
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (Math.abs(a.srcScore - b.srcScore) > EPS) return b.srcScore - a.srcScore;
    if (qi.cpRegion) {
      const ra = a.region === qi.cpRegion ? 0 : 1;
      const rb = b.region === qi.cpRegion ? 0 : 1;
      if (ra !== rb) return ra - rb;
    }
    return srcRank(a.source) - srcRank(b.source) || a.order - b.order;
  });
  const kept: Scored[] = [];
  for (const s of scored) {
    const i = kept.findIndex((k) => same(k.c, s.c));
    if (i < 0) kept.push(s);
    else if (home(s.c) && !home(kept[i].c)) kept[i] = { c: s.c, m: kept[i].m.coverage >= s.m.coverage ? kept[i].m : s.m };
  }
  return kept;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Résultat du contrat GeocodeResult (5 décimales, libellé dans la langue demandée, deux langues à Bruxelles). */
export function toResult(s: Scored, lang: Lang): GeocodeResult {
  const { c, m } = s;
  const v = pickVariant(c, lang);
  const out: GeocodeResult = {
    label: labelOf(c, v),
    lat: round5(c.lat),
    lon: round5(c.lon),
    kind: c.kind,
    source: c.source as GeoSource,
    score: round2(0.7 * m.coverage + 0.3 * m.precision),
  };
  if (c.approx) out.approx = true;
  const parts: NonNullable<GeocodeResult['parts']> = {};
  if (v.street && (c.kind === 'adresse' || c.kind === 'rue')) parts.street = v.street;
  if (c.number && c.kind === 'adresse') parts.number = c.number;
  if (c.postcode) parts.postcode = c.postcode;
  if (v.municipality) parts.municipality = v.municipality;
  if (Object.keys(parts).length) out.parts = parts;
  const fr = c.variants.find((x) => x.lang === 'fr');
  const nl = c.variants.find((x) => x.lang === 'nl');
  if (fr && nl) {
    const names = { fr: labelOf(c, fr), nl: labelOf(c, nl) };
    if (names.fr && names.nl) out.names = names;
  }
  return out;
}
