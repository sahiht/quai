# Quai 1.2 : cahier produit (PRD)

Statut : 11/11/2026, rôle produit. Version 1.2.0, qui remplace la 1.1.1 (jamais publiée). Destinataires : routage, cœur, téléphone, lunettes, Quai Web, contrôle qualité, responsable technique.
Demande du propriétaire : « au lieu de t’embêter avec marche ou pas marche, il faut se demander qu’est-ce qui est le plus court » ; un trajet aberrant depuis Braine-l’Alleud (bus 36 dans le mauvais sens) ; « Mes lieux » et « Mes favoris » confondus ; une adresse comme position dans Quai Web.
Vérifié avec un prototype jetable, hors dépôt : réseau de test, instantané 1.1 `/home/claude/real-data-11/data` (sans temps réel), 270 trajets réels tirés au hasard. Résultat : le premier trajet change pour 55 d’entre eux, dont 44 arrivent au moins 5 min plus tôt ; « Plus tôt » apparaît 3 fois, « Moins de marche » 2 fois.

En bref (pour le propriétaire) :
1. Quai propose d’abord le trajet le plus court : celui qui t’amène le plus tôt.
2. Tes lieux, tes arrêts et tes trajets forment une seule liste, « Mes favoris ». Rien n’est perdu.
3. Dans Quai Web, ta position peut être une adresse.

## 1. « Le plus court » d’abord

### 1.1 Règle

Pour l’usager : « Le plus court, c’est celui qui t’amène le plus tôt. À 5 min près, celui qui dure le moins, puis le moins de changements, puis le moins de marche. »

Pour le cœur (une seule fonction, pour la proposition 1 comme pour les autres) :
1. Un trajet en devance un autre s’il arrive au moins 5 min plus tôt. La nuit (aucun départ dans l’heure, fenêtre de 90 min de la 1.1), il faut en plus qu’il ne parte pas plus de 30 min avant lui.
2. Parmi les trajets que rien ne devance : la durée la plus courte, à 5 min près ; puis le moins de changements de véhicule ; puis le moins de marche au total, à 5 min près ; puis l’arrivée la plus tôt ; puis le départ le plus tard.

Une marche longue ne compte plus comme un changement. Le garde-fou des 30 min disparaît : il n’a plus d’objet. Restent les garde-fous de la 1.1 : attente de 60 min au plus, véhicule supprimé jamais proposé, montée et descente autorisées, jamais plus lent que d’y aller à pied. Un premier bus dans le mauvais sens n’est donc jamais proposé en tête s’il existe un trajet plus court.

### 1.2 La marche : une préférence, plus un mur

- Recherche toujours élargie, quel que soit le réglage : arrêts jusqu’à 15 min à pied, gares jusqu’à 25 min (ou la marche maximale plus 5 min, si c’est davantage). Les trois passes du calcul deviennent : large (15 et 25 min), préférence (la marche maximale), courte (5 min).
- « Marche longue » : une marche d’au moins la marche maximale plus 5 min (15 min avec le réglage par défaut, comme en 1.1). Le seuil tolère 5 min, comme partout : sinon, avec 12 min de marche, Quai préférerait un tram pour n’en marcher que 9.
- Un trajet avec une marche longue n’est « Le plus court » que s’il arrive au moins 10 min avant le plus court des trajets sans marche longue. Sinon il est proposé en « Plus tôt » s’il fait gagner au moins 5 min.
- Filtres internes de la 1.1 (trajets dominés, correspondance qui gagne moins de 5 min sur le même premier véhicule) : un trajet sans marche longue n’est jamais écarté au profit d’un trajet avec marche longue. Marche seule : si elle tient dans la marche maximale, elle reste la seule réponse (1.1).

### 1.3 Propositions

Trois au plus, sans doublon, remplies dans cet ordre (les heures du titre et la ligne du bas « ▼ {étiquette} : {HH:MM} → {HH:MM} » de la 1.1 donnent l’écart sans geste) :

| Étiquette (`label`) | Quand | Raison dans les lunettes |
|---|---|---|
| Le plus court (`short`) | toujours | « Le plus court : {changements}, à pied {a} + {b} min » ; marche seule : « Le plus court : à pied, {n} min » |
| Plus tôt (`earlier`) | le trajet qui arrive le plus tôt, s’il arrive au moins 5 min avant « Le plus court » (marche longue qui gagne 5 à 9 min, ou la nuit) | « Plus tôt : {changements}, à pied {a} + {b} min » |
| Moins de marche (`lesswalk`) | « Le plus court » a une marche longue : le plus court des trajets sans marche longue qui marchent au moins 5 min de moins, arrivée au plus 20 min après | « Moins de marche : {changements}, à pied {a} + {b} min » |
| Sans changement (`none`), Moins de changements (`fewer`) | le plus court des trajets avec moins de changements, arrivée au plus 20 min après ; pas de marche longue, sauf s’il n’arrive pas plus tard ou si « Le plus court » en a une | « Sans changement : à pied {a} + {b} min » (sans marche : « Sans changement : arrivée {HH:MM} ») ; « Moins de changements : {changements}, à pied {a} + {b} min » |
| À pied (`walk`) | 1.1 : marche seule de 30 min au plus, arrivée au plus 5 min après | « À pied : {n} min, arrivée {HH:MM} » (1.1) |
| Le suivant (`next`) | 1.1 : même trajet, départs suivants | « Le suivant : même trajet, {n} min plus tard » (1.1) |
| Plus tard (`later`) | 1.1 : la suite, jamais un trajet devancé de plus de 30 min par un trajet parti au plus 30 min avant | « Plus tard : {changements}, départ {HH:MM} » (1.1) |

Raisons : règles de la 1.1 (« direct », « 1 changement », « {n} changements » ; marches d’au moins 1 min, dans l’ordre ; au-delà de 3 marches ou de 542 px : « {total} min à pied »). Le plus long, « Moins de changements : 1 changement, à pied 12 + 13 + 14 min », fait 538 px. Accueil, favoris, « Aller à… » : la réponse reste la proposition 1, sans autre mention.

Phrases des cartes du téléphone :

| Carte | Phrase |
|---|---|
| Le plus court | « Arrive le plus tôt. » ; si une autre carte arrive plus tôt : « Le plus court sans marche longue. » (elle a une marche longue), sinon « Le plus court sans partir plus tôt. » |
| Plus tôt | « Arrive {n} min plus tôt, mais avec {m} min à pied. » ({m} : sa marche longue) ; sinon « Arrive {n} min plus tôt, en partant à {HH:MM}. » |
| Moins de marche | « {w} min de marche en moins, mais arrive {n} min plus tard. » |
| Sans changement | « Aucun changement, mais arrive {n} min plus tard. » ; « Aucun changement, même heure d’arrivée. » ; « Aucun changement, en partant {n} min plus tôt. » |
| Moins de changements | les mêmes, avec « Moins de changements, … » |
| À pied, Le suivant, Plus tard | 1.1 |

### 1.4 Ce qui disparaît

« Le plus simple » (`simple`) et « Le plus rapide » (`fast`), le garde-fou des 30 min (et sa version 30/15 de la 1.1.1), la marche longue comptée comme un changement, « Moins de marche » de la 1.1.1 (déclenché dès 10 min de marche) et son exception de la correspondance inutile. « Aucun arrêt à moins de {n} min à pied de cette adresse. » : {n} = 15.

## 2. Lieux et favoris : une seule liste

### 2.1 Trois sortes de favoris

- Lieu (`place`) : une adresse, un arrêt ou « Ma position actuelle », avec un nom. Il donne « Vers {lieu} » depuis la position, avec la réponse de la 1.1 (« partir dans 2 min » / « IC à 07:42, voie 4, direct, arrivée 08:58 »). Créneau facultatif : « Le matin » ou « Le soir ».
- Arrêt (`stop`) : ses prochains départs, filtre de lignes (1.1).
- Trajet fixe (`trip`) : de A à B, sans « Ma position » au départ (1.1).

Titre d’un lieu : « Vers {nom} » avec l’article de la 1.0 (« Vers le bureau », « Vers la maison », « Vers l’école ») ; un nom propre ou une adresse sans article (« Vers Gand-Saint-Pierre », « Vers Veldstraat 1 »). L’ordre intelligent (M1) traite un lieu comme un trajet depuis « Ma position ». Limite : 32 favoris (20 favoris et 12 lieux de la 1.1 : la migration ne perd rien).

### 2.2 Téléphone

| Élément | Texte |
|---|---|
| Accueil, Réglages | ligne « Mes lieux » retirée ; « Mes favoris », sous-titre « {n} favoris » ; section « Mes favoris » (S8) inchangée, lieux compris |
| « Mes favoris », chapeau | « Tes lieux, tes arrêts et tes trajets. En tête dans les lunettes selon l’heure et le lieu (réglage Affichage). » |
| Ligne d’un lieu | nom ; adresse normalisée, « Près de {arrêt} », « Position prise sur place » ou « Adresse à vérifier » (1.0) ; accès (§ 2.5) ; « proposé le matin » ou « proposé le soir » |
| Ligne d’un arrêt | « Gare du Nord, tram » (1.0) ; ses lignes, ou « Toutes les lignes » |
| Ligne d’un trajet fixe | « {départ} → {arrivée} » ; « Trajet fixe » |
| Ajout | bouton « Ajouter un favori » ; écran « Nouveau favori » ; champ unique « Adresse, gare ou arrêt », avec en tête « Ma position actuelle » (sous-titre « si tu es sur place ») ; lien « Un trajet fixe, d’un endroit à un autre » |
| Après une adresse ou ma position | « Nom » (raccourcis « Maison », « Bureau », « École ») ; adresse et accès ; « Le proposer à l’ouverture » : « Jamais », « Le matin (5 h à 11 h) », « Le soir (15 h à 21 h) » ; « Enregistrer » |
| Après une gare ou un arrêt | « Dans les lunettes » : « Ses prochains départs » (par défaut) ou « Le trajet pour y aller » (un lieu « Près de {arrêt} ») ; puis les réglages de l’arrêt (1.1) ou du lieu |
| Trajet fixe | « Départ », « Arrivée », « Nom affiché (« Vers le bureau »), facultatif », « Le proposer à l’ouverture » avec « Quand je suis à moins de 300 m » (1.1) |
| Bas de l’écran | « Marche maximale », sous-titre « Au-delà de 5 min de plus, seulement pour arriver au moins 10 min plus tôt » ; « Adresses récentes » et « Effacer les adresses récentes » (venus de « Mes lieux ») ; « Changer l’ordre » (1.1) |
| Suppression | lieu utilisé par un trajet fixe : « Supprimer « {nom} » ? Les trajets fixes qui l’utilisent seront aussi supprimés. » ; sinon « Supprimer ce favori ? » (1.1) |
| Recherche (T2) | « Enregistrer comme lieu » et « Enregistrer l’adresse comme lieu » retirés ; « Garder en favori » crée un lieu (départ « Ma position » : nom = adresse courte ou arrêt) ou un trajet fixe ; « Ajouté à tes favoris. », « Déjà dans tes favoris. » |
| Limite atteinte | « 32 favoris au plus : supprimes-en un. » |
| Premier lancement (S1) | titre « Tes favoris » ; sous-titre « Facultatif. Maison et bureau deviennent tes premiers favoris. » ; champs « Maison » et « Bureau » ; case cochée « Me proposer le trajet vers le bureau le matin, et vers la maison le soir » ; « Terminer », « Plus tard ». Deux lieux sont créés, sans autre favori. |
| Bannière, une fois depuis une version antérieure | « Nouveau : le trajet le plus court d’abord, et tes lieux sont dans tes favoris. » ; « OK » |

### 2.3 Lunettes

Accueil, « Autres favoris » et « Aller à… » gardent leur forme. Les lieux y paraissent comme les trajets « Ma position → lieu » de la 1.1. « Aller à… » liste les lieux (« Bureau   arrivée 08:58 »), puis les adresses récentes, puis « Autre adresse   sur le téléphone ». Liste vide, dernière ligne : « ou ajoute un favori sur le téléphone. » « Arrivée », « toucher : ★ garder ce trajet » : crée un lieu si le trajet partait de « Ma position », sinon un trajet fixe. Message une fois, depuis la 1.0 ou la 1.1 : titre « Quai 1.2 » ; « Nouveau : le trajet le plus court d’abord. » / « Tes lieux sont maintenant dans tes favoris. » / « Sur un trajet, ▼ : un autre trajet. » ; aide « toucher : continuer ».

### 2.4 Migration (réglages v3, automatique, sans perte ni doublon)

1. Chaque lieu devient un favori lieu (nom, position, adresse, `src`, `approx`, `areaId` gardés), créneau « Jamais ».
2. Un trajet favori « Ma position → ce lieu » fusionne avec lui : le lieu prend sa place dans l’ordre, son identifiant, son nom affiché et son créneau (« Quand je suis à moins de 300 m », sans effet sur un tel trajet, devient « Jamais »). S’il y en a plusieurs, le premier ; les autres disparaissent (même trajet).
3. « Ma position → adresse » ou « Ma position → arrêt » devient un lieu (nom : nom affiché, sinon adresse courte ou arrêt).
4. Arrêts et autres trajets : inchangés ; un trajet fixe qui citait un lieu cite le favori lieu (identifiant suivi).
5. Ordre : celui des favoris de la 1.1, puis les lieux restants dans l’ordre de « Mes lieux ». Adresses récentes, réglages et `seenVersion` gardés. Une seconde lecture ne change rien.

### 2.5 Accès d’un lieu (repris de la 1.1.1, `docs/v1.1/moins-de-marche.md` § 6)

D’abord l’arrêt le plus proche, nommé : « Métro Madou à 2 min à pied ». Puis la gare, seulement si elle est utile (desservie par des IC, à la marche maximale ou moins) : « Bus TEC Namur Omalius à 5 min à pied ; gare de Namur à 8 min ». Rien à 800 m : « Aucun arrêt à moins de 800 m ».

## 3. Quai Web : position par adresse

Rubrique « Position » (sous l’écran des lunettes et dans « Position et langue ») : le champ unique du téléphone, avec les lieux d’abord, puis les adresses récentes, les adresses (par le relais, comme le téléphone), les gares et les arrêts.

| Élément | Texte |
|---|---|
| Champ | « Choisir une adresse, une gare ou un arrêt » ; texte d’exemple « Adresse, gare ou arrêt » |
| Liens | « Choisir une adresse ou un arrêt à la place » ; « Choisir un autre endroit » (remplace « Choisir un autre arrêt ») |
| États | « … Choisis une adresse ou un arrêt ci-dessous. » (remplace « Choisis un arrêt ci-dessous. ») ; « Position choisie : {nom}. Gardée dans ce navigateur. » (inchangé ; rue sans numéro : « {rue} (sans numéro) ») |
| Mention | « Adresses : services officiels des Régions bruxelloise, flamande et wallonne. Seul le texte tapé leur est envoyé. » |
| Panne | « Adresses indisponibles pour l’instant : gares et arrêts seulement. » (1.1) |

## 4. Ce qu’on garde de la 1.1.1, ce qu’on retire, contrats

- Gardé (déjà construit) : texte d’accès d’un lieu (`accessText` et ses tests) ; version lue dans `app.json` et bannière par `NEWS_SINCE`, portées à 1.2.0 (« Version de Quai   1.2.0 ») ; étiquette `lesswalk` et son texte, avec le nouveau déclencheur ; mesures au pixel.
- Retiré : classement 1.1.1 (garde-fou 30/15, « Moins de marche » à ±5 min, exception de la correspondance inutile), étiquettes `simple` et `fast`, écran « Mes lieux », `store/changelog/1.1.1.txt` (remplacé par 1.2.0.txt). `moins-de-marche.md` est remplacé par ce document, sauf son § 6.
- Contrats (accord du responsable technique) : `JourneyLabel` (`short` remplace `simple`, `fast` retiré) et `LABEL_TEXT` ; `Settings` v3 (`places` fondu dans `favorites`, type `FavoritePlace`) ; `Endpoint` « place » désigne un favori lieu ; journal `QUAI_SCREEN`, `label` ; faux cœur aligné. Temps de calcul de CA-M5.7 et CA-M8.8 à tenir avec les nouveaux rayons.

## 5. Critères d’acceptation

Heures relevées sur le prototype (gares cherchées jusqu’à 20 min, comme en 1.1) ; le calcul de référence du cœur fait foi et met le test à jour.

Classement, tests unitaires (marche maximale 10 min, trajets du PRD 1.1 § 4.6) :
- CA-1.1 Cas revus : A, X ; B, Y (12 min plus tôt) puis X `none` ; C, Y seul (X arrive 45 min après) ; D, X ; E, X puis W `walk` ; F, X ; G, X puis Y `earlier` ; H, X (marche 19, 12 min plus tôt) puis Y `lesswalk` ; H avec X seulement 9 min plus tôt : Y puis X `earlier`.
- CA-1.2 Invariants : aucune proposition n’arrive 5 min ou plus avant « Le plus court », sauf « Plus tôt » ; un « Le plus court » avec marche longue arrive au moins 10 min avant tout trajet sans marche longue.

Réseau de test (S1 = Maison à 07:31, `noRT` sauf mention) :
- CA-1.3 Vers le Bureau : `short` 07:33 → 08:58 « Le plus court : direct, à pied 7 + 12 min », `next` 08:33 → 09:58 ; CA-M1, M2 et M6 inchangés, avec « Le plus court » et `short`.
- CA-1.4 Vers Rue Neuve 1 : `short` 07:33 → 08:51 « Le plus court : 1 changement, à pied 7 + 2 + 3 min » (IC jusqu’à Bruxelles-Nord, T3), `none` 07:33 → 08:56 « Sans changement : à pied 7 + 10 min », `next` 08:33 → 09:55.
- CA-1.5 Waterloo → Rogier (cas H) : `short` 07:34 → 08:30 « Le plus court : direct, à pied 19 + 5 min », `lesswalk` 07:32 → 08:46 « Moins de marche : 1 changement, à pied 2 + 2 + 3 min » (téléphone : « 17 min de marche en moins, mais arrive 16 min plus tard. »), `next` 08:04 → 09:00.
- CA-1.6 CA-M3.3, CA-M5.2 à CA-M5.4 : mêmes trajets qu’en 1.1, étiquette `short`.

Données réelles (annexe A.3 de la 1.1, instantané 1.1, sans temps réel, marche maximale 10 min sauf mention) :
- CA-1.7 Waterloo (50.7175, 4.3990) → Madou (50.8504, 4.3707), jeudi 12/11 07:31 : `short` 07:34 → 08:33 « Le plus court : 2 changements, 8 min à pied » (bus W jusqu’à Braine-l’Alleud, IC jusqu’à Bruxelles-Midi, métro 2) ; `earlier` 07:29 → 08:27 « Plus tôt : 1 changement, à pied 19 + 3 + 2 min » (P 07:50 jusqu’à Bruxelles-Midi, métro 2 ; « Arrive 6 min plus tôt, mais avec 19 min à pied. ») ; `next`. Jamais le S1 vers Bruxelles-Congrès.
- CA-1.8 Namur Place Léopold (50.4655, 4.8590) → Madou, 07:31 : `short` 07:34 → 08:44 « Le plus court : 2 changements, à pied 8 + 1 + 2 min » (IC jusqu’à Bruxelles-Luxembourg, bus 12, métro 2) ; `fewer` 07:34 → 08:52 « Moins de changements : 1 changement, à pied 8 + 2 + 10 min » ; `next` 08:06 → 09:30.
- CA-1.9 Maison → Bureau (50.8441, 4.3474), 07:31 : `short` 07:34 → 08:56 (IC jusqu’à Bruxelles-Luxembourg, bus 95) ; `none` 07:34 → 09:04 « Sans changement : à pied 8 + 12 min ». Maison → Rue Neuve 1 : `short` 07:34 → 08:49 (IC jusqu’à Bruxelles-Schuman, métro 1) ; `none` 09:02.
- CA-1.10 Braine-l’Alleud Côté du Collège (50.68634, 4.39427) → Madou, 11/11 13:30, marche maximale 5 puis 10 : `short` 13:39 → 14:47 « Le plus court : 1 changement, à pied 8 + 1 + 2 min » (bus W de Bonne Fosse à Porte de Hal, métro 2) ; jamais le bus 36 vers Rixensart. Même départ le 12/11 à 07:31 : `short` 07:49 → 08:33 « Le plus court : 2 changements, à pied 4 + 3 + 2 min » (bus 36, IC 08:01 jusqu’à Bruxelles-Midi, métro 2).
- CA-1.11 Nuit, Maison → Bureau le 11/11 à 23:50 : `short` 04:10 → 05:37 (S8, métro 1, tram 4) ; `none` 05:46 « Sans changement : à pied 8 + 12 min ».

Favoris :
- CA-2.1 Migration de `fixtures/app/preset-1.1.json` : 6 favoris au lieu de 8 entrées, dans l’ordre `fav-bureau` (lieu « Bureau », le matin, « Vers le bureau »), `fav-gdn`, `fav-gand`, `fav-namur`, `fav-dl-nord`, `fav-maison` (lieu « Maison », le soir) ; filtres, créneaux et « Adresse à vérifier » gardés ; un lieu sans trajet (ajouté au test : « École ») devient un lieu « Jamais » en fin de liste ; seconde migration identique. Même résultat depuis `preset.json` (1.0).
- CA-2.2 Lunettes, S1 : accueil identique à CA-M1.1, `order` commence par `fav-bureau` ; « Aller à… » : « Bureau   arrivée 08:58 », « Maison   ici ».
- CA-2.3 Nouveau lieu : « rue neuve 1 bruxelles », raccourci « Bureau », « Le matin », « Enregistrer » : 3 touchers et 1 saisie ; la ligne montre « Rue Neuve 1, 1000 Bruxelles » et son accès. Gare « Namur » : « Ses prochains départs » donne un arrêt, « Le trajet pour y aller » un lieu « Près de Namur ».
- CA-2.4 « Garder en favori » : « Ma position » → Veldstraat 1 donne un lieu « Veldstraat 1 » ; Bruxelles-Central → Gand-Saint-Pierre un trajet fixe ; une seconde fois : « Déjà dans tes favoris. » `#/lieux` mène à `#/favoris`.
- CA-2.5 Supprimer « Maison » utilisé par le trajet fixe « Maison → Bureau » : le message du § 2.2 ; les deux disparaissent.

Quai Web et textes :
- CA-3.1 Position refusée, « rue de fer 25 namur », choix « Rue de Fer 25, 5000 Namur » : « Position choisie : Rue de Fer 25. Gardée dans ce navigateur. » ; « Autour de moi » est centré là ; gardé au rechargement ; seul le texte tapé part. Service en panne : gares et arrêts seulement.
- CA-3.2 Toutes les nouvelles lignes des lunettes tiennent dans 542 px. « Quai 1.2 » et la bannière s’affichent une fois, jamais après une installation neuve.

## 6. Notes de version 1.2.0 (`app/store/changelog/1.2.0.txt`, 500 caractères au plus)

```
Le trajet le plus court d’abord : celui qui t’amène le plus tôt, avec la raison. Une longue marche seulement si elle fait gagner au moins 10 min.
Un seul écran « Mes favoris » : tes lieux, tes arrêts et tes trajets, sans rien perdre.
Dans Quai Web, ta position peut être une adresse.
L’accès d’un lieu nomme d’abord l’arrêt le plus proche.
```
