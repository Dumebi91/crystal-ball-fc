# Crystal Ball FC

The free daily football game at [crystalballfc.com](https://www.crystalballfc.com): Know Ball, Call It, Poll of the Day, Cold Takes, leagues and the weekly crown.

Built with Next.js (hosted on Vercel) and Supabase (database and phone logins). Fixtures and results come from API-Football.

## How it's put together

- **Every rule that decides points lives in the database** (`supabase/migrations`). Members' phones only ask the database to do things; they can't change a score, a clock or a lock.
- **Know Ball's clock is kept by the server.** It starts when a question is served and stops when it's answered. Reloading, pausing or changing the phone's time changes nothing. Each member gets their own question order, their own option order and different questions in the three swap slots.
- **Call It locks at kick-off** in the database. Games are scored from the score at the end of normal time: 10 for the exact score, 3 for the right result. Corrected results are re-scored automatically; postponed games score nothing.
- **A scheduled job** (`/api/cron/sync`, every 10 minutes) pulls fixtures and results, scores finished games, sets each matchweek's crowning time (noon WAT the day after its last game) and crowns the Oracle of the Week.
- **Privacy:** phone numbers stay in Supabase's auth system and are never readable by the site. Members can download their data and delete their account from the Me page. Fonts are bundled, so nothing is sent to Google.

## Tests

```
npm install
npm test
```

The tests run the real migrations in an in-memory Postgres with a controlled clock. They check every scoring rule, the Know Ball clock, the kick-off lock, the crown, leagues, the Dressing Room rules, fixture syncing and account deletion.

## Going live: one-time setup

1. **Supabase** (supabase.com): create a project in the EU (Frankfurt) region. In the SQL Editor, run each file in `supabase/migrations` in order, then `supabase/seed.sql`.
2. **Phone logins (Termii):** codes are sent by our Send SMS hook (`/api/hooks/send-sms`), which checks Supabase's signature and passes the text to Termii on the DND route.
   - Termii: create an account, register a sender ID (for example `CrystalBall`) and wait for approval, top up, and copy the API key and your base URL.
   - Supabase → Authentication → Sign In / Providers → Phone: switch it on.
   - Supabase → Authentication → Hooks → Send SMS: choose HTTPS, URL `https://www.crystalballfc.com/api/hooks/send-sms`, generate the secret.
   - Vercel: add `SEND_SMS_HOOK_SECRET`, `TERMII_API_KEY`, `TERMII_SENDER_ID` and `TERMII_BASE_URL`, then redeploy.
3. **API-Football** (api-football.com): subscribe to a paid plan and copy the API key.
4. **Vercel** (vercel.com): import this GitHub repository. Add the environment variables listed in `.env.example`, with real values. Set `CRON_SECRET` to a long random string.
5. **Domain:** Vercel → Project → Domains → add `www.crystalballfc.com` and follow the DNS instructions at your domain registrar.

## The admin area (/admin)

Four roles: **member** (everyone), **steward** (reviews reported replies and fair-play flags), **editor** (loads Know Ball, polls, takes and Oracle videos) and **admin** (everything, plus team roles and point corrections). Every admin action is logged.

- **Overview:** the next 14 days of content, with gaps in gold, plus open reports and flags.
- **Know Ball:** 7 fixed slots and 3 swap slots with two versions each. Type the questions in, or paste rows from a spreadsheet. Shows the difficulty mix (3 easy, 3 medium, 2 hard, 2 home colours). A quiz locks once anyone starts it.
- **Polls**, **Takes & videos** (schedule a take or an Oracle video with its transcript and the Oracle's call), **Moderation** and **Members & log**.
- **Internationals:** paste FIFA's ranking (top first). During international breaks, Super Eagles games are always playable and top-20 v top-20 games switch on by themselves; switch others on to reach 6 to 8 games. Set `API_FOOTBALL_INT_LEAGUES` to the competitions to pull.

To make yourself the first admin, join the site, then run this once in Supabase → SQL Editor (with your handle):

```sql
update public.profiles set role = 'admin' where handle = 'your_handle';
```

After that, give the team their roles from Members & log.

You can still load content by SQL with `supabase/content-template.sql` if you ever need to.

## Still to build before launch

- Final Privacy Policy and Terms text on /privacy and /terms
- Cookie banner and analytics (PostHog, loaded only after Accept)
- The Ten (follows launch)
