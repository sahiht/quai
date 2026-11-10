# Quai v1.1 : conception du calcul d’itinéraires et des adresses

Document technique pour le PRD (`PRD.md`, M3, M4, M5, M8, questions Q1, Q2, Q3, Q5, Q10, Q12), à lire avec `review-tech.md`, `review-ux.md` et `flows.md`. Rédigé le 10/11/2026 sur l’instantané réel des données (dates de service mardi 10/11 et mercredi 11/11, jour férié). Prototype : `/home/claude/routing-proto/` (aucun fichier de l’appli modifié).

## En bref

- Le pipeline publie en plus, chaque nuit, un fichier par ligne urbaine (2 759 lignes STIB, De Lijn et TEC : motifs, profils horaires par voyage, voyages des deux jours, positions, correspondances proches), un index des lignes et des « tuiles de lignes ». Mesure sur les vraies données : 28 Mo bruts, 8,3 Mo en gzip, environ 3 Ko gzip par ligne.
- Le téléphone charge, en trois vagues parallèles, les lignes qui passent près du départ et de l’arrivée, puis au plus 10 « lignes du milieu » choisies par une estimation, plus `trains/{date}.json` (déjà utilisé). Il calcule ensuite un RAPTOR par rondes (3 véhicules au plus) sur ce petit réseau, avec marches calculées à partir des coordonnées.
- Prototype sur 24 requêtes réelles (dont les 10 demandées et les cas réels du PRD) : propositions plausibles, cas F, G, H, CA-M5.8 et CA-M8.4 du PRD conformes. 490 Ko à 1,15 Mo gzip à froid (dont 412 Ko pour le fichier des trains du jour), 60 à 520 Ko quand les trains sont en cache ; temps estimé sur téléphone 1,1 à 2,0 s.
- Validation contre le réseau belge complet (toutes les lignes et tous les trains) sur 2 × 300 paires tirées au hasard : mêmes meilleures arrivées pour 1, 2 et 3 véhicules dans 98,9 à 99,6 % des cas, même « Le plus simple » dans 99,6 à 100 % des cas.
- Le classement suit le PRD § 4. Le prototype a fait apparaître quatre précisions nécessaires (égalité de marche non transitive, garde-fou des 30 min différent de jour et de nuit, fenêtre des propositions, borne de « Moins de changements ») : § 4.8.
- Adresses : nouveau point d’entrée `GET /api/geocode` sur le relais (les services officiels ne sont pas tous joignables depuis la WebView : le service flamand ne gère pas CORS). Sources : Digitaal Vlaanderen (Geolocation v4), Paradigm (géocodage du registre bruxellois, CC0), SPW (ICAR `geocodeWS`). Seul le texte tapé part du téléphone. Google reste une option désactivée.
- Constat utile pour la 1.0 : l’arrivée d’une étape urbaine est estimée avec les décalages du premier voyage du motif (`patterns.next`) ; l’écart avec l’horaire réel du voyage atteint 3 min ou plus pour 32 % des trajets STIB (16 % De Lijn, 10 % TEC). Les profils par voyage des fichiers de ligne corrigent ce défaut.

## 1. Point de départ et contraintes

**La 1.0** (`app/src/core/plan.ts`) combine des lignes urbaines directes (`patterns.next` des fichiers de zone), des trains direct ou à une correspondance (balayage des connexions sur `trains/{date}.json`) et au mieux une ligne urbaine avant ou après le train. Elle ne sait pas changer entre deux lignes urbaines, ni faire deux correspondances en train (`review-tech.md` M2 : Namur vers Saint-Nicolas par Lille), choisit mal les gares (B1), n’a pas de borne d’attente (M3), propose des trains où la montée est interdite (M1). Les fichiers de zone ne suffisent pas à un vrai calcul : une zone ne connaît que ses propres départs, `next` est limité à 60 zones sans coordonnées, avec les décalages du premier voyage du motif seulement, et la STIB n’a pas de `trip_id` dans `deps`.

**Contraintes** : 0 € ; fichiers statiques sur GitHub Pages (HTTP/2, gzip, 1 Go au plus, 406 Mo publiés aujourd’hui) ; relais Vercel Hobby ; calcul sur le téléphone ; réponse en 2 à 4 s sur réseau mobile ; moins de 3 Mo par recherche, en cache pour la journée.

**Portée du PRD** : 3 véhicules au plus ; au plus une correspondance entre deux lignes urbaines (§ 7, « Plus d’une correspondance entre lignes urbaines » hors périmètre) ; deux correspondances possibles en train (M5c). La conception ci-dessous couvre le cas général (deux correspondances urbaines) par un simple réglage, mesuré au § 5.4.

## 2. Choix de conception

| Option | Octets par recherche | Exactitude | Verdict |
|---|---|---|---|
| Réseau complet sur le téléphone | 8,3 Mo gzip de lignes + 0,4 Mo de trains, 110 000 voyages à indexer | exacte | trop lourd chaque jour sur mobile |
| Découpage régional (un paquet par région ou province) | 1 à 2 Mo par paquet, deux paquets par trajet, lignes en double aux frontières | exacte dans les paquets | lourd à froid, peu de réutilisation |
| Calcul sur le relais | quelques Ko | exacte | contraire au principe « logique sur le téléphone », limites Vercel Hobby (durée, mémoire), démarrage à froid, charge du réseau complet à chaque instance |
| **Fichiers de ligne, sélection, RAPTOR local (retenu)** | 0,5 à 1,2 Mo à froid, 0,06 à 0,5 Mo trains en cache | 98,9 à 99,6 % identique au réseau complet | retenu |

RAPTOR (calcul par rondes : ronde k = meilleure arrivée avec k véhicules) donne directement les compromis « moins de changements » contre « arrivée plus tôt » demandés par le PRD, borne naturellement le nombre de véhicules, et s’exécute en millisecondes sur un réseau de quelques milliers de zones. Les trains entrent dans le même calcul (motifs construits à partir de `trains/{date}.json`), ce qui remplace le balayage à une correspondance de la 1.0 pour `plan()`.

## 3. Données produites chaque nuit

Ajouts seulement : aucun fichier 1.0 ne change de format (une appli 1.0 continue de fonctionner). Les formats ci-dessous sont à ajouter à `shared/types.ts`.

### 3.1 Fichier de ligne : `lines/{op}/{routeKey}.json`

Un fichier par ligne GTFS (`route_id`) de la STIB, de De Lijn et du TEC, toutes directions, voyages des deux dates de service. `routeKey` = `route_id` normalisé, caractères hors `[A-Za-z0-9_-]` remplacés par `_` (comme `fileKey`).

```ts
/** DATA_BASE/lines/{op}/{routeKey}.json */
export interface LineFile {
  v: 1;
  id: string;            // `${op}:${route_id}`, ex. 'tec:L0149-21069'
  op: Exclude<Op, 'sncb'>;
  route: string;         // route_id normalisé (alertes)
  line: string;          // nom court, ex. '149'
  mode: Mode;
  /** Zones desservies : [AreaSummary.id, lat, lon, noms]. Coordonnées = celles de la zone (5 décimales). */
  areas: [id: string, lat: number, lon: number, n: Names][];
  pats: {
    head: Names;         // destination mise en forme
    a: number[];         // zones du motif, dans l'ordre (indices dans areas ; une zone peut revenir dans une boucle)
    s: string[];         // arrêt physique par position, identifiant temps réel (rt) ; '' si descente seule
    /** Autorisations par position : b montée seule, a descente seule, x les deux, n aucune.
     *  Absent = 'b' puis 'x'… puis 'a' (premier arrêt montée seule, dernier descente seule). */
    f?: string;
    /** Profils : minutes depuis le départ du premier arrêt, une valeur par position (départ ; arrivée au dernier). */
    prof: number[][];
    /** Voyages triés par (jour, départ) : [jour 0|1, départ du 1er arrêt en minutes (peut dépasser 1440),
     *  profil (indice dans prof), rang du trip_id dans trips (absent pour la STIB)]. */
    t: number[][];
  }[];
  /** Correspondances : pour chaque zone de areas, numéros (LineIndex) des autres lignes à moins de
   *  LineIndex.conn mètres. Réduit aux bornes de chaque tronçon commun (deux lignes parallèles sur dix arrêts
   *  ne sont listées qu'au premier et au dernier). */
  conn: number[][];
  /** trip_id normalisés, pour /api/rt (De Lijn, TEC). Absent pour la STIB (temps réel par pointid). */
  trips?: string[];
}
```

Règles de production :
- Motif = (ligne, direction, destination, suite des zones, autorisations). Deux arrêts consécutifs dans la même zone donnent une seule position (première arrivée, dernier départ).
- Autorisations : `pickup_type = 1` interdit la montée, `drop_off_type = 1` la descente (corrige à la source M1 pour les lignes urbaines).
- Profils : un voyage = heure de départ + profil ; les profils identiques sont partagés (sur les vraies données : 8 860 motifs, 105 000 voyages sur deux jours). Les horaires de chaque voyage sont exacts, contrairement à `patterns.next`.
- Exemple réel (abrégé) : ligne TEC 149 Antheit vers Huy, 6 motifs, `t` = `[[0,385,0,12],[0,427,1,13],…]`.

### 3.2 Index des lignes : `lines/index.json`

```ts
/** DATA_BASE/lines/index.json : numérotation des lignes de la nuit (les numéros changent d'une nuit à l'autre ;
 *  tous les fichiers d'une même génération sont cohérents). */
export interface LineIndex {
  v: 1;
  conn: number;                                        // rayon des correspondances, 400 m
  lines: [key: string, line: string, mode: Mode, patterns: number][]; // numéro = rang dans ce tableau
  stations: Record<string, number[]>;                  // gare SNCB (AreaSummary.id) → lignes à moins de `conn` m
}
```

### 3.3 Tuiles de lignes : `linetiles/{ty}_{tx}.json`

Même découpage que `tiles/` (0,02° × 0,03°). Pour chaque zone urbaine de la tuile, les lignes qui la desservent (montée ou descente) : `{ v: 1, a: { "stib:1317": [12, 40, 41] } }`. Permet de trouver les lignes autour d’un point sans charger les fichiers de zone (jusqu’à 567 Ko pour une zone De Lijn).

### 3.4 Trains

Pas de nouveau fichier : `trains/{date}.json` sert tel quel, avec le correctif M1 de `review-tech.md` (montée interdite : départ à -1 ; descente interdite : arrivée à -1). Le prototype l’émule à partir des fichiers de zone SNCB (`deps` = montée permise, `next` = descente permise) : sans lui, Liège-Guillemins vers Bruxelles-Nord le 11/11 à 09:10 propose le Nightjet de 09:21 (dépose seule) ; avec lui, l’IC de 09:27 (§ 5.2, n° 23).

### 3.5 Marches

Aucun fichier : le téléphone calcule les marches entre toutes les zones du petit réseau (grille de 400 m, `walkMinutes()` de `util.ts`), puisque chaque fichier de ligne donne les coordonnées de ses zones et `trains/` celles des gares. Les listes `conn` du pipeline utilisent le même rayon (400 m) et la même distance.

### 3.6 Tailles mesurées (instantané réel, gzip niveau 6 comme GitHub Pages)

| Fichiers | Nombre | Brut | gzip | Par fichier (gzip) |
|---|---|---|---|---|
| `lines/stib/` | 74 | 0,95 Mo | 0,23 Mo | médiane 3,1 Ko, max 5,2 Ko |
| `lines/delijn/` | 1 854 | 16,7 Mo | 5,3 Mo | médiane 1,8 Ko, 90 % sous 5,8 Ko, max 16,9 Ko |
| `lines/tec/` | 831 | 9,1 Mo | 2,1 Mo | médiane 2,1 Ko, 90 % sous 4,2 Ko, max 8,7 Ko |
| `lines/index.json` | 1 | 0,12 Mo | 26 Ko | |
| `linetiles/` | 5 212 | 1,3 Mo | 0,62 Mo | 0,1 Ko |
| **Total ajouté** | 7 972 | **28,1 Mo** | **8,3 Mo** | |

Site publié : 406 Mo + 28 Mo = 434 Mo (limite 1 Go ; l’objectif de 400 Mo est déjà dépassé, R15). Les `trip_id` De Lijn pèsent 48 % des octets gzip des lignes De Lijn (20 % au TEC) ; le raccourcissement proposé par `review-tech.md` m8 (10 caractères du suffixe, même règle dans le relais) les réduit d’autant et ramène le site sous 400 Mo. Les listes `conn` pèsent 5 à 8 %.

### 3.7 Production dans le pipeline

- `feed.ts`, après l’étape 10 (formes) : pour chaque voyage valide, suite des zones, heures, autorisations ; motifs, profils, voyages des deux jours ; garder en mémoire les lignes de l’opérateur (au plus quelques dizaines de Mo).
- `build.ts`, après tous les opérateurs : numérotation globale des lignes, lignes par zone, grille spatiale de toutes les zones, `conn` (400 m, bornes des tronçons communs), `stations` (lignes autour de chaque gare de `trains/`), écriture de `lines/`, `lines/index.json`, `linetiles/`, rapport de taille.
- Durée mesurée par le prototype (à partir des fichiers de zone, plus coûteux que depuis le GTFS) : 12 s pour les trois réseaux ; mémoire sous 3 Go. Un réseau en échec n’a simplement pas de fichiers de ligne (les tuiles de lignes ne les annoncent pas).

## 4. Calcul sur le téléphone

### 4.1 Vagues de chargement

| Vague | Fichiers (en parallèle, HTTP/2) | Mesure sur 24 requêtes |
|---|---|---|
| 1 | `lines/index.json` (cache du jour) ; `tiles/` et `linetiles/` autour de O et D | 15 à 25 petits fichiers |
| 2 | lignes L_O et L_D ; `trains/{jour 0}.json` (cache du jour), `trains/{jour 1}.json` si l’heure demandée est après 20:00 ou si rien n’est trouvé | 15 à 110 lignes, 25 à 470 Ko, plus 412 Ko de trains |
| 3 | lignes du milieu (10 au plus) | 20 à 75 Ko |
| 4 | temps réel des propositions (`/api/rt`, `/api/stib`, comme en 1.0) | 1 à 3 appels |

### 4.2 Extrémités, accès et sortie

- Extrémités : « Ma position », un lieu, une zone (arrêt ou gare), une adresse (nouvelle extrémité, § 7).
- Accès et sortie : toute zone du petit réseau à `maxWalkMin` (passe A), à 1,5 × `maxWalkMin` pour une zone urbaine et 2 × `maxWalkMin` pour une gare (passe B, « longues marches »), à 5 min (passe C, « peu de marche »). Une extrémité qui est une zone compte 0 min. Les gares voisines sont toujours candidates (corrige B1).
- Départ et arrivée à moins de 100 m : rien ; arrivée à `maxWalkMin` à pied ou moins : marche seule (règles 1.0).

### 4.3 Lignes L_O et L_D

Zones urbaines à 1,5 × `maxWalkMin` de O (de D), de la plus proche à la plus lointaine ; leurs lignes (`linetiles/`) dans cet ordre, 60 au plus par côté. Sur les 24 requêtes : L_O de 3 à 47 lignes, L_D de 11 à 60 (les grandes gares atteignent le plafond).

### 4.4 Lignes du milieu

Elles servent aux trajets à trois véhicules dont le véhicule du milieu n’est ni une ligne de O, ni une ligne de D, ni un train. En portée PRD (une correspondance urbaine au plus) : urbain, urbain, train et train, urbain, urbain.
1. Estimations le long de L_O : pour chaque zone aval d’une montée possible, `eO` = marche jusqu’à la montée + 5 min d’attente + trajet selon le premier profil ; de même `eD` vers D le long de L_D (zones amont d’une descente).
2. Gares côté D : à 2 × `maxWalkMin` de D, ou à moins de 400 m d’une zone de L_D ; durée vers D = marche, ou `eD` + marche + 2 min. Gares côté O, de même. Durées réelles des trains directs (fichier `trains/` déjà chargé) : `trainTo(X)` = meilleure durée d’un train direct de X vers une gare côté D, `trainFrom(X)` depuis une gare côté O.
3. Candidats : une ligne M de `conn` d’une zone aval de L_O et de `stations[X]` pour une gare X avec `trainTo(X)` (urbain, M, train) ; une ligne M de `conn` d’une zone amont de L_D et de `stations[X]` avec `trainFrom(X)` (train, M, urbain). Si deux correspondances urbaines sont permises : M dans `conn` d’une zone de L_O et d’une zone de L_D (urbain, M, urbain).
4. Coût estimé = temps estimé jusqu’à M + trajet sur M (distance × 1,3 à 18 km/h en bus et tram, 30 en métro) + temps estimé depuis M + 4 min. Les K meilleures sont chargées (K = 10 ; quotas 60 % urbain, M, urbain et 40 % gares quand les deux sont permis).

Une première version qui estimait le train par une vitesse forfaitaire, sans vérifier qu’un train direct existait, remplissait la liste de fausses pistes (Liège : 15 lignes « vers une gare » sur 20, la bonne ligne au 28e rang) : les durées réelles des trains sont indispensables.

### 4.5 Réseau du calcul

- Zones : celles des fichiers de ligne chargés, plus toutes les gares de `trains/`.
- Motifs : ceux des fichiers de ligne ; trains groupés par suite de gares et d’autorisations (591 motifs pour les 3 773 trains du 10/11), voyages triés par départ, contrôle FIFO par motif (recherche dichotomique, sinon parcours).
- Correspondances : même zone urbaine 2 min ; même gare 4 min (règle 1.0) ; à pied (moins de 400 m) `walkMinutes(d)` plus 1 min vers une zone urbaine, plus 3 min vers une gare (trouver le quai).
- Taille mesurée sur les 24 requêtes : 1 100 à 2 700 zones, 700 à 1 300 motifs.

### 4.6 RAPTOR par rondes, sur une plage de départs

- Rondes 1 à 3 (véhicules). Étiquette par ronde et par zone : arrivée en véhicule (pour la descente et la destination) et heure à laquelle on peut monter (correspondance comprise). Élagage par la meilleure arrivée à destination avec au plus k véhicules et par la meilleure arrivée à la zone avec au plus k véhicules.
- Plage de départs (« range RAPTOR ») : on parcourt, du plus tard au plus tôt, les départs possibles dans l’heure qui suit l’heure demandée (premiers véhicules aux zones d’accès), en gardant les étiquettes : on obtient tous les compromis (départ plus tard, arrivée plus tôt, moins de véhicules).
- Trois passes (accès et sortie A, B, C du § 4.2) sur le même réseau : les alternatives « moins de marche » et « longue marche mais direct » existent ainsi toutes les deux, sans recherche multicritère coûteuse.
- Correspondances urbaines : un compteur dans l’étiquette refuse, à la ronde 3, une troisième ligne urbaine après deux lignes urbaines (portée PRD) ; réglage `urbanUrbanMax` (1 en 1.1, 2 pour le cas général).
- Nuit et service rare : si aucun trajet n’a d’attente acceptable, plage de départs étendue à 12 h ; si toujours rien, recalcul à partir de 04:00 du jour suivant couvert. Exemples : 23:10 De Brouckère vers Namur (dernier train à 22:37 : IC de 06:07 le 11/11), 23:50 Maison vers Bureau (IC de 05:16 le 11/11).
- Reconstitution : remontée des étiquettes ; une étape porte les arrêts intermédiaires et leurs heures (écran « Dans le bus » possible pour l’urbain), le `trip_id` (SNCB, De Lijn, TEC) ou le pointid (STIB) pour le temps réel.
- Calcul mesuré (analyse JSON comprise, machine de développement) : 30 à 180 ms pour les trois passes ; estimé 0,1 à 0,7 s sur un téléphone 4 fois plus lent.

### 4.7 Garde-fous (PRD § 4.2)

- Départ du premier véhicule moins la marche : au plus tôt maintenant ; montée et descente seulement là où elles sont permises (`f` et correctif M1).
- Attente en correspondance : 60 min au plus.
- Jamais une correspondance qui ne fait gagner que moins de 5 min sur le même premier véhicule (`review-tech.md` m6).
- Jamais un trajet en véhicule plus lent que d’y aller à pied (règle 1.0, jusqu’à 60 min de marche) ; la marche seule est une proposition jusqu’à 30 min.
- Véhicule supprimé (temps réel) : trajet écarté.

### 4.8 Classement et étiquettes (PRD § 4.1 et § 4.3)

Le cœur applique les règles du PRD : changements (chaque marche de 1,5 × `maxWalkMin` ou plus compte pour un changement), puis marche totale (moins de 5 min d’écart : égalité), puis arrivée, puis moins de véhicules et départ le plus tard ; garde-fou des 30 min ; propositions dans l’ordre simple, rapide ou « Plus tôt », « Sans changement » ou « Moins de changements », « À pied », « Le suivant », « Plus tard ». Les cas A à E du PRD sont vérifiés par `rank-cases.ts`, les cas F, G, H et CA-M5.8, CA-M8.1, CA-M8.4 sur les vraies données (§ 5.2).

Le prototype a montré quatre précisions nécessaires, à valider avec le responsable produit (Q5) :
1. **Égalité de marche lue de façon séquentielle.** « Moins de 5 min d’écart : égalité » n’est pas transitive : Gand Korenmarkt vers Bruges à 10:00, ancrer l’égalité sur la marche minimale (4 min) choisissait un trajet arrivant 26 min plus tard pour 2 min de marche en moins. Règle retenue : partir du trajet qui arrive le plus tôt et ne le remplacer que par un trajet avec moins de changements, ou autant de changements et au moins 5 min de marche en moins. Les cas A à H restent conformes.
2. **Garde-fou des 30 min, de jour et de nuit.** De jour (un départ possible dans l’heure demandée) : « Le plus simple » n’arrive jamais plus de 30 min après le plus rapide de l’heure (sinon, à Gand, le bus de 10:46 battait le tram de 10:10). La nuit (aucun départ dans l’heure) : comparaison avec les seuls trajets qui ne partent pas plus de 30 min plus tôt, sans quoi le cas G (S1 de 06:20 direct) serait remplacé par un trajet à deux correspondances parti à 05:02.
3. **Fenêtre des propositions.** Départs dans l’heure demandée ; la nuit, jusqu’à 90 min après le premier départ possible ; « Le suivant » et « Plus tard » au plus 2 h après (sinon un métro direct de 15:18 apparaissait pour une recherche à 08:00).
4. **Borne de « Moins de changements ».** Au plus max(45 min, moitié de la durée du trajet simple) après lui : sans borne, Namur vers Saint-Nicolas proposait encore le trajet par Lille (4 h 20). « Le suivant » d’un train : mêmes gares et même catégorie (pas la même destination affichée).

Observation à trancher (pas un défaut) : Uccle Fort-Jaco vers Evere à 12:00, « Le plus simple » est T92 puis bus R81 (arrivée 13:20, 3 min à pied) et « Le plus rapide » 13 min à pied, S9 puis R81 (12:50) : la règle « moins de marche » l’emporte tant que l’écart reste sous 30 min.

### 4.9 Temps réel

1. Classement sur les horaires prévus, puis temps réel (fonctions 1.0 de `journeys.ts`) sur les trois propositions et trois réserves, en un appel `/api/rt` par opérateur (60 voyages au plus) et un `/api/stib` (30 points au plus). Les pointid STIB et les `trip_id` viennent des fichiers de ligne : plus besoin de charger le fichier de zone de montée.
2. Véhicule supprimé : trajet retiré, une réserve monte. Correspondance rendue impossible par un retard (marge estimée négative) : recalcul du reste du trajet depuis la zone de correspondance à l’heure estimée, sur le petit réseau déjà en mémoire (quelques ms), avec l’alerte « Correspondance recalculée ».
3. Reclassement sur les heures estimées (PRD § 4.5) à chaque calcul, jamais pendant l’affichage d’un trajet.
4. Relais lent : affichage sur l’horaire prévu après 1,5 s, fusion du temps réel au rafraîchissement suivant (`review-tech.md` M10).

### 4.10 Budget de téléchargement, cache et temps de réponse

- Mesuré à froid : 490 Ko à 1,15 Mo gzip, 40 à 135 fichiers, 3 vagues ; avec les trains et l’index en cache (deuxième recherche de la journée) : 60 à 520 Ko.
- Cache : fichiers de ligne et tuiles par génération de données (comme la 1.0) ; budget du cache persistant à revoir (`review-tech.md` M9) : un fichier de ligne fait au plus 70 Ko bruts et tient dans les emplacements actuels ; `trains/` (1,65 Mo) doit passer par un budget plus grand ou par le cache HTTP.
- Temps estimé sur téléphone = 4 vagues × 150 ms + octets / 1,25 Mo/s (10 Mbit/s) + (analyse + calcul) × 4 : 1,1 à 2,0 s à froid, 0,8 à 1,5 s ensuite. Cible PRD tenue (CA-M5.7 : 2 s sur la machine de développement ; budget réel proposé : 4 s à froid, 2 s en cache, mesure sur Quai Web avant publication).

## 5. Prototype et résultats sur les vraies données

### 5.1 Ce qui a été construit

- `gen.ts` : reconstitue les voyages depuis les fichiers de zone réels (De Lijn et TEC par `trip_id` et `stop_sequence` ; STIB par chaînage des départs de même ligne et même destination à l’heure attendue, 30 133 voyages retrouvés pour 29 994 attendus), écrit `out/lines/`, `out/lines/index.json`, `out/linetiles/` et mesure les tailles. Le vrai pipeline partira du GTFS (horaires exacts partout).
- `trainflags.ts` : autorisations de montée et de descente des trains (émulation de M1).
- `router.ts` : vagues, sélection des lignes, réseau, RAPTOR par rondes et par plage de départs, trois passes, règle urbaine, classement du PRD ; « réseau » simulé qui compte fichiers, octets bruts et gzip, et vagues.
- `run-queries.ts` (24 requêtes), `oracle.ts` (comparaison avec le réseau complet), `rank-cases.ts` (cas A à E), `v10error.mjs` (écart des estimations 1.0), `geo/l72.mjs` (conversion Lambert 72).

### 5.2 Requêtes de validation (mardi 10/11/2026 sauf mention, marche maximale 10 min, horaires prévus)

| # | Requête | Propositions (départ à pied → arrivée) | Contrôle |
|---|---|---|---|
| 1 | Waterloo centre (50.7150, 4.3990) → bureau près de Bruxelles-Central (50.8441, 4.3474), 07:45 | Le plus simple 07:48 → 08:58 : bus TEC W 07:53, tram STIB 4 08:51, 10 min à pied. Le plus rapide 07:52 → 08:46 : 18 min à pied, S1 08:10 → Bruxelles-Midi, tram 10. Plus tard 07:55 → 09:03 : bus 365a, tram 4 | conforme au cas H et à CA-M3.5 |
| 2 | Namur centre (place d’Armes) → quartier Nord (50.8580, 4.3580), 07:30 | Le plus simple 07:31 → 08:51 : IC 07:44 Namur → Bruxelles-Nord, 13 + 5 min à pied. Le suivant : IC 08:16. Plus tard : P 08:37 | IC de 62 min, plausible |
| 3 | Ixelles Flagey → point donné (50.8607, 4.3815), 12:00 | Le plus simple 12:07 → 12:33 : bus 59 jusqu’à Côteaux, 6 min à pied ; le suivant 12:18 | le point donné est à 1,2 km au sud de la place Verboekhoven |
| 3b | Flagey → arrêt Verboekhoven (50.8712, 4.3759), 12:00 | bus 59 direct 12:08 → 12:34 | plausible |
| 4 | Gand Korenmarkt → gare de Bruges, 10:00 | Le plus simple 10:10 → 11:01 : 8 min à pied, T1 Koophandelsplein → Gand-Saint-Pierre, IC 10:39. Le suivant 11:00. Plus tard : bus 10, IC par Gand-Dampoort | Korenmarkt n’est pas desservi par le T1 ; IC Gand → Bruges en 22 min |
| 5 | Liège centre (50.6410, 5.5735) → Bruxelles-Luxembourg, 08:00 | Le plus simple 08:02 → 10:03 : IC 08:13 Liège-Saint-Lambert → Namur, IC 09:16 → Luxembourg. Le plus rapide 08:06 → 09:40 : tram T1, IC 08:25 → Bruxelles-Nord, S8. Sans changement 08:30 → 10:32 : IC 08:41 | deux correspondances en train, plausibles |
| 6 | Louvain-la-Neuve centre → gare d’Ottignies, 17:30 | S8 17:41 → 17:48 ; le suivant 18:01 ; bus TEC 11 17:41 | plausible |
| 7 | Anvers Groenplaats → Brussels Airport, 09:00 | Le plus simple 09:02 → 09:49 : tram 11 → Anvers-Central, EC 09:19 → aéroport ; le suivant 10:02 | 30 min Anvers → aéroport, plausible |
| 8 | Charleroi Ville-Haute → Mons Grand-Place, 18:00 | 18:00 → 18:55 : 13 min à pied, IC 18:13 → Mons, 11 min à pied ; le suivant IC 18:46 | les bus d’Eden finissent à Palais ; le métro à 7 min ne permet pas l’IC de 18:13 |
| 9 | Village : Mettet → Namur centre, 07:15 | bus TEC E86 07:32 → Namur gare, 12 min à pied (arrivée 08:24) ; le suivant 07:39 | plausible |
| 10 | Soir : De Brouckère → Namur centre, 23:10 | IC 06:07 le 11/11 (férié), arrivée 07:26 | dernier train Bruxelles-Central → Namur à 22:37 (vérifié dans `trains/`) |
| 11 | Village : Lo → Ypres Grote Markt, 08:00 | bus De Lijn 50 08:38 → Plumerlaan, 12 min à pied (09:17) | plausible |
| 12 | Soir : Flagey → point Verboekhoven, 23:45 | bus 59 23:59 → 00:21 ; le suivant 00:14 | service au-delà de 24:00 pris en compte |
| 13 | Schuman → Louvain-la-Neuve, 08:30 | Le plus simple S8 08:38 direct (09:27) ; Le plus rapide métro 5 → Delta, bus TEC E11 (09:20) | plausible |
| 14 | Village : Bièvre → Bertrix, 07:00 | Le plus simple bus 66 07:41 direct (08:16) ; Plus tôt bus 44 07:05 puis bus 8 (07:53) | conforme à l’étiquette « Plus tôt » |
| 15 | Soir : De Brouckère → Gand Korenmarkt, 23:10 | 11 min à pied, IC 23:43 → Gand-Saint-Pierre, T1 00:27 (00:46) | plausible |
| 16 | Uccle Fort-Jaco → Evere Paduwa, 12:00 | Le plus simple T92 12:15, bus R81 (13:20) ; Le plus rapide 13 min à pied, S9, R81 (12:50) | correspondance urbaine (M5b) ; voir § 4.8 |
| 17 | Anderlecht Westland → Woluwe Roodebeek, 08:00 | métro 5 → Gare de l’Ouest, métro 1 (08:44) | plausible |
| 18 | Village : Kortemark → Torhout, 09:00 | bus De Lijn 91 09:04 direct (09:18) | plausible |
| 19 | PRD cas F : Maison (50.4655, 4.8590) → Bureau, 07:31 | Le plus simple : 8 min à pied, IC 07:44 → Bruxelles-Central, 12 min à pied (09:04). Le plus rapide : IC → Bruxelles-Luxembourg, bus 95 (08:56). Le suivant IC 08:16 | conforme à CA-M8.1 (jamais Bruxelles-Chapelle) |
| 20 | PRD CA-M8.1 : même trajet à 23:50 | IC 05:16 le 11/11 (06:35) | une proposition pour le lendemain |
| 21 | PRD cas G : gare de Waterloo → Bruxelles-Midi, 23:50 | Le plus simple S1 06:20 direct (06:46) ; Plus tôt S19 05:02 puis bus 95 et métro 2 (06:06) | conforme au cas G |
| 22 | PRD CA-M5.8 : Namur → Saint-Nicolas, 07:45 | IC 08:16 → Bruxelles-Nord, IC → Termonde, S34 (10:32) ; le suivant 09:16 | par Bruxelles, plus par Lille (4 h 20 en 1.0) |
| 23 | PRD CA-M8.4 : Liège-Guillemins → Bruxelles-Nord, 11/11 09:10 | IC 09:27 (10:35) ; IC 10:00 | pas de Nightjet (avec autorisations) |

### 5.3 Octets, fichiers et temps par requête

Lignes L_O / L_D / milieu ; « en cache » = sans trains ni index ; temps estimé selon § 4.10.

| # | Fichiers | Ko gzip à froid | Ko gzip en cache | Lignes | Analyse + calcul (ms) | Téléphone à froid | En cache |
|---|---|---|---|---|---|---|---|
| 1 | 64 | 584 | 155 | 12 / 24 / 10 | 177 | 1,8 s | 1,4 s |
| 2 | 135 | 882 | 453 | 47 / 60 / 10 | 134 | 1,9 s | 1,5 s |
| 3 | 55 | 590 | 162 | 10 / 18 / 10 | 77 | 1,4 s | 1,0 s |
| 3b | 53 | 572 | 143 | 10 / 18 / 10 | 65 | 1,3 s | 1,0 s |
| 4 | 127 | 948 | 519 | 39 / 60 / 10 | 72 | 1,7 s | 1,3 s |
| 5 | 87 | 702 | 273 | 40 / 19 / 10 | 103 | 1,6 s | 1,2 s |
| 6 | 50 | 509 | 81 | 16 / 12 / 10 | 36 | 1,2 s | 0,8 s |
| 7 | 72 | 814 | 385 | 25 / 19 / 10 | 51 | 1,5 s | 1,1 s |
| 8 | 106 | 691 | 263 | 43 / 35 / 10 | 87 | 1,5 s | 1,2 s |
| 9 | 77 | 594 | 166 | 6 / 47 / 10 | 42 | 1,3 s | 0,9 s |
| 10 | 119 | 1 022 | 351 | 43 / 47 / 10 | 110 | 1,9 s | 1,3 s |
| 11 | 54 | 513 | 84 | 8 / 24 / 10 | 32 | 1,1 s | 0,8 s |
| 12 | 56 | 833 | 162 | 10 / 18 / 10 | 65 | 1,5 s | 1,0 s |
| 13 | 71 | 600 | 171 | 27 / 16 / 10 | 106 | 1,5 s | 1,2 s |
| 14 | 40 | 492 | 63 | 3 / 12 / 10 | 30 | 1,1 s | 0,8 s |
| 15 | 111 | 1 151 | 480 | 43 / 39 / 10 | 105 | 2,0 s | 1,4 s |
| 16 | 51 | 575 | 146 | 10 / 13 / 10 | 65 | 1,3 s | 1,0 s |
| 17 | 67 | 651 | 222 | 29 / 11 / 10 | 91 | 1,5 s | 1,1 s |
| 18 | 59 | 563 | 134 | 14 / 24 / 10 | 43 | 1,2 s | 0,9 s |
| 19 | 99 | 697 | 268 | 47 / 24 / 10 | 87 | 1,5 s | 1,2 s |
| 20 | 100 | 939 | 268 | 47 / 24 / 10 | 71 | 1,7 s | 1,1 s |
| 21 | 64 | 880 | 209 | 3 / 32 / 10 | 51 | 1,5 s | 1,0 s |
| 22 | 107 | 708 | 280 | 47 / 36 / 10 | 104 | 1,6 s | 1,2 s |
| 23 | 107 | 1 076 | 405 | 21 / 57 / 10 | 92 | 1,8 s | 1,3 s |

Les requêtes du soir chargent aussi `trains/` du lendemain (248 Ko gzip le 11/11). Le fichier des trains du jour (412 Ko gzip) est le plus gros poste ; il est déjà chargé par la 1.0.

### 5.4 Exactitude contre le réseau complet

`oracle.ts` tire des paires O-D au hasard autour de neuf villes (35 % entre deux villes) à cinq heures de la journée, puis compare le petit réseau au réseau complet (2 759 lignes et tous les trains, mêmes règles) : meilleure arrivée avec 1, 2 et 3 véhicules, et proposition « Le plus simple ». Sur 300 paires, 262 comparables (les autres : marche plus rapide, aucun arrêt à distance de marche, aucun service).

| Configuration | Meilleures arrivées identiques | « Le plus simple » identique | Ko gzip à froid, moyenne (max) | Fichiers |
|---|---|---|---|---|
| Portée PRD (1 correspondance urbaine), sans ligne du milieu | 257/262 (98,1 %) | 261/262 | 636 (1 078) | 51 |
| **Portée PRD, K = 10 (retenu)** | **259/262 (98,9 %)** | **261/262 (99,6 %)** | **673 (1 126)** | **61** |
| Cas général (2 correspondances urbaines), sans ligne du milieu | 246/262 (93,9 %) | 260/262 | 636 (1 078) | 51 |
| Cas général, K = 10 | 260/262 (99,2 %) | 262/262 | 675 (1 126) | 61 |
| Cas général, K = 20 | 261/262 (99,6 %) | 262/262 | 712 (1 167) | 71 |

Deuxième tirage (300 paires, cas général, K = 20) : 267/270 (98,9 %) et « Le plus simple » 270/270. Les écarts restants vont de 1 à 7 min, toujours sur des trajets à trois véhicules en ville dense.

### 5.5 Constats

- Les estimations 1.0 des étapes urbaines (décalages du premier voyage du motif) s’écartent de l’horaire réel du voyage de 3 min ou plus pour 32 % des trajets STIB (5 min ou plus : 15 %), 16 % De Lijn, 10 % TEC (`v10error.mjs`, 3,6 millions de trajets échantillonnés).
- Le point « Schaerbeek Verboekhoven » fourni (50.8607, 4.3815) est à 1,2 km de l’arrêt ; « Fort-Jaco » doit être pris à l’arrêt (50.7894, 4.3740). Les jeux de contrôle doivent donner des positions vérifiées.
- Le nouveau tram de Liège (T1) et le tram STIB 10 sont présents et utilisés ; le 11/11 (horaire de jour férié) est bien appliqué.
- Sans autorisations de montée dans `trains/`, le calcul propose le Nightjet (M1 est donc un prérequis de M3).

## 6. Adresses (géocodage)

### 6.1 Services officiels étudiés

| Région | Service, adresse et paramètres | Réponse | CORS, licence, limites |
|---|---|---|---|
| Flandre | Digitaal Vlaanderen, Geolocation Service v4 : `https://geo.api.vlaanderen.be/geolocation/v4/Location?q={texte}&c={1..5}&type={Municipality|Thoroughfarename|Housenumber}` (et `latlon` pour l’inverse) ; `v4/Suggestion?q=&c={jusqu’à 25}` donne seulement des chaînes ([aide v4](https://geo.api.vlaanderen.be/geolocation/Help/V4), [Location](https://geo.api.vlaanderen.be/geolocation/Help/Api/GET-v4-Location_q_latlon_xy_type_c), [Suggestion](https://geo.api.vlaanderen.be/geolocation/Help/Api/GET-v4-Suggestion_q_c), [présentation](https://www.vlaanderen.be/digitaal-vlaanderen/onze-oplossingen/geografische-webdiensten/ons-api-aanbod/geolocation-service)) | `LocationResult[]` : `Municipality`, `Zipcode`, `Thoroughfarename`, `Housenumber`, `ID`, `FormattedAddress` (« Trambergstraat 1, 3520 Zonhoven »), `Location.Lat_WGS84` / `Lon_WGS84`, `LocationType`, `BoundingBox` | CORS non pris en charge (page d’aide ; JSONP seulement) ; sans clé ; limites et conditions du service non publiées sur l’aide ; environnement de test `beta-vlaanderen` ; données : licence flamande de réutilisation gratuite (fiche BeST) |
| Bruxelles | Paradigm, « Geolocation service - Brussels address register » : `https://geoservices.irisnet.be/geocoding/api/v2/brussels/geocoding/freeSearch/searchAnyObject?searchLanguage={fr|nl}&freeText={texte}&model=BeStPlus` ; aussi `searchAddress` (`streetName`, `policeNumber`, `postalCode`, `municipality`), `searchStreetName`, `searchMunicipality`, `searchPlaceName`, inverse `geometricalSearch/searchAddress?x=&y=` ([Swagger](https://geoservices.irisnet.be/geocoding/swagger-ui/index.html), [OpenAPI](https://geoservices.irisnet.be/geocoding/v3/api-docs), [spécification](https://urbisdownload.datastore.brussels/Documentation/GeocodingAPI/V2/Geoloc/Geoloc_TechSpec_EN.pdf), [fiche](https://geobru-geonetwork.irisnet.be/geonetwork/srv/api/records/ddec077a-3285-11f1-afcf-00090ffe0001)) | `GeocodageSearchTypeV2` : `resultsList[].objectType`, `result[]` (`score`, `address`, `streetname`, `municipality`, `placeName`) ; position `position.pointGeometry.point.pos` avec `srsName` (EPSG:31370 selon la fiche : conversion nécessaire) | licence CC0, « pas de limitation d’accès public » ; mise à jour chaque semaine ; CORS et quotas non documentés ; ancien service UrbIS (`https://geoservices.irisnet.be/localization`) marqué « old » |
| Wallonie | SPW, « Service de géolocalisation ICAR » : `https://geoservices.wallonie.be/geocodeWS/searchAll?address={texte}&crs=EPSG:4326&geom=true&lang=fr&levels=1,2,3,4,7` ; aussi `/geocode` (structuré ou `address`, `nap=closest`), `/revgeocode`, `/parser`, `/geolist`, lots ([OpenAPI](https://geoservices.wallonie.be/geocodeWS/v3/api-docs), [FAQ](https://metawal.wallonie.be/geonetwork/srv/api/records/c79653b2-501b-4a91-9aa4-908a7cd5800e/attachments/FAQ_geocodeWS.pdf), [fiche](https://metawal.wallonie.be/geonetwork/srv/api/records/c79653b2-501b-4a91-9aa4-908a7cd5800e)) | `candidates[]` : `score`, `geotag` (`ident`, `level` : 1 commune, 2 zone d’adresse, 3 rue, 4 adresse, 5 et 6 routes régionales, 7 gare ; `name`, `lang`, `geometry` GeoJSON) ; `crs` par défaut EPSG:31370, 4326 accepté | « accès libre et gratuit pour tout public » ; conditions d’utilisation « en cours d’élaboration », proches de celles des services web du SPW ([conditions](https://geoportail.wallonie.be/files/documents/ConditionsSPW/LicServicesSPW.pdf)) ; données ICAR CC BY 4.0 ; paramètre `scopes` (WAL, BRU, VLA) présent dans l’OpenAPI, couverture hors Wallonie non documentée ; CORS et quotas non documentés |
| Fédéral | BeST Address (BOSA) : jeu complet en téléchargement et image Docker autonome `bosa/opendata-best-webapi` (PostgreSQL, 2 à 7 processeurs, 4 à 8 Go) ([Docker Hub](https://hub.docker.com/r/bosa/opendata-best-webapi), [points d’adresse](https://transportdata.be/dataset/address-points-belgium-best-address)) ; Paradigm annonce la couverture de toutes les adresses belges « dès la mi-novembre » ([annonce FOSS4G](https://be.brussels/en/about-region/structure-and-organisations/administrations-and-institutions-region/paradigm/paradigm-unveils-its-new-geocoding-api-foss4g)) | modèle BeST | pas de service public hébergé trouvé ; l’image ne tient pas sur Vercel Hobby ; données CC BY 4.0 (image) ou licences régionales (fiche transportdata.be) |

Contrôle fait : la conversion Lambert 72 vers WGS84 par `proj4` (chaîne EPSG:31370 avec `+towgs84=-106.8686,52.2978,-103.7239,0.3366,-0.457,1.8422,-1.2747`) place l’exemple de la FAQ wallonne « Gare de Gembloux » (172835,0 ; 139989,6) à 50,57018 ; 4,69109, sur la gare.

L’environnement de développement ne joint pas ces services : tout ce qui précède vient de leur documentation publiée. Le premier appel réel se fera au déploiement du relais (vérification des formats et des temps de réponse, liste au § 8).

### 6.2 Choix : passer par le relais

- Le service flamand refuse CORS : un appel direct depuis la WebView est impossible. Le relais règle aussi la conversion Lambert 72, la fusion des trois sources, le cache partagé et les replis, et garde une seule origine réseau dans `app.json` (aucune nouvelle origine à ajouter, CA-M4.8 simplifié).
- Une source nationale unique (Paradigm, si la couverture belge est confirmée) se branche sans changer le contrat : une variable du relais, `GEOCODE_SOURCES`, ordonne les sources.

### 6.3 Contrat `GET /api/geocode`

```ts
/** GET /api/geocode?q=texte&lang=fr|nl (lang : langue des noms réglée ; rien d'autre ne part du téléphone) */
export interface GeocodeResponse {
  q: string;                         // texte normalisé (espaces)
  fetchedAt: string;
  results: GeocodeResult[];          // 8 au plus, classés
  sources: Partial<Record<GeoSource, { ok: boolean; ms?: number; n?: number; error?: string }>>;
  partial?: boolean;                 // au moins une source interrogée n'a pas répondu à temps
  attribution: string;               // ex. « Adresses : Digitaal Vlaanderen, Paradigm (UrbIS), SPW (ICAR) »
  error?: string;                    // toutes les sources en erreur (texte en français)
}
export type GeoSource = 'vla' | 'bru' | 'wal' | 'google';
export interface GeocodeResult {
  label: string;                     // « Rue de Fer 25, 5000 Namur » ; rue sans numéro : « Rue Neuve, 1000 Bruxelles »
  lat: number; lon: number;          // WGS84, 5 décimales
  kind: 'adresse' | 'rue' | 'commune' | 'lieu';
  approx?: boolean;                  // rue, commune, numéro interpolé : position approximative (PRD M4)
  source: GeoSource;
  score: number;                     // 0..1 après normalisation
  parts?: { street?: string; number?: string; postcode?: string; municipality?: string };
  names?: { fr?: string; nl?: string }; // Bruxelles : libellé dans les deux langues
}
```

### 6.4 Fonctionnement du relais

1. **Contrôle** : `q` nettoyé (espaces, caractères de contrôle refusés), 3 à 100 caractères, sinon 400 « Paramètre q manquant ou trop court : 3 caractères au moins. » ; `lang` fr ou nl (défaut fr), sinon 400 « Paramètre lang invalide : fr ou nl. ».
2. **Aiguillage** : un code postal dans le texte choisit la Région (1000 à 1299 Bruxelles ; 1300 à 1499 et 4000 à 7999 Wallonie ; 1500 à 3999 et 8000 à 9999 Flandre) ; sinon un nom de commune ou de section reconnu (table embarquée nom → Région, quelques dizaines de Ko) ; sinon les trois sources en parallèle.
3. **Appels** : délai de 2 s par source (PRD R1), 2,5 s au total ; réponse partielle permise. Flandre : `Location` avec `c=5`. Bruxelles : `freeSearch/searchAnyObject`, `searchLanguage` = `lang`, deux appels fr et nl seulement si l’utilisateur a réglé « Comme sur place ». Wallonie : `searchAll` en EPSG:4326, niveaux 1 à 4 et 7.
4. **Normalisation** : libellé « Rue Numéro, CP Commune » (casse corrigée, commune sans le préfixe en capitales), `kind` selon le niveau ou le type d’objet, positions en WGS84 (Lambert 72 converti par `proj4`, MIT, environ 100 Ko), axe GeoJSON [lon, lat] respecté, score de chaque source ramené entre 0 et 1.
5. **Fusion et classement** : doublons retirés (même libellé normalisé, ou moins de 25 m et même type) ; ordre : couverture des mots tapés (numéro compris), type (adresse, rue, lieu, commune), score de la source, Région annoncée par le code postal. Le tri par proximité se fait sur le téléphone, qui garde sa position.
6. **Cache** : mémoire de l’instance (500 entrées ; 24 h si résultats, 10 min si vide) et CDN Vercel pour les réponses complètes (`Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800`) ; `no-store` pour une réponse partielle ou en erreur.
7. **Limites** : 30 requêtes par minute et par adresse IP (au mieux, par instance) ; 4 requêtes en cours au plus par source ; une source qui échoue 3 fois de suite est écartée 60 s (« Service des adresses de Wallonie indisponible »). Côté téléphone : recherche à 3 caractères, après 250 ms sans frappe (PRD M4).
8. **Erreurs** (HTTP 200 avec `error`, comme les autres points d’entrée) : « Recherche d’adresse indisponible pour l’instant : gares et arrêts seulement. » ; par source dans `sources[x].error` : « Délai dépassé (2 s) », « Réponse illisible du service flamand ».
9. **Vie privée** : seuls `q` et `lang` sortent du téléphone, jamais la position ni un identifiant ; le relais ne journalise ni `q` ni l’adresse IP (seulement longueur, Région, durées, statut) ; en-tête `User-Agent: quai-relay/1.1` générique.
10. **Attribution** : écran « Données » et pied de la liste de résultats : « Adresses : Digitaal Vlaanderen, Paradigm (UrbIS, CC0), SPW (ICAR, CC BY 4.0) » (texte à confirmer, Q10).
11. **Santé** : `/api/health` ajoute `geocode: { vla, bru, wal }` (requête de test « Namur » au plus toutes les 10 min, en cache).

### 6.5 Utilisation sur le téléphone

- Champ unique (PRD M4) : « Ma position », mes lieux et récents (locaux, immédiats), gares et arrêts (`search/`, local), puis adresses du relais. L’ordre dépend de la forme du texte (chiffre ou mot de rue : adresses d’abord), 4 adresses et 6 gares ou arrêts au plus ; parmi les adresses, celles proches de la position actuelle d’abord, calculé localement.
- Choisir une adresse crée une extrémité `address` (§ 7) et lance `plan()` ; « Enregistrer comme lieu » crée un `Place` avec l’adresse normalisée.
- Hors ligne ou relais en erreur : gares et arrêts seulement, avec les textes du PRD (CA-M4.6).

### 6.6 Google en option

Désactivée en 1.1 (PRD § 7). Si un jour activée (variable `GOOGLE_GEOCODING_KEY` du relais, appel seulement quand les sources officielles ne trouvent rien) : compte de facturation Google Cloud obligatoire (carte bancaire), 10 000 événements gratuits par mois pour les produits « Essentials » ([FAQ facturation](https://developers.google.com/maps/billing-and-pricing/faq)) ; d’après les [règles du Geocoding API](https://developers.google.com/maps/documentation/geocoding/policies), coordonnées gardées 30 jours au plus (un lieu enregistré ne peut pas garder une position Google : garder le `place_id` et redemander), résultats affichés sur une carte seulement sur une carte Google (Quai n’a pas de carte), attribution « Google Maps » visible à côté des résultats.

### 6.7 Non retenus

- OpenStreetMap Nominatim : service tenu par des bénévoles (exclu par le propriétaire, `review-ux.md` § 4) et autocomplétion interdite sur le service public.
- bePelias (Smals Research) : à héberger soi-même, instance de test « sur demande » ([dépôt](https://github.com/SmalsResearch/bePelias)).
- BeST Address hébergé (image BOSA) : serveur et base PostgreSQL, hors 0 €.

## 7. Contrats à faire évoluer

`shared/types.ts` (accord des propriétaires, Q12) :
- `LineFile`, `LineIndex`, `LineTile` (§ 3) ; documentation des fichiers `lines/` et `linetiles/`.
- `TrainsDay.trips[].s` : -1 pour une montée ou une descente interdite (M1).
- `GeocodeResponse`, `GeocodeResult`, `GeoSource` (§ 6.3).

`app/src/core/api.ts` (Q1) :
- `Endpoint` : ajouter `{ type: 'address'; label: string; lat: number; lon: number; approx?: boolean }` (une adresse non enregistrée).
- `Journey` : `label?: 'simple' | 'fast' | 'earlier' | 'fewer' | 'none' | 'walk' | 'next' | 'later'` (Le plus simple, Le plus rapide, Plus tôt, Moins de changements, Sans changement, À pied, Le suivant, Plus tard) et `reason?: string` (texte du PRD § 6) ; `plan()` rend au plus 3 trajets dans l’ordre d’affichage.
- `Leg` : `fromStop?` et `toStop?` (identifiants temps réel des arrêts physiques) ; `stops` rempli aussi pour l’urbain.
- `Core` : `geocode(q: string): Promise<GeocodeResult[]>`.

Relais : `GET /api/geocode`, variables `GEOCODE_SOURCES` (défaut `vla,bru,wal`) et `GOOGLE_GEOCODING_KEY` (vide), `lib/shared/types.ts` resynchronisé.

## 8. Jeux de test à créer

- **Pipeline** (`fixtures/pipeline/`) : mini GTFS « lignes » : profils différents selon l’heure, boucle, montée seule et descente seule, deux directions, voyage après 24:00, voyage d’un seul des deux jours, `trip_id` STIB ; fichiers de ligne attendus (JSON de référence) ; contrôle des listes `conn` (tronçon commun réduit à ses bornes) et des tuiles de lignes.
- **Cœur, petits réseaux** (`fixtures/core/routing/`) : ligne directe ; deux lignes urbaines d’opérateurs différents reliées à pied ; urbain, train, urbain ; trois trains (M5c) ; trois lignes urbaines refusées en portée PRD ; attente de 61 min refusée ; correspondance qui ne gagne que 3 min sur le même premier train refusée ; nuit avec repli au lendemain ; montée interdite. Plus les cas A à H du PRD sur des trajets synthétiques (comme `rank-cases.ts`).
- **Cœur, données réelles** : les 24 requêtes du § 5.2 (structure attendue : lignes, gares de correspondance, étiquettes, heures à 2 min près) et le contrôle « réseau complet » (300 paires, au moins 97 % identiques) sur l’instantané, lancés à la demande et chaque nuit en avertissement (Q13 : à rafraîchir avec l’instantané).
- **Relais** (`fixtures/relay/geocode/`) : réponses types des trois sources (exemple documenté de la Flandre, forme `GeocodageSearchTypeV2`, exemple `searchAll` de la FAQ wallonne) et cas d’erreur (délai, 500, JSON illisible, vide) ; conversion Lambert 72 (Gembloux) ; faux service de géocodage scènes `base` et `down` avec le tableau du PRD annexe A.2 (`npm run mock-geocode`).
- **Interface** : états du champ unique (local seulement, adresses, hors ligne, rien trouvé) et étiquettes des cartes de résultats.

## 9. Risques

| Risque | Effet | Parade |
|---|---|---|
| Sélection des lignes incomplète en ville dense | 1 à 2 % des trajets à trois véhicules moins bons de 1 à 7 min | K réglable, contrôle « réseau complet » chaque nuit, indicateur dans les tests |
| Nombre de fichiers par recherche (40 à 135) | latence si la WebView limite les flux HTTP/2 | mesure sur Quai Web et dans l’appli ; repli : paquets de lignes par tuile |
| Fichier des trains (412 Ko gzip, plus 248 Ko le soir) | premier calcul plus lent | cache du jour (M9), jour 1 chargé seulement le soir |
| Profils absents d’une ligne (réseau en échec la nuit) | pas de trajet urbain | repli 1.0 (lignes directes par les fichiers de zone) quand `lines/` manque |
| Services d’adresses non joignables ou formats différents de la documentation | adresses absentes | faux service, tests de contrat, trois sources, disjoncteur, repli gares et arrêts ; vérification au premier déploiement |
| Conditions d’utilisation wallonnes en cours d’élaboration ; quotas non publiés | arrêt du service | cache 24 h et CDN, limites par IP, contact `helpdesk.carto@spw.wallonie.be` avant publication |
| Couverture nationale de Paradigm non confirmée | une seule source manquerait | contrat indépendant des sources, variable `GEOCODE_SOURCES` |
| Taille du site (434 Mo) | marge réduite | raccourcir les `trip_id` De Lijn (m8) avant tout ajout |
| Règles de classement sensibles aux seuils | propositions jugées étranges | seuils en constantes, cas de référence, précisions du § 4.8 à valider (Q5) |
| Reconstitution STIB du prototype approchée | tailles et horaires STIB du prototype à 1 % près | le pipeline lit les `trip_id` STIB du GTFS |

## 10. Découpage du travail

| Équipe | Travail | Estimation |
|---|---|---|
| Pipeline | Fichiers de ligne depuis le GTFS dans `feed.ts` (motifs, autorisations, profils, voyages, `trips`) ; dans `build.ts` : index des lignes, `conn`, `stations`, tuiles de lignes, rapport de taille ; correctif M1 dans `trains/` ; raccourcissement des `trip_id` De Lijn (avec le relais) ; tests sur le mini GTFS | 3 à 4 jours |
| Relais | `/api/geocode` (trois sources, aiguillage, normalisation, `proj4`, fusion, cache, limites, disjoncteur, erreurs en français, attribution), santé, faux service, tests de contrat ; comparaison des `trip_id` raccourcis | 2 à 3 jours |
| Cœur | Chargement des nouveaux fichiers et cache par génération ; sélection L_O, L_D, lignes du milieu ; réseau et marches ; RAPTOR par rondes, plage de départs, trois passes, règle urbaine, nuit ; classement du PRD avec les précisions du § 4.8 ; étapes avec arrêts et identifiants temps réel ; temps réel, recalcul de correspondance ; extrémité `address` ; `geocode()` ; tests (petits réseaux, cas A à H, 24 requêtes réelles, contrôle « réseau complet ») | 6 à 8 jours |
| Interface | Champ unique (M4), extrémité adresse, cartes étiquetées avec raison et bouton « Lunettes », « Enregistrer comme lieu », états d’erreur, mention de vie privée, écran « Données » (attribution, état des sources d’adresses) | 3 à 4 jours |

Ordre conseillé : pipeline (fichiers de ligne, M1) et relais en parallèle ; cœur sur les fichiers du prototype (`/home/claude/routing-proto/out/`, même format) sans attendre le pipeline ; interface sur le faux cœur puis le vrai.

## 11. Réponses aux questions du PRD

- **Q1** : extrémité `address` dans `Endpoint` (pas de lieu implicite) ; étiquette et raison calculées par le cœur dans `Journey` (§ 7).
- **Q2** : par le relais (CORS flamand absent, conversion de coordonnées, cache commun, une seule origine) ; trois Régions en parallèle aujourd’hui, Paradigm national dès que confirmé, sans changer le contrat.
- **Q3** : M5b et M5c tiennent dans le budget : 0,5 à 1,2 Mo gzip à froid, 1,1 à 2,0 s estimées sur téléphone, calcul de 30 à 180 ms sur la machine de développement. Les deux reposent sur les mêmes fichiers ; M5c (trains) peut aussi se faire seul avec `trains/` en remplaçant le balayage à une correspondance par le même RAPTOR.
- **Q5** : seuils du § 4.4 tenus sur les données réelles avec les quatre précisions du § 4.8 ; « marche longue » à 1,5 × `maxWalkMin` donne le bon résultat sur les cas F et H.
- **Q10** : texte proposé au § 6.4 ; licences : CC0 (Bruxelles), CC BY 4.0 pour les données ICAR et conditions SPW du service en cours d’élaboration (Wallonie), licence flamande de réutilisation gratuite (Flandre) ; à confirmer auprès de chaque service avant publication.
- **Q12** : contrats listés au § 7.

## Annexe A : reproduire

```sh
cd /home/claude/routing-proto
node --max-old-space-size=6000 gen.ts      # 12 s : out/lines/, out/lines/index.json, out/linetiles/, out/sizes.json
node trainflags.ts                          # out/trainflags.json (autorisations des trains, émulation de M1)
node run-queries.ts > results.txt           # 24 requêtes : results.txt, results.json
node table.ts > tables.md                   # tableaux du § 5
node rank-cases.ts                          # cas A à E du PRD
SEED=777 node --max-old-space-size=6000 oracle.ts 300           # portée PRD, K = 10
UU=2 MIDK=20 SEED=777 node --max-old-space-size=6000 oracle.ts 300   # cas général, K = 20
node v10error.mjs                           # écart des estimations 1.0
(cd geo && node l72.mjs)                    # conversion Lambert 72 (proj4)
```

Réglages du prototype (`router.ts`, objet `P`) : marche maximale 10 min, correspondance à pied 400 m, 60 lignes par côté, K = 10, fenêtre de 60 min, 3 véhicules, correspondances 2 min (zone urbaine) et 4 min (gare), plus 1 min ou 3 min après une marche, vitesses d’estimation 18 km/h (bus, tram), 30 (métro), 60 (train).
