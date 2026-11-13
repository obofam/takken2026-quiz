-- 過去問1選の結果の記録（kako）。2026-11-13。
-- 202611130003_merge_users.sql の次に適用する。適用は本体が行う（このファイルを置いただけでは何も変わらない）。
-- public.progress に列 kako を足す。形は {"回の番号": 1|2}（1=正解、2=不正解。その回の過去問を最後に解いたときの結果）。
-- 置き換えるもの：progress_map_ok（kind に 'kako'、値は 1 か 2）／set_progress（kind='kako' を受ける）／
--   merge_progress（引数に p_kako jsonb default '{}' を足す。古い3引数の版は消す＝3引数で呼んでも新しい版に届く）／
--   resolve_identity（2人を1人にまとめるとき kako も合わせる。同じキーは残す利用者の値、どちらかだけならそれ）。
-- 返す jsonb に 'kako' を足す。権限・RLS・security invoker・search_path は今までと同じ。キーの決まり・400件の上限も同じ。
begin;

alter table public.progress add column kako jsonb not null default '{}' check (jsonb_typeof(kako) = 'object');

create or replace function public.progress_map_ok(p_kind text, p_map jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_kind in ('listened', 'done', 'kako')
    and p_map is not null and jsonb_typeof(p_map) = 'object'
    and (select count(*) from jsonb_object_keys(p_map)) <= 400
    and coalesce((
      select bool_and(
        e.key ~ '^[A-Za-z0-9-]{1,40}$'
        and case p_kind when 'done' then e.value = 'true'::jsonb else e.value in ('1'::jsonb, '2'::jsonb) end
      ) from jsonb_each(p_map) e
    ), true)
$$;

create or replace function public.set_progress(p_user_id uuid, p_kind text, p_key text, p_value jsonb) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.progress;
  v_map jsonb;
  v_remove boolean := p_value is null or jsonb_typeof(p_value) = 'null';
begin
  if p_user_id is null or p_kind is null or p_kind not in ('listened', 'done', 'kako')
     or p_key is null or p_key !~ '^[A-Za-z0-9-]{1,40}$'
     or (not v_remove and not public.progress_map_ok(p_kind, jsonb_build_object(p_key, p_value))) then
    raise exception using errcode = '22023', message = 'invalid_progress';
  end if;
  insert into public.progress(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_row from public.progress where user_id = p_user_id for update;
  v_map := case p_kind when 'listened' then v_row.listened when 'done' then v_row.done else v_row.kako end;
  v_map := case when v_remove then v_map - p_key else v_map || jsonb_build_object(p_key, p_value) end;
  if not public.progress_map_ok(p_kind, v_map) then
    raise exception using errcode = '22023', message = 'invalid_progress';
  end if;
  update public.progress
    set listened = case when p_kind = 'listened' then v_map else listened end,
        done = case when p_kind = 'done' then v_map else done end,
        kako = case when p_kind = 'kako' then v_map else kako end,
        updated_at = now()
    where user_id = p_user_id
    returning * into v_row;
  return jsonb_build_object('listened', v_row.listened, 'done', v_row.done, 'kako', v_row.kako, 'updated_at', v_row.updated_at);
end;
$$;

-- 古い3引数の版は消してから、4引数（p_kako は省略できる）の版を作る（残すと、3引数の呼び出しがどちらか決まらなくなる）。
drop function public.merge_progress(uuid, jsonb, jsonb);
create function public.merge_progress(p_user_id uuid, p_listened jsonb, p_done jsonb, p_kako jsonb default '{}') returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.progress;
  v_l jsonb;
  v_d jsonb;
  v_k jsonb;
begin
  if p_user_id is null or not public.progress_map_ok('listened', p_listened) or not public.progress_map_ok('done', p_done)
     or not public.progress_map_ok('kako', p_kako) then
    raise exception using errcode = '22023', message = 'invalid_progress';
  end if;
  insert into public.progress(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_row from public.progress where user_id = p_user_id for update;
  v_l := p_listened || v_row.listened;
  v_d := p_done || v_row.done;
  v_k := p_kako || v_row.kako;
  if not public.progress_map_ok('listened', v_l) or not public.progress_map_ok('done', v_d) or not public.progress_map_ok('kako', v_k) then
    raise exception using errcode = '22023', message = 'invalid_progress';
  end if;
  update public.progress set listened = v_l, done = v_d, kako = v_k, updated_at = now()
    where user_id = p_user_id returning * into v_row;
  return jsonb_build_object('listened', v_row.listened, 'done', v_row.done, 'kako', v_row.kako, 'updated_at', v_row.updated_at);
end;
$$;

revoke all on function public.progress_map_ok(text, jsonb) from public, anon, authenticated;
revoke all on function public.set_progress(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.merge_progress(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.progress_map_ok(text, jsonb) to service_role;
grant execute on function public.set_progress(uuid, text, text, jsonb) to service_role;
grant execute on function public.merge_progress(uuid, jsonb, jsonb, jsonb) to service_role;

create or replace function public.resolve_identity(
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
  v_keep uuid;
  v_drop uuid;
  v_l jsonb;
  v_d jsonb;
  v_k jsonb;
  v_has_progress boolean;
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
      -- 2人の users の行を id の順にロックしてから、古いほうを残して1人にまとめる。
      perform 1 from public.users where id in (v_link_user, v_user_id) order by id for update;
      -- ロック待ちの間に別の要求がまとめ済みなら、識別の持ち主が変わっている。取り直す。
      select user_id into v_user_id from public.identities
        where provider = p_provider and subject = p_subject;
      perform 1 from public.users where id = v_link_user;
      if not found then
        raise exception using errcode = '42501', message = 'invalid_link_ticket';
      end if;
      if v_user_id <> v_link_user then
        select u.id into v_keep from public.users u
          where u.id in (v_link_user, v_user_id)
          order by u.created_at asc, u.id asc limit 1;
        v_drop := case when v_keep = v_link_user then v_user_id else v_link_user end;

        perform 1 from public.identities m join public.identities s
          on s.provider = m.provider and s.user_id = v_keep
          where m.user_id = v_drop;
        if found then
          raise exception using errcode = '23505', message = 'identity_conflict';
        end if;

        select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_l from (
          select e.key as k, max((e.value #>> '{}')::int) as v from (
            select (jsonb_each(listened)).* from public.progress where user_id in (v_keep, v_drop)
          ) e group by e.key
        ) t;
        select coalesce(jsonb_object_agg(k, 'true'::jsonb), '{}'::jsonb) into v_d from (
          select distinct e.key as k from (
            select (jsonb_each(done)).* from public.progress where user_id in (v_keep, v_drop)
          ) e
        ) t;
        -- kako（過去問）は、同じキーなら残す利用者の値を優先。どちらかにしか無ければそれを使う。
        v_k := coalesce((select kako from public.progress where user_id = v_drop), '{}'::jsonb)
            || coalesce((select kako from public.progress where user_id = v_keep), '{}'::jsonb);
        select exists(select 1 from public.progress where user_id in (v_keep, v_drop)) into v_has_progress;
        if v_has_progress then
          if not public.progress_map_ok('listened', v_l) or not public.progress_map_ok('done', v_d)
             or not public.progress_map_ok('kako', v_k) then
            raise exception using errcode = '22023', message = 'invalid_progress';
          end if;
          insert into public.progress(user_id, listened, done, kako, updated_at)
            values (v_keep, v_l, v_d, v_k, now())
            on conflict (user_id) do update
              set listened = excluded.listened, done = excluded.done, kako = excluded.kako, updated_at = excluded.updated_at;
          delete from public.progress where user_id = v_drop;
        end if;

        update public.identities set user_id = v_keep where user_id = v_drop;
        update public.entitlements set user_id = v_keep where user_id = v_drop;
        -- answers は attempts の (id, user_id, quiz_id) を参照するので、2表を1つの文で同時に動かす。
        with moved as (
          update public.attempts set user_id = v_keep where user_id = v_drop returning id
        )
        update public.answers set user_id = v_keep where user_id = v_drop;
        delete from public.link_tickets where user_id in (v_keep, v_drop) or token_hash = p_link_token_hash;
        delete from public.users where id = v_drop;
        return v_keep;
      end if;
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

revoke all on function public.resolve_identity(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.resolve_identity(text, text, text, boolean) to service_role;

commit;
