-- 記録の同期（聴いた・復習・3問済）。202611120001_products_2027.sql の次に、テスト用 Supabase へ適用する。
-- 利用者ごとに1行。listened は {"放送回の番号": 1|2}（1=聴いた, 2=復習）、done は {"放送回の番号": true}。
begin;

create table public.progress (
  user_id uuid primary key references public.users(id),
  listened jsonb not null default '{}' check (jsonb_typeof(listened) = 'object'),
  done jsonb not null default '{}' check (jsonb_typeof(done) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.progress enable row level security;
revoke all on public.progress from public, anon, authenticated;
grant all on public.progress to service_role;

-- map の検査：キーは 1〜40 文字の英数字とハイフン、値は listened なら 1 か 2、done なら true、キー数は 400 まで。
create function public.progress_map_ok(p_kind text, p_map jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_kind in ('listened', 'done')
    and p_map is not null and jsonb_typeof(p_map) = 'object'
    and (select count(*) from jsonb_object_keys(p_map)) <= 400
    and coalesce((
      select bool_and(
        e.key ~ '^[A-Za-z0-9-]{1,40}$'
        and case p_kind when 'listened' then e.value in ('1'::jsonb, '2'::jsonb) else e.value = 'true'::jsonb end
      ) from jsonb_each(p_map) e
    ), true)
$$;

-- 1件の変更。p_value が JSON の null（または SQL の null）ならそのキーを消す。変更後の {listened, done, updated_at} を返す。
create function public.set_progress(p_user_id uuid, p_kind text, p_key text, p_value jsonb) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.progress;
  v_map jsonb;
  v_remove boolean := p_value is null or jsonb_typeof(p_value) = 'null';
begin
  if p_user_id is null or p_kind is null or p_kind not in ('listened', 'done')
     or p_key is null or p_key !~ '^[A-Za-z0-9-]{1,40}$'
     or (not v_remove and not public.progress_map_ok(p_kind, jsonb_build_object(p_key, p_value))) then
    raise exception using errcode = '22023', message = 'invalid_progress';
  end if;
  insert into public.progress(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_row from public.progress where user_id = p_user_id for update;
  v_map := case p_kind when 'listened' then v_row.listened else v_row.done end;
  v_map := case when v_remove then v_map - p_key else v_map || jsonb_build_object(p_key, p_value) end;
  if not public.progress_map_ok(p_kind, v_map) then
    raise exception using errcode = '22023', message = 'invalid_progress';
  end if;
  update public.progress
    set listened = case when p_kind = 'listened' then v_map else listened end,
        done = case when p_kind = 'done' then v_map else done end,
        updated_at = now()
    where user_id = p_user_id
    returning * into v_row;
  return jsonb_build_object('listened', v_row.listened, 'done', v_row.done, 'updated_at', v_row.updated_at);
end;
$$;

-- はじめてログインした端末の記録を合わせる。サーバーに無いキーだけを足す（あるキーはサーバーの値を残す）。
create function public.merge_progress(p_user_id uuid, p_listened jsonb, p_done jsonb) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.progress;
  v_l jsonb;
  v_d jsonb;
begin
  if p_user_id is null or not public.progress_map_ok('listened', p_listened) or not public.progress_map_ok('done', p_done) then
    raise exception using errcode = '22023', message = 'invalid_progress';
  end if;
  insert into public.progress(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_row from public.progress where user_id = p_user_id for update;
  v_l := p_listened || v_row.listened;
  v_d := p_done || v_row.done;
  if not public.progress_map_ok('listened', v_l) or not public.progress_map_ok('done', v_d) then
    raise exception using errcode = '22023', message = 'invalid_progress';
  end if;
  update public.progress set listened = v_l, done = v_d, updated_at = now()
    where user_id = p_user_id returning * into v_row;
  return jsonb_build_object('listened', v_row.listened, 'done', v_row.done, 'updated_at', v_row.updated_at);
end;
$$;

revoke all on function public.progress_map_ok(text, jsonb) from public, anon, authenticated;
revoke all on function public.set_progress(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.merge_progress(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.progress_map_ok(text, jsonb) to service_role;
grant execute on function public.set_progress(uuid, text, text, jsonb) to service_role;
grant execute on function public.merge_progress(uuid, jsonb, jsonb) to service_role;

commit;
