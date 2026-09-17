-- Apply to the test Supabase project only. No allowlist subjects are seeded.
begin;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.identities (
  user_id uuid not null references public.users(id),
  provider text not null check (provider in ('line', 'email')),
  subject text not null check (length(subject) between 1 and 320),
  primary key (provider, subject),
  check (provider <> 'email' or subject = lower(btrim(subject))),
  check (provider <> 'line' or subject ~ '^[0-9a-f]{64}$')
);
create index identities_user_id_idx on public.identities(user_id);

create table public.allowlist (
  provider text not null check (provider in ('line', 'email')),
  subject text not null check (length(subject) between 1 and 320),
  primary key (provider, subject),
  check (provider <> 'email' or subject = lower(btrim(subject))),
  check (provider <> 'line' or subject ~ '^[0-9a-f]{64}$')
);

create table public.attempts (
  id uuid primary key,
  user_id uuid not null references public.users(id),
  quiz_id text not null check (quiz_id = 'ep10'),
  started_at timestamptz not null,
  unique (id, user_id, quiz_id)
);
create index attempts_user_quiz_idx on public.attempts(user_id, quiz_id, started_at);

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null,
  user_id uuid not null references public.users(id),
  quiz_id text not null check (quiz_id = 'ep10'),
  question_id text not null check (question_id in ('ep10-money', 'ep10-join', 'ep10-add')),
  value boolean,
  answered_at timestamptz not null,
  foreign key (attempt_id, user_id, quiz_id) references public.attempts(id, user_id, quiz_id),
  unique (attempt_id, question_id)
);
create index answers_user_quiz_idx on public.answers(user_id, quiz_id, answered_at);

-- Reserved for a later sprint. This migration deliberately inserts no entitlements.
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  plan text not null check (plan in ('ume', 'take', 'matsu')),
  valid_until timestamptz,
  source text not null
);
create index entitlements_user_id_idx on public.entitlements(user_id);

create table public.link_tickets (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references public.users(id),
  provider text not null check (provider in ('line', 'email')),
  subject text check (subject is null or length(subject) between 1 and 320),
  expires_at timestamptz not null check (isfinite(expires_at))
);
create index link_tickets_expires_at_idx on public.link_tickets(expires_at);

-- No browser policies: all access goes through the server's secret-key role.
alter table public.users enable row level security;
alter table public.identities enable row level security;
alter table public.allowlist enable row level security;
alter table public.attempts enable row level security;
alter table public.answers enable row level security;
alter table public.entitlements enable row level security;
alter table public.link_tickets enable row level security;
revoke all on public.users, public.identities, public.allowlist, public.attempts,
  public.answers, public.entitlements, public.link_tickets from public, anon, authenticated;
grant all on public.users, public.identities, public.allowlist, public.attempts,
  public.answers, public.entitlements, public.link_tickets to service_role;

create function public.resolve_identity(
  p_provider text,
  p_subject text,
  p_link_token_hash text default null
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
  if not found then
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
    if not found then
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
     or p_quiz_id <> 'ep10' or p_question_id is null
     or p_question_id not in ('ep10-money', 'ep10-join', 'ep10-add')
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

revoke all on function public.resolve_identity(text, text, text) from public, anon, authenticated;
revoke all on function public.save_answer(uuid, uuid, text, timestamptz, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.resolve_identity(text, text, text) to service_role;
grant execute on function public.save_answer(uuid, uuid, text, timestamptz, text, boolean, timestamptz)
  to service_role;

commit;
