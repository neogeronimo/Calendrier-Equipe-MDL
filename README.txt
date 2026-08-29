CALENDRIER ÉQUIPE MDL v0.7.1 — CORRECTIF DASHBOARD

Correction de l'erreur de connexion :
Cannot set properties of null (setting 'hidden')

CAUSE
La refonte v0.7.0 avait retiré de l'HTML certains anciens éléments attendus par
le JavaScript, notamment teamTab/adminTab, et avait créé des panneaux Agenda,
Équipe, Réglages et Administration vides.

CORRECTIONS
- références teamTab/adminTab rendues compatibles avec la nouvelle sidebar ;
- restauration complète des panneaux fonctionnels de la v0.6.0 ;
- Agenda conservé ;
- Planning équipe conservé ;
- Recherche de disponibilités conservée ;
- Réglages conservés ;
- Administration utilisateurs/groupes/types/horaires conservée ;
- nouveau Dashboard v0.7 conservé ;
- initialisation du dashboard sécurisée contre les doubles branchements.

INSTALLATION
Aucun SQL.
Aucune Edge Function.

Remplacer sur GitHub :
- index.html
- app.js

styles.css de la v0.7.0 peut rester, mais le ZIP contient l'ensemble complet.
Puis Ctrl + F5.
