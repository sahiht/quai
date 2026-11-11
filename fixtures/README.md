# Fixtures communes

`network.json` décrit un mini-réseau cohérent (SNCB, STIB, De Lijn, TEC) autour de Namur, Bruxelles-Nord, Bruxelles-Central, Gand et (1.1) Waterloo, aligné sur les maquettes Visite1-3. C'est la source unique des données de test :

- `fixtures/pipeline/` (équipe données) : générateur `network.json` → 4 zips GTFS réalistes (`sncb.zip`, `stib.zip`, `delijn.zip`, `tec.zip`) ;
- `fixtures/relay/` (équipe relais) : générateur `network.json` → flux GTFS-RT protobuf (trip-update, alert) au format du portail BMC (identifiants préfixés), réponse STIB WaitingTimes, et serveur « faux portail BMC » ;
- `fixtures/app/preset.json` : réglages de démonstration (lieux Maison et Bureau, 5 favoris).

## Conventions

- Dates de service : mardi 2026-11-10 et mercredi 2026-11-11 (jour férié : le calendrier WEEK est retiré, HOLI ajouté). Heure belge = UTC+1.
- Gabarits (`templates`) : un voyage par heure de départ, de `from` à `to` inclus tous les `every` minutes ; `idTpl` remplace `{HHMM}` par l'heure de départ au premier arrêt (ex. `70232{HHMM}` → `702321230`). Décalages en minutes depuis le premier arrêt ; arrivée = départ.
- Voyages explicites (`trips[].st`) : `[stop_id, "HH:MM"]` ou `[stop_id, "arrivée", "départ"]`, heures GTFS pouvant dépasser 24:00. stop_sequence = 1, 2, 3… dans l'ordre.
- Identifiant de zone (AreaSummary.id) : `${op}:${areaKey}` ; areaKey = parent_station (SNCB : sans le « S » initial), sinon le plus petit stop_id du groupe (comparaison de chaînes). Exemples attendus : `sncb:8812005`, `stib:6357F` (Gare du Nord), `stib:6359` (Rogier), `delijn:308611` (Bruxelles-Nord), `delijn:200553` (Gand-Saint-Pierre), `delijn:200101` (Korenmarkt), `tec:N508aga` (Namur Gare) ; 1.1 : `sncb:8814266` (Waterloo), `tec:Bwategl1` (Waterloo Eglise), `tec:Bbxlmid1` (Bruxelles Midi), `tec:Bbrlgar1` (Braine-l’Alleud Gare), `stib:8302` (Roi Baudouin).
- Noms : `network.json` donne les noms tels qu'écrits dans le GTFS (STIB en capitales, TEC de la ligne W avec la commune en capitales, « perron » et « quai » dans le nom) ; les fichiers publiés les remettent en forme (`shared/names.ts`). Les zips ajoutent quelques particularités des vrais flux absentes de `network.json` (en-tête de `make-gtfs.ts`), dont le préfixe « T » des trams De Lijn dans `route_short_name` (« T1 », la ligne publiée reste « 1 »).
- `addresses` (1.1) : adresses des scénarios porte à porte, en complément du tableau A.2 du PRD pour les faux services d'adresses (`rogier` : destination du scénario 4, à 3 min à pied de Rogier et 5 min de Bruxelles-Nord).

## Résultats attendus (base pour les tests de bout en bout)

Scène « base » (tout le temps réel de `network.json`) et scène « noRT » (portail injoignable : tout en horaire prévu, signe ~).

**Scénario 1** : 2026-11-10 07:31, position Maison (50.4655, 4.8590), réglages `preset.json`.
- Accueil : suggestion du favori `fav-bureau` (matin). Scène noRT : « Pour le bureau : IC 07:42, voie 4 » puis « partir à 07:33, 7 min à pied ». Scène base : l'IC a +2 min et part voie 6 (départ estimé 07:44, partir à 07:35).
- Autour de moi (rayon 500 m) : 3 zones : Namur Place Léopold (bus TEC, environ 150 m), Namur (train, environ 420 m), Namur Gare (bus TEC, environ 430 m).
- Aller à… Bureau (1.2.1 : le moins de marche d'abord, marche maximale 10 min), 1re proposition : marche 7 min, IC 07:42 (voie 4 ; base : 07:44 voie 6), descente Bruxelles-Nord 08:40 (base 08:42), marche 2 min, T3 08:44 Gare du Nord → Bourse 08:49, marche 9 min, arrivée 08:58 (base aussi : la correspondance tient), « Le plus court : 1 changement, à pied 7 + 2 + 9 min ». Scène noRT : puis l'IC direct jusqu'à Bruxelles-Central 08:46 et 12 min à pied (au-dessus de la marche maximale), même arrivée, « Sans changement : à pied 7 + 12 min », puis « Le suivant » (IC 08:42 et T3 09:48, 08:33 → 10:02). Scène base : le direct arriverait à 09:00, plus tard avec plus de marche : plus proposé ; « Le suivant » 08:33 → 10:02, puis « Plus tard » IC 08:42 et T4 09:43, 08:33 → 09:57, « Plus tard : 1 changement, départ 08:33 ».
- Étapes, scène base : alerte en tête « ! Voie modifiée : l’IC part de la voie 6 ».

**Scénario 2** : 2026-11-10 12:10, position (50.8600, 4.3590).
- Ouverture : le favori `fav-gdn` (à moins de 300 m) s'ouvre seul. Départs (filtrés T3, T3, T4) : T3 Churchill 2 min, T4 Stalle (P) 5 min, T3 Esplanade 6 min, T3 Churchill 10 min, T4 Stalle (P) 13 min, tous en temps réel.
- Autour de moi : 4 zones dans cet ordre : Gare du Nord, tram (≈ 80 m, T3 2 min) ; Bruxelles-Nord, train (≈ 160 m, IC 12:22 voie 9) ; Bruxelles-Nord, bus De Lijn (≈ 200 m, 232 ~5 min) ; Rogier, métro (≈ 340 m, M2 3 min).
- Bruxelles-Nord, bus De Lijn : 232 Vilvorde ~5 min ; 460 Meise 10 min (+2) ; 270 Kortenberg ~12 min ; 232 Vilvorde 20 min ; 232 Vilvorde 36 min (+1).
- Bruxelles-Nord, train : IC 12:22 voie 9 vers Anvers-Central (à l'heure) ; IC 12:30 voie 12 (~, pas de temps réel) ; S1 12:34 SUPPRIMÉ.

**Scénario 3** : 2026-11-10 13:55, position Bruxelles-Central.
- Recherche « Gand » (téléphone) : Gand-Saint-Pierre (gare SNCB), Gand-Dampoort (gare SNCB), Korenmarkt, Gand (tram De Lijn), Gand-Saint-Pierre (tram De Lijn).
- Trains Bruxelles-Central → Gand-Saint-Pierre dès 13:55 : 14:10 → 14:39 voie 4 à l'heure ; 14:22 → 14:56 voie 6 +3 min ; 14:40 → 15:09 voie 4 à l'heure.
- Arrivée à Gand-Saint-Pierre : tram 1 vers Korenmarkt à 14:44 (à l'heure) et 14:53 (+1).

**Correspondance** : Namur → Gand-Saint-Pierre à 07:31 : IC 07:42, changement à Bruxelles-Central (ou Bruxelles-Nord), IC vers Bruges, arrivée 09:29.

**Jour férié** : le 2026-11-11, à Namur, seuls partent l'IC 08:42 (DAILY) et l'IC 09:42 (HOLI).

**Après minuit** : IC 2199 à Bruxelles-Nord à 24:01 (= 00:01 le 11) ; bus TEC 4 à 24:10.

## Extension 1.1 (PRD annexe A.2, CA-M3.4, CA-M3.5, CA-M5.2, CA-M5.3)

Ajouts au réseau (les résultats attendus de la 1.0 ci-dessus restent vrais) :

- **SNCB, gare de Waterloo** `sncb:8814266` (50.7154, 4.3835), quais 1 et 2. S1 1960 à 1967 (DAILY) Nivelles → Waterloo → Bruxelles-Midi → Bruxelles-Central → Bruxelles-Nord (terminus, aucun départ ajouté à Bruxelles-Nord) : Nivelles HH:10 et HH:40, Waterloo +15 (06:25 à 09:55, toutes les 30 min, voie 1), Midi +35 (voie 6), Central +40 (voie 1, 25 min après Waterloo), Nord +45 (voie 3).
- **Retours du soir** : IC 2137 et 2138 (DAILY) Bruxelles-Midi 17:06 / 18:06 (voie 6) → Bruxelles-Central **17:12 / 18:12** (voie 5) → Bruxelles-Nord 17:17-17:18 / 18:17-18:18 (voie 3) → Schuman → Luxembourg → Ottignies → Gembloux → Namur **18:16 / 19:16** (voie 5).
- **TEC, ligne W** (`tec:B0536-23747`, bus, DAILY, toutes les 20 min) : vers « BRUXELLES Midi » (`W-HHMM`) BRAINE-L'ALLEUD Gare `Bbrlgar1` HH:04, HH:24, HH:44 → WATERLOO Eglise `Bwategl1` +12 (06:16 à 21:56) → BRUXELLES Midi `Bbxlmid1` +57 (45 min après Waterloo) ; retour vers « BRAINE-L'ALLEUD Gare » (`WR-HHMM`) `Bbxlmid2` HH:10, HH:30, HH:50 → `Bwategl2` +45 → `Bbrlgar1` +57. Zones : `tec:Bwategl1` (50.7174, 4.3979), `tec:Bbxlmid1` (50.8361, 4.3352, à 80 m du métro STIB Gare du Midi `8402` et à 90 m de la gare SNCB), `tec:Bbrlgar1`.
- **Changements du réseau 1.0** : le T3 vers Esplanade (`1203HHMM`) ne s'arrête plus à Gare du Midi (arrêt `6365` sans passage ; mêmes heures à Rogier et à Gare du Nord), pour que seul le métro M2 mène de Gare du Midi à Rogier (scénario 4) ; Roi Baudouin `8302` déplacé de 25 m (50.8913, 4.3345), à 1 min à pied du boulevard du Centenaire 1.

Résultats attendus (horaire prévu ; marche maximale 10 min ; minutes de marche = `walkMinutes` de la 1.0, à 2 min près selon les règles de correspondance du cœur). Classement de la 1.2.1 (docs/v1.2.1/PRD-1.2.1.md § 1) : palier de marche = 0 jusqu'à la marche maximale, puis un par tranche de 5 min ; la proposition 1 est le trajet le plus rapide du palier le plus bas qui arrive au plus 30 min après le trajet le plus tôt ; noms et raisons du § 2 :

**Scénario 4 (Waterloo, cas H)** : 2026-11-10 07:31, départ « Chaussée de Bruxelles 1, 1410 Waterloo » (50.7175, 4.3990), arrivée « Rue du Progrès 20, 1210 Saint-Josse-ten-Noode » (50.8582, 4.3600). Mêmes résultats en scène base et noRT.
- `short` (affiché « Moins de marche », 07:32 → 08:46) : 2 min à pied, bus W 07:36 à Waterloo Eglise, Bruxelles Midi 08:21, 2 min à pied, métro M2 08:29 vers Simonis, Rogier 08:43, 3 min à pied, arrivée 08:46 : « Moins de marche : 1 changement, à pied 2 + 2 + 3 min ».
- `earlier` (« Plus tôt », 07:34 → 08:30) : 19 min à pied jusqu'à la gare de Waterloo, S1 07:55 voie 1, Bruxelles-Nord 08:25, 5 min à pied, arrivée 08:30 : « Plus tôt de 16 min, mais 19 min à pied ». 19 min à pied : palier 2 ; le bus, au palier 0, arrive 16 min après, sous le garde-fou de 30 min.
- `next` (« Le suivant », 07:52 → 09:04) : bus W 07:56, M2 08:47, arrivée 09:04 : « Le suivant : même trajet, 20 min plus tard ».
- Pas d'autre chemin plus simple : le bus puis le S1 de Bruxelles-Midi (08:45) arrive à 09:00 ; aucun tram ne va de Gare du Midi vers Rogier.

**CA-M5.2** : position S2 (50.8600, 4.3590) à 12:10 vers « Boulevard du Centenaire 1, 1020 Bruxelles » (50.8915, 4.3340) : 6 min à pied jusqu'à Rogier, M6 12:25 vers Roi Baudouin (le 12:15 part trop tôt), Roi Baudouin 12:39, 1 min à pied, arrivée 12:40 : « direct, à pied 6 + 1 min ». L'autre chemin (T3 jusqu'à Esplanade puis 15 min à pied) compte un changement.

**CA-M5.3** : « Avenue Winston Churchill 100, 1180 Uccle » (50.8080, 4.3650) à 08:00 vers le boulevard du Centenaire 1 : 2 min à pied jusqu'à Churchill, T3 08:09 vers Esplanade (08:01 part trop tôt), Rogier 08:30, M6 08:35, Roi Baudouin 08:49, 1 min à pied, arrivée 08:50 (1 changement). La 1.0 ne trouve aucun trajet.

**CA-M3.4** : Maison 07:31, scène `noRT`, vers « Rue Neuve 1, 1000 Bruxelles » (50.8505, 4.3545) : `short` IC 07:42 jusqu'à Bruxelles-Nord 08:40 (avant Central), 2 min à pied, T3 08:44 Gare du Nord → De Brouckère 08:48, 3 min à pied, arrivée 08:51, « Le plus court : 1 changement, à pied 7 + 2 + 3 min » ; `none` IC 07:42 jusqu'à Bruxelles-Central 08:46, 10 min à pied (palier 0), arrivée 08:56, « Sans changement : à pied 7 + 10 min » ; `next` IC 08:42 et T3, arrivée 09:55.

**Le soir** : depuis Bruxelles-Central, IC 17:12 et 18:12 vers Namur (arrivées 18:16 et 19:16), aussi le 11/11. Depuis le Bureau (12 min à pied de Bruxelles-Central) vers la Maison, 1.2.1 : demandé à 15:00 ou 16:30, d'abord 9 min à pied, T3 16:57 Bourse → Gare du Midi, IC 17:06 de Bruxelles-Midi (le même train), arrivée 18:16, « Le plus court : 1 changement, à pied 9 + 1 + 7 min », puis l'IC 17:12 à Bruxelles-Central après 12 min à pied, « Sans changement » (même arrivée) ; demandé à 07:31, 12:00 ou 16:55, l'IC 17:12 direct d'abord.

**Noms (pipeline 1.1)** : « Waterloo Eglise », « Bruxelles Midi », « Braine-l’Alleud Gare » (capitales de la commune retirées, sans accent inventé) ; départs de Waterloo Eglise « W Bruxelles Midi » ; tram De Lijn « 1 » (jamais « T1 ») ; zones sans aucun départ absentes des tuiles et de la recherche (`sncb:8821006` Anvers-Central, `sncb:8891009` Bruges, `stib:6370` Stalle, `stib:8302` Roi Baudouin, `delijn:300120`, `delijn:300450`, `delijn:301870`, `tec:N520aaa`, `tec:N530aaa`, `tec:N540aaa`), mais présentes dans `areas/` et dans les fichiers de ligne.

**Comptes** : SNCB 15 zones, 21 voyages (`trains/` : 20 le 10/11, 18 le 11/11) ; STIB 10 zones ; De Lijn 7 ; TEC 8.
