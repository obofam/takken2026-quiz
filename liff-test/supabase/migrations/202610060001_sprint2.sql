-- Sprint 2 (apply to the test Supabase project only, after 202609170001_sprint1.sql).
-- Stripe test-mode payments write one entitlements row per checkout session.
begin;

-- One entitlement per payment source ('stripe:' + checkout session id): webhook retries cannot duplicate it.
alter table public.entitlements
  add constraint entitlements_source_key unique (source);

-- Received Stripe event ids (audit / replay trail). Server-side only, like every other table.
create table public.stripe_events (
  id text primary key check (length(id) between 1 and 255),
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from public, anon, authenticated;
grant all on public.stripe_events to service_role;

-- Atomic, idempotent grant. Returns 'granted', 'duplicate' or 'unknown_user'.
create function public.grant_entitlement(
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
  if p_user_id is null or p_plan is null or p_plan not in ('ume', 'take', 'matsu')
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

revoke all on function public.grant_entitlement(uuid, text, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.grant_entitlement(uuid, text, timestamptz, text, text) to service_role;

commit;
