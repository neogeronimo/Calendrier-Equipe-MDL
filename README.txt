CALENDRIER ÉQUIPE MDL v0.7.2 — CORRECTIF MENU LATÉRAL

Problème corrigé :
Le nouveau menu de gauche pouvait s'afficher mais ne pas changer de page.

Correction :
- navigation pilotée par un écouteur global robuste ;
- fonctionne même après reconnexion ou reconstruction de l'interface ;
- chaque clic sur Tableau de bord, Agenda, Planning équipe, Groupes,
  Techniciens, Réglages ou Administration ouvre explicitement le panneau attendu ;
- contrôle des droits conservé pour Équipe et Administration ;
- bouton Créer un rendez-vous et exports latéraux rendus indépendants ;
- erreurs de chargement affichées au lieu de bloquer silencieusement.

INSTALLATION
Aucun SQL.
Aucune Edge Function.

Sur GitHub remplacer :
- index.html
- app.js

Le styles.css de v0.7.1 peut rester.
Puis attendre GitHub Pages et faire Ctrl+F5.
