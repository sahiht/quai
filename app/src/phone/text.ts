/**
 * Textes du téléphone (PRD § 6.2 et § 6.3) : typographie française, cartes de trajets (titre, ligne « moyens »,
 * phrase ; PRD-1.2.1 § 7.2), jour férié (§ 5), réponses courtes des favoris, sous-titres des lieux. Fonctions pures,
 * sans DOM.
 */
import type { Endpoint, Favorite, FavoriteAnswer, Journey, NameLang, Place, PlanResult, Propose, Settings } from '../core/api';
import { LABEL_TEXT } from '../core/api';
import { favoriteTitle, placeOf } from '../core/favorites';
import { displayLabel, HOLIDAY_TEXT, holidayName, longestWalk, meansText, walksMore } from '../core/means';
import { NB, shortAddress } from '../core/text';
import { areaLabel, displayName, hhmm } from '../core/util';
import { atTitle, durationText, journeyStart, spanText, stopAnswerLine, transfersText, tripAnswerLine, walkMinOf } from '../glasses/format';
import { compareVersions } from '../version';
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
  /** Quai Web, rubrique « Position » (PRD-1.2 § 3). */
  privacyWeb: 'Adresses : services officiels des Régions bruxelloise, flamande et wallonne. Seul le texte tapé leur est envoyé.',
  addrDown: 'Adresses indisponibles pour l’instant : gares et arrêts seulement.',
  addrOffline: 'Recherche d’adresse impossible sans connexion : gares et arrêts seulement.',
  nothing: 'Aucune adresse, gare ou arrêt ne correspond. Ajoute la commune, ou vérifie l’orthographe.',
  addrHint: 'Pour une adresse, ajoute la rue et le numéro.',
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
  hereOption: 'Ma position actuelle',
  hereSearching: 'Recherche de ta position…',
  hereDown: 'Position indisponible : autorise la position pour Quai dans l’appli Even, ou choisis une adresse ou un arrêt.',
  hereDownWeb: 'Position indisponible : autorise-la dans le navigateur, ou choisis une adresse ou un arrêt.',
  needName: 'Donne un nom au lieu.',
  needSpot: 'Choisis une adresse ou un arrêt dans la liste.',
  clearRecent: 'Effacer les adresses récentes',
  recentTitle: 'Adresses récentes',
  remove: 'Supprimer',
  cancel: 'Annuler',
  removeFav: 'Supprimer ce favori ?',
  removeFavButton: 'Supprimer ce favori',
  stopMissing: 'Arrêt introuvable : choisis-le à nouveau',
  noFav: 'Aucun favori pour l’instant.',
  manageFavs: 'Gérer mes favoris',
  myFavs: 'Mes favoris',
  addFav: 'Ajouter un favori',
  newFav: 'Nouveau favori',
  favField: 'Adresse, gare ou arrêt',
  /** « Nouveau favori » : les deux choix du haut (PRD-1.2.1 § 7.1) et leur nom pour les lecteurs d'écran. */
  kindLegend: 'Type de favori',
  kindPlace: 'Un endroit',
  kindPlaceSub: 'adresse, gare ou arrêt',
  /** « A à B » insécable : jamais un « B » seul sur sa ligne (téléphone étroit). */
  kindTrip: `Un trajet de A${NB}à${NB}B`,
  kindTripSub: 'départ et arrivée fixes',
  fixedTrip: 'Trajet fixe',
  allLines: 'Toutes les lignes',
  name: 'Nom',
  save: 'Enregistrer',
  inGlasses: 'Dans les lunettes',
  nextDepartures: 'Ses prochains départs',
  tripThere: 'Le trajet pour y aller',
  proposeLegend: 'Le proposer à l’ouverture',
  reorder: 'Changer l’ordre',
  up: 'Monter',
  down: 'Descendre',
  done: 'Terminé',
  favsLead: 'Tes lieux, tes arrêts et tes trajets. En tête dans les lunettes selon l’heure et le lieu (réglage Affichage).',
  maxWalk: 'Marche maximale',
  /** PRD-1.2.1 § 7.3 : paliers de marche, plus de marche seulement si les trajets qui restent dans la limite sont bien plus lents. */
  maxWalkSub: 'D’abord les trajets dans cette limite ; au-delà, s’il n’y a pas mieux',
  rtDown: 'Temps réel indisponible, horaires prévus',
  offline: 'Pas de réseau : réessaie dans un instant.',
} as const;

/** Version où les lieux sont devenus des favoris : qui vient d'avant lit une ligne de plus dans la bannière. */
const PLACES_AS_FAVORITES = '1.2.0';

/**
 * Bannière « Nouveau » de l'accueil du téléphone (PRD-1.2.1 § 6) : les nouveautés du message « Quai 1.2.1 » des
 * lunettes, dans le même ordre, dites depuis le téléphone (le ▼ et l'accueil sont ceux des lunettes) ; depuis une
 * version antérieure à la 1.2.0, « Tes lieux sont maintenant dans tes favoris. » en plus. `seen` : la version vue avant
 * la mise à jour.
 */
export function newsLines(seen: string): string[] {
  const lines = ['Nouveau : le moins de marche d’abord.', 'Dans les lunettes, sur un trajet, ▼ : la suite, puis les autres trajets.', 'Accueil des lunettes plus simple : tes favoris en tête.'];
  if (seen && compareVersions(seen, PLACES_AS_FAVORITES) < 0) lines.push('Tes lieux sont maintenant dans tes favoris.');
  return lines;
}

/** Suppression d'un lieu utilisé par un trajet fixe (PRD-1.2 § 2.2). */
export const removeUsedPlaceText = (name: string): string => `Supprimer « ${name} » ? Les trajets fixes qui l’utilisent seront aussi supprimés.`;
/** Limite des favoris atteinte (PRD-1.2 § 2.2). */
export const limitText = (max: number): string => `${max} favoris au plus : supprimes-en un.`;
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
/** Créneaux d'un lieu (PRD-1.2 § 2.2) : « Quand je suis à moins de 300 m » n'a pas de sens pour un lieu. */
export const PLACE_PROPOSE: readonly Propose[] = ['never', 'morning', 'evening'];
/** Fin du sous-titre d'un favori : « proposé le matin ». */
export const PROPOSE_TEXT: Record<Propose, string> = { never: '', near: 'proposé à moins de 300 m', morning: 'proposé le matin', evening: 'proposé le soir' };

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
  return placeOf(settings, e.placeId)?.label ?? 'Lieu';
}

/**
 * « Vers le bureau », « Vers Veldstraat 1 », « Vers Gand-Saint-Pierre » : titre d'un trajet vers `to`, règles du cœur
 * (favoriteTitle : article pour un nom commun connu, sinon le nom tel quel), comme dans les lunettes.
 */
export function towardsText(to: Endpoint, settings: Settings): string {
  return favoriteTitle(to, settings);
}

/** « au bureau », « à Veldstraat 1 » (« Tu es déjà au bureau. »). */
export const atText = (to: Endpoint, settings: Settings): string => atTitle(towardsText(to, settings));

/** Nom d'un favori sur l'accueil du téléphone : « Vers le bureau » (lieu, trajet), ou le libellé de l'arrêt. */
export function favoriteName(f: Favorite, settings: Settings, answer?: FavoriteAnswer): string {
  if (f.kind !== 'stop') return favoriteTitle(f, settings);
  const area = answer?.board?.area;
  return area ? areaLabel(area, settings.lang) : f.op === 'sncb' ? `${displayName(f.name, settings.lang)}, train` : displayName(f.name, settings.lang);
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
  if (!j.legs.some((l) => l.kind === 'ride')) return `${dur} à pied`;
  const walk = walkMinutesOf(j);
  return [dur, transfersText(j.transfers), walk ? `${walk} min à pied` : ''].filter(Boolean).join(', ');
}

/** « 13 min », « 1 h 05 » (un nombre de minutes). */
const span = (n: number): string => (n < 60 ? `${n} min` : durationText(n));
const minutes = (ms: number): string => span(Math.max(0, Math.round(ms / 60_000)));

/** Minute affichée d'un instant (les cartes comparent des heures « HH:MM »). */
const minuteOf = (t: number): number => Math.floor(t / 60_000);

/**
 * Titre d'une carte (PRD-1.2.1 § 7.2) : le nom affiché de la proposition (`displayLabel` : la première s'appelle
 * « Moins de marche » quand une proposition « Plus tôt » marche plus qu'elle, sinon « Le plus court » ; jamais deux
 * « Moins de marche ») ; rien si le cœur n'a pas donné d'étiquette.
 */
export const cardTitle = (j: Journey, result: PlanResult): string => (j.label ? displayLabel(j, result.journeys) : '');

/** Marches d'au moins 1 min, dans l'ordre du trajet. */
const walksOf = (j: Journey): number[] =>
  j.legs
    .filter((l) => l.kind === 'walk')
    .map((l) => Math.round(walkMinOf(l)))
    .filter((m) => m >= 1);

/**
 * Ligne « moyens » d'une carte (PRD-1.2.1 § 2.3 et § 7.2) : comment on voyage (`meansText`), puis les marches dans
 * l'ordre : « bus W + S1, à pied 4 + 5 min » ; plus de 3 marches : « bus 36 + IC + métro 2, 12 min à pied » ; sans
 * marche : « IC + IC ». Trajet à pied : rien, la carte le dit déjà (« 22 min à pied », « À pied, sans transport »).
 */
export function meansLine(j: Journey): string {
  if (!j.legs.some((l) => l.kind === 'ride')) return '';
  const w = walksOf(j);
  if (!w.length) return meansText(j);
  return `${meansText(j)}, ${w.length > 3 ? `${w.reduce((s, m) => s + m, 0)} min à pied` : `à pied ${w.join(' + ')} min`}`;
}

/** Largeur d'un palier de marche, en minutes (PRD-1.2.1 § 1.1). */
export const WALK_TIER_MIN = 5;

/**
 * Palier de marche d'un trajet (PRD-1.2.1 § 1.1) : 0 si sa plus longue marche L tient dans la marche maximale M,
 * sinon ceil((L − M) / 5). Avec M = 5 : jusqu'à 5 min palier 0, de 6 à 10 palier 1, de 11 à 15 palier 2.
 */
export function walkTier(j: Pick<Journey, 'legs'>, maxWalkMin: number): number {
  const l = longestWalk(j);
  return l <= maxWalkMin ? 0 : Math.ceil((l - maxWalkMin) / WALK_TIER_MIN);
}

/**
 * Phrase d'une carte (PRD-1.2.1 § 7.2, alignée sur les raisons du § 2.2) : pourquoi le trajet passe devant ou
 * derrière la proposition 1. Elle ne lit que les étiquettes, les heures et les marches, jamais `reason` (écrite par le
 * cœur pour une ligne des lunettes). `maxWalkMin` : la marche maximale réglée (paliers de marche, § 1.1).
 *  - Proposition 1 : « Arrive le plus tôt. » ; si un trajet arrive avant elle en marchant plus (son nom affiché est
 *    alors « Moins de marche », ou ce trajet est d'un palier plus haut) : « Arrive 13 min après le plus rapide, avec
 *    moins de marche. » ; s'il arrive avant en partant plus tôt : « Le plus court sans partir plus tôt. »
 *  - Plus tôt : « Plus tôt de 13 min, mais 19 min à pied. » (sa plus longue marche, s'il marche plus que la
 *    proposition 1 : walksMore, comme displayLabel), sinon « Plus tôt de 13 min, en partant à 19:20. »
 *  - Moins de marche : « Arrive 25 min plus tard, avec moins de marche. »
 *  - Sans changement, Moins de changements : règles de la 1.2, la « marche longue » devenant un palier plus haut que
 *    la proposition 1 (« Aucun changement, arrive 3 min plus tôt, mais avec 15 min à pied. ») ; à la même heure
 *    d'arrivée aussi, la marche passe avant le départ plus tôt (« Aucun changement, même heure d’arrivée, mais avec
 *    19 min à pied. »).
 *  - À pied, Le suivant, Plus tard : phrases de la 1.1.
 */
export function cardPhrase(j: Journey, result: PlanResult, maxWalkMin: number): string {
  const all = result.journeys;
  const first = all.find((x) => x.label === 'short') ?? all[0] ?? j;
  const tier = (x: Journey): number => walkTier(x, maxWalkMin);
  const start = (x: Journey): number => journeyTimes(x).start;
  /** Minutes d'arrivée après la proposition 1 (négatif : avant elle). */
  const later = (x: Journey): number => minuteOf(x.arr) - minuteOf(first.arr);
  const changes = (prefix: string): string => {
    const d = later(j);
    if (d > 0) return `${prefix}, mais arrive ${span(d)} plus tard.`;
    // Arrive un peu avant la proposition 1 (moins de 5 min, ou en marchant plus), ou en même temps : comme la carte
    // « Plus tôt », sa marche (palier plus haut), sinon son départ plus tôt, disent pourquoi elle n'est pas en tête ;
    // jamais « même heure d’arrivée » si elle arrive avant.
    const walk = tier(j) > tier(first) ? `mais avec ${longestWalk(j)} min à pied` : '';
    if (d < 0) {
      const n = span(-d);
      if (walk) return `${prefix}, arrive ${n} plus tôt, ${walk}.`;
      return minuteOf(start(j)) < minuteOf(start(first)) ? `${prefix}, arrive ${n} plus tôt, en partant à ${hhmm(start(j))}.` : `${prefix}, arrive ${n} plus tôt.`;
    }
    if (walk) return `${prefix}, même heure d’arrivée, ${walk}.`;
    const sooner = minuteOf(start(first)) - minuteOf(start(j));
    return sooner > 0 ? `${prefix}, en partant ${span(sooner)} plus tôt.` : `${prefix}, même heure d’arrivée.`;
  };
  switch (j.label) {
    case 'short': {
      const sooner = all.filter((x) => x !== j && minuteOf(x.arr) < minuteOf(j.arr));
      if (!sooner.length) return 'Arrive le plus tôt.';
      // « le plus rapide » : le trajet qui arrive le plus tôt (« Plus tôt », ou un autre qui arrive un peu avant).
      const fastest = sooner.reduce((a, b) => (b.arr < a.arr ? b : a));
      const lessWalk = `Arrive ${span(minuteOf(j.arr) - minuteOf(fastest.arr))} après le plus rapide, avec moins de marche.`;
      if (displayLabel(j, all) === LABEL_TEXT.lesswalk || tier(fastest) > tier(j)) return lessWalk;
      if (minuteOf(start(fastest)) < minuteOf(start(j))) return 'Le plus court sans partir plus tôt.';
      // même palier, même départ : seule sa marche plus longue l'explique ; sinon rien d'exact à dire
      return walksMore(fastest, j) ? lessWalk : '';
    }
    case 'earlier': {
      // « marche plus » : la règle de displayLabel (walksMore), pour que ce nom et cette phrase disent la même chose.
      const tail = walksMore(j, first) ? `mais ${longestWalk(j)} min à pied` : `en partant à ${hhmm(start(j))}`;
      const gain = -later(j);
      return gain > 0 ? `Plus tôt de ${span(gain)}, ${tail}.` : `Même heure d’arrivée, ${tail}.`;
    }
    case 'lesswalk': {
      const d = later(j);
      if (d > 0) return `Arrive ${span(d)} plus tard, avec moins de marche.`;
      return d === 0 ? 'Même heure d’arrivée, avec moins de marche.' : `Arrive ${span(-d)} plus tôt, avec moins de marche.`;
    }
    case 'none':
      return changes('Aucun changement');
    case 'fewer':
      return changes('Moins de changements');
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

/**
 * Ligne « Jour férié : horaires du dimanche » au-dessus des résultats d'une recherche (PRD-1.2.1 § 5 et § 7.4) : un
 * trajet proposé part un jour férié national belge (heure de Bruxelles) ; rien les autres jours, ni sans trajet.
 */
export function holidayLine(result: Pick<PlanResult, 'journeys'> | null | undefined): string {
  return result?.journeys.some((j) => holidayName(journeyTimes(j).start)) ? HOLIDAY_TEXT : '';
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
      return { kind: 'text', text: opts.web ? 'Position inconnue : autorise-la dans le navigateur, ou choisis une adresse ou un arrêt (onglet Lunettes, rubrique Position).' : 'Position inconnue : autorise la position pour Quai.' };
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
