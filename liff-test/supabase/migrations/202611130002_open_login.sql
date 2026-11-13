-- 本番（takken.mimiobo.com）用：LINE・メールでログインした人はだれでも使える。2026-11-13。
-- 202611130001_progress.sql の次に適用する。適用はKei／本体が行う（このファイルを置いただけでは何も変わらない）。
-- 許可リストの確認は DB の関数の中にもあるため、アプリ側の環境変数 OPEN_LOGIN=1 だけでは通らない。
-- 関数に p_open（既定 false）を足す。p_open=true で呼ばれたときだけ許可リストを見ない。
--   ・アプリは OPEN_LOGIN=1 の環境（本番）だけ p_open=true を渡す。試し用は今までどおり許可リストを見る。
--   ・p_open を足した関数と古い関数が並ぶと呼び出しが曖昧になるため、古い関数は消して作り直す。
-- 同じデータベースを試し用と本番で使うので、この適用で試し用の動きは変わらない（p_open を渡さない限り false）。
begin;

drop function public.resolve_identity(text, text, text);
drop function public.save_answer(uuid, uuid, text, timestamptz, text, boolean, timestamptz);

create function public.resolve_identity(
  p_provider text,
  p_subject text,
  p_link_token_hash text default null,
  p_open boolean default false
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_link_user uuid;
  v_ticket public.link_tickets%rowtype;
begin
  if p_provider is null or p_provider not in ('line', 'email')
     or p_subject is null or length(p_subject) not between 1 and 320 then
    raise exception using errcode = '22023', message = 'invalid_identity';
  end if;
  -- Serialize creation/linking of the same identity before checking existence.
  perform pg_advisory_xact_lock(hashtextextended(p_provider || ':' || p_subject, 0));
  perform 1 from public.allowlist
    where provider = p_provider and subject = p_subject for share;
  if not found and not p_open then
    raise exception using errcode = '42501', message = 'identity_not_allowed';
  end if;

  if p_link_token_hash is not null then
    select * into v_ticket from public.link_tickets
      where token_hash = p_link_token_hash for update;
    if not found or v_ticket.expires_at <= clock_timestamp()
       or v_ticket.provider <> p_provider
       or (v_ticket.subject is not null and v_ticket.subject <> p_subject) then
      raise exception using errcode = '42501', message = 'invalid_link_ticket';
    end if;
    v_link_user := v_ticket.user_id;
    perform 1 from public.identities i join public.allowlist a
      on a.provider = i.provider and a.subject = i.subject
      where i.user_id = v_link_user for share of i, a;
    if not found and not p_open then
      raise exception using errcode = '42501', message = 'link_user_not_allowed';
    end if;
  end if;

  select user_id into v_user_id from public.identities
    where provider = p_provider and subject = p_subject;
  if found then
    if v_link_user is not null and v_link_user <> v_user_id then
      raise exception using errcode = '23505', message = 'identity_conflict';
    end if;
    delete from public.link_tickets where token_hash = p_link_token_hash;
    return v_user_id;
  end if;

  v_user_id := v_link_user;
  if v_user_id is null then
    insert into public.users default values returning id into v_user_id;
  end if;
  insert into public.identities(user_id, provider, subject)
    values (v_user_id, p_provider, p_subject);
  delete from public.link_tickets where token_hash = p_link_token_hash;
  return v_user_id;
end;
$$;

create function public.save_answer(
  p_user_id uuid,
  p_attempt_id uuid,
  p_quiz_id text,
  p_started_at timestamptz,
  p_question_id text,
  p_value boolean,
  p_answered_at timestamptz,
  p_open boolean default false
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
  if not found and not p_open then
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

revoke all on function public.resolve_identity(text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.save_answer(uuid, uuid, text, timestamptz, text, boolean, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.resolve_identity(text, text, text, boolean) to service_role;
grant execute on function public.save_answer(uuid, uuid, text, timestamptz, text, boolean, timestamptz, boolean)
  to service_role;

commit;
