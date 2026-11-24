'use strict';
// ログイン時の LINE 表示名の預かり（NUDGE_NAME_COLLECT=1 のときだけ）。
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/session');
const original = global.fetch, env = { ...process.env };
Object.assign(process.env, { LINE_CHANNEL_ID: '2011606963', SUPABASE_URL: 'https://test.supabase.co', ['SESSION_' + 'SECRET']: 'test-value-at-least-thirty-two-bytes-long', ['SUPABASE_SECRET' + '_KEY']: 'sb_' + 'secret_test_only' });
after(() => { global.fetch = original; process.env = env; });
const response = () => { const headers = {}; return { code: 0, data: null, headers, setHeader(k, v) { headers[k] = v; }, getHeader(k) { return headers[k]; }, status(n) { this.code = n; return this; }, json(d) { this.data = d; return this; } }; };
const req = () => ({ method: 'POST', headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: { idToken: 'dummy-not-real' } });
const USER = '12345678-1234-4123-8123-123456789abc';
function setup({ claimsExtra = {}, nameFails = false } = {}) {
  const seen = [];
  global.fetch = async (url, options) => {
    const u = new URL(url); seen.push({ path: u.pathname, body: options?.body });
    if (url === 'https://api.line.me/oauth2/v2.1/verify') return { ok: true, json: async () => ({ aud: '2011606963', iss: 'https://access.line.me', exp: Date.now() / 1000 + 100, sub: 'name-test-user', ...claimsExtra }) };
    if (u.pathname === '/rest/v1/rpc/resolve_identity') return { ok: true, json: async () => USER };
    if (u.pathname === '/rest/v1/rpc/set_line_name') return nameFails ? { ok: false, status: 500, json: async () => ({ message: 'boom' }) } : { ok: true, json: async () => null };
    throw new Error('unexpected ' + url);
  };
  return seen;
}
const nameCalls = seen => seen.filter(x => x.path === '/rest/v1/rpc/set_line_name');
test('環境変数なしでは set_line_name を呼ばない', async () => {
  delete process.env.NUDGE_NAME_COLLECT;
  const seen = setup({ claimsExtra: { name: '花子' } }), res = response();
  await handler(req(), res);
  assert.equal(res.code, 200); assert.equal(nameCalls(seen).length, 0);
});
test('NUDGE_NAME_COLLECT=1 で name があれば、ログインした利用者の id で呼ぶ', async () => {
  process.env.NUDGE_NAME_COLLECT = '1';
  try {
    const seen = setup({ claimsExtra: { name: '花子' } }), res = response();
    await handler(req(), res);
    assert.equal(res.code, 200); assert.equal(res.data.userId, USER);
    assert.equal(nameCalls(seen).length, 1);
    assert.deepEqual(JSON.parse(nameCalls(seen)[0].body), { p_user_id: USER, p_name: '花子' });
  } finally { delete process.env.NUDGE_NAME_COLLECT; }
});
test('NUDGE_NAME_COLLECT=1 でも name が無い・空なら呼ばない', async () => {
  process.env.NUDGE_NAME_COLLECT = '1';
  try {
    for (const claimsExtra of [{}, { name: '' }, { name: '   ' }, { name: 5 }]) {
      const seen = setup({ claimsExtra }), res = response();
      await handler(req(), res);
      assert.equal(res.code, 200); assert.equal(nameCalls(seen).length, 0);
    }
  } finally { delete process.env.NUDGE_NAME_COLLECT; }
});
test('名前の保存が失敗してもログインは成功のまま', async () => {
  process.env.NUDGE_NAME_COLLECT = '1';
  const logs = []; const o = [console.log, console.error, console.warn]; console.log = console.error = console.warn = (...a) => logs.push(a.join(' '));
  try {
    const seen = setup({ claimsExtra: { name: '秘密の名前' }, nameFails: true }), res = response();
    await handler(req(), res);
    assert.equal(res.code, 200); assert.equal(res.data.userId, USER); assert.equal(nameCalls(seen).length, 1);
    assert.ok(!logs.join('\n').includes('秘密の名前'));
  } finally { [console.log, console.error, console.warn] = o; delete process.env.NUDGE_NAME_COLLECT; }
});
