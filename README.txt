CALENDRIER ÉQUIPE MDL v0.4.1

CORRECTIFS
- La recherche de disponibilités est recalculée directement à partir de get_busy_slots()
  pour CHAQUE technicien sélectionné.
- Sont pris en compte :
  * rendez-vous dont il est propriétaire,
  * rendez-vous auxquels il participe,
  * horaires de travail personnalisés,
  * horaires par défaut 08:00-18:00,
  * pause déjeuner,
  * jours non travaillés,
  * créneaux déjà passés.
- La sélection des participants dans "Nouveau rendez-vous" fonctionne maintenant réellement.
- Les participants sélectionnés restent visibles sous forme de pastilles pendant la recherche.
- "Créer une réunion" préselectionne automatiquement tous les techniciens du créneau commun.

INSTALLATION
Aucun SQL.
Aucune Edge Function.

GitHub : remplacer uniquement
- index.html
- app.js
- styles.css

Puis attendre GitHub Pages et faire Ctrl+F5.
