# Quai : cahier des charges technique (v1.0)

Quai est une appli personnelle pour les lunettes Even Realities G2 : horaires en temps réel des transports en commun belges (SNCB, STIB, De Lijn, TEC), arrêts autour de soi, favoris, recherche de trajets. Coût d'exploitation visé : 0 €. Données : uniquement les données ouvertes officielles des opérateurs.

Les maquettes validées par l'utilisateur (textes, écrans, gestes) sont dans `/home/claude/quai/project/*.dc.html` (HTML lisible) :
- `Visite1.dc.html`, `Visite2.dc.html`, `Visite3.dc.html` : écrans des lunettes, étape par étape ;
- `Config1.dc.html` à `Config6.dc.html` : réglages sur le téléphone ;
- `Donnees.dc.html` : architecture expliquée à l'utilisateur.
Toute l'interface est en français. Ne jamais utiliser de tiret cadratin (—) dans les textes visibles.

Les contrats de données sont dans `shared/types.ts` (source de vérité). Chaque paquet l'importe en relatif.

## 1. Architecture

```
Portail BMC (officiel, clé gratuite)  ──nuit──►  pipeline/ (GitHub Actions)  ──►  GitHub Pages  (DATA_BASE : fichiers JSON statiques)
            │                                                                             │
            └──────────── temps réel ───►  relay/ (Vercel, gratuit) = RELAY_BASE           │
                                               │                                          │
                                   app/ (Even Hub : WebView dans l'appli Even Realities) ◄┘
                                               │  SDK @evenrealities/even_hub_sdk 0.0.16
                                          Lunettes G2 (576×288, vert monochrome)
```

Dossiers (un propriétaire par dossier, ne pas écrire dans le dossier d'un autre) :
- `shared/` : `types.ts` (contrats de données) et `names.ts` (mise en forme des noms, recherche). Lecture seule pour les équipes ; signaler tout besoin de changement dans le rapport final.
- `pipeline/` + `fixtures/pipeline/` + `.github/workflows/nightly.yml` : équipe **données**.
- `relay/` + `fixtures/relay/` : équipe **relais**.
- `app/src/core/` (sauf `api.ts` et `util.ts`, fournis et figés) : équipe **cœur** (logique de l'appli, sans interface).
- `app/` hors `src/core/` + `.github/workflows/build-app.yml` : équipe **interface** (lunettes, téléphone, SDK, build, paquet .ehpk).
- `tests/e2e/`, `.github/workflows/ci.yml`, `README.md` racine : équipe **contrôle qualité** (intervient après les quatre autres).
- `fixtures/network.json`, `fixtures/README.md`, `fixtures/app/preset.json` : jeu de test commun, en lecture seule (voir `fixtures/README.md`).

Outils : Node 22, TypeScript strict, Vitest pour les tests. Chaque paquet a son `package.json` avec `npm test` et `npm run build`. Pas de dépendance lourde inutile. Aucune clé ni secret dans le code : variables d'environnement uniquement.

## 2. Sources officielles (portail Belgian Mobility Company, Azure API Management)

- Base : `BMC_BASE = https://api-management-opendata-production.azure-api.net`
- En-têtes d'authentification (envoyer les deux) : `bmc-partner-key: <clé>` et `Ocp-Apim-Subscription-Key: <clé>`. Clé gratuite : compte sur https://api-management-opendata-production.developer.azure-api.net/ , abonnement au produit « Standard ».
- GTFS statiques (zip) : `${BMC_BASE}/api/gtfs/feed/{slug}/static` avec slug `nmbssncb`, `stibmivb`, `delijn`, `tec`. Repli De Lijn : `https://opendata-discovery-gtfs-static.api.production.belgianmobility.io/api/gtfs/feed/delijn/static`. Repli TEC sans clé : `https://opendata.tec-wl.be/Current%20GTFS/TEC-GTFS.zip`.
- GTFS-RT (protobuf) : `${BMC_BASE}/api/gtfs/feed/{slug}/rt/trip-update?format=protobuf` et `.../rt/alert?format=protobuf` pour `nmbssncb`, `delijn`, `tec`.
- SNCB, flux direct optionnel (plus complet que la copie BMC, qui ne reprend qu'une partie des trains) : URL fournie par la SNCB après demande, variable `SNCB_RT_URL`. Si elle est définie, le relais l'utilise pour la SNCB.
- STIB temps réel (pas de GTFS-RT) : `${BMC_BASE}/api/datasets/stibmivb/rt/WaitingTimes` (paramètres `where`, `limit`, `offset` ; ex. `where=pointid="5153" or pointid="5154"`). Lignes renvoyées : `{ pointid, lineid, passingtimes }` où `passingtimes` est un tableau (parfois une chaîne JSON à décoder) de `{ destination: { fr, nl }, expectedArrivalTime, lineId, message? }`. Les `pointid` temps réel sont numériques nus ; les identifiants statiques peuvent porter un suffixe lettre (`5153F`) : normaliser en retirant les lettres finales.
- Les identifiants du portail peuvent être préfixés (`gt:tec:123`, `gs:nmbssncb:8812005`) : toujours passer par `normalizeId()` de `shared/types.ts`.
- Licence des données : CC BY 4.0. Afficher « Données : SNCB, STIB, De Lijn, TEC via Belgian Mobility Company » dans l'écran Données.

Notre environnement de développement n'a pas accès à ces serveurs : tout se teste avec des fixtures réalistes. Le code doit être robuste aux écarts de format (champs absents, chaînes JSON imbriquées, identifiants préfixés, heures GTFS > 24:00).

## 3. Pipeline de nuit (`pipeline/`)

Commande : `npm run build-data -- --out <dossier>` (variables : `BMC_KEY`, optionnelles `BMC_BASE`, `QUAI_DATE` pour forcer la date, `QUAI_SOURCES` pour lire des zips locaux en test, ex. `sncb=fixtures/x.zip,stib=...`).
Produit exactement les fichiers de `shared/types.ts` : `meta.json`, `tiles/`, `areas/{op}/`, `search/`, `trains/{date}.json`, pour 2 dates de service (aujourd'hui et demain, fuseau Europe/Brussels, calendar + calendar_dates).
Règles :
- Lecture des zips en flux (De Lijn est gros : plusieurs centaines de Mo décompressés) ; ne garder en mémoire que les voyages des 2 dates.
- Zones d'arrêt : `parent_station` si présent, sinon regroupement même nom (insensible casse/accents, après retrait des suffixes « perron N », « quai X », « Quai X » qui deviennent le quai) à moins de 300 m, par opérateur. Les gares SNCB : zone = gare (parent), y compris l'arrêt « gare » sans quai.
- Identifiant de zone : `${op}:${areaKey}` ; areaKey = parent_station (SNCB : sans le « S » initial), sinon le plus petit stop_id du groupe (comparaison de chaînes). Position de la zone = parent si présent, sinon moyenne des arrêts.
- Noms (`shared/names.ts`) : d'abord `translations.txt` (formats récent `field_value` et `record_id`, et ancien format), langues fr et nl ; sinon `prettyName()` pour les noms tout en majuscules (STIB) ; pour De Lijn : `nl` = nom d'origine, `fr` = `frName(nl)`, `l = 'nl'` ; TEC : `fr` = `nl` = nom d'origine ; SNCB : `l = 'nl'` quand le stop_name d'origine est égal à la traduction nl. Destinations (trip_headsign) : même logique (une destination SNCB égale au nom d'une gare reprend les noms de cette gare).
- Mode : route_type GTFS (0 tram, 1 métro, 2 train, 3 bus, et types étendus 100-117 train, 400-405 métro, 700-716 bus, 900-906 tram).
- Quai SNCB : `platform_code` du stop, sinon suffixe après `_` dans le stop_id si numérique.
- `rt` d'un arrêt : STIB = pointid numérique nu ; autres = stop_id normalisé.
- STIB : pas de temps réel par voyage, donc `trip_id` vide (`""`) dans `deps` pour gagner de la place ; `stops[].rt` = pointid numérique.
- Recherche : voir `SearchFile` dans `shared/types.ts` et `searchWords()`/`searchKey()` de `shared/names.ts`.
- Chaque échec d'une source n'empêche pas les autres : `meta.feeds[op].ok=false` + message. Si toutes échouent : code de sortie non nul (le site publié la veille reste en ligne).
- Taille : fichiers JSON compacts (pas d'indentation). Viser < 400 Mo au total (limite GitHub Pages : 1 Go). Rapport de taille en fin d'exécution.
- Outil de test : `npm run serve-data -- --dir <dossier> --port 8787` sert les fichiers produits avec `Access-Control-Allow-Origin: *`.
- Workflow `.github/workflows/nightly.yml` : chaque nuit vers 02:15 (heure belge) + déclenchement manuel ; Node 22 ; secret `BMC_KEY` ; publie `site/` (contenant `data/` et un `index.html` minimal) sur GitHub Pages via `actions/upload-pages-artifact` et `actions/deploy-pages`.

## 4. Relais temps réel (`relay/`, Vercel, runtime Node)

Endpoints exactement selon `shared/types.ts` : `GET /api/rt`, `GET /api/stib`, `GET /api/alerts`, `GET /api/health`.
- Variables : `BMC_KEY` (obligatoire), `BMC_BASE` (défaut ci-dessus), `SNCB_RT_URL` (optionnelle), `DATA_BASE` (pour lire `meta.json` dans /api/health).
- Décodage GTFS-RT avec `gtfs-realtime-bindings`. Cache mémoire par flux : 25 s. En-têtes : `Access-Control-Allow-Origin: *`, `Cache-Control: public, s-maxage=20, stale-while-revalidate=40`. Réponse aux requêtes OPTIONS.
- `/api/rt` : filtre par `trips` (max 60) ; renvoie toutes les mises à jour d'arrêt de ces voyages (l'appli propage les retards). Voyage annulé : `cancelled: true`. Identifiants normalisés.
- Erreur d'une source : HTTP 200 avec `error` renseigné et données vides (l'appli bascule sur l'horaire prévu, signalé par « ~ »). Paramètres invalides : 400.
- Jamais de clé dans une réponse ou un log.
- `vercel.json` minimal ; `README` du dossier avec les variables.
- Déploiement Vercel avec « Root Directory » = `relay` : le dossier doit se suffire à lui-même. Ce qui vient de `shared/` est recopié dans `relay/lib/shared/` par `npm run sync-shared`, et un test vérifie que la copie est identique.
- Outils de test : `npm run mock-bmc` (port 8789) = faux portail BMC qui sert les fixtures générées depuis `fixtures/network.json`, avec scènes `base` et `noRT` (`POST /__scene/noRT` : toutes les réponses en erreur 503) ; `npm run dev` (port 8788) = les quatre endpoints sur un serveur Node local, lisant `BMC_BASE` (défaut pour le dev : http://localhost:8789).

## 5. Appli Even Hub (`app/`)

Vite + TypeScript, SDK `@evenrealities/even_hub_sdk@0.0.16`, CLI `@evenrealities/evenhub-cli` pour `evenhub pack`. Références SDK et design (à lire avant de coder) : `/home/claude/research/even-realities_everything-evenhub/repo/plugins/everything-evenhub/skills/*/SKILL.md` (sdk-reference, glasses-ui, handle-input, device-features, background-state, design-guidelines, build-and-deploy, font-measurement) et les gabarits `/home/claude/research/even-realities_evenhub-templates/repo/`. Les types du SDK dans `node_modules` font foi.

Configuration de build : `QUAI_DATA_BASE`, `QUAI_RELAY_BASE` → écrits dans la config de l'appli ET dans la liste blanche réseau de `app.json` (script `npm run configure`). `app.json` : `package_id` `com.quai.transports`, nom « Quai », permissions `network` (les 2 origines) et `location`, langue `fr`.

### 5.1 Lunettes (canevas 576×288)
Contraintes : une seule police, proportionnelle (pas à chasse fixe : pour aligner des colonnes, mesurer les largeurs avec le skill font-measurement ou utiliser un conteneur par colonne), impossible à changer ; pas de gras ni de tailles ; max 12 conteneurs dont 8 non image ; un seul conteneur `isEventCapture: 1` ; listes max 20 éléments de 64 caractères ; texte max 1000 caractères à la création ; ~9 lignes de ~48 caractères. Utiliser `textContainerUpgrade` pour les mises à jour sans clignotement. Luminosité `textColor` 0..4 (titre 4, contenu 3-4, aides 2).

Écrans (textes et logique : voir les maquettes) :
1. **Accueil** : titre « Quai » + heure ; ligne de suggestion éventuelle (« Pour le bureau : IC 07:42, voie 4 » / « partir à 07:33, 7 min à pied ») ; « Autour de moi » (n arrêts), « Mes favoris » (n), « Aller à… » ; aides « ▲▼ choisir   toucher : ouvrir ».
2. **Autour de moi** : arrêts dans le rayon réglé (300/500/800 m), toutes compagnies, triés par distance, une ligne chacun : « Gare du Nord, tram   80 m   T3 2 min ». Ligne « ~ horaire prévu, sans temps réel » si un « ~ » est affiché.
3. **Arrêt** : prochains départs (nombre réglé) : ligne, destination, minutes (bus/tram/métro) ou heure + voie (train) ; « ~ » devant un horaire sans temps réel ; « SUPPRIMÉ » ; toucher = ajouter/retirer des favoris.
4. **Mes favoris** : arrêts et trajets, avec le prochain départ en bout de ligne.
5. **Trajet A ▶ B** : prochains trains (direct ou 1 correspondance) : « 14:10  voie 4, arrivée 14:39   à l'heure » ; toucher = détail du train (arrêts, prochain arrêt, descente).
6. **Aller à…** : lieux enregistrés (Maison, Bureau…) ; calcul depuis la position : marche + train(s) + marche, et lignes directes bus/tram/métro via `patterns.next` ; 3 propositions ; toucher = étapes.
7. **Étapes** : heure de chaque étape, y compris « Partir à pied » ; mise à jour en direct ; alerte en tête « ! Voie modifiée : l'IC part de la voie 6 » ; retards recalculés.
Gestes : glisser haut/bas = se déplacer dans la liste ; toucher = ouvrir ; double toucher = retour, et depuis l'Accueil = quitter avec la boîte de confirmation système (`shutDownPageContainer(1)`).
Rafraîchissement : temps réel toutes les 30 s tant qu'un écran de départs est affiché ; position toutes les 30 s.
Suggestion à l'ouverture : favori réglé « Quand je suis à moins de 300 m » et proche → ouverture directe ; sinon favori/lieu correspondant au moment (matin 5h-11h, soir 15h-21h) → ligne de suggestion ; sinon pas de suggestion.

### 5.2 Téléphone (page web de l'appli dans l'onglet Even Hub)
Écrans des maquettes Config1-6 : premier lancement (position, langue des noms), mes lieux (adresse saisie ou position actuelle, marche maximale), favoris (arrêt avec lignes/directions, ou trajet A→B ; « Le proposer à l'ouverture »), affichage, alertes, données (état `/api/health`). Plus « Rechercher un trajet » (maquette Visite3) avec « Afficher dans les lunettes ». Réglages enregistrés via le stockage local du SDK (repli `localStorage`). Interface sobre, accessible, cibles tactiles ≥ 44 px.

### 5.3 Mode test
Paramètres d'URL (actifs seulement avec `?e2e=1`) : `mockLat`, `mockLon`, `mockNow` (ISO ; l'horloge démarre à cet instant puis avance normalement), `data`, `relay` (remplacent les bases configurées), `preset` (URL d'un fichier de réglages à charger, ex. `fixtures/app/preset.json` servi en local), `reset=1` (efface les réglages enregistrés). Avec `e2e=1`, après chaque rendu des lunettes : `console.log('QUAI_SCREEN ' + JSON.stringify({ screen, title, lines }))` où `screen` ∈ `home`, `nearby`, `board`, `favorites`, `trip` (trains A ▶ B), `places` (Aller à…), `journeys` (propositions), `steps`, `train` (dans le train), `arrival`, `message` (attente, erreur, liste vide) ; `lines` = textes affichés, dans l'ordre.

### 5.4 Découpage cœur / interface
- `app/src/core/api.ts` : contrat figé (types `Settings`, `Departure`, `Board`, `Journey`, `Suggestion`, interface `Core`). `app/src/core/util.ts` : utilitaires figés (heures belges, distances, marche, libellés). Fournis, ne pas modifier ; un besoin de changement se signale dans le rapport.
- Équipe cœur : `createCore(opts: CoreOptions): Core` exporté par `app/src/core/index.ts`, plus tout module interne utile (chargement et cache des fichiers, fusion du temps réel, trains direct et une correspondance par balayage des connexions (CSA) sur `trains/{date}.json`, trajets porte à porte, suggestion, alertes). Aucune dépendance au SDK Even ni au DOM.
- Équipe interface : tout le reste de `app/` ; n'utilise la logique que via `Core` et `util.ts`. Pendant le développement, un faux cœur (`app/src/dev/fake-core.ts`) permet d'avancer ; l'appli finale utilise `createCore`.
- Trajets porte à porte (`plan`), portée v1.0 : (1) lignes directes (tous réseaux) entre les zones à distance de marche du départ et de l'arrivée (`patterns.next`) ; (2) trains direct ou une correspondance entre gares à distance de marche (marche ≤ `maxWalkMin`), avec marche au début et à la fin ; (3) au mieux, une ligne urbaine directe pour rejoindre la gare de départ ou pour finir après la gare d'arrivée quand la marche dépasse `maxWalkMin`. Correspondance train-train : 4 min minimum dans la même gare.
- Marche : `walkMinutes(distanceM)` de `util.ts` (distance × 1,3 à 80 m/min). Heure de départ conseillée = départ du premier véhicule - marche - `leaveBeforeMin`.
- Règle du temps réel affiché : un départ est « temps réel » si son voyage figure dans le flux de l'opérateur (STIB : si le pointid et la ligne-direction figurent dans WaitingTimes) ; sinon horaire prévu, signalé par « ~ » si `markPlanned`. Source en erreur : tout en horaire prévu, « ~ ».
- Distances affichées arrondies à 10 m.

### 5.5 Ports de développement (intégration)
Appli (Vite) 5173 ; données de test 8787 (`pipeline`, `npm run serve-data`) ; relais local 8788 (`relay`, `npm run dev`) ; faux portail BMC 8789 (`relay`, `npm run mock-bmc`) ; API d'automatisation du simulateur 9898. Simulateur : `/home/claude/tools/node_modules/@evenrealities/sim-linux-x64/bin/evenhub-simulator` (dépendances système déjà installées ; lancer avec `xvfb-run -a`). Réseau : seuls les registres npm et GitHub sont joignables depuis cet environnement.

## 6. Qualité attendue
- Tests unitaires pour toute logique pure (analyse GTFS, normalisation, regroupement, temps réel, propagation des retards, recherche de trajets, mise en forme des lignes ≤ 48 caractères, machine d'états des gestes).
- Fixtures : le mini-réseau commun `fixtures/network.json` (voir `fixtures/README.md`, qui donne aussi les résultats attendus des trois scénarios). Chaque équipe peut ajouter ses propres cas limites dans son sous-dossier de `fixtures/`.
- `npm test` et `npm run build` passent sans erreur dans chaque paquet ; `npx tsc --noEmit` propre.
- Rapport final de chaque équipe : ce qui est fait, comment tester, limites connues, écarts avec ce cahier.
