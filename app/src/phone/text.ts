/**
 * Textes du téléphone (PRD § 6.2 et § 6.3) : typographie française, phrases des cartes de trajets,
 * réponses courtes des favoris, sous-titres des lieux. Fonctions pures, sans DOM.
 */
import type { Endpoint, Favorite, FavoriteAnswer, Journey, NameLang, Place, PlanResult, Propose, Settings } from '../core/api';
import { LABEL_TEXT } from '../core/api';
import { favoriteTitle } from '../core/favorites';
import { NB, shortAddress } from '../core/text';
import { areaLabel, displayName, hhmm } from '../core/util';
import { atTitle, durationText, journeyStart, spanText, stopAnswerLine, transfersText, tripAnswerLine, walkMinOf } from '../glasses/format';
import { normalizeForSearch } from '../../../shared/names';

/** Espace insécable (U+00A0) du cœur ; adresse courte « Veldstraat 1 » (titres « Vers … »). */
export { NB, shortAddress };

/**
 * Typographie française d'un texte affiché : espace insécable devant « : ; ! ? », à l'intérieur des guillemets
 * et entre un nombre et son unité (« 7 min », « 5 h », « 300 m »). Les heures (« 07:42 ») ne changent pas.
 */
export function typo(s: string): string {
  return s
    .replace(/ ([:;!?])(?=\s|$|[.,)»])/g, `${NB}$1`)
    .replace(/« /g, `«${NB}`)
    .replace(/ »/g, `${NB}»`)
    .replace(/(\d) (min|h|m|km)(?=$|[\s,.;:!?)»])/g, `$1${NB}$2`);
}

/* ------------------------------ Textes fixes (PRD § 6.2, § 6.3) ------------------------------ */

export const T = {
  where: 'Où vas-tu ?',
  wherePlaceholder: 'Adresse, gare, arrêt ou lieu',
  addrPlaceholder: 'Rue et numéro, commune',
  privacy: 'Adresses : services officiels des Régions bruxelloise, flamande et wallonne. Seul le texte tapé leur est envoyé, ta position reste sur le téléphone.',
  addrDown: 'Adresses indisponibles pour l’instant : gares et arrêts seulement.',
  addrOffline: 'Recherche d’adresse impossible sans connexion : gares et arrêts seulement.',
  nothing: 'Aucune adresse, gare ou arrêt ne correspond. Ajoute la commune, ou vérifie l’orthographe.',
  addrHint: 'Pour une adresse, ajoute la rue et le numéro.',
  saveAsPlace: 'Enregistrer comme lieu',
  saveAddressAsPlace: 'Enregistrer l’adresse comme lieu',
  savePlace: 'Enregistrer le lieu',
  keepFavorite: 'Garder en favori',
  favAdded: 'Ajouté à tes favoris.',
  favExists: 'Déjà dans tes favoris.',
  noTripNow: 'Aucun trajet trouvé à cette heure.',
  glassesOff: 'Lunettes indisponibles pour l’instant.',
  glasses: 'Lunettes',
  verify: 'Vérifier l’adresse',
  toVerify: 'Adresse à vérifier',
  approx: 'Position approximative : la rue, sans numéro.',
  hereSub: 'si tu es sur place',
  useHere: 'Utiliser ma position actuelle',
  clearRecent: 'Effacer les adresses récentes',
  addFav: 'Ajouter aux favoris',
  noThanks: 'Non merci',
  remove: 'Supprimer',
  cancel: 'Annuler',
  removeFav: 'Supprimer ce favori ?',
  stopMissing: 'Arrêt introuvable : choisis-le à nouveau',
  noFav: 'Aucun favori pour l’instant.',
  manageFavs: 'Gérer mes favoris',
  myFavs: 'Mes favoris',
  reorder: 'Changer l’ordre',
  up: 'Monter',
  down: 'Descendre',
  done: 'Terminé',
  favsLead: 'En tête dans les lunettes selon l’heure et le lieu (réglage Affichage).',
  rtDown: 'Temps réel indisponible, horaires prévus',
  offline: 'Pas de réseau : réessaie dans un instant.',
  news: 'Nouveau : tape une adresse, Quai trouve le trajet le plus simple.',
} as const;

/** « Supprimer le lieu « Piscine » ? Les trajets favoris vers ce lieu seront aussi supprimés. » */
export const removePlaceText = (name: string): string => `Supprimer le lieu « ${name} » ? Les trajets favoris vers ce lieu seront aussi supprimés.`;
export const placeSavedText = (name: string): string => `Lieu enregistré : ${name}.`;
export const addTripQuestion = (name: string): string => `Ajouter le trajet vers ${name} à tes favoris ?`;
export const noStopText = (min: number): string => `Aucun arrêt à moins de ${min} min à pied de cette adresse.`;
export const noFullTripText = (station: string): string => `Pas de trajet complet. Essaie ${station}, puis le tram.`;
export const searchTowards = (station: string): string => `Chercher vers ${station}`;
/** Annonce du nombre de résultats (« 3 trajets. »). */
export const tripsCount = (n: number): string => `${n} trajet${n > 1 ? 's' : ''}.`;

/** « Le proposer à l'ouverture » : créneaux avec leurs heures (S3). */
export const PROPOSE_LABEL: Record<Propose, string> = {
  never: 'Jamais',
  near: 'Quand je suis à moins de 300 m',
  morning: 'Le matin (5 h à 11 h)',
  evening: 'Le soir (15 h à 21 h)',
};

/* ------------------------------ Adresses ------------------------------ */

const FR_STREET = new Set(['rue', 'avenue', 'av', 'chaussee', 'chee', 'boulevard', 'bd', 'place', 'square', 'quai', 'chemin', 'dreve', 'allee']);
const NL_STREET = /(straat|laan|steenweg|plein|lei|weg)$/;

/**
 * Le texte ressemble-t-il à une adresse (PRD M4.2) ? Un chiffre, ou un mot de rue : rue, avenue, av., chaussée, chée,
 * boulevard, bd, place, square, quai, chemin, drève, allée ; en néerlandais straat, laan, steenweg, plein, lei, weg,
 * seuls ou en fin de mot composé (« Veldstraat »).
 */
export function looksLikeAddress(q: string): boolean {
  if (/\d/.test(q)) return true;
  return normalizeForSearch(q)
    .split(' ')
    .some((w) => FR_STREET.has(w) || (w.length >= 3 && NL_STREET.test(w)));
}

/** Nombre de lettres d'un texte (aide de saisie : 3 lettres ou plus). */
export const letterCount = (q: string): number => (q.match(/\p{L}/gu) ?? []).length;

/** Sous-titre d'un lieu (T3) : adresse normalisée, « Près de {arrêt} », « Adresse à vérifier » ; jamais de coordonnées. */
export function placeSubtitle(p: Place): string {
  if (p.src === 'address' && p.address) return p.approx ? `${p.address} (sans numéro)` : p.address;
  if (p.src === 'stop') return p.address ?? 'Près d’un arrêt';
  if (!p.src && p.address) return T.toVerify;
  return 'Position prise sur place';
}

/** Lieu de la 1.0 à adresse libre, jamais vérifiée (PRD M4.8). */
export const needsCheck = (p: Place): boolean => !p.src && !!p.address;

/** Texte libre d'un lieu 1.0, prêt pour le champ (« Près de Bruxelles-Central » devient « Bruxelles-Central »). */
export const legacyQuery = (p: Place): string => (p.address ?? '').replace(/^près de\s+/i, '').trim();

/** Créneau proposé d'office pour un nouveau lieu (S3) : Bureau le matin, Maison le soir. */
export function defaultSlot(name: string): Propose {
  const k = normalizeForSearch(name);
  if (k === 'bureau') return 'morning';
  if (k === 'maison') return 'evening';
  return 'never';
}

/* ------------------------------ Extrémités et favoris ------------------------------ */

/** Nom d'une extrémité pour le téléphone : « Ma position », « Bureau », « Gand-Saint-Pierre », adresse complète. */
export function endpointText(e: Endpoint, settings: Settings): string {
  if (e.type === 'here') return 'Ma position';
  if (e.type === 'area') return displayName(e.name, settings.lang);
  if (e.type === 'address') return e.label;
  return settings.places.find((p) => p.id === e.placeId)?.label ?? 'Lieu';
}

/**
 * « Vers le bureau », « Vers Veldstraat 1 », « Vers Gand-Saint-Pierre » : titre d'un trajet vers `to`, avec les règles
 * du cœur (vers(), nom donné au favori d'abord, lieu en nom commun), comme dans les lunettes.
 */
export function towardsText(to: Endpoint, settings: Settings, label?: string): string {
  return favoriteTitle({ kind: 'trip', id: '', from: { type: 'here' }, to, propose: 'never', ...(label?.trim() ? { label: label.trim() } : {}) }, settings);
}

/** « au bureau », « à Veldstraat 1 » (« Tu es déjà au bureau. »). */
export const atText = (to: Endpoint, settings: Settings): string => atTitle(towardsText(to, settings));

/** Nom d'un favori sur l'accueil du téléphone : « Vers le bureau », ou le libellé de l'arrêt (« Gare du Nord, tram »). */
export function favoriteName(f: Favorite, settings: Settings, answer?: FavoriteAnswer): string {
  if (f.kind === 'trip') return favoriteTitle(f, settings);
  const area = answer?.board?.area;
  return area ? areaLabel(area, settings.lang) : displayName(f.name, settings.lang);
}

/** Même trajet (favori ou recherche) : même départ et même arrivée. */
export function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'here') return true;
  if (a.type === 'place' && b.type === 'place') return a.placeId === b.placeId;
  if (a.type === 'area' && b.type === 'area') return a.areaId === b.areaId;
  if (a.type === 'address' && b.type === 'address') return a.label === b.label || (Math.abs(a.lat - b.lat) < 0.0003 && Math.abs(a.lon - b.lon) < 0.0004);
  return false;
}

/* ------------------------------ Trajets ------------------------------ */

const rides = (j: Journey) => j.legs.filter((l) => l.kind === 'ride');

/**
 * Heures d'une carte, comme le titre de l'écran des étapes (PRD L3) : départ à pied s'il y a une marche au début,
 * sinon départ estimé du premier véhicule ; arrivée finale.
 */
export function journeyTimes(j: Journey): { start: number; end: number } {
  return { start: journeyStart(j), end: j.arr };
}

/** Marche totale en minutes (départ, correspondances, arrivée). */
export function walkMinutesOf(j: Journey): number {
  return j.legs.filter((l) => l.kind === 'walk').reduce((s, l) => s + walkMinOf(l), 0);
}

/** « 07:33 → 08:56 », « demain 06:20 → 06:46 ». */
export function timesText(j: Journey, now: number): string {
  const { start, end } = journeyTimes(j);
  return spanText(start, end, now);
}

/** « 1 h 23, direct, 17 min à pied » ; trajet à pied : « 22 min à pied ». */
export function summaryText(j: Journey): string {
  const { start, end } = journeyTimes(j);
  const dur = durationText((end - start) / 60_000);
  if (!j.legs.some((l) => l.kind === 'ride')) return `${dur} à pied`;
  const walk = walkMinutesOf(j);
  return [dur, transfersText(j.transfers), walk ? `${walk} min à pied` : ''].filter(Boolean).join(', ');
}

const minutes = (ms: number): string => {
  const n = Math.max(0, Math.round(ms / 60_000));
  return n < 60 ? `${n} min` : durationText(n);
};

/** Minute affichée d'un instant (les cartes comparent des heures « HH:MM »). */
const minuteOf = (t: number): number => Math.floor(t / 60_000);

/** Étiquette d'une carte (« Le plus simple ») ; rien si le cœur n'en a pas donné. */
export const labelText = (j: Journey): string => (j.label ? LABEL_TEXT[j.label] : '');

/** Économie de marche qui compte (moins-de-marche.md § 1, seuil d'égalité du PRD § 4.1). */
export const LESS_WALK_MIN = 5;
/** Même créneau que « Le plus simple » : départ au plus 5 min avant (moins-de-marche.md § 1, condition 4). */
const SAME_SLOT_MIN = 5;

/**
 * « Le plus rapide » tient lieu de « Moins de marche » (moins-de-marche.md § 1, conditions 1 à 4) : un véhicule,
 * au moins 5 min de marche en moins, au plus un changement de plus, départ au plus 5 min avant « Le plus simple »
 * (il arrive plus tôt, par définition).
 */
export function fastWalksLess(fast: Journey, simple: Journey): boolean {
  if (!rides(fast).length) return false;
  const w = walkMinutesOf(simple) - walkMinutesOf(fast);
  const k = fast.transfers - simple.transfers;
  return w >= LESS_WALK_MIN && k <= 1 && minuteOf(journeyTimes(simple).start) - minuteOf(journeyTimes(fast).start) <= SAME_SLOT_MIN;
}

/** Phrase d'une carte (PRD § 6.2 T2, « Carte, phrase » ; moins-de-marche.md § 3). */
export function cardPhrase(j: Journey, result: PlanResult): string {
  const simple = result.journeys.find((x) => x.label === 'simple') ?? result.journeys[0];
  const others = result.journeys.filter((x) => x !== simple);
  switch (j.label) {
    case 'simple':
      // « … et aussi le plus rapide » seulement si aucune autre carte n'arrive plus tôt ; « Le moins de
      // changements. » si une autre carte fait marcher au moins 5 min de moins.
      if (!others.some((x) => minuteOf(x.arr) < minuteOf(j.arr))) return 'Le plus simple, et aussi le plus rapide.';
      if (others.some((x) => walkMinutesOf(j) - walkMinutesOf(x) >= LESS_WALK_MIN)) return 'Le moins de changements.';
      return 'Le moins de changements et de marche.';
    case 'fast': {
      const k = j.transfers - (simple?.transfers ?? j.transfers);
      const n = minutes((simple?.arr ?? j.arr) - j.arr);
      const changes = `${k} changement${k > 1 ? 's' : ''} de plus`;
      if (simple && fastWalksLess(j, simple)) {
        const w = walkMinutesOf(simple) - walkMinutesOf(j);
        return k >= 1 ? `Arrive ${n} plus tôt, avec ${changes} et ${w} min de marche en moins.` : `Arrive ${n} plus tôt, avec ${w} min de marche en moins.`;
      }
      return k >= 1 ? `Arrive ${n} plus tôt, avec ${changes}.` : `Arrive ${n} plus tôt, avec plus de marche.`;
    }
    case 'lesswalk': {
      const w = walkMinutesOf(simple ?? j) - walkMinutesOf(j);
      const d = minuteOf(j.arr) - minuteOf((simple ?? j).arr);
      const when = d === 0 ? 'même heure d’arrivée' : d > 0 ? `arrivée ${minutes(d * 60_000)} plus tard` : `arrivée ${minutes(-d * 60_000)} plus tôt`;
      return `${w} min de marche en moins, ${when}.`;
    }
    case 'earlier':
      return `Arrive ${minutes((simple?.arr ?? j.arr) - j.arr)} plus tôt, en partant à ${hhmm(journeyTimes(j).start)}.`;
    case 'none':
      return `Aucun changement, mais arrive ${minutes(j.arr - (simple?.arr ?? j.arr))} plus tard.`;
    case 'fewer':
      return `Moins de changements, mais arrive ${minutes(j.arr - (simple?.arr ?? j.arr))} plus tard.`;
    case 'walk':
      return `Sans attendre : ${minutes(j.arr - j.dep)} à pied.`;
    case 'next':
      return 'Même trajet, départ suivant.';
    case 'later':
      return 'Un autre trajet, plus tard.';
    default:
      return '';
  }
}

/* ------------------------------ Réponses courtes des favoris (S8) ------------------------------ */

/**
 * Réponse courte d'un favori sur l'accueil du téléphone (S8), règles des lunettes (PRD § 6.1 L1) avec une heure
 * plutôt qu'un compte à rebours, qui ne vieillit pas sur le téléphone : « partir à 07:33 » (CA-S8.1), « partir
 * maintenant », « partir demain 06:20 », « départ 14:10 », « à pied 12 min », « tu y es », « aucun trajet »,
 * « sans position », « … » ; arrêt : prochain départ (« T3 2 min », « IC 07:42 +2 v.6 ! »).
 */
export function shortAnswer(a: FavoriteAnswer | undefined, now: number, settings: Settings): string {
  if (!a) return '…';
  if (a.kind === 'stop') {
    if (a.state === 'missing') return T.stopMissing;
    const line = stopAnswerLine(a, now, settings);
    return line.right ? `${line.right}${line.tail ?? ''}` : 'aucun départ';
  }
  const line = tripAnswerLine(a, now, settings);
  const j = a.plan?.journeys[0];
  if (j && /^partir dans /.test(line.right)) return `partir à ${hhmm(j.leaveAt)}`;
  return line.right;
}

/* ------------------------------ Résultat vide (PRD § 6.3) ------------------------------ */

export type EmptyState =
  | { kind: 'text'; text: string }
  | { kind: 'station'; text: string; button: string; station: NonNullable<PlanResult['station']> };

/** Texte d'un calcul sans trajet, avec l'issue proposée (« Chercher vers Gand-Saint-Pierre »). */
export function emptyState(r: PlanResult, to: Endpoint, settings: Settings, opts: { web?: boolean } = {}): EmptyState {
  switch (r.empty) {
    case 'here':
      return { kind: 'text', text: `Tu es déjà ${atText(to, settings)}.` };
    case 'noPosition':
      return { kind: 'text', text: opts.web ? 'Position inconnue : autorise-la dans le navigateur, ou choisis un arrêt (onglet Lunettes, rubrique Position).' : 'Position inconnue : autorise la position pour Quai.' };
    case 'noStopFrom':
    case 'noStopTo':
      return { kind: 'text', text: noStopText(r.accessMin ?? settings.maxWalkMin * 2) };
    case 'noTrip':
      if (r.station) {
        const name = displayName(r.station.name, settings.lang);
        return { kind: 'station', text: noFullTripText(name), button: searchTowards(name), station: r.station };
      }
      return { kind: 'text', text: T.noTripNow };
    default:
      return { kind: 'text', text: T.noTripNow };
  }
}

/** Nom d'une langue de noms pour le service d'adresses (« Comme sur place » : français par défaut). */
export const geoLang = (lang: NameLang): 'fr' | 'nl' => (lang === 'nl' ? 'nl' : 'fr');
