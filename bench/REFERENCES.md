# Références externes du banc d'essai

Ce que proposent deux calculateurs d'itinéraires libres et gratuits, sans Google, pour les cas de `trips.json` : Transitous (moteur MOTIS 2) pour les 150 cas, iRail pour les 45 cas entre deux gares SNCB. Script : `fetch-references.mjs` (Node 22, sans dépendance).

## Lancer

- GitHub : workflow « Banc d'essai (références) », lancement manuel. Artefact `bench-references` (gardé 5 jours) : le contenu de `bench/out/`. Si le stockage des artefacts est inaccessible, cocher « journal » : la même chose est écrite dans le journal du job (archive tar.gz en base64 sur les lignes `BENCH-B64`, empreinte SHA-256 sur la ligne `BENCH-SHA256`), lisible par l'API GitHub (`actions/jobs/<id>/logs`).
- En local, avec accès au réseau : `node bench/fetch-references.mjs` (options `--sources transitous,irail`, `--only t01,t21`, `--out <dossier>`).
- Sans aucune requête, pour refaire le fichier commun à partir de réponses déjà reçues : `node bench/fetch-references.mjs --from-raw <dossier raw> --out <dossier>`.

Ne pas planifier ce flux : Transitous demande d'être prévenu (salon Matrix) avant tout usage automatisé régulier.

## Fichiers

- `references.json` : tous les cas dans le format commun décrit plus bas.
- `raw/transitous/<trajet>_<moment>.json` et `raw/irail/<trajet>_<moment>.json` : URL demandée, heure d'envoi, statut HTTP, quelques en-têtes, corps de la réponse tel quel (`body`, ou `bodyText` s'il ne s'agit pas de JSON), et les deux tentatives s'il y en a eu une seconde.
- `raw/transitous/_serveur.json` : configuration du serveur Transitous (version de MOTIS), lue une fois au début.

## Paramètres

Transitous : `GET https://api.transitous.org/api/v6/plan`. `fromPlace` et `toPlace` : latitude,longitude du banc ; `time` : le moment en UTC (07:30 à Bruxelles donne `2026-11-13T06:30:00Z`). Valeurs envoyées explicitement, car les défauts de MOTIS changent d'une version à l'autre : `arriveBy=false`, `timetableView=true`, `numItineraries=5`, `searchWindow=900`, `transitModes=TRANSIT`, `directModes=WALK`, `preTransitModes=WALK`, `postTransitModes=WALK`, `pedestrianProfile=FOOT`, `maxPreTransitTime=900`, `maxPostTransitTime=900`, `maxDirectTime=1800`, `fastestDirectFactor=1.5` (comme le site transitous.org), `useRoutedTransfers=false`, `joinInterlinedLegs=true`, `detailedLegs=false` (sans tracés), `language=fr`. Vitesse de marche et nombre maximal de correspondances : défauts du serveur (1,2 m/s dans MOTIS 2.10). Temps réel : celui du serveur, quand il existe. À savoir : MOTIS ne cherche aucun transport en commun quand la marche directe prend 5 minutes ou moins, et écarte les trajets plus de 1,5 fois plus longs que la marche directe.

iRail : `GET https://api.irail.be/v1/connections` (le service documenté sous `/connections/`, sans la redirection). `from` et `to` : `BE.NMBS.00` suivi du code SNCB (`sncb:8814258` donne `BE.NMBS.008814258`) ; `date` (jjmmaa) et `time` (hhmm) à l'heure de Bruxelles ; `timesel=departure`, `format=json`, `lang=fr`, `results=6`. `typeOfTransport` n'est pas envoyé (défaut `automatic` : trains nationaux entre deux gares belges).

Règles d'usage suivies : User-Agent `Quai-bench/1.2.2 (+https://github.com/sahiht/quai)` ; une requête à la fois par source ; Transitous au plus une par seconde et 240 par lancement (environ 151 en pratique, sous le seuil de 720 par 24 heures de sa politique d'usage) ; iRail une toutes les 6 secondes (iRail interroge lui-même la SNCB avec un quota partagé) ; au plus une nouvelle tentative par cas, espacée (429, 502, 503, 504 ou coupure réseau) ; source abandonnée après 5 échecs de suite du serveur. Aucune clé, aucun secret.

## Format commun (`references.json`)

`{ generatedAt, sources: { transitous: { params, ... }, irail: { params, ... } }, cases: [...] }`

- `sources.<source>` : adresse, `params` (les variables entre accolades), défauts du serveur non envoyés, User-Agent, espacement, nombre de requêtes envoyées, mention des sources.
- `cases[]` : `{ trip, moment, source, ok, error?, itineraries, raw }`. `ok` : réponse HTTP 200 lue ; `itineraries` peut être vide (rien trouvé) ; `raw` : chemin de la réponse brute.
- Itinéraire : `{ dep, arr, durationMin, transfers, walkTotalMin, walkMaxMin, direct?, legs }`. Heures ISO 8601 avec le décalage de Bruxelles (`+01:00`) ; durées en minutes, à une décimale ; `transfers` : nombre d'étapes en transport moins une ; `walkTotalMin` et `walkMaxMin` : somme et plus longue des étapes à pied ; `direct: true` : trajet à pied seul proposé par Transitous, placé après les autres.
- Étape : `{ mode, line?, trip?, headsign?, operator?, from, to, dep, arr, walkMin?, delayMin?, cancelled? }`. `mode` : `walk`, `train`, `metro`, `tram`, `bus`, `coach` (car longue distance), `ferry`, etc. ; `line` : ligne, ou catégorie du train (`IC`, `S1`, `L`) ; `trip` : numéro du train quand la source le donne ; `from` et `to` : `{ name, lat, lon, id? }`, avec l'identifiant de l'arrêt chez la source ; les noms techniques « START » et « END » de MOTIS sont remplacés par le nom du point du banc.
- Heures attendues : heure prévue plus retard annoncé (`delayMin`, seulement s'il n'est pas nul) ; `cancelled: true` si la source signale une suppression.

## Mentions

- Transitous : itinéraires calculés par Transitous (https://transitous.org). Sources des données : https://transitous.org/sources/. Pour la Belgique : SNCB ; STIB-MIVB, De Lijn et TEC sous licence CC BY 4.0. Réseau piéton et arrêts : © les contributeurs d'OpenStreetMap, licence ODbL (https://www.openstreetmap.org/copyright). Transitous vit de dons : https://transitous.org/donate/.
- iRail : trains de l'API iRail (https://irail.be, https://api.irail.be), d'après les données de la SNCB.
