import { beforeAll, describe, expect, it } from 'vitest';
import { makeDb, fails, type Db } from './harness';

let db: Db;
let editor: string, member: string;

const fixture = (id: number, home: string, away: string, kickoff: string) => ({
  id, competition: 'INT', season_id: '2026-27', matchweek: 'Internationals · Nov 2026', home, away,
  kickoff_at: kickoff, status: 'NS', home_goals: null, away_goals: null,
});

beforeAll(async () => {
  db = await makeDb();
  await db.pg.exec(`
    insert into public.seasons values ('2026-27', 'Season 2026/27', '2026-08-01', '2027-06-30');
    insert into public.matchweeks (season_id, label, starts_at, ends_at, crowned_at)
      values ('2026-27', 'Matchweek 12', '2026-11-03 11:00+00', '2026-11-10 11:00+00', '2026-11-10 11:00+00');
  `);
  editor = await db.member('content_lead');
  member = await db.member('eagles_fan');
  await db.pg.query(`update public.profiles set role = 'editor' where id = $1`, [editor]);
});

describe('Call It International', () => {
  it('features the Super Eagles and top-20 v top-20 games automatically, and nothing else', async () => {
    await db.as(editor);
    // A made-up ranking list for the test, top first.
    const names = ['Argentina', 'Spain', 'France', 'England', 'Brazil', 'Portugal', 'Netherlands', 'Belgium', 'Germany', 'Croatia',
                   'Morocco', 'Italy', 'Colombia', 'USA', 'Mexico', 'Uruguay', 'Switzerland', 'Japan', 'Senegal', 'Denmark'];
    expect(await db.one(`select public.admin_set_top_nations($1)`, [names])).toBe(20);

    await db.as(null);
    await db.one(`select public.upsert_fixtures($1::jsonb)`, [JSON.stringify([
      fixture(8001, 'Nigeria', 'South Africa', '2026-11-13T16:00:00Z'),   // Super Eagles: always
      fixture(8002, 'England', 'Brazil', '2026-11-14T19:45:00Z'),          // top 20 v top 20
      fixture(8003, 'Argentina', 'Bolivia', '2026-11-15T23:00:00Z'),       // Bolivia not in the top 20
      fixture(8004, 'Malta', 'Andorra', '2026-11-16T19:45:00Z'),           // neither
    ])]);
    const rows = await db.rows<any>(`select id, featured from public.fixtures order by id`);
    expect(rows.map((r) => [Number(r.id), r.featured])).toEqual([[8001, true], [8002, true], [8003, false], [8004, false]]);
  });

  it('lets an editor switch a game on, never overwrites that on the next sync, and only lets members call featured games', async () => {
    await db.as(editor);
    await db.one(`select public.admin_feature_fixture(8003, true)`);
    await db.as(null);
    await db.one(`select public.upsert_fixtures($1::jsonb)`, [JSON.stringify([{ ...fixture(8003, 'Argentina', 'Bolivia', '2026-11-15T23:30:00Z') }])]); // kick-off moved
    expect(await db.one(`select featured from public.fixtures where id = 8003`)).toBe(true);

    await db.at('2026-11-12 10:00');
    await db.as(member);
    await db.one(`select public.save_call(8001, 2, 0)`);
    await fails(db.one(`select public.save_call(8004, 1, 0)`), 'not_found');
  });

  it("won't switch off a game members have already called", async () => {
    await db.as(editor);
    await fails(db.one(`select public.admin_feature_fixture(8001, false)`), 'has_calls');
    const list = await db.one<any[]>(`select public.admin_int_fixtures('2026-11-01', '2026-11-30')`);
    expect(list.find((f) => f.id === 8001)).toMatchObject({ featured: true, calls: 1, home_rank: null });
    expect(list.find((f) => f.id === 8002)).toMatchObject({ home_rank: 4, away_rank: 5 });
  });

  it('sets the crowning time from featured games only', async () => {
    await db.as(null);
    await db.one(`select public.refresh_matchweek_windows()`);
    const ends = await db.one<Date>(`select ends_at from public.matchweeks where label = 'Internationals · Nov 2026'`);
    // Last featured game: Argentina v Bolivia, 23:30 UTC Sunday 15th = 00:30 WAT Monday 16th → crown noon Tuesday 17th.
    // Malta v Andorra (not featured) on the 16th doesn't count.
    expect(new Date(ends).toISOString()).toBe('2026-11-17T11:00:00.000Z');
  });

  it('keeps members out of the editor tools', async () => {
    await db.as(member);
    await fails(db.one(`select public.admin_set_top_nations('{Nigeria}')`), 'not_allowed');
    await fails(db.one(`select public.admin_feature_fixture(8004, true)`), 'not_allowed');
  });
});
