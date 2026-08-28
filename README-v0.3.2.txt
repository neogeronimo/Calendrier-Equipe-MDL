CALENDRIER ÉQUIPE MDL v0.3.2 — CORRECTIF FORCÉ

Les captures reçues montrent 3 problèmes distincts corrigés ici :

1) "function max(uuid) does not exist"
   L'ancienne fonction manager_list_profiles est supprimée puis recréée.
   La nouvelle version n'utilise plus jamais max() sur un UUID.

2) "Could not find the function public.manager_create_group(...) in the schema cache"
   La fonction manager_create_group est recréée et le cache API PostgREST
   est explicitement rechargé avec pg_notify('pgrst','reload schema').

3) Fenêtre Nouveau rendez-vous trop large / coupée
   Le formulaire avait une largeur basée sur le viewport à l'intérieur d'un
   dialogue plus petit, ce qui provoquait le défilement horizontal.
   Les fenêtres rendez-vous, utilisateurs et suppression sont maintenant
   limitées à la largeur réellement disponible sur PC comme sur téléphone.

INSTALLATION

ÉTAPE 1 — SUPABASE
SQL Editor > New query
Copier TOUT le contenu de :
SQL-v0.3.2-CORRECTIF-FORCE.sql
puis Run.

À la fin, Supabase doit afficher DEUX lignes :
- manager_create_group | new_name text, new_description text
- manager_list_profiles | [arguments vides]

Si ces deux lignes sont présentes, le correctif SQL est bien installé.

ÉTAPE 2 — GITHUB
Remplacer au minimum :
- index.html
- app.js
- styles.css

Attendre le déploiement GitHub Pages puis faire Ctrl+F5.

EDGE FUNCTION
Pas besoin de modifier à nouveau admin-users pour ces trois correctifs.
Conserver la version v0.3.1 déjà déployée.

IMPORTANT
Ne pas réexécuter les anciens SQL v0.3.0 ou v0.3.1 après ce correctif.
Ils ont été retirés du pack v0.3.2 pour éviter toute confusion.
