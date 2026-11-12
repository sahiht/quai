# Quai 1.2.1 : spécification

Version validée par le propriétaire le 11/11/2026 (retours sur Quai Web 1.2.0, ses trajets réels). Elle corrige la
1.2.0 sur huit points. Tout ce qui n'est pas cité ici reste comme en 1.2.0.

Valeurs fixées : paliers de marche de 5 min ; garde-fou de 30 min ; 3 favoris au plus sur l'accueil.

Textes : français, tutoiement, typographie française (espace insécable U+00A0 devant « : » et entre un nombre et son
unité, comme le code actuel). Jamais de tiret long (U+2014) dans un texte affiché.

Fonctions partagées déjà écrites (app/src/core/means.ts, testées dans app/test/core/means.test.ts) : `rideName`,
`meansText` (« bus W + S1 »), `longestWalk`, `displayLabel` (nom affiché d'une proposition), `holidayName`,
`HOLIDAY_TEXT` (« Jour férié : horaires du dimanche »). Les deux interfaces les utilisent ; le cœur peut les affiner
sans changer leur contrat.

## 1. Nouvelle logique de classement (cœur, partout)

Demande du propriétaire : « offrir en premier la solution la plus rapide qui permet le moins de marche, puis au fur et
à mesure, si ce n'est pas possible, plus de marche ». Elle remplace « Le plus court d'abord » de la 1.2 pour toutes les
recherches : favoris, « Aller à… », recherche du téléphone, Quai Web, réponses de l'accueil.

1.1 Palier de marche d'un trajet : sa plus longue marche L (min), comparée à la marche maximale M réglée.
palier = 0 si L ≤ M, sinon ceil((L − M) / 5). Avec M = 5 : jusqu'à 5 min palier 0, 6 à 10 palier 1, 11 à 15 palier 2…
Marche seule : L = sa durée.

1.2 Proposition 1. Soit E l'arrivée la plus tôt de l'ensemble. Pour k = 0, 1, 2… : S_k = trajets de palier ≤ k ; s'il
est vide, palier suivant ; sinon b = « le plus rapide » de S_k (la fonction `shortest` actuelle : un trajet en devance
un autre s'il arrive au moins 5 min plus tôt, puis la durée la plus courte à 5 min près, puis le moins de changements,
puis le moins de marche) ; si b arrive au plus 30 min après E, b est la proposition 1 ; sinon palier suivant (garde-fou
contre les détours, ex. bus 36 par Rixensart). Repli : le plus rapide de tout l'ensemble.

1.3 Filtres de la 1.1 (trajets dominés, correspondance inutile) : jamais un trajet écarté au profit d'un trajet de
palier plus haut (remplace la règle « marche longue » actuelle).

1.4 Autres propositions, 3 au plus en tout comme aujourd'hui, sans doublon, dans cet ordre :
- « Plus tôt » (earlier) : le trajet qui arrive le plus tôt, s'il arrive au moins 5 min avant la proposition 1 ;
- « Moins de marche » (lesswalk) : seulement si la proposition 1 n'est pas au palier 0 (le garde-fou l'a poussée plus
  haut) : le plus rapide des trajets de palier plus bas, arrivée au plus 20 min après la proposition 1 ;
- « Sans changement » / « Moins de changements », « À pied », « Le suivant », « Plus tard » : règles 1.2 inchangées,
  mais tout critère « marche longue » devient « palier plus haut que la proposition 1 ».

1.5 Cas réels à tenir (instantané /home/claude/real-data-11/data, marche maximale 5 min ; uniquement des arrêts publics,
jamais d'adresse personnelle dans le dépôt) :
- Braine-l'Alleud Côté du Collège (50.68634, 4.39427) → Schaerbeek Gare (STIB, 50.87755, 4.37966), 11/11 à 19:42 :
  proposition 1 = bus W puis S1 (départ 19:57, arrivée 21:05) ; « Plus tôt » = 22 min à pied, IC 20:08, IC 20:33
  (arrivée 20:52).
- Braine-l'Alleud Côté du Collège → Madou (50.8504, 4.3707), 12/11 à 07:31 : proposition 1 = bus 36, IC 08:01, métro 2
  (07:49 → 08:33).
- Braine-l'Alleud Côté du Collège (50.68634, 4.39427) → Madou, 11/11 à 13:30 : proposition 1 = bus W, métro 2
  (13:39 → 14:47) ; « Plus tôt » = 22 min à pied et IC (arrivée 14:39) ; jamais le bus 36 vers Rixensart.

## 2. Noms, raisons et moyens de transport (cœur, puis les deux interfaces)

2.1 Nom affiché (`displayLabel`) : la proposition 1 garde l'étiquette `short` ; elle s'affiche « Moins de marche »
quand une proposition « Plus tôt » marche plus qu'elle, sinon « Le plus court ». Les autres : texte de leur étiquette.

2.2 Raisons (`reasonText`, 60 caractères au plus, une ligne des lunettes) :
- proposition 1 : « {nom affiché} : {changements}, à pied {a} + {b} min » (forme actuelle, avec le nom du § 2.1) ;
- « Plus tôt » qui marche plus : « Plus tôt de 13 min, mais 19 min à pied » (19 = sa plus longue marche) ; sinon
  « Plus tôt de 13 min, en partant à 19:20 » ;
- « Moins de marche » (alternative) : « Moins de marche : arrive 25 min plus tard » (complété si la place le permet) ;
- les autres : inchangées.
Le faux cœur (app/src/dev/fake-core.ts) suit les mêmes règles.

2.3 Moyens (`meansText`) : affichés pour chaque proposition dans la liste « Autres trajets » des lunettes et sur
chaque carte du téléphone : « bus W + S1 », « IC + IC », « bus 36 + IC + métro 2 ».

## 3. Écran d'un trajet (lunettes, Quai Web)

3.1 ▲▼ fait défiler seulement les étapes du trajet affiché, jamais un autre trajet.
3.2 Ligne du bas : tant qu'il reste des étapes cachées, « ▼ suite du trajet : 3 étapes » (1 étape : « ▼ suite du
trajet : 1 étape ») ; une fois au bout (dernière étape « Arrivée… » visible) : « Fin du trajet. ▼ 2 autres trajets »
(1 : « ▼ 1 autre trajet » ; aucun : « Fin du trajet. Pas d'autre trajet pour l'instant »).
3.3 ▼ au bout ouvre la page « Autres trajets » : titre « {titre du trajet} : autres trajets » (coupé si trop long),
une entrée par autre proposition, dans l'ordre : ligne 1 = nom affiché à gauche, « 19:47 → 20:58 » à droite ; ligne 2,
plus pâle = sa raison ou « {moyens}, à pied … » (le plus parlant tient en une ligne). Curseur ▶. Aide :
« ▲▼ choisir   toucher : voir   double : retour ».
3.4 Toucher une entrée ouvre les étapes de ce trajet (titre « {titre} : 19:47 → 20:58 », ligne du haut = sa raison).
Sur ce trajet : toucher = « suivre ce trajet » (comportement 1.2) ; double toucher = retour à la liste. Double toucher
sur la liste = retour aux étapes du premier trajet, à leur fin.
3.5 Aides : étapes du trajet suivi « ▲▼ étapes   toucher : détail   double : retour » ; étapes d'une autre
proposition « ▲▼ étapes   toucher : suivre ce trajet   double : retour » ; marche seule « ▲▼ étapes   double : retour ».
3.6 Le message « Pas d'autre trajet pour l'instant » et le « ▶ » de l'étape en cours : inchangés.

## 4. Accueil des lunettes (et Quai Web, onglet Lunettes)

Jugé trop chargé : on ne comprenait pas pourquoi Bureau et Mama étaient là.

4.1 Ordre des lignes : titre « Quai » et heure ; ligne « En cours : … » si un trajet est suivi (inchangée) ;
« Favoris » avec le nombre de favoris à droite (« 4 »), sélectionnable : toucher ouvre la liste de tous les favoris ;
dessous, en retrait, jusqu'à 3 favoris, une ligne chacun, sélectionnables (toucher ouvre le trajet ou les départs comme
aujourd'hui) ; une ligne vide ; « Autour de moi » (« 9 arrêts ») ; « Aller à… ». La ligne « Autres favoris » disparaît :
« Favoris » la remplace.

Maquette :

    Quai                       20:47
    Favoris                        4
      Bureau    maintenant → 21:34
      Mama      maintenant → 21:58

    Autour de moi           9 arrêts
    Aller à…
4.2 Favoris montrés : les 3 premiers de l'ordre réglé (« selon l'heure et le lieu » ou « dans mon ordre »), jamais un
favori de la règle 5 (tu y es, rien dans les 3 heures) : il reste dans la liste ouverte par « Favoris ». Aucun
favori : la ligne « Ajouter un favori » à la place du bloc.
4.3 Une ligne par favori : nom à gauche (nom du lieu « Bureau », titre d'un trajet fixe, nom d'un arrêt) ; à droite,
lieu ou trajet : « maintenant → 21:34 », « dans 4 min → 21:34 », « 22:10 → 23:05 » (départ conseillé, puis arrivée,
sans « ~ ») ; arrêt : le prochain départ (« IC 21:08 voie 2 »). Le détail (IC de 21:08, voie 2, 1 changement) n'est
plus sur l'accueil : il est sur la page du trajet.
4.4 Relief (une seule police, ni gras ni couleur), précisé par le propriétaire le 11/11 à 21:00 : « Favoris »,
« Autour de moi » et « Aller à… » au même niveau, au plus clair ; les favoris en dessous, en retrait et un ton plus
pâles (niveaux de luminosité des conteneurs), comme un aperçu sous leur titre. À vérifier dans le simulateur et sur
Quai Web.
4.5 Plus aucune ligne de pied sur l'accueil : « ~ horaire prévu, sans temps réel » reste seulement sur les pages qui
montrent une heure avec « ~ » ; « Sur le web, ferme simplement l'onglet » disparaît.
4.6 Aide des gestes de l'accueil : seulement pendant les 7 premiers jours d'utilisation (date de premier lancement
gardée sur le téléphone, hors schéma des réglages si possible) ; les autres écrans gardent leur aide.
4.7 Jour férié (§ 5) : dernière ligne de l'accueil, pâle : « Jour férié : horaires du dimanche ».

## 5. Jours fériés

`holidayName(now)` (fériés nationaux belges : 1/1, lundi de Pâques, 1/5, Ascension, lundi de Pentecôte, 21/7, 15/8,
1/11, 11/11, 25/12). Ces jours-là : la ligne `HOLIDAY_TEXT` sur l'accueil des lunettes (§ 4.7) et au-dessus des
résultats d'une recherche sur le téléphone et Quai Web. Rien les autres jours.

## 6. Message « Quai 1.2.1 »

Une seule fois après la mise à jour (jamais après une installation neuve, comme 1.2) :
- « Nouveau : le moins de marche d'abord. »
- « Sur un trajet, ▼ : la suite, puis les autres trajets. »
- « Accueil plus simple : tes favoris en tête. »
- depuis une version antérieure à 1.2.0, en plus : « Tes lieux sont maintenant dans tes favoris. »
Mêmes lignes sur Quai Web.

## 7. Téléphone et Quai Web (onglet Réglages)

7.1 « Nouveau favori » : en haut, deux choix de même taille et de même style (contrôle segmenté) : « Un endroit »
(sous-titre « adresse, gare ou arrêt ») et « Un trajet de A à B » (« départ et arrivée fixes »). « Un endroit » est
choisi d'office et montre le formulaire actuel ; « Un trajet de A à B » montre le formulaire du trajet fixe actuel
(Départ, Arrivée, nom, créneau). Le lien du bas « Un trajet fixe, d'un endroit à un autre » disparaît. En modification
d'un favori existant : pas de choix, son formulaire directement.
7.2 Cartes des trajets : titre = `displayLabel` ; une ligne « moyens » (`meansText`, puis les marches) ; phrase
d'explication alignée sur § 2 (ex. « Plus tôt de 13 min, mais 19 min à pied. » ; proposition 1 « Moins de marche » :
« Arrive 13 min après le plus rapide, avec moins de marche. »).
7.3 « Marche maximale » : sous-titre réécrit pour la nouvelle règle, court, par exemple « Quai choisit d'abord les
trajets qui ne marchent pas plus ; plus de marche seulement s'il n'y a pas mieux. »
7.4 Jour férié : la ligne `HOLIDAY_TEXT` au-dessus des résultats (§ 5).

## 8. Version

1.2.1 (app.json et package.json), faite par main à la fin, avec la release, Quai Web, la maquette et le guide.

## 9. Critères d'acceptation

- CA-121.1 : les trois cas du § 1.5 (tests sur l'instantané réel, comme tests/e2e/real-data.test.ts).
- CA-121.2 : palier et garde-fou : tests unitaires de `rank` (palier 0 vide, garde-fou dépassé, repli).
- CA-121.3 : noms et raisons (§ 2) dans le vrai cœur et le faux cœur, 60 caractères au plus.
- CA-121.4 : lunettes, trajet de 9 étapes : ▼ fait défiler jusqu'à « Fin du trajet. ▼ 2 autres trajets » sans jamais
  changer de trajet ; ▼ ouvre « Autres trajets » ; toucher ouvre le trajet ; double toucher revient à la liste.
- CA-121.5 : accueil avec 4 favoris dont Maison (tu y es) : « Favoris   4 » (ouvre les 4), dessous en retrait et
  plus pâles Bureau et Mama sur une ligne chacun, ligne vide, « Autour de moi » et « Aller à… » au niveau de
  « Favoris » ; aucun pied ; aide des gestes seulement les 7 premiers jours.
- CA-121.6 : « Nouveau favori » : deux choix de même taille ; le lien du bas a disparu.
- CA-121.7 : 11/11/2026 : « Jour férié : horaires du dimanche » ; 12/11 : rien.
- CA-121.8 : message « Quai 1.2.1 » une fois depuis 1.2.0, avec la ligne des lieux en plus depuis 1.1.
- CA-121.9 : contrôle large sur des centaines de trajets réels (comme la 1.2) : aucun détour absurde en tête.
