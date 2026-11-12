# Passer Quai à une nouvelle version (bêta)

Ce guide sert à chaque nouvelle version de Quai. La dernière est la 1.2.2. Il faut environ 10 minutes, un ordinateur (ou le téléphone) pour le portail Even Hub, puis le téléphone.

## Ce qui change avec la 1.2.2

- Trajets plus cohérents : le premier est celui qui arrive le plus tôt, et au-delà de ta marche maximale, chaque minute à pied compte triple. Puis jusqu'à deux autres choix, chacun avec un vrai avantage : plus tôt, moins de marche ou moins de changements. Vérifié sur 250 trajets réels, sans aucune proposition incohérente.
- Deux rubriques sur l'accueil des lunettes : « Gares » (tes gares, leur prochain train, puis tout le tableau des départs) et « Bus, tram, métro » (tes lignes à ton arrêt, dans les deux sens). Tu les choisis sur le téléphone : une gare, ou une ligne puis son arrêt. Tes arrêts favoris y sont rangés tout seuls, rien n'est perdu ; leur ouverture d'office à moins de 300 m est gardée, mais plus leur créneau du matin ou du soir : l'accueil montre la gare et la ligne les plus proches.
- « Aller à… » rejoint « Favoris » : tes adresses récentes et « Autre adresse » sont au bas de la liste.
- Un trajet n'est suivi que si tu le demandes : « Suivre ce trajet » sur son écran, ou le bouton « Lunettes » du téléphone.
- Sur le téléphone, l'écran « Trajets » réunit la marche maximale et la marge avant de partir.

Si tu viens d'une version antérieure à la 1.2 : tes lieux sont maintenant des favoris, dans une seule liste, et Quai Web accepte une adresse comme position.

## Ce qui se met à jour tout seul

- Les horaires : chaque nuit, sans rien faire.
- Le relais (temps réel et adresses) : il se met à jour seul sur Vercel quand son code change sur GitHub.
- Quai Web : il passe seul à la nouvelle version, à la même adresse.
- Tes réglages : tes favoris, leur ordre et tes choix d'affichage sont repris par la nouvelle version. Depuis la 1.2, tes lieux font partie de tes favoris, sans doublon ; depuis la 1.2.2, tes arrêts favoris sont dans « Gares » ou « Bus, tram, métro ». Ils sont gardés dans l'appli Even Realities, sur ton téléphone.

Seule l'appli des lunettes demande ton geste : déposer le nouveau paquet sur Even Hub, le passer en bêta, puis l'installer sur le téléphone.

## Quand mettre à jour ?

Quand une nouvelle version est publiée sur GitHub (page « Releases » du dépôt). Une version porte toujours un numéro plus grand que la précédente : Even Hub refuse un numéro déjà déposé.

## Les étapes

### 1. Télécharger le paquet

Ouvre https://github.com/sahiht/quai/releases/latest. La page s'appelle « Quai v1.2.2 ». Dans « Assets » (fichiers joints), touche `quai.ehpk` pour le télécharger. L'icône ne change pas : inutile de la reprendre.

![Télécharger quai.ehpk](img/maj/maj-1-release.png)

### 2. Ouvrir ton appli sur Even Hub

Va sur https://hub.evenrealities.com et connecte-toi avec le même compte que dans l'appli Even Realities. Dans « My projects » (mes projets), touche la carte « Quai Belgium ».

![Ouvrir Quai Belgium](img/maj/maj-2-evenhub-projets.png)

### 3. Déposer le nouveau paquet

Onglet « Builds » (paquets). Touche le bouton « + » en haut à droite et choisis le fichier `quai.ehpk` téléchargé. Une ligne « v1.2.2 » apparaît sous « Private builds » (paquets privés), avec une étiquette grise « Private » (privé).

![Déposer le paquet](img/maj/maj-3-evenhub-builds.png)

### 4. Passer la version en bêta

Sur la ligne « v1.2.2 », touche l'étiquette grise « Private ». Choisis « Beta » (bêta), puis confirme avec « Promote to Beta » (passer en bêta).

![Passer en bêta](img/maj/maj-4-promote.png)

Inutile de te réinviter dans « Testing group » : ton accès de testeur reste actif d'une version à l'autre.

### 5. Installer sur le téléphone

Dans l'appli Even Realities : onglet « Me » (moi), puis « Beta tester » (testeur bêta). Sur Quai, touche « Install » (installer) ou « Update » (mettre à jour).

![Installer sur le téléphone](img/maj/maj-5-telephone.png)

### 6. Ouvrir Quai sur les lunettes

À la première ouverture, les lunettes affichent une fois le message « Quai 1.2.2 » avec les nouveautés. Touche pour continuer.

### 7. Vérifier

Sur le téléphone, ouvre Quai, puis « Données » : la ligne « Version de Quai » doit dire « 1.2.2 ». Dans les lunettes, l'accueil montre « Favoris », « Autour de moi », « Gares » et « Bus, tram, métro ».

## En cas de souci

| Ce que tu vois | Ce qu'il faut faire |
|---|---|
| Even Hub refuse le fichier | Ce numéro de version est déjà déposé. Vérifie que tu as bien pris le paquet de la dernière release. |
| « test version expired » sur le téléphone | La version n'est pas en « Beta », ou ton invitation n'est plus « Active » dans « Testing group ». |
| Les lunettes montrent encore l'ancienne version | Quitte Quai (double toucher à l'accueil), puis rouvre-le. Sur le téléphone, vérifie dans « Beta tester » que la version 1.2.2 est installée. |
| Un trajet propose plus de marche que ton réglage | Aucun trajet qui marche moins n'arrive assez tôt : au-delà de ta marche maximale, chaque minute à pied compte triple. Au bout des étapes, ▼ ouvre les autres trajets. Tu peux changer « Marche maximale » dans « Trajets », sur le téléphone. |
| « Gares » ou « Bus, tram, métro » disent « à choisir » | Ajoute tes gares et tes lignes sur le téléphone, dans Quai : rubriques « Gares » et « Bus, tram, métro » de l'accueil. |
| « Adresses indisponibles pour l'instant » | Le service d'adresses ne répond pas. Les gares et les arrêts restent utilisables ; réessaie plus tard. |
| La première recherche de trajet est lente | Normal : Quai télécharge une fois les lignes utiles (environ 0,5 à 1 Mo), puis les garde sur le téléphone. |
