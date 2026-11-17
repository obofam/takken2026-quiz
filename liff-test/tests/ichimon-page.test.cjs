'use strict';
// ○×1日1問ページ：記録の同期のつなぎ方と、試し用の写し（liff-test/ichimon）が公開待ちフォルダと同じこと。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const copy = f => fs.readFileSync(path.join(root, 'ichimon', f), 'utf8');
const waiting = path.resolve(root, '../../4_LINE運用/1日1問_公開待ち/ichimon');

test('ichimon page: loads /progress-sync.js, init with the production LIFF ID, ox set after the local write, onChange redraws, nothing breaks without the script', () => {
  const h = copy('index.html');
  assert.ok(h.includes('"/progress-sync.js"') && h.includes('https://static.line-scdn.net/liff/edge/2/sdk.js'));
  assert.ok(h.includes('2012583516-7vmvMorb'), '本番の LIFF ID はロードマップと同じ');
  assert.match(h, /TakkenProgress\.init\(\{ liffId: liffId, cookieHint: prod, onChange: function\(\)\{ renderToday\(\); refreshAll\(\); \} \}\)/);
  assert.ok(h.indexOf('localStorage.setItem(KEY, JSON.stringify(o));') < h.indexOf('pgSet(id, o[id]);'), '端末に書いてから送る');
  assert.match(h, /TakkenProgress\.set\("ox", id, val\)/);
  assert.ok(!h.includes('takken2027-progress-queue') && h.includes('takken2027-ichimon-day'));
  assert.ok(!/LINEのアカウントに保存/.test(h), '説明は足さない');
  // 同期の部品が無い・読めない：pgSet は待たせるだけで例外を出さない／pgStart は握りつぶす
  assert.match(h, /\.catch\(function\(\)\{\}\);\s*\}\s*if\(document\.readyState/);
});

test('ichimon page: the inline script is valid and the sync file is the one the page expects (set accepts kind ox)', () => {
  const h = copy('index.html');
  const m = h.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
  assert.doesNotThrow(() => new Function(m[1]));
  const js = fs.readFileSync(path.join(root, 'progress-sync.js'), 'utf8');
  assert.ok(js.includes("K_O = 'takken2027-ichimon'") && js.includes("kind !== 'ox'"));
});

test('liff-test/ichimon is a copy of 公開待ち/ichimon (same content, both files; skipped when the waiting folder is not on this machine)', t => {
  for (const f of ['index.html', 'questions.js']) assert.ok(fs.existsSync(path.join(root, 'ichimon', f)), f);
  if (!fs.existsSync(waiting)) { t.skip('公開待ちフォルダが無い'); return; }
  for (const f of ['index.html', 'questions.js']) assert.equal(copy(f), fs.readFileSync(path.join(waiting, f), 'utf8'), f);
});

test('the production ichimon folder is not created yet', () => {
  assert.equal(fs.existsSync(path.resolve(root, '../ichimon')), false);
});
