/**
 * Textes du téléphone (PRD § 6.2 et § 6.3) : typographie française, cartes de trajets (titre, ligne « moyens »,
 * phrase ; PRD-1.2.1 § 7.2), jour férié (§ 5), réponses courtes des favoris, sous-titres des lieux, gares et lignes
 * choisies (PRD-1.2.2 § 4). Fonctions pures, sans DOM.
 */
import type { Endpoint, FavoriteAnswer, Journey, LineMatch, LinePick, Mode, NameLang, Op, Place, PlanResult, Propose, Settings } from '../core/api';
import { LABEL_TEXT } from '../core/api';
import type { GuideStatus } from '../core/guide-types';
import type { JournalTrip } from '../core/journal-types';
import { favoriteTitle, placeOf } from '../core/favorites';
import { displayLabel, HOLIDAY_TEXT, holidayName, longestWalk, meansText, rideName, walksMore } from '../core/means';
import { NB, shortAddress } from '../core/text';
import { apos } from '../core/typo';
import { brusselsParts, displayName, hhmm, OP_NAME } from '../core/util';
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
  /** 1.2.2 (PRD-1.2.2 § 4) : nom de la liste des gares proposées à l'ajout (lecteurs d'écran). */
  stations: 'Gares',
  /** 1.2.6 (PRD-1.2.6 § 1) : les trois rubriques, chacune dit son mode. */
  stationsTitle: 'Gares de train',
  stopsTitle: 'Arrêts de bus, tram, métro',
  addStop: 'Ajouter un arrêt',
  noStop: 'Aucun arrêt pour l’instant.',
  addStation: 'Ajouter une gare',
  noStation: 'Aucune gare pour l’instant.',
  removePick: 'Retirer',
  stationExists: 'Déjà dans tes gares.',
  /** 1.2.4 : un arrêt (toutes ses lignes) déjà gardé, comme le dit son retrait (« de tes arrêts »). */
  stopExists: 'Déjà dans tes arrêts.',
  /** Type à droite d'une proposition déjà choisie. */
  stationTaken: 'déjà dans tes gares',
  lineTaken: 'déjà dans tes lignes',
  stopTaken: 'déjà dans tes arrêts',
  stationField: 'Nom de la gare',
  stationPlaceholder: 'Namur, Gand-Saint-Pierre…',
  stationNone: 'Aucune gare ne correspond. Vérifie l’orthographe.',
  /** 1.2.6 : section « Lignes de bus, tram, métro » de l'accueil. */
  followsTitle: 'Lignes de bus, tram, métro',
  addFollow: 'Ajouter une ligne',
  noFollows: 'Aucune ligne pour l’instant.',
  bothWays: 'les deux sens',
  stopField: 'Nom de l’arrêt',
  stopSearchPlaceholder: 'Rogier, Gare du Nord…',
  stopSearchNone: 'Aucun arrêt de bus, tram ou métro ne correspond. Pour une gare, ajoute-la à tes gares.',
  stopsFound: 'Arrêts trouvés',
  lineField: 'Numéro de la ligne',
  linePlaceholder: 'W, 36, 71…',
  lineNone: 'Aucune ligne de bus, tram ou métro ne porte ce numéro. Pour un train, ajoute sa gare à tes gares.',
  linesFound: 'Lignes trouvées',
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
  settingsLead: 'Favoris, gares, lignes et arrêts se règlent sur l’accueil, dans l’ordre des lunettes.',
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
  /**
   * 1.2.10 (PRD-1.2.10 § 4.1) : le seul réglage du guidage, dans Réglages. 1.3.1 (PRD-1.3.1 § 1 et § 12, L2) : pendant
   * le guidage, les lunettes montrent trois petits points ; l'aide le dit.
   */
  groupDuringTrip: 'Pendant un trajet',
  guide: 'Me guider pendant un trajet',
  guideHelp: 'Les lunettes ne montrent que trois petits points et t’écrivent seulement quand tu dois agir : partir, tourner, monter, descendre. Éteint : ton trajet est suivi sans rien afficher tout seul.',
  /** 1.2.10 (PRD-1.2.10 § 4.2) : bouton d'un favori, et son message quand les lunettes n'en rendent pas. */
  goThere: 'Y aller',
  guideStarted: 'Guidage lancé sur les lunettes.',
  followStarted: 'Trajet suivi dans les lunettes.',
  /** 1.2.10 (PRD-1.2.10 § 4.3) : carte « En cours » de l'accueil ; « suivi » quand le guidage est éteint. */
  nowTitle: 'En cours',
  /** 1.3.1 (PRD-1.3.1 § 14, R6) : bouton de la carte « En cours ». */
  copyArrival: 'Copier mon heure d’arrivée',
  stopGuide: 'Arrêter le guidage',
  stopFollow: 'Arrêter le suivi',
  guideStopped: 'Guidage arrêté.',
  followStopped: 'Suivi arrêté.',
  /** 1.2.10 (PRD-1.2.10 § 4.4) : l'ouverture de Quai, sur son écran. */
  opening: 'À l’ouverture de Quai',
  openingLead: 'Ce que les lunettes montrent en premier.',
  /** 1.2.10 (PRD-1.2.10 § 3.8 et § 4.5) : carte « Chemins à pied » de l'écran Données. */
  walkTitle: 'Chemins à pied',
  walkText: 'OpenStreetMap : les vrais chemins à pied, avec les escaliers, les parcs et les passages des gares. Le chemin se calcule sur ton téléphone : ta position n’est jamais envoyée.',
  /** Quai Web : le chemin se calcule dans le navigateur. */
  walkTextWeb: 'OpenStreetMap : les vrais chemins à pied, avec les escaliers, les parcs et les passages des gares. Le chemin se calcule dans ton navigateur : ta position n’est jamais envoyée.',
  walkCredit: '© les contributeurs d’OpenStreetMap, licence ODbL',
  /**
   * 1.3.0 (PRD-1.3.0 § 6.1) : test de l'écran des lunettes, mené par le téléphone (Réglages, « Pendant un trajet », pas
   * dans Quai Web). Les textes des étapes sont ceux du PRD.
   */
  testScreen: 'Tester l’écran des lunettes',
  testLead: 'Comment tu vois les messages de Quai pendant un trajet.',
  testIntro: 'Quai envoie un message aux lunettes et regarde s’il se voit. Le test dure environ une minute.',
  testStart: 'Commencer le test',
  testRestart: 'Recommencer le test',
  testStop: 'Arrêter le test',
  testStopped: 'Test arrêté.',
  testWait: `Mets tes lunettes, regarde devant toi, la tête droite, et ne touche à rien pendant 45${NB}secondes.`,
  /**
   * Étape sent : la consigne (« Touche une fois les lunettes ») est seulement dans les lunettes ; le téléphone ne la dit
   * pas, sinon on toucherait les lunettes sans les avoir vues et le test dirait à tort « visible » (contrôle usager 1.3.0).
   */
  testSent: 'Regarde toujours devant toi. Si les lunettes te demandent quelque chose, fais-le.',
  testAsk: `Lève la tête. Que vois-tu dans les lunettes${NB}?`,
  testAnswersLabel: 'Ce que tu vois dans les lunettes',
  testClosed: 'Ouvre Quai sur les lunettes, puis recommence.',
  /** Le test et le guidage ne vont jamais ensemble : un guidage en cours l'empêche, un guidage qui démarre l'arrête. */
  testGuiding: 'Arrête d’abord le guidage en cours, puis recommence.',
  testStoppedGuide: `Test arrêté${NB}: un guidage a commencé.`,
  /** 1.3.0 (PRD-1.3.0 § 6.4) : carte « Journal des trajets » de l'écran Données. */
  journalTitle: 'Journal des trajets',
  journalLead: `Tes 10 derniers trajets guidés, gardés sur ce téléphone seulement${NB}: des heures et des arrêts, jamais ta position.`,
  /** Quai Web : le journal reste dans le navigateur. */
  journalLeadWeb: `Tes 10 derniers trajets guidés, gardés dans ce navigateur seulement${NB}: des heures et des arrêts, jamais ta position.`,
  journalEmpty: 'Aucun trajet guidé pour l’instant.',
  journalCopy: 'Copier',
  journalCopied: 'Copié.',
  journalCopyManual: `Copie impossible${NB}: le texte est sélectionné, copie-le avec le menu du téléphone.`,
  journalClear: 'Effacer le journal',
  journalClearAsk: `Effacer le journal des trajets${NB}?`,
  journalClearYes: 'Effacer',
  journalCleared: 'Journal effacé.',
} as const;

/** 1.3.0 (PRD-1.3.0 § 6.1) : réponses à « Que vois-tu dans les lunettes ? », dans l'ordre du PRD. */
export const TEST_ANSWERS: readonly { answer: 'quai' | 'dashboard' | 'nothing'; label: string }[] = [
  { answer: 'quai', label: 'Le test de Quai' },
  { answer: 'dashboard', label: 'Le Dashboard' },
  { answer: 'nothing', label: 'Rien' },
];

/**
 * 1.3.0 (PRD-1.3.0 § 6.1, étape done) : ce que le téléphone conseille selon le résultat (textes du PRD) ; `none` : la
 * réponse « Rien », aucun résultat, vérifier « Head-Up » dans l'appli Even.
 * 1.3.1 (PRD-1.3.1 § 5) : résultat « Head-Up », le conseil précis du PRD, mot pour mot (aucun chemin de menu) ; « à 0 »
 * insécable, pour qu'un « 0 » ne commence jamais une ligne. Les autres résultats ne changent pas.
 */
export const TEST_ADVICE: Record<NonNullable<Settings['display']['alert']> | 'none', string> = {
  visible: 'Les messages de Quai se voient sans rien faire. S’il le faut, Quai les rappelle.',
  headUp: `Pour voir les messages sans bouger la tête${NB}: dans l’appli Even, règle l’angle de l’affichage Head-Up à${NB}0, en regardant un peu vers le bas pendant le réglage. L’écran restera allumé quand tu regardes devant toi${NB}; la batterie des lunettes s’use un peu plus vite.`,
  dashboard: 'En levant la tête, tu vois le Dashboard. Pendant un trajet, touche une fois les lunettes pour voir Quai.',
  none: `Les lunettes n’ont rien montré${NB}: dans l’appli Even, vérifie le réglage «${NB}Head-Up${NB}», puis recommence le test.`,
};

/**
 * 1.3.1 (PRD-1.3.1 § 14, R7) : sous le conseil des résultats « Head-Up » et « Rien » (TEST_CHECKED), ce qu'il faut
 * vérifier quand l'affichage Head-Up ne réagit pas (support Even : « Wear Detection », mode silencieux coupé par un appui
 * d'une seconde sur les deux branches). Aucun chemin de menu.
 */
export const TEST_CHECK = `Si l’affichage Head-Up ne réagit pas, vérifie «${NB}Wear Detection${NB}» dans l’appli Even, et que le mode silencieux est coupé (appui d’une seconde sur les deux branches).`;
/** 1.3.1 (R7) : les résultats dont le conseil est suivi de TEST_CHECK. */
export const TEST_CHECKED: ReadonlySet<NonNullable<Settings['display']['alert']> | 'none'> = new Set(['headUp', 'none']);

/** 1.3.0 : ligne pâle sous « Tester l’écran des lunettes » dans Réglages : le dernier résultat (Settings.display.alert). */
export const TEST_LAST: Record<NonNullable<Settings['display']['alert']>, string> = {
  visible: `Dernier test${NB}: les messages se voient sans rien faire.`,
  headUp: `Dernier test${NB}: les messages se voient en levant la tête.`,
  dashboard: `Dernier test${NB}: en levant la tête, tu vois le Dashboard.`,
};

/** 1.3.0 : compte à rebours d'une étape du test (« 45 s »). */
export const secondsLeft = (n: number): string => `${Math.max(0, Math.round(n))}${NB}s`;

/** 1.3.0 (PRD-1.3.0 § 6.4) : fin d'un trajet du journal, en clair. */
export const JOURNAL_END: Record<NonNullable<JournalTrip['end']>, string> = { done: 'arrivé', stopped: 'arrêté', ended: 'fini', replaced: 'remplacé' };

/**
 * 1.3.0 : sous-titre d'un trajet du journal : « 15/11 à 08:02, 23 min, arrivé » (heure de Bruxelles) ; pas encore fini :
 * « 15/11 à 08:02, en cours » ; moins d'une minute : « moins d’une minute ».
 */
export function journalTripLine(t: Pick<JournalTrip, 'startedAt' | 'endedAt' | 'end'>): string {
  const p = brusselsParts(t.startedAt);
  const date = `${String(p.d).padStart(2, '0')}/${String(p.mo).padStart(2, '0')} à ${hhmm(t.startedAt)}`;
  const ended = t.endedAt !== undefined && Number.isFinite(t.endedAt) && t.endedAt >= t.startedAt;
  if (!t.end && !ended) return `${date}, en cours`;
  const ms = ended ? t.endedAt! - t.startedAt : NaN;
  const parts = [date];
  if (Number.isFinite(ms)) parts.push(ms < 60_000 ? 'moins d’une minute' : durationText(ms / 60_000));
  parts.push(JOURNAL_END[t.end ?? 'ended']);
  return parts.join(', ');
}

/** 1.2.10 : choix de « À l’ouverture de Quai » (libellés de la revue d'usage n° 11, mêmes valeurs enregistrées). */
export const OPENING_LABEL: Record<Settings['display']['opening'], string> = {
  suggest: 'L’accueil, avec mes favoris',
  firstFavorite: 'Directement mon premier favori',
  home: 'L’accueil, sans favoris',
};
/** Ordre des choix de l'ouverture (celui de la 1.2.9). */
export const OPENING_ORDER: readonly Settings['display']['opening'][] = ['suggest', 'firstFavorite', 'home'];

/**
 * 1.2.10 : carte « En cours » : « Bureau, arrivée 08:54 » (sans heure connue : le titre seul). 1.3.1 (§ 7) : les noms
 * venus des données avec l'apostrophe typographique, à l'affichage seulement.
 */
export const guideTitleLine = (s: Pick<GuideStatus, 'title' | 'arr'>): string => apos(Number.isFinite(s.arr) && s.arr > 0 ? `${s.title}, arrivée ${hhmm(s.arr)}` : s.title);
/**
 * 1.2.10 : « Maintenant : bus 6 vers Gare des Guillemins » (rien si le moteur ne dit rien). 1.3.1 (L5, pôle Guidage) :
 * avant le départ, ce qui vient : « Ensuite : partir à 07:05 » (GuideStatus.then). 1.3.1 (§ 7) : « ’ ».
 */
export const guideNowLine = (s: Pick<GuideStatus, 'now' | 'then'>): string => (s.now.trim() ? apos(typo(`${s.then ? 'Ensuite' : 'Maintenant'} : ${s.now.trim()}`)) : '');

/**
 * 1.3.1 (PRD-1.3.1 § 14, R6) : carte « En cours » : le texte que « Copier mon heure d’arrivée » met dans le
 * presse-papiers, « J’arrive vers 08:54. » : l'heure d'arrivée du trajet en cours, jamais un nom de lieu ; sans heure
 * connue : '' (pas de bouton). Quai n'envoie rien : la personne colle le texte où elle veut.
 */
export const arrivalCopyText = (s: Pick<GuideStatus, 'arr'>): string => (Number.isFinite(s.arr) && s.arr > 0 ? `J’arrive vers ${hhmm(s.arr)}.` : '');
/** 1.3.1 (R6) : après la copie, « Copié : J’arrive vers 08:54. ». */
export const copiedText = (text: string): string => `Copié${NB}: ${text}`;
/**
 * 1.3.0 (PRD-1.3.0 § 6.3) : carte « En cours » : les problèmes de la vérification (GuideStatus.check, les lignes de
 * checkLines des lunettes : « Lunettes : 12 % de batterie »), deux au plus ; aucun : rien.
 */
export const checkLinesOf = (s: Pick<GuideStatus, 'check'>): string[] =>
  (Array.isArray(s.check) ? s.check : [])
    .filter((l): l is string => typeof l === 'string' && !!l.trim())
    .slice(0, 2)
    .map((l) => typo(l.trim()));


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

/**
 * 1.2.10 (PRD-1.2.10 § 7) : nouveautés de la bannière, comme le message « Quai 1.2.10 » des lunettes (« Y aller »,
 * « j'y descends », favoris sur une ligne), puis ce qui change sur le téléphone. Montrées à qui vient d'avant la
 * 1.2.10 : chacune reste vraie (PRD-1.3.1 § 9). 1.3.1 : l'écran du guidage n'est plus vide (§ 1, trois petits points) :
 * la 1re ligne le dit avec les mots de l'aide de « Me guider pendant un trajet » (§ 12, L2).
 */
export const NEWS_1210: readonly string[] = [
  '« Y aller » : Quai te guide de porte à porte. Les lunettes ne montrent que trois petits points et t’écrivent seulement quand tu dois agir : partir, tourner, monter, descendre.',
  'Train ou bus déjà pris : dans la liste de ses arrêts, touche celui où tu descends, « j’y descends », et Quai te dit quand descendre.',
  'Favoris des lunettes : une ligne chacun, le détail du favori choisi en bas de l’écran.',
  'Sur l’accueil du téléphone : « Y aller » sur chaque favori et, pendant le trajet, la carte « En cours ». Le réglage « Me guider pendant un trajet » est derrière le bouton « Réglages ».',
];

/**
 * 1.2.10 : les mêmes sur Quai Web, où la page du téléphone est l'onglet Réglages, et l'appui long de l'onglet Lunettes.
 * 1.3.1 (PRD-1.3.1 § 12, B10) : le menu dans son nouvel ordre, « Arrêter le guidage » en dernier ; « Voir les arrêts »
 * n'existe pas pour un trajet tout à pied.
 */
export const NEWS_1210_WEB: readonly string[] = [
  NEWS_1210[0],
  NEWS_1210[1],
  NEWS_1210[2],
  'Dans l’onglet Réglages : « Y aller » sur chaque favori et, pendant le trajet, la carte « En cours ». Le réglage « Me guider pendant un trajet » est derrière le bouton « Réglages ».',
  'Dans l’onglet Lunettes, le bouton « Appui long » ouvre le menu du guidage : « Voir tout le trajet », « Voir les arrêts » (sauf pour un trajet tout à pied), « Arrêter le guidage ».',
];

/**
 * 1.3.0 (PRD-1.3.0 § 9) : nouveautés de la bannière, les idées du message « Quai 1.3.0 » des lunettes (la ligne
 * « ▶ Y aller » et ▲ pour revenir des autres trajets ; les favoris en accordéon ; le test de l'écran et le rappel des
 * messages), puis le journal des trajets du téléphone.
 */
export const NEWS_130: readonly string[] = [
  'Écran d’un trajet dans les lunettes : une ligne « ▶ Y aller » dit ce que fait un toucher. Dans « Autres trajets », ▲ sur la première ligne ramène au trajet proposé.',
  'Favoris des lunettes : le détail du favori choisi s’ouvre juste dessous, sur deux lignes, et se referme quand tu passes au suivant.',
  'Pendant un trajet, un message important que tu n’as pas vu revient, deux fois au plus. Dans Réglages, « Tester l’écran des lunettes » montre comment tu vois les messages.',
  'Dans Réglages, puis Données : le journal de tes 10 derniers trajets guidés, à lire et à copier.',
];

/**
 * 1.3.0 : les mêmes sur Quai Web : pas de test de l'écran (pas de vraies lunettes) ni de rappel des messages (décision :
 * aucun rappel dans Quai Web) ; la page du téléphone est l'onglet Réglages.
 */
export const NEWS_130_WEB: readonly string[] = [
  NEWS_130[0],
  NEWS_130[1],
  'Dans l’onglet Réglages, bouton « Réglages », puis Données : le journal de tes 10 derniers trajets guidés, à lire et à copier.',
];

/** 1.2.8 : nouveautés de la bannière (comme le message « Quai 1.2.8 » des lunettes). */
export const NEWS_128: readonly string[] = [
  'Dans les lunettes, touche un train au tableau d’une gare : tout son trajet, des gares d’avant jusqu’au terminus.',
  'À chaque gare, sa voie et le prochain passage en clair (« dans 6 min ») ; ● montre où arrive le train, d’après le temps réel.',
];

/**
 * Une nouveauté d'avant qui n'est plus vraie n'est plus dite : 1.2.6, celles qui parlent de « Bus, tram, métro »,
 * devenu deux rubriques ; 1.3.0, le détail des favoris en bas de l'écran (la 1.2.10), devenu un accordéon.
 */
const NO_LONGER_TRUE: ReadonlySet<string> = new Set([NEWS_1210[2]]);
const stillTrue = (l: string): boolean => !/^Bus, tram, métro\b/.test(l) && !NO_LONGER_TRUE.has(l);

/**
 * Lignes de la bannière « Nouveau » (une seule bannière, montrée une fois) : celles de la 1.3.0 ; depuis une version
 * antérieure (`seen` : la version vue avant la mise à jour), celles des versions sautées ensuite, de la plus récente à
 * la plus ancienne, sans celles qui ne sont plus vraies. Quai Web (`web`) : ses propres lignes (onglet Réglages).
 */
export function newsLines(seen = '', web = false): string[] {
  const out = [...(web ? NEWS_130_WEB : NEWS_130)];
  if (seen && compareVersions(seen, '1.2.10') < 0) out.push(...(web ? NEWS_1210_WEB : NEWS_1210).filter(stillTrue));
  if (seen && compareVersions(seen, '1.2.9') < 0) out.push(...(web ? NEWS_129_WEB : NEWS_129));
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
/** « Ajouter une ligne » depuis un arrêt (?arret=…) : ses lignes en raccourcis. */
export const stopLinesText = (stop: string): string => (stop ? `Lignes à ${stop} :` : 'Lignes de cet arrêt :');
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

/**
 * Sous-titre d'un lieu (T3) : adresse normalisée, « Près de {arrêt} », « Adresse à vérifier » ; jamais de coordonnées.
 * 1.3.1 (§ 7) : apostrophe typographique à l'affichage (l'adresse gardée ne change pas).
 */
export function placeSubtitle(p: Place): string {
  if (p.src === 'address' && p.address) return apos(p.approx ? `${p.address} (sans numéro)` : p.address);
  if (p.src === 'stop') return apos(p.address ?? 'Près d’un arrêt');
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

/**
 * Nom d'une extrémité pour le téléphone : « Ma position », « Bureau », « Gand-Saint-Pierre », adresse complète. 1.3.1
 * (§ 7) : un nom des données avec l'apostrophe typographique (affichage seulement).
 */
export function endpointText(e: Endpoint, settings: Settings): string {
  if (e.type === 'here') return 'Ma position';
  if (e.type === 'area') return apos(displayName(e.name, settings.lang));
  // 1.3.1 (§ 7, décision du 20/11) : une adresse aussi, à l'affichage seulement (l'adresse gardée ne change pas)
  if (e.type === 'address') return apos(e.label);
  // 1.3.1 (§ 7) : le nom d'un lieu gardé (souvent celui d'une gare) s'affiche comme sur l'accueil et dans les lunettes
  return apos(placeOf(settings, e.placeId)?.label ?? 'Lieu');
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
  // 1.3.1 (§ 7) : apostrophe typographique, à l'affichage seulement
  const stop = apos(displayName(p.name, lang));
  return p.line ? `${lineName({ op: p.op, line: p.line, mode })} · ${stop}` : `${stop} · toutes les lignes`;
}

/** Ligne trouvée par son numéro (PRD-1.2.2 § 4) : « Bus W TEC, Braine-l’Alleud ↔ Bruxelles Midi ». */
export function lineMatchText(m: Pick<LineMatch, 'op' | 'mode' | 'line' | 'ends'>, lang: NameLang): string {
  const ends = m.ends.map((e) => apos(displayName(e, lang))).join(' ↔ ');
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

/**
 * Marches d'au moins 1 min, dans l'ordre du trajet ; `to` : l'arrêt ou la gare où monter dans le véhicule qui suit la
 * marche (nom affiché, apostrophe typographique), absent pour la dernière marche, vers la destination.
 */
function walksOf(j: Journey, lang: NameLang): { min: number; to?: string }[] {
  const out: { min: number; to?: string }[] = [];
  j.legs.forEach((l, i) => {
    if (l.kind !== 'walk') return;
    const min = Math.round(walkMinOf(l));
    if (min < 1) return;
    const next = j.legs.slice(i + 1).find((x) => x.kind === 'ride');
    const to = next ? apos(displayName(next.from.name, lang)).trim() : '';
    out.push(to ? { min, to } : { min });
  });
  return out;
}

/** 1.3.1 : flèche insécable des deux côtés (« 7 min → Flagey ») : jamais seule en bout ni en début de ligne. */
const TO = `${NB}→${NB}`;

/**
 * Ligne « moyens » d'une carte (PRD-1.2.1 § 2.3 et § 7.2) : comment on voyage (`meansText`), puis les marches dans
 * l'ordre : « bus W + S1, à pied 4 + 5 min » ; plus de 3 marches : « bus 36 + IC + métro 2, 12 min à pied » ; sans
 * marche : « IC + IC ». Trajet à pied : rien, la carte le dit déjà (« 22 min à pied », « À pied, sans transport »),
 * sauf la pluie prévue (1.2.5 : « pluie prévue »).
 * 1.3.1 (PRD-1.3.1 § 4, téléphone) : la première marche, quand elle mène à un véhicule, nomme l'arrêt ou la gare où
 * monter, comme les lunettes (« à pied 7 min → Flagey ») ; les autres marches suivent (« bus W + S1, à pied 6 min →
 * Flagey, puis 1 + 9 min » ; plus de deux autres : leur total, « puis 10 min »). Seule la marche vers la destination
 * (trajet qui part d'un arrêt) : inchangée (« tram 3, à pied 4 min »). `lang` : langue des noms (réglage).
 */
export function meansLine(j: Journey, lang: NameLang = 'fr'): string {
  // 1.2.5 : comme dans les lunettes, la pluie prévue sur une marche de 5 min ou plus
  const rainy = j.legs.some((l) => l.kind === 'walk' && !!l.rain && walkMinOf(l) >= 5);
  if (!j.legs.some((l) => l.kind === 'ride')) return rainy ? 'pluie prévue' : '';
  const w = walksOf(j, lang);
  const means = apos(meansText(j));
  if (!w.length) return means;
  const rain = rainy ? ', pluie prévue' : '';
  const total = (xs: readonly { min: number }[]): number => xs.reduce((s, x) => s + x.min, 0);
  const [first, ...rest] = w;
  if (first.to) {
    const then = rest.length ? `, puis ${rest.length > 2 ? total(rest) : rest.map((x) => x.min).join(' + ')}${NB}min` : '';
    return `${means}, à${NB}pied ${first.min}${NB}min${TO}${first.to}${then}${rain}`;
  }
  return `${means}, ${w.length > 3 ? `${total(w)}${NB}min à${NB}pied` : `à${NB}pied ${w.map((x) => x.min).join(' + ')}${NB}min`}${rain}`;
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
      return { kind: 'text', text: apos(`Tu es déjà ${atText(to, settings)}.`) };
    case 'noPosition':
      return { kind: 'text', text: opts.web ? 'Position inconnue : autorise-la dans le navigateur, ou choisis une adresse ou un arrêt (onglet Lunettes, rubrique Position).' : 'Position inconnue : autorise la position pour Quai.' };
    case 'noStopFrom':
    case 'noStopTo':
      return { kind: 'text', text: noStopText(r.accessMin ?? settings.maxWalkMin * 2) };
    case 'noTrip':
      if (r.station) {
        // 1.3.1 (§ 7) : le nom affiché ; la gare elle-même (r.station) ne change pas
        const name = apos(displayName(r.station.name, settings.lang));
        return { kind: 'station', text: noFullTripText(name), button: searchTowards(name), station: r.station };
      }
      return { kind: 'text', text: T.noTripNow };
    default:
      return { kind: 'text', text: T.noTripNow };
  }
}

/** Nom d'une langue de noms pour le service d'adresses (« Comme sur place » : français par défaut). */
export const geoLang = (lang: NameLang): 'fr' | 'nl' => (lang === 'nl' ? 'nl' : 'fr');
