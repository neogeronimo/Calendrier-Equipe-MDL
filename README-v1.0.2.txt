CALENDRIER ÉQUIPE MDL v1.0.2 — PERSISTANCE NOTIFICATIONS ANDROID

Correctif :
- l'activation des notifications est restaurée au redémarrage
- si Android a déjà accordé l'autorisation système, l'application réactive
  automatiquement les rappels
- les réglages sont sauvegardés dès qu'un interrupteur ou délai change
- le bouton Enregistrer confirme explicitement la mémorisation

Aucun SQL.
Aucune Edge Function.
Aucun Firebase.

GitHub :
remplacer index.html, app.js, styles.css, manifest.webmanifest et sw.js.

Sur Android :
fermer complètement l'application puis la rouvrir après publication.
Si l'ancienne version reste en cache, supprimer/réinstaller la PWA une seule fois.
