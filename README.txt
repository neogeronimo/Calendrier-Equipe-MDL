CALENDRIER ÉQUIPE MDL v0.3.6 — CORRECTIF DÉFINITIF GESTION UTILISATEURS

Le message "permission denied for table profiles" montre que l'accès Data API
avec le client secret n'est pas la bonne voie dans notre configuration.

La v0.3.6 sépare donc complètement les responsabilités :
- JWT utilisateur + RPC SECURITY DEFINER pour TOUTES les opérations BDD ;
- clé secrète uniquement pour Supabase Auth admin (création/suppression du compte).

INSTALLATION

1) Supabase > SQL Editor
   Exécuter SQL-v0.3.6-UTILISATEURS.sql
   Résultat attendu : Success.

2) Supabase > Edge Functions > admin-users > Code
   Remplacer TOUT le code par EDGE-FUNCTION-admin-users-v0.3.6.txt
   Puis Deploy.

3) Settings de admin-users
   Verify JWT with legacy secret = OFF
   Save changes.

4) Aucun changement GitHub.
   Retester + Nouvel utilisateur.

Cette version ne fait plus aucun SELECT/UPDATE/DELETE direct sur public.profiles
avec la clé secrète. La clé secrète ne sert qu'à auth.admin.createUser() et
auth.admin.deleteUser().
