# Quai 1.3.1 : spécification

Base : 1.3.0 (commit c3a2efc). Demandes du propriétaire du 15/11/2026 (16:09 à 16:51), après ses essais de la 1.3.0
sur Quai Web ; lancement décidé par lui pour le vendredi 20/11 à 9:30. Pas de nouvelle fonction : de la clarté.
Règles inchangées : écran calme, une heure et pas un conseil, rien ne démarre seul, tout au pixel, noms coupés entre
deux mots, français tutoyé, insécables, jamais de tiret long ni moyen, rien de nouveau sur le réseau, aucune adresse
personnelle nulle part.

## 1. Trois petits points pendant le guidage

- Pendant un guidage (écran du guidage, quand il est au calme : ni moment, ni « Où tu en es »), les lunettes montrent
  « · · · » au niveau le plus pâle, en bas au centre. Sens : « Quai te suit, rien à faire ».
- Fixes : jamais animés, aucun envoi de plus vers les lunettes à cause d'eux (ils font partie de la page calme).
- Un moment (partir, tourner, monter, descendre, imprévu…) ou « Où tu en es » prend toute la place ; quand il est
  masqué ou fini, les points reviennent.
- Aussi dans Quai Web. Pas en dehors d'un guidage.

## 2. « masquer » au lieu de « effacer »

- Aide de l'écran du guidage : « toucher : masquer   appui long : arrêter ». Rien n'est effacé : l'écran est caché, le
  guidage continue. Même mot partout où « effacer » désigne ce geste (lunettes, téléphone, Quai Web, guides).

## 3. « Où tu en es » dit que le guidage tourne et ce qui vient

- Titre : « Guidage en cours » (l'heure à droite). Ligne suivante : vers où (« Vers Bureau », « Vers l'arrêt X » pour
  « j'y descends », même règle de nom que le titre d'aujourd'hui).
- Une ligne « Prochain : … » avec une heure, au plus clair après le titre :
  - avant de partir : « Prochain : pars à 17:40 » (l'heure à laquelle « Partir maintenant » viendra) ;
  - en marchant : « Prochain : bus W à 17:49 » (ou « IC à 07:30, voie 3 ») ;
  - à l'arrêt : « Prochain : bus 36 à 17:04 » ;
  - à bord : « Prochain : descends à <arrêt> vers 17:05 » ;
  - dernière marche : « Prochain : arrivée vers 19:05 ».
- Pour « j'y descends » (trajet d'un seul véhicule), une ligne pâle : « je te préviens 1 min avant ton arrêt ».
- Plus de « marge N min » sur cet écran. Le reste (progression, arrêt suivant, voie, arrivée) reste s'il tient ; ce
  qui ne tient pas s'efface dans cet ordre : arrivée, progression, détail de marche.
- C'est aussi l'écran montré au lancement d'un guidage : il explique ce qui va se passer (point 6 de la demande).

## 4. Le nom de l'arrêt où l'on marche, partout

- Écran du trajet : « 16:40  à pied 7 min → Flagey » (comme les véhicules, avec « → » et le nom de l'arrêt ou de la
  gare où monter) ; marche de correspondance : « 17:37  à pied 2 min → Gare du Midi » (le nom de l'arrêt du véhicule
  suivant, même s'il ressemble au précédent) ; dernière marche vers la destination : inchangée. Nom coupé au mot.
- Favoris en accordéon : la 1re ligne nomme l'arrêt où monter (« à pied 7 min → Flagey ») ; la 2e garde le premier
  véhicule et son heure, puis les changements s'ils tiennent (« bus W ~11:49, 1 changement : métro 2 », sinon
  « bus W ~11:49, 1 changement », sinon « bus W ~11:49 »). Une gare hors de portée à pied garde sa règle de la 1.3.0.
- « Où tu en es » : « À pied vers l'arrêt Flagey » (le nom, plus « l'arrêt du bus W ») ; train : inchangé (voie, sinon
  la gare).
- Guidage : « ensuite : 7 min à pied → Flagey ».
- Téléphone : partout où une carte ou un résumé dit « à pied N min » vers un arrêt, le nom suit (« → Flagey »).
- Exemples des tests : lieux publics seulement.

## 5. Test de l'écran : conseil précis

- Résultat « Head-Up » (il faut lever la tête) : le conseil devient « Pour voir les messages sans bouger la tête : dans
  l'appli Even, règle l'angle de l'affichage Head-Up à 0, en regardant un peu vers le bas pendant le réglage. L'écran
  restera allumé quand tu regardes devant toi ; la batterie des lunettes s'use un peu plus vite. » Aucun chemin de
  menu inventé. Les autres résultats ne changent pas.

## 6. « ▶ Me guider jusqu'à cet arrêt »

- Liste des arrêts d'un départ (bus, tram, métro, et trajet d'un train), sur un arrêt où le toucher lance « j'y
  descends » : ligne d'action « ▶ Me guider jusqu'à cet arrêt », au plus clair, au-dessus des aides (comme « ▶ Y
  aller ») ; les aides deviennent « △▽ arrêts   double : retour ». Sur un arrêt où le toucher ne lance rien (avant la
  montée, gare quittée) : pas de ligne d'action. La ligne prend une rangée à la liste ; tout au pixel.

## 7. Apostrophes

- Tout nom venu des données (arrêts, gares, destinations, lignes) s'affiche avec l'apostrophe typographique « ’ »
  (« Braine-l’Alleud, Gare »), dans les lunettes, sur le téléphone et dans Quai Web. Seulement à l'affichage : les
  comparaisons, recherches et réglages enregistrés ne changent pas. Fonction commune : `apos` (core/typo.ts).
- Balayage des vraies données : aucune apostrophe droite dans une rangée affichée.

## 8. Accueil

- Ordre, dans les lunettes et sur le téléphone (et Quai Web) : Autour de moi ; Favoris (et ses favoris) ; Gares de
  train ; Lignes de bus, tram, métro ; Arrêts de bus, tram, métro. « Où vas-tu ? » reste en haut du téléphone.
- À l'ouverture de Quai, le curseur des lunettes est sur « Autour de moi » (décision du 15/11 : « ça n'a pas
  d'importance, on peut bouger facilement »). Les cas qui ajoutent une ligne (aide des gestes, trajet suivi, jour
  férié, ligne du haut) gardent leurs règles ; le réglage « À l'ouverture de Quai » garde son effet.

## 9. Version

- 1.3.1 (app.json, package.json, nouveautés de la boutique). Pas de message des nouveautés pour qui vient de la
  1.3.0 (version de clarté, comme la 1.2.7) : NEWS_SINCE reste 1.3.0 ; qui vient d'avant voit le message 1.3.0, dont
  chaque ligne reste vraie.

## 10. Barrières de publication

- tsc ; suites de l'appli, du pipeline, du relais et de bout en bout vertes ; simulateur complet à 100 % avec contrôle
  au pixel (scénarios s131 compris) ; vraies données : 0 rangée coupée au milieu d'un mot, 0 apostrophe droite
  affichée, chemins à pied inchangés ; deux contrôles indépendants (usager, technique) sans remarque ouverte.

## 11. Équipes

| Équipe | Points | Fichiers principaux |
|---|---|---|
| G1 guidage | 1, 2, 3, 4 (« Où tu en es », « ensuite ») | glasses/guide-views.ts, HINTS.guide de format.ts, controller.ts (page calme), core/guide.ts si un champ manque (heure de départ) |
| E1 écrans | 4 (écran du trajet, accordéon), 6, 7 (lunettes) | glasses/views.ts, format.ts (hors HINTS.guide), layout.ts, nav.ts |
| A1 accueil | 8 | glasses/views.ts (homeView seulement), controller.ts (curseur à l'ouverture), phone/screens/home.ts |
| T1 téléphone | 4 (téléphone), 5, 7 (téléphone), 2 (textes du téléphone) | phone/** (sauf l'accueil) |
| B1 bout en bout | tous | tests/e2e/** |

## 12. Propositions des experts retenues (le propriétaire, 20/11 à 18:32 : « l'ensemble des éléments proposés »)

Cinq experts (ergonomie des lunettes, usager quotidien, guidage à pied, langage, innovation sobre) ont relu les écrans,
le code et rejoué le moteur. Leurs notes détaillées, avec les textes exacts et les mesures au pixel :
`docs/v1.3.1/experts/` (identifiants E, U, P, L, I). Le propriétaire a validé toute la liste qui lui a été présentée :

**A. Défauts** : A1 les six messages importants (partir, monter, voie modifiée, descendre, imprévu, arrêt dépassé)
ramènent l'écran du guidage quel que soit l'écran affiché (E2) ; A2 bus raté en marchant : on reste « à pied » tant
qu'on marche vers l'arrêt, puis « Ton bus … est parti » et le suivant depuis là où l'on est (P1) ; A3 sans temps réel,
le véhicule est gardé jusqu'à 15 min avant le suivant, jamais moins de 10 min après l'heure (I1) ; A4 « très juste »
seulement quand le moteur le dit (P4) ; A5 « Partir maintenant » n'est plus caché par le premier virage (P2) ; A6
« Fais demi-tour » (P3) ; A7 un toucher ne masque qu'un message affiché depuis au moins 1,5 s (E3) ; A8 sous terre,
pas de message de position à l'arrêt ni à bord (I4).

**B. Améliorations** : B9 à bord, la ligne de progression remplace les trois points sur l'écran calme (E1) ; B10 menu
de l'appui long : « Voir tout le trajet », « Voir les arrêts », « Arrêter le guidage » en dernier (E4) ; B11 l'arrêt où
l'on descend d'habitude est retenu et la ligne d'action dit son nom (I2) ; B12 « Tram 3 dans ~1 min », « À gauche dans
30 m », « Nouveau trajet : IC à 08:42, voie 5 » (E5, L4) ; B13 un train en retard s'écrit « IC 07:42 +2 » dans le
guidage (U6) ; B14 l'heure d'arrivée sur la dernière marche de l'écran du trajet (U1) ; B15 le « ! » d'un favori sur
l'accueil (U2) ; B16 correspondance très juste dite avant, avec « Si tu le rates : tram 3 à 08:51 » (U4) ; B17 après la
descente, la marche suivante s'affiche (P7) ; B18 deux virages proches annoncés ensemble, distance stable (P6, P8) ;
B19 « pluie prévue » sur « Partir maintenant » (I5) ; B20 le soir, l'accueil montre les favoris avec « demain »
(U8) ; B21 « Gares de train » en accordéon avec la direction (U7).

**C. Finitions de textes** : L2 et U3 (« masquer » et le nom de l'arrêt aux endroits oubliés : virage sans rue, carte
« En cours » du téléphone, journal, guides, aide du réglage « Me guider ») ; L3 « Pas de position : Quai suit
l'horaire » ; L5 carte « En cours » : « Ensuite : partir à 07:05 » avant le départ ; L6 aides des listes identiques
pour le même geste ; L7 mêmes noms et « tes » entre lunettes et téléphone ; L8 « dans l'onglet Réglages » dans Quai Web.

**« Où tu en es »** (remplace le § 3 pour les mots, L1 et E1) : « Guidage en cours » ; « Jusqu'à … » pour la
destination (aussi le titre de « j'y descends ») ; « Ensuite : … » pour le prochain geste avec son heure (« Ensuite :
partir à 07:33 », « Ensuite : bus W à 17:49 », « Ensuite : descente à Bruxelles-Nord, 08:42 », « Ensuite : arrivée
~19:05 ») ; « Prochain arrêt : … » seulement pour l'arrêt suivant à bord ; chaque chose une seule fois ; avant de
partir « 9 min à pied jusqu'à la gare de Namur » ; « j'y descends » : « Quai te dit quand descendre » ; la progression
ne s'efface jamais (ordre : arrivée, chaîne, arrêt suivant).

Conflit réglé : dans le message « monter » d'une correspondance, « 2 min à pied → Gare du Nord, très juste » si le nom
tient (coupé au mot, « très juste » jamais), sinon « jusqu'à l'arrêt ».

Non retenu (pas présenté au propriétaire ; la R&D peut le reproposer) : E6, E7, E8, U5, P5, I3.

## 13. Organisation

Demandée par le propriétaire le 20/11 : un directeur, des managers, des experts techniques, de petits contrôles
qualité par sujet, et une équipe de recherche et développement qui propose de nouvelles fonctions en même temps.

| Rôle | Mission |
|---|---|
| Directeur (coordinateur) | priorités, arbitrages, fusion, vérifications finales, publication, compte rendu au propriétaire |
| Pôle Guidage (manager + experts) | points 1 à 3, guidage du point 4 ; A1 à A8 ; B9, B10, B12, B13, B16 à B19 ; C du guidage |
| Pôle Écrans et téléphone (manager + experts) | points 4 à 8 hors guidage ; B11, B14, B15, B20, B21 ; C des listes, de l'accueil et du téléphone |
| Pôle Qualité (manager + contrôleurs) | un petit contrôle usager et technique par sujet fini, scénarios de bout en bout s131, balayages des vraies données, contrôle final |
| Recherche et développement (manager + chercheurs) | veille et essais ; propositions de nouvelles fonctions, soumises au propriétaire avant toute construction |

Méthodes (celles des plugins Engineering, Design et Product Management de l'annuaire d'Anthropic, non installés) :
revue de code et stratégie de tests, critique de design, accessibilité et textes d'interface, cadrage des
fonctions et synthèse de recherche.

## 14. Recherche et développement retenue (le propriétaire, 20/11 à 19:03)

« Si on est sûr de la faisabilité, on peut tout lancer, avec un contrôle qualité que ça fonctionne. » Notes :
`docs/v1.3.1/experts/06-rd.md`. R2, R3, R4, R5, R6 et R7 : faisables avec ce que Quai a déjà, construits avec un
contrôle de chaque sujet. R1 (sortie du métro) : d'abord mesuré sur les vraies données belges (branche de
vérification) ; construit seulement si au moins 80 % des arrêts STIB sous terre ont une sortie nommée et que les
chemins à pied ne régressent pas ; sinon, reporté et expliqué au propriétaire.
