-- Run after the Sprint 1, 2 and 4 migrations in a disposable local database with Supabase roles.
-- All fixtures are rolled back; this is not a production smoke test.
begin;
set local role service_role;

do $$
declare
  v_user uuid;
  v_a10 uuid := gen_random_uuid();
  v_a3 uuid := gen_random_uuid();
  v_count integer;
  v_bad text;
begin
  insert into public.allowlist(provider, subject) values ('email', 'sprint4-one@example.invalid');
  v_user := public.resolve_identity('email', 'sprint4-one@example.invalid');

  -- ep10 keeps working with its existing ids; another episode now saves too.
  perform public.save_answer(v_user, v_a10, 'ep10', now(), 'ep10-money', true, now());
  perform public.save_answer(v_user, v_a10, 'ep10', now(), 'ep10-join', false, now());
  perform public.save_answer(v_user, v_a10, 'ep10', now(), 'ep10-add', null, now());
  perform public.save_answer(v_user, v_a3, 'ep3', now(), 'ep3-q1', true, now());
  perform public.save_answer(v_user, v_a3, 'ep3', now(), 'ep3-q1', false, now());
  select count(*) into v_count from public.answers where user_id = v_user;
  if v_count <> 4 then raise exception 'expected 4 answers, got %', v_count; end if;
  if not (select value from public.answers where attempt_id = v_a3 and question_id = 'ep3-q1') then
    raise exception 'duplicate changed server answer';
  end if;

  -- Shapes that are not ep<n> / ep<n>-<id>, or a question that belongs to another quiz, are rejected.
  for v_bad in select unnest(array['ep10|unknown', 'ep10|ep3-q1', 'ep3|ep10-money', 'ep3|ep3-Q1', 'ep3|ep3-', 'ep3|ep3-abcdefghijklmnopq',
                                   'ep1234|ep1234-q1', 'foo|foo-q1', 'EP3|EP3-q1', 'ep3|ep3-q1;drop']) loop
    begin
      perform public.save_answer(v_user, gen_random_uuid(), split_part(v_bad, '|', 1), now(), split_part(v_bad, '|', 2), true, now());
      raise exception 'malformed accepted: %', v_bad;
    exception when invalid_parameter_value then null;
    end;
  end loop;

  -- The table constraints agree with the RPC (direct writes cannot bypass the shape check).
  begin
    insert into public.attempts(id, user_id, quiz_id, started_at) values (gen_random_uuid(), v_user, 'quiz', now());
    raise exception 'attempts accepted a bad quiz_id';
  exception when check_violation then null;
  end;
  begin
    insert into public.answers(attempt_id, user_id, quiz_id, question_id, value, answered_at)
      values (v_a3, v_user, 'ep3', 'ep10-money', true, now());
    raise exception 'answers accepted a question of another quiz';
  exception when check_violation then null;
  end;
end;
$$;

rollback;
