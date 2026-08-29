-- Calendrier Équipe MDL v1.0.1
-- À exécuter dans Supabase > SQL Editor > Run.

create or replace function public.admin_delete_group(target_group_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  group_name text;
  member_count integer;
begin
  if not public.is_admin() then
    raise exception 'Seul un administrateur peut supprimer un groupe';
  end if;

  select name into group_name from public.groups where id = target_group_id;
  if group_name is null then
    raise exception 'Groupe introuvable';
  end if;

  select count(*) into member_count
  from public.user_groups
  where group_id = target_group_id;

  delete from public.manager_group_access where group_id = target_group_id;
  delete from public.user_groups where group_id = target_group_id;
  delete from public.groups where id = target_group_id;

  return format('Groupe « %s » supprimé. %s association(s) utilisateur retirée(s).', group_name, member_count);
end;
$$;

revoke all on function public.admin_delete_group(uuid) from public;
grant execute on function public.admin_delete_group(uuid) to authenticated;


create or replace function public.admin_delete_event_type(target_type_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  type_name text;
  usage_count integer;
begin
  if not public.is_admin() then
    raise exception 'Seul un administrateur peut supprimer un type de rendez-vous';
  end if;

  select name into type_name from public.event_types where id = target_type_id;
  if type_name is null then
    raise exception 'Type de rendez-vous introuvable';
  end if;

  select count(*) into usage_count
  from public.events
  where event_type_id = target_type_id;

  update public.events
  set event_type_id = null
  where event_type_id = target_type_id;

  delete from public.event_types
  where id = target_type_id;

  return format('Type « %s » supprimé. %s rendez-vous conservé(s).', type_name, usage_count);
end;
$$;

revoke all on function public.admin_delete_event_type(uuid) from public;
grant execute on function public.admin_delete_event_type(uuid) to authenticated;

select pg_notify('pgrst','reload schema');
