/**
 * Textes du téléphone (PRD § 6.2 et § 6.3) : typographie française, cartes de trajets (titre, ligne « moyens »,
 * phrase ; PRD-1.2.1 § 7.2), jour férié (§ 5), réponses courtes des favoris, sous-titres des lieux, gares et lignes
 * choisies (PRD-1.2.2 § 4). Fonctions pures, sans DOM.
 */
import type { Endpoint, FavoriteAnswer, Journey, LineMatch, LinePick, Mode, NameLang, Op, Place, PlanResult, Propose, Settings } from '../core/api';
import { LABEL_TEXT } from '../core/api';
import { favoriteTitle, placeOf } from '../core/favorites';
import { displayLabel, HOLIDAY_TEXT, holidayName, longestWalk, meansText, rideName, walksMore } from '../core/means';
import { NB, shortAddress } from '../core/text';
import { displayName, hhmm, OP_NAME } from '../core/util';
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
  /** 1.2.2 (revue d'usage n° 5) : plus de « lieu », un lieu est un favori depuis la 1.2. */
  wherePlaceholder: 'Adresse, gare, arrêt ou favori',
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
  needName: 'Donne un nom à cet endroit.',
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
  name: 'Nom',
  save: 'Enregistrer',
  /** 1.2.2 (revue d'usage n° 11) : le créneau met le favori en tête de l'accueil ; « Jamais » devient « Automatique ». */
  proposeLegend: 'En tête de l’accueil',
  reorder: 'Changer l’ordre',
  up: 'Monter',
  down: 'Descendre',
  done: 'Terminé',
  /** « A à B » insécable, comme kindTrip. */
  favsLead: `Tes endroits et tes trajets de A${NB}à${NB}B. En tête dans les lunettes selon l’heure et ta position (réglage Affichage).`,
  maxWalk: 'Marche maximale',
  /** PRD-1.2.1 § 7.3 : paliers de marche, plus de marche seulement si les trajets qui restent dans la limite sont bien plus lents. */
  maxWalkSub: 'D’abord les trajets dans cette limite ; au-delà, s’il n’y a pas mieux',
  rtDown: 'Temps réel indisponible, horaires prévus',
  offline: 'Pas de réseau : réessaie dans un instant.',
  /** 1.2.2 (revue d'usage n° 9) : écran « Trajets » (marche maximale, marge) ; « Alertes » ne garde que les alertes. */
  trips: 'Trajets',
  margin: 'Marge avant de partir',
  marginSub: 'comprise dans l’heure de départ conseillée',
  leaveAlert: 'Heure de partir à pied',
  leaveAlertSub: 'à l’heure de départ conseillée',
  works: 'Travaux et déviations',
  worksSub: 'sur tes gares et tes lignes',
  /** 1.2.2 (PRD-1.2.2 § 4) : gares et lignes choisies, sur l'accueil du téléphone et dans l'onglet Réglages de Quai Web. */
  stations: 'Gares',
  lines: 'Bus, tram, métro',
  /** 1.2.6 (PRD-1.2.6 § 1) : les trois rubriques, chacune dit son mode. */
  stationsTitle: 'Gares de train',
  stopsTitle: 'Arrêts de bus, tram, métro',
  addStop: 'Ajouter un arrêt',
  noStop: 'Aucun arrêt pour l’instant.',
  addStation: 'Ajouter une gare',
  /** 1.2.3 (PRD-1.2.3 § 3) : « Bus, tram, métro » reçoit une ligne (à un arrêt) ou un arrêt entier. */
  addLine: 'Ajouter une ligne ou un arrêt',
  noStation: 'Aucune gare pour l’instant.',
  noLine: 'Aucune ligne ni arrêt pour l’instant.',
  /** 1.2.4 (PRD-1.2.4 § 2) : les deux blocs de « Bus, tram, métro », comme dans les lunettes. */
  stopsGroup: 'Arrêts',
  linesGroup: 'Lignes',
  /** Ouverture d'office des départs à moins de 300 m (`near`, l'ancien créneau « près » d'un arrêt favori). */
  pickNear: 'Ouvrir d’office à moins de 300 m',
  removePick: 'Retirer',
  stationExists: 'Déjà dans tes gares.',
  lineExists: 'Déjà dans tes lignes.',
  /** 1.2.4 : un arrêt (toutes ses lignes) déjà gardé, comme le dit son retrait (« de tes arrêts »). */
  stopExists: 'Déjà dans tes arrêts.',
  /** Type à droite d'une proposition déjà choisie. */
  stationTaken: 'déjà dans tes gares',
  lineTaken: 'déjà dans tes lignes',
  stopTaken: 'déjà dans tes arrêts',
  stationLead: 'Ses prochains trains s’afficheront dans les lunettes.',
  stationField: 'Nom de la gare',
  stationPlaceholder: 'Namur, Gand-Saint-Pierre…',
  stationNearby: 'Les plus proches de ta position.',
  stationNone: 'Aucune gare ne correspond. Vérifie l’orthographe.',
  lineLead: 'Toute la ligne s’affichera dans les lunettes, dans les deux sens, avec l’attente à chaque arrêt.',
  /** 1.2.3 : les deux choix de l'ajout (comme « Nouveau favori ») et « Un arrêt », toutes ses lignes. */
  kindsLegend: 'Une ligne ou un arrêt',
  kindLine: 'Une ligne',
  /** 1.2.6 : section « Lignes de bus, tram, métro » de l'accueil. */
  followsTitle: 'Lignes de bus, tram, métro',
  addFollow: 'Ajouter une ligne',
  noFollows: 'Aucune ligne pour l’instant.',
  bothWays: 'les deux sens',
  kindLineSub: 'numéro, les deux sens',
  kindStop: 'Un arrêt',
  kindStopSub: 'toutes ses lignes',
  stopLead: 'Tous ses départs s’afficheront dans les lunettes.',
  stopField: 'Nom de l’arrêt',
  stopSearchPlaceholder: 'Rogier, Gare du Nord…',
  stopSearchNone: 'Aucun arrêt de bus, tram ou métro ne correspond. Pour une gare, ajoute-la à tes gares.',
  stopsFound: 'Arrêts trouvés',
  lineField: 'Numéro de la ligne',
  linePlaceholder: 'W, 36, 71…',
  lineNone: 'Aucune ligne de bus, tram ou métro ne porte ce numéro. Pour un train, ajoute sa gare à tes gares.',
  linesFound: 'Lignes trouvées',
  whichStop: 'À quel arrêt ?',
  stopFilter: 'Filtrer les arrêts',
  stopPlaceholder: 'Nom de l’arrêt',
  stopsLoading: 'Chargement des arrêts…',
  stopNone: 'Aucun arrêt de cette ligne ne correspond.',
  stopsNone: 'Aucun arrêt trouvé pour cette ligne.',
  chosenStop: 'arrêt choisi',
  changeLine: 'Changer de ligne',
  anotherLine: 'Ajouter une autre ligne',
  searchDown: 'Recherche impossible pour l’instant : réessaie dans un instant.',
  /** « Un endroit » (revue d'usage n° 3 ; 1.2.6) : un arrêt de bus, tram ou métro mène à « Ajouter un arrêt », lui en tête. */
  nextPassagesLink: 'Ses prochains départs : l’ajouter à tes arrêts',
  /**
   * 1.2.9 (PRD-1.2.9 § 2) : l'accueil du téléphone en miroir de celui des lunettes, les autres réglages derrière un seul
   * bouton « Réglages ».
   */
  settings: 'Réglages',
  settingsLead: 'Favoris, gares, arrêts et lignes se règlent sur l’accueil, dans l’ordre des lunettes.',
  inGlasses: 'Dans tes lunettes',
  mirrorLead: 'Mêmes rubriques, même ordre.',
  preview: 'Aperçu',
  previewLabel: 'Aperçu de l’accueil des lunettes',
  favorites: 'Favoris',
  noFavShort: 'Aucun favori',
  nearby: 'Autour de moi',
  seeNews: 'Voir ce qui change',
  groupGlasses: 'Dans les lunettes',
  groupTrips: 'Tes trajets',
  groupQuai: 'Quai',
  groupHome: 'Accueil des lunettes',
  groupAll: 'Sur tous les écrans',
  placeLang: 'Position et langue',
  display: 'Affichage',
  alerts: 'Alertes',
  data: 'Données',
  sources: 'Données : SNCB, STIB, De Lijn, TEC via Belgian Mobility Company',
} as const;

/** Titre de la bannière « Nouveau » de l'accueil (1.2.9 : sur une ligne, les nouveautés dépliées à la demande). */
export const newsTitle = (version: string): string => `Nouveau dans Quai ${version}`;

/** « 1 gare », « 2 arrêts », « 3 lignes » : comme à droite des rubriques de l'accueil des lunettes. */
export const counted = (n: number, word: string): string => `${n}${NB}${word}${n > 1 ? 's' : ''}`;

/** Sous-titre de « Autour de moi » : le rayon réglé (« à moins de 500 m »). */
export const withinText = (radiusM: number): string => typo(`à moins de ${radiusM} m`);

/** Langue des noms (sous-titre de « Position et langue »). */
export const LANG_TEXT: Record<NameLang, string> = { fr: 'Noms en français', nl: 'Noms en néerlandais', local: 'Noms comme sur place' };

/** Sous-titre de « Affichage » dans Réglages : le rayon, puis le signe « ~ » et la pluie s'ils sont allumés. */
export function displaySummary(d: Pick<Settings['display'], 'radiusM' | 'markPlanned' | 'rain'>): string {
  const parts = [`Rayon ${d.radiusM} m`, d.markPlanned ? 'horaires prévus « ~ »' : '', d.rain !== false ? 'pluie pendant la marche' : ''];
  return typo(parts.filter(Boolean).join(', '));
}

/** Sous-titre de « Alertes » : les alertes allumées, le retard avec son seuil (« retard dès 5 min »). */
export function alertsSummary(a: Pick<Settings['alerts'], 'platform' | 'delay' | 'delayMin' | 'cancel' | 'leave' | 'works'>): string {
  const on = [a.platform && 'voie', a.delay && `retard dès ${a.delayMin} min`, a.cancel && 'suppression', a.leave && 'départ à pied', a.works && 'travaux'].filter(Boolean) as string[];
  if (!on.length) return 'Aucune alerte';
  const t = on.join(', ');
  return typo(t.charAt(0).toUpperCase() + t.slice(1));
}

/**
 * Bannière « Nouveau » de l'accueil du téléphone, message « Quai 1.2.5 » (PRD-1.2.5 § 8) : une ligne par nouveauté,
 * comme les lunettes et Quai Web.
 */
export const NEWS_125: readonly string[] = [
  'Dans les étapes, quand tu pars bientôt : l’heure d’arrivée si tu rates ton départ.',
  'Une correspondance de 5 min ou moins montre sa marge.',
  'La pluie prévue est dite sur les marches de 5 min ou plus (réglage dans Affichage).',
  'Dans le train, le bus, le tram ou le métro : ta progression jusqu’à la descente.',
  'Bus, tram, métro dans les lunettes : la ligne et sa destination en clair, un départ par ligne.',
];

/** Nouveautés de la 1.2.4 (PRD-1.2.4 § 5) : dites aussi à qui passe d'une version antérieure directement à la 1.2.5. */
export const NEWS_124: readonly string[] = [
  'Dans les étapes, l’arrêt ou la gare où aller est écrit en entier.',
  'Bus, tram, métro : tes arrêts et tes lignes en deux blocs.',
  'L’accueil des lunettes dit combien de gares, d’arrêts et de lignes tu suis.',
  'Dans les lunettes, des heures alignées et des aides plus discrètes.',
];

/** Nouveautés de la 1.2.3 (PRD-1.2.3 § 4) : dites aussi à qui passe d'une version antérieure directement à la 1.2.4. */
export const NEWS_123: readonly string[] = [
  'Tableaux complets dans les lunettes : tous les départs des 2 prochaines heures.',
  'Touche un départ : ses arrêts jusqu’au terminus, avec l’heure et la voie.',
  'Bus, tram, métro : ajoute une ligne ou un arrêt.',
];

/**
 * Nouveautés de la 1.2.2 (PRD-1.2.2 § 9, revue d'usage n° 4) : dites aussi à qui passe d'une version antérieure
 * directement à la 1.2.4 (arrêts favoris rangés, « Aller à… » dans Favoris, trajet suivi sur demande).
 */
export const NEWS_122: readonly string[] = [
  'Nouveau : tes gares et tes lignes de bus, tram et métro sur l’accueil des lunettes.',
  'Tes arrêts favoris y sont rangés, rien n’est perdu.',
  'Dans les lunettes, Aller à… a rejoint Favoris.',
  'Un trajet n’est suivi que si tu le demandes.',
];

/** 1.2.6 : nouveautés de la bannière (comme le message « Quai 1.2.6 » des lunettes). */
export const NEWS_126: readonly string[] = [
  'Gares de train, arrêts et lignes de bus, tram, métro : trois rubriques séparées.',
  'Une ligne se suit maintenant en entier, dans les deux sens, sans choisir d’arrêt : les lunettes montrent l’attente à chacun de ses arrêts.',
  'Pour ajouter une ligne ou un arrêt, ceux près de toi sont proposés, chaque ligne à sa couleur.',
  'Tes lignes gardées à un arrêt sont déjà dans Lignes.',
];

/** 1.2.9 : nouveautés de la bannière (comme le message « Quai 1.2.9 » des lunettes). */
export const NEWS_129: readonly string[] = [
  'Dans les lunettes, « imminent » ne s’affiche plus qu’avec le temps réel ; sur l’horaire prévu, c’est « dans ~1 min ».',
  'L’accueil du téléphone reprend celui des lunettes, mêmes rubriques et même ordre ; tous les autres réglages sont derrière le bouton « Réglages ».',
  'Gares, arrêts et lignes ont chacun leur écran : touche un élément pour l’ouvrir d’office, changer son ordre ou le retirer, et ajoute ceux près de toi sur place.',
];

/** 1.2.9 : les mêmes sur Quai Web, où la page du téléphone est l'onglet Réglages. */
export const NEWS_129_WEB: readonly string[] = [
  NEWS_129[0],
  'L’onglet Réglages reprend l’accueil des lunettes, mêmes rubriques et même ordre ; tous les autres réglages sont derrière le bouton « Réglages ».',
  NEWS_129[2],
];

/** 1.2.8 : nouveautés de la bannière (comme le message « Quai 1.2.8 » des lunettes). */
export const NEWS_128: readonly string[] = [
  'Dans les lunettes, touche un train au tableau d’une gare : tout son trajet, des gares d’avant jusqu’au terminus.',
  'À chaque gare, sa voie et le prochain passage en clair (« dans 6 min ») ; ● montre où arrive le train, d’après le temps réel.',
];

/** 1.2.6 : une nouveauté d'avant qui parle de « Bus, tram, métro », devenu deux rubriques, n'est plus dite. */
const stillTrue = (l: string): boolean => !/^Bus, tram, métro\b/.test(l);

/**
 * Lignes de la bannière « Nouveau » (une seule bannière, montrée une fois) : celles de la 1.2.9 ; depuis une version
 * antérieure (`seen` : la version vue avant la mise à jour), celles des versions sautées ensuite, de la plus récente à
 * la plus ancienne, sans celles qui ne sont plus vraies.
 */
export function newsLines(seen = '', web = false): string[] {
  const out = [...(web ? NEWS_129_WEB : NEWS_129)];
  if (seen && compareVersions(seen, '1.2.8') < 0) out.push(...NEWS_128);
  if (seen && compareVersions(seen, '1.2.6') < 0) out.push(...NEWS_126);
  if (seen && compareVersions(seen, '1.2.5') < 0) out.push(...NEWS_125.filter(stillTrue));
  if (seen && compareVersions(seen, '1.2.4') < 0) out.push(...NEWS_124.filter(stillTrue));
  if (seen && compareVersions(seen, '1.2.3') < 0) out.push(...NEWS_123.filter(stillTrue));
  if (seen && compareVersions(seen, '1.2.2') < 0) out.push(...NEWS_122);
  return out;
}

/** Suppression d'un lieu utilisé par un trajet fixe (PRD-1.2 § 2.2). */
export const removeUsedPlaceText = (name: string): string => `Supprimer « ${name} » ? Les trajets fixes qui l’utilisent seront aussi supprimés.`;
/** Limite des favoris atteinte (PRD-1.2 § 2.2). */
export const limitText = (max: number): string => `${max} favoris au plus : supprimes-en un.`;
/** 1.2.2 : limites des gares et des lignes atteintes (LIMITS.stations, LIMITS.lines de settings.ts). */
export const stationLimitText = (max: number): string => `${max} gares au plus : retires-en une.`;
/** 1.2.6 : les lignes suivies et les arrêts ont chacun leur limite (LIMITS.lines). */
export const lineLimitText = (max: number): string => `${max} lignes au plus : retires-en une.`;
export const stopLimitText = (max: number): string => `${max} arrêts au plus : retires-en un.`;
/** 1.2.2 : gare ajoutée (« Ajouter une gare », lien de « Un endroit », revue d'usage n° 3). */
export const stationAddedText = (name: string): string => `${name} ajoutée à tes gares.`;
/** 1.2.3 : arrêt ajouté avec toutes ses lignes (PRD-1.2.3 § 3). */
export const stopAddedText = (name: string): string => `${name} ajouté : tous ses départs s’afficheront dans les lunettes.`;
/** « Un endroit » (revue d'usage n° 3) : une gare SNCB choisie, ses départs dans « Gares de train » (1.2.6 : « à tes gares »). */
export const nextDeparturesLink = (name: string): string => `Ses prochains départs : ajouter ${name} à tes gares`;
/** Retrait d'une gare ou d'une ligne, confirmé dans la page, puis annoncé. */
export const removeStationText = (name: string): string => `Retirer ${name} de tes gares ?`;
export const removeLineText = (name: string): string => `Retirer ${name} de tes lignes ?`;
export const stationGoneText = (name: string): string => `${name} n’est plus dans tes gares.`;
export const lineGoneText = (name: string): string => `${name} n’est plus dans tes lignes.`;
/** 1.2.4 : un arrêt (toutes ses lignes) de « Bus, tram, métro ». */
export const removeStopText = (name: string): string => `Retirer ${name} de tes arrêts ?`;
export const stopGoneText = (name: string): string => `${name} n’est plus dans tes arrêts.`;
/** « Ajouter une ligne » depuis un arrêt (?arret=…) : ses lignes en raccourcis, et une ligne qui n'y passe pas. */
export const stopLinesText = (stop: string): string => (stop ? `Lignes à ${stop} :` : 'Lignes de cet arrêt :');
export const notServedText = (stop: string): string => `Cette ligne ne passe pas à ${stop}.`;
/** Rang annoncé après « Monter » ou « Descendre » : « Namur : 2e sur 3. » */
export const rankText = (name: string, rank: number, total: number): string => `${name} : ${rank === 1 ? '1er' : `${rank}e`} sur ${total}.`;
export const noStopText = (min: number): string => `Aucun arrêt à moins de ${min} min à pied de cette adresse.`;
export const noFullTripText = (station: string): string => `Pas de trajet complet. Essaie ${station}, puis le tram.`;
export const searchTowards = (station: string): string => `Chercher vers ${station}`;
/** Annonce du nombre de résultats (« 3 trajets. »). */
export const tripsCount = (n: number): string => `${n} trajet${n > 1 ? 's' : ''}.`;

/**
 * « En tête de l’accueil » (revue d'usage n° 11, mêmes valeurs enregistrées) : créneaux avec leurs heures (S3) ;
 * « Automatique » (never) laisse l'ordre des favoris décider.
 */
export const PROPOSE_LABEL: Record<Propose, string> = {
  never: 'Automatique',
  near: 'L’ouvrir d’office à moins de 300 m',
  morning: 'Le matin (5 h à 11 h)',
  evening: 'Le soir (15 h à 21 h)',
};
/** Ordre des créneaux d'un trajet fixe : Automatique, le matin, le soir, d'office à moins de 300 m. */
export const PROPOSE_ORDER: readonly Propose[] = ['never', 'morning', 'evening', 'near'];
/** Créneaux d'un lieu (PRD-1.2 § 2.2) : l'ouverture d'office à moins de 300 m n'a pas de sens pour un lieu. */
export const PLACE_PROPOSE: readonly Propose[] = ['never', 'morning', 'evening'];
/** Fin du sous-titre d'un favori : « en tête le matin ». */
export const PROPOSE_TEXT: Record<Propose, string> = { never: '', near: 'ouvert d’office à moins de 300 m', morning: 'en tête le matin', evening: 'en tête le soir' };

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

/* ------------------------------ Gares et lignes choisies (1.2.2) ------------------------------ */

/** Nom d'une ligne : « Bus W », « Tram 3 », « Métro 2 » (mot et numéro, `rideName` du cœur) ; mode inconnu : « Ligne 3 ». */
export function lineName(l: { op: Op; line: string; mode?: Mode }): string {
  if (!l.mode || l.mode === 'train') return `Ligne ${l.line}`;
  const n = rideName({ op: l.op, mode: l.mode, line: l.line });
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/**
 * Titre d'une ligne choisie (PRD-1.2.2 § 3 et § 4) : « Bus W · Merbraine » ; sans ligne (arrêt favori de la 1.2.1
 * sans filtre, migré) : « Gare du Nord · toutes les lignes ». `mode` : le mode s'il est connu autrement (linesAt).
 */
export function linePickTitle(p: Pick<LinePick, 'op' | 'name' | 'line' | 'mode'>, lang: NameLang, mode: Mode | undefined = p.mode): string {
  const stop = displayName(p.name, lang);
  return p.line ? `${lineName({ op: p.op, line: p.line, mode })} · ${stop}` : `${stop} · toutes les lignes`;
}

/** Ligne trouvée par son numéro (PRD-1.2.2 § 4) : « Bus W TEC, Braine-l’Alleud ↔ Bruxelles Midi ». */
export function lineMatchText(m: Pick<LineMatch, 'op' | 'mode' | 'line' | 'ends'>, lang: NameLang): string {
  const ends = m.ends.map((e) => displayName(e, lang)).join(' ↔ ');
  return `${lineName(m)} ${OP_NAME[m.op]}${ends ? `, ${ends}` : ''}`;
}

/** Confirmation d'une ligne ajoutée (PRD-1.2.2 § 4) : « Bus W à Merbraine ajouté : les deux sens s’afficheront dans les lunettes. » */
/** 1.2.6 : ligne ajoutée entière, sans arrêt : « Tram 3 ajouté à tes lignes, dans les deux sens : Churchill ↔ Esplanade. » */
export function lineAddedText(named: string, ends: string): string {
  // « Bus », « Tram », « Métro » sont masculins ; « Ligne » (mode inconnu) est féminin.
  const added = named.startsWith('Ligne ') ? 'ajoutée' : 'ajouté';
  return ends ? `${named} ${added} à tes lignes, dans les deux sens : ${ends}.` : `${named} ${added} à tes lignes, dans les deux sens.`;
}

/** 1.2.6 : ligne déjà suivie. */
export function lineFollowedText(named: string): string {
  return `${named} est déjà dans tes lignes.`;
}

/** Distance d'une proposition, à droite : « ici », « 450 m », « 1,2 km », « 52 km ». */
export function distanceText(m: number): string {
  if (m < 50) return 'ici';
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  if (m < 9950) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  return `${Math.round(m / 1000)} km`;
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

/**
 * « 1 h 23, direct » ; trajet à pied : « 22 min à pied ». 1.2.2 (revue d’usage n° 13) : plus la marche, que la ligne
 * « moyens » détaille (« à pied 2 + 2 + 3 min ») et dont la phrase parle au besoin.
 */
export function summaryText(j: Journey): string {
  const { start, end } = journeyTimes(j);
  const dur = durationText((end - start) / 60_000);
  if (!j.legs.some((l) => l.kind === 'ride')) return `${dur} à pied`;
  return `${dur}, ${transfersText(j.transfers)}`;
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
 * marche : « IC + IC ». Trajet à pied : rien, la carte le dit déjà (« 22 min à pied », « À pied, sans transport »),
 * sauf la pluie prévue (1.2.5 : « pluie prévue »).
 */
export function meansLine(j: Journey): string {
  // 1.2.5 : comme dans les lunettes, la pluie prévue sur une marche de 5 min ou plus
  const rainy = j.legs.some((l) => l.kind === 'walk' && !!l.rain && walkMinOf(l) >= 5);
  if (!j.legs.some((l) => l.kind === 'ride')) return rainy ? 'pluie prévue' : '';
  const w = walksOf(j);
  if (!w.length) return meansText(j);
  const rain = rainy ? ', pluie prévue' : '';
  return `${meansText(j)}, ${w.length > 3 ? `${w.reduce((s, m) => s + m, 0)} min à pied` : `à pied ${w.join(' + ')} min`}${rain}`;
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
