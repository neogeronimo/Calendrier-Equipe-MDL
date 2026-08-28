-- Calendrier Équipe MDL v0.3.2
-- Correctif forcé : liste utilisateurs + création groupe + cache API
-- Exécuter TOUT ce fichier dans Supabase > SQL Editor > Run.

-- 1) On supprime explicitement les fonctions concernées pour être certain
--    qu'aucune ancienne version ne reste active.
drop function if exists public.manager_list_profiles();
drop function if exists public.manager_create_group(text,text);

-- 2) Liste utilisateurs : aucune utilisation de max(uuid).
create function public.manager_list_profiles()
returns table (
  id uuid,
  email text,
  first_name text,
  last_name text,
  display_name text,
  role text,
  is_active boolean,
  has_global_scope boolean,
  share_calendar boolean,
  calendar_share_mode text,
  group_ids uuid[],
  group_names text[],
  primary_group_id uuid
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.can_manage_users() then
    raise exception 'Accès administrateur ou responsable requis';
  end if;

  return query
  select
    p.id,
    u.email::text,
    p.first_name,
    p.last_name,
    p.display_name,
    p.role,
    p.is_active,
    p.has_global_scope,
    p.share_calendar,
    p.calendar_share_mode,
    coalesce(
      array_agg(ug.group_id order by g.name)
        filter (where ug.group_id is not null),
      '{}'::uuid[]
    ),
    coalesce(
      array_agg(g.name order by g.name)
        filter (where g.name is not null),
      '{}'::text[]
    ),
    (
      array_agg(ug.group_id order by g.name)
        filter (where ug.is_primary = true)
    )[1]
  from public.profiles p
  left join auth.users u on u.id = p.id
  left join public.user_groups ug on ug.user_id = p.id
  left join public.groups g on g.id = ug.group_id
  group by
    p.id, u.email, p.first_name, p.last_name, p.display_name,
    p.role, p.is_active, p.has_global_scope,
    p.share_calendar, p.calendar_share_mode
  order by coalesce(p.display_name, u.email::text);
end;
$$;

revoke all on function public.manager_list_profiles() from public;
grant execute on function public.manager_list_profiles() to authenticated;

-- 3) Création d'un groupe pour administrateurs ET responsables.
create function public.manager_create_group(
  new_name text,
  new_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_id uuid;
begin
  if not public.can_manage_users() then
    raise exception 'Accès administrateur ou responsable requis';
  end if;

  if nullif(trim(new_name), '') is null then
    raise exception 'Le nom du groupe est obligatoire';
  end if;

  insert into public.groups(name, description, is_active)
  values (
    trim(new_name),
    nullif(trim(coalesce(new_description,'')), ''),
    true
  )
  returning id into created_id;

  return created_id;
end;
$$;

revoke all on function public.manager_create_group(text,text) from public;
grant execute on function public.manager_create_group(text,text) to authenticated;

-- 4) On demande explicitement à l'API Supabase/PostgREST de relire le schéma.
select pg_notify('pgrst', 'reload schema');

-- Contrôle final : cette requête doit retourner 2 lignes.
select
  p.proname as fonction,
  pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('manager_list_profiles','manager_create_group')
order by p.proname;
