# Quai 1.2.5 : cahier produit

Demande du propriétaire du 12/11/2026 au soir : une version « cohérente, fonctionnelle, orientée user friendly », dont
la mise en production est sûre ; projet de version arbitré le même soir avec les captures du simulateur, retouches de
« Bus, tram, métro » validées le 13/11 (« Top ! Ajoute ces changements donc dans la version 1.2.5 »). L'accueil et
toutes les fonctions de la 1.2.4 restent tels quels. Règle de confidentialité inchangée : jamais d'adresse ni de
position personnelle dans le dépôt, les tests ou les captures ; la position ne quitte jamais le téléphone.

## 1. « Si tu le rates » (étapes, lunettes et Quai Web ; CA-125.1)

Constat : au moment de partir, rien ne disait ce que coûte un départ raté.
- Quand : 5 min au plus avant le départ à pied (ou avant le départ du premier véhicule, pour un trajet qui commence à
  bord), et jusqu'au départ du premier véhicule.
- Quoi : « Si tu le rates : arrivée 09:57, 59 min plus tard ». Qui rate son départ est à l'arrêt ou à la gare : parmi
  les trajets déjà calculés, ceux qui en repartent plus tard (même zone, ou même nom à 400 m au plus, à vol d'oiseau ;
  un autre trajet peut y passer, le suivant aussi), et le premier arrivé. Même heure : « même heure d'arrivée » ; plus
  tôt (un autre trajet, plus de marche) : « arrivée 08:20, pas plus tard » ; une heure ou plus : « 1 h 04 plus tard » ;
  un autre jour : « arrivée demain 06:30 ». Un fait, jamais un conseil ; aucun calcul de trajet de plus : pendant la
  fenêtre, le rafraîchissement des étapes (30 s) prend aussi les trajets de repli, pour qu'une suppression s'y voie.
- Où : la ligne du haut des étapes, à la place de la raison (« Le plus court : … »), qui revient ensuite. Une alerte
  passe toujours d'abord : pendant la marche, « Partir maintenant » (Alertes, « Heure de partir à pied », allumée
  d'office) en est une, comme en 1.2.4 ; « Si tu le rates » occupe alors les 5 min d'avant, et toute la fenêtre quand
  cette alerte est coupée ou que le trajet commence à bord. Rien quand aucun trajet n'en repart (« , dernier » le dit
  déjà), ni quand le premier véhicule est supprimé (l'alerte le dit). Une suppression plus loin dans le trajet de
  repli l'écarte.

## 2. Marge des correspondances (CA-125.2)

- Colonne d'état d'un véhicule pris en correspondance (jamais le premier) : « marge 2 min » quand il reste 5 min ou
  moins entre l'arrivée de l'étape d'avant (marche ou descente) et son départ, en temps réel ; « très juste » à 0 ou
  moins. Seulement avant son départ.
- Ordre de la colonne : « SUPPRIMÉ », « en cours », « très juste », le retard du véhicule (« +3 min » : l'heure de la
  ligne est la prévue), « marge 2 min », puis « dans 4 min ».

## 3. Pluie prévue sur les marches (CA-125.3)

- Une marche de 5 min ou plus : « (7 min, pluie) », « (9 min à pied, pluie) » quand, sur un quart d'heure qu'elle
  touche, la case de son départ ou de son arrivée prévoit au moins 0,3 mm (0,25 mm arrondi au dixième) et que l'heure
  de ce quart d'heure annonce une probabilité de pluie de 60 % ou plus. En deçà de 5 min : rien.
- « Autres trajets » : « mais 19 min à pied sous la pluie », « moins de marche sous la pluie », « à pied, 25 min sous
  la pluie ». Téléphone : « , pluie prévue » au bout de la ligne des moyens d'une carte (« pluie prévue » seule pour un
  trajet à pied).
- Source : le relais, `GET /api/weather` : une grille fixe de la Belgique (9 × 16 cases de 0,25°), la même pour tout
  le monde, d'Open-Meteo (gratuit pour un usage non commercial, licence CC BY 4.0) ; le téléphone n'envoie jamais sa
  position et choisit lui-même la case de chaque marche. Grille gardée 1 h par le relais, et par le CDN le reste de
  cette heure (5 min de revalidation) ; Open-Meteo en panne : la dernière grille jusqu'à 2 h après sa lecture, puis
  plus rien (jamais de pluie supposée) ; après un refus, pas de nouvel appel avant 5 min, et les requêtes simultanées
  partagent un seul appel (le quota gratuit n'est pas dépensé pendant une panne).
- Téléphone : grille gardée 15 min, demandée sans le cache HTTP de la WebView ; relais muet : nouvel essai après
  5 min, la grille connue jusqu'à 2 h après sa lecture chez Open-Meteo (`fetchedAt`) ; une grille plus vieille est
  refusée ; demande arrêtée à 2,5 s. Un trajet n'attend la grille que 0,5 s après son calcul ; sinon il paraît sans
  pluie et le rafraîchissement suivant (30 s) la dit, réponses des favoris comprises (leur plan mémorisé et la marche
  jusqu'à la gare aussi) ; réglage coupé : plus aucune marque au rafraîchissement suivant.
- Réglage « Pluie pendant la marche » dans Affichage (allumé ; coupé : aucune demande). Écran Données : carte « Météo »
  (« Disponible », « Indisponible », « Coupée dans Affichage » ; « ta position n'est jamais envoyée ») ; au pied :
  « Météo : Open-Meteo.com, licence CC BY 4.0. ».

## 4. « Bus, tram, métro » plus lisible (lunettes et Quai Web ; CA-125.4)

Constat du propriétaire : surligner la ligne et sa destination (« Bus W » et « Bruxelles Midi »), un arrêt plus
lisible, ses départs à côté plutôt qu'en une longue ligne.
- Une ligne : une rangée par sens, « Bus W vers Bruxelles Midi », la ligne et la destination au plus clair, « vers »
  pâle, ses 2 prochains passages au plus clair à droite ; puis le nom de l'arrêt, pâle, en retrait. Sens pas encore
  connus ou mode inconnu : la forme de la 1.2.4 (« Bus W · Braine-l'Alleud Merbraine », les sens dessous).
- Un arrêt (toutes les lignes) : son nom, pâle, puis ses 2 prochains départs, un par rangée : « Tram 3 vers Churchill
  1 min ». Toucher l'arrêt : son tableau complet (inchangé).
- Les G2 n'ont ni surligneur ni tailles de texte : la luminosité, par conteneur, en tient lieu (colonne a au niveau
  4, colonne b au niveau 2), chaque mot placé au pixel ; une destination trop longue est coupée là où elle commence
  vraiment, toujours 10 px avant les passages, jamais les passages.
- Un arrêt et ses deux départs prennent 3 rangées : une ligne qui ne tient plus à la suite passe sur la page suivante
  (▽), entière.

## 5. Temps réel coupé : derniers retards connus (CA-125.5)

- Relais ou réseau en panne : le trajet suivi garde le dernier retard connu de chaque véhicule (15 min au plus), en
  plus de la suppression, de l'arrêt sauté et de la voie (M8.5) ; les heures restent marquées « ~ » (pas en direct).
  Les autres trajets (accueil, propositions, « Autres trajets ») : comme en 1.2.4, l'horaire prévu avec la
  suppression et la voie.
- Un retard gardé informe, il ne décide pas : il ne recule jamais l'heure de partir à pied (le véhicule a pu rattraper
  son retard : on part à l'heure prévue) et ne fait jamais recalculer une correspondance (seul le temps réel en direct
  le fait).
- « Dans le train » (tous les véhicules) l'explique : « Temps réel coupé : derniers retards connus ~ ». Sans retard
  gardé : la note habituelle, « Temps réel indisponible : horaires prévus ~ », seulement pour un véhicule qui n'est
  pas en direct (le flux d'un autre opérateur en panne ne change rien).
- Tableaux et arrêts d'un départ : inchangés (M8.5), l'horaire prévu avec la suppression et la voie seulement.

## 6. Démarrage plus rapide sans réseau (CA-125.6)

- Réseau lent ou absent au lancement : au bout de 4 s au plus, la copie enregistrée des horaires sert (le réseau
  l'emporte s'il répond pendant qu'on la lit) ; si le réseau répond ensuite avec une autre génération, elle la
  remplace (comme la relecture des 10 min), et le bandeau de fraîcheur, l'écran Données et l'écran affiché suivent
  tout de suite. Sans copie : on attend le réseau, comme avant. Hors ligne : la copie tout de suite.
- Reprise d'un état gardé (téléphone verrouillé, nouvelle WebView) : sa position, si elle a 2 min au plus, sert tout
  de suite ; la nouvelle la remplace quand elle arrive et, à plus de 30 m, recalcule ce qui en dépend (l'accueil pas
  encore touché reprend son ordre). Position gardée plus ancienne, ou sans état gardé : le lancement attend la
  position (5 s au plus), comme avant.

## 7. Dans le véhicule : ligne de progression (CA-125.7)

- En haut de « Dans le train », le train compris (1.2.4 : bus, tram et métro, en mots seulement) : « ●─●─◎─○─○─○
  descente dans 4 arrêts », « descente au prochain arrêt » à la fin. Pleins : arrêts passés ; cerclé : le prochain ;
  vides : à venir, la descente en dernier. Plus de 7 arrêts : « … » tient la place des arrêts cachés, au début
  (arrêts passés) comme au milieu (descente lointaine), 7 signes au plus ; la phrase donne toujours le compte exact.
  Même calcul que « prochain » (heures estimées), pas la position. Rien quand les arrêts ne sont pas connus, ni une
  fois arrivé, ni pour un véhicule supprimé.

## 8. Nouveautés (CA-125.8)

- Lunettes, « Quai 1.2.5 » (une fois après la mise à jour, jamais après une installation neuve ; les mêmes sur Quai
  Web) : « Étapes : l'heure d'arrivée si tu rates ton départ. », « Pluie prévue : dite sur la marche concernée. »,
  « Dans le véhicule : ta progression jusqu'à la descente. », « Bus, tram, métro : les lignes en clair, un départ par
  ligne. » ; depuis une version d'avant la 1.2.4, aussi les deux lignes de la 1.2.4 (6 lignes). Les nouveautés plus
  anciennes ne sont plus dites.
- Téléphone : bannière avec les 5 nouveautés, puis celles de la 1.2.4, de la 1.2.3 et de la 1.2.2 selon la version
  d'avant.

## 9. Confidentialité et sécurité (CA-125.9)

- Quai Web publiée avec une politique de sécurité du contenu (ses propres fichiers ; réseau vers les adresses des
  données et du relais seulement ; ni objet, ni formulaire) et sans référent. Lecteurs d'écran : une rangée de « Bus,
  tram, métro » se lit dans l'ordre des mots à l'écran (« Bus W vers Bruxelles Midi, 20 · ~37 min »).
- Caractères invisibles de sens d'écriture (U+200E, U+200F, U+202A à U+202E, U+2066 à U+2069) retirés des textes des
  opérateurs par le relais (alertes, messages de la STIB) et à l'affichage (jamais « ? »).
- Relais à Francfort (fra1). Météo : aucune position envoyée (grille fixe). Description des droits (app.json) et
  politique de confidentialité (store/privacy.md) disent la pluie prévue.

## 10. Hors de cette version (1.2.6)

Rappel avant de partir, écran calme, radar de pluie, plan B, arrêt manqué, flèche de direction, écran de marche,
réglages regroupés, texte plus grand (une image seulement : les G2 n'ont qu'une taille de texte).

## 11. Vérifications

Tests de l'appli et du relais (unitaires), de bout en bout (vitest) et simulateur Even Hub 0.9.5 (vrai cœur, vraies
données des fixtures, vrai relais sur un faux portail, un faux service d'adresses et un faux Open-Meteo), contrôle au
pixel des captures ; relecture indépendante (3 défauts importants, 11 mineurs : publication adoptée après le
lancement, largeur au pixel des rangées de « Bus, tram, métro », retards gardés, pluie des favoris, âge de la grille,
position gardée, lecteurs d'écran, ligne de progression, textes), corrections faites avec leurs tests, balayage au
pixel de 2 880 rangées compris.
