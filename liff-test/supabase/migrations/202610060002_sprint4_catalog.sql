-- Sprint 4 (apply to the test Supabase project only, after 202609170001_sprint1.sql and 202610060001_sprint2.sql).
-- 3問チェックを全放送回へ：quiz_id / question_id の固定リストを「形」の検査に置き換える。
-- どの quiz・question が有効かは api/answers.js が quiz-catalog.js で判定する。DB は形と整合だけを見る。
--   quiz_id     = ep<数字1〜3桁>              例 ep10, ep3
--   question_id = <quiz_id>-<英小文字・数字1〜16字>  例 ep10-money, ep3-q1
-- 既存の行（ep10 / ep10-money・ep10-join・ep10-add）はすべてこの形に合う。データは変更しない。
begin;

alter table public.attempts drop constraint attempts_quiz_id_check;
alter table public.attempts
  add constraint attempts_quiz_id_check check (quiz_id ~ '^ep[0-9]{1,3}$');

alter table public.answers drop constraint answers_quiz_id_check;
alter table public.answers drop constraint answers_question_id_check;
alter table public.answers
  add constraint answers_quiz_id_check check (quiz_id ~ '^ep[0-9]{1,3}$'),
  add constraint answers_question_id_check check (
    question_id ~ '^ep[0-9]{1,3}-[a-z0-9]{1,16}$'
    and left(question_id, length(quiz_id) + 1) = quiz_id || '-'
  );

create or replace function public.save_answer(
  p_user_id uuid,
  p_attempt_id uuid,
  p_quiz_id text,
  p_started_at timestamptz,
  p_question_id text,
  p_value boolean,
  p_answered_at timestamptz
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt public.attempts%rowtype;
begin
  if p_user_id is null or p_attempt_id is null or p_quiz_id is null
     or p_quiz_id !~ '^ep[0-9]{1,3}$' or p_question_id is null
     or p_question_id !~ '^ep[0-9]{1,3}-[a-z0-9]{1,16}$'
     or left(p_question_id, length(p_quiz_id) + 1) <> p_quiz_id || '-'
     or p_started_at is null or p_answered_at is null
     or not isfinite(p_started_at) or not isfinite(p_answered_at)
     or p_answered_at < p_started_at then
    raise exception using errcode = '22023', message = 'invalid_answer';
  end if;

  perform 1 from public.identities i join public.allowlist a
    on a.provider = i.provider and a.subject = i.subject
    where i.user_id = p_user_id for share of i, a;
  if not found then
    raise exception using errcode = '42501', message = 'user_not_allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('attempt:' || p_attempt_id::text, 0));
  insert into public.attempts(id, user_id, quiz_id, started_at)
    values (p_attempt_id, p_user_id, p_quiz_id, p_started_at)
    on conflict (id) do nothing;
  select * into strict v_attempt from public.attempts where id = p_attempt_id for update;
  if v_attempt.user_id <> p_user_id or v_attempt.quiz_id <> p_quiz_id then
    raise exception using errcode = '42501', message = 'attempt_owner_mismatch';
  end if;
  if p_answered_at < v_attempt.started_at then
    raise exception using errcode = '22023', message = 'invalid_answer';
  end if;
  insert into public.answers(attempt_id, user_id, quiz_id, question_id, value, answered_at)
    values (p_attempt_id, p_user_id, p_quiz_id, p_question_id, p_value, p_answered_at)
    on conflict (attempt_id, question_id) do nothing;
end;
$$;

revoke all on function public.save_answer(uuid, uuid, text, timestamptz, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.save_answer(uuid, uuid, text, timestamptz, text, boolean, timestamptz)
  to service_role;

commit;
