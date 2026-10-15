-- Crystal Ball FC: Call It International.
-- During international breaks the sync pulls every international fixture from the chosen competitions.
-- Only "featured" games are playable: the Super Eagles' games always, plus games between top-ranked nations
-- (FIFA top 20 against top 20 first). Editors can switch games on or off before anyone calls them.
-- Only featured games count towards matchweek windows, the crown and Call It.

alter table public.fixtures add column featured boolean not null default true;

create table public.top_nations (
  name       text primary key,   -- as the football data provider spells it, e.g. 'Ivory Coast'
  fifa_rank  int not null unique check (fifa_rank between 1 and 50)
);
alter table public.top_nations enable row level security;
grant select on public.top_nations to anon, authenticated;
create policy "rankings are public" on public.top_nations for select using (true);

-- Should a new international fixture be featured automatically?
create or replace function public.int_auto_feature(p_home text, p_away text) returns boolean
language sql stable set search_path = public as $$
  select p_home = 'Nigeria' or p_away = 'Nigeria'
      or (exists (select 1 from top_nations where name = p_home and fifa_rank <= 20)
          and exists (select 1 from top_nations where name = p_away and fifa_rank <= 20))
$$;

-- As before, plus: international games get featured on arrival by the rule above;
-- after that, an editor's choice is never overwritten by the sync.
create or replace function public.upsert_fixtures(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  f jsonb;
  mw int;
  ko timestamptz;
  n int := 0;
  changed int;
begin
  for f in select * from jsonb_array_elements(p) loop
    ko := (f ->> 'kickoff_at')::timestamptz;

    insert into matchweeks (season_id, label, starts_at, ends_at)
    values (f ->> 'season_id', f ->> 'matchweek', ko - interval '7 days', ko + interval '1 day')
    on conflict (season_id, label) do nothing;
    select id into mw from matchweeks where season_id = f ->> 'season_id' and label = f ->> 'matchweek';

    insert into fixtures (id, competition, matchweek_id, home, away, kickoff_at, status, home_goals, away_goals, updated_at, featured)
    values ((f ->> 'id')::bigint, f ->> 'competition', mw, f ->> 'home', f ->> 'away', ko, f ->> 'status',
            (f ->> 'home_goals')::int, (f ->> 'away_goals')::int, app_now(),
            case when f ->> 'competition' = 'INT' then int_auto_feature(f ->> 'home', f ->> 'away') else true end)
    on conflict (id) do update
      set competition = excluded.competition, matchweek_id = excluded.matchweek_id,
          home = excluded.home, away = excluded.away, kickoff_at = excluded.kickoff_at,
          status = excluded.status, home_goals = excluded.home_goals, away_goals = excluded.away_goals,
          updated_at = excluded.updated_at
      where (fixtures.matchweek_id, fixtures.home, fixtures.away, fixtures.kickoff_at, fixtures.status,
             fixtures.home_goals, fixtures.away_goals)
            is distinct from
            (excluded.matchweek_id, excluded.home, excluded.away, excluded.kickoff_at, excluded.status,
             excluded.home_goals, excluded.away_goals);
    get diagnostics changed = row_count;
    n := n + changed;
  end loop;
  return n;
end $$;

create or replace function public.save_call(p_fixture bigint, p_home int, p_away int) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_member();
  f fixtures;
begin
  select * into f from fixtures where id = p_fixture;
  if not found or not f.featured then raise exception 'not_found'; end if;
  if f.status <> 'NS' or app_now() >= f.kickoff_at then raise exception 'call_locked'; end if;
  if p_home not between 0 and 15 or p_away not between 0 and 15 then raise exception 'bad_score'; end if;
  insert into calls (user_id, fixture_id, home_goals, away_goals, updated_at)
  values (uid, f.id, p_home, p_away, app_now())
  on conflict (user_id, fixture_id) do update
    set home_goals = excluded.home_goals, away_goals = excluded.away_goals, updated_at = excluded.updated_at;
end $$;

create or replace function public.refresh_matchweek_windows() returns void
language plpgsql security definer set search_path = public as $$
begin
  update matchweeks m
     set ends_at = wat_at(wat_date(x.last_kickoff) + 1, time '12:00')
    from (select matchweek_id, max(kickoff_at) as last_kickoff from fixtures
           where featured and status not in ('PST', 'CANC') group by matchweek_id) x
   where x.matchweek_id = m.id and m.crowned_at is null;

  update matchweeks m
     set starts_at = coalesce((select max(q.ends_at) from matchweeks q
                                where q.season_id = m.season_id and q.ends_at < m.ends_at), m.starts_at)
   where m.crowned_at is null;
end $$;

create or replace function public.crown_due() returns int
language plpgsql security definer set search_path = public as $$
declare m matchweeks; n int := 0;
begin
  for m in select * from matchweeks
            where crowned_at is null and ends_at <= app_now()
              and exists (select 1 from fixtures f where f.matchweek_id = matchweeks.id and f.featured)
              and not exists (select 1 from fixtures f where f.matchweek_id = matchweeks.id and f.featured and f.status in ('NS', 'LIVE'))
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
-- Editors: rankings and the featured games
---------------------------------------------------------------------------
-- Replace the ranking list in one go, top first (paste from FIFA's men's world ranking).
create or replace function public.admin_set_top_nations(p_names text[]) returns int
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_role(array['editor', 'admin']);
begin
  if array_length(p_names, 1) > 50 then raise exception 'too_many'; end if;
  delete from top_nations where true;
  insert into top_nations (name, fifa_rank)
  select trim(n), o::int from unnest(p_names) with ordinality as t(n, o) where trim(n) <> '';
  perform log_admin(uid, 'set_top_nations', jsonb_build_object('count', array_length(p_names, 1)));
  return (select count(*) from top_nations);
end $$;

create or replace function public.admin_int_fixtures(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['editor', 'admin']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', f.id, 'home', f.home, 'away', f.away, 'kickoff_at', f.kickoff_at, 'status', f.status,
            'featured', f.featured, 'calls', (select count(*) from calls c where c.fixture_id = f.id),
            'home_rank', (select fifa_rank from top_nations where name = f.home),
            'away_rank', (select fifa_rank from top_nations where name = f.away)) order by f.kickoff_at), '[]')
            from fixtures f where f.competition = 'INT' and f.kickoff_at between p_from and p_to);
end $$;

-- Switch a game on or off. A game can't be switched off once members have called it.
create or replace function public.admin_feature_fixture(p_fixture bigint, p_featured boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_role(array['editor', 'admin']);
begin
  if not p_featured and exists (select 1 from calls where fixture_id = p_fixture) then raise exception 'has_calls'; end if;
  update fixtures set featured = p_featured where id = p_fixture and competition = 'INT';
  if not found then raise exception 'not_found'; end if;
  perform refresh_matchweek_windows();
  perform log_admin(uid, 'feature_fixture', jsonb_build_object('fixture', p_fixture, 'featured', p_featured));
end $$;

revoke execute on function public.int_auto_feature(text, text) from public, anon, authenticated;
revoke execute on function public.upsert_fixtures(jsonb), public.refresh_matchweek_windows(), public.crown_due() from public, anon, authenticated;
grant execute on function public.upsert_fixtures(jsonb), public.refresh_matchweek_windows(), public.crown_due() to service_role;
grant execute on function public.admin_set_top_nations(text[]), public.admin_int_fixtures(timestamptz, timestamptz),
                          public.admin_feature_fixture(bigint, boolean) to authenticated;
