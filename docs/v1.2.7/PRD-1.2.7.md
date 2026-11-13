# Quai 1.2.7 : cahier produit

Version corrective de la 1.2.6, demandée par le propriétaire le 13/11/2026 après ses essais de « toute la ligne » sur
Quai Web. Elle ne contient que ces corrections ; ce qui était prévu pour la 1.2.7 (rappel avant la descente, écran
calme, radar de la veille, plan B avec le retard mesuré, arrêt dépassé, flèche, écran en marchant) passe en 1.2.8.
Règle de confidentialité inchangée : jamais d'adresse ni de position personnelle dans le dépôt, les tests ou les
captures.

## 1. Le prochain passage, en clair (CA-127.1)

Constat du propriétaire : « 5 · 20 min » à droite d'un arrêt ne se comprenait pas. Il faut que ce soit simple,
intuitif, juste.

- Toute la ligne : à chaque arrêt, un seul temps, celui du prochain passage : « dans 5 min » ; moins d'une minute :
  « imminent » ; au-delà d'une heure : « à 23:40 » ; un autre jour : « demain 06:04 » ; « ~ » devant le nombre sans
  temps réel (« dans ~5 min ») ; aucun : « aucun passage ».
- Les passages suivants : toucher l'arrêt (détail de la ligne à cet arrêt, 4 passages par sens).
- La note « ~ horaire prévu, sans temps réel » n'apparaît que si un temps montré est un horaire prévu.

## 2. Un ● juste (CA-127.2)

Constat sur le tram 92 (Quai Web, 13/11 à 22:21) : deux ● pour un seul tram, parti de Schaerbeek Gare, un peu plus
rapide que l'horaire.

- ● (« un tram arrive ») seulement quand le prochain passage à cet arrêt vient du temps réel et qu'il arrive avant que
  le prochain passage de l'arrêt d'avant ait pu y venir même en roulant deux fois plus vite que l'horaire : le tram a
  déjà dépassé l'arrêt d'avant. Jamais de ● d'après l'horaire seul.

## 3. Les lignes en boucle dans les deux sens (CA-127.3)

Constat du propriétaire : le métro 2 n'avait qu'un sens. Il part d'Elisabeth et y revient (ou part de Simonis) : le
premier et le dernier arrêt ne disent pas le sens, et les deux sens étaient fondus en un seul.

- Quand un motif est une boucle (moins de 300 m entre ses bouts), son sens se lit à l'ordre de ses arrêts communs
  avec le motif de référence (en tournant autour de la boucle).
- Deux sens au même terminus portent un nom différent, par où ils passent : « La Hulpe Gare par La Hulpe Nysdam »
  (l'arrêt aux plus de correspondances parmi les trois premiers où les sens se séparent, jamais le terminus).
- Un arrêt affiché deux fois (une boucle repasse à Simonis et finit à son départ) a ses passages à chaque fois.

## 4. Vérifications

Tests des règles (format du passage, ● d'après le temps réel, anneau parcouru dans les deux sens, arrêts répétés),
simulateur Even Hub avec contrôle au pixel, balayage des vraies lignes de la nuit (nouvelles mesures : deux sens au
même nom, interdit ; arrêts sans passage au milieu d'une ligne qui roule).

Sur les données du 13/11 : le métro 2 a ses deux sens (vers Elisabeth par Osseghem et Gare de l'Ouest, vers Simonis
par Ribaucourt et Rogier, 19 arrêts chacun) ; 25 lignes en boucle de plus ont leurs deux sens (75 lignes à une seule
rangée au lieu de 100) ; 23 lignes ont deux sens au même terminus, nommés par où ils passent ; aucune erreur.
