# Santa Booking

Christmas Eve Santa visit booking for the Greek Orthodox Scouts & Guides – Swefieh.

- `web/index.html`: home page
- `web/book.html`: booking form (Arabic / English, map pin, live free times)
- `web/contact.html`: contact details and a message form
- `web/admin.html`: team dashboard (board, bookings, waitlist, driver sheets, messages, setup)
- `supabase/`: database setup

Until real Supabase keys are in `web/config.js`, the site runs in **demo mode** on sample data saved in your browser. Any password works on the admin page.

## Preview locally

```bash
cd web && python3 -m http.server 8080
```
Open http://localhost:8080

## Go live

1. **Supabase**: in the "Santa Booking" project, open SQL Editor and run `supabase/schema.sql`, then `supabase/seed.sql`, then `supabase/activity_log.sql`.
2. **Admin login**: go to Authentication → Users → Add user, and pick an email and the team password (tick "Auto confirm"). Then go to Authentication → Providers → Email and turn off "Allow new users to sign up".
3. **Keys**: go to Project Settings → API. Copy the Project URL and the `anon` public key into `web/config.js`, and set `ADMIN_EMAIL` to the email from step 2.
4. **Make that email an admin**: in SQL Editor, run
   `insert into admins (email) values ('the-email-from-step-2');`
5. **Vercel**: import the GitHub repo. No build settings are needed, because `vercel.json` serves the `web` folder.

## Team logins

Everyone on the team has their own login. Nobody can create an account themselves (sign-ups are off in Supabase), and every change is recorded under the person's real name.

Run `supabase/team_accounts.sql` once in the SQL Editor (after `activity_log.sql`) to switch this on.

**Add someone** (owner, in Supabase):
1. Authentication → Users → Add user → Create new user. Email: `username@santa.team` (for example `sara@santa.team`; it doesn't need to be a real inbox). Choose a password and tick **Auto Confirm User**.
2. Table Editor → **admins** → Insert row. Email: the same email. Name: their real name, as it should appear in the activity log.
3. Send them their username (`sara`) and password. They sign in at `/admin`.

**Change a password:** Authentication → Users → the user → set a new password, then send it to them.

**Remove someone:** delete their user in Authentication → Users, and their row in the **admins** table. They're locked out straight away.

The owner account `santa@swefieh-orthodox-scout.com` signs in by typing the full email as the username.

## How cars get assigned

1. The area's home car gets the booking if it has room at that time.
2. Otherwise, the nearest other car with room takes it, as long as it's within the "help within km" setting. Distance is measured from the family's map pin to that car's stops just before and after, or to its zone.
3. If no car can take it, the family sees the nearest free times, or can join the waitlist.

Everything (hours, cars, zones, capacity, blocked times) can be edited in Admin → Setup and on the Board.
