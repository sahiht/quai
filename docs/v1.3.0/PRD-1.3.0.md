# Quai 1.3.0 : spécification

Version décidée par le propriétaire le 15/11/2026, entre 10:03 et 10:56, après ses essais de la 1.2.10 sur Quai Web.
Base : `main` au commit 2a907bc (Quai 1.2.10). Branche d'intégration : `v130`.

## 0. Décisions du propriétaire (à respecter à la lettre)

1. Écran du trajet : garder le toucher actuel (« y aller ») et ajouter une ligne bien visible « ▶ Y aller ».
2. « Autres trajets » : ▲ sur la première ligne ramène au trajet proposé.
3. Tableaux : « toucher : où descendre » au lieu de « toucher : arrêts ».
4. Hors de Belgique : le dire clairement, puis seulement les minutes et la direction, sans faux virages.
5. Noms coupés entre deux mots partout.
6. Accompagnement pendant le guidage, **tout dans Quai, aucune appli à installer, aucun service tiers** : test de
   l'écran, message rappelé s'il n'est pas vu, vérification au départ, journal de trajet.
7. Favoris en accordéon : le détail s'ouvre sous le favori où est le curseur, sur deux lignes plus claires, et se
   referme quand le curseur passe au suivant.
8. Vérifier les « … » restés à droite de certains favoris (constat sur Quai Web, 15/11 à 10:53).
9. Deux contrôles indépendants (usager et technique) avant publication, zéro remarque ouverte.

Rappels de la 1.2.10, inchangés : écran calme, une chose à la fois, une heure et pas un conseil, rien ne démarre
seul, la position ne quitte jamais le téléphone, pas de Google, typographie française (espace insécable avant « : ; !
? », jamais de tiret long ni moyen), tutoiement, tout tient au pixel.

## 1. Ligne d'action de l'écran du trajet

Écran `steps`. Nouvelle ligne `GlassesView.action`, au plus clair (niveau 4), juste au-dessus des aides. Elle dit ce
que fait un toucher sur cet écran, d'après l'intention du toucher :

| Cas | Ligne d'action | Aides |
|---|---|---|
| trajet pas encore guidé, réglage « Me guider » allumé | « ▶ Y aller » | « △▽ étapes   double : retour » |
| ce trajet est guidé | « ▶ Retour au guidage » | idem |
| réglage éteint, trajet pas suivi | « ▶ Suivre ce trajet » | idem |
| réglage éteint, trajet suivi | « ▶ Trajet suivi » (toucher : son écran, comme en 1.2.10) | idem |
| toucher sans effet | pas de ligne d'action | « △▽ étapes   double : retour » |

Le « toucher : … » quitte la ligne d'aide (il est dans la ligne d'action). La ligne prend une rangée aux étapes ;
« Fin du trajet. ▽ … » reste. Même règle pour un autre trajet ouvert depuis « Autres trajets ». Tout tient au pixel.

## 2. ▲ pour revenir des autres trajets

Dans « Autres trajets » (`others`), ▲ sur la première rangée revient à l'écran du trajet proposé, à l'endroit où il
était (sa dernière page, « Fin du trajet »). Contrat : la vue met `edgeUp: true` ; la navigation rend alors
`{ kind: 'edge', dir: 'up' }` au lieu de « rien » ; le contrôleur dépile si l'écran d'avant est `steps`. Les aides de
« Autres trajets » ne changent pas.

## 3. « où descendre »

Aides `board` (tableau d'une gare ou d'un arrêt) et `line` (une ligne à son arrêt) : « △▽ départs   toucher : où
descendre   double : retour » (« △▽ passages » pour `line`). Le toucher ne change pas : il ouvre la liste des arrêts du
départ, où l'on choisit « j'y descends ».

## 4. Hors de Belgique

- Routeur (`core/walk/router.ts`) : un chemin droit porte sa raison, `WalkRoute.reason` : `outside` quand la tuile
  piétonne d'un des deux bouts n'existe pas (hors de l'extrait de Belgique), sinon `nosnap`, `nopath` ou `far`.
- Moteur : une marche dont le chemin est `outside` n'annonce aucun virage (comme aujourd'hui) et donne une fois, au
  début de cette marche (ou au lancement si l'on marche déjà), le moment `offMap` : `walkMin`, `distM` (à vol
  d'oiseau), `bearingDeg` (direction de la cible par rapport à la marche, si le cap est connu), `toward`. Fin : 30 s ou
  un toucher. Priorité : après `leave`, avant `check` (types posés dans `guide-types.ts`, ordre posé dans `PRIO`).
  « Où tu en es » à pied : `walk.offMap = true` et `walk.crowM`.
- Écran du moment `offMap` : « Hors de Belgique » au plus clair ; « pas de chemin à pied : suis la flèche » (sans cap :
  « pas de chemin à pied ») ; pâle « 6 min jusqu'à l'arrêt X » (dernière marche : « jusqu'à {titre} »). Image : la
  flèche de direction (`bearing`) si le cap est connu, sinon le panneau « à pied / 6 / min ».
- « Où tu en es » à pied, hors de Belgique : « À pied vers l'arrêt X » ; « 450 m à vol d'oiseau, 6 min » ; pâle
  « hors de Belgique, pas de chemin à pied ».

## 5. Noms coupés entre deux mots, partout

Toute rangée de tableau, de liste d'arrêts, de toute la ligne et de « Autres trajets » coupe un nom trop long au mot,
ou après un morceau entier d'un nom composé (« Wervicq/… », « Bruxelles-… »), jamais au milieu d'un mot ; un premier
mot seul trop long reste coupé au caractère (aucune autre issue). Les heures, l'état (« SUPPRIMÉ », « marge 2 min ») et
les voies ne sont jamais coupés. Les balayages des vraies données (`test/scan`) comptent les rangées coupées au milieu
d'un mot : **0** exigé.

## 6. Accompagnement pendant le guidage, tout dans Quai

Ce que permet le matériel (vérifié le 15/11 dans la documentation d'Even) : rien pour allumer l'écran, le garder
allumé, vibrer ou notifier ; l'écran s'allume quand on lève la tête au-delà d'un angle réglable (0 à 60°) ; le
capteur de mouvement des lunettes est lisible (`imuControl`, mesures x, y, z) ; la batterie et le port des lunettes
arrivent avec l'état de l'appareil. La documentation ne dit pas si un nouveau message allume l'écran : le test le
mesure chez la personne.

### 6.1 Test de l'écran des lunettes

Téléphone, « Réglages », groupe « Pendant un trajet », sous « Me guider pendant un trajet » : bouton « Tester l'écran
des lunettes ». Pas dans Quai Web (pas de lunettes). Contrat : `GlassesApi.displayTest(cmd)` et `onDisplayTest(cb)`
(`DisplayTestCmd`, `DisplayTestState` dans `core/api.ts`), écran `displayTest` des lunettes.

1. **wait** (45 s) : le téléphone dit « Mets tes lunettes, regarde devant toi, la tête droite, et ne touche à rien
   pendant 45 secondes » avec un compte à rebours. Les lunettes montrent « Test de l'écran » et « Ne touche à
   rien ». Quai ouvre le capteur de mouvement (100 ms) pour la position de repos.
2. **sent** (15 s) : Quai envoie une nouvelle page entière (`rebuild`) : « Touche une fois les lunettes ». Un toucher
   dans les 15 s : résultat **visible**, fin.
3. **ask** : sinon, le téléphone demande « Lève la tête. Que vois-tu dans les lunettes ? » avec trois boutons : « Le
   test de Quai » (résultat **headUp**), « Le Dashboard » (**dashboard**), « Rien » (pas de résultat, conseil de
   vérifier « Head-Up » dans l'appli Even). Pendant cette étape, Quai apprend le mouvement « lever la tête » : l'axe
   qui change le plus par rapport au repos, son sens et son écart (`Settings.display.headUp`), seulement si le
   changement est net (au moins trois fois le bruit du repos).
4. **done** : résultat gardé dans `Settings.display.alert` (et `headUp`). Le téléphone dit quoi faire :
   - visible : « Les messages de Quai se voient sans rien faire. S'il le faut, Quai les rappelle. »
   - headUp : « Lève un peu la tête pour voir les messages. Pour le moindre mouvement : dans l'appli Even, règle
     l'angle d'affichage au plus bas. »
   - dashboard : « En levant la tête, tu vois le Dashboard. Pendant un trajet, touche une fois les lunettes pour
     voir Quai. »

Annuler à tout moment (« Arrêter le test ») ; Quai fermé sur les lunettes : « Ouvre Quai sur les lunettes, puis
recommence. » Le capteur est fermé à la fin, toujours.

### 6.2 Rappel des messages

- Messages importants : `leave`, `board`, `platform`, `alight`, `replan`, `passed`.
- Si `Settings.display.alert` vaut `visible` ou n'existe pas : un message important affiché, ni effacé d'un toucher ni
  vu (ci-dessous) au bout de 45 s, est renvoyé en page entière (même contenu) ; 2 rappels au plus (3 envois en
  tout), 45 s d'écart, tant que le moment dure. Un toucher, un nouveau moment ou la fin du moment arrêtent les rappels.
- « Vu » : si le mouvement « lever la tête » est appris (`headUp`), Quai ouvre le capteur (200 ms) seulement pendant
  qu'un message important attend d'être vu ; un mouvement de plus de 60 % de l'écart appris, dans le bon sens, tenu
  0,6 s, compte comme vu (pas de rappel). Capteur fermé dès que c'est vu, effacé ou fini. Sans apprentissage, ou si
  l'hôte refuse le capteur (`imu()` faux) : rappels à l'heure seulement.
- `headUp` ou `dashboard` : aucun rappel (il ne serait pas vu) ; le message reste affiché comme en 1.2.10.
- Le journal (§ 6.4) note chaque envoi, chaque rappel et chaque « vu ».

### 6.3 Vérification au départ et en route (moment `check`)

- Au lancement : batterie des lunettes sous 20 % (signal `device`, `battery`) : « Lunettes : 12 % de batterie » ;
  aucune position dans les 30 s alors que le guidage en a besoin : « Pas de position : guidage à l'heure » et pâle
  « Position « Toujours » pour l'appli Even, sur le téléphone ».
- En route : plus aucune position depuis 3 min alors que la phase en demande et qu'il y en avait : « Position perdue
  depuis 3 min » et pâle « guidage à l'heure en attendant » (une fois par guidage).
- Moment `check` (titre de la ligne : les problèmes, une ligne chacun, deux au plus), fin 20 s ou un toucher, jamais
  devant une action (priorité). La carte « En cours » du téléphone montre la même ligne.
- Entrée du moteur : `GuideInput.battery` (posée dans `core/guide.ts`) ; la perte de position se lit dans les
  positions données au moteur.

### 6.4 Journal de trajet

- Contrat : `core/journal-types.ts` (`TripJournal`, `JournalTrip`, `JournalEvent`). Gardé sur le téléphone seulement
  (clé `quai.journal`), 10 trajets et 60 ko au plus, le plus ancien oublié d'abord.
- **Jamais de coordonnées ni d'adresse** : des heures, des sortes d'événements, des noms d'arrêts et de gares publics,
  des nombres. Le journal refuse toute clé `lat`, `lon`, `latitude`, `longitude`, `address` (test).
- Écrit par le contrôleur : début (titre, genre), moments affichés (sorte, id), effacés, rappels, vus, montée et
  descente constatées, recalculs, arrêt dépassé, arrivée, résumé des positions toutes les 5 min (nombre, précision
  médiane, plus long trou), premier plan quitté et revenu, lunettes déconnectées et reconnectées, batterie au départ,
  vérifications, fin (`done`, `stopped`, `ended`, `replaced`).
- Téléphone : « Réglages », « Données », carte « Journal des trajets » : les 10 derniers (titre, date, durée, fin) ;
  toucher l'un : son texte ; boutons « Copier » (presse-papiers) et « Effacer le journal ». Le texte commence par
  « Journal Quai 1.3.0, trajet « Bureau », 15/11/2026 » et dit une ligne par événement (« 08:02:10 Partir maintenant
  affiché »), heures de Bruxelles.

## 7. Favoris en accordéon

- Écran « Favoris » (`favorites`) : une rangée par favori comme en 1.2.10 ; la rangée du curseur s'ouvre sur 1 ou 2
  lignes pâles en retrait (`DetailItem.expand`, `GlassesView.accordion`) ; les autres restent fermées. La ligne du
  détail en bas et son filet disparaissent. L'accueil ne change pas.
- Contenu (`format.ts`) :
  - marche puis véhicule : 1re ligne « à pied 7 min, puis bus W ~11:49 » (train : « IC ~07:42 voie 6 », voie modifiée
    « voie 6 ! ») ; 2e ligne « direct », « 1 changement : métro 2 », « 2 changements : métro 2, tram 3 » (au-delà :
    « … ») ; un souci du trajet passe en tête de la 2e ligne (« voie 6 au lieu de 4 », « IC supprimé ») ;
  - départ d'une gare hors de portée à pied : « IC voie 4 à 11:42, à Bruxelles-Central » ;
  - à pied seulement : une ligne « à pied 23 min » ;
  - adresse récente : une ligne, l'adresse complète ;
  - « tu y es », aucun trajet, en calcul, « Autre adresse » : rien ne s'ouvre.
- Navigation : la hauteur d'une rangée dépend du curseur ; ▲▼ gardent la rangée ouverte entière à l'écran. Tout tient
  au pixel, coupé au mot.

## 8. Les « … » des favoris

À l'ouverture de « Favoris », chaque favori reçoit sa réponse dès qu'elle est calculée (dans l'ordre de l'écran, 3
calculs à la fois au plus) ; « … » seulement pendant le calcul, jamais figé ; le lieu où l'on est : « tu y es ».
Chercher la cause du constat (Quai Web, position choisie à la main égale au lieu d'un favori, trois favoris restés
« … »), corriger, prouver par un test.

## 9. Nouveautés et version

- Version 1.3.0 (app.json, package.json, store/changelog/1.3.0.txt, données du téléphone).
- Lunettes, une fois depuis la 1.2.10 ou avant, titre « Quai 1.3.0 », trois lignes (formulations finales par l'équipe
  des écrans, au pixel) : la ligne « ▶ Y aller » et ▲ pour revenir ; les favoris en accordéon ; le test de l'écran et
  le rappel des messages. Téléphone : bandeau équivalent. Quai Web : « onglet Réglages » là où il le faut.

## 10. Confidentialité et sécurité

Rien de nouveau ne quitte le téléphone : ni le test, ni le rappel, ni le journal n'utilisent le réseau. Le capteur de
mouvement n'est ouvert que pendant le test et pendant l'attente d'un message important ; ses mesures ne sont jamais
gardées (seul le mouvement appris : un axe, un sens, un écart). Aucune adresse ni position personnelle dans le dépôt,
les tests, les captures, les journaux : lieux publics seulement.

## 11. Barrières de publication

1. TypeScript sans erreur ; tous les tests verts (appli, pipeline, relais, bout en bout), avec des tests qui
   échouent sans chaque nouveauté.
2. Simulateur complet à 100 % avec contrôle au pixel, nouveaux scénarios `s130*` (ligne d'action, ▲, accordéon, « où
   descendre », hors de Belgique, test de l'écran sur le simulateur Even Hub, rappel, vérification, journal).
3. Branche de vérification sur les vraies données : lignes et trains sans erreur, **0 rangée coupée au milieu d'un
   mot** ; chemins à pied comme en 1.2.10 (99 % entre arrêts de Belgique), raison `outside` pour les arrêts à l'étranger.
4. Deux contrôles indépendants (usager : chaque écran et parcours ; technique : code, cycle de vie, batterie,
   capteur, confidentialité), **zéro remarque ouverte** à la publication.

## 12. Équipes et fichiers

Chaque équipe travaille dans son worktree (`/home/claude/q130-<équipe>`, branche `w130-<équipe>`, partie de `v130`),
ne touche que ses fichiers (ou le minimum ailleurs, en le disant), commite (auteur `sahiht
<sahiht@users.noreply.github.com>`, lignes Co-Authored-By et Claude-Session) et ne pousse rien.

| Équipe | Fichiers | Sujets |
|---|---|---|
| A, écrans | `glasses/views.ts`, `glasses/guide-views.ts`, `glasses/format.ts`, tests des vues | § 1 (texte et intention de la ligne d'action), § 3, vues `offMap` et `check`, « Où tu en es » hors de Belgique, vues `displayTest`, § 7 (contenu `expand`, `accordion`), § 9 lunettes, `edgeUp` sur `others` |
| B, mise en page et navigation | `glasses/layout.ts`, `glasses/nav.ts`, `glasses/font.ts`, `test/scan/*`, tests | rendu de `action`, accordéon (hauteurs, ▲▼), `edgeUp` dans la navigation, § 5 et son comptage dans les balayages |
| C1, contrôleur du guidage | `glasses/controller.ts` (méthodes du guidage), tests du contrôleur | § 6.2 rappels et capteur, entrée `battery`, § 6.3 côté contrôleur, crochets du journal (§ 6.4) |
| C2, contrôleur des écrans | `glasses/controller.ts` (navigation et écrans), tests | § 2 (dépiler), § 8, orchestration du test de l'écran (§ 6.1), ligne d'action branchée |
| D, moteur et chemin | `core/guide.ts`, `core/guide-walk.ts`, `core/walk/router.ts`, tests | § 4 (raison, `offMap`, « Où tu en es »), § 6.3 (moment `check`, perte de position, batterie) |
| E, plateforme | `platform/*`, `glasses/gestures.ts`, `web/*` (hors écrans du téléphone), tests | `imu()` (imuControl, mesures en signal `imu`), batterie et port dans le signal `device`, Quai Web sans capteur |
| F, téléphone | `phone/**`, `settings.ts`, textes du téléphone, tests | § 6.1 côté téléphone, § 6.3 carte « En cours », § 6.4 écran du journal, § 9 bandeau, migration des réglages |
| H, journal | `core/journal.ts` (nouveau), son branchement dans le cœur, tests | `TripJournal` : stockage, plafonds, texte, refus des coordonnées |
| G, bout en bout | `tests/e2e/**` | scénarios `s130*`, mise à jour des scénarios existants, simulateur complet |

## 13. Hors périmètre

Notification par une autre appli ou un service tiers (refusé par le propriétaire) ; radar de la veille ; voix ;
chemins à pied hors de Belgique (extraits voisins).
