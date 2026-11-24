'use strict';
// 202611240001_nudges.sql：3週間あいた人の選び方・印・2人を1人にまとめるとき（pglite）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const ALL = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(n => n.endsWith('.sql')).sort();
const U = n => `00000000-0000-4000-8000-00000000000${n}`;
const FLOOR = '2027-01-04T00:00:00+09:00';
const FLOOR_OLD = '2020-01-01T00:00:00+09:00'; // テストの日付は今日基準なので、既定の floor より前に外して使う
const DAY = 86400000;
const ago = d => new Date(Date.now() - d * DAY).toISOString();
async function open() {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; grant usage on schema public to anon, authenticated, service_role;`);
  for (const n of ALL) await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', n), 'utf8'));
  return db;
}
// 利用者 n（識別つき）と記録を作る。
async function person(db, n, { daysAgo, provider = 'line', done = '{"1":true}', created = '2026-01-01' }) {
  await db.query('insert into public.users(id, created_at) values ($1, $2)', [U(n), created]);
  await db.query('insert into public.identities(user_id, provider, subject) values ($1, $2, $3)', [U(n), provider, provider === 'line' ? String(n).repeat(64) : 'u' + n + '@example.com']);
  if (daysAgo !== undefined) await db.query('insert into public.progress(user_id, done, updated_at) values ($1, $2::jsonb, $3)', [U(n), done, ago(daysAgo)]);
}
const cand = async (db, floor = FLOOR_OLD) => (await db.query('select user_id from public.nudge_candidates(21, $1::timestamptz)', [floor])).rows.map(r => r.user_id);

test('20日前は対象外、22日前は対象', async () => {
  const db = await open();
  try {
    await person(db, 1, { daysAgo: 20 }); await person(db, 2, { daysAgo: 22 });
    assert.deepEqual(await cand(db), [U(2)]);
  } finally { await db.close(); }
});
test('送ったあと記録なし→対象外／送ったあと記録して22日→また対象', async () => {
  const db = await open();
  try {
    await person(db, 1, { daysAgo: 30 });
    assert.deepEqual(await cand(db), [U(1)]);
    await db.query('select public.mark_nudged($1)', [U(1)]);
    assert.deepEqual(await cand(db), []);
    await db.query('update public.nudges set sent_at = $2 where user_id = $1', [U(1), ago(25)]);   // 印は25日前
    await db.query('update public.progress set updated_at = $2 where user_id = $1', [U(1), ago(22)]); // その後に記録して、また22日あいた
    assert.deepEqual(await cand(db), [U(1)]);
  } finally { await db.close(); }
});
test('戻りに last_at（記録の最後）と listened_count（聴いた回の数）がある', async () => {
  const db = await open();
  try {
    await person(db, 1, { daysAgo: 30 });
    await db.query(`update public.progress set listened = '{"1":1,"2":2,"3":1}' where user_id = $1`, [U(1)]);
    const r = (await db.query('select * from public.nudge_candidates(21, $1::timestamptz)', [FLOOR_OLD])).rows[0];
    assert.equal(r.listened_count, 3);
    assert.equal(r.display_name, null); // 名前が無くても候補には残る
    assert.equal(r.subject, undefined);
    assert.ok(Math.abs(new Date(r.last_at).getTime() - (Date.now() - 30 * DAY)) < 60000);
  } finally { await db.close(); }
});
test('set_line_name：upsert・前後の空白を取る・80字で切る・空なら何もしない／候補に名前が付く', async () => {
  const db = await open();
  try {
    await person(db, 1, { daysAgo: 30 }); await person(db, 2, { daysAgo: 40 });
    const name = n => db.query('select display_name, updated_at from public.line_names where user_id = $1', [U(n)]).then(r => r.rows[0]);
    await db.query('select public.set_line_name($1, $2)', [U(1), '  花子  ']);
    assert.equal((await name(1)).display_name, '花子');
    await db.query('select public.set_line_name($1, $2)', [U(1), '太郎']);
    assert.equal((await name(1)).display_name, '太郎');
    assert.equal((await db.query('select count(*)::int as n from public.line_names')).rows[0].n, 1);
    for (const empty of ['', '   ', null]) await db.query('select public.set_line_name($1, $2)', [U(1), empty]);
    assert.equal((await name(1)).display_name, '太郎');
    await db.query('select public.set_line_name($1, $2)', [U(1), 'あ'.repeat(100)]);
    assert.equal((await name(1)).display_name.length, 80);
    await db.query('select public.set_line_name($1, $2)', [U(1), '太郎']);
    const rows = (await db.query('select user_id, display_name from public.nudge_candidates(21, $1::timestamptz)', [FLOOR_OLD])).rows;
    assert.deepEqual(rows, [{ user_id: U(2), display_name: null }, { user_id: U(1), display_name: '太郎' }]); // 古い順・名前なしは null
  } finally { await db.close(); }
});
test('メールだけの人・記録が空の人・記録の行が無い人・floor より前の人は対象外', async () => {
  const db = await open();
  try {
    await person(db, 1, { daysAgo: 30, provider: 'email' });
    await person(db, 2, { daysAgo: 30, done: '{}' });
    await person(db, 3, { daysAgo: 30 });
    await person(db, 4, {});
    assert.deepEqual(await cand(db), [U(3)]);
    assert.deepEqual(await cand(db, FLOOR), []); // 既定の floor（2027-01-04）より前の記録
    assert.deepEqual(await cand(db, ago(10)), []);
  } finally { await db.close(); }
});
test('権限：service_role だけが呼べ、表は RLS・anon/authenticated は触れない', async () => {
  const db = await open();
  try {
    const fns = ['nudge_candidates(int,timestamptz)', 'mark_nudged(uuid)', 'set_line_name(uuid,text)'];
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query(`select has_table_privilege('${role}', 'public.nudges', 'select') as a`)).rows[0].a, false);
      for (const f of fns) assert.equal((await db.query(`select has_function_privilege('${role}', 'public.${f}', 'execute') as a`)).rows[0].a, false);
    }
    for (const f of fns) assert.equal((await db.query(`select has_function_privilege('service_role', 'public.${f}', 'execute') as a`)).rows[0].a, true);
    assert.equal((await db.query("select relrowsecurity from pg_class where oid = 'public.nudges'::regclass")).rows[0].relrowsecurity, true);
  } finally { await db.close(); }
});
test('2人を1人にまとめる処理のあとも壊れない（消える側の印・名前は一緒に消える）', async () => {
  const db = await open();
  try {
    await person(db, 1, { daysAgo: 30, created: '2026-01-01' });                    // LINE（古い＝残る側）
    await person(db, 2, { daysAgo: 30, provider: 'email', created: '2026-02-01' }); // メール（消える側）
    await db.query('select public.mark_nudged($1)', [U(2)]);
    await db.query('select public.set_line_name($1, $2)', [U(1), '残る側']);
    await db.query('select public.set_line_name($1, $2)', [U(2), '消える側']);
    await db.query("insert into public.link_tickets(token_hash, user_id, provider, subject, expires_at) values ($1, $2, 'email', 'u2@example.com', now() + interval '10 minutes')", ['1'.repeat(64), U(1)]);
    const r = await db.query('select public.resolve_identity($1, $2, $3, true) as u', ['email', 'u2@example.com', '1'.repeat(64)]);
    assert.equal(r.rows[0].u, U(1));
    assert.deepEqual((await db.query('select user_id, display_name from public.line_names')).rows, [{ user_id: U(1), display_name: '残る側' }]);
    assert.equal((await db.query('select count(*)::int as n from public.nudges')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int as n from public.users')).rows[0].n, 1);
    assert.deepEqual(await cand(db), []); // まとめたあとは記録が今に更新される
  } finally { await db.close(); }
});
