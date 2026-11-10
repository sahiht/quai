# Quai

Quai est une appli personnelle pour les lunettes Even Realities G2 : les prochains départs des transports en commun belges (SNCB, STIB, De Lijn, TEC) en temps réel, les arrêts autour de soi, les favoris et les trajets porte à porte, affichés dans les lunettes et réglés depuis le téléphone.

Elle n'utilise que les données ouvertes officielles des opérateurs (portail Belgian Mobility Company, licence CC BY 4.0) et ne coûte rien à faire tourner : GitHub (code, préparation de nuit, hébergement des horaires), Vercel Hobby (relais temps réel) et le portail Even Hub (distribution de l'appli).

Pour l'installer, suivre le guide pas à pas : [docs/INSTALL.md](docs/INSTALL.md).

## Fonctionnement

```
Portail BMC (officiel, clé gratuite BMC_KEY)
   │                         │
   │ chaque nuit (GTFS)      │ temps réel (GTFS-RT, attentes STIB)
   ▼                         ▼
pipeline/                 relay/
GitHub Actions            Vercel, fonctions Node 22
« Données de nuit »       /api/rt  /api/stib  /api/alerts  /api/health
   │                         │
   ▼                         │
GitHub Pages                 │
fichiers JSON statiques      │
(DATA_BASE)                  │ (RELAY_BASE)
   │                         │
   └──────────┬──────────────┘
              ▼
app/  paquet Even Hub (quai.ehpk), page web dans l'appli Even Realities du téléphone
              │  SDK @evenrealities/even_hub_sdk 0.0.16
              ▼
Lunettes G2 (576 × 288, vert monochrome)
```

- La clé BMC ne quitte jamais GitHub (secret `BMC_KEY`) et Vercel (variable `BMC_KEY`) : elle n'est jamais dans l'appli.
- L'appli ne contacte que deux origines, inscrites dans la liste blanche réseau de son `app.json` : GitHub Pages (horaires, téléchargés par zones d'environ 2 km) et le relais Vercel. La position exacte reste sur le téléphone (voir [app/store/privacy.md](app/store/privacy.md)).
- Contrats de données (fichiers publiés et réponses du relais) : [shared/types.ts](shared/types.ts). Cahier des charges : [SPEC.md](SPEC.md).

## Dossiers

| Dossier | Contenu |
|---|---|
| `pipeline/` | Préparation de nuit : GTFS officiels vers fichiers JSON statiques ([README](pipeline/README.md)). |
| `relay/` | Relais temps réel pour Vercel, dossier autonome (Root Directory `relay`) ([README](relay/README.md)). |
| `app/` | Appli Even Hub (Vite + TypeScript) : `src/core/` logique sans interface, `src/glasses/` lunettes, `src/phone/` téléphone, `src/web/` et `web/` Quai Web (la même appli dans le navigateur, `npm run build:web`), `scripts/` configuration et paquet, `store/` textes de la fiche et confidentialité. |
| `shared/` | Types communs et mise en forme des noms, importés par chaque paquet. |
| `fixtures/` | Mini-réseau de test commun ([README](fixtures/README.md)), zips GTFS et flux temps réel générés. |
| `tests/e2e/` | Tests de bout en bout : vraies commandes du pipeline et du relais, cœur de l'appli. |
| `.github/workflows/` | `nightly.yml` (« Données de nuit »), `build-app.yml` (« Paquet de l'appli »), `ci.yml` (« Intégration continue »). |
| `docs/` | Guide d'installation en français. |

## Développement

Prérequis : Node 22 (22.18 ou plus récent pour le pipeline), puis `npm ci` dans chaque paquet utilisé (`pipeline/`, `relay/`, `app/`, `tests/e2e/`). Aucune clé n'est nécessaire : tout tourne sur les fixtures.

Pile locale complète, chacun dans son terminal :

```sh
# 1. Données de test (pipeline sur les zips de fixtures), servies sur le port 8787
cd pipeline
G=../fixtures/pipeline/gtfs
QUAI_SOURCES="sncb=$G/sncb.zip,stib=$G/stib.zip,delijn=$G/delijn.zip,tec=$G/tec.zip" \
QUAI_DATE=2026-11-10 npm run build-data -- --out ../.data/fixture-data
npm run serve-data -- --dir ../.data/fixture-data --port 8787

# 2. Faux portail BMC (port 8789) et relais local (port 8788)
cd relay && npm run mock-bmc
cd relay && QUAI_NOW=2026-11-10T12:10:00+01:00 npm run dev

# 3. Appli (port 5173)
cd app && npm run dev
```

Puis ouvrir dans un navigateur (émulateur des lunettes sur la page) :
`http://localhost:5173/?e2e=1&data=http://localhost:8787&relay=http://localhost:8788&mockLat=50.86&mockLon=4.359&mockNow=2026-11-10T12:10:00%2B01:00`.
Sans pile locale, `?fake=1` utilise un faux cœur. Paramètres du mode test : SPEC.md, section 5.3.

Quai Web en local (port 5174, mêmes paramètres) : `cd app && npm run dev:web`, puis
`http://localhost:5174/quai/app/?e2e=1&data=http://localhost:8787&relay=http://localhost:8788&mockLat=50.86&mockLon=4.359`.
Version publiée : `QUAI_DATA_BASE=https://… QUAI_RELAY_BASE=https://… npm run build:web` (dossier `app/dist-web/`, chemin `QUAI_WEB_BASE`, défaut `/quai/app/`) ; le flux de nuit s'en charge.

Simulateur Even Hub : `cd app && npm run sim-tour` parcourt les écrans et enregistre les captures dans `app/test/screens/` (voir l'en-tête de `app/scripts/sim-tour.mjs`).

Paquet `.ehpk` à la main (le workflow « Paquet de l'appli » fait la même chose) :

```sh
cd app
QUAI_DATA_BASE=https://ton-nom.github.io/quai/data QUAI_RELAY_BASE=https://quai-relais.vercel.app npm run configure
npm run pack                      # app/quai.ehpk
npm run configure -- --reset      # remet app.json, privacy.md et config.ts dans l'état du dépôt
```

`configure` n'accepte que des adresses `https` sans `/` final et les inscrit dans la liste blanche de `app.json`. La version du paquet est celle de `app/app.json` ; chaque version a besoin de ses notes dans `app/store/changelog/<version>.txt`.

## Tests

Dans chaque paquet : `npm run typecheck` puis `npm test`.

```sh
(cd pipeline && npm run typecheck && npm test)
(cd relay && npm run typecheck && npm run vercel-build && npm test)
(cd app && npm run typecheck && npm test)
(cd tests/e2e && npm run typecheck && npm test)
```

- Les tests d'intégration de l'appli sur la vraie sortie du pipeline ne tournent que si `.data/fixture-data` existe (commande 1 ci-dessus) ; sinon ils sont ignorés.
- `tests/e2e` lance lui-même le pipeline, le faux portail et le relais sur des ports éphémères (environ 2 minutes).
- Le test de charge du pipeline : `cd pipeline && npm run load-test`.
- Sur GitHub, le workflow « Intégration continue » fait tout cela à chaque push et pull request, avec en plus un paquet `.ehpk` de contrôle. Le simulateur Even Hub n'y est pas installé : la variable `QUAI_SKIP_SIM=1` le signale aux tests.

## Limites connues

- Les formats des vrais serveurs BMC n'ont pas pu être essayés depuis l'environnement de développement : tout est validé sur des fixtures réalistes. Le premier passage de la préparation de nuit et le premier `/api/health` sont donc les vrais tests.
- Temps réel SNCB : la copie du portail BMC ne reprend qu'une partie des trains. Le flux direct de la SNCB (variable `SNCB_RT_URL`) s'obtient sur demande.
- Horaires : deux journées (aujourd'hui et demain). Si la préparation de nuit s'arrête, l'appli n'affiche plus de départs le surlendemain (« Horaires périmés ») plutôt que des horaires faux. GitHub peut désactiver la tâche planifiée après 60 jours sans activité sur le dépôt : le workflow fait un petit commit de maintien, impossible si la branche est protégée.
- Trajets : lignes directes (bus, tram, métro), trains directs ou avec une correspondance, et au plus une ligne urbaine pour rejoindre la gare ou en repartir, marche comprise. Pas de correspondance entre deux bus ou trams.
- Le relais n'a pas d'authentification : qui connaît son adresse peut l'interroger. Les caches (25 s en mémoire, 20 s sur le CDN de Vercel) limitent les appels au portail BMC.
- Usage personnel et non commercial (offre Hobby de Vercel, quotas partagés du portail BMC). Une publication pour tout le monde demanderait une clé dédiée et un hébergement adapté.
- Taille des données réelles estimée entre 300 et 500 Mo (limite de GitHub Pages : 1 Go), sans mesure sur les vrais flux.
