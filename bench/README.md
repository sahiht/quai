# Banc d'essai des itinéraires

Pour vérifier que Quai propose des trajets cohérents, et choisir la règle de classement de la version 1.2.2.

- `trips.json` : 50 trajets × 3 moments (vendredi 13/11 07:30 et 17:30, samedi 14/11 11:00). Uniquement des gares, des arrêts et des lieux publics ; aucune adresse personnelle.
- Les données de Quai pour ces journées viennent du workflow « Instantané des données (tests) », lancé avec la date du premier jour.
- Références externes, sans Google : Transitous (calculateur libre et communautaire, moteur MOTIS) et iRail pour les trains.
- Contrôle interne : un calcul exhaustif sur les mêmes données vérifie qu'aucun trajet n'est à la fois plus rapide, moins marché et moins changeant que le premier proposé.
