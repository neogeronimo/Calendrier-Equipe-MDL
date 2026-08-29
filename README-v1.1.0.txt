CALENDRIER ÉQUIPE MDL v1.1.0 — WEB PUSH ANDROID

Cette version ajoute Web Push :
- abonnement PushManager lié à l'utilisateur Supabase
- Service Worker reçoit les push même PWA fermée
- rappel serveur via Edge Function push-reminders
- clic sur notification rouvre l'application
- préférences de rappel stockées côté Supabase

Déjà fait dans le projet TEST par l'assistant :
- tables push_subscriptions, push_preferences, push_delivery_log
- Edge Function push-reminders déployée

RESTE À FAIRE :
1. Supabase > Edge Functions > Secrets : ajouter les 3 valeurs du fichier PUSH-SECRETS-v1.1.txt
2. SQL Editor : exécuter SQL-CRON-PUSH-v1.1.sql
3. GitHub : remplacer index.html, app.js, styles.css, manifest.webmanifest, sw.js
4. Android : rouvrir PWA, Réglages > Notifications > Activer
