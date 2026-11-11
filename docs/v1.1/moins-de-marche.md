# Quai : « Moins de marche », garde-fou de « Le plus simple », accès d'un lieu

Statut : spécification produit du 11/11/2026 (rôle produit), pour la version qui suit la 1.1.0. Destinataires : routage, cœur, téléphone, lunettes, contrôle qualité. Complète `PRD.md` § 4 et § 6 ; en cas de désaccord, ce fichier l'emporte sur ces paragraphes.

Retours du propriétaire : « tu proposes parfois 12 min de marche alors qu'il y a peut-être un bus » ; de Waterloo vers Madou, « Le plus simple » arrive 28 min après le plus rapide, avec plus de marche ; un lieu à Madou affiche « Bruxelles-Congrès à 10 min à pied, métro à 1 min ».
Vérifié avec un prototype jetable, hors dépôt : réseau de test, instantané 1.1 `/home/claude/real-data-11/data` (requêtes du jeudi 12/11, sans temps réel), 270 trajets au hasard. Les 38 tests actuels du routage (cas A à H, CA sur les fixtures, petits réseaux) restent verts.

## 1. « Moins de marche » : quand

Déclencheur : « Le plus simple » a au moins un véhicule et une marche (départ, correspondance ou arrivée) d'au moins la marche maximale réglée (10 min par défaut), en minutes affichées. Relatif au réglage plutôt que 8 min fixes : un seul réglage à connaître, et qui a réglé 20 min n'est pas dérangé. Les marches de correspondance étant bornées à 400 m, c'est en pratique la marche du départ ou de l'arrivée.

Trajet retenu : le premier, dans l'ordre du § 4.1, de ceux qui remplissent toutes ces conditions :
1. au moins un véhicule ;
2. au moins 5 min de marche en moins au total (le seuil d'égalité du § 4.1) ;
3. au plus un changement de véhicule de plus ;
4. même créneau : départ au plus 5 min avant celui de « Le plus simple », arrivée au plus 5 min après (5 compris) ;
5. les garde-fous du § 4.2 (attente de 60 min au plus, aucun véhicule supprimé, encore attrapable). Pas de règle d'attente en plus : les bornes de 5 min la limitent.

Correspondance « inutile » (§ 4.2), exception : une correspondance qui fait marcher au moins 5 min de moins n'est jamais inutile. Sans elle, « même train, puis tram » est retiré avant le classement dès qu'il n'arrive pas 5 min plus tôt (CA-MW.6).

Jamais de « Moins de marche » : sans déclencheur ; si « Le plus simple » est entièrement à pied ; si « Le plus rapide » remplit déjà les conditions 1 à 4 (il en tient lieu, sans doublon, et ses phrases le disent, § 3) ; marche gagnée de moins de 5 min ; arrivée plus de 5 min après ; départ plus de 5 min avant ; deux changements de plus.
Nuit : pas d'exception, mêmes règles sur la fenêtre de nuit (marcher moins y compte autant). Temps réel : étiquette recalculée à chaque calcul, jamais pendant l'affichage ; un même trajet peut être « Moins de marche » à l'heure prévue et « Le plus rapide » avec un retard.

## 2. Place parmi les propositions

Ordre de remplissage des 3 propositions : Le plus simple, Le plus rapide, Plus tôt, **Moins de marche**, Sans changement ou Moins de changements, À pied, Le suivant, Plus tard. En pratique 2e (devant « Le suivant ») ou 3e (après « Le plus rapide ») ; jamais à la place de « Le plus simple », « Le plus rapide » ou « Plus tôt ».

Lunettes : une page comme les autres. L'indice est la ligne du bas de la page précédente, « ▼ Moins de marche : 07:33 → 08:53 », sous le titre « … : 07:33 → 08:57 » : les deux arrivées se comparent sans geste. La raison de « Le plus simple » ne change pas. Accueil, « Autres favoris », « Aller à… » et favoris du téléphone : inchangés, jamais de mention (une réponse par favori : la proposition 1) ; « Moins de marche » est à T puis ▼.

## 3. Textes exacts (conventions § 6.0 : U+00A0 devant « : » et « ; » et entre nombre et unité)

| Où | Texte |
|---|---|
| Étiquette (`lesswalk`) | « Moins de marche » |
| Lunettes, raison | « Moins de marche : {changements}, à pied {a} + {b} + {c} min », mêmes règles que « Le plus simple » (plus de 3 marches : « {total} min à pied »). Ex. « Moins de marche : 1 changement, à pied 7 + 2 + 4 min » (462 px) ; le plus long, « … : 2 changements, à pied 12 + 13 + 14 min », 497 px sur 542. |
| Lunettes, ligne du bas de la page précédente | « ▼ Moins de marche : {HH:MM} → {HH:MM} » (319 px). Aide et message « Trajet suivi : … » inchangés. |
| Téléphone, phrase de la carte | « {w} min de marche en moins, arrivée {n} min plus tard. », « …, même heure d'arrivée. » ou « …, arrivée {n} min plus tôt. » ({w} : écart de marche totale) |
| Téléphone, carte « Le plus simple » | « Le plus simple, et aussi le plus rapide. » seulement si aucune autre carte n'arrive plus tôt ; sinon « Le moins de changements. » si une autre carte fait marcher au moins 5 min de moins ; sinon « Le moins de changements et de marche. » |
| Téléphone, « Le plus rapide » qui en tient lieu | « Arrive {n} min plus tôt, avec {k} changement de plus et {w} min de marche en moins. » (« changements » au-delà de 1) |
| Lecteur d'écran | « Afficher Moins de marche dans les lunettes » |

## 4. Réglage

Aucun nouveau réglage. « Marche maximale » (5 à 20 min) est le déclencheur : la baisser fait proposer « Moins de marche » plus tôt (et compte plus tôt une longue marche comme un changement). Pas de préférence « moins de marche d'abord » : l'option est à un ▼.

## 5. « Le plus simple » : garde-fou resserré (Waterloo vers Madou)

Constat : à 07:31, « Le plus simple » est le S1 jusqu'à Bruxelles-Congrès puis 11 min à pied (08:55), 28 min après le plus rapide et avec 6 min de marche de plus (30 contre 24), pour éviter un seul changement ; le garde-fou de 30 min le laisse passer.

Règle (§ 4.2) : « Le plus simple » n'arrive jamais plus de 30 min après le plus rapide, ni plus de 15 min après s'il ne fait pas marcher au moins 5 min de moins que lui. Pour éviter un changement, Quai accepte 15 min de plus ; jusqu'à 30 min seulement si l'on marche aussi nettement moins. Référence : la première arrivée de la fenêtre (à égalité, celle qui marche le moins). La nuit, même double seuil, face aux trajets qui ne partent pas plus de 30 min plus tôt (règle actuelle). « Le plus rapide », « Plus tôt » et la borne de « Moins de changements » : inchangés. Poids de la marche inchangé (marche longue à 1,5 fois la marche maximale) : le baisser ferait repasser le cas F par Bruxelles-Chapelle.

Effet : Waterloo vers Madou donne 1. bus W, IC de Braine-l'Alleud jusqu'à Bruxelles-Midi, métro 2 (07:34 → 08:33, 8 min à pied) ; 2. « Le plus rapide », 19 min à pied puis P 07:50 jusqu'à Bruxelles-Midi et métro 2, 6 min plus tôt ; 3. « Moins de changements » (bus W puis métro 6, 08:58). Le train jusqu'à Midi puis le métro 2 est en tête, rejoint en bus plutôt qu'après 19 min à pied ; mettre la version à pied en tête exigerait de ne plus compter une marche de 15 min comme un changement (cas H, attentes S-3 et S-4) : non retenu. Sur 270 trajets au hasard, 5 changent de « Le plus simple », chaque fois pour arriver 17 à 28 min plus tôt avec un changement de plus (l'ancien reste proposé en « Moins de changements » ou « Sans changement ») ; un seuil unique de 20 min, écarté, remplaçait aussi des trajets en bus presque sans marche par 28 min de marche. Uccle Fort-Jaco vers Evere (observation de `design-routing.md` § 4.8) : le S9 arrivant 30 min plus tôt passe en tête, avec le bus 43 en « Moins de marche ».

## 6. Accès d'un lieu (« Mes lieux », confirmation d'une adresse)

Constat : « Près de Madou » puis « Bruxelles-Congrès à 10 min à pied, métro à 1 min » : la gare passe avant l'arrêt, qui n'est pas nommé ; on croit le lieu rattaché à Congrès, alors que Quai choisit arrêts et gares à chaque calcul.

Nouveau texte (`accessText`) :
1. L'arrêt le plus proche d'abord, nommé : « {Mode} {nom} à {n} min à pied » (mots de l'appli : métro, tram, bus, bus TEC, bus De Lijn, tram De Lijn, métro TEC) ou « Gare de {nom} à {n} min à pied ». Le plus proche : le moins de minutes ; à égalité train, métro, tram, bus, puis la distance.
2. La gare ensuite, seulement si elle est utile : desservie par des IC (« IC » dans ses lignes), à la marche maximale ou moins et pas déjà citée : « ; gare de {nom} à {m} min ».
3. Rien à 800 m : « Aucun arrêt à moins de 800 m » (inchangé).

Exemples (instantané du 12/11) : Madou, « Métro Madou à 2 min à pied » (1.1.0 : « Bruxelles-Congrès à 11 min à pied, métro à 2 min ») ; avenue de l'Astronomie, « Métro Madou à 2 min à pied » ; Maison, « Bus TEC Namur Omalius à 5 min à pied ; gare de Namur à 8 min » ; Bureau, « Tram Anneessens à 3 min à pied » (Bruxelles-Chapelle, S1 seulement, n'est pas citée).

## 7. Critères d'acceptation

Unitaires (`rank`, trajets synthétiques comme au § 4.6, marche maximale 10 min). X : direct, marche 7 + 12, IC 07:42, arrivée 08:58. Z : même IC puis un bus, marche 7 + 1 + 2.
- CA-MW.1 Z arrive 08:59 (1 min plus tard) : X `simple`, Z `lesswalk` « Moins de marche : 1 changement, à pied 7 + 1 + 2 min ». À 09:03 : idem. À 09:04 (6 min plus tard) : pas de `lesswalk`.
- CA-MW.2 Z rejoint l'IC en bus (marche 2 + 1 + 2) et part 5 min avant X : `lesswalk` ; 6 min avant : non.
- CA-MW.3 Z marche 7 + 2 + 6 (4 min de moins) : non. Z avec deux changements de plus : non. X marche 7 + 9 : non ; le même avec la marche maximale à 8 min : `lesswalk`.
- CA-MW.4 Z arrive 08:53 : `fast` « Le plus rapide : 5 min plus tôt, 1 changement », pas de `lesswalk` ; téléphone « Arrive 5 min plus tôt, avec 1 changement de plus et 9 min de marche en moins. », 1re carte « Le moins de changements. ». Trajet seulement à pied : jamais.

Réseau de test (cœur et simulateur, S1 = Maison à 07:31) :
- CA-MW.5 Les cas A à H, CA-M2.2, CA-M3.3 à CA-M3.5 et CA-M5.2 à CA-M5.4 restent inchangés. Vers Rue Neuve 1 (`noRT`) : le T3 (`fast`) tient lieu de « Moins de marche ». Vers le Bureau : `simple`, `next` (le tram par Bourse ne fait gagner qu'1 min de marche). Bruxelles-Central (S3, 13:55) vers le Bureau : une seule proposition, « Le plus simple : à pied, 12 min ».
- CA-MW.6 Vers le point de test « Saint-Géry » (50.8470, 4.3480), scène `noRT` : `simple` 07:33 → 08:57 « Le plus simple : direct, à pied 7 + 11 min » (IC jusqu'à Bruxelles-Central) ; `lesswalk` 07:33 → 08:53 « Moins de marche : 1 changement, à pied 7 + 2 + 4 min » (même IC jusqu'à Bruxelles-Nord, T3 08:44 jusqu'à Bourse) ; `next` 08:33 → 09:57. Lunettes : page 1, bas « ▼ Moins de marche : 07:33 → 08:53 » ; page 2, `label` `lesswalk`. Téléphone : 2e carte « 5 min de marche en moins, arrivée 4 min plus tôt. », 1re carte « Le moins de changements. ». Scène `base` (IC +2 min) : ce tram devient `fast` « Le plus rapide : 6 min plus tôt, 1 changement », sans `lesswalk`. Nuit, à 23:50 : `fast` (T4, 5 min plus tôt), sans `lesswalk`.

Données réelles (annexe A.3, instantané 1.1, jeudi 12/11, relais en panne, marche maximale 10 min) :
- CA-MW.7 Waterloo (50.7175, 4.3990) vers Madou (50.8504, 4.3707), 07:31 : `simple` 07:34 → 08:33 « Le plus simple : 2 changements, 8 min à pied » (bus W, IC Braine-l'Alleud → Bruxelles-Midi, métro 2) ; `fast` 07:29 → 08:27 « Le plus rapide : 6 min plus tôt, 1 changement » (P 07:50, métro 2) ; `fewer` 07:49 → 08:58 « Moins de changements : arrivée 08:58 ». Jamais le S1 vers Bruxelles-Congrès en proposition 1.
- CA-MW.8 Namur Place Léopold (50.4655, 4.8590) vers Madou, 07:31, inchangé : `simple` 07:34 → 08:52 « Le plus simple : 1 changement, à pied 8 + 2 + 10 min » ; `fast` 07:34 → 08:44 « Le plus rapide : 8 min plus tôt, 2 changements » (bus 12, métro 2), qui tient lieu de « Moins de marche » (« …, avec 1 changement de plus et 9 min de marche en moins. ») ; `next` 08:06 → 09:23. Maison vers Bureau, inchangé : le bus 95 en `fast` (« … et 5 min de marche en moins. »).
- CA-MW.9 Namur centre (50.4625, 4.8670) vers quartier Nord (50.8580, 4.3580), 07:30 : `simple` « Le plus simple : direct, à pied 13 + 5 min » ; `lesswalk` 07:28 → 08:51 « Moins de marche : 1 changement, à pied 3 + 2 + 5 min » (bus 80 jusqu'à la gare, même IC) ; `next`.
- CA-MW.10 Nuit, Maison vers Bureau à 23:50 le 11/11 : `simple` S8 04:20 jusqu'à Bruxelles-Central puis 12 min ; `fast` arrivée 05:37 (2 changements) ; `lesswalk` 04:10 → 05:42 « Moins de marche : 1 changement, à pied 8 + 2 + 3 min » (même S8 jusqu'à Bruxelles-Nord, tram 10).
- CA-MW.11 Accès : les exemples du § 6 ; réseau de test : Maison « Bus TEC Namur Place Léopold à 3 min à pied ; gare de Namur à 7 min », Bureau « Tram Bourse à 9 min à pied ».
- CA-MW.12 Toute nouvelle ligne des lunettes tient au pixel (542 px), sans « … ».

## 8. Contrats et fichiers

- `api.ts` (contrat : accord du responsable technique) : `JourneyLabel` + `'lesswalk'`, `LABEL_TEXT.lesswalk = 'Moins de marche'` ; journal `QUAI_SCREEN`, `label` `lesswalk`. Faux cœur aligné.
- `routing/params.ts`, `rank.ts`, `reason.ts` : § 1 (économie 5 min, ±5 min, un changement de plus), exception de la correspondance inutile, double seuil 30 et 15 min, raison. `phone/text.ts` : phrases du § 3 ; `phone/screens/places.ts` : `accessText` du § 6. Lunettes : rien de propre (étiquette par `LABEL_TEXT`).
- À reporter dans le PRD : § 4.2, § 4.3 (nouvelle ligne), § 4.4, § 6.1 L3, § 6.2 T2, M4.7 (exemple d'accès).
