# Quai 1.1 : cahier produit (PRD)

Statut : brouillon 3 du 10/11/2026, rôle produit. Intègre `review-tech.md` et `review-ux.md` ; `design-routing.md` n’était pas encore disponible (§ 12). Destinataires : équipes cœur, interface, données, relais et contrôle qualité, responsable technique.
Sources : retours réels du propriétaire, captures 1.0.1 du simulateur (`app/test/screens/`, `tests/e2e/screens/`), vidéo de démonstration, maquettes validées 1.0 (`/home/claude/quai/project/`), données réelles publiées le 10/11/2026 (`/home/claude/real-data/data`), revues technique et UX (`docs/v1.1/`), documentation Even (lecture seule).
Parcours écran par écran : `flows.md`.

## En bref (pour le propriétaire)

1. Dans tes lunettes, tes favoris donnent la réponse dès l’ouverture : quand partir, quel train ou bus, quelle voie, l’heure d’arrivée. Un toucher ouvre le trajet étape par étape, un glissement montre un autre trajet.
2. Quai choisit d’abord le trajet le plus simple (moins de changements, moins de marche), montre le plus rapide s’il est différent, et dit toujours pourquoi.
3. Sur le téléphone, tu tapes une adresse, une gare ou un arrêt dans un seul champ, pour y aller ou l’enregistrer ; la mise à jour se fait avec un guide en français et garde tous tes réglages.

## 1. Les 5 problèmes à résoudre

### P1. Entrer dans ses favoris ne donne pas la réponse, et le trajet est loin

- Retour réel : « Je trouve qu'entrer sur mes favoris gagnerait à être amélioré : tu dois faciliter aussi intuitivement le trajet que propose ce favori. »
- `app/test/screens/glasses-favorites.png` : « Ici ▶ Bureau   S1 12:34 v.3 ». Seul le premier véhicule est donné : ni l’heure de départ à pied, ni l’arrivée ; le nom donné au favori (« bureau ») est ignoré ; « v.3 » est abrégé ; un nom long coupe la destination (« Ottignies-Louvain-la-Neuve ▶ Bruxel… », `review-ux.md` n° 3).
- Mesuré (`review-ux.md` § 1) : le train du bureau demande 5 gestes par « Mes favoris » (▼ ▼ T T T) contre 1 par la suggestion de l’accueil ; un favori de gare à gare, 6 gestes, et il ouvre le détail d’un train, jamais les étapes.
- Ordre figé (seul « Mettre en premier » existe) : à Namur à 07:31, la liste montre en 2e position « Gare du Nord (STIB) », inutile à Namur.
- `tests/e2e/screens/polish-favorites-late.png` (23:30) : « Ici ▶ Bureau   à pied », sans durée ni arrivée.

### P2. Impossible d’aller à une adresse

- Retour réel : « Intégrer l'ajout d'une adresse postale qui permettra ensuite de retrouver le trajet le plus "facile" de A à B. »
- Écran « Nouveau lieu » : le champ « Adresse (texte libre) » n’est pas localisé ; la position vient seulement de « Utiliser ma position actuelle », de coordonnées tapées ou d’un arrêt proche. Ajouter « Bureau » : 7 touchers et 3 saisies, adresse ignorée, « Enregistrer le lieu » grisé sans raison, position affichée en coordonnées (`review-ux.md` n° 13).
- `phone-search.png` : la recherche ne connaît que les gares et arrêts ; un nom de rue donne « Aucun arrêt ne correspond. »
- Lunettes, « Aller à… » : « Autre lieu   sur le téléphone » ne mène qu’à un message (`glasses-places.png`).

### P3. Le trajet proposé n’est pas « le plus facile », et Quai ne dit pas pourquoi

- Retours réels : « le trajet le plus "facile" de A à B » ; sur le produit : « pédagogique, clair, facile d'utilisation pour les lunettes ».
- `glasses-journeys.png` : trois fois « 07:33 ▶ 08:58   1 h 25, direct », triés par arrivée, sans étiquette ni raison.
- Données réelles (`review-tech.md`, B1) : le trajet type Maison (Namur) vers Bureau passe par Bruxelles-Chapelle avec un changement (arrivée 09:12) au lieu de l’IC direct jusqu’à Bruxelles-Central puis 12 min à pied (arrivée 09:04), et rien n’est proposé à 23:50 pour le lendemain. Autres réponses absurdes : Namur vers Saint-Nicolas par Lille en 4 h 20, 7 h d’attente nocturne à Ottignies, une correspondance pour gagner 1 minute.
- Couverture 1.0 trop étroite : pas de correspondance entre deux bus ou trams ; gare d’arrivée cherchée à 2 km au plus de la destination, d’où « Aucun trajet trouvé » de Bruxelles-Central vers Korenmarkt, à Gand (`review-ux.md` n° 11). Depuis « WATERLOO Eglise », les bus TEC W et 365a vont jusqu’à « BRUXELLES Midi » ; pour finir en métro ou en tram, il faut une correspondance urbaine. Le centre de Waterloo est à 19 min à pied de sa gare.
- Aucune donnée d’accessibilité dans les fichiers publiés : « sans marches » est inconnu.

### P4. Lunettes : des gestes et des textes pas toujours fiables

- Retours réels sur le produit : « extrêmement intuitif », « simplicité d'usage ».
- Le train choisi sur le téléphone n’est pas celui que suivent les lunettes : on choisit le 14:22, elles passent seules « dans le train » du 14:10 (`review-ux.md` n° 1, bloquant).
- `s2-favorite-removed.png` : un toucher sur les départs d’un arrêt favori le retire aussitôt ; le rajouter le recrée en fin de liste, réglé « Jamais ».
- Temps réel coupé : « Pas de réseau » accuse le téléphone ; un S1 « SUPPRIMÉ » redevient « ~12:34 voie 3 », comme s’il circulait (`review-ux.md` n° 6 et 7).
- Aides incohérentes (« ▲▼ arrêt   toucher : départs » sans retour ; « double toucher » ou « double ») ; mots voisins (« itinéraires », « propositions », « trajets ») ; « ▶ » sert à la fois de curseur et de « vers » (« ▶Ici ▶ Bureau »).
- Le suivi d’un trajet est perdu dès qu’on revient à l’accueil ou qu’on rouvre Quai.
- Données réelles (`review-tech.md`) : 96 % des noms TEC portent la commune en capitales (« WATERLOO Eglise », « BRUXELLES Midi ») ; lignes « TT1 », « MM3 » ; départs en double (1,7 % des départs SNCB) ; « Gare du Nord » coupée en deux zones, tram et bus, si bien qu’un favori ne couvre que l’une ; « gare du Midi », « aéroport » et « LLN » introuvables ; un relais muet fige chaque écran 8 s.

### P5. Mettre à jour Quai est difficile pour le propriétaire

- Retour réel : il a demandé quand une mise à jour est nécessaire et comment l’installer ; les interfaces en anglais (GitHub, Vercel, Even Hub) le gênent.
- `docs/INSTALL.md`, « Mettre à jour Quai » : cinq étapes sur GitHub et Even Hub, boutons en anglais (« Add file », « Commit changes », « Promote to Beta », « Install »), sans image.
- Le téléphone n’affiche pas la version installée ; rien ne dit qu’une mise à jour existe, ni qu’elle est inutile pour les horaires (préparés chaque nuit).
- Conséquence : sans passage guidé, la 1.1 n’arrivera pas dans les lunettes.

## 2. Panel d’utilisateurs simulé

Panel simulé : personnes fictives, imaginées par l’équipe produit pour éprouver les scénarios. Leurs avis complètent les retours réels du propriétaire ; ils ne les remplacent pas et ne servent jamais de preuve à eux seuls.

| Persona (simulé) | Profil | Retours (simulés) |
|---|---|---|
| S-1 La navetteuse du train | 38 ans, Namur ↔ Bruxelles-Luxembourg chaque jour, IC puis marche | « Le matin, je veux un seul chiffre : dans combien de minutes je pars. Le reste, je le lis dans le train. » « Si l’IC est supprimé, montre-moi tout de suite le suivant, pas un message d’erreur. » « Je ne touche pas à l’ordre de mes favoris : s’il bouge, je dois comprendre pourquoi. » |
| S-2 Le Bruxellois multimodal | 29 ans, sans voiture, tram, métro et bus autour de la gare du Nord | « Pour moi, Gare du Nord est un seul endroit ; Quai m’en montre deux, tram et bus. » « Mes trajets, c’est souvent tram puis bus : sans correspondance entre deux lignes STIB, Quai ne m’emmène nulle part. » « J’ai déjà retiré un favori sans le vouloir, en touchant l’écran des départs. » |
| S-3 La visiteuse d’un jour | 55 ans, rendez-vous à Gand à une adresse reçue par e-mail | « J’ai une adresse, pas un nom d’arrêt. Je la tape, et c’est tout. » « Donne-moi le plus simple, même s’il prend dix minutes de plus : je ne connais pas la ville. » « Vingt minutes à pied avec une valise, pour moi c’est un changement. » |
| S-4 Le père avec poussette | 34 ans, habite le centre de Waterloo, va à Bruxelles avec un enfant | « Facile, c’est moins de changements et moins de marche. Les escaliers, je veux le savoir quand c’est connu. » « Entre le train à la gare de Waterloo et le bus W devant chez moi, dis-moi lequel est le plus simple aujourd’hui. » |
| S-5 Le jeune retraité, nouveau sur les lunettes | 67 ans, découvre les G2 | « Je ne retiens pas les gestes : la ligne d’aide en bas doit toujours dire la même chose. » « Une information par ligne, pas d’abréviation comme “v.3”. » « Si je ressors de Quai dans le train, je veux retrouver mon trajet en le rouvrant. » |

Ce que le panel ajoute : une longue marche vaut un changement (S-3, S-4), la correspondance urbaine est indispensable à Bruxelles (S-2), un retrait de favori doit pouvoir s’annuler (S-2), le trajet en cours doit revenir (S-5), des mots entiers plutôt que des abréviations (S-5).

## 3. Principes de la 1.1

1. Une réponse avant un geste : ce qui sert maintenant s’affiche dès l’ouverture.
2. Un toucher ouvre ou agit ; il ne détruit rien sans retour possible.
3. Toujours dire pourquoi : chaque trajet proposé porte sa raison.
4. Écrire sur le téléphone, lire dans les lunettes.
5. La même réponse partout : accueil, favoris, « Aller à… », téléphone et Quai Web utilisent le même calcul et les mêmes mots.
6. Rien de nouveau à apprendre : les quatre gestes du SDK (glisser vers le haut, glisser vers le bas, toucher, double toucher ; il n’y a pas d’appui long), une ligne d’aide qui dit toujours ce que fait chacun, un seul mot (« trajet »), « → » pour « vers » et « ▶ » seulement pour le curseur ou le repère.

## 4. Définition du « trajet le plus facile »

### 4.1 Classement « Le plus simple »

Dans cet ordre :
1. Le moins de changements de véhicule. Chaque marche de 15 min ou plus (1,5 fois la marche maximale réglée dans « Mes lieux », 10 min par défaut) compte comme un changement de plus : 12 min de marche jusqu’au bureau ne pénalisent pas un train direct, les 19 min entre le centre de Waterloo et sa gare comptent.
2. À égalité, le moins de marche au total (départ, correspondances, arrivée). Moins de 5 min d’écart : égalité.
3. À égalité, sans marches (escaliers), quand c’est connu pour tout le trajet. Donnée absente en 1.1 : critère inactif, jamais affiché (voir C4).
4. À égalité, l’arrivée la plus tôt.
5. À égalité parfaite : le moins de véhicules, puis le départ le plus tard (moins d’attente).

### 4.2 Garde-fous

- Seuls les trajets encore attrapables : départ du premier véhicule moins la marche jusqu’à lui, au plus tôt maintenant.
- Un trajet dont un véhicule est supprimé n’est jamais proposé.
- Montée et descente seulement là où elles sont autorisées (pas de train de nuit en dépose seule, pas de point frontière).
- Attente en correspondance de 60 min au plus ; jamais de correspondance qui ne fait gagner que moins de 5 min sur le même premier train.
- Les grandes gares voisines sont toujours candidates, même quand une petite gare est plus proche ; la gare d’arrivée peut être à plus de 2 km de la destination quand une ligne urbaine les relie.
- « Le plus simple » n’arrive jamais plus de 30 min après le plus rapide.
- Règle 1.0 gardée : jamais un trajet en véhicule plus lent que d’y aller à pied.

### 4.3 Propositions

Trois au plus, sans doublon, remplies dans cet ordre :

| Étiquette | Quand | Raison affichée dans les lunettes (exemple) |
|---|---|---|
| Le plus simple | toujours : 1er du classement | « Le plus simple : direct, à pied 7 + 12 min » |
| Le plus rapide | s’il arrive au moins 5 min avant « Le plus simple », sans partir plus de 30 min avant lui | « Le plus rapide : 5 min plus tôt, 1 changement » |
| Plus tôt | s’il arrive au moins 5 min avant « Le plus simple » mais part plus de 30 min avant lui (cas de nuit) | « Plus tôt : 1 changement, départ 04:59 » |
| Sans changement, ou Moins de changements | un trajet avec moins de changements, écarté par le garde-fou des 30 min | « Sans changement : arrivée 10:05 » |
| À pied | la marche seule prend 30 min au plus et arrive au plus 5 min après « Le plus simple » | « À pied : 22 min, arrivée 09:12 » |
| Le suivant | même trajet que la proposition 1, au départ suivant | « Le suivant : même trajet, 1 h plus tard » |
| Plus tard | à défaut, le trajet suivant du classement | « Plus tard : 1 changement, départ 08:12 » |

### 4.4 Paramètres

Constantes du cœur, à valider sur données réelles (Q5) : égalité de marche 5 min ; écart minimal pour « Le plus rapide » 5 min ; départ au plus 30 min avant « Le plus simple » pour « Le plus rapide » ; garde-fou 30 min ; marche seule jusqu’à 30 min ; marche longue à partir de 1,5 fois la marche maximale ; attente en correspondance 60 min au plus.

### 4.5 Temps réel

Le classement utilise les heures estimées quand le temps réel est connu, sinon les heures prévues (« ~ »). Il est refait à chaque calcul (ouverture d’un écran, rafraîchissement d’une liste), jamais pendant qu’un trajet est affiché : un trajet affiché reste le même et se met à jour en direct (retards, voies).

### 4.6 Cas de référence (tests unitaires du cœur)

| Cas | Candidats (marche maximale 10 min) | Résultat attendu |
|---|---|---|
| A | X : direct, marche 7 + 12, arrivée 08:58. Y : 1 changement, marche 7 + 2 + 9, arrivée 08:58 | 1 = X (aucun changement : 12 min restent sous le seuil de 15). Pas de « Le plus rapide ». |
| B | X : direct, marche 5 + 4, arrivée 09:10. Y : 1 changement, marche 3 + 2, arrivée 08:58 | 1 = X ; 2 = Y « Le plus rapide : 12 min plus tôt, 1 changement » |
| C | X : direct, arrivée 10:05. Y : 1 changement, arrivée 09:20 | 1 = Y (X arrive 45 min après le plus rapide) ; 2 = X « Sans changement : arrivée 10:05 » |
| D | X : 1 changement, marche 2 + 3, arrivée 09:00. Y : 1 changement, marche 9 + 6, arrivée 08:57 | 1 = X (5 min de marche contre 15) ; Y n’arrive que 3 min plus tôt : pas de « Le plus rapide » |
| E | X : bus avec 1 changement, arrivée 09:14. W : marche seule 22 min, arrivée 09:12 | 1 = X (W : marche longue, donc égalité à 1, puis moins de marche) ; 2 = W « À pied : 22 min, arrivée 09:12 » |
| F (réel) | X : IC 07:44 Namur → Bruxelles-Central, marche 8 + 12, arrivée 09:04. Y : IC 07:44 → Bruxelles-Midi, S1 → Bruxelles-Chapelle, marche 8 + 6, arrivée 09:12 | 1 = X ; Y arrive plus tard, il n’est pas montré. Suppose Bruxelles-Central candidate (M8). |
| G (réel, nuit) | à 23:50, gare de Waterloo vers Bruxelles-Midi. X : S1 06:20 direct, arrivée 06:46. Y : S19 05:02 puis IC, 1 changement, arrivée 06:30 | 1 = X ; 2 = Y « Plus tôt : 1 changement, départ 04:59 » (Y part plus de 30 min avant X) |
| H (réel) | centre de Waterloo vers un bureau près de Bruxelles-Central. X : marche 19, S1 direct, marche 5, arrivée 08:46. Y : bus W puis métro, 1 changement, marche 1 + 2 + 4 | 1 = Y (égalité à 1 car la marche de 19 min compte, puis moins de marche) ; 2 = X « Le plus rapide » s’il arrive au moins 5 min avant Y |

## 5. Périmètre 1.1 : Must, Should, Could

| ID | Titre | Priorité | Cible de gestes dans les lunettes |
|---|---|---|---|
| M1 | Favoris « réponse directe » sur l’accueil et dans la liste | Must | réponse du favori le plus utile : 0 geste |
| M2 | Un toucher : le trajet ; un glissement : un autre trajet ; la raison ; un trajet suivi sûr | Must | étapes : 1 geste ; autre trajet : 1 geste de plus |
| M3 | « Le trajet le plus facile » : classement et étiquettes | Must | raison visible sans geste de plus |
| M4 | Adresses sur le téléphone : un seul champ | Must | trajet affiché dans les lunettes : 0 geste |
| M5 | Trajets porte à porte vers et depuis une adresse (a : adresse comme extrémité ; b : une correspondance urbaine ; c : deux correspondances en train) | Must | comme M2 |
| M6 | Lunettes sans mauvaise surprise : retrait annulable, trajet en cours sur l’accueil et repris à la réouverture | Must | annuler : 1 geste ; reprise : 0 geste |
| M7 | Passer à la 1.1 sans effort : réglages gardés, guide en français, version visible | Must | sans objet |
| M8 | Des réponses justes sur les vraies données | Must | sans objet |
| S1 | Premier lancement avec Maison et Bureau | Should | 0 geste |
| S2 | Aides de gestes cohérentes, message « Quai 1.1 » | Should | sans objet |
| S3 | « Garder en favori » depuis la recherche, ordre des favoris, créneaux proposés d’office | Should | sans objet |
| S4 | Adresses récentes | Should | 2 gestes depuis « Aller à… » |
| S5 | Noms lisibles et homonymes | Should | sans objet |
| S6 | Textes plus clairs (étapes, « demain », « imminent », heures) | Should | sans objet |
| S7 | Ouverture rapide et sobre en données | Should | sans objet |
| S8 | Mes favoris sur le téléphone, avec un bouton « Lunettes » | Should | 0 geste (1 toucher sur le téléphone) |
| C1 à C6 | voir § 5.3 | Could | |

Conventions de test, valables pour tous les critères d’acceptation (CA) :
- Simulateur ou navigateur : `http://localhost:5173/?e2e=1&data=http://localhost:8787&relay=http://localhost:8788&preset=<préréglage>&mockNow=<heure ISO>&mockLat=<lat>&mockLon=<lon>` (SPEC § 5.3) ; faux portail BMC en scène `base` (temps réel complet) ou `noRT` (sources en erreur, tout en horaire prévu).
- Préréglage : `fixtures/app/preset-1.1.json` (à ajouter, annexe A.2) sauf mention contraire.
- Positions : S1 = Maison (50.4655, 4.8590) le 2026-11-10 à 07:31 ; S2 = (50.8600, 4.3590) à 12:10 ; S3 = Bruxelles-Central (50.8454, 4.3571) à 13:55.
- Journal `QUAI_SCREEN` (`screen`, `title`, `lines`) de la 1.0, plus en 1.1 : `order` (identifiants des favoris dans l’ordre affiché) sur `home` et `favorites` ; `page`, `pages`, `label` (`simple`, `fast`, `earlier`, `fewer`, `walk`, `next`, `later`) et `followed` (vrai sur le trajet suivi) sur `steps`.
- Adresses : faux service d’adresses, scènes `base` et `down` (annexe A.2).
- Données réelles : critères marqués « annexe A.3 », sur l’instantané du 10/11/2026 avec le banc de la revue technique (`/home/claude/tech-review/`).
- Gestes : ▼ glisser vers le bas, ▲ glisser vers le haut, T toucher, TT double toucher.
- Heures marquées « à confirmer » : valeurs déduites des fixtures par l’équipe produit ; le calcul de référence du cœur fait foi et met à jour le test.

### 5.1 Must

#### M1. Favoris « réponse directe » sur l’accueil et dans la liste

Histoire : en tant que navetteur, quand j’ouvre Quai, je veux lire tout de suite, pour mes favoris utiles à ce moment, quand partir, quel véhicule prendre, sur quelle voie et à quelle heure j’arrive, sans rien toucher.

Comportement :
1. Accueil (`home`), dans cet ordre : « En cours » si un trajet est en cours (M6) ; les 2 premiers favoris de l’ordre intelligent, sur 2 lignes chacun (textes § 6.1, L1) ; « Autour de moi » ; « Autres favoris » ; « Aller à… ». Curseur sur le 1er élément. Sans favori : « Ajouter un favori » remplace les favoris et « Mes favoris » ; T ouvre la liste vide (L2), qui dit comment en ajouter un depuis les lunettes ou le téléphone.
2. Ligne du haut de l’accueil : seulement les horaires périmés, un avertissement de données ou « Temps réel indisponible : horaires prévus ~ » (M8). « Près de {lieu} » disparaît quand des favoris sont en tête (il reste avec « Accueil sans favoris »). Note « ~ horaire prévu, sans temps réel » quand un « ~ » est affiché. La liste peut défiler : avec une ligne du haut, la note et un trajet en cours, « Aller à… » passe sous le bord et ▼ l’amène.
3. « Autres favoris » (`favorites`) : les favoris suivants, même format, 3 visibles par écran.
4. Ordre intelligent, recalculé à chaque ouverture de l’accueil ou de la liste, figé tant que l’écran reste affiché :
   1. tout près : arrêt favori, ou trajet favori à départ fixe, à 300 m au plus (du plus proche au plus loin) ;
   2. prévu pour ce moment : « Le proposer à l’ouverture » sur « Le matin » (5 h à 11 h) ou « Le soir » (15 h à 21 h) ;
   3. utilisable d’ici : trajets depuis « Ma position », puis arrêts et départs fixes à 1 km au plus ;
   4. le reste, dans l’ordre choisi sur le téléphone ;
   5. en fin de liste : déjà sur place (destination à 300 m au plus : « tu y es ») ou rien dans les 3 heures.
   À égalité : l’ordre choisi sur le téléphone. Avec « Ordre des favoris : Dans mon ordre » (S3) : l’ordre du téléphone seul, sauf la règle 5.
5. La réponse d’un trajet favori est la proposition 1 du § 4, celle que montre et suit ensuite l’écran des étapes. De gare à gare : la marche jusqu’à la gare de départ est comprise si elle tient dans la marche maximale ; sinon l’heure du train est donnée (« départ 14:10 »).
6. Mise à jour toutes les 30 s (comme en 1.0) ; « … » tant que la réponse est en calcul, puis affichage favori par favori.
7. Le favori réglé « Quand je suis à moins de 300 m » s’ouvre seul à l’ouverture (1.0 gardée) ; pour un trajet favori, ce sont ses étapes qui s’ouvrent.
8. Sans position : « Autour de moi   sans position » (au lieu de « … » sans fin) ; les trajets depuis « Ma position » affichent « sans position ».

Critères d’acceptation :
- CA-M1.1 S1, scène `noRT` : `home` = « Vers le bureau » / « partir dans 2 min » / « IC à ~07:42, voie 4, direct, arrivée 08:58 » ; « Namur, train » / « IC ~07:42 v.4 » / « vers Bruxelles-Midi, puis ~08:42 » ; « Autour de moi   3 arrêts » ; « Autres favoris   4 » ; « Aller à… » ; note « ~ horaire prévu, sans temps réel » ; pas de ligne « Près de ». `order` commence par `fav-bureau`, `fav-namur`.
- CA-M1.2 S1, scène `base` : « partir dans 4 min » / « IC à 07:42 (+2 min), voie 6 !, direct, arrivée 09:00 » ; 2e favori « IC 07:42 +2 v.6 ! ».
- CA-M1.3 S2, scène `base` : à l’ouverture, les départs de « Gare du Nord, tram (STIB) » s’ouvrent seuls (1.0). TT : `home` = « Gare du Nord, tram » / « T3 2 min » / « vers Churchill, puis T4 Stalle 5 min » ; « Bruxelles-Nord, bus De Lijn » / « 232 ~5 min » / « vers Vilvorde, puis 460 Meise 10 min ». ▼ ▼ ▼ T sur « Autres favoris » : `order` = `fav-bureau`, `fav-gand`, `fav-namur`, `fav-maison` ; « Vers Gand-Saint-Pierre » / « départ 14:10 » / « IC voie 4 à Bruxelles-Central, arrivée 14:39 ».
- CA-M1.4 S3, scène `base` : 1er favori « Vers Gand-Saint-Pierre » / « partir dans 13 min » / « IC à 14:10, voie 4, direct, arrivée 14:39 ».
- CA-M1.5 Position du Bureau (50.8441, 4.3474) à 07:31 : « Vers le bureau » est en fin de liste, avec « tu y es » et sans 2e ligne ; T affiche « Tu es déjà au bureau. »
- CA-M1.6 Sur `favorites`, pendant 2 min de rafraîchissements avec passage de la scène `noRT` à `base`, `order` ne change pas ; les heures, elles, changent.
- CA-M1.7 Toutes les lignes de `home` et `favorites` des scénarios S1 à S3 tiennent dans leur colonne, mesurées au pixel (`textWidth`), sans « … ».
- CA-M1.8 Position refusée : « Autour de moi   sans position » ; trajets depuis « Ma position » : « sans position » ; arrêts favoris : leurs départs ; l’ordre n’applique que les règles 2, 4 et 5.
- CA-M1.9 Horaires périmés (ligne du haut) et note « ~ » : « Aller à… » est atteint par ▼ ; aucun autre élément n’est caché au premier affichage.

Gestes : réponse des 2 premiers favoris : 0 ; étapes du 1er : 1 (T) ; réponse des favoris 3 à 5 : 4 (▼ ▼ ▼ T) ; étapes du 5e : 7 (9 en 1.0) ; « Autour de moi » : 3 (▼ ▼ T ; 1 ou 2 en 1.0, voir R7).

#### M2. Un toucher : le trajet ; un glissement : un autre trajet ; un trajet suivi sûr

Histoire : en tant qu’utilisateur des lunettes, je veux qu’un toucher sur un trajet favori ou un lieu m’ouvre directement les étapes du trajet proposé, avec la raison de ce choix, qu’un glissement me montre un autre trajet, et que les lunettes suivent toujours le trajet que j’ai choisi.

Comportement :
1. T sur un trajet favori (accueil, « Autres favoris »), sur un lieu de « Aller à… », ou bouton « Lunettes » d’une carte sur le téléphone : écran « Trajet proposé » (`steps`), au trajet ouvert (proposition 1, ou celui de la carte). Ce trajet devient le « trajet suivi ».
2. Titre : « {Vers …} : {départ} → {arrivée} », où départ = heure de départ à pied s’il y a une marche au début, sinon heure estimée du premier véhicule. Ligne du haut : l’alerte 1.0 s’il y en a une (prioritaire), sinon la raison (§ 4.3). Ligne du bas : ce que fera ▼.
3. ▼ montre les étapes cachées s’il en reste, sinon le trajet suivant ; ▲ l’inverse. Pas de curseur mobile : « ▶ » marque l’étape en cours ou la prochaine, sur le trajet suivi seulement.
4. T sur le trajet suivi : détail du véhicule en cours ou du prochain (écran « Dans le train » de la 1.0). T sur un autre trajet : il devient le trajet suivi (« Trajet suivi : IC 08:42 »). TT : retour à l’écran précédent ; en revenant, on retrouve le même trajet.
5. Le suivi automatique de la 1.0 (au départ du véhicule, « Dans le train » ; à la descente, retour aux étapes ; 3 min avant une arrivée en gare, l’aide à l’arrivée) ne concerne que le trajet suivi. S’il se déclenche pendant qu’on regarde un autre trajet, l’écran revient au trajet suivi. Un ▼ machinal ne change donc jamais le train suivi (`review-ux.md`, R2).
6. Les écrans « Propositions » (`journeys`) et « Trains A ▶ B » (`trip`) ne sont plus ouverts par ces chemins (Q6).
7. Une marche vers une zone qui porte le même nom que l’arrêt de descente s’écrit « À pied vers l’arrêt du tram » (bus, métro) ou « À pied vers la gare ».
8. Trajet entièrement à pied : deux étapes, « Partir à pied » puis « Arrivée … » ; raison « Le plus simple : à pied, {n} min » ; jamais « direct » pour une marche.
9. Téléphone : la carte choisie est transmise et suivie, y compris pour les trains de gare à gare ; message « Affiché dans les lunettes : IC 14:22, voie 6. » (`review-ux.md` n° 1 : correctif à livrer dès une 1.0.2, Q14).

Critères d’acceptation :
- CA-M2.1 S1, scène `base`, T sur « Vers le bureau » : `steps`, `page` 1, `pages` 3, `label` `simple`, `followed` vrai ; titre « Vers le bureau : 07:35 → 09:00 » ; haut « ! Voie modifiée : l’IC part de la voie 6 » (l’alerte passe avant la raison) ; étapes de la 1.0 (« 07:35 Partir à pied vers la gare », « 07:42 IC vers Bruxelles-Midi, voie 6 +2 min », « 08:48 Descendre à Bruxelles-Central », « 09:00 Arrivée au bureau ») ; « ▶ » devant la 1re étape ; aide « ▲▼ autre trajet   toucher : détail   double : retour ».
- CA-M2.2 S1, scène `noRT` : haut « Le plus simple : direct, à pied 7 + 12 min » ; bas « ▼ Le suivant : 08:33 → 09:58 ». ▼ : `page` 2, `label` `next`, `followed` faux, titre « Vers le bureau : 08:33 → 09:58 », haut « Le suivant : même trajet, 1 h plus tard », étape « ~08:42 IC vers Bruxelles-Midi, voie 5 », pas de « ▶ », aide « ▲▼ autre trajet   toucher : suivre ce trajet   double : retour », bas « ▼ Le suivant : 09:33 → 10:58 ». ▼ : `page` 3, bas « ▲ trajet précédent ». ▼ de plus : rien ne change. ▲ ▲ : `page` 1.
- CA-M2.3 T sur le trajet suivi : `train` (« IC vers Bruxelles-Midi… ») ; TT : `steps`, même `page`.
- CA-M2.4 « Aller à… », T sur « Bureau » : `steps` directement, jamais `journeys`.
- CA-M2.5 S3, scène `base`, T sur « Vers Gand-Saint-Pierre » : titre « Vers Gand-Saint-Pierre : 14:10 → 14:39 » (pas de marche au début) ; haut « Le plus simple : direct » ; étapes « 14:10 IC vers Bruges, voie 4 » puis « 14:39 Arrivée à Gand-Saint-Pierre » ; bas « ▼ Le suivant : 14:25 → 14:56 » (heures estimées : l’IC de 14:22 a 3 min de retard). À 14:10 : `train` ; à 14:36 : `arrival` (1.0).
- CA-M2.6 Téléphone, S3 : recherche Bruxelles-Central → Gand-Saint-Pierre, bouton « Lunettes » de la 2e carte : `steps`, `page` 2, `followed` vrai ; message « Affiché dans les lunettes : IC 14:22, voie 6. » ; à 14:10 les lunettes ne passent pas « dans le train » du 14:10 ; à 14:25, `train` de l’IC de 14:22.
- CA-M2.7 Trajet entièrement à pied (lieu Bureau, position 50.8460, 4.3500) : étapes « Partir à pied » puis « Arrivée au bureau » ; haut « Le plus simple : à pied, {n} min » ; aide « ▲▼ autre trajet   double : retour » ; T ne fait rien.
- CA-M2.8 S1, scène `noRT` : trajet ouvert à 07:31 (page 1 suivie), ▼, la page 2 reste affichée ; à 07:42, l’écran passe à `train` de l’IC de 07:42 (pas celui de 08:42). Autre essai : sur la page 2, T affiche « Trajet suivi : IC 08:42 » et `followed` devient vrai sur la page 2.

Gestes : étapes depuis l’accueil : 1 ; autre trajet : 1 de plus (▼) ; détail du véhicule : 1 (T) ; suivre un autre trajet : 2 (▼, T) ; retour : TT. En 1.0, un autre trajet coûtait 3 gestes depuis les étapes (TT, ▼, T), et aucun n’était accessible quand les étapes venaient de la suggestion de l’accueil.

#### M3. « Le trajet le plus facile » : classement et étiquettes

Histoire : en tant que voyageur, je veux que Quai me propose d’abord le trajet le plus simple, puis le plus rapide s’il est vraiment différent, et me dise pourquoi.

Comportement : règles du § 4, dans le cœur, une seule fonction pour l’accueil, les favoris, « Aller à… », le téléphone et Quai Web. Chaque proposition porte une étiquette et une raison (textes § 6).

Critères d’acceptation :
- CA-M3.1 Tests unitaires du cœur : cas A à H du § 4.6 ; jamais deux propositions identiques ; 3 au plus ; jamais de véhicule supprimé ; égalités résolues comme au § 4.1.
- CA-M3.2 Pour une même recherche (S1 vers Bureau, S3 vers Gand-Saint-Pierre, S1 vers « Rue Neuve 1 »), téléphone et lunettes donnent les mêmes étiquettes dans le même ordre.
- CA-M3.3 S3, scène `base`, vers Gand-Saint-Pierre : pas de « Le plus rapide » ; propositions `simple` (14:10), `next` (14:22, +3 min), `next` (14:40).
- CA-M3.4 S1, scène `noRT`, vers « Rue Neuve 1, 1000 Bruxelles » : `simple` = IC jusqu’à Bruxelles-Central puis 10 min à pied, arrivée 08:56 ; `fast` = IC jusqu’à Bruxelles-Nord puis T3 jusqu’à De Brouckère, arrivée 08:51, raison « Le plus rapide : 5 min plus tôt, 1 changement » (à confirmer).
- CA-M3.5 Scénario Waterloo (annexe A.1, jeu de test à ajouter) : `simple` = bus W puis métro (1 changement, peu de marche) ; `fast` = marche jusqu’à la gare de Waterloo puis train (cas H).

Gestes : aucun de plus, la raison est sur l’écran des étapes et sur les cartes du téléphone.

#### M4. Adresses sur le téléphone : un seul champ

Histoire : en tant qu’utilisateur, je veux taper une adresse, une gare, un arrêt ou un de mes lieux dans un seul champ, choisir le bon résultat, puis y aller tout de suite ou l’enregistrer comme lieu.

Comportement :
1. Un seul champ partout où l’on choisit un endroit : « Départ » et « Arrivée » de « Rechercher un trajet », adresse d’un lieu, départ et arrivée d’un trajet favori. Le choix s’écrit dans le champ (« Bureau », « Ma position »), y compris dans le formulaire de favori, où il restait vide (`review-ux.md` n° 12). Accueil du téléphone : champ « Où vas-tu ? » qui ouvre la recherche, curseur dans « Arrivée ».
2. Propositions, avec leur type à droite (§ 6.2). Ordre : « Ma position », mes lieux, récents (S4), puis :
   - si le texte ressemble à une adresse (il contient un chiffre ou un mot de rue : rue, avenue, av., chaussée, chée, boulevard, bd, place, square, quai, chemin, drève, allée, straat, laan, steenweg, plein, lei, weg) : adresses, puis gares et arrêts ;
   - sinon : gares, arrêts, puis adresses.
   Au plus 4 adresses et 6 gares ou arrêts. Parmi les gares et arrêts : mot exact avant début de mot, puis métro, tram, bus, et l’opérateur local à égalité. Noms usuels trouvés : « gare du Midi », « gare du Nord », « gare Centrale » donnent aussi la gare SNCB ; « aéroport », « aeroport », « luchthaven » donnent Brussels Airport-Zaventem ; « LLN » donne Louvain-la-Neuve ; « St », « Sint » et « Saint » sont équivalents ; « gare » ou « station » est facultatif (`review-tech.md`, M7 et m7).
3. Adresses : services officiels gratuits, sans clé ni carte bancaire, des Régions bruxelloise, flamande et wallonne (décision technique ; Google reste une option future ; piste signalée par la revue UX : l’API de géocodage de Paradigm fondée sur BeST Address, à vérifier, Q2). Recherche dès 3 caractères, après 250 ms sans frappe. Adresse normalisée : « Rue de Fer 25, 5000 Namur ». À Bruxelles, nom dans la langue des noms réglée si le service la donne. Rue sans numéro : « Rue Neuve, 1000 Bruxelles (sans numéro) », position signalée comme approximative.
4. Choisir une adresse dans « Arrivée » lance la recherche de trajets (M3) ; sous le champ apparaît « Enregistrer comme lieu ».
5. Résultats : une carte par trajet, avec son étiquette, sa raison et son propre bouton « Lunettes » (un toucher affiche ce trajet dans les lunettes et le fait suivre) ; le grand bouton du bas disparaît ; un seul message d’état, à côté du bouton touché (`review-ux.md` n° 29).
6. « Enregistrer comme lieu » : un nom (raccourcis touchables « Maison », « Bureau », « École »), puis « Enregistrer le lieu » ; le lieu apparaît dans « Mes lieux » et dans « Aller à… ».
7. « Mes lieux », « Ajouter un lieu » : « Nom du lieu » avec les mêmes raccourcis, puis le champ « Adresse » unifié ; une fois l’adresse choisie, l’adresse normalisée et l’accès en confirmation (texte 1.0 : « Namur à 7 min à pied, bus TEC à 3 min »). « Utiliser ma position actuelle » reste, avec le sous-titre « si tu es sur place ». Le bloc « Ou placer le lieu près d’un arrêt » disparaît : un arrêt choisi dans le champ place le lieu à cet arrêt (« Près de Namur »). Jamais de coordonnées à l’écran.
8. Lieux 1.0 à adresse libre : gardés tels quels, sous-titre « Adresse à vérifier » et bouton « Vérifier l’adresse » dans leur écran.
9. Vie privée : seul le texte tapé part vers le service d’adresses ; jamais la position, jamais d’identifiant. Mention sous le champ (§ 6.2) ; `app/store/privacy.md` et liste blanche réseau de `app.json` mis à jour.
10. Accessibilité : propositions en liste de choix (`role="listbox"`), cartes de résultats en choix unique (`role="radiogroup"`, `role="radio"`), cibles de 44 px au moins, nombre de résultats annoncé (« 3 trajets. »).

Critères d’acceptation (faux service d’adresses, annexe A.2) :
- CA-M4.1 Scène `base` : « rue de fer 25 namur » : 1re proposition « Rue de Fer 25, 5000 Namur » / « adresse », affichée en moins d’1 s.
- CA-M4.2 « namur » : « Namur » / « gare SNCB » d’abord, puis les arrêts, puis les adresses.
- CA-M4.3 « gand » : Gand-Saint-Pierre et Gand-Dampoort (gares SNCB) d’abord, puis les arrêts, puis les adresses éventuelles.
- CA-M4.4 S3 : « Veldstraat 1, 9000 Gent » choisie dans « Arrivée » : cartes de résultats en moins de 3 s sur la machine de développement, chacune avec son bouton « Lunettes » ; « Enregistrer comme lieu » visible.
- CA-M4.5 « Enregistrer comme lieu », nom « Rendez-vous », « Enregistrer le lieu » : « Mes lieux » montre « Rendez-vous », « Veldstraat 1, 9000 Gent » et l’accès ; dans les lunettes, « Aller à… » montre « Rendez-vous   arrivée {HH:MM} ».
- CA-M4.6 Scène `down` : gares et arrêts restent proposés, avec « Adresses indisponibles pour l’instant : gares et arrêts seulement. » ; téléphone hors ligne : « Recherche d’adresse impossible sans connexion : gares et arrêts seulement. »
- CA-M4.7 Rien trouvé : « Aucune adresse, gare ou arrêt ne correspond. Ajoute la commune, ou vérifie l’orthographe. »
- CA-M4.8 Journal du faux service : chaque requête ne contient que le texte tapé (ni position, ni identifiant). `app.json` et `privacy.md` listent les nouvelles origines.
- CA-M4.9 Ajouter un lieu « Bureau » par adresse : 3 touchers et 1 saisie (raccourci « Bureau », saisie, choix, « Enregistrer le lieu ») ; aucune coordonnée affichée à aucun moment.
- CA-M4.10 Réglages 1.0 chargés : « Maison » et « Bureau » affichent « Adresse à vérifier » ; « Vérifier l’adresse » ouvre le champ avec le texte libre prérempli.
- CA-M4.11 Données réelles (annexe A.3) : « gare du midi » donne « Bruxelles-Midi » (gare SNCB) en tête ; « aéroport » donne « Brussels Airport-Zaventem » ; « lln » donne une gare ou un arrêt de Louvain-la-Neuve ; « rogier » donne le métro STIB avant le bus De Lijn.
- CA-M4.12 Nouveau trajet favori : après le choix de « Bureau » dans « Arrivée », le champ affiche « Bureau ».
- CA-M4.13 Lecteur d’écran : les cartes sont annoncées comme un groupe de choix, le bouton « Lunettes » d’une carte comme « Afficher Le plus simple dans les lunettes ».

Gestes : sur le téléphone, d’une adresse aux lunettes : saisie puis 2 touchers (le résultat, « Lunettes ») ; enregistrer un lieu : 2 touchers de plus et le nom. Dans les lunettes : 0 geste, le trajet s’affiche.

#### M5. Trajets porte à porte vers et depuis une adresse

Histoire : en tant que voyageur qui va à une adresse inconnue, je veux un trajet complet jusqu’à la porte, même s’il faut changer entre deux bus, trams ou métros.

Comportement (détail technique : `design-routing.md`) :
- M5a. Une adresse, enregistrée ou non, peut être le départ ou l’arrivée d’un calcul de trajet, d’un lieu, d’un trajet favori et de l’affichage dans les lunettes. Les combinaisons 1.0 restent (marche, ligne directe, trains, ligne urbaine avant ou après le train). La gare d’arrivée peut être à plus de 2 km de la destination quand une ligne urbaine les relie (`review-ux.md` n° 11).
- M5b. Une correspondance entre deux lignes urbaines (bus, tram, métro), y compris d’un réseau à l’autre (TEC ou De Lijn vers STIB, et l’inverse), marche de correspondance comprise.
- M5c. Deux correspondances en train (`review-tech.md`, M2), pour ne plus passer par Lille entre Namur et Saint-Nicolas.
- Aucun trajet complet trouvé : une issue plutôt qu’une impasse. Téléphone : « Pas de trajet complet. Essaie {gare}, puis le tram. » et un bouton « Chercher vers {gare} » (gare la plus proche de la destination) ; aucun arrêt à distance de marche : « Aucun arrêt à moins de {n} min à pied de cette adresse. » (§ 6.3).

Critères d’acceptation :
- CA-M5.1 S1, scène `noRT`, vers « Rue Neuve 1, 1000 Bruxelles » : au moins deux propositions (CA-M3.4) ; jamais « Aucun trajet trouvé ».
- CA-M5.2 S2 vers « Boulevard du Centenaire 1, 1020 Bruxelles » : `simple` = marche jusqu’à Rogier puis M6 vers Roi Baudouin, haut « Le plus simple : direct, à pied 6 + 1 min » (à confirmer).
- CA-M5.3 Depuis « Avenue Winston Churchill 100, 1180 Uccle » à 08:00 vers « Boulevard du Centenaire 1, 1020 Bruxelles » : `simple` = T3 vers Esplanade, descente à Rogier, M6 vers Roi Baudouin, haut « Le plus simple : 1 changement, à pied 2 + 1 + 1 min » (à confirmer). La 1.0 ne trouve aucun trajet (M5b).
- CA-M5.4 S3 vers « Veldstraat 1, 9000 Gent » (2,1 km de Gand-Saint-Pierre) : `simple` = « 14:10 IC vers Bruges, voie 4 », « 14:39 Descendre à Gand-Saint-Pierre », « 14:40 À pied vers l’arrêt du tram », « 14:44 T1 vers Korenmarkt », « 14:54 Descendre à Korenmarkt, Gand », « 14:57 Arrivée à Veldstraat 1 » ; haut « Le plus simple : 1 changement, à pied 1 + 3 min » (à confirmer). Même chose vers l’arrêt « Korenmarkt » (la 1.0 répond « Aucun trajet trouvé »).
- CA-M5.5 Scénario Waterloo (annexe A.1) : deux propositions d’étiquettes différentes (CA-M3.5).
- CA-M5.6 « Rue du Bois 1, 6600 Bastogne » (aucun arrêt dans les fixtures) : lunettes « Aucun trajet trouvé pour l’instant. » ; téléphone « Aucun arrêt à moins de 20 min à pied de cette adresse. »
- CA-M5.7 Temps de calcul : 2 s au plus par recherche sur la machine de développement avec les fixtures ; budget sur données réelles à fixer dans `design-routing.md` et à mesurer sur Quai Web avant publication.
- CA-M5.8 Données réelles (annexe A.3) : Namur vers Saint-Nicolas le 10/11 à 07:45 passe par Bruxelles (2 correspondances), pas par Lille.

Gestes : comme M2.

#### M6. Lunettes sans mauvaise surprise

Histoire : en tant qu’utilisateur, je veux qu’un toucher maladroit ne me fasse rien perdre, et retrouver mon trajet en cours en revenant à l’accueil ou en rouvrant Quai.

Comportement :
1. Retrait annulable : sur les départs d’un arrêt favori, T retire le favori et affiche « ★ Retiré. Toucher encore : annuler » pendant 5 s. Un T pendant ces 5 s le rétablit à l’identique (même identifiant, mêmes lignes, même réglage d’ouverture, même place) : « ★ Favori rétabli ». Après 5 s, T l’ajoute comme un nouveau favori (1.0). Le message ne suit pas un changement d’écran (1.0).
2. Départs d’un arrêt : plus de curseur (▲▼ font seulement défiler) ; un arrêt favori porte « ★ » à la fin de son titre (`review-ux.md` n° 5).
3. Trajet en cours : le trajet suivi (M2) devient « en cours » quand son heure de départ à pied est atteinte, et le reste jusqu’à son arrivée plus 5 min. Il prend fin plus tôt si, après le départ du premier véhicule, la position est encore à moins de 300 m du point de départ (le voyage n’a pas commencé).
4. Tant qu’un trajet est en cours, la 1re ligne de l’accueil est « En cours : {vers …} » avec l’étape suivante à droite (« IC 07:44, voie 6 », « descente 08:48 », « arrivée 09:00 ») ; T rouvre le trajet à l’écran qui correspond à l’heure (étapes ou « Dans le train »).
5. Réouverture de Quai pendant un trajet en cours : le trajet s’ouvre directement, avec « Trajet en cours : vers le bureau » pendant 3 s ; TT ramène à l’accueil, où la ligne « En cours » reste.

Critères d’acceptation :
- CA-M6.1 S2, scène `base`, départs de « Gare du Nord, tram (STIB) ★ » : T affiche « ★ Retiré. Toucher encore : annuler » ; T à moins de 5 s affiche « ★ Favori rétabli » ; `fav-gdn` revient avec son filtre (T3, T3, T4), « Quand je suis à moins de 300 m » et sa 2e place sur le téléphone.
- CA-M6.2 Même départ, T après 6 s : « ★ Ajouté aux favoris », nouveau favori réglé « Jamais ». Sur les départs, ▲▼ ne déplacent aucun curseur.
- CA-M6.3 S1, scène `base` : étapes du bureau ouvertes à 07:31 et laissées affichées jusqu’à 07:36 ; TT : `home` commence par « En cours : vers le bureau   IC 07:44, voie 6 » ; quitter (TT, confirmation) ; rouvrir à 08:05 avec la position près d’Ottignies (50.6727, 4.5694) : `train` (« IC vers Bruxelles-Midi, +2 min ») et « Trajet en cours : vers le bureau ».
- CA-M6.4 Étapes ouvertes à 07:31, TT à 07:32 (avant l’heure de départ), quitter ; rouvrir à 07:50 : `home`, sans ligne « En cours ».
- CA-M6.5 Comme CA-M6.3, mais rouvrir à 07:50 avec la position toujours à la maison : `home`, sans ligne « En cours » (l’IC de 07:44 est parti sans l’utilisateur).
- CA-M6.6 Comme CA-M6.3, rouvrir à 09:10 (arrivée 09:00 plus de 5 min) : `home`, sans ligne « En cours ».

Gestes : annuler un retrait : 1 (impossible en 1.0) ; retrouver le trajet en cours : 0 à la réouverture, 1 depuis l’accueil (5 et plus en 1.0).

#### M7. Passer à la 1.1 sans effort

Histoire : en tant que propriétaire non développeur, je veux savoir quand une mise à jour est utile et l’installer avec un guide clair en français, sans perdre mes lieux ni mes favoris.

Comportement :
1. Réglages 1.0 repris automatiquement (lieux, favoris avec ordre et réglages, affichage, alertes). Rien à refaire ; pas de nouvel écran « Bienvenue ». Un favori dont la zone a changé d’identifiant est retrouvé (M8).
2. Guide `docs/MISE-A-JOUR.md`, lié depuis `INSTALL.md` (section « Mettre à jour Quai ») :
   - « Quand mettre à jour ? » : les horaires se mettent à jour seuls chaque nuit ; une mise à jour de l’appli sert seulement à recevoir une nouvelle version, comme la 1.1.
   - Voie la plus simple : demander à Claude, connecteur GitHub branché : « Passe Quai en version 1.1.0 » ; il ne reste alors que Even Hub et le téléphone.
   - Pour chaque étape : le nom anglais exact du bouton, entre guillemets, sa traduction, l’endroit où il se trouve, et une image (capture, ou dessin simple quand la capture est impossible depuis l’environnement de développement).
   - Au plus 8 étapes, et une vérification finale : l’écran « Données » affiche « Version de Quai   1.1.0 ».
3. Téléphone, écran « Données » : ligne « Version de Quai ».
4. `app/store/changelog/1.1.0.txt` (§ 10) et `app/app.json` en 1.1.0.

Critères d’acceptation :
- CA-M7.1 Réglages de `fixtures/app/preset.json` (1.0) chargés dans l’appli 1.1 : mêmes lieux, mêmes favoris (identifiants, ordre, réglages), pas d’écran « Bienvenue » ; message « Quai 1.1 » une seule fois dans les lunettes (S2).
- CA-M7.2 Le guide se suit sans connaître l’anglais : chaque bouton anglais est traduit ; une personne non développeuse le suit seule jusqu’à la vérification finale.
- CA-M7.3 « Données » affiche « Version de Quai   1.1.0 ».
- CA-M7.4 Le workflow « Paquet de l’appli » produit le paquet 1.1.0 ; les notes font 500 caractères au plus.

Gestes : sans objet.

#### M8. Des réponses justes sur les vraies données

Histoire : en tant qu’utilisateur, je veux que ce que les lunettes m’affichent soit vrai sur le vrai réseau : le bon train, pas de départ en double, mon arrêt en entier, une réponse même quand le temps réel tarde, et une panne dite comme elle est.

Pourquoi c’est un Must : sans ces correctifs, la réponse mise en avant par M1 et M2 serait fausse sur le trajet type du propriétaire (`review-tech.md`, B1) et trompeuse pendant une panne du temps réel (`review-ux.md` n° 6 à 8). Le détail technique et les fichiers à modifier sont dans les revues ; ici, le résultat attendu.

Comportement :
1. Gares candidates et correspondances : les garde-fous du § 4.2 (grandes gares voisines candidates, attente de 60 min au plus, pas de correspondance inutile, montée et descente autorisées seulement).
2. Départs uniques et réels : un départ par voyage et par zone, pas de départ vers un terminus situé dans la zone même, doublons SNCB écartés.
3. Une station, une zone : les zones de même nom à moins de 300 m sont fusionnées (Gare du Nord tram et bus ; quais TEC « LA HULPE Gare ») ; le titre des départs donne les modes (« Gare du Nord, tram et bus (STIB) ») ; un favori dont la zone a changé d’identifiant est retrouvé par opérateur, nom et position (moins de 150 m), sinon signalé (« introuvable : modifie-le sur le téléphone »).
4. Premier affichage sur l’horaire prévu après 1,5 s au plus quand le relais tarde ; temps réel fusionné au rafraîchissement suivant.
5. Panne du temps réel dite juste : « Temps réel indisponible : horaires prévus ~ » (« Pas de réseau » seulement si le téléphone est hors ligne) ; suppressions et voies modifiées déjà connues gardées 15 min ; accueil : cette phrase en ligne du haut ; téléphone : « Temps réel indisponible, horaires prévus » au lieu de « Tout est à jour ».
6. Lancement sans horaires : « Horaires injoignables : nouvel essai dans 30 s » ; « vérifie la publication de cette nuit » seulement si le serveur répond sans le fichier.
7. Accueil léger : le nombre d’arrêts de « Autour de moi » se calcule sans charger les départs de toutes les zones.

Critères d’acceptation :
- CA-M8.1 Données réelles (annexe A.3) : Maison (50.4655, 4.8590) vers Bureau (50.8441, 4.3474), 10/11 07:31, marche maximale 10 min : proposition 1 = IC jusqu’à Bruxelles-Central puis 12 min à pied ; jamais Bruxelles-Chapelle en proposition 1 ; une proposition existe à 23:50 pour le lendemain.
- CA-M8.2 Données réelles : départs de Namur (`sncb:8863008`) le 10/11 à 17:30 : l’IC de 17:38 vers Lille Flandres n’apparaît qu’une fois.
- CA-M8.3 Données réelles : autour de (50.8600, 4.3600), 500 m : une seule ligne « Gare du Nord » STIB, dont les départs montrent trams et bus ; le favori de démonstration `fav-gdn` (`stib:6357F`, absent des données réelles) est retrouvé.
- CA-M8.4 Données réelles : Liège-Guillemins vers Bruxelles-Nord le 11/11 à 09:10 : aucun train de nuit proposé ; la recherche « mouscron » ne propose plus « Mouscron-Frontière ».
- CA-M8.5 Relais suspendu : chaque écran de départs s’affiche en 1,5 s au plus, avec « ~ ».
- CA-M8.6 S2, scène `base`, départs de Bruxelles-Nord, train : « S1 12:34 SUPPRIMÉ » ; passage en scène `noRT` : la ligne reste « SUPPRIMÉ » pendant 15 min ; note « Temps réel indisponible : horaires prévus ~ » ; accueil : même phrase en ligne du haut.
- CA-M8.7 Serveur d’horaires arrêté au lancement : « Horaires injoignables : nouvel essai dans 30 s ».
- CA-M8.8 Accueil : réponses des 2 favoris en tête en 2 s au plus quand les fichiers sont en cache, 4 s au plus à froid (mesure sur Quai Web, téléphone du propriétaire) ; « … » en attendant.

Gestes : sans objet.

### 5.2 Should

#### S1. Premier lancement avec Maison et Bureau

Histoire : au premier lancement, je veux donner mes deux adresses principales et trouver aussitôt mes trajets du matin et du soir dans les lunettes.
Comportement : après « Bienvenue » (1.0), étape facultative « Tes lieux » : champs unifiés « Maison » et « Bureau » ; case cochée « Me proposer le trajet vers le bureau le matin, et vers la maison le soir ». « Terminer » crée les lieux et deux trajets favoris (« Ma position » vers Bureau, « Le matin » ; « Ma position » vers Maison, « Le soir »). « Plus tard » ne crée rien.
- CA-S1.1 `reset=1`, après « Continuer » : écran « Tes lieux » ; deux adresses, « Terminer » : « Mes lieux » = Maison, Bureau ; « Mes favoris » = « Ma position → Bureau » (« Trajet porte à porte, proposé le matin ») et « Ma position → Maison » (« …, proposé le soir »).
- CA-S1.2 Lunettes, S1 : `home` commence par « Vers le bureau ».
- CA-S1.3 « Plus tard » : aucun lieu, aucun favori ; `home` = « Ajouter un favori », « Autour de moi   {n} arrêts », « Aller à… » ; T sur « Ajouter un favori » : la liste vide de L2.
Gestes : 0 dans les lunettes, l’accueil se met à jour seul. Téléphone : 7 touchers et 2 saisies jusqu’au trajet du lendemain matin (17 touchers et 3 saisies en 1.0, `review-ux.md` § 1).

#### S2. Aides de gestes cohérentes et message « Quai 1.1 »

Comportement : toutes les aides suivent « ▲▼ {quoi}   toucher : {action}   double : {retour ou quitter} » ; liste exacte au § 6.1. À l’écran racine, le double toucher quitte et l’aide le dit (« double : quitter »), y compris sur l’accueil et sur l’erreur au lancement. Message « Quai 1.1 » (§ 6.1, L9) à la première ouverture après la mise à jour, une seule fois ; jamais après une nouvelle installation (S1 le remplace).
- CA-S2.1 Chaque écran affiche exactement l’aide du § 6.1.
- CA-S2.2 Le message « Quai 1.1 » apparaît une fois ; T mène à `home` ; il ne revient pas à l’ouverture suivante.

#### S3. « Garder en favori » depuis la recherche, ordre des favoris, créneaux proposés d’office

Comportement : sous les résultats d’une recherche, « Garder en favori » crée un trajet favori (départ et arrivée de la recherche, nom = la destination, « Jamais ») ; s’il existe déjà : « Déjà dans tes favoris. ». Après l’enregistrement d’un nouveau lieu : « Ajouter le trajet vers {nom} à tes favoris ? » avec « Ajouter aux favoris » et « Non merci » ; pour « Bureau » le créneau « Le matin » est proposé d’office, pour « Maison » « Le soir ». « Mes favoris », « Changer l’ordre » : boutons « Monter », « Descendre », « Terminé ». « Affichage », « Ordre des favoris » : « Selon l’heure et le lieu » (par défaut) ou « Dans mon ordre ». Créneaux affichés avec leurs heures : « Le matin (5 h à 11 h) », « Le soir (15 h à 21 h) ».
- CA-S3.1 S3, recherche vers « Veldstraat 1 », « Garder en favori » : « Ajouté à tes favoris. » ; dans les lunettes, « Vers Veldstraat 1 » apparaît dans « Autres favoris » (règle 3 : trajet depuis « Ma position ») avec sa réponse, 2e ligne « IC à 14:10, voie 4, 1 changement, arrivée 14:57 » (à confirmer).
- CA-S3.2 « Dans mon ordre » et un favori monté en 1re place : `order` de `home` le suit, quelles que soient l’heure et la position (sauf « tu y es »).

#### S4. Adresses récentes

Comportement : les 5 dernières adresses choisies (pas les arrêts) restent sur le téléphone ; elles apparaissent comme « récent » dans le champ, et les 3 plus récentes dans « Aller à… » après les lieux (T : étapes). « Effacer les adresses récentes » dans « Mes lieux ».
- CA-S4.1 Après CA-M4.4, « Aller à… » montre « Veldstraat 1   arrivée {HH:MM} » ; T ouvre `steps`.
- CA-S4.2 Après « Effacer les adresses récentes », elles disparaissent partout.
Gestes : 2 depuis « Aller à… » (▼, T).

#### S5. Noms lisibles et homonymes (`review-tech.md`, M6, m2, m3, m4)

Comportement :
- Noms TEC (arrêts et destinations) avec préfixe de commune en capitales mis en casse normale, commune répétée retirée : « WATERLOO Eglise » devient « Waterloo Eglise », « BRUXELLES Midi » devient « Bruxelles Midi », « BRAINE-L'ALLEUD Gare » devient « Braine-l’Alleud Gare » (on n’invente pas les accents absents de la source).
- Pas de double préfixe de ligne : « T2 » et non « TT2 », « M3 » et non « MM3 ».
- Zones sans aucun départ (« Noord afstaphalte ») absentes de « Autour de moi » et de la recherche, ou marquées « arrivée seulement ».
- Noms français De Lijn complétés (« La Hulpe » et non « Terhulpen ») ; une destination égale au nom d’une zone du même opérateur reprend ses noms.
- Deux propositions de même nom et de même type dans la recherche : la commune est ajoutée au type (« métro TEC, Charleroi »).
- CA-S5.1 Données réelles : la recherche « waterloo » donne « Waterloo » (gare SNCB) d’abord, et « Charleroi Waterloo (M) » avec « métro TEC, Charleroi » ; les départs de « Waterloo Eglise » affichent « W   Bruxelles Midi ».
- CA-S5.2 Départs de `delijn:200552` : « T2 Melle Leeuw » ; aucune ligne « TT » ni « MM » dans les écrans des 16 lieux testés par la revue.

#### S6. Textes plus clairs (`review-ux.md` n° 16, 21, 22, 23, 25, 28, 30, 32 ; `review-tech.md` m5)

Comportement :
- Étapes : la durée de marche passe dans le texte (« Partir à pied vers la gare (7 min) », « Arrivée au bureau (12 min à pied) ») ; la colonne de droite (108 px au lieu de 96) ne donne que l’état : « dans 4 min », « en cours », « +2 min », « SUPPRIMÉ ».
- « trajet » partout (plus de « itinéraires » ni « propositions ») ; titre d’attente des départs = nom de l’arrêt, pas « Départs ».
- « demain » jamais avant 04:00 du matin ; si tous les départs d’un écran sont le lendemain, une seule ligne du haut « Départs de demain » au lieu de « demain, » devant chaque ligne.
- « imminent » remplace « 0 min » pour les bus, trams et métros ; au-delà de 60 min, une heure et non des minutes, le « ~ » devant l’heure (« demain ~06:02 », jamais « ~298 min »).
- Liste de favoris vide, dans les lunettes : comment en ajouter un depuis les lunettes (§ 6.1, L2).
- Téléphone : confirmations de suppression dans la page (« Supprimer ce favori ? », « Supprimer », « Annuler »), plus de boîte du système ; créneaux avec leurs heures (S3).
- CA-S6.1 Un départ dans moins d’une minute s’affiche « imminent » sur les départs et dans « Autour de moi ».
- CA-S6.2 Données réelles, `stib:7` le 11/11 à 00:20 : le métro 5 vers Erasme affiche une heure, jamais « ~298 min ».
- CA-S6.3 S1, `steps` : « 07:35 Partir à pied vers la gare (7 min)   dans 4 min » à 07:31, puis « en cours » à 07:36 ; « 09:00 Arrivée au bureau (12 min à pied) ».
- CA-S6.4 À 23:30 (S2), un train à 00:01 s’affiche sans « demain ».

#### S7. Ouverture rapide et sobre en données (`review-tech.md`, M9, m8, m9)

Comportement : le cache persistant garde les fichiers réellement utiles (budget en octets adapté au stockage du SDK) ; le fichier de trains du lendemain n’est chargé que le soir ou faute de résultat ; identifiants De Lijn raccourcis et clés de recherche plus fines pour les mots courants (« rue »). Détail dans la revue.
- CA-S7.1 Deuxième ouverture de Quai dans la même journée, réseau coupé : l’accueil affiche les réponses des favoris (horaire prévu, « ~ ») sans télécharger à nouveau les trains.

#### S8. Mes favoris sur le téléphone, avec un bouton « Lunettes » (`review-ux.md` n° 14)

Comportement : sur l’accueil du téléphone, une section « Mes favoris » au-dessus de « Réglages » : chaque favori avec sa réponse courte (« partir à 07:35 », « T3 2 min », mêmes règles que les lunettes) et un bouton « Lunettes » qui l’affiche dans les lunettes (trajet : étapes, et il devient le trajet suivi ; arrêt : départs). Lien « Gérer mes favoris » vers la liste des réglages.
- CA-S8.1 S1 : la section montre « Vers le bureau   partir à 07:33 » ; « Lunettes » affiche `steps`, `followed` vrai, en 1 toucher.
Gestes : 0 dans les lunettes ; 1 toucher sur le téléphone.

### 5.3 Could

- C1. Arrêts des bus, trams et métros dans « Dans le train » (motifs `patterns.next`), avec « descente dans 3 arrêts ».
- C2. Aperçu des lunettes dans l’écran d’un favori, sur le téléphone (la revue UX conseille de le monter en Should : c’est là qu’on voit l’effet de « Le proposer à l’ouverture »).
- C3. Avis « Nouvelle version disponible » sur le téléphone, d’après un fichier `version.json` publié chaque nuit avec la version du dépôt.
- C4. « Sans marches » : le pipeline garde `wheelchair_boarding` et `wheelchair_accessible` (GTFS) ; le critère 3 du § 4.1 s’active, et la raison dit « sans marches » quand c’est vrai pour tout le trajet.
- C5. Nombre de favoris en tête de l’accueil réglable (0 à 3).
- C6. Réglages d’alertes : « Marge avant de partir » déplacée dans « Mes lieux » (elle change l’heure de départ, alerte coupée ou non) ; « Seuil du retard » grisé quand l’alerte est coupée (`review-ux.md` n° 31).

## 6. Textes exacts

### 6.0 Conventions

- Espace insécable (U+00A0) devant « : », « ; », « ! », « ? » et entre un nombre et son unité (« 7 min », « 80 m »), comme en 1.0. Guillemets « ». Jamais de tiret cadratin.
- « ~ » devant une heure ou une attente sans temps réel (réglage « Signaler les horaires prévus ») ; « ! » après une voie modifiée (1.0) ; « → » pour « vers » et entre deux heures ; « ▶ » seulement pour le curseur et le repère d’étape.
- {…} : valeur variable. Largeurs mesurées au pixel avec la police des lunettes (`@evenrealities/pretext`) : ligne entière 542 px, colonne gauche des menus 340 px, colonne droite des menus 190 px, titre 476 px, colonne du milieu des étapes 342 px (avec la colonne d’état de 108 px, S6). Tous les exemples de ce chapitre tiennent ; le plus long : « ▲▼ autre trajet   toucher : suivre ce trajet   double : retour » (503 px). Un nom trop long est coupé avec « … » en gardant la destination.
- Ajustement d’une 2e ligne de favori trop longue : retirer « direct, », puis écrire « v. » au lieu de « voie », puis couper avec « … ».
- « inchangé » : texte de la 1.0, à garder mot pour mot.

### 6.1 Lunettes

L1. Accueil (`home`)

| Élément | Texte |
|---|---|
| Titre | « Quai » (inchangé) |
| Ligne du haut | horaires périmés et avertissements (inchangés) ; « Temps réel indisponible : horaires prévus ~ » (M8) ; « Près de {lieu} » seulement avec « Accueil sans favoris » |
| Trajet en cours (M6) | « En cours : {vers …} » à gauche ; à droite l’étape suivante : « IC 07:44, voie 6 », « descente 08:48 », « arrivée 09:00 » |
| Trajet favori, ligne 1, à gauche | « Vers {destination} » avec l’article de la 1.0 : « Vers le bureau », « Vers la maison », « Vers Gand-Saint-Pierre », « Vers Veldstraat 1 » |
| Trajet favori, ligne 1, à droite | « partir dans {n} min » (1 à 15 min) ; « partir maintenant » (heure atteinte, trajet encore attrapable) ; « partir à {HH:MM} » (au-delà de 15 min) ; « partir demain {HH:MM} » ; « départ {HH:MM} » (gare de départ hors de portée à pied) ; « à pied {n} min » ; « tu y es » ; « aucun trajet » ; « sans position » ; « … » (calcul) |
| Trajet favori, ligne 2 | « {véhicule} à {HH:MM}{ (+{n} min)}, voie {p}{ !}, {direct / 1 changement / {n} changements}, arrivée {HH:MM} ». Véhicule : « IC », « S1 », « T4 », « M2 », « Bus 232 ». Exemples : « IC à 07:42, voie 4, direct, arrivée 08:58 » ; « IC à 07:42 (+2 min), voie 6 !, direct, arrivée 09:00 » ; « T4 à 12:15, direct, arrivée 12:29 » ; « Bus W à 07:58, 1 changement, arrivée 08:52 ». Gare hors de portée : « IC voie 4 à Bruxelles-Central, arrivée 14:39 ». À pied : « à pied, arrivée 23:55 ». « tu y es » : pas de 2e ligne. |
| Arrêt favori, ligne 1, à gauche | libellé de « Autour de moi » (1.0) : « Gare du Nord, tram », « Bruxelles-Nord, bus De Lijn », « Namur, train » |
| Arrêt favori, ligne 1, à droite | prochain départ au format 1.0 : « T3 2 min », « 232 ~5 min », « IC 07:42 +2 v.6 ! », « IC ~demain 08:42 », « T3 2 min, dernier » |
| Arrêt favori, ligne 2 | bus, tram, métro : « vers {destination 1}, puis {ligne 2} {destination 2} {attente 2} » (« vers Churchill, puis T4 Stalle 5 min ») ; train : « vers {destination 1}, puis {HH:MM 2} » (« vers Bruxelles-Midi, puis ~08:42 ») ; rien : « aucun départ dans les prochaines heures » ; zone disparue (M8) : « introuvable : modifie-le sur le téléphone » |
| Menu | « Autour de moi   {n} arrêts » (inchangé) ou « Autour de moi   sans position » ; « Autres favoris   {n} » (quand des favoris sont montrés au-dessus), sinon « Mes favoris   {n} » ; « Aller à… » (inchangé) ; sans favori : « Ajouter un favori » à la place des favoris et de « Mes favoris » |
| Toucher sur « Ajouter un favori » | la liste vide de L2 |
| Note | « ~ horaire prévu, sans temps réel » quand un « ~ » est affiché |

L2. Autres favoris, Mes favoris (`favorites`)

| Élément | Texte |
|---|---|
| Titre | « Autres favoris » (depuis l’accueil avec favoris) ou « Mes favoris » |
| Éléments | comme L1 |
| Note | « ~ horaire prévu, sans temps réel » (inchangée) |
| Liste vide | « Aucun favori pour l’instant. » / « Ouvre un arrêt dans Autour de moi et touche-le, » / « ou ajoute un trajet sur le téléphone. » |

L3. Trajet proposé (`steps`)

| Élément | Texte |
|---|---|
| Titre | « {Vers …} : {HH:MM} → {HH:MM} » (« ▶ » de la 1.0 remplacé par « → ») |
| Ligne du haut | alerte 1.0 s’il y en a une ; sinon la raison : « Le plus simple : {changements}{, à pied {a} + {b} min} » ; « Le plus simple : à pied, {n} min » ; « Le plus rapide : {n} min plus tôt, {changements} » ; « Plus tôt : {changements}, départ {HH:MM} » ; « Sans changement : arrivée {HH:MM} » ; « Moins de changements : arrivée {HH:MM} » ; « À pied : {n} min, arrivée {HH:MM} » ; « Le suivant : même trajet, {n} min plus tard » ou « …, 1 h plus tard » ; « Plus tard : {changements}, départ {HH:MM} ». Changements : « direct », « 1 changement », « {n} changements ». Marches : chacune d’au moins 1 min, dans l’ordre ; au-delà de 3 : « {total} min à pied ». |
| Étapes | 1.0 : « Partir à pied vers la gare », « {véhicule} vers {destination}, voie {p} », « Descendre à {arrêt} », « À pied vers {zone} », « Arrivée au bureau » ; nouveau : « À pied vers l’arrêt du tram » (bus, métro) et « À pied vers la gare » quand la zone porte le nom de l’arrêt de descente ; « Arrivée à {adresse courte} » ; trajet à pied : « Partir à pied » ; avec S6, durées dans le texte (« (7 min) », « (12 min à pied) ») et colonne d’état (« dans 4 min », « en cours », « +2 min », « SUPPRIMÉ ») |
| Repère | « ▶ » devant l’étape en cours ou la prochaine, sur le trajet suivi seulement |
| Ligne du bas | « ▼ {étiquette} : {HH:MM} → {HH:MM} » (trajet suivant) ; « ▼ {n} étapes de plus » ; « ▲ trajet précédent » (dernier trajet) ; « Pas d’autre trajet pour l’instant » (trajet unique) |
| Aide | trajet suivi : « ▲▼ autre trajet   toucher : détail   double : retour » ; autre trajet : « ▲▼ autre trajet   toucher : suivre ce trajet   double : retour » ; trajet à pied : « ▲▼ autre trajet   double : retour » |
| Message | « Trajet suivi : {véhicule} {HH:MM} » (« Trajet suivi : IC 08:42 ») |
| Attente | « Calcul du trajet… » |
| Aucun trajet | titre « Vers … », « Aucun trajet trouvé pour l’instant. » (inchangé) |
| Déjà sur place | « Tu es déjà au bureau. » (inchangé) |

L4 « Dans le train » et L5 « Arrivée » : inchangés, sauf l’aide de L4 (liste ci-dessous) ; C1 pour les arrêts des bus et trams.

L6. Départs d’un arrêt (`board`)

| Élément | Texte |
|---|---|
| Titre | 1.0, avec les modes d’une zone fusionnée (« Gare du Nord, tram et bus (STIB) ») et « ★ » à la fin pour un favori (« Gare du Nord, tram (STIB) ★ ») ; titre d’attente : le nom de l’arrêt (S6) |
| Retrait | « ★ Retiré. Toucher encore : annuler » (5 s) |
| Annulation | « ★ Favori rétabli » |
| Ajout | « ★ Ajouté aux favoris » (inchangé) |
| Attente imminente (S6) | « imminent » au lieu de « 0 min » |
| Tous les départs demain (S6) | ligne du haut « Départs de demain » |

L7. Autour de moi (`nearby`) : inchangé, sauf l’aide (liste ci-dessous) et « imminent » (S6).

L8. Aller à… (`places`)

| Élément | Texte |
|---|---|
| Lieux | « {lieu}   arrivée {HH:MM} », « ici », « {n} min à pied », « aucun trajet » (inchangés) |
| Adresses récentes (S4) | « {adresse courte}   arrivée {HH:MM} » |
| Dernière ligne | « Autre adresse   sur le téléphone » (remplace « Autre lieu ») |
| Toucher sur « Autre adresse » | « Tape l’adresse dans Quai, sur le téléphone » |
| Sans lieu | « Aucun lieu enregistré   sur le téléphone » (inchangé) |

L9. Messages (`message`)

| Message | Texte |
|---|---|
| Bienvenue | « Bienvenue dans Quai ! » / « Termine les réglages sur le téléphone : » / « appli Even Realities, onglet Even Hub, Quai. » / « Position, langue et tes lieux, en une minute. » (Quai Web : textes 1.0, dernière ligne « position, langue et tes lieux, en une minute. ») |
| Quai 1.1 (une fois) | titre « Quai 1.1 » ; « Nouveau : tes favoris donnent la réponse. » / « Toucher un favori : le trajet, étape par étape. » / « Sur un trajet, ▼ : un autre trajet. » / « Les adresses se tapent sur le téléphone. » |
| Reprise | « Trajet en cours : vers le bureau » (message court, 3 s) |
| Horaires injoignables (M8) | « Horaires injoignables : nouvel essai dans 30 s » |
| Position | « Position indisponible. » / « Autorise la position pour Quai dans l’appli Even. » (inchangé) |

Aides de gestes, liste complète (S2) :

| Écran | Aide |
|---|---|
| L1 Accueil | « ▲▼ choisir   toucher : ouvrir   double : quitter » |
| L2 Favoris | « ▲▼ choisir   toucher : ouvrir   double : retour » (inchangée) |
| L3 Trajet proposé | voir L3 |
| L4 Dans le train | « ▲▼ arrêts   double : retour » (remplace « double toucher : retour ») |
| L5 Arrivée | « toucher : ★ garder ce trajet   double : retour » (inchangée) |
| L6 Départs | « ▲▼ départs   toucher : ★ favori   double : retour » ou « ▲▼ départs   toucher : ★ retirer   double : retour » (inchangées ; ▲▼ font défiler) |
| L7 Autour de moi | « ▲▼ arrêt   toucher : départs   double : retour » |
| L8 Aller à… | « ▲▼ choisir   toucher : trajet   double : retour » (remplace « toucher : itinéraires ») |
| L9 Messages | « double toucher : retour » (inchangée) ; erreur à la racine : « toucher : réessayer   double : quitter » ; bienvenue : « toucher : continuer   double : quitter » (inchangée) ; « Quai 1.1 » : « toucher : continuer » |

### 6.2 Téléphone

T1. Accueil

| Élément | Texte |
|---|---|
| Champ de recherche (remplace le bouton « Rechercher un trajet ») | « Où vas-tu ? » ; texte d’exemple « Adresse, gare, arrêt ou lieu » |
| Section « Mes favoris » (S8) | titre « Mes favoris » ; ligne : nom du favori, réponse courte (« partir à 07:33 », « T3 2 min »), bouton « Lunettes » ; lien « Gérer mes favoris » |
| Bannière, une fois après la mise à jour | « Nouveau : tape une adresse, Quai trouve le trajet le plus simple. » ; bouton « OK » |
| Sous-titre de « Données » pendant une panne (M8) | « Temps réel indisponible, horaires prévus » (au lieu de « Tout est à jour ») |
| Le reste | inchangé |

T2. Rechercher un trajet

| Élément | Texte |
|---|---|
| Champs | « Départ » (« Ma position, {gare proche} », inchangé) ; « Arrivée », texte d’exemple « Adresse, gare, arrêt ou lieu » |
| Types | « position actuelle », « mon lieu », « récent », « adresse », « gare SNCB », « métro STIB », « tram STIB », « bus STIB », « tram De Lijn », « bus De Lijn », « bus TEC », « métro TEC » |
| Sous une adresse choisie | lien « Enregistrer comme lieu » |
| Aide de saisie (pas de chiffre ni de mot de rue, 3 lettres ou plus, aucun arrêt trouvé) | « Pour une adresse, ajoute la rue et le numéro. » |
| Mention sous le champ | « Adresses : services officiels des Régions bruxelloise, flamande et wallonne. Seul le texte tapé leur est envoyé, ta position reste sur le téléphone. » |
| En-tête des résultats | inchangé (« {départ} → {arrivée} », « dès {HH:MM} », « Changer l’heure ») |
| Étiquette de carte | « Le plus simple », « Le plus rapide », « Plus tôt », « Sans changement », « Moins de changements », « À pied », « Le suivant », « Plus tard » |
| Carte, lignes | « {HH:MM} → {HH:MM} », mêmes heures que le titre de L3 ; « {durée}, {direct / 1 changement / {n} changements}, {n} min à pied » ; pastilles et détail inchangés (« Voie 4 à Namur, à l’heure ») |
| Carte, phrase | Le plus simple : « Le moins de changements et de marche. », ou « Le plus simple, et aussi le plus rapide. » s’il n’y a pas de plus rapide ; Le plus rapide : « Arrive {n} min plus tôt, avec {k} changement de plus. » (« changements » au-delà de 1), ou « Arrive {n} min plus tôt, avec plus de marche. » ; Plus tôt : « Arrive {n} min plus tôt, en partant à {HH:MM}. » ; Sans changement : « Aucun changement, mais arrive {n} min plus tard. » ; Moins de changements : « Moins de changements, mais arrive {n} min plus tard. » ; À pied : « Sans attendre : {n} min à pied. » ; Le suivant : « Même trajet, départ suivant. » ; Plus tard : « Un autre trajet, plus tard. » |
| Carte, bouton | « Lunettes » (lecteur d’écran : « Afficher {étiquette} dans les lunettes ») |
| Sous les cartes | « Garder en favori » (S3) ; « Enregistrer l’adresse comme lieu » (départ ou arrivée = adresse non enregistrée) |
| Messages (un seul à la fois, à côté du bouton touché) | « Affiché dans les lunettes : {véhicule} {HH:MM}, voie {p}. » (« Affiché dans les lunettes : IC 14:22, voie 6. ») ; « Ajouté à tes favoris. » ; « Déjà dans tes favoris. » ; « Lieu enregistré : {nom}. » |

T3. Mes lieux

| Élément | Texte |
|---|---|
| Ligne d’un lieu | nom ; adresse normalisée, ou « Près de {arrêt} », ou « Adresse à vérifier » ; accès (inchangé). Jamais de coordonnées. |
| Nouveau lieu | « Nom du lieu » (« Maison, Bureau… », inchangé) avec les raccourcis « Maison », « Bureau », « École » ; « Adresse », texte d’exemple « Rue et numéro, commune » ; adresse choisie : « {adresse normalisée} » puis l’accès ; rue sans numéro : « Position approximative : la rue, sans numéro. » ; « Utiliser ma position actuelle », sous-titre « si tu es sur place » ; « Enregistrer le lieu » (inchangé) |
| Lieu 1.0 | bouton « Vérifier l’adresse » |
| Après un nouveau lieu (S3) | « Ajouter le trajet vers {nom} à tes favoris ? » ; « Ajouter aux favoris » ; « Non merci » |
| Suppression (dans la page) | « Supprimer le lieu « {nom} » ? Les trajets favoris vers ce lieu seront aussi supprimés. » ; « Supprimer » ; « Annuler » (la 1.0 supprimait ces trajets sans le dire) |
| Adresses récentes (S4) | « Effacer les adresses récentes » |

T4. Mes favoris

| Élément | Texte |
|---|---|
| Sous-titre | « En tête dans les lunettes selon l’heure et le lieu (réglage Affichage). » |
| Ordre (S3) | « Changer l’ordre » ; « Monter » ; « Descendre » ; « Terminé » |
| Trajet favori | « Départ », « Arrivée » : champs unifiés, le choix s’y écrit ; « Nom affiché (« Vers le bureau »), facultatif » (remplace « Nom affiché (« Pour le bureau : … »), facultatif ») |
| « Le proposer à l’ouverture » | « Jamais » ; « Quand je suis à moins de 300 m » ; « Le matin (5 h à 11 h) » ; « Le soir (15 h à 21 h) » |
| Suppression (dans la page) | « Supprimer ce favori ? » ; « Supprimer » ; « Annuler » |
| Zone disparue (M8) | « Arrêt introuvable : choisis-le à nouveau » |

T5. Affichage

| Élément | Texte |
|---|---|
| « À l’ouverture de Quai » | « Mes favoris en tête, selon l’heure et le lieu » (par défaut, remplace « Suggestion selon l’heure et le lieu ») ; « Toujours ouvrir le favori en tête » (remplace « Toujours le premier favori ») ; « Accueil sans favoris » (remplace « Toujours l’accueil ») |
| « Ordre des favoris » (S3) | « Selon l’heure et le lieu » ; « Dans mon ordre » |
| Aperçu | l’accueil des lunettes avec ses favoris |

T6. Données

| Élément | Texte |
|---|---|
| « Mises à jour » | nouvelle ligne « Version de Quai   1.1.0 » |
| Nouvelle carte « Adresses » | « Services officiels de Bruxelles, de Flandre et de Wallonie » ; état « Disponible » ou « Indisponible » ; « Tester la connexion » teste aussi les adresses |
| Pied de page | sources des adresses ajoutées aux sources des horaires (texte exact : Q10) |

T7. Premier lancement

| Élément | Texte |
|---|---|
| Étape 1 « Bienvenue » | sous-titre « Quelques réglages, et Quai est prêt. » (remplace « Deux réglages, et Quai est prêt. ») ; le reste inchangé |
| Étape 2 « Tes lieux » (S1) | sous-titre « Facultatif. Avec ces deux adresses, Quai te propose le bon trajet le matin et le soir. » ; champ « Maison », texte d’exemple « Adresse de ton domicile » ; champ « Bureau », texte d’exemple « Adresse de ton travail ou de ton école » ; case « Me proposer le trajet vers le bureau le matin, et vers la maison le soir » (cochée) ; boutons « Terminer » et « Plus tard » |

### 6.3 États vides et erreurs

| Situation | Lunettes | Téléphone |
|---|---|---|
| Aucun favori | « Ajouter un favori » (accueil) ; T : liste vide de L2 | « Aucun favori pour l’instant. » (inchangé) |
| Trajet favori en calcul | « … » | sans objet |
| Aucun trajet dans les 23 h | « aucun trajet » ; écran : « Aucun trajet trouvé pour l’instant. » | « Aucun trajet trouvé à cette heure. » (une seule fois, inchangé) |
| Pas de trajet complet vers une destination | « Aucun trajet trouvé pour l’instant. » | « Pas de trajet complet. Essaie {gare}, puis le tram. » ; bouton « Chercher vers {gare} » |
| Adresse loin de tout arrêt | « Aucun trajet trouvé pour l’instant. » | « Aucun arrêt à moins de {n} min à pied de cette adresse. » ({n} = 2 fois la marche maximale) |
| Service d’adresses indisponible | sans objet | « Adresses indisponibles pour l’instant : gares et arrêts seulement. » |
| Téléphone hors ligne pendant une recherche d’adresse | sans objet | « Recherche d’adresse impossible sans connexion : gares et arrêts seulement. » |
| Rien ne correspond | sans objet | « Aucune adresse, gare ou arrêt ne correspond. Ajoute la commune, ou vérifie l’orthographe. » |
| Temps réel indisponible (source ou relais) | « Temps réel indisponible : horaires prévus ~ » (note des listes ; ligne du haut de l’accueil) | « Temps réel indisponible, horaires prévus » |
| Téléphone hors ligne | « Pas de réseau : réessaie dans un instant. » (inchangé) | « Pas de réseau : réessaie dans un instant. » |
| Horaires injoignables au lancement | « Horaires injoignables : nouvel essai dans 30 s » | inchangé |
| Position inconnue | « sans position » (favori, « Autour de moi ») ; écran : inchangé | inchangé |
| Déjà sur place | « tu y es » ; écran : « Tu es déjà au bureau. » | inchangé |
| Zone d’un favori disparue | « introuvable : modifie-le sur le téléphone » | « Arrêt introuvable : choisis-le à nouveau » |
| Horaires périmés | inchangé | inchangé |

## 7. Hors périmètre de la 1.1

- Carte, navigation à pied pas à pas, boussole.
- Google Maps et recherche de points d’intérêt (commerces, monuments) : option future.
- Recherche vocale avec le micro des lunettes.
- Billets, prix, abonnements ; vélos et trottinettes partagés ; voiture et parkings de dissuasion.
- Notifications quand Quai est fermé.
- Trajets au-delà de demain ; adresses hors de Belgique ; trajets internationaux.
- Itinéraires garantis accessibles aux personnes en fauteuil (C4 seulement, si la donnée existe).
- Nouveaux gestes : pas d’appui long dans le SDK ; pas de commande par mouvement de tête.
- Comptes, synchronisation entre Quai Web et l’appli des lunettes.
- Publication publique dans Even Hub (usage personnel).
- Plus d’une correspondance entre lignes urbaines, plus de deux en train.

## 8. Risques

| Risque | Effet | Parade |
|---|---|---|
| R1. Trois services d’adresses différents (formats, disponibilité, accès depuis la WebView, limites d’usage non publiées), injoignables depuis l’environnement de développement | adresses absentes ou lentes | faux service et tests de contrat ; appels en parallèle, délai maximum 2 s ; repli « gares et arrêts seulement » ; premier vrai test au déploiement ; passage par le relais si nécessaire (Q2) |
| R2. Le texte tapé quitte le téléphone | confiance | seul le texte part, jamais la position ; mention visible ; `privacy.md` ; aucun journal côté relais |
| R3. Calcul plus lourd (adresses, correspondances urbaines, deux correspondances en train) | lenteur, batterie, données téléchargées | budget de calcul (CA-M5.7, CA-M8.8) ; affichage progressif ; cache (S7) ; rayon limité (`design-routing.md`) |
| R4. Contrat figé `api.ts` à étendre | retard, régressions | accord du responsable technique avant le code (Q1, Q12) ; migration des réglages testée sur `preset.json` |
| R5. ▲▼ change de sens sur l’écran des étapes | confusion des habitués ; un ▼ machinal pourrait faire suivre un autre train | ligne du bas qui dit ce que fait ▼ ; message « Quai 1.1 » ; trajet suivi indépendant de l’affichage (M2, point 5) |
| R6. Ordre intelligent perçu comme instable | perte de repères | règles simples, ordre figé pendant l’affichage, « Dans mon ordre » |
| R7. « Autour de moi » passe de la 1re ou 2e ligne de l’accueil à la 3e | un ou deux gestes de plus pour un arrêt non favori (`review-ux.md`, R1) | les arrêts favoris proches montent en tête (règle 1) ; « Autour de moi » placé avant « Autres favoris » ; à revoir après usage réel |
| R8. Temps réel SNCB partiel (copie du portail BMC) | « Le plus rapide » parfois faux, « ~ » fréquents | « ~ » visible ; reclassement au rafraîchissement des listes ; flux SNCB direct à demander (action du propriétaire, hors code) |
| R9. Noms et adresses longs | textes coupés | règles d’ajustement ; tests au pixel sur un échantillon de noms réels |
| R10. Mise à jour faite par le propriétaire, interfaces en anglais | 1.1 jamais installée | guide M7, voie « demander à Claude », vérification par la version affichée |
| R11. Huit Must pour une itération | glissement | ordre de livraison conseillé : M8 et M3 (justesse), puis M1, M2, M6, puis M4 et M5a, puis M7 ; M5b et M5c sont les seuls Must qui peuvent glisser, décision au point de mi-parcours (Q3) ; M5a seul reste utile |
| R12. Licences et attribution des données d’adresses | conformité | texte d’attribution confirmé avant publication (Q10) |
| R13. Reprise d’un trajet qui n’est plus voulu | gêne | fin automatique si l’utilisateur n’est pas parti (position) ou à l’arrivée plus 5 min (M6) |
| R14. Les attentes du jeu de démonstration ne valent pas sur les données réelles | tests verts, appli fausse | double jeu de contrôle : fixtures (annexe A.2) et instantané réel (annexe A.3) |
| R15. Données publiées : 406 Mo, au-dessus de l’objectif de 400 Mo (limite GitHub Pages : 1 Go) | marge réduite pour de nouvelles données (accessibilité, C4) | identifiants De Lijn raccourcis (S7, environ 70 Mo de moins) avant tout ajout |
| R16. Accueil plus chargé (trajet en cours, deux favoris, note, ligne du haut) | « Aller à… » sous le bord | défilement accepté et testé (CA-M1.9) ; ligne « Près de » retirée quand des favoris sont en tête |

## 9. Questions ouvertes pour le responsable technique

- Q1. Contrat `api.ts` : ajouter une extrémité « adresse » (`Endpoint` de type `address` : libellé, adresse, position) ou passer par un lieu implicite ? Ajouter à `Journey` l’étiquette et la raison calculées par le cœur ? Réglages en version 2 (ordre, adresses récentes, version vue, trajet suivi et en cours) ?
- Q2. Services d’adresses : appel direct depuis la WebView (CORS, liste blanche de `app.json`) ou via le relais Vercel ? Quelles origines ? Les trois Régions en parallèle, ou un service national (piste Paradigm, BeST Address, signalée par la revue UX) ?
- Q3. M5b et M5c tiennent-ils dans l’itération et dans le budget de calcul ? Sinon, date du point de décision.
- Q4. Accessibilité : le pipeline peut-il garder `wheelchair_boarding` et `wheelchair_accessible` pour les quatre réseaux, dans les limites de taille de GitHub Pages ? (C4)
- Q5. Seuils du § 4.4, dont « marche longue » à 1,5 fois la marche maximale : validation sur données réelles.
- Q6. Les écrans `journeys` et `trip` ne sont plus ouverts par les chemins principaux : d’accord ? Les garde-t-on pour les tests ?
- Q7. Trajet suivi et trajet en cours (M2, M6) : stockage (stockage local du SDK), règles de fin, lien avec l’état d’arrière-plan existant.
- Q8. Ordre intelligent et classement « le plus facile » : dans le cœur, pour être communs aux lunettes, au téléphone et à Quai Web ?
- Q9. Noms TEC à préfixe de commune en capitales : correction dans `shared/names.ts` (données de nuit) ou à l’affichage ?
- Q10. Texte d’attribution et licence des données d’adresses.
- Q11. `version.json` publié chaque nuit pour l’avis de nouvelle version (C3) : d’accord sur le principe ?
- Q12. Contrats à faire évoluer selon `review-tech.md` (accord des propriétaires de `shared/`) : interdictions de montée et de descente dans `TrainsDay.trips[].s`, identifiants De Lijn raccourcis (relais compris), variante de `nearby` sans départs.
- Q13. Jeu de contrôle sur données réelles (annexe A.3) : qui le maintient, et comment le rafraîchir quand les horaires changent ?
- Q14. Livrer avant la 1.1 une 1.0.2 qui corrige le train choisi sur le téléphone (`review-ux.md` n° 1, bloquant) ?

## 10. Notes de version 1.1.0 (fiche Even Hub)

Fichier `app/store/changelog/1.1.0.txt`, trois lignes, 500 caractères au plus (ici 437) :

```
Tes favoris donnent la réponse dès l’ouverture : quand partir, quel train ou bus, quelle voie, l’arrivée. Un toucher ouvre le trajet étape par étape, un glissement montre un autre trajet.
Le trajet le plus simple d’abord (moins de changements, moins de marche), le plus rapide s’il est différent, toujours avec la raison.
Sur le téléphone, un seul champ pour une adresse, une gare ou un arrêt : vas-y, ou enregistre l’adresse comme lieu.
```

Résumé en 3 lignes pour le propriétaire : voir « En bref », en tête de ce document.

## 11. Annexe A : scénarios de test et jeu de données

### A.1 Scénarios

| Scénario | Préparation | Ce qui doit se passer | CA |
|---|---|---|---|
| 1. Trajet du matin, Namur vers le bureau à Bruxelles | S1, scènes `base` et `noRT` | accueil avec « Vers le bureau » et sa réponse ; un toucher, les étapes ; ▼, le train suivant sans changer le train suivi ; suivi automatique jusqu’au bureau ; « En cours » sur l’accueil ; reprise à la réouverture | M1.1, M1.2, M2.1, M2.2, M2.8, M6.3 |
| 2. Bruxelles multimodal, gare du Nord | S2, scène `base` | les départs du tram s’ouvrent seuls ; l’accueil montre le tram et le bus De Lijn ; retrait annulable ; vers une adresse proche de Roi Baudouin, marche puis M6 ; panne du temps réel dite juste | M1.3, M5.2, M6.1, M8.6 |
| 3. Après-midi vers Gand | S3, scène `base` | « Vers Gand-Saint-Pierre » en tête ; étapes, trains suivants, aide à l’arrivée ; le train choisi sur le téléphone est suivi ; vers « Veldstraat 1 », train puis tram 1 | M1.4, M2.5, M2.6, M3.3, M5.4 |
| 4. Waterloo vers Bruxelles | extension Waterloo (A.2), 07:31, départ « Chaussée de Bruxelles 1, 1410 Waterloo », arrivée : une adresse à moins de 5 min à pied de Rogier ; données réelles (A.3) | « Le plus simple » : bus W puis métro M2 ; « Le plus rapide » : marche jusqu’à la gare de Waterloo puis train | M3.5, M5.5 |
| 5. Adresse inconnue dans une autre ville | S3 vers « Veldstraat 1, 9000 Gent » ; S1 vers « Rue Neuve 1, 1000 Bruxelles » | adresse trouvée en un champ ; trajets étiquetés et expliqués ; bouton « Lunettes » ; « Enregistrer comme lieu » | M4.1 à M4.5, M3.4, M5.1, M5.4 |

### A.2 Jeu de données à ajouter (proposition, à valider par le responsable technique)

- `fixtures/app/preset-1.1.json` : `preset.json` plus le favori `fav-maison` (« Ma position » vers Maison, nom « maison », « Le soir »), placé en dernier.
- Faux service d’adresses, scènes `base` et `down`, réponses fixes :

| Texte tapé (exemple) | Adresse normalisée | Position | Région |
|---|---|---|---|
| rue de fer 25 namur | Rue de Fer 25, 5000 Namur | 50.4662, 4.8648 | Wallonie |
| rue de fer 25 | Rue de Fer 25, 5000 Namur ; Rue de Fer 25, 4000 Liège (homonyme fictif) | 50.4662, 4.8648 ; 50.6400, 5.5700 | Wallonie |
| rue neuve 1 bruxelles, nieuwstraat 1 | Rue Neuve 1, 1000 Bruxelles (nl : Nieuwstraat 1, 1000 Brussel) | 50.8505, 4.3545 | Bruxelles |
| rue neuve bruxelles | Rue Neuve, 1000 Bruxelles (sans numéro) | 50.8520, 4.3555 | Bruxelles |
| avenue winston churchill 100 | Avenue Winston Churchill 100, 1180 Uccle | 50.8080, 4.3650 | Bruxelles |
| boulevard du centenaire 1 | Boulevard du Centenaire 1, 1020 Bruxelles | 50.8915, 4.3340 | Bruxelles |
| veldstraat 1 gent | Veldstraat 1, 9000 Gent | 51.0537, 3.7225 | Flandre |
| chaussée de bruxelles 1 waterloo | Chaussée de Bruxelles 1, 1410 Waterloo | 50.7175, 4.3990 | Wallonie |
| rue du bois 1 bastogne | Rue du Bois 1, 6600 Bastogne | 50.0030, 5.7150 | Wallonie |

- Extension Waterloo de `fixtures/network.json` (jeu commun en lecture seule : modification à décider par le responsable technique) : gare SNCB « Waterloo » (50.7154, 4.3835) avec un train direct vers Bruxelles-Central toutes les 30 min (25 min de trajet) ; arrêt TEC « WATERLOO Eglise » (50.7174, 4.3979) avec le bus W vers « BRUXELLES Midi » toutes les 20 min (45 min), arrêt d’arrivée à moins de 300 m de la station STIB Gare du Midi (M2). Horaires réglés pour que le train arrive au moins 5 min avant le bus.
- Retours du soir : un IC Bruxelles-Central vers Namur à 17:12 et 18:12, pour tester « Vers la maison » le soir.

### A.3 Contrôles sur données réelles (instantané du 10/11/2026)

Avec le banc de `review-tech.md` (`/home/claude/tech-review/`), relais en échec sauf mention. Les attentes viennent des revues ; les heures exactes peuvent changer avec les horaires publiés.

| Contrôle | Requête | Attendu en 1.1 | Constat 1.0.1 |
|---|---|---|---|
| Trajet type | Maison (50.4655, 4.8590) vers Bureau (50.8441, 4.3474), 10/11 07:31 et 23:50 | IC jusqu’à Bruxelles-Central puis 12 min à pied ; une proposition à 23:50 pour le lendemain | via Bruxelles-Chapelle, arrivée 8 min plus tard ; rien à 23:50 |
| Départs uniques | `board(sncb:8863008)` 10/11 17:30 | l’IC de 17:38 vers Lille Flandres une seule fois | deux fois |
| Une station, une zone | `nearby(50.8600, 4.3600, 500)` | une seule zone « Gare du Nord » STIB, titre « Gare du Nord, tram et bus (STIB) » | tram et bus séparés |
| Favori de démonstration | `fav-gdn` (`stib:6357F`) | retrouvé par nom et position | « Arrêt introuvable » |
| Montée autorisée | Liège-Guillemins vers Bruxelles-Nord, 11/11 09:10 | pas de train de nuit | Nightjet en 1re proposition |
| Deux correspondances | Namur vers Saint-Nicolas, 10/11 07:45 | par Bruxelles | par Lille, 4 h 20 |
| Nuit | Louvain-la-Neuve Grand-Place vers Namur, 23:50 | aucune attente de plus de 60 min | 7 h d’attente à Ottignies |
| Recherche | « gare du midi », « aéroport », « lln », « rogier » | CA-M4.11 | gare SNCB absente, aucun résultat, ordre inversé |
| Noms | départs de « WATERLOO Eglise » ; `delijn:200552` | « Waterloo Eglise », « W Bruxelles Midi » ; « T2 » | capitales ; « TT2 » |
| Relais muet | `board(sncb:8863008)` relais suspendu | affichage en 1,5 s au plus | 8 s |
| Waterloo | centre de Waterloo vers un bureau près de Bruxelles-Central, 10/11 07:45 | cas H du § 4.6 : « Le plus simple » bus W puis métro (si M5b), « Le plus rapide » train | train seul, après 19 min de marche |

## 12. Intégration des revues parallèles

- `review-tech.md` (reçue vers 22 h) : intégrée. Preuves de P3 et P4 ; seuil de « marche longue » relevé à 1,5 fois la marche maximale, pour ne pas préférer un changement à Bruxelles-Midi à 12 min de marche (cas F) ; garde-fous du § 4.2 ; étiquette « Plus tôt » pour la nuit (cas G) ; Must M8 (correctifs 1, 2, 3, 5, 7 et 8 de la revue) ; M5c (correctif 9) ; alias et classement de recherche dans M4 (correctif 6) ; noms dans S5 (correctif 4) ; cache et taille dans S7 (correctif 10) ; contrôles réels en annexe A.3.
- `review-ux.md` (reçue vers 22 h 15, revue du brouillon 2) : intégrée. Retenus : train choisi sur le téléphone transmis et suivi (n° 1, M2 et Q14) ; trajet suivi indépendant de l’affichage (R2, M2) ; « En cours » sur l’accueil (n° 10, M6) ; départs sans curseur et « ★ » dans le titre (n° 5, M6) ; panne du temps réel dite juste, suppressions gardées 15 min (n° 6, 7, 8, 15, M8) ; « Autour de moi   sans position » (n° 9, M1) ; gare d’arrivée au-delà de 2 km et état vide avec issue (n° 11, M5) ; champ rempli après le choix, raccourcis de nom, jamais de coordonnées, hors ligne (n° 12, 13, M4) ; favoris sur l’accueil du téléphone avec bouton « Lunettes » (n° 14, S8) ; bouton « Lunettes » sur chaque carte (n° 29, M4) ; durées dans le texte des étapes et colonne d’état (n° 16, S6) ; trajet à pied sans « direct » (n° 17, M2) ; « → » pour « vers » (n° 19) ; « double : quitter » à la racine (n° 20, S2) ; « trajet » partout, « demain », « imminent », liste vide, horaires injoignables, créneaux avec heures, confirmations dans la page (n° 21 à 23, 25, 28, 30, 32, S6, M8) ; ligne « Près de » retirée quand des favoris sont en tête et défilement accepté (R3, M1) ; « Autour de moi » avant « Autres favoris » (R1, en partie).
- Non retenus ou reportés : ligne « Près de » touchable (R1 : la ligne du haut n’est pas sélectionnable ; « Autour de moi » remonté à la place) ; note « ~ » sur l’écran des étapes (n° 18 : la ligne du bas sert à ▼ ; le « ~ » reste devant chaque heure) ; aperçu dans le formulaire de favori (C2, laissé en Could malgré l’avis de la revue) ; réglages d’alertes (n° 31, C6) ; titre « Rogier, métro et tram » couvert par M8, point 3 (n° 27).
- `design-routing.md` : pas encore disponible au moment de ce brouillon. À reprendre dès son arrivée : algorithme et budget de M5 et de M8 (point 1), faisabilité de M5b et M5c (Q3), contrat de l’extrémité « adresse » (Q1).
