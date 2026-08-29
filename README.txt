CALENDRIER ÉQUIPE MDL v0.5.2

CORRECTIF RECHERCHE DE DISPONIBILITÉS

Erreur corrigée :
Recherche impossible : computeCommonSlots is not defined

Cause :
Lors du gros lot v0.5.0 / v0.5.1, le moteur de calcul précis des disponibilités
de la v0.4.2 n'a pas été conservé dans app.js.

Correction :
- restauration du moteur validé de v0.4.2 ;
- prise en compte des rendez-vous propriétaires ;
- prise en compte des rendez-vous participants ;
- journées entières bloquantes ;
- horaires personnalisés ;
- horaires par défaut ;
- pause déjeuner ;
- jours non travaillés ;
- créneaux déjà passés.

INSTALLATION
Aucun SQL.
Aucune Edge Function.

GitHub :
- remplacer index.html
- remplacer app.js

styles.css peut rester celui de v0.5.1.

Puis attendre GitHub Pages et faire Ctrl+F5.
