-- 2027の商品の plan（haru / natsu / last30 / zenbu / bansou）。202611110001_text_plan.sql の次に、テスト用 Supabase へ適用する。
-- matome（要点まとめと問題）は単独では付与しない（zenbu・bansou に含めてサーバーで広げる）ので入れない。
begin;

alter table public.entitlements drop constraint entitlements_plan_check;
alter table public.entitlements
  add constraint entitlements_plan_check check (plan in ('ume', 'take', 'matsu', 'text', 'haru', 'natsu', 'last30', 'zenbu', 'bansou'));

-- Same function as before with the new plans accepted. Signature unchanged, so existing grants stay.
create or replace function public.grant_entitlement(
  p_user_id uuid,
  p_plan text,
  p_valid_until timestamptz,
  p_source text,
  p_event_id text
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  if p_user_id is null or p_plan is null or p_plan not in ('ume', 'take', 'matsu', 'text', 'haru', 'natsu', 'last30', 'zenbu', 'bansou')
     or p_source is null or length(p_source) not between 1 and 255
     or p_event_id is null or length(p_event_id) not between 1 and 255
     or (p_valid_until is not null and not isfinite(p_valid_until)) then
    raise exception using errcode = '22023', message = 'invalid_entitlement';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('entitlement:' || p_source, 0));
  perform 1 from public.users where id = p_user_id;
  if not found then
    return 'unknown_user';
  end if;
  insert into public.stripe_events(id) values (p_event_id) on conflict (id) do nothing;
  insert into public.entitlements(user_id, plan, valid_until, source)
    values (p_user_id, p_plan, p_valid_until, p_source)
    on conflict (source) do nothing;
  get diagnostics v_inserted = row_count;
  return case when v_inserted = 1 then 'granted' else 'duplicate' end;
end;
$$;

commit;
