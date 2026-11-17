'use strict';
// 202611170001_progress_ox.sql：ox（○×1日1問の記録）の列・検査・set／merge・2人を1人にまとめるとき（pglite）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const LINE = 'a'.repeat(64), MAIL = 'tester@example.com', T1 = '1'.repeat(64);
const BEFORE = ['202609170001_sprint1.sql', '202610060001_sprint2.sql', '202610060002_sprint4_catalog.sql', '202611110001_text_plan.sql', '202611120001_products_2027.sql', '202611130001_progress.sql', '202611130002_open_login.sql', '202611130003_merge_users.sql', '202611130004_progress_kako.sql', '202611160001_purchases.sql'];
const OX = '202611170001_progress_ox.sql';
const mig = n => fs.readFileSync(path.join(root, 'supabase/migrations', n), 'utf8');
const A = { r: [1, 0, 1], t: '2027-01-04' }, B = { r: [0], t: '2027-01-05' }, C = { r: [1, 1], t: '2027-01-06' };

async function open({ ox = true } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; grant usage on schema public to anon, authenticated, service_role;`);
  for (const n of BEFORE) await db.exec(mig(n));
  if (ox) await db.exec(mig(OX));
  await db.exec(`insert into public.users(id, created_at) values ('${U1}', '2026-01-01'), ('${U2}', '2026-02-01')`);
  return db;
}
const set = (db, u, kind, key, value) => db.query('select public.set_progress($1, $2, $3, $4::jsonb) as r', [u, kind, key, value === undefined ? null : JSON.stringify(value)]);
const merge3 = (db, u, l, d) => db.query('select public.merge_progress($1, $2::jsonb, $3::jsonb) as r', [u, JSON.stringify(l), JSON.stringify(d)]);
const merge4 = (db, u, l, d, k) => db.query('select public.merge_progress($1, $2::jsonb, $3::jsonb, $4::jsonb) as r', [u, JSON.stringify(l), JSON.stringify(d), JSON.stringify(k)]);
const merge5 = (db, u, l, d, k, o) => db.query('select public.merge_progress($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb) as r', [u, JSON.stringify(l), JSON.stringify(d), JSON.stringify(k), JSON.stringify(o)]);
const rejects = p => assert.rejects(p, /invalid_progress/);

test('ox column: jsonb object, not null, default {}; existing rows (and listened/done/kako) are untouched; RLS and privileges unchanged', async () => {
  const db = await open({ ox: false });
  try {
    await db.exec(`insert into public.progress(user_id, listened, done, kako) values ('${U1}', '{"1":1}', '{"1":true}', '{"1":2}')`);
    await db.exec(mig(OX));
    const r = (await db.query(`select listened, done, kako, ox from public.progress where user_id = '${U1}'`)).rows[0];
    assert.deepEqual([r.listened, r.done, r.kako, r.ox], [{ 1: 1 }, { 1: true }, { 1: 2 }, {}]);
    const col = (await db.query("select is_nullable, data_type from information_schema.columns where table_name = 'progress' and column_name = 'ox'")).rows[0];
    assert.deepEqual([col.is_nullable, col.data_type], ['NO', 'jsonb']);
    await assert.rejects(db.exec(`update public.progress set ox = '[1]' where user_id = '${U1}'`));
    await assert.rejects(db.exec(`update public.progress set ox = null where user_id = '${U1}'`));
    assert.equal((await db.query("select relrowsecurity from pg_class where oid = 'public.progress'::regclass")).rows[0].relrowsecurity, true);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query(`select has_table_privilege('${role}', 'public.progress', 'select') as a`)).rows[0].a, false);
      for (const f of ['set_progress(uuid,text,text,jsonb)', 'merge_progress(uuid,jsonb,jsonb,jsonb,jsonb)', 'progress_map_ok(text,jsonb)', 'progress_ox_ok(jsonb)', 'resolve_identity(text,text,text,boolean)']) {
        assert.equal((await db.query(`select has_function_privilege('${role}', 'public.${f}', 'execute') as a`)).rows[0].a, false, role + ' ' + f);
        assert.equal((await db.query(`select has_function_privilege('service_role', 'public.${f}', 'execute') as a`)).rows[0].a, true, f);
      }
    }
    assert.equal((await db.query("select count(*)::int as n from pg_proc where proname = 'merge_progress'")).rows[0].n, 1); // 古い4引数の版は残らない
    const cfg = (await db.query("select proname, prosecdef, proconfig from pg_proc where proname in ('set_progress','merge_progress','resolve_identity','progress_map_ok','progress_ox_ok')")).rows;
    for (const f of cfg) { assert.equal(f.prosecdef, false, f.proname); assert.ok((f.proconfig || []).some(c => /search_path=/.test(c)), f.proname); }
  } finally { await db.close(); }
});

test('progress_map_ok: ox key is o+3 digits, value is {r, t} only; same 400-key limit; other kinds unchanged', async () => {
  const db = await open();
  try {
    const ok = async (kind, m) => (await db.query('select public.progress_map_ok($1, $2::jsonb) as a', [kind, JSON.stringify(m)])).rows[0].a;
    assert.equal(await ok('ox', { o001: A, o281: B }), true);
    assert.equal(await ok('ox', {}), true);
    assert.equal(await ok('ox', { o001: { r: Array(10).fill(1), t: '2027-10-16' } }), true);
    const badValues = [1, true, null, 'x', [], { r: [1] }, { t: '2027-01-04' }, { r: [], t: '2027-01-04' }, { r: Array(11).fill(1), t: '2027-01-04' },
      { r: [2], t: '2027-01-04' }, { r: [true], t: '2027-01-04' }, { r: ['1'], t: '2027-01-04' }, { r: 1, t: '2027-01-04' }, { r: [1], t: '2027/01/04' },
      { r: [1], t: '2027-1-4' }, { r: [1], t: 20270104 }, { r: [1], t: '2027-01-04', x: 1 }, { r: [1], t: '2027-01-04 ' }];
    for (const v of badValues) assert.equal(await ok('ox', { o001: v }), false, JSON.stringify(v));
    for (const k of ['001', 'o01', 'o0001', 'O001', 'a b', 'o00a', '1']) assert.equal(await ok('ox', { [k]: A }), false, k);
    const big = {}; for (let i = 0; i < 401; i++) big['o' + String(i).padStart(3, '0')] = A;
    assert.equal(await ok('ox', big), false);
    delete big.o400; assert.equal(Object.keys(big).length, 400); assert.equal(await ok('ox', big), true);
    assert.equal(await ok('ox', { 1: 1 }), false);
    assert.equal(await ok('kako', { o001: A }), false);
    assert.equal(await ok('kako', { 1: 1 }), true); assert.equal(await ok('listened', { 1: 1 }), true);
    assert.equal(await ok('done', { 1: true }), true); assert.equal(await ok('done', { 1: 1 }), false);
    assert.equal(await ok('other', {}), false);
  } finally { await db.close(); }
});

test('set_progress ox: sets, overwrites, null removes; other kinds untouched; bad keys and values rejected', async () => {
  const db = await open();
  try {
    let r = (await set(db, U1, 'ox', 'o001', A)).rows[0].r;
    assert.deepEqual([r.listened, r.done, r.kako, r.ox], [{}, {}, {}, { o001: A }]);
    r = (await set(db, U1, 'ox', 'o001', B)).rows[0].r;
    assert.deepEqual(r.ox, { o001: B });
    await set(db, U1, 'kako', '1', 2);
    r = (await set(db, U1, 'ox', 'o002', C)).rows[0].r;
    assert.deepEqual([r.kako, r.ox], [{ 1: 2 }, { o001: B, o002: C }]);
    r = (await set(db, U1, 'ox', 'o001', null)).rows[0].r;
    assert.deepEqual(r.ox, { o002: C });
    await set(db, U1, 'ox', 'o002', C); // JSON null（SQL の NULL ではない）でも消す
    assert.deepEqual((await db.query("select public.set_progress($1, 'ox', 'o002', 'null'::jsonb) as r", [U1])).rows[0].r.ox, {});
    for (const v of [0, 1, true, '1', [], { r: [] , t: '2027-01-04' }, { r: [2], t: '2027-01-04' }, { r: [1], t: 'x' }, { r: [1] }, { r: [1], t: '2027-01-04', z: 1 }]) await rejects(set(db, U1, 'ox', 'o001', v));
    for (const k of ['a b', '', '1', 'o01', 'o0001', 'x001']) await rejects(set(db, U1, 'ox', k, A));
    await rejects(set(db, U1, 'ox', 'x001', null)); // 消すときもキーの形は見る
    await rejects(set(db, U1, 'kako', 'o001', A));
    await rejects(set(db, U1, 'other', 'o001', A));
    const big = {}; for (let i = 0; i < 400; i++) big['o' + String(i).padStart(3, '0')] = A;
    await merge5(db, U2, {}, {}, {}, big);
    await rejects(set(db, U2, 'ox', 'o999', A)); // 401 キー目
    await set(db, U2, 'ox', 'o000', B); // 既にあるキーの上書きは通る
  } finally { await db.close(); }
});

test('old calls still work: set_progress for listened/done/kako, 3- and 4-argument merge_progress (ox untouched)', async () => {
  const db = await open();
  try {
    await set(db, U1, 'ox', 'o001', A);
    let r = (await set(db, U1, 'listened', '1', 1)).rows[0].r;
    assert.deepEqual([r.listened, r.ox], [{ 1: 1 }, { o001: A }]);
    r = (await set(db, U1, 'done', '1', true)).rows[0].r;
    assert.deepEqual(r.done, { 1: true });
    r = (await set(db, U1, 'kako', '1', 2)).rows[0].r;
    assert.deepEqual([r.kako, r.ox], [{ 1: 2 }, { o001: A }]);
    r = (await merge3(db, U1, { 5: 1 }, { 5: true })).rows[0].r; // kako 以前の呼び出し
    assert.deepEqual([r.listened, r.done, r.kako, r.ox], [{ 1: 1, 5: 1 }, { 1: true, 5: true }, { 1: 2 }, { o001: A }]);
    r = (await merge4(db, U1, {}, {}, { 1: 1, 2: 1 })).rows[0].r; // kako 時代の呼び出し
    assert.deepEqual([r.kako, r.ox], [{ 1: 2, 2: 1 }, { o001: A }]);
    // 名前つきの呼び出し（PostgREST と同じ）
    assert.deepEqual((await db.query(`select public.merge_progress(p_user_id => $1, p_listened => '{}', p_done => '{}') as r`, [U2])).rows[0].r.ox, {});
    assert.deepEqual((await db.query(`select public.merge_progress(p_user_id => $1, p_listened => '{}', p_done => '{}', p_kako => '{"9":1}') as r`, [U2])).rows[0].r.kako, { 9: 1 });
  } finally { await db.close(); }
});

test('merge_progress 5 args: adds only keys the server lacks, idempotent, checks, rollback', async () => {
  const db = await open();
  try {
    await set(db, U1, 'ox', 'o001', B);
    let r = (await merge5(db, U1, {}, {}, {}, { o001: A, o002: A, o003: C })).rows[0].r;
    assert.deepEqual(r.ox, { o001: B, o002: A, o003: C }); // サーバーの o001 を残す
    assert.deepEqual((await merge5(db, U1, {}, {}, {}, { o001: A, o002: A, o003: C })).rows[0].r.ox, { o001: B, o002: A, o003: C });
    const e = (await merge5(db, U2, {}, {}, {}, {})).rows[0].r;
    assert.deepEqual([e.listened, e.done, e.kako, e.ox], [{}, {}, {}, {}]);
    assert.deepEqual((await db.query(`select public.merge_progress(p_user_id => $1, p_listened => '{}', p_done => '{}', p_ox => '{"o009":{"r":[1],"t":"2027-02-01"}}') as r`, [U2])).rows[0].r.ox, { o009: { r: [1], t: '2027-02-01' } });
    for (const bad of [{ o001: 1 }, { x1: A }, [1], { o001: { r: [3], t: '2027-01-04' } }]) await rejects(merge5(db, U1, {}, {}, {}, bad));
    await rejects(db.query(`select public.merge_progress($1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, null::jsonb)`, [U1]));
    const before = (await db.query('select ox, kako from public.progress where user_id = $1', [U1])).rows[0];
    await rejects(merge5(db, U1, {}, {}, { 7: 1 }, { o050: 'bad' }));
    await rejects(merge5(db, U1, { bad: 3 }, {}, {}, { o051: A }));
    assert.deepEqual((await db.query('select ox, kako from public.progress where user_id = $1', [U1])).rows[0], before); // 全部元のまま
  } finally { await db.close(); }
});

async function mergeUsers(db, a, b) {
  await db.exec(`insert into public.identities values ('${U1}','line','${LINE}'),('${U2}','email','${MAIL}')`);
  const row = (u, x) => `('${u}', '${x.l || '{}'}', '${x.d || '{}'}', '${x.k || '{}'}', '${x.o || '{}'}')`;
  await db.exec(`insert into public.progress(user_id, listened, done, kako, ox) values ${row(U1, a)}${b ? ', ' + row(U2, b) : ''}`);
  await db.exec(`insert into public.link_tickets values ('${T1}','${U2}','line',null, now() + interval '10 minutes')`);
  return (await db.query(`select public.resolve_identity('line','${LINE}','${T1}',true) as id`)).rows[0].id;
}
const J = o => JSON.stringify(o);
test('resolve_identity merge: ox - same key takes the newer t (even from the dropped side); same t keeps the surviving user; one-sided keys are kept; other kinds unchanged', async () => {
  const db = await open();
  try {
    const id = await mergeUsers(db,
      { l: '{"1":1}', k: '{"1":1}', o: J({ o001: A, o002: C, o003: { r: [1], t: '2027-01-04' }, o004: A }) },
      { l: '{"1":2}', k: '{"1":2,"3":1}', o: J({ o001: B, o002: A, o003: { r: [0], t: '2027-01-04' }, o005: B }) });
    assert.equal(id, U1); // U1 のほうが古い
    const p = (await db.query('select listened, done, kako, ox from public.progress')).rows;
    assert.equal(p.length, 1);
    assert.deepEqual(p[0].ox, { o001: B, o002: C, o003: { r: [1], t: '2027-01-04' }, o004: A, o005: B });
    assert.deepEqual(p[0].kako, { 1: 1, 3: 1 });
    assert.deepEqual(p[0].listened, { 1: 2 });
    assert.equal((await db.query("select public.progress_map_ok('ox', ox) as a from public.progress")).rows[0].a, true);
  } finally { await db.close(); }
});
test('resolve_identity merge: when the newer user is the one kept, same t keeps that user\'s value, a newer t from the dropped one wins', async () => {
  const db = await open();
  try {
    await db.exec(`update public.users set created_at = '2026-03-01' where id = '${U1}'`); // U2 のほうが古い → U2 を残す
    const id = await mergeUsers(db, { o: J({ o001: { r: [1], t: '2027-01-04' }, o002: B }) }, { o: J({ o001: { r: [0], t: '2027-01-04' }, o002: A }) });
    assert.equal(id, U2);
    assert.deepEqual((await db.query(`select ox from public.progress where user_id = '${U2}'`)).rows[0].ox, { o001: { r: [0], t: '2027-01-04' }, o002: B });
    assert.equal((await db.query('select count(*)::int as n from public.progress')).rows[0].n, 1);
  } finally { await db.close(); }
});
test('resolve_identity merge: only the dropped side has ox -> it moves to the kept user; neither side has progress -> no row is made', async () => {
  const db = await open();
  try {
    await db.exec(`insert into public.identities values ('${U1}','line','${LINE}'),('${U2}','email','${MAIL}')`);
    await db.exec(`insert into public.progress(user_id, ox) values ('${U2}', '${J({ o001: A })}')`);
    await db.exec(`insert into public.link_tickets values ('${T1}','${U2}','line',null, now() + interval '10 minutes')`);
    assert.equal((await db.query(`select public.resolve_identity('line','${LINE}','${T1}',true) as id`)).rows[0].id, U1);
    assert.deepEqual((await db.query(`select ox from public.progress where user_id = '${U1}'`)).rows[0].ox, { o001: A });
  } finally { await db.close(); }
  const db2 = await open();
  try {
    await db2.exec(`insert into public.identities values ('${U1}','line','${LINE}'),('${U2}','email','${MAIL}')`);
    await db2.exec(`insert into public.link_tickets values ('${T1}','${U2}','line',null, now() + interval '10 minutes')`);
    await db2.query(`select public.resolve_identity('line','${LINE}','${T1}',true)`);
    assert.equal((await db2.query('select count(*)::int as n from public.progress')).rows[0].n, 0);
  } finally { await db2.close(); }
});
