# Quai 1.2.2 : cahier produit

Décisions du propriétaire du 12/11/2026 (nuit), arbitrées par l'équipe. Contrat de code : app/src/core/api.ts
(réglages v4, StationPick, LinePick, LineBoard, LineMatch, LineStop, findLines, lineStops, lineBoard).
Règle de confidentialité : jamais d'adresse ni de position personnelle dans le dépôt, les tests ou les captures ; des
gares, des arrêts et des lieux publics seulement.

## 1. Accueil des lunettes et Favoris

1.1 Accueil, dans cet ordre (une ligne par entrée, le nombre à droite au plus clair) :
- « En cours : … » seulement pour un trajet suivi (§ 6) ;
- « Favoris   N » (N = nombre de favoris), puis jusqu'à 3 favoris du moment en retrait et plus pâles (comme en 1.2.1) ;
- ligne vide ;
- « Autour de moi   9 arrêts » ;
- « Gares » avec à droite le prochain train de la gare choisie la plus proche (§ 8, n° 6) ; sans gare choisie :
  « Gares   à choisir » ;
- « Bus, tram, métro » avec à droite le prochain passage de la ligne choisie la plus proche ; sans ligne choisie :
  « Bus, tram, métro   à choisir ».
« Aller à… » disparaît de l'accueil : son contenu rejoint la liste des favoris (§ 1.2). L'accueil tient sur un écran
(9 lignes) avec 3 favoris, même un jour férié pendant un trajet en cours : « En cours » prend la ligne de son propre
favori, la ligne d'aide n'existe que pendant les 7 premiers jours, et la ligne vide saute la première s'il manque de la
place (§ 8, n° 1).

1.2 Liste « Favoris » (titre « Favoris ») : tous les favoris (lieux et trajets) dans l'ordre choisi (ordre intelligent
ou ordre du téléphone, comme en 1.2.1), puis, s'il y en a, les adresses récentes (3 au plus, comme dans l'ancien
« Aller à… », avec leur réponse à droite), puis « Autre adresse   sur le téléphone ». Sans favori : « Ajouter un
favori » en premier. Un séparateur discret précède les adresses récentes (ligne pâle « Adresses récentes »), non
sélectionnable.

1.3 Entrées vides : « Gares   à choisir » au toucher affiche « Choisis tes gares dans Quai, sur le téléphone » ;
« Bus, tram, métro   à choisir » affiche « Choisis tes lignes dans Quai, sur le téléphone ». Dans Quai Web, le toucher
ouvre directement la bonne section de l'onglet Réglages.

## 2. Gares (lunettes)

- Seulement les gares choisies sur le téléphone, dans leur ordre ; une ligne par gare : son nom, et à droite son
  prochain train (« 07:42 v.6 », retard et voie modifiée signalés comme dans « Autour de moi »).
- Toucher une gare ouvre son tableau complet (le tableau des départs existant) ; double toucher revient à « Gares ».
- Gare sans train dans l'horizon des tableaux : « aucun train » à droite.

## 3. Bus, tram, métro (lunettes)

- Seulement les lignes choisies sur le téléphone, chacune à son arrêt, dans leur ordre. Pour chaque ligne : une ligne
  de titre (« Bus W · Merbraine », au plus clair), puis un sens par ligne, en retrait et plus pâle : « vers Bruxelles
  Midi » et à droite les 2 prochains passages (« 3 · 18 min » ; « imminent », « ~4 min » sans temps réel, « SUPPRIMÉ »,
  l'heure au-delà de 60 min, comme les tableaux).
- Les deux sens sont toujours affichés (un seul au terminus ou pour une boucle). Une ligne qui a plusieurs terminus à
  l'arrêt est rangée en deux sens (lineBoard) ; le sens porte son terminus principal de la journée, le même du matin
  au soir. Un passage qui s'arrête avant
  (« jusqu'à Vallée Bailly ») n'est jamais présenté comme allant au terminus : il est marqué et son terminus est dit,
  au moins dans le détail.
- Toucher une ligne ouvre son détail : pour chaque sens, le terminus puis les 4 prochains passages (heure, attente,
  temps réel, terminus si différent), puis « Tous les départs de l'arrêt » (le tableau de l'arrêt).
- Ligne sans filtre (arrêt favori de la 1.2.1 sans filtre, migré) : titre « Gare du Nord · toutes les lignes », une
  ligne avec les 2 prochains départs ; toucher ouvre le tableau de l'arrêt.
- Ligne qui ne passe plus à l'arrêt : « introuvable : modifie-la sur le téléphone ».

## 4. Téléphone et Quai Web (réglages)

- Accueil du téléphone : sous « Mes favoris », deux sections « Gares » et « Bus, tram, métro », avec leurs éléments
  (nom, et pour une ligne « Bus W · Merbraine »), un bouton pour retirer (confirmé dans la page), « Monter » et
  « Descendre » comme pour les favoris, et « Ajouter une gare », « Ajouter une ligne ». 32 gares et 32 lignes au plus
  (la limite des favoris : la migration ne perd jamais un arrêt).
- « Ajouter une gare » : champ de recherche limité aux gares SNCB (search() filtré), les plus proches d'abord si la
  position est connue ; un toucher ajoute ; une gare déjà choisie est signalée « Déjà dans tes gares ».
- « Ajouter une ligne », en deux temps : 1. « Numéro de la ligne » (W, 36, 71…) : les lignes trouvées (findLines),
  « Bus W TEC, Braine-l'Alleud ↔ Bruxelles Midi », les plus proches d'abord ; 2. « À quel arrêt ? » : ses arrêts
  (lineStops), le plus proche d'abord, avec un champ pour filtrer. Un toucher ajoute et confirme : « Bus W à Merbraine
  ajouté : les deux sens s'afficheront dans les lunettes. »
- Quai Web : les mêmes sections dans l'onglet Réglages.
- Le téléphone ne crée plus d'arrêt favori ; « Un endroit » (lieu) et « Un trajet de A à B » restent.

## 5. Réglages v4 et migration

- Réglages v4 : `stations` (StationPick) et `lines` (LinePick), 32 au plus chacune, dans l'ordre choisi ; `near` garde
  l'ouverture d'office à moins de 300 m d'un arrêt favori de la 1.2.1.
- Migration v3 vers v4 (settings.ts, moveStops) : un arrêt favori SNCB devient une gare ; un arrêt favori d'un autre
  réseau devient une ligne par ligne de son filtre, ou une « toutes les lignes » sans filtre. Il quitte les favoris.
  Rien n'est perdu ni doublé ; l'ordre est gardé.
- Le message de nouveautés le dit une fois (§ 9).

## 6. Trajet suivi seulement sur demande

Constat du propriétaire : des trajets qu'il ne suit pas s'affichent « En cours ». Cause : ouvrir un favori ou un lieu
faisait de sa proposition 1 le trajet suivi, qui passait « En cours » à l'heure du départ.
- Ouvrir un trajet (favori, lieu, adresse) ne le fait plus suivre. Un trajet n'est suivi que sur demande : toucher
  « Suivre ce trajet » sur son écran (toutes les propositions, la 1re comprise), ou le bouton « Lunettes » du téléphone.
- L'écran d'un trajet dit clairement s'il est suivi (« Suivi ») ou propose de le suivre, sans dépendre de l'aide des
  gestes (qui disparaît après 7 jours). Sur le trajet suivi, toucher propose d'arrêter le suivi (« Ne plus suivre »).
- Un trajet gardé par la 1.2.1 sans demande explicite n'est pas repris comme suivi.

## 7. Classement des trajets

Règle, pour l'usager : « Le premier trajet est celui qui arrive le plus tôt ; au-delà de ta marche maximale, chaque
minute à pied compte triple. » Elle remplace, partout (favoris, adresses, recherche du téléphone, Quai Web, accueil),
les paliers de marche, « le plus rapide à 5 min près », le garde-fou de 30 min et les filtres de la 1.2.1 (trajets
dominés, correspondance inutile). Choisie sur le banc d'essai (calcul exhaustif interne, `bench/oracle` ; méthodes
d'OTP, MOTIS et Navitia) ; mesures : `docs/v1.2.2/BANC-ESSAI-1.2.2.md` (rapport de `bench/oracle/report.ts`).

7.1 Coût d'un trajet, en minutes : arrivée + 3 × (plus longue marche − marche maximale, si elle dépasse) + 1 par
changement. Une marche jusqu'à la marche maximale ne coûte que son temps ; la marche seule a pour plus longue marche sa
durée. Proposition 1 (`short`) : le coût le plus bas ; à égalité, le moins de changements, puis la plus courte plus
longue marche, la marche totale la plus courte, le départ le plus tard, puis la garde du § 7.4 : à arrivée, plus
longue marche et changements égaux, le trajet qui part plus tard prend la place de celui de l'heure demandée, même
s'il part après elle (le dernier tram qui fait la correspondance, jamais 50 min d'attente pour le même train).

7.2 Paramètres : 3 par minute de marche de trop, 1 par changement. Candidats : départ dans l'heure demandée (sans
départ dans l'heure : recherche sur 12 h, puis jusqu'à 90 min après le premier départ possible), 3 véhicules et une
correspondance entre lignes urbaines au plus, attente de 60 min au plus en correspondance, marche seule de 30 min au
plus (60 min s'il n'y a aucun trajet en véhicule). Deux garanties, vraies quels que soient les candidats : la
proposition 1 n'est jamais dominée (un trajet aussi bon sur l'arrivée, la plus longue marche et les changements ne
coûte pas plus et gagne les égalités) ; jamais une marche absurde (6 min de trop coûtent 18 min, plus que 15 min de
retard et deux changements).

7.3 Autres propositions : deux au plus, chacune avec un gain visible sur la proposition 1, dans cet ordre :
- « Plus tôt » (`earlier`) : le trajet qui arrive le plus tôt, s'il arrive au moins 5 min avant elle (souvent en
  marchant plus) ; la marche seule n'est proposée qu'ainsi ou en proposition 1 ;
- « Moins de marche » (`lesswalk`), seulement si la plus longue marche de la proposition 1 dépasse la marche maximale :
  parmi les trajets arrivés au plus 20 min après elle, celui dont la plus longue marche est la plus courte, s'il tient
  dans la marche maximale ou marche au moins 5 min de moins ;
- « Sans changement » ou « Moins de changements » (`none`, `fewer`) : le meilleur coût des trajets qui changent moins,
  arrivés au plus 15 min après elle, sans marcher plus qu'elle au-delà de la marche maximale.
Puis, jusqu'à 3 propositions : « Le suivant » (`next`, une seule fois : même structure, départ suivant dans les 2 h ;
à arrivée égale, le dernier premier véhicule qui fait la correspondance), puis les départs suivants de même structure
qui complètent la liste, dans l'ordre des départs, et « Plus tard » (`later` : le meilleur coût des trajets partis et
arrivés après les propositions précédentes ; jamais un trajet devancé de plus de 30 min par un trajet parti au plus
30 min avant), tous nommés « Plus tard ». « Plus tard » part et arrive donc toujours après « Le suivant » (§ 8).
Noms et raisons : PRD-1.2.1 § 2, inchangés (la proposition 1 s'appelle « Moins de marche » quand « Plus tôt » marche
plus qu'elle), sauf « Le suivant » remplacé par un trajet d'autres lignes (§ 7.4) : « Le suivant : 1 h plus tard »,
sans « même trajet » ; étiquettes et contrat (`api.ts`) inchangés ; l'étiquette `walk` n'est plus donnée.

7.4 Gardes : aucune proposition, la première comprise, n'est dominée par un candidat, affiché ou non (départ plus
tard ou égal, arrivée, plus longue marche et changements pas pires, l'un meilleur) ; sinon un candidat qui la domine,
et que rien ne domine, prend sa place dans le même rôle (scénario 1 : « Le suivant » est l'IC de 08:42 puis le T4,
arrivée 09:57, pas l'IC puis le T3, arrivée 10:02), puis les autres gardes s'appliquent à lui, sinon le candidat
suivant du rôle : jamais deux propositions de la même suite de lignes, sauf « Le suivant » et les départs suivants de
même structure ; la marche seule seulement en proposition 1 ou « Plus tôt » ; 3 propositions au plus.

7.5 Corrections du moteur (`app/src/core/routing`), nécessaires quelle que soit la règle :
1. calcul multicritère (`raptor.ts`) : pour chaque nombre de véhicules, les trajets non dominés sur l'arrivée et la plus
   longue marche (à égalité, la marche totale), en une passe aux rayons de la recherche élargie, sans passes par
   palier ; à heure égale, le trajet qui marche le moins ; on ne monte plus loin sur le premier véhicule que pour partir
   plus tard sans marcher plus ;
2. lignes chargées (`select.ts`) : aussi les lignes de métro dont une gare est à 10 km au plus d'une extrémité (STIB 1,
   2, 5 et 6 ; métro de Charleroi), que les lignes du milieu ne prennent pas toujours ;
3. `engine.ts` : plus de filtre « jamais plus lent que la marche seule » ni de raccourci « marche seule » ; la marche
   seule concourt avec sa propre marche ; « Tu es déjà … » à 300 m gardé ; aucun arrêt autour d'une extrémité : la
   marche seule si elle dure 30 min au plus ;
4. un seul classement sur tous les candidats : le temps réel remplace les heures des trajets qu'il touche
   (propositions, 3 réserves au coût, premiers véhicules déjà partis à l'heure prévue), il ne réduit pas l'ensemble ;
   une proposition encore sans temps réel le reçoit avant le dernier classement ; pour la garde du § 7.4, une recherche
   de 30 min à partir des deux premiers départs suivants de la proposition 1 partis après l'heure demandée (un trajet
   d'autres lignes qui les domine est ainsi un candidat) ;
5. bus de remplacement de la SNCB (catégorie « BUS », nombreux le samedi 14/11) : des véhicules comme les autres ;
   l'étape dit mode « bus », comme les départs des gares, et « bus SNCB » dans les phrases (`means.ts` : `rideName`,
   `meansText`) ; les colonnes étroites gardent leur code court.

7.6 Résultats, mesurés contre le calcul exhaustif interne (indépendant du moteur, tout l'instantané) : 150 cas du banc
(13 et 14/11) et 100 cas hors échantillon (11 et 12/11), sans temps réel. Proposition 1 dominée : un trajet de l'oracle
fait mieux d'au moins 2 min ou d'un changement sans faire moins bien ; marche absurde, oubli, étiquettes : contrôles du
rapport interne ; une proposition dominée (garde du § 7.4) : l'une des propositions au moins dominée par un trajet de
l'oracle ou la marche seule, départ compris ; retard : minutes après l'arrivée la plus tôt de l'ensemble.

| Marche maximale 5 min | Dominée | Marche absurde | Oubli | Étiquettes | Une proposition dominée | Retard moyen (p90) | Plus longue marche | Changements |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Banc, 1.2.1 | 4,0 % | 1,3 % | 2,0 % | 2,0 % | 25,3 % | 1,08 (3) | 2,25 | 0,66 |
| Banc, 1.2.2 | 0 % | 0 % | 0 % | 0 % | 0,7 % | 0,46 (0) | 2,22 | 0,67 |
| Hors échantillon, 1.2.1 | 4,0 % | 1,0 % | 2,0 % | 2,0 % | 27,0 % | 0,87 (2) | 2,25 | 0,65 |
| Hors échantillon, 1.2.2 | 0 % | 0 % | 0 % | 0 % | 0 % | 0,67 (1) | 1,81 | 0,67 |

| Marche maximale 10 min | Dominée | Marche absurde | Oubli | Étiquettes | Une proposition dominée | Retard moyen (p90) | Plus longue marche | Changements |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Banc, 1.2.1 | 5,3 % | 0,7 % | 4,0 % | 2,0 % | 22,7 % | 0,99 (2) | 3,07 | 0,59 |
| Banc, 1.2.2 | 0 % | 0 % | 0 % | 0 % | 0,7 % | 0,19 (0) | 2,83 | 0,60 |
| Hors échantillon, 1.2.1 | 7,0 % | 1,0 % | 4,0 % | 2,0 % | 24,0 % | 0,83 (1) | 3,08 | 0,58 |
| Hors échantillon, 1.2.2 | 0 % | 0 % | 0 % | 0 % | 0 % | 0,46 (0) | 2,54 | 0,57 |

Le seul cas de la 1.2.2 où une proposition est dominée (Madou → Waterloo, vendredi 07:30, marche 5 et 10) : « Le
suivant » par le métro 6, l'IC et le S1 (07:59 → 08:40) ; l'oracle passe par le bus 95 et le S19 (08:36), une ligne
que le moteur ne charge pas pour ce trajet : il ne voit pas ce candidat.

Le moteur donne la proposition 1 de la règle appliquée à tout l'ensemble de l'oracle dans 504 calculs sur 506 (les
deux autres, Vanderkindere → Gare du Nord : même coût, une minute de marche de plus, le bus 50 non chargé). Cas réels
du PRD-1.2.1 § 1.5 (marche 5 et 10) tenus : Braine-l'Alleud Côté du Collège → Schaerbeek Gare, 11/11 19:42, bus W puis
S1 (19:57 → 21:05), les 22 min à pied et les deux IC seulement en « Plus tôt », « Le suivant » le bus W puis le tram 92
(20:39 → 22:01, il domine le bus W puis le S1 suivant) ; → Madou, 12/11 07:31, bus 36,
IC 08:01, métro 2 (07:49 → 08:33) ; → Madou, 11/11 13:30, bus W puis métro 2 (13:39 → 14:47), jamais le bus 36 vers
Rixensart.

| Temps par recherche (ms) | Moyenne | Médiane | p90 | Maximum |
|---|---:|---:|---:|---:|
| Banc, marche 5, 1.2.1 | 80 | 66 | 154 | 803 |
| Banc, marche 5, 1.2.2 | 59 | 41 | 120 | 339 |
| Hors échantillon, marche 5, 1.2.1 | 80 | 59 | 138 | 706 |
| Hors échantillon, marche 5, 1.2.2 | 54 | 42 | 113 | 283 |

Mesures du 12/11, la 1.2.1 et la 1.2.2 l'une après l'autre sur la même machine, chargée par d'autres essais (les deux
plus lentes qu'au premier banc) ; la recherche du § 7.5, point 4, pour la garde ajoute environ 25 % au temps de
calcul de la 1.2.2 (300 paires réelles, mêmes conditions).

Références externes (Transitous et iRail, mêmes 150 cas, hors FlixBus, Eurostar, ICE, European Sleeper et Eurocity
Direct) : un trajet qui arrive au moins 5 min avant la proposition 1 sans plus de marche ni de changements dans 1 cas
(1.2.1 : 4) : Korenmarkt → Gand-Saint-Pierre, vendredi 17:30, une correspondance de 2 min à pied que Transitous fait
sans marge et que Quai compte avec 1 min pour trouver l'arrêt (écart de modèle accepté).

## 8. Améliorations d'usage

Revue complète : docs/v1.2.2/REVUE-USAGE.md (textes exacts et critères). Arbitrage :
- Retenus : n° 1 (accueil : la ligne d'aide n'existe que pendant les 7 premiers jours ; « En cours » remplace la ligne
  de son propre favori ; s'il manque une ligne, la ligne vide saute d'abord ; « Gares » et « Bus, tram, métro » restent
  affichées même vides, avec « à choisir », comme l'a voulu le propriétaire) ; n° 2 (textes des adresses récentes et de
  la liste vide) ; n° 3 (★ des départs : une gare va dans « Gares », un arrêt de bus, tram ou métro ouvre « garder une
  ligne » ; « Un endroit » sur le téléphone donne toujours un lieu, avec un lien vers la bonne rubrique) ; n° 4
  (migration dite et sans perte : ouverture d'office à moins de 300 m gardée par `near`, alerte travaux sur les gares
  et lignes gardées, ordre gardé) ; n° 5 (plus de « lieux », titre « Favoris ») ; n° 6 (à droite de « Gares » et de
  « Bus, tram, métro », le prochain départ de l'élément le plus proche au lieu d'un nombre ; « à choisir » si vide) ;
  n° 7 (liste « Favoris » au format de l'accueil) ; n° 8 (un véhicule s'écrit partout de la même façon) ; n° 9
  (écran « Trajets » sur le téléphone) ; n° 10 (erreur et « Autour de moi » vide avec une issue) ; n° 11 (libellés
  d'« Affichage ») ; n° 13 (la marche dite une fois sur les cartes).
- Reporté : n° 12 (gare proposée au premier lancement).
- Transmis au classement (§ 7) : « Plus tard » ne doit jamais arriver avant « Le suivant ».

## 9. Nouveautés, version

- Version 1.2.2 (app.json, package.json) ; notes de la boutique en 1 à 3 lignes (app/store/changelog/1.2.2.txt).
- Message unique « Quai 1.2.2 » sur les lunettes et le téléphone : rubriques Gares et Bus, tram, métro ; « Aller à… »
  rejoint Favoris ; arrêts favoris rangés dans les rubriques ; trajet suivi seulement sur demande ; et ce que § 7 et § 8
  changent pour l'usager.

## 10. Critères d'acceptation

- CA-122.1 Accueil : ordre et textes du § 1.1, 3 favoris tenus, entrées vides du § 1.3 (lunettes et Quai Web).
- CA-122.2 Favoris : favoris puis adresses récentes puis « Autre adresse » ; « Aller à… » n'existe plus.
- CA-122.3 Gares : liste, prochain train, tableau au toucher, gare sans train.
- CA-122.4 Bus, tram, métro : deux sens toujours, deux passages par sens, passage partiel signalé, détail à 4 passages,
  ligne « toutes les lignes », ligne introuvable. Sur les données réelles du 12/11 : le 36 à Braine-l'Alleud Côté du
  Collège donne deux sens (Wavre, Braine-l'Alleud Gare) et marque le passage qui s'arrête à Vallée Bailly.
- CA-122.5 Téléphone et Quai Web : ajout d'une gare, ajout d'une ligne en deux temps, retrait confirmé, ordre, limites.
- CA-122.6 Migration : arrêts favoris rangés sans perte ni doublon (SNCB, avec filtre, sans filtre), favoris restants
  dans le même ordre, message une fois.
- CA-122.7 Suivi : ouvrir un favori ne suit pas ; « Suivre ce trajet » suit ; « Ne plus suivre » arrête ; un trajet
  1.2.1 non demandé n'est pas « En cours ».
- CA-122.8 Classement et usage : selon § 7 et § 8.
