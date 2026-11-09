# Fixtures communes

`network.json` décrit un mini-réseau cohérent (SNCB, STIB, De Lijn, TEC) autour de Namur, Bruxelles-Nord, Bruxelles-Central et Gand, aligné sur les maquettes Visite1-3. C'est la source unique des données de test :

- `fixtures/pipeline/` (équipe données) : générateur `network.json` → 4 zips GTFS réalistes (`sncb.zip`, `stib.zip`, `delijn.zip`, `tec.zip`) ;
- `fixtures/relay/` (équipe relais) : générateur `network.json` → flux GTFS-RT protobuf (trip-update, alert) au format du portail BMC (identifiants préfixés), réponse STIB WaitingTimes, et serveur « faux portail BMC » ;
- `fixtures/app/preset.json` : réglages de démonstration (lieux Maison et Bureau, 5 favoris).

## Conventions

- Dates de service : mardi 2026-11-10 et mercredi 2026-11-11 (jour férié : le calendrier WEEK est retiré, HOLI ajouté). Heure belge = UTC+1.
- Gabarits (`templates`) : un voyage par heure de départ, de `from` à `to` inclus tous les `every` minutes ; `idTpl` remplace `{HHMM}` par l'heure de départ au premier arrêt (ex. `70232{HHMM}` → `702321230`). Décalages en minutes depuis le premier arrêt ; arrivée = départ.
- Voyages explicites (`trips[].st`) : `[stop_id, "HH:MM"]` ou `[stop_id, "arrivée", "départ"]`, heures GTFS pouvant dépasser 24:00. stop_sequence = 1, 2, 3… dans l'ordre.
- Identifiant de zone (AreaSummary.id) : `${op}:${areaKey}` ; areaKey = parent_station (SNCB : sans le « S » initial), sinon le plus petit stop_id du groupe (comparaison de chaînes). Exemples attendus : `sncb:8812005`, `stib:6357F` (Gare du Nord), `stib:6359` (Rogier), `delijn:308611` (Bruxelles-Nord), `delijn:200553` (Gand-Saint-Pierre), `delijn:200101` (Korenmarkt), `tec:N508aga` (Namur Gare).

## Résultats attendus (base pour les tests de bout en bout)

Scène « base » (tout le temps réel de `network.json`) et scène « noRT » (portail injoignable : tout en horaire prévu, signe ~).

**Scénario 1** : 2026-11-10 07:31, position Maison (50.4655, 4.8590), réglages `preset.json`.
- Accueil : suggestion du favori `fav-bureau` (matin). Scène noRT : « Pour le bureau : IC 07:42, voie 4 » puis « partir à 07:33, 7 min à pied ». Scène base : l'IC a +2 min et part voie 6 (départ estimé 07:44, partir à 07:35).
- Autour de moi (rayon 500 m) : 3 zones : Namur Place Léopold (bus TEC, environ 150 m), Namur (train, environ 420 m), Namur Gare (bus TEC, environ 430 m).
- Aller à… Bureau, 1re proposition : marche 7 min, IC 07:42 (voie 4 ; base : 07:44 voie 6), descente Bruxelles-Central 08:46 (base 08:48), marche 12 min, arrivée 08:58 (base 09:00).
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
