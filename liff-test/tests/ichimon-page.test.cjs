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

// 日の行き来の規則だけを取り出して動かす（DOM なし）
function navRules(today) {
  const h = copy('index.html');
  const src = h.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];
  const a = src.indexOf('function pad(n)'), b = src.indexOf('function jstToday');
  const c = src.indexOf('function addDays'), d = src.indexOf('function renderDayNav');
  const sandbox = { window: {}, TODAY: today };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'ichimon', 'questions.js'), 'utf8'), sandbox);
  vm.runInContext('var D=window.ICHIMON,BY={};D.questions.forEach(function(q){BY[q.id]=q;});var TODAY=' + JSON.stringify(today) + ',viewDay=TODAY;'
    + src.slice(a, b) + src.slice(c, d)
    + ';this.api={set:function(v){viewDay=v;},canPrev:canPrev,canNext:canNext,prevDay:prevDay};', sandbox);
  return sandbox.api;
}

test('ichimon page: day navigation (prev back to 2027-01-04; next only up to today, no 先取り)', () => {
  const n = navRules('2027-01-12');
  const at = d => { n.set(d); return [n.canPrev(), n.canNext()]; };
  assert.deepEqual(at('2027-01-04'), [false, true]);
  assert.deepEqual(at('2027-01-09'), [true, true]);    // 1/10 は復習の日だが今日以前
  assert.deepEqual(at('2027-01-11'), [true, true]);    // 1/12 は今日
  assert.deepEqual(at('2027-01-12'), [true, false]);   // 今日より先へは進めない（Kei 11/17）
  const t2 = navRules('2027-01-09');
  t2.set('2027-01-09'); assert.equal(t2.canNext(), false); // 1/10 は復習の日で今日より先
  assert.equal(navRules('2026-11-17').canPrev(), false);
});

test('ichimon page: bottom tab bar, hash screens, review days kept per date, small type', () => {
  const h = copy('index.html');
  for (const k of ['ichimon', 'kiroku', 'fukushu', 'subete']) assert.ok(h.includes('k:"' + k + '"'), k);
  for (const n of ['1日1問', '記録', '復習', 'すべて']) assert.ok(h.includes('n:"' + n + '"'), n);
  assert.ok(h.includes('env(safe-area-inset-bottom)') && h.includes('viewport-fit=cover'));
  assert.ok(h.includes('"hashchange"') && !h.includes('<details'));
  assert.match(h, /font-size:15px;line-height:1\.8/);
  assert.match(h, /height:48px/);
  assert.ok(h.includes('DayPick.get(viewDay)') && h.includes('DayPick.set(viewDay,id)'));
  assert.ok(h.includes('"次の日の問題へ"') && !h.includes('"先取り"'));
  assert.ok(h.includes('jpDate(viewDay)+"の1問"') && h.includes('if(!asked[q.id]) return;'));
});

test('the production ichimon folder is not created yet', () => {
  assert.equal(fs.existsSync(path.resolve(root, '../ichimon')), false);
});
