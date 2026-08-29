-- Calendrier Équipe MDL v0.3.6
-- Gestion utilisateurs via RPC SECURITY DEFINER.
-- But : l'Edge Function n'accède plus directement aux tables avec la clé secrète.
-- À exécuter dans Supabase > SQL Editor > Run.

create or replace function public.manager_create_user_profile(
  target_user_id uuid,
  new_first_name text,
  new_last_name text,
  new_display_name text,
  new_role text,
  new_is_active boolean,
  new_has_global_scope boolean,
  new_group_ids uuid[] default '{}'::uuid[],
  new_primary_group_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  if not public.can_manage_users() then
    raise exception 'Accès administrateur ou responsable requis';
  end if;

  select p.role into caller_role
  from public.profiles p
  where p.id = auth.uid();

  if new_role not in ('technicien','planificateur','responsable','administrateur') then
    raise exception 'Rôle invalide';
  end if;

  if caller_role <> 'administrateur' and new_role = 'administrateur' then
    raise exception 'Seul un administrateur peut créer un administrateur';
  end if;

  update public.profiles
  set first_name = nullif(trim(coalesce(new_first_name,'')),''),
      last_name = nullif(trim(coalesce(new_last_name,'')),''),
      display_name = coalesce(
        nullif(trim(coalesce(new_display_name,'')),''),
        nullif(trim(concat_ws(' ',new_first_name,new_last_name)),'')
      ),
      role = new_role,
      is_active = coalesce(new_is_active,true),
      has_global_scope = coalesce(new_has_global_scope,false)
  where id = target_user_id;

  if not found then
    raise exception 'Profil automatique introuvable pour le nouvel utilisateur';
  end if;

  delete from public.user_groups where user_id = target_user_id;

  if coalesce(array_length(new_group_ids,1),0) > 0 then
    insert into public.user_groups(user_id,group_id,is_primary)
    select
      target_user_id,
      gid,
      (new_primary_group_id is not null and gid = new_primary_group_id)
    from unnest(new_group_ids) as gid;
  end if;
end;
$$;

revoke all on function public.manager_create_user_profile(uuid,text,text,text,text,boolean,boolean,uuid[],uuid) from public;
grant execute on function public.manager_create_user_profile(uuid,text,text,text,text,boolean,boolean,uuid[],uuid) to authenticated;


create or replace function public.manager_update_user_profile(
  target_user_id uuid,
  new_first_name text,
  new_last_name text,
  new_display_name text,
  new_role text,
  new_is_active boolean,
  new_has_global_scope boolean,
  new_group_ids uuid[] default '{}'::uuid[],
  new_primary_group_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  target_role text;
begin
  if not public.can_manage_users() then
    raise exception 'Accès administrateur ou responsable requis';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'Cette opération est interdite sur votre propre compte';
  end if;

  select p.role into caller_role from public.profiles p where p.id = auth.uid();
  select p.role into target_role from public.profiles p where p.id = target_user_id;

  if target_role is null then
    raise exception 'Utilisateur introuvable';
  end if;

  if caller_role = 'responsable' and target_role = 'administrateur' then
    raise exception 'Un responsable ne peut pas gérer un administrateur';
  end if;

  if new_role not in ('technicien','planificateur','responsable','administrateur') then
    raise exception 'Rôle invalide';
  end if;

  if caller_role <> 'administrateur' and new_role = 'administrateur' then
    raise exception 'Seul un administrateur peut attribuer le rôle administrateur';
  end if;

  update public.profiles
  set first_name = nullif(trim(coalesce(new_first_name,'')),''),
      last_name = nullif(trim(coalesce(new_last_name,'')),''),
      display_name = coalesce(
        nullif(trim(coalesce(new_display_name,'')),''),
        nullif(trim(concat_ws(' ',new_first_name,new_last_name)),'')
      ),
      role = new_role,
      is_active = coalesce(new_is_active,true),
      has_global_scope = coalesce(new_has_global_scope,false)
  where id = target_user_id;

  delete from public.user_groups where user_id = target_user_id;

  if coalesce(array_length(new_group_ids,1),0) > 0 then
    insert into public.user_groups(user_id,group_id,is_primary)
    select
      target_user_id,
      gid,
      (new_primary_group_id is not null and gid = new_primary_group_id)
    from unnest(new_group_ids) as gid;
  end if;
end;
$$;

revoke all on function public.manager_update_user_profile(uuid,text,text,text,text,boolean,boolean,uuid[],uuid) from public;
grant execute on function public.manager_update_user_profile(uuid,text,text,text,text,boolean,boolean,uuid[],uuid) to authenticated;


create or replace function public.manager_set_user_active(
  target_user_id uuid,
  new_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  target_role text;
begin
  if not public.can_manage_users() then
    raise exception 'Accès administrateur ou responsable requis';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'Cette opération est interdite sur votre propre compte';
  end if;

  select p.role into caller_role from public.profiles p where p.id = auth.uid();
  select p.role into target_role from public.profiles p where p.id = target_user_id;

  if target_role is null then raise exception 'Utilisateur introuvable'; end if;
  if caller_role = 'responsable' and target_role = 'administrateur' then
    raise exception 'Un responsable ne peut pas gérer un administrateur';
  end if;

  update public.profiles
  set is_active = new_is_active
  where id = target_user_id;
end;
$$;

revoke all on function public.manager_set_user_active(uuid,boolean) from public;
grant execute on function public.manager_set_user_active(uuid,boolean) to authenticated;


create or replace function public.manager_delete_user_data(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  target_role text;
  active_admins integer;
begin
  if not public.can_manage_users() then
    raise exception 'Accès administrateur ou responsable requis';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'Cette opération est interdite sur votre propre compte';
  end if;

  select p.role into caller_role from public.profiles p where p.id = auth.uid();
  select p.role into target_role from public.profiles p where p.id = target_user_id;

  if target_role is null then raise exception 'Utilisateur introuvable'; end if;

  if caller_role = 'responsable' and target_role = 'administrateur' then
    raise exception 'Un responsable ne peut pas supprimer un administrateur';
  end if;

  if target_role = 'administrateur' then
    select count(*) into active_admins
    from public.profiles
    where role='administrateur' and is_active=true;

    if active_admins <= 1 then
      raise exception 'Impossible de supprimer le dernier administrateur actif';
    end if;
  end if;

  -- Les événements créés pour d'autres utilisateurs restent et changent de créateur.
  update public.events
  set created_by = auth.uid()
  where created_by = target_user_id
    and owner_id <> target_user_id;

  delete from public.event_participants
  where user_id = target_user_id
     or event_id in (select id from public.events where owner_id = target_user_id);

  delete from public.events where owner_id = target_user_id;
  delete from public.working_hours where user_id = target_user_id;
  delete from public.manager_group_access where user_id = target_user_id;
  delete from public.user_groups where user_id = target_user_id;

  -- Ne pas supprimer profiles ici : auth.admin.deleteUser() déclenchera
  -- le ON DELETE CASCADE sur le profil.
end;
$$;

revoke all on function public.manager_delete_user_data(uuid) from public;
grant execute on function public.manager_delete_user_data(uuid) to authenticated;

select pg_notify('pgrst','reload schema');
