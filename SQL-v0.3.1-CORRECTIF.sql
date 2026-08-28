-- Calendrier Équipe MDL v0.3.1
-- Correctif administration utilisateurs / groupes
-- À exécuter dans Supabase > SQL Editor.

create or replace function public.manager_list_profiles()
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
    ) as group_ids,
    coalesce(
      array_agg(g.name order by g.name)
        filter (where g.name is not null),
      '{}'::text[]
    ) as group_names,
    (
      array_agg(ug.group_id)
        filter (where ug.is_primary = true)
    )[1] as primary_group_id
  from public.profiles p
  left join auth.users u on u.id = p.id
  left join public.user_groups ug on ug.user_id = p.id
  left join public.groups g on g.id = ug.group_id
  group by
    p.id,u.email,p.first_name,p.last_name,p.display_name,
    p.role,p.is_active,p.has_global_scope,
    p.share_calendar,p.calendar_share_mode
  order by coalesce(p.display_name,u.email::text);
end;
$$;

revoke all on function public.manager_list_profiles() from public;
grant execute on function public.manager_list_profiles() to authenticated;


create or replace function public.manager_create_group(
  new_name text,
  new_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if not public.can_manage_users() then
    raise exception 'Accès administrateur ou responsable requis';
  end if;

  if nullif(trim(new_name),'') is null then
    raise exception 'Le nom du groupe est obligatoire';
  end if;

  insert into public.groups(name,description,is_active)
  values(trim(new_name),nullif(trim(new_description),''),true)
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.manager_create_group(text,text) from public;
grant execute on function public.manager_create_group(text,text) to authenticated;
