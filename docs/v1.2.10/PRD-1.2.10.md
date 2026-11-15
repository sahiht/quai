# Quai 1.2.10 « Y aller » : guidage de bout en bout, écran calme, favoris légers

Spécification de référence pour toutes les équipes. Contrat de types : `app/src/core/guide-types.ts`, et les ajouts
marqués « 1.2.10 » dans `app/src/core/api.ts`, `app/src/glasses/types.ts`, `app/src/glasses/nav.ts`,
`app/src/glasses/gestures.ts` et `app/src/platform/types.ts`. Ne changez pas un contrat sans le signaler dans votre
rapport (nom, raison, effet sur les autres équipes).

## 0. Décisions du propriétaire (14 et 15/11)

- Favoris des lunettes moins chargés : une ligne par favori, **le détail du favori choisi en bas de l'écran** (variante
  choisie), plus de favoris à l'écran.
- Le trajet d'un favori doit être **facile à lire**.
- **Guider de bout en bout**, « au plus près et au plus juste » : à pied jusqu'au bus, le bus, la descente à la gare,
  le train, un autre bus, à pied jusqu'à l'arrivée ; et, pour un train ou un bus pris sans trajet complet, **seulement
  la partie suivi**.
- **Écran calme** : l'écran reste vide et ne montre quelque chose que quand il faut agir. On peut **effacer** un message
  une fois lu, Quai relance pour la suite ; on peut **arrêter** ; on peut **ne pas l'activer**. Une version à trois
  niveaux a été jugée trop complexe : **un seul fonctionnement, deux gestes, un seul réglage**.
- Le guidage existe dans Favoris (« Y aller », de porte à porte) et dans Gares, Arrêts, Lignes, Autour de moi
  (« J'y descends », le véhicule seul).
- **Vrai chemin à pied** (OpenStreetMap, calculé sur le téléphone), dans cette version.
- **Pas de version d'essai** : une version définitive, complète, avec contrôle qualité usager et technique.
- Exigence de qualité : **99,99 % de conformité**. Traduit en barrières mesurables au § 9 : rien ne part avec un test
  rouge, un écart au pixel, une erreur sur les vraies données ou une remarque de relecture ouverte.
- Restent tels quels : l'écart des favoris entre téléphone et lunettes (1.2.9). Pour plus tard : le radar de la veille.

## 1. Principes

1. Une chose à la fois. Un message n'apparaît que si la personne doit agir. Entre deux, l'écran est vide.
2. Rien ne démarre seul : le guidage commence toujours par un toucher (« y aller », « j'y descends », bouton
   « Y aller » du téléphone). Une fois lancé, il avance seul (c'est son rôle).
3. Une heure, pas un conseil. Seules exceptions, les consignes d'action du guidage : « Partir maintenant »,
   « Descends au prochain arrêt », « Fais demi-tour ». Jamais « presse le pas », « pas besoin de courir ».
4. La position ne quitte jamais le téléphone. Aucun service nouveau ne la reçoit. Pas de Google.
5. Données officielles des opérateurs ; OpenStreetMap seulement pour les chemins à pied (les données officielles
   n'ont ni escaliers, ni chemins des parcs, ni passages des gares).
6. Typographie française : espace insécable avant « : ; ! ? » (constante `NB`), guillemets « », jamais de tiret long
   ni moyen dans un texte montré. Tutoiement.
7. Tout ce qui s'affiche tient au pixel (`textWidth`, police des G2) : jamais de texte coupé au milieu d'un mot.
   Arbitré le 15/11 : vaut pour les écrans de la 1.2.10, les titres et les lignes de détail (coupés au mot, ou après
   un morceau entier d'un nom composé : « Wervicq/… ») ; les rangées des tableaux et de toute la ligne gardent la coupe
   de la 1.2.x (0,6 % des rangées sur les vraies données), à reprendre plus tard.
8. Le guidage ne dépend ni de l'allumage de l'écran (aucune API ne l'allume), ni du premier plan : il calcule toujours,
   et l'écran montre l'état juste dès qu'il est visible.

## 2. Favoris des lunettes (écran `favorites`)

- Une rangée par favori : le nom au plus clair, puis « ! » (insécable) s'il a un souci ; à droite, la réponse au format
  de l'accueil (`tripHomeText`, `stopHomeText`) : « dans 3 min → 08:58 », « 09:00 → 09:29 », « tu y es », « … ».
- « ! » : premier véhicule supprimé, voie modifiée, alerte travaux qui concerne le trajet (§ 6). Un retard seul ne met
  pas « ! » (les heures à droite le comptent déjà).
- **Ligne du détail, en bas**, fixe, au-dessus des aides, après un filet pâle (bordure du conteneur, niveau 2) : le
  détail du favori sous le curseur, au format actuel (`favoriteDetail`) : « IC 07:42 +2 voie 6 !, 1 changement »,
  « bus W 07:36, direct », « à pied, 21 min ». Rien pour « tu y es » ou sans trajet. « ~ » au début de l'heure
  d'un horaire prévu (pas de note séparée : cette ligne la remplace). Sur une adresse récente : l'adresse complète.
  Sur « Autre adresse » : vide.
- Les adresses récentes et « Autre adresse » suivent, inchangées. Aides inchangées.
- Capacité visée : 7 favoris à l'écran avec le détail (4 aujourd'hui avec 2 lignes chacun).

## 3. Guidage

### 3.1 Lancer

- **« Y aller »** (genre `trip`) : sur l'écran du trajet (§ 5), toucher = « y aller » sur la proposition affichée
  (intention `goGuide`). Aussi depuis les adresses récentes et « Autre adresse » (leur trajet s'ouvre de même).
  Téléphone : bouton « Y aller » sur chaque favori lieu ou trajet (`GlassesApi.goFavorite`).
- **« J'y descends »** (genre `ride`) : dans la liste des arrêts d'un départ (routes `stops`, écrans `stops` et
  `trainRun`), toucher un arrêt **après** la montée = « j'y descends » (intention `alight`). Les arrêts d'avant et
  celui de la montée sont pâles et sans action. Ce toucher **remplace** l'ouverture du tableau de cet arrêt depuis cette
  liste (arbitré) : les départs d'un arrêt restent dans Gares, Arrêts, Autour de moi. Aides de cette liste :
  « △▽ arrêts   toucher : j'y descends   double : retour ».
- Un nouveau guidage remplace le précédent. Le trajet suivi (`FollowedTrip`, clé `quai.trip`) porte le guidage.
- Au lancement : l'écran `guide` s'ouvre sur « Où tu en es » (§ 3.3), qui s'efface seul au bout de 15 s. Arbitré le
  15/11 (contrôle usager) : un moment déjà dû (voie modifiée, « monter » d'un bus qui arrive, nouveau trajet) passe
  d'abord ; « Où tu en es » reste à un toucher.

### 3.2 Écran calme et moments

Écran `guide`. Par défaut : **page vide** (tous les conteneurs vides, aucune aide, aucune image). Le moteur
(`core/guide.ts`) donne au plus **un moment** à la fois, le plus prioritaire, dans cet ordre :
`replan` > `passed` > `alight` > `platform` > `board` > `turn` > `leave` > `nextStop` > `arrived`.

Chaque moment reste jusqu'à sa fin automatique (`until`) ou jusqu'à un toucher (« effacer ») ; un moment effacé ne
revient pas, sauf si son contenu change d'une façon qui oblige à agir (nouvelle voie, nouveau trajet : nouvel `id`).
Pendant un moment, les chiffres qui bougent (distance, minutes) se mettent à jour sans reconstruire la page
(`textContainerUpgrade`).

| Moment | Quand il apparaît | Fin automatique | Image (à gauche) | Texte |
|---|---|---|---|---|
| `leave` | à l'heure de partir (`leaveAt`) ; tout de suite si on lance le guidage après | marche commencée (40 m du point de départ) ou `leaveAt` + 3 min | panneau « à pied » / minutes / « min » | « Partir maintenant » ; « 5 min à pied jusqu'à l'arrêt Monument Gramme » (train : « jusqu'à la gare de Namur » ; dernière marche : « jusqu'à {titre} ») ; « bus 6 à 07:12 » (« ~07:12 » sans temps réel ; « , très juste » si marge ≤ 1 min) ; si très juste : « Si tu le rates : arrivée 09:34, 30 min plus tard » (règle 1.2.5) |
| `turn` | prochain virage à 40 m ou moins (ou 15 s à la vitesse de marche) | 10 m après le virage | flèche du virage | « à gauche dans 40 m » (moins de 100 m : par 10 m ; sinon par 50 m ; 10 m ou moins : « à gauche maintenant ») ; pâle : nom de la rue prise si connu, sinon « vers l'arrêt du bus 6 », « vers la voie 3 », « vers {titre} » |
| `board` | à 60 m de l'arrêt ou de la gare de montée (sans position : à l'heure d'arrivée de la marche) et départ dans 15 min ou moins | montée constatée ou départ + 1 min | panneau « bus » / « 6 », « tram » / « 3 », « métro » / « 2 », « voie » / « 3 » (train sans voie connue : « train » / « IC ») | bus, tram, métro : « dans 1 min » (au-delà de 10 min : « à 07:12 » ; « imminent » seulement avec le temps réel) ; train : « IC à 07:30 » ; pâle : « vers Gare des Guillemins » ; pâle : « descente dans 4 arrêts » ; correspondance en gare : « 3 min à pied jusqu'au quai, marge 6 min » ; voie modifiée : « voie modifiée » au plus clair |
| `platform` | voie modifiée par le temps réel avant la montée, si `board` n'est pas affiché | 2 min ou montée | panneau « voie » / nouvelle voie | « Voie modifiée » ; « IC à 07:30, voie 6 au lieu de 4 » |
| `nextStop` | train seulement, trajet à bord de 10 min ou plus : 1 min avant chaque gare intermédiaire ; au plus un toutes les 10 min ; jamais dans les 5 min avant `alight` | départ de cette gare + 1 min | aucune | « Prochain arrêt : Louvain » ; pâle : « descente dans 3 arrêts, à Bruxelles-Central » |
| `alight` | le véhicule quitte l'arrêt d'avant la descente (position ; sinon heure estimée + 30 s), pas avant 4 min de l'arrivée ; trajet d'un seul arrêt : départ + 30 s | descente constatée ou arrivée + 2 min | aucune | « Descends au prochain arrêt » ; « Gare des Guillemins, 07:20 » ; pâle : « ensuite : voie 3, IC à 07:30 » / « ensuite : bus 71 à 08:34 » / « ensuite : 5 min à pied » |
| `replan` | correspondance devenue impossible (retard), véhicule supprimé, véhicule raté (encore à l'arrêt 2 min après son départ) : le contrôleur calcule un nouveau trajet depuis là où l'on est | 60 s, puis le guidage suit le nouveau trajet | aucune | « Ton IC de 07:30 est parti » / « … est supprimé » / « Correspondance ratée : bus 71 de 08:34 » ; « Nouveau trajet : IC 08:02, voie 3 » ; pâle : « arrivée 09:27, 33 min plus tard » ; sans solution : « Pas d'autre trajet trouvé » |
| `passed` | à bord, la position dépasse l'arrêt de descente (plus de 300 m au-delà, en s'éloignant, après son heure) | descente constatée ou 3 min | aucune | « Tu as passé Bruxelles-Central » ; « Descends à Bruxelles-Midi, 08:31 » ; pâle : « nouveau trajet : arrivée 09:06 » |
| `arrived` | à 50 m de la destination (sans position : heure d'arrivée) ; genre `ride` : descente faite | 2 min, puis le guidage s'arrête | aucune | « Tu y es » ; pâle : « {titre}, 08:54, à l'heure » / « 3 min de retard » / « 2 min d'avance » ; aides : « toucher : terminer » |

Sans position (refusée, sous terre, trop imprécise : précision au-delà de 75 m ou plus vieille que 60 s) : tout
fonctionne à l'heure et au temps réel ; pas de virage, pas d'arrêt dépassé, pas de véhicule raté.

Titre de chaque écran du guidage (ligne du haut, pâle) : le titre du trajet (« Bureau », « Vers Bruxelles-Central »)
et l'heure à droite. Aides des moments : « toucher : effacer   appui long : arrêter ».

### 3.3 Où tu en es

Toucher sur l'écran vide (et au lancement). S'efface seul au bout de 30 s, ou d'un toucher.

- Ligne 1 (sous le titre) : la chaîne « ● à pied ─ ◎ bus 6 ─ ○ IC ─ ○ bus 71 » : la marche de départ s'il y en a une,
  puis chaque véhicule ; fait ●, en cours ◎ (au plus clair), à venir ○ (pâles). Trop longue : « … » au milieu.
- À pied : « À pied vers l'arrêt du bus 6 » (« vers la voie 3 », « vers {titre} ») ; « 260 m, 4 min » ;
  « bus 6 à 07:12, marge 2 min » ; « arrivée 08:54 ».
- À l'arrêt : « À l'arrêt Monument Gramme » (gare : « À la gare de Namur ») ; « bus 6 dans 1 min, vers Gare des
  Guillemins » ; train : « voie 3 » ; « arrivée 08:54 ».
- À bord : ligne de progression 1.2.5 (`progressLine`) puis « descente dans 3 arrêts » pâle ; « Prochain arrêt :
  Place Général Leman, 07:16 » ; pâle : « descente : Gare des Guillemins, 07:20 » ; pâle : « arrivée 08:54 » (genre
  `trip`).
- Aides : « toucher : effacer   appui long : arrêter ».

### 3.4 Gestes, menu, arrêt

- **Toucher** : écran vide → « Où tu en es » ; moment ou « Où tu en es » → effacer (écran vide) ; « Tu y es » →
  terminer.
- **Appui long** : menu de 2 choix, « Arrêter le guidage » (id 1) et « Voir tout le trajet » (id 2).
  Appli Even : choix ajoutés au menu système (`menuObject`, SDK 0.0.14+, 10 choix au plus, 32 octets) sur les pages du
  guidage seulement. Quai Web : bouton « Appui long » (geste `long`) → écran `menu` rendu par Quai, toucher = choisir,
  double = retour.
- « Arrêter le guidage » : fin immédiate, toast « Guidage arrêté », retour à l'accueil. Aussi depuis la carte
  « En cours » du téléphone.
- « Voir tout le trajet » : l'écran du trajet (§ 5) du trajet guidé, double toucher pour revenir au guidage.
- **Double toucher** sur l'écran du guidage : retour à l'accueil, le guidage continue ; l'accueil montre « En cours »,
  dont le toucher rouvre l'écran du guidage.
- Fin automatique : « Tu y es » + 2 min ; trajet terminé (règle 1.2.x : arrivée + 5 min, ou pas parti) ; nouveau
  guidage.

### 3.5 Réglage « Me guider pendant un trajet » désactivé

`settings.display.guide === false` : « y aller » et « j'y descends » font suivre le trajet **sans aucun message et
sans qu'aucun écran ne change seul** (pas de « Dans le train » automatique de la 1.2.9) ; toast « Trajet suivi » ;
l'accueil montre « En cours », son toucher ouvre l'écran du trajet. La carte « En cours » du téléphone reste.

### 3.6 Imprévus

- Correspondance ratée ou véhicule supprimé (genre `trip`) : le contrôleur demande au cœur un nouveau trajet depuis
  `replan.from` jusqu'à la destination du trajet suivi ; le guidage passe au premier trajet proposé, moment `replan`.
  Rien trouvé : `replan` avec `none`, le guidage continue sur l'ancien trajet.
- Arrêt dépassé : moment `passed` puis nouveau trajet depuis l'arrêt suivant (genre `trip`) ; genre `ride` :
  seulement « Descends à … ».
- Véhicule raté, genre `ride` : « Ton bus 6 de 07:12 est parti » ; « Prochain : bus 6 à 07:24 » si le tableau de
  l'arrêt le donne.
- Voie modifiée : moment `platform` (ou `board` avec « voie modifiée »).
- Un retard qui ne casse rien ne fait aucun message (les heures du « Où tu en es » le montrent).

### 3.7 Position, batterie, cycle de vie

- Positions continues seulement pendant un guidage (`LocationPort.watch`) : `high` (5 m, 2 s) en marchant (approche
  de l'arrêt comprise), à l'arrêt dans les 15 min avant le départ, à bord quand le prochain arrêt est la descente ;
  `medium` (50 m, 30 s) à bord autrement et 10 min avant l'heure de partir ; `off` sinon et dès la fin (contrôle
  technique du 15/11 : texte aligné sur le moteur). Appli Even : `startAppLocationUpdates` ;
  Quai Web et navigateur : `watchPosition`. Positions ignorées si précision > 75 m pour les décisions de distance.
- Le moteur se recalcule à chaque position, à `wakeAt` (au plus toutes les 60 s) et à chaque rafraîchissement du temps
  réel du trajet suivi (règle 1.2.x : à l'approche du départ).
- **Premier plan quitté** (`FOREGROUND_EXIT`, une notification passe devant) : le guidage continue (minuteries,
  positions), seul l'affichage attend ; au retour (`FOREGROUND_ENTER`) la page du moment présent est reconstruite.
  Attention à la boîte de sortie (événements inversés, voir even-g2-notes).
- **Lunettes reconnectées** (`onDeviceStatusChanged`) : page reconstruite.
- **Téléphone verrouillé** : iOS garde la page vivante ; Android peut la suspendre : à la reprise, état recalculé
  depuis l'heure et la position, sans rejouer les moments passés. Prérequis donné au propriétaire : position de
  l'appli Even sur « Toujours ».
- Persistance : `FollowedTrip.guide` (genre, `GuideMemory`, chemin à pied en cours), enregistré à chaque changement
  (au plus toutes les 5 s).

### 3.8 Chemin à pied (OpenStreetMap)

Pipeline (« Données de nuit ») : graphe piéton de la Belgique, refait au plus une fois par semaine (cache), depuis
l'extrait Geofabrik `belgium-latest.osm.pbf`. Voies gardées : `highway` = footway, pedestrian, path, steps,
living_street, residential, service, unclassified, tertiary(_link), secondary(_link), primary(_link), track, cycleway
(sauf `foot=no`), `corridor`, quais (`railway=platform`, `public_transport=platform`) ; exclues : motorway, trunk sans
trottoir, `foot=no`, `access=private|no` sans `foot=yes`. Nœuds aux carrefours, géométrie simplifiée (environ 2 m),
longueur, nom de rue, marches. Tuiles d'environ 2 km, nœuds identifiés pour se raccorder d'une tuile à l'autre,
publiées sous `data/walk/` avec un index (`data/walk/index.json` : version, date, source, licence ODbL, taille des
tuiles). Budget : 80 Mo au plus pour toute la Belgique (sinon simplifier ou limiter à 2 km autour des arrêts), 300 ko
au plus par tuile. Attribution : « © les contributeurs d'OpenStreetMap, ODbL » (LICENSE-DATA, écran Données du
téléphone).

Téléphone (`core/walk/`) : tuiles chargées autour de la marche (cadre + 300 m), A*, départ et arrivée accrochés à la
voie la plus proche (100 m au plus), sinon chemin droit (`source: 'straight'`, aucun virage annoncé). Virages
seulement aux carrefours (3 voies ou plus) : angle de moins de 30° ignoré ; 30 à 60° « légèrement » ; 60 à 135° ;
135 à 170° « en épingle » (mots : « franchement à gauche ») ; au-delà, demi-tour. Deux virages à moins de 15 m : un
seul (le plus marqué). Aucun virage dans les 20 derniers mètres. Hors du chemin de plus de 30 m pendant 10 s : nouveau
chemin, sans message ; « Fais demi-tour » seulement si le nouveau chemin commence par un demi-tour. Temps de calcul :
moins de 150 ms pour 2 km sur un téléphone.

### 3.9 Écrans du guidage (mise en page)

Mêmes rangées que les autres écrans (GEO de `layout.ts`). Image (conteneur d'image, 144 × 144, 4 au plus par page) à
gauche sous le titre ; texte à x = 196 quand il y a une image, sinon à la marge habituelle. Trois lignes de texte au
plus pour un moment (quatre avec « Si tu le rates »), centrées verticalement sur l'image. Panneau : cadre arrondi au
plus clair, petit mot pâle en haut (« bus », « voie », « à pied »), grand chiffre au plus clair, petit mot en bas
(« min ») ; flèches pleines, épaisses (16 px). Rendu en 16 niveaux de vert (`glasses/images.ts`), identique dans
Quai Web (canvas) et le simulateur. Si une image ne part pas (échec de `updateImageRawData`), le texte suffit.

## 4. Téléphone

1. **Réglage** dans Réglages, rubrique « Pendant un trajet » : interrupteur « Me guider pendant un trajet », allumé par
   défaut ; aide : « Les lunettes restent vides et t'écrivent seulement quand tu dois agir : partir, tourner, monter,
   descendre. Éteint : ton trajet est suivi sans rien afficher tout seul. »
2. **Bouton « Y aller »** sur chaque favori lieu ou trajet (carte Favoris de l'accueil et liste complète) :
   `goFavorite(id)`, message rendu à côté du bouton (« Guidage lancé sur les lunettes », ou l'erreur).
3. **Carte « En cours »** en tête de l'accueil pendant un trajet suivi : « En cours » ; « {titre}, arrivée 08:54 » ;
   « Maintenant : bus 6 vers Gare des Guillemins » (`GuideStatus.now`) ; bouton « Arrêter le guidage ». Mise à jour
   en direct (`onGuide`).
4. **Affichage sur un seul écran** (laissé par la 1.2.9) : le choix de l'ouverture sur un écran à part ; Affichage
   tient dans 390 × 844.
5. **Données** : carte « Chemins à pied » (OpenStreetMap, ODbL, date des données, disponible ou non).
6. Retrait du code laissé par la refonte 1.2.9 (anciennes sections de l'accueil, leurs tests et leur CSS).
7. Bandeau des nouveautés 1.2.10 (§ 7). Quai Web : bouton « Appui long » à côté de « Toucher » et « Double toucher ».

## 5. Écran du trajet (`steps`), plus facile à lire

- Titre : le nom du trajet (« Bureau »), l'heure à droite.
- Ligne du haut : « Départ 07:05, dans 3 min » et, à droite, « arrivée 08:54 » (« ~ » sans temps réel). Une alerte du
  trajet (§ 6) prend cette ligne, au plus clair. Arbitré le 15/11 : « Si tu le rates » de la 1.2.5 garde sa place dans
  sa fenêtre (5 min avant de partir, jusqu'au départ du premier véhicule) : alerte, puis « Si tu le rates », puis le
  départ et l'arrivée.
- Une rangée par étape : l'heure au début ; véhicule au plus clair (« Bus 6 », « IC voie 3 », « Tram 3 »,
  « voie 6 ! » si modifiée) puis « → Gare des Guillemins » pâle ; à droite l'heure d'arrivée pâle, ou la marge d'une
  correspondance de 5 min ou moins (« marge 2 min », « très juste », règle 1.2.5) ; marche : « à pied 5 min » pâle
  (« , pluie » si 1.2.5). Supprimé : « SUPPRIMÉ ».
- Aides : « △▽ étapes   toucher : y aller   double : retour » ; trajet déjà guidé (arbitré le 15/11) : « △▽ étapes
  toucher : guidage   double : retour », toucher = retour au guidage ; trajet suivi, réglage éteint : toucher = écran
  du trajet suivi (« toucher : ne plus suivre »).
- Le reste (autres trajets, « Fin du trajet. ▽ … ») inchangé.

## 6. Alertes et vérifications

- Seules les alertes qui concernent le trajet (ses lignes, ses arrêts, ses heures) s'affichent ; les travaux sont mis
  en forme : jamais de texte brut avec « | » (constat du 14/11 : « Travaux : Binche | Travaux réfection rue Zéphir… »
  sur un trajet Waterloo → Bruxelles). 48 caractères au plus, au pixel.
- Vérifications laissées par la 1.2.9 : `controller.worksOf` pour De Lijn et le TEC (numéros de ligne contre
  `route_id`), jour de service pendant l'heure du changement d'heure, deux lignes W de régions différentes gardées en
  1.2.5, `npm run dev:web`.

## 7. Nouveautés (une fois, depuis la 1.2.9 ou avant)

Lunettes, titre « Quai 1.2.10 », trois lignes : « Y aller : guidé de porte à porte, écran calme. » ; « Train ou bus
déjà pris : « j'y descends ». » ; « Favoris : une ligne chacun, le détail en bas. » (formulations finales par l'équipe
des écrans, au pixel). Quai Web : « onglet Réglages » là où il le faut (règle 1.2.9). Téléphone : bandeau équivalent.

## 8. Confidentialité et sécurité

- Aucune adresse ni position personnelle dans le dépôt, les tests, les captures, les journaux. Lieux publics seulement
  (gares, arrêts). Exemples : Liège-Guillemins, Monument Gramme, Bruxelles-Central, Flagey.
- Les tuiles piétonnes sont demandées par tuile (zone de 2 km), comme les tuiles d'arrêts : rien d'autre ne part.
- CSP de Quai Web : rien de nouveau hors de l'origine du site.

## 9. Qualité : barrières de publication

1. TypeScript sans erreur ; tous les tests existants et nouveaux verts (appli, pipeline, relais, bout en bout).
2. Moteur du guidage : au moins 80 scénarios (heure seule, positions, temps réel, retards, correspondance ratée,
   supprimé, voie modifiée, arrêt dépassé, véhicule raté, sans position, sous terre, verrouillage et reprise, genre
   `ride`, réglage éteint, un seul arrêt, trajet à pied seul, minuit et changement d'heure).
3. Chemin à pied : tests sur graphes construits à la main et sur un extrait réel ; sur la branche de vérification,
   1 000 marches de 200 m à 1,5 km entre vrais arrêts : au moins 99 % de vrais chemins, p95 sous 150 ms, aucun virage
   à moins de 15 m d'un autre, taille totale mesurée sous le budget.
4. Écrans : chaque texte mesuré au pixel avec les noms les plus longs des vraies données ; simulateur à 100 % avec
   contrôle au pixel, captures de chaque nouvel écran.
5. Bout en bout : scénarios guidés complets (marche, bus, train, bus, marche ; « j'y descends » ; imprévus ; réglage
   éteint ; Quai Web avec l'appui long), positions simulées.
6. Vraies données : balayage des lignes et des trains sans erreur (branche de vérification).
7. Deux contrôles indépendants (usager : chaque écran et chaque parcours ; technique : code, cycle de vie, batterie,
   confidentialité) ; **zéro remarque ouverte** à la publication.

## 10. Équipes et fichiers

Chaque équipe travaille dans son worktree (`/home/claude/q1210-<équipe>`, branche `w1210-<équipe>`), ne touche que ses
fichiers, commite (auteur `sahiht <sahiht@users.noreply.github.com>`, lignes Co-Authored-By et Claude-Session) et ne
pousse rien.

| Équipe | Fichiers | Fournit aux autres |
|---|---|---|
| A, moteur | `core/guide.ts` (et `core/guide-*.ts`), `core/routing/legs.ts` (lat/lon des arrêts), tests `test/core/guide*` | `guideStep`, `dismissMoment`, `rideJourney`, `guideStatusOf`, `newGuideMemory` |
| B, plateforme | `platform/*`, `web/location.ts`, `web/position.ts`, `web/display.ts`, `web/gestures.ts`, `web/shell.ts`, `glasses/gestures.ts`, `glasses/images.ts` (nouveau), tests | `LocationPort.watch`, images (`paint`, rendu), menu système, signaux `menu` et `device`, geste `long`, position simulée de bout en bout (`window.__quaiPushFix`) |
| C1, écrans | `glasses/views.ts`, `glasses/format.ts`, `glasses/layout.ts`, `glasses/guide-views.ts` (nouveau), tests des vues et des largeurs | `guideView`, `menuView`, favoris et trajet refaits, « j'y descends » dans les arrêts, nouveautés |
| C2, contrôleur | `glasses/controller.ts`, `glasses/nav.ts`, tests du contrôleur | guidage branché de bout en bout, `GlassesApi` 1.2.10 |
| D, chemin à pied | `pipeline/src/walk/*`, `.github/workflows/nightly.yml` (étape et cache), `core/walk/*`, `core/data.ts` (tuiles piétonnes), LICENSE-DATA, tests | `WalkRouter`, `walkProgress`, tuiles `data/walk/` |
| E, téléphone | `phone/**`, `settings.ts`, textes du téléphone, tests du téléphone | réglage, « Y aller », « En cours », Affichage, Données |
| F, alertes | `core/journeys.ts` (alertes), `core/realtime.ts`, `core/alerts.ts` (nouveau), relais si nécessaire, script `dev:web`, tests | alertes du trajet mises en forme, vérifications 1.2.9 |
| G, bout en bout | `tests/e2e/**` | scénarios, captures, contrôle au pixel |

## 11. Hors périmètre

Radar de la veille ; voix ; carte ; noms de sortie du métro ; réglages fins de l'écran calme (un seul interrupteur).

## 12. Bilan de publication (15/11)

- Construction : 8 équipes en parallèle (moteur, plateforme, écrans, contrôleur, chemin à pied, téléphone, alertes,
  bout en bout), puis deux contrôles indépendants (usager, technique) et la passe complète du simulateur.
- Contrôle technique : 4 défauts corrigés au premier passage (arrêt dépassé « Descends à Ma position », guidage
  arrêté pendant l'attente d'un bus en retard, recalcul chaque seconde, enregistrement à la sortie du premier plan),
  essai de 300 trajets tirés au hasard ; puis les 6 défauts trouvés par le simulateur (descente non constatée à une
  correspondance très juste, arrêt dépassé non vu, compte du « Prochain arrêt », « ~ » d'« Où tu en es », boucle de
  demandes de chemin, horloge du mode test) ; arrêt dépassé complet (« Descends à », nouveau trajet depuis l'arrêt
  suivant, véhicule gardé jusque-là) ; « j'y descends » resté à bord après l'arrêt en gare.
- Contrôle usager : 13 points, tous traités (gel possible de l'appli, titres coupés, voie écrite au moment
  « monter », voie modifiée de la gare de montée, descente nommée une fois, panneaux avec « - / . + », carte
  « En cours », virages derrière « monter », « très juste » trop tôt) ou arbitrés (lancement : un moment déjà dû
  avant « Où tu en es » ; « Tu y es » sans position à l'arrivée + 2 min).
- Barrières du § 9 : TypeScript sans erreur ; tests de l'appli 1 541, du pipeline 279, du relais 275, de bout en
  bout 172, tous verts ; moteur couvert par plus de 115 tests, 86 du contrôleur et l'essai aléatoire ; simulateur
  280 étapes sur 280 avec contrôle au pixel (22 captures du guidage) ; branche de vérification sur les vraies données
  du 15/11 : 1 833 lignes et 3 081 trains sans erreur ; graphe piéton de toute la Belgique (extrait de 699 Mo,
  7 009 tuiles, 30 Mo pour un budget de 80, plus grosse tuile 116 ko, construit en 22 s) ; 1 000 marches entre vrais
  arrêts : 99,79 % de vrais chemins entre arrêts de Belgique (arbitré : un arrêt à l'étranger ou au bord de
  l'extrait garde le chemin droit, compté à part ; 98,8 % sur toutes les marches), calcul p95 0,3 ms (2,5 ms tuiles
  comprises), aucun virage à moins de 15 m d'un autre.
- À essayer sur les vraies lunettes (non vérifiable ici) : menu système de l'appui long, écran éteint et angle
  d'affichage, téléphone verrouillé (iPhone avec la position « Toujours », Android), cadence réelle des positions de
  l'appli Even, batterie sur un vrai trajet.
