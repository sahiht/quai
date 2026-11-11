# Réponses types des services d'adresses

Réponses des trois services officiels lus par `GET /api/geocode` du relais (`relay/lib/geocode/sources.ts`), pour les tests de contrat (`relay/test/geocode-sources.test.ts`), et tableau du faux service (`fake-addresses.json`, `npm run mock-geocode`).

« Relevé en direct » : réponse obtenue le 11/11/2026 depuis cet environnement par l'outil WebFetch (le shell n'a pas d'accès général à Internet). L'outil rend le texte de la page : selon la taille, le texte complet ou les valeurs champ par champ. « Reconstitué » : écrit d'après la documentation publiée, sans réponse réelle.

## Fichiers

| Fichier | Requête | Provenance |
|---|---|---|
| `vla/location-veldstraat-1-gent.json` | `geo.api.vlaanderen.be/geolocation/v4/Location?q=Veldstraat 1 Gent&c=5` | Relevé en direct, texte complet. Une accolade fermante en trop à la fin du texte rendu par l'outil (erreur de recopie : les quatre autres objets ferment correctement) a été retirée. |
| `vla/location-gent.json` | `…/Location?q=Gent&c=5` | Relevé en direct champ par champ : `LocationType`, `Municipality`, `Zipcode`, `Thoroughfarename`, `Housenumber`, `ID`, `FormattedAddress`, `Lat_WGS84`, `Lon_WGS84`, ordre. Coordonnées Lambert calculées (`relay/lib/geocode/lambert.ts`) ; `BoundingBox` réduite au point (emprises réelles non relevées). |
| `vla/location-nieuwstraat-1-brussel.json` | `…/Location?q=Nieuwstraat 1 Brussel&c=5` | Comme ci-dessus. Montre que le service flamand couvre Bruxelles (`urbis_huisnummer`, noms néerlandais). |
| `vla/location-empty.json` | `…/Location?q=qxzqxzwvk&c=5` | Relevé en direct, texte complet : `{"LocationResult":[]}`. |
| `wal/searchall-rue-de-fer-25-namur.json` | `geoservices.wallonie.be/geocodeWS/searchAll?address=rue de fer 25 namur&crs=EPSG:4326&geom=true&lang=fr&levels=1,2,3,4,7` | Relevé en direct, texte complet. |
| `wal/searchall-namur.json` | `…/searchAll?address=namur&…` | Relevé en direct, texte complet des 6 premiers candidats sur 10 (les 4 derniers non relevés). |
| `wal/searchall-rue-de-fer-25.json` | `…/searchAll?address=rue de fer 25&…` | Relevé en direct champ par champ (score, ident, niveau, nom, coordonnées à 6 décimales, sauf Namur complète), dont la variante « 25 Rue du Fer 4020 Liège_ » du même `ident`. Mise en forme reprise des relevés complets. |
| `wal/searchall-gare-de-gembloux.json` | `…/searchAll?address=gare de gembloux&…` | Relevé en direct champ par champ, coordonnées complètes (gare : niveau 7, `BE00438`). Mise en forme reprise des relevés complets. |
| `wal/searchall-gembloux-lambert72.json` | `…/searchAll?address=gembloux&levels=7&geom=True` (sans `crs` : EPSG:31370) | Reconstitué d'après l'exemple de la FAQ du SPW (FAQ_geocodeWS, avril 2025) : score `0.0630929768`, `BE00438`, coordonnées `[172835.01647250125, 139989.62418902014]` ; en-tête `geotag` reconstitué. |
| `wal/searchall-empty.json` | `…/searchAll?address=qxzqxzwvk&…` | Relevé en direct (début du texte recopié tel quel, liste `candidates` vide). |
| `bru/searchanyobject-rue-neuve-1.json`, `bru/searchanyobject-rue-neuve.json`, `bru/searchanyobject-empty.json` | `geoservices.irisnet.be/geocoding/api/v1/brussels/geocoding/freeSearch/searchAnyObject?searchLanguage=fr&freeText=…&model=BeStPlus` | Reconstitués (avant le relevé ci-dessous). Le service bruxellois n'a répondu à aucune lecture depuis cet environnement (OpenAPI `/geocoding/v3/api-docs`, Swagger, requête : erreur serveur). Forme `GeocodageSearchTypeV2` relevée dans l'OpenAPI pour `design-routing.md` § 6.1 (`resultsList[].objectType`, `result[]` avec `score` et `address`, `streetname`, `municipality` ou `placeName`, position `pointGeometry.point.pos` avec `srsName`) ; champs de l'adresse d'après le modèle BeSt Address (`houseNumber`, `boxNumber`, `position`, `hasStreetName`, `hasMunicipality`, `hasPostalInfo`, noms `language` / `spelling`). Positions de Rue Neuve 1 et 10 : positions UrbIS rendues par le service flamand, converties en Lambert 72. |
| `bru/searchanyobject-v1-rue-neuve-1-structure-reelle.json` | `geoservices.irisnet.be/geocoding/api/v1/brussels/geocoding/freeSearch/searchAnyObject?searchLanguage=fr&freeText=rue neuve 1&model=BeStPlus` | Structure relevée en direct le 11/11/2026 par WebFetch (chemins des clés, de `inputValues` et `resultsList` jusqu'aux feuilles) ; valeurs relevées pour le 1er résultat (score 13, adresse 169839, numéro 1, Rue Neuve / Nieuwstraat 4611, Bruxelles / Brussel 21004, code postal 1000, position `148962.829 171134.478` en EPSG:31370) et pour le 2e (score 12, Rue Terre-Neuve / Nieuwland, 149139) ; espaces de noms, liens `href`, valeur exacte de `srsName` et position du 2e résultat reconstitués. Le chemin `/api/v2/` ne répond pas : `/api/v1/` est celui de la spécification Geoloc (février 2026). |
| `bru/searchanyobject-variante-churchill.json` | idem | Autre forme plausible (un `result` objet, `policeNumber`, noms `{ fr, nl }`, `pos` en tableau, `srsName` en URN) : vérifie la lecture tolérante. |
| `common/erreur-500.html` | | Page d'erreur HTML type (réponse illisible, HTTP 500 ou 200). |
| `fake-addresses.json` | | Tableau du faux service : PRD annexe A.2, plus « Rue du Progrès 20, 1210 Saint-Josse-ten-Noode » (scénario 4, ajouté par l'équipe données dans `fixtures/network.json`). Un test vérifie que les adresses de `network.json` y figurent avec la même position. |

## Formats lus par le relais

Flandre, Digitaal Vlaanderen, Geolocation v4 `Location` (sans clé ; `c` plafonné à 5 par le service, sans erreur au-delà) :

```json
{"LocationResult":[{"Municipality":"Gent","Zipcode":"9000","Thoroughfarename":"Veldstraat","Housenumber":"1","ID":2327665,
  "FormattedAddress":"Veldstraat 1, 9000 Gent","Location":{"Lat_WGS84":51.0535957,"Lon_WGS84":3.7224103,"X_Lambert72":104681.54,
  "Y_Lambert72":193912.33,"X_Lambert2008":604678.74,"Y_Lambert2008":693907.15},"LocationType":"basisregisters_huisnummer_aangeduidDoorBeheerder",
  "BoundingBox":{"LowerLeft":{…},"UpperRight":{…}}}]}
```

`LocationType` relevés : `basisregisters_gemeente`, `basisregisters_straat`, `basisregisters_huisnummer_aangeduidDoorBeheerder`, `urbis_huisnummer`. Un numéro `…geinterpoleerd` (interpolé) est rendu approximatif. Pas de score : rang dans la réponse. Le service complète le numéro par le début (« 1 » donne 1, 10, 100, 11, 12, dans l'ordre alphabétique) : le classement du relais remet le numéro exact en tête.

Wallonie, SPW, ICAR `searchAll` (sans clé ; `scopes` vaut `["WAL"]` par défaut) :

```json
{"geotag":{"address":"rue de fer 25 namur","levels":"1,2,3,4,7","bbox":false,"geom":true,"crs":"EPSG:4326","scopes":["WAL"],"lang":"fr"},
 "candidates":[{"score":0.032258064,"geotag":{"ident":"367956","level":4,"name":"Rue de Fer 25 5000 Namur","lang":"fr",
   "geometry":{"type":"Point","crs":{"type":"name","properties":{"name":"EPSG:4326"}},"coordinates":[4.865011263015592,50.46540393341745]}}}]}
```

Niveaux : 1 commune (« Namur »), 2 zone d'adresse (« 5000 Namur »), 3 rue (« Rue de la Gare 5030 Gembloux », parfois sans code postal : « Rue Yolande de Namur Namur »), 4 adresse (« Rue de Fer 25 5000 Namur »), 7 gare (« Gare de Gembloux »). Le nom n'a pas de virgule : le relais le découpe (code postal, sinon commune reconnue en fin de nom). `score` : « densité de couverture » du moteur plein texte (FAQ), plus grand = meilleur, sans borne fixe (valeurs relevées de 0,024 à 0,17) ; la liste n'est pas triée par score. Le relais ramène chaque score à celui du meilleur candidat.

Bruxelles, Paradigm, `freeSearch/searchAnyObject` (format non vérifié, voir ci-dessus) : le relais lit `resultsList[].result[]` (tableau ou objet), puis `address`, `streetname`, `municipality` ou `placeName` ; numéro dans `houseNumber` ou `policeNumber` ; noms dans une liste `language` / `spelling`, un objet `{ fr, nl }` ou une chaîne ; code postal dans `hasPostalInfo`, `postalCode` ou `postCode` ; position `pos` (« x y » ou `[x, y]`), `coordinates` ou `{ x, y }`, système lu dans `srsName` (Lambert 72 par défaut, Lambert 2008 et WGS84 reconnus, sinon deviné à l'ordre de grandeur). Une réponse d'une autre forme est « illisible » : le disjoncteur écarte le service et Bruxelles passe par le service flamand (noms néerlandais).

## Contrôle de la conversion Lambert 72

Couples rendus par les services eux-mêmes, retrouvés au centimètre près par `relay/lib/geocode/lambert.ts` (`relay/test/lambert.test.ts`) : gare de Gembloux, Lambert 72 de la FAQ du SPW et position EPSG:4326 rendue par `searchAll` (50,57018 ; 4,69110) ; Veldstraat 1, 10 et 100 à Gand, Lambert 72, Lambert 2008 et WGS84 rendus ensemble par Digitaal Vlaanderen.
