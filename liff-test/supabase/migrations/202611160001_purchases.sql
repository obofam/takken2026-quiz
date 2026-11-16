-- 帳簿（purchases）と、買った記録を権利の付与と同じトランザクションで書く record_purchase、返金の refund_purchase。
-- 202611130004_progress_kako.sql の次に、Supabase へ適用する（SQL Editor に貼る）。適用してから、新しいコードをデプロイする。
-- 足すだけ：既存の grant_entitlement（5引数）・表・制約は変えない。本番の古いコードは、そのまま動き続ける。
-- purchases は人を指す列を持たない（user_id もメールも入れない）。年末に users や entitlements を消しても、帳簿は7年残る。
begin;

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  purchased_at timestamptz not null,
  product text not null check (length(product) between 1 and 80),
  plan text not null check (length(plan) between 1 and 80),
  amount integer not null check (amount >= 0),
  currency text not null check (length(currency) between 1 and 10),
  list_price integer check (list_price is null or list_price >= 0),
  price_kind text not null check (price_kind in ('tsujo', 'start', 'sagaku')),
  stripe_session_id text not null unique check (length(stripe_session_id) between 4 and 255),
  stripe_payment_intent text check (stripe_payment_intent is null or length(stripe_payment_intent) between 4 and 255),
  livemode boolean not null,
  refunded_at timestamptz,
  refund_amount integer check (refund_amount is null or refund_amount >= 0),
  created_at timestamptz not null default now()
);
create index purchases_payment_intent_idx on public.purchases(stripe_payment_intent);
alter table public.purchases enable row level security;
revoke all on public.purchases from public, anon, authenticated;
grant all on public.purchases to service_role;

-- 権利の付与（grant_entitlement と同じ検査・同じ lock・同じ戻り値）＋帳簿に1行。'granted' / 'duplicate' / 'unknown_user'。
-- 利用者が見つからなくても帳簿は書く（お金は動いている）。権利は付けない。二重に届いても帳簿は増えない。
create function public.record_purchase(
  p_user_id uuid,
  p_plan text,
  p_valid_until timestamptz,
  p_source text,
  p_event_id text,
  p_product text,
  p_amount integer,
  p_currency text,
  p_list_price integer,
  p_price_kind text,
  p_payment_intent text,
  p_purchased_at timestamptz,
  p_livemode boolean
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  if p_user_id is null or p_plan is null or p_plan not in ('ume', 'take', 'matsu', 'text', 'haru', 'natsu', 'last30', 'zenbu', 'bansou')
     or p_source is null or length(p_source) not between 1 and 255 or p_source !~ '^stripe:cs_.+'
     or p_event_id is null or length(p_event_id) not between 1 and 255
     or (p_valid_until is not null and not isfinite(p_valid_until))
     or p_product is null or length(p_product) not between 1 and 80
     or p_amount is null or p_amount < 0
     or p_currency is null or length(p_currency) not between 1 and 10
     or (p_list_price is not null and p_list_price < 0)
     or p_price_kind is null or p_price_kind not in ('tsujo', 'start', 'sagaku')
     or (p_payment_intent is not null and length(p_payment_intent) not between 4 and 255)
     or p_purchased_at is null or not isfinite(p_purchased_at)
     or p_livemode is null then
    raise exception using errcode = '22023', message = 'invalid_purchase';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('entitlement:' || p_source, 0));
  insert into public.purchases(purchased_at, product, plan, amount, currency, list_price, price_kind, stripe_session_id, stripe_payment_intent, livemode)
    values (p_purchased_at, p_product, p_plan, p_amount, p_currency, p_list_price, p_price_kind, substr(p_source, 8), p_payment_intent, p_livemode)
    on conflict (stripe_session_id) do nothing;
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

revoke all on function public.record_purchase(uuid, text, timestamptz, text, text, text, integer, text, integer, text, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.record_purchase(uuid, text, timestamptz, text, text, text, integer, text, integer, text, text, timestamptz, boolean) to service_role;

-- 返金の記録。p_key は cs_…（セッション）か pi_…（取引番号）。全額のときだけ権利を外す。
-- 'refunded'（全額・権利を外した）/ 'partial'（一部・権利は残す）/ 'not_found' / 'already'（すでに記録あり・何もしない）。
create function public.refund_purchase(
  p_key text,
  p_refund_amount integer,
  p_refunded_at timestamptz
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.purchases%rowtype;
begin
  if p_key is null or length(p_key) not between 4 and 255 or p_key !~ '^(cs|pi)_.+'
     or p_refund_amount is null or p_refund_amount < 0
     or (p_refunded_at is not null and not isfinite(p_refunded_at)) then
    raise exception using errcode = '22023', message = 'invalid_refund';
  end if;
  if left(p_key, 3) = 'cs_' then
    select * into v_row from public.purchases where stripe_session_id = p_key;
  else
    select * into v_row from public.purchases where stripe_payment_intent = p_key order by purchased_at limit 1;
  end if;
  if not found then
    return 'not_found';
  end if;
  -- record_purchase と同じ lock（同じ支払いの付与と返金が同時に走っても順番に処理する）。取ったあとで行を読み直す。
  perform pg_advisory_xact_lock(hashtextextended('entitlement:stripe:' || v_row.stripe_session_id, 0));
  select * into v_row from public.purchases where id = v_row.id for update;
  if v_row.refunded_at is not null then
    return 'already';
  end if;
  update public.purchases set refunded_at = coalesce(p_refunded_at, now()), refund_amount = p_refund_amount where id = v_row.id;
  if p_refund_amount >= v_row.amount then
    delete from public.entitlements where source = 'stripe:' || v_row.stripe_session_id;
    return 'refunded';
  end if;
  return 'partial';
end;
$$;

revoke all on function public.refund_purchase(text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.refund_purchase(text, integer, timestamptz) to service_role;

commit;
