CALENDRIER ÉQUIPE MDL v1.0.4 — AUTORISATION NOTIFICATIONS ANDROID

Correction du comportement Android :
- cocher "Activer les notifications" déclenche immédiatement la demande Android
- si Android autorise : la case reste cochée et le choix est mémorisé
- si Android refuse : la case se décoche volontairement et l'application explique
  où réactiver les notifications dans les paramètres système
- "Tester une notification" demande également l'autorisation si elle n'a jamais
  encore été accordée
- un test réussi active et mémorise automatiquement les notifications
- le délai et les autres préférences restent mémorisés

IMPORTANT :
Si Android a déjà enregistré un REFUS, le navigateur ne peut généralement plus
réafficher la demande automatiquement. Il faut alors aller dans :
Paramètres Android > Applications > Calendrier Équipe MDL (ou Chrome) >
Notifications > Autoriser.

Aucun SQL.
Aucune Edge Function.
Aucun Firebase.

GitHub :
remplacer index.html, app.js, styles.css, manifest.webmanifest et sw.js.
