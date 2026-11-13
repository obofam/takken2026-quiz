-- LINE とメールの記録をまとめる：両方にすでに利用者の行がある場合も1人にまとめる。2026-11-13。
-- 202611130002_open_login.sql の次に適用する。適用はKei／本体が行う（このファイルを置いただけでは何も変わらない）。
-- resolve_identity だけを置き換える（引数・戻り値・権限・security invoker・search_path は同じ）。
-- 有効な合図（期限内の link ticket）があり、識別が別の利用者 B につながっていて、合図の持ち主が利用者 A のとき：
--   例外にせず、作成日時が古いほう（同時なら id の小さいほう）を S として残し、もう一方 M を S にまとめて消す。
--   ・identities：M の行を S へ付け替える。S が同じ provider の識別をすでに持つなら identity_conflict（何も変わらない）。
--   ・progress：listened はキーごとに大きいほう、done は和集合。S の行に書き、M の行は消す。
--   ・entitlements・attempts・answers：user_id を S へ付け替える（attempts は id ごと移るので (attempt_id, question_id) の一意制約には当たらない。
--     answers → attempts の外部キーは (id, user_id, quiz_id) なので、2表を1つの文で同時に更新する）。
--   ・link_tickets：A・B に関係する合図を消す（今回の分を含む）。最後に M を消し、S を返す。
-- 合図が無い・期限切れ・無効のときは今までどおり（まとめない）。関数の中は1トランザクションなので、途中で失敗すれば全部元のまま。
begin;

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
        select exists(select 1 from public.progress where user_id in (v_keep, v_drop)) into v_has_progress;
        if v_has_progress then
          if not public.progress_map_ok('listened', v_l) or not public.progress_map_ok('done', v_d) then
            raise exception using errcode = '22023', message = 'invalid_progress';
          end if;
          insert into public.progress(user_id, listened, done, updated_at)
            values (v_keep, v_l, v_d, now())
            on conflict (user_id) do update
              set listened = excluded.listened, done = excluded.done, updated_at = excluded.updated_at;
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
