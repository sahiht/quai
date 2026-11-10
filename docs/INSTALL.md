# Installer Quai sur tes lunettes Even G2

Durée : environ 45 minutes, une seule fois. Coût : 0 €.
Il te faut : ton téléphone avec l'appli Even Realities, tes G2, et pour l'étape 2 soit un ordinateur, soit Claude.

Tu vas ouvrir quatre comptes gratuits, à ton nom :

| Compte | Sert à |
|---|---|
| Belgian Mobility Company (BMC) | la clé d'accès aux données officielles SNCB, STIB, De Lijn, TEC |
| GitHub | garder le code, préparer les horaires chaque nuit, les héberger |
| Vercel | le relais temps réel (retards, voies, temps d'attente) |
| Even Hub | déposer l'appli et l'installer sur tes lunettes |

Ta clé BMC reste secrète : elle est enregistrée chez GitHub et Vercel, jamais dans l'appli.

Dans ce guide, `ton-nom` est ton nom d'utilisateur GitHub, écrit en minuscules.

Pas encore de lunettes ? Après les étapes 1 à 4 et le point 1 de l'étape 5, Quai fonctionne déjà dans le navigateur du téléphone : voir « Utiliser Quai sans les lunettes : Quai Web », plus bas.

## Étape 1 : la clé des données officielles (10 min)

1. Ouvre https://api-management-opendata-production.developer.azure-api.net et choisis « Sign up ». Confirme ton adresse e-mail.
2. Connecte-toi, ouvre « Products », choisis « Standard » puis « Subscribe » (donne un nom, par exemple « quai »).
3. Ouvre ton profil (« Profile »), section abonnements : affiche la « Primary key » et copie-la. C'est ta clé BMC.

## Étape 2 : mettre le code sur GitHub (10 min)

Crée d'abord un compte sur https://github.com (gratuit).

Option A, depuis le téléphone, la plus simple :
1. Sur GitHub, crée un dépôt vide : bouton « New repository », nom `quai`, visibilité « Public » (obligatoire pour l'hébergement gratuit des horaires), sans README.
2. Dans Claude, ouvre les réglages, « Connecteurs », et connecte GitHub.
3. Écris à Claude : « pousse Quai dans ton-nom/quai ». Claude y dépose le code.

Option B, avec un ordinateur :
1. Télécharge `quai.zip` et décompresse-le. Le dossier doit s'appeler `quai`.
2. Installe GitHub Desktop et connecte-toi. Menu « File », « Add local repository… », choisis le dossier `quai`. Si GitHub Desktop propose « create a repository », accepte.
3. En bas à gauche, écris « Première version » dans « Summary », puis clique sur « Commit to main ».
4. Clique sur « Publish repository », décoche « Keep this code private », puis « Publish repository ».

Juste après, GitHub vérifie le code tout seul (workflow « Intégration continue », onglet « Actions ») : une coche verte apparaît après quelques minutes.

## Étape 3 : la préparation de nuit des horaires (5 min, puis 10 min d'attente)

Dans ton dépôt `quai` sur GitHub :
1. « Settings », « Secrets and variables », « Actions », bouton « New repository secret ». Nom : `BMC_KEY`. Valeur : ta clé BMC. Puis « Add secret ».
2. « Settings », « Pages », rubrique « Build and deployment », « Source » : choisis « GitHub Actions ».
3. Onglet « Actions », choisis le workflow « Données de nuit » dans la liste de gauche, bouton « Run workflow », puis le bouton vert « Run workflow ».
4. Après une dizaine de minutes, ouvre `https://ton-nom.github.io/quai/` : la page d'état indique la date de mise à jour et doit dire « Tous les réseaux sont à jour ».

Ensuite, tout se refait seul chaque nuit vers 2 h (3 h en été).

## Étape 4 : le relais temps réel (5 min)

1. Ouvre https://vercel.com, « Sign Up », plan « Hobby », « Continue with GitHub ».
2. « Add New… », « Project », puis « Import » à côté du dépôt `quai`. Si le dépôt n'apparaît pas, autorise Vercel à le voir (« Adjust GitHub App Permissions »).
3. « Project Name » : `quai-relais` (c'est le début de l'adresse du relais ; si le nom est pris, choisis-en un autre).
4. « Root Directory » : « Edit », choisis `relay`, puis « Continue ». Laisse « Framework Preset » sur « Other ».
5. « Environment Variables » : ajoute `BMC_KEY` (ta clé), puis `DATA_BASE` avec la valeur `https://ton-nom.github.io/quai/data`.
6. « Deploy ». Une minute plus tard, ouvre le projet : sous « Domains », note l'adresse courte, par exemple `https://quai-relais.vercel.app`. N'utilise pas l'adresse longue avec des lettres et des chiffres au hasard : Vercel la protège et l'appli ne pourrait pas s'en servir.
7. Vérifie en ouvrant `https://quai-relais.vercel.app/api/health` : la page doit commencer par `{"ok":true`. Si tu lis `{"ok":false`, attends la fin de l'étape 3, puis recharge la page.

## Étape 5 : fabriquer l'appli (5 min)

1. Dans ton dépôt GitHub : « Settings », « Secrets and variables », « Actions », onglet « Variables », « New repository variable ». Nom : `QUAI_RELAY_BASE`. Valeur : l'adresse Vercel de l'étape 4, sans `/` à la fin. Puis « Add variable ».
2. Onglet « Actions », workflow « Paquet de l'appli », « Run workflow », puis le bouton vert « Run workflow ».
3. Quand il est vert (environ 3 minutes), ouvre « Releases » (page d'accueil du dépôt, colonne de droite), puis la plus récente (par exemple « Quai v1.0.1 »). Télécharge `quai.ehpk` et `icon.png` sur ton téléphone.

## Étape 6 : installer Quai sur tes lunettes (10 min)

1. Va sur https://hub.evenrealities.com/login et connecte-toi avec le même e-mail et le même mot de passe que dans l'appli Even Realities (le compte se crée dans l'appli, pas sur le site).
2. Crée l'appli : nom « Quai », accroche « Trains, trams et bus belges en temps réel », icône `icon.png`. Puis onglet « Builds » : dépose `quai.ehpk`. Le paquet apparaît dans « Private builds » avec une étiquette grise « Private ».
3. Onglet « Testing group », « Add user » : ton propre e-mail, « Send invite ». Ouvre l'e-mail reçu et accepte : ton statut doit passer à « Active ».
4. Onglet « Builds » : touche l'étiquette grise « Private », choisis « Beta », confirme « Promote to Beta ».
5. Sur le téléphone : appli Even Realities, « Me », « Beta tester », « Install ». Quai apparaît dans le menu des lunettes.
6. Ouvre Quai une première fois sur le téléphone : autorise la position, choisis la langue des noms, ajoute tes lieux et tes favoris.

## Utiliser Quai sans les lunettes : Quai Web

Quai Web, c'est la même appli dans le navigateur : l'écran des lunettes reproduit sur le téléphone, avec les mêmes horaires, le même temps réel et les mêmes écrans que sur les G2. Adresse : `https://ton-nom.github.io/quai/app/` (lien « Ouvrir Quai Web » sur la page d'état `https://ton-nom.github.io/quai/`).

Le workflow « Données de nuit » la publie chaque nuit et après chaque changement de l'appli, dès que la variable `QUAI_RELAY_BASE` existe (étape 5, point 1). La première fois, lance-le à la main : onglet « Actions », « Données de nuit », « Run workflow ». Sans cette variable, l'adresse affiche une page d'explication ; les horaires sont publiés quand même.

L'ajouter à l'écran d'accueil (elle s'ouvre alors en plein écran, comme une appli) :
- iPhone : ouvre l'adresse dans Safari, bouton « Partager », « Sur l'écran d'accueil », puis « Ajouter ».
- Android : ouvre l'adresse dans Chrome, menu « ⋮ », « Ajouter à l'écran d'accueil » (ou « Installer l'appli »), puis « Installer ».

Premier lancement : l'onglet « Réglages » s'ouvre. Accepte la demande de position du navigateur, choisis la langue des noms, puis ajoute tes lieux et tes favoris comme sur le téléphone. Si la position est refusée ou imprécise, choisis un arrêt ou une gare dans la rubrique « Position », sous l'écran des lunettes : Quai fait comme si tu y étais.

Les gestes, dans l'onglet « Lunettes » :
- les boutons sous l'écran : « ▲ », « ▼ », « Toucher », « Double toucher » ;
- sur l'écran : glisser vers le haut ou le bas, toucher une ou deux fois ;
- au clavier d'un ordinateur : flèches haut et bas, Entrée pour toucher, Échap ou Retour arrière pour double toucher (la molette fait défiler).

« Rechercher un trajet », puis « Afficher dans les lunettes », montre le résultat dans l'onglet « Lunettes ». Sur un grand écran, les deux onglets sont côte à côte.

Limites :
- la page doit rester ouverte et l'écran allumé : Quai garde l'écran allumé tant que l'onglet « Lunettes » est affiché, si le navigateur le permet ; page cachée ou téléphone verrouillé, le temps réel s'arrête et reprend au retour ;
- pas d'usage mains libres : il faut regarder et toucher le téléphone ;
- les réglages sont gardés dans ce navigateur, séparés de ceux de l'appli des lunettes (une navigation privée les oublie) ;
- sur le web, rien à quitter : double toucher sur l'accueil rappelle de fermer simplement l'onglet.

## Mettre à jour Quai

Chaque mise à jour a besoin d'un nouveau numéro de version : Even Hub refuse un numéro déjà déposé. Tout se fait sur le site GitHub, depuis le téléphone.

1. Ajoute les notes de la version : dossier `app/store/changelog`, « Add file », « Create new file ». Nom : le nouveau numéro suivi de `.txt`, par exemple `1.0.1.txt`. Écris 1 à 3 lignes courtes sur ce qui change pour toi, puis « Commit changes ».
2. Ouvre `app/app.json`, touche le crayon, remplace `"version": "1.0.0"` par `"version": "1.0.1"`, puis « Commit changes ».
3. Le workflow « Paquet de l'appli » démarre tout seul. Quand il est vert, ouvre la release « Quai v1.0.1 » et télécharge le nouveau `quai.ehpk`.
4. Sur Even Hub, onglet « Builds » : dépose ce paquet, touche son étiquette « Private », choisis « Beta », confirme « Promote to Beta ».
5. Sur le téléphone : « Me », « Beta tester », « Install ».

Ne te rajoute pas dans « Testing group » : ton accès reste actif d'une version à l'autre.

## Publier Quai pour tout le monde (facultatif)

C'est possible depuis le portail Even Hub. La fiche doit être complète : informations sur le développeur, captures d'écran du simulateur (dans `app/test/screens/`, fichiers `glasses-…`), permissions, icône. Pour la politique de confidentialité, ouvre `app/store/privacy.md` sur GitHub et remplace les deux lignes « remplie par `npm run configure` » par tes deux adresses (GitHub Pages et Vercel). Ensuite, sur le paquet : étiquette « Private », « Public », « Submit this build for review? », « Confirm ». Un relecteur d'Even teste l'appli, téléphone verrouillé compris.

À savoir avant : tous les utilisateurs passeraient par ta clé BMC et ton relais Vercel. L'offre Hobby de Vercel est réservée à un usage personnel et non commercial, et les quotas du portail BMC sont partagés. Pour un vrai lancement public, il faut une clé dédiée et un hébergement adapté.

## En cas de souci

| Ce que tu vois | Que faire |
|---|---|
| « Données de nuit » en rouge, à l'étape « Vérifier le secret BMC_KEY » | Le secret manque : refais l'étape 3, point 1, puis relance le workflow. |
| « Données de nuit » en rouge, à l'étape « Configurer GitHub Pages » | « Settings », « Pages », « Source » : « GitHub Actions » (étape 3, point 2), puis relance le workflow. |
| « Paquet de l'appli » en rouge, avec « Variable QUAI_RELAY_BASE manquante » | Refais l'étape 5, point 1, puis relance le workflow. |
| « Paquet de l'appli » en rouge, avec « ne doit pas se terminer par « / » » | Retire le `/` final de la variable `QUAI_RELAY_BASE`, puis relance le workflow. |
| `/api/health` affiche une page de connexion Vercel | Tu utilises l'adresse longue : prends celle de « Domains » (étape 4, point 6). |
| Des « ~ » partout dans les lunettes | Le temps réel ne répond pas : ouvre `/api/health` sur ton relais et vérifie `BMC_KEY` dans Vercel (« Settings », « Environment Variables »). Après une modification, redéploie (ligne suivante). |
| Redéployer le relais après un changement de variable | Vercel, onglet « Deployments », « … » sur le premier de la liste, « Redeploy ». Décoche « Use project's Ignore Build Step », puis « Redeploy ». |
| « Horaires périmés » | La préparation de nuit est arrêtée : GitHub, « Actions », workflow « Données de nuit », « Enable workflow » si proposé, puis « Run workflow ». |
| « horaires du 12/11 » à côté d'un réseau (écran Données, page d'état) | Le portail n'a pas fourni ce réseau cette nuit : Quai reprend ses horaires gardés (7 jours au plus). Rien à faire si cela ne dure pas ; sinon, vérifie la clé `BMC_KEY` et le journal de « Données de nuit ». |
| « test version expired » sur le téléphone | Le paquet n'est pas en « Beta » ou ton invitation n'est pas « Active ». |
| Quai Web affiche « Quai Web n'est pas disponible pour l'instant » | La variable `QUAI_RELAY_BASE` manque (étape 5, point 1) ou la construction a échoué (journal de « Données de nuit ») ; corrige, puis relance « Données de nuit ». |
| Quai Web : « Position refusée par le navigateur » | Autorise la position dans les réglages du site (cadenas à côté de l'adresse ; sur iPhone : Réglages, Safari, Position), ou choisis un arrêt dans la rubrique « Position ». |
| Even Hub refuse le paquet : la version existe déjà | Suis « Mettre à jour Quai » : chaque paquet déposé doit avoir un nouveau numéro. |
| L'adresse du relais a changé | Mets à jour la variable `QUAI_RELAY_BASE`, puis suis « Mettre à jour Quai » : l'appli n'accepte que l'adresse inscrite dans le paquet. |
| Peu de trains SNCB en temps réel | La copie du portail BMC ne reprend qu'une partie des trains. Demande à la SNCB l'accès à son flux temps réel direct (page « Données publiques » de belgiantrain.be), ajoute son adresse dans Vercel sous `SNCB_RT_URL`, puis redéploie. |
