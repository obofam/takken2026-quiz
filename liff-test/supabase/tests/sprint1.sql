-- Run after the migration in a disposable local database with Supabase roles.
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/sprint1.sql
-- All fixtures are rolled back; this is not a production smoke test.
begin;
set local role service_role;

do $$
declare
  v_user uuid;
  v_other uuid;
  v_attempt uuid := gen_random_uuid();
  v_line text := repeat('a', 64);
  v_ticket text := repeat('b', 64);
  v_table text;
  v_count integer;
  v_plan text;
begin
  foreach v_table in array array['users','identities','allowlist','attempts','answers','entitlements','link_tickets'] loop
    if has_table_privilege('anon', 'public.' || v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_table_privilege('authenticated', 'public.' || v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'browser table access: %', v_table;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || v_table)::regclass) then
      raise exception 'RLS disabled: %', v_table;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.resolve_identity(text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.resolve_identity(text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.save_answer(uuid,uuid,text,timestamptz,text,boolean,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.save_answer(uuid,uuid,text,timestamptz,text,boolean,timestamptz)', 'EXECUTE') then
    raise exception 'browser RPC access';
  end if;

  begin
    perform public.resolve_identity('email', 'sprint1-denied@example.invalid');
    raise exception 'unlisted identity accepted';
  exception when insufficient_privilege then null;
  end;

  insert into public.allowlist(provider, subject) values
    ('email', 'sprint1-one@example.invalid'), ('email', 'sprint1-two@example.invalid'), ('line', v_line);
  v_user := public.resolve_identity('email', 'sprint1-one@example.invalid');
  v_other := public.resolve_identity('email', 'sprint1-two@example.invalid');
  foreach v_plan in array array['ume','take','matsu'] loop
    insert into public.entitlements(user_id, plan, source) values (v_user, v_plan, 'test');
  end loop;
  foreach v_plan in array array['karte','navi','bansou','unknown'] loop
    begin
      insert into public.entitlements(user_id, plan, source) values (v_user, v_plan, 'test');
      raise exception 'invalid entitlement plan accepted: %', v_plan;
    exception when check_violation then null;
    end;
  end loop;
  if public.resolve_identity('email', 'sprint1-one@example.invalid') <> v_user then
    raise exception 'identity not stable';
  end if;

  insert into public.link_tickets values (v_ticket, v_user, 'line', null, now() + interval '10 minutes');
  if public.resolve_identity('line', v_line, v_ticket) <> v_user then
    raise exception 'link did not preserve user';
  end if;
  if exists (select 1 from public.link_tickets where token_hash = v_ticket) then
    raise exception 'ticket not consumed';
  end if;
  begin
    perform public.resolve_identity('line', v_line, v_ticket);
    raise exception 'ticket replay accepted';
  exception when insufficient_privilege then null;
  end;

  insert into public.link_tickets values (v_ticket, v_other, 'line', null, now() + interval '10 minutes');
  begin
    perform public.resolve_identity('line', v_line, v_ticket);
    raise exception 'conflicting identity merged';
  exception when unique_violation then
    if sqlerrm <> 'identity_conflict' then raise; end if;
  end;
  if not exists (select 1 from public.link_tickets where token_hash = v_ticket) then
    raise exception 'failed link consumed ticket';
  end if;

  update public.link_tickets set user_id = v_user, expires_at = now() - interval '1 minute'
    where token_hash = v_ticket;
  begin
    perform public.resolve_identity('line', v_line, v_ticket);
    raise exception 'expired ticket accepted';
  exception when insufficient_privilege then null;
  end;
  update public.link_tickets set expires_at = now() + interval '10 minutes', provider = 'email'
    where token_hash = v_ticket;
  begin
    perform public.resolve_identity('line', v_line, v_ticket);
    raise exception 'wrong ticket provider accepted';
  exception when insufficient_privilege then null;
  end;
  update public.link_tickets set provider = 'line', subject = repeat('c', 64)
    where token_hash = v_ticket;
  begin
    perform public.resolve_identity('line', v_line, v_ticket);
    raise exception 'wrong ticket subject accepted';
  exception when insufficient_privilege then null;
  end;

  perform public.save_answer(v_user, v_attempt, 'ep10', now(), 'ep10-money', true, now());
  perform public.save_answer(v_user, v_attempt, 'ep10', now(), 'ep10-money', false, now());
  select count(*) into v_count from public.answers where attempt_id = v_attempt;
  if v_count <> 1 or not (select value from public.answers where attempt_id = v_attempt) then
    raise exception 'duplicate changed server answer';
  end if;
  perform public.save_answer(v_user, v_attempt, 'ep10', now(), 'ep10-join', null, now());
  begin
    perform public.save_answer(v_other, v_attempt, 'ep10', now(), 'ep10-add', false, now());
    raise exception 'other user reused attempt';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_answer(v_user, v_attempt, 'ep10', now(), 'unknown', true, now());
    raise exception 'unknown question accepted';
  exception when invalid_parameter_value then null;
  end;

  delete from public.allowlist where subject in ('sprint1-one@example.invalid', v_line);
  begin
    perform public.save_answer(v_user, v_attempt, 'ep10', now(), 'ep10-add', true, now());
    raise exception 'revoked user saved answer';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.resolve_identity('email', 'sprint1-one@example.invalid');
    raise exception 'revoked identity logged in';
  exception when insufficient_privilege then null;
  end;
  update public.link_tickets set provider = 'email', subject = 'sprint1-two@example.invalid'
    where token_hash = v_ticket;
  begin
    perform public.resolve_identity('email', 'sprint1-two@example.invalid', v_ticket);
    raise exception 'revoked source user linked';
  exception when insufficient_privilege then
    if sqlerrm <> 'link_user_not_allowed' then raise; end if;
  end;
end;
$$;

rollback;
