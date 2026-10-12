-- =====================================================================
-- Only owners can read the activity log. Run once in Supabase → SQL Editor,
-- after team_accounts.sql. Everyone's actions are still recorded.
-- To make someone else an owner: Table Editor → admins → tick "is_owner" on their row.
-- =====================================================================

alter table admins add column if not exists is_owner boolean not null default false;
update admins set is_owner = true where lower(email) = 'santa@swefieh-orthodox-scout.com';

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where lower(email) = lower(auth.jwt() ->> 'email') and is_owner);
$$;
revoke execute on function is_owner() from public, anon;
grant execute on function is_owner() to authenticated;

drop policy if exists log_read on activity_log;
create policy log_read on activity_log for select to authenticated using (is_owner());
