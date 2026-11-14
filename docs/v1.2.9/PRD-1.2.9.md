# Quai 1.2.9 : « dans ~1 min » et réglages du téléphone en miroir des lunettes

Demandes du propriétaire du 14/11 : « imminent » réservé au temps réel (décidé à 01:10), puis revoir la configuration du téléphone (« un fouillis », trop longue, il faut défiler jusqu'en bas). Trois pistes dessinées sur une planche (A « Trois onglets », B « Accueil en résumé », C « Le miroir des lunettes ») ; choix du 14/11 à 02:09 : la piste C avec trois retouches. Mise en production demandée le 14/11 à 02:09, avec les corrections des défauts trouvés en chemin (sans en inventer) et un contrôle avant publication.

Maquettes de référence (locales, pour l'équipe) : /home/claude/quai-design-129/project/C-accueil.dc.html, C-lignes.dc.html, C-reglages.dc.html, C-apercu.dc.html ; B-lignes.dc.html pour l'ajout sur l'écran de la liste ; A-reglages.dc.html pour les boutons − +. Les données des maquettes sont des exemples.

Reporté en 1.2.10 (prévu en 1.2.7, puis 1.2.8, puis 1.2.9) : rappel avant la descente, écran calme, radar de la veille, plan B avec le retard mesuré, arrêt dépassé, flèche, écran en marchant, réglages « Ce qui s'affiche tout seul ».

## 1. « imminent » réservé au temps réel

- Un passage ou un départ à moins d'une minute : avec le temps réel, « imminent » (inchangé) ; sans temps réel (horaire prévu), jamais « imminent ».
- Textes en clair (toute la ligne, trajet d'un train) : « dans ~1 min ». Détail d'une ligne : « dans 1 min », l'heure de la rangée portant déjà le « ~ » (« ~07:59   dans 1 min »).
- Formes courtes, avec le même « ~ » que les autres horaires prévus : « ~1 min » (attente d'un bus, tram ou métro : Autour de moi, arrêts favoris, téléphone) et « ~1 » dans la colonne des minutes des tableaux.
- « SUPPRIMÉ » passe toujours avant. La note « ~ horaire prévu » s'affiche quand une de ces rangées est à l'écran (Item.planned, comme en 1.2.8).
- Partout où « imminent » est produit aujourd'hui : app/src/glasses/format.ts (attente, passage des tableaux, prochain passage en clair, détail d'une ligne) et app/src/core/text.ts (téléphone).

## 2. Réglages du téléphone : piste C « Le miroir des lunettes »

Principe : l'accueil du téléphone reprend l'accueil des lunettes, mêmes rubriques, mêmes mots, même ordre ; chaque rubrique tient sur une ligne et ouvre son écran ; tous les autres réglages passent par un seul bouton « Réglages ». Rien ne disparaît : chaque fonction actuelle reste accessible. Quai Web (onglet Réglages) suit, avec ses textes propres (ctx.web).

### 2.1 Accueil (#/)
- En-tête : « Quai », « Bonjour », et à droite un bouton « Réglages » (icône) vers #/reglages. La phrase « Les départs en direct s'affichent… » disparaît.
- Alertes « Quai n'est pas configuré » et « Horaires périmés » : inchangées.
- « Où vas-tu ? » : inchangé (ouvre #/recherche).
- Bandeau « Nouveau » sur une ligne : « Nouveau dans Quai 1.2.9 », un bouton « Voir ce qui change » qui déplie les lignes des nouveautés dans le bandeau, et « OK » (comme aujourd'hui, une fois).
- Section « Dans tes lunettes » (h2), sous-titre « Mêmes rubriques, même ordre. », lien « Aperçu » vers #/affichage.
- Carte 1 : ligne « Favoris » avec leur nombre à droite, vers #/favoris ; dessous, en retrait, les 3 premiers favoris (HOME_FAVORITES) dans l'ordre des lunettes calculé par le téléphone (orderedFavorites), chacun avec sa réponse courte et son bouton « Lunettes » (comportement actuel) ; au-delà, « Voir les 2 autres favoris » les montre de la même façon (rien ne disparaît : en 1.2.8, tous avaient leur bouton). Sans favori : « Aucun favori » et « Ajouter un favori ». Écart voulu avec les lunettes : elles écartent un favori « tu y es », sans trajet dans les 3 heures, celui du trajet suivi, ou tous avec « L'accueil, sans favoris » ; le téléphone les garde, chacun avec son bouton.
- Carte 2, dans l'ordre des lunettes : « Autour de moi » (sous-titre « à moins de 500 m », le rayon réglé ; vers Affichage, qui revient alors à l'accueil, comme le lien « Aperçu ») ; « Gares de train » (sous-titre : les noms ; à droite « 2 gares ») ; « Arrêts de bus, tram, métro » (les noms ; « 1 arrêt ») ; « Lignes de bus, tram, métro » (les pastilles aux couleurs officielles ; « 3 lignes »). Rubrique vide : « à choisir » à droite, et le toucher ouvre l'ajout (comme aujourd'hui). La carte suit une gare, un arrêt ou une ligne gardés ou retirés ailleurs (★ des lunettes, Quai Web côte à côte).
- Plus de liste « Réglages » ni de grandes cartes avec « Retirer » sur l'accueil. La mention des sources passe dans Réglages (et reste dans Données).

### 2.2 Gares, Arrêts, Lignes (#/gares, #/arrets, #/lignes)
- Écran propre à chaque rubrique : retour « Accueil », titre de la rubrique, phrase « Dans tes lunettes, dans cet ordre. » (Lignes : suivie de « Chaque ligne s'y affiche dans les deux sens. »). Pas d'aperçu noir (retouche 3).
- La liste, dans l'ordre des lunettes ; chaque élément est une rangée compacte (une ligne : pastille, « Tram 3 », « STIB · Churchill ↔ Esplanade ») qui se déplie au toucher (aria-expanded) : interrupteur « Ouvrir d'office » (« à moins de 300 m », une ligne : « à moins de 300 m de Gare du Nord », seulement avec un arrêt repère, comme aujourd'hui) ; « Ordre dans les lunettes » (« 2e sur 3 ») avec ↑ et ↓ (« Monter … », « Descendre … », grisés aux bouts, règles de groupes actuelles) ; « Retirer cette gare / cet arrêt / cette ligne », confirmé dans la page. Repliée, une rangée ouverte d'office le dit : « Ouvre d'office près de Gare du Nord » pour une ligne, « Ouvre d'office à moins de 300 m » pour une gare ou un arrêt.
- Ajout sur le même écran (retouche 1, d'après la piste B) : « Près de toi » avec un bouton « Ajouter » / « Ajoutée » par élément, puis la recherche ; mêmes règles qu'aujourd'hui (pick-add.ts). « Près de toi » se calcule dès l'ouverture de l'écran, sur le téléphone : la dernière position connue, sinon une demande de 6 s au plus (en 1.2.8, seulement à l'ouverture de l'écran d'ajout). #/gares/ajouter, #/arrets/ajouter, #/lignes/ajouter et #/lignes/ajouter/ligne mènent à cet écran, curseur sur l'ajout ; une rubrique vide aussi ; #/lignes/ajouter/arret mène à celui des arrêts (une ligne s'ajoute entière depuis la 1.2.6).
- Tout ce que font les sections actuelles reste : limites, textes « introuvable », noms complétés, messages annoncés (liveRegion), arrêts d'une ligne, ouverture d'office.

### 2.3 Réglages (#/reglages, nouveau)
- Retour « Accueil », titre « Réglages », phrase « Favoris, gares, arrêts et lignes se règlent sur l'accueil, dans l'ordre des lunettes. »
- « Dans les lunettes » : Affichage (sous-titre : rayon, horaires prévus « ~ », pluie, selon les réglages) ; Alertes (résumé actuel, avec le seuil du retard).
- « Tes trajets » (retouche 2, d'après la piste A) : « Marche maximale » et « Marge avant de partir » réglables sur place avec − et + (mêmes bornes, pas et textes que l'écran Trajets) ; puis « Position et langue » (vers #/bienvenue).
- « Quai » : Données (sous-titre actuel).
- En bas : « Données : SNCB, STIB, De Lijn, TEC via Belgian Mobility Company ».
- #/trajets reste valable (ancien lien) ; « Mes favoris » n'est plus dans les réglages (la ligne « Favoris » de l'accueil y mène).
- Affichage, Alertes, Données, Position et langue et Trajets reviennent à Réglages ; Affichage ouvert depuis l'accueil y revient.

### 2.4 Affichage (#/affichage)
- Retour « Réglages » ; l'aperçu actuel de l'accueil des lunettes en haut.
- « Accueil des lunettes » : rayon de « Autour de moi » (300, 500, 800 m), ordre des favoris (Automatique, Dans mon ordre), À l'ouverture de Quai (les 3 choix actuels).
- « Sur tous les écrans » : Aides de gestes, Signaler les horaires prévus « ~ », Pluie pendant la marche (interrupteurs actuels).
- Mesuré à 390 × 844 : l'accueil tient sur un écran une fois le bandeau « Nouveau » fermé (896 px avec lui), Réglages aussi (808 px) ; Affichage dépasse encore d'environ un quart d'écran (1 064 px : l'aperçu et les trois choix de l'ouverture). À reprendre en 1.2.10 (l'ouverture sur un écran à part, comme la maquette C).

### 2.5 Règles communes
- Mêmes couleurs, polices et composants que l'appli (styles.css, ui.ts) ; cibles de 44 px au moins ; vrais boutons et liens ; focus gardé après un déplacement ou un retrait ; contraste 4,5:1.
- Français : tutoiement, typo() (espaces insécables), guillemets « », jamais de tiret long.
- Jamais d'adresse ni de position personnelle dans le code, les tests ou les captures.

## 3. Défauts trouvés en chemin
Seulement des défauts prouvés, chacun corrigé avec son test (trois équipes de recherche, puis trois relectures indépendantes) :
- Lunettes : une gare, un arrêt ou une ligne dont le rafraîchissement échoue garde sa dernière valeur au lieu de « … » ; un arrêt dont les départs gardés sont passés dit « … », jamais « aucun passage dans les prochaines heures ».
- Lunettes : « , demain » n'est plus coupé au titre des arrêts d'un départ et de « Dans le train » par une longue destination (TEC 69, 139, 24, 366, De Lijn 47 le 13/11) ; l'état (« , SUPPRIMÉ », « , +3 min ») non plus.
- Lunettes : la note « ~ horaire prévu » seulement sous une page qui montre un « ~ », aussi au détail d'une ligne et aux arrêts d'un départ de bus, tram ou métro (règle de la 1.2.8).
- Cœur : une ligne trouvée par son numéro est lue en entier au-delà de 16 fichiers (le « 2 » de Louvain et le « 4 » de Courtrai n'avaient qu'un sens).
- Cœur : les alertes « Travaux » de la STIB d'un trajet se lisent par numéro de ligne (métro 2 à Rogier : le message du tram 4, jamais le sien).
- Téléphone : effacer l'heure de « Changer l'heure » ne cherche plus pour minuit ; « Recherche… » n'est plus en rouge après un échec ; à la modification d'un lieu, une position arrivée après un autre choix ne le remplace plus ; un champ d'adresse quitté n'envoie plus de recherche d'adresse (et ne lève plus d'erreur une fois la page fermée).
- Téléphone : l'accueil suit une gare, un arrêt ou une ligne gardés ou retirés depuis les lunettes ; au-delà de 3 favoris, leur bouton « Lunettes » reste à portée ; « Rayon de « Autour de moi » » avec ses espaces insécables.
- Quai Web : espace insécable devant « : » dans l'aide sous l'écran des lunettes ; le message et la bannière des nouveautés parlent de l'onglet Réglages, pas du téléphone.

## 4. Nouveautés et version
- Version 1.2.9. Message « Quai 1.2.9 » des lunettes, une fois depuis la 1.2.8 ou avant : « « imminent » : seulement d'après le temps réel. », « Téléphone : l'accueil reprend celui des lunettes. » (Quai Web : « Onglet Réglages : il reprend l'accueil des lunettes. »), « Réglages : tout derrière un seul bouton. » ; depuis la 1.2.7 ou avant, aussi les trois lignes de la 1.2.8 (une version entière ou rien, 8 lignes au plus).
- Bannière « Nouveau » du téléphone (NEWS_129, variante Quai Web) et changelog app/store/changelog/1.2.9.txt.

## 5. Laissé pour la 1.2.10
- Affichage sur un seul écran (voir § 2.4).
- Code laissé par la refonte : les anciennes sections de l'accueil (picks.ts, pickSection) et leurs tests, leur CSS, le paramètre `focus` de homeScreen, quelques textes orphelins.
- À vérifier : les alertes « Travaux » des lignes et des tableaux des lunettes pour De Lijn et le TEC (controller.worksOf passe des numéros de ligne là où le filtre attend des route_id) ; le jour de service pendant l'heure du changement d'heure (serviceDayIndex) ; deux lignes du même numéro de régions différentes gardées en 1.2.5 (migration) ; `npm run dev:web` (développement seulement).

## 6. Contrôles avant publication
- Appli : 1 038 tests, typage sans erreur ; relais : 271 tests ; pipeline : 170 tests ; bout en bout sans affichage : 161 tests.
- Simulateur : 247 étapes sur 247 (nouveau scénario s129 : accueil, bannière, Réglages, Affichage, écran des lignes, ajout « Près de toi », favoris au-delà de 3, retour à l'accueil), puis téléphone, Quai Web, nouveautés et reprise refaits sur la version finale : 148 sur 148.
- Branche de vérification sur les vraies données du 14/11 : 831 lignes sans erreur, aucune introuvable par son numéro (2 avant) ; 3 228 trains sans erreur.
- Relectures indépendantes (téléphone ; lunettes et cœur ; ensemble de la version) : chaque défaut prouvé corrigé avec son test ; aucune adresse personnelle, aucune clé, aucun tiret long dans la version.
