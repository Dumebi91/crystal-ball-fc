import { beforeAll, describe, expect, it } from 'vitest';
import { makeDb, fails, type Db } from './harness';

let db: Db;
let admin: string, editor: string, steward: string, member: string;

const question = (slot: number, variant = 0, difficulty = 'easy') => ({
  slot, variant, difficulty, prompt: `Question ${slot}.${variant}`, options: ['A', 'B', 'C', 'D'], correct: 2, fact: 'A fact.',
});
const fullQuiz = () => [
  ...[1, 2, 3, 4, 5, 6, 7].map((s) => question(s)),
  ...[8, 9, 10].flatMap((s) => [question(s, 1, 'home'), question(s, 2, 'home')]),
];

beforeAll(async () => {
  db = await makeDb();
  await db.pg.exec(`
    insert into public.seasons values ('2026-27', 'Season 2026/27', '2026-08-01', '2027-06-30');
    insert into public.matchweeks (season_id, label, starts_at, ends_at) values ('2026-27', 'Matchweek 12', '2026-11-03 11:00+00', '2026-11-10 11:00+00');
  `);
  admin = await db.member('the_boss');
  editor = await db.member('content_lead');
  steward = await db.member('steward_one');
  member = await db.member('regular_joe');
  // The first admin is set by hand in the Supabase SQL editor; everyone else through admin_set_role.
  await db.pg.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  await db.as(admin);
  await db.one(`select public.admin_set_role('content_lead', 'editor')`);
  await db.one(`select public.admin_set_role('steward_one', 'steward')`);
});

describe('roles', () => {
  it('keeps members out of every admin function', async () => {
    await db.as(member);
    await fails(db.one(`select public.admin_save_quiz('2026-11-07', $1::jsonb)`, [JSON.stringify(fullQuiz())]), 'not_allowed');
    await fails(db.one(`select public.admin_open_reports()`), 'not_allowed');
    await fails(db.one(`select public.admin_set_role('regular_joe', 'admin')`), 'not_allowed');
    await fails(db.one(`select public.admin_get_quiz('2026-11-07')`), 'not_allowed');
    expect(await db.one(`select public.my_role()`)).toBe('member');
  });

  it('lets editors load content but not moderate or change roles; stewards moderate but not load content', async () => {
    await db.as(editor);
    await fails(db.one(`select public.admin_open_reports()`), 'not_allowed');
    await fails(db.one(`select public.admin_set_role('regular_joe', 'editor')`), 'not_allowed');
    await db.as(steward);
    await fails(db.one(`select public.admin_save_poll('2026-11-07', 'Q?', '{a,b}')`), 'not_allowed');
    expect(await db.one(`select public.admin_open_flags()`)).toEqual([]);
  });

  it("stops an admin changing their own role, so there's always an admin", async () => {
    await db.as(admin);
    await fails(db.one(`select public.admin_set_role('the_boss', 'member')`), 'cannot_change_own_role');
  });
});

describe('loading Know Ball', () => {
  it('saves a full quiz, refuses a quiz with missing slots or a broken question, and can be re-saved until someone plays', async () => {
    await db.as(editor);
    const partial = fullQuiz().filter((q) => q.slot !== 4 && q.slot !== 9);
    await fails(db.one(`select public.admin_save_quiz('2026-11-07', $1::jsonb)`, [JSON.stringify(partial)]), 'missing_slots_4,9');
    const broken = fullQuiz(); broken[2].options = ['A', 'B', '', 'D'];
    await fails(db.one(`select public.admin_save_quiz('2026-11-07', $1::jsonb)`, [JSON.stringify(broken)]), 'bad_question_in_slot_3');

    await db.one(`select public.admin_save_quiz('2026-11-07', $1::jsonb)`, [JSON.stringify(fullQuiz())]);
    const saved = await db.one<any>(`select public.admin_get_quiz('2026-11-07')`);
    expect(saved.questions).toHaveLength(13);
    expect(saved.locked).toBe(false);

    const edited = fullQuiz(); edited[0].prompt = 'A better question 1';
    await db.one(`select public.admin_save_quiz('2026-11-07', $1::jsonb)`, [JSON.stringify(edited)]);
    expect((await db.one<any>(`select public.admin_get_quiz('2026-11-07')`)).questions[0].prompt).toBe('A better question 1');

    // A member plays; the quiz is now locked.
    await db.at('2026-11-07 09:30');
    await db.as(member);
    await db.one(`select public.kb_start()`);
    await db.as(editor);
    await fails(db.one(`select public.admin_save_quiz('2026-11-07', $1::jsonb)`, [JSON.stringify(fullQuiz())]), 'quiz_locked');
    expect(await db.one<any>(`select public.admin_get_quiz('2026-11-07')`)).toMatchObject({ locked: true, players: 1 });
  });

  it('sets a 5-minute window for a prize quiz', async () => {
    await db.as(editor);
    await db.one(`select public.admin_save_quiz('2026-11-08', $1::jsonb, true, '18:00')`, [JSON.stringify(fullQuiz())]);
    const q = await db.rows<any>(`select prize_opens_at, prize_closes_at from public.kb_quizzes where quiz_date = '2026-11-08'`);
    expect(new Date(q[0].prize_opens_at).toISOString()).toBe('2026-11-08T17:00:00.000Z');
    expect(new Date(q[0].prize_closes_at).toISOString()).toBe('2026-11-08T17:05:00.000Z');
  });
});

describe('polls, takes and the content calendar', () => {
  it('saves polls and takes and shows what is loaded for each day', async () => {
    await db.as(editor);
    await db.one(`select public.admin_save_poll('2026-11-07', 'Who finishes higher?', '{Arsenal,"Man City","Someone else"}')`);
    await fails(db.one(`select public.admin_save_poll('2026-11-09', 'Only one option?', '{Yes}')`), 'bad_poll');
    const tid = await db.one<number>(
      `select public.admin_save_take(null, 'set-pieces', 'take', 'Set pieces decide titles', 'Agree?', '["One.","Two."]'::jsonb, 'The call.', null, '2026-11-07 11:00+00')`);
    await db.one(`select public.admin_save_take($1, 'set-pieces', 'take', 'Set pieces decide title races', 'Agree?', '["One."]'::jsonb, null, null, '2026-11-07 11:00+00')`, [tid]);
    await db.one(`select public.admin_save_take(null, 'draft-take', 'take', 'A draft', 'Agree?', '[]'::jsonb, null, null, null)`);
    const takes = await db.one<any[]>(`select public.admin_list_takes()`);
    expect(takes.map((t) => t.title)).toEqual(['A draft', 'Set pieces decide title races']);

    const cal = await db.one<any[]>(`select public.admin_content_calendar('2026-11-07', 3)`);
    expect(cal).toEqual([
      { date: '2026-11-07', quiz_slots: 10, quiz_prize: false, poll: true, takes: 1 },
      { date: '2026-11-08', quiz_slots: 10, quiz_prize: true, poll: false, takes: 0 },
      { date: '2026-11-09', quiz_slots: 0, quiz_prize: null, poll: false, takes: 0 },
    ]);
  });

  it('locks a poll once people have voted', async () => {
    await db.at('2026-11-07 12:30');
    await db.as(member);
    const pid = await db.one<number>(`select id from public.polls where poll_date = '2026-11-07'`);
    await db.one(`select public.vote_poll($1, 0)`, [pid]);
    await db.as(editor);
    await fails(db.one(`select public.admin_save_poll('2026-11-07', 'Changed', '{a,b}')`), 'poll_locked');
  });
});

describe('moderation and fair play', () => {
  it('shows stewards the reported replies and lets them keep or remove each one', async () => {
    await db.at('2026-11-07 13:00');
    const tid = await db.one<number>(`select id from public.takes where slug = 'set-pieces'`);
    await db.as(member);
    const keep = await db.one<number>(`select public.post_reply($1, 'Fair point, but strikers win titles.')`, [tid]);
    await db.tick(31000);
    const bad = await db.one<number>(`select public.post_reply($1, 'Something abusive')`, [tid]);
    await db.as(admin);
    await db.one(`select public.report_reply($1, 'disagree')`, [keep]);
    await db.one(`select public.report_reply($1, 'abuse')`, [bad]);

    await db.as(steward);
    const open = await db.one<any[]>(`select public.admin_open_reports()`);
    expect(open.map((r) => r.body).sort()).toEqual(['Fair point, but strikers win titles.', 'Something abusive']);
    await db.one(`select public.review_report($1, true)`, [keep]);
    await db.one(`select public.review_report($1, false)`, [bad]);
    expect(await db.one(`select public.admin_open_reports()`)).toEqual([]);
    const after = await db.rows<any>(`select id, hidden, deleted_at is not null as gone from public.replies order by id`);
    expect(after.map((r) => [r.hidden, r.gone])).toEqual([[false, false], [true, true]]);
  });

  it('lets a steward clear or action a fair-play flag, with a note, once', async () => {
    await db.pg.query(`insert into public.fair_play_flags (user_id, kind, ref) values ($1, 'kb_too_fast', 'x')`, [member]);
    await db.as(steward);
    const [flag] = await db.one<any[]>(`select public.admin_open_flags()`);
    expect(flag).toMatchObject({ handle: 'regular_joe', kind: 'kb_too_fast' });
    await db.one(`select public.admin_review_flag($1, 'cleared', 'Fast reader, answers look genuine')`, [flag.id]);
    await fails(db.one(`select public.admin_review_flag($1, 'actioned', 'again')`, [flag.id]), 'not_found');
    expect(await db.one(`select public.admin_open_flags()`)).toEqual([]);
  });
});

describe('point corrections and the log', () => {
  it('needs a reason, posts the correction to the current matchweek and records who did it', async () => {
    await db.at('2026-11-07 14:00');
    await db.as(admin);
    await fails(db.one(`select public.admin_adjust_points('regular_joe', -5, '')`), 'reason_required');
    await db.one(`select public.admin_adjust_points('regular_joe', -5, 'Shared prize quiz answers')`);
    const row = await db.rows<any>(`select points, matchweek_id, detail from public.points_ledger where source = 'adjust'`);
    expect(row).toEqual([{ points: -5, matchweek_id: 1, detail: { reason: 'Shared prize quiz answers' } }]);
    const log = await db.one<any[]>(`select public.admin_recent_log(100)`);
    expect(log[0]).toMatchObject({ who: 'the_boss', action: 'adjust_points' });
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(['set_role', 'save_quiz', 'save_poll', 'save_take', 'review_report', 'review_flag']));
    await db.as(editor);
    await fails(db.one(`select public.admin_recent_log(10)`), 'not_allowed');
  });
});
