'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { runNudge } = require('../lib/nudge');
const { buildNotice } = require('../lib/nudge-message');
const sha = v => createHash('sha256').update(v).digest('hex');
const NOW = Date.parse('2027-02-01T10:00:00+09:00');
const OWNER = 'Uowner0000000000000000000000000000';
const BASE = { LINE_MESSAGING_TOKEN: 'tok-test', NUDGE_NOTIFY_TO: OWNER, NUDGE_OPEN_FROM: '2027-01-20', SUPABASE_URL: 'https://test.supabase.co', ['SUPABASE_SECRET' + '_KEY']: 'sb_' + 'secret_test' };
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const LAST = '2027-01-05T15:30:00Z'; // 日本時間では 1/6
// cands: [{lineId, uid, n}]。pages: followers の各ページ。names: LINE ID→displayName（無ければ profile は404）
function fake({ cands = [], pages = [[]], names = {}, pushStatus = 200 } = {}) {
  const calls = [];
  const f = async (url, opt = {}) => {
    calls.push({ url, opt });
    if (url.includes('/rpc/nudge_candidates')) return json(200, cands.map(c => ({ user_id: c.uid, subject: sha(c.lineId), last_at: LAST, listened_count: c.n ?? 4 })));
    if (url.includes('/rpc/mark_nudged')) return json(200, null);
    if (url.includes('/followers/ids')) {
      const m = /start=([^&]*)/.exec(url), i = m ? Number(decodeURIComponent(m[1])) : 0;
      return json(200, { userIds: pages[i], ...(i + 1 < pages.length ? { next: String(i + 1) } : {}) });
    }
    if (url.includes('/bot/profile/')) { const id = decodeURIComponent(url.split('/bot/profile/')[1]); return names[id] ? json(200, { displayName: names[id] }) : json(404, {}); }
    if (url.endsWith('/message/push')) return json(pushStatus, {});
    throw new Error('unexpected ' + url);
  };
  return { f, calls, marked: () => calls.filter(c => c.url.includes('mark_nudged')).map(c => JSON.parse(c.opt.body).p_user_id), pushed: () => calls.filter(c => c.url.endsWith('/message/push')) };
}
const run = (env, fk, now = NOW) => runNudge({ fetch: fk.f, env: { ...BASE, ...env }, now });
const cs = n => Array.from({ length: n }, (_, i) => ({ lineId: 'U' + String(i).padStart(4, '0'), uid: '00000000-0000-4000-8000-' + String(i).padStart(12, '0') }));
const nm = c => Object.fromEntries(c.map((x, i) => [x.lineId, '花子' + i]));

test('トークンなし・NOTIFY_TOなし・開始日前・開始日なし・終了日後は LINE も DB も呼ばない', async () => {
  for (const [env, code] of [[{ LINE_MESSAGING_TOKEN: '' }, 'no_token'], [{ NUDGE_NOTIFY_TO: '' }, 'no_notify_to'], [{ NUDGE_OPEN_FROM: '2027-02-02' }, 'not_open_yet'], [{ NUDGE_OPEN_FROM: '' }, 'not_open_yet'], [{ NUDGE_OPEN_UNTIL: '2027-01-31' }, 'closed']]) {
    const fk = fake({ cands: cs(1) });
    assert.deepEqual(await run(env, fk), { skipped: code });
    assert.equal(fk.calls.length, 0);
  }
  const fk = fake(); await run({ NUDGE_OPEN_FROM: '2027-02-01', NUDGE_OPEN_UNTIL: '2027-02-01' }, fk); assert.ok(fk.calls.length > 0);
});
test('候補0人なら LINE を呼ばない／友だちに一致が0人なら何も送らない', async () => {
  let fk = fake();
  assert.deepEqual(await run({}, fk), { candidates: 0, matched: 0, notified: 0, failed: 0 });
  assert.ok(!fk.calls.some(c => c.url.includes('line.me')));
  fk = fake({ cands: cs(2), pages: [['Uother']] });
  assert.deepEqual(await run({}, fk), { candidates: 2, matched: 0, notified: 0, failed: 0 });
  assert.equal(fk.pushed().length, 0);
});
test('dry run：送らず印もつけず、名前も取らず人数だけ', async () => {
  const c = cs(2), fk = fake({ cands: c, pages: [c.map(x => x.lineId)] });
  assert.deepEqual(await run({ NUDGE_DRY_RUN: '1' }, fk), { candidates: 2, matched: 2, notified: 0, failed: 0, dry_run: true });
  assert.equal(fk.pushed().length, 0); assert.equal(fk.marked().length, 0);
});
test('通知は1通だけ・宛先は NOTIFY_TO・本人には送らない・一致した全員に印', async () => {
  const c = cs(3), fk = fake({ cands: c, pages: [[c[0].lineId, c[1].lineId, 'Uother']], names: nm(c) });
  assert.deepEqual(await run({}, fk), { candidates: 3, matched: 2, notified: 2, failed: 0 });
  assert.equal(fk.pushed().length, 1);
  const b = JSON.parse(fk.pushed()[0].opt.body);
  assert.equal(b.to, OWNER);
  assert.ok(!fk.pushed().some(p => c.some(x => JSON.parse(p.opt.body).to === x.lineId)));
  assert.equal(b.messages[0].text, buildNotice([{ name: '花子0', lastAt: Date.parse(LAST), listened: 4 }, { name: '花子1', lastAt: Date.parse(LAST), listened: 4 }]));
  assert.match(b.messages[0].text, /記録が3週間以上あいた方が 2人います。/);
  assert.match(b.messages[0].text, /・花子0さん（最後の記録 1\/6・聴いた回 4）/);
  assert.match(b.messages[0].text, /声をかけますか。$/);
  assert.match(fk.pushed()[0].opt.headers['X-Line-Retry-Key'], /^[0-9a-f-]{36}$/);
  assert.deepEqual(fk.marked(), [c[0].uid, c[1].uid]);
});
test('profile が取れない人は「（名前を取得できず）」', async () => {
  const c = cs(1), fk = fake({ cands: c, pages: [[c[0].lineId]] });
  await run({}, fk);
  assert.match(JSON.parse(fk.pushed()[0].opt.body).messages[0].text, /・（名前を取得できず）さん（最後の記録/);
});
test('followers の2ページ目も読む', async () => {
  const c = cs(2), fk = fake({ cands: c, pages: [[c[0].lineId], [c[1].lineId]], names: nm(c) });
  assert.equal((await run({}, fk)).notified, 2);
  assert.equal(fk.calls.filter(x => x.url.includes('/followers/ids')).length, 2);
  assert.equal(fk.pushed().length, 1);
});
test('上限 NUDGE_MAX（既定30）：1通に載せるのは上限まで、印もその人数だけ', async () => {
  const c = cs(35);
  let fk = fake({ cands: c, pages: [c.map(x => x.lineId)] });
  assert.equal((await run({}, fk)).notified, 30);
  assert.equal(fk.pushed().length, 1); assert.equal(fk.marked().length, 30);
  assert.match(JSON.parse(fk.pushed()[0].opt.body).messages[0].text, /30人います/);
  fk = fake({ cands: c, pages: [c.map(x => x.lineId)] });
  assert.equal((await run({ NUDGE_MAX: '5' }, fk)).notified, 5);
});
test('通知が失敗したら誰にも印をつけない', async () => {
  const c = cs(2), fk = fake({ cands: c, pages: [c.map(x => x.lineId)], pushStatus: 429 });
  assert.deepEqual(await run({}, fk), { candidates: 2, matched: 2, notified: 0, failed: 2 });
  assert.equal(fk.marked().length, 0);
});
test('followers が 403 ならその status だけ返して終了。戻り値・ログに名前も ID も入らない', async () => {
  const c = cs(1);
  const f = async url => url.includes('/rpc/') ? json(200, [{ user_id: c[0].uid, subject: sha(c[0].lineId), last_at: LAST, listened_count: 1 }]) : json(403, {});
  assert.deepEqual(await runNudge({ fetch: f, env: BASE, now: NOW }), { candidates: 1, matched: 0, notified: 0, failed: 0, followers_status: 403 });
  const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
  try {
    const r = await run({}, fake({ cands: c, pages: [[c[0].lineId]], names: { [c[0].lineId]: '秘密の名前' } }));
    const text = JSON.stringify(r) + logs.join('\n');
    assert.ok(logs.length > 0);
    for (const bad of [c[0].lineId, c[0].uid, sha(c[0].lineId), '秘密の名前', OWNER]) assert.ok(!text.includes(bad));
  } finally { console.log = orig; }
});
