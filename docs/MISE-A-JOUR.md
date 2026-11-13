# Passer Quai à une nouvelle version (bêta)

Ce guide sert à chaque nouvelle version de Quai. La dernière est la 1.2.6. Il faut environ 10 minutes, un ordinateur (ou le téléphone) pour le portail Even Hub, puis le téléphone.

## Ce qui change avec la 1.2.6

- Trois rubriques, dans les lunettes, sur le téléphone et dans Quai Web : « Gares de train », « Arrêts de bus, tram, métro » et « Lignes de bus, tram, métro ». Sur l'accueil des lunettes, le mot clé en clair (Gares, Arrêts, Lignes), la précision en pâle.
- Une ligne se suit en entier, dans les deux sens, sans choisir d'arrêt. Dans « Lignes de bus, tram, métro », un sens par rangée (« Tram 3 vers Churchill ») ; touche-le : tous ses arrêts dans l'ordre, l'attente à chacun (« 1 · 9 min »), ● quand un véhicule arrive, et l'arrêt le plus proche avec sa distance (« à 80 m »), sous le curseur. En bas, « ↔ Autre sens ».
- Sur le téléphone, chaque ajout commence par « Près de toi » : les gares, les arrêts et les lignes autour de toi, calculés sur le téléphone (ta position ne le quitte pas). Sinon, cherche par nom ou par numéro. Chaque ligne a sa pastille à sa couleur (STIB et De Lijn : leurs couleurs officielles ; TEC : jaune et rouge).
- Tes lignes gardées à un arrêt en 1.2.5 sont déjà dans « Lignes », dans les deux sens, et leur ouverture d'office à moins de 300 m reste. Une copie de tes réglages d'avant est gardée sur le téléphone.

Si tu passes directement de la 1.2.4 (ou d'avant) à la 1.2.6, voici aussi ce qu'apportaient les versions précédentes.

## Ce qui change avec la 1.2.5

- « Si tu le rates » : quand tu pars dans les 5 minutes, le haut des étapes dit l'heure d'arrivée si tu rates ton bus ou ton train (« Si tu le rates : arrivée 09:57, 59 min plus tard »).
- Une correspondance serrée montre sa marge (« marge 2 min », « très juste »).
- Pluie prévue : une marche de 5 minutes ou plus sous la pluie le dit (« (7 min, pluie) »). Quai reçoit la carte de toute la Belgique : ta position n'est jamais envoyée. Réglage « Pluie pendant la marche » dans Affichage.
- Dans le train, le bus, le tram ou le métro : une ligne de progression jusqu'à ta descente (« ●─●─◎─○─○ descente dans 3 arrêts »).
- Les arrêts de bus, tram et métro plus lisibles dans les lunettes : « Bus W vers Bruxelles Midi », la ligne et sa destination en clair ; sous un arrêt, ses deux prochains départs, un par ligne. Touche l'arrêt pour tous ses départs.
- Sans réseau : Quai démarre sur les horaires déjà enregistrés au bout de 4 secondes au plus, et garde les derniers retards connus du trajet que tu suis (« Temps réel coupé : derniers retards connus ~ »), sans jamais retarder l'heure de partir.

## Ce qui change avec la 1.2.4

- Dans les étapes, l'arrêt ou la gare où aller est écrit en entier, sous « Partir à pied vers l'arrêt ». Un trajet qui commence à bord dit d'où il part.
- Sur l'accueil des lunettes, chaque rubrique dit ce qu'elle contient (« 2 gares », « 2 arrêts ») au lieu d'un départ sans direction.
- Lunettes plus lisibles : heures alignées (le « ~ » d'un horaire prévu ne décale plus l'heure), aides des gestes plus discrètes (« △▽ »).

## Ce qui change avec la 1.2.3

- Tableaux complets : une gare ou un arrêt montre tous ses départs des 2 prochaines heures, page par page avec ▲▼. Le réglage « Départs par arrêt » disparaît.
- Touche un départ : ses arrêts jusqu'au terminus, avec l'heure, la voie et le retard pour un train. Touche un arrêt de la liste pour voir ses départs.

Si tu passes directement de la 1.2.1 à la 1.2.6, voici aussi ce qu'apportait la 1.2.2.

## Ce qui change avec la 1.2.2

- Trajets plus cohérents : le premier est celui qui arrive le plus tôt, et au-delà de ta marche maximale, chaque minute à pied compte triple. Puis jusqu'à deux autres choix, chacun avec un vrai avantage : plus tôt, moins de marche ou moins de changements. Vérifié sur 250 trajets réels, sans aucune proposition incohérente.
- Tes gares, tes arrêts et tes lignes sur l'accueil des lunettes (trois rubriques depuis la 1.2.6), choisis sur le téléphone. Tes arrêts favoris y sont rangés tout seuls, rien n'est perdu ; leur ouverture d'office à moins de 300 m est gardée, mais plus leur créneau du matin ou du soir.
- « Aller à… » rejoint « Favoris » : tes adresses récentes et « Autre adresse » sont au bas de la liste.
- Un trajet n'est suivi que si tu le demandes : « Suivre ce trajet » sur son écran, ou le bouton « Lunettes » du téléphone.
- Sur le téléphone, l'écran « Trajets » réunit la marche maximale et la marge avant de partir.

Si tu viens d'une version antérieure à la 1.2 : tes lieux sont maintenant des favoris, dans une seule liste, et Quai Web accepte une adresse comme position.

## Ce qui se met à jour tout seul

- Les horaires : chaque nuit, sans rien faire.
- Le relais (temps réel, adresses et pluie prévue) : il se met à jour seul sur Vercel quand son code change sur GitHub.
- Quai Web : il passe seul à la nouvelle version, à la même adresse.
- Tes réglages : tes favoris, leur ordre et tes choix d'affichage sont repris par la nouvelle version. Depuis la 1.2, tes lieux font partie de tes favoris, sans doublon ; depuis la 1.2.2, tes arrêts favoris sont rangés dans tes gares et tes arrêts ; depuis la 1.2.6, tes lignes gardées à un arrêt sont dans « Lignes de bus, tram, métro ». Ils sont gardés dans l'appli Even Realities, sur ton téléphone.

Seule l'appli des lunettes demande ton geste : déposer le nouveau paquet sur Even Hub, le passer en bêta, puis l'installer sur le téléphone.

## Quand mettre à jour ?

Quand une nouvelle version est publiée sur GitHub (page « Releases » du dépôt). Une version porte toujours un numéro plus grand que la précédente : Even Hub refuse un numéro déjà déposé.

## Les étapes

### 1. Télécharger le paquet

Ouvre https://github.com/sahiht/quai/releases/latest. La page s'appelle « Quai v1.2.6 ». Dans « Assets » (fichiers joints), touche `quai.ehpk` pour le télécharger. L'icône ne change pas : inutile de la reprendre.

![Télécharger quai.ehpk](img/maj/maj-1-release.png)

### 2. Ouvrir ton appli sur Even Hub

Va sur https://hub.evenrealities.com et connecte-toi avec le même compte que dans l'appli Even Realities. Dans « My projects » (mes projets), touche la carte « Quai Belgium ».

![Ouvrir Quai Belgium](img/maj/maj-2-evenhub-projets.png)

### 3. Déposer le nouveau paquet

Onglet « Builds » (paquets). Touche le bouton « + » en haut à droite et choisis le fichier `quai.ehpk` téléchargé. Une ligne « v1.2.6 » apparaît sous « Private builds » (paquets privés), avec une étiquette grise « Private » (privé).

![Déposer le paquet](img/maj/maj-3-evenhub-builds.png)

### 4. Passer la version en bêta

Sur la ligne « v1.2.6 », touche l'étiquette grise « Private ». Choisis « Beta » (bêta), puis confirme avec « Promote to Beta » (passer en bêta).

![Passer en bêta](img/maj/maj-4-promote.png)

Inutile de te réinviter dans « Testing group » : ton accès de testeur reste actif d'une version à l'autre.

### 5. Installer sur le téléphone

Dans l'appli Even Realities : onglet « Me » (moi), puis « Beta tester » (testeur bêta). Sur Quai, touche « Install » (installer) ou « Update » (mettre à jour).

![Installer sur le téléphone](img/maj/maj-5-telephone.png)

### 6. Ouvrir Quai sur les lunettes

À la première ouverture, les lunettes affichent une fois le message « Quai 1.2.6 » avec les nouveautés. Touche pour continuer.

### 7. Vérifier

Sur le téléphone, ouvre Quai, puis « Données » : la ligne « Version de Quai » doit dire « 1.2.6 ». Dans les lunettes, l'accueil montre « Favoris », « Autour de moi », « Gares de train », « Arrêts de bus, tram, métro » et « Lignes de bus, tram, métro ».

## En cas de souci

| Ce que tu vois | Ce qu'il faut faire |
|---|---|
| Even Hub refuse le fichier | Ce numéro de version est déjà déposé. Vérifie que tu as bien pris le paquet de la dernière release. |
| « test version expired » sur le téléphone | La version n'est pas en « Beta », ou ton invitation n'est plus « Active » dans « Testing group ». |
| Les lunettes montrent encore l'ancienne version | Quitte Quai (double toucher à l'accueil), puis rouvre-le. Sur le téléphone, vérifie dans « Beta tester » que la version 1.2.6 est installée. |
| Un trajet propose plus de marche que ton réglage | Aucun trajet qui marche moins n'arrive assez tôt : au-delà de ta marche maximale, chaque minute à pied compte triple. Au bout des étapes, ▼ ouvre les autres trajets. Tu peux changer « Marche maximale » dans « Trajets », sur le téléphone. |
| « Gares de train », « Arrêts » ou « Lignes » disent « à choisir » | Ajoute tes gares, tes arrêts et tes lignes sur le téléphone, dans Quai : rubriques du même nom de l'accueil. |
| Une ligne dit « introuvable » | Elle n'est plus dans les horaires du jour (ligne renumérotée ou supprimée) : retire-la et ajoute la nouvelle sur le téléphone, rubrique « Lignes de bus, tram, métro ». |
| Une ligne sans couleur sur le téléphone | Son réseau ne publie pas de couleur pour elle : sa pastille reste neutre, rien d'autre ne change. |
| Jamais de « pluie » sur les marches | Il ne pleut pas assez (0,3 mm sur un quart d'heure, probabilité de 60 % ou plus), ou la marche dure moins de 5 minutes. Sur le téléphone, « Données » : la carte « Météo » doit dire « Disponible » ; « Coupée dans Affichage » : rallume « Pluie pendant la marche ». |
| « Adresses indisponibles pour l'instant » | Le service d'adresses ne répond pas. Les gares et les arrêts restent utilisables ; réessaie plus tard. |
| La première recherche de trajet est lente | Normal : Quai télécharge une fois les lignes utiles (environ 0,5 à 1 Mo), puis les garde sur le téléphone. |
