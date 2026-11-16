'use strict';
// 202611160001_purchases.sql：帳簿（purchases）・record_purchase・refund_purchase（pglite）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const GONE = '00000000-0000-4000-8000-0000000000ff';
const ALL = ['202609170001_sprint1.sql', '202610060001_sprint2.sql', '202610060002_sprint4_catalog.sql', '202611110001_text_plan.sql', '202611120001_products_2027.sql', '202611130001_progress.sql', '202611130002_open_login.sql', '202611130003_merge_users.sql', '202611130004_progress_kako.sql', '202611160001_purchases.sql'];
const mig = n => fs.readFileSync(path.join(root, 'supabase/migrations', n), 'utf8');

async function open() {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; grant usage on schema public to anon, authenticated, service_role;`);
  for (const n of ALL) await db.exec(mig(n));
  await db.exec(`insert into public.users(id, created_at) values ('${U1}', '2026-01-01'), ('${U2}', '2026-02-01')`);
  return db;
}
// record_purchase を既定値つきで呼ぶ。over で差し替える。
const SQL = 'select public.record_purchase($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as r';
function args(over = {}) {
  const a = { user: U1, plan: 'text', until: '2027-10-17T14:59:59Z', source: 'stripe:cs_test_1', event: 'evt_1', product: 'text', amount: 2480, currency: 'jpy', list: 2980, kind: 'start', pi: 'pi_test_1', at: '2027-01-05T03:00:00Z', live: false, ...over };
  return [a.user, a.plan, a.until, a.source, a.event, a.product, a.amount, a.currency, a.list, a.kind, a.pi, a.at, a.live];
}
const buy = async (db, over) => (await db.query(SQL, args(over))).rows[0].r;
const refund = async (db, key, amount, at = '2027-02-01T00:00:00Z') => (await db.query('select public.refund_purchase($1,$2,$3) as r', [key, amount, at])).rows[0].r;
const count = async (db, t) => (await db.query(`select count(*)::int as n from public.${t}`)).rows[0].n;

test('record_purchase: granted writes one ledger row and one entitlement; duplicate adds nothing', async () => {
  const db = await open();
  try {
    assert.equal(await buy(db), 'granted');
    assert.equal(await count(db, 'purchases'), 1);
    assert.equal(await count(db, 'entitlements'), 1);
    const row = (await db.query('select * from public.purchases')).rows[0];
    assert.deepEqual([row.product, row.plan, row.amount, row.currency, row.list_price, row.price_kind, row.stripe_session_id, row.stripe_payment_intent, row.livemode, row.refunded_at, row.refund_amount],
      ['text', 'text', 2480, 'jpy', 2980, 'start', 'cs_test_1', 'pi_test_1', false, null, null]);
    assert.equal(new Date(row.purchased_at).toISOString(), '2027-01-05T03:00:00.000Z');
    // 同じ支払いが別のイベントで届いても増えない
    assert.equal(await buy(db), 'duplicate');
    assert.equal(await buy(db, { event: 'evt_2' }), 'duplicate');
    assert.equal(await count(db, 'purchases'), 1);
    assert.equal(await count(db, 'entitlements'), 1);
    // 別の支払いは別の行
    assert.equal(await buy(db, { source: 'stripe:cs_test_2', event: 'evt_3', pi: null, list: null, kind: 'tsujo', amount: 2980 }), 'granted');
    assert.equal(await count(db, 'purchases'), 2);
    const second = (await db.query("select * from public.purchases where stripe_session_id = 'cs_test_2'")).rows[0];
    assert.deepEqual([second.stripe_payment_intent, second.list_price, second.price_kind], [null, null, 'tsujo']);
  } finally { await db.close(); }
});

test('record_purchase: unknown user still writes the ledger row, grants nothing', async () => {
  const db = await open();
  try {
    assert.equal(await buy(db, { user: GONE }), 'unknown_user');
    assert.equal(await count(db, 'purchases'), 1);
    assert.equal(await count(db, 'entitlements'), 0);
    assert.equal(await buy(db, { user: GONE, event: 'evt_9' }), 'unknown_user');
    assert.equal(await count(db, 'purchases'), 1, '二重に届いても増えない');
  } finally { await db.close(); }
});

test('purchases has no person column and survives deleting users and entitlements', async () => {
  const db = await open();
  try {
    const cols = (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'purchases'")).rows.map(r => r.column_name);
    assert.equal(cols.some(c => /user|mail|subject|identity/.test(c)), false, cols.join());
    await buy(db);
    await db.exec('delete from public.entitlements; delete from public.stripe_events; delete from public.users;');
    assert.equal(await count(db, 'users'), 0);
    assert.equal(await count(db, 'purchases'), 1);
  } finally { await db.close(); }
});

test('refund_purchase: full refund removes the entitlement, partial keeps it, not_found, already', async () => {
  const db = await open();
  try {
    await buy(db);
    await buy(db, { source: 'stripe:cs_test_2', event: 'evt_2', pi: 'pi_test_2', user: U2 });
    // 一部（pi_ でも引ける）
    assert.equal(await refund(db, 'pi_test_1', 1000), 'partial');
    assert.equal(await count(db, 'entitlements'), 2);
    let row = (await db.query("select refunded_at, refund_amount from public.purchases where stripe_session_id = 'cs_test_1'")).rows[0];
    assert.equal(row.refund_amount, 1000);
    assert.equal(new Date(row.refunded_at).toISOString(), '2027-02-01T00:00:00.000Z');
    // すでに記録ずみ
    assert.equal(await refund(db, 'cs_test_1', 2480), 'already');
    assert.equal(await count(db, 'entitlements'), 2);
    row = (await db.query("select refund_amount from public.purchases where stripe_session_id = 'cs_test_1'")).rows[0];
    assert.equal(row.refund_amount, 1000, 'already は何も書き換えない');
    // 全額（cs_ で引く）：その支払いの権利だけ消える
    assert.equal(await refund(db, 'cs_test_2', 2480), 'refunded');
    const left = (await db.query('select user_id, source from public.entitlements')).rows;
    assert.deepEqual(left, [{ user_id: U1, source: 'stripe:cs_test_1' }]);
    assert.equal(await count(db, 'purchases'), 2, '帳簿の行は消さない');
    // 全額超えも全額
    await buy(db, { source: 'stripe:cs_test_3', event: 'evt_3', pi: 'pi_test_3' });
    assert.equal(await refund(db, 'pi_test_3', 9999), 'refunded');
    // 見つからない
    assert.equal(await refund(db, 'cs_nope', 100), 'not_found');
    assert.equal(await refund(db, 'pi_nope', 100), 'not_found');
  } finally { await db.close(); }
});

test('invalid arguments raise 22023', async () => {
  const db = await open();
  try {
    const bad = [
      { user: null }, { plan: 'matome' }, { plan: null }, { source: 'manual:x' }, { source: 'stripe:xx_1' }, { source: null }, { event: '' },
      { product: null }, { product: '' }, { amount: -1 }, { amount: null }, { currency: null }, { list: -5 }, { kind: 'other' }, { kind: null },
      { pi: 'x' }, { at: null }, { at: 'infinity' }, { live: null }, { until: 'infinity' }
    ];
    for (const over of bad) {
      await assert.rejects(() => buy(db, over), e => e.code === '22023' || /invalid_purchase/.test(e.message), JSON.stringify(over));
    }
    assert.equal(await count(db, 'purchases'), 0);
    for (const [key, amount] of [[null, 1], ['abc', 1], ['cs_x', -1], ['cs_x', null], ['', 1]]) {
      await assert.rejects(() => refund(db, key, amount), e => e.code === '22023' || /invalid_refund/.test(e.message), String(key) + amount);
    }
    // 表の検査も効く
    await assert.rejects(db.exec("insert into public.purchases(purchased_at,product,plan,amount,currency,price_kind,stripe_session_id,livemode) values (now(),'t','text',1,'jpy','bogus','cs_x',false)"));
    await assert.rejects(db.exec("insert into public.purchases(purchased_at,product,plan,amount,currency,price_kind,stripe_session_id,livemode) values (now(),'t','text',-1,'jpy','tsujo','cs_y',false)"));
  } finally { await db.close(); }
});

test('RLS and privileges: only service_role can touch purchases and the new functions; old grant_entitlement still works', async () => {
  const db = await open();
  try {
    assert.equal((await db.query("select relrowsecurity from pg_class where oid = 'public.purchases'::regclass")).rows[0].relrowsecurity, true);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query("select has_table_privilege($1, 'public.purchases', 'select') as p", [role])).rows[0].p, false, role);
      assert.equal((await db.query("select has_function_privilege($1, 'public.refund_purchase(text,integer,timestamptz)', 'execute') as p", [role])).rows[0].p, false, role);
      assert.equal((await db.query("select has_function_privilege($1, 'public.record_purchase(uuid,text,timestamptz,text,text,text,integer,text,integer,text,text,timestamptz,boolean)', 'execute') as p", [role])).rows[0].p, false, role);
    }
    assert.equal((await db.query("select has_table_privilege('service_role', 'public.purchases', 'select') as p")).rows[0].p, true);
    assert.equal((await db.query("select has_function_privilege('service_role', 'public.refund_purchase(text,integer,timestamptz)', 'execute') as p")).rows[0].p, true);
    // 旧 grant_entitlement（5引数）は今までどおり：付与・二重・不明な利用者・不正な plan
    const g = (u, plan, src) => db.query('select public.grant_entitlement($1,$2,null,$3,$4) as r', [u, plan, src, 'evt:' + src]).then(r => r.rows[0].r);
    assert.equal(await g(U1, 'ume', 'stripe:cs_old_1'), 'granted');
    assert.equal(await g(U1, 'ume', 'stripe:cs_old_1'), 'duplicate');
    assert.equal(await g(GONE, 'ume', 'stripe:cs_old_2'), 'unknown_user');
    await assert.rejects(() => g(U1, 'matome', 'stripe:cs_old_3'), /invalid_entitlement/);
    assert.equal(await count(db, 'purchases'), 0, '旧関数は帳簿に触らない');
  } finally { await db.close(); }
});
