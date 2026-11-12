# Banc interne : Quai 1.2.2 (règle F4, corrections du moteur)

Banc interne, 12/11/2026. Code mesuré : la 1.2.2 de ce dépôt (moteur réel `computeRoute`, sans temps réel), comparée à la 1.2.1 (copie du commit c50fd22, `app/src` et `shared`), sur la même machine, l’une après l’autre. Mêmes données et mêmes contrôles que le rapport interne de la 1.2.1 : 150 cas du banc (instantané du 13/11), cas A, B, C et 100 cas hors échantillon (instantané du 11/11), marche maximale 5 et 10 min ; oracle exhaustif (`bench/oracle`), indépendant du moteur. Aucune adresse personnelle, aucun service Google.

## En bref

- 1.2.2 (moteur) : 0,0 % de propositions 1 dominées, 0,0 % de marches absurdes, 0,0 % d’oublis, 0,0 % d’étiquettes fausses sur le banc à 5 min (tableaux du § 1 pour 10 min et hors échantillon) ; cas A, B, C conformes.
- Garde de la 1.2.2 (aucune proposition dominée, même par un trajet non affiché) : 0,7 % des cas du banc à 5 min ont une proposition dominée par un trajet de l’oracle ou la marche seule (1.2.1 : 25,3 %).
- Retard moyen sur l’arrivée la plus tôt : 0,46 min à 5 min (1.2.1 : 1,08), 0,19 min à 10 min (1.2.1 : 0,99).
- Le moteur donne la proposition 1 de la règle écrite à part (F5, sur tout l’ensemble de l’oracle) dans presque tous les cas (§ 3) : les corrections du moteur lui font trouver les trajets dont la règle a besoin.
- Temps de calcul (§ 4) : 59 ms en moyenne par recherche (1.2.1 : 80 ms).
- Références externes (§ 5) : 1 cas où Transitous ou iRail arrive au moins 5 min plus tôt sans plus de marche ni de changements (1.2.1 : 4).

## 1. Contrôles

Validation de l’oracle : son arrivée la plus tôt égale ou bat celle du moteur dans 306 calculs du banc sur 306 (strictement meilleure 2 fois) et 198 sur 200 hors échantillon (les autres : un trajet en véhicule du moteur que la marche seule domine, absent de l’ensemble de Pareto de l’oracle, jamais proposé) ; il couvre 5637 des 5637 candidats du moteur partis dans l’heure (3297 sur 3299 hors échantillon ; les autres arrivent après T + 3 h).

Contrôles du rapport 1.2.1 : (a) proposition 1 dominée par un trajet de l’oracle (arrivée, plus longue marche, changements ; 1 min de tolérance) ; (b) marche absurde (plus de M + 5 min à pied alors qu’un trajet sans marche de plus de M arrive au plus 15 min après) ; (c) oubli ; (d) étiquettes. Contrôle ajouté pour la garde de la 1.2.2 : une proposition au moins, la première comprise, dominée par un trajet de l’oracle ou par la marche seule (départ plus tard ou égal, arrivée, plus longue marche et changements pas pires, l’un meilleur d’au moins 2 min ou d’un changement ; trajets de l’oracle partis dans l’heure). Retards en minutes sur l’arrivée la plus tôt de l’ensemble ; marches en minutes.

### Banc (150 cas, instantané du 13/11)

Marche maximale 5 min (150 cas) :

| Version | P1 dominée | Marche absurde | Oubli | Étiquettes | Une proposition dominée | Plus lent que la marche | Retard moyen | Retard p90 | Plus longue marche | Changements |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1.2.1 (moteur livré) | 4,0 % | 1,3 % | 2,0 % | 2,0 % | 25,3 % | 0,0 % | 1,08 | 3 | 2,25 | 0,66 |
| 1.2.2 (moteur) | 0,0 % | 0,0 % | 0,0 % | 0,0 % | 0,7 % | 0,0 % | 0,46 | 0 | 2,22 | 0,67 |
| règle 1.2.2 sur l’ensemble complet (F5) | 0,0 % | 0,0 % | 0,0 % | 0,0 % | 0,0 % | 0,0 % | 0,46 | 0 | 2,21 | 0,67 |

Marche maximale 10 min (150 cas) :

| Version | P1 dominée | Marche absurde | Oubli | Étiquettes | Une proposition dominée | Plus lent que la marche | Retard moyen | Retard p90 | Plus longue marche | Changements |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1.2.1 (moteur livré) | 5,3 % | 0,7 % | 4,0 % | 2,0 % | 22,7 % | 0,0 % | 0,99 | 2 | 3,07 | 0,59 |
| 1.2.2 (moteur) | 0,0 % | 0,0 % | 0,0 % | 0,0 % | 0,7 % | 0,0 % | 0,19 | 0 | 2,83 | 0,60 |
| règle 1.2.2 sur l’ensemble complet (F5) | 0,0 % | 0,0 % | 0,0 % | 0,0 % | 0,0 % | 0,0 % | 0,19 | 0 | 2,83 | 0,60 |

### Hors échantillon (100 cas, instantané du 11/11)

Marche maximale 5 min (100 cas) :

| Version | P1 dominée | Marche absurde | Oubli | Étiquettes | Une proposition dominée | Plus lent que la marche | Retard moyen | Retard p90 | Plus longue marche | Changements |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1.2.1 (moteur livré) | 4,0 % | 1,0 % | 2,0 % | 2,0 % | 27,0 % | 0,0 % | 0,87 | 2 | 2,25 | 0,65 |
| 1.2.2 (moteur) | 0,0 % | 0,0 % | 0,0 % | 0,0 % | 0,0 % | 1,0 % | 0,67 | 1 | 1,81 | 0,67 |
| règle 1.2.2 sur l’ensemble complet (F5) | 0,0 % | 0,0 % | 0,0 % | 0,0 % | 0,0 % | 1,0 % | 0,67 | 1 | 1,80 | 0,67 |

Marche maximale 10 min (100 cas) :

| Version | P1 dominée | Marche absurde | Oubli | Étiquettes | Une proposition dominée | Plus lent que la marche | Retard moyen | Retard p90 | Plus longue marche | Changements |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1.2.1 (moteur livré) | 7,0 % | 1,0 % | 4,0 % | 2,0 % | 24,0 % | 0,0 % | 0,83 | 1 | 3,08 | 0,58 |
| 1.2.2 (moteur) | 0,0 % | 0,0 % | 0,0 % | 0,0 % | 0,0 % | 1,0 % | 0,46 | 0 | 2,54 | 0,57 |
| règle 1.2.2 sur l’ensemble complet (F5) | 0,0 % | 0,0 % | 0,0 % | 0,0 % | 0,0 % | 1,0 % | 0,46 | 0 | 2,54 | 0,57 |

Propositions du moteur 1.2.2 dominées par un trajet de l’oracle (garde de la 1.2.2) :

- t09 Madou → Waterloo, ven. 07:30, marche 5 (banc) : Le suivant 07:59 → 08:40, STIB 6 + IC + S1, à pied 3, 2 ch. ; l’oracle : 07:59 → 08:36, STIB 6 + STIB 95 + S19, à pied 1, 2 ch. ; le bus 95 (Trône → Luxembourg) n’est pas parmi les 61 lignes que le moteur charge pour ce trajet (il prend le bus 64) : le moteur ne voit pas ce trajet, sa garde ne peut pas le remplacer.
- t09 Madou → Waterloo, ven. 07:30, marche 10 (banc) : Le suivant 07:59 → 08:40, STIB 6 + IC + S1, à pied 3, 2 ch. ; l’oracle : 07:59 → 08:36, STIB 6 + STIB 95 + S19, à pied 1, 2 ch. ; le bus 95 (Trône → Luxembourg) n’est pas parmi les 61 lignes que le moteur charge pour ce trajet (il prend le bus 64) : le moteur ne voit pas ce trajet, sa garde ne peut pas le remplacer.

Propositions 1 changées par rapport à la 1.2.1 : banc 27 (marche 5) et 30 (marche 10) sur 153 ; hors échantillon 13 et 19 sur 100.

## 2. Cas du propriétaire (instantané du 11/11)

| Cas | 1.2.2 : propositions | Conforme |
|---|---|---|
| A : Braine-l’Alleud Côté du Collège → Schaerbeek Gare (STIB), mer. 11/11 (férié) 19:42, marche 5 | 19:59 → 21:05, TEC W + S1, à pied 8 + 1 + 3, 1 ch.<br>autres : Plus tôt 19:46 → 20:52 (IC + IC, à pied 22 + 3) ; Le suivant 20:41 → 22:01 (TEC W + STIB 92, à pied 8 + 1) | oui |
| A : Braine-l’Alleud Côté du Collège → Schaerbeek Gare (STIB), mer. 11/11 (férié) 19:42, marche 10 | 19:59 → 21:05, TEC W + S1, à pied 8 + 1 + 3, 1 ch.<br>autres : Plus tôt 19:46 → 20:52 (IC + IC, à pied 22 + 3) ; Le suivant 20:41 → 22:01 (TEC W + STIB 92, à pied 8 + 1) | oui |
| B : Braine-l’Alleud Côté du Collège → Madou (STIB), jeu. 12/11 07:31, marche 5 | 07:49 → 08:31, TEC 36 + IC + STIB 2, à pied 4 + 3, 2 ch.<br>autres : Plus tard 07:54 → 08:48 (TEC 36 + S1 + STIB 2, à pied 1 + 3) ; Plus tard 08:14 → 08:59 (TEC 39 + IC + STIB 2, à pied 1 + 3) | oui |
| B : Braine-l’Alleud Côté du Collège → Madou (STIB), jeu. 12/11 07:31, marche 10 | 07:49 → 08:31, TEC 36 + IC + STIB 2, à pied 4 + 3, 2 ch.<br>autres : Plus tard 07:54 → 08:48 (TEC 36 + S1 + STIB 2, à pied 1 + 3) ; Plus tard 08:14 → 08:59 (TEC 39 + IC + STIB 2, à pied 1 + 3) | oui |
| C : Braine-l’Alleud Côté du Collège → Madou (STIB), mer. 11/11 (férié) 13:30, marche 5 | 13:41 → 14:45, TEC W + STIB 2, à pied 8 + 1, 1 ch.<br>autres : Plus tôt 13:46 → 14:37 (IC + STIB 2, à pied 22 + 3) ; Le suivant 14:11 → 15:17 (TEC W + STIB 2, à pied 8 + 1) | oui |
| C : Braine-l’Alleud Côté du Collège → Madou (STIB), mer. 11/11 (férié) 13:30, marche 10 | 13:41 → 14:45, TEC W + STIB 2, à pied 8 + 1, 1 ch.<br>autres : Plus tôt 13:46 → 14:37 (IC + STIB 2, à pied 22 + 3) ; Le suivant 14:11 → 15:17 (TEC W + STIB 2, à pied 8 + 1) | oui |

Attentes : A, le bus W et le S1 d’abord, la marche de 22 min et l’IC seulement en « Plus tôt » ; B, bus 36, IC 08:01, métro 2 ; C, bus W puis métro 2, jamais le bus 36 vers Rixensart.

## 3. Moteur et règle

F5 : la règle 1.2.2 écrite dans `bench/oracle/rules.ts`, sans le code du moteur, sur l’ensemble complet (oracle et candidats du moteur) ; F0* : `rank.ts` sur ce même ensemble.

| Calculs | Nombre | P1 du moteur = P1 de F5 | P1 de rank.ts = P1 de F5 | Propositions du moteur = celles de F5 |
|---|---:|---:|---:|---:|
| banc, marche 5 | 153 | 152 | 153 | 148 |
| banc, marche 10 | 153 | 153 | 153 | 150 |
| hors échantillon, marche 5 | 100 | 99 (dont 1 équivalent) | 100 | 95 |
| hors échantillon, marche 10 | 100 | 100 (dont 1 équivalent) | 100 | 96 |

Propositions 1 différentes (même coût, départage par la marche : le moteur n’a pas chargé la ligne qui marche une minute de moins) :

- t36 Vanderkindere → Gare du Nord, sam. 11:00, marche 5 : moteur 11:03 → 11:34, STIB 4 + STIB 6 + IC, à pied 3 + 2, 2 ch. ; règle 11:03 → 11:34, STIB 4 + STIB 50 + IC, à pied 2 + 2, 2 ch.
- t36 Vanderkindere → Gare du Nord, mer. 11/11 (férié) 15:00, marche 5 : moteur 15:01 → 15:34, STIB 4 + STIB 6 + IC, à pied 3 + 2, 2 ch. ; règle 15:01 → 15:34, STIB 4 + STIB 50 + IC, à pied 2 + 2, 2 ch.

## 4. Temps de calcul

Temps par recherche (ms : moyenne / médiane / p90 / maximum), fichiers lus sur disque et gardés en mémoire d’une recherche à l’autre, comme dans l’application.

| Calculs | 1.2.1 | 1.2.2 |
|---|---|---|
| banc (153 calculs), marche 5 | 80 / 66 / 154 / 803 | 59 / 41 / 120 / 339 |
| banc (153 calculs), marche 10 | 74 / 63 / 153 / 780 | 56 / 37 / 112 / 275 |
| hors échantillon (100), marche 5 | 80 / 59 / 138 / 706 | 54 / 42 / 113 / 283 |
| hors échantillon (100), marche 10 | 76 / 60 / 136 / 701 | 51 / 38 / 90 / 242 |

## 5. Références externes (Transitous, iRail)

150 cas du banc ; 150 réponses de Transitous, 41 d’iRail ; itinéraires écartés (services absents des données de Quai) : Eurocity Direct 2, Eurostar 11, European Sleeper 1, FlixBus 3, ICE 8. Un cas est signalé quand une source arrive au moins 5 min avant la proposition 1 de Quai sans plus de changements ni plus de marche (plus longue marche et marche totale ; Transitous part des coordonnées et arrive aux coordonnées : 2 min de tolérance sur la plus longue marche, 4 min sur la marche totale).

Cas signalés, 1.2.2 : 1 :

- t43 Korenmarkt, Gand → Gand-Saint-Pierre, ven. 17:30, marche 5, transitous : 17:30 → 17:51 : à pied 1 ; De Lijn 11 17:31 Gent Korenmarkt perron 3 → Gent Brugsepoort (Brugsepoortstraat) 17:35 ; à pied 2 ; De Lijn T4 17:37 Gent Brugsepoort (Begijnhoflaan) → Gent Sint-Pietersstation perron 18 17:49 ; à pied 2 (1 ch., marche 2 min au plus, 5 en tout) ; Quai : 17:31 → 17:57, De Lijn 10 + De Lijn 55, à pied 2, 1 ch. ; oracle (tout l’instantané, modèle de marche de Quai) : aucun trajet aussi bon ; les mêmes véhicules sont dans les données de Quai (bus 11 de 17:31, tram 4 de 17:37 à Brugsepoort), mais Quai compte une correspondance à pied comme sa marche plus 1 min pour trouver l’arrêt (17:35 + 2 + 1 = 17:38) : le tram de 17:37 est manqué ; écart de modèle, acceptable (avec 10 min de marche maximale, Quai propose le tram 1 et 7 min à pied, 17:32 → 17:55).

Cas signalés, 1.2.1 : 4 :

- t13 Ceria → Braine-l'Alleud, sam. 11:00, marche 5, transitous : 11:05 → 12:02 : à pied 1 ; STIB 73 11:06 CERIA → Place Victor Horta 11:21 ; à pied 5 ; BUS 11:26 Bruxelles-Midi → Braine-l'Alleud 12:01 ; à pied 1 (1 ch., marche 5 min au plus, 7 en tout) ; Quai : 11:36 → 12:30, S8 + BUS, à pied 4, 1 ch. ; oracle (tout l’instantané, modèle de marche de Quai) : aucun trajet aussi bon ; corrigé par la 1.2.2 (lignes de métro chargées) : métro 5 puis 6 jusqu’à Bruxelles-Midi et le même bus SNCB de 11:26, arrivée 12:01.
- t13 Ceria → Braine-l'Alleud, sam. 11:00, marche 10, transitous : 11:05 → 12:02 : à pied 1 ; STIB 73 11:06 CERIA → Place Victor Horta 11:21 ; à pied 5 ; BUS 11:26 Bruxelles-Midi → Braine-l'Alleud 12:01 ; à pied 1 (1 ch., marche 5 min au plus, 7 en tout) ; Quai : 11:36 → 12:30, S8 + BUS, à pied 4, 1 ch. ; oracle (tout l’instantané, modèle de marche de Quai) : aucun trajet aussi bon ; corrigé par la 1.2.2 (lignes de métro chargées) : métro 5 puis 6 jusqu’à Bruxelles-Midi et le même bus SNCB de 11:26, arrivée 12:01.
- t36 Vanderkindere → Gare du Nord, ven. 17:30, marche 5, transitous : 17:31 → 17:58 : à pied 2 ; STIB 4 17:33 Vanderkindere → Porte de Hal 17:41 ; à pied 2 ; STIB 6 17:44 Porte de Hal → Rogier 17:54 ; à pied 2 ; STIB 55 17:56 Rogier → Gare du Nord 17:57 ; à pied 1 (2 ch., marche 2 min au plus, 7 en tout) ; Quai : 17:33 → 18:07, STIB 4 + STIB 48 + IC, à pied 3 + 2, 2 ch. ; oracle (tout l’instantané, modèle de marche de Quai) : aucun trajet aussi bon ; trois lignes urbaines, donc deux correspondances entre lignes urbaines, et Quai n’en permet qu’une (règle du produit) ; acceptable (1.2.2 : un seul changement, tram 92 puis bus R27 avec 5 min de marche maximale, tram 4 puis métro 6 et 10 min à pied avec 10 min).
- t43 Korenmarkt, Gand → Gand-Saint-Pierre, ven. 17:30, marche 5, transitous : 17:30 → 17:51 : à pied 1 ; De Lijn 11 17:31 Gent Korenmarkt perron 3 → Gent Brugsepoort (Brugsepoortstraat) 17:35 ; à pied 2 ; De Lijn T4 17:37 Gent Brugsepoort (Begijnhoflaan) → Gent Sint-Pietersstation perron 18 17:49 ; à pied 2 (1 ch., marche 2 min au plus, 5 en tout) ; Quai : 17:31 → 17:57, De Lijn 10 + De Lijn 55, à pied 2, 1 ch. ; oracle (tout l’instantané, modèle de marche de Quai) : aucun trajet aussi bon ; les mêmes véhicules sont dans les données de Quai (bus 11 de 17:31, tram 4 de 17:37 à Brugsepoort), mais Quai compte une correspondance à pied comme sa marche plus 1 min pour trouver l’arrêt (17:35 + 2 + 1 = 17:38) : le tram de 17:37 est manqué ; écart de modèle, acceptable (avec 10 min de marche maximale, Quai propose le tram 1 et 7 min à pied, 17:32 → 17:55).

Trajets de référence arrivés au moins 5 min avant la proposition 1 de la 1.2.2 (non signalés : plus de marche ou de changements) :

- t04 Braine-l’Alleud Route de Mont-Saint-Jean → Schaerbeek, ven. 07:30, marche 5, transitous : 07:33 → 08:34 : à pied 12 ; P 07:45 Braine-l'Alleud → Schaerbeek 08:33 ; à pied 1 (0 ch., plus longue marche 12 min) ; Quai : 07:48 → 08:40, TEC W + IC + P, à pied 3 + 1, 2 ch. Plus de marche (12 min jusqu’à la gare) : Quai propose un trajet de ce genre en « Plus tôt » (P et P, 13 min à pied, arrivée 08:31) et en proposition 1 avec 10 min de marche maximale ; acceptable.
- t36 Vanderkindere → Gare du Nord, ven. 17:30, marche 5, transitous : 17:31 → 17:58 : à pied 2 ; STIB 4 17:33 Vanderkindere → Porte de Hal 17:41 ; à pied 2 ; STIB 6 17:44 Porte de Hal → Rogier 17:54 ; à pied 2 ; STIB 55 17:56 Rogier → Gare du Nord 17:57 ; à pied 1 (2 ch., plus longue marche 2 min) ; Quai : 17:32 → 18:07, STIB 92 + De Lijn R27, à pied 1 + 3, 1 ch. Trois lignes urbaines, donc deux correspondances entre lignes urbaines, et Quai n’en permet qu’une (règle du produit) ; acceptable (1.2.2 : un seul changement, tram 92 puis bus R27 avec 5 min de marche maximale, tram 4 puis métro 6 et 10 min à pied avec 10 min).
- t36 Vanderkindere → Gare du Nord, ven. 17:30, marche 10, transitous : 17:31 → 17:58 : à pied 2 ; STIB 4 17:33 Vanderkindere → Porte de Hal 17:41 ; à pied 2 ; STIB 6 17:44 Porte de Hal → Rogier 17:54 ; à pied 2 ; STIB 55 17:56 Rogier → Gare du Nord 17:57 ; à pied 1 (2 ch., plus longue marche 2 min) ; Quai : 17:33 → 18:04, STIB 4 + STIB 6, à pied 10, 1 ch. Trois lignes urbaines, donc deux correspondances entre lignes urbaines, et Quai n’en permet qu’une (règle du produit) ; acceptable (1.2.2 : un seul changement, tram 92 puis bus R27 avec 5 min de marche maximale, tram 4 puis métro 6 et 10 min à pied avec 10 min).
- t41 Parc du Cinquantenaire → Gare du Midi, sam. 11:00, marche 5, transitous : 11:00 → 11:26 : à pied 8 ; STIB 1 11:08 Merode → Arts-Loi 11:12 ; à pied 2 ; STIB 6 11:16 Arts-Loi → Gare du Midi 11:23 ; à pied 3 (1 ch., plus longue marche 8 min) ; Quai : 11:03 → 11:31, STIB 80 + STIB 6, à pied 4, 1 ch. Plus de marche (8 min jusqu’à Merode) : Quai propose ce trajet en « Plus tôt » (11:00 → 11:24) et en proposition 1 avec 10 min de marche maximale ; acceptable.
- t43 Korenmarkt, Gand → Gand-Saint-Pierre, ven. 17:30, marche 5, transitous : 17:30 → 17:51 : à pied 1 ; De Lijn 11 17:31 Gent Korenmarkt perron 3 → Gent Brugsepoort (Brugsepoortstraat) 17:35 ; à pied 2 ; De Lijn T4 17:37 Gent Brugsepoort (Begijnhoflaan) → Gent Sint-Pietersstation perron 18 17:49 ; à pied 2 (1 ch., plus longue marche 2 min) ; Quai : 17:31 → 17:57, De Lijn 10 + De Lijn 55, à pied 2, 1 ch. Les mêmes véhicules sont dans les données de Quai (bus 11 de 17:31, tram 4 de 17:37 à Brugsepoort), mais Quai compte une correspondance à pied comme sa marche plus 1 min pour trouver l’arrêt (17:35 + 2 + 1 = 17:38) : le tram de 17:37 est manqué ; écart de modèle, acceptable (avec 10 min de marche maximale, Quai propose le tram 1 et 7 min à pied, 17:32 → 17:55).

Données : `bench/out/internal.json`, `internal-holdout.json` (1.2.2), `internal-121.json`, `internal-holdout-121.json` (1.2.1). Rejouer : `cd bench/oracle && QUAI_ROOT=<dépôt> npx tsx run.ts && npx tsx run.ts --holdout && npx tsx report.ts` ; la 1.2.1 : `QUAI_ROOT=<copie 1.2.1> npx tsx run.ts --tag 121` (et `--holdout --tag 121`).
