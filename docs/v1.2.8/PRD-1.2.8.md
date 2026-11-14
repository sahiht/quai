# Quai 1.2.8 : cahier produit

Petite version demandée par le propriétaire le 13/11/2026 au soir, après ses essais de la 1.2.7 sur Quai Web : à la
gare de Namur, il choisit le train pour Liège et voudrait, une fois sur place, (1) voir la voie et dans combien de temps
le train part, (2) avoir les petits points de suivi, comme pour les trams, (3) voir aussi les gares d'avant, pas
seulement à partir de la gare choisie. Il a aussi demandé de corriger les défauts trouvés en chemin, sans en inventer.
Ce qui était prévu pour la 1.2.8 (rappel avant la descente, écran calme, radar de la veille, plan B avec le retard
mesuré, arrêt dépassé, flèche, écran en marchant) passe en 1.2.9, puis en 1.2.10 (la 1.2.9 est consacrée aux réglages du
téléphone, PRD-1.2.9). Règle de confidentialité inchangée : jamais
d'adresse ni de position personnelle dans le dépôt, les tests ou les captures.

## 1. Tout le trajet d'un train (CA-128.1)

- Toucher un train au tableau d'une gare (« Gares de train », « Autour de moi », une gare d'un autre trajet) : tout son
  trajet, de sa gare de départ à son terminus. Après la gare du tableau, seulement les gares où l'on peut descendre
  (comme 1.2.3) ; jamais un point de passage sans heure (« Sterpenich-Frontière », « Athus-Frontière »).
- Une rangée par gare, comme toute la ligne (1.2.6, 1.2.7) : ○ devant le nom (● : § 2), le nom au plus clair, la voie
  en pâle (modifiée par le temps réel : « voie 6 ! », au plus clair), à droite le passage en clair : « dans 6 min »,
  « imminent », au-delà d'une heure « à 08:42 », un autre jour « demain 06:04 », « ~ » sans temps réel, « SUPPRIMÉ ».
  L'heure est le départ jusqu'à la gare du tableau, l'arrivée ensuite.
- Les gares que le train a quittées : toute la rangée en pâle, avec leur heure (« 07:57 », « ~07:42 »).
- Le curseur sur la gare du tableau, la gare d'avant au-dessus de lui ; △ remonte jusqu'à la gare de départ du train,
  ▽ descend jusqu'au terminus ; toucher une gare : ses départs ; double toucher : retour. Aide : « △▽ gares   toucher :
  départs   double : retour ». Un départ d'un autre jour : « , demain » au titre (comme 1.2.3).
- Bus, tram et métro : les arrêts d'un départ restent ceux de la 1.2.3 (de l'arrêt du tableau au terminus).

## 2. Le ● d'un train (CA-128.2)

- Le train a quitté une gare quand son départ estimé (temps réel, sinon horaire prévu) est passé ; il ne recule jamais
  (une gare d'avant la dernière quittée est quittée aussi) ; l'heure prévue d'un arrêt supprimé ne compte pas.
- ● sur la première gare desservie après la dernière quittée : le train y arrive, ou y est à quai. Seulement si ces deux
  gares viennent du temps réel (juste ou rien, comme le ● de la 1.2.7) ; avant le départ du train et après son
  terminus, aucun ●. La ligne du haut le dit : « ● : le train arrive ».
- À l'ouverture, quand le train arrive d'avant la gare du tableau : son ● et la gare qu'il vient de quitter sur la page
  du curseur, si tout tient (sinon son ● seul, sinon la gare d'avant).
- Limite connue : le temps réel des trains reçu aujourd'hui (copie du portail BMC) est partiel ; sans lui, pas de ●.
  Le flux temps réel officiel de la SNCB est gratuit, sous un contrat de licence à demander par le propriétaire (son
  formulaire « public data ») ; il se brancherait au relais sans changer l'écran.

## 3. Défauts corrigés (CA-128.3)

- La note « ~ horaire prévu, sans temps réel » s'affichait sous une page sans aucun « ~ » (toute la ligne : la capture
  du tram 92 du 13/11 ; tableaux d'une gare ou d'un arrêt sur plusieurs pages). Elle ne s'affiche plus que si une
  rangée à l'écran montre un « ~ » ; sa ligne reste réservée (rien ne bouge d'une page à l'autre). Le temps réel en
  panne garde sa note sur toutes les pages.

## 4. Message « Quai 1.2.8 » (CA-128.4)

- Une fois, à qui avait vu la 1.2.7 ou avant (la 1.2.7, corrective, n'en avait pas) : « Un train : tout son trajet,
  gares d'avant comprises. », « Chaque gare : sa voie et dans combien de temps. », « ● : là où le train arrive, d'après
  le temps réel. » Depuis la 1.2.5 ou avant, aussi les quatre lignes de la 1.2.6 ; une version entière ou rien, 8
  lignes au plus (un écran) : celles de la 1.2.5 ne sont plus dites.
- Bannière « Nouveau » du téléphone : deux phrases de la 1.2.8, puis celles des versions sautées (comme avant).

## 5. Vérifications

Tests des règles (trainProgress : gares quittées, ●, arrêt supprimé, retard qui ne fait pas reculer le train ; vue :
gares d'avant en pâle, voie modifiée au plus clair, curseur et ● sur la même page, noms longs ; note « ~ » par page),
simulateur Even Hub avec contrôle au pixel et relief mesuré (nouveau scénario à 08:00 : l'IC de 07:42 roule, Gembloux
quittée en pâle, ● à Ottignies, curseur sur Bruxelles-Nord), et balayage de tous les vrais trains de la nuit
(test/scan/real-trains.test.ts, chaque nuit avec celui des lignes) : chaque voyage vu de sa première gare, d'une gare
du milieu et de la dernière, puis avec un temps réel simulé.

Sur les données du 13/11 : 3 777 voyages, 11 218 trajets, de 2 à 34 gares (médiane 13), des gares d'avant dans 7 441
trajets, voies connues pour 87,1 % des arrêts, aucune rangée coupée sur 155 372, le ● juste sur 3 745 voyages, aucune
erreur. Le balayage a trouvé deux défauts de la nouvelle vue, corrigés avant publication : les points de passage sans
heure (433 dans les données) et une heure pâle qui dépassait le bord sûr d'un pixel.
