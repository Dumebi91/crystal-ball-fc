-- How to load a day's content until the admin area is built. Run in Supabase → SQL Editor.
-- Change the date and the text; keep the shape.

-- Know Ball: 10 slots. Slots 1-7 are fixed (variant 0). Slots 8-10 are swap slots: give each two variants (1 and 2)
-- of the same difficulty, so members get different questions there. Mix: 3 easy, 3 medium, 2 hard, 2 home colours.
-- 'correct' is the position (0-3) of the right answer in 'options' as written here; members see options shuffled.
with q as (
  insert into public.kb_quizzes (quiz_date, opens_at, closes_at)
  values ('2026-11-07', public.wat_at('2026-11-07', '09:00'), public.wat_at('2026-11-08', '00:00'))
  returning id
)
insert into public.kb_questions (quiz_id, slot, variant, difficulty, prompt, options, correct, fact)
select q.id, x.slot, x.variant, x.difficulty, x.prompt, x.options, x.correct, x.fact from q, (values
  (1, 0, 'easy', 'Which club plays its home games at the Emirates Stadium?',
   array['Arsenal', 'Tottenham Hotspur', 'Chelsea', 'West Ham United'], 0, 'Arsenal moved there from Highbury in 2006.')
  -- , (2, 0, 'easy', ...)  ... through slot 10, with two variants (1 and 2) for slots 8, 9 and 10
) as x(slot, variant, difficulty, prompt, options, correct, fact);

-- Poll of the Day (12pm to midnight)
insert into public.polls (poll_date, question, options, opens_at, closes_at)
values ('2026-11-07', 'Who finishes higher this season?', array['Arsenal', 'Man City', 'Someone else'],
        public.wat_at('2026-11-07', '12:00'), public.wat_at('2026-11-08', '00:00'));

-- A Cold Take (published at 12pm)
insert into public.takes (slug, kind, title, question, body, call_line, published_at)
values ('set-pieces-decide-titles', 'take',
        'Set pieces will decide this title race.',
        'Set pieces decide the title. Agree?',
        '["First paragraph.", "Second paragraph."]',
        'The champions will be the team that wins the most ugly 1-0s from a dead ball.',
        public.wat_at('2026-11-07', '12:00'));
