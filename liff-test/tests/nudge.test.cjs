'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runNudge } = require('../lib/nudge');
const { buildNotice } = require('../lib/nudge-message');
const NOW = Date.parse('2027-02-01T10:00:00+09:00');
const OWNER = 'Uowner0000000000000000000000000000';
const BASE = { LINE_MESSAGING_TOKEN: 'tok-test', NUDGE_NOTIFY_TO: OWNER, NUDGE_OPEN_FROM: '2027-01-20', SUPABASE_URL: 'https://test.supabase.co', ['SUPABASE_SECRET' + '_KEY']: 'sb_' + 'secret_test' };
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const LAST = '2027-01-05T15:30:00Z'; // 日本時間では 1/6
// cands: DB の候補（古い順）[{uid, name, n}]
function fake({ cands = [], pushStatus = 200 } = {}) {
  const calls = [];
  const f = async (url, opt = {}) => {
    calls.push({ url, opt });
    if (url.includes('/rpc/nudge_candidates')) return json(200, cands.map(c => ({ user_id: c.uid, display_name: c.name ?? null, last_at: LAST, listened_count: c.n ?? 4 })));
    if (url.includes('/rpc/mark_nudged')) return json(200, null);
    if (url.endsWith('/message/push')) return json(pushStatus, {});
    throw new Error('unexpected ' + url);
  };
  return { f, calls, marked: () => calls.filter(c => c.url.includes('mark_nudged')).map(c => JSON.parse(c.opt.body).p_user_id), pushed: () => calls.filter(c => c.url.endsWith('/message/push')) };
}
const run = (env, fk, now = NOW) => runNudge({ fetch: fk.f, env: { ...BASE, ...env }, now });
const cs = (n, named = true) => Array.from({ length: n }, (_, i) => ({ uid: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'), name: named ? '花子' + i : null }));

test('トークンなし・NOTIFY_TOなし・開始日前・開始日なし・終了日後は LINE も DB も呼ばない', async () => {
  for (const [env, code] of [[{ LINE_MESSAGING_TOKEN: '' }, 'no_token'], [{ NUDGE_NOTIFY_TO: '' }, 'no_notify_to'], [{ NUDGE_OPEN_FROM: '2027-02-02' }, 'not_open_yet'], [{ NUDGE_OPEN_FROM: '' }, 'not_open_yet'], [{ NUDGE_OPEN_UNTIL: '2027-01-31' }, 'closed']]) {
    const fk = fake({ cands: cs(1) });
    assert.deepEqual(await run(env, fk), { skipped: code });
    assert.equal(fk.calls.length, 0);
  }
  const fk = fake(); await run({ NUDGE_OPEN_FROM: '2027-02-01', NUDGE_OPEN_UNTIL: '2027-02-01' }, fk); assert.ok(fk.calls.length > 0);
});
test('候補0人なら LINE を呼ばない', async () => {
  const fk = fake();
  assert.deepEqual(await run({}, fk), { candidates: 0, notified: 0, failed: 0 });
  assert.ok(!fk.calls.some(c => c.url.includes('line.me')));
});
test('dry run：送らず印もつけず人数だけ', async () => {
  const fk = fake({ cands: cs(2) });
  assert.deepEqual(await run({ NUDGE_DRY_RUN: '1' }, fk), { candidates: 2, notified: 0, failed: 0, dry_run: true });
  assert.equal(fk.pushed().length, 0); assert.equal(fk.marked().length, 0);
});
test('通知は1通だけ・宛先は NOTIFY_TO・全員に印・文面は buildNotice', async () => {
  const c = cs(2), fk = fake({ cands: c });
  assert.deepEqual(await run({}, fk), { candidates: 2, notified: 2, failed: 0 });
  assert.equal(fk.pushed().length, 1);
  const b = JSON.parse(fk.pushed()[0].opt.body);
  assert.equal(b.to, OWNER);
  const p = x => ({ lastAt: Date.parse(LAST), listened: 4, name: x });
  assert.equal(b.messages[0].text, buildNotice([p('花子0'), p('花子1')]));
  assert.match(b.messages[0].text, /記録が3週間以上あいた方が 2人います。/);
  assert.match(b.messages[0].text, /・花子0さん（最後の記録 1\/6・聴いた回 4）/);
  assert.match(b.messages[0].text, /声をかけますか。$/);
  assert.match(fk.pushed()[0].opt.headers['X-Line-Retry-Key'], /^[0-9a-f-]{36}$/);
  assert.deepEqual(fk.marked(), c.map(x => x.uid));
});
test('名前が無い人は「（名前なし）」', async () => {
  const fk = fake({ cands: cs(1, false) });
  await run({}, fk);
  assert.match(JSON.parse(fk.pushed()[0].opt.body).messages[0].text, /・（名前なし）さん（最後の記録/);
});
test('友だち一覧・プロフィールの URL を一切呼ばない', async () => {
  const fk = fake({ cands: cs(3) });
  await run({}, fk);
  assert.ok(!fk.calls.some(c => /followers|\/bot\/profile/.test(c.url)));
  assert.deepEqual([...new Set(fk.calls.map(c => c.url.replace(/^https:\/\/[^/]+/, '').replace(/\?.*/, '')))].sort(), ['/rest/v1/rpc/mark_nudged', '/rest/v1/rpc/nudge_candidates', '/v2/bot/message/push']);
});
test('上限 NUDGE_MAX（既定30）：1通に載せるのは古い順に上限まで、印もその人数だけ', async () => {
  const c = cs(35);
  let fk = fake({ cands: c });
  assert.deepEqual(await run({}, fk), { candidates: 35, notified: 30, failed: 0 });
  assert.equal(fk.pushed().length, 1); assert.deepEqual(fk.marked(), c.slice(0, 30).map(x => x.uid));
  assert.match(JSON.parse(fk.pushed()[0].opt.body).messages[0].text, /30人います/);
  fk = fake({ cands: c });
  assert.equal((await run({ NUDGE_MAX: '5' }, fk)).notified, 5);
});
test('通知が失敗したら誰にも印をつけない', async () => {
  const fk = fake({ cands: cs(2), pushStatus: 429 });
  assert.deepEqual(await run({}, fk), { candidates: 2, notified: 0, failed: 2 });
  assert.equal(fk.marked().length, 0);
});
test('戻り値・ログに名前も ID も入らない', async () => {
  const c = [{ uid: '00000000-0000-4000-8000-000000000009', name: '秘密の名前' }];
  const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
  try {
    const r = await run({}, fake({ cands: c }));
    const text = JSON.stringify(r) + logs.join('\n');
    assert.ok(logs.length > 0);
    for (const bad of [c[0].uid, '秘密の名前', OWNER]) assert.ok(!text.includes(bad));
  } finally { console.log = orig; }
});
