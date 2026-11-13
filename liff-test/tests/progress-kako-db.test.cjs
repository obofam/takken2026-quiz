'use strict';
// 202611130004_progress_kako.sql：kako（過去問1選の結果）の列・検査・set／merge・2人を1人にまとめるとき（pglite）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const LINE = 'a'.repeat(64), MAIL = 'tester@example.com', T1 = '1'.repeat(64);
const ALL = ['202609170001_sprint1.sql', '202610060001_sprint2.sql', '202610060002_sprint4_catalog.sql', '202611110001_text_plan.sql', '202611120001_products_2027.sql', '202611130001_progress.sql', '202611130002_open_login.sql', '202611130003_merge_users.sql'];
const mig = n => fs.readFileSync(path.join(root, 'supabase/migrations', n), 'utf8');

async function open({ kako = true } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; grant usage on schema public to anon, authenticated, service_role;`);
  for (const n of ALL) await db.exec(mig(n));
  if (kako) await db.exec(mig('202611130004_progress_kako.sql'));
  await db.exec(`insert into public.users(id, created_at) values ('${U1}', '2026-01-01'), ('${U2}', '2026-02-01')`);
  return db;
}
const set = (db, u, kind, key, value) => db.query('select public.set_progress($1, $2, $3, $4::jsonb) as r', [u, kind, key, value === undefined ? null : JSON.stringify(value)]);
const merge3 = (db, u, l, d) => db.query('select public.merge_progress($1, $2::jsonb, $3::jsonb) as r', [u, JSON.stringify(l), JSON.stringify(d)]);
const merge4 = (db, u, l, d, k) => db.query('select public.merge_progress($1, $2::jsonb, $3::jsonb, $4::jsonb) as r', [u, JSON.stringify(l), JSON.stringify(d), JSON.stringify(k)]);
const rejects = p => assert.rejects(p, /invalid_progress/);

test('kako column: jsonb object, not null, default {}; existing rows get {}; RLS and privileges unchanged', async () => {
  const db = await open({ kako: false });
  try {
    await db.exec(`insert into public.progress(user_id, listened, done) values ('${U1}', '{"1":1}', '{"1":true}')`);
    await db.exec(mig('202611130004_progress_kako.sql'));
    const r = (await db.query(`select listened, done, kako from public.progress where user_id = '${U1}'`)).rows[0];
    assert.deepEqual([r.listened, r.done, r.kako], [{ 1: 1 }, { 1: true }, {}]); // 既存の記録はそのまま
    const col = (await db.query("select is_nullable, data_type from information_schema.columns where table_name = 'progress' and column_name = 'kako'")).rows[0];
    assert.deepEqual([col.is_nullable, col.data_type], ['NO', 'jsonb']);
    await assert.rejects(db.exec(`update public.progress set kako = '[1]' where user_id = '${U1}'`));
    await assert.rejects(db.exec(`update public.progress set kako = null where user_id = '${U1}'`));
    assert.equal((await db.query("select relrowsecurity from pg_class where oid = 'public.progress'::regclass")).rows[0].relrowsecurity, true);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query(`select has_table_privilege('${role}', 'public.progress', 'select') as a`)).rows[0].a, false);
      for (const f of ['set_progress(uuid,text,text,jsonb)', 'merge_progress(uuid,jsonb,jsonb,jsonb)', 'progress_map_ok(text,jsonb)', 'resolve_identity(text,text,text,boolean)']) {
        assert.equal((await db.query(`select has_function_privilege('${role}', 'public.${f}', 'execute') as a`)).rows[0].a, false, role + ' ' + f);
        assert.equal((await db.query(`select has_function_privilege('service_role', 'public.${f}', 'execute') as a`)).rows[0].a, true, f);
      }
    }
    // 古い3引数の merge_progress は残らない（残ると呼び出しが決まらない）。security invoker・search_path も同じ
    assert.equal((await db.query("select count(*)::int as n from pg_proc where proname = 'merge_progress'")).rows[0].n, 1);
    const cfg = (await db.query("select proname, prosecdef, proconfig from pg_proc where proname in ('set_progress','merge_progress','resolve_identity','progress_map_ok')")).rows;
    for (const f of cfg) { assert.equal(f.prosecdef, false, f.proname); assert.ok((f.proconfig || []).some(c => /search_path=/.test(c)), f.proname); }
  } finally { await db.close(); }
});

test('progress_map_ok: kako takes 1 or 2 only, same key rule and 400-key limit', async () => {
  const db = await open();
  try {
    const ok = async (kind, m) => (await db.query('select public.progress_map_ok($1, $2::jsonb) as a', [kind, JSON.stringify(m)])).rows[0].a;
    assert.equal(await ok('kako', { 1: 1, 2: 2 }), true);
    assert.equal(await ok('kako', {}), true);
    for (const bad of [{ 1: 3 }, { 1: 0 }, { 1: true }, { 1: '1' }, { 'a b': 1 }, { ['a'.repeat(41)]: 1 }]) assert.equal(await ok('kako', bad), false, JSON.stringify(bad));
    const big = {}; for (let i = 0; i < 401; i++) big['k' + i] = 1;
    assert.equal(await ok('kako', big), false);
    // 今までの種類の規則は変わらない
    assert.equal(await ok('listened', { 1: 1 }), true); assert.equal(await ok('listened', { 1: true }), false);
    assert.equal(await ok('done', { 1: true }), true); assert.equal(await ok('done', { 1: 1 }), false);
    assert.equal(await ok('other', {}), false);
  } finally { await db.close(); }
});

test('set_progress kako: sets, overwrites (last result wins), null removes; other kinds untouched; bad values rejected', async () => {
  const db = await open();
  try {
    let r = (await set(db, U1, 'kako', '1', 1)).rows[0].r;
    assert.deepEqual([r.listened, r.done, r.kako], [{}, {}, { 1: 1 }]);
    r = (await set(db, U1, 'kako', '1', 2)).rows[0].r;
    assert.deepEqual(r.kako, { 1: 2 });
    await set(db, U1, 'listened', '1', 1);
    r = (await set(db, U1, 'kako', '2', 1)).rows[0].r;
    assert.deepEqual([r.listened, r.done, r.kako], [{ 1: 1 }, {}, { 1: 2, 2: 1 }]);
    r = (await set(db, U1, 'kako', '1', null)).rows[0].r;
    assert.deepEqual(r.kako, { 2: 1 });
    for (const v of [0, 3, true, '1', { a: 1 }]) await rejects(set(db, U1, 'kako', '1', v));
    await rejects(set(db, U1, 'kako', 'a b', 1));
    await rejects(set(db, U1, 'kako', '', 1));
    await rejects(set(db, U1, 'listened', '1', 3));
    await rejects(set(db, U1, 'done', '1', 1));
    const big = {}; for (let i = 0; i < 400; i++) big['k' + i] = 1;
    await merge4(db, U2, {}, {}, big);
    await rejects(set(db, U2, 'kako', 'extra', 1));
    await set(db, U2, 'kako', 'k0', 2);
  } finally { await db.close(); }
});

test('merge_progress: 3-argument calls still work (kako untouched); 4-argument adds only keys the server lacks; checks and rollback', async () => {
  const db = await open();
  try {
    await set(db, U1, 'kako', '1', 2);
    let r = (await merge3(db, U1, { 5: 1 }, { 5: true })).rows[0].r; // 古い呼び出し
    assert.deepEqual([r.listened, r.done, r.kako], [{ 5: 1 }, { 5: true }, { 1: 2 }]);
    r = (await merge4(db, U1, {}, {}, { 1: 1, 2: 1, 3: 2 })).rows[0].r;
    assert.deepEqual(r.kako, { 1: 2, 2: 1, 3: 2 }); // サーバーの 1:2 を残す
    assert.deepEqual((await merge4(db, U1, {}, {}, { 1: 1, 2: 1, 3: 2 })).rows[0].r.kako, { 1: 2, 2: 1, 3: 2 }); // 冪等
    const e = (await merge4(db, U2, {}, {}, {})).rows[0].r;
    assert.deepEqual([e.listened, e.done, e.kako], [{}, {}, {}]);
    // 名前つきの呼び出し（PostgREST と同じ）：p_kako を付けても付けなくても通る
    assert.deepEqual((await db.query(`select public.merge_progress(p_user_id => $1, p_listened => '{}', p_done => '{}') as r`, [U2])).rows[0].r.kako, {});
    assert.deepEqual((await db.query(`select public.merge_progress(p_user_id => $1, p_listened => '{}', p_done => '{}', p_kako => '{"9":1}') as r`, [U2])).rows[0].r.kako, { 9: 1 });
    for (const bad of [{ 1: 3 }, { 'a b': 1 }, [1]]) await rejects(merge4(db, U1, {}, {}, bad));
    await rejects(db.query(`select public.merge_progress($1, '{}'::jsonb, '{}'::jsonb, null::jsonb)`, [U1]));
    const before = (await db.query('select kako from public.progress where user_id = $1', [U1])).rows[0].kako;
    await rejects(merge4(db, U1, { bad: 3 }, {}, { 7: 1 }));
    assert.deepEqual((await db.query('select kako from public.progress where user_id = $1', [U1])).rows[0].kako, before); // 全部元のまま
  } finally { await db.close(); }
});

async function mergeUsers(db, a, b) {
  await db.exec(`insert into public.identities values ('${U1}','line','${LINE}'),('${U2}','email','${MAIL}')`);
  const row = (u, x) => `('${u}', '${x.l || '{}'}', '${x.d || '{}'}', '${x.k || '{}'}')`;
  await db.exec(`insert into public.progress(user_id, listened, done, kako) values ${row(U1, a)}${b ? ', ' + row(U2, b) : ''}`);
  await db.exec(`insert into public.link_tickets values ('${T1}','${U2}','line',null, now() + interval '10 minutes')`);
  return (await db.query(`select public.resolve_identity('line','${LINE}','${T1}',true) as id`)).rows[0].id;
}
test('resolve_identity merge: kako - same key keeps the surviving user (older) value; keys on only one side are kept', async () => {
  const db = await open();
  try {
    const id = await mergeUsers(db, { l: '{"1":1}', k: '{"1":1,"2":2}' }, { l: '{"1":2}', k: '{"1":2,"3":1,"4":2}' });
    assert.equal(id, U1); // U1 のほうが古い
    const p = (await db.query('select listened, done, kako from public.progress')).rows;
    assert.equal(p.length, 1);
    assert.deepEqual(p[0].kako, { 1: 1, 2: 2, 3: 1, 4: 2 }); // 1 は残す U1 の値（1）
    assert.deepEqual(p[0].listened, { 1: 2 });               // 今までの規則（大きいほう）は変わらない
    assert.equal((await db.query("select public.progress_map_ok('kako', kako) as a from public.progress")).rows[0].a, true);
  } finally { await db.close(); }
});
test('resolve_identity merge: when the newer user is the one kept, its kako value wins', async () => {
  const db = await open();
  try {
    await db.exec(`update public.users set created_at = '2026-03-01' where id = '${U1}'`); // U2 のほうが古い → U2 を残す
    const id = await mergeUsers(db, { k: '{"1":1,"5":2}' }, { k: '{"1":2}' });
    assert.equal(id, U2);
    assert.deepEqual((await db.query(`select kako from public.progress where user_id = '${U2}'`)).rows[0].kako, { 1: 2, 5: 2 });
    assert.equal((await db.query('select count(*)::int as n from public.progress')).rows[0].n, 1);
  } finally { await db.close(); }
});
test('resolve_identity merge: only the dropped side has kako -> it moves to the kept user; neither side has progress -> no row is made', async () => {
  const db = await open();
  try {
    await db.exec(`insert into public.identities values ('${U1}','line','${LINE}'),('${U2}','email','${MAIL}')`);
    await db.exec(`insert into public.progress(user_id, kako) values ('${U2}', '{"1":2}')`);
    await db.exec(`insert into public.link_tickets values ('${T1}','${U2}','line',null, now() + interval '10 minutes')`);
    assert.equal((await db.query(`select public.resolve_identity('line','${LINE}','${T1}',true) as id`)).rows[0].id, U1);
    assert.deepEqual((await db.query(`select kako from public.progress where user_id = '${U1}'`)).rows[0].kako, { 1: 2 });
  } finally { await db.close(); }
  const db2 = await open();
  try {
    await db2.exec(`insert into public.identities values ('${U1}','line','${LINE}'),('${U2}','email','${MAIL}')`);
    await db2.exec(`insert into public.link_tickets values ('${T1}','${U2}','line',null, now() + interval '10 minutes')`);
    await db2.query(`select public.resolve_identity('line','${LINE}','${T1}',true)`);
    assert.equal((await db2.query('select count(*)::int as n from public.progress')).rows[0].n, 0);
  } finally { await db2.close(); }
});
