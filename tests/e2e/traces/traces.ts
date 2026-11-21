/**
 * 1.2.10 « Y aller » : traces de positions des scénarios guidés (PRD-1.2.10 § 3, § 9.5). Lieux publics seulement
 * (PRD § 8 : gares, arrêts, places, parcs) ; jamais une adresse ni une position personnelle.
 *
 * Deux familles :
 *  - NAMUR_* et RIDE_* : sur le mini-réseau des fixtures (fixtures/network.json, mardi 10/11/2026, scène « base » :
 *    l'IC 2112 de Namur part à 07:44 au lieu de 07:42, voie 6 au lieu de 4). Ce sont celles des scénarios s1210 du
 *    simulateur : de la place de l'Ange de Namur à la place Fontainas (Bruxelles) par l'IC jusqu'à Bruxelles-Nord et le
 *    tram 3 jusqu'à la Bourse ; puis le véhicule raté, l'arrêt dépassé, sans position, « j'y descends ».
 *  - LIEGE_FLAGEY : l'exemple du PRD (§ 3.2, § 3.3), de bout en bout : à pied jusqu'à l'arrêt Monument Gramme, bus 6
 *    jusqu'à la gare des Guillemins, IC par Ans, Louvain et Bruxelles-Nord jusqu'à Bruxelles-Central, à pied, bus 71
 *    jusqu'à Flagey, à pied jusqu'aux étangs d'Ixelles. Les fixtures n'ont ni Liège ni le bus 71 : cette trace sert aux
 *    tests du moteur (équipe A) et à un passage sur les vraies données ; positions des arrêts approchées (à 50 m près),
 *    vitesses et caps cohérents.
 *
 * Chaque point : instant (epoch ms), lat, lon, vitesse (m/s), cap (degrés, absent à l'arrêt), précision (m).
 */
import { at, joinTrace, ride, stay, walk, type LatLon, type Trace, type TracePoint } from './geo';

const D = '2026-11-10';
const T = (hhmmss: string) => at(`${D}T${hhmmss.length === 5 ? `${hhmmss}:00` : hhmmss}`);

/* ------------------------------ Lieux publics (fixtures : mêmes coordonnées que network.json) ------------------------------ */

export const PLACES = {
  /** Namur, place de l'Ange (place publique, centre-ville, 9 min à pied de la gare). Départ des scénarios s1210. */
  placeAnge: { lat: 50.4641, lon: 4.8656 },
  /** Namur, gare (network.json, sncb 8863008) et son quai de la voie 6. */
  namur: { lat: 50.4685, lon: 4.8625 },
  namurVoie6: { lat: 50.4687, lon: 4.8622 },
  gembloux: { lat: 50.5707, lon: 4.6913 },
  ottignies: { lat: 50.6727, lon: 4.5694 },
  luxembourg: { lat: 50.8388, lon: 4.3732 },
  schuman: { lat: 50.8433, lon: 4.3804 },
  bruxellesNord: { lat: 50.8605, lon: 4.3612 },
  bruxellesCentral: { lat: 50.8454, lon: 4.3571 },
  bruxellesMidi: { lat: 50.8357, lon: 4.3363 },
  /** STIB Gare du Nord (6357F), Rogier (6359), De Brouckère (6361), Bourse (6362) : tram 3 vers Churchill. */
  gareDuNordTram: { lat: 50.86, lon: 4.36014 },
  rogier: { lat: 50.85695, lon: 4.35895 },
  deBrouckere: { lat: 50.851, lon: 4.3524 },
  bourse: { lat: 50.8483, lon: 4.3497 },
  /** Bruxelles, place Fontainas (place publique) : destination des scénarios s1210 (9 min à pied de la Bourse). */
  placeFontainas: { lat: 50.8443, lon: 4.3466 },
} as const satisfies Record<string, LatLon>;

/**
 * De la place de l'Ange à la gare de Namur par les rues de l'extrait des fixtures (fixtures/pipeline/osm/namur-bruxelles.osm :
 * rue de Fer, à gauche rue Godefroid, à droite place de la Station), 700 m. 1.3.1 : la trace suit le chemin à pied que le
 * routeur rend sur ces rues. Avant, elle coupait en biais à travers les pâtés de maisons de l'extrait : à 45 m de toute
 * rue, le chemin recalculé repartait de la rue de derrière et l'écran disait « Fais demi-tour » (A6) à quelqu'un qui
 * marchait vers la gare.
 */
export const WALK_NAMUR: LatLon[] = [
  PLACES.placeAnge,
  { lat: 50.46407, lon: 4.86527 },
  { lat: 50.4645, lon: 4.86518 },
  { lat: 50.4658, lon: 4.8649 },
  { lat: 50.46796, lon: 4.86462 },
  { lat: 50.46796, lon: 4.8625 },
  PLACES.namur,
  PLACES.namurVoie6,
];
/** Bruxelles-Nord, du quai à l'arrêt du tram (Gare du Nord, souterrain). */
const WALK_NORD: LatLon[] = [PLACES.bruxellesNord, { lat: 50.8602, lon: 4.3607 }, PLACES.gareDuNordTram];
/** De la Bourse à la place Fontainas par le boulevard Anspach. */
const WALK_FONTAINAS: LatLon[] = [PLACES.bourse, { lat: 50.8471, lon: 4.3489 }, { lat: 50.8457, lon: 4.3477 }, PLACES.placeFontainas];
/** De Bruxelles-Central à la place Fontainas (rue de la Madeleine, rue du Midi) : après l'arrêt dépassé. */
const WALK_CENTRAL_FONTAINAS: LatLon[] = [PLACES.bruxellesCentral, { lat: 50.8458, lon: 4.3545 }, { lat: 50.8455, lon: 4.3512 }, { lat: 50.8449, lon: 4.3488 }, PLACES.placeFontainas];

/** IC 2112 (scène base : +2 min) de Namur à Bruxelles-Nord, ou au-delà jusqu'à Bruxelles-Central. */
const IC_2112 = [
  { name: 'Namur', ...PLACES.namurVoie6, arr: T('07:44'), dep: T('07:44') },
  { name: 'Gembloux', ...PLACES.gembloux, arr: T('07:57'), dep: T('07:57:30') },
  { name: 'Ottignies', ...PLACES.ottignies, arr: T('08:11'), dep: T('08:11:30') },
  { name: 'Bruxelles-Luxembourg', ...PLACES.luxembourg, arr: T('08:33'), dep: T('08:33:30') },
  { name: 'Bruxelles-Schuman', ...PLACES.schuman, arr: T('08:37'), dep: T('08:37:30') },
  { name: 'Bruxelles-Nord', ...PLACES.bruxellesNord, arr: T('08:42'), dep: T('08:43') },
  { name: 'Bruxelles-Central', ...PLACES.bruxellesCentral, arr: T('08:48'), dep: T('08:48:30') },
];
/** Jusqu'à la descente à Bruxelles-Nord (08:42) : la personne quitte le train à son arrivée. */
const IC_TO_NORD = [...IC_2112.slice(0, 5), { ...IC_2112[5], dep: IC_2112[5].arr }];
/** Tram 3 vers Churchill (gabarit 1103, départ d'Esplanade 08:32). */
const T3_0844 = [
  { name: 'Gare du Nord', ...PLACES.gareDuNordTram, arr: T('08:44'), dep: T('08:44') },
  { name: 'Rogier', ...PLACES.rogier, arr: T('08:46'), dep: T('08:46') },
  { name: 'De Brouckère', ...PLACES.deBrouckere, arr: T('08:48'), dep: T('08:48') },
  { name: 'Bourse', ...PLACES.bourse, arr: T('08:49'), dep: T('08:49') },
];

/* ------------------------------ Traces des scénarios s1210 (fixtures) ------------------------------ */

/**
 * De bout en bout, tout se passe bien : à 07:20 sur la place de l'Ange, « Partir maintenant » à l'heure de partir
 * (07:33 : l'IC de 07:44 moins 9 min de marche et 2 min de marge), départ à 07:34, 9 min à pied jusqu'à la voie 6,
 * l'IC de 07:44 (voie modifiée), descente à Bruxelles-Nord à 08:42,
 * 1 min 20 à pied jusqu'au tram 3 (très juste), tram 3 de 08:44, descente à la Bourse à 08:49, 6 min 30 à pied
 * jusqu'à la place Fontainas.
 */
export const NAMUR_FONTAINAS: Trace = {
  id: 'namur-fontainas',
  label: 'Place de l’Ange (Namur) → place Fontainas (Bruxelles) : marche, IC voie 6, tram 3, marche',
  places: ['Place de l’Ange, Namur', 'Gare de Namur', 'Bruxelles-Nord', 'Gare du Nord (tram)', 'Bourse', 'Place Fontainas'],
  points: joinTrace(
    stay(PLACES.placeAnge, T('07:20'), T('07:33:50'), { phase: 'stay', accuracy: 6, mark: 'place de l’Ange' }),
    walk(WALK_NAMUR, T('07:34'), { mark: 'départ à pied' }),
    stay(PLACES.namurVoie6, T('07:43:10'), T('07:43:50'), { mark: 'voie 6' }),
    ride(IC_TO_NORD),
    walk(WALK_NORD, T('08:42:10'), { mark: 'correspondance' }),
    stay(PLACES.gareDuNordTram, T('08:43:30'), T('08:43:50'), { mark: 'arrêt du tram 3' }),
    ride(T3_0844, { everyS: 20 }),
    walk(WALK_FONTAINAS, T('08:49:10'), { mark: 'dernière marche' }),
    stay(PLACES.placeFontainas, T('08:56'), T('08:58'), { phase: 'stay', mark: 'place Fontainas' }),
  ),
};

/** Véhicule raté : même marche, mais l'IC de 07:44 part sans la personne, encore sur le quai à 07:52. */
export const NAMUR_MISSED: Trace = {
  id: 'namur-missed',
  label: 'Place de l’Ange (Namur) : à la voie 6 à temps, mais encore sur le quai 2 min après le départ de l’IC',
  places: ['Place de l’Ange, Namur', 'Gare de Namur'],
  points: joinTrace(
    stay(PLACES.placeAnge, T('07:20'), T('07:33:50'), { phase: 'stay', accuracy: 6 }),
    walk(WALK_NAMUR, T('07:34')),
    stay(PLACES.namurVoie6, T('07:43:10'), T('07:52'), { mark: 'voie 6, IC parti à 07:44' }),
  ),
};

/** Arrêt dépassé : dans l'IC, la descente de Bruxelles-Nord ne se fait pas ; la personne descend à Bruxelles-Central. */
export const NAMUR_PASSED: Trace = {
  id: 'namur-passed',
  label: 'IC de 07:44 : Bruxelles-Nord dépassé, descente à Bruxelles-Central, puis à pied jusqu’à la place Fontainas',
  places: ['Place de l’Ange, Namur', 'Gare de Namur', 'Bruxelles-Nord', 'Bruxelles-Central', 'Place Fontainas'],
  points: joinTrace(
    stay(PLACES.placeAnge, T('07:20'), T('07:33:50'), { phase: 'stay', accuracy: 6 }),
    walk(WALK_NAMUR, T('07:34')),
    stay(PLACES.namurVoie6, T('07:43:10'), T('07:43:50')),
    ride(IC_2112),
    walk(WALK_CENTRAL_FONTAINAS, T('08:49'), { mark: 'à pied depuis Bruxelles-Central' }),
  ),
};

/**
 * Sans position utilisable : la même trace, mais chaque position à 150 m de précision (au-delà des 75 m du PRD § 3.2 :
 * ignorée pour les décisions de distance). Le guidage doit fonctionner à l'heure seule ; sans aucun point du tout,
 * le scénario « sans position » n'envoie rien.
 */
export const NAMUR_IMPRECISE: Trace = {
  id: 'namur-imprecise',
  label: 'Même trajet, positions trop imprécises (150 m) : guidage à l’heure seule',
  places: NAMUR_FONTAINAS.places,
  points: NAMUR_FONTAINAS.points.map((p) => ({ ...p, accuracy: 150 })),
};

/**
 * « J'y descends » : sur le quai de la voie 6 à 07:38, l'IC de 07:44, descente à Bruxelles-Central (08:48), choisie
 * dans les arrêts du départ (genre `ride` : le véhicule seul).
 */
export const RIDE_CENTRAL: Trace = {
  id: 'ride-central',
  label: 'IC de 07:44 pris à Namur, « j’y descends » à Bruxelles-Central',
  places: ['Gare de Namur', 'Bruxelles-Nord', 'Bruxelles-Central'],
  points: joinTrace(stay(PLACES.namurVoie6, T('07:38'), T('07:43:50'), { mark: 'voie 6' }), ride(IC_2112), stay(PLACES.bruxellesCentral, T('08:49'), T('08:52'), { phase: 'stay', mark: 'descendu' })),
};

/* ------------------------------ Exemple du PRD : Liège → Flagey (vraies données, moteur) ------------------------------ */

const L = {
  boverie: { lat: 50.63, lon: 5.58 },
  monumentGramme: { lat: 50.6268, lon: 5.5781 },
  fragnee: { lat: 50.6262, lon: 5.5742 },
  generalLeman: { lat: 50.6258, lon: 5.5703 },
  paradis: { lat: 50.6252, lon: 5.5681 },
  guilleminsBus: { lat: 50.6246, lon: 5.5662 },
  guilleminsVoie3: { lat: 50.6243, lon: 5.5669 },
  ans: { lat: 50.6604, lon: 5.5096 },
  louvain: { lat: 50.8814, lon: 4.7159 },
  bruxellesNord: { lat: 50.8605, lon: 4.3612 },
  bruxellesCentral: { lat: 50.8454, lon: 4.3571 },
  gareCentrale71: { lat: 50.8447, lon: 4.3585 },
  royale: { lat: 50.843, lon: 4.3612 },
  trone: { lat: 50.8405, lon: 4.3667 },
  porteNamur: { lat: 50.838, lon: 4.3627 },
  fernandCocq: { lat: 50.8329, lon: 4.3668 },
  flagey: { lat: 50.8275, lon: 4.3721 },
  etangs: { lat: 50.823, lon: 4.3735 },
} as const satisfies Record<string, LatLon>;

/**
 * L'exemple du PRD, aux heures du PRD : départ 07:05 du parc de la Boverie, 5 min à pied jusqu'à l'arrêt Monument
 * Gramme, bus 6 de 07:12 (4 arrêts, Place Général Leman à 07:16), gare des Guillemins à 07:20, voie 3, IC de 07:30
 * par Ans, Louvain et Bruxelles-Nord, Bruxelles-Central à 08:31, à pied jusqu'à l'arrêt Gare Centrale, bus 71 de
 * 08:34, Flagey à 08:47, à pied jusqu'aux étangs d'Ixelles, arrivée 08:54.
 */
export const LIEGE_FLAGEY: Trace = {
  id: 'liege-flagey',
  label: 'Exemple du PRD : parc de la Boverie (Liège) → étangs d’Ixelles : marche, bus 6, IC, marche, bus 71, marche',
  places: ['Parc de la Boverie, Liège', 'Monument Gramme', 'Gare des Guillemins', 'Ans', 'Louvain', 'Bruxelles-Nord', 'Bruxelles-Central', 'Gare Centrale (bus 71)', 'Flagey', 'Étangs d’Ixelles'],
  points: joinTrace(
    stay(L.boverie, T('07:00'), T('07:04:50'), { phase: 'stay', accuracy: 6 }),
    walk([L.boverie, { lat: 50.6289, lon: 5.5795 }, { lat: 50.6277, lon: 5.5787 }, L.monumentGramme], T('07:05'), { mark: 'vers l’arrêt Monument Gramme' }),
    stay(L.monumentGramme, T('07:10:30'), T('07:11:50'), { mark: 'arrêt Monument Gramme' }),
    ride([
      { name: 'Monument Gramme', ...L.monumentGramme, arr: T('07:12'), dep: T('07:12') },
      { name: 'Pont de Fragnée', ...L.fragnee, arr: T('07:14'), dep: T('07:14:20') },
      { name: 'Place Général Leman', ...L.generalLeman, arr: T('07:16'), dep: T('07:16:20') },
      { name: 'Paradis', ...L.paradis, arr: T('07:18'), dep: T('07:18:20') },
      { name: 'Gare des Guillemins', ...L.guilleminsBus, arr: T('07:20'), dep: T('07:20') },
    ], { everyS: 10 }),
    walk([L.guilleminsBus, { lat: 50.6245, lon: 5.5665 }, L.guilleminsVoie3], T('07:20:30'), { mark: 'vers la voie 3' }),
    stay(L.guilleminsVoie3, T('07:22'), T('07:29:50'), { mark: 'voie 3' }),
    ride([
      { name: 'Liège-Guillemins', ...L.guilleminsVoie3, arr: T('07:30'), dep: T('07:30') },
      { name: 'Ans', ...L.ans, arr: T('07:36'), dep: T('07:37') },
      { name: 'Louvain', ...L.louvain, arr: T('08:10'), dep: T('08:11') },
      { name: 'Bruxelles-Nord', ...L.bruxellesNord, arr: T('08:26'), dep: T('08:27') },
      { name: 'Bruxelles-Central', ...L.bruxellesCentral, arr: T('08:31'), dep: T('08:31') },
    ]),
    walk([L.bruxellesCentral, { lat: 50.8449, lon: 4.3578 }, L.gareCentrale71], T('08:31:30'), { mark: 'vers l’arrêt du bus 71' }),
    stay(L.gareCentrale71, T('08:33:10'), T('08:33:50'), { mark: 'arrêt Gare Centrale' }),
    ride([
      { name: 'Gare Centrale', ...L.gareCentrale71, arr: T('08:34'), dep: T('08:34') },
      { name: 'Royale', ...L.royale, arr: T('08:36'), dep: T('08:36:20') },
      { name: 'Trône', ...L.trone, arr: T('08:38'), dep: T('08:38:20') },
      { name: 'Porte de Namur', ...L.porteNamur, arr: T('08:40'), dep: T('08:40:20') },
      { name: 'Fernand Cocq', ...L.fernandCocq, arr: T('08:44'), dep: T('08:44:20') },
      { name: 'Flagey', ...L.flagey, arr: T('08:47'), dep: T('08:47') },
    ], { everyS: 10 }),
    walk([L.flagey, { lat: 50.8262, lon: 4.3727 }, { lat: 50.8247, lon: 4.3731 }, L.etangs], T('08:47:30'), { mark: 'vers les étangs d’Ixelles' }),
  ),
};

export const TRACES: Record<string, Trace> = Object.fromEntries([NAMUR_FONTAINAS, NAMUR_MISSED, NAMUR_PASSED, NAMUR_IMPRECISE, RIDE_CENTRAL, LIEGE_FLAGEY].map((t) => [t.id, t]));

/** Une position de la trace telle que `window.__quaiPushFix` l'attend (sans les champs de lecture). */
export const toFix = (p: TracePoint) => ({ lat: p.lat, lon: p.lon, accuracy: p.accuracy, speed: p.speed, ...(p.heading !== undefined ? { heading: p.heading } : {}), at: p.at });
