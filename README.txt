CALENDRIER ÉQUIPE MDL v0.8.0 — PLANNING PRO + MOBILE

GROS LOT
- PWA réactivée : installation possible depuis le navigateur mobile.
- Navigation et dashboard mobile renforcés.
- Actions rapides mobile : rendez-vous, absence, disponibilités.
- Déclaration d'absence dédiée, journée entière et multi-jours.
- Les absences bloquent automatiquement les disponibilités.
- Horaires individuels dans Mes réglages.
- Un utilisateur gère ses propres horaires.
- Un administrateur peut sélectionner un utilisateur et gérer ses horaires.
- Filtres supplémentaires du planning équipe par type et statut.
- Toute la logique v0.7.2 est conservée.

INSTALLATION POUR TEST MOBILE
Aucun nouveau SQL.
Aucune Edge Function.

Sur GitHub remplacer :
- index.html
- app.js
- styles.css
- manifest.webmanifest
- sw.js

Conserver le dossier icons.
Attendre GitHub Pages puis Ctrl+F5 sur PC.
Sur téléphone, fermer/réouvrir le site ou actualiser. Le navigateur pourra proposer
"Installer l'application" / "Ajouter à l'écran d'accueil".

NOTE
Les horaires individuels utilisent la table working_hours déjà présente.
Selon les règles actuelles, un technicien modifie les siens et un administrateur
peut gérer ceux des autres.
