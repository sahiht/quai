/**
 * Quai 1.2.5, contrôle qualité : bout en bout avec le VRAI cœur, les vraies données (pipeline sur les zips de
 * fixtures), le vrai relais (faux portail BMC, faux service d'adresses des trois Régions) et l'appli construite :
 *   - lunettes dans le simulateur Even Hub 0.9.5 (sans affichage, xvfb) : gestes, journal QUAI_SCREEN, captures
 *     576 × 288 contrôlées au pixel (CA-M1.7), relief de l'accueil et de « Autres trajets » mesuré sur la capture
 *     (PRD-1.2.1 § 4.4 : luminosité des conteneurs, retrait des favoris) ; 1.2.2 (docs/v1.2.2/PRD-1.2.2.md) : accueil
 *     avec « Gares » et « Bus, tram, métro » (§ 1.1), « Favoris » avec les adresses récentes (§ 1.2), « Gares » (§ 2),
 *     « Bus, tram, métro », le détail d'une ligne et « garder une ligne » (§ 3, REVUE-USAGE n° 3), trajet suivi
 *     seulement sur demande, « Suivi » et « Ne plus suivre » (§ 6) ; 1.2.3 (docs/v1.2.3/PRD-1.2.3.md) : tableau complet
 *     d'une gare ou d'un arrêt, ses pages (§ 1), les arrêts d'un départ et retour (§ 2) ; 1.2.4 (docs/v1.2.4/PRD-1.2.4.md) :
 *     l'arrêt ou la gare où aller nommé dans les étapes (§ 1), « ARRÊTS » et « LIGNES » (§ 2), le contenu des rubriques
 *     sur l'accueil (§ 3), aides « △▽ » (§ 4), message « Quai 1.2.4 » (§ 5) ; 1.2.5 (docs/v1.2.5/PRD-1.2.5.md) :
 *     « Si tu le rates » (§ 1), marge des correspondances (§ 2), pluie prévue par le relais sur un faux Open-Meteo
 *     (§ 3), « Bus, tram, métro » en mots clairs et pâles mesurés au pixel (§ 4), ligne de progression dans le
 *     véhicule (§ 7), message « Quai 1.2.5 » et bannière (§ 8), Quai Web avec sa politique de sécurité (§ 9) ;
 *   - téléphone dans Chrome sans affichage (protocole DevTools, sim/cdp.ts) : « Mes favoris », « Nouveau favori » et
 *     ses deux onglets, champ unique, cartes (nom affiché, ligne des moyens, phrases 1.2.1), jour férié au-dessus des
 *     résultats, « Lunettes », « Garder en favori », « Trajets », données, premier lancement, et réouverture de Quai (le
 *     simulateur 0.9.5 ne garde pas setLocalStorage d'un lancement à l'autre ; Chrome garde le stockage local d'un
 *     chargement à l'autre : message et bannière une seule fois, aide des gestes de l'accueil les 7 premiers jours) ;
 *   - Quai Web (build web) dans Chrome : onglet Lunettes (accueil, relief mesuré sur le canvas), rubrique « Position »
 *     avec une adresse (PRD-1.2 § 3).
 * Chrome sans aucun accès au réseau hors de la machine (sim/cdp.ts : ni proxy, ni nom d'hôte autre que 127.0.0.1).
 *
 *   cd tests/e2e && npm run sim                    (tout, environ 15 min)
 *   npm run sim -- --only s1,waterloo              (scénarios choisis, liste dans SCENARIOS en bas du fichier)
 *   npm run sim -- --deliver /tmp/quai-1.2.5-shots   (captures pour le propriétaire + manifest.json)
 *   npm run sim -- --tour                          (rafraîchit les images de app/test/screens/, mêmes noms)
 *
 * Captures : tests/e2e/screens/<scénario>-<étape>.png ; rapport : tests/e2e/out/sim-report.json.
 * Port d'automatisation : 9931 (option --port), pour ne pas gêner un autre simulateur sur 9898.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP, buildFixtureData, ROOT, run, startDataServer, startStack, type Proc, type Stack } from '../lib/stack';
import { litPixels, Sim, startStatic, type Screen } from '../lib/sim';
import { Chrome, type GlassesScreen, type Page } from './cdp';
import { alphaIn, checkPixels, HOME_INDENT, levels, lineSegments, SEG_ROW, truncatedLines } from './pixels';

const E2E = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SHOTS = join(E2E, 'screens');
const OUT = join(E2E, 'out');
const TOUR = join(APP, 'test', 'screens');
const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ONLY = new Set((opt('only') ?? '').split(',').filter(Boolean));
const PORT = Number(opt('port') ?? 9931);
const DELIVER = opt('deliver');
const WITH_TOUR = argv.includes('--tour');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP_VERSION = (JSON.parse(readFileSync(join(APP, 'app.json'), 'utf8')) as { version: string }).version;
/** Compare deux versions x.y.z (négatif si a < b). */
function cmpVersion(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/* ------------------------------ Situations de test (PRD § 5, conventions) ------------------------------ */

const S1 = { mockLat: '50.4655', mockLon: '4.859', mockNow: '2026-11-10T07:31:00+01:00' };
const S2 = { mockLat: '50.86', mockLon: '4.359', mockNow: '2026-11-10T12:10:00+01:00' };
const S3 = { mockLat: '50.8454', mockLon: '4.3571', mockNow: '2026-11-10T13:55:00+01:00' };
/** Scénario 4 : « Chaussée de Bruxelles 1, 1410 Waterloo » à 07:31 (fixtures/README.md, Extension 1.1 ; PRD-1.2.1 § 1). */
const WAT = { mockLat: '50.7175', mockLon: '4.399', mockNow: '2026-11-10T07:31:00+01:00' };
/** Même endroit, même heure, le 11/11 (Armistice, jour férié national, PRD-1.2.1 § 5) et le 12/11 (jour ordinaire). */
const WAT_1111 = { ...WAT, mockNow: '2026-11-11T07:31:00+01:00' };
const WAT_1211 = { ...WAT, mockNow: '2026-11-12T07:31:00+01:00' };
/**
 * De la maison au bureau (1.2.1 : IC jusqu'à Bruxelles-Nord, T3 jusqu'à la Bourse, 9 min à pied ; minutes après 07:31) :
 * à pied jusqu'à la gare de Namur, IC, Bruxelles-Nord à 08:42, Bourse vers 08:49, le bureau à 08:58.
 */
const PATH_S1 = '6:50.4677,4.8617;12:50.4685,4.8625;20:50.53,4.7;34:50.6727,4.5694;71:50.8603,4.362;73:50.8601,4.3602;78:50.8483,4.3497;87:50.8441,4.3474';
/**
 * De Bruxelles-Central à Gand-Saint-Pierre (minutes après 14:05). Le point de départ est la gare elle-même : la
 * position la quitte dès 14:09, sinon une position prise juste après le départ de 14:10, encore à moins de 300 m,
 * mettrait fin au trajet (« pas parti », PRD M6.3).
 */
const PATH_S3 = '4:50.849,4.362;10:50.86,4.2;20:50.95,3.95;30:51.03,3.72;34:51.0359,3.7107';

/** Aides de gestes exactes (PRD 1.1 § 6.1, liste S2 ; PRD-1.2.1 § 3.5 ; PRD-1.2.2 § 2, § 3, § 6) : l'oracle, indépendant du code. */
const H = {
  home: '△▽ choisir   toucher : ouvrir   double : quitter',
  favorites: '△▽ choisir   toucher : ouvrir   double : retour',
  /** Trajet suivi (1.2.2 : toucher propose « Ne plus suivre »). */
  steps: '△▽ étapes   toucher : ne plus suivre   double : retour',
  /** Trajet ouvert, pas encore suivi (toute proposition, la 1re comprise). */
  stepsOther: '△▽ étapes   toucher : suivre ce trajet   double : retour',
  stepsWalk: '△▽ étapes   double : retour',
  /** « Ne plus suivre » et le détail du véhicule. */
  followed: '△▽ choisir   toucher : valider   double : retour',
  others: '△▽ choisir   toucher : voir   double : retour',
  train: '△▽ arrêts   double : retour',
  arrival: 'toucher : ★ garder ce trajet   double : retour',
  /**
   * 1.2.3 (PRD-1.2.3 § 1) : tableau complet d'une gare ou d'un arrêt, curseur de départ en départ ; la ligne ★ en tête
   * garde ou retire la gare (« Gares »), ou ouvre « garder une ligne ».
   */
  board: '△▽ départs   toucher : arrêts   double : retour',
  /** 1.2.3 (§ 2) : les arrêts d'un départ ; toucher un arrêt : son tableau. */
  stops: '△▽ arrêts   toucher : départs   double : retour',
  keepLine: '△▽ choisir   toucher : ★ garder ou retirer   double : retour',
  stations: '△▽ choisir   toucher : départs   double : retour',
  lines: '△▽ choisir   toucher : ouvrir   double : retour',
  /** 1.2.6 (PRD-1.2.6 § 3) : « Lignes de bus, tram, métro », un sens par rangée ; toute la ligne dans un sens. */
  follows: '△▽ choisir   toucher : la ligne   double : retour',
  lineRun: '△▽ arrêts   toucher : passages   double : retour',
  /** Détail d'une ligne ; 1.2.3 : toucher un passage, ses arrêts. */
  line: '△▽ passages   toucher : arrêts   double : retour',
  nearby: '△▽ arrêt   toucher : départs   double : retour',
  nearest: 'toucher : ses départs   double : retour',
  message: 'double toucher : retour',
  errorRoot: 'toucher : réessayer   double : quitter',
  firstRun: 'toucher : continuer   double : quitter',
  news: 'toucher : continuer',
};
/** À droite du titre d'un trajet (PRD-1.2.2 § 6) : son état, quelle que soit l'aide des gestes. */
const FOLLOW = '   Suivre ce trajet';
const FOLLOWED = '   Suivi';
/** « Le suivant » vers le bureau à S1 : l'IC de 08:42 ; l'arrivée dépend du tram choisi par le classement du cœur (§ 7). */
const NEXT_S1 = /^Le suivant {3}08:33 → (09:5\d|10:0\d)$/;
/**
 * Message « Quai 1.2.6 » des lunettes (PRD-1.2.6 § 7) : depuis la 1.2.5, les quatre lignes de la 1.2.6 ; depuis une
 * version antérieure, aussi les trois lignes de la 1.2.5 encore vraies (7 lignes). Les plus anciennes ne sont plus dites.
 */
const NEWS_TITLE = 'Quai 1.2.6';
const NEWS_126 = [
  'Arrêts et lignes de bus, tram, métro, séparés.',
  'Une ligne : tout son parcours, l’attente à chaque arrêt.',
  'Dans les deux sens, sans choisir d’arrêt.',
  'Tes lignes gardées y sont déjà.',
];
const NEWS_125 = ['Étapes : l’heure d’arrivée si tu rates ton départ.', 'Pluie prévue : dite sur la marche concernée.', 'Dans le véhicule : ta progression jusqu’à la descente.'];
/** Lignes du message selon la version vue avant la mise à jour. */
const newsFor = (seen: string): string[] => [...NEWS_126, ...(cmpVersion(seen, '1.2.5') < 0 ? NEWS_125 : [])];
/**
 * Bannière « Nouveau » du téléphone (app/src/phone/text.ts, NEWS_126 à NEWS_122) : celles des versions sautées, sans
 * celles qui parlent de « Bus, tram, métro », devenu deux rubriques.
 */
const BANNER_126 = [
  'Gares de train, arrêts et lignes de bus, tram, métro : trois rubriques séparées.',
  'Une ligne se suit maintenant en entier, dans les deux sens, sans choisir d’arrêt : les lunettes montrent l’attente à chacun de ses arrêts.',
  'Pour ajouter une ligne ou un arrêt, ceux près de toi sont proposés, chaque ligne à sa couleur.',
  'Tes lignes gardées à un arrêt sont déjà dans Lignes.',
];
const BANNER_125 = [
  'Dans les étapes, quand tu pars bientôt : l’heure d’arrivée si tu rates ton départ.',
  'Une correspondance de 5 min ou moins montre sa marge.',
  'La pluie prévue est dite sur les marches de 5 min ou plus (réglage dans Affichage).',
  'Dans le train, le bus, le tram ou le métro : ta progression jusqu’à la descente.',
];
const BANNER_124 = [
  'Dans les étapes, l’arrêt ou la gare où aller est écrit en entier.',
  'L’accueil des lunettes dit combien de gares, d’arrêts et de lignes tu suis.',
  'Dans les lunettes, des heures alignées et des aides plus discrètes.',
];
const BANNER_123 = ['Tableaux complets dans les lunettes : tous les départs des 2 prochaines heures.', 'Touche un départ : ses arrêts jusqu’au terminus, avec l’heure et la voie.'];
const BANNER_122 = ['Nouveau : tes gares et tes lignes de bus, tram et métro sur l’accueil des lunettes.', 'Tes arrêts favoris y sont rangés, rien n’est perdu.', 'Dans les lunettes, Aller à… a rejoint Favoris.', 'Un trajet n’est suivi que si tu le demandes.'];
const bannerFor = (seen: string): string[] => [
  ...BANNER_126,
  ...(cmpVersion(seen, '1.2.5') < 0 ? BANNER_125 : []),
  ...(cmpVersion(seen, '1.2.4') < 0 ? BANNER_124 : []),
  ...(cmpVersion(seen, '1.2.3') < 0 ? BANNER_123 : []),
  ...(cmpVersion(seen, '1.2.2') < 0 ? BANNER_122 : []),
];
const WELCOME = ['Bienvenue dans Quai !', 'Termine les réglages sur le téléphone :', 'appli Even Realities, onglet Even Hub, Quai.', 'Position, langue et tes favoris, en une minute.'];
/** Panne du temps réel : avec « ~ » sur les écrans qui en montrent, sans « ~ » sur l'accueil (PRD-1.2.1 § 4.5). */
const RT_DOWN = 'Temps réel indisponible : horaires prévus ~';
const HOME_RT_DOWN = 'Temps réel indisponible : horaires prévus';
const HOLIDAY = 'Jour férié : horaires du dimanche';
/** Chapeau de « Mes favoris » (1.2.2 : endroits et trajets, plus d'arrêts). */
const FAVS_LEAD = 'Tes endroits et tes trajets de A à B. En tête dans les lunettes selon l’heure et ta position (réglage Affichage).';
const MAX_WALK_SUB = 'D’abord les trajets dans cette limite ; au-delà, s’il n’y a pas mieux';
/** Rubriques vides de l'accueil (PRD-1.2.2 § 1.3) : le toucher dit où les choisir. */
const CHOOSE_STATIONS = 'Choisis tes gares dans Quai, sur le téléphone';
const CHOOSE_STOPS = 'Choisis tes arrêts dans Quai, sur le téléphone';
const CHOOSE_LINES = 'Choisis tes lignes dans Quai, sur le téléphone';

/**
 * « Choisis tes gares… » sur l'accueil : à la place du titre « Quai », jamais une ligne de pied qui pousserait la dernière
 * ligne hors de l'écran (revue indépendante) : autant de lignes qu'avant le toucher, la même en dernier.
 */
function sameRows(s: Screen, before: Screen): void {
  check(s.lines.length === before.lines.length && s.lines.at(-1) === before.lines.at(-1), `lignes poussées par le message : ${JSON.stringify(s.lines)} au lieu de ${JSON.stringify(before.lines)}`);
}
/** Erreur au lancement (REVUE-USAGE n° 10). */
const DATA_DOWN = 'Pas de connexion aux horaires : nouvel essai dans 30 s';
/**
 * Message « Quai 1.2.6 » et bannière : seulement quand l'appli construite est en 1.2.6 (app.json) ; avant la montée
 * de version, ils ne paraissent pas et les étapes qui les attendent le disent dans les notes.
 */
const V125 = cmpVersion(APP_VERSION, '1.2.6') >= 0;
/** Ligne du haut de l'accueil (jamais un élément sélectionnable). */
const TOP_HOME = /^(Temps réel indisponible|Pas de réseau|Horaires |Près de |! )/;
/** Alpha des captures du simulateur pour chaque niveau de luminosité (mesuré : 4 → 255, 3 → 230, 2 → 197). */
const ALPHA = { 4: 255, 3: 230, 2: 197 } as const;

/* ------------------------------ Captures pour le propriétaire (--deliver) ------------------------------ */

const DELIVERABLES: Record<string, { file: string; caption: string }> = {
  g01: { file: 'g01-lunettes-accueil-favoris.png', caption: 'Lunettes, accueil à 07:31 à la maison (Waterloo) : « Favoris   3 », dessous, en retrait et plus pâles, le bureau (maintenant → 08:46) et Mama (maintenant → 08:47), puis « Autour de moi », « Gares de train   1 gare » (la gare de Waterloo), « Arrêts de bus, tram, métro » et « Lignes de bus, tram, métro » à choisir. La maison (tu y es) reste dans la liste ouverte par « Favoris ».' },
  g02: { file: 'g02-lunettes-trajet-suite.png', caption: 'Lunettes, Waterloo vers le bureau, « Moins de marche : 1 changement, à pied 2 + 2 + 3 min » (bus W puis métro 2), trajet suivi (« Suivi » sur la ligne du titre) : au milieu du trajet, la ligne du bas dit « ▽ suite du trajet : … ».' },
  g03: { file: 'g03-lunettes-fin-du-trajet.png', caption: 'Lunettes, même trajet après ▼ : la dernière étape (arrivée 08:46) est visible, la ligne du bas dit « Fin du trajet. ▽ 2 autres trajets ». ▼ n’a jamais changé de trajet.' },
  g04: { file: 'g04-lunettes-autres-trajets.png', caption: 'Lunettes, ▼ au bout du trajet : « Vers le bureau : autres trajets ». Par entrée, le nom et les heures, puis plus pâles les moyens et le pourquoi (« S1, 16 min plus tôt, mais 19 min à pied » ; « bus W + métro 2, à pied 2 + 2 + 3 min »).' },
  g05: { file: 'g05-lunettes-trajet-plus-tot.png', caption: 'Lunettes, « Plus tôt » ouvert depuis la liste : « Suivre ce trajet » sur la ligne du titre, « Plus tôt de 16 min, mais 19 min à pied » en haut, puis ses étapes (19 min à pied, S1 07:55 voie 1). Toucher : le suivre ; double toucher : retour à la liste.' },
  g06: { file: 'g06-lunettes-accueil-jour-ferie.png', caption: 'Lunettes, accueil le 11/11 (Armistice) à 07:31 à Waterloo : en dernière ligne, pâle, « Jour férié : horaires du dimanche » ; la ligne vide saute pour lui laisser la place. Le 12/11, rien.' },
  g07: { file: 'g07-lunettes-message-quai-1-2-6.png', caption: 'Lunettes, message « Quai 1.2.6 », montré une seule fois à la première ouverture après la mise à jour depuis la 1.2.5 : arrêts et lignes séparés, toute une ligne et l’attente à chaque arrêt, dans les deux sens, les lignes gardées déjà là.' },
  g08: { file: 'g08-lunettes-gares.png', caption: 'Lunettes, « Gares de train » à 07:31 à Namur : la gare choisie et son prochain train à droite (retard et voie modifiée comme dans « Autour de moi »). Toucher : son tableau.' },
  g09: { file: 'g09-lunettes-ouverture-arret.png', caption: 'Lunettes (1.2.6), à 12:10 à la gare du Nord : les départs de l’arrêt repère du tram 3 et du tram 4 s’ouvrent seuls (à moins de 300 m), comme l’arrêt favori de la 1.2.1.' },
  g15: { file: 'g15-lunettes-lignes.png', caption: 'Lunettes (1.2.6), « Lignes de bus, tram, métro » : un sens par rangée, « Tram 3 vers Churchill », la ligne et sa destination au plus clair, « vers » pâle, sans attente.' },
  g10: { file: 'g10-lunettes-toute-la-ligne.png', caption: 'Lunettes (1.2.6), tout le tram 3 vers Churchill : chaque arrêt et ses 2 prochains passages, ● quand un tram arrive, la gare du Nord (à 80 m) sous le curseur.' },
  g11: { file: 'g11-lunettes-garder-une-ligne.png', caption: 'Lunettes, ★ sur les départs de la gare du Nord : « Gare du Nord : garder une ligne », les lignes de l’arrêt, « ★ » sur celles suivies dans « Lignes de bus, tram, métro ».' },
  g12: { file: 'g12-lunettes-trajet-suivi.png', caption: 'Lunettes, toucher sur un trajet suivi : « Vers Gand-Saint-Pierre : trajet suivi », « Ne plus suivre » et le détail du train.' },
  g13: { file: 'g13-lunettes-tableau-complet.png', caption: 'Lunettes (1.2.3), tableau complet de Namur à 07:31 : « ★ retirer la gare » en tête, puis tous les départs des 2 prochaines heures, le curseur sur le premier (l’IC de 07:42, +2, voie 6 au lieu de 4). ▲▼ de départ en départ, la liste défile par page.' },
  g16: { file: 'g16-lunettes-dans-le-train-progression.png', caption: 'Lunettes (1.2.5), dans l’IC suivi à 08:05 : en haut, la ligne de progression (Namur et Gembloux passés, Ottignies le prochain, la descente à Bruxelles-Nord en dernier) et « descente dans 4 arrêts » ; dessous, les arrêts avec leur heure.' },
  g14: { file: 'g14-lunettes-arrets-du-depart.png', caption: 'Lunettes (1.2.3), toucher l’IC de 07:42 : « IC vers Bruxelles-Midi », Namur en tête au plus clair (07:42 +2, voie 6 !), puis chaque gare jusqu’au terminus avec son heure et sa voie. Toucher une gare ouvre son tableau.' },
  p01: { file: 'p01-telephone-nouveau-favori-endroit.png', caption: 'Téléphone, « Nouveau favori » : en haut, deux choix de même taille, « Un endroit » (choisi d’office) et « Un trajet de A à B » ; dessous, le champ « Adresse, gare ou arrêt » avec « Ma position actuelle » en tête, puis les adresses récentes.' },
  p02: { file: 'p02-telephone-nouveau-favori-trajet.png', caption: 'Téléphone, « Nouveau favori », choix « Un trajet de A à B » : le formulaire du trajet fixe (Départ, Arrivée, nom affiché, créneau).' },
  p03: { file: 'p03-telephone-cartes-trajets.png', caption: 'Téléphone, Waterloo vers la rue du Progrès : « Moins de marche » en tête (bus W + métro 2, à pied 2 + 2 + 3 min ; « Arrive 16 min après le plus rapide, avec moins de marche. »), puis « Plus tôt » (S1, à pied 19 + 5 min ; « Plus tôt de 16 min, mais 19 min à pied. ») et « Le suivant ».' },
  p04: { file: 'p04-telephone-trajets.png', caption: 'Téléphone, écran « Trajets » : « Marche maximale » et son sous-titre « D’abord les trajets dans cette limite ; au-delà, s’il n’y a pas mieux », puis la marge avant de partir.' },
  p05: { file: 'p05-telephone-jour-ferie.png', caption: 'Téléphone, recherche le 11/11 (Waterloo vers la rue du Progrès) : la ligne « Jour férié : horaires du dimanche » sous l’heure, au-dessus des résultats. Le 12/11, rien.' },
  w01: { file: 'w01-quai-web-lunettes-accueil.png', caption: 'Quai Web, onglet Lunettes, accueil à 07:31 à Waterloo (adresse choisie dans la rubrique « Position ») : « Favoris » et ses favoris en retrait, plus pâles, puis « Autour de moi » et les trois rubriques ; plus de ligne de pied.' },
};
const delivered: Record<string, string> = {};
const toured: { file: string; what: string }[] = [];

function deliver(id: keyof typeof DELIVERABLES, src: string): void {
  if (!DELIVER) return;
  mkdirSync(DELIVER, { recursive: true });
  copyFileSync(src, join(DELIVER, DELIVERABLES[id].file));
  delivered[id] = DELIVERABLES[id].file;
}

/** Images de la visite (app/test/screens/, noms de la 1.0 gardés). */
function tour(name: string, src: string, what: string): void {
  if (!WITH_TOUR) return;
  copyFileSync(src, join(TOUR, name));
  toured.push({ file: name, what });
}

/* ------------------------------ Résultats ------------------------------ */

interface StepResult {
  scenario: string;
  step: string;
  ok: boolean;
  error?: string;
  screen?: Screen | GlassesScreen;
  shot?: string;
  ms: number;
}
const results: StepResult[] = [];
const notes: string[] = [];

class Check extends Error {}
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Check(msg);
}
const has = (s: { lines: string[] }, re: RegExp) => s.lines.some((l) => re.test(l));
const show = (s: { screen: string; title: string; clock?: string; lines: string[] } & Record<string, unknown>) => {
  const extra = Object.entries(s).filter(([k]) => !['screen', 'title', 'lines', 'clock', 'sel', 'at', 'id'].includes(k));
  return `${s.screen} « ${s.title} » ${s.clock ?? ''} sel ${String(s.sel)} ${extra.length ? JSON.stringify(Object.fromEntries(extra)) : ''}\n      ${s.lines.join('\n      ')}`;
};
/** Écran chargé : plus de « … » d'attente. */
const loaded = (s: { lines: string[] }) => !s.lines.some((l) => l.endsWith('…') || /^Chargement|^Recherche|^Calcul/.test(l));
const is = (screen: string, extra: (s: Screen) => boolean = () => true) => (s: Screen) => s.screen === screen && extra(s);
const hint = (s: { lines: string[] }) => s.lines[s.lines.length - 1];
/** Ligne du bas (au-dessus de l'aide) d'un écran d'étapes. */
const bottom = (s: { lines: string[] }) => s.lines[s.lines.length - 2];
/** Espaces insécables (typographie française du téléphone) remplacées par des espaces, pour comparer. */
const nbn = (t: string | undefined) => (t ?? '').replace(/[\u00a0\u202f]/g, ' ');
/** Même chose dans une expression évaluée dans la page. */
const N = (expr: string) => `((${expr}) ?? '').replace(/[\\u00a0\\u202f]/g, ' ')`;
const field = <T>(s: Screen, k: string) => (s as unknown as Record<string, T>)[k];
const clockAtLeast = (hhmm: string) => (s: Screen) => (s.clock ?? '') >= hhmm;
const sameList = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------ Accueil (PRD-1.2.1 § 4, PRD-1.2.2 § 1.1) ------------------------------ */

/** Lignes des éléments de l'accueil, dans l'ordre de `sel` : sans la ligne du haut, la ligne vide, le jour férié ni l'aide. */
function homeItems(s: { lines: string[] }): string[] {
  const l = [...s.lines];
  if (TOP_HOME.test(l[0] ?? '')) l.shift();
  return l.filter((x) => x !== '' && x !== HOLIDAY && !/^△▽ /.test(x));
}
/** Rang (sel) de l'élément de l'accueil dont la ligne vérifie `re`. */
function homeIndex(s: { lines: string[] }, re: RegExp): number {
  const i = homeItems(s).findIndex((x) => re.test(x));
  check(i >= 0, `élément ${re} absent de l’accueil : ${JSON.stringify(s.lines)}`);
  return i;
}
/* ------------------------------ Tableaux complets, arrêts d'un départ (PRD-1.2.3 § 1, § 2) ------------------------------ */

/** Lignes de la liste d'un tableau ou des arrêts d'un départ : sans la ligne du haut, la note ni l'aide. */
function listRows(s: { screen: string; lines: string[] }): string[] {
  const l = s.lines.slice(0, -1);
  if (s.screen === 'stops' || /^(! |Départs de demain$)/.test(l[0] ?? '')) l.shift();
  if (/^(~ horaire prévu|Temps réel indisponible|Pas de réseau)/.test(l[l.length - 1] ?? '')) l.pop();
  return l;
}
/**
 * Minutes depuis minuit d'une ligne de tableau ou d'arrêt : l'heure (« 07:42 », « ~07:42 ») plus son retard (« +2 ») ;
 * un bus dans l'heure : `now` plus l'attente (« 4 min », « ~4 min », « imminent ») ; rien de lisible (« SUPPRIMÉ ») : NaN.
 */
function minutesOfRow(row: string, now = 0): number {
  const m = /(\d\d):(\d\d)(?: \+(\d+))?/.exec(row);
  if (m) return +m[1] * 60 + +m[2] + (m[3] ? +m[3] : 0);
  const w = /~?(\d+)\u00a0?\s?min$/.exec(row);
  if (w) return now + +w[1];
  return /imminent$/.test(row) ? now : NaN;
}

/** Favoris montrés sur l'accueil : les lignes en retrait, entre « Favoris   n » et la ligne vide (ou « Autour de moi »). */
function homeFavorites(s: { lines: string[] }): string[] {
  const i = s.lines.findIndex((x) => /^Favoris {3}\d+$/.test(x));
  if (i < 0) return [];
  const j = s.lines.findIndex((x, k) => k > i && (x === '' || /^Autour de moi {3}/.test(x)));
  return s.lines.slice(i + 1, j < 0 ? undefined : j);
}
/** Accueil chargé : réponses des favoris montrés calculées (pas de « … »), « Autour de moi » compté. */
const homeReady = is('home', (x) => loaded(x) && has(x, /^Autour de moi {3}/));

/**
 * Rubriques de l'accueil (1.2.6, PRD-1.2.6 § 1 : chacune dit son mode), à droite leur contenu, « à choisir » ou
 * « sans position ». LINES_ROW : « Lignes de bus, tram, métro », la dernière.
 */
const STATIONS_ROW = /^Gares de train {3}\S/;
const STOPS_ROW = /^Arrêts de bus, tram, métro {3}\S/;
const LINES_ROW = /^Lignes de bus, tram, métro {3}\S/;
/** Les trois rubriques du préréglage courant (Namur ; Bruxelles-Nord De Lijn ; tram 3 et tram 4 suivis). */
const SECTIONS_CUR = ['Gares de train   1 gare', 'Arrêts de bus, tram, métro   1 arrêt', 'Lignes de bus, tram, métro   2 lignes'];

/**
 * Contrôles communs de l'accueil (PRD-1.2.1 § 4, PRD-1.2.2 § 1.1, REVUE-USAGE n° 1) : aide des gestes seulement les
 * 7 premiers jours (`help`), aucun pied ni « ~ », plus de « Autres favoris » ni de « Aller à… » ; « Autour de moi »,
 * puis les trois rubriques de la 1.2.6 en dernier ; au plus une ligne vide, juste au-dessus de « Autour de moi » (elle
 * saute d'abord s'il manque une ligne) ; aucune ligne coupée, pas de tiret long.
 */
function homeCommon(s: Screen, help: boolean): void {
  if (help) check(hint(s) === H.home, `aide « ${hint(s)} » au lieu de « ${H.home} » (7 premiers jours)`);
  else check(!s.lines.some((l) => /^△▽ /.test(l)), `aide des gestes sur l’accueil d’un utilisateur de plus de 7 jours (§ 4.6) : ${JSON.stringify(s.lines)}`);
  check(!s.lines.some((l) => /~|horaire prévu|ferme simplement|Autres favoris|Aller à/.test(l)), `pied, « ~ », « Autres favoris » ou « Aller à… » sur l’accueil : ${JSON.stringify(s.lines)}`);
  const k = s.lines.findIndex((l) => /^Autour de moi {3}/.test(l));
  check(k > 0 && STATIONS_ROW.test(s.lines[k + 1] ?? '') && STOPS_ROW.test(s.lines[k + 2] ?? '') && LINES_ROW.test(s.lines[k + 3] ?? ''), `« Autour de moi », puis les trois rubriques : ${JSON.stringify(s.lines)}`);
  const blanks = s.lines.map((l, i) => (l === '' ? i : -1)).filter((i) => i >= 0);
  check(blanks.length <= 1 && blanks.every((i) => i === k - 1), `au plus une ligne vide, au-dessus de « Autour de moi » : ${JSON.stringify(s.lines)}`);
  const cut = truncatedLines(s);
  check(!cut.length, `lignes coupées : ${JSON.stringify(cut)}`);
  check(![s.title, ...s.lines].some((l) => /[\u2013\u2014]/.test(l)), 'tiret long dans un texte affiché');
}

/**
 * Écarts de relief mesurés sur une capture (PRD-1.2.1 § 4.4 ; « Autres trajets » § 3.3 : 2e ligne plus pâle ;
 * 1.2.5, PRD-1.2.5 § 4 : « Bus, tram, métro », la ligne, sa destination et ses passages au plus clair, « vers », les
 * noms d'arrêts et les intitulés pâles, mot par mot).
 */
function reliefIssues(kind: 'home' | 'others' | 'lines', s: Screen, lv: ReturnType<typeof levels>, png: Buffer): string[] {
  const bad: string[] = [];
  const rows = lv.filter((l) => l.label.startsWith('ligne'));
  if (kind === 'lines') {
    let words = 0;
    for (const l of rows) {
      if (SEG_ROW.test(l.text)) {
        for (const sg of lineSegments(s, l.text)) {
          const a = alphaIn(png, s, l.text, sg.from, sg.to);
          const want = sg.text === 'vers' ? ALPHA[2] : ALPHA[4];
          words++;
          if (a !== want) bad.push(`« ${l.text} » : « ${sg.text} » alpha ${a} au lieu de ${want}`);
        }
      } else if (l.text && !/^(\S+ \S+ · |vers |…$|aucun passage|introuvable)/.test(l.text) && l.alpha !== ALPHA[2]) {
        bad.push(`« ${l.text} » (intitulé ou nom d’arrêt) : alpha ${l.alpha} au lieu de ${ALPHA[2]}`);
      }
    }
    if (!words) bad.push('aucune rangée en mots clairs et pâles mesurée');
    return bad;
  }
  if (kind === 'home') {
    const favs = new Set(homeFavorites(s));
    for (const l of rows) {
      if (favs.has(l.text)) {
        if (l.alpha !== ALPHA[2]) bad.push(`favori « ${l.text} » : alpha ${l.alpha} au lieu de ${ALPHA[2]} (niveau 2)`);
        if (l.x0 < 28 + HOME_INDENT - 1) bad.push(`favori « ${l.text} » : commence à x = ${l.x0}, sans le retrait de ${HOME_INDENT} px`);
      } else if (/^(Favoris|Autour de moi|Gares|Arrêts de bus|Lignes de bus|Ajouter un favori|En cours)/.test(l.text)) {
        if (l.alpha !== ALPHA[4]) bad.push(`« ${l.text} » : alpha ${l.alpha} au lieu de ${ALPHA[4]} (niveau 4)`);
        if (l.x0 > 28 + 2) bad.push(`« ${l.text} » : commence à x = ${l.x0} au lieu de la marge (28)`);
      }
    }
    if (favs.size && !rows.some((l) => favs.has(l.text))) bad.push('aucun favori mesuré');
  } else {
    rows.forEach((l, i) => {
      const want = i % 2 ? ALPHA[2] : ALPHA[4];
      if (l.alpha !== want) bad.push(`« ${l.text} » : alpha ${l.alpha} au lieu de ${want}`);
    });
  }
  return bad;
}

let stack: Stack;
let night: Proc;
let web: { url: string; close(): Promise<void> };
let webApp: { url: string; close(): Promise<void> };
let sim: Sim;

/** Adresse locale en 127.0.0.1 (Chrome ne résout aucun autre nom, sim/cdp.ts ; les serveurs écoutent sur toutes les adresses). */
const ipv4 = (url: string): string => url.replace('://localhost:', '://127.0.0.1:');

/** Adresse de la page (paramètres du mode test, SPEC § 5.3). */
function pageUrl(params: Record<string, string | undefined>, hash = '', bases?: { data?: string; relay?: string; app?: string }): string {
  const u = new URL(`${ipv4(bases?.app ?? web.url)}/index.html`);
  u.searchParams.set('e2e', '1');
  u.searchParams.set('data', ipv4(bases?.data ?? night.url));
  u.searchParams.set('relay', ipv4(bases?.relay ?? stack.relay.url));
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString() + hash;
}
const preset = (file: string) => (p: Record<string, string>) => ({ ...p, reset: '1', preset: `${ipv4(web.url)}/${file}` });
/** Réglages 1.1 tels quels (fixtures/app/preset-1.1.json, seenVersion 1.1.0) : migrés en v4, « Quai 1.2.5 » une fois. */
const P11 = preset('preset-1.1.json');
/** Réglages de la 1.0 (fixtures/app/preset.json) : migrés au lancement, « Quai 1.2.5 » une fois. */
const P10 = preset('preset.json');
/** Utilisateur de la 1.2.0 (seenVersion 1.2.0) : « Quai 1.2.5 » une fois, avec les nouveautés de la 1.2.4. */
const P120 = preset('p/1.2.0.json');
/** Utilisateur de la 1.2.1 (seenVersion 1.2.1) : « Quai 1.2.5 » une fois, ses arrêts favoris rangés (PRD-1.2.2 § 5). */
const P121 = preset('p/1.2.1.json');
/** Utilisateur de la 1.2.2 (seenVersion 1.2.2) : « Quai 1.2.5 » une fois, avec les nouveautés de la 1.2.4. */
const P122 = preset('p/1.2.2.json');
/** Utilisateur de la 1.2.3 (seenVersion 1.2.3) : « Quai 1.2.5 » une fois, avec les nouveautés de la 1.2.4. */
const P123 = preset('p/1.2.3.json');
/** Utilisateur de la 1.2.4 (seenVersion 1.2.4) : « Quai 1.2.6 » une fois, avec les nouveautés de la 1.2.5. */
const P124 = preset('p/1.2.4.json');
/** Utilisateur de la 1.2.5 (seenVersion 1.2.5) : « Quai 1.2.6 » une fois, les seules nouveautés de la 1.2.6. */
const P125 = preset('p/1.2.5.json');
/**
 * Utilisateur de la version construite : les réglages de la 1.1 avec les nouveautés déjà vues (seenVersion 1.2.5),
 * migrés au lancement comme ceux d'un utilisateur réel : favoris Bureau, Vers Gand-Saint-Pierre et Maison ; « Gares » :
 * Namur ; « Bus, tram, métro » : tram 3 et tram 4 à Gare du Nord (ouverts d'office à moins de 300 m) et Bruxelles-Nord
 * De Lijn, toutes les lignes. Quai déjà utilisé (date du premier lancement absente, version vue connue) : pas d'aide
 * des gestes sur l'accueil (§ 4.6). Jamais de message de nouveautés.
 */
const PCUR = preset('p/current.json');
/** PCUR avec trois adresses récentes, des lieux publics (S4 ; PRD-1.2.2, règle de confidentialité). */
const PREC = preset('p/recent.json');
/** PCUR avec un lieu au nom de ville et une adresse récente (champ unique). */
const PPHONE = preset('p/phone.json');
/** Configuration faite, aucun favori, ni gare ni ligne (CA-2.3 à CA-2.5, Quai Web). */
const PEMPTY = preset('p/empty.json');
/** PCUR avec des lieux à adresse vérifiée et deux adresses récentes (captures de « Mes favoris »). */
const PNICE = preset('p/nice.json');
/**
 * Waterloo (scénario 4 des fixtures, CA-121.5) : Maison (tu y es), Bureau, Mama et la gare de Waterloo (arrêt favori
 * de la 1.2.1, rangé dans « Gares ») ; seenVersion 1.2.5.
 */
const PWAT = preset('p/waterloo.json');

let scenario = '';
interface StepOut {
  screen?: Screen;
  /** Capture des lunettes (défaut : oui si un écran est rendu). */
  shot?: boolean;
  /** Contrôle au pixel de la capture (défaut : oui ; faux pour les écrans dont le texte n'est pas mesuré). */
  pixels?: boolean;
  /** Relief mesuré sur la capture : accueil (§ 4.4), « Autres trajets » (§ 3.3) ou 1.2.5 « Bus, tram, métro ». */
  relief?: 'home' | 'others' | 'lines';
  deliver?: keyof typeof DELIVERABLES;
  tour?: [string, string];
}

async function step(name: string, fn: () => Promise<StepOut | void>): Promise<void> {
  const t0 = Date.now();
  const r: StepResult = { scenario, step: name, ok: true, ms: 0 };
  const seen = sim?.entries ?? [];
  const from = seen.length;
  try {
    const out = (await fn()) ?? {};
    if (out.screen) r.screen = out.screen;
    if (out.screen && out.shot !== false) {
      // Capture stable : aucun nouvel écran journalisé pendant la capture (horloge accélérée), sinon on recommence ;
      // le contrôle au pixel porte sur le dernier écran journalisé, celui qui est affiché.
      let buf: Buffer = Buffer.alloc(0);
      let shown: Screen = out.screen;
      for (let i = 0; i < 5; i++) {
        await sim.drain();
        const before = sim.screens.length;
        buf = await sim.rawShot();
        await sim.drain();
        if (sim.screens.length === before && sim.last) {
          shown = sim.last;
          break;
        }
        await sleep(200);
      }
      const file = join(SHOTS, `${scenario}-${name}.png`);
      const checked = shown.screen === out.screen.screen ? shown : out.screen;
      // L'affichage du simulateur peut avoir un temps de retard sur le journal (mise à jour acceptée, image pas
      // encore redessinée) : nouvelle capture jusqu'à 2 s avant de conclure. Un vrai défaut de mise en page reste.
      const issues = (b: Buffer): string[] => (litPixels(b).lit > 0 ? (out.pixels !== false ? checkPixels(b, checked) : []) : ['écran noir']);
      let bad = issues(buf);
      for (let k = 0; bad.length && k < 5; k++) {
        await sleep(400);
        buf = await sim.rawShot();
        bad = issues(buf);
        if (!bad.length) notes.push(`${scenario}-${name} : capture refaite ${k + 1} fois (affichage du simulateur en retard sur le journal)`);
      }
      writeFileSync(file, buf);
      r.shot = file.slice(E2E.length + 1);
      check(litPixels(buf).lit > 0, `capture ${name} : écran noir`);
      check(!bad.length, `contrôle au pixel :\n        ${bad.join('\n        ')}`);
      if (out.relief) {
        const lv = levels(buf, checked);
        const bad = reliefIssues(out.relief, checked, lv, buf);
        check(!bad.length, `relief :\n        ${bad.join('\n        ')}`);
        if (out.relief === 'home') notes.push(`${scenario}-${name} : relief mesuré (alpha, x du 1er pixel) ${lv.filter((l) => l.label.startsWith('ligne')).map((l) => `« ${l.text.split('   ')[0]} » ${l.alpha} x${l.x0}`).join(', ')}`);
      }
      if (out.deliver) deliver(out.deliver, file);
      if (out.tour) tour(out.tour[0], file, out.tour[1]);
    }
    console.log(`  ✓ ${scenario}-${name}${r.screen ? `\n      ${show(r.screen as Screen & Record<string, unknown>)}` : ''}`);
  } catch (e) {
    r.ok = false;
    r.error = (e as Error).message;
    r.screen = sim?.last;
    // gestes écartés par l'anti-rebond ou sans effet pendant l'étape (journal QUAI_GESTURE du mode test)
    try {
      if (sim?.proc) await sim.drain();
    } catch {
      /* simulateur arrêté */
    }
    const gestures = (sim?.entries === seen ? seen.slice(from) : (sim?.entries ?? [])).filter((x) => x.message.startsWith('QUAI_GESTURE ')).map((x) => x.message.slice(13));
    if (gestures.length) r.error += ` (gestes : ${gestures.join(' ; ')})`;
    console.log(`  ✗ ${scenario}-${name} : ${r.error}${r.screen ? `\n      dernier écran : ${show(r.screen as Screen & Record<string, unknown>)}` : ''}`);
    try {
      if (sim?.proc) await sim.shot(`${scenario}-${name}-ECHEC`);
    } catch {
      /* simulateur arrêté */
    }
  }
  r.ms = Date.now() - t0;
  results.push(r);
}

async function runScenario(id: string, label: string, fn: () => Promise<void>): Promise<void> {
  if (ONLY.size && !ONLY.has(id)) return;
  scenario = id;
  console.log(`\n• ${id} : ${label}`);
  for (const f of readdirSync(SHOTS)) if (f.startsWith(`${id}-`) && f.endsWith('.png')) rmSync(join(SHOTS, f));
  const t0 = Date.now();
  try {
    await fn();
  } catch (e) {
    results.push({ scenario, step: 'scénario', ok: false, error: (e as Error).message, ms: 0 });
    console.log(`  ✗ ${id} interrompu : ${(e as Error).message}`);
  }
  if (sim.proc) {
    const errs = sim.errors().filter((e) => !/favicon|\[fetch\] 404 Not Found .*\/(line)?tiles\//i.test(e.message));
    if (errs.length) notes.push(`${id} : erreurs console : ${errs.map((e) => e.message.slice(0, 160)).join(' | ')}`);
    // diagnostic : sortie du simulateur lui-même quand une étape du scénario a échoué (affichage figé, gestes perdus)
    if (results.some((r) => r.scenario === id && !r.ok)) {
      const file = join(OUT, `sim-${id}-simulateur.log`);
      writeFileSync(file, sim.out.join('').slice(-200_000));
      notes.push(`${id} : sortie du simulateur dans ${file.slice(E2E.length + 1)}`);
    }
  }
  await sim.stop();
  durations[id] = Date.now() - t0;
}
const durations: Record<string, number> = {};

/**
 * Données publiées « cette nuit, 04:12 » (écran « Données ») : la génération est réécrite partout où elle figure
 * (meta.json, lines/index.json…) ; le cœur n'utilise les fichiers de ligne que s'ils sont de la même génération que
 * meta.json.
 */
function republish(dir: string, iso: string): void {
  const gen = (JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { generatedAt: string }).generatedAt;
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  for (const f of walk(dir)) {
    const text = readFileSync(f, 'utf8');
    if (text.includes(gen)) writeFileSync(f, text.split(gen).join(iso));
  }
}

/** Horaires des fixtures publiés la nuit du jour `day` (« 2026-11-11 ») à 04:12, servis par serve-data. */
async function dataOf(day: string): Promise<{ url: string; stop(): Promise<void> }> {
  const { dir } = await buildFixtureData({ date: day });
  republish(dir, `${day}T03:12:00.000Z`);
  const srv = await startDataServer(dir);
  return {
    url: srv.url,
    stop: async () => {
      await srv.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Contrôles communs d'un écran : aide exacte, aucune ligne coupée par « … » (CA-M1.7), pas de tiret long. */
function common(s: Screen, wantHint: string): void {
  check(hint(s) === wantHint, `aide « ${hint(s)} » au lieu de « ${wantHint} »`);
  const cut = truncatedLines(s);
  check(!cut.length, `lignes coupées : ${JSON.stringify(cut)}`);
  check(![s.title, ...s.lines].some((l) => /[\u2013\u2014]/.test(l)), 'tiret long dans un texte affiché');
}

/**
 * Double toucher : retour à l'écran attendu. Jamais sur l'accueil (écran racine : le double toucher quitte Quai) :
 * si une étape précédente a échoué avant d'en partir, on y est déjà et les étapes suivantes peuvent continuer.
 */
async function back(to: (s: Screen) => boolean, label: string): Promise<Screen> {
  await sim.drain();
  const cur = sim.last;
  if (cur?.screen === 'home') {
    check(to(cur), `${label} : déjà sur l’accueil, mais l’écran ne convient pas`);
    return cur;
  }
  await sim.input('double_click');
  return sim.waitScreen(to, 12_000, label);
}

/**
 * Étapes d'un trajet (PRD-1.2.1 § 3.1, § 3.2) : ▼ jusqu'au bout (« Fin du trajet. … »), en vérifiant à chaque geste
 * que la page, le titre et l'étiquette ne changent pas (jamais un autre trajet pendant le défilement).
 */
async function scrollToEnd(from: Screen): Promise<Screen> {
  let s = from;
  const same = (x: Screen) => x.screen === 'steps' && field(x, 'page') === field(from, 'page') && x.title === from.title && field(x, 'label') === field(from, 'label');
  for (let i = 0; i < 6 && !/^Fin du trajet\./.test(bottom(s) ?? ''); i++) {
    const before = bottom(s);
    check(/^▽ suite du trajet : \d+ étapes?$/.test(before ?? ''), `ligne du bas « ${before} » (étapes cachées : « ▽ suite du trajet : n étapes »)`);
    await sim.input('down');
    s = await sim.waitScreen((x) => x.screen !== 'steps' || bottom(x) !== before, 8_000, 'étapes suivantes (▼)');
    check(same(s), `▼ a changé de trajet ou d’écran : ${s.screen} « ${s.title} » page ${field(s, 'page')} (§ 3.1)`);
  }
  check(/^Fin du trajet\./.test(bottom(s) ?? ''), `« Fin du trajet. » jamais atteint : « ${bottom(s)} »`);
  return s;
}

/** ▼ au bout des étapes : la page « Autres trajets » (§ 3.3). */
async function openOthers(): Promise<Screen> {
  await sim.input('down');
  return sim.waitScreen(is('others', loaded), 10_000, '« Autres trajets »');
}

/**
 * Double toucher jusqu'à l'écran attendu (plusieurs écrans à remonter : départs, détail d'une ligne, rubrique…), sans
 * jamais quitter l'accueil.
 */
async function backTo(to: (s: Screen) => boolean, label: string, max = 5): Promise<Screen> {
  for (let i = 0; i < max; i++) {
    await sim.drain();
    const cur = sim.last;
    if (cur && to(cur)) return cur;
    check(cur?.screen !== 'home', `${label} : sur l’accueil, mais l’écran ne convient pas`);
    await sim.input('double_click', 700);
  }
  return sim.waitScreen(to, 12_000, label);
}

/**
 * « Suivre ce trajet » (PRD-1.2.2 § 6) : toucher sur un trajet ouvert, pas encore suivi ; le message « Trajet suivi :
 * … » remplace l'aide 2,6 s, puis l'aide du trajet suivi revient. Rend l'écran suivi, aide revenue.
 */
async function follow(label = 'trajet suivi'): Promise<Screen> {
  const before = sim.last!;
  check(before.screen === 'steps' && field(before, 'followed') === false && before.title.endsWith(FOLLOW), `« Suivre ce trajet » attendu sur la ligne du titre : « ${before.title} »`);
  await sim.input('click');
  const s = await sim.waitScreen(is('steps', (x) => field(x, 'followed') === true && /^Trajet suivi : /.test(hint(x) ?? '')), 8_000, label);
  check(s.title.endsWith(FOLLOWED) && s.title.slice(0, -FOLLOWED.length) === before.title.slice(0, -FOLLOW.length), `« Suivi » à la place de « Suivre ce trajet » : « ${s.title} »`);
  const back = await sim.waitScreen(is('steps', (x) => field(x, 'followed') === true && hint(x) === H.steps), 8_000, 'aide du trajet suivi revenue');
  // La fin du message est un rendu : l'anti-rebond des lunettes écarte un glissement reçu moins de 80 ms après un
  // rendu (DEBOUNCE.scrollAfterRenderMs, défilement parasite du G2). Un ▼ envoyé aussitôt serait perdu (journal
  // QUAI_GESTURE « écarté : après un rendu ») ; une personne, elle, réagit plus lentement.
  await sleep(300);
  return back;
}

/* ------------------------------ Lunettes, scénario 1 : le matin à Namur ------------------------------ */

async function s1(): Promise<void> {
  await sim.launch(pageUrl(PREC(S1)));
  await step('home', async () => {
    const s = await sim.waitScreen(is('home', (x) => homeReady(x) && homeFavorites(x).length === 2), 20_000, 'accueil chargé, 2 favoris');
    check(!sim.screens.some((x) => x.title === NEWS_TITLE), `pas de « ${NEWS_TITLE} » pour qui l’a déjà vu`);
    check(s.title === 'Quai' && s.clock === '07:31', `titre et heure « ${s.title} » ${s.clock}`);
    check(s.lines[0] === 'Favoris   3', `« ${s.lines[0]} » (« Favoris » et le nombre de favoris, § 1.1)`);
    const favs = homeFavorites(s);
    check(/^Bureau {3}dans [34] min → 08:58$/.test(favs[0] ?? ''), `1er favori « ${favs[0]} » (lieu : départ conseillé puis arrivée)`);
    check(/^Vers Gand-Saint-Pierre {3}\d\d:\d\d → \d\d:\d\d$/.test(favs[1] ?? ''), `2e favori « ${favs[1]} » (trajet fixe : le train de sa gare)`);
    // PRD-1.2.2 § 1.1 : la ligne vide, « Autour de moi », puis les rubriques ; 1.2.6 (PRD-1.2.6 § 1) : « Gares de
    // train », « Arrêts de bus, tram, métro », « Lignes de bus, tram, métro », à droite leur contenu (Namur ;
    // Bruxelles-Nord toutes les lignes ; tram 3 et tram 4, gardés à Gare du Nord en 1.2.5, suivis)
    check(sameList(s.lines.slice(3, 5), ['', 'Autour de moi   3 arrêts']), `fin de l’accueil ${JSON.stringify(s.lines.slice(3))}`);
    check(sameList(s.lines.slice(5), SECTIONS_CUR), `les trois rubriques ${JSON.stringify(s.lines.slice(5))} (PRD-1.2.6 § 1)`);
    check(s.sel === 1, `curseur sur le premier favori montré (sel ${s.sel})`);
    const order = field<string[]>(s, 'order') ?? [];
    check(sameList(order, ['fav-bureau', 'fav-gand', 'fav-maison']), `order ${JSON.stringify(order)} (le lieu fav-bureau en tête, Maison en fin)`);
    const shown = field<string[]>(s, 'shown') ?? [];
    check(sameList(shown, ['fav-bureau', 'fav-gand']), `shown ${JSON.stringify(shown)} : jamais « Maison » (tu y es, § 4.2)`);
    homeCommon(s, false);
    return { screen: s, relief: 'home', tour: ['glasses-home.png', 'Accueil 1.2.6, 07:31 à la maison (Namur) : « Favoris   3 », dessous en retrait le bureau et Gand-Saint-Pierre, puis « Autour de moi », « Gares de train » (Namur), « Arrêts de bus, tram, métro » (Bruxelles-Nord) et « Lignes de bus, tram, métro » (tram 3 et tram 4)'] };
  });
  await step('steps', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1 && loaded(x)), 20_000, 'étapes, page 1');
    // PRD-1.2.2 § 6 : ouvrir un favori ne le suit pas ; la ligne du titre propose de le suivre
    check(s.title === `Vers le bureau : 07:35 → 08:58${FOLLOW}`, `titre « ${s.title} »`);
    // classement 1.2.2 (PRD-1.2.2 § 7) : l'IC direct et ses 12 min à pied n'est plus proposé ; « Le suivant » reste
    check(field(s, 'pages') === 2 && field(s, 'label') === 'short' && field(s, 'followed') === false, `page ${field(s, 'page')}/${field(s, 'pages')} ${field(s, 'label')} suivi ${field(s, 'followed')}`);
    check(s.lines[0] === '! Voie modifiée : l’IC part de la voie 6', `alerte en tête « ${s.lines[0]} »`);
    check(/^07:35 {3}Partir à pied vers la gare \(7 min\) {3}dans [34] min$/.test(s.lines[1] ?? ''), `1re étape « ${s.lines[1]} »`);
    // 1.2.4 (PRD-1.2.4 § 1) : la gare où aller, en entier, sur la ligne suivante
    check(s.lines[2] === 'Namur', `gare de départ nommée « ${s.lines[2]} »`);
    check(s.lines[3] === '07:42   IC vers Bruxelles-Midi, voie 6   +2 min', `2e étape « ${s.lines[3]} »`);
    check(s.lines[4] === '08:42   Descendre à Bruxelles-Nord', `descente « ${s.lines[4]} » (IC jusqu’à Bruxelles-Nord, puis le tram 3)`);
    check(has(s, /^~?08:44 {3}Tram 3 vers /), `tram 3 de 08:44, en toutes lettres (REVUE-USAGE n° 8) ${JSON.stringify(s.lines)}`);
    // 1.2.5 (PRD-1.2.5 § 2) : l'IC a 2 min de retard, 2 min à pied, le tram à 08:44 : aucune marge
    check(has(s, /^~08:44 {3}Tram 3 vers Churchill {3}très juste$/), `marge de la correspondance du tram 3 (PRD-1.2.5 § 2) ${JSON.stringify(s.lines)}`);
    check(/^▽ suite du trajet : \d+ étapes?$/.test(bottom(s) ?? ''), `ligne du bas « ${bottom(s)} » (§ 3.2)`);
    check(s.sel === -1, `pas de repère ▶ sur un trajet pas suivi (sel ${s.sel})`);
    common(s, H.stepsOther);
    return { screen: s, tour: ['glasses-steps.png', 'Trajet proposé Maison vers Bureau, « Le plus court », pas encore suivi (« Suivre ce trajet »), alerte de voie en tête, « ▽ suite du trajet »'] };
  });
  await step('follow', async () => {
    const s = await follow();
    check(s.sel === 0, `repère ▶ sur la 1re étape (sel ${s.sel})`);
    common(s, H.steps);
    return { screen: s };
  });
  await step('followed-menu', async () => {
    // toucher sur le trajet suivi : « Ne plus suivre », puis le détail du véhicule (« Dans le train » de la 1.2.1)
    await sim.input('click');
    const m = await sim.waitScreen(is('followed', loaded), 8_000, '« Ne plus suivre »');
    check(m.title === 'Vers le bureau : trajet suivi', `titre « ${m.title} »`);
    check(sameList(m.lines.slice(0, 2), ['Ne plus suivre', 'Arrêts : IC vers Bruxelles-Midi, +2 min']) && m.sel === 0, `menu ${JSON.stringify(m.lines)} sel ${m.sel}`);
    common(m, H.followed);
    return { screen: m };
  });
  await step('train-detail', async () => {
    await sim.input('down');
    await sim.input('click');
    const s = await sim.waitScreen(is('train', loaded), 15_000, 'détail du véhicule');
    check(s.title === 'IC vers Bruxelles-Midi, +2 min', `titre « ${s.title} »`);
    // 1.2.5 (PRD-1.2.5 § 7) : la ligne de progression, train compris ; avant le départ, Namur est le prochain
    check(/^◎(─○)+ {3}descente dans \d+ arrêts$/.test(s.lines[0] ?? ''), `ligne de progression « ${s.lines[0]} » (PRD-1.2.5 § 7)`);
    check(has(s, /^Namur {3}07:44 {3}voie 6 !$/) && has(s, /^Bruxelles-Nord {3}08:42 {3}descente$/), `arrêts ${JSON.stringify(s.lines)}`);
    common(s, H.train);
    const b = await back(is('steps', (x) => field(x, 'page') === 1), 'retour aux étapes, même page');
    check(field(b, 'followed') === true, 'page 1 toujours suivie');
    return { screen: s, shot: false };
  });
  await step('end', async () => {
    const s = await scrollToEnd(sim.last!);
    check(bottom(s) === 'Fin du trajet. ▽ 1 autre trajet', `ligne du bas « ${bottom(s)} » (§ 3.2)`);
    // 1.2.5 (PRD-1.2.5 § 3) : le faux Open-Meteo annonce de la pluie à Bruxelles de 08:45 à 09:00 : la marche finale
    // (Bourse vers le bureau, 9 min) la dit, par le relais (/api/weather) ; les marches de 2 min jamais
    check(has(s, /^08:58 {3}Arrivée au bureau \(9 min à pied, pluie\)$/), `dernière étape visible, sous la pluie ${JSON.stringify(s.lines)}`);
    check(!has(s, /\(2 min[^)]*pluie\)/), `pluie sur une marche de 2 min : ${JSON.stringify(s.lines)}`);
    common(s, H.steps);
    return { screen: s };
  });
  await step('others', async () => {
    const s = await openOthers();
    check(s.title === 'Vers le bureau : autres trajets', `titre « ${s.title} » (§ 3.3)`);
    // « Le suivant » : l'IC d'une heure plus tard, puis le tram (le 3 ou le 4 selon le classement du cœur, PRD-1.2.2 § 7)
    check(NEXT_S1.test(s.lines[0] ?? '') && /^IC \+ tram [34], à pied 7 \+ 2 \+ 9 min$/.test(s.lines[1] ?? ''), `1re entrée ${JSON.stringify(s.lines.slice(0, 2))}`);
    check(s.sel === 0 && s.lines.length === 3, `curseur sur la seule entrée (sel ${s.sel}) : ${JSON.stringify(s.lines)}`);
    common(s, H.others);
    return { screen: s, relief: 'others', tour: ['glasses-journeys.png', 'Autres trajets (▼ au bout des étapes) : par entrée, le nom et les heures, puis les moyens et les marches'] };
  });
  await step('other-steps', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 2 && loaded(x)), 12_000, 'étapes de « Le suivant »');
    check(field(s, 'label') === 'next' && field(s, 'followed') === false, `label ${field(s, 'label')}, suivi ${field(s, 'followed')}`);
    check(new RegExp(`^Vers le bureau : 08:33 → \\d\\d:\\d\\d${FOLLOW}$`).test(s.title), `titre « ${s.title} » (§ 3.4)`);
    // « même trajet » seulement si le cœur reprend le même tram (classement du § 7)
    check(/^Le suivant : (même trajet, )?1 h plus tard$/.test(s.lines[0] ?? ''), `raison « ${s.lines[0]} »`);
    check(has(s, /^~?08:42 {3}IC vers Bruxelles-Midi, voie 5$/), 'IC 08:42 voie 5');
    check(s.sel === -1, 'pas de repère ▶ sur un trajet non suivi');
    common(s, H.stepsOther);
    return { screen: s };
  });
  await step('other-end', async () => {
    const end = await scrollToEnd(sim.last!);
    check(bottom(end) === 'Fin du trajet. ▽ autres trajets', `ligne du bas « ${bottom(end)} » (§ 3.2, trajet ouvert depuis la liste)`);
    // ▼ au bout d'un trajet ouvert depuis la liste : retour à la liste
    await sim.input('down');
    const l = await sim.waitScreen(is('others'), 8_000, 'retour à la liste par ▼');
    check(l.sel === 0, `curseur sur la même entrée (sel ${l.sel})`);
    return { screen: end, shot: false };
  });
  await step('back-to-first', async () => {
    // double toucher sur la liste : les étapes du premier trajet, à leur fin
    const s = await back(is('steps', (x) => field(x, 'page') === 1), 'étapes du 1er trajet');
    check(bottom(s) === 'Fin du trajet. ▽ 1 autre trajet' && field(s, 'followed') === true, `à la fin du 1er trajet, suivi : « ${bottom(s)} » ${field(s, 'followed')}`);
    await sim.input('up');
    const up = await sim.waitScreen(is('steps', (x) => /^▽ suite du trajet/.test(bottom(x) ?? '')), 8_000, '▲ : les étapes du haut');
    await sim.input('up');
    await sleep(600);
    await sim.drain();
    check(field(sim.last!, 'page') === 1 && sim.last!.title === up.title && sim.last!.screen === 'steps', '▲ en haut des étapes : jamais un autre trajet (§ 3.1)');
    return { screen: s, shot: false };
  });
  await step('follow-other', async () => {
    await scrollToEnd(sim.last!);
    await openOthers();
    await sim.input('click');
    await sim.waitScreen(is('steps', (x) => field(x, 'page') === 2), 8_000, 'page 2');
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 2 && field(x, 'followed') === true), 8_000, 'page 2 suivie');
    check(hint(s) === 'Trajet suivi : IC 08:42', `message « ${hint(s)} »`);
    const l = await back(is('others'), 'retour à la liste');
    check(hint(l) === H.others, `le message ne suit pas sur la liste : « ${hint(l)} »`);
    const p1 = await back(is('steps', (x) => field(x, 'page') === 1), 'page 1');
    check(field(p1, 'followed') === false && hint(p1) === H.stepsOther && p1.title.endsWith(FOLLOW), `page 1 plus suivie : ${field(p1, 'followed')} « ${hint(p1)} » « ${p1.title} »`);
    return { screen: s, shot: false };
  });
  await step('favorites', async () => {
    const h = await back(homeReady, 'retour à l’accueil');
    check(h.sel === 1, `curseur gardé sur le premier favori (sel ${h.sel})`);
    await sim.select(0);
    await sim.input('click');
    const s = await sim.waitScreen(is('favorites', loaded), 25_000, '« Favoris » ouvre la liste de tous les favoris');
    check(s.title === 'Favoris', `titre « ${s.title} » (§ 1.2, REVUE-USAGE n° 5)`);
    const order = field<string[]>(s, 'order') ?? [];
    check(sameList(order, ['fav-bureau', 'fav-gand', 'fav-maison']), `les 3 favoris, « Maison » (tu y es) en fin de liste : ${JSON.stringify(order)}`);
    // REVUE-USAGE n° 7 : la ligne de l'accueil, puis le détail plus pâle
    check(/^Bureau {3}dans [34] min → 08:58$/.test(s.lines[0] ?? '') && /^IC 07:42 \+2 voie 6 !, 1 changement$/.test(s.lines[1] ?? ''), `Bureau ${JSON.stringify(s.lines.slice(0, 2))}`);
    check(/^Vers Gand-Saint-Pierre {3}/.test(s.lines[2] ?? '') && s.lines[3] === 'IC voie 4 à Bruxelles-Central', `Gand ${JSON.stringify(s.lines.slice(2, 4))}`);
    check(s.lines[4] === 'Maison   tu y es', `« ${s.lines[4]} » sans 2e ligne`);
    common(s, H.favorites);
    return { screen: s, tour: ['glasses-favorites.png', '« Favoris » (1.2.2) : la ligne de l’accueil, puis le détail ; « Maison   tu y es » sur une ligne'] };
  });
  await step('recents', async () => {
    // PRD-1.2.2 § 1.2 : sous les favoris, la ligne pâle « Adresses récentes », 3 adresses au plus, puis « Autre adresse »
    await sim.select(3);
    const first = await sim.waitScreen(is('favorites', (x) => loaded(x) && x.lines.includes('ADRESSES RÉCENTES')), 25_000, 'adresses récentes calculées');
    const k = first.lines.indexOf('ADRESSES RÉCENTES');
    check(first.sel === 3 && /^Grand-Place {3}/.test(first.lines[k + 1] ?? ''), `curseur sur la 1re adresse, jamais sur la ligne pâle (sel ${first.sel}) : ${JSON.stringify(first.lines)}`);
    await sim.select(6);
    const s = await sim.waitScreen(is('favorites', (x) => loaded(x) && x.sel === 6), 25_000, 'bas de « Favoris »');
    const rec = s.lines.filter((l) => /^(Grand-Place|Korenmarkt|Place de la Monnaie) {3}/.test(l));
    check(rec.length === 3 && rec.every((l) => / {3}(maintenant|dans \d+ min|\d\d:\d\d) → \d\d:\d\d$/.test(l)), `les 3 adresses récentes, au format de l’accueil : ${JSON.stringify(s.lines)}`);
    check(s.lines.at(-2) === 'Autre adresse   sur le téléphone', `« Autre adresse » en dernier : ${JSON.stringify(s.lines)}`);
    common(s, H.favorites);
    return { screen: s, tour: ['glasses-places.png', '« Favoris » : sous les favoris, la ligne pâle « Adresses récentes », les adresses avec leur réponse, puis « Autre adresse »'] };
  });
  await step('place-steps', async () => {
    await sim.select(0);
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1 && loaded(x)), 20_000, 'étapes vers le bureau');
    check(s.title === `Vers le bureau : 07:35 → 08:58${FOLLOW}` && field(s, 'label') === 'short' && field(s, 'followed') === false, `« ${s.title} » ${field(s, 'label')}`);
    await back(is('favorites'), 'retour à « Favoris »');
    await sim.select(2);
    await sim.input('click');
    const m = await sim.waitScreen(is('message', (x) => x.title === 'Vers la maison'), 8_000, '« Tu es déjà à la maison. »');
    check(m.lines[0] === 'Tu es déjà à la maison.', `« ${m.lines[0]} »`);
    common(m, H.message);
    await back(is('favorites'), 'retour à « Favoris »');
    await sim.select(6);
    await sim.input('click');
    const t = await sim.waitScreen(is('favorites', (x) => hint(x) === 'Tape l’adresse dans Quai, sur le téléphone'), 8_000, 'message « Autre adresse »');
    return { screen: t, shot: false };
  });
  await step('stations', async () => {
    const h = await back(homeReady, 'retour à l’accueil');
    await sim.select(homeIndex(h, STATIONS_ROW));
    await sim.input('click');
    const s = await sim.waitScreen(is('stations', loaded), 15_000, '« Gares de train »');
    check(s.title === 'Gares de train', `titre « ${s.title} » (PRD-1.2.6 § 1)`);
    check(s.lines[0] === 'Namur   IC 07:42 +2 voie 6 !', `« ${s.lines[0]} » (le prochain train, retard et voie modifiée)`);
    common(s, H.stations);
    return { screen: s, deliver: 'g08', tour: ['glasses-stations.png', '« Gares » : la gare choisie et son prochain train'] };
  });
  await step('station-board', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('board', (x) => loaded(x) && /^Namur, train/.test(x.title)), 15_000, 'départs de Namur');
    check(s.title === 'Namur, train (SNCB) ★', `titre « ${s.title} » (★ : la gare est dans « Gares »)`);
    // PRD-1.2.3 § 1 (CA-123.1) : la ligne ★ en tête (gare gardée : « ★ retirer la gare »), le curseur sur le premier départ
    check(s.lines[0] === '★ retirer la gare' && s.sel === 1, `ligne ★ en tête et curseur sur le 1er départ : « ${s.lines[0]} » sel ${s.sel}`);
    check(/^IC {3}Bruxelles-Midi {3}07:42 \+2 {2}voie 6 !$/.test(s.lines[1] ?? ''), `1er départ « ${s.lines[1]} »`);
    const n = field<number>(s, 'departures') ?? 0;
    notes.push(`s1-station-board : Namur à 07:31, ${n} départs dans les 2 heures (données de test)`);
    check(n >= 2, `départs au tableau de Namur : ${n}`);
    common(s, H.board);
    return { screen: s, deliver: 'g13', tour: ['glasses-board-full.png', 'Tableau complet de Namur (1.2.3) : la ligne ★ en tête, tous les départs des 2 prochaines heures, le curseur sur le premier'] };
  });
  await step('departure-stops', async () => {
    // PRD-1.2.3 § 2 (CA-123.2) : l'IC de 07:42 : Namur en tête, au plus clair, puis ses arrêts jusqu'au terminus
    await sim.input('click');
    const s = await sim.waitScreen(is('stops', (x) => loaded(x) && x.lines.length > 2), 15_000, 'arrêts de l’IC de 07:42');
    check(s.title === 'IC vers Bruxelles-Midi', `titre « ${s.title} » (le véhicule et sa destination)`);
    check(/^07:42 \+2 {3}Namur {3}voie 6 !$/.test(s.lines[0] ?? ''), `l’arrêt du tableau en tête, retard et voie modifiée : « ${s.lines[0]} »`);
    const rows = listRows(s);
    check(rows.length >= 2 && rows.every((r) => /^~?\d\d:\d\d( \+\d+)? {3}\S/.test(r)), `arrêts suivants (heure, nom, voie) : ${JSON.stringify(rows)}`);
    check(rows.some((r) => / {3}voie \S+( !)?$/.test(r)), `voies des gares : ${JSON.stringify(rows)}`);
    check(s.sel === 0, `curseur sur le 1er arrêt suivant (sel ${s.sel})`);
    common(s, H.stops);
    return { screen: s, deliver: 'g14', tour: ['glasses-stops.png', 'Arrêts de l’IC de 07:42 au départ de Namur (1.2.3) : Namur en tête, au plus clair, puis chaque gare jusqu’au terminus, avec l’heure, le retard et la voie'] };
  });
  await step('stops-terminus', async () => {
    // ▼ jusqu'au dernier arrêt (la liste défile par page) : le terminus, les heures dans l'ordre du trajet
    const first = sim.last!;
    const count = field<number>(first, 'stops') ?? 0;
    check(count >= 3, `arrêts de l’IC : ${count}`);
    const seen: string[] = [...listRows(first)];
    for (let i = 1; i <= count - 2; i++) {
      await sim.input('down');
      const x = await sim.waitScreen(is('stops', (y) => y.sel === i), 6_000, `arrêt ${i + 1}`);
      const top = field<number>(x, 'top') ?? 0;
      listRows(x).forEach((r, k) => (seen[top + k] = r));
      if (top !== field<number>(sim.screens[sim.screens.length - 2] ?? x, 'top')) check(top === i, `page suivante au curseur : top ${top}, sel ${i}`);
    }
    const end = sim.last!;
    check(/ {3}Bruxelles-Midi( {3}voie \S+( !)?)?$/.test(seen[seen.length - 1] ?? ''), `terminus en dernier : ${JSON.stringify(seen)}`);
    const times = seen.map(minutesOfRow);
    check(times.every((t, k) => k === 0 || t >= times[k - 1]), `heures dans l’ordre du trajet : ${JSON.stringify(seen)}`);
    common(end, H.stops);
    return { screen: end };
  });
  let stopName = '';
  await step('stop-board', async () => {
    // toucher un arrêt : son tableau (§ 2), pour aller plus loin
    await sim.select(0);
    stopName = (listRows(sim.last!)[0] ?? '').split('   ')[1] ?? '';
    await sim.input('click');
    const b = await sim.waitScreen(is('board', (x) => loaded(x) && x.title.startsWith(`${stopName},`)), 15_000, `tableau de ${stopName}`);
    check(b.lines[0] === '★ garder la gare' && b.sel === 1, `« ★ garder la gare » en tête, curseur sur le 1er départ : « ${b.lines[0]} » sel ${b.sel}`);
    common(b, H.board);
    return { screen: b };
  });
  await step('stop-board-stops', async () => {
    // et l'un de ses départs : ses arrêts, cette gare en tête
    await sim.input('click');
    const s2 = await sim.waitScreen(is('stops', (x) => loaded(x) && x.lines.length > 1), 15_000, `arrêts d’un départ de ${stopName}`);
    check(new RegExp(`^\\S+( \\+\\d+)? {3}${stopName}( {3}|$)`).test(s2.lines[0] ?? ''), `${stopName} en tête : « ${s2.lines[0]} » (${s2.title})`);
    common(s2, H.stops);
    return { screen: s2 };
  });
  await step('stops-back', async () => {
    // chaque double toucher revient d'un écran, le curseur où il était : tableau, arrêts de l'IC, tableau de Namur
    const b2 = await back(is('board', (x) => x.title.startsWith(`${stopName},`)), `double toucher : le tableau de ${stopName}`);
    check(b2.sel === 1, `curseur gardé sur le départ (sel ${b2.sel})`);
    const s1b = await back(is('stops', (x) => x.title === 'IC vers Bruxelles-Midi'), 'double toucher : les arrêts de l’IC');
    check(s1b.sel === 0, `curseur gardé sur ${stopName} (sel ${s1b.sel})`);
    const nb2 = await back(is('board', (x) => /^Namur, train/.test(x.title)), 'double toucher : le tableau de Namur');
    check(nb2.sel === 1, `curseur gardé sur l’IC de 07:42 (sel ${nb2.sel})`);
    return { screen: nb2 };
  });
  await step('board-pages', async () => {
    // CA-123.1 : ▼ de départ en départ jusqu'au dernier ; tous les départs des 2 prochaines heures (07:31 à 09:31),
    // dans l'ordre des heures (Namur, données de test : un train par heure ; les pages : s2-board-pages)
    const first = sim.last!;
    const n = field<number>(first, 'departures') ?? 0;
    const seen: string[] = [...listRows(first)];
    let prevTop = field<number>(first, 'top') ?? 0;
    for (let i = 2; i <= n; i++) {
      // un ▼ moins de 80 ms après un rendu serait écarté (anti-rebond, comme dans follow()) : le rythme d'une personne
      await sleep(150);
      await sim.input('down');
      const x = await sim.waitScreen(is('board', (y) => y.sel === i), 6_000, `départ ${i}`);
      const top = field<number>(x, 'top') ?? 0;
      if (top !== prevTop) check(top === i, `page suivante au curseur : top ${top}, sel ${i}`);
      prevTop = top;
      listRows(x).forEach((r, k) => (seen[top + k] = r));
    }
    const deps = seen.slice(1);
    check(deps.length === n, `${deps.length} départs vus pour ${n} : ${JSON.stringify(seen)}`);
    const times = deps.map(minutesOfRow);
    check(times.every((t, k) => t >= 7 * 60 + 30 && t <= 9 * 60 + 31 && (k === 0 || t >= times[k - 1])), `départs des 2 prochaines heures, dans l’ordre : ${JSON.stringify(deps)}`);
    // ▲ depuis le haut d'une page : la page d'avant, qui finit au curseur
    const end = sim.last!;
    if ((field<number>(end, 'top') ?? 0) > 0) {
      const t = field<number>(end, 'top') ?? 0;
      await sim.select(t);
      await sim.input('up');
      const up = await sim.waitScreen(is('board', (y) => y.sel === t - 1), 6_000, 'page d’avant');
      check((field<number>(up, 'top') ?? 0) < t, `▲ : la page d’avant (top ${field<number>(up, 'top')})`);
    }
    common(sim.last!, H.board);
    return { screen: sim.last! };
  });
  await step('lines', async () => {
    await back(is('stations'), 'double toucher : « Gares de train »');
    const h = await backTo(homeReady, 'retour à l’accueil');
    await sim.select(homeIndex(h, STOPS_ROW));
    await sim.input('click');
    const s = await sim.waitScreen(is('lines', loaded), 20_000, '« Arrêts de bus, tram, métro »');
    check(s.title === 'Arrêts de bus, tram, métro', `titre « ${s.title} » (PRD-1.2.6 § 2)`);
    // 1.2.5 (PRD-1.2.5 § 4) : l'arrêt, pâle, puis ses prochains départs, un par ligne, « Bus 232 vers Vilvorde   ~13 min » ;
    // 1.2.6 : plus d'intitulé « ARRÊTS », l'écran porte ce nom
    check(s.lines[0] === 'Bruxelles-Nord', `l’arrêt en tête ${JSON.stringify(s.lines.slice(0, 3))}`);
    const deps = s.lines.slice(1).filter((l) => SEG_ROW.test(l));
    check(deps.length >= 1 && deps.length <= 2 && deps.every((l) => /^Bus \d+ vers \S.* {3}(~?\d+ min|imminent|demain .+)$/.test(l)), `les départs de l’arrêt, un par ligne : ${JSON.stringify(s.lines)}`);
    check(s.sel === 0, `curseur sur l’arrêt (sel ${s.sel})`);
    common(s, H.lines);
    // 1.2.5 : contrôle au pixel des mots placés par segRow, et luminosité mot par mot (relief « lines »)
    return { screen: s, relief: 'lines' };
  });
  await step('follows', async () => {
    await back(homeReady, 'double toucher : l’accueil');
    await sim.select(homeIndex(sim.last!, LINES_ROW));
    await sim.input('click');
    // 1.2.6 (PRD-1.2.6 § 3) : un sens par rangée, la ligne et sa destination au plus clair, « vers » pâle, sans attente
    const f = await sim.waitScreen(is('follows', (x) => loaded(x) && x.lines.filter((l) => SEG_ROW.test(l)).length >= 3), 15_000, '« Lignes de bus, tram, métro »');
    check(f.title === 'Lignes de bus, tram, métro', `titre « ${f.title} »`);
    check(sameList(f.lines.slice(0, 3), ['Tram 3 vers Churchill', 'Tram 3 vers Esplanade', 'Tram 4 vers Stalle']), `un sens par rangée : ${JSON.stringify(f.lines)}`);
    check(f.sel === 0, `curseur sur le 1er sens (sel ${f.sel})`);
    common(f, H.follows);
    return { screen: f, relief: 'lines' };
  });
  await step('line-run', async () => {
    await sim.input('click');
    const r = await sim.waitScreen(is('lineRun', (x) => loaded(x) && x.title === 'Tram 3 vers Churchill'), 15_000, 'tout le tram 3 vers Churchill');
    // les arrêts du sens, ○ (● : un tram arrive), les 2 prochains passages ; à Namur, loin de toute la ligne : le
    // curseur sur le premier arrêt
    const stops = r.lines.filter((l) => /^[○●◇◆] [^:]/.test(l));
    check(stops.length >= 3 && stops.every((l) => /^[○●◇◆] \S.* {3}(~?\d+ · ~?\d+ min|~?\d+ min|imminent.*|aucun passage|.*\d\d:\d\d)$/.test(l)), `arrêts de la ligne : ${JSON.stringify(r.lines)}`);
    check(r.sel === 0 && (field<number>(r, 'nearest') ?? -1) === -1, `curseur sur le 1er arrêt, aucun arrêt proche (sel ${r.sel})`);
    common(r, H.lineRun);
    return { screen: r };
  });
  await step('line-run-other-way', async () => {
    const n = field<number>(sim.last!, 'stops') ?? 0;
    await sim.select(n);
    await sim.waitScreen(is('lineRun', (x) => x.sel === n), 8_000, '▼ jusqu’à « ↔ Autre sens »');
    check(sim.last!.lines.includes('↔ Autre sens vers Esplanade'), `« ↔ Autre sens vers Esplanade » : ${JSON.stringify(sim.last!.lines)}`);
    await sim.input('click');
    const o = await sim.waitScreen(is('lineRun', (x) => loaded(x) && x.title === 'Tram 3 vers Esplanade'), 15_000, 'l’autre sens');
    common(o, H.lineRun);
    return { screen: o };
  });
  await step('lines-all-stop', async () => {
    // CA-123.3 (lunettes) : un arrêt « toutes les lignes » : ses 2 prochains départs sur la ligne ; toucher : son
    // tableau complet (ligne ★ en tête, le curseur sur le premier départ)
    const h = await backTo(homeReady, 'retour à l’accueil');
    await sim.select(homeIndex(h, STOPS_ROW));
    await sim.input('click');
    await sim.waitScreen(is('lines', loaded), 20_000, '« Arrêts de bus, tram, métro »');
    await sim.input('click');
    const b = await sim.waitScreen(is('board', (x) => loaded(x) && /De Lijn/.test(x.title)), 15_000, 'tableau de Bruxelles-Nord De Lijn');
    check(b.title === 'Bruxelles-Nord, bus (De Lijn) ★', `titre « ${b.title} »`);
    check(b.lines[0] === '★ garder une ligne' && b.sel === 1 && /^232 {3}Vilvorde {3}/.test(b.lines[1] ?? ''), `ligne ★, puis le 1er départ : ${JSON.stringify(b.lines.slice(0, 2))} sel ${b.sel}`);
    check((field<number>(b, 'departures') ?? 0) > 2, `tous les départs des 2 heures : ${field<number>(b, 'departures')}`);
    common(b, H.board);
    return { screen: b };
  });
  await step('exit', async () => {
    await backTo(homeReady, 'retour à l’accueil');
    const mark = sim.out.join('').length;
    await sim.input('double_click', 2_500);
    check(/ShutDownPageContainer/.test(sim.out.join('').slice(mark)), 'double toucher sur l’accueil : shutDownPageContainer non appelé');
  });
}

/* ------------------------------ Scénario 1 sans temps réel (scène noRT) ------------------------------ */

async function s1noRT(): Promise<void> {
  await stack.scene('noRT');
  try {
    await sim.launch(pageUrl(PCUR(S1)));
    await step('home', async () => {
      const s = await sim.waitScreen(is('home', (x) => homeReady(x) && x.lines[0] === HOME_RT_DOWN && homeFavorites(x).length === 2), 25_000, 'accueil, temps réel indisponible');
      check(s.lines[1] === 'Favoris   3', `« ${s.lines[1]} »`);
      const favs = homeFavorites(s);
      check(/^Bureau {3}dans [12] min → 08:58$/.test(favs[0] ?? ''), `1er favori « ${favs[0]} »`);
      check(has(s, /^Gares de train {3}1 gare$/), `« Gares de train   1 gare » (PRD-1.2.6 § 1) : ${JSON.stringify(s.lines)}`);
      homeCommon(s, false);
      return { screen: s, relief: 'home' };
    });
    await step('bottom-reachable', async () => {
      // la ligne du haut prend une ligne : « Lignes de bus, tram, métro », la dernière, reste à l'écran, atteinte par ▼ (CA-M1.9)
      const at = homeIndex(sim.last!, LINES_ROW);
      await sim.select(at);
      const s = await sim.waitScreen(is('home', (x) => x.sel === at && LINES_ROW.test(hint(x) ?? '')), 8_000, '« Lignes de bus, tram, métro » amené par ▼');
      return { screen: s, shot: false };
    });
    await step('steps', async () => {
      await sim.select(1);
      await sim.input('click');
      const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1 && loaded(x)), 20_000, 'étapes');
      check(s.title === `Vers le bureau : 07:33 → 08:58${FOLLOW}`, `titre « ${s.title} »`);
      check(field(s, 'label') === 'short' && field(s, 'pages') === 2, `étiquette ${field(s, 'label')}, ${field(s, 'pages')} pages`);
      // 1.2.5 (PRD-1.2.5 § 1) : départ à pied à 07:33, dans 2 min : « Si tu le rates » (l'IC suivant de Namur, « Le
      // suivant ») à la place de la raison « Le plus court : 1 changement, à pied 7 + 2 + 9 min »
      check(/^Si tu le rates : arrivée (09:5\d|10:0\d), (\d+ min|\d+ h( \d\d)?) plus tard$/.test(s.lines[0] ?? ''), `« Si tu le rates » en haut « ${s.lines[0]} » (PRD-1.2.5 § 1)`);
      check(has(s, /^~07:42 {3}IC vers Bruxelles-Midi, voie 4$/), 'IC ~07:42 voie 4');
      common(s, H.stepsOther);
      return { screen: s };
    });
    await step('others', async () => {
      await scrollToEnd(sim.last!);
      const s = await openOthers();
      // classement 1.2.2 (PRD-1.2.2 § 7) : l'IC direct et ses 12 min à pied, au-delà de la marche maximale, n'est jamais
      // « Sans changement » ; reste « Le suivant »
      check(s.lines.length === 3 && NEXT_S1.test(s.lines[0] ?? '') && /^IC \+ tram [34], à pied 7 \+ 2 \+ 9 min$/.test(s.lines[1] ?? ''), `entrées ${JSON.stringify(s.lines)}`);
      common(s, H.others);
      return { screen: s, relief: 'others' };
    });
    await step('next', async () => {
      await sim.input('click');
      const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 2 && loaded(x)), 8_000, 'page 2');
      check(field(s, 'label') === 'next' && field(s, 'followed') === false, `page 2 ${field(s, 'label')}`);
      check(new RegExp(`^Vers le bureau : 08:33 → \\d\\d:\\d\\d${FOLLOW}$`).test(s.title), `titre « ${s.title} »`);
      check(/^Le suivant : (même trajet, )?1 h plus tard$/.test(s.lines[0] ?? ''), `raison « ${s.lines[0]} »`);
      check(has(s, /^~08:42 {3}IC vers Bruxelles-Midi, voie \d+$/) && s.sel === -1, 'IC ~08:42, pas de repère');
      common(s, H.stepsOther);
      return { screen: s };
    });
    await step('up-top', async () => {
      const before = sim.last!;
      await sim.input('up');
      await sleep(600);
      await sim.drain();
      check(sim.last!.screen === 'steps' && field(sim.last!, 'page') === 2 && sim.last!.title === before.title, '▲ en haut : rien ne change (jamais la proposition précédente)');
      return { screen: sim.last!, shot: false };
    });
    await step('stations-planned', async () => {
      // « Gares » sans temps réel : « ~ » et la note, comme « Autour de moi »
      await backTo(homeReady, 'accueil');
      await sim.select(homeIndex(sim.last!, STATIONS_ROW));
      await sim.input('click');
      const s = await sim.waitScreen(is('stations', loaded), 15_000, '« Gares »');
      check(/^Namur {3}IC ~07:42 voie 4$/.test(s.lines[0] ?? ''), `« ${s.lines[0]} » (horaire prévu, « ~ »)`);
      check(s.lines.includes('~ horaire prévu, sans temps réel'), `note du bas : ${JSON.stringify(s.lines)}`);
      common(s, H.stations);
      return { screen: s };
    });
  } finally {
    await stack.scene('base');
  }
}

/* ------------------------------ Trajet suivi en accéléré : en cours, dans le train, descente ------------------------------ */

async function s1run(): Promise<void> {
  await sim.launch(pageUrl({ ...PCUR(S1), mockSpeed: '30', mockPath: PATH_S1 }));
  await step('walking', async () => {
    await sim.waitScreen(is('home'), 20_000, 'accueil');
    await sim.input('click');
    // PRD-1.2.2 § 6 : ouvert, pas suivi ; toucher « Suivre ce trajet » (au moins 220 ms après le toucher précédent,
    // filtre des gestes des G2)
    await sim.waitScreen(is('steps', (x) => field(x, 'followed') === false && x.title.endsWith(FOLLOW)), 20_000, 'étapes, pas encore suivies');
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'followed') === true && has(x, /Partir à pied vers la gare \(7 min\) {3}en cours$/)), 40_000, 'marche « en cours »');
    check(s.lines[0] === '! Voie modifiée : l’IC part de la voie 6', `alerte « ${s.lines[0]} »`);
    check(s.sel === 0 && s.title.endsWith(FOLLOWED), `repère sur la marche en cours, « Suivi » : sel ${s.sel} « ${s.title} »`);
    return { screen: s, tour: ['glasses-steps-alert.png', 'Étapes du trajet suivi à 07:36 : « Suivi », marche en cours, voie modifiée en tête'] };
  });
  await step('home-running', async () => {
    // REVUE-USAGE n° 1 et n° 8 : « En cours » remplace la ligne de son favori ; le train, son heure, son retard, sa voie
    const s = await back(is('home', (x) => /^En cours : vers le bureau {3}IC 07:42 \+2 voie 6 !$/.test(x.lines[0] ?? '')), 'accueil avec « En cours »');
    check(s.lines[1] === 'Favoris   3' && /^Vers Gand-Saint-Pierre {3}/.test(s.lines[2] ?? '') && !homeFavorites(s).some((l) => /^Bureau/.test(l)), `« Favoris » sous « En cours », sans le bureau : ${JSON.stringify(s.lines.slice(0, 3))}`);
    check(s.sel === 0, `curseur sur « En cours » (comme en 1.2, sel ${s.sel})`);
    homeCommon(s, false);
    return { screen: s, relief: 'home' };
  });
  await step('resume-from-home', async () => {
    await sim.select(0);
    await sim.input('click');
    const s = await sim.waitScreen((x) => (x.screen === 'steps' && field(x, 'followed') === true) || x.screen === 'train', 10_000, 'trajet en cours rouvert');
    return { screen: s, shot: false };
  });
  await step('in-vehicle', async () => {
    const s = await sim.waitScreen(is('train', clockAtLeast('08:05')), 120_000, 'dans le train vers 08:05');
    check(s.title === 'IC vers Bruxelles-Midi, +2 min', `titre « ${s.title} »`);
    check(has(s, /^Gembloux {3}07:57 {3}passé$/) && has(s, /^Ottignies {3}08:11 {3}prochain$/) && has(s, /^Bruxelles-Nord {3}08:42 {3}descente$/), `arrêts ${JSON.stringify(s.lines)}`);
    // 1.2.5 (PRD-1.2.5 § 7) : Namur et Gembloux passés, Ottignies le prochain : « ●─●─◎─… descente dans n arrêts »
    check(/^●─●─◎(─○)+ {3}descente dans \d+ arrêts$/.test(s.lines[0] ?? ''), `ligne de progression « ${s.lines[0]} » (PRD-1.2.5 § 7)`);
    common(s, H.train);
    return { screen: s, deliver: 'g16', tour: ['glasses-train.png', 'Dans le train à 08:05, ouvert seul au départ de l’IC suivi : la ligne de progression en haut (1.2.5)'] };
  });
  await step('tram', async () => {
    // correspondance à Bruxelles-Nord : le tram 3 de 08:44 s'ouvre seul à son départ (comme l'IC)
    const s = await sim.waitScreen(is('train', (x) => /^Tram 3 /.test(x.title) && clockAtLeast('08:44')(x)), 150_000, 'dans le tram 3 vers 08:44');
    check(has(s, /descente$/), `descente du tram ${JSON.stringify(s.lines)}`);
    check(/^[●◎○─…]+ {3}descente (au prochain arrêt|dans \d+ arrêts)$/.test(s.lines[0] ?? ''), `ligne de progression du tram « ${s.lines[0]} » (PRD-1.2.5 § 7)`);
    common(s, H.train);
    return { screen: s, pixels: false };
  });
  await step('alight', async () => {
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'followed') === true && clockAtLeast('08:49')(x)), 120_000, 'retour aux étapes à la descente du tram');
    // 1.2.5 : pluie prévue sur la marche finale (faux Open-Meteo, 08:45 à 09:00 à Bruxelles)
    check(has(s, /^08:58 {3}Arrivée au bureau \(9 min à pied, pluie\) {3}en cours$/), `marche finale en cours ${JSON.stringify(s.lines)}`);
    // 7 étapes (marche, IC, descente, marche, tram 3, descente, arrivée) : le repère sur la 7e, l'arrivée
    check(s.sel === 6, `repère sur la dernière étape (sel ${s.sel})`);
    check(bottom(s) === 'Fin du trajet. ▽ 1 autre trajet', `le repère reste visible, la fin du trajet aussi : « ${bottom(s)} »`);
    const h = await back(is('home', (x) => /^En cours : vers le bureau {3}arrivée 08:58$/.test(x.lines[0] ?? '')), 'accueil, « En cours » jusqu’à l’arrivée');
    return { screen: h, shot: false };
  });
  await step('ended', async () => {
    const s = await sim.waitScreen(is('home', (x) => !/^En cours/.test(x.lines[0] ?? '') && clockAtLeast('09:03')(x)), 90_000, 'fin du trajet (arrivée plus 5 min)');
    return { screen: s, shot: false };
  });
}

/** CA-M6.5 dans une même session : l'IC part sans l'utilisateur resté à la maison, le trajet en cours prend fin. */
async function s1stay(): Promise<void> {
  await sim.launch(pageUrl({ ...PCUR(S1), mockSpeed: '30' }));
  await step('not-left', async () => {
    await sim.waitScreen(is('home'), 20_000, 'accueil');
    await sim.input('click');
    await sim.waitScreen(is('steps', (x) => field(x, 'followed') === false), 15_000, 'étapes, pas encore suivies');
    await sim.input('click');
    await sim.waitScreen(is('steps', (x) => field(x, 'followed') === true), 15_000, 'étapes suivies');
    // (le filtre des gestes ignore un double toucher moins de 220 ms après un toucher)
    await sleep(300);
    await sim.input('double_click');
    await sim.waitScreen(is('home', (x) => /^En cours : vers le bureau/.test(x.lines[0] ?? '')), 40_000, '« En cours » après 07:35');
    const s = await sim.waitScreen(is('home', (x) => !/^En cours/.test(x.lines[0] ?? '') && clockAtLeast('07:44')(x)), 90_000, '« En cours » retiré après le départ de l’IC');
    return { screen: s, shot: false };
  });
}

/** CA-122.7 dans une même session : un trajet ouvert, jamais suivi, ne passe jamais « En cours » ni « Dans le train ». */
async function s1open(): Promise<void> {
  await sim.launch(pageUrl({ ...PCUR(S1), mockSpeed: '30' }));
  await step('never-followed', async () => {
    await sim.waitScreen(is('home'), 20_000, 'accueil');
    await sim.input('click');
    await sim.waitScreen(is('steps', (x) => field(x, 'followed') === false), 15_000, 'étapes, pas suivies');
    const s = await sim.waitScreen(is('steps', clockAtLeast('07:45')), 60_000, 'les étapes, jusqu’après le départ de l’IC');
    check(!sim.screens.some((x) => x.screen === 'train'), 'jamais « Dans le train » pour un trajet pas suivi');
    check(field(s, 'followed') === false, 'toujours pas suivi');
    await sleep(300);
    const h = await back(is('home'), 'accueil');
    check(!/^En cours/.test(h.lines[0] ?? ''), `jamais « En cours » pour un trajet pas suivi : « ${h.lines[0]} »`);
    return { screen: h, shot: false };
  });
}

/* ------------------------------ Scénario 2 : gare du Nord, lignes ouvertes d'office, « garder une ligne », panne du temps réel ------------------------------ */

async function s2(): Promise<void> {
  await sim.launch(pageUrl(PCUR(S2)));
  await step('board-near', async () => {
    // REVUE-USAGE n° 4, 1.2.6 (PRD-1.2.6 § 4) : tram 3 et tram 4 gardés à Gare du Nord (l'arrêt favori « près » de la
    // 1.2.1) sont des lignes suivies, l'arrêt en repère : à moins de 300 m, ses départs s'ouvrent seuls
    const s = await sim.waitScreen(is('board', loaded), 20_000, 'départs de Gare du Nord ouverts seuls');
    check(s.title === 'Gare du Nord, tram (STIB) ★' && s.sel === 1, `« ${s.title} » sel ${s.sel} (★ : l’arrêt repère de lignes suivies)`);
    check(s.lines[0] === '★ garder une ligne' && /^T3 {3}Churchill {3}[12] min$/.test(s.lines[1] ?? '') && /^T4 {3}Stalle {3}[45] min$/.test(s.lines[2] ?? ''), `ligne ★, puis le tram 3 et le tram 4 en temps réel : ${JSON.stringify(s.lines)}`);
    common(s, H.board);
    return { screen: s, deliver: 'g09', tour: ['glasses-board-near.png', 'À moins de 300 m de la gare du Nord (1.2.6) : les départs de l’arrêt repère du tram 3 et du tram 4 s’ouvrent seuls, comme l’arrêt favori de la 1.2.1'] };
  });
  await step('follows', async () => {
    const h = await back(homeReady, 'double toucher : l’accueil');
    await sim.select(homeIndex(h, LINES_ROW));
    await sim.input('click');
    const s = await sim.waitScreen(is('follows', (x) => loaded(x) && x.lines.filter((l) => SEG_ROW.test(l)).length >= 3), 15_000, '« Lignes de bus, tram, métro »');
    check(s.title === 'Lignes de bus, tram, métro', `titre « ${s.title} » (PRD-1.2.6 § 3)`);
    check(sameList(s.lines.slice(0, 3), ['Tram 3 vers Churchill', 'Tram 3 vers Esplanade', 'Tram 4 vers Stalle']), `un sens par rangée, sans attente : ${JSON.stringify(s.lines)}`);
    common(s, H.follows);
    return { screen: s, relief: 'lines', deliver: 'g15', tour: ['glasses-follows.png', '« Lignes de bus, tram, métro » (1.2.6) : un sens par rangée, « Tram 3 vers Churchill », la ligne et sa destination au plus clair, « vers » pâle'] };
  });
  await step('line-run', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('lineRun', (x) => loaded(x) && x.title === 'Tram 3 vers Churchill'), 15_000, 'tout le tram 3 vers Churchill');
    // l'arrêt le plus proche (Gare du Nord, à 80 m) sous le curseur ; ● : un tram arrive ; la STIB annonce ses passages
    // à Gare du Nord (temps réel), les autres arrêts en horaire prévu (« ~ »)
    const at = field<number>(s, 'nearest') ?? -1;
    check(at === 1 && s.sel === 1, `curseur sur l’arrêt le plus proche (nearest ${at}, sel ${s.sel})`);
    const gdn = s.lines.find((l) => / Gare du Nord à \d+ m {3}/.test(l)) ?? '';
    check(/^[○●◇◆] Gare du Nord à [5-9]0 m {3}[12] · (9|10) min$/.test(gdn), `Gare du Nord, sa distance, ses 2 passages en temps réel : « ${gdn} »`);
    check(s.lines.includes('~ horaire prévu, sans temps réel'), `« ~ » expliqué : ${JSON.stringify(s.lines)}`);
    common(s, H.lineRun);
    return { screen: s, deliver: 'g10', tour: ['glasses-line-run.png', 'Tout le tram 3 vers Churchill (1.2.6) : chaque arrêt et ses 2 prochains passages, ● quand un tram arrive, l’arrêt le plus proche sous le curseur'] };
  });
  await step('line-detail', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('line', loaded), 15_000, 'passages du tram 3 à Gare du Nord');
    // 1.2.3 : curseur sur le premier passage (« vers … » ne se sélectionne jamais), la liste défile par page
    check(s.title === 'Tram 3 · Gare du Nord' && s.sel === 0, `« ${s.title} », curseur sur le 1er passage (sel ${s.sel})`);
    check(s.lines.filter((l) => /^vers (Churchill|Esplanade)$/.test(l)).length >= 1, `sens du tram 3 : ${JSON.stringify(s.lines)}`);
    check(s.lines.filter((l) => /^~?\d\d:\d\d( .*)? {3}(dans \d+ min|imminent)$/.test(l)).length >= 4, `4 passages par sens (heure, attente) : ${JSON.stringify(s.lines)}`);
    common(s, H.line);
    return { screen: s, tour: ['glasses-line.png', 'Les passages du tram 3 à la gare du Nord, dans les deux sens, puis « Tous les départs de l’arrêt »'] };
  });
  await step('passage-stops', async () => {
    // PRD-1.2.3 § 2 : toucher un passage du détail : ses arrêts ; Gare du Nord en tête, sans voie (tram)
    await sim.input('click');
    const s = await sim.waitScreen(is('stops', (x) => loaded(x) && x.lines.length > 2), 15_000, 'arrêts d’un passage du tram 3');
    check(/^Tram 3 vers (Churchill|Esplanade)$/.test(s.title), `titre « ${s.title} »`);
    check(/^\d\d:\d\d( \+\d+)? {3}Gare du Nord$/.test(s.lines[0] ?? ''), `Gare du Nord en tête, en temps réel : « ${s.lines[0]} »`);
    const rows = listRows(s);
    check(rows.length >= 2 && rows.every((r) => /^~?\d\d:\d\d( \+\d+)? {3}\S/.test(r)), `arrêts suivants : ${JSON.stringify(rows)}`);
    check(s.sel === 0, `curseur sur le 1er arrêt suivant (sel ${s.sel})`);
    common(s, H.stops);
    return { screen: s, tour: ['glasses-stops-tram.png', 'Arrêts d’un passage du tram 3 (1.2.3), ouverts depuis le détail de la ligne : Gare du Nord en tête, puis chaque arrêt jusqu’au terminus'] };
  });
  await step('passage-back', async () => {
    const d = await back(is('line'), 'double toucher : le détail du tram 3');
    check(d.sel === 0, `curseur gardé sur le passage (sel ${d.sel})`);
    return { screen: d, shot: false };
  });
  await step('board-stop', async () => {
    // « Tous les départs de l'arrêt », en bas du détail : le tableau complet de l'arrêt (PRD-1.2.3 § 1)
    const items = field<number>(sim.last!, 'items') ?? 0;
    check(items >= 3, `éléments du détail : ${items}`);
    await sim.select(items - 1);
    await sim.input('click');
    const s = await sim.waitScreen(is('board', loaded), 15_000, 'tous les départs de l’arrêt');
    check(s.title === 'Gare du Nord, tram (STIB) ★', `titre « ${s.title} » (★ : une de ses lignes est gardée)`);
    check(s.lines[0] === '★ garder une ligne' && s.sel === 1, `« ★ garder une ligne » en tête, curseur sur le 1er départ : « ${s.lines[0]} » sel ${s.sel}`);
    const want = [/^T3 {3}Churchill {3}[12] min$/, /^T4 {3}Stalle {3}[45] min$/, /^T3 {3}Esplanade {3}[56] min$/, /^T3 {3}Churchill {3}(9|10) min$/, /^T4 {3}Stalle {3}1[23] min$/];
    want.forEach((re, i) => check(re.test(s.lines[i + 1] ?? ''), `départ ${i + 1} « ${s.lines[i + 1]} »`));
    check((field<number>(s, 'departures') ?? 0) > want.length, `tous les départs des 2 heures : ${field<number>(s, 'departures')}`);
    // ▲▼ : de départ en départ, puis la ligne ★
    await sim.input('down');
    check((await sim.waitScreen(is('board', (x) => x.sel === 2), 6_000, '▼ : 2e départ')).sel === 2, '▼');
    await sim.input('up');
    await sim.waitScreen(is('board', (x) => x.sel === 1), 6_000, '▲ : 1er départ');
    common(s, H.board);
    return { screen: s, tour: ['glasses-board.png', 'Tous les départs de l’arrêt de la gare du Nord (★ : ses lignes sont gardées ; la ligne ★ en tête)'] };
  });
  await step('keep-line-undo', async () => {
    await sim.select(0);
    await sim.input('click', 300);
    const k = await sim.waitScreen(is('keepLine', loaded), 8_000, '« Gare du Nord : garder une ligne »');
    check(k.title === 'Gare du Nord : garder une ligne', `titre « ${k.title} »`);
    check(sameList(k.lines.slice(0, 2), ['tram 3   ★', 'tram 4   ★']), `lignes de l’arrêt ${JSON.stringify(k.lines)}`);
    common(k, H.keepLine);
    await sim.select(1);
    await sim.input('click', 300);
    const off = await sim.waitScreen(is('keepLine', (x) => hint(x) === '★ Retirée. Toucher encore : annuler'), 6_000, '« ★ Retirée. Toucher encore : annuler »');
    check(off.lines[1] === 'tram 4', `tram 4 sans ★ : « ${off.lines[1]} »`);
    await sim.input('click', 300);
    const on = await sim.waitScreen(is('keepLine', (x) => hint(x) === '★ Ligne rétablie'), 4_000, '« ★ Ligne rétablie » (moins de 5 s)');
    check(on.lines[1] === 'tram 4   ★', `★ revenu : « ${on.lines[1]} »`);
    await sim.waitScreen(is('keepLine', (x) => hint(x) === H.keepLine), 6_000, 'aide revenue');
    return { screen: k, deliver: 'g11', tour: ['glasses-keep-line.png', '« Gare du Nord : garder une ligne », ouvert par ★ sur ses départs'] };
  });
  await step('home', async () => {
    const s = await backTo(is('home', (x) => homeReady(x) && homeFavorites(x).length === 2), 'accueil');
    const order = field<string[]>(s, 'order') ?? [];
    check(order[0] === 'fav-bureau' && order.length === 3, `order ${JSON.stringify(order)}`);
    const favs = homeFavorites(s);
    check(s.lines[0] === 'Favoris   3', `« ${s.lines[0]} »`);
    check(/^Bureau {3}(maintenant|dans \d+ min) → \d\d:\d\d$/.test(favs[0] ?? ''), `1er favori « ${favs[0]} »`);
    check(/^Vers Gand-Saint-Pierre {3}14:10 → 14:39$/.test(favs[1] ?? ''), `2e favori « ${favs[1]} »`);
    check(has(s, /^Autour de moi {3}4 arrêts$/), `« Autour de moi   4 arrêts » ${JSON.stringify(s.lines)}`);
    check(sameList(s.lines.slice(-3), SECTIONS_CUR), `le contenu des trois rubriques (PRD-1.2.6 § 1) : ${JSON.stringify(s.lines)}`);
    homeCommon(s, false);
    return { screen: s, relief: 'home' };
  });
  await step('favorites', async () => {
    await sim.select(0);
    await sim.input('click');
    const s = await sim.waitScreen(is('favorites', loaded), 20_000, '« Favoris »');
    const order = field<string[]>(s, 'order') ?? [];
    check(order.length === 3 && order[0] === 'fav-bureau', `les 3 favoris, dans l’ordre du cœur : ${JSON.stringify(order)} (CA-M1.3)`);
    check(/^Bureau {3}/.test(s.lines[0] ?? '') && /^(tram|bus|métro|IC) /.test(s.lines[1] ?? ''), `Bureau et son détail : ${JSON.stringify(s.lines)}`);
    common(s, H.favorites);
    return { screen: s };
  });
  await step('favorites-scroll', async () => {
    const order = field<string[]>(sim.last!, 'order') ?? [];
    await sim.select(order.indexOf('fav-gand'));
    const s = await sim.waitScreen(is('favorites', (x) => has(x, /^Vers Gand-Saint-Pierre {3}/)), 8_000, 'Gand-Saint-Pierre');
    check(has(s, /^Vers Gand-Saint-Pierre {3}14:10 → 14:39$/) && has(s, /^IC voie 4 à Bruxelles-Central$/), `Gand ${JSON.stringify(s.lines)}`);
    common(s, H.favorites);
    return { screen: s };
  });
  await step('nearby', async () => {
    const h = await back(homeReady, 'accueil');
    await sim.select(homeIndex(h, /^Autour de moi {3}/));
    await sim.input('click');
    const s = await sim.waitScreen(is('nearby', loaded), 15_000, 'Autour de moi');
    const want = [/^Gare du Nord, tram {3}80 m {3}T3 [12] min$/, /^Bruxelles-Nord, train {3}160 m {3}IC 12:22 v\.9$/, /^Bruxelles-Nord, bus De Lijn {3}200 m {3}232 ~[45] min$/, /^Rogier, métro {3}340 m {3}M2 [23] min$/];
    want.forEach((re, i) => check(re.test(s.lines[i] ?? ''), `zone ${i + 1} « ${s.lines[i]} »`));
    common(s, H.nearby);
    return { screen: s, pixels: false, tour: ['glasses-nearby.png', 'Autour de moi à 12:10 près de la gare du Nord'] };
  });
  await step('board-planned', async () => {
    await sim.select(2);
    await sim.input('click');
    const s = await sim.waitScreen(is('board', (x) => loaded(x) && /De Lijn/.test(x.title)), 15_000, 'départs De Lijn');
    check(s.title === 'Bruxelles-Nord, bus (De Lijn) ★', `titre « ${s.title} » (★ : l’arrêt « toutes les lignes » est gardé)`);
    check(s.lines[0] === '★ garder une ligne' && (s.lines[1]?.startsWith('232   Vilvorde   ~') ?? false), `ligne ★, puis le 1er départ « ${s.lines[1]} »`);
    common(s, H.board);
    return { screen: s, pixels: false, tour: ['glasses-board-planned.png', 'Départs De Lijn en partie en horaire prévu (~)'] };
  });
  await step('board-pages', async () => {
    // CA-123.1 : tableau complet de Bruxelles-Nord De Lijn (16 départs à 12:10) : ▼ de départ en départ jusqu'au
    // dernier ; la page suivante commence au curseur ; les départs de 12:10 à 14:10, dans l'ordre des heures ; ▲ depuis
    // le haut d'une page : la page d'avant
    const first = sim.last!;
    const n = field<number>(first, 'departures') ?? 0;
    check(n > 8, `tableau complet : ${n} départs (plus que les 8 de l’ancien réglage)`);
    const seen: string[] = [...listRows(first)];
    let prevTop = field<number>(first, 'top') ?? 0;
    let flips = 0;
    for (let i = 2; i <= n; i++) {
      // un ▼ moins de 80 ms après un rendu serait écarté (anti-rebond, comme dans follow()) : le rythme d'une personne
      await sleep(150);
      await sim.input('down');
      const x = await sim.waitScreen(is('board', (y) => y.sel === i), 6_000, `départ ${i}`);
      const top = field<number>(x, 'top') ?? 0;
      if (top !== prevTop) {
        check(top === i, `page suivante au curseur : top ${top}, sel ${i}`);
        flips++;
      }
      prevTop = top;
      listRows(x).forEach((r, k) => (seen[top + k] = r));
    }
    const deps = seen.slice(1);
    check(flips >= 1 && deps.length === n, `${deps.length} départs vus pour ${n}, ${flips} page(s) suivante(s)`);
    const times = deps.map((r) => minutesOfRow(r, 12 * 60 + 10)).filter((t) => !Number.isNaN(t));
    check(times.length >= n - 2 && times.every((t, k) => t >= 12 * 60 + 9 && t <= 14 * 60 + 10 && (k === 0 || t >= times[k - 1])), `départs des 2 prochaines heures, dans l’ordre : ${JSON.stringify(deps)}`);
    const t = field<number>(sim.last!, 'top') ?? 0;
    await sim.select(t);
    await sim.input('up');
    const up = await sim.waitScreen(is('board', (y) => y.sel === t - 1), 6_000, 'page d’avant');
    check((field<number>(up, 'top') ?? 0) < t && (field<number>(up, 'top') ?? 0) + listRows(up).length - 1 === t - 1, `▲ : la page d’avant, qui finit au curseur (top ${field<number>(up, 'top')})`);
    common(up, H.board);
    return { screen: up };
  });
  await step('board-train', async () => {
    await back(is('nearby'), 'retour à Autour de moi');
    await sim.select(1);
    await sim.input('click');
    const s = await sim.waitScreen(is('board', (x) => loaded(x) && /train/.test(x.title)), 15_000, 'départs des trains');
    check(s.title === 'Bruxelles-Nord, train (SNCB)', `titre « ${s.title} » (gare pas dans « Gares »)`);
    check(s.lines[0] === '★ garder la gare', `ligne ★ « ${s.lines[0]} »`);
    check(/^IC {3}Anvers-Central {3}12:22 {2}voie 9$/.test(s.lines[1] ?? ''), `1er départ « ${s.lines[1]} »`);
    check(/^S1 {3}.*12:34 {2}SUPPRIMÉ$/.test(s.lines[3] ?? ''), `S1 supprimé, à sa place « ${s.lines[3]} »`);
    check(s.lines.filter((l) => /12:22/.test(l)).length === 1, 'IC 12:22 une seule fois');
    common(s, H.board);
    return { screen: s, pixels: false };
  });
  await step('rt-outage', async () => {
    const t0 = Date.now();
    await stack.scene('noRT');
    try {
      const s = await sim.waitScreen(is('board', (x) => /train/.test(x.title) && /~12:22/.test(x.lines[1] ?? '') && x.lines.includes(RT_DOWN)), 45_000, 'panne du temps réel dite juste');
      notes.push(`s2 : panne du temps réel affichée après ${((Date.now() - t0) / 1000).toFixed(1)} s (rafraîchissement 30 s)`);
      check(/^S1 {3}.*12:34 {2}SUPPRIMÉ$/.test(s.lines[3] ?? ''), `suppression gardée 15 min (CA-M8.6) : « ${s.lines[3]} »`);
      await back(is('nearby'), 'Autour de moi');
      const h = await back(is('home', (x) => x.lines[0] === HOME_RT_DOWN), 'accueil, ligne du haut « Temps réel indisponible : horaires prévus » (sans « ~ »)');
      check(!h.lines.some((l) => /~/.test(l)), `aucun « ~ » sur l’accueil (§ 4.5) : ${JSON.stringify(h.lines)}`);
      return { screen: h, pixels: false, shot: false };
    } finally {
      await stack.scene('base');
    }
  });
}

/* ------------------------------ Scénario 3 : l'après-midi vers Gand ------------------------------ */

async function s3(): Promise<void> {
  await sim.launch(pageUrl(PCUR(S3)));
  await step('home', async () => {
    const s = await sim.waitScreen(is('home', (x) => homeReady(x) && homeFavorites(x).length >= 2), 20_000, 'accueil');
    const favs = homeFavorites(s);
    check(/^Vers Gand-Saint-Pierre {3}/.test(favs[0] ?? '') && / → 14:39$/.test(favs[0] ?? ''), `1er favori « ${favs[0]} » (trajet fixe : départ puis arrivée)`);
    check(/^Bureau {3}(maintenant|dans \d+ min) → \d\d:\d\d$/.test(favs[1] ?? ''), `2e favori « ${favs[1]} »`);
    homeCommon(s, false);
    return { screen: s, relief: 'home' };
  });
  await step('steps', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1 && loaded(x)), 20_000, 'étapes');
    check(s.title === `Vers Gand-Saint-Pierre : 14:10 → 14:39${FOLLOW}`, `titre « ${s.title} » (pas de marche au début)`);
    check(s.lines[0] === 'Le plus court : direct', `raison « ${s.lines[0]} » (CA-1.6)`);
    // 1.2.4 (PRD-1.2.4 § 1) : un trajet qui commence à bord dit de quelle gare (« depuis Bruxelles-Central »)
    check(
      /^14:10 {3}IC vers Bruges, voie 4 {3}dans 1[45] min$/.test(s.lines[1] ?? '') && s.lines[2] === 'depuis Bruxelles-Central' && s.lines[3] === '14:39   Arrivée à Gand-Saint-Pierre',
      `étapes ${JSON.stringify(s.lines.slice(1, 4))}`,
    );
    check(bottom(s) === 'Fin du trajet. ▽ 2 autres trajets' && field(s, 'pages') === 3, `ligne du bas « ${bottom(s)} », ${field(s, 'pages')} pages`);
    common(s, H.stepsOther);
    return { screen: s, tour: ['glasses-trip.png', 'Vers Gand-Saint-Pierre, trajet fixe de gare à gare : « Le plus court : direct », « Suivre ce trajet », « Fin du trajet. ▽ 2 autres trajets »'] };
  });
  await step('labels', async () => {
    const labels = [field<string>(sim.last!, 'label')];
    const list = await openOthers();
    // PRD-1.2.2 § 7 : un seul « Le suivant » ; le train d'après, de même structure, est « Plus tard »
    check(sameList(list.lines.slice(0, 4), ['Le suivant   14:25 → 14:56', 'IC', 'Plus tard   14:40 → 15:09', 'IC']), `entrées ${JSON.stringify(list.lines)}`);
    for (let i = 0; i < 2; i++) {
      await sim.select(i);
      await sim.input('click');
      const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === i + 2), 8_000, `page ${i + 2}`);
      labels.push(field<string>(s, 'label'));
      await back(is('others'), 'retour à la liste');
    }
    check(sameList(labels, ['short', 'next', 'later']), `étiquettes ${JSON.stringify(labels)} (CA-M3.3, CA-1.6)`);
    await back(is('steps', (x) => field(x, 'page') === 1), 'page 1');
  });
  await step('followed-menu', async () => {
    // suivre, puis toucher : « Ne plus suivre » et le détail du train
    await follow();
    await sim.input('click');
    const m = await sim.waitScreen(is('followed', loaded), 8_000, '« Ne plus suivre »');
    check(m.title === 'Vers Gand-Saint-Pierre : trajet suivi', `titre « ${m.title} »`);
    check(sameList(m.lines.slice(0, 2), ['Ne plus suivre', 'Arrêts : IC vers Bruges']), `menu ${JSON.stringify(m.lines)}`);
    common(m, H.followed);
    return { screen: m, deliver: 'g12', tour: ['glasses-followed.png', 'Toucher sur un trajet suivi : « Ne plus suivre », puis le détail du train'] };
  });
  await step('train-detail', async () => {
    await sim.input('down');
    await sim.input('click');
    const s = await sim.waitScreen(is('train', loaded), 15_000, 'détail du train');
    check(s.title === 'IC vers Bruges' && has(s, /^Gand-Saint-Pierre {3}14:39 {3}descente$/), `« ${s.title} » ${JSON.stringify(s.lines)}`);
    common(s, H.train);
    return { screen: s, pixels: false, tour: ['glasses-train-detail.png', 'Détail du train suivi (« Arrêts : IC vers Bruges »)'] };
  });
  await step('unfollow', async () => {
    const st = await back(is('steps', (x) => field(x, 'followed') === true), 'retour aux étapes suivies');
    await sim.input('click');
    await sim.waitScreen(is('followed'), 8_000, '« Ne plus suivre »');
    await sim.select(0);
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'followed') === false && hint(x) === 'Suivi arrêté'), 8_000, '« Suivi arrêté »');
    check(s.title.endsWith(FOLLOW) && s.sel === -1, `« Suivre ce trajet » de nouveau, sans repère : « ${s.title} » sel ${s.sel}`);
    return { screen: st, shot: false };
  });
}

/**
 * Scénario 3 en accéléré : dans le train à 14:10, aide à l'arrivée 3 min avant Gand-Saint-Pierre (CA-M2.5) ;
 * « ★ garder ce trajet » sur un trajet venu d'un favori : déjà gardé (PRD-1.2 § 2.3).
 */
async function s3run(): Promise<void> {
  await sim.launch(pageUrl({ ...PCUR({ ...S3, mockNow: '2026-11-10T14:05:00+01:00' }), mockSpeed: '20', mockPath: PATH_S3 }));
  await step('train', async () => {
    await sim.waitScreen(is('home'), 20_000, 'accueil');
    await sim.input('click');
    await sim.waitScreen(is('steps', (x) => field(x, 'followed') === false), 20_000, 'étapes, pas encore suivies');
    await sim.input('click');
    await sim.waitScreen(is('steps', (x) => field(x, 'followed') === true), 20_000, 'étapes suivies');
    const s = await sim.waitScreen(is('train', clockAtLeast('14:10')), 60_000, 'dans le train à 14:10');
    check(s.title === 'IC vers Bruges', `titre « ${s.title} »`);
    return { screen: s, pixels: false };
  });
  await step('arrival', async () => {
    const s = await sim.waitScreen(is('arrival', (x) => loaded(x) && x.lines.some((l) => /^Tram 1 /.test(l))), 120_000, 'aide à l’arrivée');
    check(s.title === 'Arrivée à Gand-Saint-Pierre', `titre « ${s.title} »`);
    check(/^Dans \d+ min\. Ensuite, devant la gare :$/.test(s.lines[0] ?? ''), `« ${s.lines[0]} »`);
    check(s.lines.filter((l) => /^Tram 1 {3}Korenmarkt {3}~?\d+ min$/.test(l)).length >= 1, `trams vers Korenmarkt ${JSON.stringify(s.lines)}`);
    check((s.clock ?? '') >= '14:36' && (s.clock ?? '') < '14:39', `vers 14:36 (${s.clock})`);
    common(s, H.arrival);
    return { screen: s, pixels: false, tour: ['glasses-arrival.png', 'Aide à l’arrivée 3 min avant Gand-Saint-Pierre'] };
  });
  await step('keep-already', async () => {
    // Horloge accélérée (×20) : le message ne reste que 130 ms ; on le cherche dans tout le journal depuis le toucher.
    await sim.drain();
    const mark = sim.screens.length;
    await sim.input('click', 300);
    let s: Screen | undefined;
    for (const t0 = Date.now(); !s && Date.now() - t0 < 5_000; await sleep(100)) {
      await sim.drain();
      s = sim.screens.slice(mark).find((x) => x.screen === 'arrival' && hint(x) === '★ Déjà dans les favoris');
    }
    check(s, `« ★ Déjà dans les favoris » (trajet suivi depuis le favori « Vers Gand-Saint-Pierre ») : ${JSON.stringify(sim.screens.slice(mark).map(hint))}`);
    let h: Screen | undefined;
    for (let i = 0; i < 4 && !h; i++) {
      await sleep(i ? 0 : 2_800);
      await sim.input('double_click');
      await sleep(600);
      await sim.drain();
      if (sim.last?.screen === 'home') h = sim.last;
    }
    check(h, 'retour à l’accueil par double toucher');
    const home = await sim.waitScreen(homeReady, 15_000, 'accueil chargé');
    check((field<string[]>(home, 'order') ?? []).length === 3, `aucun favori ajouté : ${JSON.stringify(field(home, 'order'))}`);
    return { screen: s, shot: false };
  });
}

/* ------------------------------ Waterloo : l'accueil, le trajet, « Autres trajets » (PRD-1.2.1 § 3, § 4 ; PRD-1.2.2 § 1) ------------------------------ */

async function waterloo(): Promise<void> {
  await sim.launch(pageUrl(PWAT(WAT)));
  await step('home', async () => {
    const s = await sim.waitScreen(is('home', (x) => homeReady(x) && homeFavorites(x).length === 2), 25_000, 'accueil, 2 favoris');
    check(s.title === 'Quai' && s.clock === '07:31', `titre et heure « ${s.title} » ${s.clock}`);
    check(s.lines[0] === 'Favoris   3', `« ${s.lines[0]} » (3 favoris : la gare de Waterloo est rangée dans « Gares »)`);
    const favs = homeFavorites(s);
    // départ conseillé 07:32 : « dans 1 min » à 07:31:00, « maintenant » quelques secondes plus tard (minutes arrondies vers le bas)
    check(/^Bureau {3}(maintenant|dans 1 min) → 08:46$/.test(favs[0] ?? ''), `1er favori « ${favs[0]} » (§ 4.3)`);
    check(/^Mama {3}(maintenant|dans 1 min) → 08:47$/.test(favs[1] ?? ''), `2e favori « ${favs[1]} »`);
    check(sameList(s.lines.slice(3), ['', 'Autour de moi   1 arrêt', 'Gares de train   1 gare', 'Arrêts de bus, tram, métro   à choisir', 'Lignes de bus, tram, métro   à choisir']), `fin de l’accueil ${JSON.stringify(s.lines.slice(3))} (PRD-1.2.2 § 1.1, PRD-1.2.6 § 1)`);
    const shown = field<string[]>(s, 'shown') ?? [];
    check(!shown.includes('fav-maison') && (field<string[]>(s, 'order') ?? []).length === 3, `jamais « Maison » (tu y es, § 4.2) : shown ${JSON.stringify(shown)}`);
    check(s.sel === 1, `curseur sur le premier favori montré (sel ${s.sel})`);
    homeCommon(s, false);
    return { screen: s, relief: 'home', deliver: 'g01' };
  });
  await step('favorites', async () => {
    await sim.select(0);
    const h = await sim.waitScreen(is('home', (x) => x.sel === 0), 8_000, '▲ : « Favoris »');
    check(h.lines[0] === 'Favoris   3', '« Favoris » sélectionné');
    await sim.input('click');
    const s = await sim.waitScreen(is('favorites', loaded), 20_000, 'liste de tous les favoris');
    const order = field<string[]>(s, 'order') ?? [];
    check(s.title === 'Favoris' && order.length === 3 && order[order.length - 1] === 'fav-maison', `les 3 favoris, « Maison » en fin de liste : « ${s.title} » ${JSON.stringify(order)} (CA-121.5)`);
    common(s, H.favorites);
    return { screen: s };
  });
  await step('steps-middle', async () => {
    const b = await back(homeReady, 'retour à l’accueil');
    check(b.sel === 0, `curseur gardé sur « Favoris » (sel ${b.sel})`);
    await sim.select(1);
    await sim.input('click');
    const o = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1 && loaded(x)), 25_000, 'étapes vers le bureau');
    check(o.title === `Vers le bureau : 07:32 → 08:46${FOLLOW}`, `titre « ${o.title} »`);
    check(field(o, 'label') === 'short' && field(o, 'pages') === 3 && field(o, 'followed') === false, `page 1 ${field(o, 'label')} / ${field(o, 'pages')} suivi ${field(o, 'followed')}`);
    // suivi sur demande (PRD-1.2.2 § 6)
    const s = await follow();
    // 1.2.5 (PRD-1.2.5 § 1) : départ à pied à 07:32 : « Si tu le rates » à la place de la raison (« Moins de marche : 1
    // changement, à pied 2 + 2 + 3 min ») ; raté à l'arrêt du bus W, « Le suivant » en repart (09:04), jamais le S1 de la
    // gare (« Plus tôt »), qu'on ne rattrape pas de l'arrêt
    check(s.lines[0] === 'Si tu le rates : arrivée 09:04, 18 min plus tard', `« Si tu le rates » en haut « ${s.lines[0]} » (PRD-1.2.5 § 1)`);
    check(/^07:32 {3}Partir à pied vers l’arrêt \(2 min\) {3}(maintenant|dans 1 min|en cours)$/.test(s.lines[1] ?? '') && has(s, /^~07:36 {3}Bus W vers Bruxelles Midi$/), `marche puis bus W, en toutes lettres ${JSON.stringify(s.lines)}`);
    check(/^▽ suite du trajet : \d+ étapes?$/.test(bottom(s) ?? ''), `ligne du bas « ${bottom(s)} » (§ 3.2)`);
    check(s.sel === 0, `repère ▶ sur la 1re étape (sel ${s.sel})`);
    common(s, H.steps);
    return { screen: s, deliver: 'g02' };
  });
  await step('steps-end', async () => {
    const s = await scrollToEnd(sim.last!);
    check(bottom(s) === 'Fin du trajet. ▽ 2 autres trajets', `ligne du bas « ${bottom(s)} »`);
    check(has(s, /^~08:29 {3}Métro 2 vers Simonis \(Elisabeth\)$/) && has(s, /^08:46 {3}Arrivée au bureau \(3 min à pied\)$/), `métro 2 puis arrivée ${JSON.stringify(s.lines)}`);
    common(s, H.steps);
    return { screen: s, deliver: 'g03' };
  });
  await step('others', async () => {
    const s = await openOthers();
    check(s.title === 'Vers le bureau : autres trajets', `titre « ${s.title} »`);
    check(s.lines[0] === 'Plus tôt   07:34 → 08:30' && s.lines[1] === 'S1, 16 min plus tôt, mais 19 min à pied', `1re entrée ${JSON.stringify(s.lines.slice(0, 2))} (§ 3.3)`);
    check(s.lines[2] === 'Le suivant   07:52 → 09:04' && s.lines[3] === 'bus W + métro 2, à pied 2 + 2 + 3 min', `2e entrée ${JSON.stringify(s.lines.slice(2, 4))}`);
    check(s.sel === 0, `curseur ▶ sur la 1re entrée (sel ${s.sel})`);
    common(s, H.others);
    return { screen: s, relief: 'others', deliver: 'g04' };
  });
  await step('earlier', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 2 && loaded(x)), 12_000, 'étapes de « Plus tôt »');
    check(field(s, 'label') === 'earlier' && field(s, 'followed') === false, `page 2 ${field(s, 'label')} suivi ${field(s, 'followed')}`);
    check(s.title === `Vers le bureau : 07:34 → 08:30${FOLLOW}`, `titre « ${s.title} » (§ 3.4)`);
    check(s.lines[0] === 'Plus tôt de 16 min, mais 19 min à pied', `raison « ${s.lines[0]} » (§ 2.2)`);
    check(has(s, /^07:34 {3}Partir à pied vers la gare \(19 min\)/) && has(s, /^~07:55 {3}S1 vers Bruxelles-Nord, voie 1$/), `19 min à pied puis le S1 ${JSON.stringify(s.lines)}`);
    check(bottom(s) === 'Fin du trajet. ▽ autres trajets' && s.sel === -1, `ligne du bas « ${bottom(s)} », pas de repère`);
    common(s, H.stepsOther);
    return { screen: s, deliver: 'g05' };
  });
  await step('list-and-back', async () => {
    // ▼ au bout d'un trajet ouvert depuis la liste : la liste ; le suivant ; double toucher : la liste, puis le 1er
    await sim.input('down');
    const l = await sim.waitScreen(is('others'), 8_000, 'retour à la liste par ▼');
    check(l.sel === 0, `curseur sur « Plus tôt » (sel ${l.sel})`);
    await sim.select(1);
    await sim.input('click');
    const n = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 3 && loaded(x)), 12_000, 'étapes de « Le suivant »');
    check(n.title === `Vers le bureau : 07:52 → 09:04${FOLLOW}` && n.lines[0] === 'Le suivant : même trajet, 20 min plus tard', `« ${n.title} » « ${n.lines[0]} »`);
    const l2 = await back(is('others'), 'double toucher : la liste');
    check(l2.sel === 1, `curseur sur « Le suivant » (sel ${l2.sel})`);
    const p1 = await back(is('steps', (x) => field(x, 'page') === 1), 'double toucher sur la liste : le 1er trajet');
    check(bottom(p1) === 'Fin du trajet. ▽ 2 autres trajets' && field(p1, 'followed') === true, `le 1er trajet, à sa fin, toujours suivi : « ${bottom(p1)} »`);
    return { screen: n, shot: false };
  });
  await step('stations', async () => {
    // « Gares de train » : la gare de Waterloo (arrêt favori de la 1.2.1, rangé) ; arrêts et lignes vides : où choisir
    const h = await backTo(homeReady, 'accueil');
    await sim.select(homeIndex(h, STATIONS_ROW));
    await sim.input('click');
    const s = await sim.waitScreen(is('stations', loaded), 15_000, '« Gares de train »');
    check(/^Waterloo {3}S1 ~?07:55 voie 1$/.test(s.lines[0] ?? ''), `« ${s.lines[0]} »`);
    common(s, H.stations);
    return { screen: s };
  });
  await step('stops-empty', async () => {
    const h = await back(homeReady, 'accueil');
    await sim.select(homeIndex(h, STOPS_ROW));
    await sim.input('click');
    const s = await sim.waitScreen(is('home', (x) => x.title === CHOOSE_STOPS), 8_000, `« ${CHOOSE_STOPS} » à la place du titre (PRD-1.2.6 § 2)`);
    sameRows(s, h);
    return { screen: s, pixels: false };
  });
  await step('lines-empty', async () => {
    const h = await sim.waitScreen(is('home', (x) => homeReady(x) && x.title === 'Quai'), 8_000, '« Quai » revenu');
    await sim.select(homeIndex(h, LINES_ROW));
    await sim.input('click');
    const s = await sim.waitScreen(is('home', (x) => x.title === CHOOSE_LINES), 8_000, `« ${CHOOSE_LINES} » à la place du titre (PRD-1.2.2 § 1.3)`);
    sameRows(s, h);
    return { screen: s, pixels: false };
  });
}

/**
 * Jour férié (PRD-1.2.1 § 4.7, § 5 ; CA-121.7) : le 11/11, la dernière ligne de l'accueil (la ligne vide saute pour
 * lui laisser la place, REVUE-USAGE n° 1) ; le 12/11, rien. Horaires publiés la nuit même (ceux du 10/11 donneraient
 * « Horaires d’hier » le 11/11 et seraient périmés le 12/11).
 */
async function holiday(): Promise<void> {
  const d11 = await dataOf('2026-11-11');
  try {
    await sim.launch(pageUrl(PWAT(WAT_1111), '', { data: d11.url }));
    await step('home-1111', async () => {
      const s = await sim.waitScreen(is('home', (x) => homeReady(x) && homeFavorites(x).length === 2), 25_000, 'accueil le 11/11');
      check(s.lines[0] === 'Favoris   3', `pas de ligne du haut : « ${s.lines[0]} »`);
      check(hint(s) === HOLIDAY, `dernière ligne « ${hint(s)} » au lieu de « ${HOLIDAY} »`);
      check(s.lines.filter((l) => l === HOLIDAY).length === 1, 'une seule ligne de jour férié');
      homeCommon(s, false);
      return { screen: s, relief: 'home', deliver: 'g06' };
    });
    await step('steps-1111', async () => {
      await sim.input('click');
      const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1 && loaded(x)), 25_000, 'trajet du 11/11');
      check(/^Vers le bureau : \d\d:\d\d → \d\d:\d\d {3}Suivre ce trajet$/.test(s.title), `titre « ${s.title} »`);
      check(!has(s, /^Jour férié/), 'pas de ligne de jour férié sur les étapes (§ 4.7 : l’accueil seulement)');
      return { screen: s };
    });
  } finally {
    await d11.stop();
  }
  const d12 = await dataOf('2026-11-12');
  try {
    await sim.launch(pageUrl(PWAT(WAT_1211), '', { data: d12.url }));
    await step('home-1211', async () => {
      const s = await sim.waitScreen(is('home', (x) => homeReady(x) && homeFavorites(x).length >= 2), 25_000, 'accueil le 12/11');
      check(!has(s, /^Jour férié/), `pas de jour férié le 12/11 (CA-121.7) : ${JSON.stringify(s.lines)}`);
      check(hint(s) === 'Lignes de bus, tram, métro   à choisir', `dernière ligne « ${hint(s)} »`);
      homeCommon(s, false);
      return { screen: s, shot: false };
    });
  } finally {
    await d12.stop();
  }
}

/* ------------------------------ Mise à jour depuis la 1.2.2, la 1.2.1, la 1.2.0, la 1.1 et la 1.0, premier lancement ------------------------------ */

async function news(): Promise<void> {
  const from = async (label: string, P: typeof P10, ids: string[], withDeliver: boolean, seen: string) => {
    await sim.launch(pageUrl(P(S1)));
    await step(`message-${label}`, async () => {
      if (!V125) {
        const h = await sim.waitScreen(homeReady, 20_000, 'accueil');
        check(!sim.screens.some((x) => x.title === NEWS_TITLE), `« ${NEWS_TITLE} » avant la montée de version (app.json ${APP_VERSION})`);
        notes.push(`news-${label} : app.json en ${APP_VERSION}, message « ${NEWS_TITLE} » non vérifié`);
        return { screen: h, shot: false };
      }
      const s = await sim.waitScreen(is('message', (x) => x.title === NEWS_TITLE), 20_000, `message « ${NEWS_TITLE} »`);
      // PRD-1.2.6 § 7 : depuis la 1.2.5, la 1.2.6 seule ; d'avant, aussi les nouveautés de la 1.2.5 encore vraies
      check(sameList(s.lines.slice(0, -1), newsFor(seen)), `texte ${JSON.stringify(s.lines)} (PRD-1.2.6 § 7, depuis la ${label})`);
      common(s, H.news);
      return { screen: s, ...(withDeliver ? { deliver: 'g07' as const } : {}) };
    });
    await step(`home-${label}`, async () => {
      if (V125) await sim.input('click');
      const s = await sim.waitScreen(homeReady, 20_000, 'accueil');
      const order = field<string[]>(s, 'order') ?? [];
      check(sameList([...order].sort(), ids), `favoris migrés sans perte ni doublon : ${JSON.stringify(order)} (CA-2.1, CA-122.6)`);
      check(order[0] === 'fav-bureau' && s.lines[0] === 'Favoris   3', `ordre ${JSON.stringify(order)}, « ${s.lines[0]} »`);
      // les arrêts favoris rangés : la gare de Namur dans « Gares de train », Bruxelles-Nord dans « Arrêts… » ; tram 3 et
      // tram 4 (gardés à Gare du Nord) suivis dans « Lignes… » (PRD-1.2.6 § 4)
      check(sameList(s.lines.slice(-3), SECTIONS_CUR), `rubriques de l’accueil : ${JSON.stringify(s.lines)}`);
      homeCommon(s, false);
      return { screen: s };
    });
    await step(`lines-${label}`, async () => {
      await sim.select(homeIndex(sim.last!, STOPS_ROW));
      await sim.input('click');
      const l = await sim.waitScreen(is('lines', loaded), 20_000, '« Arrêts de bus, tram, métro »');
      check(l.lines[0] === 'Bruxelles-Nord' && SEG_ROW.test(l.lines[1] ?? ''), `l’arrêt favori rangé, ses départs : ${JSON.stringify(l.lines)} (CA-122.6)`);
      common(l, H.lines);
      // 1.2.6 : le tram 3 et le tram 4, suivis, un sens par rangée, le tram 3 d'abord
      await back(homeReady, 'accueil');
      await sim.select(homeIndex(sim.last!, LINES_ROW));
      await sim.input('click');
      const f = await sim.waitScreen(is('follows', (x) => loaded(x) && x.lines.filter((y) => SEG_ROW.test(y)).length >= 3), 20_000, '« Lignes de bus, tram, métro »');
      check(sameList(f.lines.slice(0, 3), ['Tram 3 vers Churchill', 'Tram 3 vers Esplanade', 'Tram 4 vers Stalle']), `les lignes gardées, suivies : ${JSON.stringify(f.lines)} (CA-126.4)`);
      common(f, H.follows);
      return { screen: f, shot: false };
    });
    await step(`favorites-${label}`, async () => {
      await back(is('home'), 'accueil');
      await sim.select(0);
      await sim.input('click');
      const p = await sim.waitScreen(is('favorites', (x) => loaded(x) && x.lines.length >= 4), 25_000, '« Favoris »');
      check(/^Bureau {3}dans [34] min → 08:58$/.test(p.lines[0] ?? '') && p.lines.includes('Maison   tu y es') && p.lines.includes('Autre adresse   sur le téléphone'), `lieux devenus favoris, « Autre adresse » (ex-« Aller à… ») : ${JSON.stringify(p.lines)}`);
      common(p, H.favorites);
      return { screen: p };
    });
    await step(`session-${label}`, async () => {
      const h = await back(is('home'), 'accueil');
      const homeId = sim.screens.find((y) => y.screen === 'home')?.id ?? 0;
      check(!sim.screens.some((x) => x.title === NEWS_TITLE && x.id > homeId), `« ${NEWS_TITLE} » ne revient pas pendant la session`);
      return { screen: h, shot: false };
    });
  };
  const ids = ['fav-bureau', 'fav-gand', 'fav-maison'];
  // 1.2.6 : depuis la 1.2.5 (la version publiée avant celle-ci), les quatre lignes de la 1.2.6 seules
  await from('1.2.5', P125, ids, true, '1.2.5');
  await from('1.2.4', P124, ids, false, '1.2.4');
  await from('1.2.3', P123, ids, false, '1.2.3');
  await from('1.2.2', P122, ids, false, '1.2.2');
  await from('1.2.1', P121, ids, false, '1.2.1');
  await from('1.2.0', P120, ids, false, '1.2.0');
  await from('1.1', P11, ids, false, '1.1.0');
  // réglages de la 1.0 : migrés avec la version vue 1.0.0 (settings.ts)
  await from('1.0', P10, ['fav-bureau', 'fav-gand', 'maison'], false, '1.0.0');
}

async function firstrun(): Promise<void> {
  const frames: { t: number; lit: number }[] = [];
  await sim.launch(pageUrl({ ...S2, reset: '1' }), {
    waitReady: false,
    onPing: async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 5_000) {
        try {
          frames.push({ t: Date.now() - t0, lit: litPixels(await sim.rawShot()).lit });
        } catch {
          frames.push({ t: Date.now() - t0, lit: -1 });
        }
        await sleep(100);
      }
    },
  });
  await step('welcome', async () => {
    const first = frames.findIndex((f) => f.lit > 0);
    check(first >= 0, 'aucune image pendant 5 s');
    check(!frames.slice(first).some((f) => f.lit <= 0), 'écran noir après le premier affichage');
    const s = await sim.waitScreen(is('message', (x) => x.lines[0] === WELCOME[0]), 20_000, 'bienvenue');
    check(sameList(s.lines.slice(0, 4), WELCOME), `texte ${JSON.stringify(s.lines)} (REVUE-USAGE n° 5 : « tes favoris »)`);
    check(!sim.screens.some((x) => x.title === NEWS_TITLE), `jamais « ${NEWS_TITLE} » après une nouvelle installation (CA-3.2)`);
    common(s, H.firstRun);
    return { screen: s, pixels: false, tour: ['glasses-first-run.png', 'Premier lancement : bienvenue, réglages sur le téléphone'] };
  });
  await step('home-empty', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('home', loaded), 15_000, 'accueil sans favori');
    check(s.lines[0] === 'Près de Bruxelles-Nord', `ligne du haut « ${s.lines[0]} » (seulement sans favoris montrés)`);
    check(sameList(s.lines.slice(1, 7), ['Ajouter un favori', '', 'Autour de moi   4 arrêts', 'Gares de train   à choisir', 'Arrêts de bus, tram, métro   à choisir', 'Lignes de bus, tram, métro   à choisir']), `menu ${JSON.stringify(s.lines)} (PRD-1.2.2 § 1.1 et § 1.3, PRD-1.2.6 § 1)`);
    // nouvelle installation : l'aide des gestes de l'accueil (7 premiers jours, § 4.6)
    homeCommon(s, true);
    return { screen: s, relief: 'home', tour: ['glasses-home-near.png', 'Accueil sans favori (nouvelle installation) : « Près de Bruxelles-Nord », « Ajouter un favori », les trois rubriques à choisir, aide des gestes les 7 premiers jours'] };
  });
  await step('empty-list', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('favorites'), 10_000, '« Favoris » vide');
    check(sameList(s.lines.slice(0, 2), ['Ajouter un favori   sur le téléphone', 'Autre adresse   sur le téléphone']), `lignes ${JSON.stringify(s.lines)} (PRD-1.2.2 § 1.2)`);
    common(s, H.favorites);
    await sim.input('click');
    const m = await sim.waitScreen(is('message', (x) => x.title === 'Favoris'), 10_000, 'comment ajouter un favori');
    check(sameList(m.lines.slice(0, 2), ['Aucun favori pour l’instant.', 'Ajoute Maison ou Bureau sur le téléphone.']), `texte ${JSON.stringify(m.lines)} (REVUE-USAGE n° 2)`);
    common(m, H.message);
    return { screen: s, pixels: false };
  });
  await step('sections-empty', async () => {
    const h = await backTo(is('home'), 'retour à l’accueil');
    await sim.select(homeIndex(h, STATIONS_ROW));
    await sim.input('click');
    const g = await sim.waitScreen(is('home', (x) => x.title === CHOOSE_STATIONS), 8_000, `« ${CHOOSE_STATIONS} » à la place du titre`);
    sameRows(g, h);
    await sim.select(homeIndex(h, STOPS_ROW));
    await sim.input('click');
    const a = await sim.waitScreen(is('home', (x) => x.title === CHOOSE_STOPS), 8_000, `« ${CHOOSE_STOPS} » à la place du titre`);
    sameRows(a, h);
    await sim.select(homeIndex(h, LINES_ROW));
    await sim.input('click');
    const s = await sim.waitScreen(is('home', (x) => x.title === CHOOSE_LINES), 8_000, `« ${CHOOSE_LINES} » à la place du titre`);
    sameRows(s, h);
    return { screen: s, pixels: false };
  });
  await step('exit', async () => {
    await sleep(2_800);
    await back(is('home'), 'retour à l’accueil');
    const mark = sim.out.join('').length;
    await sim.input('double_click', 2_500);
    check(/ShutDownPageContainer/.test(sim.out.join('').slice(mark)), 'double toucher sur l’accueil : shutDownPageContainer non appelé');
  });
}

/* ------------------------------ Pannes : horaires injoignables, relais muet, aucun arrêt, périmés ------------------------------ */

/** Mandataire des horaires : en panne (HTTP 503) ou transparent, au choix du test. */
async function switchable(target: string): Promise<{ url: string; up(on: boolean): void; close(): Promise<void> }> {
  let on = false;
  const server = http.createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    if (!on) {
      res.writeHead(503, cors);
      res.end('indisponible');
      return;
    }
    try {
      const r = await fetch(target + (req.url ?? '/'));
      res.writeHead(r.status, { ...cors, 'Content-Type': r.headers.get('content-type') ?? 'application/octet-stream' });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch {
      res.writeHead(502, cors);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    up: (v) => (on = v),
    close: () => new Promise<void>((r) => {
      server.closeAllConnections?.();
      server.close(() => r());
    }),
  };
}

async function errors(): Promise<void> {
  const proxy = await switchable(night.url);
  // au lancement à S2, Quai ouvre l'accueil, ou les départs de Gare du Nord (repère des lignes `near`, à moins de 300 m)
  const started = (x: Screen) => ['home', 'lines', 'board'].includes(x.screen);
  try {
    await sim.launch(pageUrl(PCUR(S2), '', { data: proxy.url }));
    await step('data-unreachable', async () => {
      const s = await sim.waitScreen(is('message', (x) => x.lines[0] === DATA_DOWN), 40_000, 'horaires injoignables');
      common(s, H.errorRoot);
      return { screen: s, pixels: false };
    });
    await step('retry-tap', async () => {
      proxy.up(true);
      await sim.input('click');
      const s = await sim.waitScreen(started, 30_000, 'Quai démarré après « réessayer »');
      return { screen: s, shot: false };
    });
    proxy.up(false);
    await sim.launch(pageUrl(PCUR(S2), '', { data: proxy.url }));
    await step('retry-auto', async () => {
      await sim.waitScreen(is('message', (x) => x.lines[0] === DATA_DOWN), 40_000, 'horaires injoignables');
      const t0 = Date.now();
      proxy.up(true);
      const s = await sim.waitScreen(started, 45_000, 'nouvel essai seul (30 s)');
      notes.push(`errors : démarrage seul ${((Date.now() - t0) / 1000).toFixed(1)} s après le retour du serveur d’horaires`);
      return { screen: s, shot: false };
    });
    proxy.up(false);
    await sim.launch(pageUrl(PCUR(S2), '', { data: proxy.url }));
    await step('error-exit', async () => {
      await sim.waitScreen(is('message', (x) => x.lines[0] === DATA_DOWN), 40_000, 'horaires injoignables');
      const mark = sim.out.join('').length;
      await sim.input('double_click', 2_500);
      check(/ShutDownPageContainer/.test(sim.out.join('').slice(mark)), 'double toucher sur l’erreur au lancement : shutDownPageContainer non appelé');
    });
  } finally {
    await proxy.close();
  }
  await sim.launch(pageUrl(PCUR(S2), '', { relay: 'http://127.0.0.1:9' }));
  await step('relay-down', async () => {
    // 1.2.6 : les départs de Gare du Nord ouverts seuls (repère du tram 3 et du tram 4) : tout en horaire prévu, la
    // panne dite en bas
    const s = await sim.waitScreen(is('board', (x) => loaded(x) && x.lines.includes(RT_DOWN)), 30_000, 'départs sans relais');
    const deps = s.lines.filter((l) => /^T[34] {3}/.test(l));
    check(deps.length >= 2 && deps.every((l) => /~\d+ min$/.test(l)), `départs en horaire prévu (« ~ ») : ${JSON.stringify(s.lines)}`);
    const h = await back(is('home', (x) => x.lines[0] === HOME_RT_DOWN), 'accueil, « Temps réel indisponible : horaires prévus » (pas « Pas de réseau », sans « ~ »)');
    return { screen: h, shot: false };
  });
  await sim.launch(pageUrl({ ...PCUR(S2), mockLat: '50.1', mockLon: '5.2' }));
  await step('nearby-empty', async () => {
    const h = await sim.waitScreen(is('home', loaded), 20_000, 'accueil');
    await sim.select(homeIndex(h, /^Autour de moi {3}/));
    await sim.input('click');
    const s = await sim.waitScreen(is('message', (x) => x.title === 'Autour de moi'), 15_000, 'aucun arrêt');
    // REVUE-USAGE n° 10 : rien à 3 km non plus : où régler le rayon
    check(sameList(s.lines.slice(0, 2), ['Aucun arrêt à moins de 500 m.', 'Rayon réglable sur le téléphone : Affichage.']), `texte ${JSON.stringify(s.lines)}`);
    common(s, H.message);
    return { screen: s, pixels: false, tour: ['glasses-nearby-empty.png', 'Autour de moi sans arrêt dans le rayon, ni à 3 km : où régler le rayon'] };
  });
  // à un peu plus d'un kilomètre au nord de la gare de Namur : l'arrêt le plus proche, et ses départs d'un toucher
  await sim.launch(pageUrl({ ...PCUR(S1), mockLat: '50.4795', mockLon: '4.8625' }));
  await step('nearby-nearest', async () => {
    const h = await sim.waitScreen(is('home', loaded), 20_000, 'accueil');
    await sim.select(homeIndex(h, /^Autour de moi {3}/));
    await sim.input('click');
    const s = await sim.waitScreen(is('message', (x) => x.title === 'Autour de moi' && x.lines.length >= 3), 15_000, 'aucun arrêt dans le rayon, le plus proche');
    check(s.lines[0] === 'Aucun arrêt à moins de 500 m.' && /^Le plus proche : .+, à 1,\d km\.$/.test(s.lines[1] ?? ''), `texte ${JSON.stringify(s.lines)} (REVUE-USAGE n° 10)`);
    common(s, H.nearest);
    await sim.input('click');
    const b = await sim.waitScreen(is('board', loaded), 15_000, 'ses départs');
    check(s.lines[1]?.includes(b.title.split(',')[0]) ?? false, `les départs de l’arrêt annoncé : « ${b.title} »`);
    return { screen: b, pixels: false };
  });
}

async function stale(): Promise<void> {
  const { dir } = await buildFixtureData({ date: '2026-11-01' });
  const old = await startDataServer(dir);
  try {
    await sim.launch(pageUrl(PCUR(S2), '', { data: old.url }));
    await step('home', async () => {
      const STALE = 'Horaires périmés : mise à jour arrêtée le 02/11';
      // les départs de Gare du Nord ouverts seuls (repère des lignes `near`) : aucun départ avec des horaires périmés,
      // la raison en bas
      const l = await sim.waitScreen(is('board', (x) => x.lines.includes(STALE)), 25_000, 'départs de l’arrêt, horaires périmés');
      check(!l.lines.some((x) => /\d+ min$/.test(x)), `aucun départ avec des horaires périmés : ${JSON.stringify(l.lines)}`);
      const s = await back(is('home', (x) => x.lines[0] === STALE && has(x, /^Autour de moi {3}/)), 'accueil, horaires périmés');
      homeCommon(s, false);
      await sleep(1_500);
      await sim.drain();
      const shown = sim.last!;
      const buf = await sim.rawShot();
      const bad = checkPixels(buf, shown);
      check(!bad.length, `contrôle au pixel :\n        ${bad.join('\n        ')}`);
      const at = homeIndex(shown, LINES_ROW);
      for (let i = 0; i < at + 2; i++) await sim.input('down', 400);
      await sim.drain();
      const end = sim.last!;
      check(end.screen === 'home' && LINES_ROW.test(hint(end) ?? '') && end.lines[0] === STALE && end.sel === at, `« Lignes de bus, tram, métro » atteint par ▼ (CA-M1.9) : sel ${end.sel} ${JSON.stringify(end.lines)}`);
      const file = join(SHOTS, `${scenario}-home-first.png`);
      writeFileSync(file, buf);
      tour('glasses-home-stale.png', file, 'Accueil quand la mise à jour de nuit est en panne');
      return { screen: shown, shot: false };
    });
  } finally {
    await old.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 23:30 : passages et départs du lendemain (S6) ; « demain » comme les tableaux ; train de 00:01 sans « demain ». 1.2.6 :
 * les départs de l'arrêt repère s'ouvrent seuls (« Départs de demain ») ; les passages du lendemain sur toute la ligne.
 */
async function late(): Promise<void> {
  await sim.launch(pageUrl(PCUR({ ...S2, mockNow: '2026-11-10T23:30:00+01:00' })));
  await step('board-tomorrow', async () => {
    // rien dans les 2 heures : le prochain départ, même demain (PRD-1.2.3 § 1), « Départs de demain » en ligne du haut
    const s = await sim.waitScreen(is('board', loaded), 20_000, 'départs de l’arrêt repère ouverts seuls');
    check(s.lines[0] === 'Départs de demain' && s.lines[1] === '★ garder une ligne', `ligne du haut « ${s.lines[0]} », puis la ligne ★ « ${s.lines[1]} »`);
    check(!s.lines.some((l) => /demain, /.test(l)), `pas de « demain, » sur chaque ligne : ${JSON.stringify(s.lines)}`);
    check(!s.lines.some((l) => /\(P\)/.test(l)), 'Stalle sans « (P) »');
    return { screen: s, pixels: false };
  });
  await step('line-run-tomorrow', async () => {
    const h = await back(homeReady, 'double toucher : l’accueil');
    await sim.select(homeIndex(h, LINES_ROW));
    await sim.input('click');
    await sim.waitScreen(is('follows', (x) => loaded(x) && x.lines.filter((l) => SEG_ROW.test(l)).length >= 3), 15_000, '« Lignes de bus, tram, métro »');
    await sim.input('click');
    const s = await sim.waitScreen(is('lineRun', (x) => loaded(x) && x.title === 'Tram 3 vers Churchill'), 15_000, 'tout le tram 3 vers Churchill');
    // passages du lendemain matin : « demain ~06:04 · … », jamais une heure seule qui laisserait croire à ce soir
    const morning = s.lines.filter((l) => /^[●○◆◇] [^:]/.test(l) && / {3}(demain )?~?0\d:\d\d/.test(l));
    check(morning.length >= 1 && morning.every((l) => / {3}demain ~?0\d:\d\d/.test(l)), `passages du lendemain dits « demain » : ${JSON.stringify(s.lines)}`);
    check(!s.lines.some((l) => /^[●◆] [^:]/.test(l)), `aucun tram n’arrive la nuit : ${JSON.stringify(s.lines)}`);
    common(s, H.lineRun);
    return { screen: s };
  });
  await step('home', async () => {
    const s = await backTo(is('home', (x) => loaded(x) && has(x, /^Autour de moi {3}/)), 'accueil');
    homeCommon(s, false);
    // un départ du lendemain sur l'accueil : « demain 06:20 → 06:46 » ou « T3 demain … » tient dans sa colonne
    return { screen: s, relief: 'home' };
  });
  await step('train-after-midnight', async () => {
    await sim.select(homeIndex(sim.last!, /^Autour de moi {3}/));
    await sim.input('click');
    await sim.waitScreen(is('nearby', loaded), 15_000, 'Autour de moi');
    await sim.select(1);
    await sim.input('click');
    const s = await sim.waitScreen(is('board', (x) => loaded(x) && /train/.test(x.title)), 15_000, 'trains');
    check(/^IC {3}Anvers-Central {3}~?00:01 {2}voie 9$/.test(s.lines[1] ?? ''), `train de 00:01 sans « demain » (CA-S6.4) : « ${s.lines[1]} »`);
    return { screen: s, pixels: false };
  });
}

/* ------------------------------ Téléphone (Chrome) ------------------------------ */

const NO_EMU = '#glasses-emulator{display:none !important}';

/** Chrome neuf (stockage vide) pour un scénario du téléphone. */
async function withChrome(fn: (page: Page) => Promise<void>, viewport?: { width: number; height: number; dpr: number; mobile: boolean }): Promise<void> {
  const chrome = await Chrome.launch();
  const page = await chrome.newPage(viewport);
  try {
    await fn(page);
  } finally {
    const errs = page.errors.filter((e) => !/favicon/i.test(e));
    if (errs.length) notes.push(`${scenario} : erreurs de la page : ${errs.join(' | ').slice(0, 400)}`);
    await chrome.close();
  }
}

/** Haut de la capture : un sélecteur CSS, ou le premier élément dont le texte est exactement `text`. */
type Scroll = string | { text: string };

/** Étape du téléphone : capture facultative (390 × 844, densité 2, sans l'émulateur des lunettes de la page). */
async function phoneStep(page: Page, name: string, fn: () => Promise<{ shot?: boolean; deliver?: keyof typeof DELIVERABLES; scroll?: Scroll; glasses?: GlassesScreen; keepFocus?: boolean } | void>): Promise<void> {
  const t0 = Date.now();
  const r: StepResult = { scenario, step: name, ok: true, ms: 0 };
  try {
    const out = (await fn()) ?? {};
    if (out.glasses) r.screen = out.glasses;
    if (out.shot !== false && (out.shot || out.deliver)) {
      await page.addStyle(NO_EMU);
      if (!out.keepFocus) await page.eval(`document.activeElement && document.activeElement.blur && document.activeElement.blur(), true`);
      const target =
        typeof out.scroll === 'string'
          ? `document.querySelector(${JSON.stringify(out.scroll)})`
          : out.scroll
            ? `[...document.querySelectorAll('h1,h2,h3,legend,label,span,p,button,strong')].find((e) => ${N('e.textContent')}.trim() === ${JSON.stringify(out.scroll.text)})`
            : 'null';
      await page.eval(`(() => { const el = ${target}; if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 12); else window.scrollTo(0, 0); return true; })()`);
      await sleep(250);
      const file = join(SHOTS, `${scenario}-${name}.png`);
      await page.screenshot(file);
      r.shot = file.slice(E2E.length + 1);
      if (out.deliver) deliver(out.deliver, file);
    }
    console.log(`  ✓ ${scenario}-${name}${r.screen ? `\n      lunettes : ${show(r.screen as GlassesScreen & Record<string, unknown>)}` : ''}`);
  } catch (e) {
    r.ok = false;
    r.error = (e as Error).message;
    console.log(`  ✗ ${scenario}-${name} : ${r.error}`);
    try {
      await page.addStyle(NO_EMU);
      await page.screenshot(join(SHOTS, `${scenario}-${name}-ECHEC.png`));
    } catch {
      /* page fermée */
    }
  }
  r.ms = Date.now() - t0;
  results.push(r);
}

/** Attend que le texte de la page (espaces insécables normalisées) vérifie `re` ; rend ce texte. */
async function waitText(page: Page, re: RegExp, label: string, timeout = 10_000, selector = 'main'): Promise<string> {
  const t0 = Date.now();
  let t = '';
  while (Date.now() - t0 < timeout) {
    t = await page.text(selector);
    if (re.test(t)) return t;
    await sleep(150);
  }
  throw new Check(`délai dépassé : ${label} (texte : ${t.slice(0, 500)})`);
}

/** Changement d'écran du téléphone par l'ancre seule (même page, rien n'est rechargé). */
async function hashGo(page: Page, hash: string): Promise<void> {
  await page.eval(`(location.hash = ${JSON.stringify(hash)}, true)`);
  await sleep(400);
}

/** Texte des propositions du champ (« libellé | type »). */
const suggestions = (page: Page, id: string) =>
  page.eval<string[]>(`[...document.querySelectorAll('#${id}-liste [role=option]')].map((b) => ${N("b.querySelector('.s1').textContent")} + ' | ' + ${N("b.querySelector('.s2').textContent")})`);

/** Touche la proposition « libellé » (et « type ») du champ `id`, dès qu'elle paraît. */
async function pick(page: Page, id: string, label: string, type?: string, timeout = 10_000): Promise<void> {
  const find = `[...document.querySelectorAll('#${id}-liste [role=option]')].find((b) => ${N("b.querySelector('.s1')?.textContent")} === ${JSON.stringify(label)}${type ? ` && ${N("b.querySelector('.s2')?.textContent")} === ${JSON.stringify(type)}` : ''})`;
  await page.waitFor(`!!${find}`, timeout, `proposition « ${label}${type ? ` | ${type}` : ''} » du champ ${id}`);
  await page.eval(`(() => { const b = ${find}; b.scrollIntoView({ block: 'center' }); b.click(); return true; })()`);
}

const noCoordinates = async (page: Page) => {
  const t = await page.text('main');
  check(!/\b\d{1,2}[.,]\d{4,}\b/.test(t), `coordonnées affichées : ${/\b\d{1,2}[.,]\d{4,}\b/.exec(t)?.[0]}`);
};

/** Lignes de « Mes favoris » : titre, sous-titre, accès d'un lieu, créneau. */
interface FavRow {
  t1: string;
  t2: string;
  t3: string;
  t4: string;
}
const favRows = (page: Page) =>
  page.eval<FavRow[]>(
    `[...document.querySelectorAll('.screen ul.list > li > button.row')].map((b) => ({ t1: ${N("b.querySelector('.t1')?.textContent")}, t2: ${N("b.querySelector('.t2:not(.t4)')?.textContent")}, t3: ${N("b.querySelector('.t3')?.textContent")}, t4: ${N("b.querySelector('.t4')?.textContent")} }))`,
  );
/** Attend « Mes favoris » avec `n` lignes, accès des lieux et noms des arrêts calculés (« Gare du Nord, tram »). */
async function waitRows(page: Page, n: number, label = `${n} favoris`): Promise<FavRow[]> {
  const t0 = Date.now();
  let rows: FavRow[] = [];
  while (Date.now() - t0 < 15_000) {
    rows = await favRows(page).catch(() => []);
    const settled = rows.every((r) => !/…$/.test(r.t3) && !(r.t3 === '' && /Près de|, \d{4} |Position prise|Adresse à vérifier/.test(r.t2) && r.t2 !== 'Adresse à vérifier'));
    if (rows.length === n && settled) {
      await sleep(400); // noms d'arrêts complétés (modes connus)
      return favRows(page);
    }
    await sleep(150);
  }
  throw new Check(`délai dépassé : ${label} (lignes : ${JSON.stringify(rows)})`);
}
const rowText = (r: FavRow) => [r.t1, r.t2, r.t3, r.t4].filter(Boolean).join(' | ');

/** Lignes de la bannière « Nouveau » de l'accueil du téléphone (vide si elle n'est pas là). */
const bannerLines = (page: Page) => page.eval<string[]>(`[...document.querySelectorAll('.news p')].map((p) => ${N('p.textContent')}.trim())`);

/** Onglets de « Nouveau favori » (PRD-1.2.1 § 7.1) : valeur, titre, sous-titre, choisi, taille. */
interface Tab {
  value: string;
  text: string;
  selected: boolean;
  w: number;
  h: number;
}
const kindTabs = (page: Page) =>
  page.eval<Tab[]>(
    `[...document.querySelectorAll('[role=tablist] [role=tab]')].map((t) => { const r = t.getBoundingClientRect(); return { value: t.dataset.value, text: ${N('t.innerText')}.replace(/\\s+/g, ' ').trim(), selected: t.getAttribute('aria-selected') === 'true', w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; })`,
  );
/** Panneau visible de « Nouveau favori » : « place » (champ unique) ou « trip » (Départ, Arrivée). */
const visiblePanel = (page: Page) =>
  page.eval<string>(`(() => { const vis = (sel) => { const e = document.querySelector(sel); return !!e && !!(e.offsetParent || e.getClientRects().length) && !e.closest('[hidden]'); }; return vis('#fav-de') && !vis('#nf-lieu') ? 'trip' : vis('#nf-lieu') && !vis('#fav-de') ? 'place' : 'les deux ou aucun'; })()`);

/** Cartes des trajets : texte de chaque carte, lignes séparées par « | », espaces insécables normalisées. */
const cardsText = async (page: Page) => (await page.eval<string[]>(`[...document.querySelectorAll('.result')].map((r) => r.innerText.replace(/\\n+/g, ' | '))`)).map(nbn);
/** Une carte (PRD-1.2.1 § 7.2) : titre et heures, ligne « moyens », phrase. */
function card(c: string | undefined, title: string, times: string | RegExp, means: string | RegExp, phrase?: string): void {
  const parts = (c ?? '').split(' | ');
  check(parts[0] === title && (typeof times === 'string' ? parts[1] === times : times.test(parts[1] ?? '')), `carte « ${title} ${times} » : ${c}`);
  const m = parts.find((p) => (typeof means === 'string' ? p === means : means.test(p)));
  check(m, `ligne des moyens ${means} absente de la carte : ${c}`);
  if (phrase !== undefined) check(parts.includes(phrase), `phrase « ${phrase} » absente de la carte : ${c}`);
}

/** Texte d'une section de l'accueil du téléphone (vide si elle n'est pas là) : gares, arrêts (`lines`), lignes (`follows`). */
const pickSectionText = (page: Page, kind: 'stations' | 'lines' | 'follows') => page.eval<string>(N(`document.querySelector('#h-${kind}')?.closest('section')?.innerText`));

async function phone(): Promise<void> {
  // Migration visible depuis la 1.1 (CA-2.1, CA-122.6) : Maison et Bureau deviennent des lieux, sans doublon ; les
  // arrêts favoris rangés dans « Gares » et « Bus, tram, métro » ; bannière une fois.
  await withChrome(async (page) => {
    await phoneStep(page, 'migration', async () => {
      await page.goto(pageUrl(P11(S1), '#/'));
      await page.waitFor(`!!document.querySelector('#h-follows')`, 15_000, 'accueil du téléphone');
      if (V125) {
        await page.waitFor(`!!document.querySelector('.news')`, 15_000, 'bannière « Nouveau » depuis la 1.1');
        const lines = await bannerLines(page);
        check(sameList(lines, bannerFor('1.1.0')), `bannière ${JSON.stringify(lines)} (PRD-1.2.6 § 7 : les versions sautées, sans « Bus, tram, métro »)`);
      } else notes.push(`phone-migration : app.json en ${APP_VERSION}, bannière non vérifiée`);
      const t = await page.text('main');
      check(!/Mes lieux/.test(t), '« Mes lieux » encore sur l’accueil (PRD-1.2 § 2.2)');
      check(/Mes favoris\s+3 favoris/.test(t), `ligne « Mes favoris », « 3 favoris » : ${/Mes favoris[^\n]*\n[^\n]*/.exec(t.split('Réglages').pop() ?? '')?.[0]}`);
      // PRD-1.2.2 § 4 et § 5 : la gare de Namur dans « Gares de train », Bruxelles-Nord dans « Arrêts de bus, tram,
      // métro » ; 1.2.6 (PRD-1.2.6 § 4) : tram 3 et tram 4 (gardés à Gare du Nord) suivis dans « Lignes de bus, tram,
      // métro », retrouvés avec leurs terminus
      await page.waitFor(`${N(`document.querySelector('#h-follows')?.closest('section')?.innerText`)}.includes('Churchill ↔ Esplanade')`, 15_000, 'lignes reprises, terminus retrouvés');
      const st = await pickSectionText(page, 'stations');
      const ar = await pickSectionText(page, 'lines');
      const li = await pickSectionText(page, 'follows');
      check(/^Gares de train\n/.test(st) && /Namur/.test(st), `« Gares de train » : ${st}`);
      check(/^Arrêts de bus, tram, métro\n/.test(ar) && /Bruxelles-Nord/.test(ar) && !/Tram 3/.test(ar), `« Arrêts de bus, tram, métro » : ${ar}`);
      const at = (x: string) => li.indexOf(x);
      check(/^Lignes de bus, tram, métro\n/.test(li) && at('Tram 3') >= 0 && at('Tram 3') < at('STIB · Churchill ↔ Esplanade') && at('STIB · Churchill ↔ Esplanade') < at('Tram 4') && /de Gare du Nord/.test(li), `« Lignes de bus, tram, métro » : ${li}`);
      if (V125) {
        const g = await page.waitScreen((x) => x.screen === 'message' && x.title === NEWS_TITLE, 20_000, `message « ${NEWS_TITLE} » dans les lunettes`);
        check(sameList(g.lines.slice(0, -1), newsFor('1.1.0')), `message des lunettes ${JSON.stringify(g.lines)}`);
        await page.clickText('OK', '.news');
        await page.waitFor(`!document.querySelector('.news')`, 5_000, 'bannière fermée par « OK »');
      }
      await hashGo(page, '#/favoris');
      await waitText(page, /Ajouter un favori/, 'écran « Mes favoris »');
      check((await page.text('main')).includes(FAVS_LEAD), 'chapeau de « Mes favoris »');
      const rows = await waitRows(page, 3, 'trois favoris migrés');
      const want: [RegExp, RegExp, RegExp][] = [
        [/^Bureau$/, /^Adresse à vérifier$/, /^en tête le matin$/],
        [/^Bruxelles-Central → Gand-Saint-Pierre$/, /^Trajet fixe$/, /^$/],
        [/^Maison$/, /^Adresse à vérifier$/, /^en tête le soir$/],
      ];
      want.forEach(([a, b, c], i) => check(rows[i] && a.test(rows[i].t1) && b.test(rows[i].t2) && c.test(rows[i].t4), `favori ${i + 1} : ${rows[i] ? rowText(rows[i]) : 'absent'}`));
      check(!rows.some((r) => /Ma position|Gare du Nord|Namur, train/.test(r.t1)), 'plus de trajet « Ma position → lieu » ni d’arrêt favori');
      return { glasses: page.lastScreen() };
    });
    await phoneStep(page, 'migration-legacy-link', async () => {
      // ancre de la 1.1 (#/lieux) : la même chose dans « Mes favoris »
      await hashGo(page, '#/lieux');
      await page.waitFor(`location.hash === '#/favoris'`, 5_000, '#/lieux mène à #/favoris (CA-2.4)');
      await hashGo(page, '#/lieux/nouveau');
      await page.waitFor(`location.hash === '#/favoris/nouveau' && document.querySelector('h1')?.textContent === 'Nouveau favori'`, 5_000, '#/lieux/nouveau mène à « Nouveau favori »');
    });
  });

  // Depuis la 1.2.5 : la 1.2.6 seule ; d'avant, les nouveautés des versions sautées, de la plus récente à la plus
  // ancienne (PRD-1.2.6 § 7).
  for (const [label, P] of [['1.2.5', P125], ['1.2.4', P124], ['1.2.3', P123], ['1.2.2', P122], ['1.2.1', P121], ['1.2.0', P120]] as const) {
    await withChrome(async (page) => {
      await phoneStep(page, `banner-${label}`, async () => {
        await page.goto(pageUrl(P(S1), '#/'));
        if (!V125) {
          await page.waitFor(`!!document.querySelector('#h-follows')`, 15_000, 'accueil du téléphone');
          check(!(await page.eval<boolean>(`!!document.querySelector('.news')`)), `bannière avant la montée de version (app.json ${APP_VERSION})`);
          notes.push(`phone-banner-${label} : app.json en ${APP_VERSION}, bannière non vérifiée`);
          return;
        }
        await page.waitFor(`!!document.querySelector('.news')`, 15_000, `bannière « Nouveau » depuis la ${label}`);
        const lines = await bannerLines(page);
        check(sameList(lines, bannerFor(label)), `bannière ${JSON.stringify(lines)}`);
        const g = await page.waitScreen((x) => x.screen === 'message' && x.title === NEWS_TITLE, 20_000, `message « ${NEWS_TITLE} »`);
        check(sameList(g.lines.slice(0, -1), newsFor(label)), `message des lunettes ${JSON.stringify(g.lines)}`);
        return { glasses: g };
      });
    });
  }

  await withChrome(async (page) => {
    await phoneStep(page, 'home', async () => {
      await page.goto(pageUrl(PCUR(S1), '#/'));
      await page.waitFor(`document.querySelector('.home-favs')?.innerText.includes('partir à 07:35')`, 20_000, 'réponses des favoris sur l’accueil');
      const t = await page.text('main');
      check(t.includes('Où vas-tu ?') && t.includes('Adresse, gare, arrêt ou favori') && t.includes('Mes favoris') && t.includes('Gérer mes favoris'), 'accueil : champ (REVUE-USAGE n° 5 : « ou favori ») et section « Mes favoris »');
      check(t.includes('Gares de train') && t.includes('Ajouter une gare') && t.includes('Arrêts de bus, tram, métro') && t.includes('Ajouter un arrêt') && t.includes('Lignes de bus, tram, métro') && t.includes('Ajouter une ligne'), 'les trois sections (PRD-1.2.6 § 1)');
      check(!(await page.eval<boolean>(`!!document.querySelector('.news')`)), 'pas de bannière pour qui a déjà vu la 1.2.3');
      const buttons = await page.eval<number>(`document.querySelectorAll('.home-favs button.btn-glasses').length`);
      check(buttons === 3, `un bouton « Lunettes » par favori, lieux compris (${buttons})`);
      const names = (await page.eval<string[]>(`[...document.querySelectorAll('.home-favs .fav-row')].map((r) => r.innerText.split('\\n')[0])`)).map(nbn);
      check(names.includes('Vers le bureau') && names.includes('Vers la maison'), `les lieux sur l’accueil : ${JSON.stringify(names)}`);
    });
    await phoneStep(page, 'favorite-to-glasses', async () => {
      // le bouton « Lunettes » est une demande : le trajet est suivi (PRD-1.2.2 § 6)
      const n = page.screens().length;
      await page.eval(`(() => { const row = [...document.querySelectorAll('.home-favs .fav-row')].find((r) => r.innerText.includes('Vers le bureau')); row.querySelector('button').click(); return true; })()`);
      const g = await page.waitScreen((x) => x.screen === 'steps' && x.followed === true, 20_000, 'étapes suivies dans les lunettes', n);
      const msg = nbn(await page.waitFor<string>(`[...document.querySelectorAll('.home-favs .msg')].map((m) => m.textContent).filter(Boolean).join('|')`, 10_000, 'message à côté du bouton'));
      check(msg === 'Affiché dans les lunettes : IC 07:42, voie 6.', `message « ${msg} »`);
      check(g.title === `Vers le bureau : 07:35 → 08:58${FOLLOWED}` && g.page === 1 && g.label === 'short', `lunettes « ${g.title} » page ${g.page} ${g.label}`);
      return { glasses: g };
    });
  });

  // « Mes favoris » avec des lieux à adresse vérifiée : la liste unique, « Trajets » (marche maximale), « Nouveau favori ».
  await withChrome(async (page) => {
    await phoneStep(page, 'favorites-list', async () => {
      await page.goto(pageUrl(PNICE(S1), '#/favoris'));
      const rows = await waitRows(page, 3);
      check(rows[0].t1 === 'Bureau' && rows[0].t2 === 'Rue du Progrès 20, 1210 Saint-Josse-ten-Noode' && /^Métro Rogier à \d+ min à pied/.test(rows[0].t3) && rows[0].t4 === 'en tête le matin', `lieu Bureau : ${rowText(rows[0])}`);
      check(rows[2].t1 === 'Maison' && rows[2].t2 === 'Rue de Fer 25, 5000 Namur' && /à \d+ min à pied/.test(rows[2].t3) && rows[2].t4 === 'en tête le soir', `lieu Maison : ${rowText(rows[2])}`);
      check(rows[1].t1 === 'Bruxelles-Central → Gand-Saint-Pierre' && rows[1].t2 === 'Trajet fixe', `trajet fixe : ${rowText(rows[1])}`);
      notes.push(`phone : accès des lieux : « ${rows[0].t3} » ; « ${rows[2].t3} »`);
      const t = await page.text('main');
      check(t.includes('Adresses récentes') && t.includes('Effacer les adresses récentes') && t.includes('Korenmarkt, 9000 Gent'), 'adresses récentes en bas de « Mes favoris »');
      check(!t.includes('Mes lieux') && !t.includes('Marche maximale'), 'plus de « Mes lieux » ; la marche maximale est dans « Trajets »');
      await noCoordinates(page);
      return { shot: true };
    });
    await phoneStep(page, 'trips', async () => {
      // REVUE-USAGE n° 9 : « Trajets », la marche maximale et la marge avant de partir
      await hashGo(page, '#/trajets');
      const t = await waitText(page, /Marche maximale/, 'écran « Trajets »');
      check(t.includes('Marche maximale') && t.includes(MAX_WALK_SUB), `« Marche maximale » et son sous-titre (PRD-1.2.1 § 7.3) : ${/Marche maximale[^\n]*\n[^\n]*/.exec(t)?.[0]}`);
      check(t.includes('Marge avant de partir'), '« Marge avant de partir » dans « Trajets »');
      const v = nbn(await page.eval<string>(`[...document.querySelectorAll('output')].map((o) => o.textContent).join('|')`));
      check(v.split('|')[0] === '10 min', `valeur « ${v} »`);
      return { deliver: 'p04', scroll: { text: 'Marche maximale' } };
    });
    await phoneStep(page, 'new-favorite', async () => {
      await hashGo(page, '#/favoris');
      await waitText(page, /Ajouter un favori/, 'écran « Mes favoris »');
      await page.clickText('Ajouter un favori');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Nouveau favori'`, 5_000, 'écran « Nouveau favori »');
      // PRD-1.2.1 § 7.1, CA-121.6 : deux choix de même taille et de même style, « Un endroit » choisi d'office
      const tabs = await kindTabs(page);
      check(tabs.length === 2 && tabs[0].value === 'place' && tabs[1].value === 'trip', `deux onglets place et trip : ${JSON.stringify(tabs)}`);
      check(tabs[0].text === 'Un endroit adresse, gare ou arrêt' && tabs[1].text === 'Un trajet de A à B départ et arrivée fixes', `titres et sous-titres : ${JSON.stringify(tabs.map((x) => x.text))}`);
      check(tabs[0].w === tabs[1].w && tabs[0].h === tabs[1].h, `même taille : ${JSON.stringify(tabs.map((x) => [x.w, x.h]))}`);
      check(tabs[0].selected && !tabs[1].selected && (await visiblePanel(page)) === 'place', `« Un endroit » choisi d’office : ${JSON.stringify(tabs.map((x) => x.selected))} ${await visiblePanel(page)}`);
      const styles = await page.eval<string[]>(`[...document.querySelectorAll('[role=tablist] [role=tab]')].map((t) => { const c = getComputedStyle(t); return [c.fontFamily, c.minHeight, c.borderRadius, c.padding].join(' ; '); })`);
      check(styles[0] === styles[1], `même style : ${JSON.stringify(styles)}`);
      const t = await page.text('main');
      check(!t.includes('Un trajet fixe, d’un endroit à un autre'), 'le lien du bas « Un trajet fixe, d’un endroit à un autre » a disparu (CA-121.6)');
      await page.eval(`document.querySelector('#nf-lieu').focus(), true`);
      const list = await page.waitFor<string[]>(`(() => { const l = [...document.querySelectorAll('#nf-lieu-liste [role=option]')]; return l.length >= 3 && l.map((b) => ${N("b.querySelector('.s1').textContent")} + ' | ' + ${N("b.querySelector('.s2').textContent")}); })()`, 8_000, 'propositions du champ vide');
      check(list[0] === 'Ma position actuelle | si tu es sur place', `en tête « ${list[0]} »`);
      check(list.slice(1).every((l) => / \| récent$/.test(l)), `puis les adresses récentes : ${JSON.stringify(list)}`);
      check(/Adresse, gare ou arrêt/.test(t), 'champ « Adresse, gare ou arrêt »');
      return { deliver: 'p01', keepFocus: true };
    });
    await phoneStep(page, 'new-favorite-trip', async () => {
      await page.click('[role=tab][data-value=trip]');
      await page.waitFor(`document.querySelector('[role=tab][data-value=trip]')?.getAttribute('aria-selected') === 'true'`, 5_000, '« Un trajet de A à B » choisi');
      check((await visiblePanel(page)) === 'trip', `formulaire du trajet fixe montré : ${await visiblePanel(page)}`);
      const t = await page.text('main');
      check(/Départ/.test(t) && /Arrivée/.test(t) && t.includes('En tête de l’accueil'), `Départ, Arrivée et créneau (REVUE-USAGE n° 11) : ${t.slice(0, 600)}`);
      check((await page.eval<string>(`document.querySelector('h1')?.textContent`)) === 'Nouveau favori', 'titre « Nouveau favori » gardé');
      return { deliver: 'p02' };
    });
    await phoneStep(page, 'here-place', async () => {
      // retour à « Un endroit » : rien n'est perdu ; « Ma position actuelle » donne un lieu « Position prise sur place »
      await page.click('[role=tab][data-value=place]');
      await page.waitFor(`document.querySelector('[role=tab][data-value=place]')?.getAttribute('aria-selected') === 'true'`, 5_000, '« Un endroit » de nouveau');
      await page.eval(`document.querySelector('#nf-lieu').focus(), true`);
      await pick(page, 'nf-lieu', 'Ma position actuelle');
      await page.waitFor(`!!document.querySelector('#pl-nom')`, 12_000, 'formulaire du lieu');
      await waitText(page, /Position prise sur place[\s\S]*à \d+ min à pied/, 'endroit et accès', 10_000);
      check(await page.eval<boolean>(`[...document.querySelectorAll('.place-form button')].find((b) => b.textContent === 'Enregistrer').disabled`), '« Enregistrer » grisé sans nom');
      check((await page.text('main')).includes('Donne un nom à cet endroit.'), 'aide « Donne un nom à cet endroit. »');
      await page.type('#pl-nom', 'Piscine');
      await page.clickText('Enregistrer', '.place-form');
      await page.waitFor(`location.hash === '#/favoris'`, 5_000, 'retour à « Mes favoris »');
      const rows = await waitRows(page, 4);
      check(rows[3].t1 === 'Piscine' && rows[3].t2 === 'Position prise sur place' && /à \d+ min à pied/.test(rows[3].t3) && !rows[3].t4, `nouveau lieu en fin de liste : ${rowText(rows[3])}`);
    });
    await phoneStep(page, 'edit-no-tabs', async () => {
      // modification d'un favori existant : pas de choix, son formulaire directement (§ 7.1)
      await page.eval(`(() => { const b = [...document.querySelectorAll('.screen ul.list > li > button.row')].find((r) => r.querySelector('.t1')?.textContent === 'Bruxelles-Central → Gand-Saint-Pierre'); b.click(); return true; })()`);
      await page.waitFor(`!!document.querySelector('#fav-de')`, 8_000, 'formulaire du trajet fixe');
      check((await kindTabs(page)).length === 0, 'pas d’onglets en modification');
    });
  });

  // Nouveau favori depuis une liste vide : adresse (CA-2.3), gare (un lieu « Près de … », et le lien vers « Gares »,
  // REVUE-USAGE n° 3), trajet fixe entre deux lieux (onglet « Un trajet de A à B »), suppression d'un lieu utilisé par
  // un trajet fixe (CA-2.5).
  await withChrome(async (page) => {
    await phoneStep(page, 'new-place', async () => {
      await page.goto(pageUrl(PEMPTY(S1), '#/favoris'));
      await waitText(page, /Aucun favori pour l’instant\.[\s\S]*Ajouter un favori/, 'liste vide et « Ajouter un favori »');
      await page.clickText('Ajouter un favori');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Nouveau favori'`, 5_000, 'écran « Nouveau favori »');
      await page.type('#nf-lieu', 'rue neuve 1 bruxelles');
      await pick(page, 'nf-lieu', 'Rue Neuve 1, 1000 Bruxelles', 'adresse');
      await page.waitFor(`document.querySelector('#pl-nom')?.value === 'Rue Neuve 1'`, 5_000, 'nom proposé « Rue Neuve 1 » (adresse courte)');
      await page.clickText('Bureau', '.shortcuts');
      await page.waitFor(`document.querySelector('#pl-nom').value === 'Bureau' && document.querySelector('.place-form input[type=radio][value=morning]').checked`, 3_000, '« Bureau » : « Le matin » coché sans autre toucher');
      await waitText(page, /Rue Neuve 1, 1000 Bruxelles[\s\S]*à \d+ min à pied/, 'adresse normalisée et accès', 10_000);
      await noCoordinates(page);
      await page.clickText('Enregistrer', '.place-form');
      await page.waitFor(`location.hash === '#/favoris'`, 5_000, 'retour à « Mes favoris »');
      const rows = await waitRows(page, 1);
      check(rows[0].t1 === 'Bureau' && rows[0].t2 === 'Rue Neuve 1, 1000 Bruxelles' && /à \d+ min à pied/.test(rows[0].t3) && rows[0].t4 === 'en tête le matin', `CA-2.3 (3 touchers, 1 saisie) : ${rowText(rows[0])}`);
    });
    await phoneStep(page, 'station-place', async () => {
      // REVUE-USAGE n° 3 : une gare dans « Un endroit » donne toujours un lieu (« Près de Namur »), et un lien l'ajoute à « Gares »
      await page.clickText('Ajouter un favori');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Nouveau favori'`, 5_000);
      await page.type('#nf-lieu', 'namur');
      await pick(page, 'nf-lieu', 'Namur', 'gare SNCB');
      await page.waitFor(`document.querySelector('#pl-nom')?.value === 'Namur'`, 8_000, 'lieu nommé « Namur »');
      const link = nbn(await page.waitFor<string>(`document.querySelector('.jump')?.textContent`, 5_000, 'lien vers « Gares »'));
      check(link === 'Ses prochains départs : ajouter Namur à Gares', `lien « ${link} »`);
      return { shot: true };
    });
    await phoneStep(page, 'station-to-gares', async () => {
      await page.click('.jump');
      const msg = nbn(await page.waitFor<string>(`document.querySelector('.jump-box .msg')?.textContent`, 5_000, 'message du lien'));
      check(msg === 'Namur ajoutée à Gares.', `message « ${msg} »`);
      await page.clickText('Enregistrer', '.place-form');
      await page.waitFor(`location.hash === '#/favoris'`, 5_000, 'retour à « Mes favoris »');
      const rows = await waitRows(page, 2);
      check(rows[1].t1 === 'Namur' && rows[1].t2 === 'Près de Namur' && /^Gare de Namur à \d+ min à pied/.test(rows[1].t3), `un lieu « Près de Namur » : ${rowText(rows[1])}`);
      await hashGo(page, '#/');
      await page.waitFor(`!!document.querySelector('#h-stations')`, 8_000, 'accueil du téléphone');
      const st = await pickSectionText(page, 'stations');
      check(/Namur/.test(st), `Namur dans « Gares » : ${st}`);
      await hashGo(page, '#/favoris');
    });
    await phoneStep(page, 'fixed-trip', async () => {
      // Maison : « rue de fer 25 namur », raccourci « Maison » (en tête le soir)
      await page.clickText('Ajouter un favori');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Nouveau favori'`, 5_000);
      await page.type('#nf-lieu', 'rue de fer 25 namur');
      await pick(page, 'nf-lieu', 'Rue de Fer 25, 5000 Namur', 'adresse');
      await page.clickText('Maison', '.shortcuts');
      await page.clickText('Enregistrer', '.place-form');
      await page.waitFor(`location.hash === '#/favoris'`, 5_000);
      // Trajet fixe Maison → Bureau : onglet « Un trajet de A à B » (1.2.1, à la place du lien du bas)
      await page.clickText('Ajouter un favori');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Nouveau favori'`, 5_000);
      await page.click('[role=tab][data-value=trip]');
      await page.waitFor(`document.querySelector('[role=tab][data-value=trip]')?.getAttribute('aria-selected') === 'true'`, 5_000, 'onglet « Un trajet de A à B »');
      await page.eval(`document.querySelector('#fav-de').focus(), true`);
      const dep = await page.waitFor<string[]>(`(() => { const l = [...document.querySelectorAll('#fav-de-liste [role=option]')]; return l.length && l.map((b) => ${N("b.querySelector('.s1').textContent")}); })()`, 5_000, 'propositions du départ');
      check(!dep.some((l) => /^Ma position/.test(l)) && dep.includes('Maison') && dep.includes('Bureau'), `départ : les lieux, jamais « Ma position » : ${JSON.stringify(dep)}`);
      await pick(page, 'fav-de', 'Maison', 'favori');
      await page.eval(`document.querySelector('#fav-vers').focus(), true`);
      await pick(page, 'fav-vers', 'Bureau', 'favori');
      await page.clickText('Enregistrer', '.trip-form');
      await page.waitFor(`location.hash === '#/favoris'`, 5_000, 'retour à « Mes favoris »');
      const rows = await waitRows(page, 4);
      check(rows[3].t1 === 'Maison → Bureau' && rows[3].t2 === 'Trajet fixe', `trajet fixe entre deux lieux : ${rowText(rows[3])}`);
    });
    await phoneStep(page, 'legacy-trip-links', async () => {
      // anciens liens du trajet fixe : « Nouveau favori », onglet « Un trajet de A à B »
      for (const hash of ['#/favoris/trajet', '#/favoris/nouveau?type=trajet']) {
        await hashGo(page, '#/favoris');
        await hashGo(page, hash);
        await page.waitFor(`document.querySelector('h1')?.textContent === 'Nouveau favori' && document.querySelector('[role=tab][data-value=trip]')?.getAttribute('aria-selected') === 'true'`, 5_000, `${hash} : « Nouveau favori », onglet trajet`);
        check((await visiblePanel(page)) === 'trip', `${hash} : formulaire du trajet montré`);
      }
      await hashGo(page, '#/favoris');
      await waitRows(page, 4);
    });
    await phoneStep(page, 'delete-place', async () => {
      await page.eval(`(() => { const b = [...document.querySelectorAll('.screen ul.list > li > button.row')].find((r) => r.querySelector('.t1')?.textContent === 'Maison'); b.click(); return true; })()`);
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Maison'`, 5_000, 'écran du lieu « Maison »');
      // Espacements du formulaire d'un lieu (comme les écrans de la 1.1) : « Supprimer ce favori » ne touche pas
      // « Enregistrer », le champ de l'endroit ne touche pas les raccourcis du nom.
      const gaps = await page.eval<{ saveDel: number; shortcutsField: number }>(`(() => {
        const f = document.querySelector('.place-form');
        const btn = (t) => [...f.querySelectorAll('button')].find((b) => b.textContent === t).getBoundingClientRect();
        const sc = f.querySelector('.shortcuts').getBoundingClientRect();
        const next = f.querySelector('#pl-lieu').closest('.field').getBoundingClientRect();
        return { saveDel: Math.round(btn('Supprimer ce favori').top - btn('Enregistrer').bottom), shortcutsField: Math.round(next.top - sc.bottom) };
      })()`);
      check(gaps.saveDel >= 12 && gaps.shortcutsField >= 12, `espacements du formulaire du lieu (px) : ${JSON.stringify(gaps)}`);
      check((await kindTabs(page)).length === 0, 'pas d’onglets en modification d’un lieu');
      await page.clickText('Supprimer ce favori');
      const q = nbn(await page.waitFor<string>(`document.querySelector('.confirm-q')?.textContent`, 5_000, 'question de suppression'));
      check(q === 'Supprimer « Maison » ? Les trajets fixes qui l’utilisent seront aussi supprimés.', `question « ${q} » (CA-2.5)`);
      await page.clickText('Supprimer', '.confirm-actions');
      await page.waitFor(`location.hash === '#/favoris'`, 5_000, 'retour à « Mes favoris »');
      const rows = await waitRows(page, 2);
      check(!rows.some((r) => /Maison/.test(r.t1)), `« Maison » et « Maison → Bureau » supprimés : ${JSON.stringify(rows.map((r) => r.t1))}`);
    });
  });

  // Cartes (scène noRT) : Rue Neuve 1, Waterloo, Uccle ; bouton « Lunettes » et « Autres trajets » dans les lunettes.
  await stack.scene('noRT');
  try {
    await withChrome(async (page) => {
      await phoneStep(page, 'results', async () => {
        await page.goto(pageUrl(PCUR(S1), '#/recherche'));
        await page.waitFor(`!!document.querySelector('#r-arrivee')`, 15_000);
        await page.type('#r-arrivee', 'rue neuve 1 bruxelles');
        await page.waitFor(`[...document.querySelectorAll('#r-arrivee-liste [role=option]')].some((b) => b.innerText.includes('Rue Neuve 1, 1000 Bruxelles'))`, 10_000, 'adresse proposée');
        const first = (await suggestions(page, 'r-arrivee'))[0];
        check(first === 'Rue Neuve 1, 1000 Bruxelles | adresse', `1re proposition « ${first} » (le texte ressemble à une adresse)`);
        await pick(page, 'r-arrivee', 'Rue Neuve 1, 1000 Bruxelles', 'adresse');
        await page.waitFor(`document.querySelectorAll('.result').length === 3`, 15_000, 'trois cartes');
        const cards = await cardsText(page);
        card(cards[0], 'Le plus court', '07:33 → 08:51', 'IC + tram 3, à pied 7 + 2 + 3 min', 'Arrive le plus tôt.');
        // 1.2.5 (PRD-1.2.5 § 3) : la marche finale (08:46 → 08:56, Bruxelles) sous la pluie du faux Open-Meteo
        card(cards[1], 'Sans changement', '07:33 → 08:56', 'IC, à pied 7 + 10 min, pluie prévue', 'Aucun changement, mais arrive 5 min plus tard.');
        // « Le suivant » : l'IC d'une heure plus tard, puis le tram 3 ou 4 selon le classement du cœur (PRD-1.2.2 § 7)
        card(cards[2], 'Le suivant', /^08:33 → \d\d:\d\d$/, /^IC \+ tram [34], à pied 7 \+ 2 \+ 3 min$/, 'Même trajet, départ suivant.');
        check(cards.every((c) => c.endsWith('Lunettes')), 'un bouton « Lunettes » par carte');
        check((await page.eval<number>(`document.querySelectorAll('.result .chip, .result .chips').length`)) === 0, 'plus de pastilles de lignes (remplacées par la ligne des moyens)');
        const roles = await page.eval<string>(`document.querySelector('.results').getAttribute('role') + '/' + document.querySelectorAll('.results [role=radio]').length + '/' + document.querySelector('.result button.btn-glasses').getAttribute('aria-label')`);
        check(roles === 'radiogroup/3/Afficher Le plus court dans les lunettes', `accessibilité ${roles} (CA-M4.13)`);
        check((await page.text('.results-box')).includes('3 trajets.'), 'nombre de trajets annoncé');
        check(!(await page.eval<boolean>(`!!document.querySelector('.res-head .holiday')`)), 'pas de ligne de jour férié le 10/11');
        const buttons = await page.eval<string[]>(`[...document.querySelectorAll('button')].map((b) => b.textContent)`);
        check(!buttons.some((b) => /Enregistrer (l’adresse )?comme lieu/.test(b ?? '')) && buttons.includes('Garder en favori'), '« Enregistrer comme lieu » retiré, « Garder en favori » présent (PRD-1.2 § 2.2)');
      });
      await phoneStep(page, 'glasses-button', async () => {
        const n = page.screens().length;
        await page.click('.result:nth-child(2) button.btn-glasses');
        // le bouton « Lunettes » est une demande : le trajet est suivi (PRD-1.2.2 § 6)
        const g = await page.waitScreen((s) => s.screen === 'steps' && s.page === 2 && s.followed === true, 20_000, 'trajet de la carte 2 suivi', n);
        check(g.label === 'none' && g.pages === 3 && g.title === `Vers Rue Neuve 1 : 07:33 → 08:56${FOLLOWED}`, `lunettes ${g.label} ${g.pages} « ${g.title} »`);
        // 1.2.5 (PRD-1.2.5 § 1) : départ à pied à 07:33, dans 2 min : « Si tu le rates » (l'IC suivant de Namur) en haut
        check(/^Si tu le rates : arrivée (demain )?\d\d:\d\d, (\d+ min|\d+ h( \d\d)?) plus tard$/.test(g.lines[0] ?? ''), `« Si tu le rates » en haut « ${g.lines[0]} » (CA-1.4, PRD-1.2.5 § 1)`);
        const msgs = (await page.eval<string[]>(`[...document.querySelectorAll('.result')].map((r) => r.querySelector('.msg')?.textContent ?? '')`)).map(nbn);
        check(msgs[1] === 'Affiché dans les lunettes : IC 07:42, voie 4.' && !msgs[0] && !msgs[2], `message seulement à côté du bouton touché : ${JSON.stringify(msgs)}`);
        return { glasses: g };
      });
      await phoneStep(page, 'glasses-others', async () => {
        // 1.2.1 : ▼ au bout des étapes de la carte 2 : « Autres trajets », les deux autres propositions
        const n = page.screens().length;
        for (let i = 0; i < 4 && page.lastScreen()?.screen !== 'others'; i++) await page.gesture('down');
        const l = await page.waitScreen((s) => s.screen === 'others', 8_000, '« Autres trajets »', n);
        check(l.title === 'Vers Rue Neuve 1 : autres trajets', `titre « ${l.title} »`);
        check(l.lines[0] === 'Le plus court   07:33 → 08:51' && /^Le suivant {3}08:33 → \d\d:\d\d$/.test(l.lines[2] ?? ''), `entrées ${JSON.stringify(l.lines)} (la proposition affichée n’y est pas)`);
        await page.gesture('down');
        await page.gesture('tap');
        const p3 = await page.waitScreen((s) => s.screen === 'steps' && s.page === 3, 8_000, 'page 3', n);
        check(p3.label === 'next' && p3.followed === false && new RegExp(`^Vers Rue Neuve 1 : 08:33 → \\d\\d:\\d\\d${FOLLOW}$`).test(p3.title), `page 3 ${p3.label} « ${p3.title} »`);
        await page.gesture('double');
        await page.gesture('double');
        const p2 = await page.waitScreen((s) => s.screen === 'steps' && s.page === 2 && /^Fin du trajet\./.test(bottom(s) ?? ''), 8_000, 'retour à la carte 2, à sa fin', n);
        check(p2.followed === true && p2.label === 'none', `trajet suivi gardé : ${p2.label} ${p2.followed}`);
        return { glasses: l };
      });
      await phoneStep(page, 'results-waterloo', async () => {
        await page.goto(pageUrl(PCUR(WAT), '#/recherche'));
        await page.waitFor(`!!document.querySelector('#r-arrivee')`, 15_000);
        await page.type('#r-arrivee', 'rue du progrès 20');
        await pick(page, 'r-arrivee', 'Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', 'adresse');
        await page.waitFor(`document.querySelectorAll('.result').length === 3`, 15_000, 'trois cartes');
        const cards = await cardsText(page);
        card(cards[0], 'Moins de marche', '07:32 → 08:46', 'bus W + métro 2, à pied 2 + 2 + 3 min', 'Arrive 16 min après le plus rapide, avec moins de marche.');
        card(cards[1], 'Plus tôt', '07:34 → 08:30', 'S1, à pied 19 + 5 min', 'Plus tôt de 16 min, mais 19 min à pied.');
        card(cards[2], 'Le suivant', '07:52 → 09:04', 'bus W + métro 2, à pied 2 + 2 + 3 min');
        // REVUE-USAGE n° 13 : la marche dite une fois, dans la ligne des moyens (plus après la durée)
        check(cards[0].split(' | ').includes('1 h 14, 1 changement') && cards[1].split(' | ').includes('56 min, direct'), `durées : ${cards[0]} / ${cards[1]}`);
        return { deliver: 'p03', scroll: '.res-head' };
      });
      await phoneStep(page, 'results-earlier', async () => {
        // « Plus tôt » qui marche plus (Waterloo à 08:30 vers Uccle) : 19 min à pied pour 8 min d'avance
        await page.goto(pageUrl(PCUR({ ...WAT, mockNow: '2026-11-10T08:30:00+01:00' }), '#/recherche'));
        await page.waitFor(`!!document.querySelector('#r-arrivee')`, 15_000);
        await page.type('#r-arrivee', 'avenue winston churchill 100');
        await pick(page, 'r-arrivee', 'Avenue Winston Churchill 100, 1180 Uccle', 'adresse');
        await page.waitFor(`document.querySelectorAll('.result').length === 3`, 15_000, 'trois cartes');
        const cards = await cardsText(page);
        card(cards[0], 'Moins de marche', '08:32 → 09:43', /^bus W \+ /, 'Arrive 8 min après le plus rapide, avec moins de marche.');
        card(cards[1], 'Plus tôt', '08:34 → 09:35', /, à pied 19 \+ /, 'Plus tôt de 8 min, mais 19 min à pied.');
        card(cards[2], 'Le suivant', '08:52 → 10:07', /^bus W \+ /);
        const n = page.screens().length;
        await page.click('.result:nth-child(2) button.btn-glasses');
        const g = await page.waitScreen((s) => s.screen === 'steps' && s.page === 2 && s.followed === true, 20_000, 'carte « Plus tôt » dans les lunettes', n);
        check(g.label === 'earlier' && g.lines[0] === 'Plus tôt de 8 min, mais 19 min à pied', `lunettes ${g.label} « ${g.lines[0]} » (§ 2.2)`);
        return { glasses: g };
      });
      await phoneStep(page, 'results-none', async () => {
        // Uccle vers la rue Neuve : le direct (plus de marche, arrive plus tard) n'est plus proposé (§ 1.4)
        await page.goto(pageUrl(PCUR({ mockLat: '50.808', mockLon: '4.365', mockNow: '2026-11-10T07:31:00+01:00' }), '#/recherche'));
        await page.waitFor(`!!document.querySelector('#r-arrivee')`, 15_000);
        await page.type('#r-arrivee', 'rue neuve 1 bruxelles');
        await pick(page, 'r-arrivee', 'Rue Neuve 1, 1000 Bruxelles', 'adresse');
        await page.waitFor(`document.querySelectorAll('.result').length === 3`, 15_000, 'trois cartes');
        const cards = await cardsText(page);
        card(cards[0], 'Le plus court', '07:33 → 08:06', /^tram 3/, 'Arrive le plus tôt.');
        card(cards[1], 'Le suivant', '07:41 → 08:14', /^tram 3/);
        card(cards[2], 'Plus tard', '07:49 → 08:22', /^tram 3/); // 1.2.2 : un seul « Le suivant » (PRD-1.2.2 § 7)
        check(!cards.some((c) => c.startsWith('Sans changement')), `plus de carte « Sans changement » : ${JSON.stringify(cards)}`);
      });
    });
  } finally {
    await stack.scene('base');
  }

  // Jour férié (§ 5, § 7.4, CA-121.7) : la ligne au-dessus des résultats le 11/11, rien le 12/11 (horaires publiés
  // la nuit même).
  const days = { '2026-11-11': await dataOf('2026-11-11'), '2026-11-12': await dataOf('2026-11-12') };
  await withChrome(async (page) => {
    const search = async (when: Record<string, string>) => {
      await page.goto(pageUrl(PCUR(when), '#/recherche', { data: days[when.mockNow.slice(0, 10) as keyof typeof days].url }));
      await page.waitFor(`!!document.querySelector('#r-arrivee')`, 15_000);
      await page.type('#r-arrivee', 'rue du progrès 20');
      await pick(page, 'r-arrivee', 'Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', 'adresse');
      await page.waitFor(`document.querySelectorAll('.result').length >= 1`, 15_000, 'cartes');
    };
    await phoneStep(page, 'holiday', async () => {
      await search(WAT_1111);
      const line = nbn(await page.waitFor<string>(`document.querySelector('.res-head .holiday')?.textContent`, 5_000, 'ligne du jour férié'));
      check(line === HOLIDAY, `« ${line} »`);
      // au-dessus des résultats, sous l'heure de la recherche
      const pos = await page.eval<{ holiday: number; first: number }>(`({ holiday: document.querySelector('.res-head .holiday').getBoundingClientRect().bottom, first: document.querySelector('.result').getBoundingClientRect().top })`);
      check(pos.holiday <= pos.first, `ligne au-dessus des résultats : ${JSON.stringify(pos)}`);
      return { deliver: 'p05', scroll: '.res-head' };
    });
    await phoneStep(page, 'holiday-none', async () => {
      await search(WAT_1211);
      await sleep(500);
      check(!(await page.eval<boolean>(`!!document.querySelector('.res-head .holiday')`)) && !(await page.text('main')).includes('Jour férié'), 'rien le 12/11 (CA-121.7)');
    });
  });
  for (const d of Object.values(days)) await d.stop();

  // Champ unique, messages, « Garder en favori » (CA-2.4)
  await withChrome(async (page) => {
    await phoneStep(page, 'field', async () => {
      await page.goto(pageUrl(PPHONE(S3), '#/recherche'));
      await page.waitFor(`!!document.querySelector('#r-arrivee')`, 15_000);
      await stack.geoJournalReset();
      await page.type('#r-arrivee', 'bruxelles');
      await page.waitFor(`[...document.querySelectorAll('#r-arrivee-liste .s2')].some((e) => e.textContent === 'adresse')`, 10_000, 'adresses proposées');
      const list = await suggestions(page, 'r-arrivee');
      const types = new Set(list.map((l) => l.split(' | ')[1]));
      // REVUE-USAGE n° 5 : un lieu est un favori (« favori » à droite, plus « mon lieu »)
      for (const t of ['favori', 'récent', 'gare SNCB', 'adresse']) check(types.has(t), `type « ${t} » absent : ${JSON.stringify(list)}`);
      check(list[0] === 'Piscine de Bruxelles | favori' && list[1] === 'Boulevard du Centenaire 1, 1020 Bruxelles | récent', `favoris et récents d’abord : ${JSON.stringify(list)}`);
      const stops = list.findIndex((l) => / \| gare SNCB$/.test(l));
      const addr = list.findIndex((l) => / \| adresse$/.test(l));
      check(stops < addr, 'gares avant adresses (le texte ne ressemble pas à une adresse)');
      const journal = await stack.geoJournal();
      const leaks = journal.filter((j) => Object.entries(j.params).some(([k, v]) => /lat|lon|^x$|^y$|pos|near|id/i.test(k) || /50\.8|4\.35/.test(v)));
      check(journal.length > 0 && !leaks.length, `requêtes d’adresses : seul le texte tapé (${journal.length} requêtes, ${leaks.length} avec position ou identifiant)`);
    });
    await phoneStep(page, 'field-messages', async () => {
      await stack.geoScene('down');
      try {
        await page.type('#r-arrivee', 'rue neuve 1 bruxelles');
        await page.waitFor(`${N("document.querySelector('#r-arrivee-etat')?.textContent")} === 'Adresses indisponibles pour l’instant : gares et arrêts seulement.'`, 10_000, 'service d’adresses en panne (CA-M4.6)');
        await page.type('#r-arrivee', 'gare du nord');
        await page.waitFor(`[...document.querySelectorAll('#r-arrivee-liste [role=option]')].length > 0 && ${N("document.querySelector('#r-arrivee-etat')?.textContent")} === 'Adresses indisponibles pour l’instant : gares et arrêts seulement.'`, 10_000, 'gares et arrêts toujours proposés');
      } finally {
        await stack.geoScene('base');
      }
      await page.type('#r-arrivee', 'namur');
      await page.waitFor(`document.querySelectorAll('#r-arrivee-liste [role=option]').length > 0`, 10_000);
      await page.offline(true);
      await page.type('#r-arrivee', 'rue de fer 25 namur');
      await page.waitFor(`${N("document.querySelector('#r-arrivee-etat')?.textContent")} === 'Recherche d’adresse impossible sans connexion : gares et arrêts seulement.'`, 10_000, 'téléphone hors ligne');
      await page.offline(false);
      await page.type('#r-arrivee', 'qxzqxzwvk');
      await page.waitFor(`${N("document.querySelector('#r-arrivee-etat')?.textContent")} === 'Aucune adresse, gare ou arrêt ne correspond. Ajoute la commune, ou vérifie l’orthographe.'`, 10_000, 'rien ne correspond (CA-M4.7)');
      await page.type('#r-arrivee', 'rue de fer 25');
      await page.waitFor(`[...document.querySelectorAll('#r-arrivee-liste .s1')].filter((e) => /^Rue de Fer 25, /.test(e.textContent)).length === 2`, 10_000, 'deux homonymes (F2-b)');
    });
  });
  await withChrome(async (page) => {
    const keep = async (label: string): Promise<string> => {
      await page.clickText('Garder en favori', '.below-results');
      return nbn(await page.waitFor<string>(`[...document.querySelectorAll('.below-results .msg')].map((m) => m.textContent).find((t) => t && t !== ${JSON.stringify(label)})`, 6_000, 'message de « Garder en favori »'));
    };
    await phoneStep(page, 'keep-place', async () => {
      await page.goto(pageUrl(PEMPTY(S3), '#/recherche'));
      await page.waitFor(`!!document.querySelector('#r-arrivee')`, 15_000);
      await page.type('#r-arrivee', 'veldstraat 1 gent');
      await pick(page, 'r-arrivee', 'Veldstraat 1, 9000 Gent', 'adresse');
      await page.waitFor(`document.querySelectorAll('.result').length >= 2`, 15_000, 'cartes vers Veldstraat (CA-M4.4)');
      const m1 = await keep('');
      check(m1 === 'Ajouté à tes favoris.', `« ${m1} »`);
      const m2 = await keep(m1);
      check(m2 === 'Déjà dans tes favoris.', `seconde fois : « ${m2} » (CA-2.4)`);
      await hashGo(page, '#/lieux');
      await page.waitFor(`location.hash === '#/favoris'`, 5_000, '#/lieux mène à #/favoris');
      const rows = await waitRows(page, 1);
      check(rows[0].t1 === 'Veldstraat 1' && rows[0].t2 === 'Veldstraat 1, 9000 Gent' && /à \d+ min à pied/.test(rows[0].t3), `« Ma position » → Veldstraat 1 donne un lieu : ${rowText(rows[0])}`);
    });
    await phoneStep(page, 'keep-trip', async () => {
      await hashGo(page, '#/recherche');
      await page.waitFor(`!!document.querySelector('#r-depart')`, 10_000);
      await page.type('#r-depart', 'bruxelles-central');
      await pick(page, 'r-depart', 'Bruxelles-Central', 'gare SNCB');
      await page.type('#r-arrivee', 'gand-saint-pierre');
      await pick(page, 'r-arrivee', 'Gand-Saint-Pierre', 'gare SNCB');
      await page.waitFor(`document.querySelectorAll('.result').length >= 2`, 15_000, 'cartes Bruxelles-Central vers Gand-Saint-Pierre');
      const m1 = await keep('');
      check(m1 === 'Ajouté à tes favoris.', `« ${m1} »`);
      const m2 = await keep(m1);
      check(m2 === 'Déjà dans tes favoris.', `seconde fois : « ${m2} »`);
      await hashGo(page, '#/favoris');
      const rows = await waitRows(page, 2);
      check(rows[1].t1 === 'Bruxelles-Central → Gand-Saint-Pierre' && rows[1].t2 === 'Trajet fixe', `trajet fixe : ${rowText(rows[1])}`);
    });
  });

  await withChrome(async (page) => {
    await phoneStep(page, 'reorder', async () => {
      await page.goto(pageUrl(PCUR(S3), '#/favoris'));
      await waitText(page, /Changer l’ordre/, 'bouton « Changer l’ordre »');
      await page.clickText('Changer l’ordre');
      await page.waitFor(`document.querySelectorAll('.order-row').length >= 2`, 5_000, 'mode « Changer l’ordre »');
      const before = await page.eval<string[]>(`[...document.querySelectorAll('.order-row .t1')].map((e) => e.textContent)`);
      check(sameList(before, ['Bureau', 'Bruxelles-Central → Gand-Saint-Pierre', 'Maison']), `lieux et trajet dans une seule liste, plus d’arrêt : ${JSON.stringify(before)}`);
      await page.click(`.order-row:nth-child(2) button:first-of-type`);
      await page.waitFor(`document.querySelector('.order-row:nth-child(1) .t1').textContent === 'Bruxelles-Central → Gand-Saint-Pierre'`, 5_000, 'trajet fixe monté');
      check(await page.eval<boolean>(`document.querySelector('.order-row:nth-child(1) button:first-of-type').disabled && document.querySelector('.order-row:nth-child(3) button:last-of-type').disabled`), '« Monter » grisé en tête, « Descendre » en fin de liste');
      // et redescendu : l'ordre du téléphone revient (Bureau en tête)
      await page.click(`.order-row:nth-child(1) button:last-of-type`);
      await page.waitFor(`document.querySelector('.order-row:nth-child(1) .t1').textContent === 'Bureau'`, 5_000, 'Bureau de nouveau en tête');
      await page.clickText('Terminé');
    });
    await phoneStep(page, 'my-order', async () => {
      // « Dans mon ordre » (CA-S3.2) : à S3, l'ordre intelligent met Gand-Saint-Pierre en tête ; l'ordre du téléphone, le bureau
      const n = page.screens().length;
      await hashGo(page, '#/affichage');
      await waitText(page, /Dans mon ordre/, 'écran « Affichage »');
      await page.clickText('Dans mon ordre');
      await page.waitFor(`!!document.querySelector('input[type=radio][value=mine]')?.checked`, 5_000, '« Dans mon ordre » choisi');
      const g = await page.waitScreen((s) => s.screen === 'home' && Array.isArray(s.order) && (s.order as string[])[0] === 'fav-bureau', 20_000, 'accueil des lunettes dans l’ordre choisi (CA-S3.2)', n);
      check(/^Bureau {3}/.test(homeFavorites(g)[0] ?? ''), `1er favori montré : ${JSON.stringify(homeFavorites(g))}`);
      return { glasses: g };
    });
  });

  await withChrome(async (page) => {
    await phoneStep(page, 'display-preview', async () => {
      // « Affichage » : l'aperçu de l'accueil des lunettes en 1.2.1 (« Favoris », 3 favoris en retrait, outils)
      await page.goto(pageUrl(PCUR(S2), '#/affichage'));
      await waitText(page, /Ordre des favoris/, 'écran « Affichage »', 15_000);
      // l'aperçu est dessiné (role=img) ; son texte est lu dans aria-label : « Aperçu dans les lunettes : Quai, Favoris 3, … »
      const label = nbn(await page.waitFor<string>(`document.querySelector('.preview[role=img]')?.getAttribute('aria-label')`, 8_000, 'aperçu de l’accueil'));
      // favoris d'exemple du téléphone (samples.ts), puis « Autour de moi » et les trois rubriques (PRD-1.2.6 § 1)
      check(/^Aperçu dans les lunettes : Quai, Favoris 3, Bureau \S.*, Autour de moi \d+ arrêts?, Gares de train 1 gare, Arrêts de bus, tram, métro 1 arrêt, Lignes de bus, tram, métro 1 ligne$/.test(label), `aperçu : « Favoris », les favoris, « Autour de moi », les trois rubriques : ${label}`);
      check(!label.includes('Autres favoris') && !label.includes('Aller à'), `plus de « Autres favoris » ni de « Aller à… » : ${label}`);
      // CA-123.1 : le réglage « Départs par arrêt » n'existe plus (les tableaux montrent les 2 prochaines heures)
      const t = await page.text('main');
      check(!/départs par arrêt/i.test(t), `« Départs par arrêt » encore dans « Affichage » (PRD-1.2.3 § 1) : ${t.slice(0, 300)}`);
      // 1.2.5 (PRD-1.2.5 § 3) : « Pluie pendant la marche », allumé
      check(/Pluie pendant la marche\s*sur les marches de 5 min ou plus, d’après Open-Meteo/.test(nbn(t)), `réglage « Pluie pendant la marche » (PRD-1.2.5 § 3) : ${t.slice(0, 600)}`);
      return { shot: true, scroll: { text: 'Aperçu dans les lunettes' } };
    });
  });

  await withChrome(async (page) => {
    await phoneStep(page, 'data', async () => {
      await page.goto(pageUrl(PCUR(S3), '#/donnees'));
      const t = await waitText(page, new RegExp(`Adresses\\s+Disponible\\s+Services officiels de Bruxelles, de Flandre et de Wallonie[\\s\\S]*Version de Quai\\s+${APP_VERSION.replace(/\./g, '\\.')}`), `carte « Adresses » et « Version de Quai ${APP_VERSION} » (PRD-1.2 § 4)`, 15_000);
      if (!V125) notes.push(`phone-data : app.json en ${APP_VERSION} (la 1.2.3 attend la montée de version, PRD-1.2.3 § 4)`);
      check(/Horaires officiels\s+cette nuit, 04:12/.test(t), `date des horaires : ${/Horaires officiels\s+[^\n]+\n?[^\n]*/.exec(t)?.[0]}`);
      // 1.2.5 (PRD-1.2.5 § 3) : la météo par le relais (faux Open-Meteo) : « Disponible », la position jamais envoyée
      const m = nbn(await waitText(page, /Météo\s+Disponible/, 'carte « Météo » disponible (relais, faux Open-Meteo)', 15_000));
      check(m.includes('Open-Meteo : la pluie prévue pendant tes marches. Quai reçoit la carte de toute la Belgique : ta position n’est jamais envoyée.'), `texte de la carte « Météo » : ${m.slice(0, 900)}`);
      check(m.includes('Météo : Open-Meteo.com, licence CC BY 4.0.'), 'attribution d’Open-Meteo au pied de « Données »');
    });
    await phoneStep(page, 'data-one-region-down', async () => {
      await stack.geoScene('down', ['wal']);
      try {
        await waitText(page, /Tester la connexion/, 'bouton « Tester la connexion »');
        await page.clickText('Tester la connexion');
        await waitText(page, /Disponible, sauf en Wallonie/, '« Disponible, sauf en Wallonie » (une Région en panne)', 15_000);
      } finally {
        await stack.geoScene('base');
      }
    });
    await phoneStep(page, 'onboarding', async () => {
      await page.goto(pageUrl({ ...S3, reset: '1' }, '#/'));
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Bienvenue'`, 10_000, 'bienvenue');
      check((await page.text('main')).includes('Quelques réglages, et Quai est prêt.'), 'sous-titre de bienvenue');
      await page.clickText('Continuer');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Tes favoris'`, 5_000, '« Tes favoris » (PRD-1.2 § 2.2)');
      await page.type('#s1-maison', 'rue de fer 25 namur');
      await pick(page, 's1-maison', 'Rue de Fer 25, 5000 Namur', 'adresse');
      await page.type('#s1-bureau', 'rue neuve 1 bruxelles');
      await pick(page, 's1-bureau', 'Rue Neuve 1, 1000 Bruxelles', 'adresse');
      const t = await page.text('main');
      check(t.includes('Facultatif. Maison et bureau deviennent tes premiers favoris.') && t.includes('Mettre le bureau en tête le matin, et la maison le soir'), 'textes de « Tes favoris » (REVUE-USAGE n° 11)');
      check(await page.eval<boolean>(`document.querySelector('.check-row input[type=checkbox]').checked`), 'case cochée');
      const buttons = await page.eval<string[]>(`[...document.querySelectorAll('main button')].map((b) => b.textContent)`);
      check(buttons.includes('Terminer') && buttons.includes('Plus tard'), `boutons ${JSON.stringify(buttons.slice(-3))}`);
      return { shot: true };
    });
    await phoneStep(page, 'onboarding-done', async () => {
      const n = page.screens().length;
      await page.clickText('Terminer');
      await page.waitFor(`document.querySelector('.home-favs')?.innerText.includes('Vers le bureau')`, 10_000, 'accueil avec « Mes favoris »');
      const g = await page.waitScreen((s) => s.screen === 'home' && s.lines[0] === 'Favoris   2' && /^Bureau {3}/.test(s.lines[1] ?? ''), 15_000, 'lunettes : « Favoris   2 », le bureau en tête (CA-S1.2)', n);
      await hashGo(page, '#/favoris');
      const rows = await waitRows(page, 2, 'deux lieux, sans autre favori');
      check(rows[0].t1 === 'Bureau' && rows[0].t2 === 'Rue Neuve 1, 1000 Bruxelles' && rows[0].t4 === 'en tête le matin', `Bureau : ${rowText(rows[0])}`);
      check(rows[1].t1 === 'Maison' && rows[1].t2 === 'Rue de Fer 25, 5000 Namur' && rows[1].t4 === 'en tête le soir', `Maison : ${rowText(rows[1])}`);
      return { glasses: g };
    });
  });

  await withChrome(async (page) => {
    await phoneStep(page, 'legacy-place', async () => {
      await page.goto(pageUrl(P10(S1), '#/favoris'));
      const rows = await waitRows(page, 3);
      check(rows.filter((r) => r.t2 === 'Adresse à vérifier').length === 2, `Bureau et Maison « Adresse à vérifier » (CA-M4.10) : ${JSON.stringify(rows.map(rowText))}`);
      await page.eval(`(() => { const b = [...document.querySelectorAll('.screen ul.list > li > button.row')].find((r) => r.querySelector('.t1')?.textContent === 'Maison'); b.click(); return true; })()`);
      await page.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent === 'Vérifier l’adresse')`, 5_000, 'bouton « Vérifier l’adresse »');
      check((await page.text('main')).includes('Texte enregistré avec la version précédente : « Namur ».'), 'ancien texte rappelé');
    });
    await phoneStep(page, 'legacy-verify', async () => {
      await page.clickText('Vérifier l’adresse');
      await page.waitFor(`document.querySelector('input[role=combobox]')?.value === 'Namur' && document.querySelectorAll('[role=listbox] [role=option]').length > 0`, 10_000, 'champ prérempli avec l’ancien texte');
    });
  });
}

/* ------------------------------ « ★ garder ce trajet » depuis ma position (Chrome, accéléré) ------------------------------ */

async function keep(): Promise<void> {
  await withChrome(async (page) => {
    await phoneStep(page, 'arrival-keep', async () => {
      await page.goto(pageUrl({ ...PCUR({ ...S3, mockNow: '2026-11-10T14:05:00+01:00' }), mockSpeed: '20', mockPath: PATH_S3 }, '#/recherche'));
      await page.waitFor(`!!document.querySelector('#r-arrivee')`, 15_000);
      await page.type('#r-arrivee', 'gand-saint-pierre');
      await pick(page, 'r-arrivee', 'Gand-Saint-Pierre', 'gare SNCB');
      await page.waitFor(`document.querySelectorAll('.result').length >= 1`, 15_000, 'cartes vers Gand-Saint-Pierre');
      const n = page.screens().length;
      await page.click('.result:nth-child(1) button.btn-glasses');
      // le bouton « Lunettes » est une demande : le trajet est suivi (PRD-1.2.2 § 6)
      await page.waitScreen((s) => s.screen === 'steps' && s.followed === true, 20_000, 'trajet suivi dans les lunettes', n);
      const a = await page.waitScreen((s) => s.screen === 'arrival', 150_000, 'aide à l’arrivée (accéléré)', n);
      check(a.title === 'Arrivée à Gand-Saint-Pierre' && hint(a) === H.arrival, `« ${a.title} », aide « ${hint(a)} »`);
      const m = page.screens().length;
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'arrival' && hint(s) === '★ Trajet ajouté aux favoris', 6_000, '« ★ Trajet ajouté aux favoris »', m);
      await sleep(2_900);
      const k = page.screens().length;
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'arrival' && hint(s) === '★ Déjà dans les favoris', 6_000, 'seconde fois : « ★ Déjà dans les favoris »', k);
      // Parti de « Ma position » : un lieu (PRD-1.2 § 2.3), pas un trajet fixe
      await hashGo(page, '#/favoris');
      const rows = await waitRows(page, 4);
      check(rows[3].t1 === 'Gand-Saint-Pierre' && rows[3].t2 === 'Près de Gand-Saint-Pierre', `nouveau lieu en fin de liste : ${rowText(rows[3])}`);
      check(rows.filter((r) => /Gand-Saint-Pierre/.test(r.t1)).length === 2, 'un seul lieu ajouté (le trajet fixe Bruxelles-Central → Gand-Saint-Pierre reste)');
      return { glasses: page.lastScreen() };
    });
  });
}

/* ------------------------------ Quai Web : onglet Lunettes (accueil) et rubrique « Position » ------------------------------ */

/**
 * Luminosité du canvas de Quai Web, ligne par ligne (vert le plus fort de la bande et abscisse du premier pixel
 * allumé, en pixels des lunettes) : niveau 4 → 255, 3 → 230, 2 → 196 (opacité 0,77 du vert).
 */
const canvasRows = (page: Page, top: number) =>
  page.eval<{ g: number; x0: number }[]>(`(() => {
    const c = document.querySelector('.w-canvas');
    const W = c.width, H = c.height, sx = W / 576, sy = H / 288;
    const d = c.getContext('2d').getImageData(0, 0, W, H).data;
    const out = [];
    for (let i = 0; i < 9; i++) {
      const y0 = ${top} + i * 27;
      let g = 0, x0 = 999;
      for (let y = Math.round((y0 + 4) * sy); y < Math.round((y0 + 24) * sy); y++)
        for (let x = Math.round(27 * sx); x < W; x++) { const v = d[(y * W + x) * 4 + 1]; if (v > g) g = v; if (v > 120 && x / sx < x0) x0 = x / sx; }
      out.push({ g, x0: Math.round(x0) });
    }
    return out;
  })()`);

async function webPosition(): Promise<void> {
  await withChrome(async (page) => {
    await phoneStep(page, 'glasses-home', async () => {
      // position choisie dans la rubrique « Position » (comme le ferait le propriétaire), gardée au rechargement : la
      // page s'ouvre avec elle, sans la mention « Position simulée (mode test) »
      await page.permission('geolocation', 'denied');
      const url = pageUrl({ mockNow: WAT.mockNow, ...PWAT({}) }, '', { app: webApp.url });
      await page.goto(url);
      await page.waitFor(`/^Position refusée par le navigateur\\./.test(${N("document.querySelector('.w-pos-box .w-pos-status')?.textContent")})`, 15_000, '« Position refusée par le navigateur. »');
      await page.type('#w-pos-q', 'chaussée de bruxelles 1 waterloo');
      await pick(page, 'w-pos-q', 'Chaussée de Bruxelles 1, 1410 Waterloo', 'adresse');
      const chosen = 'Position choisie : Chaussée de Bruxelles 1. Gardée dans ce navigateur.';
      await page.waitFor(`${N("document.querySelector('.w-pos-box .w-pos-status')?.textContent")} === ${JSON.stringify(chosen)}`, 8_000, `« ${chosen} »`);
      const n = page.screens().length;
      await page.reload();
      await page.waitFor(`${N("document.querySelector('.w-pos-box .w-pos-status')?.textContent")} === ${JSON.stringify(chosen)}`, 15_000, 'position gardée au rechargement');
      const h = await page.waitScreen((s) => s.screen === 'home' && loaded(s) && homeFavorites(s).length === 2, 25_000, 'accueil des lunettes dans Quai Web', n);
      check(h.lines[0] === 'Favoris   3' && /^Bureau {3}(maintenant|dans 1 min) → 08:46$/.test(homeFavorites(h)[0] ?? ''), `accueil ${JSON.stringify(h.lines)}`);
      check(hint(h) === 'Lignes de bus, tram, métro   à choisir' && !h.lines.some((l) => /ferme simplement|~/.test(l)), `aucun pied sur Quai Web (§ 4.5) : ${JSON.stringify(h.lines)}`);
      const tab = await page.eval<string>(`document.querySelector('#w-tab-lunettes')?.getAttribute('aria-selected')`);
      check(tab === 'true', `onglet Lunettes ouvert (${tab})`);
      // relief (§ 4.4 : « À vérifier dans le simulateur et sur Quai Web ») mesuré sur le canvas
      await sleep(400);
      const rows = await canvasRows(page, 33);
      const bad: string[] = [];
      const favs = new Set(homeFavorites(h));
      h.lines.forEach((l, i) => {
        if (i >= rows.length || !l) return;
        const r = rows[i];
        if (favs.has(l)) {
          if (Math.abs(r.g - 196) > 3) bad.push(`favori « ${l} » : vert ${r.g} au lieu de 196 (niveau 2)`);
          if (r.x0 < 28 + HOME_INDENT - 2) bad.push(`favori « ${l} » : x = ${r.x0}, sans retrait`);
        } else if (/^(Favoris|Autour de moi|Gares|Arrêts de bus|Lignes de bus)/.test(l)) {
          if (r.g < 250) bad.push(`« ${l} » : vert ${r.g} au lieu de 255 (niveau 4)`);
          if (r.x0 > 31) bad.push(`« ${l} » : x = ${r.x0} au lieu de 28`);
        }
      });
      check(!bad.length, `relief sur Quai Web :\n        ${bad.join('\n        ')}`);
      notes.push(`web : relief du canvas ${h.lines.map((l, i) => (l && i < rows.length ? `« ${l.split('   ')[0]} » ${rows[i].g} x${rows[i].x0}` : '')).filter(Boolean).join(', ')}`);
      return { deliver: 'w01', glasses: h };
    });
  });
  const url = pageUrl({ mockNow: S1.mockNow, ...preset('p/empty.json')({}) }, '', { app: webApp.url });
  const status = (page: Page) => page.eval<string>(N("document.querySelector('.w-pos-box .w-pos-status')?.textContent"));
  await withChrome(async (page) => {
    await phoneStep(page, 'position-denied', async () => {
      await page.permission('geolocation', 'denied');
      await page.goto(url);
      await page.waitFor(`/^Position refusée par le navigateur\\./.test(${N("document.querySelector('.w-pos-box .w-pos-status')?.textContent")})`, 15_000, '« Position refusée par le navigateur. »');
      const t = await page.text('.w-pos-box');
      check(t.includes('Choisir une adresse, une gare ou un arrêt') && t.includes('Adresses : services officiels des Régions bruxelloise, flamande et wallonne. Seul le texte tapé leur est envoyé.'), `champ et mention : ${t}`);
      check((await page.eval<string>(`document.querySelector('#w-pos-q')?.placeholder`)) === 'Adresse, gare ou arrêt', 'texte d’exemple « Adresse, gare ou arrêt »');
      return { glasses: page.lastScreen() };
    });
    await phoneStep(page, 'position-address', async () => {
      await stack.geoJournalReset();
      const n0 = page.screens().length;
      await page.type('#w-pos-q', 'rue du progrès 20');
      await pick(page, 'w-pos-q', 'Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', 'adresse');
      await page.waitFor(`${N("document.querySelector('.w-pos-box .w-pos-status')?.textContent")} === 'Position choisie : Rue du Progrès 20. Gardée dans ce navigateur.'`, 8_000, '« Position choisie : Rue du Progrès 20. Gardée dans ce navigateur. »');
      const t = await page.text('.w-pos-box');
      check(t.includes('Choisir un autre endroit') && t.includes('Revenir à la position du navigateur'), `liens : ${t}`);
      const journal = await stack.geoJournal();
      const leaks = journal.filter((j) => Object.entries(j.params).some(([k, v]) => /lat|lon|^x$|^y$|pos|near|id/i.test(k) || /50\.\d{3}|4\.\d{3}/.test(v)));
      check(journal.length > 0 && !leaks.length, `requêtes d’adresses : seul le texte tapé (${journal.length} requêtes, ${leaks.length} avec position)`);
      // « Autour de moi » est centré là (CA-3.1) : accueil sans favori, « Près de Bruxelles-Nord » (tram Gare du Nord à
      // 200 m de la rue du Progrès 20), arrêts comptés autour de l'adresse
      const h = await page.waitScreen((s) => s.screen === 'home' && loaded(s) && /^Près de /.test(s.lines[0] ?? '') && /^Autour de moi {3}\d+ arrêts?$/.test(s.lines[3] ?? ''), 20_000, 'accueil des lunettes centré sur l’adresse', n0);
      check(h.lines[0] === 'Près de Bruxelles-Nord' && h.lines[1] === 'Ajouter un favori' && h.lines[2] === '', `accueil sans favori : ${JSON.stringify(h.lines)}`);
      const n = page.screens().length;
      await page.gesture('down', '.w-gestures');
      await page.gesture('tap', '.w-gestures');
      const near = await page.waitScreen((s) => s.screen === 'nearby' && loaded(s), 15_000, 'Autour de moi', n);
      const dist = (re: RegExp) => Number(/ {3}(\d+) m /.exec(near.lines.find((l) => re.test(l)) ?? '')?.[1] ?? NaN);
      check(dist(/^Gare du Nord, tram /) <= 250 && dist(/^Rogier, métro /) <= 450, `Autour de moi centré sur l’adresse : ${JSON.stringify(near.lines)}`);
      return { glasses: near, shot: true };
    });
    await phoneStep(page, 'position-kept', async () => {
      await page.reload();
      await page.waitFor(`${N("document.querySelector('.w-pos-box .w-pos-status')?.textContent")} === 'Position choisie : Rue du Progrès 20. Gardée dans ce navigateur.'`, 15_000, 'position gardée au rechargement');
      const s = await status(page);
      check(s === 'Position choisie : Rue du Progrès 20. Gardée dans ce navigateur.', `« ${s} »`);
    });
    await phoneStep(page, 'position-geo-down', async () => {
      await stack.geoScene('down');
      try {
        await page.clickText('Choisir un autre endroit', '.w-pos-box');
        await page.type('#w-pos-q', 'rue de fer 25 namur');
        await page.waitFor(`${N("document.querySelector('#w-pos-q-etat')?.textContent")} === 'Adresses indisponibles pour l’instant : gares et arrêts seulement.'`, 10_000, 'service d’adresses en panne : gares et arrêts seulement');
        await page.type('#w-pos-q', 'namur');
        await pick(page, 'w-pos-q', 'Namur', 'gare SNCB');
        await page.waitFor(`${N("document.querySelector('.w-pos-box .w-pos-status')?.textContent")} === 'Position choisie : Namur (gare SNCB). Gardée dans ce navigateur.'`, 8_000, 'gare choisie en panne des adresses');
      } finally {
        await stack.geoScene('base');
      }
    });
  });
}

/* ------------------------------ Réouverture de Quai (Chrome : stockage gardé) ------------------------------ */

async function reopen(): Promise<void> {
  for (const [name, P, seen] of [
    ['news-once-1.2.5', P125, '1.2.5'],
    ['news-once-1.2.4', P124, '1.2.4'],
    ['news-once-1.2.3', P123, '1.2.3'],
    ['news-once-1.2.2', P122, '1.2.2'],
    ['news-once-1.2.1', P121, '1.2.1'],
    ['news-once-1.2.0', P120, '1.2.0'],
    ['news-once-1.1', P11, '1.1.0'],
    ['news-once-1.0', P10, '1.0.0'],
  ] as const) {
    await withChrome(async (page) => {
      await phoneStep(page, name, async () => {
        await page.goto(pageUrl(P(S1), '#/'));
        if (V125) {
          const g = await page.waitScreen((s) => s.screen === 'message' && s.title === NEWS_TITLE, 20_000, `message « ${NEWS_TITLE} »`);
          check(sameList(g.lines.slice(0, -1), newsFor(seen)), `message des lunettes ${JSON.stringify(g.lines)}`);
          await page.waitFor(`!!document.querySelector('.news')`, 15_000, 'bannière du téléphone');
          const lines = await bannerLines(page);
          check(sameList(lines, bannerFor(seen)), `bannière ${JSON.stringify(lines)}`);
          check(!(await page.text('main')).includes('Bienvenue'), 'pas d’écran « Bienvenue » après la mise à jour');
          await page.gesture('tap');
        } else notes.push(`reopen-${name} : app.json en ${APP_VERSION}, message et bannière non vérifiés`);
        await page.waitScreen((s) => s.screen === 'home', 15_000, 'accueil après « continuer »');
        // Réouverture : même page sans remise à zéro (le stockage local garde les réglages).
        const n = page.screens().length;
        await page.goto(pageUrl({ ...S1 }, '#/'));
        const h = await page.waitScreen((s) => s.screen === 'home', 20_000, 'accueil à la réouverture', n);
        check(!page.screens().slice(n).some((s) => s.title === NEWS_TITLE), `« ${NEWS_TITLE} » revenu à la réouverture (CA-3.2)`);
        check(!(await page.eval<boolean>(`!!document.querySelector('.news')`)), 'bannière revenue à la réouverture (CA-3.2)');
        check((h.order as string[] | undefined)?.length === 3, `favoris gardés à la réouverture : ${JSON.stringify(h.order)}`);
        check(!h.lines.some((l) => /^△▽ /.test(l)), `mise à jour : Quai déjà utilisé, pas d’aide des gestes sur l’accueil (§ 4.6) : ${JSON.stringify(h.lines)}`);
        return { glasses: h };
      });
    });
  }
  await withChrome(async (page) => {
    await phoneStep(page, 'fresh-install', async () => {
      await page.goto(pageUrl({ ...S1, reset: '1' }, '#/'));
      await page.waitScreen((s) => s.screen === 'message' && s.lines[0] === WELCOME[0], 20_000, 'bienvenue');
      await page.clickText('Continuer');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Tes favoris'`, 5_000);
      await page.clickText('Plus tard');
      await page.waitScreen((s) => s.screen === 'home' && s.lines.includes('Ajouter un favori'), 15_000, 'accueil sans favori (CA-S1.3)');
      check(!(await page.eval<boolean>(`!!document.querySelector('.news')`)), 'jamais la bannière après une nouvelle installation');
      const n = page.console.length;
      await page.goto(pageUrl({ ...S1 }, '#/'));
      await page.waitScreen((s) => s.screen === 'home', 20_000, 'accueil à la réouverture');
      const later = page.console.slice(n).filter((l) => l.text.startsWith('QUAI_SCREEN ')).map((l) => JSON.parse(l.text.slice(12)) as GlassesScreen);
      check(!page.screens().some((s) => s.title === NEWS_TITLE), `jamais « ${NEWS_TITLE} » après une nouvelle installation (CA-3.2)`);
      check(!later.some((s) => s.lines[0] === WELCOME[0]), 'bienvenue pas reprise');
      check(!(await page.eval<boolean>(`!!document.querySelector('.news')`)), 'jamais la bannière à la réouverture');
      return { glasses: page.lastScreen() };
    });
    await phoneStep(page, 'home-help-7-days', async () => {
      // § 4.6 : date du premier lancement gardée hors des réglages (quai.firstUse) ; aide de l'accueil 7 jours
      const first = Number(await page.eval<string>(`localStorage.getItem('quai.firstUse')`));
      // l'heure du premier lancement : mockNow, plus les secondes écoulées avant la lecture (horloge qui avance)
      check(first >= Date.parse(S1.mockNow) && first < Date.parse(S1.mockNow) + 60_000, `quai.firstUse = ${first} (premier lancement, ${S1.mockNow})`);
      check(!(await page.eval<string>(`localStorage.getItem('quai.settings') ?? ''`)).includes(String(first)), 'date du premier lancement hors des réglages');
      const at = async (days: number): Promise<GlassesScreen> => {
        const n = page.screens().length;
        await page.goto(pageUrl({ ...S1, mockNow: new Date(Date.parse(S1.mockNow) + days * 86_400_000).toISOString() }, '#/'));
        return page.waitScreen((s) => s.screen === 'home' && s.lines.some((l) => LINES_ROW.test(l)), 20_000, `accueil ${days} jours après le premier lancement`, n);
      };
      const d6 = await at(6.9);
      check(hint(d6) === H.home, `6,9 jours après : aide « ${hint(d6)} »`);
      const d7 = await at(7.1);
      check(!d7.lines.some((l) => /^△▽ /.test(l)), `7,1 jours après : plus d’aide sur l’accueil : ${JSON.stringify(d7.lines)}`);
      // les autres écrans gardent leur aide
      const n = page.screens().length;
      // ▼ jusqu'à « Autour de moi » (un glissement juste après un affichage est ignoré, comme sur les G2)
      for (let i = 0; i < 5 && page.lastScreen()?.sel !== 1; i++) await page.gesture('down');
      check(page.lastScreen()?.screen === 'home' && page.lastScreen()?.sel === 1, `« Autour de moi » sélectionné : ${JSON.stringify(page.lastScreen())}`);
      await page.gesture('tap');
      const near = await page.waitScreen((s) => s.screen === 'nearby' || (s.screen === 'message' && s.title === 'Autour de moi'), 15_000, 'Autour de moi', n);
      check(/^(△▽ arrêt|double toucher)/.test(hint(near) ?? ''), `aide gardée sur « Autour de moi » : « ${hint(near)} »`);
      return { glasses: d7 };
    });
  });
  await withChrome(async (page) => {
    await phoneStep(page, 'resume', async () => {
      await page.goto(pageUrl({ ...PCUR(S1), mockSpeed: '20' }, '#/'));
      await page.waitScreen((s) => s.screen === 'home', 20_000, 'accueil');
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'steps' && s.followed === false, 20_000, 'étapes, pas encore suivies');
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'steps' && s.followed === true && s.lines.some((l) => /en cours$/.test(l)), 40_000, 'suivi, marche en cours (07:35)');
      await page.gesture('double');
      await page.waitScreen((s) => s.screen === 'home' && /^En cours : vers le bureau {3}IC 07:42 \+2 voie 6 !$/.test(s.lines[0] ?? ''), 10_000, '« En cours » sur l’accueil (CA-M6.3)');
      const n = page.screens().length;
      await page.goto(pageUrl({ mockLat: '50.6727', mockLon: '4.5694', mockNow: '2026-11-10T08:05:00+01:00' }, '#/'));
      const g = await page.waitScreen((s) => s.screen === 'train' && s.lines[s.lines.length - 1] === 'Trajet en cours : vers le bureau', 20_000, '« Dans le train » et « Trajet en cours : vers le bureau »', n);
      check(g.title === 'IC vers Bruxelles-Midi, +2 min', `titre « ${g.title} »`);
      await page.waitScreen((s) => s.screen === 'train' && s.lines[s.lines.length - 1] === H.train, 8_000, 'message court (3 s), puis l’aide', n);
      const m = page.screens().length;
      await page.gesture('double');
      const st = await page.waitScreen((s) => s.screen === 'steps' && s.followed === true, 8_000, 'étapes du trajet en cours', m);
      check(st.label === 'short' && st.title.endsWith(FOLLOWED), `trajet repris « ${st.label} » « ${st.title} »`);
      // 1.2.1 : ▼ au bout des étapes du trajet repris : « Autres trajets »
      for (let i = 0; i < 4 && page.lastScreen()?.screen === 'steps'; i++) await page.gesture('down');
      const l = await page.waitScreen((s) => s.screen === 'others', 8_000, '« Autres trajets » du trajet repris', m);
      check(l.title === 'Vers le bureau : autres trajets' && l.lines.length >= 3, `« ${l.title} » ${JSON.stringify(l.lines)}`);
      await page.gesture('double');
      await page.waitScreen((s) => s.screen === 'steps' && s.followed === true, 8_000, 'retour aux étapes', m);
      await page.gesture('double');
      const h = await page.waitScreen((s) => s.screen === 'home' && /^En cours : vers le bureau {3}descente 08:42$/.test(s.lines[0] ?? ''), 10_000, 'accueil, « En cours » gardée', m);
      return { glasses: h };
    });
    await phoneStep(page, 'after-arrival', async () => {
      const n = page.screens().length;
      await page.goto(pageUrl({ mockLat: '50.8441', mockLon: '4.3474', mockNow: '2026-11-10T09:10:00+01:00' }, '#/'));
      const h = await page.waitScreen((s) => s.screen === 'home' && loaded(s), 20_000, 'accueil à 09:10', n);
      check(!/^En cours/.test(h.lines[0] ?? ''), `plus de « En cours » après l’arrivée plus 5 min (CA-M6.6) : « ${h.lines[0]} »`);
      return { glasses: h };
    });
  });
  await withChrome(async (page) => {
    await phoneStep(page, 'not-left', async () => {
      await page.goto(pageUrl(PCUR(S1), '#/'));
      await page.waitScreen((s) => s.screen === 'home', 20_000, 'accueil');
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'steps' && s.followed === false, 20_000, 'étapes à 07:31, pas suivies');
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'steps' && s.followed === true, 20_000, 'étapes suivies à 07:31');
      await page.gesture('double');
      await page.waitScreen((s) => s.screen === 'home', 8_000, 'accueil avant le départ');
      const n = page.screens().length;
      await page.goto(pageUrl({ ...S1, mockNow: '2026-11-10T07:50:00+01:00' }, '#/'));
      const h = await page.waitScreen((s) => s.screen === 'home' && loaded(s), 20_000, 'accueil à 07:50, toujours à la maison', n);
      check(!/^En cours/.test(h.lines[0] ?? ''), `pas de « En cours » : l’IC est parti sans l’utilisateur (CA-M6.4, CA-M6.5) : « ${h.lines[0]} »`);
      return { glasses: h };
    });
  });
  await withChrome(async (page) => {
    await phoneStep(page, 'undo-identical', async () => {
      // REVUE-USAGE n° 3 : ★ des départs de la gare du Nord (ouverts seuls : l'arrêt repère du tram 3 et du tram 4),
      // « garder une ligne », le tram 3 retiré puis rétabli dans les 5 s : « Lignes de bus, tram, métro » du téléphone
      // identique (place, nom, terminus, ouverture d'office à moins de 300 m)
      await page.goto(pageUrl(PCUR(S2), '#/'));
      const lines = `document.querySelector('#h-follows')?.closest('section')`;
      const state = () => page.eval<string>(`(() => { const s = ${lines}; return s ? s.innerText + ' | ' + [...s.querySelectorAll('.pick-near input')].map((i) => i.checked).join(',') : ''; })()`);
      await page.waitFor(`(${lines})?.innerText.includes('Churchill ↔ Esplanade')`, 15_000, '« Lignes de bus, tram, métro » du téléphone');
      const before = await state();
      await page.waitScreen((s) => s.screen === 'board' && /★$/.test(s.title) && s.lines[0] === '★ garder une ligne', 20_000, 'départs de Gare du Nord ouverts seuls, ★');
      // la ligne ★ en tête du tableau (le curseur commence sur le premier départ) ; un glissement reçu juste après un
      // rendu est écarté par l'anti-rebond des lunettes (QUAI_GESTURE « écarté : après un rendu ») : refait, comme une
      // personne le referait
      for (let i = 0; i < 4 && page.lastScreen()?.sel !== 0; i++) {
        await page.gesture('up');
        await sleep(400);
      }
      await page.waitScreen((s) => s.screen === 'board' && s.sel === 0, 5_000, 'curseur sur la ligne ★');
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'keepLine' && s.lines[0] === 'tram 3   ★', 10_000, '« garder une ligne »');
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'keepLine' && s.lines[s.lines.length - 1] === '★ Retirée. Toucher encore : annuler', 5_000, 'retirée');
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'keepLine' && s.lines[s.lines.length - 1] === '★ Ligne rétablie', 5_000, 'rétablie');
      await page.goto(pageUrl({ ...S2 }, '#/'));
      await page.waitFor(`(${lines})?.innerText.includes('Churchill ↔ Esplanade')`, 15_000, '« Lignes de bus, tram, métro » relu');
      const after = await state();
      check(after === before, `« Lignes de bus, tram, métro » identique (place, nom, ouverture d’office) :\n${before}\n≠\n${after}`);
      const stored = await page.eval<string>(`localStorage.getItem('quai.settings') ?? ''`);
      check(!/"kind":"stop"/.test(stored), 'jamais d’arrêt favori (PRD-1.2.2 § 4)');
    });
  });
}

/* ------------------------------ Visite : images de app/test/screens (--tour) ------------------------------ */

async function tourPhone(): Promise<void> {
  if (!WITH_TOUR) return;
  /** `scroll` : texte exact d'un élément à placer en haut de l'image (sinon le haut de la page). */
  type Shot = { file: string; params: Record<string, string>; hash: string; what: string; data?: string; scroll?: string };
  const shots: Shot[] = [
    { file: 'phone-onboarding.png', params: { ...S3, reset: '1' }, hash: '#/', what: 'Premier lancement, étape « Bienvenue »' },
    { file: 'phone-home.png', params: PNICE(S3), hash: '#/', what: 'Accueil du téléphone : « Où vas-tu ? », « Mes favoris », puis les gares, les arrêts et les lignes' },
    { file: 'phone-picks.png', params: PCUR(S3), hash: '#/gares', what: '« Gares de train », « Arrêts de bus, tram, métro » et « Lignes de bus, tram, métro » sur l’accueil du téléphone', scroll: 'Gares de train' },
    { file: 'phone-places.png', params: PNICE(S1), hash: '#/favoris/fav-maison', what: 'Un lieu de « Mes favoris » : nom, adresse et accès, créneau « En tête de l’accueil »' },
    { file: 'phone-favorites.png', params: PNICE(S3), hash: '#/favoris', what: 'Mes favoris : endroits et trajets fixes dans une seule liste' },
    { file: 'phone-favorite-edit.png', params: PCUR(S2), hash: '#/favoris/fav-gand', what: 'Modifier un trajet fixe (en modification, pas de choix « Un endroit » ou « Un trajet de A à B »)' },
    { file: 'phone-trips.png', params: PCUR(S1), hash: '#/trajets', what: '« Trajets » : marche maximale et marge avant de partir' },
    { file: 'phone-display.png', params: PCUR(S2), hash: '#/affichage', what: 'Affichage : « À l’ouverture de Quai », « Ordre des favoris » et l’aperçu de l’accueil des lunettes 1.2.2 (« Favoris », « Gares », « Bus, tram, métro »)', scroll: 'À l’ouverture de Quai' },
    { file: 'phone-alerts.png', params: PCUR(S1), hash: '#/alertes', what: 'Alertes' },
    { file: 'phone-data.png', params: PCUR(S2), hash: '#/donnees', what: `Données, avec « Version de Quai ${APP_VERSION} » et « Adresses »` },
    { file: 'phone-search.png', params: PCUR(S3), hash: '#/recherche?q=Gand', what: 'Recherche « Gand » dans le champ unique' },
    { file: 'phone-search-results.png', params: PCUR(S3), hash: '#/recherche?de=sncb:8813003&vers=sncb:8892007', what: 'Trajets Bruxelles-Central vers Gand-Saint-Pierre : nom affiché, ligne des moyens, phrase' },
  ];
  const { dir } = await buildFixtureData({ date: '2026-11-01' });
  const old = await startDataServer(dir);
  shots.push({ file: 'phone-data-stale.png', params: PCUR(S2), hash: '#/donnees', what: 'Données quand la mise à jour de nuit est en panne', data: old.url });
  try {
    await withChrome(
      async (page) => {
        for (const { file, params, hash, what, data, scroll } of shots) {
          await phoneStep(page, file.replace(/\.png$/, ''), async () => {
            await page.goto(pageUrl(params, hash, data ? { data } : undefined));
            await sleep(hash.includes('recherche') ? 3_500 : 2_500);
            await page.addStyle(NO_EMU);
            const top = scroll
              ? await page.eval<boolean>(`(() => { const el = [...document.querySelectorAll('main *')].find((e) => e.textContent.trim() === ${JSON.stringify(scroll)}); if (!el) return false; window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 12); return true; })()`)
              : await page.eval<boolean>('(window.scrollTo(0, 0), true)');
            check(top, `élément « ${scroll} » introuvable`);
            await sleep(250);
            const out = join(TOUR, file);
            await page.screenshot(out);
            toured.push({ file, what });
          });
        }
      },
      { width: 600, height: 800, dpr: 1, mobile: true },
    );
  } finally {
    await old.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ------------------------------ Prototype 1.2.6 (branche locale proto-126, jamais publié) ------------------------------ */

/** PCUR, version vue 1.2.6, « Lignes » : tram 3, tram 4 (gardés à Gare du Nord en 1.2.5) et bus W (TEC). */
const P126 = preset('p/p126.json');
/** Même chose, version vue 1.2.5 : message « Quai 1.2.6 ». */
const P126NEWS = preset('p/p126news.json');
/** Waterloo (PWAT), version vue 1.2.6, mêmes lignes. */
const PWAT126 = preset('p/pwat126.json');

/** Contrôles communs des écrans de la 1.2.6 : aucune ligne coupée, pas de tiret long. */
function proto(s: Screen): void {
  const cut = truncatedLines(s);
  check(!cut.length, `lignes coupées : ${JSON.stringify(cut)}`);
  check(![s.title, ...s.lines].some((l) => /[–—]/.test(l)), 'tiret long dans un texte affiché');
}

/**
 * 1.2.6 (docs/v1.2.6/PRD-1.2.6.md) : à 12:10 à la gare du Nord, un utilisateur de la 1.2.5 (tram 3 et tram 4 gardés à
 * Gare du Nord, migrés en lignes suivies) qui suit aussi le bus W : les départs de l'arrêt repère ouverts seuls, les trois
 * rubriques, « Lignes » (un sens par rangée), toute la ligne dans un sens et l'autre sens, les passages à un arrêt ;
 * Waterloo et le bus W ; le message « Quai 1.2.6 » ; le téléphone : sections, ajouts « Près de toi », bannière.
 */
async function s126(): Promise<void> {
  await sim.launch(pageUrl(P126(S2)));
  await step('ouverture', async () => {
    const s = await sim.waitScreen(is('board', loaded), 20_000, 'départs de Gare du Nord ouverts seuls');
    check(s.title === 'Gare du Nord, tram (STIB) ★' && s.lines[0] === '★ garder une ligne', `« ${s.title} » ${JSON.stringify(s.lines.slice(0, 2))} (PRD-1.2.6 § 4)`);
    common(s, H.board);
    return { screen: s };
  });
  await step('accueil', async () => {
    const s = await back(is('home', (x) => homeReady(x) && has(x, /^Lignes de bus, tram, métro {3}/)), 'accueil');
    check(sameList(s.lines.slice(-3), ['Gares de train   1 gare', 'Arrêts de bus, tram, métro   1 arrêt', 'Lignes de bus, tram, métro   3 lignes']), `les trois rubriques ${JSON.stringify(s.lines)} (PRD-1.2.6 § 1)`);
    homeCommon(s, false);
    return { screen: s, relief: 'home' };
  });
  await step('arrets', async () => {
    await sim.select(homeIndex(sim.last!, STOPS_ROW));
    await sim.input('click');
    const s = await sim.waitScreen(is('lines', loaded), 15_000, '« Arrêts »');
    check(s.title === 'Arrêts de bus, tram, métro' && s.lines[0] === 'Bruxelles-Nord', `« ${s.title} » ${JSON.stringify(s.lines)} (PRD-1.2.6 § 2)`);
    common(s, H.lines);
    return { screen: s, relief: 'lines' };
  });
  await step('gares', async () => {
    const h = await back(homeReady, 'accueil');
    await sim.select(homeIndex(h, STATIONS_ROW));
    await sim.input('click');
    const s = await sim.waitScreen(is('stations', loaded), 15_000, '« Gares de train »');
    check(s.title === 'Gares de train' && /^Namur {3}/.test(s.lines[0] ?? ''), `« ${s.title} » ${JSON.stringify(s.lines)}`);
    common(s, H.stations);
    return { screen: s };
  });
  await step('lignes', async () => {
    const h = await back(homeReady, 'accueil');
    await sim.select(homeIndex(h, /^Lignes de bus, tram, métro {3}/));
    await sim.input('click');
    const s = await sim.waitScreen(is('follows', (x) => loaded(x) && x.lines.filter((l) => / vers /.test(l)).length >= 5), 15_000, '« Lignes »');
    // le bus W (ajouté en 1.2.6) puis le tram 3 et le tram 4 (repris de la 1.2.5), un sens par rangée
    check(sameList(s.lines.filter((l) => SEG_ROW.test(l)), ['Bus W vers Braine-l’Alleud Gare', 'Bus W vers Bruxelles Midi', 'Tram 3 vers Churchill', 'Tram 3 vers Esplanade', 'Tram 4 vers Stalle']), `un sens par rangée : ${JSON.stringify(s.lines)}`);
    common(s, H.follows);
    return { screen: s, relief: 'lines' };
  });
  await step('tram3-churchill', async () => {
    const i = sim.last!.lines.findIndex((l) => l === 'Tram 3 vers Churchill');
    check(i >= 0, `« Tram 3 vers Churchill » absent : ${JSON.stringify(sim.last!.lines)}`);
    await sim.select(i);
    await sim.input('click');
    const s = await sim.waitScreen(is('lineRun', (x) => loaded(x) && x.title === 'Tram 3 vers Churchill'), 15_000, 'tout le tram 3 vers Churchill');
    check(s.sel === (field<number>(s, 'nearest') ?? -2) && /Gare du Nord à \d+ m {3}/.test(s.lines.find((l) => /Gare du Nord/.test(l)) ?? ''), `l’arrêt le plus proche sous le curseur : sel ${s.sel} ${JSON.stringify(s.lines)}`);
    common(s, H.lineRun);
    return { screen: s };
  });
  await step('tram3-churchill-fin', async () => {
    const stops = field<number>(sim.last!, 'stops') ?? 0;
    await sim.select(stops);
    const s = await sim.waitScreen(is('lineRun', (x) => x.sel === stops), 8_000, '▼ jusqu’à « ↔ Autre sens »');
    proto(s);
    return { screen: s };
  });
  await step('tram3-esplanade', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('lineRun', (x) => loaded(x) && x.title === 'Tram 3 vers Esplanade'), 15_000, '↔ autre sens');
    proto(s);
    return { screen: s };
  });
  await step('tram3-arret', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('line', loaded), 15_000, 'passages du tram 3 à l’arrêt');
    proto(s);
    return { screen: s };
  });
  await sim.stop();
  await sim.launch(pageUrl(PWAT126(WAT)));
  await step('waterloo-accueil', async () => {
    const s = await sim.waitScreen(is('home', (x) => homeReady(x) && has(x, /^Lignes de bus, tram, métro {3}/)), 20_000, 'accueil à Waterloo');
    proto(s);
    return { screen: s };
  });
  await step('waterloo-lignes', async () => {
    await sim.select(homeIndex(sim.last!, /^Lignes de bus, tram, métro {3}/));
    await sim.input('click');
    const s = await sim.waitScreen(is('follows', (x) => loaded(x) && x.lines.some((l) => l === 'Bus W vers Bruxelles Midi')), 15_000, '« Lignes » à Waterloo');
    proto(s);
    return { screen: s, shot: false };
  });
  await step('busW-midi', async () => {
    await sim.select(sim.last!.lines.findIndex((l) => l === 'Bus W vers Bruxelles Midi'));
    await sim.input('click');
    const s = await sim.waitScreen(is('lineRun', (x) => loaded(x) && x.title === 'Bus W vers Bruxelles Midi'), 15_000, 'tout le bus W vers Bruxelles Midi');
    proto(s);
    return { screen: s };
  });
  await sim.stop();
  await sim.launch(pageUrl(P126NEWS(S2)));
  await step('nouveautes', async () => {
    const s = await sim.waitScreen(is('message', (x) => x.title === 'Quai 1.2.6'), 20_000, '« Quai 1.2.6 »');
    proto(s);
    return { screen: s };
  });
  await withChrome(async (page) => {
    await phoneStep(page, 'tel-accueil', async () => {
      await page.goto(pageUrl(P126(S2), '#/'));
      await waitText(page, /Lignes de bus, tram, métro[\s\S]*Ajouter une ligne/, 'sections « Arrêts » et « Lignes »');
      await sleep(1_500);
      return { shot: true, scroll: { text: 'Gares de train' } };
    });
    await phoneStep(page, 'tel-ajout-ligne', async () => {
      await hashGo(page, '#/lignes/ajouter');
      await waitText(page, /Près de toi[\s\S]*Métro 2/, 'lignes près de toi');
      await sleep(1_200);
      return { shot: true };
    });
    await phoneStep(page, 'tel-ajout-ligne-m2', async () => {
      await page.eval(`(() => { const r = [...document.querySelectorAll('.near-row')].find((x) => /Métro 2/.test(x.textContent)); r.querySelector('button').click(); return true; })()`);
      await page.waitFor(`[...document.querySelectorAll('.near-row')].some((x) => /Métro 2/.test(x.textContent) && /Ajoutée/.test(x.textContent))`, 5_000, 'métro 2 ajouté');
      await sleep(300);
      return { shot: true };
    });
    await phoneStep(page, 'tel-lignes', async () => {
      await hashGo(page, '#/');
      await waitText(page, /Métro 2/, 'Métro 2 dans « Lignes »');
      await sleep(1_200);
      return { shot: true, scroll: { text: 'Arrêts de bus, tram, métro' } };
    });
    await phoneStep(page, 'tel-ajout-arret', async () => {
      await hashGo(page, '#/lignes/ajouter/arret');
      await waitText(page, /Gare du Nord[\s\S]*Rogier/, 'arrêts proches');
      await sleep(1_500);
      return { shot: true };
    });
    await phoneStep(page, 'tel-ajout-gare', async () => {
      await hashGo(page, '#/gares/ajouter');
      await waitText(page, /Près de toi[\s\S]*Bruxelles/, 'gares proches');
      await sleep(800);
      return { shot: true };
    });
    await phoneStep(page, 'tel-nouveau', async () => {
      await page.goto(pageUrl(P126NEWS(S2), '#/'));
      await waitText(page, /trois rubriques/, 'bannière « Nouveau »');
      return { shot: true };
    });
  });
}

/* ------------------------------ Lancement ------------------------------ */

const SCENARIOS: [string, string, () => Promise<void>][] = [
  ['s126', '1.2.6 : départs de l’arrêt repère ouverts seuls, « Gares de train », « Arrêts » et « Lignes », toute la ligne dans un sens, l’autre sens, Waterloo et le bus W, message, téléphone (ajouts « Près de toi »)', s126],
  ['s1', 'le matin à Namur : accueil 1.2.6, étapes, « Suivre ce trajet », « Ne plus suivre », « Fin du trajet », « Autres trajets », Favoris et adresses récentes, Gares de train, tableau complet, arrêts d’un départ et retours (1.2.3), Arrêts, Lignes, toute la ligne, sortie', s1],
  ['s1noRT', 'le matin, temps réel indisponible : ligne du haut sans « ~ », « Le plus court : 1 changement, à pied 7 + 2 + 9 min », « Sans changement », Gares en horaire prévu', s1noRT],
  ['s1run', 'trajet suivi en accéléré : en cours, dans le train, dans le tram, descente, fin', s1run],
  ['s1stay', 'l’IC part sans l’utilisateur : le trajet en cours prend fin', s1stay],
  ['s1open', 'trajet ouvert sans être suivi : jamais « En cours » ni « Dans le train » (CA-122.7)', s1open],
  ['s2', 'gare du Nord : départs de l’arrêt repère ouverts seuls (1.2.6), « Lignes », toute la ligne, ses passages à un arrêt, arrêts d’un passage, tableau complet et ses pages (1.2.3), « garder une ligne » annulable, accueil, Favoris, panne du temps réel', s2],
  ['s3', 'l’après-midi vers Gand : réponse, étapes, étiquettes par « Autres trajets », trajet suivi, « Ne plus suivre », détail du train', s3],
  ['s3run', 'vers Gand en accéléré : dans le train, aide à l’arrivée, « ★ garder ce trajet » déjà gardé', s3run],
  ['waterloo', 'Waterloo : accueil (Favoris 3, Maison jamais montrée, la gare dans « Gares »), trajet au milieu et au bout, « Autres trajets », « Plus tôt », retours, rubrique vide', waterloo],
  ['holiday', 'jour férié : dernière ligne de l’accueil le 11/11, rien le 12/11', holiday],
  ['news', `mise à jour depuis la 1.2.5, la 1.2.4, la 1.2.3, la 1.2.2, la 1.2.1, la 1.2.0, la 1.1 et la 1.0 : message « ${NEWS_TITLE} » (avec la 1.2.5 pour les plus anciennes), favoris migrés, arrêts et lignes rangés, « Favoris »`, news],
  ['firstrun', 'premier lancement : bienvenue, accueil sans favori avec l’aide des gestes, « Favoris » vide, rubriques à choisir, sortie', firstrun],
  ['errors', 'horaires injoignables puis nouvel essai, relais muet, aucun arrêt, l’arrêt le plus proche', errors],
  ['stale', 'horaires périmés', stale],
  ['late', '23:30 : passages et départs de demain', late],
  ['phone', 'téléphone (Chrome) : bannière, migration visible, Mes favoris, Trajets, Nouveau favori et ses onglets, gare vers « Gares », cartes 1.2.1, jour férié, Garder en favori, champ, ordre, Affichage, données, premier lancement', phone],
  ['keep', '« ★ garder ce trajet » depuis ma position (Chrome, accéléré) : un lieu', keep],
  ['web', 'Quai Web (Chrome) : onglet Lunettes (accueil 1.2.2, relief), rubrique « Position » avec une adresse', webPosition],
  ['reopen', `réouverture de Quai (Chrome) : « ${NEWS_TITLE} » et la bannière une fois, aide des gestes 7 jours, trajet repris, fin du trajet, ligne retirée puis rétablie à l’identique`, reopen],
  ['tour', 'images du téléphone pour app/test/screens (--tour)', tourPhone],
];

async function main(): Promise<void> {
  if (process.env.QUAI_SKIP_SIM === '1') {
    console.log('Simulateur ignoré (QUAI_SKIP_SIM=1).');
    return;
  }
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(SHOTS)) if (f.endsWith('-ECHEC.png')) rmSync(join(SHOTS, f));
  const tmp = mkdtempSync(join(tmpdir(), 'quai-sim-'));
  const dist = join(tmp, 'dist');
  const distWeb = join(tmp, 'dist-web');
  console.log('Construction de l’appli et de Quai Web (vite build)…');
  const b = await run('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: APP });
  if (b.code !== 0) throw new Error(`vite build en échec\n${b.stdout}\n${b.stderr}`);
  // Quai Web : adresses de build fictives (https exigé), remplacées dans la page par ?e2e=1&data=…&relay=…
  const bw = await run('npx', ['vite', 'build', '--config', 'vite.web.config.ts', '--outDir', distWeb, '--emptyOutDir'], {
    cwd: APP,
    // 1.2.5 : la politique de sécurité de la page laisse aussi parler aux serveurs de la machine (essais seulement)
    env: { ...process.env, QUAI_DATA_BASE: 'https://donnees.quai-test.invalid', QUAI_RELAY_BASE: 'https://relais.quai-test.invalid', QUAI_WEB_BASE: '/', QUAI_WEB_CSP_LOCAL: '1' },
  });
  if (bw.code !== 0) throw new Error(`vite build de Quai Web en échec\n${bw.stdout}\n${bw.stderr}`);
  stack = await startStack();
  // Données de la nuit : mêmes fichiers, publiés le 10/11 à 04:12 (heure du jeu de test, écran « Données »).
  const nightDir = join(tmp, 'data');
  cpSync(stack.dataDir, nightDir, { recursive: true });
  republish(nightDir, '2026-11-10T03:12:00.000Z');
  night = await startDataServer(nightDir);
  // Réglages de test, tous au format de la 1.1 (v2) : la 1.2.2 les migre au lancement (PRD-1.2 § 2.4, PRD-1.2.2 § 5).
  const p11 = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'app', 'preset-1.1.json'), 'utf8')) as Record<string, unknown> & { places: Record<string, unknown>[] };
  const p120 = { ...p11, seenVersion: '1.2.0' };
  const p121 = { ...p11, seenVersion: '1.2.1' };
  const p122 = { ...p11, seenVersion: '1.2.2' };
  const p123 = { ...p11, seenVersion: '1.2.3' };
  const p124 = { ...p11, seenVersion: '1.2.4' };
  const p125 = { ...p11, seenVersion: '1.2.5' };
  const pcur = { ...p11, seenVersion: '1.2.6' };
  // Adresses récentes : des lieux publics (PRD-1.2.2 : jamais d'adresse personnelle dans les tests ni les captures).
  const recent = [
    { label: 'Grand-Place, 1000 Bruxelles', lat: 50.8467, lon: 4.3525, at: Date.parse('2026-11-09T18:20:00+01:00') },
    { label: 'Korenmarkt, 9000 Gent', lat: 51.0547, lon: 3.7217, at: Date.parse('2026-11-08T10:05:00+01:00') },
    { label: 'Place de la Monnaie, 1000 Bruxelles', lat: 50.8502, lon: 4.3529, at: Date.parse('2026-11-07T16:40:00+01:00') },
  ];
  const presets = join(tmp, 'p');
  mkdirSync(presets);
  const write = (name: string, x: unknown) => writeFileSync(join(presets, name), JSON.stringify(x));
  write('1.2.0.json', p120);
  write('1.2.1.json', p121);
  write('1.2.2.json', p122);
  write('1.2.3.json', p123);
  write('1.2.4.json', p124);
  write('1.2.5.json', p125);
  write('current.json', pcur);
  write('recent.json', { ...pcur, recent });
  write('phone.json', {
    ...pcur,
    places: [...p11.places, { id: 'lieu-piscine', label: 'Piscine de Bruxelles', lat: 50.852, lon: 4.3555, address: 'Rue Neuve, 1000 Bruxelles', src: 'address', approx: true }],
    recent: [{ label: 'Boulevard du Centenaire 1, 1020 Bruxelles', lat: 50.8915, lon: 4.334, at: Date.parse('2026-11-09T18:20:00+01:00') }],
  });
  write('empty.json', { ...pcur, places: [], favorites: [], recent: [] });
  write('nice.json', {
    ...pcur,
    places: [
      { id: 'maison', label: 'Maison', lat: 50.4662, lon: 4.8648, address: 'Rue de Fer 25, 5000 Namur', src: 'address' },
      { id: 'bureau', label: 'Bureau', lat: 50.8582, lon: 4.36, address: 'Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', src: 'address' },
    ],
    recent: recent.slice(1),
  });
  // Waterloo (CA-121.5 : 4 favoris dont Maison, tu y es) : adresses des fixtures (scénario 4, CA-M5.3), gare de Waterloo
  write('waterloo.json', {
    ...pcur,
    places: [
      { id: 'maison', label: 'Maison', lat: 50.7175, lon: 4.399, address: 'Chaussée de Bruxelles 1, 1410 Waterloo', src: 'address' },
      { id: 'bureau', label: 'Bureau', lat: 50.8582, lon: 4.36, address: 'Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', src: 'address' },
      { id: 'mama', label: 'Mama', lat: 50.808, lon: 4.365, address: 'Avenue Winston Churchill 100, 1180 Uccle', src: 'address' },
    ],
    favorites: [
      { kind: 'trip', id: 'fav-bureau', from: { type: 'here' }, to: { type: 'place', placeId: 'bureau' }, label: 'bureau', propose: 'morning' },
      { kind: 'trip', id: 'fav-mama', from: { type: 'here' }, to: { type: 'place', placeId: 'mama' }, label: 'Mama', propose: 'never' },
      { kind: 'stop', id: 'fav-waterloo', areaId: 'sncb:8814266', op: 'sncb', name: { fr: 'Waterloo', nl: 'Waterloo' }, lat: 50.7154, lon: 4.3835, propose: 'never' },
      { kind: 'trip', id: 'fav-maison', from: { type: 'here' }, to: { type: 'place', placeId: 'maison' }, label: 'maison', propose: 'evening' },
    ],
    recent: [],
  });
  // 1.2.6 : lignes suivies sans arrêt. Le tram 3 et le tram 4 du préréglage (gardés à Gare du Nord, « près ») sont
  // migrés au lancement, l'arrêt en repère ; le bus W, ajouté en 1.2.6, sans arrêt. À Waterloo, les trois suivies.
  const N2 = (fr: string, nl = fr) => ({ fr, nl });
  const busW = { id: 'f-tec-w', op: 'tec', mode: 'bus', line: 'W', routes: ['tec:B0536-23747'], ends: [N2('Braine-l’Alleud Gare'), N2('Bruxelles Midi')] };
  const follows = [
    { id: 'f-stib-3', op: 'stib', mode: 'tram', line: '3', routes: ['stib:3'], ends: [N2('Churchill'), N2('Esplanade')] },
    { id: 'f-stib-4', op: 'stib', mode: 'tram', line: '4', routes: ['stib:4'], ends: [N2('Stalle (P)')] },
    busW,
  ];
  write('p126.json', { ...pcur, follows: [busW] });
  write('p126news.json', { ...pcur, seenVersion: '1.2.5', follows: [busW] });
  write('pwat126.json', { ...(JSON.parse(readFileSync(join(presets, 'waterloo.json'), 'utf8')) as object), follows });
  const extra = {
    '/preset.json': join(ROOT, 'fixtures', 'app', 'preset.json'),
    '/preset-1.1.json': join(ROOT, 'fixtures', 'app', 'preset-1.1.json'),
    ...Object.fromEntries(readdirSync(presets).map((f) => [`/p/${f}`, join(presets, f)])),
  };
  web = await startStatic(dist, extra);
  webApp = await startStatic(distWeb, extra);
  sim = new Sim(PORT, SHOTS);
  console.log(`Quai ${APP_VERSION} ; données ${night.url} ; relais ${stack.relay.url} ; adresses ${stack.geo.url} ; appli ${web.url} ; Quai Web ${webApp.url} ; simulateur :${PORT}`);
  const t0 = Date.now();
  try {
    for (const [id, label, fn] of SCENARIOS) await runScenario(id, label, fn);
  } finally {
    await sim.stop();
    await web.close();
    await webApp.close();
    writeFileSync(join(OUT, 'sim-servers.log'), stack.logs());
    await night.stop();
    await stack.stop();
    rmSync(tmp, { recursive: true, force: true });
  }
  if (DELIVER && Object.keys(delivered).length) {
    const manifest = Object.fromEntries(Object.entries(DELIVERABLES).filter(([id]) => delivered[id]).map(([, d]) => [d.file, d.caption]));
    const path = join(DELIVER, 'manifest.json');
    const prev = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>) : {};
    writeFileSync(path, JSON.stringify({ ...prev, ...manifest }, null, 2) + '\n');
  }
  if (WITH_TOUR && toured.length) {
    const path = join(TOUR, 'tour.json');
    const prev = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as { screens?: { file: string; what: string }[] }) : {};
    const byFile = new Map((prev.screens ?? []).filter((x) => typeof x === 'object' && 'file' in x).map((x) => [x.file, x]));
    for (const t of toured) byFile.set(t.file, t);
    writeFileSync(path, JSON.stringify({ version: APP_VERSION, how: 'tests/e2e : npm run sim -- --tour (vrai cœur, données des fixtures)', screens: [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file)) }, null, 2) + '\n');
  }
  const failed = results.filter((r) => !r.ok);
  writeFileSync(join(OUT, 'sim-report.json'), JSON.stringify({ when: new Date().toISOString(), version: APP_VERSION, ms: Date.now() - t0, durations, results, notes }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} étapes réussies en ${Math.round((Date.now() - t0) / 1000)} s`);
  console.log(`  durées : ${Object.entries(durations).map(([k, v]) => `${k} ${Math.round(v / 1000)} s`).join(', ')}`);
  for (const n of notes) console.log(`  note : ${n}`);
  for (const f of failed) console.log(`  ✗ ${f.scenario}-${f.step} : ${f.error}`);
  process.exitCode = failed.length ? 1 : 0;
}

process.on('SIGINT', () => {
  void sim?.stop().finally(() => process.exit(130));
});
await main();
