# Quai : relais temps réel

Petit service Vercel (gratuit, plan Hobby, runtime Node 22) entre le portail officiel Belgian Mobility Company (BMC) et l’appli Quai. Il récupère les flux temps réel des opérateurs avec la clé BMC (qui ne quitte jamais le serveur), les décode et ne renvoie à l’appli que ce qu’elle demande, en JSON. Les formats de réponse suivent exactement `shared/types.ts` (copie dans `lib/shared/types.ts`).

Données : SNCB, STIB, De Lijn, TEC via Belgian Mobility Company (licence CC BY 4.0).

## Points d’entrée

Toutes les réponses sont en JSON avec `Access-Control-Allow-Origin: *` et `Access-Control-Allow-Methods: GET, OPTIONS`. Une requête `OPTIONS` reçoit `204`.

| Réponse | Statut | Cache-Control |
|---|---|---|
| succès | 200 | `public, s-maxage=20, stale-while-revalidate=40` (cache CDN Vercel) |
| source en erreur ou clé absente | 200 avec `error` (en français) et données vides : l’appli passe à l’horaire prévu, signe « ~ » | `no-store` |
| paramètres invalides | 400 avec `error` (en français) | `no-store` |

### `GET /api/rt?op=sncb|delijn|tec&trips=t1,t2` (RtResponse)

Mises à jour GTFS-RT (TripUpdates) des voyages demandés : 60 `trip_id` au maximum, séparés par des virgules (identifiants normalisés ; un identifiant préfixé `gt:…:` est accepté et normalisé). Seuls les voyages présents dans le flux sont renvoyés ; un voyage absent n’a pas de temps réel.

```json
{"op":"sncb","fetchedAt":"2026-11-10T11:10:00.000Z","feedTimestamp":1794309000,
 "trips":{"88____:007::8863008:8814001:10:852:20261231":{"u":[[1,"8863008_6",120,1794293040,0],[7,"8813003_3",120,1794296880,0]]},
          "88____:046::8812005:8883006:4:1315:20261231":{"cancelled":true,"u":[]}}}
```

Chaque élément de `u` : `[stop_sequence|null, stop_id, retard en s|null, heure estimée epoch s|null, sauté 1|0]`, dans l’ordre du flux.
- retard : `departure.delay`, sinon `arrival.delay` ; heure : `departure.time`, sinon `arrival.time` ;
- arrêt : `stop_time_properties.assigned_stop_id` s’il existe, sinon `stop_id` (un quai SNCB différent du statique signale un changement de voie) ;
- sauté : `schedule_relationship = SKIPPED` ; voyage `CANCELED` (ou `DELETED`) : `cancelled: true`.

Le relais ne propage pas les retards aux arrêts suivants : c’est le travail de l’appli. Il tolère les écarts des flux réels : identifiants préfixés (`gt:`, `gs:`, `gr:`), entités sans `trip_id` (ignorées), doublons d’un même voyage (fusionnés arrêt par arrêt, la mise à jour la plus récente l’emporte ; à dates de départ différentes, celle du jour), en-tête `DIFFERENTIAL` (fusion avec l’état connu de l’instance, `is_deleted` retire le voyage) ou `FULL_DATASET`, horodatages en millisecondes.

Source : `${BMC_BASE}/api/gtfs/feed/{nmbssncb|delijn|tec}/rt/trip-update?format=protobuf`, ou `SNCB_RT_URL` pour la SNCB si elle est définie.

### `GET /api/stib?points=5153,5154` (StibResponse)

Prochains passages STIB (pas de GTFS-RT) : 30 `pointid` numériques au maximum. Un identifiant statique à lettre finale (`6357F`) est ramené au pointid (`6357`). Chaque arrêt demandé figure dans `points` (liste vide si rien), regroupé par ligne et destination, heures triées en ISO 8601 avec le décalage de Bruxelles. Les destinations sont rendues telles que la STIB les donne (majuscules : l’appli les met en forme) ; `msg` est le texte français du message éventuel.

```json
{"fetchedAt":"2026-11-10T11:10:00.000Z","points":{"8041":[{"line":"2","dest":{"fr":"GARE DU MIDI","nl":"ZUIDSTATION"},
 "times":["2026-11-10T12:14:00+01:00","2026-11-10T12:20:00+01:00"],"msg":"Travaux : arrêt Botanique non desservi"}]}}
```

Source : `${BMC_BASE}/api/datasets/stibmivb/rt/WaitingTimes?where=pointid="6357" or pointid="8041"&limit=100&offset=0` (une seule requête pour tous les arrêts manquants du cache, pages suivantes par `offset` si besoin, 8 s au total). Formes acceptées : objet Opendatasoft (`results`, ou `records[].fields`) ou tableau nu ; `passingtimes` en tableau ou en chaîne JSON ; `destination` objet `{fr, nl}` ou chaîne ; `message` chaîne ou `{fr, nl}`. Les passages sans heure sont ignorés.

### `GET /api/alerts?op=sncb|delijn|tec&routes=r1,r2&stops=s1` (AlertsResponse)

Alertes actives maintenant (ou sans période) qui concernent les lignes (`route_id`) ou les arrêts (`stop_id`) donnés, ou toutes si aucun filtre. Une alerte de tout le réseau (agence sans ligne ni arrêt) concerne tous les filtres. Pour la SNCB, un quai et sa gare correspondent (`8811601_2`, `8811601`, `S8811601`). `header` : textes par langue (`fr`, `nl`, `en`, `de`) ; une traduction sans langue est rangée dans la langue de l’opérateur (De Lijn : `nl`, sinon `fr`). `active` : périodes `[début, fin]` en secondes epoch, `0` pour une borne absente.

Source : `${BMC_BASE}/api/gtfs/feed/{nmbssncb|delijn|tec}/rt/alert?format=protobuf` (toujours le portail BMC, même si `SNCB_RT_URL` est définie).

### `GET /api/health` (HealthResponse)

Sonde les quatre sources en parallèle (3 s au plus, statut et en-têtes seulement, sans télécharger les flux) et lit `${DATA_BASE}/meta.json` si `DATA_BASE` est définie. `sources.x` : `{ ok, ms }` ou `{ ok: false, error }`. `data` : date de la dernière génération de nuit, `ok` si `meta.json` est lisible, que tous les flux de la nuit sont en ordre et que les données ont moins de 48 h, et l’état de chaque flux. `ok` global : toutes les sources et les données en ordre. Ni clé ni adresse de source dans la réponse.

## Variables d’environnement

| Variable | Rôle |
|---|---|
| `BMC_KEY` | Obligatoire. Clé gratuite du portail BMC (compte sur https://api-management-opendata-production.developer.azure-api.net/, abonnement au produit « Standard »). Envoyée dans les deux en-têtes `bmc-partner-key` et `Ocp-Apim-Subscription-Key`, uniquement vers `BMC_BASE`, jamais dans une réponse ni un journal. Absente : réponses 200 avec `error` et une ligne claire dans les journaux. |
| `BMC_BASE` | Optionnelle. Défaut `https://api-management-opendata-production.azure-api.net`. |
| `SNCB_RT_URL` | Optionnelle. Flux GTFS-RT SNCB direct (plus complet que la copie BMC), fourni par la SNCB sur demande. La clé BMC n’y est jamais envoyée ; des identifiants dans l’adresse (`https://user:motdepasse@…`) passent en en-tête Basic. L’adresse est masquée dans les journaux. |
| `DATA_BASE` | Optionnelle. Base des données de nuit (GitHub Pages), ex. `https://<utilisateur>.github.io/<depot>/data`, pour `/api/health`. |

Modèle : `.env.example`. Aucune clé dans le dépôt.

## Déploiement sur Vercel

1. Sur Vercel, « Add New… > Project », importer le dépôt GitHub.
2. « Root Directory » : `relay`. « Framework Preset » : « Other » (détecté seul). Version de Node : 22.x (imposée aussi par `engines` dans `package.json`).
3. « Environment Variables » : `BMC_KEY` (et au besoin `DATA_BASE`, `SNCB_RT_URL`, `BMC_BASE`), pour Production et Preview.
4. « Deploy ». Vercel installe les dépendances, lance `npm run vercel-build` (vérification des types de `api/` et `lib/`), publie `public/` (page d’accueil) et crée une fonction Node par fichier de `api/`.
5. Vérifier : `curl -s https://<projet>.vercel.app/api/health`.
6. Donner l’adresse (`https://<projet>.vercel.app`, sans `/` final) à l’appli : `QUAI_RELAY_BASE` au moment de `npm run configure`. Prendre le domaine de production (« Domains » sur la page du projet), jamais l’adresse propre à un déploiement (`<projet>-<suite aléatoire>.vercel.app`) : avec la protection standard de Vercel, elle demande une connexion Vercel et l’appli n’y aurait pas accès.

Un changement de variable d’environnement n’est pris en compte qu’au déploiement suivant. Comme les commits sans changement dans `relay/` sont ignorés (ci-dessous), deux moyens :
- dans Vercel, « Deployments », menu « … » du dernier déploiement, « Redeploy », en décochant « Use project's Ignore Build Step » (sinon le script compare le commit à lui-même et annule le déploiement) ;
- ou pousser un commit dont le message contient `[deploy relay]`, par exemple `git commit --allow-empty -m "Nouvelle clé BMC [deploy relay]"`.

Essai du build de Vercel sans compte ni réseau vers Vercel : dans `relay/`, créer `.vercel/project.json` contenant `{"projectId":"local","orgId":"local","settings":{"framework":null}}` (dossier ignoré par git), puis `npx vercel build --yes`. La sortie `.vercel/output/` doit contenir quatre fonctions `nodejs22.x` (`api/alerts`, `api/health`, `api/rt`, `api/stib`), chacune avec `lib/` et `gtfs-realtime-bindings` seulement, et `static/index.html`.

Le dossier se suffit à lui-même : ce qui vient de `shared/` est recopié dans `lib/shared/` par `npm run sync-shared` (un test vérifie que la copie est identique). Les fonctions utilisent la signature Web standard des fonctions Node de Vercel pour un projet sans framework : `export function GET(request: Request): Response` dans `api/*.ts` (comme les exemples `vercel/examples`, `solutions/slackbot` et `starter/mcp-api-wrapper`), sans dépendance à `@vercel/node`.

### Déploiements ignorés (`ignoreCommand`)

Le dépôt reçoit des commits automatiques (fichier mensuel dans `.github/`, changements de l’appli). `vercel.json` déclare `"ignoreCommand": "sh scripts/vercel-ignore.sh"`, l’« Ignored Build Step » de Vercel, lancé depuis le Root Directory : code de sortie `0` = Vercel ignore le commit, `1` = Vercel construit et déploie.

Le script ne saute le déploiement que si rien n’a changé dans `relay/` :
- sur Vercel, il compare `HEAD` au commit du dernier déploiement réussi de la branche (`VERCEL_GIT_PREVIOUS_SHA`), ce qui couvre une poussée de plusieurs commits ;
- premier déploiement (pas de déploiement précédent), commit précédent absent du clone ou git indisponible : il déploie ;
- hors Vercel (essai local), il compare au commit parent `HEAD^` et déploie s’il n’y en a pas (premier commit) ;
- un message de commit contenant `[deploy relay]` force le déploiement.

Essai local : `cd relay && sh scripts/vercel-ignore.sh; echo $?`.

## Développement et tests

```sh
cd relay
npm ci
npm test            # vitest : unitaires + bout en bout (faux portail et relais lancés sur des ports éphémères)
npm run build       # vérification des types (tsc --noEmit), comme npx tsc --noEmit
npm run sync-shared # après une modification de shared/types.ts
npm run make-rt     # régénère les fixtures de fixtures/relay/ depuis fixtures/network.json
```

Deux terminaux pour essayer à la main :

```sh
npm run mock-bmc    # faux portail BMC sur http://localhost:8789 (ou -- --port 9000)
npm run dev         # relais sur http://localhost:8788 (ou -- --port 9001)
```

En développement seulement, `npm run dev` prend par défaut `BMC_BASE=http://localhost:8789` et `BMC_KEY=dev-key`. `QUAI_NOW=2026-11-10T12:10:00+01:00 npm run dev` fait partir l’horloge du relais de cet instant (filtre des alertes actives, âge des données). `POST /__cache/clear` vide les caches du relais.

```sh
curl -s "http://localhost:8788/api/rt?op=sncb&trips=88____:007::8863008:8814001:10:852:20261231,88____:046::8812005:8883006:4:1315:20261231"
curl -s "http://localhost:8788/api/rt?op=delijn&trips=702321245,704601218"
curl -s "http://localhost:8788/api/rt?op=tec&trips=N5-0750"
curl -s "http://localhost:8788/api/stib?points=6357,6358,8042,8041"
curl -s "http://localhost:8788/api/alerts?op=sncb&stops=8811601"
curl -s "http://localhost:8788/api/alerts?op=tec&routes=N51"
curl -s "http://localhost:8788/api/health"
curl -si -X OPTIONS "http://localhost:8788/api/rt"
curl -s -X POST http://localhost:8789/__scene/noRT && curl -s -X POST http://localhost:8788/__cache/clear
curl -s "http://localhost:8788/api/rt?op=sncb&trips=88____:046::8812005:8883006:4:1315:20261231"   # 200 + error
curl -s -X POST http://localhost:8789/__scene/base
```

Flux SNCB direct avec le faux portail : `SNCB_RT_URL=http://localhost:8789/sncb-direct/trip-update npm run dev`.

Lignes à attendre au démarrage (pour les scripts de test) : `[faux BMC] prêt : http://localhost:<port>` et `[dev] Relais Quai (dev) : http://localhost:<port>`.

### Faux portail BMC (`fixtures/relay/mock-bmc.ts`)

- Exige les deux en-têtes de clé (`401` sinon) ; avec `MOCK_BMC_KEY`, seule cette clé est acceptée.
- `GET /api/gtfs/feed/{nmbssncb|delijn|tec}/rt/trip-update` et `/rt/alert` : fixtures protobuf.
- `GET /api/datasets/stibmivb/rt/WaitingTimes` : applique `where` (`pointid="…" or …`), `limit` (100 au plus, comme Opendatasoft) et `offset`.
- `GET /api/gtfs/feed/{nmbssncb|stibmivb|delijn|tec}/static` : zips `fixtures/pipeline/gtfs/{sncb|stib|delijn|tec}.zip` de l’équipe données, s’ils existent (sinon 404).
- `GET /sncb-direct/trip-update` (sans clé) : variante du flux SNCB direct.
- Scènes : `POST /__scene/base`, `POST /__scene/noRT` (toutes les routes en 503), `GET /__scene`. Compteurs : `GET /__stats`, `POST /__stats/reset`.

### Fixtures (`fixtures/relay/`, générées par `npm run make-rt`)

- `bmc/{nmbssncb,delijn,tec}/trip-update.pb` et `alert.pb` : format du portail (identifiants préfixés `gt:<slug>:`, `gs:<slug>:`, `gr:<slug>:`, horodatage 1794309000 = 2026-11-10 12:10). Changement de voie de l’IC de Namur dans `assigned_stop_id` ; dans le flux De Lijn, une entité sans `trip_id` et un doublon, à ignorer ou fusionner.
- `sncb-direct/trip-update.pb` : variante sans préfixes (quai réel directement dans `stop_id`).
- `bmc/stibmivb/waiting-times.json` : réponse WaitingTimes réaliste (enveloppe Opendatasoft, `passingtimes` en chaîne JSON, destinations en majuscules, heures absolues).
- `*.pb.json` : vue lisible de chaque `.pb` (non servie). Un test vérifie que toutes les fixtures sont à jour par rapport à `fixtures/network.json`.

## Limites connues

- Cache mémoire de 25 s par instance de fonction (les requêtes simultanées partagent un seul appel au portail) : une instance froide ou une deuxième instance refait la requête. Le cache CDN de 20 s réduit les appels.
- Plafonds du portail BMC non documentés : le cache limite les appels (au plus un par flux et par instance toutes les 25 s).
- Plan Hobby de Vercel : usage personnel non commercial et quotas mensuels ; chaque appel reste sous 8 s (délai amont), `/api/health` sous 3 s.
- Flux `DIFFERENTIAL` : fusion au mieux, par instance (un voyage non revu depuis 10 min est oublié).
- Retard global d’un voyage (`TripUpdate.delay`) sans mise à jour par arrêt : non transmis (le contrat ne le prévoit pas).
- Pas de vérification sur les vrais serveurs depuis cet environnement : formats éprouvés sur des fixtures réalistes seulement (en particulier la clause `where` STIB et le format du flux SNCB direct).

## Organisation

```
api/          rt.ts, stib.ts, alerts.ts, health.ts : GET et OPTIONS, rien d'autre
lib/          handlers.ts (les quatre points d'entrée), gtfsrt.ts (décodage), stib.ts, upstream.ts (requêtes, délais),
              cache.ts, config.ts, context.ts, http.ts, log.ts (masquage des secrets), time.ts, shared/ (copie)
scripts/      dev.ts, sync-shared.ts, vercel-ignore.sh
test/         vitest (unitaires, fuite de clé, copie de shared, fixtures à jour, ignoreCommand, bout en bout)
public/       page d'accueil statique (dossier de sortie attendu par Vercel)
```
