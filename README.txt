CALENDRIER ÉQUIPE MDL v0.9.1 — ANDROID CONFORT

CORRECTIFS PRINCIPAUX

1. NOTIFICATIONS ANDROID
La v0.9.0 utilisait principalement new Notification(), qui n'est pas la voie
fiable sur Android. La v0.9.1 passe par le Service Worker et
registration.showNotification().

Le bouton "Tester une notification" doit maintenant produire une vraie
notification système Android si l'autorisation est accordée.

Une vibration courte est demandée lorsque l'appareil l'autorise.

IMPORTANT :
Le son d'une notification Web/PWA est contrôlé par Android et par le canal
de notification du navigateur/PWA. Une application Web ne peut pas imposer
fiablement sa propre sonnerie.

Pour vérifier :
Paramètres Android > Applications > Calendrier MDL ou Chrome >
Notifications > autoriser les notifications et vérifier que le canal n'est
pas en mode silencieux.

2. INTERFACE MOBILE
Refonte "Android Confort" automatique sous 860 px :
- police générale beaucoup plus grande
- boutons tactiles plus hauts
- KPI lisibles
- cartes et formulaires agrandis
- notifications plus lisibles
- dialogues presque plein écran
- navigation basse plus grande
- planning horizontal conservé mais avec textes et événements agrandis
- zones de saisie dimensionnées pour le tactile
- meilleure prise en compte de la safe area

3. INSTALLATION
Aucun SQL.
Aucune Edge Function.

Sur GitHub remplacer :
- index.html
- app.js
- styles.css
- manifest.webmanifest
- sw.js

ATTENTION AU CACHE PWA
Après publication :
- fermer complètement l'application PWA
- la rouvrir
- si l'ancienne interface reste affichée, supprimer l'application de l'écran
  d'accueil puis la réinstaller une fois.

TEST CONSEILLÉ
- Mes réglages > Notifications > Activer
- accepter l'autorisation Android
- cliquer "Tester une notification"
- tester le dashboard et le planning en portrait
- tester la création d'un rendez-vous et d'une absence
