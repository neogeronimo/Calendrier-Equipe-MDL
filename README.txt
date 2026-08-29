CALENDRIER ÉQUIPE MDL v0.9.0 — NOTIFICATIONS & FINITIONS

GROS LOT V9

NOTIFICATIONS
- Centre d'alertes dans le bandeau.
- Badge de notifications non lues.
- Alertes intégrées au dashboard.
- Préférences de notification dans Mes réglages.
- Rappel navigateur configurable : 5 / 10 / 15 / 30 / 60 minutes.
- Notification de test.
- Les préférences sont conservées localement sur l'appareil.
- Les rappels fonctionnent lorsque l'application est ouverte/installée.
  Les vraies notifications push en arrière-plan via Firebase/FCM viendront dans le lot production.

ABSENCES
- Absence dédiée conservée.
- Possibilité de marquer une absence comme provisoire.
- Style spécifique dans le planning.
- Filtre "Absences uniquement" dans Planning équipe.
- Réinitialisation rapide des filtres.

PWA / MOBILE
- État de l'installation dans Mes réglages.
- Bouton Installer l'application lorsque le navigateur expose l'installation.
- Service worker/cache versionné v0.9.
- Centre d'alertes adapté au téléphone.
- Navigation mobile et actions rapides conservées.

ADMINISTRATION / SÉCURITÉ
- Les règles existantes restent inchangées.
- Un fichier SQL OPTIONNEL permet de préparer un futur journal d'audit admin.
- Ne pas exécuter ce SQL pour tester la v0.9.0 : il n'est pas requis.

INSTALLATION POUR TEST
Aucun SQL obligatoire.
Aucune Edge Function.

Sur GitHub remplacer :
- index.html
- app.js
- styles.css
- manifest.webmanifest
- sw.js

Puis attendre GitHub Pages.
PC : Ctrl+F5.
Mobile : fermer/réouvrir le site ou vider l'ancien onglet si nécessaire.

À TESTER
1. Tableau de bord.
2. Menu latéral / navigation mobile.
3. Création rendez-vous.
4. Déclaration absence, y compris provisoire.
5. Filtre Absences uniquement.
6. Mes réglages > Horaires individuels.
7. Mes réglages > Notifications > Autoriser > Tester.
8. Installation PWA / Ajouter à l'écran d'accueil.
