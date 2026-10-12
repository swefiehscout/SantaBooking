-- =====================================================================
-- Santa Eve Visits — Supabase schema
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to run once on a fresh project.
-- =====================================================================

-- ---------- Tables ----------------------------------------------------

create table settings (
  id              int primary key default 1 check (id = 1),
  event_date      date    not null default '2026-12-24',
  start_time      time    not null default '15:00',
  end_time        time    not null default '22:30',
  slot_minutes    int     not null default 30 check (slot_minutes between 5 and 240),
  default_capacity int    not null default 1  check (default_capacity >= 0),
  cutoff_hours    int     not null default 48 check (cutoff_hours >= 0),
  borrow_km       numeric not null default 5,      -- how far another car may travel to take a booking
  booking_open    boolean not null default true,   -- master on/off switch for the public form
  contact_phone   text    not null default '',
  cliq_alias      text    not null default '',
  price_note      text    not null default ''
);
insert into settings (id) values (1);

create table cars (
  id      serial primary key,
  name    text    not null,
  driver  text    not null default '',
  phone   text    not null default '',
  active  boolean not null default true,
  sort    int     not null default 0,
  start_time time,   -- this car's own hours; null = the night's hours
  end_time   time
);

create table areas (
  id      serial primary key,
  name_en text    not null,
  name_ar text    not null default '',
  car_id  int     references cars(id) on delete set null,   -- home car for this area
  lat     double precision,
  lng     double precision,
  active  boolean not null default true,
  sort    int     not null default 0
);

-- Per car + slot: override capacity and/or block it.
create table slot_overrides (
  car_id    int  not null references cars(id) on delete cascade,
  slot_time time not null,
  capacity  int  check (capacity >= 0),          -- null = use default_capacity
  blocked   boolean not null default false,
  primary key (car_id, slot_time)
);

create sequence booking_ref_seq start 1001;

create table bookings (
  id              uuid primary key default gen_random_uuid(),
  ref             text unique not null default ('S' || nextval('booking_ref_seq')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text not null default 'public form',
  name            text not null,
  phone           text not null,
  email           text not null default '',
  area_id         int references areas(id) on delete set null,
  lat             double precision,
  lng             double precision,
  maps_link       text not null default '',
  address_details text not null default '',
  gift_message    text not null default '',
  notes           text not null default '',
  payment_method  text not null default 'cash' check (payment_method in ('cash','cliq','transfer')),  -- how they said they'd donate
  paid            boolean not null default false,   -- donation received
  amount          numeric,                          -- donation received (JD)
  donation_method text check (donation_method in ('cash','cliq','transfer')),  -- how they actually donated
  collected_by    int references cars(id) on delete set null,                  -- car that collected it
  preferred_time  time not null,            -- what the family asked for
  slot_time       time,                     -- what they got (null while on waitlist)
  car_id          int references cars(id) on delete set null,
  status          text not null default 'new'
                  check (status in ('new','confirmed','done','cancelled','waitlist')),
  admin_notes     text not null default '',
  lang            text not null default 'en'
);
create index on bookings (car_id, slot_time);
create index on bookings (status);

create table booking_history (
  id          bigserial primary key,
  booking_id  uuid not null references bookings(id) on delete cascade,
  at          timestamptz not null default now(),
  by_name     text not null,
  changes     jsonb not null
);

-- Messages from the Contact page.
create table messages (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null,
  phone      text not null default '',
  email      text not null default '',
  message    text not null,
  handled    boolean not null default false
);

-- Shared admin login(s). Add the admin account's email here after creating it.
create table admins (email text primary key);

-- ---------- Helpers ---------------------------------------------------

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

-- Distance in km between two points.
create or replace function km(lat1 double precision, lng1 double precision,
                              lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select case when lat1 is null or lat2 is null then null else
    6371 * 2 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
  end;
$$;

-- Minutes into the evening. Times before 06:00 count as after midnight (00:30 -> 24:30).
create or replace function tmin(t time) returns int
language sql immutable as $$
  select (extract(hour from t) * 60 + extract(minute from t))::int
         + case when t < time '06:00' then 1440 else 0 end;
$$;

-- The night's span in minutes, widened by any car with longer hours.
create or replace function night_span(out a int, out z int, out step int)
language sql stable security definer set search_path = public as $$
  select least(tmin(s.start_time), coalesce((select min(tmin(start_time)) from cars where active and start_time is not null), tmin(s.start_time))),
         greatest(tmin(s.end_time), coalesce((select max(tmin(end_time)) from cars where active and end_time is not null), tmin(s.end_time))),
         s.slot_minutes
  from settings s where s.id = 1;
$$;

-- All slot start times of the night, in order.
create or replace function slot_list() returns setof time
language sql stable security definer set search_path = public as $$
  select (time '00:00' + make_interval(mins => g % 1440))::time
  from night_span() n, generate_series(n.a, n.z - n.step, n.step) g
  order by g;
$$;

-- Free places a car has in a slot (0 if blocked / inactive).
create or replace function car_free(p_car int, p_slot time) returns int
language sql stable security definer set search_path = public as $$
  select case
    when not c.active or coalesce(o.blocked, false) then 0
    when tmin(p_slot) < tmin(coalesce(c.start_time, s.start_time))
      or tmin(p_slot) + s.slot_minutes > tmin(coalesce(c.end_time, s.end_time)) then 0
    else greatest(0, coalesce(o.capacity, s.default_capacity) - (
      select count(*) from bookings b
      where b.car_id = p_car and b.slot_time = p_slot
        and b.status in ('new','confirmed','done')))::int
  end
  from cars c
  cross join settings s
  left join slot_overrides o on o.car_id = c.id and o.slot_time = p_slot
  where c.id = p_car and s.id = 1;
$$;

-- How far a car would be from a point at a given slot:
-- distance to its stop just before / just after, else to the centre of its home areas.
create or replace function car_distance(p_car int, p_slot time,
                                        p_lat double precision, p_lng double precision)
returns double precision
language sql stable security definer set search_path = public as $$
  with s as (select slot_minutes from settings where id = 1),
  near_stops as (
    select km(p_lat, p_lng, coalesce(b.lat, a.lat), coalesce(b.lng, a.lng)) d
    from bookings b left join areas a on a.id = b.area_id, s
    where b.car_id = p_car
      and b.status in ('new','confirmed','done')
      and b.slot_time in (p_slot - make_interval(mins => s.slot_minutes),
                          p_slot + make_interval(mins => s.slot_minutes))
  ),
  zone as (
    select km(p_lat, p_lng, avg(lat), avg(lng)) d
    from areas where car_id = p_car and lat is not null
  )
  select coalesce((select min(d) from near_stops), (select d from zone));
$$;

-- Choose a car for a booking, or null if none fits.
-- 1) the area's home car if it has room,
-- 2) else the closest other car with room, within borrow_km.
create or replace function pick_car(p_slot time, p_area int,
                                    p_lat double precision, p_lng double precision)
returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_home int;
  v_lat double precision := p_lat;
  v_lng double precision := p_lng;
  v_borrow numeric;
  v_car int;
begin
  select car_id, coalesce(v_lat, lat), coalesce(v_lng, lng)
    into v_home, v_lat, v_lng from areas where id = p_area;
  select borrow_km into v_borrow from settings where id = 1;

  if v_home is not null and car_free(v_home, p_slot) > 0 then
    return v_home;
  end if;

  if v_lat is null then
    -- No location at all: any car with room, least busy first.
    select c.id into v_car from cars c
    where c.active and car_free(c.id, p_slot) > 0
    order by (select count(*) from bookings b where b.car_id = c.id
              and b.status in ('new','confirmed','done')), c.sort, c.id
    limit 1;
    return v_car;
  end if;

  select c.id into v_car from cars c
  where c.active and c.id is distinct from v_home
    and car_free(c.id, p_slot) > 0
    and coalesce(car_distance(c.id, p_slot, v_lat, v_lng), 0) <= v_borrow
  order by coalesce(car_distance(c.id, p_slot, v_lat, v_lng), 999), c.sort, c.id
  limit 1;
  return v_car;
end;
$$;

create or replace function bookings_open() returns boolean
language sql stable as $$
  select s.booking_open and
         now() < ((s.event_date + s.start_time) at time zone 'Asia/Amman')
                 - make_interval(hours => s.cutoff_hours)
  from settings s where s.id = 1;
$$;

-- ---------- Public functions (used by the booking form) ---------------

create or replace function public_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'event_date', s.event_date,
    'slot_minutes', s.slot_minutes,
    'start_time', (select to_char(time '00:00' + make_interval(mins => a % 1440), 'HH24:MI') from night_span()),
    'end_time', (select to_char(time '00:00' + make_interval(mins => z % 1440), 'HH24:MI') from night_span()),
    'open', bookings_open(),
    'contact_phone', s.contact_phone,
    'cliq_alias', s.cliq_alias,
    'price_note', s.price_note,
    'areas', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', id, 'en', name_en, 'ar', name_ar, 'lat', lat, 'lng', lng)
                order by sort, name_en), '[]') from areas where active)
  ) from settings s where s.id = 1;
$$;

-- Which slots are bookable for this family's location.
create or replace function public_availability(p_area int,
                                               p_lat double precision default null,
                                               p_lng double precision default null)
returns table (slot text, available boolean)
language sql stable security definer set search_path = public as $$
  select to_char(t, 'HH24:MI'), pick_car(t, p_area, p_lat, p_lng) is not null
  from slot_list() t order by tmin(t);
$$;

-- Create a booking. Returns {ok, ref, slot} or {ok:false, reason, suggestions}.
create or replace function public_book(
  p_name text, p_phone text, p_email text, p_area int,
  p_lat double precision, p_lng double precision,
  p_maps_link text, p_address text, p_gift text, p_notes text,
  p_payment text, p_slot text, p_waitlist boolean, p_lang text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_slot time;
  v_car int;
  v_ref text;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  v_sugg jsonb;
begin
  -- One booking at a time, so two families can't grab the same last place.
  perform pg_advisory_xact_lock(724);

  if not bookings_open() then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'name');
  end if;
  if v_phone !~ '^(\+?962|0)?7[789][0-9]{7}$' then
    return jsonb_build_object('ok', false, 'reason', 'phone');
  end if;
  if not exists (select 1 from areas where id = p_area and active) then
    return jsonb_build_object('ok', false, 'reason', 'area');
  end if;
  if coalesce(p_payment, '') not in ('cash','cliq','transfer') then
    return jsonb_build_object('ok', false, 'reason', 'payment');
  end if;
  -- Every booking needs a map pin inside Jordan and a Google Maps link.
  if p_lat is null or p_lng is null or p_lat not between 29 and 33.5 or p_lng not between 34.8 and 39.5
     or length(trim(coalesce(p_maps_link, ''))) < 8 then
    return jsonb_build_object('ok', false, 'reason', 'pin');
  end if;
  begin
    v_slot := p_slot::time;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'slot');
  end;
  if v_slot not in (select slot_list()) then
    return jsonb_build_object('ok', false, 'reason', 'slot');
  end if;
  -- Same phone already holds an active booking.
  if exists (select 1 from bookings
             where regexp_replace(phone, '[^0-9]', '', 'g') ~ (right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 9) || '$')
               and status in ('new','confirmed','waitlist')) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;

  if not coalesce(p_waitlist, false) then
    v_car := pick_car(v_slot, p_area, p_lat, p_lng);
    if v_car is null then
      select coalesce(jsonb_agg(x.s), '[]') into v_sugg from (
        select to_char(t, 'HH24:MI') s from slot_list() t
        where pick_car(t, p_area, p_lat, p_lng) is not null
        order by abs(tmin(t) - tmin(v_slot)), tmin(t)
        limit 3) x;
      return jsonb_build_object('ok', false, 'reason', 'full', 'suggestions', v_sugg);
    end if;
  end if;

  insert into bookings (name, phone, email, area_id, lat, lng, maps_link, address_details,
                        gift_message, notes, payment_method, preferred_time, slot_time,
                        car_id, status, lang)
  values (trim(p_name), v_phone, coalesce(trim(p_email), ''), p_area, p_lat, p_lng,
          coalesce(trim(p_maps_link), ''), coalesce(trim(p_address), ''),
          coalesce(trim(p_gift), ''), coalesce(trim(p_notes), ''),
          p_payment,
          v_slot,
          case when v_car is null then null else v_slot end,
          v_car,
          case when v_car is null then 'waitlist' else 'new' end,
          case when p_lang = 'ar' then 'ar' else 'en' end)
  returning ref into v_ref;

  return jsonb_build_object('ok', true, 'ref', v_ref,
                            'waitlist', v_car is null, 'slot', to_char(v_slot, 'HH24:MI'));
end;
$$;

-- Contact form.
create or replace function public_message(p_name text, p_phone text, p_email text, p_message text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  if length(trim(coalesce(p_name, ''))) < 2 or length(trim(coalesce(p_message, ''))) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;
  if length(p_message) > 4000 then
    return jsonb_build_object('ok', false, 'reason', 'long');
  end if;
  -- Light spam guard: at most 20 messages in any 10 minutes.
  if (select count(*) from messages where created_at > now() - interval '10 minutes') >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  insert into messages (name, phone, email, message)
  values (trim(p_name), trim(coalesce(p_phone, '')), trim(coalesce(p_email, '')), trim(p_message));
  return jsonb_build_object('ok', true);
end;
$$;

-- Admin helper: suggest a car for a booking (used by "Auto-assign" and waitlist).
create or replace function admin_suggest_car(p_booking uuid, p_slot text)
returns int
language plpgsql stable security definer set search_path = public as $$
declare b bookings;
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  select * into b from bookings where id = p_booking;
  return pick_car(p_slot::time, b.area_id, b.lat, b.lng);
end;
$$;

-- ---------- History trigger -------------------------------------------

create or replace function log_booking_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  diff jsonb := '{}';
  k text;
  skip text[] := array['updated_at', 'updated_by'];
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    return new;
  end if;
  for k in select jsonb_object_keys(to_jsonb(new)) loop
    if not k = any(skip) and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
      diff := diff || jsonb_build_object(k, jsonb_build_array(to_jsonb(old) -> k, to_jsonb(new) -> k));
    end if;
  end loop;
  if diff <> '{}' then
    insert into booking_history (booking_id, by_name, changes)
    values (new.id, coalesce(nullif(new.updated_by, ''), 'admin'), diff);
  end if;
  return new;
end;
$$;

create trigger bookings_history before insert or update on bookings
for each row execute function log_booking_change();

-- ---------- Security --------------------------------------------------
-- The public can ONLY call public_config / public_availability / public_book.
-- Everything else needs the shared admin login.

alter table settings        enable row level security;
alter table cars            enable row level security;
alter table areas           enable row level security;
alter table slot_overrides  enable row level security;
alter table bookings        enable row level security;
alter table booking_history enable row level security;
alter table admins          enable row level security;
alter table messages        enable row level security;

create policy admin_all on settings        for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on cars            for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on areas           for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on slot_overrides  for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on bookings        for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on booking_history for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_all on messages        for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_read on admins         for select to authenticated using (is_admin());

revoke execute on all functions in schema public from public, anon;
grant execute on function public_config()                       to anon, authenticated;
grant execute on function public_availability(int, double precision, double precision) to anon, authenticated;
grant execute on function public_book(text, text, text, int, double precision, double precision,
  text, text, text, text, text, text, boolean, text)            to anon, authenticated;
grant execute on function public_message(text, text, text, text) to anon, authenticated;
grant execute on function is_admin()                            to authenticated;
grant execute on function admin_suggest_car(uuid, text)         to authenticated;
grant usage on sequence booking_ref_seq to authenticated;

-- Live updates in the admin dashboard when bookings change.
alter publication supabase_realtime add table bookings;
