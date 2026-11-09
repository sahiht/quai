# Quai : confidentialité

Quai est une appli personnelle pour les lunettes Even Realities G2. Elle ne crée aucun compte, ne suit personne et n’utilise aucun outil de statistiques ou de publicité. Les deux serveurs qu’elle contacte sont ouverts à ton nom : ton compte GitHub (horaires) et ton compte Vercel (relais temps réel).

## Permissions demandées

- Position (`location`) : trouver les arrêts proches et proposer le bon trajet.
- Réseau (`network`) : télécharger les horaires et le temps réel, uniquement depuis les deux adresses listées plus bas.

## Position

La position du téléphone sert uniquement, sur le téléphone, à trouver les arrêts proches et à calculer les trajets. Elle n’est jamais enregistrée et n’est jamais envoyée au relais temps réel. Seule exception : un lieu que tu enregistres toi-même avec « Utiliser ma position actuelle » garde ces coordonnées, dans tes réglages sur le téléphone.

## Horaires

Les horaires sont des fichiers statiques préparés chaque nuit et publiés sur GitHub Pages. L’appli les télécharge par zones d’environ 2 km : le serveur voit seulement les fichiers demandés (la zone, les arrêts consultés, les deux premières lettres des mots recherchés), jamais la position exacte.

## Temps réel

Les retards, voies et suppressions viennent de ton propre relais, hébergé sur Vercel. L’appli lui envoie seulement des identifiants d’arrêts, de lignes et de voyages (ceux des écrans affichés), jamais la position.

## Ce que voient les hébergeurs

Comme pour toute page web, GitHub et Vercel reçoivent les données techniques de chaque requête (adresse IP, heure, fichier demandé). Quai n’y ajoute aucun identifiant.

## Ce qui reste sur le téléphone

Tes réglages, tes lieux, tes favoris et une copie des horaires déjà consultés sont enregistrés dans le stockage de l’appli Even Realities, sur ton téléphone. Rien n’est envoyé ailleurs.

## Serveurs contactés

<!-- quai:domaines:debut -->
- Horaires (fichiers statiques) : adresse GitHub Pages, remplie par `npm run configure`
- Temps réel (relais personnel) : adresse Vercel, remplie par `npm run configure`
<!-- quai:domaines:fin -->

## Sources

Données : SNCB, STIB, De Lijn, TEC via Belgian Mobility Company, licence CC BY 4.0. Usage personnel et non commercial.
