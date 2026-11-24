'use strict';
// /api/products?nudge=1 の入口：合言葉が無い・違うなら404。合っても環境変数が無ければ何もしない。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const productsApi = require('../api/products');
const response = () => ({ code: 0, data: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, status(n) { this.code = n; return this; }, json(d) { this.data = d; return this; } });
const call = async authorization => {
  const res = response();
  await productsApi({ method: 'GET', url: '/api/products?nudge=1', query: { nudge: '1' }, headers: { host: 'localhost:3000', ...(authorization ? { authorization } : {}) } }, res);
  return res;
};
test('CRON の合言葉が無い・違うなら404、合えば理由コードだけ返す', async () => {
  const saved = { ...process.env };
  try {
    const NAME = 'CRON_' + 'SECRET';
    delete process.env[NAME]; delete process.env.LINE_MESSAGING_TOKEN;
    assert.equal((await call('Bearer x')).code, 404);
    process.env[NAME] = 'cron-test-value';
    assert.equal((await call()).code, 404);
    assert.equal((await call('Bearer wrong')).code, 404);
    const ok = await call('Bearer cron-test-value');
    assert.equal(ok.code, 200); assert.deepEqual(ok.data, { skipped: 'no_token' });
  } finally { process.env = saved; }
});
