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
/* server: { loggedIn: 'email'|'line'|null, listened, done, kako, ox, failPost }（kako・ox を渡さない＝古いサーバー：kako を返さず、kako の変更は 400） */
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
      const out = () => Object.assign({ listened: st.listened, done: st.done }, st.kako ? { kako: st.kako } : {}, st.ox ? { ox: st.ox } : {});
      if (method === 'GET') return st.failGet ? reply(503, { error: 'service_unavailable' }) : reply(200, Object.assign(out(), { updatedAt: 'x' }));
      if (st.failPost) throw new Error('network');
      if (body.merge) { st.listened = Object.assign({}, body.listened, st.listened); st.done = Object.assign({}, body.done, st.done); if (st.kako) st.kako = Object.assign({}, body.kako, st.kako); if (st.ox) st.ox = Object.assign({}, body.ox, st.ox); }
      else { if ((body.kind === 'kako' && !st.kako) || (body.kind === 'ox' && !st.ox)) return reply(400, { error: 'invalid_progress' }); const m = st[body.kind]; if (body.value === null) delete m[body.key]; else m[body.key] = body.value; }
      return reply(200, out());
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
  assert.deepEqual(merge, { merge: true, listened: { '1': 1, '2': 2 }, done: { '1': true }, kako: {}, ox: {} });
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
  assert.deepEqual(w.posts()[0].body, { merge: true, listened: { '1': 1, '2': 1 }, done: { '3': true }, kako: {}, ox: {} });
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

test('cookieHint: ログインの印がなければ /api/session を呼ばない（401を出さない）。印があれば同期し、401なら印を消す。同期できたら印が付く', async () => {
  const w = world({ server: { loggedIn: null } });
  await w.P.init({ cookieHint: true });
  assert.equal(w.log.length, 0);
  assert.equal(w.P.state(), 'local');
  const w2 = world({ local: { 'takken2027-login-hint': '1' }, server: { loggedIn: null } });
  await w2.P.init({ cookieHint: true });
  assert.equal(w2.log.filter(l => l.url === '/api/session').length, 1);
  assert.equal(w2.ls.getItem('takken2027-login-hint'), null);
  const w3 = world({ local: { 'takken2027-login-hint': '1' }, server: { loggedIn: 'email' } });
  await w3.P.init({ cookieHint: true });
  assert.equal(w3.P.state(), 'synced');
  assert.equal(w3.ls.getItem('takken2027-login-hint'), '1');
  /* 指定しなければ今までどおり（印なしでも問い合わせる） */
  const w4 = world({ server: { loggedIn: 'email' } });
  await w4.P.init({});
  assert.equal(w4.P.state(), 'synced');
});

/* ---- 過去問1選の結果（kako）：3つ目の種類 ---- */
test('kako: the device value is merged once, the server value wins on the same key, and the two sides are made equal', async () => {
  const w = world({
    local: { 'takken2027-kako': '{"1":1,"2":2,"a b":1,"3":3}' },
    server: { loggedIn: 'email', kako: { '2': 1, '5': 2 } },
  });
  await w.P.init({});
  assert.deepEqual(w.posts()[0].body.kako, { '1': 1, '2': 2 }); // 値が 1・2 でないものと、キーの決まりに合わないものは送らない
  assert.deepEqual(w.st.kako, { '1': 1, '2': 1, '5': 2 });      // 同じキーはサーバーの値が残る
  assert.deepEqual(parse(w.ls, 'takken2027-kako'), { '1': 1, '2': 1, '5': 2 });
  assert.equal(w.P.state(), 'synced');
});
test('kako: set() sends kind kako (1 or 2 only, null removes), overwriting by the last value', async () => {
  const w = world({ server: { loggedIn: 'email', kako: {} } });
  await w.P.init({});
  const before = w.posts().length;
  w.P.set('kako', '1', 1);
  w.P.set('kako', '1', 2);
  w.P.set('kako', '2', 3);     // 無視
  w.P.set('kako', '2', true);  // 無視
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(w.posts().slice(before).map(p => p.body), [{ kind: 'kako', key: '1', value: 2 }]);
  assert.deepEqual(w.st.kako, { '1': 2 });
  assert.equal(w.ls.getItem('takken2027-progress-queue'), '[]');
});
test('kako: not logged in sends nothing and leaves the device value alone', async () => {
  const w = world({ local: { 'takken2027-kako': '{"1":1}' } });
  await w.P.init({});
  w.P.set('kako', '1', 2);
  assert.equal(w.log.filter(l => l.url === '/api/progress').length, 0);
  assert.equal(w.ls.getItem('takken2027-kako'), '{"1":1}');
});
test('kako: an old server (no kako in the reply) does not break anything; the device value stays and the change waits in the queue', async () => {
  const w = world({ local: { 'takken2027-kako': '{"1":1}', 'takken2027-listened': '{"1":1}' }, server: { loggedIn: 'email', listened: { '2': 1 } } });
  await w.P.init({});
  assert.equal(w.P.state(), 'synced');
  assert.deepEqual(parse(w.ls, 'takken2027-kako'), { '1': 1 });          // 端末の値は消えない
  assert.deepEqual(parse(w.ls, 'takken2027-listened'), { '1': 1, '2': 1 }); // 聴いたは今までどおり
  w.P.set('kako', '3', 2);
  w.P.set('listened', '4', 1);
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(w.st.listened, { '1': 1, '2': 1, '4': 1 });           // ほかの種類は通る
  const q = parse(w.ls, 'takken2027-progress-queue');
  assert.deepEqual(q.map(i => [i.kind, i.key, i.value]), [['kako', '3', 2]]); // kako の 400 は捨てずに残す
});
test('kako: a kako change made before the login check ends is sent afterwards, and the server value reaches the device', async () => {
  const w = world({ server: { loggedIn: 'email', kako: { '1': 2 } } });
  const p = w.P.init({});
  w.P.set('kako', '1', 1); // 確認の途中
  await p; await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(w.st.kako, { '1': 1 });
  assert.deepEqual(parse(w.ls, 'takken2027-kako'), { '1': 1 });
});
test('kako: the solving code (line-full.js / ep1-full.js) writes takken2027-kako and calls TakkenProgress.set("kako", ...); the old trial roadmap shows the tag; the production roadmap does not (Kei 2026-11-16: 過去問の記録は過去問まとめページで使う)', () => {
  const root = path.join(__dirname, '..');
  for (const f of ['ep1-full.js', '../ep/1/line-full.js']) {
    const js = fs.readFileSync(path.join(root, f), 'utf8');
    assert.match(js, /localStorage\.setItem\('takken2027-kako'/, f);
    assert.match(js, /TakkenProgress\.set\('kako', KAKO_EP, v\)/, f);
    assert.match(js, /var v = ok \? 1 : 2;/, f);
    assert.ok(js.indexOf('saveKako(ok);') > js.indexOf('var ok = '), f);
  }
  for (const f of ['roadmap-an2.html']) {
    const h = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(h.includes("K_K = 'takken2027-kako'") && h.includes('過去問 ○') && h.includes('過去問 ×'), f);
    assert.match(h, /\.acts \.kk\.kk-ng \{ background: none;/, f);
  }
  // 本番のロードマップ：過去問の印は出さない。丸の下の印は「3問」だけ
  const prod = fs.readFileSync(path.join(root, '../roadmap/index.html'), 'utf8');
  assert.ok(!prod.includes('過去問 ○') && !prod.includes('過去問 ×') && !/\.acts \.kk/.test(prod), 'roadmap/index.html');
  assert.match(prod, /<span class="ck'\+\(DN\[e\.n\]\?' on':''\)\+'">3問/, 'roadmap/index.html');
});

/* ---- ○×1日1問の記録（ox）：4つ目の種類。端末のキーは takken2027-ichimon ---- */
const OA = { r: [1, 0, 1], t: '2027-01-04' }, OB = { r: [0], t: '2027-01-05' }, OC = { r: [1], t: '2027-01-06' };
test('ox: the device value is merged once; on the same key the newer t stays on the device and is sent back to the server', async () => {
  const w = world({
    local: { 'takken2027-ichimon': JSON.stringify({ o001: OA, o002: OC, o003: OA, bad: OA, o004: { r: [2], t: '2027-01-04' }, o005: { r: [1], t: '2027-01-04', x: 1 }, o006: { r: [], t: '2027-01-04' } }) },
    server: { loggedIn: 'email', ox: { o001: OB, o002: OB, o009: OB } },
  });
  await w.P.init({});
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(w.posts()[0].body.ox, { o001: OA, o002: OC, o003: OA }); // 形に合わないものは送らない
  assert.deepEqual(parse(w.ls, 'takken2027-ichimon'), { o001: OB, o002: OC, o003: OA, o009: OB }); // o001＝サーバーが新しい／o002＝端末が新しい
  assert.deepEqual(w.st.ox, { o001: OB, o002: OC, o003: OA, o009: OB }); // 端末が新しい o002 はサーバーへ送り直す
  assert.equal(w.ls.getItem('takken2027-progress-queue'), '[]');
  assert.equal(w.P.state(), 'synced');
});
test('ox: same t keeps the server value; set() sends kind ox (object only, null removes), the last value wins', async () => {
  const w = world({ local: { 'takken2027-ichimon': JSON.stringify({ o001: { r: [0], t: '2027-01-04' } }) }, server: { loggedIn: 'email', ox: { o001: OA } } });
  await w.P.init({});
  assert.deepEqual(parse(w.ls, 'takken2027-ichimon'), { o001: OA });
  const before = w.posts().length;
  w.P.set('ox', 'o002', OB);
  w.P.set('ox', 'o002', OC);
  w.P.set('ox', 'o003', 1);                     // 無視
  w.P.set('ox', 'o004', { r: [3], t: '2027-01-04' }); // 無視
  w.P.set('ox', 'o004', { r: [1], t: '2027-01-04', z: 1 }); // 無視
  w.P.set('ox', 'x1', OA);                      // 無視（キーの決まり）
  w.P.set('ox', 'o001', null);
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(w.posts().slice(before).map(p => p.body), [{ kind: 'ox', key: 'o002', value: OC }, { kind: 'ox', key: 'o001', value: null }]);
  assert.deepEqual(w.st.ox, { o002: OC });
  assert.equal(w.ls.getItem('takken2027-progress-queue'), '[]');
});
test('ox: not logged in sends nothing and leaves the device value alone', async () => {
  const dev = JSON.stringify({ o001: OA });
  const w = world({ local: { 'takken2027-ichimon': dev } });
  await w.P.init({});
  w.P.set('ox', 'o001', OB);
  assert.equal(w.log.filter(l => l.url === '/api/progress').length, 0);
  assert.equal(w.ls.getItem('takken2027-ichimon'), dev);
});
test('ox: an old server (no ox in the reply) does not break anything; the device value stays and the change waits in the queue', async () => {
  const w = world({ local: { 'takken2027-ichimon': JSON.stringify({ o001: OA }), 'takken2027-listened': '{"1":1}' }, server: { loggedIn: 'email', listened: { '2': 1 } } });
  await w.P.init({});
  assert.equal(w.P.state(), 'synced');
  assert.deepEqual(parse(w.ls, 'takken2027-ichimon'), { o001: OA });
  w.P.set('ox', 'o003', OB);
  w.P.set('listened', '4', 1);
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(w.st.listened, { '1': 1, '2': 1, '4': 1 });
  assert.deepEqual(parse(w.ls, 'takken2027-progress-queue').map(i => [i.kind, i.key, i.value]), [['ox', 'o003', OB]]);
});
test('ox: a change made before the login check ends is sent afterwards, and the server value reaches the device', async () => {
  const w = world({ server: { loggedIn: 'email', ox: { o001: OA, o002: OB } } });
  const p = w.P.init({});
  w.P.set('ox', 'o001', OC); // 確認の途中
  await p; await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(w.st.ox, { o001: OC, o002: OB });
  assert.deepEqual(parse(w.ls, 'takken2027-ichimon'), { o001: OC, o002: OB });
});
test('ox: the other fields on the device (takken2027-ichimon-day) are never touched', async () => {
  const w = world({ local: { 'takken2027-ichimon-day': '{"d":"2027-01-04","id":"o001"}' }, server: { loggedIn: 'email', ox: { o001: OA } } });
  await w.P.init({});
  assert.equal(w.ls.getItem('takken2027-ichimon-day'), '{"d":"2027-01-04","id":"o001"}');
});
