-- Crystal Ball FC: core tables.
-- All game times are West Africa Time (Africa/Lagos, UTC+1, no daylight saving).
-- Every rule that decides points lives in the database, so a member's phone can never change a score or a clock.

-- One clock for the whole game. Tests replace this function to control time.
create or replace function public.app_now() returns timestamptz
language sql stable as $$ select clock_timestamp() $$;

-- The calendar date in Lagos for a moment in time.
create or replace function public.wat_date(ts timestamptz) returns date
language sql immutable as $$ select (ts at time zone 'Africa/Lagos')::date $$;

-- A Lagos wall-clock time on a given date, as a real timestamp.
create or replace function public.wat_at(d date, t time) returns timestamptz
language sql immutable as $$ select (d + t) at time zone 'Africa/Lagos' $$;

---------------------------------------------------------------------------
-- Members
---------------------------------------------------------------------------
create sequence public.founding_seq;

create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  handle           text not null unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  city             text check (char_length(city) <= 40),
  club             text check (char_length(club) <= 40),
  confirmed_adult  boolean not null check (confirmed_adult),         -- 18+ only (Terms s.2, Privacy s.10)
  role             text not null default 'member' check (role in ('member', 'steward', 'admin')),
  founding_number  int unique,                                         -- first 1,000 members
  -- Reminders stay off until the member turns them on (Privacy s.2).
  reminders        jsonb not null default '{"kb": false, "ten": false, "call": false, "wa": false}',
  created_at       timestamptz not null default now()
);

---------------------------------------------------------------------------
-- Seasons, matchweeks and fixtures
---------------------------------------------------------------------------
create table public.seasons (
  id         text primary key,               -- '2026-27'
  label      text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null
);

-- A matchweek runs from the previous crowning to its own crowning
-- (noon WAT the day after its last game). Know Ball and poll points land in
-- whichever matchweek is running when they are earned.
create table public.matchweeks (
  id          serial primary key,
  season_id   text not null references public.seasons (id),
  label       text not null,                 -- 'Matchweek 12', 'November international break'
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,          -- the crowning moment
  crowned_at  timestamptz,
  check (ends_at > starts_at)
);
create index on public.matchweeks (starts_at, ends_at);

create table public.fixtures (
  id            bigint primary key,          -- the football data provider's fixture id
  competition   text not null check (competition in ('PL', 'INT')),
  matchweek_id  int references public.matchweeks (id),
  home          text not null,
  away          text not null,
  kickoff_at    timestamptz not null,
  -- NS not started, LIVE in play, FT finished, PST postponed, ABD abandoned, CANC cancelled
  status        text not null default 'NS' check (status in ('NS', 'LIVE', 'FT', 'PST', 'ABD', 'CANC')),
  home_goals    int check (home_goals >= 0), -- score at the end of normal time, never extra time (Terms s.4)
  away_goals    int check (away_goals >= 0),
  updated_at    timestamptz not null default now(),
  scored_at     timestamptz
);
create index on public.fixtures (matchweek_id);
create index on public.fixtures (kickoff_at);

create table public.calls (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  fixture_id  bigint not null references public.fixtures (id) on delete cascade,
  home_goals  int not null check (home_goals between 0 and 15),
  away_goals  int not null check (away_goals between 0 and 15),
  updated_at  timestamptz not null default now(),
  primary key (user_id, fixture_id)
);
create index on public.calls (fixture_id);

---------------------------------------------------------------------------
-- Points: one row per thing that earned (or could earn) points.
-- source_ref makes scoring idempotent: re-scoring a corrected result updates the row.
-- When a member deletes their account, their rows stay as "former member" (Privacy s.6).
---------------------------------------------------------------------------
create table public.points_ledger (
  id            bigserial primary key,
  user_id       uuid references public.profiles (id) on delete set null,
  source        text not null check (source in ('kb', 'call', 'poll', 'ten', 'adjust')),
  source_ref    text not null,
  matchweek_id  int references public.matchweeks (id),
  points        int not null,
  detail        jsonb not null default '{}',
  created_at    timestamptz not null default public.app_now(),
  unique (user_id, source, source_ref)
);
create index on public.points_ledger (matchweek_id, user_id);

---------------------------------------------------------------------------
-- Know Ball: 10 questions, 60 seconds, the clock runs only while a question is on screen.
---------------------------------------------------------------------------
create table public.kb_quizzes (
  id               serial primary key,
  quiz_date        date not null unique,
  opens_at         timestamptz not null,     -- 9am WAT
  closes_at        timestamptz not null,     -- midnight WAT
  is_prize         boolean not null default false,
  prize_opens_at   timestamptz,              -- prize quizzes run in a 5-minute window at launch
  prize_closes_at  timestamptz,
  salt             text not null default md5(random()::text),   -- keeps each member's order unguessable
  check (closes_at > opens_at),
  check (not is_prize or (prize_opens_at is not null and prize_closes_at > prize_opens_at))
);

-- Each quiz has 10 slots. A slot with one row is fixed (everyone gets it);
-- a slot with two or more rows is a swap slot (each member gets one of them).
create table public.kb_questions (
  id          serial primary key,
  quiz_id     int not null references public.kb_quizzes (id) on delete cascade,
  slot        int not null check (slot between 1 and 10),
  variant     int not null default 0,
  difficulty  text not null check (difficulty in ('easy', 'medium', 'hard', 'home')),
  prompt      text not null,
  options     text[] not null check (array_length(options, 1) = 4),
  correct     int not null check (correct between 0 and 3),   -- index into options as stored
  fact        text not null default '',
  unique (quiz_id, slot, variant)
);

create table public.kb_attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  quiz_id      int not null references public.kb_quizzes (id) on delete cascade,
  plan         jsonb not null,               -- [{ "q": question id, "perm": [display -> stored option index] }]
  idx          int not null default 0,       -- the question the member is on (0-9)
  served_at    timestamptz,                  -- when the current question was shown; null between questions
  used_ms      int not null default 0,       -- clock time used so far
  score        int,
  status       text not null default 'playing' check (status in ('playing', 'done')),
  timed_out    boolean not null default false,
  started_at   timestamptz not null default public.app_now(),
  finished_at  timestamptz,
  unique (user_id, quiz_id)
);

create table public.kb_answers (
  attempt_id   uuid not null references public.kb_attempts (id) on delete cascade,
  idx          int not null,
  question_id  int not null references public.kb_questions (id),
  chosen       int not null,                 -- stored option index
  correct      boolean not null,
  ms           int not null,
  answered_at  timestamptz not null default public.app_now(),
  primary key (attempt_id, idx)
);

-- Signals for a person to review. A flag never costs anyone points by itself (Terms s.5).
create table public.fair_play_flags (
  id           bigserial primary key,
  user_id      uuid references public.profiles (id) on delete cascade,
  kind         text not null,
  ref          text not null,
  detail       jsonb not null default '{}',
  created_at   timestamptz not null default public.app_now(),
  reviewed_by  uuid references public.profiles (id),
  reviewed_at  timestamptz,
  outcome      text check (outcome in ('cleared', 'actioned'))
);

---------------------------------------------------------------------------
-- Poll of the Day
---------------------------------------------------------------------------
create table public.polls (
  id         serial primary key,
  poll_date  date not null unique,
  question   text not null,
  options    text[] not null check (array_length(options, 1) between 2 and 4),
  opens_at   timestamptz not null,           -- 12pm WAT
  closes_at  timestamptz not null
);

create table public.poll_votes (
  poll_id     int not null references public.polls (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  option      int not null,
  created_at  timestamptz not null default public.app_now(),
  primary key (poll_id, user_id)
);

---------------------------------------------------------------------------
-- Cold Takes, Oracle videos and the Dressing Room
---------------------------------------------------------------------------
create table public.takes (
  id            serial primary key,
  slug          text not null unique check (slug ~ '^[a-z0-9-]{3,80}$'),
  kind          text not null default 'take' check (kind in ('take', 'video')),
  title         text not null,
  question      text not null,               -- what members vote on: "Agree or disagree?"
  body          jsonb not null default '[]', -- paragraphs, or transcript lines for a video
  call_line     text,                        -- "Here's the call: ..."
  video         jsonb,                       -- { url, length_s, episode, oracle_call: { fixture_id, home, away, note } }
  published_at  timestamptz                  -- null = draft
);

create table public.take_votes (
  take_id     int not null references public.takes (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  side        text not null check (side in ('agree', 'disagree')),
  created_at  timestamptz not null default public.app_now(),
  primary key (take_id, user_id)
);

create table public.replies (
  id          bigserial primary key,
  take_id     int not null references public.takes (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  side        text check (side in ('agree', 'disagree')),
  body        text not null check (char_length(body) between 1 and 280),
  likes       int not null default 0,
  hidden      boolean not null default false,  -- hidden while a Steward reviews a report
  deleted_at  timestamptz,
  created_at  timestamptz not null default public.app_now()
);
create index on public.replies (take_id, created_at desc);

create table public.reports (
  reply_id     bigint not null references public.replies (id) on delete cascade,
  reporter_id  uuid not null references public.profiles (id) on delete cascade,
  reason       text,
  created_at   timestamptz not null default public.app_now(),
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles (id),
  outcome      text check (outcome in ('kept', 'removed')),
  primary key (reply_id, reporter_id)
);

---------------------------------------------------------------------------
-- Private leagues: same daily games, a table of your own people.
---------------------------------------------------------------------------
create table public.leagues (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 3 and 40),
  kind         text not null default 'Friends' check (kind in ('Friends', 'Office', 'Fan club', 'Family', 'Other')),
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  invite_code  text not null unique,
  created_at   timestamptz not null default public.app_now()
);

create table public.league_members (
  league_id  uuid not null references public.leagues (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default public.app_now(),
  primary key (league_id, user_id)
);
create index on public.league_members (user_id);

---------------------------------------------------------------------------
-- Crowns
---------------------------------------------------------------------------
create table public.oracle_of_week (
  matchweek_id  int primary key references public.matchweeks (id),
  user_id       uuid references public.profiles (id) on delete set null,
  points        int not null,
  exact_scores  int not null,
  crowned_at    timestamptz not null default public.app_now()
);

create table public.league_oracles (
  league_id     uuid not null references public.leagues (id) on delete cascade,
  matchweek_id  int not null references public.matchweeks (id),
  user_id       uuid references public.profiles (id) on delete set null,
  points        int not null,
  primary key (league_id, matchweek_id)
);

---------------------------------------------------------------------------
-- Tables (leaderboards)
---------------------------------------------------------------------------
create view public.weekly_scores as
select
  l.matchweek_id,
  l.user_id,
  sum(l.points)::int                                                              as points,
  (count(*) filter (where l.source = 'call' and (l.detail ->> 'exact')::boolean))::int as exact_scores,
  coalesce(sum((l.detail ->> 'right')::int) filter (where l.source = 'kb'), 0)::int   as kb_right,
  coalesce(sum((l.detail ->> 'ms')::int) filter (where l.source = 'kb'), 0)::int      as kb_ms
from public.points_ledger l
where l.matchweek_id is not null and l.user_id is not null
group by l.matchweek_id, l.user_id;

create view public.season_scores as
select m.season_id, l.user_id, sum(l.points)::int as points
from public.points_ledger l
join public.matchweeks m on m.id = l.matchweek_id
where l.user_id is not null
group by m.season_id, l.user_id;

-- Prophet (top 1%) is awarded when the season ends, not by points.
create or replace function public.rank_for(points int) returns text
language sql immutable as $$
  select case
    when points >= 1200 then 'Oracle'
    when points >= 500  then 'Seer'
    when points >= 150  then 'Reader'
    else 'Apprentice'
  end
$$;
