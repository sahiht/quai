# Quai 1.2.6 : cahier produit

Demande du propriétaire du 13/11/2026 : « Bus, tram, métro » devient deux rubriques, une pour les arrêts et une pour
les lignes ; une ligne se garde sans arrêt, toujours dans les deux sens, et la toucher montre tout son parcours avec
l'attente à chaque arrêt. Version 2 du projet le même jour, après sa relecture : des titres qui distinguent clairement
les trains du reste, une configuration plus simple, avec des couleurs. Projet de version avec les écrans du simulateur :
https://claude.ai/artifact/NmJ57AXnYj8G3wuGgwj6uN. Mise en production demandée le 13/11 (« fais un dernier contrôle
qualité rapide et lance la prod »). Règle de confidentialité inchangée : jamais d'adresse ni de position personnelle
dans le dépôt, les tests ou les captures ; la position ne quitte jamais le téléphone.

## 1. Trois rubriques qui disent leur mode (lunettes, téléphone, Quai Web ; CA-126.1)

- Accueil des lunettes : « Gares de train », « Arrêts de bus, tram, métro », « Lignes de bus, tram, métro », à la place
  de « Gares » et « Bus, tram, métro », sous « Autour de moi ». Le mot clé (Gares, Arrêts, Lignes) au plus clair, la
  précision en pâle (segRow) ; à droite leur nombre (« 1 gare », « 1 arrêt », « 3 lignes ») ou « à choisir ».
- Les mêmes titres sur l'écran de chaque rubrique, sur le téléphone et dans Quai Web.
- Place : 5 rubriques fixes au lieu de 4. L'accueil garde 3 favoris ; la ligne vide avant « Autour de moi » saute
  d'abord. Quatre cas prennent une ligne : l'aide des gestes (7 premiers jours), un trajet suivi, un jour férié, une
  ligne du haut (temps réel indisponible, horaires anciens). Avec un seul, 3 favoris ; deux, 2 ; trois, 1 ; les
  quatre, aucun (« Favoris » et leur nombre restent).
- Écarté : « Trains » et « Bus, tram, métro : arrêts » ; deux rubriques commenceraient par les mêmes mots.

## 2. « Arrêts de bus, tram, métro » (CA-126.2)

La présentation de la 1.2.5, appréciée par le propriétaire : le nom de l'arrêt, puis ses deux prochains départs, un par
ligne ; toucher l'arrêt ouvre tous ses départs. Seul l'intitulé « ARRÊTS » disparaît : l'écran porte ce nom. Vide :
« Choisis tes arrêts dans Quai, sur le téléphone » (Quai Web : l'ajout d'un arrêt).

## 3. « Lignes de bus, tram, métro » et toute la ligne (CA-126.3)

- Liste : une rangée par sens (« Tram 3 vers Churchill », « Tram 3 vers Esplanade »), la ligne et sa destination au
  plus clair, « vers » en pâle ; une ligne qui ne roule que dans un sens (boucle) n'a qu'une rangée, une ligne en
  morceaux une rangée par morceau et par sens. Pas d'attente : sans arrêt, il n'y en a pas une seule à donner. La
  liste ne demande rien au relais. Ligne introuvable dans les données du jour : « introuvable : modifie-la sur le
  téléphone ».
- Toucher un sens : toute la ligne dans ce sens (lineRun). Ses arrêts dans l'ordre du trajet, variantes comprises ;
  à droite les deux prochains passages (« 1 · 9 min », « ~ » sans temps réel, une heure au-delà de 60 min) ; ○ devant
  chaque arrêt, ● quand un véhicule arrive (il a passé l'arrêt d'avant : le prochain passage arrive plus tôt que celui
  de l'arrêt d'avant plus le temps de parcours, moins 30 s, et dans les 30 min) ; la ligne du haut le rappelle
  (« ● : un tram arrive »). L'arrêt le plus proche, à 2 km au plus, dit sa distance (« à 80 m ») et porte le curseur à
  l'ouverture ; plus loin, le curseur part du premier arrêt. En bas, « ↔ Autre sens vers Esplanade », s'il y a un sens
  inverse. La liste défile par page. Toucher un arrêt : les passages de la ligne à cet arrêt, dans les deux sens
  (écran de la 1.2.2).
- Temps réel : STIB, l'attente annoncée à chaque arrêt (relais, 30 arrêts par appel, trié par destination) ; De Lijn et
  TEC, les voyages en route ou qui partent dans l'heure (GTFS-RT). Mise à jour toutes les 30 s, comme les autres écrans
  en direct. Le ● se déduit des heures : aucune position de véhicule n'est demandée.
- Variantes : les arrêts d'un sens sont ceux de son motif le plus servi, puis ceux des autres motifs du sens, insérés
  à leur place : avant l'arrêt commun qui les suit, à la suite du terminus pour un prolongement, au début pour un
  départ plus tôt. Un arrêt que seuls certains voyages desservent porte ◇ (◆ quand un véhicule arrive) ; la ligne du
  haut le dit (« ◇ : pas tous les trams »). Ses passages ne comptent que les voyages qui s'y arrêtent.
- Morceaux : des motifs d'un même sens sans arrêt commun (une ligne coupée par des travaux, par exemple) forment des
  morceaux. Chaque morceau est un sens à part, avec sa rangée dans « Lignes » et son terminus, la destination la plus
  servie du morceau. Le tram 4 des données du 13/11 roule en deux morceaux (Gare du Nord ↔ Wiels, Porte de Hal ↔
  Stalle) : 4 rangées.
- « ↔ Autre sens » mène au sens de l'autre direction qui partage le plus d'arrêts avec celui-ci ; sans sens inverse,
  pas de rangée « ↔ ».

## 4. Lignes suivies, reprise des réglages (CA-126.4)

- Réglages v4, nouveau champ `follows` (LineFollow : réseau, numéro, mode, variantes `routes`, terminus `ends`,
  couleur, arrêt repère `via`, `near`), 32 lignes au plus. `lines` ne garde que les arrêts.
- Une ligne gardée à un arrêt en 1.2.5 (LinePick avec `line`) devient une ligne suivie, dans les deux sens ; gardée à
  deux arrêts, elle n'apparaît qu'une fois. Son arrêt devient son repère (`via`), pour reconnaître la bonne ligne (le W
  du TEC, pas un autre W) ; ses variantes et terminus sont retrouvés à la première ouverture, puis gardés.
- Copie unique des réglages d'avant sous `quai.settings.v4-1.2.5`, comme en 1.2.2 : un retour à la 1.2.5 peut les
  reprendre.
- « Ouvrir d'office à moins de 300 m » d'une ligne gardée à un arrêt : Quai ouvre les départs de cet arrêt, comme
  l'arrêt favori de la 1.2.1. Une ligne ajoutée en 1.2.6 n'a pas d'ouverture d'office (pas d'arrêt).
- « ★ garder une ligne », sur les départs d'un arrêt : ajoute ou retire la ligne entière (« ★ Ajoutée aux lignes »),
  annulable 5 s ; ★ dans le titre : l'arrêt est gardé, ou c'est le repère d'une ligne suivie.

## 5. Configuration sur le téléphone (CA-126.5)

- Accueil : sections « Gares de train », « Arrêts de bus, tram, métro », « Lignes de bus, tram, métro », chacune avec
  son écran (#/gares, #/arrets, #/lignes) : monter, descendre, retrait confirmé dans la page puis annoncé (« Retirer
  Tram 3 de tes lignes ? »), 32 au plus (« 32 lignes au plus : retires-en une. », aussi dans « Près de toi »). Sous
  une ligne, son réseau et ses terminus (« STIB · Churchill ↔ Esplanade »). « Ouvrir d'office à moins de 300 m de
  Gare du Nord » seulement pour une ligne qui a un arrêt repère (gardée en 1.2.5) ; un arrêt le garde.
- « Un endroit » (nouveau favori) : un arrêt de bus, tram ou métro propose « Ses prochains départs : l'ajouter à tes
  arrêts » (« Ajouter un arrêt », lui en tête).
- Les trois ajouts commencent par « Près de toi » : les gares proches, les arrêts proches (avec leurs lignes), les
  lignes des arrêts à 500 m (8 au plus) ; « Ajouter » à droite, « Ajoutée ✓ » (« Ajouté ✓ » pour un arrêt) ensuite,
  un second toucher retire. Dessous, « Une autre gare », « Un autre arrêt », « Une autre ligne » : la recherche par nom
  ou par numéro. Une ligne s'ajoute toujours dans les deux sens ; plus de question « À quel arrêt ? ». « Près de toi »
  se calcule sur le téléphone avec les horaires de la nuit : la position ne le quitte pas.
- Couleurs : chaque ligne est une pastille à sa couleur, avec son numéro (accueil, ajouts, lignes d'un arrêt) ; une gare
  de train a son icône bleue. Couleurs posées par le CSSOM (style.setProperty), sans attribut style écrit dans la page.
  Les lunettes restent monochromes.
- Lisibilité (contrôle sur les vraies données) : le numéro garde la couleur de texte de l'opérateur si elle se lit
  (contraste d'au moins 3:1), sinon blanc ou presque noir, le plus lisible (le beige sur blanc de 556 lignes De
  Lijn) ; chaque pastille garde un liseré fin (une pastille blanche sur la page blanche).

## 6. Couleurs des lignes (données de nuit ; CA-126.6)

- Le pipeline lit `route_color` et `route_text_color` des horaires officiels et les garde dans `lines/index.json`
  (5e et 6e éléments de chaque ligne, lus par position : la 1.2.5 les ignore) et dans chaque fichier de ligne. Le
  journal de nuit dit la couverture par réseau (« Couleurs des lignes : STIB 86/86, … »).
- Les trois réseaux publient une couleur par ligne : nuit du 13/11, STIB 86/86, De Lijn 1856/1856, TEC 838/838
  (journal de nuit) ; le TEC, la même pour toutes ses lignes (jaune, numéro noir). Une ligne sans couleur reste
  neutre ; au TEC, elle prendrait le jaune et le rouge de ses bus.
- Données d'essai : couleurs proches de celles du réseau (métros 1, 2, 5, 6 : violet, orange, jaune, bleu).

## 7. Nouveautés (CA-126.7)

Message « Quai 1.2.6 » une fois dans les lunettes (« Arrêts et lignes de bus, tram, métro, séparés. », « Une ligne :
tout son parcours, l'attente à chaque arrêt. », « Dans les deux sens, sans choisir d'arrêt. », « Tes lignes gardées y
sont déjà. ») ; à qui vient d'avant la 1.2.5, aussi les trois nouveautés de la 1.2.5 encore vraies. Bannière
« Nouveau » sur le téléphone, une fois : les quatre nouveautés de la 1.2.6, puis celles des versions sautées, sans
celles qui parlent de « Bus, tram, métro » (devenu deux rubriques).

## 8. Hors de cette version (1.2.7)

Rappel avant la descente, écran calme, radar de la veille, plan B avec le retard mesuré, arrêt dépassé, flèche, écran
en marchant, réglages « Ce qui s'affiche tout seul ». Condition inchangée : un essai sur les lunettes, téléphone
verrouillé, sur 3 vrais trajets.

## 9. Vérifications

- Tests des règles : 957 tests de l'appli (deux sens, morceaux et variantes, ●, arrêt le plus proche, « Près de
  toi », reprise des réglages, « ★ garder une ligne », couleurs et contraste), 271 du relais, 170 du pipeline
  (couleurs des lignes, lecture par la 1.2.5), 161 de bout en bout.
- Simulateur Even Hub : 222 étapes, écrans des lunettes contrôlés au pixel, dont « Lignes de bus, tram, métro » (mot
  par mot : la ligne et sa destination au plus clair, « vers » pâle) et toute la ligne ; téléphone et Quai Web dans
  Chrome.
- Vraies lignes : chaque nuit, l'étape « Balayer les lignes de bus, tram et métro » du workflow « Données de nuit »
  passe chaque ligne par le calcul des lunettes (sens et terminus, arrêts de chaque sens, toute la ligne à 08:00,
  rangées page par page) et écrit son bilan dans le journal ; erreurs : une ligne sans sens ou sans terminus, des
  rangées « Lignes » qui ne correspondent pas aux sens, un arrêt d'un motif absent de la liste de son sens, un « autre
  sens » invalide, un sens de moins de 2 arrêts, une rangée qui dépasse ; mesures : lignes en morceaux, motifs hors de
  l'ordre de la liste, arrêts de variante, sens sans « autre sens ». Lancée aussi avant la publication (essai de
  branche, sans rien publier), sur les données du 13/11 : 1 851 lignes (STIB 86, De Lijn 927, TEC 838 ; 2 780
  fichiers), aucune erreur. Avant la correction des variantes, 11,3 % des voyages passaient par un arrêt absent de
  l'écran ; après : aucun arrêt caché, 5 lignes en morceaux (dont le tram 4), 11,9 % des arrêts montrés en ◇, 1,9 %
  des voyages sur un motif dont l'ordre diffère de la liste (boucles surtout), 3 609 sens de 2 à 133 arrêts (médiane
  32), 0,7 % des rangées coupées (« … »), couleurs pour 100 % des lignes, texte de l'opérateur remplacé sur 566
  pastilles illisibles (aucune sous 3:1 ensuite). Deux fichiers De Lijn (lignes 2 et 4) ne sont pas retrouvés par leur
  numéro (la recherche lit 16 fichiers au plus).
- Contrôle qualité avant publication, défauts corrigés avec leurs tests : numéro d'une ligne suivie coupé à 12
  caractères (20 pour les arrêts : réglages instables), deux définitions de « même ligne », caractères de sens
  d'écriture dans les mots des rangées, limites de « Près de toi » sans message, « Terminé » d'un ajout d'arrêt qui
  menait aux lignes, aperçu de l'accueil incomplet pour les lecteurs d'écran, toute la ligne absente du mode de
  développement, une ligne à variantes ou en morceaux montrait une partie de ses arrêts sous un terminus qui ne
  collait pas (le tram 4 des données du 13/11 : 54 % des voyages sur des arrêts absents) ; le contrôle au pixel du
  simulateur étendu aux deux nouveaux écrans.
- Relecture indépendante (cinq équipes : cœur et réglages, lunettes, téléphone, données, relecture transversale),
  défauts corrigés avec leurs tests :
  - importants : une ligne suivie devenait « introuvable » quand l'opérateur renomme ses variantes à une nouvelle
    publication (retrouvée par son numéro, ses terminus ou son arrêt repère ; jamais au hasard) ; après un
    verrouillage, Quai rouvrait l'accueil au lieu de « Lignes » ou de toute la ligne ; deux lignes du même numéro dans
    deux régions (le W de Waterloo et celui de Tournai) se confondaient, au téléphone comme dans « garder une ligne » ;
    « Près de toi » ne se remplissait pas sans position à l'ouverture, et son bouton ne suivait pas un ajout par la
    recherche ; une couleur de ligne sans couleur de texte écrivait un élément vide refusé par le contrôle des
    données ;
  - mineurs : « Près de toi » lent à un grand arrêt (4 lignes lues à la fois, arrêt dès 8), couleur d'une autre région
    pour un numéro partagé (neutre désormais), identifiant de ligne reprise en double, ligne sans aucun sens absente
    de « Lignes » (« introuvable » désormais), message « introuvable » de toute la ligne (majuscule, Quai Web),
    « 1000 m » au lieu de « 1 km », focus et « aria-busy » des boutons d'ajout, ligne déjà suivie non signalée dans
    les lignes trouvées, couleurs jamais relues après un échec, noms longs sans espace, « à Gares » au lieu de « à tes
    gares », textes de la boutique.
- La 1.2.5 installée lit les nouvelles données de nuit (5e et 6e éléments de l'index, couleurs des fichiers de
  ligne) : vérifié avec ses propres validateurs.
