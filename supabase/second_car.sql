-- =====================================================================
-- An area can share two cars. Run once in Supabase → SQL Editor.
-- Set the second car on the Setup page. The website then books whichever of
-- the two has more room at that time; if equal, the one with fewer visits that night.
-- =====================================================================

alter table areas add column if not exists car2_id int references cars(id) on delete set null;

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
    from areas where p_car in (car_id, car2_id) and lat is not null
  )
  select coalesce((select min(d) from near_stops), (select d from zone));
$$;

-- The website only books an area's own cars, so busy areas can't take other areas' places.
-- With two cars: the one with more room at that time, then the one with fewer visits that night.
create or replace function home_car(p_slot time, p_area int) returns int
language sql stable security definer set search_path = public as $$
  select c.id
  from areas a join cars c on c.id in (a.car_id, a.car2_id)
  where a.id = p_area and car_free(c.id, p_slot) > 0
  order by car_free(c.id, p_slot) desc,
           (select count(*) from bookings b where b.car_id = c.id and b.status in ('new','confirmed','done')),
           c.sort, c.id
  limit 1;
$$;

-- Choose a car for a booking, or null if none fits. (Used for the team's suggestions; the website uses home_car.)
-- 1) the area's own car(s) if one has room,
-- 2) else the closest other car with room, within borrow_km.
create or replace function pick_car(p_slot time, p_area int,
                                    p_lat double precision, p_lng double precision)
returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_home int;
  v_home2 int;
  v_lat double precision := p_lat;
  v_lng double precision := p_lng;
  v_borrow numeric;
  v_car int;
begin
  select car_id, car2_id, coalesce(v_lat, lat), coalesce(v_lng, lng)
    into v_home, v_home2, v_lat, v_lng from areas where id = p_area;
  select borrow_km into v_borrow from settings where id = 1;

  v_car := home_car(p_slot, p_area);
  if v_car is not null then
    return v_car;
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
  where c.active and c.id is distinct from v_home and c.id is distinct from v_home2
    and car_free(c.id, p_slot) > 0
    and coalesce(car_distance(c.id, p_slot, v_lat, v_lng), 0) <= v_borrow
  order by coalesce(car_distance(c.id, p_slot, v_lat, v_lng), 999), c.sort, c.id
  limit 1;
  return v_car;
end;
$$;

-- Only the booking functions use these.
revoke execute on function home_car(time, int) from public, anon, authenticated;
revoke execute on function pick_car(time, int, double precision, double precision) from public, anon, authenticated;
revoke execute on function car_distance(int, time, double precision, double precision) from public, anon, authenticated;
