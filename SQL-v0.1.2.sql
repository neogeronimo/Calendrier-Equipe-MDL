-- Calendrier Équipe MDL v0.1.2
-- RPC sécurisées pour le profil courant et l'administration des profils.

create or replace function public.get_my_profile()
returns setof public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select p.*
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

revoke all on function public.get_my_profile() from public;
grant execute on function public.get_my_profile() to authenticated;

create or replace function public.admin_list_profiles()
returns setof public.profiles
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'administrateur'
      and p.is_active = true
  ) then
    raise exception 'Accès administrateur requis';
  end if;

  return query
  select p.*
  from public.profiles p
  order by p.display_name;
end;
$$;

revoke all on function public.admin_list_profiles() from public;
grant execute on function public.admin_list_profiles() to authenticated;

create or replace function public.admin_update_user_role(
  target_user_id uuid,
  new_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'administrateur'
      and p.is_active = true
  ) then
    raise exception 'Accès administrateur requis';
  end if;

  if new_role not in ('technicien','planificateur','responsable','administrateur') then
    raise exception 'Rôle invalide';
  end if;

  update public.profiles
  set role = new_role
  where id = target_user_id;

  if not found then
    raise exception 'Utilisateur introuvable';
  end if;
end;
$$;

revoke all on function public.admin_update_user_role(uuid, text) from public;
grant execute on function public.admin_update_user_role(uuid, text) to authenticated;
