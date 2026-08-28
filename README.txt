CALENDRIER ÉQUIPE MDL v0.3.0

NOUVEAUTÉS
- Administration accessible aux administrateurs ET responsables.
- Création d'utilisateurs depuis l'application.
- Modification du rôle, groupes, groupe principal, statut et accès global.
- Désactivation / réactivation d'un compte.
- Suppression sécurisée en 2 étapes :
  1) génération obligatoire d'une archive Excel (.xlsx),
  2) confirmation explicite avant suppression définitive.
- L'archive contient deux feuilles : Informations et Calendrier.
- Un responsable ne peut pas créer/modifier/supprimer un administrateur.
- Impossible de supprimer son propre compte.
- Impossible de supprimer le dernier administrateur actif.

INSTALLATION SANS NODE / SANS SERVEUR LOCAL

1) SUPABASE > SQL Editor
   Exécuter SQL-v0.3.0.sql.

2) SUPABASE > Edge Functions
   Cliquer "Deploy a new function" puis "Via Editor".
   Nom EXACT de la fonction : admin-users
   Coller le contenu de EDGE-FUNCTION-admin-users.txt (ou supabase/functions/admin-users/index.ts).
   Déployer la fonction.

   Aucun service_role n'est à mettre dans GitHub ou config.js.
   Supabase fournit la clé serveur à l'Edge Function via ses secrets hébergés.

3) GITHUB
   Décompresser ce ZIP et remplacer les fichiers de la racine du dépôt
   par ceux de Calendrier-Equipe-MDL-v0.3.0.
   index.html, app.js, styles.css et config.js doivent rester à la racine.
   Le dossier supabase peut rester dans GitHub : il ne contient AUCUN secret.

4) Attendre le redéploiement GitHub Pages puis faire Ctrl+F5.

IMPORTANT
La création/suppression de comptes Auth ne peut pas être réalisée de façon sûre
directement dans le navigateur avec la clé publique. C'est pourquoi v0.3.0 utilise
une Supabase Edge Function côté serveur, tout en restant sans serveur local.
