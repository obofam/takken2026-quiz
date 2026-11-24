-- 記録が3週間以上あいた人へ LINE でひとこと送る：送った印の表と、対象を選ぶ関数。2026-11-24。
-- 202611170001_progress_ox.sql の次に適用する。適用は本体が行う（このファイルを置いただけでは何も変わらない）。
-- 運営者に知らせた印（本人には送らない）。kind 'fukki3w' の意味は「運営者に知らせた」。
-- 「あいたら1回だけ。また記録して、また p_days 日あいたらもう1回」＝ progress.updated_at より新しい送信の印が無い人だけが対象。
-- users が消える・2人が1人にまとめられる（resolve_identity が M の users を消す）とき、M の印は on delete cascade で一緒に消える。
-- まとめた直後は progress.updated_at が now() になるので、印が消えても二重送信にはならない。
begin;

create table public.nudges (
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null default 'fukki3w',
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, sent_at)
);
alter table public.nudges enable row level security;
revoke all on public.nudges from public, anon, authenticated;
grant all on public.nudges to service_role;

-- LINE の表示名（ログインのとき預かる。運営者への知らせにだけ使う）。users が消える・まとめられるときは cascade で消える（次のLINEログインで入り直す）。
create table public.line_names (
  user_id uuid primary key references public.users(id) on delete cascade,
  display_name text not null,
  updated_at timestamptz not null default now()
);
alter table public.line_names enable row level security;
revoke all on public.line_names from public, anon, authenticated;
grant all on public.line_names to service_role;

create function public.set_line_name(p_user_id uuid, p_name text) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := left(btrim(coalesce(p_name, '')), 80);
begin
  if p_user_id is null or v_name = '' then
    return;
  end if;
  insert into public.line_names(user_id, display_name) values (p_user_id, v_name)
    on conflict (user_id) do update set display_name = excluded.display_name, updated_at = now();
end;
$$;

create function public.nudge_candidates(p_days int, p_floor timestamptz) returns table (user_id uuid, display_name text, last_at timestamptz, listened_count int)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.user_id, ln.display_name, p.updated_at, (select count(*)::int from jsonb_object_keys(p.listened))
  from public.progress p
  left join public.line_names ln on ln.user_id = p.user_id
  where exists (select 1 from public.identities i where i.user_id = p.user_id and i.provider = 'line')
    and (p.listened <> '{}'::jsonb or p.done <> '{}'::jsonb or p.kako <> '{}'::jsonb or p.ox <> '{}'::jsonb)
    and p.updated_at < now() - make_interval(days => p_days)
    and p.updated_at >= p_floor
    and not exists (
      select 1 from public.nudges n
      where n.user_id = p.user_id and n.kind = 'fukki3w' and n.sent_at > p.updated_at
    )
  order by p.updated_at asc
$$;

create function public.mark_nudged(p_user_id uuid) returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.nudges(user_id, kind) values (p_user_id, 'fukki3w')
$$;

revoke all on function public.nudge_candidates(int, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_nudged(uuid) from public, anon, authenticated;
revoke all on function public.set_line_name(uuid, text) from public, anon, authenticated;
grant execute on function public.nudge_candidates(int, timestamptz) to service_role;
grant execute on function public.mark_nudged(uuid) to service_role;
grant execute on function public.set_line_name(uuid, text) to service_role;

commit;
