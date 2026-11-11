# Quai : relais temps réel et adresses

Petit service Vercel (gratuit, plan Hobby, runtime Node 22) entre le portail officiel Belgian Mobility Company (BMC) et l’appli Quai. Il récupère les flux temps réel des opérateurs avec la clé BMC (qui ne quitte jamais le serveur), les décode et ne renvoie à l’appli que ce qu’elle demande, en JSON. Depuis la 1.1, il cherche aussi les adresses auprès des services officiels des trois Régions (`/api/geocode`). Les formats de réponse suivent exactement `shared/types.ts` (copie dans `lib/shared/types.ts`).

Données : SNCB, STIB, De Lijn, TEC via Belgian Mobility Company (licence CC BY 4.0). Adresses : Digitaal Vlaanderen, Paradigm (UrbIS, CC0), SPW (ICAR, CC BY 4.0), voir « Attribution et licences ».

## Points d’entrée

Toutes les réponses sont en JSON avec `Access-Control-Allow-Origin: *` et `Access-Control-Allow-Methods: GET, OPTIONS`. Une requête `OPTIONS` reçoit `204`.

| Réponse | Statut | Cache-Control |
|---|---|---|
| succès | 200 | `public, s-maxage=20, stale-while-revalidate=40` (cache CDN Vercel) |
| adresses : réponse complète avec résultats | 200 | `public, s-maxage=86400, stale-while-revalidate=604800` |
| adresses : réponse complète sans résultat | 200 | `public, s-maxage=600, stale-while-revalidate=600` |
| source en erreur ou clé absente ; adresses : réponse partielle | 200 avec `error` (en français) et données vides : l’appli passe à l’horaire prévu, signe « ~ » ; adresses : `partial: true`, `error` si toutes les sources sont en erreur | `no-store` |
| adresses : plus de 30 recherches par minute depuis une même adresse IP | 429 avec `error`, `Retry-After: 60` | `no-store` |
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

Prochains passages STIB (pas de GTFS-RT) : 30 `pointid` numériques au maximum. Un identifiant statique à lettre finale (`6357F`) est ramené au pointid (`6357`). Chaque arrêt demandé figure dans `points` (liste vide si rien), regroupé par ligne, destination et message (le `msg` d’un groupe vaut pour toutes ses heures : un passage « Temps théorique », « Ne pas embarquer » ou « Dernier passage » forme son propre groupe), heures triées en ISO 8601 avec le décalage de Bruxelles. Les destinations sont rendues telles que la STIB les donne (majuscules, parfois vides : l’appli les met en forme et complète les vides) ; `msg` est le texte français du message éventuel.

```json
{"fetchedAt":"2026-11-10T11:10:00.000Z","points":{"8041":[{"line":"2","dest":{"fr":"GARE DU MIDI","nl":"ZUIDSTATION"},
 "times":["2026-11-10T12:14:00+01:00","2026-11-10T12:20:00+01:00"],"msg":"Travaux : arrêt Botanique non desservi"}]}}
```

Source : `${BMC_BASE}/api/datasets/stibmivb/rt/WaitingTimes?where=pointid="6357" or pointid="8041"&limit=100&offset=0` (une seule requête pour tous les arrêts manquants du cache, pages suivantes par `offset` si besoin, 8 s au total). Formes acceptées : objet Opendatasoft (`results`, ou `records[].fields`) ou tableau nu ; `passingtimes` en tableau ou en chaîne JSON ; `destination` objet `{fr, nl}` ou chaîne ; `message` chaîne ou `{fr, nl}`. Les passages sans heure sont ignorés.

### `GET /api/alerts?op=sncb|delijn|tec&routes=r1,r2&stops=s1` (AlertsResponse)

Alertes actives maintenant (ou sans période) qui concernent les lignes (`route_id`) ou les arrêts (`stop_id`) donnés, ou toutes si aucun filtre. Une alerte de tout le réseau (agence sans ligne ni arrêt) concerne tous les filtres. Pour la SNCB, un quai et sa gare correspondent (`8811601_2`, `8811601`, `S8811601`). `header` : textes par langue (`fr`, `nl`, `en`, `de`) ; une traduction sans langue est rangée dans la langue de l’opérateur (De Lijn : `nl`, sinon `fr`). `active` : périodes `[début, fin]` en secondes epoch, `0` pour une borne absente.

Source : `${BMC_BASE}/api/gtfs/feed/{nmbssncb|delijn|tec}/rt/alert?format=protobuf` (toujours le portail BMC, même si `SNCB_RT_URL` est définie).

### `GET /api/geocode?q=texte&lang=fr|nl` (GeocodeResponse)

Adresses des services officiels des trois Régions (PRD M4, `docs/v1.1/design-routing.md` § 6). Seuls `q` (texte tapé) et `lang` (langue des noms réglée, `fr` par défaut) sont lus ; tout autre paramètre est ignoré et ne part jamais vers les services.

```json
{"q":"rue de fer 25 namur","fetchedAt":"2026-11-11T07:24:53.101Z",
 "results":[{"label":"Rue de Fer 25, 5000 Namur","lat":50.46540,"lon":4.86501,"kind":"adresse","source":"wal","score":1,
             "parts":{"street":"Rue de Fer","number":"25","postcode":"5000","municipality":"Namur"}}],
 "sources":{"wal":{"ok":true,"ms":180,"n":1}},
 "attribution":"Adresses : Digitaal Vlaanderen, Paradigm (UrbIS, CC0), SPW (ICAR, CC BY 4.0)"}
```

1. Contrôle : espaces resserrés, 3 à 100 caractères, caractères de contrôle refusés ; sinon 400 « Paramètre q manquant ou trop court : 3 caractères au moins. », « Paramètre q trop long : 100 caractères au plus. », « Paramètre q invalide : caractère de contrôle interdit. » ; `lang` autre que fr ou nl : 400 « Paramètre lang invalide : fr ou nl. ».
2. Aiguillage : un code postal suivi d’un mot (« 5000 Namur ») choisit la Région (1000 à 1299 Bruxelles ; 1300 à 1499 et 4000 à 7999 Wallonie ; 1500 à 3999 et 8000 à 9999 Flandre) ; sinon une commune reconnue en fin de texte, sauf après un petit mot (« chaussée de Bruxelles » est une rue) ; sinon les trois services en parallèle. Code postal et commune de Régions différentes : les deux. Table embarquée (`lib/geocode/communes.ts`, environ 9 Ko) : les 19 communes bruxelloises (français et néerlandais), les 261 communes wallonnes de la liste du service ICAR lui-même, les 285 communes flamandes de la liste officielle (2025), les anciennes communes fusionnées, les noms usuels dans les autres langues et quelques sections connues.
3. Appels : 2 s par service, 2,5 s en tout ; réponse partielle permise. Flandre : `Location?q=…&c=5`. Bruxelles : `freeSearch/searchAnyObject?searchLanguage={lang}&freeText=…&model=BeStPlus`. Wallonie : `searchAll?address=…&crs=EPSG:4326&geom=true&lang={lang}&levels=1,2,3,4,7`. Repli : si le service bruxellois échoue ou est écarté, le service flamand (qui couvre aussi Bruxelles, en néerlandais) répond à sa place s’il reste au moins 0,4 s.
4. Normalisation : libellé « Rue Numéro, CP Commune » (casse corrigée pour les noms tout en capitales ou tout en minuscules, commune sans préfixe en capitales), `kind` (adresse, rue, lieu, commune), `approx` pour une rue, une commune ou un numéro interpolé, positions WGS84 à 5 décimales (Lambert 72 et Lambert 2008 convertis par `lib/geocode/lambert.ts`, mêmes formules que proj4, vérifiées au centimètre sur des couples rendus par les services), `parts`, et à Bruxelles `names: { fr, nl }` (le libellé suit `lang`).
5. Fusion et classement : doublons retirés (même objet d’un service, même libellé, ou même type à moins de 25 m avec le même numéro ; on garde celui du service de la Région) ; ordre : couverture des mots tapés (numéro compris ; un numéro que l’on n’a pas tapé compte comme non couvert, d’où « Rue Neuve » avant « Rue Neuve 1 »), précision (part du libellé expliquée par le texte : « namur » donne la commune avant « Rue de Namur »), type (adresse, rue, lieu, commune), score du service ramené entre 0 et 1, Région du code postal tapé ; 8 résultats au plus. `score` rendu = 0,7 × couverture + 0,3 × précision, au centième : des résultats équivalents ont le même score et le téléphone les départage par la proximité (calcul local, la position ne quitte pas le téléphone).
6. Cache : mémoire de l’instance (500 entrées, 24 h avec résultats, 10 min sans résultat ; même texte à la casse près et même langue), requêtes simultanées identiques partagées, et cache CDN (tableau ci-dessus). Une réponse partielle ou en erreur n’est jamais gardée.
7. Limites (par instance, au mieux) : 30 recherches par minute et par adresse IP (429 « Trop de recherches d’adresses : réessaie dans une minute. ») ; 4 requêtes en cours au plus par service (les suivantes attendent une place jusqu’au délai, sinon « Trop de recherches en cours vers le service wallon ») ; disjoncteur : 3 échecs de suite écartent le service 60 s (« Service des adresses de Wallonie indisponible », de même Flandre et Bruxelles).
8. Erreurs, toujours en HTTP 200 : toutes les sources en erreur : `error` « Recherche d’adresse indisponible pour l’instant : gares et arrêts seulement. » ; par source dans `sources.x.error` : « Délai dépassé (2 s) », « Réponse HTTP 503 du service wallon », « Réponse illisible du service flamand », « Service bruxellois injoignable », « Trop de requêtes, limite du service wallon atteinte (HTTP 429) », « Réponse trop volumineuse du service flamand ». `partial: true` dès qu’une source interrogée manque.

### `GET /api/health` (HealthResponse)

Sonde les quatre sources en parallèle (3 s au plus, statut et en-têtes seulement, sans télécharger les flux) et lit `${DATA_BASE}/meta.json` si `DATA_BASE` est définie. `sources.x` : `{ ok, ms }` ou `{ ok: false, error }`. `data` : date de la dernière génération de nuit, `ok` si `meta.json` est lisible, que tous les flux de la nuit sont en ordre et que les données ont moins de 48 h, et l’état de chaque flux. `ok` global : toutes les sources et les données en ordre. Ni clé ni adresse de source dans la réponse.

Depuis la 1.1 : `version` (« 1.1.0 ») et `geocode: { vla, bru, wal }` pour les services d’adresses activés, `{ ok, ms }` ou `{ ok: false, error }`. L’état vient de la dernière vraie recherche si elle a moins de 10 min, sinon d’une requête de test « Namur » (au plus une toutes les 10 min par service, même quand le disjoncteur l’écarte ; une réussite le referme). Les adresses ne changent pas `ok` global (une recherche d’adresse en panne laisse gares et arrêts).

## Variables d’environnement

| Variable | Rôle |
|---|---|
| `BMC_KEY` | Obligatoire. Clé gratuite du portail BMC (compte sur https://api-management-opendata-production.developer.azure-api.net/, abonnement au produit « Standard »). Envoyée dans les deux en-têtes `bmc-partner-key` et `Ocp-Apim-Subscription-Key`, uniquement vers `BMC_BASE`, jamais dans une réponse ni un journal. Absente : réponses 200 avec `error` et une ligne claire dans les journaux. |
| `BMC_BASE` | Optionnelle. Défaut `https://api-management-opendata-production.azure-api.net`. |
| `SNCB_RT_URL` | Optionnelle. Flux GTFS-RT SNCB direct (plus complet que la copie BMC), fourni par la SNCB sur demande. La clé BMC n’y est jamais envoyée ; des identifiants dans l’adresse (`https://user:motdepasse@…`) passent en en-tête Basic. L’adresse est masquée dans les journaux. |
| `DATA_BASE` | Optionnelle. Base des données de nuit (GitHub Pages), ex. `https://<utilisateur>.github.io/<depot>/data`, pour `/api/health`. |
| `GEOCODE_SOURCES` | Optionnelle. Services d’adresses activés, dans l’ordre : défaut `vla,bru,wal`. Une autre entrée (`google` compris) est ignorée avec une ligne de journal. |
| `QUAI_GEO_VLA_BASE`, `QUAI_GEO_BRU_BASE`, `QUAI_GEO_WAL_BASE` | Optionnelles. Adresses de base des services. Défauts : `https://geo.api.vlaanderen.be/geolocation/v4`, `https://geoservices.irisnet.be/geocoding/api/v1/brussels/geocoding` (chemin de la spécification Geoloc de Paradigm, février 2026, vérifié en direct le 11/11/2026), `https://geoservices.wallonie.be/geocodeWS`. Permettent de suivre un changement de version sans changer le code. |
| `QUAI_GEO_BASE` | Tests seulement. Base unique d’un faux service : les trois adresses deviennent `${QUAI_GEO_BASE}/geolocation/v4`, `…/geocoding/api/v1/brussels/geocoding`, `…/geocodeWS` (une variable propre à un service l’emporte). Jamais sur Vercel. |
| `GOOGLE_GEOCODING_KEY` | À laisser vide. Google n’est pas branché en 1.1 (`design-routing.md` § 6.6) : la clé n’est jamais utilisée ni écrite au journal ; si elle est définie, une ligne de journal le rappelle. |

Modèle : `.env.example`. Aucune clé dans le dépôt. Les services d’adresses n’ont besoin d’aucune clé.

## Vie privée (adresses)

- Le téléphone n’envoie que `q` et `lang` ; le relais ne transmet aux services que le texte et la langue, avec les paramètres fixes de chaque service, les en-têtes `Accept` et `User-Agent: quai-relay/1.1` (aucun cookie, aucune adresse IP, aucun identifiant, jamais la clé BMC). Le journal du faux service le vérifie (CA-M4.8).
- Le relais ne journalise ni `q` ni l’adresse IP : une ligne par recherche avec la longueur du texte, la langue, l’aiguillage, l’état et la durée de chaque service, le nombre de résultats et le statut, par exemple `adresses : 19 car., fr, aiguillage commune → wal, wal ok 1 rés. 180 ms ; 1 résultat(s) en 182 ms, statut 200`. Le serveur de développement affiche `q=(19 car.)`.
- La limite par client garde seulement une empreinte salée de l’adresse IP (sel aléatoire propre à l’instance), oubliée après une minute.
- Limite connue : les journaux de requêtes de Vercel (onglet « Logs », conservés peu de temps sur le plan Hobby) peuvent montrer l’adresse demandée, donc `q`. Le relais n’y peut rien ; ne pas activer de « Log Drain » si l’on veut l’éviter.

## Attribution et licences (Q10)

| Service | Conditions publiées | Mention |
|---|---|---|
| Digitaal Vlaanderen, Geolocation v4 | Données du « Gebouwen- en adressenregister » sous « Modellicentie voor gratis hergebruik » v1.0 : réutilisation gratuite, y compris commerciale ; mention de la source obligatoire, « Bron: Digitaal Vlaanderen » (fiche metadata.vlaanderen.be du jeu « adressen »). La page du service ne publie ni quotas ni conditions propres. | Digitaal Vlaanderen |
| Paradigm, géocodage du registre bruxellois | Fiche Geobru du service : licence CC0 1.0, « No limitations to public access ». Aucune mention exigée. | Paradigm (UrbIS, CC0), par courtoisie |
| SPW, service de géolocalisation ICAR | Fiche Metawal du service : « Accès libre et gratuit au service pour tout public » ; conditions d’utilisation « en cours d’élaboration », annoncées proches de celles des services web du SPW (document `LicServicesSPW.pdf`, non lu depuis cet environnement). Données ICAR : CC BY 4.0 (fiche transportdata.be), mention obligatoire. | SPW (ICAR, CC BY 4.0) |

Texte proposé, rendu dans `attribution` et à afficher au pied de la liste des adresses et sur l’écran « Données » : « Adresses : Digitaal Vlaanderen, Paradigm (UrbIS, CC0), SPW (ICAR, CC BY 4.0) » (seuls les services activés y figurent). Avant publication : relire les conditions du SPW une fois arrêtées (contact `helpdesk.carto@spw.wallonie.be`).

## Déploiement sur Vercel

1. Sur Vercel, « Add New… > Project », importer le dépôt GitHub.
2. « Root Directory » : `relay`. « Framework Preset » : « Other » (détecté seul). Version de Node : 22.x (imposée aussi par `engines` dans `package.json`).
3. « Environment Variables » : `BMC_KEY` (et au besoin `DATA_BASE`, `SNCB_RT_URL`, `BMC_BASE`), pour Production et Preview. Les adresses n’ont besoin d’aucune variable (`GEOCODE_SOURCES` et `QUAI_GEO_*_BASE` seulement pour changer un service ; jamais `QUAI_GEO_BASE` ni `GOOGLE_GEOCODING_KEY`).
4. « Deploy ». Vercel installe les dépendances, lance `npm run vercel-build` (vérification des types de `api/` et `lib/`), publie `public/` (page d’accueil) et crée une fonction Node par fichier de `api/`. `vercel.json` limite `api/geocode` à 5 s (`maxDuration` ; la recherche répond en 2,5 s au plus).
5. Vérifier : `curl -s https://<projet>.vercel.app/api/health`, puis la liste « Vérifications après déploiement » ci-dessous.
6. Donner l’adresse (`https://<projet>.vercel.app`, sans `/` final) à l’appli : `QUAI_RELAY_BASE` au moment de `npm run configure`. Prendre le domaine de production (« Domains » sur la page du projet), jamais l’adresse propre à un déploiement (`<projet>-<suite aléatoire>.vercel.app`) : avec la protection standard de Vercel, elle demande une connexion Vercel et l’appli n’y aurait pas accès.

Un changement de variable d’environnement n’est pris en compte qu’au déploiement suivant. Comme les commits sans changement dans `relay/` sont ignorés (ci-dessous), deux moyens :
- dans Vercel, « Deployments », menu « … » du dernier déploiement, « Redeploy », en décochant « Use project's Ignore Build Step » (sinon le script compare le commit à lui-même et annule le déploiement) ;
- ou pousser un commit dont le message contient `[deploy relay]`, par exemple `git commit --allow-empty -m "Nouvelle clé BMC [deploy relay]"`.

Essai du build de Vercel sans compte ni réseau vers Vercel : dans `relay/`, créer `.vercel/project.json` contenant `{"projectId":"local","orgId":"local","settings":{"framework":null}}` (dossier ignoré par git), puis `npx vercel build --yes`. La sortie `.vercel/output/` doit contenir cinq fonctions `nodejs22.x` (`api/alerts`, `api/geocode`, `api/health`, `api/rt`, `api/stib`), chacune avec `lib/` (et `gtfs-realtime-bindings` pour celles du temps réel ; `api/geocode` n’en a pas besoin), `maxDuration: 5` pour `api/geocode`, et `static/index.html`. Essai fait le 11/11/2026 avec Vercel CLI 65.14.0 : build réussi, fonctions compilées appelées sur le faux service d’adresses.

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
npm test            # vitest : unitaires + bout en bout (faux portail, faux service d'adresses et relais sur des ports éphémères)
npm run build       # vérification des types (tsc --noEmit), comme npx tsc --noEmit
npm run vercel-build # vérification des types de api/ et lib/ seulement, comme sur Vercel
npm run sync-shared # après une modification de shared/types.ts
npm run make-rt     # régénère les fixtures de fixtures/relay/ depuis fixtures/network.json
```

Trois terminaux pour essayer à la main :

```sh
npm run mock-bmc      # faux portail BMC sur http://localhost:8789 (ou -- --port 9000)
npm run mock-geocode  # faux service d'adresses sur http://localhost:8790 (ou -- --port 9002)
npm run dev           # relais sur http://localhost:8788 (ou -- --port 9001)
```

En développement seulement, `npm run dev` prend par défaut `BMC_BASE=http://localhost:8789`, `BMC_KEY=dev-key` et, sans aucune variable `QUAI_GEO_*`, `QUAI_GEO_BASE=http://localhost:8790` (le faux service d’adresses). `QUAI_NOW=2026-11-10T12:10:00+01:00 npm run dev` fait partir l’horloge du relais de cet instant (filtre des alertes actives, âge des données). `POST /__cache/clear` vide les caches du relais (adresses comprises : cache, disjoncteurs, limite par client).

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

Adresses avec le faux service :

```sh
curl -s "http://localhost:8788/api/geocode?q=rue%20de%20fer%2025%20namur"
curl -s "http://localhost:8788/api/geocode?q=rue%20de%20fer%2025"                  # homonyme fictif à Liège, même score
curl -s "http://localhost:8788/api/geocode?q=nieuwstraat%201&lang=nl"              # Bruxelles en néerlandais, names fr et nl
curl -s "http://localhost:8788/api/geocode?q=rue%20neuve%20bruxelles"              # rue sans numéro, approx
curl -s -X POST http://localhost:8790/__scene/down && curl -s -X POST http://localhost:8788/__cache/clear
curl -s "http://localhost:8788/api/geocode?q=rue%20du%20bois%201%20bastogne"       # 200 + error
curl -s -X POST "http://localhost:8790/__scene/slow?sources=wal"                   # le service wallon seul répond après 3 s
curl -s -X POST http://localhost:8790/__scene/base
curl -s http://localhost:8790/__journal                                             # ce que les « services » ont reçu
```

Lignes à attendre au démarrage (pour les scripts de test) : `[faux BMC] prêt : http://localhost:<port>`, `[faux adresses] prêt : http://localhost:<port>` et `[dev] Relais Quai (dev) : http://localhost:<port>`. Pour brancher un relais lancé par un script sur le faux service : `QUAI_GEO_BASE=<adresse du faux service> npm run dev -- --port 0`.

### Faux service d’adresses (`fixtures/relay/mock-geocode.ts`)

- Imite les trois services sur leurs vrais chemins et dans leurs formats (`fixtures/relay/geocode/README.md`) : `GET /geolocation/v4/Location` (Flandre, couvre aussi Bruxelles en néerlandais), `GET /geocoding/api/v1/brussels/geocoding/freeSearch/searchAnyObject` (Bruxelles, noms français et néerlandais, positions en Lambert 72), `GET /geocodeWS/searchAll` (Wallonie, EPSG:31370 par défaut, EPSG:4326 sur demande). Paramètres manquants : 400, comme les vrais.
- Données : `fixtures/relay/geocode/fake-addresses.json`, tableau du PRD annexe A.2 (« rue de fer 25 namur », homonyme fictif à Liège, « rue neuve 1 bruxelles » et « nieuwstraat 1 », « rue neuve bruxelles » sans numéro, « avenue winston churchill 100 », « boulevard du centenaire 1 », « veldstraat 1 gent », « chaussée de bruxelles 1 waterloo », « rue du bois 1 bastogne ») et « rue du progrès 20 » (scénario 4). Correspondance simple : chaque mot significatif tapé doit se trouver dans l’adresse.
- Scènes : `POST /__scene/base`, `/__scene/down` (HTTP 503), `/__scene/slow` (réponse après 3 s), `/__scene/garbage` (HTML en 200), avec `?sources=wal,bru` pour ne toucher que ces services ; `GET /__scene`.
- Journal : `GET /__journal` (pour chaque requête : service, chemin, paramètres, en-têtes reçus), `POST /__journal/reset` ; compteurs `GET /__stats`, `POST /__stats/reset`.

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
- `geocode/` (écrit à la main, pas par `make-rt`) : réponses types des trois services d’adresses, relevées en direct ou reconstituées (provenance fichier par fichier dans `geocode/README.md`), et tableau du faux service.

## Vérifications après déploiement

À ouvrir dans un navigateur (ou avec `curl -s`), sur le domaine de production. Chaque réponse doit être un JSON sans `error`, avec la source indiquée `ok`.

1. https://quai-relay.vercel.app/api/health : `version` « 1.1.0 », `geocode.vla`, `geocode.bru`, `geocode.wal` à `ok: true` avec une durée `ms` (moins de 2000).
2. https://quai-relay.vercel.app/api/geocode?q=rue%20de%20fer%2025%20namur : 1er résultat « Rue de Fer 25, 5000 Namur », `kind` « adresse », `source` « wal », position vers 50,4654 ; 4,8650.
3. https://quai-relay.vercel.app/api/geocode?q=veldstraat%201%20gent : 1er résultat « Veldstraat 1, 9000 Gent », `source` « vla », position vers 51,0536 ; 3,7224.
4. https://quai-relay.vercel.app/api/geocode?q=rue%20neuve%201%20bruxelles : 1er résultat « Rue Neuve 1, 1000 Bruxelles », `source` « bru », `names.nl` « Nieuwstraat 1, 1000 Brussel », position vers 50,8506 ; 4,3540. C’est le contrôle du format bruxellois reconstitué : si `sources.bru` porte « Réponse illisible du service bruxellois », noter la réponse brute de https://geoservices.irisnet.be/geocoding/api/v1/brussels/geocoding/freeSearch/searchAnyObject?searchLanguage=fr&freeText=rue%20neuve%201&model=BeStPlus (chemin du code, `lib/config.ts` ; `/api/v2/` ne répond pas, voir `fixtures/relay/geocode/README.md` ; si le service a changé de chemin, `QUAI_GEO_BRU_BASE`) ; en attendant, Bruxelles passe par le service flamand (noms néerlandais).
5. https://quai-relay.vercel.app/api/geocode?q=nieuwstraat%201&lang=nl : un seul « Nieuwstraat 1, 1000 Brussel » (doublon flamand et bruxellois fusionné), les trois sources `ok`.
6. https://quai-relay.vercel.app/api/geocode?q=rue%20neuve%20bruxelles : « Rue Neuve, 1000 Bruxelles » en tête, `kind` « rue », `approx: true`.
7. https://quai-relay.vercel.app/api/geocode?q=gare%20de%20gembloux : « Gare de Gembloux » (`kind` « lieu ») en tête, position vers 50,5702 ; 4,6911.
8. https://quai-relay.vercel.app/api/geocode?q=namur : « Namur » (`kind` « commune ») en tête ; https://quai-relay.vercel.app/api/geocode?q=chauss%C3%A9e%20de%20bruxelles%201%20waterloo : « Chaussée de Bruxelles 1, 1410 Waterloo ».
9. https://quai-relay.vercel.app/api/geocode?q=ab : HTTP 400 « Paramètre q manquant ou trop court : 3 caractères au moins. ».
10. Deux fois la même adresse de recherche : la seconde réponse a le même `fetchedAt` (cache) et l’en-tête `Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800` (`curl -sI`).
11. Durées : `sources.x.ms` en dessous de 1000 en temps normal ; dans « Logs » de Vercel, les lignes `[relais] adresses : … car.` ne contiennent jamais le texte cherché.

## Limites connues

- Cache mémoire de 25 s par instance de fonction (les requêtes simultanées partagent un seul appel au portail) : une instance froide ou une deuxième instance refait la requête. Le cache CDN de 20 s réduit les appels.
- Plafonds du portail BMC non documentés : le cache limite les appels (au plus un par flux et par instance toutes les 25 s).
- Plan Hobby de Vercel : usage personnel non commercial et quotas mensuels ; chaque appel reste sous 8 s (délai amont), `/api/health` sous 3 s.
- Flux `DIFFERENTIAL` : fusion au mieux, par instance (un voyage non revu depuis 10 min est oublié).
- Retard global d’un voyage (`TripUpdate.delay`) sans mise à jour par arrêt : non transmis (le contrat ne le prévoit pas).
- Pas de vérification sur les vrais serveurs depuis cet environnement : formats éprouvés sur des fixtures réalistes seulement (en particulier la clause `where` STIB et le format du flux SNCB direct).
- Adresses : formats flamand et wallon relevés en direct le 11/11/2026 ; format bruxellois reconstitué d’après la documentation (le service n’a pas répondu depuis cet environnement), lu de façon tolérante, à vérifier au premier déploiement (liste ci-dessus, point 4). La documentation bruxelloise publiée hésite entre `/api/v1/` (spécification technique de février 2026, modèle `BeStPlus`) et `/api/v2/` (OpenAPI lue pour la conception) : `QUAI_GEO_BRU_BASE` permet de basculer sans changer le code.
- Adresses : quotas des trois services non publiés ; conditions du service wallon en cours d’élaboration. Le cache (instance et CDN), la limite par client et le disjoncteur réduisent les appels.
- Adresses : cache, limite par client, requêtes en cours et disjoncteur sont propres à chaque instance de fonction (au mieux, comme le prévoit la conception).
- Adresses : une commune reconnue en fin de texte réduit les services interrogés ; une rue qui finit par un nom de commune sans code postal (« rue Paul Verlaine ») n’est cherchée que dans la Région de cette commune.

## Organisation

```
api/          rt.ts, stib.ts, alerts.ts, health.ts, geocode.ts : GET et OPTIONS, rien d'autre
lib/          handlers.ts (temps réel et santé), gtfsrt.ts (décodage), stib.ts, upstream.ts (requêtes, délais),
              cache.ts, config.ts, context.ts, http.ts, log.ts (masquage des secrets), time.ts, shared/ (copie)
lib/geocode/  service.ts (/api/geocode, sondes de santé), sources.ts (trois services : requêtes et lecture),
              rank.ts (libellés, fusion, classement), communes.ts (aiguillage, table des communes),
              text.ts (contrôle, normalisation, casse), lambert.ts (Lambert 72 et 2008 vers WGS84), state.ts
scripts/      dev.ts, sync-shared.ts, vercel-ignore.sh
test/         vitest (unitaires, adresses, Lambert, fuite de clé, copie de shared, fixtures à jour, ignoreCommand,
              bout en bout)
public/       page d'accueil statique (dossier de sortie attendu par Vercel)
```
