'use strict';
// progress-sync.js：端末だけ→何も送らない／ログイン済み→merge して置き換える／送れなかった変更を次の init で送り直す。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../progress-sync.js'), 'utf8');
const KEY = 'mimiobo-test-v1-0123456789abcdef0123456789abcdef';
const SUFFIX = KEY.slice(-16);

function storage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => m.delete(k), m };
}
/* server: { loggedIn: 'email'|'line'|null, listened, done, failPost } */
function world({ local = {}, server = {}, liff } = {}) {
  const st = Object.assign({ loggedIn: null, listened: {}, done: {}, failPost: false, failGet: false }, server);
  const log = [];
  const ls = storage(local);
  const fetch = async (url, opt = {}) => {
    const method = opt.method || 'GET', body = opt.body ? JSON.parse(opt.body) : undefined;
    log.push({ url, method, body });
    const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
    if (url === '/api/session') {
      if (method === 'POST') { if (body.idToken === 'good') { st.loggedIn = 'line'; return reply(200, { userId: 'u', storageKey: KEY }); } return reply(401, { error: 'invalid_line_token' }); }
      return st.loggedIn ? reply(200, { userId: 'u', storageKey: KEY, providers: [st.loggedIn] }) : reply(401, { error: 'login_required' });
    }
    if (url === '/api/progress') {
      if (!st.loggedIn) return reply(401, { error: 'login_required' });
      if (method === 'GET') return st.failGet ? reply(503, { error: 'service_unavailable' }) : reply(200, { listened: st.listened, done: st.done, updatedAt: 'x' });
      if (st.failPost) throw new Error('network');
      if (body.merge) { st.listened = Object.assign({}, body.listened, st.listened); st.done = Object.assign({}, body.done, st.done); }
      else { const m = st[body.kind]; if (body.value === null) delete m[body.key]; else m[body.key] = body.value; }
      return reply(200, { listened: st.listened, done: st.done });
    }
    throw new Error('unexpected ' + url);
  };
  const ctx = { localStorage: ls, fetch, liff, setTimeout, clearTimeout, Promise, JSON, Object, Array, Error, String, Number };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { P: ctx.TakkenProgress, ls, st, log, posts: () => log.filter(l => l.url === '/api/progress' && l.method === 'POST') };
}
const parse = (ls, k) => JSON.parse(ls.getItem(k));

test('not logged in: nothing is sent to /api/progress, local data is untouched, state is local', async () => {
  const w = world({ local: { 'takken2027-listened': '{"1":1}' } });
  let changed = 0;
  await w.P.init({ onChange: () => { changed++; } });
  w.P.set('listened', '2', 1);
  assert.equal(w.P.state(), 'local');
  assert.equal(w.log.filter(l => l.url === '/api/progress').length, 0);
  assert.equal(w.ls.getItem('takken2027-listened'), '{"1":1}');
  assert.equal(w.ls.m.size, 1);
  assert.equal(changed, 0);
});

test('logged in by email session: merges the device once, replaces the two local keys with the server result, calls onChange', async () => {
  const w = world({
    local: { 'takken2027-listened': '{"1":1,"2":2}', 'takken2027-done': '{"1":true}' },
    server: { loggedIn: 'email', listened: { '1': 2, '3': 1 }, done: {} },
  });
  let changed = 0;
  await w.P.init({ onChange: () => { changed++; } });
  const merge = w.posts()[0].body;
  assert.deepEqual(merge, { merge: true, listened: { '1': 1, '2': 2 }, done: { '1': true } });
  assert.equal(w.st.listened['1'], 2); // サーバーの値が残る
  assert.deepEqual(parse(w.ls, 'takken2027-listened'), { '1': 2, '2': 2, '3': 1 });
  assert.deepEqual(parse(w.ls, 'takken2027-done'), { '1': true });
  assert.equal(w.ls.getItem('takken2027-synced-' + SUFFIX), '1');
  assert.equal(w.P.state(), 'synced');
  assert.equal(w.P.provider(), 'email');
  assert.equal(changed, 1);
});

test('the merge happens once per user and device: the second init only reads', async () => {
  const w = world({ local: { 'takken2027-listened': '{"1":1}' }, server: { loggedIn: 'email' } });
  await w.P.init({});
  assert.equal(w.posts().length, 1);
  const again = world({ local: Object.fromEntries(w.ls.m), server: { loggedIn: 'email', listened: { '1': 1 } } });
  await again.P.init({});
  assert.equal(again.posts().length, 0);
  assert.equal(again.log.filter(l => l.url === '/api/progress' && l.method === 'GET').length, 1);
});

test('inside LINE: the ID token logs in once (POST /api/session), provider is line; outside LINE it never calls login', async () => {
  const inClient = { init: async () => {}, isInClient: () => true, isLoggedIn: () => true, getIDToken: () => 'good', login: () => { throw new Error('must not redirect'); } };
  const w = world({ liff: inClient });
  await w.P.init({ liffId: '123-abc' });
  assert.equal(w.log.filter(l => l.url === '/api/session' && l.method === 'POST').length, 1);
  assert.equal(w.P.state(), 'synced');
  assert.equal(w.P.provider(), 'line');
  const outside = { init: async () => {}, isInClient: () => false, isLoggedIn: () => false, getIDToken: () => null, login: () => { throw new Error('must not redirect'); } };
  const o = world({ liff: outside });
  await o.P.init({ liffId: '123-abc' });
  assert.equal(o.P.state(), 'local');
  assert.equal(o.log.filter(l => l.method === 'POST').length, 0);
});

test('sessionReady: the page already logged in, so init does not POST /api/session again', async () => {
  const liff = { init: async () => { throw new Error('page already did'); }, isInClient: () => true, isLoggedIn: () => true, getIDToken: () => 'good' };
  const w = world({ liff, server: { loggedIn: 'line' } });
  await w.P.init({ liffId: 'x', sessionReady: true });
  assert.equal(w.log.filter(l => l.url === '/api/session' && l.method === 'POST').length, 0);
  assert.equal(w.P.state(), 'synced');
  assert.equal(w.P.provider(), 'line');
});

test('set() sends one change when logged in; null removes the key; a bad value is ignored', async () => {
  const w = world({ server: { loggedIn: 'email' } });
  await w.P.init({});
  const before = w.posts().length;
  w.P.set('listened', '5', 2);
  w.P.set('done', '5', true);
  w.P.set('listened', '5', null);
  w.P.set('listened', '5', 9);
  w.P.set('other', '5', 1);
  await new Promise(r => setTimeout(r, 20));
  const sent = w.posts().slice(before).map(p => p.body);
  // 同じキーへの続けての変更は、待ち行列の中で最後の1件にまとまる（listened 5 の 2 → null は null だけ送る）
  assert.deepEqual(sent, [{ kind: 'done', key: '5', value: true }, { kind: 'listened', key: '5', value: null }]);
  assert.deepEqual(w.st.listened, {});
  assert.deepEqual(w.st.done, { '5': true });
  assert.equal(w.ls.getItem('takken2027-progress-queue'), '[]');
});

test('a change that could not be sent stays in the queue and is sent first at the next init', async () => {
  const w = world({ server: { loggedIn: 'email' } });
  await w.P.init({});
  w.st.failPost = true;
  w.P.set('listened', '7', 1);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(w.P.state(), 'error');
  const queued = parse(w.ls, 'takken2027-progress-queue');
  assert.deepEqual(queued.map(q => [q.kind, q.key, q.value]), [['listened', '7', 1]]);
  // 端末の記録は画面側が書く：ここでは再現として書いておく
  w.ls.setItem('takken2027-listened', '{"7":1}');
  // 次に開いたとき：サーバーにはまだ無いが、GET で置き換える前に送り直す
  const next = world({ local: Object.fromEntries(w.ls.m), server: { loggedIn: 'email' } });
  await next.P.init({});
  const urls = next.log.filter(l => l.url === '/api/progress').map(l => l.method + (l.body && l.body.merge ? ':merge' : l.body ? ':set' : ''));
  assert.deepEqual(urls, ['POST:set', 'GET']); // 印があるので merge は無く、送り直し→GET の順
  assert.deepEqual(next.st.listened, { '7': 1 });
  assert.deepEqual(parse(next.ls, 'takken2027-listened'), { '7': 1 });
  assert.equal(next.ls.getItem('takken2027-progress-queue'), '[]');
});

test('a change made while init is still checking is applied on top of the server result and sent', async () => {
  const w = world({ server: { loggedIn: 'email', listened: { '1': 1 } } });
  const p = w.P.init({});
  w.P.set('listened', '2', 1); // init の確認中
  await p;
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(parse(w.ls, 'takken2027-listened'), { '1': 1, '2': 1 });
  assert.deepEqual(w.st.listened, { '1': 1, '2': 1 });
});

test('merge failure or GET failure: state error, the local record is kept as it was', async () => {
  const w = world({ local: { 'takken2027-listened': '{"1":1}' }, server: { loggedIn: 'email', failGet: true } });
  await w.P.init({});
  assert.equal(w.P.state(), 'error');
  assert.equal(w.ls.getItem('takken2027-listened'), '{"1":1}');
  const f = world({ local: { 'takken2027-listened': '{"1":1}' }, server: { loggedIn: 'email', failPost: true } });
  await f.P.init({});
  assert.equal(f.P.state(), 'error');
  assert.equal(f.ls.getItem('takken2027-listened'), '{"1":1}');
  assert.equal(f.ls.getItem('takken2027-synced-' + SUFFIX), null); // 失敗したら印はつけない
});

test('old array format and invalid entries are cleaned before the merge is sent; a broken localStorage never throws', async () => {
  const w = world({ local: { 'takken2027-listened': '[1,2]', 'takken2027-done': '{"3":true,"4":"x","a b":true}' }, server: { loggedIn: 'email' } });
  await w.P.init({});
  assert.deepEqual(w.posts()[0].body, { merge: true, listened: { '1': 1, '2': 1 }, done: { '3': true } });
  const broken = world({ local: { 'takken2027-listened': '{oops' }, server: { loggedIn: 'email' } });
  await broken.P.init({});
  assert.equal(broken.P.state(), 'synced');
  const noStorage = world({ server: { loggedIn: 'email' } });
  noStorage.ls.getItem = () => { throw new Error('denied'); };
  noStorage.ls.setItem = () => { throw new Error('denied'); };
  await noStorage.P.init({});
  noStorage.P.set('listened', '1', 1);
});

test('page wiring: roadmap-an2 and ep1-3dan load progress-sync.js, call set(), and the note texts are the three agreed sentences', () => {
  const root = path.join(__dirname, '..');
  const road = fs.readFileSync(path.join(root, 'roadmap-an2.html'), 'utf8');
  const ep = fs.readFileSync(path.join(root, 'ep1-3dan.html'), 'utf8');
  assert.match(road, /<script src="progress-sync\.js"><\/script>/);
  assert.match(road, /TakkenProgress\.set\('listened', n, nx \|\| null\)/);
  assert.match(road, /TakkenProgress\.init\(\{ liffId: window\.TEST_LIFF_ID/);
  for (const t of ['LINEに記録しています。', '機種を変えても残ります。', 'メールアドレスに記録しています。', 'ほかの端末でも同じ記録が出ます。', 'いまは、この端末にだけ残ります。', 'LINEで開くと、', '記録が残ります。']) assert.ok(road.includes(t), t);
  assert.ok(!road.includes('準備しています'));
  assert.match(ep, /<script src="progress-sync\.js"><\/script>/);
  assert.match(ep, /TakkenProgress\.set\('done', m\[1\], true\)/);
  assert.match(ep, /sessionReady: sessionMade/);
  assert.equal((ep.match(/fetch\('\/api\/session'/g) || []).length, 1); // ログインの POST はこのページに1か所だけ
  // 記録の localStorage のキーは変えていない
  assert.ok(road.includes("'takken2027-listened'") && road.includes("'takken2027-done'") && ep.includes("'takken2027-done'"));
});
