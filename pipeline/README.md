# Quai : pipeline de nuit (données)

Chaque nuit, ce paquet télécharge les horaires officiels (GTFS) de la SNCB, de la STIB, de De Lijn et du TEC sur le portail de la Belgian Mobility Company, garde les deux journées utiles (aujourd'hui et demain, heure de Bruxelles) et produit de petits fichiers JSON statiques, publiés sur GitHub Pages. L'appli les lit à l'adresse `DATA_BASE` ; leur format est défini dans `shared/types.ts`.

Coût : 0 €. Aucune clé dans le code : la clé du portail est lue dans la variable d'environnement `BMC_KEY` (secret GitHub dans le flux de nuit).

## Prérequis

Node 22.18 ou plus récent (le code TypeScript est exécuté directement par Node, sans compilation), puis `npm ci` dans `pipeline/`.

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run build-data -- --out <dossier> [--site <dossier>] [--cache-dir <dossier>]` | Prépare les données dans `<dossier>` ; avec `--site`, écrit aussi la page d'état `index.html` ; avec `--cache-dir`, garde le GTFS de chaque réseau et le reprend (7 jours au plus) si le flux de la nuit est inutilisable. |
| `npm run serve-data -- --dir <dossier> [--port 8787] [--host 127.0.0.1]` | Petit serveur de test : `Access-Control-Allow-Origin: *`, type JSON correct, gzip si le client l'accepte. |
| `npm run make-fixtures` | Regénère les 4 zips GTFS de test (`fixtures/pipeline/gtfs/`) à partir de `fixtures/network.json`. |
| `npm test` | Tests (Vitest). Le test de charge n'est lancé qu'avec `QUAI_LOAD=1`. |
| `npm run build` | Vérification complète des types (`tsc`, aucun fichier produit : le code s'exécute tel quel). |
| `npm run load-test` | Test de charge : flux synthétique d'environ 2 millions de lignes `stop_times`, durée et mémoire maximale. |

Exemple avec les zips de test (sans clé ni réseau), depuis `pipeline/` :

```sh
G=../fixtures/pipeline/gtfs
QUAI_SOURCES="sncb=$G/sncb.zip,stib=$G/stib.zip,delijn=$G/delijn.zip,tec=$G/tec.zip" \
QUAI_DATE=2026-11-10 npm run build-data -- --out ../.data/fixture-data
npm run serve-data -- --dir ../.data/fixture-data --port 8787
```

Les chemins relatifs (`--out`, `--site`, `--dir`, `QUAI_SOURCES`) sont résolus depuis le dossier où `npm` a été lancé.

## Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `BMC_KEY` | Clé gratuite du portail (compte sur https://api-management-opendata-production.developer.azure-api.net/, abonnement au produit « Standard »). Obligatoire, sauf avec `QUAI_SOURCES`. Jamais affichée : tout message d'erreur est masqué. |
| `BMC_BASE` | Adresse du portail, défaut `https://api-management-opendata-production.azure-api.net`. |
| `QUAI_DATE` | Date de service du jour 0, `AAAA-MM-JJ`. Défaut : aujourd'hui à Bruxelles. Le jour 1 est le lendemain. |
| `QUAI_SOURCES` | Zips locaux à la place du téléchargement, ex. `sncb=a.zip,stib=b.zip,delijn=c.zip,tec=d.zip`. Un opérateur absent de la liste est ignoré et marqué en erreur dans `meta.json`. |

## Téléchargement

- Adresse : `${BMC_BASE}/api/gtfs/feed/{nmbssncb|stibmivb|delijn|tec}/static`, avec les deux en-têtes `bmc-partner-key` et `Ocp-Apim-Subscription-Key`.
- Replis : De Lijn sur `opendata-discovery-gtfs-static.api.production.belgianmobility.io` (même clé, hôte de la BMC) ; TEC sur `https://opendata.tec-wl.be/Current%20GTFS/TEC-GTFS.zip`, sans clé.
- Par adresse : un essai puis 3 nouvelles tentatives (attentes de 2 s, 8 s et 20 s) sur erreur réseau, 408, 429 ou 5xx ; pas de nouvel essai sur 401, 403 ou 404. Délai maximal de 15 minutes par essai, et 60 secondes sans données reçues.
- Redirections suivies une à une : la clé n'est envoyée qu'à l'origine de départ, jamais à un autre hôte.
- Le contenu reçu doit être un zip ; les quatre téléchargements se font en parallèle, les traitements un par un (mémoire).

## Fichiers produits

Tous les JSON sont compacts (sans indentation). `meta.json` est écrit en dernier : un lecteur ne voit jamais un `meta.json` qui annonce des fichiers absents. Les fichiers d'une exécution précédente sont d'abord effacés (`meta.json` en premier).

```
<out>/
  meta.json                  état de chaque réseau (ok, erreur, zones, voyages, version du flux), dates couvertes
  tiles/{ty}_{tx}.json       zones par tuile de 0,02° x 0,03° (tileKey() de shared/types.ts)
  areas/{op}/{fileKey}.json  une zone : arrêts physiques, motifs de desserte, départs des deux jours
  search/{xx}.json           recherche par nom : xx = deux premiers caractères de chaque mot (searchWords/searchKey)
  trains/{AAAA-MM-JJ}.json   trains SNCB de chaque date, avec tous leurs arrêts, heures et voies
  LICENSE-DATA.txt           licence CC BY 4.0 et attribution
<site>/index.html            (avec --site) page d'état en français
```

En fin d'exécution : rapport de taille (nombre de fichiers, total, détail par dossier, plus gros fichiers), durée et mémoire maximale.

Repli (`--cache-dir`) : après une préparation réussie, le zip téléchargé de chaque réseau est gardé avec une fiche `{op}.json` (date du téléchargement). Si le portail ne répond pas, livre autre chose qu'un zip lisible ou un flux sans aucun voyage sur les deux journées, le zip gardé sert s'il a au plus 7 jours : `meta.feeds[op].cachedFrom` donne sa date, la page d'état affiche « horaires du 12/11, le portail n'a pas répondu cette nuit ». Un flux inutilisable ne remplace jamais le zip gardé. Le flux de nuit conserve ce dossier d'une nuit à l'autre avec `actions/cache` (clé `gtfs-…`).

Codes de sortie : 0 si au moins un réseau a réussi ; 1 si tous ont échoué (le site publié la veille reste en ligne) ; 2 si la configuration est invalide. Un réseau en échec n'empêche pas les autres : `meta.feeds[op].ok = false` et un message en français, sans secret. Si la SNCB échoue, les fichiers `trains/` sont écrits vides.

## Règles de préparation

- Lecture en flux : le zip est lu par blocs, `stop_times.txt` ligne à ligne ; seuls les voyages actifs l'un des deux jours sont gardés, en colonnes compactes (environ 17 octets par passage). Ordre : calendrier, lignes, voyages, arrêts, traductions, puis horaires.
- Calendrier : `calendar.txt` et/ou `calendar_dates.txt` (un retrait l'emporte sur un ajout).
- Zones : `parent_station` si présent (SNCB : clé sans le « S » initial, l'arrêt « gare » sans quai compris), sinon même nom (sans casse ni accents, suffixe « perron N » ou « quai X » retiré) à moins de 300 m de proche en proche. Clé : le parent, sinon le plus petit `stop_id` (comparaison de chaînes). Position : le parent, sinon la moyenne. Seules les zones desservies l'un des deux jours sont écrites.
- Noms : `translations.txt` (formats `field_value`, `record_id` et ancien format `trans_id`, langues fr et nl), puis `prettyName()` ; De Lijn : `nl` = nom d'origine, `fr` = `frName(nl)`, `l = 'nl'` ; TEC : `fr` = `nl` ; SNCB : `l = 'nl'` quand le nom d'origine est la traduction nl. Destinations : même logique ; une destination SNCB égale au nom d'une gare reprend ses noms ; destination vide = nom du dernier arrêt.
- Quai : `platform_code`, sinon suffixe du nom (« perron 4 », « quai A »), sinon (SNCB) suffixe numérique de l'identifiant (`8863008_4`).
- `rt` d'un arrêt : STIB = pointid numérique (`6357F` donne `6357`), autres = `stop_id` normalisé. Tous les identifiants passent par `normalizeId()`.
- Départs (`deps`) : un par passage, sauf au dernier arrêt du voyage et aux arrêts sans montée (`pickup_type` 1) ; triés par (jour, minutes) ; minutes depuis minuit du jour de service (au-delà de 1440 après minuit) ; `trip_id` vide pour la STIB. Heures manquantes interpolées.
- Motifs (`patterns`) : ligne + direction + destination + suite des zones (+ rang dans le voyage, pour les boucles) ; `next` = zones suivantes où l'on peut descendre, avec les minutes depuis le départ d'ici, d'après le premier voyage du motif, 60 zones au plus. Deux formes qui ne diffèrent qu'en amont (même ligne, même destination, même `next`) partagent une seule entrée.
- Résumés (`lines`) : 12 lignes au plus, les plus fréquentes, triées par mode (train, métro, tram, bus) puis dans l'ordre naturel.
- Modes : `route_type` 0 tram, 1 métro, 2 train, 3 bus ; 100-117 train, 400-405 métro, 700-716 bus, 900-906 tram ; autres valeurs : rapprochement raisonnable, bus par défaut.

## Flux de nuit (`.github/workflows/nightly.yml`)

- Chaque nuit à 01:15 UTC (02:15 à Bruxelles en hiver, 03:15 en été), à la demande (« Run workflow ») et après chaque envoi sur `main` qui touche `app/`, `shared/` ou ce workflow (Quai Web republié ; les données sont refaites aussi, avec les GTFS gardés en repli).
- Job « Préparer les données » (droits : lecture du dépôt et de la configuration Pages) : vérifie le secret `BMC_KEY` (message clair en français s'il manque), Node 22 avec cache npm, `npm ci`, `npm run build-data -- --out ../site/data --site ../site`, puis Quai Web (`npm ci` et `npm run build:web` dans `app/`, copié dans `site/app/`, avec `QUAI_DATA_BASE` = `https://<compte>.github.io/<dépôt>/data` et `QUAI_RELAY_BASE` = variable de dépôt `vars.QUAI_RELAY_BASE`), puis `actions/configure-pages` et `actions/upload-pages-artifact` (dossier `site`). Sans la variable `QUAI_RELAY_BASE`, ou si Quai Web ne se construit pas, les données sont publiées quand même et `site/app/` contient une page d'explication (avis ou avertissement en français dans le journal).
- Job « Publier sur GitHub Pages » (droits : `pages: write`, `id-token: write`) : `actions/deploy-pages`. Une seule publication à la fois, jamais interrompue.
- Job « Garder la tâche planifiée active » : GitHub désactive sans prévenir les tâches planifiées d'un dépôt public après 60 jours sans activité. Si le dernier commit de la branche par défaut a plus de 30 jours, ce job committe `.github/keepalive.txt` (la date du jour) avec le jeton du flux, au nom de `github-actions[bot]`. C'est le seul job autorisé à écrire (`contents: write`). Un envoi refusé (branche protégée par exemple) ne fait jamais échouer le flux : simple avertissement, il faut alors faire un commit à la main avant 60 jours.

Mise en place, une fois : Settings > Pages > Source : « GitHub Actions » ; Settings > Secrets and variables > Actions > New repository secret, nom `BMC_KEY`. Les données sont ensuite à `https://<utilisateur>.github.io/<dépôt>/data/` (c'est `DATA_BASE`), la page d'état à la racine du site (avec le lien « Ouvrir Quai Web »), Quai Web à `https://<utilisateur>.github.io/<dépôt>/app/`.

## Zips de test (`fixtures/pipeline/`)

`make-gtfs.ts` transforme `fixtures/network.json` en 4 zips GTFS committés (`fixtures/pipeline/gtfs/*.zip`), déterministes (un test vérifie qu'ils sont à jour, octet pour octet). Ils reprennent volontairement les écarts des vrais flux : SNCB avec gares parentes `S<uic>`, arrêt « gare » et quais `<uic>_<n>` (`platform_code`), tous les champs entre guillemets, `translations.txt` au format `field_value` (fr, nl, de, en), `route_type` 109 ; STIB en majuscules, fins de ligne CRLF, traductions `record_id` (arrêts) et `field_value` (destinations) ; De Lijn avec « perron N », colonnes de `stop_times.txt` dans un ordre non standard, colonne inconnue en trop, `route_type` 700 ; TEC avec « quai X », BOM UTF-8, champ entre guillemets contenant une virgule et des guillemets doublés, heures sans zéro initial ; heures au-delà de 24:00 ; `calendar.txt` et `calendar_dates.txt` (WEEK retiré le 2026-11-11, HOLI ajouté) ; `feed_info.txt` avec `feed_version`.

## Performance

Test de charge (`npm run load-test -- --copies 800`), sur la machine de développement (2 cœurs partagés avec d'autres processus) :

| Flux synthétique | Lignes actives (2 jours) | Durée | Mémoire maximale | Sortie |
| --- | --- | --- | --- | --- |
| 1 989 200 lignes `stop_times` | 596 760 | 5,1 s | 289 Mo | 13 455 fichiers, 27,9 Mo |
| 3 978 400 lignes `stop_times` | 1 193 520 | 9,7 s | 370 Mo | 25 490 fichiers, 56,1 Mo |

Débit d'environ 400 000 lignes par seconde ; la mémoire croît d'environ 140 octets par ligne active. Pour le flux réel de De Lijn (de l'ordre de 15 à 30 millions de lignes, dont 3 à 5 millions actives sur deux jours), on attend environ 35 à 75 s et 0,6 à 0,9 Go, bien sous l'objectif de 2,5 Go. La durée dépend du nombre total de lignes lues, la mémoire du nombre de lignes gardées.

Taille : un départ occupe environ 30 à 55 octets (selon la longueur des `trip_id`), un motif environ 100 octets plus 20 à 25 octets par zone de `next`. Pour les quatre réseaux réels, l'estimation est de 300 à 500 Mo : la commande avertit au-delà de 400 Mo (objectif) et de 1 Go (limite de GitHub Pages).

## Limites connues

- `frequencies.txt` n'est pas pris en charge (avertissement dans le journal) : un voyage à fréquence ne compte qu'une fois.
- Les voyages de la veille qui roulent après minuit (heures au-delà de 24:00 du jour précédent) ne sont pas repris dans le jour 0 : le contrat ne couvre que les deux dates de service.
- Fichiers attendus en UTF-8 (BOM accepté) ; un flux en Latin-1 donnerait des caractères de remplacement.
- Un mode inconnu (ferry, téléphérique...) est classé « bus », faute de mieux dans le contrat.
