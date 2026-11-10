# Quai 1.0.1 : revue UX avant la 1.1

Statut : 10/11/2026, revue UX des lunettes et de la page du téléphone. Lecteurs : rédaction de `PRD.md`, équipes interface et cœur.

Méthode : appli construite (`vite build`), vrai cœur, données du pipeline sur les fixtures, faux portail BMC et relais local, simulateur Even Hub piloté par son API (▲ ▼ toucher, double toucher) ; téléphone piloté dans la WebView du simulateur. Six tâches jouées comme un nouvel utilisateur, gestes comptés, puis états limites (sans position, temps réel coupé, horaires injoignables ou périmés, 23:30). Captures citées : `/home/claude/ux-review/shots/` ; script rejouable : `/home/claude/ux-review/walk.ts` ; journaux des écrans : `/home/claude/ux-review/walk-*.json`.

Gravité. Bloquant : information fausse pour se déplacer, ou tâche impossible. Majeur : réglage perdu, impasse, détour net ou état trompeur. Mineur : gêne, incohérence de mots ou de symboles.

## En bref

- Ce qui marche : le train du matin est sur l’accueil sans geste ; un arrêt favori proche s’ouvre seul ; les arrêts autour de soi en 2 touchers ; le suivi automatique (départ du train, aide à l’arrivée) ; les horaires périmés sont bien signalés ; contrastes et cibles tactiles corrects sur le téléphone.
- Ce qui casse : le train choisi sur le téléphone n’est pas celui que suivent les lunettes (Bloquant) ; un favori de trajet demande un écran de plus que la suggestion et sa ligne ne dit pas quand partir ; un toucher maladroit retire un favori et efface ses réglages ; la panne du temps réel est mal nommée et fait oublier les suppressions ; l’adresse d’un lieu ne sert à rien ; dans le formulaire de favori, le lieu choisi n’apparaît pas.
- Le PRD couvre déjà la plupart de ces points (M1, M2, M4, M6, S1 à S6). La colonne « PRD 1.1 » du § 2 signale ce qui manque ; le § 5 liste quatre risques UX du PRD lui-même.

## 1. Gestes par tâche, mesurés, et cible

T : toucher ; TT : double toucher. Téléphone : touchers et saisies.

| Tâche | Parcours | 1.0.1 (mesuré) | Hésitations relevées | Cible 1.1 |
|---|---|---|---|---|
| a. Mon prochain train pour le bureau (07:31, Namur) | Suggestion de l’accueil | 0 pour lire, 1 T pour les étapes | « +2 » sans unité ; « voie 6 » sans « ! » alors que la voie a changé ; dans les étapes, « 7 min » se lit « dans 7 min » | 0 et 1 (inchangé) |
| | Par « Mes favoris » | 5 (▼ ▼ T T T) | « Ici ▶ Bureau » (deux ▶) ; « v.6 ! » ; une liste de propositions alors que le favori est choisi | 1 (favori en tête, PRD M1) ; 3 au plus |
| | Par « Aller à… » | 7 (▼ ▼ ▼ T ▼ T T) | « toucher : itinéraires » | 5 (T sur le lieu : étapes) |
| b. Les prochains trams à mon arrêt (12:10, Gare du Nord) | Arrêt favori réglé « à moins de 300 m » | 0 | aucune | 0 |
| | Sans favori, par « Autour de moi » | 2 (T T) ; 3 si une suggestion occupe la 1re ligne | ▲▼ déplace un curseur inutile ; un toucher ajoute un favori | 1 à 2 (voir § 5, R1 : 5 avec l’accueil du PRD) |
| c. Ouvrir un favori et suivre son trajet (13:55, Bruxelles-Central) | Favori de gare à gare jusqu’au train | 6 (▼ T ▼ ▼ T T) ; suivi ensuite : 0 (train à 14:10, aide à l’arrivée à 14:36) | le détail s’intitule « IC vers Bruges » ; un toucher n’y fait rien | 1 si le favori est en tête, 4 sinon |
| | Favori porte à porte jusqu’aux étapes | 4 (▼ T T T) | même détour que (a) | 1 à 3 |
| | Suivi après un retour à l’accueil | perdu (5 gestes pour revenir) | rien ne rappelle le trajet en cours | 0 (reprise, PRD M6) |
| d. Nouvelle destination depuis le téléphone (13:55) | « Gand », 2e train, « Afficher dans les lunettes » | téléphone : 5 touchers et « Gand » ; lunettes : 0 ; mais le 1er train est suivi | curseur sur le 14:10 et passage seul « dans le train » du 14:10 | 4 touchers et la saisie ; le train choisi est suivi |
| | « Korenmarkt » (centre de Gand) | 3 touchers et la saisie, puis impasse | « Aucun trajet trouvé » écrit deux fois, aucune issue | un trajet (IC puis tram 1), ou une issue proposée |
| e. Temps réel coupé | Pendant l’affichage des départs | 0 ; bascule en 27 s | « Pas de réseau » alors que le téléphone a du réseau ; le S1 supprimé redevient « ~12:34 voie 3 » ; accueil et téléphone muets | 0, message juste |
| | Horaires injoignables au lancement | 1 T (« réessayer ») ou 0 (nouvel essai seul toutes les 30 s, non dit) | « vérifie la publication de cette nuit » quelle que soit la cause | 0, et le dire |
| f. Premier lancement, rien de réglé | Bienvenue | lunettes : 1 T ; téléphone : 2 touchers | aucune | inchangé |
| | Ajouter le lieu « Bureau » | 7 touchers et 3 saisies (51 caractères), dont une adresse ignorée | « Enregistrer le lieu » grisé sans raison ; position en coordonnées | 3 touchers et 1 saisie (PRD M4) |
| | Ajouter le trajet du matin vers « Bureau » | 8 touchers | le champ « Arrivée » reste vide après le choix de « Bureau » | 1 toucher (PRD S3, après le lieu) |
| | Accueil sans position autorisée | « Autour de moi   … » sans fin | attente qui ne finit pas | « sans position » |
| | Total jusqu’à la suggestion du lendemain matin | 17 touchers et 3 saisies | | 7 touchers et 2 saisies (PRD S1, Maison et Bureau) |

Comptes donnés depuis un accueil ouvert à neuf : au retour sur un écran, la 1.0.1 garde la sélection précédente, ce qui retire parfois un ou deux ▼.

## 2. Constats

| N° | Écran | Problème | Gravité | Preuve | Changement recommandé | PRD 1.1 |
|---|---|---|---|---|---|---|
| 1 | Téléphone vers lunettes, « Afficher dans les lunettes » (trains) | Le train choisi n’est pas transmis : curseur sur le 1er train, puis à 14:10 les lunettes passent seules « dans le train » du 14:10 alors qu’on attend le 14:22. (Le mode porte à porte transmet bien la carte choisie.) | Bloquant | d4-tel-2e-train-choisi.png, d4-lunettes-trains.png, d4-lunettes-suit-le-14-10.png | Transmettre la carte choisie (sélection initiale) et ne suivre que ce train. Téléphone : « Affiché dans les lunettes : IC 14:22, voie 6. » | CA-M2.6 ; correctif utile dès la 1.0.2 |
| 2 | Lunettes, Mes favoris | Toucher un trajet favori n’ouvre pas le trajet qu’il propose : liste « Vers le bureau, départ maintenant » (porte à porte), ou liste des trains puis « IC vers Bruges » sans étapes (gare à gare). La suggestion du même favori, elle, ouvre les étapes. | Majeur | a2-favoris.png, a2-propositions.png, c1-trains.png, c1-detail-train.png, a1-etapes.png | Un toucher : les étapes du trajet proposé. | M2 |
| 3 | Lunettes, Mes favoris | La ligne ne dit ni quand partir ni l’arrivée : « Ici ▶ Bureau   IC 07:42 +2 v.6 ! ». Le nom du favori (« bureau ») est ignoré ; un nom long coupe la destination (« Ottignies-Louvain-la-Neuve ▶ Bruxel… », 531 px pour 338). | Majeur | a2-favoris.png, c1-favoris.png, h1-favoris-2330.png | « Vers le bureau   partir dans 4 min » ; sans nom, « Vers {destination} », jamais le départ en premier. | M1, S6 |
| 4 | Lunettes, départs d’un arrêt favori | Un toucher sur n’importe quel départ retire le favori, sans confirmation ; un 2e toucher le recrée en fin de liste, réglé « Jamais » : l’arrêt ne s’ouvrira plus seul. | Majeur | b1-toucher-retire-favori.png, b1-tel-favoris-apres-retrait-ajout.png | « ★ Retiré. Toucher encore : annuler » (5 s), rétablissement à l’identique. | M6 |
| 5 | Lunettes, départs | ▲▼ déplace un curseur ▶ qui ne change rien ; une fois le message parti, rien ne dit que l’arrêt est un favori. | Mineur | b2-tableau-curseur-bas.png, b1-toucher-rajoute-favori.png | Pas de curseur sur les départs (▲▼ fait seulement défiler) ; « ★ » en fin de titre : « Gare du Nord, tram (STIB) ★ ». | absent |
| 6 | Lunettes, temps réel coupé | « Pas de réseau : horaires prévus ~ » accuse le téléphone alors que c’est la source de l’opérateur (ou le relais) qui ne répond pas. | Majeur | e1-train-sans-temps-reel.png, e3-relais-injoignable.png | « Temps réel indisponible : horaires prévus ~ » ; « Pas de réseau » seulement si le téléphone est hors ligne. | absent (§ 6.3 garde le texte) |
| 7 | Lunettes, temps réel coupé | Au rafraîchissement suivant, le S1 12:34 « SUPPRIMÉ » redevient « ~12:34 voie 3 » : un train supprimé paraît circuler. | Majeur | e1-train-temps-reel.png, e1-train-sans-temps-reel.png | Garder 15 min les suppressions et voies modifiées déjà connues ; note « Temps réel interrompu à 12:10 ». | absent |
| 8 | Lunettes, accueil, temps réel coupé | Rien ne signale la panne ; la suggestion « Pour le bureau : IC 07:42, voie 4 » n’a pas de « ~ », les étapes affichent « ~07:42 ». | Majeur | e2-accueil-matin-sans-temps-reel.png, e2-etapes-sans-temps-reel.png, e1-accueil-sans-temps-reel.png | « ~ » dans la suggestion (« IC ~07:42 ») ; ligne du haut « Temps réel indisponible » quand elle est libre. | CA-M1.1 (le « ~ ») ; ligne du haut absente |
| 9 | Lunettes, accueil sans position | « Autour de moi   … » reste affiché sans fin. | Majeur | f6-lunettes-accueil-sans-position.png, f6-lunettes-autour-sans-position.png | « Autour de moi   sans position » ; le toucher garde le message actuel. | CA-M1.8 (favoris seulement) |
| 10 | Lunettes, suivi | Le suivi automatique ne vit que sur l’écran affiché (`autoAdvance`, `controller.ts`) : un retour à l’accueil ou une réouverture l’abandonne. | Majeur | c3-auto-dans-le-train.png, c3-auto-arrivee.png (suivi tant qu’on reste) | Reprise du trajet en cours ; tant qu’il dure, 1re ligne de l’accueil « En cours : IC 14:22, voie 6 ». | M6 (reprise) ; ligne d’accueil absente |
| 11 | Téléphone, Rechercher (porte à porte) | « Korenmarkt » depuis Bruxelles-Central : « Aucun trajet trouvé » alors que IC puis tram 1 existent. Cause probable : la gare d’arrivée n’est cherchée qu’à 2 km de la destination (`plan.ts`, `FAR_MAX_M`) ; Gand-Saint-Pierre est à 2,2 km. « Veldstraat 1 » est à 2,1 km : CA-M5.4 échouera tel quel. | Majeur | d2-tel-resultats-porte-a-porte.png | Cœur : chercher la gare d’arrivée au-delà de 2 km quand une ligne urbaine la relie à la destination. Téléphone : « Pas de trajet complet. Essaie Gand-Saint-Pierre (gare), puis le tram. » et un bouton « Chercher vers Gand-Saint-Pierre ». | M5 (à signaler à `design-routing.md`) |
| 12 | Téléphone, nouveau favori de trajet | Après le choix de « Bureau » (ou « Ma position ») dans les propositions, le champ « Arrivée » reste vide ; le favori est pourtant enregistré. | Majeur | f4-tel-arrivee-options.png, f4-tel-trajet-rempli.png | Écrire le choix dans le champ (« Bureau »), comme pour un arrêt. | M4 (champs unifiés) ; bogue à corriger |
| 13 | Téléphone, nouveau lieu | « Adresse (texte libre) » ne place pas le lieu ; « Enregistrer le lieu » reste grisé sans raison ; position en coordonnées (« 50.8454, 4.3571 ») ; la liste montre ensuite l’adresse tapée alors que le lieu est sur la gare. | Majeur | f3-tel-adresse-saisie.png, f3-tel-lieu-place.png, f3-tel-mes-lieux.png, g-tel-lieu-bureau.png | Adresse cherchée (§ 4) ; jamais de coordonnées : adresse normalisée ou « Près de Bruxelles-Central ». | M4 |
| 14 | Téléphone, accueil | Les favoris sont rangés sous « Réglages », sans réponse ni moyen de les afficher dans les lunettes ; une recherche ne peut pas devenir un favori. | Majeur | g-tel-accueil.png, d1-tel-resultats.png | Section « Mes favoris » en tête : réponse courte (« partir à 07:35 », « T3 2 min ») et bouton « Lunettes » ; « Garder en favori » sous les résultats. | S3 (partiel) |
| 15 | Téléphone, accueil | « Données : Tout est à jour » pendant une panne complète du temps réel, alors que l’écran Données dit « Injoignable ». | Mineur | e1-tel-accueil-sans-temps-reel.png, e1-tel-donnees-sans-temps-reel.png | « Temps réel indisponible, horaires prévus ». | absent |
| 16 | Lunettes, étapes | La colonne de droite mélange durée (« 7 min » de marche), retard (« +2 min ») et état (« en cours ») ; sur les départs, la même colonne veut dire « dans 7 min ». | Mineur | a1-etapes.png | Durée dans le texte : « Partir à pied vers la gare (7 min) », « Arrivée au bureau (12 min à pied) » ; colonne de droite pour l’état : « dans 4 min », « en cours », « +2 min », « SUPPRIMÉ » (colonne portée de 96 à 108 px). | absent (L3 « inchangées ») |
| 17 | Lunettes, trajet à pied | Proposition « 12 min, direct » ; étapes réduites à « 14:07 Arrivée au bureau, à pied 12 min », sans heure de départ. | Mineur | c2-propositions-bureau.png, c2-etapes-bureau.png, d2b-lunettes-etapes.png | « 13:55 Partir à pied (12 min) » puis « 14:07 Arrivée au bureau » ; jamais « direct » pour une marche. | CA-M2.7 (partiel) |
| 18 | Lunettes, étapes en horaire prévu | Aucune note n’explique « ~07:42 ». | Mineur | e2-etapes-sans-temps-reel.png | Note « ~ horaire prévu, sans temps réel », comme ailleurs. | absent |
| 19 | Lunettes, partout | ▶ sert de curseur et de « vers » : « ▶Ici ▶ Bureau », « 07:35 ▶ 09:00 » ; le PRD en ajoute (« ▼ Le suivant : 08:33 ▶ 09:58 »). | Mineur | a2-favoris.png, a2-propositions.png, c1-trains.png | « → » pour « vers » (présent dans la police, 17 px ; déjà utilisé sur le téléphone) ; ▶ réservé au repère. | L3 à revoir |
| 20 | Lunettes, aides | Accueil sans « double : quitter » ; « Autour de moi » sans retour ; étapes sans « toucher : détail » alors que le toucher ouvre le train ; erreur au lancement « double : retour » alors que le geste quitte. | Mineur | a4-accueil-avant-sortie.png, b2-autour-de-moi.png, a1-etapes.png, e4-horaires-injoignables.png | Accueil : « ▲▼ choisir   toucher : ouvrir   double : quitter » (390 px) ; erreur à la racine : « toucher : réessayer   double : quitter ». | S2 (accueil laissé tel quel) |
| 21 | Lunettes, vocabulaire | « itinéraires », « propositions », « trajets », « détail » pour des choses voisines ; titre d’attente « Départs » remplacé ensuite par le nom de l’arrêt. | Mineur | a3-aller-a.png, a3-propositions.png | « trajet » partout ; titre d’attente : le nom de l’arrêt. | S2 (partiel) |
| 22 | Lunettes, « demain » | À 23:30, « IC ~demain 00:01 » pour un train dans 31 min ; « demain, » répété devant chaque destination. | Mineur | h1-autour-2330.png, h1-train-2330.png, h1-tableau-gdn-2330.png | Pas de « demain » avant 04:00 ; si tous les départs sont le lendemain, une seule ligne du haut « Départs de demain ». | absent |
| 23 | Lunettes, « 0 min » | « T3 ~0 min », « T3 0 min ». | Mineur | a2-favoris.png, f5-lunettes-favoris.png | « imminent ». | S6 |
| 24 | Lunettes, suggestion | Voie modifiée non signalée (« voie 6 » sans « ! ») et « +2 » sans unité. | Mineur | a1-accueil-suggestion.png | « IC 07:42 +2, voie 6 ! » ou la 2e ligne du PRD. | CA-M1.2 |
| 25 | Lunettes, Mes favoris vide | Ne dit pas qu’un arrêt s’ajoute depuis les lunettes. | Mineur | f1-lunettes-favoris-vide.png | « Aucun favori pour l’instant. » / « Ouvre un arrêt dans Autour de moi et touche-le, » / « ou ajoute un trajet sur le téléphone. » | L2 (« inchangé ») |
| 26 | Lunettes, Aller à… | « Autre lieu   sur le téléphone » ne mène qu’à un message. | Mineur | f1-lunettes-aller-a-vide.png, f1-lunettes-aller-a-toucher.png | Textes du PRD L8, adresses récentes S4. | L8, S4 |
| 27 | Lunettes, départs de Rogier | Titre « Rogier, métro (STIB) » alors que des trams y sont listés. | Mineur | b2-tableau-rogier.png | « Rogier, métro et tram (STIB) ». | absent |
| 28 | Lunettes, lancement sans horaires | « Données indisponibles : vérifie la publication de cette nuit » quelle que soit la cause, téléphone hors ligne compris ; le nouvel essai automatique n’est pas dit. | Mineur | e4-horaires-injoignables.png, e4-apres-reessayer.png | « Horaires injoignables : nouvel essai dans 30 s » ; la publication n’est mise en cause que si le serveur répond sans le fichier. | absent |
| 29 | Téléphone, Rechercher | Choix en deux temps (carte, puis bouton en bas) ; « Aucun trajet trouvé » écrit deux fois ; « Affiché dans les lunettes. » en petit texte sous le bouton. | Mineur | d1-tel-2e-train-choisi.png, d2-tel-resultats-porte-a-porte.png, d1-tel-apres-afficher.png | Bouton « Lunettes » sur chaque carte ; un seul message ; retour nommant le trajet (n° 1). | M2 (partiel) |
| 30 | Téléphone, favori | « Le matin », « Le soir » sans les heures ; « Nom affiché (« Pour le bureau : … ») » obscur. | Mineur | f4-tel-trajet-rempli.png, g-tel-favori-bureau.png | « Le matin (5 h à 11 h) », « Le soir (15 h à 21 h) » ; nom : texte du PRD T4. | T4 (partiel) |
| 31 | Téléphone, Alertes | « Marge avant de partir » change l’heure « partir à » même alerte coupée (c’est un réglage de trajet) ; « Seuil du retard » reste actif alerte coupée. | Mineur | g-tel-alertes.png | Marge dans « Mes lieux », sous « Marche maximale » ; seuil grisé quand l’alerte est coupée. | absent |
| 32 | Téléphone, suppression d’un favori ou d’un lieu | `window.confirm` : boîte du système titrée par l’adresse technique de la page ; dans le simulateur, elle bloque la WebView. | Mineur | g2-tel-confirm-ecran.png | Confirmation dans la page : « Supprimer ce favori ? » avec « Supprimer » et « Annuler ». | T3 (texte seulement) |
| 33 | Téléphone, premier lancement | Après « Continuer », rien ne guide vers Maison et Bureau ; les lunettes renvoient au téléphone, qui ne guide plus. | Mineur | f2-tel-accueil.png, f1-lunettes-accueil-vide.png | Étape « Tes lieux ». | S1 |
| 34 | Téléphone, accessibilité | Bon niveau : contraste minimal mesuré 4,97:1, cibles de 44 px au moins (lignes, boutons, segments, pas-à-pas). Défauts : cartes de résultats en `aria-pressed` au lieu d’un choix unique ; message d’état hors de l’écran sur un petit téléphone. | Mineur | /home/claude/ux-review/audit-pages.json, audit-recherche.json | `role="radiogroup"` et `role="radio"` ; message d’état à côté du bouton. | absent |

## 3. Favoris : diagnostic et proposition

Le retour du propriétaire (« faciliter intuitivement le trajet que propose ce favori ») est fondé : le favori connaît la réponse, mais les lunettes la cachent derrière un écran de plus, et la ligne affiche le premier véhicule au lieu de l’heure de départ.

Diagnostic, lunettes :
- Entrée : « Mes favoris   5 », un compte qui n’aide pas ; liste dans l’ordre figé du téléphone.
- Ligne : nom fabriqué (« Ici ▶ Bureau ») au lieu du nom donné (« bureau ») ; à droite, l’heure du premier véhicule, pas « partir à », pas d’arrivée (n° 3).
- Toucher : liste des propositions ou des trains, puis un toucher de plus ; de gare à gare, jamais d’étapes (n° 2).
- Départs d’un arrêt favori : un toucher le retire et efface ses réglages (n° 4).
- Ajouter un favori depuis les lunettes est possible (départs, aide à l’arrivée) mais nulle part expliqué (n° 25).

Diagnostic, téléphone : favoris rangés sous « Réglages », sans réponse ni action ; champ « Arrivée » vide après le choix d’un lieu ; heures des créneaux absentes ; pas de « Garder en favori » depuis une recherche ; ordre : « Mettre en premier » seulement (n° 12, 14, 30).

Proposition. Le PRD (M1, M2, M6, S3) fixe l’essentiel ; à ajouter ou préciser :
1. Lunettes, ligne d’un favori : jamais le point de départ en premier ; un nom long garde la destination (« Vers Bruxelles-Aéroport-Zaventem » plutôt que « Ottignies-Louvain-la-Neuve ▶ Bruxel… »).
2. Lunettes, départs : « ★ » en fin de titre d’un arrêt favori, pas de curseur, retrait annulable (n° 4, 5).
3. Lunettes, liste vide : dire comment ajouter un arrêt depuis les lunettes (n° 25).
4. Téléphone, accueil : « Mes favoris » au-dessus de « Réglages », chaque favori avec sa réponse courte et un bouton « Lunettes » (étiquette pour lecteur d’écran : « Afficher Vers le bureau dans les lunettes ») : un toucher pour afficher un favori dans les lunettes, au lieu d’une recherche complète.
5. Téléphone, formulaire : champ rempli après le choix, heures des créneaux, aperçu dans les lunettes (PRD C2, à monter en Should : c’est là qu’on voit ce que donnera « Le proposer à l’ouverture »).

Gestes visés : réponse d’un favori en tête, 0 ; ses étapes, 1 ; afficher un favori depuis le téléphone, 1 toucher.

## 4. Lieux : diagnostic et parcours par adresse

Diagnostic : la position d’un lieu ne vient que de « Utiliser ma position actuelle » (utile seulement sur place) ou d’un arrêt proche (le lieu est alors posé sur l’arrêt, la marche finale disparaît). Le champ « Adresse (texte libre) » laisse croire le contraire, le bouton reste grisé sans explication, et la liste affiche l’adresse tapée à côté d’un lieu posé ailleurs (n° 13). Les lieux du propriétaire sont des villes (« Namur », « Bruxelles »).

Parcours 1.1 (accord avec PRD M4 ; compléments en italique) :
1. « Ajouter un lieu » : « Nom du lieu » *avec trois raccourcis touchables « Maison », « Bureau », « École »*, puis le champ « Adresse » (« Rue et numéro, commune »).
2. Propositions dès 3 caractères ; le choix affiche l’adresse normalisée et l’accès en confirmation (« Bruxelles-Central à 9 min à pied, tram à 3 min »). *Jamais de coordonnées à l’écran.*
3. Replis : « Utiliser ma position actuelle » *(sous-titre « si tu es sur place »)*, ou un arrêt choisi dans le même champ (« Près de Namur »).
4. Erreurs : textes du PRD § 6.3 ; *hors ligne : « Recherche d’adresse impossible sans connexion : gares et arrêts seulement. »*
5. Après l’enregistrement : « Ajouter le trajet vers {nom} à tes favoris ? » (S3) ; *pour « Bureau », le créneau « Le matin » est proposé d’office, « Le soir » pour « Maison ».*
6. Contrainte du propriétaire : données officielles et libres, pas de service tenu par des bénévoles, pas de serveur payant. Piste à vérifier par le responsable technique : Paradigm (Région bruxelloise) a présenté une API de géocodage fondée sur le registre authentique des adresses au standard BeSt Address, avec une couverture de toutes les adresses belges annoncée dès la mi-novembre ([be.brussels](https://be.brussels/fr/propos-de-la-region/structure-et-organisation/administrations-et-institutions-de-la-region/paradigm/paradigm-presente-sa-nouvelle-api-de-geocodage-levenement-foss4g)) ; le jeu de points d’adresse BeST Address est publié sur [transportdata.be](https://www.transportdata.be/dataset/address-points-belgium-best-address). Accès, gratuité et conditions d’usage restent à confirmer (PRD Q2, Q10).

Gestes visés : un lieu par adresse, 3 touchers et 1 saisie ; le trajet du matin, 1 toucher de plus.

## 5. Risques UX dans le PRD actuel

| N° | Point du PRD | Risque | Proposition |
|---|---|---|---|
| R1 | M1 : deux favoris sur deux lignes avant « Autour de moi » | Tâche (b) pour un arrêt non favori : 2 gestes aujourd’hui, 5 demain (▼ ▼ ▼ T T). | Rendre touchable la ligne « Près de {arrêt} » : un toucher ouvre les départs de l’arrêt le plus proche (1 geste). |
| R2 | M2 : ▼ montre une autre proposition ; suivi automatique de la proposition affichée | Un ▼ machinal laisse affiché le train suivant : à son départ, les lunettes passeraient « dans le train » du mauvais train (même effet que le n° 1). | Figer le trajet suivi dès l’heure de départ à pied atteinte ; une autre proposition affichée ensuite n’est suivie qu’après un geste explicite. |
| R3 | M1 : accueil à 7 lignes | Avec une ligne du haut et la note « ~ », 6 lignes seulement sont visibles (mesuré : 8, 7, 7, 6 selon les cas) : « Aller à… » sort de l’écran. | Accepter le défilement et le dire dans les critères, ou retirer la ligne du haut quand des favoris sont affichés. |
| R4 | CA-M5.4 « Veldstraat 1 » et § 6.3 « Pas de réseau » | Le calcul actuel cherche la gare d’arrivée à 2 km au plus (n° 11) ; « Pas de réseau » gardé pour la panne du temps réel (n° 6). | Lever la limite dans `design-routing.md` ; distinguer « Pas de réseau » (téléphone) et « Temps réel indisponible » (source). |

## 6. Les 10 changements les plus rentables pour la 1.1, dans l’ordre

1. Le train choisi sur le téléphone est celui que montrent et suivent les lunettes (n° 1) : petit correctif, à livrer avant même la 1.1.
2. Favori de trajet : un toucher, les étapes du trajet proposé ; la ligne dit « partir dans 4 min » (n° 2, 3 ; PRD M1, M2), avec le trajet suivi figé (R2).
3. Retrait d’un favori annulable, réglages rétablis à l’identique ; « ★ » dans le titre ; pas de curseur sur les départs (n° 4, 5 ; PRD M6).
4. Panne du temps réel dite juste : « Temps réel indisponible : horaires prévus ~ », « ~ » dans la suggestion et les étapes, suppressions gardées 15 min, téléphone « Temps réel indisponible » (n° 6, 7, 8, 15, 18).
5. Lieu par adresse, sans coordonnées, accès en confirmation, puis « Ajouter le trajet vers Bureau à tes favoris ? » (n° 13, 33 ; PRD M4, S1, S3).
6. Favoris sur le téléphone : en tête de l’accueil avec bouton « Lunettes » ; « Garder en favori » depuis une recherche ; champ « Arrivée » rempli après le choix ; heures des créneaux (n° 12, 14, 30).
7. Trajet en cours : reprise à la réouverture (PRD M6) et ligne « En cours : IC 14:22, voie 6 » sur l’accueil (n° 10).
8. Recherche sans résultat : gare d’arrivée cherchée au-delà de 2 km quand une ligne urbaine y mène, et un état vide qui propose une issue (n° 11 ; condition de CA-M5.4).
9. États sans position et sans horaires : « sans position » au lieu de « … » sans fin ; « Horaires injoignables : nouvel essai dans 30 s » ; « double : quitter » à la racine (n° 9, 20, 28).
10. Mots et symboles : « → » pour « vers », colonne d’état des étapes (« dans 4 min »), « trajet » partout, « demain » une seule fois, « imminent » (n° 16, 17, 19, 21, 22, 23).

## Annexe : reproduire et limites

- Rejouer : `cd /home/claude/quai-app/tests/e2e && npx tsx /home/claude/ux-review/walk.ts --only a,b` (tâches `a a2 b c c2 d d4 e f f2 g h i`). La copie construite reçoit seulement une télécommande de test (`/home/claude/ux-review/ctl.js`) ; le code de l’appli n’est pas modifié.
- Limites : mini-réseau des fixtures (peu de trains, noms courts) ; le simulateur n’affiche pas la boîte système de sortie (a4-apres-double-accueil.png, écran noir après `ShutDownPageContainer`) ; la permission de position est simulée ; la boîte `window.confirm` bloque l’automatisation, d’où une seule capture d’écran du bureau virtuel (g2-tel-confirm-ecran.png).
