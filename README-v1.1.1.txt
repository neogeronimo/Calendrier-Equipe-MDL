CALENDRIER ÉQUIPE MDL v1.1.1 — FIX ABONNEMENT PUSH

Correction :
- currentUser n'existait pas dans l'application.
- Le code Push utilise maintenant currentProfile.id, qui correspond à l'ID auth Supabase.
- L'abonnement Push Android peut désormais être enregistré dans push_subscriptions.
- Les préférences Push peuvent désormais être lues/écrites dans push_preferences.

Aucun SQL supplémentaire.
Aucune modification Edge Function.
Les secrets VAPID et le cron de la v1.1.0 restent valables.

GitHub :
remplacer index.html, app.js, styles.css, manifest.webmanifest et sw.js.
