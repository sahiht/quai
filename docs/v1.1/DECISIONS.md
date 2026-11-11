# Quai 1.1 : décisions du responsable technique et répartition du travail

Référence pour toutes les équipes de la 1.1. À lire avec `PRD.md` (le quoi), `design-routing.md` (le comment du
calcul de trajets et des adresses), `review-ux.md` et `review-tech.md` (les constats). En cas de désaccord entre
documents : ce fichier, puis le PRD pour les textes et le comportement, puis `design-routing.md` pour l'algorithme.

## 1. Périmètre

- Must M1 à M8 : tous.
- Should S1 à S8 : tous.
- Could : C1 seulement (arrêts des bus, trams et métros dans « Dans le train », puisque les fichiers de ligne
  donnent les arrêts). C2 à C6 : hors 1.1.
- Pas de 1.0.2 séparée (Q14) : le correctif du train choisi sur le téléphone est dans la 1.1.0.

## 2. Réponses aux questions du PRD (§ 9)

| Q | Décision |
|---|---|
| Q1 | Extrémité `address` dans `Endpoint` (pas de lieu implicite). `Journey.label` et `Journey.reason` calculés par le cœur. Réglages v2 (`Settings.v = 2`) : `recent`, `seenVersion`, `display.favOrder`, lieux `src`, `approx`, `areaId`. Migration 1.0 → 1.1 faite (`app/src/settings.ts`, tests `app/test/ui/settings.test.ts`). Le trajet suivi et en cours n'est pas dans les réglages : clé KV `quai.trip` (Q7). |
| Q2 | Adresses par le relais (`GET /api/geocode`), trois Régions (aiguillage par code postal ou commune, sinon les trois en parallèle). Google : désactivé (variable vide). Paradigm national : plus tard, sans changer le contrat. |
| Q3 | M5b et M5c dans la 1.1, sur les fichiers de ligne (`design-routing.md`). Repli 1.0 si `meta.lines` est absent. |
| Q4 | C4 (accessibilité) hors 1.1. |
| Q5 | Seuils du PRD § 4.4 avec les quatre précisions de `design-routing.md` § 4.8, acceptées telles quelles. L'observation Uccle → Evere reste ainsi (règle « moins de marche » sous 30 min d'écart). |
| Q6 | `journeys` et `trip` ne sont plus ouverts par aucun chemin des lunettes. L'équipe lunettes peut supprimer ces écrans s'ils ne servent plus. |
| Q7 | Trajet suivi (M2) et en cours (M6) : clé KV `quai.trip`, écrite par les lunettes ; incluse dans `__getStateSnapshot` / `__restoreState`. Règles de fin : PRD M6.3. |
| Q8 | Ordre intelligent et classement dans le cœur (`orderFavorites`, `answer`, `route`), communs aux lunettes, au téléphone et à Quai Web. |
| Q9 | Noms TEC corrigés la nuit (`shared/names.ts`, pipeline). |
| Q10 | Texte d'attribution : à confirmer par l'équipe relais d'après les conditions publiées de chaque service ; défaut « Adresses : Digitaal Vlaanderen, Paradigm (UrbIS), SPW (ICAR) ». |
| Q11 | C3 (`version.json`) hors 1.1. |
| Q12 | `TrainsDay.trips[].s` : -1 pour une montée ou une descente interdite (fait dans `shared/types.ts`). Identifiants De Lijn raccourcis : non (site à 434 Mo sur 1 Go permis). `nearby(…, { light: true })` pour compter sans départs. |
| Q13 | Contrôles sur données réelles : à la demande, sur l'instantané (`/home/claude/real-data/data`, workflow « Instantané des données » pour le rafraîchir). Pas dans l'intégration continue. |
| Q14 | Pas de 1.0.2. |

## 3. Contrats (faits, à respecter)

- `shared/types.ts` : `Meta.lines`, `AreaSummary.aka`, `TrainsDay` (-1), `LineFile`, `LineIndex`, `LineTile`,
  `GeoSource`, `GeocodeResult`, `GeocodeResponse`, `HealthResponse.geocode` et `.version`.
- `app/src/core/api.ts` (version 2) : `Settings` v2, `Place`, `RecentAddress`, `Endpoint` 'address', `JourneyLabel`
  et `LABEL_TEXT`, `Journey.label` et `.reason`, `Leg.fromStop` et `.toStop`, `PlanResult`, `FavoriteRank`,
  `FavoriteAnswer`, `CoreStatus`, `GeocodeAnswer`, méthodes `route`, `orderFavorites`, `answer`, `geocode`,
  `status`, `nearby(…, { light })`, et pour les lunettes et le téléphone `TripRequest` et `GlassesApi`.
- Les méthodes nouvelles ont des points d'attache provisoires dans `core/index.ts` et `dev/fake-core.ts` : tout
  compile et les 295 tests passent au départ.
- Changer un contrat : demander au responsable technique (`main`), jamais seul. Ajouter un champ facultatif
  documenté dans un type que l'on possède seul : permis, en le signalant dans le rapport final.

## 4. Équipes et fichiers

Tout le monde travaille dans le même dossier (`/home/claude/quai-app`). Chacun ne modifie que ses fichiers.
Fichier partagé : seulement avec l'outil Edit (jamais Write), en relisant juste avant.

| Équipe (nom d'agent) | Possède | Ne touche pas |
|---|---|---|
| Données (`donnees`) | `pipeline/**`, `shared/names.ts`, `fixtures/network.json`, `fixtures/pipeline/**`, `fixtures/README.md`, `tests/e2e/validate-data.ts`, `tests/e2e/data.test.ts`, `.github/workflows/nightly.yml` (si besoin) | `app/`, `relay/` |
| Relais (`relais`) | `relay/**`, `fixtures/relay/**` | `app/`, `pipeline/`, `shared/` (demander) |
| Routage (`routage`) | `app/src/core/routing/**` (nouveau), `app/src/core/plan.ts`, `trains.ts`, `journeys.ts`, dans `core/index.ts` les méthodes `route`, `plan`, `trains`, `refresh` ; `app/test/core/routing*/**`, `plan.test.ts`, `trains.test.ts`, `refresh-alerts.test.ts` ; dans `app/test/core/support/gen-fixtures.ts` la production des fichiers de ligne | interface |
| Cœur (`coeur`) | le reste de `app/src/core/**` (dont `index.ts` hors méthodes du routage), `app/src/settings.ts`, `app/src/dev/fake-core.ts`, le reste de `app/test/core/**`, `app/test/ui/settings.test.ts`, `fixtures/app/preset-1.1.json` | interface, routage |
| Lunettes (`lunettes`) | `app/src/glasses/**`, `app/src/main.ts`, `app/src/boot.ts`, `app/test/ui/**` sauf `settings.test.ts` et `phone-data.test.ts` | cœur, téléphone |
| Téléphone (`telephone`) | `app/src/phone/**`, `app/src/web/**`, `app/src/version.ts` (nouveau), `app/store/**`, `app/app.json`, `app/package.json` (version), `app/vite.config.ts`, `app/vite.web.config.ts`, `app/index.html`, `app/web/**`, `app/test/web/**`, `app/test/ui/phone-data.test.ts`, `app/test/phone/**` (nouveau) | cœur, lunettes |

Ensuite : contrôle qualité de bout en bout (`tests/e2e/**`, simulateur), puis images et guide de mise à jour.

## 5. Ordre et dépendances

1. Données, d'abord : extension de `fixtures/network.json` (annexe A.2 du PRD : Waterloo, retours du soir, ce
   qu'exigent CA-M3.4, CA-M5.2 à CA-M5.4) et zips régénérés, puis message à `routage`, `coeur`, `lunettes`,
   `telephone` et `main`. Le reste du pipeline ensuite.
2. Cœur, d'abord : faux cœur (`dev/fake-core.ts`) complet pour la 1.1 (réponses des favoris, propositions
   étiquetées avec raison, faux géocodage avec le tableau A.2, `status`), puis message à `lunettes` et `telephone`.
3. Routage : sur les fichiers du prototype (`/home/claude/routing-proto/out/`, même format) sans attendre le
   pipeline ; fichiers de ligne des fixtures produits par `gen-fixtures.ts`.
4. Lunettes et téléphone : sur le faux cœur, puis le vrai.

## 6. Règles communes

- Textes : ceux du PRD § 6 mot pour mot ; espace insécable (U+00A0) devant « : », « ; », « ! », « ? » et entre un
  nombre et son unité ; guillemets « » ; jamais de tiret cadratin ni de tiret demi-cadratin dans un texte affiché.
- Lignes des lunettes mesurées au pixel avec la police (`glasses/font.ts`), comme en 1.0.
- Secrets : la clé BMC n'apparaît nulle part (code, tests, journaux, paquet). Aucun appel réel au portail BMC.
- Vie privée : seul le texte tapé part vers le service d'adresses (jamais la position, jamais un identifiant).
- Pas de `git commit` ni de `git push` : le responsable technique s'en charge.
- Chaque équipe lance les tests et la vérification des types de son paquet avant de rendre son travail.
- Rapport final court : fichiers modifiés, tests ajoutés et résultat, écarts au PRD, points ouverts.

## 7. Ajustements décidés pendant la construction

- `FavoriteAnswer.state` 'none' = aucun trajet ni départ dans l'horizon de recherche (environ 23 h). Une réponse
  lointaine reste 'ok' (« partir à 17:13 », « partir demain 06:20 ») ; la règle 5 de l'ordre (« rien dans les
  3 heures ») se lit sur l'heure de la réponse.
- CA-M2.7 (trajet à pied) : la position du PRD (50.8460, 4.3500) est à 279 m du Bureau, donc « tu y es ». Le test
  utilise (50.8480, 4.3520), à 9 min à pied.
- M8.6 : nouveau code `QuaiError` 'dataUnreachable' (« Horaires injoignables : nouvel essai dans 30 s ») pour
  réseau coupé, délai dépassé ou erreur serveur ; 'dataUnavailable' seulement quand le serveur répond sans le
  fichier. `tests/e2e/robustness.test.ts` est à aligner au contrôle qualité.
- Réseau de test 1.1 (équipe données) : scénario 4 de Waterloo vers « Rue du Progrès 20, 1210 Saint-Josse-ten-Noode »
  (3 min de Rogier) ; le T3 vers Esplanade ne s'arrête plus à Gare du Midi ; Roi Baudouin déplacé de 25 m.
  Valeurs attendues : `fixtures/README.md`, section « Extension 1.1 ».
- CA-M2.1 et CA-M2.2 : le 10/11, le réseau de test n'a que deux IC du matin depuis Namur (07:42 et 08:42). Le
  trajet Maison → Bureau a donc deux propositions (« Le plus simple », puis « Le suivant : même trajet, 1 h plus
  tard ») et ▼ sur la page 2 affiche « Pas d’autre trajet pour l’instant ». La navigation sur trois pages se teste
  sur un cas qui a trois propositions : Rue Neuve 1 en scène noRT (simple 07:33 → 08:56, fast 07:33 → 08:51,
  next 08:33 → 09:56) ou Waterloo à 07:31 (simple 07:32 → 08:46, fast 07:34 → 08:30, next 07:52 → 09:04).
- `Journey.reason` : une ligne des lunettes mesurée au pixel (542 px), pas 48 caractères ; trois marches restent
  listées comme dans le PRD (« Le plus simple : 1 changement, à pied 2 + 1 + 1 min »).
- Lunettes : toucher un autre favori ou un lieu pendant un trajet en cours montre la proposition sans remplacer le
  trajet suivi ; il faut toucher pour le suivre (« Trajet suivi : … »). Toucher le favori du trajet en cours rouvre
  ce trajet. Dernière page des étapes : la ligne du bas reste « ▲ trajet précédent », ▼ affiche « Pas d’autre trajet
  pour l’instant ». Hors ligne, la ligne du haut dit « Pas de réseau : horaires prévus ~ ». Validé.
- Téléphone : réponse courte d'un trajet favori « partir à 07:33 » (pas de compte à rebours) ; enregistrer un lieu
  sous un nom existant met ce lieu à jour (favoris gardés) ; carte « Adresses » « Disponible, sauf en Wallonie »
  quand une seule Région est en panne ; le téléphone n'écrit jamais seenVersion. Validé.
- M6.3 : la fin anticipée d'un trajet en cours (position encore à moins de 300 m du départ) n'est appliquée que 3 min
  après le départ du premier véhicule, pour ne pas arrêter un suivi lancé depuis le quai. Validé.
- Ordre des favoris, règle 5 (« rien dans les 3 heures ») : elle se lit sur les dernières réponses connues ; à la
  toute première ouverture de la journée, un favori lointain (« Vers la maison, partir à 16:12 » le matin) peut donc
  rester en 2e place jusqu'à l'ouverture suivante. Limite connue, gardée pour la 1.1.
- Brussels (Paradigm) : chemin `api/v1` de la spécification Geoloc (février 2026), structure de réponse relevée en
  direct le 11/11/2026 ; `api/v2` ne répond pas.

