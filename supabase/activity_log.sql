-- =====================================================================
-- Activity log: every change, who made it and when. Read-only.
-- Run once in Supabase → SQL Editor (after schema.sql and seed.sql).
-- =====================================================================

create table if not exists activity_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      text not null,              -- team member's name, or 'Website' for families
  action     text not null,              -- created / changed / deleted / signed in / exported ...
  entity     text not null,              -- booking / car / area / settings / time slot / message / team
  entity_id  text,
  label      text,                       -- e.g. "S1003 · Haddad family"
  changes    jsonb                       -- {field: [old, new]} for changes; the full record for created/deleted
);
create index if not exists activity_log_at on activity_log (at desc);

-- Who is making this request: the name the dashboard sends, else "Website" for the public form.
create or replace function current_actor() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.headers', true)::json ->> 'x-actor', ''),
    case when auth.jwt() ->> 'email' is not null then 'Team' else 'Website' end);
$$;

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
    diff := rec;   -- keep a full copy of what was created or deleted
  end if;

  insert into activity_log (actor, action, entity, entity_id, label, changes)
  values (
    current_actor(),
    case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'changed' else 'deleted' end,
    ent,
    rec ->> 'id',
    case ent
      when 'booking'   then concat_ws(' · ', rec ->> 'ref', rec ->> 'name')
      when 'car'       then rec ->> 'name'
      when 'area'      then rec ->> 'name_en'
      when 'settings'  then 'Night settings'
      when 'time slot' then concat((select name from cars where id = (rec ->> 'car_id')::int), ' at ', left(rec ->> 'slot_time', 5))
      when 'message'   then concat('Message from ', rec ->> 'name')
    end,
    diff);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists log_bookings on bookings;
drop trigger if exists log_cars on cars;
drop trigger if exists log_areas on areas;
drop trigger if exists log_settings on settings;
drop trigger if exists log_slots on slot_overrides;
drop trigger if exists log_messages on messages;
create trigger log_bookings after insert or update or delete on bookings       for each row execute function log_activity('booking');
create trigger log_cars     after insert or update or delete on cars           for each row execute function log_activity('car');
create trigger log_areas    after insert or update or delete on areas          for each row execute function log_activity('area');
create trigger log_settings after insert or update or delete on settings       for each row execute function log_activity('settings');
create trigger log_slots    after insert or update or delete on slot_overrides for each row execute function log_activity('time slot');
create trigger log_messages after insert or update or delete on messages       for each row execute function log_activity('message');

-- Read-only: the team can read it and add sign-in/export events. Nobody can edit or delete entries.
alter table activity_log enable row level security;
drop policy if exists log_read on activity_log;
drop policy if exists log_add on activity_log;
create policy log_read on activity_log for select to authenticated using (is_admin());
create policy log_add  on activity_log for insert to authenticated
  with check (is_admin() and entity = 'team' and action in ('signed in', 'signed out', 'exported', 'printed', 'copied'));
revoke update, delete, truncate on activity_log from anon, authenticated;
revoke execute on function current_actor() from public, anon;
revoke execute on function log_activity() from public, anon;
grant usage, select on sequence activity_log_id_seq to authenticated;
