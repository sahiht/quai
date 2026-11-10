# Quai 1.1 : parcours écran par écran

Complément de `PRD.md` (même dossier, brouillon 3). Les textes exacts et leurs règles sont au § 6 du PRD ; ici, les enchaînements.

Notation :
- ▼ glisser vers le bas, ▲ glisser vers le haut, T toucher, TT double toucher.
- L1 à L9 : écrans des lunettes (PRD § 6.1), avec leur nom `screen` du journal de test ; T1 à T7 : écrans du téléphone (PRD § 6.2).
- Les écrans des lunettes sont dessinés ligne par ligne. La police réelle est proportionnelle : les colonnes sont indicatives. « ▶ » est le curseur, ou le repère d’étape sur L3 ; « → » se lit « vers ».
- Les étapes sont dessinées avec les textes des Must ; avec S6, les durées de marche passent dans le texte (« (7 min) ») et la colonne de droite ne donne que l’état (« dans 4 min », « en cours », « +2 min »).
- Heures : jeu de test commun (`fixtures/`), mardi 10/11/2026 ; « à confirmer » quand le calcul de référence du cœur doit les fixer.

## F1. Trajet du matin depuis un favori (lunettes)

Contexte : 07:31, à la maison à Namur (S1), préréglage 1.1, temps réel complet (scène `base` : l’IC a 2 min de retard et part de la voie 6).

| # | Écran | Geste | Ce qui se passe |
|---|---|---|---|
| 1 | L1 Accueil (`home`) | aucun | à l’ouverture, la réponse est déjà là |
| 2 | L1 | T | ouvre le trajet proposé, qui devient le trajet suivi |
| 3 | L3 Trajet proposé (`steps`), trajet 1 sur 3 | aucun, ou ▼ | ▼ montre le trajet suivant (3 bis) sans changer le trajet suivi |
| 4 | L3, 07:35 | aucun | le trajet passe « en cours » ; l’étape à pied passe « en cours » |
| 5 | L4 Dans le train (`train`), 07:44 | aucun (▲▼ pour parcourir les arrêts) | ouvert seul au départ de l’IC suivi, même si l’on regardait le trajet 2 |
| 6 | L3, 08:48 | aucun | retour seul aux étapes à la descente, repère sur la dernière étape |
| 7 | L3 | TT | retour à l’accueil ; la ligne « En cours » reste jusqu’à 09:05 |

Étape 1, L1 :
```
Quai                                               07:31
▶ Vers le bureau                       partir dans 4 min
  IC à 07:42 (+2 min), voie 6 !, direct, arrivée 09:00
  Namur, train                         IC 07:42 +2 v.6 !
  vers Bruxelles-Midi, puis ~08:42
  Autour de moi                                 3 arrêts
  Autres favoris                                       4
  Aller à…
~ horaire prévu, sans temps réel
▲▼ choisir   toucher : ouvrir   double : quitter
```

Étape 3, L3, trajet suivi (l’alerte passe avant la raison) :
```
Vers le bureau : 07:35 → 09:00                     07:31
! Voie modifiée : l’IC part de la voie 6
▶ 07:35  Partir à pied vers la gare                7 min
  07:42  IC vers Bruxelles-Midi, voie 6           +2 min
  08:48  Descendre à Bruxelles-Central
  09:00  Arrivée au bureau, à pied                12 min

▼ Le suivant : 08:33 → 09:58
▲▼ autre trajet   toucher : détail   double : retour
```

Étape 3 bis, après ▼ (▲ revient à l’étape 3 ; T ferait de ce trajet le trajet suivi : « Trajet suivi : IC 08:42 ») :
```
Vers le bureau : 08:33 → 09:58                     07:31
Le suivant : même trajet, 1 h plus tard
  08:33  Partir à pied vers la gare                7 min
  ~08:42 IC vers Bruxelles-Midi, voie 5
  09:46  Descendre à Bruxelles-Central
  09:58  Arrivée au bureau, à pied                12 min

▼ Le suivant : 09:33 → 10:58
▲▼ autre trajet   toucher : suivre ce trajet   double : retour
```

Étape 5, L4 (vue à 08:05) :
```
IC vers Bruxelles-Midi, +2 min                     08:05
  Gembloux                         07:57   passé
▶ Ottignies                        08:11   prochain
  Bruxelles-Luxembourg             08:33
  Bruxelles-Schuman                08:37
  Bruxelles-Nord                   08:42
  Bruxelles-Central                08:48   descente
▲▼ arrêts   double : retour
```

Étape 7, L1 pendant le trajet (avant 09:05) :
```
Quai                                               08:52
▶ En cours : vers le bureau                arrivée 09:00
  Vers …                                             …
```

Gestes pour tout le trajet : 1 (T). En 1.0 : 1 si le trajet était la suggestion de l’accueil, sinon 5 (▼ ▼ T T T).

Variantes :
- F1-b. Sans temps réel (scène `noRT`) : L1 « partir dans 2 min » et « IC à ~07:42, voie 4, direct, arrivée 08:58 » ; ligne du haut « Temps réel indisponible : horaires prévus ~ » ; L3 raison « Le plus simple : direct, à pied 7 + 12 min ».
- F1-c. IC supprimé : la réponse de L1 passe au trajet suivant attrapable ; si le trajet suivi est touché, L3 montre l’alerte de suppression de la 1.0 en tête et ▼ propose le suivant ; T sur celui-ci le fait suivre.
- F1-d. Quai fermé dans le train (TT jusqu’à l’accueil, TT, confirmation à 07:50), puis rouvert à 08:05 près d’Ottignies : L4 directement, avec « Trajet en cours : vers le bureau » pendant 3 s. Rouvert à 07:50 encore à la maison : L1 sans « En cours » (l’IC est parti sans l’utilisateur). Rouvert après 09:05 : L1.
- F1-e. Favori d’arrêt (S2, 12:10, près de la gare du Nord) : les départs de « Gare du Nord, tram (STIB) ★ » s’ouvrent seuls (1.0) ; TT : L1 avec « Gare du Nord, tram   T3 2 min » / « vers Churchill, puis T4 Stalle 5 min ».
- F1-f. Position refusée : « Vers le bureau   sans position », « Autour de moi   sans position » ; T sur le favori : « Position indisponible. » / « Autorise la position pour Quai dans l’appli Even. »
- F1-g. Déjà au bureau : « Vers le bureau   tu y es » descend en fin de liste ; T : « Tu es déjà au bureau. »
- F1-h. Depuis le téléphone (S8) : accueil du téléphone, section « Mes favoris », bouton « Lunettes » de « Vers le bureau » : les lunettes affichent L3, trajet suivi. 1 toucher, 0 geste.

## F2. Ajouter un lieu par son adresse (téléphone)

Contexte : réglages 1.1, n’importe où.

| # | Écran | Action | Ce qui s’affiche |
|---|---|---|---|
| 1 | T1 Accueil | toucher « Mes lieux » | T3 « Mes lieux » : Maison, Bureau, « Ajouter un lieu » |
| 2 | T3 Mes lieux | toucher « Ajouter un lieu » | « Nouveau lieu » : « Nom du lieu » et ses raccourcis « Maison », « Bureau », « École » ; « Adresse » (texte d’exemple « Rue et numéro, commune ») ; « Utiliser ma position actuelle » (« si tu es sur place ») ; mention sur les adresses |
| 3 | Nouveau lieu | taper « Piscine » dans « Nom du lieu » (ou toucher un raccourci) | |
| 4 | Nouveau lieu | taper « rue de fer 25 namur » dans « Adresse » | après 250 ms, adresses d’abord (le texte contient un chiffre) : « Rue de Fer 25, 5000 Namur   adresse », puis les gares et arrêts |
| 5 | Nouveau lieu | toucher « Rue de Fer 25, 5000 Namur » | le champ affiche l’adresse choisie, puis l’accès (texte 1.0, ex. « Namur à 5 min à pied, bus TEC à 2 min ») ; « Enregistrer le lieu » devient actif ; aucune coordonnée |
| 6 | Nouveau lieu | toucher « Enregistrer le lieu » | retour à « Mes lieux », nouvelle ligne « Piscine » ; question « Ajouter le trajet vers Piscine à tes favoris ? » (S3) |
| 7 | Mes lieux | toucher « Ajouter aux favoris » | nouveau favori « Ma position → Piscine » (« Trajet porte à porte ») |
| 8 | Lunettes | aucun geste | « Aller à… » montre « Piscine   arrivée {HH:MM} » ; les favoris montrent « Vers la piscine » avec sa réponse |

Touchers : 5, plus la saisie du nom et de l’adresse (avec un raccourci de nom : 3 touchers et 1 saisie jusqu’à l’enregistrement).

Variantes :
- F2-b. Adresse sans commune, « rue de fer 25 » : deux propositions, « Rue de Fer 25, 5000 Namur » et « Rue de Fer 25, 4000 Liège » ; la commune fait le choix.
- F2-c. Rue sans numéro, « rue neuve bruxelles » : « Rue Neuve, 1000 Bruxelles (sans numéro) » ; une fois choisie : « Position approximative : la rue, sans numéro. »
- F2-d. Service d’adresses indisponible : « Adresses indisponibles pour l’instant : gares et arrêts seulement. » ; téléphone hors ligne : « Recherche d’adresse impossible sans connexion : gares et arrêts seulement. » ; on peut choisir un arrêt (le lieu devient « Près de {arrêt} ») ou « Utiliser ma position actuelle ».
- F2-e. Rien trouvé : « Aucune adresse, gare ou arrêt ne correspond. Ajoute la commune, ou vérifie l’orthographe. »
- F2-f. Lieu venu de la 1.0 : sa ligne dit « Adresse à vérifier » ; dans son écran, « Vérifier l’adresse » ouvre le champ « Adresse » prérempli avec l’ancien texte libre.
- F2-g. « Bureau » ou « Maison » : à l’étape 6, le créneau « Le matin » (Bureau) ou « Le soir » (Maison) est proposé d’office avec le favori.
- F2-h. Supprimer un lieu, confirmation dans la page : « Supprimer le lieu « Piscine » ? Les trajets favoris vers ce lieu seront aussi supprimés. », « Supprimer », « Annuler ».
- F2-i. Depuis la recherche : choisir une adresse dans « Arrivée », puis « Enregistrer comme lieu » (F3, étape 6).

## F3. Trouver le trajet le plus facile vers une adresse (téléphone, puis lunettes)

Contexte : 13:55, à Bruxelles-Central (S3), rendez-vous à une adresse de Gand inconnue de l’utilisateur ; scène `base`.

| # | Écran | Action | Ce qui s’affiche |
|---|---|---|---|
| 1 | T1 Accueil | toucher « Où vas-tu ? » | T2 « Rechercher un trajet » ; « Départ » : « Ma position, Bruxelles-Central » ; curseur dans « Arrivée » |
| 2 | T2 | taper « veldstraat 1 gent » | « Veldstraat 1, 9000 Gent   adresse » en tête |
| 3 | T2 | toucher cette proposition | le champ affiche l’adresse ; la recherche part ; « Enregistrer comme lieu » apparaît sous le champ ; les cartes s’affichent (ci-dessous) |
| 4 | T2 | toucher « Lunettes » sur la 1re carte | « Affiché dans les lunettes : IC 14:10, voie 4. » à côté du bouton ; les lunettes montrent L3, ce trajet devient le trajet suivi |
| 5 | Lunettes | aucun geste | suivi automatique : L4 au départ de l’IC, L3 à la descente, L4 pour le tram, L3 pour la dernière marche |
| 6 | T2, facultatif | « Garder en favori » ; « Enregistrer l’adresse comme lieu » | « Ajouté à tes favoris. » ; nom « Rendez-vous », « Enregistrer le lieu », « Lieu enregistré : Rendez-vous. » |

Étape 3, cartes (heures à confirmer) :
```
Bruxelles-Central → Veldstraat 1, 9000 Gent       Changer l’heure
dès 13:55

[Le plus simple]                                      [Lunettes]
14:10 → 14:57                 47 min, 1 changement, 4 min à pied
IC › 1 min › Tram 1 › 3 min
Voie 4 à Bruxelles-Central, à l’heure
Le plus simple, et aussi le plus rapide.

[Le suivant]                                          [Lunettes]
14:25 → 15:13                 48 min, 1 changement, 4 min à pied
Voie 6 à Bruxelles-Central, retard de 3 min annoncé
Même trajet, départ suivant.

[Le suivant]                                          [Lunettes]
14:40 → 15:29                 49 min, 1 changement, 4 min à pied
Même trajet, départ suivant.

        Garder en favori
        Enregistrer l’adresse comme lieu
```

Étape 4, L3 dans les lunettes :
```
Vers Veldstraat 1 : 14:10 → 14:57                  13:56
Le plus simple : 1 changement, à pied 1 + 3 min
▶ 14:10  IC vers Bruges, voie 4
  14:39  Descendre à Gand-Saint-Pierre
  14:40  À pied vers l’arrêt du tram               1 min
  14:44  T1 vers Korenmarkt
  14:54  Descendre à Korenmarkt, Gand
  14:57  Arrivée à Veldstraat 1, à pied            3 min
▼ Le suivant : 14:25 → 15:13
▲▼ autre trajet   toucher : détail   double : retour
```

Gestes dans les lunettes : 0 pour voir le trajet ; 1 par autre trajet (▼) ; 2 pour en suivre un autre (▼, T). Sur le téléphone : la saisie et 2 touchers.

Variantes :
- F3-b. « Le plus simple » et « Le plus rapide » différents : 07:31 à la maison à Namur (S1, scène `noRT`) vers « Rue Neuve 1, 1000 Bruxelles » (heures à confirmer) :
  - [Le plus simple] « 07:33 → 08:56 », « 1 h 23, direct, 17 min à pied », « Le moins de changements et de marche. »
  - [Le plus rapide] « 07:33 → 08:51 », « 1 h 18, 1 changement, 12 min à pied » (IC jusqu’à Bruxelles-Nord, puis tram 3 jusqu’à De Brouckère), « Arrive 5 min plus tôt, avec 1 changement de plus. »
  - [Le suivant] « 08:33 → 09:56 ».
  - Dans les lunettes, le trajet 1 annonce en bas « ▼ Le plus rapide : 07:33 → 08:51 ».
- F3-c. Waterloo vers Bruxelles (extension du jeu de test, PRD annexe A.2 ; données réelles, annexe A.3) : [Le plus simple] bus W depuis « Waterloo Eglise » puis métro 2 depuis Gare du Midi, 1 changement, peu de marche ; [Le plus rapide] marche jusqu’à la gare de Waterloo puis train, « Arrive {n} min plus tôt, avec plus de marche. »
- F3-d. Correspondance entre deux lignes urbaines (M5b) : de « Avenue Winston Churchill 100, 1180 Uccle » à « Boulevard du Centenaire 1, 1020 Bruxelles », 08:00 : T3 jusqu’à Rogier, puis M6 ; raison « Le plus simple : 1 changement, à pied 2 + 1 + 1 min » (à confirmer). La 1.0 répondait « Aucun trajet trouvé ».
- F3-e. Pas de trajet complet : « Pas de trajet complet. Essaie {gare}, puis le tram. » et le bouton « Chercher vers {gare} », qui relance la recherche vers la gare la plus proche de la destination.
- F3-f. « Changer l’heure » : choisir 17:30 ; les cartes et les étiquettes sont recalculées pour cette heure ; « Lunettes » affiche ce trajet.
- F3-g. Adresse loin de tout arrêt (« Rue du Bois 1, 6600 Bastogne » dans le jeu de test) : « Aucun arrêt à moins de 20 min à pied de cette adresse. » ; rien n’est envoyé aux lunettes.
- F3-h. Position inconnue avec « Départ » sur « Ma position » : message 1.0 du téléphone ; on peut choisir un autre départ (adresse, gare, lieu).

## F4. Gérer ses favoris

| # | Où | Parcours | Gestes ou touchers |
|---|---|---|---|
| F4-a | Lunettes : ajouter un arrêt | S2 : L1, ▼ ▼ jusqu’à « Autour de moi », T ; L7, ▼ jusqu’à « Bruxelles-Nord, train », T ; L6, T : « ★ Ajouté aux favoris », le titre prend « ★ ». Le nouveau favori (réglé « Jamais ») est à 160 m : il monte sur l’accueil (règle « tout près »). | 6 gestes |
| F4-b | Lunettes : retirer, puis annuler | L6 d’un arrêt favori, T : « ★ Retiré. Toucher encore : annuler » ; T dans les 5 s : « ★ Favori rétabli », à l’identique | 2 gestes |
| F4-c | Téléphone : modifier un arrêt favori | T1, « Gérer mes favoris » (ou « Mes favoris » dans les réglages), toucher le favori ; « Modifier le favori » : cocher les lignes et directions, choisir « Le proposer à l’ouverture » (« Le matin (5 h à 11 h) »…) ; « Enregistrer le favori » | 4 touchers et plus |
| F4-d | Téléphone : trajet favori vers une adresse | « Mes favoris », « Ajouter un arrêt, une gare ou un trajet », « Un trajet de A à B » ; « Départ » : « Ma position » (le champ l’affiche) ; « Arrivée » : taper l’adresse, la choisir ; « Nom affiché (« Vers le bureau »), facultatif » : « piscine » ; « Le soir (15 h à 21 h) » ; « Enregistrer le favori ». Le soir, « Vers la piscine » est en tête des lunettes avec sa réponse. | 6 touchers et la saisie |
| F4-e | Téléphone : changer l’ordre | « Mes favoris », « Changer l’ordre », « Monter » ou « Descendre », « Terminé » ; pour que cet ordre s’applique toujours : « Affichage », « Ordre des favoris », « Dans mon ordre » | 3 touchers et plus |
| F4-f | Téléphone : supprimer | « Modifier le favori », « Supprimer ce favori », confirmation dans la page (« Supprimer ») | 3 touchers |
| F4-g | Téléphone : garder un trajet cherché | après une recherche (F3), « Garder en favori » : « Ajouté à tes favoris. » ; s’il existe déjà : « Déjà dans tes favoris. » | 1 toucher |
| F4-h | Téléphone : afficher un favori dans les lunettes (S8) | accueil du téléphone, section « Mes favoris », bouton « Lunettes » | 1 toucher |
| F4-i | Lunettes : vérifier | L1 montre les 2 favoris en tête (ordre intelligent ou ordre choisi) ; « Autres favoris » (▼ ▼ ▼ T) montre les suivants, 3 par écran, ordre figé tant que l’écran est affiché | 0 à 4 gestes |

Ordre intelligent, rappel (PRD M1) : tout près (300 m), puis prévu pour ce moment (matin, soir), puis utilisable d’ici (trajets depuis « Ma position », arrêts à 1 km au plus), puis le reste dans l’ordre choisi ; en fin de liste, « tu y es » et ce qui n’a rien dans les 3 heures.

Exemple à 12:10 près de la gare du Nord (S2) : accueil = « Gare du Nord, tram », « Bruxelles-Nord, bus De Lijn » ; « Autres favoris » = « Vers le bureau » (« partir dans 2 min »), « Vers Gand-Saint-Pierre » (« départ 14:10 »), « Namur, train » (« IC ~demain 08:42 »), « Vers la maison » (« aucun trajet »).

## F5. Premier lancement

### F5-a. Nouvelle installation

| # | Où | Écran | Action | Suite |
|---|---|---|---|---|
| 1 | Lunettes | L9 Bienvenue (`message`) : « Bienvenue dans Quai ! » / « Termine les réglages sur le téléphone : » / « appli Even Realities, onglet Even Hub, Quai. » / « Position, langue et tes lieux, en une minute. » | aucun geste (T : accueil sans réglages) | attend les réglages |
| 2 | Téléphone | T7 étape 1 « Bienvenue », « Quelques réglages, et Quai est prêt. » | « Autoriser la position », choisir la langue des noms, « Continuer » | étape 2 |
| 3 | Téléphone | T7 étape 2 « Tes lieux » | taper l’adresse de « Maison », choisir ; taper celle de « Bureau », choisir ; laisser cochée « Me proposer le trajet vers le bureau le matin, et vers la maison le soir » ; « Terminer » | T1 Accueil ; lieux Maison et Bureau, deux trajets favoris, section « Mes favoris » (S8) |
| 4 | Lunettes | L1 Accueil, mis à jour seul (comme en 1.0 quand les réglages arrivent) | aucun geste | le matin, « Vers le bureau » en tête avec sa réponse ; le soir, « Vers la maison » |

Gestes dans les lunettes : 0. Téléphone : 7 touchers et 2 saisies jusqu’au trajet du lendemain matin (17 touchers et 3 saisies en 1.0).

### F5-b. « Plus tard » à l’étape 2

Aucun lieu, aucun favori. L1 : « Ajouter un favori », « Autour de moi   {n} arrêts », « Aller à… ». T sur « Ajouter un favori » : « Aucun favori pour l’instant. » / « Ouvre un arrêt dans Autour de moi et touche-le, » / « ou ajoute un trajet sur le téléphone. » « Aller à… » : « Aucun lieu enregistré   sur le téléphone », « Autre adresse   sur le téléphone ».

### F5-c. Position refusée

Téléphone : messages de la 1.0. Lunettes : « Autour de moi   sans position » ; les trajets depuis « Ma position » affichent « sans position » ; les arrêts favoris gardent leurs départs.

### F5-d. Mise à jour depuis la 1.0

| # | Où | Ce qui s’affiche |
|---|---|---|
| 1 | Lunettes, première ouverture | L9 « Quai 1.1 » : « Nouveau : tes favoris donnent la réponse. » / « Toucher un favori : le trajet, étape par étape. » / « Sur un trajet, ▼ : un autre trajet. » / « Les adresses se tapent sur le téléphone. » ; aide « toucher : continuer » |
| 2 | Lunettes, T | L1 avec les favoris en tête ; tous les favoris et lieux de la 1.0 sont là, avec leurs réglages (un arrêt dont l’identifiant a changé est retrouvé, M8) |
| 3 | Téléphone, première ouverture | bannière « Nouveau : tape une adresse, Quai trouve le trajet le plus simple. », « OK » ; pas d’écran « Bienvenue » |
| 4 | Téléphone, « Mes lieux » | les lieux 1.0 portent « Adresse à vérifier » (F2-f) |
| 5 | Téléphone, « Données » | « Version de Quai   1.1.0 » |

Le message « Quai 1.1 » et la bannière ne reviennent plus ensuite.

### F5-e. Quai Web

Même parcours dans le navigateur, avec les textes 1.0 propres à Quai Web (« onglet Réglages ») ; dernière ligne de bienvenue : « position, langue et tes lieux, en une minute. »

## Récapitulatif des gestes dans les lunettes

| Action | 1.0 | 1.1 |
|---|---|---|
| Savoir quand partir pour le favori le plus utile | 0 s’il était la suggestion, sinon 3 et plus | 0 |
| Étapes de ce trajet | 1 ou 5 | 1 |
| Un autre trajet | 3 (TT, ▼, T), ou aucun | 1 (▼) |
| Suivre un autre trajet | 3 et plus | 2 (▼, T) |
| Réponse des favoris 3 à 5 | 3 à 7 | 4 |
| Étapes du 5e favori | 9 | 7 |
| Arrêts autour de soi | 1 ou 2 | 3 |
| Annuler le retrait d’un favori | impossible | 1 |
| Retrouver le trajet en cours | 5 et plus | 0 à la réouverture, 1 depuis l’accueil |
| Voir le trajet vers une adresse tapée sur le téléphone | impossible | 0 |
| Afficher un favori depuis le téléphone (S8) | recherche complète | 1 toucher sur le téléphone, 0 geste |
