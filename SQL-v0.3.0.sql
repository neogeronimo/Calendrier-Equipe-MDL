-- Calendrier Équipe MDL v0.3.0
-- Gestion utilisateurs par administrateurs et responsables
-- + archive calendrier avant suppression.
--
-- À exécuter UNE FOIS dans Supabase > SQL Editor.

create or replace function public.can_manage_users()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and p.role in ('administrateur','responsable')
  );
$$;

revoke all on function public.can_manage_users() from public;
grant execute on function public.can_manage_users() to authenticated;


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
    coalesce(array_agg(ug.group_id order by g.name) filter (where ug.group_id is not null), '{}'::uuid[]) as group_ids,
    coalesce(array_agg(g.name order by g.name) filter (where g.name is not null), '{}'::text[]) as group_names,
    max(ug.group_id) filter (where ug.is_primary) as primary_group_id
  from public.profiles p
  left join auth.users u on u.id = p.id
  left join public.user_groups ug on ug.user_id = p.id
  left join public.groups g on g.id = ug.group_id
  group by p.id,u.email,p.first_name,p.last_name,p.display_name,p.role,p.is_active,p.has_global_scope,p.share_calendar,p.calendar_share_mode
  order by coalesce(p.display_name,u.email::text);
end;
$$;

revoke all on function public.manager_list_profiles() from public;
grant execute on function public.manager_list_profiles() to authenticated;


create or replace function public.manager_user_archive(target_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  caller_role text;
  target_role text;
  result jsonb;
begin
  if not public.can_manage_users() then
    raise exception 'Accès administrateur ou responsable requis';
  end if;

  select role into caller_role from public.profiles where id = auth.uid();
  select role into target_role from public.profiles where id = target_user_id;

  if target_role is null then
    raise exception 'Utilisateur introuvable';
  end if;

  if caller_role = 'responsable' and target_role = 'administrateur' then
    raise exception 'Un responsable ne peut pas archiver un administrateur';
  end if;

  select jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'id',p.id,
        'email',u.email,
        'first_name',p.first_name,
        'last_name',p.last_name,
        'display_name',p.display_name,
        'role',p.role,
        'is_active',p.is_active,
        'has_global_scope',p.has_global_scope,
        'group_names',coalesce((
          select jsonb_agg(g.name order by g.name)
          from public.user_groups ug
          join public.groups g on g.id=ug.group_id
          where ug.user_id=p.id
        ),'[]'::jsonb)
      )
      from public.profiles p
      left join auth.users u on u.id=p.id
      where p.id=target_user_id
    ),
    'events', coalesce((
      select jsonb_agg(row_json order by row_json->>'starts_at')
      from (
        select jsonb_build_object(
          'id',e.id,
          'starts_at',e.starts_at,
          'ends_at',e.ends_at,
          'all_day',e.all_day,
          'title',e.title,
          'description',e.description,
          'location',e.location,
          'status',e.status,
          'event_type_name',et.name,
          'relationship',case when e.owner_id=target_user_id then 'Propriétaire' else 'Participant' end,
          'owner_name',coalesce(op.display_name,concat_ws(' ',op.first_name,op.last_name),'Utilisateur'),
          'participant_names',coalesce((
            select jsonb_agg(coalesce(pp.display_name,concat_ws(' ',pp.first_name,pp.last_name),'Utilisateur') order by coalesce(pp.display_name,pp.last_name))
            from public.event_participants ep2
            join public.profiles pp on pp.id=ep2.user_id
            where ep2.event_id=e.id
          ),'[]'::jsonb)
        ) as row_json
        from public.events e
        left join public.event_types et on et.id=e.event_type_id
        left join public.profiles op on op.id=e.owner_id
        where e.owner_id=target_user_id
           or exists (
             select 1
             from public.event_participants ep
             where ep.event_id=e.id
               and ep.user_id=target_user_id
           )
      ) q
    ),'[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.manager_user_archive(uuid) from public;
grant execute on function public.manager_user_archive(uuid) to authenticated;

-- Les opérations Auth (création/suppression) restent volontairement
-- dans l'Edge Function : aucune clé secrète n'est exposée dans le navigateur.
