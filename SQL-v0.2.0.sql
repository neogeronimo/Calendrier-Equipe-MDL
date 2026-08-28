-- Calendrier Équipe MDL v0.2.0
-- Types d'événements proposés par défaut.
-- Ce script peut être relancé sans créer de doublons.

insert into public.event_types (name, description, color, is_active)
values
  ('Intervention', 'Intervention technique ou déplacement terrain', '#5b4fd6', true),
  ('Réunion', 'Réunion, point d’équipe ou rendez-vous', '#2563eb', true),
  ('Formation', 'Formation ou accompagnement', '#0f766e', true),
  ('Congé / absence', 'Congé, RTT ou autre absence', '#b45309', true),
  ('Télétravail', 'Journée ou demi-journée de télétravail', '#7c3aed', true),
  ('Autre', 'Autre type de rendez-vous', '#64748b', true)
on conflict (name) do update
set description = excluded.description,
    color = excluded.color,
    is_active = true;

-- Les utilisateurs authentifiés doivent pouvoir lire les types.
grant select on table public.event_types to authenticated;
