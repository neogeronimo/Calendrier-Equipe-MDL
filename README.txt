CALENDRIER ÉQUIPE MDL v0.4.0

OBJECTIF DE CETTE VERSION
Accélérer le passage du prototype à un outil réellement utilisable par les planificateurs.

NOUVEAUTÉS
- Planning équipe multi-techniciens.
- Filtre par groupe.
- Affichage 1 / 3 / 5 / 7 jours.
- Sélection de plusieurs techniciens.
- Événements où le technicien est propriétaire OU participant.
- Double-clic dans une case vide du planning équipe pour préparer un rendez-vous.
- Recherche de créneaux communs conservée et améliorée.
- Un créneau commun peut créer directement une réunion avec tous les techniciens sélectionnés comme participants.
- Gestion des participants dans la fenêtre Rendez-vous.
- Export Excel du planning équipe.
- Gestion utilisateurs v0.3.6 conservée, avec création/suppression sécurisées.
- Interface responsive PC / téléphone.

INSTALLATION SI TA v0.3.6 FONCTIONNE DÉJÀ
1. AUCUN SQL supplémentaire.
2. AUCUNE modification de l'Edge Function admin-users.
3. Sur GitHub, remplacer :
   - index.html
   - app.js
   - styles.css
4. Attendre GitHub Pages puis Ctrl+F5.

IMPORTANT
Les fichiers SQL v0.3.6 et Edge Function v0.3.6 sont inclus dans le pack uniquement
pour garder une version complète et autonome du projet. Si ta gestion utilisateurs
fonctionne déjà, ne les rejoue pas.

TEST RAPIDE
- Équipe > choisir un groupe.
- Sélectionner 2 techniciens.
- Vérifier que leurs rendez-vous apparaissent.
- Rechercher un créneau commun.
- Cliquer "Créer une réunion".
- Vérifier que les techniciens sont précochés comme participants.
- Enregistrer.
- Vérifier que la réunion apparaît dans le planning des participants.
