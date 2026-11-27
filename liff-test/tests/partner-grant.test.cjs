'use strict';
// scripts/partner-grant.mjs：パートナー経由の権限付与（pglite。ネットワークの部分は差し替え）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const ALL = ['202609170001_sprint1.sql', '202610060001_sprint2.sql', '202610060002_sprint4_catalog.sql', '202611110001_text_plan.sql', '202611120001_products_2027.sql', '202611130001_progress.sql', '202611130002_open_login.sql', '202611130003_merge_users.sql', '202611130004_progress_kako.sql', '202611160001_purchases.sql', '202611170001_progress_ox.sql'];
const mig = n => fs.readFileSync(path.join(root, 'supabase/migrations', n), 'utf8');
const U1 = '00000000-0000-4000-8000-000000000001';
const mod = () => import(path.join(root, 'scripts/partner-grant.mjs').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));

async function open() {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; grant usage on schema public to anon, authenticated, service_role;`);
  for (const n of ALL) await db.exec(mig(n));
  await db.exec(`insert into public.users(id) values ('${U1}'); insert into public.identities(user_id, provider, subject) values ('${U1}', 'email', 'taro@example.com')`);
  return db;
}
// REST の代わりに pglite へ直接つなぐ io。
function io(db) {
  return {
    findUser: async e => (await db.query("select user_id from public.identities where provider='email' and subject=$1", [e])).rows[0]?.user_id || null,
    createUser: async e => {
      const id = (await db.query('insert into public.users default values returning id')).rows[0].id;
      await db.query("insert into public.identities(user_id, provider, subject) values ($1,'email',$2)", [id, e]);
      return id;
    },
    grant: async (u, p, until, s) => (await db.query('select public.grant_entitlement($1,$2,$3,$4,$4) as r', [u, p, until, s])).rows[0].r,
    revoke: async s => (await db.query('delete from public.entitlements where source=$1 returning 1', [s])).rows.length,
    list: async partner => (await db.query("select e.plan, e.valid_until, (select subject from public.identities i where i.user_id=e.user_id and i.provider='email' limit 1) as email from public.entitlements e where e.source like $1", ['partner:' + partner + ':%'])).rows
  };
}
const count = async (db, t) => (await db.query(`select count(*)::int as n from public.${t}`)).rows[0].n;

test('existing email user gets the plan; source has hash not email; default expiry', async () => {
  const m = await mod(), db = await open();
  try {
    const r = await m.run(io(db), { email: '  Taro@Example.com ', plan: 'text', partner: 'acme-1' });
    assert.equal(r.result, 'granted');
    assert.equal(r.createdUser, false);
    const row = (await db.query('select * from public.entitlements')).rows[0];
    assert.equal(row.user_id, U1);
    assert.equal(row.plan, 'text');
    assert.match(row.source, /^partner:acme-1:text:[0-9a-f]{12}$/);
    assert.equal(row.source.includes('taro'), false);
    assert.equal(new Date(row.valid_until).toISOString(), '2027-10-17T14:59:59.000Z');
    assert.equal(await count(db, 'users'), 1);
  } finally { await db.close(); }
});

test('unknown email: user+identity are pre-created and the later login (resolve_identity) lands on the same user', async () => {
  const m = await mod(), db = await open();
  try {
    const r = await m.run(io(db), { email: 'new@example.com', plan: 'bansou', partner: 'acme' });
    assert.equal(r.result, 'granted');
    assert.equal(r.createdUser, true);
    assert.equal(await count(db, 'users'), 2);
    const ent = (await db.query('select user_id from public.entitlements')).rows[0].user_id;
    const login = (await db.query("select public.resolve_identity('email','new@example.com',null,true) as u")).rows[0].u;
    assert.equal(login, ent, '合流する');
    assert.equal(await count(db, 'users'), 2, '新しい users はできない');
    assert.equal(await count(db, 'identities'), 2);
  } finally { await db.close(); }
});

test('same spec twice is duplicate; --until is end of JST day; dry-run writes nothing', async () => {
  const m = await mod(), db = await open();
  try {
    const o = { email: 'taro@example.com', plan: 'last30', partner: 'acme', until: '2027-03-31' };
    const d = await m.run(io(db), { ...o, dryRun: true });
    assert.equal(d.dryRun, true);
    assert.equal(await count(db, 'entitlements'), 0);
    const dn = await m.run(io(db), { ...o, email: 'nobody@example.com', dryRun: true });
    assert.equal(dn.willCreateUser, true);
    assert.equal(await count(db, 'users'), 1, 'dry-run は users も作らない');
    assert.equal((await m.run(io(db), o)).result, 'granted');
    assert.equal((await m.run(io(db), o)).result, 'duplicate');
    assert.equal(await count(db, 'entitlements'), 1);
    assert.equal(new Date((await db.query('select valid_until from public.entitlements')).rows[0].valid_until).toISOString(), '2027-03-31T14:59:59.000Z');
  } finally { await db.close(); }
});

test('revoke removes only the same source; other partner / plan / stripe rows stay; list masks email', async () => {
  const m = await mod(), db = await open();
  try {
    const e = 'taro@example.com';
    await m.run(io(db), { email: e, plan: 'text', partner: 'acme' });
    await m.run(io(db), { email: e, plan: 'last30', partner: 'acme' });
    await m.run(io(db), { email: e, plan: 'text', partner: 'other' });
    await db.query("select public.grant_entitlement($1,'text',null,'stripe:cs_test_1','evt_1')", [U1]);
    assert.equal(await count(db, 'entitlements'), 4);
    const l = await m.run(io(db), { list: true, partner: 'acme' });
    assert.equal(l.rows.length, 2);
    assert.ok(l.rows.every(r => r.email === 't***@example.com'));
    assert.equal(JSON.stringify(l).includes('taro'), false);
    assert.equal((await m.run(io(db), { email: ' TARO@example.com', plan: 'text', partner: 'acme', revoke: true })).removed, 1);
    assert.equal((await m.run(io(db), { email: e, plan: 'text', partner: 'acme', revoke: true })).removed, 0);
    const left = (await db.query('select source from public.entitlements order by source')).rows.map(r => r.source.split(':').slice(0, 3).join(':'));
    assert.deepEqual(left, ['partner:acme:last30', 'partner:other:text', 'stripe:cs_test_1']);
    assert.equal(await count(db, 'purchases'), 0, '帳簿には入らない');
  } finally { await db.close(); }
});

test('invalid plan / partner / email / until are rejected before touching the db', async () => {
  const m = await mod(), db = await open();
  try {
    const good = { email: 'taro@example.com', plan: 'text', partner: 'acme' };
    for (const [over, msg] of [[{ plan: 'take' }, 'invalid_plan'], [{ plan: 'zenbu' }, 'invalid_plan'], [{ plan: undefined }, 'invalid_plan'], [{ partner: 'a_b' }, 'invalid_partner'], [{ partner: 'a:b' }, 'invalid_partner'], [{ partner: '日本' }, 'invalid_partner'], [{ partner: '' }, 'invalid_partner'], [{ partner: undefined }, 'invalid_partner'], [{ email: 'abc' }, 'invalid_email'], [{ email: 'a b@x.com' }, 'invalid_email'], [{ email: '' }, 'invalid_email'], [{ email: undefined }, 'invalid_email'], [{ until: '2027-02-30' }, 'invalid_until'], [{ until: '2027/03/01' }, 'invalid_until']]) {
      await assert.rejects(() => m.run(io(db), { ...good, ...over }), e => e.message === msg, JSON.stringify(over));
    }
    await assert.rejects(() => m.run(io(db), { list: true, partner: 'x y' }), /invalid_partner/);
    assert.equal(await count(db, 'entitlements'), 0);
    assert.equal(await count(db, 'users'), 1);
    assert.deepEqual(m.parseArgs(['A@b.co', 'text', '--partner', 'p', '--dry-run']), { dryRun: true, revoke: false, list: false, partner: 'p', email: 'A@b.co', plan: 'text' });
    assert.throws(() => m.parseArgs(['a@b.co', 'text', '--partner']), /usage/);
    assert.throws(() => m.parseArgs(['a@b.co']), /usage/);
  } finally { await db.close(); }
});
