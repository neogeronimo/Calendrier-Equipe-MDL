CALENDRIER ÉQUIPE MDL - v0.1.0
================================

Contenu :
- Connexion Supabase
- PWA responsive PC / Android
- Respect des safe areas (encoche/poinçon + barre système)
- Agenda des événements visibles par l'utilisateur connecté
- Onglet Équipe pour planificateurs/responsables/admins
- Administration de base pour les administrateurs
- Création visuelle de groupes
- Modification visuelle du rôle d'un utilisateur

IMPORTANT
---------
Cette version utilise la clé publique "anon" Supabase, ce qui est normal pour une application Web.
Ne jamais ajouter de service_role key, mot de passe de base de données ou secret JWT dans config.js.

TEST LOCAL
----------
Une PWA / module JavaScript doit être ouverte via HTTP, pas par double-clic sur index.html.

Depuis le dossier du projet :

  python -m http.server 8080

Puis ouvrir :
  http://localhost:8080

Aucun Java n'est nécessaire.

DÉPLOIEMENT
-----------
Cette application est statique et pourra ensuite être publiée gratuitement sur un hébergement compatible HTTPS.
