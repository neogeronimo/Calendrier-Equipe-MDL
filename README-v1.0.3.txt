CALENDRIER ÉQUIPE MDL v1.0.3 — CORRECTIF RÉGLAGES ANDROID

CORRIGÉ :
- erreur "roleLabel is not defined" dans Mes réglages
- cette erreur interrompait le chargement avant la restauration des notifications
- chaque carte de Réglages se charge indépendamment
- l'activation des notifications est restaurée depuis la mémoire locale
- l'autorisation Android n'écrase plus un choix explicite
- diagnostic : contrôle de la mémoire locale

AUCUN SQL.
AUCUNE EDGE FUNCTION.
AUCUN FIREBASE.

GITHUB :
remplacer index.html, app.js, styles.css, manifest.webmanifest et sw.js.

ANDROID :
après publication, fermer complètement la PWA puis la rouvrir.
Dans Réglages > Notifications :
1. activer
2. choisir le délai
3. Enregistrer
4. fermer complètement l'application
5. la relancer
L'activation doit rester cochée.
