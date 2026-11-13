'use strict';
// 202611130001_progress.sql：表・権限・set_progress／merge_progress の検査と規則（pglite）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';

async function open() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202609170001_sprint1.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202611130001_progress.sql'), 'utf8'));
  await db.exec(`insert into public.users(id) values ('${U1}'), ('${U2}')`);
  return db;
}
const set = (db, u, kind, key, value) => db.query('select public.set_progress($1, $2, $3, $4::jsonb) as r', [u, kind, key, value === undefined ? null : JSON.stringify(value)]);
const merge = (db, u, l, d) => db.query('select public.merge_progress($1, $2::jsonb, $3::jsonb) as r', [u, JSON.stringify(l), JSON.stringify(d)]);
const rejects = (p) => assert.rejects(p, /invalid_progress/);

test('table is service_role only; anon/authenticated cannot read or run the functions; RLS is on', async () => {
  const db = await open();
  try {
    const rls = await db.query("select relrowsecurity from pg_class where oid = 'public.progress'::regclass");
    assert.equal(rls.rows[0].relrowsecurity, true);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query(`select has_table_privilege('${role}', 'public.progress', 'select') as a`)).rows[0].a, false);
      assert.equal((await db.query(`select has_function_privilege('${role}', 'public.set_progress(uuid,text,text,jsonb)', 'execute') as a`)).rows[0].a, false);
      assert.equal((await db.query(`select has_function_privilege('${role}', 'public.merge_progress(uuid,jsonb,jsonb)', 'execute') as a`)).rows[0].a, false);
    }
    assert.equal((await db.query("select has_function_privilege('service_role', 'public.set_progress(uuid,text,text,jsonb)', 'execute') as a")).rows[0].a, true);
    assert.equal((await db.query("select has_function_privilege('service_role', 'public.merge_progress(uuid,jsonb,jsonb)', 'execute') as a")).rows[0].a, true);
    assert.equal((await db.query("select has_table_privilege('service_role', 'public.progress', 'insert') as a")).rows[0].a, true);
  } finally { await db.close(); }
});

test('set_progress creates the row, sets and removes keys (JSON null removes)', async () => {
  const db = await open();
  try {
    let r = (await set(db, U1, 'listened', '1', 1)).rows[0].r;
    assert.deepEqual([r.listened, r.done], [{ '1': 1 }, {}]);
    r = (await set(db, U1, 'listened', '1', 2)).rows[0].r;
    assert.deepEqual(r.listened, { '1': 2 });
    r = (await set(db, U1, 'done', '1', true)).rows[0].r;
    assert.deepEqual([r.listened, r.done], [{ '1': 2 }, { '1': true }]);
    r = (await set(db, U1, 'listened', '1', null)).rows[0].r;
    assert.deepEqual([r.listened, r.done], [{}, { '1': true }]);
    r = (await set(db, U1, 'done', '1', undefined)).rows[0].r; // SQL null も消す
    assert.deepEqual(r.done, {});
    // 別の利用者の行は動かない
    await set(db, U2, 'listened', '5', 1);
    assert.deepEqual((await db.query('select listened from public.progress where user_id = $1', [U1])).rows[0].listened, {});
    assert.equal((await db.query('select count(*)::int as n from public.progress')).rows[0].n, 2);
  } finally { await db.close(); }
});

test('set_progress rejects bad kind, key and value with invalid_progress', async () => {
  const db = await open();
  try {
    await rejects(set(db, U1, 'other', '1', 1));
    await rejects(set(db, U1, 'listened', '', 1));
    await rejects(set(db, U1, 'listened', 'a'.repeat(41), 1));
    await rejects(set(db, U1, 'listened', 'a b', 1));
    await rejects(set(db, U1, 'listened', 'ep_1', 1));
    await rejects(set(db, U1, 'listened', '1', 3));
    await rejects(set(db, U1, 'listened', '1', 0));
    await rejects(set(db, U1, 'listened', '1', true));
    await rejects(set(db, U1, 'listened', '1', '1'));
    await rejects(set(db, U1, 'done', '1', 1));
    await rejects(set(db, U1, 'done', '1', false));
    await rejects(set(db, U1, 'done', '1', { a: 1 }));
    await set(db, U1, 'listened', 'a'.repeat(40), 1);
    await set(db, U1, 'done', 'ep-1', true);
  } finally { await db.close(); }
});

test('a map holds at most 400 keys', async () => {
  const db = await open();
  try {
    const big = {}; for (let i = 0; i < 400; i++) big['k' + i] = 1;
    await merge(db, U1, big, {});
    await rejects(set(db, U1, 'listened', 'extra', 1));
    await set(db, U1, 'listened', 'k0', 2); // 既存キーの更新は通る
    await set(db, U1, 'listened', 'k1', null);
    await set(db, U1, 'listened', 'extra', 1);
    big.extra = 1; big.k2 = 1; big.k3 = 1;
    await rejects(merge(db, U2, Object.assign({}, big, { more: 1, more2: 1 }), {}));
  } finally { await db.close(); }
});

test('merge_progress adds only keys the server lacks and returns the merged maps', async () => {
  const db = await open();
  try {
    await set(db, U1, 'listened', '1', 2);
    await set(db, U1, 'done', '1', true);
    const r = (await merge(db, U1, { '1': 1, '2': 1, '3': 2 }, { '1': true, '4': true })).rows[0].r;
    assert.deepEqual(r.listened, { '1': 2, '2': 1, '3': 2 }); // サーバーの '1': 2 を残す
    assert.deepEqual(r.done, { '1': true, '4': true });
    // 空の merge は何も変えない・行がなければ作る
    const e = (await merge(db, U2, {}, {})).rows[0].r;
    assert.deepEqual([e.listened, e.done], [{}, {}]);
    // 2回目も同じ結果（冪等）
    assert.deepEqual((await merge(db, U1, { '1': 1, '2': 1, '3': 2 }, { '1': true, '4': true })).rows[0].r.listened, { '1': 2, '2': 1, '3': 2 });
    // 削除したキーを merge が復活させる（はじめての端末だけで使う前提）：サーバーに無いキーは足される
    await set(db, U1, 'listened', '2', null);
    assert.deepEqual((await merge(db, U1, { '2': 1 }, {})).rows[0].r.listened, { '1': 2, '2': 1, '3': 2 });
  } finally { await db.close(); }
});

test('merge_progress runs the same checks and rolls back as a whole', async () => {
  const db = await open();
  try {
    await rejects(merge(db, U1, { '1': 1, bad: 3 }, {}));
    await rejects(merge(db, U1, {}, { '1': 1 }));
    await rejects(merge(db, U1, { 'a b': 1 }, {}));
    await rejects(merge(db, U1, [1], {}));
    await rejects(merge(db, U1, null, {}));
    assert.equal((await db.query('select count(*)::int as n from public.progress')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('an unknown user cannot get a row (foreign key)', async () => {
  const db = await open();
  try {
    await assert.rejects(set(db, '00000000-0000-4000-8000-0000000000ff', 'listened', '1', 1));
  } finally { await db.close(); }
});
