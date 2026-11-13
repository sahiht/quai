/**
 * Réglages de Quai : validation, migration selon `v`, lecture et écriture via le KV du SDK.
 * Aucune fonction ne lève d'exception sur une entrée invalide : on retombe sur les valeurs par défaut.
 * Version 3 (1.2, docs/v1.2/PRD-1.2.md § 2.4) : lieux et favoris en une seule liste ; un lieu est un favori
 * (kind 'place') ; un trajet fixe ne part jamais de « Ma position ».
 * Version 4 (1.2.2, docs/v1.2.2/PRD-1.2.2.md § 5) : gares (`stations`) et lignes à un arrêt (`lines`) choisies ; les
 * arrêts favoris y sont rangés et ne restent plus dans `favorites`.
 */
import type { Endpoint, Favorite, FavoritePlace, FavoriteStop, FavoriteTrip, KV, LineFilter, LinePick, NameLang, Place, Propose, RecentAddress, Settings, StationPick } from './core/api';
import { DEFAULT_SETTINGS } from './core/api';
import { shortAddress } from './core/text';
import { displayName } from './core/util';
import type { Mode, Names, Op } from '../../shared/types';

export const SETTINGS_KEY = 'quai.settings';
/**
 * 1.2.2 : réglages tels qu'ils étaient avant leur première migration en v4 (v3 de la 1.2.1, ou antérieurs), gardés une
 * seule fois et jamais réécrits : un retour à la 1.2.1 peut les reprendre.
 */
export const SETTINGS_BACKUP_KEY = 'quai.settings.v3';
export const CURRENT_VERSION = 4;

const OPS: readonly Op[] = ['sncb', 'stib', 'delijn', 'tec'];
const MODES: readonly Mode[] = ['train', 'metro', 'tram', 'bus'];
const LANGS: readonly NameLang[] = ['fr', 'nl', 'local'];
const PROPOSE: readonly Propose[] = ['never', 'near', 'morning', 'evening'];
/** Créneaux d'un lieu : « Quand je suis à moins de 300 m » n'a pas de sens pour lui et devient « Jamais ». */
const PLACE_PROPOSE: readonly Propose[] = ['never', 'morning', 'evening'];
const OPENING: readonly Settings['display']['opening'][] = ['suggest', 'home', 'firstFavorite'];
const RADII: readonly Settings['display']['radiusM'][] = [300, 500, 800];
const FAV_ORDER: readonly Settings['display']['favOrder'][] = ['smart', 'mine'];
const PLACE_SRC: readonly NonNullable<Place['src']>[] = ['address', 'stop', 'here'];

export const LIMITS = {
  favorites: 32, // 1.2 : 20 favoris et 12 lieux de la 1.1, la migration ne perd rien
  stations: 32, // 1.2.2 : autant que de favoris, la migration ne perd aucun arrêt
  lines: 32, // 1.2.2 : idem (un arrêt qui ne tient plus ligne par ligne devient « toutes les lignes »)
  recent: 5,
  label: 30,
  address: 120,
  maxWalkMin: [5, 20] as const,
  depsPerStop: [2, 8] as const,
  delayMin: [1, 60] as const,
  leaveBeforeMin: [0, 15] as const,
};

/** 1.1 : « Mes lieux », 12 au plus (lus seulement par la migration). */
const V2_PLACES_MAX = 12;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown, max = 200): string | undefined =>
  typeof x === 'string' && x.trim() ? x.trim().replace(/\s+/g, ' ').slice(0, max) : undefined;
const bool = (x: unknown, d: boolean): boolean => (typeof x === 'boolean' ? x : d);
const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : undefined);
const oneOf = <T>(x: unknown, list: readonly T[], d: T): T => (list.includes(x as T) ? (x as T) : d);

export function clampInt(x: unknown, [lo, hi]: readonly [number, number], d: number): number {
  const n = num(x);
  if (n === undefined) return d;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function lat(x: unknown): number | undefined {
  const n = num(x);
  return n !== undefined && n >= -90 && n <= 90 ? n : undefined;
}
function lon(x: unknown): number | undefined {
  const n = num(x);
  return n !== undefined && n >= -180 && n <= 180 ? n : undefined;
}

function names(x: unknown): Names | undefined {
  if (!isObj(x)) return undefined;
  const fr = str(x.fr, 120);
  const nl = str(x.nl, 120);
  if (!fr && !nl) return undefined;
  const out: Names = { fr: fr ?? nl!, nl: nl ?? fr! };
  if (x.l === 'nl' || x.l === 'fr') out.l = x.l;
  return out;
}

function nearestRadius(x: unknown): Settings['display']['radiusM'] {
  const n = num(x);
  if (n === undefined) return DEFAULT_SETTINGS.display.radiusM;
  return RADII.reduce((best, r) => (Math.abs(r - n) < Math.abs(best - n) ? r : best), RADII[0]);
}

function place(x: unknown): Place | undefined {
  if (!isObj(x)) return undefined;
  const id = str(x.id, 60);
  const label = str(x.label, LIMITS.label);
  const la = lat(x.lat);
  const lo = lon(x.lon);
  if (!id || !label || la === undefined || lo === undefined) return undefined;
  const p: Place = { id, label, lat: la, lon: lo };
  const address = str(x.address, LIMITS.address);
  if (address) p.address = address;
  if (PLACE_SRC.includes(x.src as NonNullable<Place['src']>)) p.src = x.src as NonNullable<Place['src']>;
  if (x.approx === true) p.approx = true;
  const a = areaId(x.areaId);
  if (a) p.areaId = a;
  return p;
}

function recentAddress(x: unknown): RecentAddress | undefined {
  if (!isObj(x)) return undefined;
  const label = str(x.label, LIMITS.address);
  const la = lat(x.lat);
  const lo = lon(x.lon);
  const at = num(x.at);
  if (!label || la === undefined || lo === undefined) return undefined;
  const r: RecentAddress = { label, lat: la, lon: lo, at: at !== undefined && at > 0 ? Math.round(at) : 0 };
  if (x.approx === true) r.approx = true;
  return r;
}

function areaId(x: unknown): string | undefined {
  const s = str(x, 80);
  return s && /^(sncb|stib|delijn|tec):\S+$/.test(s) ? s : undefined;
}

function endpoint(x: unknown, placeIds: Set<string>): Endpoint | undefined {
  if (!isObj(x)) return undefined;
  if (x.type === 'here') return { type: 'here' };
  if (x.type === 'place') {
    const placeId = str(x.placeId, 60);
    return placeId && placeIds.has(placeId) ? { type: 'place', placeId } : undefined;
  }
  if (x.type === 'address') {
    const label = str(x.label, LIMITS.address);
    const la = lat(x.lat);
    const lo = lon(x.lon);
    if (!label || la === undefined || lo === undefined) return undefined;
    const e: Endpoint = { type: 'address', label, lat: la, lon: lo };
    if (x.approx === true) e.approx = true;
    return e;
  }
  if (x.type === 'area') {
    const id = areaId(x.areaId);
    const op = oneOf(x.op, OPS, undefined as unknown as Op);
    const n = names(x.name);
    const la = lat(x.lat);
    const lo = lon(x.lon);
    if (!id || !op || !n || la === undefined || lo === undefined) return undefined;
    return { type: 'area', areaId: id, op, name: n, lat: la, lon: lo };
  }
  return undefined;
}

function filters(x: unknown): LineFilter[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: LineFilter[] = [];
  for (const f of x) {
    if (!isObj(f)) continue;
    const line = str(f.line, 20);
    const head = typeof f.head === 'string' ? f.head.trim().toLowerCase() : undefined;
    if (!line || head === undefined) continue;
    if (!out.some((o) => o.line === line && o.head === head)) out.push({ line, head });
  }
  return out.length ? out.slice(0, 30) : undefined;
}

function favoritePlace(x: Obj): FavoritePlace | undefined {
  const p = place(x);
  return p ? { ...p, kind: 'place', propose: oneOf(x.propose, PLACE_PROPOSE, 'never' as Propose) } : undefined;
}

function favorite(x: unknown, placeIds: Set<string>): Favorite | undefined {
  if (!isObj(x)) return undefined;
  if (x.kind === 'place') return favoritePlace(x);
  const id = str(x.id, 60);
  if (!id) return undefined;
  const propose = oneOf(x.propose, PROPOSE, 'never' as Propose);
  if (x.kind === 'stop') {
    const id2 = areaId(x.areaId);
    const op = oneOf(x.op, OPS, undefined as unknown as Op);
    const n = names(x.name);
    const la = lat(x.lat);
    const lo = lon(x.lon);
    if (!id2 || !op || !n || la === undefined || lo === undefined) return undefined;
    const fav: FavoriteStop = { kind: 'stop', id, areaId: id2, op, name: n, lat: la, lon: lo, propose };
    const f = filters(x.filter);
    if (f) fav.filter = f;
    return fav;
  }
  if (x.kind === 'trip') {
    const from = endpoint(x.from, placeIds);
    const to = endpoint(x.to, placeIds);
    if (!from || !to) return undefined;
    const fav: FavoriteTrip = { kind: 'trip', id, from, to, propose };
    const label = str(x.label, LIMITS.label);
    if (label) fav.label = label;
    return fav;
  }
  return undefined;
}

/** Nom d'un lieu venu d'un trajet de la 1.1 : son nom affiché (« bureau » → « Bureau »), sinon `fallback`. */
function nameFrom(own: string | undefined, fallback: string): string {
  const t = own?.trim();
  if (!t || t.toLowerCase() === fallback.trim().toLowerCase()) return fallback.slice(0, LIMITS.label);
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, LIMITS.label);
}

/**
 * « Ma position → adresse » ou « Ma position → arrêt » devient un lieu (PRD-1.2 § 2.4, règle 3) : même identifiant,
 * nom affiché, sinon adresse courte ou arrêt ; créneau gardé (« près » devient « Jamais »).
 */
function placeFromTrip(f: FavoriteTrip, lang: NameLang): FavoritePlace | undefined {
  const to = f.to;
  const propose = PLACE_PROPOSE.includes(f.propose) ? f.propose : 'never';
  if (to.type === 'address') {
    const p: FavoritePlace = { kind: 'place', id: f.id, label: nameFrom(f.label, shortAddress(to.label)), lat: to.lat, lon: to.lon, address: to.label, src: 'address', propose };
    if (to.approx) p.approx = true;
    return p;
  }
  if (to.type === 'area') {
    const stop = displayName(to.name, lang);
    return { kind: 'place', id: f.id, label: nameFrom(f.label, stop), lat: to.lat, lon: to.lon, address: `Près de ${stop}`.slice(0, LIMITS.address), src: 'stop', areaId: to.areaId, propose };
  }
  return undefined;
}

function stationPick(x: unknown): StationPick | undefined {
  if (!isObj(x)) return undefined;
  const id = str(x.id, 60);
  const a = areaId(x.areaId);
  const n = names(x.name);
  const la = lat(x.lat);
  const lo = lon(x.lon);
  if (!id || !a || !a.startsWith('sncb:') || !n || la === undefined || lo === undefined) return undefined;
  const p: StationPick = { id, areaId: a, name: n, lat: la, lon: lo };
  if (x.near === true) p.near = true;
  return p;
}

function linePick(x: unknown): LinePick | undefined {
  if (!isObj(x)) return undefined;
  const id = str(x.id, 60);
  const a = areaId(x.areaId);
  const op = oneOf(x.op, OPS, undefined as unknown as Op);
  const n = names(x.name);
  const la = lat(x.lat);
  const lo = lon(x.lon);
  if (!id || !a || !op || op === 'sncb' || !n || la === undefined || lo === undefined) return undefined;
  const p: LinePick = { id, areaId: a, op, name: n, lat: la, lon: lo };
  const line = str(x.line, 20);
  if (line) p.line = line;
  if (MODES.includes(x.mode as Mode) && x.mode !== 'train') p.mode = x.mode as Mode;
  if (x.near === true) p.near = true;
  return p;
}

/** Identifiants : 60 caractères au plus, comme à la lecture (une seconde lecture ne les change pas). */
const ID_MAX = 60;

/**
 * 1.2.2 (PRD-1.2.2 § 5) : un arrêt favori rejoint les gares (gare SNCB) ou les lignes (autres réseaux : une ligne
 * par ligne de son filtre, toutes les lignes de l'arrêt sans filtre), sans doublon ni dépassement des limites.
 * L'ordre des favoris est gardé ; un arrêt déjà présent n'est pas ajouté une deuxième fois (il lui donne seulement son
 * ouverture d'office). Le créneau « près » (ouverture d'office à moins de 300 m) devient `near`. Le réseau est lu
 * dans l'identifiant de zone, comme pour les gares et les lignes. Identifiants uniques parmi favoris, gares et
 * lignes : celui de l'arrêt, suivi de la ligne s'il en donne plusieurs (« fav-gdn-3 »), puis « -2 », « -3 »…
 * Rien n'est perdu (32 favoris au plus, 32 gares et 32 lignes) : une place est gardée pour chaque arrêt qui suit ; un
 * arrêt dont les lignes ne tiennent plus devient une seule ligne « toutes les lignes ».
 */
export function moveStops(favorites: readonly Favorite[], stations: StationPick[], lines: LinePick[]): Favorite[] {
  const rest: Favorite[] = [];
  const taken = new Set([...stations.map((x) => x.id), ...lines.map((x) => x.id), ...favorites.filter((f) => f.kind !== 'stop').map((f) => f.id)]);
  const freeId = (base: string, suffix = '') => {
    const make = (s: string) => `${base.slice(0, Math.max(1, ID_MAX - s.length))}${s}`;
    let out = make(suffix);
    for (let n = 2; taken.has(out); n++) out = make(`${suffix}-${n}`);
    taken.add(out);
    return out;
  };
  const opOf = (f: FavoriteStop) => f.areaId.slice(0, f.areaId.indexOf(':')) as Op;
  let after = favorites.filter((f) => f.kind === 'stop' && opOf(f) !== 'sncb').length;
  for (const f of favorites) {
    if (f.kind !== 'stop') {
      rest.push(f);
      continue;
    }
    const near = f.propose === 'near';
    const op = opOf(f);
    if (op === 'sncb') {
      const known = stations.find((x) => x.areaId === f.areaId);
      if (known) {
        if (near) known.near = true;
      } else if (stations.length < LIMITS.stations) {
        stations.push({ id: freeId(f.id), areaId: f.areaId, name: f.name, lat: f.lat, lon: f.lon, ...(near ? { near } : {}) });
      }
      continue;
    }
    after -= 1;
    const wanted = [...new Set((f.filter ?? []).map((x) => x.line))];
    const fresh = wanted.filter((line) => !lines.some((x) => x.areaId === f.areaId && x.line === line));
    // une place gardée pour chacun des arrêts suivants ; sinon l'arrêt entier, toutes ses lignes
    const fits = !fresh.length || fresh.length <= LIMITS.lines - lines.length - after;
    const each: (string | undefined)[] = wanted.length && fits ? wanted : [undefined];
    for (const line of each) {
      const known = lines.find((x) => x.areaId === f.areaId && x.line === line);
      if (known) {
        if (near) known.near = true;
        continue;
      }
      if (lines.length >= LIMITS.lines) continue;
      const p: LinePick = { id: freeId(f.id, line === undefined || each.length === 1 ? '' : `-${line}`), areaId: f.areaId, op, name: f.name, lat: f.lat, lon: f.lon };
      if (line !== undefined) p.line = line;
      if (near) p.near = true;
      lines.push(p);
    }
  }
  return rest;
}

/**
 * Favoris v3 dans l'ordre, identifiants uniques, 32 au plus. Un trajet « Ma position → … » n'est pas un trajet fixe :
 * vers un lieu, c'est ce lieu (déjà dans la liste) ; vers une adresse ou un arrêt, il devient un lieu. Un trajet fixe
 * qui cite un lieu absent est retiré (comme en 1.1).
 */
function favoritesOf(raw: unknown[], lang: NameLang): Favorite[] {
  const placeIds = new Set<string>();
  for (const r of raw) {
    const p = isObj(r) && r.kind === 'place' ? favoritePlace(r) : undefined;
    if (p) placeIds.add(p.id);
  }
  const out: Favorite[] = [];
  for (const r of raw) {
    let f = favorite(r, placeIds);
    if (f?.kind === 'trip' && f.from.type === 'here') f = placeFromTrip(f, lang);
    if (f && !out.some((g) => g.id === f.id)) out.push(f);
    if (out.length >= LIMITS.favorites) break;
  }
  const kept = new Set(out.filter((f) => f.kind === 'place').map((f) => f.id));
  const known = (e: Endpoint) => e.type !== 'place' || kept.has(e.placeId);
  return out.filter((f) => f.kind !== 'trip' || (known(f.from) && known(f.to)));
}

/**
 * Valide et complète des réglages (format v4). Des réglages d'une version antérieure (`v` 1 à 3 : anciens
 * enregistrements, préréglages) sont d'abord migrés. Ne lève jamais.
 */
export function validateSettings(input: unknown): Settings {
  if (isObj(input) && typeof input.v === 'number' && input.v >= 1 && input.v < CURRENT_VERSION) return migrateSettings(input);
  const d = DEFAULT_SETTINGS;
  const x = isObj(input) ? input : {};
  const lang = oneOf(x.lang, LANGS, d.lang);
  const stations: StationPick[] = [];
  for (const r of Array.isArray(x.stations) ? x.stations : []) {
    const p = stationPick(r);
    if (p && !stations.some((q) => q.id === p.id || q.areaId === p.areaId)) stations.push(p);
    if (stations.length >= LIMITS.stations) break;
  }
  const lines: LinePick[] = [];
  for (const r of Array.isArray(x.lines) ? x.lines : []) {
    const p = linePick(r);
    if (p && !lines.some((q) => q.id === p.id || (q.areaId === p.areaId && q.line === p.line))) lines.push(p);
    if (lines.length >= LIMITS.lines) break;
  }
  // 1.2.2 : un arrêt favori encore présent (réglages écrits par une version antérieure) rejoint gares ou lignes
  const favorites = moveStops(favoritesOf(Array.isArray(x.favorites) ? x.favorites : [], lang), stations, lines);
  const recent: RecentAddress[] = [];
  for (const r of Array.isArray(x.recent) ? x.recent : []) {
    const ok = recentAddress(r);
    if (ok && !recent.some((q) => q.label === ok.label)) recent.push(ok);
    if (recent.length >= LIMITS.recent) break;
  }
  const seen = typeof x.seenVersion === 'string' && /^\d+\.\d+\.\d+$/.test(x.seenVersion.trim()) ? x.seenVersion.trim() : '';
  const disp = isObj(x.display) ? x.display : {};
  const al = isObj(x.alerts) ? x.alerts : {};
  return {
    v: 4,
    onboarded: bool(x.onboarded, d.onboarded),
    lang,
    maxWalkMin: clampInt(x.maxWalkMin, LIMITS.maxWalkMin, d.maxWalkMin),
    favorites,
    stations,
    lines,
    recent,
    seenVersion: seen,
    display: {
      depsPerStop: clampInt(disp.depsPerStop, LIMITS.depsPerStop, d.display.depsPerStop),
      radiusM: nearestRadius(disp.radiusM),
      gestureHints: bool(disp.gestureHints, d.display.gestureHints),
      markPlanned: bool(disp.markPlanned, d.display.markPlanned),
      rain: bool(disp.rain, d.display.rain),
      opening: oneOf(disp.opening, OPENING, d.display.opening),
      favOrder: oneOf(disp.favOrder, FAV_ORDER, d.display.favOrder),
    },
    alerts: {
      platform: bool(al.platform, d.alerts.platform),
      delay: bool(al.delay, d.alerts.delay),
      delayMin: clampInt(al.delayMin, LIMITS.delayMin, d.alerts.delayMin),
      cancel: bool(al.cancel, d.alerts.cancel),
      leave: bool(al.leave, d.alerts.leave),
      leaveBeforeMin: clampInt(al.leaveBeforeMin, LIMITS.leaveBeforeMin, d.alerts.leaveBeforeMin),
      works: bool(al.works, d.alerts.works),
    },
  };
}

/**
 * Migrations successives, indexées par la version de départ.
 * v0 = réglages enregistrés sans champ `v` (prototype) : mêmes champs, mais `radius` et `deps`
 * à plat et `hints` au lieu de display.gestureHints.
 */
const MIGRATIONS: Record<number, (x: Obj) => Obj> = {
  0: (x) => {
    const display = isObj(x.display) ? { ...x.display } : {};
    if (display.radiusM === undefined && x.radius !== undefined) display.radiusM = x.radius;
    if (display.depsPerStop === undefined && x.deps !== undefined) display.depsPerStop = x.deps;
    if (display.gestureHints === undefined && x.hints !== undefined) display.gestureHints = x.hints;
    const { radius: _r, deps: _d, hints: _h, ...rest } = x;
    return { ...rest, display, v: 1 };
  },
  /** 1.0 vers 1.1 : tout est gardé ; le message « Quai 1.1 » s'affichera une fois (seenVersion 1.0.0). */
  1: (x) => {
    const display = isObj(x.display) ? { ...x.display } : {};
    if (display.favOrder === undefined) display.favOrder = 'smart';
    return { ...x, display, recent: Array.isArray(x.recent) ? x.recent : [], seenVersion: typeof x.seenVersion === 'string' && x.seenVersion ? x.seenVersion : '1.0.0', v: 2 };
  },
  /**
   * 1.1 vers 1.2 (PRD-1.2 § 2.4), sans perte ni doublon :
   * 1. chaque lieu devient un favori lieu (nom, position, adresse, src, approx, areaId gardés), créneau « Jamais » ;
   * 2. un trajet « Ma position → ce lieu » fusionne avec lui : le lieu prend sa place dans l'ordre, son
   *    identifiant, son nom affiché et son créneau (« près » devient « Jamais ») ; s'il y en a plusieurs, le premier ;
   * 3. « Ma position → adresse ou arrêt » devient un lieu ;
   * 4. arrêts et autres trajets inchangés ; un trajet fixe qui citait un lieu cite son favori lieu ;
   * 5. ordre : les favoris de la 1.1, puis les lieux restants dans l'ordre de « Mes lieux ».
   * Adresses récentes, réglages et seenVersion gardés.
   */
  2: (x) => {
    const lang = oneOf(x.lang, LANGS, DEFAULT_SETTINGS.lang);
    const places: Place[] = [];
    for (const r of Array.isArray(x.places) ? x.places : []) {
      const p = place(r);
      if (p && !places.some((q) => q.id === p.id)) places.push(p);
      if (places.length >= V2_PLACES_MAX) break;
    }
    const placeIds = new Set(places.map((p) => p.id));
    const out: Favorite[] = [];
    const placeFav = new Map<string, string>(); // lieu de la 1.1 → identifiant de son favori lieu
    for (const r of Array.isArray(x.favorites) ? x.favorites : []) {
      const f = favorite(r, placeIds);
      if (!f || f.kind === 'place' || out.some((g) => g.id === f.id)) continue;
      if (f.kind === 'trip' && f.from.type === 'here') {
        const to = f.to;
        if (to.type === 'place') {
          if (placeFav.has(to.placeId)) continue; // même trajet : disparaît
          const p = places.find((q) => q.id === to.placeId)!;
          placeFav.set(p.id, f.id);
          out.push({ ...p, kind: 'place', id: f.id, label: nameFrom(f.label, p.label), propose: PLACE_PROPOSE.includes(f.propose) ? f.propose : 'never' });
        } else {
          const p = placeFromTrip(f, lang);
          if (p) out.push(p);
        }
        continue;
      }
      out.push(f);
    }
    const taken = new Set(out.map((f) => f.id));
    for (const p of places) {
      if (placeFav.has(p.id)) continue;
      let id = p.id;
      for (let n = 2; taken.has(id); n++) id = `${p.id}-${n}`; // identifiant déjà pris par un favori
      taken.add(id);
      placeFav.set(p.id, id);
      out.push({ ...p, kind: 'place', id, propose: 'never' });
    }
    const follow = (e: Endpoint): Endpoint => (e.type === 'place' ? { type: 'place', placeId: placeFav.get(e.placeId) ?? e.placeId } : e);
    const favorites = out.map((f) => (f.kind === 'trip' ? { ...f, from: follow(f.from), to: follow(f.to) } : f));
    const { places: _places, ...rest } = x;
    return { ...rest, favorites, v: 3 };
  },
  /**
   * 1.2 vers 1.2.2 (PRD-1.2.2 § 5) : les arrêts favoris rejoignent les gares et les lignes (moveStops, appliqué par
   * validateSettings) ; le reste est gardé, seenVersion compris (le message « Quai 1.2.2 » s'affichera une fois).
   */
  3: (x) => ({ ...x, stations: Array.isArray(x.stations) ? x.stations : [], lines: Array.isArray(x.lines) ? x.lines : [], v: 4 }),
};

/** Version d'un objet de réglages (0 si absente ou invalide). */
export function versionOf(x: unknown): number {
  if (!isObj(x)) return 0;
  const v = num(x.v);
  return v !== undefined && Number.isInteger(v) && v >= 0 ? v : 0;
}

/** Migre puis valide. Une version plus récente que celle connue est lue au mieux (champs connus). */
export function migrateSettings(input: unknown): Settings {
  if (!isObj(input)) return validateSettings({});
  let x: Obj = { ...input };
  let v = versionOf(x);
  while (v < CURRENT_VERSION && MIGRATIONS[v]) {
    x = MIGRATIONS[v](x);
    v += 1;
  }
  return validateSettings(x);
}

/** Lit les réglages enregistrés (JSON) ; valeurs par défaut si absents ou illisibles. */
export function parseSettings(raw: string | null | undefined): Settings {
  if (!raw) return validateSettings({});
  try {
    return migrateSettings(JSON.parse(raw));
  } catch {
    return validateSettings({});
  }
}

export async function loadSettings(kv: KV): Promise<Settings> {
  let raw: string | null;
  try {
    raw = await kv.get(SETTINGS_KEY);
  } catch {
    return validateSettings({});
  }
  await backupBeforeMigration(kv, raw);
  return parseSettings(raw);
}

/**
 * 1.2.2 : copie des réglages d'une version antérieure (v < 4) avant leur migration, sous SETTINGS_BACKUP_KEY, la
 * première fois seulement (une copie déjà là n'est jamais remplacée). Au mieux : un échec n'empêche pas la lecture.
 */
async function backupBeforeMigration(kv: KV, raw: string | null): Promise<void> {
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!isObj(parsed) || versionOf(parsed) >= CURRENT_VERSION) return;
  try {
    if (!(await kv.get(SETTINGS_BACKUP_KEY))) await kv.set(SETTINGS_BACKUP_KEY, raw);
  } catch {
    /* au mieux */
  }
}

export async function saveSettings(kv: KV, s: Settings): Promise<void> {
  await kv.set(SETTINGS_KEY, JSON.stringify(validateSettings(s)));
}

export async function clearSettings(kv: KV): Promise<void> {
  await kv.set(SETTINGS_KEY, '');
}

/** Identifiant court et lisible pour un nouveau lieu ou favori. */
export function newId(prefix: string, taken: Iterable<string>, now = Date.now()): string {
  const used = new Set(taken);
  let n = now % 1_000_000;
  let id = `${prefix}-${n.toString(36)}`;
  while (used.has(id)) id = `${prefix}-${(++n).toString(36)}`;
  return id;
}

type Listener = (s: Settings) => void;

/** Réglages vivants partagés par le téléphone et les lunettes. */
export class SettingsStore {
  private value: Settings;
  private listeners = new Set<Listener>();
  private saving: Promise<void> = Promise.resolve();

  constructor(private kv: KV, initial: Settings) {
    this.value = validateSettings(initial);
  }

  get(): Settings {
    return this.value;
  }

  /** Remplace les réglages (validés), enregistre, prévient les abonnés. */
  set(next: Settings): Promise<void> {
    this.value = validateSettings(next);
    for (const l of this.listeners) {
      try {
        l(this.value);
      } catch (err) {
        console.error(err);
      }
    }
    const snapshot = this.value;
    this.saving = this.saving.then(() => saveSettings(this.kv, snapshot)).catch((err) => console.error('Réglages non enregistrés', err));
    return this.saving;
  }

  update(fn: (s: Settings) => Settings): Promise<void> {
    return this.set(fn(structuredClone(this.value)));
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  flush(): Promise<void> {
    return this.saving;
  }
}
