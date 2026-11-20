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
