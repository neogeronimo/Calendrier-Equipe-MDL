CALENDRIER ÉQUIPE MDL v1.1.2 — RÉPARATION PUSH ANDROID

Le serveur Supabase a confirmé l'envoi du rappel, mais le téléphone ne l'a pas affiché.
Cette version répare donc la partie appareil :
- force la mise à jour du Service Worker
- supprime l'ancien abonnement Push navigateur
- supprime les anciens endpoints Push du compte
- recrée un abonnement FCM neuf
- réenregistre les clés p256dh/auth dans Supabase
- ne garde qu'un abonnement actif propre pour ce téléphone
- Service Worker Push réécrit et simplifié
- prise en charge plus robuste du payload Push
- icônes de notification résolues avec URL absolue

La réparation s'exécute automatiquement une seule fois à l'ouverture des Réglages si les notifications sont activées.

Aucun SQL supplémentaire.
Aucune nouvelle Edge Function.

GitHub : remplacer index.html, app.js, styles.css, manifest.webmanifest et sw.js.
