-- Crystal Ball FC: loading fixtures and results from the football data provider.

alter table public.matchweeks add constraint matchweeks_season_label_key unique (season_id, label);

-- Takes a batch of fixtures from the sync job and writes only what changed.
-- A changed result bumps updated_at, so score_pending() re-scores that game.
-- p: [{ id, competition, season_id, matchweek, home, away, kickoff_at, status, home_goals, away_goals }]
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

    insert into fixtures (id, competition, matchweek_id, home, away, kickoff_at, status, home_goals, away_goals, updated_at)
    values ((f ->> 'id')::bigint, f ->> 'competition', mw, f ->> 'home', f ->> 'away', ko, f ->> 'status',
            (f ->> 'home_goals')::int, (f ->> 'away_goals')::int, app_now())
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

revoke execute on function public.upsert_fixtures(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_fixtures(jsonb) to service_role;
