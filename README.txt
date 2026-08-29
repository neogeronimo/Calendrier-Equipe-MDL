CALENDRIER ÉQUIPE MDL v0.4.2

CORRECTIF JOURNÉE ENTIÈRE

Problème :
Un rendez-vous coché "Journée entière" conservait ses heures internes
(ex. 08:15-09:15). La recherche de disponibilités voyait alors le technicien
comme occupé uniquement pendant cette heure.

Correction :
- la recherche lit maintenant le champ all_day ;
- un événement Journée entière bloque toute la journée concernée ;
- cela fonctionne aussi pour les rendez-vous où le technicien est participant ;
- les événements annulés et participations refusées restent ignorés.

INSTALLATION
Aucun SQL.
Aucune Edge Function.

Sur GitHub remplacer uniquement :
- index.html
- app.js

Puis attendre GitHub Pages et faire Ctrl+F5.
