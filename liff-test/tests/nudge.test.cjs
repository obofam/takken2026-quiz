'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { runNudge } = require('../lib/nudge');
const { NUDGE_TEXT } = require('../lib/nudge-message');
const sha = v => createHash('sha256').update(v).digest('hex');
const NOW = Date.parse('2027-02-01T10:00:00+09:00');
const BASE = { LINE_MESSAGING_TOKEN: 'tok-test', NUDGE_OPEN_FROM: '2027-01-20', SUPABASE_URL: 'https://test.supabase.co', ['SUPABASE_SECRET' + '_KEY']: 'sb_' + 'secret_test' };
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
// cands: 候補 [{lineId, uid}]。pages: followers の各ページ。pushStatus: LINE ID→status
function fake({ cands = [], pages = [[]], pushStatus = {} } = {}) {
  const calls = [];
  const f = async (url, opt = {}) => {
    calls.push({ url, opt });
    if (url.includes('/rpc/nudge_candidates')) return json(200, cands.map(c => ({ user_id: c.uid, subject: sha(c.lineId) })));
    if (url.includes('/rpc/mark_nudged')) return json(200, null);
    if (url.includes('/followers/ids')) {
      const m = /start=([^&]*)/.exec(url), i = m ? Number(decodeURIComponent(m[1])) : 0;
      return json(200, { userIds: pages[i], ...(i + 1 < pages.length ? { next: String(i + 1) } : {}) });
    }
    if (url.endsWith('/message/push')) return json(pushStatus[JSON.parse(opt.body).to] || 200, {});
    throw new Error('unexpected ' + url);
  };
  return { f, calls, marked: () => calls.filter(c => c.url.includes('mark_nudged')).map(c => JSON.parse(c.opt.body).p_user_id), pushed: () => calls.filter(c => c.url.endsWith('/message/push')) };
}
const run = (env, fk, now = NOW) => runNudge({ fetch: fk.f, env: { ...BASE, ...env }, now });
const cs = n => Array.from({ length: n }, (_, i) => ({ lineId: 'U' + String(i).padStart(4, '0'), uid: '00000000-0000-4000-8000-' + String(i).padStart(12, '0') }));

test('トークンなし・開始日前・開始日なし・終了日後は LINE も DB も呼ばない', async () => {
  for (const [env, code] of [[{ LINE_MESSAGING_TOKEN: '' }, 'no_token'], [{ NUDGE_OPEN_FROM: '2027-02-02' }, 'not_open_yet'], [{ NUDGE_OPEN_FROM: '' }, 'not_open_yet'], [{ NUDGE_OPEN_UNTIL: '2027-01-31' }, 'closed']]) {
    const fk = fake({ cands: cs(1) });
    assert.deepEqual(await run(env, fk), { skipped: code });
    assert.equal(fk.calls.length, 0);
  }
  const fk = fake(); await run({ NUDGE_OPEN_FROM: '2027-02-01', NUDGE_OPEN_UNTIL: '2027-02-01' }, fk); assert.ok(fk.calls.length > 0); // 当日は動く
});
test('候補0人なら LINE を呼ばない', async () => {
  const fk = fake();
  assert.deepEqual(await run({}, fk), { candidates: 0, matched: 0, sent: 0, failed: 0 });
  assert.ok(!fk.calls.some(c => c.url.includes('line.me')));
});
test('dry run：送らず印もつけず人数だけ', async () => {
  const c = cs(2), fk = fake({ cands: c, pages: [c.map(x => x.lineId)] });
  assert.deepEqual(await run({ NUDGE_DRY_RUN: '1' }, fk), { candidates: 2, matched: 2, sent: 0, failed: 0, dry_run: true });
  assert.equal(fk.pushed().length, 0); assert.equal(fk.marked().length, 0);
});
test('友だちでない候補には送らない／友だちだけ送って印をつける・文面と retry key', async () => {
  const c = cs(3), fk = fake({ cands: c, pages: [[c[0].lineId, 'Uother']] });
  assert.deepEqual(await run({}, fk), { candidates: 3, matched: 1, sent: 1, failed: 0 });
  assert.deepEqual(fk.marked(), [c[0].uid]);
  const p = fk.pushed()[0];
  assert.equal(JSON.parse(p.opt.body).to, c[0].lineId); assert.equal(JSON.parse(p.opt.body).messages[0].text, NUDGE_TEXT);
  assert.match(p.opt.headers['X-Line-Retry-Key'], /^[0-9a-f-]{36}$/);
  assert.equal(p.opt.headers.Authorization, 'Bearer tok-test');
});
test('followers の2ページ目も読む', async () => {
  const c = cs(2), fk = fake({ cands: c, pages: [[c[0].lineId], [c[1].lineId]] });
  assert.equal((await run({}, fk)).sent, 2);
  assert.equal(fk.calls.filter(x => x.url.includes('/followers/ids')).length, 2);
});
test('上限 NUDGE_MAX（既定30）', async () => {
  const c = cs(35);
  assert.equal((await run({}, fake({ cands: c, pages: [c.map(x => x.lineId)] }))).sent, 30);
  assert.equal((await run({ NUDGE_MAX: '5' }, fake({ cands: c, pages: [c.map(x => x.lineId)] }))).sent, 5);
});
test('push が失敗した人には印をつけない', async () => {
  const c = cs(2), fk = fake({ cands: c, pages: [c.map(x => x.lineId)], pushStatus: { [c[0].lineId]: 429 } });
  assert.deepEqual(await run({}, fk), { candidates: 2, matched: 2, sent: 1, failed: 1 });
  assert.deepEqual(fk.marked(), [c[1].uid]);
});
test('followers が 403 ならその status だけ返して終了。戻り値・ログに ID が入らない', async () => {
  const c = cs(1);
  const f = async url => url.includes('/rpc/') ? json(200, [{ user_id: c[0].uid, subject: sha(c[0].lineId) }]) : json(403, {});
  assert.deepEqual(await runNudge({ fetch: f, env: BASE, now: NOW }), { candidates: 1, matched: 0, sent: 0, failed: 0, followers_status: 403 });
  const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
  try {
    const r = await run({}, fake({ cands: c, pages: [[c[0].lineId]] }));
    const text = JSON.stringify(r) + logs.join('\n');
    assert.ok(logs.length > 0 && !text.includes(c[0].lineId) && !text.includes(c[0].uid) && !text.includes(sha(c[0].lineId)));
  } finally { console.log = orig; }
});
