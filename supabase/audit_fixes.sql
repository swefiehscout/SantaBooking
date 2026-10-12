-- =====================================================================
-- Audit fixes. Run once in Supabase → SQL Editor, after home_car_only.sql.
--  • Booking form: length limits, at most 40 website bookings per 10 minutes,
--    and a "waitlist" request for a time that is actually free gets booked.
--  • Signed-in accounts that aren't on the team can't call internal functions.
-- =====================================================================

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
  if length(p_name) > 100 or length(coalesce(p_email, '')) > 200 or length(coalesce(p_maps_link, '')) > 500
     or length(coalesce(p_address, '')) > 300 or length(coalesce(p_gift, '')) > 600 or length(coalesce(p_notes, '')) > 600 then
    return jsonb_build_object('ok', false, 'reason', 'long');
  end if;
  -- Light abuse guard: at most 40 website bookings in any 10 minutes.
  if (select count(*) from bookings where created_at > now() - interval '10 minutes') >= 40 then
    return jsonb_build_object('ok', false, 'reason', 'busy');
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

  -- If the time turned out to be free after all, book it rather than waitlisting them.
  v_car := home_car(v_slot, p_area);
  if not coalesce(p_waitlist, false) then
    if v_car is null then
      select coalesce(jsonb_agg(x.s), '[]') into v_sugg from (
        select to_char(t, 'HH24:MI') s from slot_list() t
        where home_car(t, p_area) is not null
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

-- Only these functions can be called from the website; everything else runs inside them.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public_config()                       to anon, authenticated;
grant execute on function public_availability(int, double precision, double precision) to anon, authenticated;
grant execute on function public_book(text, text, text, int, double precision, double precision,
  text, text, text, text, text, text, boolean, text)            to anon, authenticated;
grant execute on function public_message(text, text, text, text) to anon, authenticated;
grant execute on function is_admin()                            to authenticated;
grant execute on function is_owner()                            to authenticated;
grant execute on function admin_suggest_car(uuid, text)         to authenticated;
