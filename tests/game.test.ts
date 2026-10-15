import { beforeAll, describe, expect, it } from 'vitest';
import { makeDb, fails, type Db } from './harness';

let db: Db;

// Launch weekend: matchweek 12 runs until noon on Tuesday 10 November (the day after Monday's last game).
async function seedCalendar() {
  await db.pg.exec(`
    insert into public.seasons values ('2026-27', 'Season 2026/27', '2026-08-01', '2027-06-30');
    insert into public.matchweeks (season_id, label, starts_at, ends_at, crowned_at)
      values ('2026-27', 'Matchweek 11', '2026-10-30 11:00+00', '2026-11-03 11:00+00', '2026-11-03 11:00+00'),
             ('2026-27', 'Matchweek 12', '2026-11-03 11:00+00', '2026-11-10 11:00+00', null);
  `);
}

// A quiz with 7 fixed slots and 3 swap slots (two versions each). The right answer is never option 0,
// so a member's shuffled options can be checked against the stored order.
async function seedQuiz(date: string, opts: { prize?: boolean } = {}) {
  const quizId = await db.one<number>(
    `insert into public.kb_quizzes (quiz_date, opens_at, closes_at, is_prize, prize_opens_at, prize_closes_at)
     values ($1::date, public.wat_at($1::date, '09:00'), public.wat_at($1::date + 1, '00:00'), $2,
             case when $2 then public.wat_at($1::date, '09:00') end, case when $2 then public.wat_at($1::date, '09:05') end)
     returning id`,
    [date, !!opts.prize],
  );
  for (let slot = 1; slot <= 10; slot++) {
    const variants = slot >= 8 ? [1, 2] : [0];
    for (const v of variants) {
      await db.pg.query(
        `insert into public.kb_questions (quiz_id, slot, variant, difficulty, prompt, options, correct, fact)
         values ($1, $2, $3, $4, $5, $6, $7, 'fact')`,
        [quizId, slot, v, slot <= 3 ? 'easy' : slot <= 6 ? 'medium' : slot <= 8 ? 'hard' : 'home',
         `Q${slot}v${v}`, [`A${slot}`, `B${slot}`, `C${slot}`, `D${slot}`], 1 + (slot % 3)],
      );
    }
  }
  return quizId;
}

// Which displayed option is right, worked out from the stored question.
async function rightChoice(q: { prompt: string; options: string[] }) {
  const stored = await db.rows<{ options: string[]; correct: number }>(
    `select options, correct from public.kb_questions where prompt = $1`, [q.prompt]);
  return q.options.indexOf(stored[0].options[stored[0].correct]);
}

async function play(attempt: string, pattern: (i: number) => 'right' | 'wrong', msPerAnswer = 3000) {
  let last: any;
  for (let i = 0; i < 10; i++) {
    const q = await db.one<any>(`select public.kb_question($1)`, [attempt]);
    if (q.status === 'done') return q;
    await db.tick(msPerAnswer);
    const right = await rightChoice(q);
    const choice = pattern(i) === 'right' ? right : (right + 1) % 4;
    last = await db.one<any>(`select public.kb_answer($1, $2)`, [attempt, choice]);
    await db.tick(1500); // reading the result: the clock is stopped here
  }
  return last.result;
}

beforeAll(async () => {
  db = await makeDb();
  await seedCalendar();
});

describe('joining', () => {
  it('only lets adults join, with a clean unique handle, and numbers the Founding Oracles', async () => {
    const id = crypto.randomUUID();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [id]);
    await db.as(id);
    await fails(db.one(`select public.create_profile('teen_fan', 'Lagos', null, false)`), 'must_be_18');
    await fails(db.one(`select public.create_profile('Bad Handle!', 'Lagos', null, true)`), 'bad_handle');
    const p = await db.one<any>(`select public.create_profile('First_Oracle', 'Lagos', 'Chelsea', true)`);
    expect(p).toEqual({ handle: 'first_oracle', founding_number: 1 });
    const other = crypto.randomUUID();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [other]);
    await db.as(other);
    await fails(db.one(`select public.create_profile('first_oracle', 'Abuja', null, true)`), 'handle_taken');
  });

  it('starts every member with reminders off', async () => {
    const id = await db.member('quiet_fan');
    const r = await db.one<any>(`select reminders from public.profiles where id = $1`, [id]);
    expect(r).toEqual({ kb: false, ten: false, call: false, wa: false });
  });
});

describe('Know Ball', () => {
  let quiz: number;
  beforeAll(async () => { quiz = await seedQuiz('2026-11-07'); });

  it('is closed before 9am', async () => {
    await db.as(await db.member('early_bird'));
    await db.at('2026-11-07 08:59');
    await fails(db.one(`select public.kb_start()`), 'kb_closed');
  });

  it('gives each member 10 questions, their own order, their own options, and one go', async () => {
    await db.at('2026-11-07 09:30');
    const plans: any[] = [];
    for (const h of ['order_a', 'order_b', 'order_c', 'order_d', 'order_e', 'order_f']) {
      await db.as(await db.member(h));
      const a = await db.one<string>(`select public.kb_start()`);
      expect(await db.one<string>(`select public.kb_start()`)).toBe(a); // no fresh start
      plans.push(await db.one(`select plan from public.kb_attempts where id = $1`, [a]));
    }
    for (const p of plans) {
      expect(p).toHaveLength(10);
      const slots = await db.rows(`select distinct slot from public.kb_questions where id = any($1::int[])`, [p.map((x: any) => x.q)]);
      expect(slots).toHaveLength(10);
    }
    const orders = new Set(plans.map((p) => p.map((x: any) => x.q).join(',')));
    expect(orders.size).toBeGreaterThan(1);
    const swapSets = new Set(plans.map((p) => p.map((x: any) => x.q).sort().join(',')));
    expect(swapSets.size).toBeGreaterThan(1); // some members got different swap questions
  });

  it('never lets a member read the questions table', async () => {
    await db.as(await db.member('peeker'));
    await fails(db.asRole('authenticated', `select * from public.kb_questions`), 'permission denied');
    await fails(db.asRole('authenticated', `select salt from public.kb_quizzes`), 'permission denied');
  });

  it('scores 1 a right answer, adds 5 for 10/10, and posts the points to this matchweek', async () => {
    await db.at('2026-11-07 10:00');
    const uid = await db.member('perfect_ten');
    await db.as(uid);
    const a = await db.one<string>(`select public.kb_start()`);
    const result = await play(a, () => 'right');
    expect(result).toMatchObject({ status: 'done', score: 10, points: 15, timed_out: false });
    expect(result.used_ms).toBe(30000); // 10 x 3s; the 1.5s reading pauses don't count
    const row = await db.rows(`select points, matchweek_id, detail from public.points_ledger where user_id = $1`, [uid]);
    expect(row).toEqual([{ points: 15, matchweek_id: 2, detail: { right: 10, ms: 30000 } }]);
    // Playing again changes nothing.
    expect(await db.one<string>(`select public.kb_start()`)).toBe(a);
    expect(await db.one<any>(`select public.kb_question($1)`, [a])).toMatchObject({ status: 'done', score: 10 });
  });

  it('keeps the clock running if the member reloads the page', async () => {
    await db.at('2026-11-07 11:00');
    await db.as(await db.member('reloader'));
    const a = await db.one<string>(`select public.kb_start()`);
    const first = await db.one<any>(`select public.kb_question($1)`, [a]);
    expect(first.remaining_ms).toBe(60000);
    await db.tick(20000);
    const again = await db.one<any>(`select public.kb_question($1)`, [a]);
    expect(again.prompt).toBe(first.prompt);
    expect(again.remaining_ms).toBe(40000);
  });

  it('ends the quiz when the 60 seconds run out, keeping the right answers so far', async () => {
    await db.at('2026-11-07 12:00');
    const uid = await db.member('slowcoach');
    await db.as(uid);
    const a = await db.one<string>(`select public.kb_start()`);
    // Two right answers at 25s each, then a third question left on screen too long.
    for (let i = 0; i < 2; i++) {
      const q = await db.one<any>(`select public.kb_question($1)`, [a]);
      await db.tick(25000);
      await db.one(`select public.kb_answer($1, $2)`, [a, await rightChoice(q)]);
    }
    const q3 = await db.one<any>(`select public.kb_question($1)`, [a]);
    await db.tick(11600); // 50s + 11.6s = 61.6s, past the 1.5s grace
    const r = await db.one<any>(`select public.kb_answer($1, $2)`, [a, await rightChoice(q3)]);
    expect(r).toMatchObject({ status: 'done', score: 2, timed_out: true, used_ms: 60000 });
    expect(await db.one(`select points from public.points_ledger where user_id = $1`, [uid])).toBe(2);
  });

  it('does not serve another question once the clock has hit 60 seconds', async () => {
    await db.at('2026-11-07 12:30');
    await db.as(await db.member('last_gasp'));
    const a = await db.one<string>(`select public.kb_start()`);
    const q = await db.one<any>(`select public.kb_question($1)`, [a]);
    await db.tick(61000); // inside the grace: this answer counts
    await db.one(`select public.kb_answer($1, $2)`, [a, await rightChoice(q)]);
    const next = await db.one<any>(`select public.kb_question($1)`, [a]);
    expect(next).toMatchObject({ status: 'done', score: 1, timed_out: true });
  });

  it('flags impossibly fast answers for a person to review, without changing the score', async () => {
    await db.at('2026-11-07 13:00');
    const uid = await db.member('speedy');
    await db.as(uid);
    const a = await db.one<string>(`select public.kb_start()`);
    const result = await play(a, () => 'right', 200);
    expect(result).toMatchObject({ score: 10, points: 15 });
    const flags = await db.rows(`select kind from public.fair_play_flags where user_id = $1`, [uid]);
    expect(flags.filter((f: any) => f.kind === 'kb_too_fast')).toHaveLength(10);
    expect(flags.some((f: any) => f.kind === 'kb_perfect_fast')).toBe(true);
  });

  it('only opens a prize quiz inside its 5-minute window', async () => {
    await seedQuiz('2026-11-08', { prize: true });
    await db.as(await db.member('late_for_prize'));
    await db.at('2026-11-08 09:06');
    await fails(db.one(`select public.kb_start()`), 'kb_prize_window_closed');
    await db.as(await db.member('on_time'));
    await db.at('2026-11-08 09:02');
    expect(await db.one<string>(`select public.kb_start()`)).toBeTruthy();
  });
});

describe('Call It', () => {
  const ARS_CHE = 9001, VIL_BHA = 9002, EVE_MUN = 9003;
  let tolu: string, seer: string, chi: string;

  beforeAll(async () => {
    await db.pg.exec(`
      insert into public.fixtures (id, competition, matchweek_id, home, away, kickoff_at) values
        (${ARS_CHE}, 'PL', 2, 'Arsenal', 'Chelsea', '2026-11-07 12:30+00'),
        (${VIL_BHA}, 'PL', 2, 'Aston Villa', 'Brighton', '2026-11-07 17:30+00'),
        (${EVE_MUN}, 'PL', 2, 'Everton', 'Man United', '2026-11-08 14:00+00');
    `);
    tolu = await db.member('pitchside_tolu');
    seer = await db.member('abuja_seer', 'Abuja');
    chi = await db.member('coldtake_chi');
  });

  it('accepts and changes calls until kick-off, then locks them', async () => {
    await db.at('2026-11-07 12:00');
    await db.as(tolu);
    await db.one(`select public.save_call(${ARS_CHE}, 1, 0)`);
    await db.one(`select public.save_call(${ARS_CHE}, 2, 1)`); // changed mind
    await db.as(seer);
    await db.one(`select public.save_call(${ARS_CHE}, 1, 0)`);
    await db.as(chi);
    await db.one(`select public.save_call(${ARS_CHE}, 0, 2)`);
    await db.at('2026-11-07 13:30'); // kick-off
    await fails(db.one(`select public.save_call(${ARS_CHE}, 3, 0)`), 'call_locked');
  });

  it('only shows the crowd split after your own call', async () => {
    await db.at('2026-11-07 15:00');
    await db.as(chi);
    expect(await db.one(`select public.crowd_split(${VIL_BHA})`)).toBeNull();
    await db.one(`select public.save_call(${VIL_BHA}, 1, 0)`);
    expect(await db.one<any>(`select public.crowd_split(${VIL_BHA})`)).toMatchObject({ calls: 1, home: 100 });
  });

  it('scores 10 for the exact score, 3 for the right result, 0 otherwise, and re-scores a corrected result', async () => {
    await db.pg.exec(`update public.fixtures set status = 'FT', home_goals = 2, away_goals = 1, updated_at = public.app_now() + interval '1 second' where id = ${ARS_CHE}`);
    await db.one(`select public.score_pending()`);
    const pts = async (u: string) =>
      db.one<number>(`select points from public.points_ledger where user_id = $1 and source = 'call' and source_ref = '${ARS_CHE}'`, [u]);
    expect(await pts(tolu)).toBe(10);
    expect(await pts(seer)).toBe(3);
    expect(await pts(chi)).toBe(0);
    // The data provider corrects the result to 1-0.
    await db.pg.exec(`update public.fixtures set home_goals = 1, away_goals = 0, updated_at = public.app_now() + interval '1 second' where id = ${ARS_CHE}`);
    await db.one(`select public.score_pending()`);
    expect(await pts(tolu)).toBe(3);
    expect(await pts(seer)).toBe(10);
  });

  it('voids calls on a postponed game', async () => {
    await db.as(seer);
    await db.at('2026-11-08 10:00');
    await db.one(`select public.save_call(${EVE_MUN}, 1, 1)`);
    await db.pg.exec(`update public.fixtures set status = 'PST', updated_at = public.app_now() + interval '1 second' where id = ${EVE_MUN}`);
    await db.one(`select public.score_pending()`);
    expect(await db.rows(`select * from public.points_ledger where source_ref = '${EVE_MUN}'`)).toHaveLength(0);
  });
});

describe('the weekly crown', () => {
  it('ends a matchweek at noon WAT the day after its last game', async () => {
    await db.pg.exec(`
      insert into public.matchweeks (season_id, label, starts_at, ends_at)
        values ('2026-27', 'Matchweek 13', '2026-11-10 11:00+00', '2026-11-30 11:00+00');
      insert into public.fixtures (id, competition, matchweek_id, home, away, kickoff_at)
        values (9101, 'PL', 3, 'Chelsea', 'Fulham', '2026-11-23 20:00+00');
    `);
    await db.one(`select public.refresh_matchweek_windows()`);
    const ends = await db.one<Date>(`select ends_at from public.matchweeks where id = 3`);
    expect(new Date(ends).toISOString()).toBe('2026-11-24T11:00:00.000Z'); // Tuesday 12:00 WAT
  });

  it('crowns the top scorer once the matchweek is over, with exact scores breaking a tie', async () => {
    await db.at('2026-11-09 23:00');
    expect(await db.one(`select public.crown_due()`)).toBe(0); // too early
    // Close matchweek 12: the Villa game finishes; Everton v United stays postponed.
    await db.pg.exec(`update public.fixtures set status = 'FT', home_goals = 1, away_goals = 0, updated_at = public.app_now() + interval '1 second' where id = 9002`);
    await db.one(`select public.score_pending()`);
    await db.at('2026-11-10 12:00');
    expect(await db.one(`select public.crown_due()`)).toBeGreaterThan(0);
    const crown = await db.rows<any>(
      `select p.handle, o.points from public.oracle_of_week o join public.profiles p on p.id = o.user_id where o.matchweek_id = 2`);
    // perfect_ten and speedy both have 15 Know Ball points; speedy was faster. coldtake_chi has 10 from the Villa call.
    expect(crown).toEqual([{ handle: 'speedy', points: 15 }]);
  });
});

describe('leagues', () => {
  it('lets a member start a league, invite by code and see the table; strangers see only the invite', async () => {
    await db.at('2026-11-07 18:00');
    const owner = await db.member('office_boss');
    const mate = await db.member('desk_mate');
    const stranger = await db.member('stranger');
    await db.as(owner);
    const { id, invite_code } = await db.one<any>(`select public.create_league('Office Ballers', 'Office')`);
    expect(invite_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    await db.as(mate);
    expect(await db.one(`select public.join_league($1)`, [invite_code.toLowerCase()])).toBe(id);
    const table = await db.rows(`select handle from public.league_table($1)`, [id]);
    expect(table.map((r: any) => r.handle).sort()).toEqual(['desk_mate', 'office_boss']);
    await db.as(stranger);
    await fails(db.one(`select public.league_table($1)`, [id]), 'not_allowed');
    expect(await db.one<any>(`select public.league_by_code($1)`, [invite_code])).toMatchObject({ name: 'Office Ballers', members: 2 });
    await db.as(owner);
    await db.one(`select public.remove_league_member($1, $2)`, [id, mate]);
    expect(await db.rows(`select 1 from public.league_members where league_id = $1`, [id])).toHaveLength(1);
  });
});

describe('Cold Takes and the Dressing Room', () => {
  it('takes one vote, enforces slow mode, and hides a reported reply from everyone but its author', async () => {
    await db.at('2026-11-07 12:00');
    const takeId = await db.one<number>(
      `insert into public.takes (slug, title, question, published_at) values ('set-pieces', 'Set pieces decide titles', 'Agree?', '2026-11-07 11:00+00') returning id`);
    const author = await db.member('take_author');
    const reader = await db.member('take_reader');
    await db.as(author);
    expect(await db.one<any>(`select public.vote_take($1, 'agree')`, [takeId])).toMatchObject({ votes: 1, agree: 100 });
    await fails(db.one(`select public.vote_take($1, 'disagree')`, [takeId]), 'duplicate key');
    const reply = await db.one<number>(`select public.post_reply($1, 'Corners win titles.')`, [takeId]);
    await fails(db.one(`select public.post_reply($1, 'And another thing')`, [takeId]), 'slow_mode');
    await db.tick(31000);
    await db.one(`select public.post_reply($1, 'And another thing')`, [takeId]);
    await fails(db.one(`select public.post_reply($1, $2)`, [takeId, 'x'.repeat(281)]), 'reply_too_long');

    await db.as(reader);
    await db.one(`select public.report_reply($1, 'abuse')`, [reply]);
    const seenByReader = await db.asRole('authenticated', `select id from public.replies where take_id = $1`, [takeId]);
    expect(seenByReader.map((r: any) => Number(r.id))).not.toContain(Number(reply));
    await db.as(author);
    const seenByAuthor = await db.asRole('authenticated', `select id from public.replies where take_id = $1`, [takeId]);
    expect(seenByAuthor.map((r: any) => Number(r.id))).toContain(Number(reply));
    await fails(db.one(`select public.review_report($1, true)`, [reply]), 'not_allowed'); // members can't review
  });
});

describe('Poll of the Day', () => {
  it('gives 1 point for one vote and shows the split afterwards', async () => {
    await db.at('2026-11-07 12:30');
    const pollId = await db.one<number>(
      `insert into public.polls (poll_date, question, options, opens_at, closes_at)
       values ('2026-11-07', 'Who finishes higher?', '{Arsenal,Man City,Someone else}', public.wat_at('2026-11-07', '12:00'), public.wat_at('2026-11-08', '00:00')) returning id`);
    const uid = await db.member('poll_voter');
    await db.as(uid);
    expect(await db.one(`select public.poll_split($1)`, [pollId])).toBeNull();
    expect(await db.one<any>(`select public.vote_poll($1, 0)`, [pollId])).toEqual({ votes: 1, split: [100, 0, 0] });
    await fails(db.one(`select public.vote_poll($1, 1)`, [pollId]), 'duplicate key');
    expect(await db.one(`select sum(points)::int from public.points_ledger where user_id = $1`, [uid])).toBe(1);
  });
});

describe('your data', () => {
  it('exports a member’s data and deletes the account, keeping points with no name attached', async () => {
    const uid = await db.member('leaving_soon');
    await db.as(uid);
    const pollId = await db.one<number>(`select id from public.polls limit 1`);
    await db.one(`select public.vote_poll($1, 1)`, [pollId]);
    const data = await db.one<any>(`select public.export_my_data()`);
    expect(data.profile.handle).toBe('leaving_soon');
    expect(data.poll_votes).toHaveLength(1);
    await db.one(`select public.delete_my_account()`);
    expect(await db.rows(`select 1 from public.profiles where id = $1`, [uid])).toHaveLength(0);
    expect(await db.rows(`select 1 from public.poll_votes where user_id = $1`, [uid])).toHaveLength(0);
    expect(await db.rows(`select 1 from public.points_ledger where user_id is null and source = 'poll'`)).toHaveLength(1);
  });
});

describe('fixture sync', () => {
  it('creates matchweeks, writes only real changes, and a corrected result gets re-scored', async () => {
    const batch = (h: number | null, a: number | null, status: string) => JSON.stringify([{
      id: 7001, competition: 'PL', season_id: '2026-27', matchweek: 'Matchweek 14', home: 'Brentford', away: 'Spurs',
      kickoff_at: '2026-12-05T15:00:00Z', status, home_goals: h, away_goals: a }]);
    expect(await db.one(`select public.upsert_fixtures($1::jsonb)`, [batch(null, null, 'NS')])).toBe(1);
    expect(await db.one(`select public.upsert_fixtures($1::jsonb)`, [batch(null, null, 'NS')])).toBe(0); // nothing changed
    expect(await db.one(`select count(*)::int from public.matchweeks where label = 'Matchweek 14'`)).toBe(1);

    const uid = await db.member('sync_tester');
    await db.as(uid);
    await db.at('2026-12-05 10:00');
    await db.one(`select public.save_call(7001, 2, 0)`);
    await db.at('2026-12-05 18:00');
    await db.one(`select public.upsert_fixtures($1::jsonb)`, [batch(2, 0, 'FT')]);
    await db.one(`select public.score_pending()`);
    expect(await db.one(`select points from public.points_ledger where user_id = $1`, [uid])).toBe(10);
    await db.tick(60000);
    await db.one(`select public.upsert_fixtures($1::jsonb)`, [batch(2, 1, 'FT')]); // provider corrects the score
    expect(await db.one(`select public.score_pending()`)).toBe(1);
    expect(await db.one(`select points from public.points_ledger where user_id = $1`, [uid])).toBe(3);
  });
});
