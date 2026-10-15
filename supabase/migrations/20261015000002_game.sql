-- Crystal Ball FC: game rules.
-- Members call these functions; they never write to game tables directly (see the security migration).
-- Every function that acts for a member checks auth.uid() itself.

---------------------------------------------------------------------------
-- Helpers
---------------------------------------------------------------------------
create or replace function public.require_member() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from profiles where id = uid) then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;
  return uid;
end $$;

-- The matchweek running at a moment, if any.
create or replace function public.mw_at(ts timestamptz) returns int
language sql stable set search_path = public as $$
  select id from matchweeks where ts >= starts_at and ts < ends_at order by starts_at limit 1
$$;

-- A stable pseudo-random number from text, for per-member question choice and order.
create or replace function public.hash_int(t text) returns int
language sql immutable as $$ select ('x' || substr(md5(t), 1, 7))::bit(28)::int $$;

create or replace function public.ms_between(a timestamptz, b timestamptz) returns int
language sql immutable as $$ select greatest(0, (extract(epoch from (b - a)) * 1000)::int) $$;

---------------------------------------------------------------------------
-- Joining
---------------------------------------------------------------------------
create or replace function public.create_profile(p_handle text, p_city text, p_club text, p_confirmed_adult boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  h text := lower(trim(p_handle));
  n int;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  if not coalesce(p_confirmed_adult, false) then raise exception 'must_be_18'; end if;
  if exists (select 1 from profiles where id = uid) then raise exception 'profile_exists'; end if;
  if h !~ '^[a-z0-9_]{3,20}$' then raise exception 'bad_handle'; end if;
  if exists (select 1 from profiles where handle = h) then raise exception 'handle_taken'; end if;
  n := nextval('founding_seq');
  insert into profiles (id, handle, city, club, confirmed_adult, founding_number)
  values (uid, h, nullif(trim(p_city), ''), nullif(trim(p_club), ''), true, case when n <= 1000 then n end);
  return jsonb_build_object('handle', h, 'founding_number', case when n <= 1000 then n end);
end $$;

---------------------------------------------------------------------------
-- Know Ball
---------------------------------------------------------------------------
-- Grace for network delay on the final answer, in milliseconds.
create or replace function public.kb_grace_ms() returns int language sql immutable as $$ select 1500 $$;

-- Start (or resume) today's quiz. Builds this member's own plan once:
-- one variant per swap slot, their own question order and their own option order.
create or replace function public.kb_start() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_member();
  now_ timestamptz := app_now();
  q kb_quizzes;
  aid uuid;
  plan jsonb;
begin
  select * into q from kb_quizzes where quiz_date = wat_date(now_);
  if not found or now_ < q.opens_at or now_ >= q.closes_at then raise exception 'kb_closed'; end if;

  select id into aid from kb_attempts where user_id = uid and quiz_id = q.id;
  if found then return aid; end if;   -- one go a day: never a fresh start

  if q.is_prize and (now_ < q.prize_opens_at or now_ >= q.prize_closes_at) then
    raise exception 'kb_prize_window_closed';
  end if;

  with slots as (
    select slot, array_agg(id order by variant) as ids from kb_questions where quiz_id = q.id group by slot
  ), picked as (
    select s.slot,
           s.ids[1 + hash_int(q.salt || uid::text || 'v' || s.slot) % array_length(s.ids, 1)] as qid
    from slots s
  ), perms as (
    select p.slot, p.qid,
           (select jsonb_agg(o order by hash_int(q.salt || uid::text || 'p' || p.qid || '-' || o))
              from generate_series(0, 3) o) as perm
    from picked p
  )
  select jsonb_agg(jsonb_build_object('q', qid, 'perm', perm) order by hash_int(q.salt || uid::text || 'o' || qid))
    into plan from perms;

  if plan is null or jsonb_array_length(plan) <> 10 then raise exception 'kb_not_ready'; end if;

  insert into kb_attempts (user_id, quiz_id, plan) values (uid, q.id, plan) returning id into aid;
  return aid;
end $$;

-- Close an attempt and post its points. Internal.
create or replace function public.kb_finish(p_attempt uuid, p_timed_out boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a kb_attempts;
  s int;
  pts int;
begin
  select * into a from kb_attempts where id = p_attempt for update;
  if a.status = 'done' then
    return jsonb_build_object('status', 'done', 'score', a.score, 'used_ms', a.used_ms, 'timed_out', a.timed_out);
  end if;
  select count(*) filter (where correct) into s from kb_answers where attempt_id = a.id;
  update kb_attempts
     set status = 'done', score = s, timed_out = p_timed_out, served_at = null,
         used_ms = least(used_ms, 60000), finished_at = app_now()
   where id = a.id
  returning * into a;

  pts := s + case when s = 10 then 5 else 0 end;
  insert into points_ledger (user_id, source, source_ref, matchweek_id, points, detail)
  values (a.user_id, 'kb', a.quiz_id::text, mw_at(app_now()), pts, jsonb_build_object('right', s, 'ms', a.used_ms))
  on conflict (user_id, source, source_ref) do nothing;

  -- A perfect score in under 15 seconds is worth a human look.
  if s = 10 and a.used_ms < 15000 then
    insert into fair_play_flags (user_id, kind, ref, detail)
    values (a.user_id, 'kb_perfect_fast', a.id::text, jsonb_build_object('ms', a.used_ms));
  end if;

  return jsonb_build_object('status', 'done', 'score', s, 'points', pts, 'used_ms', a.used_ms, 'timed_out', p_timed_out);
end $$;

-- Show the current question and start the clock. Reloading does not reset the clock.
create or replace function public.kb_question(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_member();
  now_ timestamptz := app_now();
  a kb_attempts;
  item jsonb;
  qq kb_questions;
  used int;
begin
  select * into a from kb_attempts where id = p_attempt and user_id = uid for update;
  if not found then raise exception 'not_found'; end if;
  if a.status = 'done' then return kb_finish(a.id, a.timed_out); end if;
  if a.used_ms >= 60000 then return kb_finish(a.id, true); end if;   -- no time left for another question

  if a.served_at is null then
    update kb_attempts set served_at = now_ where id = a.id;
    used := a.used_ms;
  else
    used := a.used_ms + ms_between(a.served_at, now_);
    if used > 60000 + kb_grace_ms() then
      update kb_attempts set used_ms = 60000 where id = a.id;
      return kb_finish(a.id, true);
    end if;
  end if;

  item := a.plan -> a.idx;
  select * into qq from kb_questions where id = (item ->> 'q')::int;
  return jsonb_build_object(
    'status', 'playing',
    'index', a.idx,
    'total', 10,
    'difficulty', qq.difficulty,
    'prompt', qq.prompt,
    'options', (select jsonb_agg(qq.options[(o.v)::int + 1] order by o.n)
                  from jsonb_array_elements_text(item -> 'perm') with ordinality o(v, n)),
    'remaining_ms', greatest(0, 60000 - used)
  );
end $$;

-- Answer the question on screen with the option shown at p_choice (0-3).
-- The clock stops while the member reads the result, until they ask for the next question.
create or replace function public.kb_answer(p_attempt uuid, p_choice int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_member();
  now_ timestamptz := app_now();
  a kb_attempts;
  item jsonb;
  perm int[];
  qq kb_questions;
  elapsed int;
  total int;
  stored int;
  ok boolean;
  fin jsonb;
begin
  if p_choice is null or p_choice not between 0 and 3 then raise exception 'bad_choice'; end if;
  select * into a from kb_attempts where id = p_attempt and user_id = uid for update;
  if not found then raise exception 'not_found'; end if;
  if a.status = 'done' then return kb_finish(a.id, a.timed_out); end if;
  if a.served_at is null then raise exception 'no_question_on_screen'; end if;

  elapsed := ms_between(a.served_at, now_);
  total := a.used_ms + elapsed;
  if total > 60000 + kb_grace_ms() then
    update kb_attempts set used_ms = 60000 where id = a.id;
    return kb_finish(a.id, true);
  end if;

  item := a.plan -> a.idx;
  select array_agg(v::int order by n) into perm from jsonb_array_elements_text(item -> 'perm') with ordinality t(v, n);
  select * into qq from kb_questions where id = (item ->> 'q')::int;
  stored := perm[p_choice + 1];
  ok := stored = qq.correct;

  insert into kb_answers (attempt_id, idx, question_id, chosen, correct, ms)
  values (a.id, a.idx, qq.id, stored, ok, elapsed);

  -- Faster than anyone can read a question: flag for review, nothing more.
  if elapsed < 400 then
    insert into fair_play_flags (user_id, kind, ref, detail)
    values (uid, 'kb_too_fast', a.id::text, jsonb_build_object('index', a.idx, 'ms', elapsed));
  end if;

  update kb_attempts set used_ms = least(total, 60000), idx = idx + 1, served_at = null where id = a.id;

  if a.idx + 1 >= 10 then
    fin := kb_finish(a.id, false);
  end if;

  return jsonb_build_object(
    'correct', ok,
    'correct_index', array_position(perm, qq.correct) - 1,
    'fact', qq.fact,
    'remaining_ms', greatest(0, 60000 - least(total, 60000)),
    'done', fin is not null,
    'result', fin
  );
end $$;

---------------------------------------------------------------------------
-- Call It
---------------------------------------------------------------------------
create or replace function public.save_call(p_fixture bigint, p_home int, p_away int) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_member();
  f fixtures;
begin
  select * into f from fixtures where id = p_fixture;
  if not found then raise exception 'not_found'; end if;
  if f.status <> 'NS' or app_now() >= f.kickoff_at then raise exception 'call_locked'; end if;
  if p_home not between 0 and 15 or p_away not between 0 and 15 then raise exception 'bad_score'; end if;
  insert into calls (user_id, fixture_id, home_goals, away_goals, updated_at)
  values (uid, f.id, p_home, p_away, app_now())
  on conflict (user_id, fixture_id) do update
    set home_goals = excluded.home_goals, away_goals = excluded.away_goals, updated_at = excluded.updated_at;
end $$;

-- How the club is leaning on a game. Shown once you've made your own call, or after kick-off.
create or replace function public.crowd_split(p_fixture bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  f fixtures;
  h int; d int; aw int; n int;
begin
  select * into f from fixtures where id = p_fixture;
  if not found then return null; end if;
  if app_now() < f.kickoff_at and not exists (select 1 from calls where fixture_id = f.id and user_id = uid) then
    return null;
  end if;
  select count(*) filter (where home_goals > away_goals), count(*) filter (where home_goals = away_goals),
         count(*) filter (where home_goals < away_goals), count(*)
    into h, d, aw, n from calls where fixture_id = f.id;
  if n = 0 then return jsonb_build_object('calls', 0); end if;
  return jsonb_build_object('calls', n, 'home', round(100.0 * h / n), 'draw', round(100.0 * d / n), 'away', round(100.0 * aw / n));
end $$;

-- Score one fixture: 10 for the exact score, 3 for the right result.
-- Safe to run again after a corrected result. Postponed, abandoned or cancelled games score nothing.
create or replace function public.score_fixture(p_fixture bigint) returns int
language plpgsql security definer set search_path = public as $$
declare
  f fixtures;
  n int;
begin
  select * into f from fixtures where id = p_fixture for update;
  if not found then raise exception 'not_found'; end if;

  if f.status in ('PST', 'ABD', 'CANC') then
    delete from points_ledger where source = 'call' and source_ref = f.id::text;
    update fixtures set scored_at = app_now() where id = f.id;
    return 0;
  end if;
  if f.status <> 'FT' or f.home_goals is null or f.away_goals is null then return null; end if;

  insert into points_ledger (user_id, source, source_ref, matchweek_id, points, detail)
  select c.user_id, 'call', f.id::text, f.matchweek_id,
         case when c.home_goals = f.home_goals and c.away_goals = f.away_goals then 10
              when sign(c.home_goals - c.away_goals) = sign(f.home_goals - f.away_goals) then 3
              else 0 end,
         jsonb_build_object('exact', c.home_goals = f.home_goals and c.away_goals = f.away_goals,
                            'call', c.home_goals || '-' || c.away_goals,
                            'result', f.home_goals || '-' || f.away_goals)
    from calls c where c.fixture_id = f.id
  on conflict (user_id, source, source_ref) do update
    set points = excluded.points, detail = excluded.detail, matchweek_id = excluded.matchweek_id;
  get diagnostics n = row_count;

  update fixtures set scored_at = app_now() where id = f.id;
  return n;
end $$;

-- Score every fixture that finished (or changed) since it was last scored.
create or replace function public.score_pending() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from fixtures
            where status in ('FT', 'PST', 'ABD', 'CANC') and (scored_at is null or updated_at > scored_at)
  loop
    perform score_fixture(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Set each uncrowned matchweek to end at noon WAT the day after its last game,
-- and start where the previous matchweek ended.
create or replace function public.refresh_matchweek_windows() returns void
language plpgsql security definer set search_path = public as $$
begin
  update matchweeks m
     set ends_at = wat_at(wat_date(x.last_kickoff) + 1, time '12:00')
    from (select matchweek_id, max(kickoff_at) as last_kickoff from fixtures
           where status not in ('PST', 'CANC') group by matchweek_id) x
   where x.matchweek_id = m.id and m.crowned_at is null;

  update matchweeks m
     set starts_at = coalesce((select max(q.ends_at) from matchweeks q
                                where q.season_id = m.season_id and q.ends_at < m.ends_at), m.starts_at)
   where m.crowned_at is null;
end $$;

---------------------------------------------------------------------------
-- Crowning: Oracle of the Week and each league's Oracle.
-- Ties: most exact scores, then most right Know Ball answers, then the fastest total Know Ball time.
---------------------------------------------------------------------------
create or replace function public.crown_due() returns int
language plpgsql security definer set search_path = public as $$
declare m matchweeks; n int := 0;
begin
  for m in select * from matchweeks
            where crowned_at is null and ends_at <= app_now()
              and not exists (select 1 from fixtures f where f.matchweek_id = matchweeks.id and f.status in ('NS', 'LIVE'))
            order by ends_at
  loop
    insert into oracle_of_week (matchweek_id, user_id, points, exact_scores)
    select w.matchweek_id, w.user_id, w.points, w.exact_scores
      from weekly_scores w
     where w.matchweek_id = m.id and w.points > 0
     order by w.points desc, w.exact_scores desc, w.kb_right desc, w.kb_ms asc
     limit 1
    on conflict (matchweek_id) do nothing;

    insert into league_oracles (league_id, matchweek_id, user_id, points)
    select distinct on (lm.league_id) lm.league_id, m.id, w.user_id, w.points
      from league_members lm
      join weekly_scores w on w.user_id = lm.user_id and w.matchweek_id = m.id
     where w.points > 0
     order by lm.league_id, w.points desc, w.exact_scores desc, w.kb_right desc, w.kb_ms asc
    on conflict (league_id, matchweek_id) do nothing;

    update matchweeks set crowned_at = app_now() where id = m.id;
    n := n + 1;
  end loop;
  return n;
end $$;

---------------------------------------------------------------------------
-- Poll of the Day: 1 point for voting.
---------------------------------------------------------------------------
create or replace function public.vote_poll(p_poll int, p_option int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_member();
  p polls;
begin
  select * into p from polls where id = p_poll;
  if not found then raise exception 'not_found'; end if;
  if app_now() < p.opens_at or app_now() >= p.closes_at then raise exception 'poll_closed'; end if;
  if p_option not between 0 and array_length(p.options, 1) - 1 then raise exception 'bad_option'; end if;
  insert into poll_votes (poll_id, user_id, option) values (p.id, uid, p_option);   -- one vote; a second raises
  insert into points_ledger (user_id, source, source_ref, matchweek_id, points)
  values (uid, 'poll', p.id::text, mw_at(app_now()), 1)
  on conflict do nothing;
  return poll_split(p.id);
end $$;

create or replace function public.poll_split(p_poll int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare n int;
begin
  if not exists (select 1 from poll_votes where poll_id = p_poll and user_id = auth.uid()) then return null; end if;
  select count(*) into n from poll_votes where poll_id = p_poll;
  return jsonb_build_object('votes', n, 'split',
    (select jsonb_agg(round(100.0 * (select count(*) from poll_votes v where v.poll_id = p_poll and v.option = o) / n) order by o)
       from generate_series(0, (select array_length(options, 1) - 1 from polls where id = p_poll)) o));
end $$;

---------------------------------------------------------------------------
-- Cold Takes and the Dressing Room
---------------------------------------------------------------------------
create or replace function public.vote_take(p_take int, p_side text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_member();
begin
  if p_side not in ('agree', 'disagree') then raise exception 'bad_side'; end if;
  if not exists (select 1 from takes where id = p_take and published_at <= app_now()) then raise exception 'not_found'; end if;
  insert into take_votes (take_id, user_id, side) values (p_take, uid, p_side);   -- votes are final
  return take_split(p_take);
end $$;

create or replace function public.take_split(p_take int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a int; n int;
begin
  if not exists (select 1 from take_votes where take_id = p_take and user_id = auth.uid()) then return null; end if;
  select count(*) filter (where side = 'agree'), count(*) into a, n from take_votes where take_id = p_take;
  return jsonb_build_object('votes', n, 'agree', round(100.0 * a / n), 'disagree', 100 - round(100.0 * a / n));
end $$;

-- 280 characters, one reply per 30 seconds per take (slow mode).
create or replace function public.post_reply(p_take int, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_member();
  b text := trim(p_body);
  rid bigint;
begin
  if b is null or char_length(b) = 0 then raise exception 'empty_reply'; end if;
  if char_length(b) > 280 then raise exception 'reply_too_long'; end if;
  if not exists (select 1 from takes where id = p_take and published_at <= app_now()) then raise exception 'not_found'; end if;
  if exists (select 1 from replies where take_id = p_take and user_id = uid and created_at > app_now() - interval '30 seconds') then
    raise exception 'slow_mode';
  end if;
  insert into replies (take_id, user_id, side, body)
  values (p_take, uid, (select side from take_votes where take_id = p_take and user_id = uid), b)
  returning id into rid;
  return rid;
end $$;

create or replace function public.delete_reply(p_reply bigint) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_member();
begin
  update replies set deleted_at = app_now() where id = p_reply and user_id = uid and deleted_at is null;
  if not found then raise exception 'not_found'; end if;
end $$;

-- Any member can report; the reply is hidden until a Steward reviews it.
create or replace function public.report_reply(p_reply bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_member();
begin
  if not exists (select 1 from replies where id = p_reply and deleted_at is null and user_id <> uid) then
    raise exception 'not_found';
  end if;
  insert into reports (reply_id, reporter_id, reason) values (p_reply, uid, left(p_reason, 200))
  on conflict do nothing;
  update replies set hidden = true where id = p_reply;
end $$;

create or replace function public.review_report(p_reply bigint, p_keep boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_member();
begin
  if not exists (select 1 from profiles where id = uid and role in ('steward', 'admin')) then
    raise exception 'not_allowed';
  end if;
  if p_keep then
    update replies set hidden = false where id = p_reply;
  else
    update replies set hidden = true, deleted_at = app_now() where id = p_reply;
  end if;
  update reports set resolved_at = app_now(), resolved_by = uid, outcome = case when p_keep then 'kept' else 'removed' end
   where reply_id = p_reply and resolved_at is null;
end $$;

---------------------------------------------------------------------------
-- Leagues
---------------------------------------------------------------------------
create or replace function public.is_league_member(p_league uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from league_members where league_id = p_league and user_id = auth.uid())
$$;

create or replace function public.create_league(p_name text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_member();
  code text;
  lid uuid;
begin
  if (select count(*) from leagues where owner_id = uid) >= 10 then raise exception 'too_many_leagues'; end if;
  loop
    -- 6 characters with no 0/O or 1/I, easy to read out loud
    code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
               from generate_series(1, 6));
    exit when not exists (select 1 from leagues where invite_code = code);
  end loop;
  insert into leagues (name, kind, owner_id, invite_code)
  values (trim(p_name), coalesce(nullif(p_kind, ''), 'Friends'), uid, code)
  returning id into lid;
  insert into league_members (league_id, user_id) values (lid, uid);
  return jsonb_build_object('id', lid, 'invite_code', code);
end $$;

-- What a non-member sees on an invite link: name, size and the top three this week.
create or replace function public.league_by_code(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', l.id, 'name', l.name, 'kind', l.kind,
    'owner', (select handle from profiles where id = l.owner_id),
    'members', (select count(*) from league_members where league_id = l.id),
    'top', (select coalesce(jsonb_agg(t), '[]') from (
              select p.handle, w.points from league_members lm
                join profiles p on p.id = lm.user_id
                join weekly_scores w on w.user_id = lm.user_id and w.matchweek_id = mw_at(app_now())
               where lm.league_id = l.id order by w.points desc limit 3) t))
  from leagues l where l.invite_code = upper(trim(p_code))
$$;

create or replace function public.join_league(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_member();
  l leagues;
begin
  select * into l from leagues where invite_code = upper(trim(p_code));
  if not found then raise exception 'not_found'; end if;
  if (select count(*) from league_members where league_id = l.id) >= 500 then raise exception 'league_full'; end if;
  insert into league_members (league_id, user_id) values (l.id, uid) on conflict do nothing;
  return l.id;
end $$;

create or replace function public.leave_league(p_league uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_member();
begin
  if exists (select 1 from leagues where id = p_league and owner_id = uid) then raise exception 'owner_cannot_leave'; end if;
  delete from league_members where league_id = p_league and user_id = uid;
end $$;

create or replace function public.remove_league_member(p_league uuid, p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_member();
begin
  if not exists (select 1 from leagues where id = p_league and owner_id = uid) then raise exception 'not_allowed'; end if;
  if p_member = uid then raise exception 'owner_cannot_leave'; end if;
  delete from league_members where league_id = p_league and user_id = p_member;
end $$;

create or replace function public.rename_league(p_league uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_member();
begin
  update leagues set name = trim(p_name) where id = p_league and owner_id = uid;
  if not found then raise exception 'not_allowed'; end if;
end $$;

-- A league's table for a matchweek (default: the one running now).
create or replace function public.league_table(p_league uuid, p_matchweek int default null)
returns table (pos bigint, user_id uuid, handle text, points int, exact_scores int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_league_member(p_league) then raise exception 'not_allowed'; end if;
  return query
  select rank() over (order by coalesce(w.points, 0) desc, coalesce(w.exact_scores, 0) desc),
         p.id, p.handle, coalesce(w.points, 0), coalesce(w.exact_scores, 0)
    from league_members lm
    join profiles p on p.id = lm.user_id
    left join weekly_scores w on w.user_id = lm.user_id and w.matchweek_id = coalesce(p_matchweek, mw_at(app_now()))
   where lm.league_id = p_league
   order by 1, p.handle;
end $$;

---------------------------------------------------------------------------
-- Your data (Privacy s.7)
---------------------------------------------------------------------------
create or replace function public.export_my_data() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'exported_at', app_now(),
    'profile', (select to_jsonb(p) from profiles p where id = auth.uid()),
    'calls', (select coalesce(jsonb_agg(c), '[]') from calls c where user_id = auth.uid()),
    'know_ball', (select coalesce(jsonb_agg(jsonb_build_object('quiz', a.quiz_id, 'score', a.score, 'used_ms', a.used_ms,
                    'answers', (select jsonb_agg(jsonb_build_object('index', x.idx, 'correct', x.correct, 'ms', x.ms))
                                  from kb_answers x where x.attempt_id = a.id))), '[]')
                  from kb_attempts a where a.user_id = auth.uid()),
    'poll_votes', (select coalesce(jsonb_agg(v), '[]') from poll_votes v where user_id = auth.uid()),
    'take_votes', (select coalesce(jsonb_agg(v), '[]') from take_votes v where user_id = auth.uid()),
    'replies', (select coalesce(jsonb_agg(r), '[]') from replies r where user_id = auth.uid()),
    'leagues', (select coalesce(jsonb_agg(jsonb_build_object('league', l.name, 'joined_at', m.joined_at)), '[]')
                  from league_members m join leagues l on l.id = m.league_id where m.user_id = auth.uid()),
    'points', (select coalesce(jsonb_agg(l), '[]') from points_ledger l where user_id = auth.uid())
  )
$$;

-- Deletes the login and, through cascades, everything personal.
-- Points stay in past tables with no name attached (Privacy s.6).
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  delete from auth.users where id = uid;
end $$;
