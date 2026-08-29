CALENDRIER ÉQUIPE MDL v1.0.0 — FINAL RELEASE

OBJECTIF
Version stabilisée pour validation finale avant passage TEST -> PROD.

CORRECTIFS ET FINITIONS
- Correction définitive du chargement des horaires individuels et des réglages
  de notifications via le nouveau menu.
- Correction de la version du Service Worker.
- Bouton de synchronisation manuelle.
- Détection en ligne / hors ligne.
- Bandeau hors connexion.
- Diagnostic intégré dans Réglages :
  version, plateforme, HTTPS, Service Worker, PWA, notifications,
  accès Supabase, rôle, référentiels chargés.
- Copie du diagnostic en un clic.
- Mise à jour automatique du Service Worker.
- Interface Android Confort conservée.
- Notifications système Android via Service Worker conservées.
- Toutes les fonctions v0.9.1 conservées.

AUCUNE ACTION SQL OBLIGATOIRE POUR CETTE V1.
AUCUNE MODIFICATION EDGE FUNCTION OBLIGATOIRE POUR CETTE V1.

POUR TESTER SUR L'INFRA DE TEST
Remplacer sur GitHub :
- index.html
- app.js
- styles.css
- manifest.webmanifest
- sw.js

Le fichier config.js existant peut rester inchangé.

PASSAGE EN PRODUCTION
Le pack contient config.PRODUCTION.example.js pour rappeler qu'en production
le front doit uniquement utiliser la clé publique Supabase.
Ne jamais mettre service_role dans le navigateur.

Firebase/FCM n'est PAS requis pour valider cette v1.
Les notifications actuelles fonctionnent comme notifications Web/PWA lorsque
l'application est active/installée. Les push totalement indépendantes de
l'ouverture de l'application pourront être ajoutées ultérieurement.
