# Quai 1.2.2 : revue des parcours (lunettes, téléphone, Quai Web)

Revue UX de la 1.2.1 publiée, le 12/11/2026, pour la 1.2.2. Lecteurs : équipes lunettes, téléphone et cœur de la 1.2.2.

Méthode : chaque parcours relu dans le code de la 1.2.1 (`app/src/glasses`, `app/src/phone`, `app/src/web`) et sur les
captures réelles (`tests/e2e/screens`, `app/test/screens`). Place à l'écran et
largeurs mesurées avec les fonctions mêmes de la 1.2.1 (`homeView`, `geometry`, `textWidth`), dans une copie isolée du
dépôt, où les 385 tests d'interface passent. Chaque texte proposé a été mesuré au pixel : il tient dans sa
colonne. Rien n'a été modifié dans le dépôt.

Étiquettes : « Indispensable » (à livrer avec la 1.2.2), « Utile », « Plus tard ». Effort S, M, L. Les textes des
lunettes gardent les espaces insécables habituelles.

## En bref

| N° | Constat | Étiquette | Effort | Risque |
|---|---|---|---|---|
| 1 | L'accueil 1.2.2 ne montre que 2 favoris, parfois aucun | Indispensable | S | faible |
| 2 | « Aller à… » répète « Favoris » | Indispensable | M | moyen |
| 3 | Les anciens chemins vers un arrêt favori ne mènent pas aux nouvelles rubriques | Indispensable | M | moyen |
| 4 | La migration des arrêts n'est ni dite ni complète | Indispensable | S | faible |
| 5 | « Lieux » partout, et deux noms pour la même liste | Indispensable | S | faible |
| 6 | Un nombre à droite de « Gares » et « Bus, tram, métro » | Utile | M | faible |
| 7 | Un favori s'écrit autrement dans la liste que sur l'accueil | Utile | S | faible |
| 8 | Trois façons d'écrire le même bus | Utile | S | faible |
| 9 | Réglages de trajet éparpillés, un sous-titre faux | Utile | S | faible |
| 10 | États vides et erreurs sans issue | Utile | S | faible |
| 11 | « Affichage » : trois réglages qui disent la même chose | Utile | S | faible |
| 12 | Premier lancement sans gare | Plus tard | M | faible |
| 13 | Carte de trajet : la marche dite trois fois | Plus tard | S | faible |

Accueil cible (n° 1, 2 et 6 ensemble) : 8 lignes sous le titre, une de libre pour « En cours » ou une ligne d'état.

```
Quai                                      07:31
Favoris                                       4
   Bureau                maintenant → 08:46
   École                 dans 6 min → 08:05
   Vers Bruxelles-Central        07:48 → 08:21

Autour de moi                          9 arrêts
Gares                           S1 07:55 voie 1
Bus, tram, métro                        W 4 min
```

---

## 1. Accueil 1.2.2 : 9 lignes et 3 favoris (Indispensable)

**Où** : lunettes et Quai Web, accueil. `app/src/glasses/layout.ts` (`geometry`), `views.ts` (`homeView`),
`controller.ts` (`homeShown`).

**Problème** : l'accueil prévu compte 9 lignes (« Favoris », 3 favoris, ligne vide, 4 entrées), mais n'en a que 8 :
la ligne d'aide reste réservée, vide, après les 7 premiers jours. Les favoris prennent ce qui reste. Mesuré (favoris
montrés, 3 au plus) avec la 1.2.1 et deux entrées de plus :

| Situation | 1.2.2 prévue | avec le n° 1 | avec les n° 1 et 2 |
|---|---|---|---|
| Jour ordinaire, après 7 jours | 2 | 3 | 3 |
| 7 premiers jours (aide des gestes) | 2 | 2 | 3 |
| Trajet en cours | 1 | 2 | 3 |
| Ligne du haut (temps réel coupé, hors ligne, horaires d'hier) | 1 | 2 | 3 |
| Ligne du haut et trajet en cours | 0 | 1 | 2 |
| Jour férié, 7 premiers jours | 1 | 1 | 2 |

De plus, pendant un trajet suivi, son favori paraît deux fois : « En cours : vers le bureau » puis « Bureau
maintenant → 08:58 » (capture `s1run-home-running.png`).

**Proposition**
- Sur l'accueil, la ligne d'aide n'existe que si l'aide s'affiche (7 premiers jours). Aucun message temporaire n'est
  donné sur l'accueil (vérifié dans le contrôleur) : rien ne la réclame.
- « Gares » et « Bus, tram, métro » ne paraissent que si elles contiennent au moins un élément.
- Le favori du trajet en cours n'est pas répété sous « Favoris » : la ligne « En cours » le remplace.
- S'il ne reste pas la place d'un favori, la ligne vide saute d'abord. Les entrées ne sont jamais coupées ; la liste
  ne défile toujours pas.

**Textes** : aucun nouveau.

**Critères d'acceptation**
- Jour ordinaire après 7 jours, 3 favoris ou plus, sans ligne du haut : 3 favoris montrés, toutes les entrées visibles.
- Trajet suivi vers « Bureau » : « En cours : vers le bureau » et pas de ligne « Bureau » dessous.
- Aucune rubrique vide affichée ; aucune entrée coupée dans les 6 situations du tableau (un test de vue par situation,
  comme `app/test/glasses/home.test.ts`).
- Simulateur : pied de hauteur nulle accepté (la documentation du SDK permet 0 à 288 px ; sinon 1 px), relief des
  favoris inchangé (CA-121.5).

**Fichiers** : `glasses/layout.ts`, `glasses/views.ts`, `glasses/controller.ts`, `phone/samples.ts` (aperçu
« Affichage »), `app/test/glasses/home.test.ts`, `app/test/ui/layout.test.ts`, oracles de `tests/e2e/sim/run-sim.ts`.
**Effort** S. **Risque** faible.

## 2. « Aller à… » rejoint « Favoris » (Indispensable)

**Où** : lunettes et Quai Web, accueil et écran « Aller à… ». `views.ts` (`placesView`, `homeView`,
`favoritesView`), `controller.ts` (`fetchPlaces`, `goTo`).

**Problème** : « Aller à… » liste les lieux, qui sont des favoris depuis la 1.2, avec la même réponse (même calcul,
`refreshAnswers`) et le même toucher que « Favoris ». Une fois les arrêts partis dans « Gares » et « Bus, tram,
métro », les deux listes ont les mêmes destinations avec deux noms (« Bureau », « Vers le bureau »), deux réponses
(« arrivée 08:46 », « partir maintenant ») et deux états (« ici », « tu y es ») : captures `waterloo-places.png` et
`waterloo-favorites.png`. C'est le reste de « Mes lieux », que la 1.2 voulait fondre dans les favoris ; son état vide
dit encore « Aucun lieu enregistré ». Seuls apports propres : 3 adresses récentes et « Autre adresse ».

**Proposition** : plus de ligne « Aller à… » sur l'accueil. La liste ouverte par « Favoris » finit par une ligne
vide, les adresses récentes (une ligne chacune, réponse au format de l'accueil), puis « Autre adresse ». Toucher une
adresse récente ouvre ses étapes, comme aujourd'hui. L'écran `places` reste lisible pour un état gardé par la 1.2.1.
Repli si l'équipe garde la ligne : « Aller à… » ne montre plus les favoris, seulement les adresses récentes et
« Autre adresse ».

**Textes**
- adresse récente : « {adresse courte}   07:40 → 08:51 » ; sur place : « tu y es » ;
- « Autre adresse   sur le téléphone » (Quai Web : « Autre adresse   dans Réglages »), inchangés ;
- liste vide : « Aucun favori pour l'instant. » / « Ajoute Maison ou Bureau sur le téléphone. » (Quai Web : « Ajoute
  Maison ou Bureau dans l'onglet Réglages. »).

**Critères d'acceptation**
- L'accueil n'a plus « Aller à… » ; « Favoris » ouvre les favoris, puis les adresses récentes (3 au plus, jamais
  celle d'un favori, règle `recentShown`), puis « Autre adresse ».
- Toucher une adresse récente ou « Autre adresse » : même effet qu'en 1.2.1.
- Un état d'arrière-plan sur l'écran `places` s'ouvre sans erreur.

**Fichiers** : `glasses/views.ts`, `glasses/controller.ts`, `glasses/types.ts`, `phone/samples.ts`,
`docs/MISE-A-JOUR.md`, tests `app/test/glasses`, scénarios du simulateur qui ouvrent « Aller à… ».
**Effort** M. **Risque** moyen : une habitude change (le message du n° 4 le dit), tests et scénarios à revoir.

## 3. Garder une gare ou une ligne par les anciens chemins (Indispensable)

**Où** : lunettes, départs d'un arrêt (`boardView`, `toggleFavoriteStop` dans `controller.ts`) ; téléphone,
« Nouveau favori », choix « Un endroit » (`placeChoice` dans `phone/screens/favorite-edit.ts`).

**Problème** : deux chemins de la 1.2.1 créent encore un « arrêt favori », que la 1.2.2 range ailleurs. Sur les
lunettes, toucher des départs (« toucher : ★ favori ») garde un arrêt entier, pas une ligne. Sur le téléphone, une
gare ou un arrêt choisi dans « Un endroit » donne par défaut « Ses prochains départs » (capture
`phone-station-choice.png`), en doublon avec « choisir une gare » et « choisir une ligne ». La liste vide des lunettes
promet encore « Ouvre un arrêt dans Autour de moi et touche-le ».

**Proposition**
- Départs d'une gare SNCB : toucher garde ou retire la gare dans « Gares », avec les règles d'aujourd'hui (« ★ » en fin
  de titre, retrait annulable 5 s).
- Départs d'un arrêt de bus, tram ou métro : toucher ouvre la liste des lignes de l'arrêt (`linesAt`), « ★ » à droite
  de celles déjà gardées ; toucher garde ou retire la ligne à cet arrêt, dans les deux sens, comme sur le téléphone ;
  double toucher revient aux départs. « ★ » en fin de titre des départs si une ligne de l'arrêt est gardée.
- Téléphone, « Un endroit » : une gare ou un arrêt donne toujours un lieu (« Le trajet pour y aller ») ; le choix
  « Dans les lunettes » disparaît ; un lien au-dessus du formulaire mène à la bonne rubrique.

**Textes**
- aide, gare : « ▲▼ départs   toucher : ★ garder la gare   double : retour » ; gare gardée : « ▲▼ départs
  toucher : ★ retirer la gare   double : retour » ;
- messages : « ★ Ajoutée à tes gares », « ★ Retirée. Toucher encore : annuler », « ★ Gare rétablie » ;
- aide, arrêt : « ▲▼ départs   toucher : ★ lignes   double : retour » ;
- liste des lignes : titre « {arrêt} : garder une ligne » ; lignes « tram 3 », « bus 58 », « ★ » à droite si gardée ;
  aide « ▲▼ choisir   toucher : ★ garder ou retirer   double : retour » ;
- téléphone, gare : lien « Ses prochains départs : ajouter {gare} à Gares », puis « {gare} ajoutée à Gares. » ;
  arrêt : « Ses prochains passages : choisir une ligne dans Bus, tram, métro » (arrêt présélectionné à la 2e étape).

**Critères d'acceptation**
- Après chacun de ces chemins, aucun favori `kind: 'stop'` dans les réglages ; la gare ou la ligne paraît dans sa
  rubrique, sur les lunettes et sur le téléphone.
- Gare : ajout, retrait et annulation dans les 5 s à l'identique (CA-M6.1 de la 1.1).
- Ligne gardée depuis les lunettes : ses deux sens dans « Bus, tram, métro » ; double toucher revient aux départs.
- Aides mesurées : 424 à 499 px pour 542.

**Fichiers** : `glasses/views.ts`, `glasses/controller.ts`, `glasses/format.ts` (`HINTS`), `glasses/types.ts`
(écran des lignes), `phone/screens/favorite-edit.ts`, `phone/text.ts`, tests `app/test/glasses`,
`app/test/phone/favorites.test.ts`.
**Effort** M. **Risque** moyen : un petit écran de plus ; le toucher change de sens sur les départs de bus, tram, métro.

## 4. Dire la migration et ne rien perdre (Indispensable)

**Où** : message des lunettes (`NEWS_TITLE`, `newsLines` dans `views.ts`, `NEWS_SINCE` dans `controller.ts`),
bannière du téléphone (`newsLines` dans `phone/text.ts`), migration (`app/src/settings.ts`, équipe cœur), alerte
travaux (chargement des départs dans `controller.ts`).

**Problème** : à la mise à jour, les arrêts favoris quittent « Favoris » sans un mot. Trois réglages de la 1.2.1 en
dépendent : lignes et directions choisies (`fixtures/app/preset.json` : « Gare du Nord », tram 3 dans les deux sens et
tram 4 vers Stalle), « Quand je suis à moins de 300 m » qui ouvre les départs d'office (`homeNav`), et « Travaux et
déviations sur tes lignes favorites », calculé seulement pour un arrêt favori.

**Proposition** : un message « Quai 1.2.2 » une fois après la mise à jour (jamais après une installation neuve), la
même chose sur la bannière ; une migration qui garde lignes, directions, ouverture d'office et ordre ; l'alerte
travaux sur les gares et lignes gardées.

**Textes**
- lunettes, titre « Quai 1.2.2 » : « Nouveau : tes gares et tes lignes sur l'accueil. » / « Tes arrêts favoris y sont
  rangés, rien n'est perdu. » / avec le n° 2 : « Aller à… a rejoint Favoris. » ; aide « toucher : continuer » ;
- bannière du téléphone : « Nouveau : tes gares et tes lignes de bus, tram et métro sur l'accueil des lunettes. » /
  « Tes arrêts favoris y sont rangés, rien n'est perdu. » / avec le n° 2 : « Dans les lunettes, Aller à… a rejoint
  Favoris. » / bouton « OK » ;
- « Alertes », sous-titre de « Travaux et déviations » : « sur tes gares et tes lignes » ;
- `app/store/changelog/1.2.2.txt` sur le même fond.

**Critères d'acceptation**
- Message une seule fois depuis la 1.2.1, la 1.2.0 ou la 1.1 ; rien après une installation neuve ; mêmes lignes sur
  Quai Web (comme CA-121.8).
- `preset.json` migré : tram 3 et tram 4 gardés à « Gare du Nord », toujours ouverts d'office à moins de 300 m ;
  « Namur » et « Bruxelles-Nord, bus De Lijn » dans leur rubrique ; une seconde migration ne change rien.
- Ligne gardée avec « Travaux et déviations » activé : la ligne « ! … » des départs paraît comme en 1.2.1.

**Fichiers** : `glasses/views.ts`, `glasses/controller.ts`, `phone/text.ts`, `phone/screens/alerts.ts`,
`app/src/settings.ts` et `app/test/ui/settings.test.ts` (cœur), `app/store/changelog/1.2.2.txt`,
`docs/MISE-A-JOUR.md`.
**Effort** S. **Risque** faible.

## 5. Plus de « lieux », un seul nom par liste (Indispensable)

**Où** : lunettes et Quai Web, bienvenue (`firstRunView`), liste vide (`emptyFavoritesLines`), titre de la liste
(`favoritesView`) ; téléphone, « Où vas-tu ? » (`T.wherePlaceholder`), suggestions (`phone/field.ts`), « Mes favoris »
(`T.favsLead`), formulaire d'un lieu (`T.needName`), « Données » (`phone/screens/data.ts`).

**Problème** : depuis la 1.2 les lieux sont des favoris, mais sept textes disent encore « lieu » : « Position, langue
et tes lieux, en une minute. » (première ouverture, `firstrun-welcome.png`), « Aucun lieu enregistré », « mon lieu »,
« Adresse, gare, arrêt ou lieu », « Trajets vers tes lieux », « Donne un nom au lieu. », « Tes lieux, tes arrêts et
tes trajets. ». Et la liste s'appelle « Favoris » sur l'accueil, « Mes favoris » une fois ouverte.

**Proposition et textes**
- bienvenue : « Position, langue et tes favoris, en une minute. » (Quai Web : « position, langue et tes favoris, en
  une minute. ») ;
- titre de la liste des lunettes : « Favoris », comme la ligne de l'accueil, « Gares » et « Bus, tram, métro » ;
- liste vide : textes du n° 2 ;
- téléphone : « Adresse, gare, arrêt ou favori » ; suggestion de type « favori » ; « Tes endroits et tes trajets de A
  à B. En tête dans les lunettes selon l'heure et ta position (réglage Affichage). » ; « Donne un nom à cet endroit. » ;
  « Données » : « Trajets vers tes favoris   prêts pour aujourd'hui ».

**Critères d'acceptation** : aucun texte affiché ne contient « tes lieux », « lieu enregistré » ou « mon lieu » (test
de recherche dans les textes) ; titre « Favoris » sur les lunettes et Quai Web ; bienvenue mesurée à 395 px.

**Fichiers** : `glasses/views.ts`, `phone/text.ts`, `phone/field.ts`, `phone/screens/data.ts`,
`app/test/phone/text.test.ts`, `app/test/glasses`.
**Effort** S. **Risque** faible.

## 6. « Gares » et « Bus, tram, métro » : le prochain départ plutôt qu'un nombre (Utile)

**Où** : accueil des lunettes et de Quai Web, lignes des deux rubriques de la 1.2.2.

**Problème** : « Gares   2 » ne dit rien qu'on ne sache déjà (la revue 1.0.1 le relevait pour « Mes favoris   5 »).
En 1.2.1, le prochain train d'une gare favorite pouvait être lu sur l'accueil sans geste (capture g01) ; en 1.2.2, il
faut un toucher de plus.

**Proposition** : à droite de chaque rubrique, le prochain départ de son élément le plus proche (ou du seul ; sans
position, le premier de la liste), au format des arrêts favoris de l'accueil 1.2.1 (`stopHomeText`), rafraîchi avec
l'accueil. Plus de nombre.

**Textes** : « Gares   S1 07:55 voie 1 » ; « Bus, tram, métro   W 4 min » ; « … » pendant le calcul ; « aucun
départ ».

**Critères d'acceptation** : colonne de droite de 210 px au plus (forme courte « v.1 » au besoin, comme en 1.2.1) ;
même départ que la première ligne de la rubrique ouverte ; une seule requête de départs par rubrique et par
rafraîchissement (30 s).

**Fichiers** : `glasses/views.ts` (`homeView`), `glasses/controller.ts` (`homeData`, `refreshHome`),
`glasses/format.ts`.
**Effort** M. **Risque** faible.

## 7. La liste « Favoris » au format de l'accueil (Utile)

**Où** : lunettes et Quai Web, liste ouverte par « Favoris » (`favoriteItem` dans `views.ts`, `tripAnswerLine` et
`tripSecondLine` dans `format.ts`).

**Problème** : un même favori s'écrit « Bureau   maintenant → 08:46 » sur l'accueil, puis « Vers le bureau   partir
maintenant » et « Bus W à ~07:36, 1 changement, arrivée 08:46 » dans la liste (captures g01 et
`waterloo-favorites.png`) : deux noms, deux façons de dire l'heure.

**Proposition** : ligne 1 comme l'accueil (nom de `homeFavoriteName`, réponse de `tripHomeText`) ; ligne 2, plus
pâle, le détail sans l'arrivée déjà dite : premier véhicule et son heure, voie, changements. Colonne de droite de
210 px, comme « Autres trajets ».

**Textes** : « Bureau   maintenant → 08:46 » / « bus W 07:36, 1 changement » ; « Vers Gand-Saint-Pierre   14:10 →
14:39 » / « IC voie 4 à Bruxelles-Central » ; « Maison   tu y es ».

**Critères d'acceptation** : pour chaque favori, la ligne 1 de la liste est identique à sa ligne de l'accueil ;
« demain 06:20 → 06:46 » tient (201 px) ; « ~ » seulement en ligne 2, avec la note du bas.

**Fichiers** : `glasses/views.ts`, `glasses/format.ts`, `glasses/layout.ts`, `app/test/glasses`,
`app/test/ui/views.test.ts`.
**Effort** S. **Risque** faible.

## 8. Un véhicule s'écrit partout de la même façon (Utile)

**Où** : étapes (`vehicleOf` dans `stepRows`), « Dans le train » (`trainTitle`), « En cours » (`runningNext`), liste
des favoris (`vehicleName`), « Autres trajets » et cartes du téléphone (`rideName`, `core/means.ts`).

**Problème** : le même bus est « W » dans les étapes, « bus W » dans « Autres trajets », « Bus W » dans la liste des
favoris ; le métro « M2 » et « métro 2 » (captures g02 et g04). Sur un même accueil, un même train s'écrit « IC 07:44,
voie 6 » (« En cours ») et « IC 07:42 +2 voie 6 ! » (gare favorite), capture `s1run-home-running.png`. La rubrique de
lignes de la 1.2.2 demande une règle avant d'être écrite.

**Proposition** : dans une phrase ou une liste de moyens, le mot et le numéro (`rideName`), majuscule en début de
ligne d'étape ; dans une colonne étroite (départs, « Autour de moi », droite de l'accueil), le code court
(`lineLabel`). Un train : heure prévue, retard, voie, « ! » si la voie change, comme sur les départs.

**Textes** : étapes « ~07:36   Bus W vers Bruxelles Midi », « ~08:29   Métro 2 vers Simonis (Elisabeth) »,
« Tram 3 vers Churchill » ; « En cours : vers le bureau   IC 07:42 +2 voie 6 ! » ; liste « bus W 07:36 » ;
colonnes inchangées (« T3 2 min », « W 4 min »).

**Critères d'acceptation** : une fonction pour les phrases, une pour les colonnes ; étapes dans 342 px (« Métro 2
vers Simonis (Elisabeth) » : 279 px) ; « En cours » et la ligne d'une gare donnent la même heure pour un même train.

**Fichiers** : `glasses/format.ts`, `glasses/views.ts`, `core/means.ts` (lecture, ou demande au cœur), tests à textes
attendus (`app/test/glasses/steps.test.ts`, `app/test/ui/format.test.ts`, oracles du simulateur).
**Effort** S. **Risque** faible.

## 9. Réglages de trajet au même endroit (Utile)

**Où** : téléphone et Quai Web : « Marche maximale » en bas de « Mes favoris » (`phone/screens/favorites.ts`,
capture p04) ; « Marge avant de partir » dans « Alertes » (`phone/screens/alerts.ts`, capture `phone-alerts.png`).

**Problème** : deux réglages qui changent les trajets proposés sont rangés dans deux écrans sans rapport. La marge est
comprise dans l'heure conseillée (`recompute` dans `core/journeys.ts`, `withAccessWalk` dans `core/favorites.ts`) :
elle change « maintenant → 08:46 » même alerte coupée, et le sous-titre « 2 min avant l'heure conseillée » dit le
contraire (déjà relevé par la revue 1.0.1, n° 31). En 1.2.2, « Mes favoris » ne contiendra plus que des endroits et
des trajets : la marche maximale y sera encore moins attendue.

**Proposition** : une ligne « Trajets » dans Réglages, sous « Position et langue », avec les deux réglages ;
« Alertes » ne garde que les alertes.

**Textes** : ligne « Trajets », sous-titre « Marche 10 min au plus, marge 2 min » ; écran « Trajets » : « Marche
maximale » (sous-titre actuel gardé), « Marge avant de partir » avec le sous-titre « comprise dans l'heure de départ
conseillée » ; « Alertes » : « Heure de partir à pied », sous-titre « à l'heure de départ conseillée ».

**Critères d'acceptation** : chaque réglage à un seul endroit ; mêmes clés de réglages, aucune migration ; Quai Web
identique ; plus de « 2 min avant » sous l'alerte.

**Fichiers** : `phone/screens/home.ts`, `phone/app.ts` (route `#/trajets`), nouvel écran `phone/screens/trips.ts`,
`phone/screens/favorites.ts`, `phone/screens/alerts.ts`, `phone/text.ts`, `app/test/phone`.
**Effort** S. **Risque** faible.

## 10. États vides et erreurs qui donnent une issue (Utile)

**Où** : lunettes et Quai Web : erreur au lancement (`MESSAGES.dataUnreachable`, `core/errors.ts`), « Autour de moi »
vide (`nearbyView`).

**Problème** : « Horaires injoignables : nouvel essai dans 30 s » (`errors-data-unreachable.png`) : « injoignables »
se dit d'une personne, et le cas courant est un téléphone sans réseau. « Aucun arrêt dans un rayon de 500 m »
(`errors-nearby-empty.png`) n'offre que le retour, alors qu'un arrêt est souvent juste au-delà du rayon réglé.

**Proposition** : un texte simple pour l'erreur ; « Autour de moi » vide cherche l'arrêt le plus proche jusqu'à 3 km
(recherche légère, comme le compte de l'accueil) et ouvre ses départs au toucher.

**Textes** : « Pas de connexion aux horaires : nouvel essai dans 30 s » (481 px) ; « Aucun arrêt à moins de 500 m. »
/ « Le plus proche : {arrêt}, à 1,2 km. » ; aide « toucher : ses départs   double : retour » ; rien à 3 km :
« Rayon réglable sur le téléphone : Affichage. » (Quai Web : « Rayon réglable dans l'onglet Réglages : Affichage. »).

**Critères d'acceptation** : textes dans 542 px ; le toucher ouvre les départs de l'arrêt nommé ; aucune requête en
plus quand la liste n'est pas vide.

**Fichiers** : `core/errors.ts` (cœur), `glasses/views.ts`, `glasses/controller.ts` (chargement de `nearby`),
`app/test/glasses`, `tests/e2e/robustness.test.ts`.
**Effort** S. **Risque** faible.

## 11. « Affichage » : trois réglages qui disent la même chose (Utile)

**Où** : téléphone et Quai Web, « Affichage » (`phone/screens/display.ts`, capture `phone-display.png`) et créneau de
chaque favori (`PROPOSE_LABEL`, `PROPOSE_TEXT`, `T.proposeLegend` dans `phone/text.ts`).

**Problème** : « Mes favoris en tête, selon l'heure et le lieu » (ouverture), « Selon l'heure et le lieu » (ordre) et
« Le proposer à l'ouverture » (chaque favori) parlent de la même chose avec les mêmes mots ; avec « Dans mon ordre »,
le premier libellé devient faux. « Le proposer à l'ouverture » date de la ligne de suggestion de la 1.0 : le créneau
met aujourd'hui le favori en tête de l'accueil, et « Jamais » laisse en fait l'ordre automatique décider.

**Proposition** : renommer, sans rien changer au fonctionnement.

**Textes**
- « À l'ouverture de Quai » : « L'accueil, avec mes favoris en tête » / « Directement mon premier favori » / « L'accueil,
  sans favoris » ;
- « Ordre des favoris » : « Automatique, selon l'heure et ta position » / « Dans mon ordre » ;
- chaque favori, légende « En tête de l'accueil » : « Automatique » (ancien « Jamais ») / « Le matin (5 h à 11 h) » /
  « Le soir (15 h à 21 h) » / « L'ouvrir d'office à moins de 300 m » ;
- sous-titres de la liste : « en tête le matin », « en tête le soir », « ouvert d'office à moins de 300 m ».

**Critères d'acceptation** : mêmes valeurs enregistrées (`never`, `morning`, `evening`, `near`) ; aucun libellé avec
« proposer » ; tests de textes à jour.

**Fichiers** : `phone/screens/display.ts`, `phone/text.ts`, `phone/screens/favorite-edit.ts`,
`phone/screens/places.ts`, `app/test/phone/display.test.ts`, `app/test/phone/favorites.test.ts`.
**Effort** S. **Risque** faible.

## 12. Premier lancement : proposer sa gare (Plus tard)

**Où** : téléphone et Quai Web, étape « Tes favoris » (`yourFavoritesScreen` dans `phone/screens/onboarding.ts`).

**Problème** : la 1.2.2 ajoute « Gares » à l'accueil, mais le premier lancement ne demande que Maison et Bureau : la
rubrique reste vide, donc absente de l'accueil (n° 1), jusqu'à ce qu'on la trouve sur le téléphone.

**Proposition** : un troisième champ facultatif, « Ta gare », rempli d'office avec la gare la plus proche de
« Maison » quand elle est à 15 min à pied au plus.

**Textes** : libellé « Ta gare » ; texte d'exemple « Gare de départ habituelle » ; sous le champ « Facultatif. Elle
sera dans Gares, sur l'accueil des lunettes. » ; proposition « {gare}, à 8 min à pied de Maison ».

**Critères d'acceptation** : « Terminer » ajoute la gare à « Gares » ; « Plus tard » ne crée rien ; aucune gare
proposée au-delà de 15 min.

**Fichiers** : `phone/screens/onboarding.ts`, `app/test/phone/onboarding.test.ts`.
**Effort** M. **Risque** faible.

## 13. Carte de trajet : la marche dite trois fois (Plus tard)

**Où** : téléphone et Quai Web, résultats d'une recherche (`summaryText` et `meansLine` dans `phone/text.ts`,
capture p03).

**Problème** : une même carte dit « 7 min à pied » (résumé), « à pied 2 + 2 + 3 min » (moyens) et reparle de marche
dans sa phrase : six lignes d'information par carte.

**Proposition** : le résumé ne donne plus la marche quand la ligne des moyens la détaille ; trajet à pied inchangé.

**Textes** : « 1 h 14, 1 changement » ; « bus W + métro 2, à pied 2 + 2 + 3 min » inchangé.

**Critères d'acceptation** : la marche n'apparaît que dans la ligne des moyens et la phrase ; trajet à pied : « 22 min
à pied » inchangé.

**Fichiers** : `phone/text.ts`, `app/test/phone/cards.test.ts`, `app/test/phone/qa-cards.test.ts`.
**Effort** S. **Risque** faible.

---

## Hors périmètre, à transmettre

- Routage : dans « Autres trajets », « Plus tard 08:33 → 09:57 » arrive avant « Le suivant 08:33 → 10:02 » (capture
  `s1-others.png`). Le nom des propositions est à revoir avec le banc d'essai, pas dans cette revue.
- Accueil sans « ~ » (PRD-1.2.1 § 4.3) : décision gardée ; le n° 6 suit la même règle.
