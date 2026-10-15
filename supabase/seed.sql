-- Run once after the migrations. The sync job creates matchweeks and fixtures from API-Football.
insert into public.seasons (id, label, starts_at, ends_at)
values ('2026-27', 'Season 2026/27', '2026-08-01 00:00+01', '2027-06-30 23:59+01')
on conflict do nothing;
