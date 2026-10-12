-- =====================================================================
-- Personal team logins. Run once in Supabase → SQL Editor, after activity_log.sql.
-- Each person gets their own login (created by the owner in Supabase → Authentication → Users)
-- and a row in the "admins" table with their real name. Every change is stamped with
-- that name by the database itself, so nobody can act under someone else's name.
-- =====================================================================

alter table admins add column if not exists name text;
update admins set name = 'Owner' where name is null;

-- Who is making this request, decided by the database (never by the browser):
--   a signed-in team member → their name from "admins"
--   the public website      → 'Website'
--   the Supabase dashboard  → 'Supabase dashboard'
create or replace function current_actor() returns text
language sql stable security definer set search_path = public as $$
  select case
    when auth.jwt() ->> 'email' is not null then
      coalesce((select nullif(trim(name), '') from admins where lower(email) = lower(auth.jwt() ->> 'email')),
               auth.jwt() ->> 'email')
    when coalesce(current_setting('request.headers', true), '') = '' then 'Supabase dashboard'
    else 'Website'
  end;
$$;

-- Bookings: "updated_by" and the booking history always use the real person.
create or replace function log_booking_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  diff jsonb := '{}';
  k text;
begin
  new.updated_at := now();
  new.updated_by := current_actor();
  if tg_op = 'INSERT' then
    return new;
  end if;
  for k in select jsonb_object_keys(to_jsonb(new)) loop
    if k not in ('updated_at', 'updated_by') and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
      diff := diff || jsonb_build_object(k, jsonb_build_array(to_jsonb(old) -> k, to_jsonb(new) -> k));
    end if;
  end loop;
  if diff <> '{}' then
    insert into booking_history (booking_id, by_name, changes) values (new.id, new.updated_by, diff);
  end if;
  return new;
end;
$$;

-- Activity log: sign-in / export entries get the real name and time, whatever the browser sends.
create or replace function stamp_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.actor := current_actor();
  new.at := now();
  return new;
end;
$$;
drop trigger if exists stamp_activity on activity_log;
create trigger stamp_activity before insert on activity_log for each row execute function stamp_activity();

-- Log changes to the team list too.
create or replace function log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ent  text  := tg_argv[0];
  rec  jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  diff jsonb;
  k    text;
begin
  if tg_op = 'UPDATE' then
    diff := '{}';
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if k not in ('updated_at', 'updated_by') and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(to_jsonb(old) -> k, to_jsonb(new) -> k));
      end if;
    end loop;
    if diff = '{}' then return new; end if;
  else
    diff := rec;
  end if;

  insert into activity_log (actor, action, entity, entity_id, label, changes)
  values (
    current_actor(),
    case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'changed' else 'deleted' end,
    ent,
    coalesce(rec ->> 'id', rec ->> 'email'),
    case ent
      when 'booking'     then concat_ws(' · ', rec ->> 'ref', rec ->> 'name')
      when 'car'         then rec ->> 'name'
      when 'area'        then rec ->> 'name_en'
      when 'settings'    then 'Night settings'
      when 'time slot'   then concat((select name from cars where id = (rec ->> 'car_id')::int), ' at ', left(rec ->> 'slot_time', 5))
      when 'message'     then concat('Message from ', rec ->> 'name')
      when 'team member' then coalesce(nullif(rec ->> 'name', ''), rec ->> 'email')
    end,
    diff);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists log_admins on admins;
create trigger log_admins after insert or update or delete on admins for each row execute function log_activity('team member');

-- The team list is managed only from the Supabase dashboard: the website can read it, never change it.
revoke insert, update, delete on admins from anon, authenticated;
revoke execute on function current_actor() from public, anon;
revoke execute on function stamp_activity() from public, anon;
