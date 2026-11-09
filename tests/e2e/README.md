# Quai : tests de bout en bout (contrôle qualité, comportement à l’exécution)

Ce dossier vérifie l’ensemble en conditions réelles, sans maquette du code testé : le pipeline prépare les
données depuis les zips GTFS de `fixtures/pipeline/gtfs/`, `serve-data` les sert, le relais (`npm run dev`)
interroge le faux portail BMC (`npm run mock-bmc`, clé imposée), et le vrai cœur (`createCore`) ou l’appli
construite (`vite build`) dans le simulateur Even Hub les consomme. L’oracle est `fixtures/README.md`.

Chaque suite lance elle-même ses serveurs (vraies commandes `npm run …`) sur des ports éphémères et les arrête.

## Prérequis

- Node 22.18 ou plus récent ; `npm ci` dans `pipeline/`, `relay/` et `app/` (les suites utilisent leurs commandes).
- Pour le simulateur seulement : `xvfb-run` et le binaire
  `/home/claude/tools/node_modules/@evenrealities/sim-linux-x64/bin/evenhub-simulator`
  (autre emplacement : variable `EVENHUB_SIMULATOR`).

## Tout relancer

```sh
# 1. Paquets : installation propre, tests, types, construction
(cd pipeline && npm ci && npm test && npm run build)
(cd relay && npm ci && npm test && npm run build && npm run vercel-build)
(cd app && npm ci && npm test && npm run typecheck && npm run build)

# 2. Bout en bout sans interface (environ 2 min 30, dont 90 s d’attentes réelles de nouvelles tentatives)
cd tests/e2e
npm ci
npm test              # data, core, robustness, download
npm run typecheck

# 3. Simulateur (environ 7 min ; port d’automatisation 9931)
npm run sim                       # tous les scénarios
npm run sim -- --only s1,s2live   # scénarios choisis (s1 s1noRT s1fast s2 s2live s3 s3fast firstrun stale errors exit polish phone)
```

Suites partielles : `npm run test:data` (données et téléchargement), `npm run test:core` (cœur et robustesse).
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
| `core.test.ts` | Vrai cœur + vraies données + vrai relais : scénarios 1, 2, 3, correspondance, jour férié, après minuit, en scène `base` et `noRT` ; horaires périmés ; recherche « Gand » ; `linesAt` ; corrections du cœur (« IC 12:22 » une seule fois, une proposition par trajet, marche seule ou aucun trajet sur place, jamais plus lent que la marche). |
| `robustness.test.ts` | Pannes à chaque frontière : portail (500, délai, protobuf ou JSON invalide, coupure, 401, 429, redirection), relais (500, délai, JSON invalide, formes inattendues, arrêté), données (meta illisible, zone en JSON invalide ou absente, tuiles vides ou malformées, trains et recherche illisibles), entrées de l’appli (zone inconnue, position absente, lieu inconnu). Rien ne plante ; messages en français. |
| `sim/run-sim.ts` | Appli construite dans le simulateur, vrai cœur : gestes, journaux `QUAI_SCREEN`, captures, comparaison aux maquettes, rafraîchissement de 30 s (passage en `noRT` en cours d’affichage), 2 minutes sans geste, premier lancement sans écran noir, double toucher sur l’accueil (`ShutDownPageContainer`), horaires périmés, sources injoignables, pages du téléphone ; `polish` : départs du lendemain à 23:30 (« demain »), STIB sans « (P) », message de favori non reporté, « Tu es déjà à la maison. », réseau repris d’une nuit précédente sur l’écran Données. Rapport : `out/sim-report.json`, journaux des serveurs : `out/sim-servers.log`. |
| `lib/` | `stack.ts` (lancement des serveurs), `faulty.ts` (mandataire à pannes), `sim.ts` (pilotage du simulateur). |

## Captures (`screens/`)

Lunettes (576 × 288, scène `base` sauf mention) :

- Scénario 1 : `s1-home.png`, `s1-steps.png`, `s1-nearby.png`, `s1-places.png`, `s1-journeys.png`, `s1-journey-steps.png` ;
  scène `noRT` : `s1noRT-home.png`, `s1noRT-steps.png`, `s1noRT-nearby.png` ;
  en accéléré : `s1fast-steps-0737.png` (voie modifiée), `s1fast-train-0805.png` (dans le train).
- Scénario 2 : `s2-board-gdn.png`, `s2-home.png`, `s2-nearby.png`, `s2-board-delijn.png`, `s2-favorite-removed.png`,
  `s2-board-train.png`, `s2-favorites.png` ; rafraîchissement : `s2live-board-train-base.png`, `s2live-refresh-to-noRT.png`,
  `s2live-refresh-back-to-base.png`, `s2live-idle-2min.png`.
- Scénario 3 : `s3-home.png`, `s3-trip.png`, `s3-train-detail.png`, `s3fast-arrival.png`.
- États : `firstrun-no-black-screen.png`, `firstrun-continue.png`, `stale-home.png`, `stale-board.png`,
  `errors-data-down.png`, `errors-relay-down.png`, `errors-nearby-empty.png`, `exit-before.png`.
- Polissage (23:30, départs du lendemain) : `polish-board-gdn-late.png`, `polish-toast-not-carried.png`, `polish-nearby-late.png`,
  `polish-board-train-late.png`, `polish-favorites-late.png`, `polish-already-home.png`.

Téléphone (WebView) : `phone-onboarding.png`, `phone-home.png`, `phone-places.png`, `phone-favorites.png`,
`phone-favorite-edit.png`, `phone-display.png`, `phone-alerts.png`, `phone-data.png`, `phone-search.png`,
`phone-search-results.png`, `polish-phone-data-cached.png` (réseau repris d’une nuit précédente), `polish-phone-favorite-edit.png`.

Une capture `*-ECHEC.png` n’existe que si une étape échoue ; elles sont effacées au début de chaque `npm run sim`.

## Notes

- Le simulateur garde un cache HTTP WebKit sur disque (`~/.local/share/com.evenrealities.evenhub-simulator/WebKitCache`),
  partagé entre lancements : c’est ce qui a révélé que les réponses du relais (`stale-while-revalidate=40`) étaient
  resservies par la WebView. Le cœur demande désormais le temps réel avec `cache: 'no-store'`.
- Les minutes affichées sont arrondies vers le bas (`minutesUntil` de `app/src/core/util.ts`) : l’horloge simulée
  démarre à `mockNow` puis avance, donc « 2 min » à 12:10:00 devient « 1 min » une seconde plus tard. Les assertions
  du simulateur acceptent cet écart d’une minute.
