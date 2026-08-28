CALENDRIER ÉQUIPE MDL v0.3.1 — CORRECTIF

Ce correctif règle 3 points :
1. Erreur PostgreSQL "function max(uuid) does not exist".
2. Création de groupe qui semblait ne rien faire.
3. Edge Function admin-users modernisée avec @supabase/server et erreurs lisibles.

INSTALLATION

A. Supabase > SQL Editor
Exécuter : SQL-v0.3.1-CORRECTIF.sql

B. Supabase > Edge Functions > admin-users
Ouvrir la fonction existante, remplacer TOUT son code par :
EDGE-FUNCTION-admin-users-v0.3.1.txt
Puis déployer une nouvelle version.

IMPORTANT POUR L'EDGE FUNCTION
Avec @supabase/server et auth:'user', la recommandation Supabase actuelle est
d'utiliser l'autorisation gérée par le SDK. Si l'éditeur Dashboard propose une
option "Verify JWT", laisser la valeur compatible avec un appel utilisateur
authentifié. Si une erreur d'authentification de plateforme apparaît avant même
l'exécution, ouvrir les réglages de la fonction et désactiver "Verify JWT", car
le SDK effectue lui-même la validation de l'utilisateur.

C. GitHub
Remplacer index.html et app.js par ceux de v0.3.1 (styles.css peut aussi être remplacé).
Attendre le déploiement puis Ctrl+F5.
