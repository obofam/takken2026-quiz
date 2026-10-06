-- Run after the Sprint 1 and Sprint 2 migrations in a disposable local database with Supabase roles.
-- All fixtures are rolled back; this is not a production smoke test.
begin;
set local role service_role;

do $$
declare
  v_user uuid;
  v_count integer;
  v_valid timestamptz := '2027-10-17T23:59:59+09:00';
begin
  if has_table_privilege('anon', 'public.stripe_events', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.stripe_events', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'browser stripe_events access';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.stripe_events'::regclass) then
    raise exception 'RLS disabled: stripe_events';
  end if;
  if has_function_privilege('anon', 'public.grant_entitlement(uuid,text,timestamptz,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.grant_entitlement(uuid,text,timestamptz,text,text)', 'EXECUTE') then
    raise exception 'browser RPC access';
  end if;

  insert into public.users default values returning id into v_user;

  if public.grant_entitlement(gen_random_uuid(), 'ume', v_valid, 'stripe:cs_unknown', 'evt_unknown') <> 'unknown_user' then
    raise exception 'unknown user granted';
  end if;
  select count(*) into v_count from public.entitlements;
  if v_count <> 0 then raise exception 'unknown user wrote a row'; end if;

  if public.grant_entitlement(v_user, 'ume', v_valid, 'stripe:cs_test_1', 'evt_1') <> 'granted' then
    raise exception 'first grant failed';
  end if;
  -- Same checkout session, redelivered under the same or a different event id.
  if public.grant_entitlement(v_user, 'ume', v_valid, 'stripe:cs_test_1', 'evt_1') <> 'duplicate'
     or public.grant_entitlement(v_user, 'ume', v_valid, 'stripe:cs_test_1', 'evt_2') <> 'duplicate' then
    raise exception 'duplicate not detected';
  end if;
  select count(*) into v_count from public.entitlements where user_id = v_user and plan = 'ume' and source = 'stripe:cs_test_1' and valid_until = v_valid;
  if v_count <> 1 then raise exception 'entitlement rows: %', v_count; end if;
  select count(*) into v_count from public.stripe_events;
  if v_count <> 2 then raise exception 'stripe_events rows: %', v_count; end if;

  -- A different payment is a different source.
  if public.grant_entitlement(v_user, 'ume', v_valid, 'stripe:cs_test_2', 'evt_3') <> 'granted' then
    raise exception 'second payment not granted';
  end if;

  begin
    insert into public.entitlements(user_id, plan, source) values (v_user, 'ume', 'stripe:cs_test_1');
    raise exception 'source unique not enforced';
  exception when unique_violation then null;
  end;
  begin
    perform public.grant_entitlement(v_user, 'karte', v_valid, 'stripe:cs_bad', 'evt_bad');
    raise exception 'invalid plan accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

rollback;
