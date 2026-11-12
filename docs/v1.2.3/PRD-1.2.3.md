# Quai 1.2.3 : cahier produit

Demande du propriétaire du 12/11/2026 (10:47), après ses essais de la 1.2.2 : voir tous les horaires d'une gare, et
pour un départ, ses arrêts suivants ; dans « Bus, tram, métro », choisir une ligne ou un arrêt. Contrat de code :
app/src/core/api.ts (board avec `horizonMin`, departureStops, StopCall, DepartureStops). Règle de confidentialité
inchangée : jamais d'adresse ni de position personnelle dans le dépôt, les tests ou les captures.

## 1. Tableau complet d'une gare ou d'un arrêt (lunettes et Quai Web)

Constat : le tableau de Namur ne montrait que 3 départs (le réglage « Départs par arrêt » de la 1.0, 2 à 8).
- Partout où un tableau s'ouvre (Gares, Bus tram métro « toutes les lignes », Autour de moi, ★, favoris d'avant) :
  tous les départs des 2 prochaines heures (`board` avec `horizonMin: 120`, 40 au plus), dans l'ordre des heures, les
  supprimés à leur place. ▲▼ déplace le curseur de départ en départ, la liste défile par page.
- Première ligne du tableau, au-dessus des départs : « ★ garder la gare » / « ★ retirer la gare » (gare), « ★ garder
  une ligne » (arrêt de bus, tram ou métro), comme le toucher de la 1.2.2. Le curseur commence sur le premier départ.
- Toucher un départ ouvre ses arrêts (§ 2). Aide : « ▲▼ départs   toucher : arrêts   double : retour ».
- Rien dans les 2 heures : le prochain départ (même plus tard), sinon « aucun départ ».
- Le réglage « Départs par arrêt » disparaît d'« Affichage » (la valeur stockée est ignorée).

## 2. Les arrêts d'un départ (lunettes et Quai Web)

- Titre : le véhicule et sa destination (« IC vers Herstal », « Bus W vers Bruxelles Midi », « Tram 3 vers
  Churchill ») et l'heure.
- Lignes : l'arrêt du tableau d'abord (au plus clair), puis les suivants jusqu'au terminus, une ligne chacun :
  l'heure, le nom, et pour un train la voie ; le retard (« +3 ») et la voie modifiée comme sur les tableaux ; « ~ »
  pour une heure sans temps réel ; un arrêt supprimé est dit. ▲▼ fait défiler par page.
- Toucher un arrêt ouvre son tableau (§ 1), pour aller plus loin ; double toucher revient.
- Trains : heures et voies de la SNCB, retard par gare s'il est connu. Bus, tram, métro : heures prévues du trajet,
  décalées du retard connu au départ quand l'opérateur le donne, sinon « ~ ».
- Voyage disparu des données : « Ce départ n'est plus dans les horaires. »
- Depuis le détail d'une ligne (Bus, tram, métro), toucher un passage ouvre aussi ses arrêts.

## 3. Bus, tram, métro : une ligne ou un arrêt (téléphone et Quai Web)

- « Ajouter » propose deux choix : « Une ligne » (le parcours de la 1.2.2 : numéro, puis arrêt) et « Un arrêt » : un
  champ de recherche limité aux arrêts de bus, tram et métro (search() sans les gares SNCB), le plus proche d'abord ;
  un toucher ajoute l'arrêt avec toutes ses lignes (LinePick sans `line`), et confirme « {arrêt} ajouté : tous ses
  départs s'afficheront dans les lunettes. »
- Dans les lunettes, un arrêt choisi s'affiche « {arrêt} · toutes les lignes » avec ses 2 prochains départs ; toucher
  ouvre son tableau complet (§ 1).

## 4. Nouveautés, version

- Version 1.2.3 ; notes de la boutique en 1 à 3 lignes ; message unique « Quai 1.2.3 » sur les lunettes et le
  téléphone : tableaux complets (2 heures) ; toucher un départ : ses arrêts jusqu'au terminus ; Bus, tram, métro :
  une ligne ou un arrêt.

## 5. Critères d'acceptation

- CA-123.1 Tableau : tous les départs de 2 h (Namur un jour de semaine : bien plus de 8), ligne ★ en tête, curseur sur
  le premier départ, pages ▲▼, aide, cas sans départ ; « Départs par arrêt » absent d'« Affichage ».
- CA-123.2 Arrêts d'un départ : train (voies, retard par gare), bus, tram, métro (heures prévues ou décalées), arrêt du
  tableau en tête, terminus en dernier, arrêt supprimé, voyage disparu, toucher un arrêt ouvre son tableau, double
  toucher revient ; sur données réelles, un IC au départ de Namur et le bus 36 à Braine-l'Alleud Côté du Collège.
- CA-123.3 Arrêt dans Bus, tram, métro : recherche sans gares SNCB, ajout, doublon signalé, affichage « toutes les
  lignes », toucher vers le tableau complet.
- CA-123.4 Message « Quai 1.2.3 » une fois ; aucune régression des critères 1.2.2 (simulateur complet).
