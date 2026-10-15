-- Crystal Ball FC: the admin area.
-- Roles: member (everyone), steward (moderates replies, reviews fair-play flags),
-- editor (loads quizzes, polls and takes), admin (everything, plus roles and point corrections).
-- Every admin action is written to admin_log, so prize decisions can be explained later.

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('member', 'steward', 'editor', 'admin'));

create table public.admin_log (
  id      bigserial primary key,
  actor   uuid references public.profiles (id) on delete set null,
  action  text not null,
  detail  jsonb not null default '{}',
  at      timestamptz not null default public.app_now()
);
alter table public.admin_log enable row level security;   -- no policies: read only through admin_recent_log()

create or replace function public.require_role(p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not exists (select 1 from profiles where id = uid and role = any (p_roles)) then
    raise exception 'not_allowed';
  end if;
  return uid;
end $$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid()), 'none')
$$;

create or replace function public.log_admin(p_actor uuid, p_action text, p_detail jsonb) returns void
language sql security definer set search_path = public as $$
  insert into admin_log (actor, action, detail) values (p_actor, p_action, p_detail)
$$;

---------------------------------------------------------------------------
-- Content: Know Ball
---------------------------------------------------------------------------
-- p_questions: [{ slot 1-10, variant 0 for fixed or 1/2 for swap slots, difficulty, prompt, options[4], correct 0-3, fact }]
-- Questions lock once anyone has started that day's quiz.
create or replace function public.admin_save_quiz(p_date date, p_questions jsonb, p_is_prize boolean default false,
                                                  p_prize_start time default '09:00') returns int
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_role(array['editor', 'admin']);
  qid int;
  q jsonb;
  missing int[];
begin
  if jsonb_typeof(p_questions) <> 'array' then raise exception 'bad_questions'; end if;
  for q in select * from jsonb_array_elements(p_questions) loop
    if (q ->> 'slot')::int not between 1 and 10
       or coalesce(trim(q ->> 'prompt'), '') = ''
       or jsonb_array_length(q -> 'options') <> 4
       or exists (select 1 from jsonb_array_elements_text(q -> 'options') o where trim(o) = '')
       or (q ->> 'correct')::int not between 0 and 3
       or (q ->> 'difficulty') not in ('easy', 'medium', 'hard', 'home') then
      raise exception 'bad_question_in_slot_%', coalesce(q ->> 'slot', '?');
    end if;
  end loop;
  select array_agg(s) into missing from generate_series(1, 10) s
   where not exists (select 1 from jsonb_array_elements(p_questions) x where (x ->> 'slot')::int = s);
  if missing is not null then raise exception 'missing_slots_%', array_to_string(missing, ','); end if;

  select id into qid from kb_quizzes where quiz_date = p_date;
  if found and exists (select 1 from kb_attempts where quiz_id = qid) then raise exception 'quiz_locked'; end if;

  if qid is null then
    insert into kb_quizzes (quiz_date, opens_at, closes_at) values (p_date, wat_at(p_date, '09:00'), wat_at(p_date + 1, '00:00'))
    returning id into qid;
  end if;
  update kb_quizzes
     set is_prize = p_is_prize,
         prize_opens_at = case when p_is_prize then wat_at(p_date, p_prize_start) end,
         prize_closes_at = case when p_is_prize then wat_at(p_date, p_prize_start) + interval '5 minutes' end,
         opens_at = case when p_is_prize then least(wat_at(p_date, '09:00'), wat_at(p_date, p_prize_start)) else wat_at(p_date, '09:00') end
   where id = qid;

  delete from kb_questions where quiz_id = qid;
  insert into kb_questions (quiz_id, slot, variant, difficulty, prompt, options, correct, fact)
  select qid, (x ->> 'slot')::int, coalesce((x ->> 'variant')::int, 0), x ->> 'difficulty', trim(x ->> 'prompt'),
         array(select trim(o) from jsonb_array_elements_text(x -> 'options') o), (x ->> 'correct')::int, coalesce(trim(x ->> 'fact'), '')
    from jsonb_array_elements(p_questions) x;

  perform log_admin(uid, 'save_quiz', jsonb_build_object('date', p_date, 'questions', jsonb_array_length(p_questions), 'prize', p_is_prize));
  return qid;
end $$;

create or replace function public.admin_get_quiz(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q kb_quizzes;
begin
  perform require_role(array['editor', 'admin']);
  select * into q from kb_quizzes where quiz_date = p_date;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', q.id, 'date', q.quiz_date, 'is_prize', q.is_prize,
    'prize_start', to_char(q.prize_opens_at at time zone 'Africa/Lagos', 'HH24:MI'),
    'locked', exists (select 1 from kb_attempts where quiz_id = q.id),
    'players', (select count(*) from kb_attempts where quiz_id = q.id),
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('slot', slot, 'variant', variant, 'difficulty', difficulty,
                    'prompt', prompt, 'options', to_jsonb(options), 'correct', correct, 'fact', fact) order by slot, variant), '[]')
                  from kb_questions where quiz_id = q.id));
end $$;

---------------------------------------------------------------------------
-- Content: polls and takes
---------------------------------------------------------------------------
create or replace function public.admin_save_poll(p_date date, p_question text, p_options text[]) returns int
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_role(array['editor', 'admin']);
  pid int;
begin
  if coalesce(trim(p_question), '') = '' or array_length(p_options, 1) not between 2 and 4
     or exists (select 1 from unnest(p_options) o where trim(o) = '') then
    raise exception 'bad_poll';
  end if;
  select id into pid from polls where poll_date = p_date;
  if found and exists (select 1 from poll_votes where poll_id = pid) then raise exception 'poll_locked'; end if;
  insert into polls (poll_date, question, options, opens_at, closes_at)
  values (p_date, trim(p_question), p_options, wat_at(p_date, '12:00'), wat_at(p_date + 1, '00:00'))
  on conflict (poll_date) do update set question = excluded.question, options = excluded.options
  returning id into pid;
  perform log_admin(uid, 'save_poll', jsonb_build_object('date', p_date));
  return pid;
end $$;

create or replace function public.admin_save_take(p_id int, p_slug text, p_kind text, p_title text, p_question text,
                                                  p_body jsonb, p_call_line text, p_video jsonb, p_published_at timestamptz) returns int
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_role(array['editor', 'admin']);
  tid int;
begin
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_question), '') = '' then raise exception 'bad_take'; end if;
  if p_slug !~ '^[a-z0-9-]{3,80}$' then raise exception 'bad_slug'; end if;
  if p_id is null then
    insert into takes (slug, kind, title, question, body, call_line, video, published_at)
    values (p_slug, coalesce(p_kind, 'take'), trim(p_title), trim(p_question), coalesce(p_body, '[]'), p_call_line, p_video, p_published_at)
    returning id into tid;
  else
    update takes set slug = p_slug, kind = coalesce(p_kind, 'take'), title = trim(p_title), question = trim(p_question),
                     body = coalesce(p_body, '[]'), call_line = p_call_line, video = p_video, published_at = p_published_at
     where id = p_id returning id into tid;
    if tid is null then raise exception 'not_found'; end if;
  end if;
  perform log_admin(uid, 'save_take', jsonb_build_object('id', tid, 'slug', p_slug, 'published_at', p_published_at));
  return tid;
end $$;

create or replace function public.admin_list_takes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['editor', 'admin']);
  return (select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object(
            'votes', (select count(*) from take_votes v where v.take_id = t.id),
            'replies', (select count(*) from replies r where r.take_id = t.id and r.deleted_at is null))
          order by t.published_at desc nulls first, t.id desc), '[]') from takes t);
end $$;

-- What's loaded for each of the next few days, so gaps show up before they bite.
create or replace function public.admin_content_calendar(p_from date, p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['editor', 'admin']);
  return (select jsonb_agg(jsonb_build_object(
      'date', d::date,
      'quiz_slots', (select count(distinct slot) from kb_questions k join kb_quizzes z on z.id = k.quiz_id where z.quiz_date = d::date),
      'quiz_prize', (select is_prize from kb_quizzes where quiz_date = d::date),
      'poll', exists (select 1 from polls where poll_date = d::date),
      'takes', (select count(*) from takes where wat_date(published_at) = d::date)
    ) order by d)
    from generate_series(p_from, p_from + (p_days - 1), interval '1 day') d);
end $$;

---------------------------------------------------------------------------
-- Moderation and fair play
---------------------------------------------------------------------------
create or replace function public.admin_open_reports() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['steward', 'admin']);
  return (select coalesce(jsonb_agg(x order by x.first_report), '[]') from (
    select r.id as reply_id, r.body, p.handle as author, t.title as take, r.created_at,
           count(rep.*) as reports, min(rep.created_at) as first_report,
           array_remove(array_agg(distinct rep.reason), null) as reasons
      from replies r
      join reports rep on rep.reply_id = r.id and rep.resolved_at is null
      join profiles p on p.id = r.user_id
      join takes t on t.id = r.take_id
     where r.deleted_at is null
     group by r.id, p.handle, t.title) x);
end $$;

-- Replaces the members' version: stewards and admins only, and logged.
create or replace function public.review_report(p_reply bigint, p_keep boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_role(array['steward', 'admin']);
begin
  if p_keep then
    update replies set hidden = false where id = p_reply;
  else
    update replies set hidden = true, deleted_at = app_now() where id = p_reply;
  end if;
  update reports set resolved_at = app_now(), resolved_by = uid, outcome = case when p_keep then 'kept' else 'removed' end
   where reply_id = p_reply and resolved_at is null;
  perform log_admin(uid, 'review_report', jsonb_build_object('reply', p_reply, 'kept', p_keep));
end $$;

create or replace function public.admin_open_flags() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['steward', 'admin']);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'handle', p.handle, 'kind', f.kind, 'ref', f.ref,
            'detail', f.detail, 'created_at', f.created_at) order by f.created_at), '[]')
            from fair_play_flags f left join profiles p on p.id = f.user_id where f.reviewed_at is null);
end $$;

-- A person decides what a flag means. Actioning a flag records the decision;
-- removing points is a separate, logged point correction (admin_adjust_points).
create or replace function public.admin_review_flag(p_flag bigint, p_outcome text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := require_role(array['steward', 'admin']);
begin
  if p_outcome not in ('cleared', 'actioned') then raise exception 'bad_outcome'; end if;
  update fair_play_flags set reviewed_at = app_now(), reviewed_by = uid, outcome = p_outcome,
                             detail = detail || jsonb_build_object('note', p_note)
   where id = p_flag and reviewed_at is null;
  if not found then raise exception 'not_found'; end if;
  perform log_admin(uid, 'review_flag', jsonb_build_object('flag', p_flag, 'outcome', p_outcome, 'note', p_note));
end $$;

---------------------------------------------------------------------------
-- Members: roles and point corrections (admins only)
---------------------------------------------------------------------------
create or replace function public.admin_set_role(p_handle text, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_role(array['admin']);
  target uuid;
begin
  if p_role not in ('member', 'steward', 'editor', 'admin') then raise exception 'bad_role'; end if;
  select id into target from profiles where handle = lower(trim(p_handle));
  if target is null then raise exception 'not_found'; end if;
  if target = uid then raise exception 'cannot_change_own_role'; end if;
  update profiles set role = p_role where id = target;
  perform log_admin(uid, 'set_role', jsonb_build_object('handle', lower(trim(p_handle)), 'role', p_role));
end $$;

create or replace function public.admin_adjust_points(p_handle text, p_points int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := require_role(array['admin']);
  target uuid;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  if p_points = 0 or abs(p_points) > 100 then raise exception 'bad_points'; end if;
  select id into target from profiles where handle = lower(trim(p_handle));
  if target is null then raise exception 'not_found'; end if;
  insert into points_ledger (user_id, source, source_ref, matchweek_id, points, detail)
  values (target, 'adjust', 'adj-' || gen_random_uuid(), mw_at(app_now()), p_points, jsonb_build_object('reason', trim(p_reason)));
  perform log_admin(uid, 'adjust_points', jsonb_build_object('handle', lower(trim(p_handle)), 'points', p_points, 'reason', trim(p_reason)));
end $$;

create or replace function public.admin_recent_log(p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(array['admin']);
  return (select coalesce(jsonb_agg(jsonb_build_object('at', l.at, 'who', p.handle, 'action', l.action, 'detail', l.detail) order by l.at desc), '[]')
            from (select * from admin_log order by at desc limit least(p_limit, 200)) l left join profiles p on p.id = l.actor);
end $$;

revoke execute on function public.require_role(text[]), public.log_admin(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function
  public.my_role(),
  public.admin_save_quiz(date, jsonb, boolean, time), public.admin_get_quiz(date),
  public.admin_save_poll(date, text, text[]), public.admin_save_take(int, text, text, text, text, jsonb, text, jsonb, timestamptz),
  public.admin_list_takes(), public.admin_content_calendar(date, int),
  public.admin_open_reports(), public.review_report(bigint, boolean),
  public.admin_open_flags(), public.admin_review_flag(bigint, text, text),
  public.admin_set_role(text, text), public.admin_adjust_points(text, int, text), public.admin_recent_log(int)
to authenticated;
