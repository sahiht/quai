# Quai : confidentialité

Quai est une appli personnelle pour les lunettes Even Realities G2. Elle ne crée aucun compte, ne suit personne et n’utilise aucun outil de statistiques ou de publicité. Les deux serveurs qu’elle contacte sont ouverts à ton nom : ton compte GitHub (horaires) et ton compte Vercel (relais du temps réel et des adresses).

## Permissions demandées

- Position (`location`) : trouver les arrêts proches et proposer le bon trajet.
- Réseau (`network`) : télécharger les horaires et le temps réel, et chercher les adresses, uniquement depuis les deux adresses listées plus bas.

## Position

La position du téléphone sert uniquement, sur le téléphone, à trouver les arrêts proches et à calculer les trajets. Elle n’est jamais enregistrée et n’est jamais envoyée au relais temps réel. Seule exception : un lieu que tu enregistres toi-même avec « Utiliser ma position actuelle » garde ces coordonnées, dans tes réglages sur le téléphone.

## Horaires

Les horaires sont des fichiers statiques préparés chaque nuit et publiés sur GitHub Pages. L’appli les télécharge par zones d’environ 2 km : le serveur voit seulement les fichiers demandés (la zone, les arrêts consultés, les deux premières lettres des mots recherchés), jamais la position exacte.

## Temps réel

Les retards, voies et suppressions viennent de ton propre relais, hébergé sur Vercel. L’appli lui envoie seulement des identifiants d’arrêts, de lignes et de voyages (ceux des écrans affichés), jamais la position.

## Adresses

Quand tu tapes une adresse sur le téléphone (3 caractères au moins), l’appli envoie à ton relais seulement le texte tapé et la langue des noms : jamais la position, jamais un identifiant. Le relais transmet ce texte aux services officiels et gratuits des Régions : Paradigm (UrbIS) pour Bruxelles, Digitaal Vlaanderen pour la Flandre, le SPW (ICAR) pour la Wallonie. Ces services reçoivent la requête du relais, pas de ton téléphone. La position sert seulement, sur le téléphone, à classer les adresses trouvées.

Les adresses que tu choisis restent sur le téléphone : tes favoris, et les 5 dernières adresses choisies (« Effacer les adresses récentes », dans « Mes favoris », les retire).

## Ce que voient les hébergeurs

Comme pour toute page web, GitHub et Vercel reçoivent les données techniques de chaque requête (adresse IP, heure, fichier demandé, et pour une adresse le texte tapé). Quai n’y ajoute aucun identifiant.

## Ce qui reste sur le téléphone

Tes réglages, tes favoris, tes gares et tes lignes, tes adresses récentes et une copie des horaires déjà consultés sont enregistrés dans le stockage de l’appli Even Realities, sur ton téléphone. Rien n’est envoyé ailleurs.

## Serveurs contactés

<!-- quai:domaines:debut -->
- Horaires (fichiers statiques) : adresse GitHub Pages, remplie par `npm run configure`
- Temps réel et adresses (relais personnel) : adresse Vercel, remplie par `npm run configure`
<!-- quai:domaines:fin -->

## Sources

Données : SNCB, STIB, De Lijn, TEC via Belgian Mobility Company, licence CC BY 4.0. Adresses : Digitaal Vlaanderen, Paradigm (UrbIS), SPW (ICAR). Usage personnel et non commercial.
