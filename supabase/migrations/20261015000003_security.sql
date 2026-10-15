-- Crystal Ball FC: who can read and write what.
-- Members read through row-level security and write only through the game functions.
-- Scoring, syncing and crowning run with the service role from scheduled jobs.

---------------------------------------------------------------------------
-- Lock everything down, then open what's needed.
---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

---------------------------------------------------------------------------
-- Public reading: anyone, signed in or not.
---------------------------------------------------------------------------
grant select on public.seasons, public.matchweeks, public.fixtures, public.kb_quizzes, public.polls,
                public.takes, public.oracle_of_week to anon, authenticated;

create policy "seasons are public"    on public.seasons        for select using (true);
create policy "matchweeks are public" on public.matchweeks     for select using (true);
create policy "fixtures are public"   on public.fixtures       for select using (true);
create policy "quiz dates are public" on public.kb_quizzes     for select using (true);
create policy "polls are public"      on public.polls          for select using (true);
create policy "published takes"       on public.takes          for select using (published_at is not null and published_at <= public.app_now());
create policy "crowns are public"     on public.oracle_of_week for select using (true);

-- The salt that scrambles each member's question order must never leave the database.
revoke select on public.kb_quizzes from anon, authenticated;
grant select (id, quiz_date, opens_at, closes_at, is_prize, prize_opens_at, prize_closes_at) on public.kb_quizzes to anon, authenticated;

---------------------------------------------------------------------------
-- Members: handles, cities, clubs and ranks are public; phone numbers live in auth and are never exposed.
---------------------------------------------------------------------------
grant select (id, handle, city, club, role, founding_number, created_at) on public.profiles to anon, authenticated;
grant select (reminders) on public.profiles to authenticated;
grant update (city, club, reminders) on public.profiles to authenticated;
create policy "profiles are public"     on public.profiles for select using (true);
create policy "edit your own profile"   on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Points are public: they make the tables.
grant select on public.points_ledger to anon, authenticated;
create policy "points are public" on public.points_ledger for select using (true);
grant select on public.weekly_scores, public.season_scores to anon, authenticated;

---------------------------------------------------------------------------
-- Your own game records.
---------------------------------------------------------------------------
grant select on public.calls, public.kb_attempts, public.kb_answers, public.poll_votes, public.take_votes to authenticated;
create policy "your calls"        on public.calls       for select to authenticated using (user_id = auth.uid());
create policy "your quiz"         on public.kb_attempts for select to authenticated using (user_id = auth.uid());
create policy "your answers"      on public.kb_answers  for select to authenticated
  using (exists (select 1 from public.kb_attempts a where a.id = attempt_id and a.user_id = auth.uid()));
create policy "your poll votes"   on public.poll_votes  for select to authenticated using (user_id = auth.uid());
create policy "your take votes"   on public.take_votes  for select to authenticated using (user_id = auth.uid());
-- kb_questions, fair_play_flags and reports have no policies: nobody reads them directly.

---------------------------------------------------------------------------
-- The Dressing Room: visible replies to everyone; a hidden reply only to its author.
---------------------------------------------------------------------------
grant select (id, take_id, user_id, side, body, likes, hidden, created_at) on public.replies to anon, authenticated;
create policy "visible replies" on public.replies for select
  using (deleted_at is null and (not hidden or user_id = auth.uid()));

---------------------------------------------------------------------------
-- Leagues: members see their own leagues; strangers see only what an invite link shows.
---------------------------------------------------------------------------
grant select on public.leagues, public.league_members, public.league_oracles to authenticated;
create policy "your leagues"        on public.leagues        for select to authenticated using (public.is_league_member(id));
create policy "your league members" on public.league_members for select to authenticated using (public.is_league_member(league_id));
create policy "your league crowns"  on public.league_oracles for select to authenticated using (public.is_league_member(league_id));

---------------------------------------------------------------------------
-- Functions members may call.
---------------------------------------------------------------------------
grant execute on function
  public.app_now(), public.wat_date(timestamptz), public.wat_at(date, time), public.rank_for(int), public.mw_at(timestamptz),
  public.is_league_member(uuid), public.league_by_code(text), public.crowd_split(bigint), public.poll_split(int), public.take_split(int)
to anon, authenticated;

grant execute on function
  public.create_profile(text, text, text, boolean),
  public.kb_start(), public.kb_question(uuid), public.kb_answer(uuid, int),
  public.save_call(bigint, int, int),
  public.vote_poll(int, int),
  public.vote_take(int, text), public.post_reply(int, text), public.delete_reply(bigint),
  public.report_reply(bigint, text), public.review_report(bigint, boolean),
  public.create_league(text, text), public.join_league(text), public.leave_league(uuid),
  public.remove_league_member(uuid, uuid), public.rename_league(uuid, text), public.league_table(uuid, int),
  public.export_my_data(), public.delete_my_account()
to authenticated;

-- Scheduled jobs only (service role): scoring, syncing, crowning, and the internal finisher.
grant execute on function
  public.score_fixture(bigint), public.score_pending(), public.refresh_matchweek_windows(), public.crown_due(),
  public.kb_finish(uuid, boolean)
to service_role;
