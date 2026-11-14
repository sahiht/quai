# Quai : tests de bout en bout (contrôle qualité, comportement à l’exécution)

Ce dossier vérifie l’ensemble en conditions réelles, sans maquette du code testé : le pipeline prépare les
données depuis les zips GTFS de `fixtures/pipeline/gtfs/`, `serve-data` les sert, le relais (`npm run dev`)
interroge le faux portail BMC (`npm run mock-bmc`, clé imposée) et, pour les adresses (1.1), le faux service
d’adresses des trois Régions (`npm run mock-geocode`, branché par `QUAI_GEO_BASE`), et le vrai cœur (`createCore`)
ou l’appli construite (`vite build`) dans le simulateur Even Hub les consomme. L’oracle est `fixtures/README.md`
(section « Extension 1.1 » comprise), avec les critères d’acceptation du PRD 1.1 (§ 5) et `docs/v1.1/DECISIONS.md` § 7.

Chaque suite lance elle-même ses serveurs (vraies commandes `npm run …`) sur des ports éphémères et les arrête.

## Prérequis

- Node 22.18 ou plus récent ; `npm ci` dans `pipeline/`, `relay/` et `app/` (les suites utilisent leurs commandes).
- Pour le simulateur seulement : `xvfb-run` et le binaire
  `/home/claude/tools/node_modules/@evenrealities/sim-linux-x64/bin/evenhub-simulator`
  (autre emplacement : variable `EVENHUB_SIMULATOR`), et Chrome pour les écrans du téléphone (`/usr/bin/google-chrome`,
  sinon variable `CHROME_BIN`).

## Tout relancer

```sh
# 1. Paquets : installation propre, tests, types, construction
(cd pipeline && npm ci && npm test && npm run build)
(cd relay && npm ci && npm test && npm run build && npm run vercel-build)
(cd app && npm ci && npm test && npm run typecheck && npm run build)

# 2. Bout en bout sans interface (environ 1 min 15, dont 50 s d’attentes réelles de nouvelles tentatives et de délais)
cd tests/e2e
npm ci
npm test              # data, core, robustness, download, routing, geocode (155 tests ; real-data sautée sans QUAI_REAL_DATA)
npm run typecheck

# 3. Simulateur, téléphone et Quai Web (environ 16 min ; port d’automatisation 9931)
npm run sim                       # tous les scénarios
npm run sim -- --only s1,waterloo # scénarios choisis (s129 s128 s126 s1 s1noRT s1run s1stay s1open s2 s3 s3run waterloo holiday news firstrun errors stale late phone keep web reopen tour)
npm run sim -- --deliver <dossier> --tour   # captures pour le propriétaire (manifest.json) ; images de app/test/screens/
```

Suites partielles : `npm run test:data` (données et téléchargement), `npm run test:core` (cœur, robustesse, trajets
et adresses). Données réelles, à la demande : `QUAI_REAL_DATA=/home/claude/real-data-11/data npm run test:real`
(instantané 1.1 couvrant le 11/11 et le 12/11/2026).
Valider un dossier de données quelconque (par exemple la sortie du flux de nuit) :
`npx tsx validate-data.ts <dossier>` (code de sortie 1 en cas d’erreur ; `--json` pour un rapport complet).

`QUAI_SKIP_SIM=1` : `npm run sim` ne fait rien (intégration continue sans affichage). Aucun test de
`npm test` n’utilise le simulateur.

## Contenu

| Fichier | Ce qui est vérifié |
| --- | --- |
| `validate-data.ts` | Validateur des fichiers produits contre `shared/types.ts` : types, bornes, tris (départs par jour puis minutes), références (zones des tuiles et de `patterns.next`, index de motif et d’arrêt des départs, gares des trains), clés de recherche cohérentes avec `searchWords()`/`searchKey()`, noms non vides et remis en casse, identifiants normalisés, JSON compact, départs SNCB identiques à `trains/`, `cachedFrom` (date valide, réseau en ordre, 7 jours au plus). |
| `data.test.ts` | `build-data` sur les zips de fixtures, validateur sans erreur, identifiants attendus, jour férié et après minuit dans les données, et 14 corruptions volontaires que le validateur doit détecter. |
| `download.test.ts` | Téléchargement réel depuis le faux portail via un mandataire qui enregistre les en-têtes et injecte des pannes : deux en-têtes de clé, 503 puis succès, redirection vers une autre origine (clé non transmise), contenu non zip, 503 permanent puis repli, clé refusée (pas de nouvel essai), codes de sortie 0, 1, 2, aucune trace de la clé dans les journaux ni les fichiers ; `--cache-dir` : GTFS gardés après une nuit normale, repris (`cachedFrom`) la nuit où le portail refuse tout, refusés au-delà de 7 jours. |
| `core.test.ts` | Vrai cœur + vraies données + vrai relais : scénarios 1, 2, 3, correspondance, jour férié, après minuit, en scène `base` et `noRT` ; horaires périmés ; recherche « Gand » ; `linesAt` ; corrections du cœur (« IC 12:22 » une seule fois, une proposition par trajet, marche seule ou aucun trajet sur place, jamais plus lent que la marche). Typographie 1.1 de tous les textes contrôlés : espace insécable devant « : ; ! ? » et avant une unité, jamais de tiret long ni demi-cadratin. |
| `robustness.test.ts` | Pannes à chaque frontière : portail (500, délai, protobuf ou JSON invalide, coupure, 401, 429, redirection), relais (500, JSON invalide, formes inattendues, arrêté ; relais muet : horaire prévu en 1,5 s, puis panne dite au délai de 8 s), données (meta illisible ou absente : « Données indisponibles » ; serveur en erreur, coupé ou arrêté : « Horaires injoignables », M8.6 ; zone en JSON invalide ou absente, tuiles vides ou malformées, trains et recherche illisibles ; copie persistante écrite par rafale après 2 s), entrées de l’appli (zone inconnue, position absente : `empty` « noPosition », lieu inconnu). Rien ne plante ; messages en français. |
| `routing.test.ts` | Entre équipes : le pipeline produit les fichiers de ligne, trains et zones qu’attend le routage (comparaison à `app/test/core/support/gen-fixtures.ts`) ; `route()` sur ces données, classement 1.2 « Le plus court » (PRD-1.2 CA-1.2 à CA-1.6 : `short`, `none`, `lesswalk`, `next` ; marche longue en tête seulement avec 10 min d’avance), CA-M2.1, CA-M2.2, CA-M2.7, CA-M5.1 à CA-M5.7, nuit, retour du soir Bureau → Maison, raisons au pixel (police des lunettes) ; temps réel d’une étape en bus (De Lijn) et en métro (STIB) par `refresh()` ; réglages v3 : préréglages 1.0 et 1.1 migrés (CA-2.1, CA-2.2), réponses et ordre des favoris (CA-M1.1 à CA-M1.5, CA-S3.2) ; zones fusionnées (M8.3) sur une variante des zips : une seule « Gare du Nord » tram et bus, `aka`, favori retrouvé. |
| `real-data.test.ts` | À la demande (`QUAI_REAL_DATA`) : instantané 1.1 servi par serve-data, vrai relais sans temps réel, cœur neuf par recherche : cas du propriétaire (Braine-l’Alleud → Madou, marche 5 et 10, jamais le bus 36 vers Rixensart), Waterloo → Madou et Namur → Madou (PRD-1.2 CA-1.7, CA-1.8, CA-1.10), temps de calcul. |
| `geocode.test.ts` | Adresses : cœur → relais → faux services des trois Régions (CA-M4.1, homonymes triés sur le téléphone, rue sans numéro, noms fr et nl), vie privée (CA-M4.8 : seuls `q` et `lang` partent du cœur, journal du faux service limité au texte tapé, jamais `q` dans le journal du relais), de l’adresse au trajet (Veldstraat, Waterloo, Centenaire, Bastogne), pannes (scènes `down`, `garbage`, `slow`, un service en panne, relais arrêté ou malade, hors ligne) et `health()`. |
| `sim/run-sim.ts` | 1.2.1, appli et Quai Web construits, vrai cœur, vraies données, vrai relais, faux service d’adresses. Réglages de test au format 1.1, migrés par l’appli au lancement (`p/1.2.1.json` : ceux de `preset-1.1.json` avec les nouveautés déjà vues ; `p/1.2.0.json` : mise à jour depuis la 1.2.0 ; `p/waterloo.json` : Maison à Waterloo, Bureau rue du Progrès 20, Mama à Uccle et la gare de Waterloo, comme CA-121.5). Lunettes dans le simulateur : accueil 1.2.1 (PRD-1.2.1 § 4 : « Favoris » et son nombre, jusqu’à 3 favoris en retrait sur une ligne chacun avec le départ conseillé puis l’arrivée, ou le prochain départ, sans « ~ », jamais un favori de la règle 5, ligne vide, « Autour de moi », « Aller à… », aucun pied, curseur sur le premier favori ou sur « En cours », ligne du haut sans « ~ » sans temps réel ; CA-121.5), relief mesuré sur chaque capture de l’accueil (« Favoris », « Autour de moi », « Aller à… » au niveau 4, favoris au niveau 2 et en retrait de 20 px), « Favoris » ouvre « Mes favoris » (tous), trajet de 7 étapes : ▼ fait défiler les étapes seulement (« ▼ suite du trajet : 1 étape », puis « Fin du trajet. ▼ 2 autres trajets », jamais un autre trajet, ▲ en haut sans effet ; CA-121.4), « Autres trajets » (titre, nom et heures, puis moyens et pourquoi sur une 2e ligne plus pâle), toucher : les étapes de l’entrée (« Vers le bureau : 07:34 → 08:30 », « Plus tôt de 16 min, mais 19 min à pied », « Fin du trajet. ▼ autres trajets »), ▼ au bout ou double toucher : retour à la liste, double toucher sur la liste : le premier trajet à sa fin, suivre un autre trajet depuis la liste, suivi automatique (en cours, dans le train, dans le T3 de la correspondance, descente, aide à l’arrivée, fin), « pas parti » (M6.3), « ★ garder ce trajet » (déjà gardé), retrait de favori annulable (M6.1), « Aller à… » avec les lieux puis les adresses récentes (S4, CA-2.2), jour férié en dernière ligne de l’accueil le 11/11 et rien le 12/11 (CA-121.7), message « Quai 1.2.1 » une fois depuis la 1.2.0, et depuis la 1.1 et la 1.0 avec la ligne des lieux (CA-121.8), premier lancement (aide des gestes sur l’accueil), horaires injoignables puis nouvel essai (toucher et 30 s, M8.6), relais muet et panne du temps réel dite juste (M8.5, M8.6), horaires périmés, départs de demain (S6), aides de gestes exactes (PRD-1.2.1 § 3.5) et double toucher (retour, ou sortie à la racine). Chaque capture des menus, des étapes et de « Autres trajets » est contrôlée au pixel (CA-M1.7). Téléphone dans Chrome : migration visible depuis la 1.1 et bannière « Nouveau » (ses lignes depuis la 1.1 et depuis la 1.2.0), « Mes favoris » unique, « Nouveau favori » : deux onglets de même taille et de même style, « Un endroit » choisi d’office, plus de lien du bas, « Un trajet de A à B » (formulaire du trajet fixe), anciens liens `#/favoris/trajet` et `?type=trajet`, pas d’onglets en modification (CA-121.6) ; adresse en 3 touchers (CA-2.3), gare : « Ses prochains départs » ou « Le trajet pour y aller », trajet fixe entre deux lieux et suppression d’un lieu utilisé (CA-2.5), « Marche maximale » et son sous-titre 1.2.1, cartes : nom affiché, ligne des moyens (plus de pastilles), phrases 1.2.1 (« Arrive 16 min après le plus rapide, avec moins de marche. », « Plus tôt de 16 min, mais 19 min à pied. ») vers la rue Neuve, depuis Waterloo, vers Uccle et depuis Uccle (plus de « Sans changement »), bouton « Lunettes » puis « Autres trajets » dans les lunettes, jour férié au-dessus des résultats le 11/11 et rien le 12/11, « Garder en favori » (CA-2.4), champ unique (types, ordre, pannes, hors ligne, homonymes, vie privée CA-M4.8), ordre des favoris (CA-S3.2), aperçu de l’accueil dans « Affichage », Données (« Version de Quai 1.2.1 », adresses), « Tes favoris » au premier lancement, lieu 1.0 à vérifier ; « ★ garder ce trajet » depuis ma position (un lieu « Près de Gand-Saint-Pierre ») ; Quai Web : onglet Lunettes (accueil 1.2.1, relief mesuré sur le canvas), position refusée, adresse choisie dans la rubrique « Position », « Autour de moi » centré là, gardée au rechargement, adresses en panne (CA-3.1) ; réouverture de Quai (stockage local gardé) : « Quai 1.2.1 » et la bannière une seule fois depuis la 1.2.0, la 1.1 et la 1.0, jamais après une nouvelle installation (CA-3.2), aide des gestes de l’accueil les 7 premiers jours (`quai.firstUse`, hors des réglages), trajet repris et ses « Autres trajets » (CA-M6.3), fin du trajet (M6.4 à M6.6), favori rétabli à l’identique. 1.2.9 (PRD-1.2.9) : message « Quai 1.2.9 » (ses 3 lignes depuis la 1.2.8, avec celles de la 1.2.8 d’avant) et bannière « Nouveau dans Quai 1.2.9 » repliée, dépliée par « Voir ce qui change » ; sur Quai Web, les mêmes qui parlent de l’onglet Réglages ; téléphone : accueil en miroir des lunettes (« Bonjour », « Réglages », rubriques dans l’ordre des lunettes, nombres, ancres, rubriques vides « à choisir », « Voir les 2 autres favoris », carte des rubriques qui suit une ligne retirée puis rétablie dans les lunettes, Affichage ouvert depuis l’accueil qui y revient), écrans Gares, Arrêts et Lignes (rangées dépliables, « Ouvrir d’office », ↑ et ↓, retrait confirmé dans la page, ajout « Près de toi » sur place), Réglages (pas-à-pas enregistrés, sources en bas), Affichage et retours. Rapport : `out/sim-report.json` (étapes, durées par scénario, notes dont le relief mesuré), journaux des serveurs : `out/sim-servers.log`, sortie du simulateur d’un scénario en échec : `out/sim-<scénario>-simulateur.log`. |
| `sim/cdp.ts` | Pilote minimal de Chrome sans affichage (protocole DevTools, WebSocket de Node) : page 390 × 844 en densité 2, console, clics, saisie, hors ligne, permission de position (Quai Web), captures. |
| `sim/pixels.ts` | Contrôle au pixel des captures des lunettes : chaque ligne journalisée dessinée dans sa colonne, sans débordement ni retour à la ligne ; accueil 1.2.1 (favoris en retrait de 20 px, réponse calée au bord droit, ligne vide sans aucun pixel, pied compact) et « Autres trajets » (nom et heures, puis la 2e ligne). `levels()` : luminosité de chaque ligne, lue dans l’alpha de la capture (relief). |
| `lib/` | `stack.ts` (lancement des serveurs, faux service d’adresses compris : `stack.geo`, `geoScene()`, `geoJournal()`), `faulty.ts` (mandataire à pannes), `sim.ts` (pilotage du simulateur). |

## Captures (`screens/`)

Nom : `<scénario>-<étape>.png` ; les captures d’un scénario sont remplacées à chaque passage.

- Lunettes (576 × 288, scène `base` sauf mention) : `s1-*` (07:31 à Namur : accueil, étapes, fin du trajet, Autres trajets,
  un autre trajet, Mes favoris, Aller à…), `s1noRT-*` (temps réel indisponible), `s1run-*` (trajet suivi en accéléré :
  en cours, accueil avec « En cours », dans le train), `s2-*` (gare du Nord : départs du favori, accueil, Mes favoris,
  Autour de moi, départs), `s3-*` et `s3run-*` (vers Gand, aide à l’arrivée), `waterloo-*` (accueil 1.2.1, trajet au
  milieu et au bout, Autres trajets, Plus tôt, Aller à…), `holiday-*` (11/11), `news-*` (« Quai 1.2.1 » depuis la
  1.2.0, la 1.1 et la 1.0), `firstrun-*`, `errors-*`, `stale-home-first.png`, `late-*` (23:30).
- Téléphone (Chrome, 390 × 844 en densité 2, sans l’émulateur des lunettes de la page de développement) : `phone-*`,
  `keep-*`, `s126-tel-*` ; 1.2.9 (`s129-tel-*`, PRD-1.2.9 § 2) : accueil en miroir des lunettes, bannière « Nouveau dans
  Quai 1.2.9 » dépliée, Réglages, Affichage, écran « Lignes de bus, tram, métro » avec une rangée dépliée, son ajout
  « Près de toi » ; Quai Web (même format) : `web-*`.

Une capture `*-ECHEC.png` n’existe que si une étape échoue ; elles sont effacées au début de chaque `npm run sim`.
Avec `--deliver <dossier>`, les captures choisies pour le propriétaire (`g01` à `g07` pour les lunettes, `p01` à `p05`
pour le téléphone, `w01` pour Quai Web) y sont copiées avec `manifest.json` (fichier → ce qu’il montre). Avec `--tour`,
les images de la visite de `app/test/screens/` (noms de la 1.0) sont refaites, et `tour.json` dit ce que montre chacune.

## Notes

- L’affichage du simulateur 0.9.5 peut avoir un temps de retard sur le journal : la mise à jour d’un conteneur est
  acceptée et journalisée, mais la capture montre encore l’image d’avant (vu sur `waterloo` juste après le lancement,
  deux passes complètes sur quatre de la 1.2.1), et un geste envoyé pendant ce retard peut se perdre. Le contrôle au
  pixel refait donc la capture jusqu’à 2 s (note « capture refaite » dans le rapport), `back()` n’envoie jamais de
  double toucher sur l’accueil (il quitterait Quai : `ShutDownPageContainer`, puis « inject_input: no active event
  container » pour tous les gestes suivants) et les sélections passent par `sim.select()`, qui renvoie le geste. Quand
  une étape échoue, la sortie du simulateur est gardée dans `out/sim-<scénario>-simulateur.log`.
- Le simulateur garde un cache HTTP WebKit sur disque (`~/.local/share/com.evenrealities.evenhub-simulator/WebKitCache`),
  partagé entre lancements : c’est ce qui a révélé que les réponses du relais (`stale-while-revalidate=40`) étaient
  resservies par la WebView. Le cœur demande désormais le temps réel avec `cache: 'no-store'`.
- Les minutes affichées sont arrondies vers le bas (`minutesUntil` de `app/src/core/util.ts`) : l’horloge simulée
  démarre à `mockNow` puis avance, donc « 2 min » à 12:10:00 devient « 1 min » une seconde plus tard (sur l’accueil,
  « dans 1 min → 08:46 » devient « maintenant → 08:46 »). Les assertions du simulateur acceptent cet écart d’une minute.
- Relief (PRD-1.2.1 § 4.4) : les captures du simulateur codent la luminosité de chaque conteneur dans l’alpha des
  pixels (niveau 4 → 255, 3 → 230, 2 → 197) ; `levels()` de `sim/pixels.ts` la mesure. Le canvas de Quai Web dessine le
  vert avec la même opacité (255, 230, 196 sur fond noir). Les captures livrées gardent ce format (vert sur fond
  transparent, comme celles de la 1.2).
- Aide des gestes de l’accueil (§ 4.6) : la date du premier lancement est dans le stockage de l’appli
  (`quai.firstUse`), hors des réglages. Le simulateur repart d’un stockage vide : avec des réglages déjà vus
  (`seenVersion`), la date vaut 0 (Quai déjà utilisé) et l’accueil n’a pas d’aide ; une nouvelle installation
  (`reset=1` sans réglages) l’a. Les 7 jours se vérifient dans Chrome (réouverture 6,9 puis 7,1 jours après).
- Jours fériés : les zips des fixtures ont un calendrier `HOLI` le 11/11. Le scénario `holiday` et les recherches du
  téléphone du 11/11 et du 12/11 servent des horaires publiés la nuit même (`dataOf`) : ceux du 10/11 donneraient
  « Horaires d’hier » le 11/11 et seraient périmés le 12/11.
- Le simulateur 0.9.5 garde `setLocalStorage` en mémoire seulement : un nouveau lancement repart de réglages vides. La
  réouverture de Quai (message « Quai 1.2.1 » une seule fois, trajet repris) se vérifie donc dans Chrome, où le stockage
  local reste d’un chargement à l’autre (même code, plateforme « navigateur »).
- Quai Web est construit pour le test avec des adresses fictives (`https://….invalid`, exigées par le build) que la
  page remplace par `?e2e=1&data=…&relay=…` ; sans `mockLat`, la position vient du navigateur, refusée par
  `Browser.setPermission`.
- En accéléré, un message court des lunettes (2,6 s en temps simulé) ne dure que 130 ms réelles à ×20 : les tests le
  cherchent dans tout le journal depuis le geste, pas sur le dernier écran.
- Un trajet suivi prend fin si, après le départ du premier véhicule, la position est encore à moins de 300 m du départ
  (PRD M6.3). Pour suivre un trajet en accéléré, la position simulée suit donc un parcours : paramètre de test
  `mockPath=13:50.4686,4.8625;20:50.6727,4.5694` (minutes après `mockNow`, puis la position), lu par `app/src/main.ts`.
- La position est relue toutes les 30 s réelles (pas en temps simulé) : en accéléré, une réponse de l’accueil peut
  dater d’une position un peu ancienne. Les assertions n’en dépendent pas.
- Les données servies à l’appli sont celles des fixtures, publiées « cette nuit, 04:12 » (génération réécrite partout
  où elle figure, pour l’écran « Données ») ; le cœur n’utilise les fichiers de ligne que s’ils sont de la même
  génération que `meta.json`.
